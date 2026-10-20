-- Up Migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TYPE org_role        AS ENUM ('member', 'auditor', 'org_admin');
CREATE TYPE team_role       AS ENUM ('viewer', 'member', 'approver', 'admin');
CREATE TYPE item_type       AS ENUM ('customer_issue','engineering_problem','payment_investigation',
                                     'production_incident','compliance_request','operational_task');
CREATE TYPE item_status     AS ENUM ('open','in_progress','blocked','pending_approval','resolved','closed');
CREATE TYPE item_priority   AS ENUM ('p0','p1','p2','p3');           -- enum order = sort order (p0 first)
CREATE TYPE approval_state  AS ENUM ('not_required','not_requested','pending','approved','rejected');
CREATE TYPE approval_decision AS ENUM ('pending','approved','rejected');
CREATE TYPE outbox_status   AS ENUM ('pending','processing','done','dead');

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL CHECK (char_length(email) <= 254),
  display_name   text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  password_hash  text NOT NULL,
  org_role       org_role NOT NULL DEFAULT 'member',
  is_active      boolean NOT NULL DEFAULT true,
  token_version  integer NOT NULL DEFAULT 0,       -- bump to revoke all tokens
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  slug       text NOT NULL CHECK (slug ~ '^[a-z0-9-]{2,40}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX teams_slug_uq ON teams (slug);

CREATE TABLE team_memberships (
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       team_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX team_memberships_user_idx ON team_memberships (user_id);

CREATE TABLE work_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number             bigint GENERATED ALWAYS AS IDENTITY UNIQUE,   -- human key: OPS-<number>
  team_id            uuid NOT NULL REFERENCES teams(id),
  type               item_type NOT NULL,
  title              text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description        text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
  status             item_status NOT NULL DEFAULT 'open',
  priority           item_priority NOT NULL DEFAULT 'p2',
  reporter_id        uuid NOT NULL REFERENCES users(id),
  assignee_id        uuid REFERENCES users(id),
  requires_approval  boolean NOT NULL DEFAULT false,
  approval_state     approval_state NOT NULL DEFAULT 'not_required',
  tags               text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tags) <= 10),
  due_at             timestamptz,
  resolution_note    text,
  close_reason       text CHECK (close_reason IN ('completed','cancelled','auto_closed')),
  version            integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_activity_at   timestamptz NOT NULL DEFAULT now(),
  stale_at           timestamptz,            -- last_activity_at + threshold(priority); NULL when resolved/closed
  stale_notified_at  timestamptz,
  overdue_notified_at timestamptz,
  resolved_at        timestamptz,
  closed_at          timestamptz,
  search_vector      tsvector GENERATED ALWAYS AS (
                       setweight(to_tsvector('english', coalesce(title,'')), 'A') ||
                       setweight(to_tsvector('english', coalesce(description,'')), 'B')
                     ) STORED,
  -- invariants enforced by the database itself:
  CONSTRAINT chk_progress_needs_assignee
    CHECK (status NOT IN ('in_progress','pending_approval') OR assignee_id IS NOT NULL),
  CONSTRAINT chk_approval_consistency
    CHECK ((requires_approval = false AND approval_state = 'not_required')
        OR (requires_approval = true  AND approval_state <> 'not_required')),
  CONSTRAINT chk_pending_state_match
    CHECK ((status = 'pending_approval') = (approval_state = 'pending')),
  CONSTRAINT chk_closed_has_reason
    CHECK (status <> 'closed' OR close_reason IS NOT NULL)
);

-- Active-work indexes (partial: closed items, the bulk of history, stay out of these)
CREATE INDEX wi_team_active_activity_idx ON work_items (team_id, last_activity_at DESC, id DESC) WHERE status <> 'closed';
CREATE INDEX wi_assignee_active_idx      ON work_items (assignee_id, priority, last_activity_at DESC) WHERE status NOT IN ('resolved','closed');
CREATE INDEX wi_team_priority_due_idx    ON work_items (team_id, priority, due_at, id) WHERE status NOT IN ('resolved','closed');
CREATE INDEX wi_unassigned_idx           ON work_items (team_id, priority, created_at, id) WHERE assignee_id IS NULL AND status = 'open';
CREATE INDEX wi_pending_approval_idx     ON work_items (team_id, last_activity_at, id) WHERE status = 'pending_approval';
CREATE INDEX wi_due_idx                  ON work_items (due_at) WHERE due_at IS NOT NULL AND status NOT IN ('resolved','closed');
CREATE INDEX wi_stale_idx                ON work_items (stale_at) WHERE stale_at IS NOT NULL;
CREATE INDEX wi_resolved_idx             ON work_items (resolved_at) WHERE status = 'resolved';
CREATE INDEX wi_team_created_idx         ON work_items (team_id, created_at DESC, id DESC);
CREATE INDEX wi_search_gin               ON work_items USING gin (search_vector);
CREATE INDEX wi_tags_gin                 ON work_items USING gin (tags);
CREATE INDEX wi_title_trgm               ON work_items USING gin (title gin_trgm_ops);

-- History: append-only. High volume; indexed for per-item and per-team reads.
CREATE TABLE item_events (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  item_id      uuid NOT NULL REFERENCES work_items(id),
  team_id      uuid NOT NULL REFERENCES teams(id),          -- team at the time of the event
  actor_id     uuid REFERENCES users(id),                   -- NULL = system
  type         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,          -- before/after, reason, etc.
  item_version integer NOT NULL,
  request_id   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX item_events_item_idx ON item_events (item_id, id DESC);
CREATE INDEX item_events_team_idx ON item_events (team_id, id DESC);

CREATE OR REPLACE FUNCTION item_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'item_events is append-only (% blocked)', TG_OP USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER item_events_no_update_delete BEFORE UPDATE OR DELETE ON item_events
  FOR EACH ROW EXECUTE FUNCTION item_events_immutable();
CREATE TRIGGER item_events_no_truncate BEFORE TRUNCATE ON item_events
  FOR EACH STATEMENT EXECUTE FUNCTION item_events_immutable();

CREATE TABLE comments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid NOT NULL REFERENCES work_items(id),
  team_id    uuid NOT NULL REFERENCES teams(id),            -- denormalized for resource-level authz
  author_id  uuid NOT NULL REFERENCES users(id),
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_item_idx ON comments (item_id, created_at, id);

CREATE TABLE approvals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id       uuid NOT NULL REFERENCES work_items(id),
  requested_by  uuid NOT NULL REFERENCES users(id),
  decided_by    uuid REFERENCES users(id),
  state         approval_decision NOT NULL DEFAULT 'pending',
  decision_note text,
  requested_at  timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  CONSTRAINT chk_decision_fields CHECK (
    (state = 'pending' AND decided_by IS NULL AND decided_at IS NULL) OR
    (state <> 'pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX approvals_one_pending_uq ON approvals (item_id) WHERE state = 'pending';
CREATE INDEX approvals_item_idx ON approvals (item_id, requested_at DESC);

CREATE TABLE item_watchers (
  item_id    uuid NOT NULL REFERENCES work_items(id),
  user_id    uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, user_id)
);
CREATE INDEX item_watchers_user_idx ON item_watchers (user_id);

CREATE TABLE notifications (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id),
  item_id    uuid NOT NULL REFERENCES work_items(id),
  event_id   bigint NOT NULL REFERENCES item_events(id),
  kind       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at    timestamptz,
  CONSTRAINT notifications_dedupe_uq UNIQUE (user_id, event_id, kind)      -- idempotent handlers
);
CREATE INDEX notifications_unread_idx ON notifications (user_id, id DESC) WHERE read_at IS NULL;
CREATE INDEX notifications_user_idx   ON notifications (user_id, id DESC);

CREATE TABLE outbox (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        bigint NOT NULL REFERENCES item_events(id),
  handler         text NOT NULL,
  status          outbox_status NOT NULL DEFAULT 'pending',
  attempts        integer NOT NULL DEFAULT 0,
  max_attempts    integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  CONSTRAINT outbox_event_handler_uq UNIQUE (event_id, handler)
);
CREATE INDEX outbox_pending_idx    ON outbox (next_attempt_at, id) WHERE status = 'pending';
CREATE INDEX outbox_processing_idx ON outbox (locked_until)        WHERE status = 'processing';
CREATE INDEX outbox_done_idx       ON outbox (completed_at)        WHERE status = 'done';

CREATE TABLE idempotency_keys (
  user_id             uuid NOT NULL REFERENCES users(id),
  key                 text NOT NULL CHECK (char_length(key) BETWEEN 8 AND 128),
  request_fingerprint text NOT NULL,        -- sha256(method + path + canonical JSON body)
  response_status     integer,              -- set before COMMIT; only 2xx stored
  response_body       jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_created_idx ON idempotency_keys (created_at);

-- Down Migration
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS outbox CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS item_watchers CASCADE;
DROP TABLE IF EXISTS approvals CASCADE;
DROP TABLE IF EXISTS comments CASCADE;
DROP TRIGGER IF EXISTS item_events_no_truncate ON item_events;
DROP TRIGGER IF EXISTS item_events_no_update_delete ON item_events;
DROP FUNCTION IF EXISTS item_events_immutable() CASCADE;
DROP TABLE IF EXISTS item_events CASCADE;
DROP TABLE IF EXISTS work_items CASCADE;
DROP TABLE IF EXISTS team_memberships CASCADE;
DROP TABLE IF EXISTS teams CASCADE;
DROP TABLE IF EXISTS users CASCADE;

DROP TYPE IF EXISTS outbox_status;
DROP TYPE IF EXISTS approval_decision;
DROP TYPE IF EXISTS approval_state;
DROP TYPE IF EXISTS item_priority;
DROP TYPE IF EXISTS item_status;
DROP TYPE IF EXISTS item_type;
DROP TYPE IF EXISTS team_role;
DROP TYPE IF EXISTS org_role;
