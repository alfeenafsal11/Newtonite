# OpsFlow — Implementation Plan

**Product:** OpsFlow, an internal operational work-coordination web application (first usable version)
**Source of truth for scope:** `PROBLEM_STATEMENT.md` (the "Problem Statement"). If anything in this plan appears to conflict with the Problem Statement, the Problem Statement wins and the conflict must be recorded in `KNOWN_LIMITATIONS.md`.
**Document status:** Final plan. Everything an implementer needs (stack and versions, structure, data model, API, algorithms, tests, and the text of every required deliverable file) is inside this single file.

---

## 0. Adherence Directive (read first, applies to every implementer, human or AI agent)

You are implementing a system against a fixed problem statement. You MUST:

1. **Stay inside the Problem Statement.** Build only what is required or directly supports a required behaviour. The Problem Statement says it prefers *"a smaller system with well-considered behaviour than a large system containing many incomplete features"*. Do not add features from Section 2.2 (Out of scope), even if easy.
2. **Honour every hard constraint**, none of which may be traded away:
   - C1. Authorization is **enforced by the server** (API + domain layer + DB constraints), never only by hiding UI controls.
   - C2. The browser **never loads the entire dataset**; the server **never processes the full dataset in application memory**. All listing is paginated in the database; all filtering/search/aggregation runs in SQL.
   - C3. Important actions **never silently disappear**: every state-changing action writes an append-only history event in the same DB transaction.
   - C4. At least **three** situations where correctness exceeds simple CRUD are implemented **and tested** (this plan implements seven, Section 12).
   - C5. Concurrency situations named in the Problem Statement are handled deliberately: two users claiming the same work; viewing stale data; multiple updates in a short period; repeated requests after uncertain outcome.
   - C6. If asynchronous processing is used, behaviour on **failure, duplicate execution, and delay** is defined and tested (Section 13).
   - C7. The deliverables listed in Section 22 all exist, with exactly the names given.
   - C8. UI emphasis is on **coherent, responsive behaviour**, not decoration. No design systems, animations, themes, or icon libraries.
   - C9. Assumptions are **documented** (Section 3 is copied into `README.md`/`ENGINEERING_DECISIONS.md` as specified).
3. **Use exactly the technologies and versions in Section 4.** If a pinned version cannot be installed, choose the nearest *patch* release of the same minor, commit the lockfile, and record the substitution in `KNOWN_LIMITATIONS.md`. Do not swap libraries or add new runtime dependencies without recording the reason in `ENGINEERING_DECISIONS.md`.
4. **Resolve gaps conservatively.** Where this plan is silent, choose the simplest option that satisfies C1–C9, and add a one-line entry to the "Assumptions" section of `README.md`. Never invent requirements, roles, or screens that are not needed.
5. **Never claim completion without evidence.** Each phase in Section 21 has a *gate* (a command with an expected result). A phase is complete only when the command was actually run and its output pasted into `docs/PROGRESS.md`. Reported-complete without pasted evidence = not complete. Failing or skipped tests must be listed, never hidden.
6. **Never weaken a test to make it pass.** If a test in Section 20 fails, fix the code. A test may only be changed if the plan itself is wrong, and the change must be logged in `docs/PROGRESS.md` with the reason.
7. **Do not deliver the required files separately.** Required files (`README.md`, `ENGINEERING_DECISIONS.md`, `KNOWN_LIMITATIONS.md`, `docs/ARCHITECTURE.md`) are created inside the repository from the text in Section 22 of this plan.

---

## 1. Paste-ready kickoff prompt for an implementing agent

```text
Implement OpsFlow exactly as specified in IMPLEMENTATION_PLAN.md, against PROBLEM_STATEMENT.md.
Rules: follow Section 0 (Adherence Directive); use only the stack/versions in Section 4; create the repo layout in Section 5;
execute phases in Section 21 in order; do not start a phase before the previous gate passes; paste each gate's real command output
into docs/PROGRESS.md; do not build anything in Section 2.2; create the four deliverable docs from Section 22 verbatim (then adjust only
facts that differ from what you actually built, and say so). If anything is ambiguous, pick the simplest option consistent with
Section 0 and record it under "Assumptions" in README.md. Stop and report if a hard constraint (C1–C9) cannot be met.
```

---

## 2. Problem restatement and scope

### 2.1 In scope (maps 1:1 to the Problem Statement)

| # | Problem Statement requirement | Delivered as |
|---|---|---|
| R1 | Create/manage operational work items; understand what/why, state, importance, owner, history, what's next | `work_items` + `item_events` + `comments` + `allowed_actions` + dashboard "attention" |
| R2 | Multiple teams, multi-membership, per-team responsibilities, server-enforced authorization | `teams`, `team_memberships(role)`, `domain/permissions.ts`, resource-level checks |
| R3 | Collaboration and history; important actions never silently disappear | Comments, watchers, append-only `item_events` (DB-enforced immutability) |
| R4 | Concurrency (claim race, stale view, burst updates, repeated request) | Row lock + optimistic `version`, atomic claim, in-transaction idempotency keys, SSE staleness signal |
| R5 | Useful overview; find work without browsing everything; usable at scale | `GET /dashboard/attention`, `GET /dashboard/overview`, filtered/searchable keyset-paginated list |
| R6 | Optional async processing with failure/duplicate/delay handling | Transactional outbox + SKIP LOCKED worker + idempotent handlers + scheduler |
| R7 | Scale: thousands of users, hundreds–thousands concurrent, tens of thousands of active items, large history | Indexes, keyset pagination, partial indexes, bounded SSE, no full-dataset loads |
| R8 | ≥3 non-CRUD correctness situations | Section 12 (seven) |
| R9 | `ENGINEERING_DECISIONS.md` (~5 decisions with trade-offs) | Section 22.2 |
| R10 | Automated tests for dangerous behaviours | Section 20 |
| R11 | Submission: source, run instructions, setup, decisions doc, tests, known limitations | Section 22 |

### 2.2 Explicitly out of scope (do NOT build)

Self-service sign-up, SSO/OAuth/SAML, password reset email flow, MFA, file attachments, @mentions, email/Slack/push delivery (notifications are in-app only), editable/deletable comments, custom workflows or custom fields per team, SLA policy editor, saved views, bulk actions, import/export, i18n, dark mode, mobile layout beyond basic responsiveness, multi-region or HA deployment, Redis/Kafka/Elasticsearch, microservices, GraphQL, event sourcing, audit-log export, per-field permissions.

---

## 3. Assumptions and decisions for unspecified points

These are deliberate choices. Copy this table into `README.md` under "Assumptions".

| ID | Unspecified point | Decision |
|---|---|---|
| A1 | Tenancy | One company (single tenant). No `org_id` column. |
| A2 | Identity | Users are provisioned by an `org_admin` (or the seed script). Email + password login. No self-signup. |
| A3 | What is a "work item" | One table with a `type` enum: `customer_issue`, `engineering_problem`, `payment_investigation`, `production_incident`, `compliance_request`, `operational_task`. Type is informational, except `requires_approval` which is a per-item boolean set at creation (default `false`; default `true` for `payment_investigation` and `compliance_request`, overridable by a team `member+` at creation only). |
| A4 | Ownership | An item belongs to exactly one team (`team_id`) and has at most one assignee, who must be a member (`member` or higher) of that team. |
| A5 | Roles | Org-level: `member`, `auditor` (read-only everywhere), `org_admin` (admin everywhere). Team-level: `viewer` < `member` < `approver` < `admin`, cumulative. A user can have a different role in each team. |
| A6 | Visibility | A user can see an item only if they have any role in its team (or are `auditor`/`org_admin`). Items of other teams behave as **non-existent (404)**, to avoid leaking existence. |
| A7 | Priorities | `p0` (critical) … `p3` (low). Setting or changing a `p0` priority requires team role `approver` or higher. |
| A8 | Staleness | An active item is "stale" when it has had no activity for a priority-dependent time: p0 2h, p1 24h, p2 72h, p3 168h (configurable by env). |
| A9 | Overdue | An active item is overdue when `due_at < now()`. |
| A10 | Approval | Items with `requires_approval=true` cannot be resolved until approved. The approver must hold `approver+` in the item's team and must not be the requester or the current assignee (separation of duties). |
| A11 | Comments | Append-only (no edit/delete) in v1, to preserve history integrity. |
| A12 | Versioning | `version` increments on any change to item fields, assignee, status, approval state, or team. Comments do **not** bump `version` (otherwise every comment would conflict with every edit). |
| A13 | Cross-team transfer | Allowed for the assignee or a team `admin` of the source team, and only to a team where the actor is at least `member` (or `org_admin`). Assignee is cleared if not a member of the target team. |
| A14 | Time | All timestamps stored as `timestamptz` (UTC); UI renders in browser locale. |
| A15 | Notifications | In-app only, produced asynchronously; recipients are item watchers (reporter, assignee, anyone who commented/acted) except the actor. |
| A16 | Data retention | History is kept indefinitely (never deleted). Idempotency keys expire after 24h; processed outbox rows after 7 days. |
| A17 | Browser support | Current evergreen Chrome, Firefox, Safari, Edge. |
| A18 | Clock | Server time (`now()` in PostgreSQL) is authoritative. Client clocks are never trusted. |

---

## 4. Technology stack and pinned versions

**Rationale for the whole stack:** PostgreSQL gives transactions, row locks, partial indexes, full-text search, `LISTEN/NOTIFY`, and `SKIP LOCKED` queues in one dependency, which is everything the correctness requirements need. One language (TypeScript) across API, worker, and web keeps the codebase maintainable within the time limit.

### 4.1 Platform requirements

| Requirement | Version |
|---|---|
| OS | Linux, macOS, or Windows via WSL2 |
| Node.js | **22.12.0** (pin in `.nvmrc`; `engines.node: ">=22.12.0 <23"`) |
| npm | **10.9.0** (workspaces) |
| Docker Engine | ≥ 24.0 |
| Docker Compose | v2 (≥ 2.20) |
| PostgreSQL (container image) | `postgres:16.6-alpine` |
| PostgreSQL extensions | `pg_trgm` (bundled with the image; `gen_random_uuid()` is built into PG ≥ 13) |
| Git | ≥ 2.39 |

### 4.2 Backend (`apps/api`) dependencies (exact versions, no `^`)

| Package | Version | Purpose |
|---|---|---|
| typescript | 5.6.3 | Language |
| tsx | 4.19.2 | Dev runner / scripts |
| fastify | 5.1.0 | HTTP server |
| @fastify/cors | 10.0.1 | CORS allowlist |
| @fastify/helmet | 12.0.1 | Security headers |
| @fastify/rate-limit | 10.2.1 | Basic abuse control |
| @fastify/static | 8.0.3 | Serves built web app in the Docker profile |
| pg | 8.13.1 | PostgreSQL driver |
| node-pg-migrate | 7.8.0 | SQL migrations |
| zod | 3.23.8 | Request/response validation |
| jose | 5.9.6 | JWT sign/verify |
| argon2 | 0.41.1 | Password hashing (argon2id) |
| pino | 9.5.0 | Structured logging |
| pino-pretty | 13.0.0 (dev) | Readable dev logs |
| @types/node | 22.10.1 (dev) | Types |
| @types/pg | 8.11.10 (dev) | Types |
| vitest | 2.1.8 (dev) | Test runner |

### 4.3 Frontend (`apps/web`) dependencies

| Package | Version | Purpose |
|---|---|---|
| react / react-dom | 18.3.1 | UI |
| vite | 5.4.11 | Build/dev server |
| @vitejs/plugin-react | 4.3.4 | Vite React plugin |
| @tanstack/react-query | 5.62.7 | Server-state cache, optimistic updates |
| @tanstack/react-virtual | 3.10.9 | List virtualization |
| react-router-dom | 6.28.0 | Routing |
| zod | 3.23.8 | Shared DTO validation of API responses |
| vitest | 2.1.8 (dev) | Tests |
| @testing-library/react | 16.1.0 (dev) | Component tests |
| @testing-library/user-event | 14.5.2 (dev) | Interaction tests |
| jsdom | 25.0.1 (dev) | DOM for tests |
| @types/react / @types/react-dom | 18.3.12 / 18.3.1 (dev) | Types |

Styling: a single hand-written `styles.css` (no CSS framework).

### 4.4 Tooling (root)

| Package | Version |
|---|---|
| eslint | 9.15.0 |
| typescript-eslint | 8.16.0 |
| prettier | 3.4.1 |
| concurrently | 9.1.0 |
| dotenv | 16.4.5 |

### 4.5 TypeScript configuration

`strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, ESM (`"type": "module"`), API uses `moduleResolution: NodeNext`, web uses `moduleResolution: Bundler`. A shared `packages/contracts` workspace is **not** created; DTO schemas live in `apps/api/src/http/schemas.ts` and the web app has a mirrored `apps/web/src/api/types.ts` (kept small, validated by the API contract tests in Section 20).

### 4.6 Environment variables (`.env.example`, all required unless a default is shown)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://opsflow:opsflow@localhost:5432/opsflow` | App DB |
| `DATABASE_URL_TEST` | `postgres://opsflow:opsflow@localhost:5432/opsflow_test` | Test DB (created by test setup) |
| `JWT_SECRET` | *(none, ≥32 chars, app refuses to boot otherwise)* | HS256 signing key |
| `JWT_TTL_HOURS` | `8` | Token lifetime |
| `API_PORT` | `3000` | API port |
| `WEB_ORIGIN` | `http://localhost:5173` | CORS allowlist |
| `LOG_LEVEL` | `info` | pino level |
| `PG_POOL_MAX` | `20` | Pool size per process |
| `SSE_MAX_CONNECTIONS` | `2000` | Per-API-process cap |
| `WORKER_BATCH` | `50` | Outbox rows per poll |
| `WORKER_POLL_MS` | `1000` | Outbox poll interval |
| `OUTBOX_MAX_ATTEMPTS` | `8` | Then row becomes `dead` |
| `OUTBOX_LOCK_SECONDS` | `60` | Visibility timeout |
| `STALE_HOURS_P0/P1/P2/P3` | `2/24/72/168` | Staleness thresholds |
| `IDEMPOTENCY_TTL_HOURS` | `24` | Key retention |
| `AUTO_CLOSE_DAYS` | `7` | Resolved → closed |
| `RATE_LIMIT_PER_MINUTE` | `600` | Per IP (general) |
| `LOGIN_RATE_LIMIT_PER_MINUTE` | `10` | Per IP (login) |

---

## 5. Repository structure (create exactly this)

```text
opsflow/
├── package.json                    # npm workspaces: apps/api, apps/web; root scripts
├── .nvmrc                          # 22.12.0
├── .env.example
├── .gitignore
├── .prettierrc / eslint.config.js
├── docker-compose.yml              # postgres (+ optional "app" profile)
├── Dockerfile                      # multi-stage build: web build → api image
├── README.md                       # Section 22.1
├── ENGINEERING_DECISIONS.md        # Section 22.2
├── KNOWN_LIMITATIONS.md            # Section 22.3
├── docs/
│   ├── ARCHITECTURE.md             # Section 22.4 (diagrams)
│   └── PROGRESS.md                 # Gate evidence log (Section 0 rule 5)
├── scripts/
│   ├── seed.ts                     # small demo seed
│   └── seed-load.ts                # 20k items / 300k events performance seed
└── apps/
    ├── api/
    │   ├── package.json  tsconfig.json  vitest.config.ts
    │   ├── migrations/
    │   │   └── 1700000000000_init.sql        # Section 8 (full DDL)
    │   ├── src/
    │   │   ├── config.ts                      # env parsing/validation (zod)
    │   │   ├── server.ts                      # process entry: API (+ SSE hub)
    │   │   ├── app.ts                         # buildApp(): Fastify instance, plugins, routes
    │   │   ├── db/
    │   │   │   ├── pool.ts                    # pg Pool singleton
    │   │   │   ├── tx.ts                      # withTx(), retry on 40001/40P01
    │   │   │   └── errors.ts                  # PG error → domain error mapping
    │   │   ├── domain/                        # PURE logic, no I/O, heavily unit-tested
    │   │   │   ├── permissions.ts             # can(), effectiveRole(), policy table
    │   │   │   ├── transitions.ts             # state-machine table + guards
    │   │   │   ├── allowed-actions.ts         # computeAllowedActions()
    │   │   │   ├── events.ts                  # event type constants + payload builders
    │   │   │   ├── staleness.ts               # staleAtFor(priority, from)
    │   │   │   └── cursor.ts                  # encodeCursor()/decodeCursor()
    │   │   ├── http/
    │   │   │   ├── errors.ts                  # AppError classes + error envelope + handler
    │   │   │   ├── auth.ts                    # JWT verify, request.actor loading
    │   │   │   ├── idempotency.ts             # withIdempotency()
    │   │   │   ├── schemas.ts                 # zod request/response schemas
    │   │   │   └── request-context.ts         # request_id, logger binding
    │   │   ├── modules/
    │   │   │   ├── auth/        routes.ts service.ts
    │   │   │   ├── teams/       routes.ts service.ts
    │   │   │   ├── items/       routes.ts service.ts repo.ts list-query.ts
    │   │   │   ├── comments/    routes.ts service.ts
    │   │   │   ├── approvals/   routes.ts service.ts
    │   │   │   ├── dashboard/   routes.ts service.ts
    │   │   │   ├── notifications/ routes.ts service.ts
    │   │   │   └── stream/      routes.ts hub.ts   # SSE endpoint + LISTEN hub
    │   │   └── worker/
    │   │       ├── main.ts                    # worker process entry
    │   │       ├── outbox.ts                  # claim/complete/fail/backoff
    │   │       ├── handlers/
    │   │       │   ├── index.ts               # handler registry
    │   │       │   ├── notify-watchers.ts
    │   │       │   └── notify-approvers.ts
    │   │       └── scheduler.ts               # periodic jobs (advisory-locked)
    │   └── test/
    │       ├── helpers/ (db.ts, factory.ts, client.ts)
    │       ├── unit/ (permissions, transitions, allowed-actions, cursor, staleness, backoff)
    │       └── integration/ (claim-race, idempotency, optimistic-lock, workflow-approval,
    │                         authz, history-immutability, outbox, pagination-search, stream-authz)
    └── web/
        ├── package.json  tsconfig.json  vite.config.ts  index.html
        └── src/
            ├── main.tsx  App.tsx  styles.css
            ├── api/ (client.ts, types.ts, queryKeys.ts, idempotency.ts, sse.ts)
            ├── state/ (auth.tsx, filters.ts)
            ├── hooks/ (useItems.ts, useItem.ts, useItemMutations.ts, useDashboard.ts,
            │           useNotifications.ts, useEventStream.ts)
            ├── pages/ (LoginPage, DashboardPage, ItemsPage, ItemDetailPage, TeamMembersPage)
            ├── components/ (ItemTable, FilterBar, ItemHeader, ActionBar, Timeline, CommentBox,
            │                ApprovalPanel, ConflictBanner, StaleBanner, CreateItemDialog,
            │                NotificationBell, Toasts, ErrorBoundary)
            └── test/ (optimistic-claim, idempotent-retry, conflict-banner, stale-banner)
```

---

## 6. Runtime components ("agents") — what each does, when it runs, where it lives

There are **no LLM agents** at runtime. The following processes and modules are the system's active components.

| Component | Where | Runs when | Responsibility | Must never |
|---|---|---|---|---|
| **API process** | `apps/api/src/server.ts` → `app.ts` | Always | HTTP API; authenticates; authorizes; executes all mutations transactionally; serves SSE | Do slow/secondary work inline (notifications) |
| **Domain layer** | `apps/api/src/domain/*` | Called by services in the API and worker | Pure rules: permissions, transitions, allowed actions, staleness, cursors | Perform I/O |
| **Service layer** | `modules/*/service.ts` | Called by routes/worker | Orchestrates: load → authorize → guard → write item + event + outbox in **one** tx | Be bypassed by routes issuing SQL |
| **Repo/query layer** | `modules/items/repo.ts`, `list-query.ts` | Called by services | All SQL for items (parameterized, whitelisted sort columns) | Concatenate user input into SQL |
| **Idempotency middleware** | `http/idempotency.ts` | Wraps every mutating service call | In-tx dedupe by `(user_id, Idempotency-Key)` | Store non-2xx responses |
| **Outbox worker** | `apps/api/src/worker/main.ts`, `outbox.ts` | Always (separate process; ≥1 instance) | Claims pending `outbox` rows with `FOR UPDATE SKIP LOCKED`, runs handlers, retries with backoff, marks `dead` after max attempts | Assume exactly-once; handlers must be idempotent |
| **Handlers** | `worker/handlers/*` | Per outbox row | `notify-watchers`, `notify-approvers` insert `notifications` with `ON CONFLICT DO NOTHING` | Throw away errors (must rethrow so retry happens) |
| **Scheduler** | `worker/scheduler.ts` | Interval ticks inside the worker process | Stale sweep, overdue sweep, auto-close, idempotency/outbox cleanup; each guarded by `pg_try_advisory_xact_lock` | Run the same job concurrently on two instances |
| **SSE hub** | `modules/stream/hub.ts` | Always in API | One dedicated PG connection `LISTEN item_changed`; fans out **content-free** invalidation signals to authorized connected clients | Send item content over SSE |
| **Web app** | `apps/web` | In browser | Renders; caches server state; optimistic updates with rollback; conflict/stale UX | Be the only place authorization is enforced |

---

## 7. Architecture and data flow

### 7.1 Topology

```text
Browser (React, TanStack Query)
   │  REST /api/v1  (Bearer JWT, Idempotency-Key, expected_version)
   │  SSE  /api/v1/stream  (fetch-stream with Bearer header)
   ▼
API process(es) (Fastify) ──────────────┐
   │  transactions (pg Pool)            │ LISTEN item_changed (1 connection per API process)
   ▼                                    │
PostgreSQL 16  ◄────────────────────────┘
   ▲   tables: users, teams, team_memberships, work_items, item_events (append-only),
   │           comments, approvals, item_watchers, notifications, outbox, idempotency_keys
   │  claim rows (FOR UPDATE SKIP LOCKED)
Worker process(es): outbox poller + scheduler
```

### 7.2 Mutation data flow (applies to every write endpoint; example: claim)

1. Fastify route validates the body/params with zod (`400 validation_error` on failure).
2. `auth` plugin verifies the JWT, loads the **actor** from DB (`users` + `team_memberships`) — authorization data is **never** trusted from the token. Inactive user or mismatched `token_version` → `401`.
3. `withIdempotency(actor, key, fingerprint, fn)` begins a transaction and `INSERT ... ON CONFLICT DO NOTHING` into `idempotency_keys`. If the row already existed (committed by an earlier request), return the stored response (`Idempotent-Replay: true`). If a concurrent identical request holds the uncommitted row, PostgreSQL makes this insert **wait** for it to commit or roll back, then proceeds accordingly.
4. Inside the same transaction, the service does `SELECT ... FROM work_items WHERE id=$1 FOR UPDATE` (row lock, held for milliseconds only).
5. If the item is not visible to the actor → `404 not_found`.
6. Check `expected_version` (where applicable) → `409 version_conflict` carrying the current item.
7. `can(actor, permission, resource)` and state-machine guards → `403 forbidden` / `409 invalid_transition` / `409 already_claimed`.
8. `UPDATE work_items SET ..., version=version+1, last_activity_at=now(), stale_at=..., ... WHERE id=$1 AND version=$2`.
9. `INSERT INTO item_events` (history), `INSERT INTO outbox` (one row per async handler), `INSERT INTO item_watchers` (as needed), `SELECT pg_notify('item_changed', payload)`.
10. Store the response in `idempotency_keys` (same tx) and `COMMIT`. `NOTIFY` is delivered **only on commit**.
11. Respond `200/201` with the full updated item DTO (including `version` and `allowed_actions`).

### 7.3 Asynchronous flow

`COMMIT` (step 10) → worker polls `outbox` → claims rows → handler inserts `notifications` (idempotent) → marks row `done`. A delayed or crashed worker never affects the correctness of the primary action or the dashboard (the dashboard computes attention directly from item state, not from notifications).

### 7.4 Real-time flow

`pg_notify` on commit → each API process's hub receives `{item_id, team_id, version, type, event_id}` → for each SSE connection whose user is authorized for `team_id`, write an SSE message with only those fields → the browser invalidates the relevant TanStack Query keys (list, dashboard, item) or, if the item detail has unsaved edits, shows a **StaleBanner**.

### 7.5 Read data flow

Routes call `list-query.ts` which builds one parameterized SQL statement: authorization predicate + filters + keyset predicate + `LIMIT n+1`; returns `{items, next_cursor}`. No endpoint returns an unbounded collection.

---
## 8. Data model (full DDL — put in `apps/api/migrations/1700000000000_init.sql`)

Design rules: UUID primary keys for externally visible entities; `bigint identity` for high-volume append-only tables; DB constraints enforce invariants as defense in depth; history is append-only and enforced by trigger.

```sql
-- node-pg-migrate: "Up Migration"
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

CREATE FUNCTION item_events_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
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
```

**Scale notes (record in `ENGINEERING_DECISIONS.md`):** `item_events` is the fastest-growing table. Per-item and per-team reads use `(item_id, id DESC)` / `(team_id, id DESC)` keyset access, so growth does not slow reads. The plan keeps one table for the first version; the documented next step is declarative range partitioning by `created_at` (no schema change required for readers).

**Event types** (`item_events.type`): `item_created`, `fields_updated`, `priority_changed`, `claimed`, `released`, `assigned`, `status_changed`, `comment_added`, `approval_requested`, `approval_approved`, `approval_rejected`, `transferred`, `stale_flagged`, `overdue_flagged`, `auto_closed`.

**Event payload convention:** `{ "changes": { "<field>": {"from": <old>, "to": <new>} }, "reason"?: string, "comment_id"?: uuid, "approval_id"?: uuid }`.

---

## 9. Authorization model

### 9.1 Principles

1. **Single policy module.** All decisions go through `domain/permissions.ts: can(actor, permission, ctx)`. Routes and services never contain ad-hoc `if (role === ...)` checks.
2. **Actor is loaded from the database on every request** (user row + memberships). The JWT carries only `sub` and `tv` (token_version). Role changes and deactivation take effect on the next request.
3. **Resource-level.** Decisions depend on the *specific item* (its team, assignee, reporter, status, approval requester), not only on global role.
4. **Existence hiding.** If the actor has no role in the item's team (and is not auditor/org_admin) the item is `404`, for reads and writes alike.
5. **Re-check inside the transaction.** The item row is locked and its `team_id`/`assignee_id`/`status` are read fresh before `can()` is evaluated, so decisions use current state, not state the client saw.
6. **UI mirrors, never decides.** The API returns `allowed_actions` computed by the same `can()`/transition code. The UI renders buttons from that list; the server still enforces independently.

### 9.2 Effective role

`effectiveRole(actor, teamId)`:
- `org_admin` → `admin` in every team
- `auditor` → `viewer` in every team
- else the membership role for `teamId`, or `none`
- When several apply, the highest wins. Role order: `none < viewer < member < approver < admin`.

### 9.3 Permission matrix

| Permission | viewer | member | approver | admin | Extra resource condition |
|---|:--:|:--:|:--:|:--:|---|
| `item.read` | ✓ | ✓ | ✓ | ✓ | team scope |
| `item.create` | – | ✓ | ✓ | ✓ | |
| `item.update` (title, description, tags, due, priority p1–p3) | – | ✓ | ✓ | ✓ | item not `closed` |
| `item.priority.p0` (set to p0, or change away from p0) | – | – | ✓ | ✓ | |
| `item.comment` | – | ✓ | ✓ | ✓ | item not `closed` |
| `item.claim` | – | ✓ | ✓ | ✓ | `assignee_id IS NULL`, status `open` or `blocked` |
| `item.release` | – | assignee only | assignee only | ✓ (any) | status `in_progress` or `blocked` |
| `item.assign` (to another user) | – | assignee only (hand-off) | assignee only | ✓ | target must be `member+` in team; status `open`/`in_progress`/`blocked` |
| `item.transition.*` | see Section 10 | | | | per-transition guard |
| `item.approval.request` | – | assignee only | assignee only | assignee or admin | `requires_approval`, state `in_progress` |
| `item.approval.decide` | – | – | ✓ | ✓ | actor ≠ requester **and** actor ≠ assignee |
| `item.transfer` | – | assignee only | assignee only | ✓ | actor must be `member+` in target team (or `org_admin`) |
| `item.cancel` | – | reporter only | reporter only | ✓ | status not `closed` |
| `team.members.read` | ✓ | ✓ | ✓ | ✓ | |
| `team.members.manage` | – | – | – | ✓ | |
| `org.users.manage`, `org.teams.create` | `org_admin` only | | | | |

`auditor` can read everything and never write. `GET /dashboard/overview` and list endpoints automatically scope to the actor's teams unless `auditor`/`org_admin`.

### 9.4 `can()` contract

```ts
type Permission = 'item.read' | 'item.create' | 'item.update' | 'item.priority.p0' | 'item.comment'
  | 'item.claim' | 'item.release' | 'item.assign' | 'item.approval.request' | 'item.approval.decide'
  | 'item.transfer' | 'item.cancel' | 'team.members.read' | 'team.members.manage'
  | 'org.users.manage' | 'org.teams.create';

interface Decision { allowed: boolean; reason?: string }   // reason is a stable code, e.g. 'role_insufficient'

function can(actor: Actor, permission: Permission, ctx?: { teamId?: string; item?: ItemRow; approvalRequesterId?: string; targetTeamId?: string }): Decision
```

Pure function; no I/O. Exhaustively unit-tested (every permission × every role × key resource conditions).

---

## 10. Workflow (state machine) — `domain/transitions.ts`

```mermaid
stateDiagram-v2
  [*] --> open: create
  open --> in_progress: claim / assign
  open --> closed: cancel
  in_progress --> blocked: block (reason)
  blocked --> in_progress: unblock
  in_progress --> open: release
  blocked --> open: release
  in_progress --> pending_approval: request_approval
  pending_approval --> in_progress: approve / reject
  in_progress --> resolved: resolve (note; approval if required)
  resolved --> in_progress: reopen
  resolved --> closed: close / auto_close
  in_progress --> closed: cancel
  blocked --> closed: cancel
  pending_approval --> closed: cancel
  closed --> [*]
```

### 10.1 Transition table (the only source of allowed status changes)

| Name | From | To | Who (beyond role) | Guards / required input | Side effects |
|---|---|---|---|---|---|
| `claim` | `open`, `blocked` | `in_progress` if was `open`, unchanged if `blocked` | any `member+` | `assignee_id IS NULL` | set assignee=actor; watcher add |
| `assign` | `open`,`in_progress`,`blocked` | `in_progress` if was `open`, else unchanged | assignee (hand-off) or `admin` | target is `member+` in team | set assignee=target; watcher add |
| `release` | `in_progress`,`blocked` | `open` | assignee or `admin` | — | assignee=NULL |
| `block` | `in_progress` | `blocked` | assignee | `reason` (1–1000 chars) | |
| `unblock` | `blocked` | `in_progress` | assignee | assignee not null | |
| `request_approval` | `in_progress` | `pending_approval` | assignee (or `admin`) | `requires_approval=true`; `approval_state ∈ {not_requested, rejected}` | insert `approvals` row (state `pending`); `approval_state='pending'` |
| `approve` | `pending_approval` | `in_progress` | `approver+` | actor ≠ requester and ≠ assignee; pending approval exists | approval row → `approved`; `approval_state='approved'` |
| `reject` | `pending_approval` | `in_progress` | `approver+` | same as approve; `note` required (1–1000) | approval row → `rejected`; `approval_state='rejected'` |
| `resolve` | `in_progress` | `resolved` | assignee | `resolution_note` required; if `requires_approval` then `approval_state='approved'` | `resolved_at=now()` |
| `reopen` | `resolved` | `in_progress` | `member+` | `reason` required; assignee not null (if null, actor becomes assignee) | if `requires_approval` → `approval_state='not_requested'`; `resolved_at=NULL` |
| `close` | `resolved` | `closed` | reporter or `admin` | — | `close_reason='completed'`, `closed_at=now()` |
| `cancel` | any non-closed | `closed` | reporter or `admin` | `reason` required | `close_reason='cancelled'`, `closed_at=now()` |
| `auto_close` | `resolved` | `closed` | **system** (scheduler) | `resolved_at < now() - AUTO_CLOSE_DAYS` | `close_reason='auto_closed'` |

`closed` is terminal. Any `(from, to, name)` not in this table → `409 invalid_transition` with `{from, requested}` in `details`.

### 10.2 Implementation shape

```ts
interface TransitionDef {
  name: TransitionName; from: ItemStatus[]; to: (item: ItemRow) => ItemStatus;
  permission: (actor: Actor, item: ItemRow) => Decision;           // calls can()
  guard: (item: ItemRow, input: TransitionInput) => GuardResult;   // pure business guards
  apply: (item: ItemRow, input: TransitionInput, actor: Actor) => Partial<ItemRow>;  // pure patch
}
export const TRANSITIONS: Record<TransitionName, TransitionDef>;
export function evaluateTransition(name, actor, item, input): { ok: true; patch: Partial<ItemRow> } | { ok: false; code: 'forbidden'|'invalid_transition'|'guard_failed'|'validation_error'; detail: string };
```

The service executes: lock row → `evaluateTransition` → if ok, `UPDATE` with `patch` → event → outbox. The database `CHECK` constraints in Section 8 are the last line of defence (a bug in guards raises a constraint error, mapped to `500 internal` and logged, never silent corruption).

### 10.3 `allowed_actions`

`computeAllowedActions(actor, item): AllowedAction[]` evaluates every transition's `from`, `permission` and non-input guards plus `update`, `comment`, `claim`, `assign`, `release`, `transfer`, `cancel`, `approve`, `reject`. Output example: `["comment","update","claim","cancel"]`. It is computed on every item response and unit-tested against the permission matrix.

---

## 11. API specification (`/api/v1`)

### 11.1 Conventions

- JSON only; `Content-Type: application/json`; body limit 100 KB.
- Auth: `Authorization: Bearer <jwt>` on everything except `POST /auth/login` and `GET /healthz`.
- Mutations: header `Idempotency-Key: <uuid>` is **required** on every `POST`/`PATCH` except login (`400 idempotency_key_required` if missing).
- Optimistic concurrency: body field `expected_version` (integer) is **required** on `PATCH /items/:id` and on transitions that depend on current item state (`transition`, `assign`, `transfer`, `approval/*`). `claim`, `release` and `comments` do not need it (their preconditions are state-based).
- Response headers: `X-Request-Id` always; `Idempotent-Replay: true` on replayed responses.
- Errors share one envelope:

```json
{ "error": { "code": "version_conflict", "message": "Item changed since you loaded it.",
             "details": { "current": { "...full item DTO..." } }, "request_id": "..." } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `validation_error`, `idempotency_key_required` | bad input; details list zod issues |
| 401 | `unauthenticated` | missing/invalid/expired token, inactive user, token_version mismatch |
| 403 | `forbidden` | actor can see the resource but may not perform the action; `details.reason` = stable code |
| 404 | `not_found` | missing **or not visible** to actor |
| 409 | `version_conflict` | `expected_version` ≠ current; `details.current` = current item |
| 409 | `already_claimed` | claim lost the race; `details.assignee` = {id, display_name} |
| 409 | `invalid_transition` | transition not allowed from current status |
| 409 | `guard_failed` | business guard (e.g., approval required before resolve) |
| 422 | `idempotency_key_reuse` | same key, different request fingerprint |
| 429 | `rate_limited` | rate limit |
| 500 | `internal` | unexpected; logged with request_id; message generic |

### 11.2 Endpoints

**Auth & identity**

| Method & path | Purpose | Notes |
|---|---|---|
| `POST /auth/login` | `{email,password}` → `{token, user}` | argon2id verify; constant-ish time on unknown email; stricter rate limit |
| `POST /auth/logout` | revoke tokens | increments `users.token_version` |
| `GET /me` | current user + `memberships[{team, role}]` | |

**Teams**

| Method & path | Purpose | Permission |
|---|---|---|
| `GET /teams` | teams visible to actor (all teams for auditor/org_admin) | authenticated |
| `GET /teams/:teamId/members` | members + roles | `team.members.read` |
| `PUT /teams/:teamId/members/:userId` | `{role}` add or change member role | `team.members.manage` |
| `DELETE /teams/:teamId/members/:userId` | remove member; refuses if member holds assigned active items in the team (`409 guard_failed`) | `team.members.manage` |

**Work items**

| Method & path | Purpose | Key behaviour |
|---|---|---|
| `POST /items` | create `{team_id,type,title,description?,priority?,tags?,due_at?,requires_approval?}` | `201`; event `item_created`; reporter becomes watcher; `item.create` in team; p0 needs `item.priority.p0` |
| `GET /items` | list (filters below) | keyset-paginated; authz-scoped in SQL |
| `GET /items/:id` | item DTO incl. `allowed_actions`, `version` | `404` if not visible |
| `PATCH /items/:id` | `{expected_version, title?, description?, tags?, due_at?, priority?}` | at least one field; only changed fields recorded; event `fields_updated` (+`priority_changed`) |
| `POST /items/:id/claim` | atomic take-ownership | `200` with item (also `200` if actor already holds it, no new event); `409 already_claimed` otherwise |
| `POST /items/:id/release` | `{}` | |
| `POST /items/:id/assign` | `{expected_version, assignee_id}` | |
| `POST /items/:id/transition` | `{expected_version, name, reason?, resolution_note?}` for `block`, `unblock`, `resolve`, `reopen`, `close`, `cancel` | uses Section 10 table |
| `POST /items/:id/transfer` | `{expected_version, team_id, reason?}` | |
| `POST /items/:id/approval/request` | `{expected_version}` | |
| `POST /items/:id/approval/approve` | `{expected_version, note?}` | |
| `POST /items/:id/approval/reject` | `{expected_version, note}` | |
| `GET /items/:id/events` | history, newest first, keyset `?cursor=&limit=` | includes comment events |
| `GET /items/:id/comments` | `?cursor=&limit=` oldest→newest | |
| `POST /items/:id/comments` | `{body}` | no version needed; bumps `last_activity_at`, not `version` |

**List filters (`GET /items`)** — all optional, combinable: `team_id` (repeatable), `status` (repeatable), `priority` (repeatable), `type` (repeatable), `assignee` (`me` \| `unassigned` \| `<uuid>`), `reporter` (`me`\|`<uuid>`), `tag`, `q` (search text or `OPS-123`/`123`), `due` (`overdue` \| `today` \| `week`), `stale=true`, `awaiting_my_approval=true`, `include_closed=false` (default excludes `closed`), `sort` (`activity_desc` default \| `priority_due` \| `created_desc`), `limit` (default 50, max 100), `cursor`.

**Dashboard**

| Method & path | Purpose |
|---|---|
| `GET /dashboard/attention` | Sections for the current user, each `{key,label,count,count_capped,items[≤10],filter_preset}`: `awaiting_my_approval`, `my_overdue`, `my_stale`, `my_active`, `unassigned_in_my_teams`, `unread_notifications`. Counts are capped (`count_capped=true` means “1000+”). |
| `GET /dashboard/overview?team_id=` | Management view for a team the actor can read: active counts by status and by priority, overdue, stale, unassigned, oldest unassigned age, last-7-day opened/resolved counts, most recent 20 events. |

**Notifications**

| Method & path | Purpose |
|---|---|
| `GET /notifications?cursor=&limit=&unread=` | keyset, newest first |
| `POST /notifications/read` | `{up_to_id}` marks read (idempotent) |

**Stream & health**

| Method & path | Purpose |
|---|---|
| `GET /stream` | SSE; messages `event: item_changed`, `data: {item_id,team_id,version,type,event_id}`; heartbeat comment every 25 s; `503` when over `SSE_MAX_CONNECTIONS` |
| `GET /healthz` | process liveness |
| `GET /readyz` | DB reachable (`SELECT 1`) |

**Item DTO** (response): `id, number, key ("OPS-<number>"), team{id,name}, type, title, description, status, priority, reporter{id,display_name}, assignee{id,display_name}|null, requires_approval, approval_state, tags[], due_at, is_overdue, is_stale, resolution_note, version, created_at, updated_at, last_activity_at, allowed_actions[]`.

---

## 12. Critical behaviours (correctness beyond CRUD) — all implemented and tested

| # | Behaviour | Mechanism | Test file |
|---|---|---|---|
| **CB1** | **Simultaneous claim**: N users claim the same unassigned item at once → exactly one wins, the others get `409 already_claimed` naming the winner; exactly one `claimed` event | Row lock (`SELECT … FOR UPDATE`) then state check + `UPDATE … WHERE assignee_id IS NULL AND version=$v`; event in same tx | `claim-race.test.ts` |
| **CB2** | **Stale update protection**: two users edit the same version → second gets `409 version_conflict` with the current item; no lost update; UI offers reload / re-apply | Required `expected_version`; `UPDATE … WHERE version=$v`; version bump | `optimistic-lock.test.ts` |
| **CB3** | **Repeat-safe actions**: user retries after timeout/uncertainty; concurrent duplicates → one effect, identical response | `Idempotency-Key` row inserted **inside the business transaction** with `ON CONFLICT DO NOTHING`; concurrent duplicate blocks on the unique index until the first commits | `idempotency.test.ts` |
| **CB4** | **Workflow rules + separation of duties**: illegal transitions rejected; item needing approval cannot be resolved unapproved; approver cannot be requester/assignee; concurrent approve vs reject → exactly one decision | Transition table; `approvals_one_pending_uq`; `chk_*` constraints; conditional update `WHERE state='pending'` | `workflow-approval.test.ts` |
| **CB5** | **Resource-level authorization**: non-members see 404; viewers cannot write; p0 needs approver; cross-team IDOR attempts on comments/events/transitions fail; auditor read-only | `can()` + team-scoped SQL + 404 hiding; tests call the API directly (no UI) | `authz.test.ts` |
| **CB6** | **History integrity**: every mutation yields exactly one event atomically; rollback leaves none; history cannot be updated/deleted even by SQL | Same-tx event insert; immutability trigger | `history-immutability.test.ts` |
| **CB7** | **Reliable async**: handler failure → retry with backoff then `dead`; duplicate delivery → no duplicate notifications; two workers → no double-processing; crashed worker → recovered; delay does not break primary flow | Transactional outbox; `SKIP LOCKED`; `locked_until`; unique `(user_id,event_id,kind)` | `outbox.test.ts` |
| CB8 (frontend) | **Optimistic UI reconciliation**: optimistic claim is rolled back and replaced by server truth when the server decides otherwise; retry reuses the same idempotency key | TanStack Query `onMutate/onError/onSettled`; key held per user intent | `apps/web/src/test/*` |

### 12.1 Concurrency rules in code (`modules/items/service.ts`)

- Every mutation runs in `withTx` (default `READ COMMITTED`). Row locks are held only for the transaction duration (milliseconds); never across user think time.
- `withTx` retries the **whole** transaction (max 3, jittered) on SQLSTATE `40001` and `40P01`. Because the idempotency row lives in the same transaction, a retry is safe.
- Lock order is always `work_items` row first, then `approvals`/`comments`/`item_events`/`outbox` inserts, preventing deadlocks.
- `SELECT … FOR UPDATE` is a plain blocking lock (not `NOWAIT`) with `SET LOCAL lock_timeout = '3s'`; a lock timeout (SQLSTATE `55P03`) maps to `503 busy` with `Retry-After: 1`.
- `statement_timeout` is set to `10s` per transaction (`SET LOCAL`).

### 12.2 Idempotency algorithm (`http/idempotency.ts`)

```text
withIdempotency(actor, key, fingerprint, work):
  BEGIN
  inserted = INSERT INTO idempotency_keys(user_id,key,request_fingerprint) VALUES (...) ON CONFLICT DO NOTHING RETURNING 1
  if not inserted:
      row = SELECT ... FROM idempotency_keys WHERE user_id=$1 AND key=$2
      COMMIT
      if row.request_fingerprint != fingerprint  -> 422 idempotency_key_reuse
      return stored (response_status, response_body) with header Idempotent-Replay: true
  result = work(tx)                         -- the business logic, same tx
  UPDATE idempotency_keys SET response_status, response_body WHERE user_id AND key
  COMMIT
  return result
  (any thrown AppError -> ROLLBACK -> key row disappears -> client may retry same key; outcome re-evaluated)
```

Only 2xx outcomes are stored. Non-2xx outcomes are deterministic functions of current state, so re-evaluation on retry is correct. A key is scoped per user (`user_id, key`) to prevent cross-user replay.
---

## 13. Asynchronous processing (transactional outbox)

### 13.1 What is async and what is not

| Synchronous (inside the request transaction) | Asynchronous (worker, after commit) |
|---|---|
| Authorization, validation, state change, history event, watcher subscription, idempotency record, outbox row creation, `pg_notify` | Creating in-app notifications for watchers/approvers; stale/overdue flagging; auto-close; cleanup jobs |

Rationale: the user's action must be correct and durable immediately; fan-out is secondary and may lag or be retried without affecting correctness.

### 13.2 Event → handler routing (`domain/events.ts: HANDLERS_FOR`)

| Event type | Outbox handlers created in the same tx |
|---|---|
| `claimed`, `released`, `assigned`, `status_changed`, `fields_updated`, `priority_changed`, `comment_added`, `approval_approved`, `approval_rejected`, `transferred`, `stale_flagged`, `overdue_flagged`, `auto_closed` | `notify_watchers` |
| `approval_requested` | `notify_approvers` (team members with `approver+`, excluding requester and assignee) **and** `notify_watchers` |
| `item_created` | `notify_watchers` (reporter only is watcher → actor excluded → no-op; kept for uniformity) |

### 13.3 Worker claim algorithm (`worker/outbox.ts: claimBatch`)

```sql
UPDATE outbox o
   SET status = 'processing',
       attempts = o.attempts + 1,
       locked_until = now() + make_interval(secs => $lockSeconds)
 WHERE o.id IN (
   SELECT id FROM outbox
    WHERE (status = 'pending' AND next_attempt_at <= now())
       OR (status = 'processing' AND locked_until < now())      -- crash recovery
    ORDER BY id
    LIMIT $batch
    FOR UPDATE SKIP LOCKED)
RETURNING o.*;
```

Per row: load the event (`item_events` join `work_items` minimal fields) → run `HANDLERS[row.handler](event, db)` → on success `UPDATE outbox SET status='done', completed_at=now(), locked_until=NULL`. On exception: if `attempts >= max_attempts` → `status='dead'` with `last_error`; else `status='pending'`, `next_attempt_at = now() + backoff(attempts)`, `last_error` stored.

`backoff(attempts) = min(5s × 2^(attempts-1), 15 min) + random(0..1s)` (pure function in `outbox.ts`, unit-tested).

### 13.4 Required behaviours when things go wrong

| Situation | Defined behaviour |
|---|---|
| Handler throws | Row retried with exponential backoff; after `OUTBOX_MAX_ATTEMPTS` becomes `dead` (kept for inspection; `GET`-able via SQL, logged at `error`). Primary action is unaffected. |
| Handler executes more than once (retry, crash-after-effect-before-ack, visibility timeout) | Handlers are idempotent: notifications use `INSERT … ON CONFLICT (user_id,event_id,kind) DO NOTHING`. Duplicate execution yields identical state. |
| Worker is slow, down, or delayed | Items, history, and dashboards are unaffected. Notifications appear when the worker resumes. `locked_until` expiry returns abandoned rows to the pool. |
| Two workers run | `FOR UPDATE SKIP LOCKED` ensures a row is claimed by one worker at a time. |
| Poison message | Capped by `max_attempts` → `dead`; does not block others (no head-of-line blocking because claim is per row). |

### 13.5 Scheduler jobs (`worker/scheduler.ts`)

Each job runs on an interval inside the worker. Each tick starts a transaction and calls `pg_try_advisory_xact_lock(hashtext('opsflow:<job>'))`; if not acquired, the tick is skipped (another instance is running it). Jobs process in batches of 200 using `FOR UPDATE SKIP LOCKED` and never load unbounded rows.

| Job | Interval | Logic |
|---|---|---|
| `staleSweep` | 60 s | `status NOT IN ('resolved','closed') AND stale_at < now() AND stale_notified_at IS NULL` → set `stale_notified_at=now()`; insert `stale_flagged` event (actor NULL) + outbox. Any later activity clears `stale_notified_at` and recomputes `stale_at`, so an item can be flagged again after it goes stale again. |
| `overdueSweep` | 60 s | `due_at < now() AND overdue_notified_at IS NULL AND status active` → set `overdue_notified_at`; `overdue_flagged` event + outbox. Changing `due_at` clears `overdue_notified_at`. |
| `autoCloseResolved` | 5 min | `status='resolved' AND resolved_at < now() - AUTO_CLOSE_DAYS` → status `closed`, `close_reason='auto_closed'`, version+1, `auto_closed` event + outbox. |
| `cleanup` | 1 h | delete `idempotency_keys` older than `IDEMPOTENCY_TTL_HOURS`; delete `outbox` rows `done` older than 7 days. **Never** deletes `item_events`. |

Dashboards compute `is_stale` / `is_overdue` **live** from `stale_at` / `due_at`, not from the flags, so a delayed scheduler cannot hide problems from users.

`staleAtFor(priority, from)` in `domain/staleness.ts` returns `from + threshold(priority)`; it is recomputed on every mutation and comment (activity), and set to `NULL` on `resolved`/`closed`.

---

## 14. Real-time updates (SSE) — `modules/stream`

- **Purpose:** keep views fresh and detect staleness; **never** to transport data.
- **Hub (`hub.ts`)**: on API start, open one dedicated `pg.Client`, `LISTEN item_changed`. Reconnect with backoff on error. Maintain `Map<connectionId, {userId, teamIds:Set, reply}>`.
- **Authorization:** on connect, load the actor's team IDs (auditor/org_admin → wildcard). Refresh team IDs every 60 s per connection and whenever a `membership_changed` notification arrives (emitted by team-member endpoints). A message is written only if `teamId ∈ connection.teamIds`.
- **Payload:** `{item_id, team_id, version, type, event_id}` (no titles, no comment text).
- **Limits:** `SSE_MAX_CONNECTIONS` per process (`503 sse_capacity` beyond); 25 s heartbeat; connection closes if the token expires or `token_version` changes (checked at refresh interval).
- **Client:** because browser `EventSource` cannot send an `Authorization` header, the web app implements `api/sse.ts` using `fetch()` + `ReadableStream` with a minimal SSE parser and exponential reconnect (1 s → 30 s). After every reconnect it invalidates all active queries (no replay protocol; documented limitation).
- **Fallback:** if SSE cannot connect, the dashboard and open item detail poll every 30 s (`refetchInterval`), so the system still converges.

---

## 15. Read side: search, filtering, pagination, dashboards

### 15.1 Authorization predicate (always the first WHERE clause)

- `auditor`/`org_admin`: no team predicate.
- Others: `wi.team_id IN (SELECT team_id FROM team_memberships WHERE user_id = $actor)`.

If `team_id` filters are supplied they are intersected with the predicate (never replace it).

### 15.2 Keyset pagination (`domain/cursor.ts`, `modules/items/list-query.ts`)

- Cursor is opaque base64url JSON `{"s":"<sort>","k":[<sort key values>],"id":"<uuid>"}` and is rejected (`400 validation_error`) if `s` doesn't match the requested sort.
- Sort definitions (whitelisted; never interpolate user text into SQL):

| `sort` | ORDER BY | Keyset predicate |
|---|---|---|
| `activity_desc` (default) | `last_activity_at DESC, id DESC` | `(last_activity_at, id) < ($k0, $id)` |
| `priority_due` | `priority ASC, due_at ASC NULLS LAST, id ASC` | expressed with explicit OR-chain handling NULLs (unit-tested) |
| `created_desc` | `created_at DESC, id DESC` | `(created_at, id) < ($k0, $id)` |

- Fetch `limit + 1` rows; if more than `limit`, drop the last and emit `next_cursor` built from the last returned row. No `OFFSET` anywhere. No total count in the list response (counts are provided by dashboard endpoints and are capped).

### 15.3 Filters → SQL

| Filter | SQL |
|---|---|
| `status[]`, `priority[]`, `type[]` | `= ANY($n::item_status[])` etc. |
| default | `AND wi.status <> 'closed'` unless `include_closed=true` or `status` includes `closed` |
| `assignee=me` / `<uuid>` / `unassigned` | `assignee_id = $n` / `assignee_id IS NULL` |
| `tag` | `tags @> ARRAY[$n]::text[]` |
| `due=overdue` | `due_at < now() AND status NOT IN ('resolved','closed')` |
| `due=today` | `due_at >= date_trunc('day', now()) AND due_at < date_trunc('day', now()) + interval '1 day'` |
| `due=week` | `due_at >= now() AND due_at < now() + interval '7 days'` |
| `stale=true` | `stale_at < now()` |
| `awaiting_my_approval=true` | `status='pending_approval' AND team_id IN (teams where actor effective role ≥ approver) AND NOT EXISTS pending approval requested_by = actor AND assignee_id <> actor` |
| `q` | If `^(?:ops-)?\d+$` (case-insens.) → `number = $n`. Otherwise `(search_vector @@ websearch_to_tsquery('english', $q) OR title ILIKE '%' || $escaped || '%')`. `%`, `_`, `\` in user text are escaped. Min length 2. Results use the selected sort (relevance ranking is intentionally not used, to keep keyset pagination stable). |

All filters are parameterized.

### 15.4 Dashboard queries (`modules/dashboard/service.ts`)

Each section is a separate bounded query, run in parallel with `Promise.all` (pool-aware: max 6 concurrent):

| Section key | Definition | Order |
|---|---|---|
| `awaiting_my_approval` | as in `awaiting_my_approval=true` | oldest first |
| `my_overdue` | assigned to me, `due_at < now()`, active | most overdue first |
| `my_stale` | assigned to me, `stale_at < now()` | stalest first |
| `my_active` | assigned to me, status `in_progress`/`blocked`, not already in the sections above | priority, due |
| `unassigned_in_my_teams` | status `open`, `assignee_id IS NULL`, my teams | priority, age |
| `unread_notifications` | count only (+ latest 5) | newest first |

Counts use `SELECT count(*) FROM (SELECT 1 FROM … LIMIT 1001) t` so the cost is bounded; `count_capped=true` when 1001 returned. Items shown are capped at 10 with a `filter_preset` string that opens the full list in `/items` with equivalent filters.

`/dashboard/overview` uses `GROUP BY status` / `GROUP BY priority` over **active** items of one team (served by the partial indexes), plus `min(created_at)` of unassigned open items, plus a 7-day count over `created_at` / `resolved_at`, plus `item_events` latest 20 via `(team_id, id DESC)`.

### 15.5 Performance budget (verified by `seed-load.ts` + EXPLAIN test)

With 20 000 active items, 30 000 closed, 300 000 events in the seed: list (first page, default filters) < 100 ms server time; item detail < 50 ms; events page < 50 ms; dashboard attention < 300 ms total. Verified by an automated test asserting `EXPLAIN` output contains `Index Scan`/`Bitmap` access (not `Seq Scan` on `work_items`) for the default list, `assignee=me`, and `team_id` queries, plus a manual timing log.

---

## 16. Backend module and function catalog

Every function below must exist with this responsibility, in this file, and be used where stated. Services never call each other's repos directly; cross-module needs go through the service function listed.

### 16.1 Infrastructure

| File | Function / export | Purpose | Used when / by |
|---|---|---|---|
| `config.ts` | `loadConfig(): Config` | Parse + validate env with zod; throw on missing `JWT_SECRET`/short secret | Process start (api, worker, scripts) |
| `db/pool.ts` | `getPool(): Pool` | Singleton `pg.Pool` (`max=PG_POOL_MAX`) | Everywhere |
| `db/tx.ts` | `withTx<T>(fn:(c:PoolClient)=>Promise<T>, opts?:{retries?:number}): Promise<T>` | BEGIN/COMMIT/ROLLBACK; `SET LOCAL lock_timeout='3s'`, `statement_timeout='10s'`; retries on 40001/40P01 | Every mutation and job |
| `db/errors.ts` | `mapPgError(e): AppError` | `23505`→409 (context-specific), `23514`→500 + log (invariant), `55P03`→503 busy, `P0001` from immutability trigger→500 | Error handler |
| `http/errors.ts` | `class AppError(status, code, message, details?)`, `errorHandler` | Uniform error envelope; hide internals on 500 | Fastify `setErrorHandler` |
| `http/request-context.ts` | `registerRequestContext(app)` | Generate/echo `X-Request-Id`; bind pino child logger | `app.ts` |
| `http/auth.ts` | `authPlugin`, `requireActor(req): Actor`, `signToken(user)`, `verifyToken(t)` | Verify JWT (`sub`,`tv`), load `Actor {id, orgRole, isActive, memberships: Map<teamId,role>}` from DB each request | `onRequest` for protected routes |
| `http/idempotency.ts` | `withIdempotency(actor, req, work)` | Algorithm in 12.2; computes `fingerprint = sha256(method|path|canonicalJson(body))` | Wrapping all mutating service calls |
| `http/schemas.ts` | zod schemas: `LoginBody, CreateItemBody, PatchItemBody, TransitionBody, AssignBody, TransferBody, CommentBody, ApprovalBody, ListItemsQuery, MemberRoleBody, CursorQuery` | Input validation; strip unknown keys | Route handlers |

### 16.2 Domain (pure)

| File | Export | Purpose |
|---|---|---|
| `permissions.ts` | `effectiveRole(actor, teamId)`, `can(actor, permission, ctx)`, `roleAtLeast(a,b)` | Policy of Section 9 |
| `transitions.ts` | `TRANSITIONS`, `evaluateTransition(...)` | Section 10 |
| `allowed-actions.ts` | `computeAllowedActions(actor, item)` | UI-facing list from same policy |
| `events.ts` | `EventType` union, `HANDLERS_FOR`, `buildChanges(before, after, fields)` | Event payload + routing |
| `staleness.ts` | `staleAtFor(priority, from, cfg)`, `isStale(item, now)`, `isOverdue(item, now)` | Section 13.5 |
| `cursor.ts` | `encodeCursor(sort, row)`, `decodeCursor(sort, token)` | Section 15.2 |

### 16.3 Items module

| File | Function | Purpose | Notes |
|---|---|---|---|
| `items/repo.ts` | `lockItem(c, id): ItemRow \| null` | `SELECT … FOR UPDATE` | first statement of every item mutation |
| | `getItemForActor(c, actor, id): ItemRow \| null` | read with authz predicate | reads, DTO building |
| | `insertItem(c, row)` / `updateItem(c, id, expectedVersion, patch): ItemRow \| null` | `UPDATE … WHERE id AND version` + `version+1`, `updated_at`, `last_activity_at`, `stale_at` | returns `null` when 0 rows (treated as conflict) |
| | `insertEvent(c, ev): EventRow` | append history | returns `id` for outbox |
| | `insertOutbox(c, eventId, handlers[])` | one row per handler | |
| | `addWatcher(c, itemId, userId)` | `ON CONFLICT DO NOTHING` | |
| | `notifyChanged(c, payload)` | `SELECT pg_notify('item_changed', $1)` | after event insert |
| `items/list-query.ts` | `buildListQuery(actor, params): {text, values}` | Section 15 | no string-concat of user data |
| `items/service.ts` | `createItem(actor, input, ctx)` | validate team access, p0 rule, default `requires_approval`, insert + event + watcher + outbox | `201` |
| | `patchItem(actor, id, input, ctx)` | lock → expected_version → `can(update)` (+p0) → diff → update → events (`fields_updated`, optional `priority_changed`) → outbox | CB2 |
| | `claimItem(actor, id, ctx)` | lock → authz → if mine: return unchanged → if assigned: `409 already_claimed` → update status/assignee → `claimed` event | CB1 |
| | `releaseItem`, `assignItem` | per Section 10 | |
| | `transitionItem(actor, id, input, ctx)` | `evaluateTransition` → update → `status_changed` event | CB4 |
| | `transferItem(actor, id, input, ctx)` | permission in both teams → team change, clear assignee if not member of target, update `comments.team_id` is **not** rewritten (comments keep original team for history; reads authorize via item's current team) → `transferred` event | |
| | `listItems(actor, params)` | execute list query + build `next_cursor` | |
| | `getItemDto(actor, id)` | item + `allowed_actions` + computed `is_stale/is_overdue` | |
| | `listEvents(actor, id, cursor, limit)` | keyset `(id < cursor)` | |
| `comments/service.ts` | `addComment(actor, itemId, body, ctx)` | lock item (no version bump) → `can(comment)` → insert comment → event `comment_added` → `last_activity_at`, `stale_at`, clear `stale_notified_at` → watcher add | |
| | `listComments(actor, itemId, cursor, limit)` | authz via item | |
| `approvals/service.ts` | `requestApproval`, `decideApproval(actor, id, decision, note)` | Section 10; `decideApproval` uses `UPDATE approvals SET state=… WHERE item_id=$1 AND state='pending' RETURNING *` → 0 rows ⇒ `409 invalid_transition` | CB4 |
| `teams/service.ts` | `listTeamsFor(actor)`, `listMembers`, `setMemberRole`, `removeMember` | Section 11; emits `pg_notify('item_changed'…)`-style `membership_changed` | `removeMember` refuses if assigned active items exist |
| `auth/service.ts` | `login(email,password)`, `logout(actor)`, `me(actor)` | argon2id verify; token issue | |
| `notifications/service.ts` | `listNotifications`, `markRead(actor, upToId)` | keyset; `UPDATE … WHERE user_id=$1 AND id<=$2 AND read_at IS NULL` | idempotent |
| `dashboard/service.ts` | `attention(actor)`, `overview(actor, teamId)` | Section 15.4 | |
| `stream/hub.ts` | `startHub()`, `registerConnection(actor, reply)`, `broadcast(payload)` | Section 14 | |

### 16.4 Worker

| File | Function | Purpose |
|---|---|---|
| `worker/main.ts` | `main()` | Start poll loop (`WORKER_POLL_MS`) + scheduler; graceful shutdown on SIGTERM (finish in-flight, stop claiming) |
| `worker/outbox.ts` | `claimBatch(c, n)`, `markDone(c, id)`, `markFailed(c, row, err)`, `backoff(attempts)`, `runOnce(handlers)` | Section 13.3 |
| `worker/handlers/index.ts` | `HANDLERS: Record<string, Handler>` | Registry (test code can inject a failing handler) |
| `worker/handlers/notify-watchers.ts` | `notifyWatchers(event, c)` | Insert notifications for `item_watchers` of the item excluding `event.actor_id`; `ON CONFLICT DO NOTHING` |
| `worker/handlers/notify-approvers.ts` | `notifyApprovers(event, c)` | Insert notifications for team members with role `approver`/`admin` (+ org_admins), excluding requester and assignee; `ON CONFLICT DO NOTHING` |
| `worker/scheduler.ts` | `startScheduler()`, `staleSweep`, `overdueSweep`, `autoCloseResolved`, `cleanup` | Section 13.5 |

### 16.5 Scripts

| File | Purpose |
|---|---|
| `scripts/seed.ts` | Idempotent demo data: 1 `org_admin`, 1 `auditor`, 4 teams (Support, Engineering, Payments, Compliance), 24 users with varied roles across teams (some users in 2–3 teams with different roles), ~60 realistic items in various states (including `pending_approval`, overdue, stale, unassigned), a few comments/events. All demo passwords `Passw0rd!demo` (**dev only**, printed by the script). |
| `scripts/seed-load.ts` | Bulk generator with `COPY`/multi-row inserts: ~2 000 users, 100 teams, 50 000 items (20 000 active), ~300 000 events; used by the performance test and for manual checks. |

---

## 17. Frontend design (`apps/web`)

### 17.1 State management rules

1. **Server state lives only in TanStack Query.** No Redux/Zustand. Local component state is for form drafts and dialogs only.
2. **URL is the state for filters and sort** (`/items?status=open&assignee=me&q=…`), so views are linkable and survive reload. `state/filters.ts` parses/serializes the URL.
3. **Auth state** (`state/auth.tsx`): token in `sessionStorage`; `GET /me` result in query cache; `401` anywhere clears it and redirects to `/login`.
4. **Query keys** (`api/queryKeys.ts`): `['me']`, `['teams']`, `['items', filtersObject]` (infinite), `['item', id]`, `['item', id, 'events']`, `['item', id, 'comments']`, `['dashboard','attention']`, `['dashboard','overview', teamId]`, `['notifications']`.
5. **Stale time:** lists 15 s, item 10 s, dashboard 15 s; SSE signals invalidate sooner. Infinite list uses `maxPages: 10` to bound memory.
6. **Never trust cache for authorization.** Buttons come from `allowed_actions`; any `403/404` response triggers an item refetch and a toast.

### 17.2 API client (`api/client.ts`)

- `apiFetch(path, {method, body, idempotencyKey, signal})` adds `Authorization`, `X-Request-Id`, JSON handling; throws `ApiError {status, code, message, details, requestId}`.
- Automatic retry **only** for `GET` on network errors/5xx (2 retries, exponential). Mutations are never auto-retried silently; the user (or an explicit "Retry" button) retries with the **same** idempotency key.
- `api/idempotency.ts: useIntentKey()` — returns a stable `uuid` generated when a dialog/button interaction starts and held in a `useRef` until that intent **succeeds or is cancelled**; retry after failure reuses it; a new user intent gets a new key.

### 17.3 Mutation pattern (`hooks/useItemMutations.ts`)

All item mutations share this contract:

```text
onMutate  : cancel in-flight ['item',id] queries; snapshot previous; apply optimistic patch (only for: claim, release, priority/field edit, add comment)
mutationFn: apiFetch(... Idempotency-Key = intent key, expected_version = cached item.version)
onSuccess : setQueryData(['item',id], serverItem); invalidate ['items'], ['dashboard'], ['item',id,'events']
onError   : rollback snapshot; if ApiError.code in {version_conflict, already_claimed} → setQueryData(['item',id], error.details.current) and show ConflictBanner/Toast; else show error with Retry (same key)
onSettled : invalidate ['item',id]
```

Non-optimistic (wait for server): transitions involving approval, `resolve`, `close`, `cancel`, `transfer`, `assign` (server decisions with guards the client can't predict). Buttons show a pending state and are disabled while pending (prevents accidental double submits in addition to server idempotency).

### 17.4 Screens and components (minimum viable, no decoration)

| Page | Contents |
|---|---|
| `LoginPage` | Email/password, error display |
| `DashboardPage` | Attention sections from `GET /dashboard/attention` (each: label, capped count, ≤10 rows, “View all” → preset filter); team selector → overview panel (counts by status/priority, overdue/stale/unassigned, oldest unassigned age, recent activity) |
| `ItemsPage` | `FilterBar` (team, status, priority, type, assignee, due, stale, tag, search box with 300 ms debounce, sort) + virtualized `ItemTable` (`@tanstack/react-virtual`) with infinite scroll via `next_cursor`; row shows key, title, status, priority, assignee, due, stale/overdue badges |
| `ItemDetailPage` | `ItemHeader` (key, title, status, priority, assignee, team, due, approval state, version), `ActionBar` (buttons from `allowed_actions`), editable fields form, `ApprovalPanel`, `Timeline` (merged events+comments, infinite “load older”), `CommentBox`, `ConflictBanner`, `StaleBanner` |
| `TeamMembersPage` | Members and roles; role change/remove for `admin` (controls from API-provided capability flag; server enforces anyway) |
| Global | `NotificationBell` (unread count, dropdown list, mark read), `Toasts`, `ErrorBoundary`, `CreateItemDialog` |

**Conflict UX:**
- `ConflictBanner` (after `version_conflict` on edit): “Changed by {actor} while you were editing.” Buttons: **Reload latest** (discard draft) and **Re-apply my changes** (rebases `expected_version` onto `current.version`, keeps the user's draft in the form; user presses Save again — no silent overwrite).
- `StaleBanner` (SSE signal with `version > cachedVersion` while the user has a dirty form): “This item was updated. Reload to see changes.” Without dirty form, the item silently refreshes.
- `already_claimed` toast: “Claimed by {name} just now.”; cache replaced by server truth; Claim button disappears (it's no longer in `allowed_actions`).

### 17.5 Frontend performance rules

- Virtualized list; page size 50; never prefetch beyond the next page.
- Debounced search; `AbortController` cancels superseded requests.
- Dashboard shows sections as they arrive (each section is its own field of one response; the endpoint runs them in parallel server-side).
- No unbounded `useEffect` polling except the 30 s SSE-fallback.

---

## 18. Error handling policy

1. Every failure leaves the system consistent: all multi-write operations are single transactions; no partial item/event/outbox state is possible.
2. Domain errors are explicit `AppError`s with stable `code`s (Section 11.1). Unknown errors → `500 internal` with `request_id`; stack goes to logs only.
3. PostgreSQL errors are mapped by `mapPgError`: unique violations on `approvals_one_pending_uq` → `409 invalid_transition`; check-constraint violations → logged `error` + `500` (indicates a guard bug); `55P03` → `503 busy`.
4. Worker errors never crash the process: caught per row; `dead` rows are logged at `error` with `event_id`, `handler`, `last_error`.
5. Frontend: `ErrorBoundary` per page; mutation errors surface through toasts with the server's `message` and `request_id` (for support); network failures offer “Retry” (same idempotency key).
6. Graceful shutdown: API closes server and SSE connections; worker stops claiming and finishes in-flight rows.

---

## 19. Security baseline

- Passwords: argon2id (library defaults, ≥ 19 MiB memory). JWT HS256, `exp` = `JWT_TTL_HOURS`, claims `sub`, `tv`, `iat`; secret ≥ 32 chars enforced at boot.
- Authorization data always re-read from DB (Section 9.1). Logout and deactivation revoke immediately via `token_version`/`is_active`.
- Helmet defaults; CORS restricted to `WEB_ORIGIN`; rate limits per Section 4.6 (in-memory, per process — documented limitation).
- All SQL parameterized; sort/filter identifiers whitelisted; `ILIKE` input escaped.
- Output encoding: React escapes by default; no `dangerouslySetInnerHTML`. Comment bodies and descriptions are plain text.
- Request size limits (100 KB body), field length limits mirrored by DB `CHECK`s.
- Secrets only via env; `.env` git-ignored; `.env.example` has placeholders only (the seed prints demo passwords for local dev; documented as dev-only).

---

## 20. Testing strategy

### 20.1 Principles

- Tests target the **dangerous behaviours of this architecture** (Section 12), not coverage percentage.
- Integration tests run against **real PostgreSQL 16** (the docker-compose `postgres` service); no DB mocks for concurrency tests.
- Setup (`test/helpers/db.ts`): create database `opsflow_test` if absent, run migrations once per run. **Tests never TRUNCATE** (the immutability trigger blocks it on `item_events`); each test creates its own uniquely named teams/users via `factory.ts` so tests are isolated and can run in parallel files.
- Concurrency tests use `Promise.all` over real HTTP-level `app.inject()` calls against one Fastify instance and a real pool (`PG_POOL_MAX ≥ 30` for tests).
- Run: `npm run test` (all), `npm run test:api`, `npm run test:web`.

### 20.2 Unit tests (`apps/api/test/unit`)

| File | Must assert |
|---|---|
| `permissions.test.ts` | Full matrix: every permission × {none, viewer, member, approver, admin, auditor, org_admin}; resource conditions (assignee-only, reporter-only, p0 rule, requester≠approver) |
| `transitions.test.ts` | Every legal transition succeeds with correct patch; **every illegal (from,name) pair** is rejected; required inputs enforced; `closed` terminal; resolve blocked without approval |
| `allowed-actions.test.ts` | Output equals expected sets for representative actors/items; never includes an action that the service would reject for permission reasons |
| `cursor.test.ts` | Round-trip; tamper/mismatched sort rejected; NULL `due_at` ordering in `priority_due` |
| `staleness.test.ts` | Thresholds per priority; recompute on priority change; NULL when resolved/closed |
| `backoff.test.ts` | Monotonic growth, cap at 15 min, jitter within bounds |

### 20.3 Integration tests (`apps/api/test/integration`)

| File | Scenarios (each must pass) |
|---|---|
| `claim-race.test.ts` | (1) 20 users (members of the team) claim the same item concurrently → exactly 1×`200`, 19×`409 already_claimed`; item has the winner as assignee; exactly 1 `claimed` event; `version` incremented exactly once. (2) The same user double-claims with different keys → both `200`, one event. (3) Claim of an item in `resolved`/`closed`/already assigned → `409`. (4) Viewer/non-member claim → `403`/`404`. |
| `idempotency.test.ts` | (1) 10 concurrent `POST /items` with the same key+body → exactly one item row, all responses equal, replays flagged. (2) Same key, different body → `422 idempotency_key_reuse`. (3) Same key by a different user → independent. (4) A request that fails with `409` does **not** store a key (retry re-evaluates). (5) Missing key on a mutation → `400`. (6) Sequential retry after success → replay with identical body and no new event. |
| `optimistic-lock.test.ts` | (1) Two `PATCH` with the same `expected_version` concurrently → one `200`, one `409 version_conflict` containing `details.current`; final state equals the winner; no lost update. (2) Stale `expected_version` on transition → `409`. (3) Comments do not bump `version` and do not conflict with edits. (4) 50 rapid sequential updates with correct versions all succeed and version = 51. |
| `workflow-approval.test.ts` | (1) Item with `requires_approval` cannot `resolve` before `approved`. (2) Requester cannot approve; current assignee cannot approve; member (non-approver) → `403`. (3) Concurrent `approve` and `reject` → exactly one succeeds, the other `409`; exactly one approval decision row. (4) Reject → `request_approval` again allowed → approve → resolve works. (5) Reopen of resolved approval-required item resets `approval_state` and requires re-approval. (6) `closed` is terminal. (7) Two simultaneous `request_approval` → one pending approval row. |
| `authz.test.ts` | (1) User in team A cannot read/list/patch/comment/transition/claim/see events or comments of team B items (all `404`, and absent from lists/dashboard/search). (2) Viewer can read but gets `403` on every write. (3) `auditor` reads all, writes none. (4) `org_admin` acts as admin everywhere. (5) Setting `p0` requires `approver+`; downgrading from `p0` likewise. (6) Assigning to a non-member → rejected. (7) Transfer requires membership in target; after transfer to a team the actor can't see, the actor receives `404` on later reads. (8) Role downgrade takes effect on the **next request** with the same token. (9) Deactivated user / bumped `token_version` → `401`. (10) Tests call the API directly with crafted requests, proving enforcement does not rely on the UI. |
| `history-immutability.test.ts` | (1) Direct SQL `UPDATE`/`DELETE`/`TRUNCATE` on `item_events` fails. (2) Every mutating endpoint yields exactly one new event with correct `actor_id`, `type`, `changes`, `item_version`. (3) Injected failure after event insert (force an error before commit) → no event, no item change, no outbox row. (4) Timeline of a scripted scenario reconstructs the full ordered history. |
| `outbox.test.ts` | (1) After a mutation the outbox has one `pending` row per handler. (2) Handler injected to throw → `attempts` increments, `next_attempt_at` moves forward, `last_error` stored; after `max_attempts` → `dead`; other rows still processed. (3) Run the same row's handler twice → notifications count unchanged (idempotent). (4) Two concurrent `runOnce` workers over 200 rows → each row processed by exactly one worker (no duplicates in `notifications`). (5) Simulated crash (row left `processing` with expired `locked_until`) → reclaimed and completed. (6) Primary API calls succeed and are correct while the worker is not running. (7) Actor never notifies themselves. |
| `pagination-search.test.ts` | (1) With 500 seeded items, walking pages with `limit=37` returns every visible item exactly once in order, for all three sorts. (2) Inserting items during pagination causes no duplicates or crashes. (3) Filters combine correctly (status×assignee×tag×due×stale). (4) Search by words, by partial title, and by `OPS-<n>`; `%`/`_` in `q` treated literally. (5) Results never include other teams' items. (6) `limit>100` → `400`. (7) EXPLAIN check on the large seed (when `seed-load` data present, else skipped with a visible “SKIPPED” log): default list and `assignee=me` use index access. |
| `stream-authz.test.ts` | SSE client for a user in team A receives signals for team A item changes and **none** for team B; payload contains no title/body; capacity limit returns `503`; revoked token closes stream at refresh. |
| `scheduler.test.ts` | Stale sweep flags once (not repeatedly), re-arms after new activity; overdue sweep likewise; auto-close only after threshold; two concurrent scheduler ticks → advisory lock lets one run; cleanup never touches `item_events`. |

### 20.4 Frontend tests (`apps/web/src/test`, Vitest + Testing Library, API mocked at `fetch`)

| File | Must assert |
|---|---|
| `optimistic-claim.test.ts(x)` | Claim shows assignee immediately; on `409 already_claimed` UI rolls back to server item showing winner, button removed. |
| `idempotent-retry.test.tsx` | After a simulated network failure, “Retry” re-sends the **same** `Idempotency-Key`; a new interaction uses a **new** key. |
| `conflict-banner.test.tsx` | `version_conflict` on edit shows banner, preserves draft, “Re-apply my changes” sends `expected_version = current.version`. |
| `stale-banner.test.tsx` | SSE signal with higher version while form is dirty shows StaleBanner and does not overwrite draft; clean form refreshes silently. |

### 20.5 Gate for "tests done"

`npm run test` exits `0`; the output (counts per file) is pasted into `docs/PROGRESS.md`. Any skipped test must be explained in `KNOWN_LIMITATIONS.md`.

---

## 21. Implementation phases and gates

Execute in order. Do not begin a phase until the previous gate has passed **and** its real output has been pasted into `docs/PROGRESS.md` (Section 0, rule 5).

### 21.0 Root files to create in P0

**`package.json` (root)** — `"private": true`, `"workspaces": ["apps/api","apps/web"]`, `"engines": {"node": ">=22.12.0 <23"}`, scripts:

| Script | Command |
|---|---|
| `dev` | `concurrently -n api,worker,web "npm:dev:api" "npm:dev:worker" "npm:dev:web"` |
| `dev:api` | `npm -w apps/api run dev` (`tsx watch src/server.ts`) |
| `dev:worker` | `npm -w apps/api run dev:worker` (`tsx watch src/worker/main.ts`) |
| `dev:web` | `npm -w apps/web run dev` (`vite`) |
| `migrate` | `npm -w apps/api run migrate` (`node-pg-migrate up -m migrations`; reads `DATABASE_URL`) |
| `seed` / `seed:load` | `tsx scripts/seed.ts` / `tsx scripts/seed-load.ts` |
| `build` | web `vite build` → `apps/web/dist`; api `tsc -p apps/api` → `apps/api/dist` |
| `test`, `test:api`, `test:web` | `vitest run` in each workspace |
| `lint`, `typecheck` | `eslint .` / `tsc --noEmit` per workspace |

**`docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16.6-alpine
    environment:
      POSTGRES_USER: opsflow
      POSTGRES_PASSWORD: opsflow
      POSTGRES_DB: opsflow
    ports: ["5432:5432"]
    volumes: ["pgdata:/var/lib/postgresql/data"]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U opsflow -d opsflow"]
      interval: 3s
      timeout: 3s
      retries: 20
  api:
    profiles: ["app"]
    build: .
    command: sh -c "npm run migrate && node apps/api/dist/server.js"
    env_file: .env
    environment: { DATABASE_URL: "postgres://opsflow:opsflow@postgres:5432/opsflow", API_PORT: "3000" }
    depends_on: { postgres: { condition: service_healthy } }
    ports: ["3000:3000"]
  worker:
    profiles: ["app"]
    build: .
    command: node apps/api/dist/worker/main.js
    env_file: .env
    environment: { DATABASE_URL: "postgres://opsflow:opsflow@postgres:5432/opsflow" }
    depends_on: { postgres: { condition: service_healthy } }
volumes:
  pgdata:
```

**`Dockerfile`** — multi-stage: stage `build` on `node:22.12.0-bookworm-slim` (`npm ci`, `npm run build`); final stage on the same base copies `node_modules`, `apps/api/dist`, `apps/api/migrations`, `apps/web/dist`; the API serves `apps/web/dist` through `@fastify/static` when `NODE_ENV=production` (SPA fallback to `index.html` for non-`/api` routes).

### 21.1 Phases

| Phase | Deliver | Gate (command → expected) |
|---|---|---|
| **P0 Scaffold** | Repo layout (Section 5), configs, lint/format, `.env.example`, compose, migration file (Section 8 plus `-- Down Migration` dropping everything in reverse order) | `docker compose up -d postgres && npm ci && npm run typecheck && npm run lint && npm run migrate` → all exit 0; `psql` `\dt` shows all 11 tables; a manual `UPDATE item_events SET type='x'` is rejected by the immutability trigger |
| **P1 Domain** | `domain/*` pure modules + unit tests | `npm -w apps/api run test -- test/unit` → all pass |
| **P2 Platform** | `config`, `db/*`, `http/*`, auth module, `/healthz`, `/readyz`, `/me`, login/logout, error envelope, rate limit | login/logout/`401` cases pass; `X-Request-Id` echoed |
| **P3 Items core** | create/get/patch, `insertEvent`, `insertOutbox`, `notifyChanged`, `withIdempotency`, `allowed_actions` | `idempotency.test.ts`, `optimistic-lock.test.ts`, `history-immutability.test.ts` pass |
| **P4 Workflow & collaboration** | claim, release, assign, transition, transfer, approvals, comments, watchers, teams/members endpoints | `claim-race.test.ts`, `workflow-approval.test.ts`, `authz.test.ts` pass |
| **P5 Async** | worker, outbox, handlers, scheduler | `outbox.test.ts`, `scheduler.test.ts` pass |
| **P6 Read side & realtime** | list query/search/filters/cursors, dashboards, notifications API, SSE hub | `pagination-search.test.ts`, `stream-authz.test.ts` pass |
| **P7 Seeds & scale check** | `seed.ts`, `seed-load.ts`; EXPLAIN test enabled | `npm run seed:load` completes; timing log meets Section 15.5 budget; EXPLAIN assertions pass |
| **P8 Frontend** | All pages/components of Section 17; four frontend tests | `npm run test:web` passes; manual smoke checklist (21.2) executed and recorded |
| **P9 Deliverable docs** | Create `README.md`, `ENGINEERING_DECISIONS.md`, `KNOWN_LIMITATIONS.md`, `docs/ARCHITECTURE.md` from Section 22 (adjust only facts that differ from reality) | `ls` shows all four; README commands verified in P10 |
| **P10 Fresh-clone verification** | Clone to a clean directory; follow README **literally** | App starts, demo login works, `npm run test` exits 0; record in `docs/PROGRESS.md` |

### 21.2 Manual smoke checklist (record results in `docs/PROGRESS.md`)

1. Login as `support.agent1`, create an item; it appears at the top of the list.
2. In a second browser session as `support.agent2`, the item appears in “Unassigned in my teams” within ~1 s (SSE) without reload.
3. Both click **Claim** at the same moment → one succeeds, the other sees “Claimed by … just now” and the UI converges.
4. Agent 1 edits the title while Agent 2 edits it in another session; second save shows ConflictBanner; “Re-apply my changes” works.
5. Throttle network to offline during **Resolve**; click Retry after reconnect → exactly one `status_changed` event in the timeline.
6. Payment item with approval: assignee requests approval → assignee cannot approve; `pay.approver` can; resolve now allowed.
7. `viewer@opsflow.test` sees no write controls and receives `403` from direct `curl` write attempts; user from another team gets `404` for the item URL.
8. Stop the worker; actions still succeed; start the worker; notifications appear; restart-safe.
9. Open `/items` on the load-seeded database; scroll through several pages; memory stays bounded; typing a search keeps the UI responsive.

---

## 22. Required deliverable files (full text — create these files in the repo)

> These four files are part of the submission. Create them **inside the repository** exactly at the paths shown. Keep the structure; update a statement only where the built system differs from it (and add that difference to `KNOWN_LIMITATIONS.md`).

### 22.1 `README.md`

~~~~markdown
# OpsFlow

Internal web application for coordinating operational work (customer issues, incidents, payment investigations,
compliance requests, operational tasks) across teams, with reliable ownership, approvals, history, and concurrency handling.

## What it does
- Work items with status, priority, owner, due date, tags, approval gate, comments, and a complete append-only history.
- Teams and per-team roles (viewer, member, approver, admin) enforced on the server; org-level `auditor` and `org_admin`.
- "What needs my attention" dashboard, team overview, filterable/searchable keyset-paginated list, in-app notifications.
- Correct under concurrency: atomic claim, optimistic locking, idempotent mutations, live staleness signals.
- Reliable async processing (transactional outbox) for notifications and background sweeps.

## Prerequisites
| Tool | Version |
|---|---|
| Node.js | 22.12.0 (`nvm use` reads `.nvmrc`) |
| npm | 10.9.0 |
| Docker + Compose v2 | Engine ≥ 24, Compose ≥ 2.20 |

## Setup and run (local development)
```bash
git clone <repo> opsflow && cd opsflow
nvm use                                 # Node 22.12.0
cp .env.example .env                    # then set JWT_SECRET to a random string of 32+ chars
docker compose up -d postgres           # PostgreSQL 16.6 on :5432
npm ci
npm run migrate                         # creates schema
npm run seed                            # demo teams, users, items
npm run dev                             # API :3000, worker, web :5173
```
Open http://localhost:5173 and sign in with a demo account (password for all: `Passw0rd!demo`; dev only).

| Account | Role |
|---|---|
| `admin@opsflow.test` | org_admin (admin in every team) |
| `auditor@opsflow.test` | auditor (read-only everywhere) |
| `support.lead@opsflow.test` | Support: admin |
| `support.agent1@opsflow.test`, `support.agent2@opsflow.test` | Support: member |
| `eng.approver@opsflow.test`, `eng.dev1@opsflow.test`, `eng.dev2@opsflow.test` | Engineering: approver / members |
| `pay.approver@opsflow.test`, `pay.analyst@opsflow.test` | Payments: approver / member |
| `compliance.admin@opsflow.test` | Compliance: admin |
| `viewer@opsflow.test` | Support: viewer |
| `multi@opsflow.test` | Support: member, Payments: approver, Engineering: viewer |

## Run everything in containers (optional)
```bash
docker compose --profile app up --build   # API+web on :3000, worker, postgres
```

## Tests
```bash
npm run test          # all (needs the postgres container running)
npm run test:api      # unit + integration (real PostgreSQL, DB "opsflow_test" auto-created)
npm run test:web      # frontend behaviour tests
```
Large-data check (optional): `npm run seed:load` (≈50k items, 300k events) then `npm run test:api -- pagination-search`.

## Documentation
- `ENGINEERING_DECISIONS.md` — key decisions and trade-offs
- `KNOWN_LIMITATIONS.md` — what is intentionally missing or imperfect
- `docs/ARCHITECTURE.md` — diagrams and data flow
- `IMPLEMENTATION_PLAN.md` — the full plan this system was built from

## Assumptions
(Copy the full table from Section 3 of the implementation plan here, A1–A18, plus any assumption added during implementation.)
~~~~

### 22.2 `ENGINEERING_DECISIONS.md`

~~~~markdown
# Engineering Decisions

Five decisions that shape this system, with the alternatives considered and what each one costs.

## 1. PostgreSQL as the single system of record; history written transactionally in the same database
**Decision.** One relational model (`work_items`, `teams`, `team_memberships`, `comments`, `approvals`, `item_events`, …). Every state change
writes the item update **and** an append-only `item_events` row in one transaction; a trigger makes `item_events` immutable. Business
invariants (an in-progress item must have an assignee; approval state must match status; one pending approval per item) are also
`CHECK`/unique constraints, so a bug in application code cannot silently corrupt data.
**Why.** The Problem Statement stresses data consistency, not losing important actions, and explaining "why a decision was made." A transactional store
gives all of this with one dependency and makes the history impossible to forget or fake.
**Alternatives.** Event sourcing (rebuild state from events) gives a perfect audit trail but complicates queries, search, and concurrency for a first version.
A document store would simplify schema changes but weakens constraints and joins. Separate audit service: more moving parts, risk of divergence.
**Trade-offs.** `item_events` grows fast; reads are keyset-paginated on `(item_id,id)`/`(team_id,id)` so size does not slow reads; range partitioning by time is the planned next step. State is stored (not derived), so history is a faithful log, not the source of truth.

## 2. Concurrency: per-request row lock + optimistic `version` + in-transaction idempotency keys
**Decision.** Every mutation locks the item row (`SELECT … FOR UPDATE`, milliseconds, never across user think time), checks the client's
`expected_version`, then updates with `WHERE version = $v` and increments it. Claiming is atomic: the first transaction wins; others receive `409 already_claimed`
naming the winner. Each mutating request carries an `Idempotency-Key`; the key row is inserted **inside the business transaction** with `ON CONFLICT DO NOTHING`, so
concurrent duplicates wait on the unique index and then replay the stored response; retries after timeouts are safe.
**Why.** It handles all four scenarios in the brief (two claimers, stale view, bursts of updates, repeated requests) with plain PostgreSQL semantics that are easy to test.
**Alternatives.** Long pessimistic locks (blocks users, can leak), distributed locks in Redis (extra infrastructure, failure modes, still need DB checks), last-write-wins (silent data loss),
automatic field-level merging (more code and subtle bugs; we return the current item and let the user re-apply).
**Trade-offs.** A conflicting editor must re-submit; comments deliberately do not bump `version` to avoid false conflicts. Only 2xx responses are stored under an idempotency key (failures are re-evaluated on retry, which is correct because they derive from current state).

## 3. Authorization: team-scoped RBAC in one pure policy module, enforced in the service layer with resource-level checks
**Decision.** Roles are per team (viewer < member < approver < admin) plus org-level auditor and org_admin. `can(actor, permission, resource)` is the single decision point;
the actor and memberships are loaded from the database on every request (the token only identifies the user), checks run again after the row is locked, and non-members receive `404`
so item existence is not leaked. Workflow rules live in a table-driven state machine; approvals enforce separation of duties (approver ≠ requester ≠ assignee). The API returns `allowed_actions` computed by the same code,
so the UI mirrors rules without owning them.
**Why.** Meets "enforced by the system itself" and "different responsibilities in different teams," and keeps rules testable (a full permission × role matrix is a unit test).
**Alternatives.** An ABAC/policy engine (OPA/Cedar) — powerful but heavy for this scope; roles in JWT claims — faster but stale until expiry; DB row-level security — strong, but harder to unit test and debug in a first version.
**Trade-offs.** One extra membership lookup per request (indexed, small); authorization logic must be called consistently, which is mitigated by routing every mutation through services that start with lock → `can()` → guard, and by API-level tests that bypass the UI.

## 4. Asynchronous work via a transactional outbox in PostgreSQL, with idempotent handlers; SSE only as a content-free invalidation signal
**Decision.** Primary actions complete synchronously and durably; notification fan-out is recorded as `outbox` rows in the same transaction and processed by a worker using `FOR UPDATE SKIP LOCKED`,
exponential backoff, a visibility timeout (`locked_until`) for crash recovery, and a `dead` state after 8 attempts. Handlers are idempotent (`UNIQUE (user_id, event_id, kind)`), so at-least-once delivery is safe.
Stale/overdue sweeps and auto-close run as advisory-locked scheduled jobs. Live updates use `LISTEN/NOTIFY` → SSE messages that carry only `{item_id, version}`; clients refetch through the normal authorized API.
**Why.** No lost or phantom side effects (the event and its work item commit together), no new infrastructure, and failure/duplicate/delay behaviours are explicit and testable. Dashboards compute attention from item state, so a delayed worker never hides work.
**Alternatives.** Redis + BullMQ / Kafka (more infrastructure for this scale), publishing directly after commit (can lose messages on crash), WebSockets carrying data (needs per-message authorization and replay).
**Trade-offs.** Polling adds up to ~1 s notification latency; throughput is bounded by PostgreSQL (ample for the stated scale); SSE has no replay, so clients refetch after reconnect.

## 5. Read side designed for growth: keyset pagination, partial indexes, SQL-only filtering/search, bounded dashboards, and server-state-only frontend
**Decision.** No `OFFSET`; opaque keyset cursors; filters and search (`tsvector` + trigram + exact `OPS-n` lookup) run in SQL behind a mandatory team-scope predicate; active-work partial indexes keep closed history out of hot paths; dashboard sections are separate bounded queries with capped counts.
The frontend keeps server state in TanStack Query (URL-driven filters, virtualized list, capped page cache), applies optimistic updates only where the server rarely disagrees (claim, simple edits, comments) and reconciles with the server's answer, and reuses one idempotency key per user intent.
**Why.** Meets "usable as data grows" and "never load the entire dataset" while staying simple to reason about.
**Alternatives.** Elasticsearch (operational burden), materialized dashboard counters (staleness and maintenance), global client store (duplicated truth, invalidation bugs).
**Trade-offs.** No total counts or relevance ranking in lists (keeps pagination stable); search is lexical, not semantic; capped counts show "1000+".

## What we intentionally did not build
Self-service sign-up/SSO, email/Slack delivery, attachments, @mentions, editable comments, custom workflows/fields, bulk actions, saved views, event replay for SSE, table partitioning (planned), multi-region/HA, metrics/tracing stack.
Each was excluded to keep a smaller system with well-considered behaviour in the available time.
~~~~

### 22.3 `KNOWN_LIMITATIONS.md`

~~~~markdown
# Known Limitations

1. **Rate limiting is per process (in memory).** With several API instances limits are per instance. A shared store would be needed for global limits.
2. **SSE has no replay.** After a disconnect the client refetches everything it displays; no missed-event recovery protocol. Fallback polling (30 s) applies if SSE is unavailable.
3. **Notifications are in-app only** (no email/Slack/push). Delivery latency is bounded by the worker poll interval (~1 s) and backoff on failures.
4. **`item_events` is a single table.** Reads scale via indexes and keyset access, but a multi-year history would warrant range partitioning and archival (not implemented).
5. **Lexical search only** (PostgreSQL full-text + trigram). No typo tolerance beyond trigram substring match, no relevance-ranked pagination.
6. **Edit conflicts are resolved by the user.** The server rejects stale edits and returns the current item; there is no automatic field-level merge.
7. **Comments are append-only** (no edit/delete) to protect history.
8. **Single tenant, provisioned users.** No sign-up, password reset, MFA, or SSO.
9. **Transfer across teams** can remove the actor's own visibility of the item (by design, documented in the UI confirmation).
10. **Threshold configuration is global** (staleness hours via environment), not per team; `stale_at` is computed at write time, so a threshold change applies only after an item's next activity.
11. **Dead outbox rows require manual inspection** (SQL); there is no admin UI for retry.
12. **Counts on dashboards are capped** ("1000+") for bounded cost.
13. **Performance numbers** were measured on a single local PostgreSQL instance with the load seed, not under real multi-user load testing.
14. **Any pinned dependency substitutions** made during implementation are listed below. (Leave this line empty if none.)
~~~~

### 22.4 `docs/ARCHITECTURE.md`

~~~~markdown
# Architecture

## Components
```mermaid
flowchart LR
  B[Browser<br/>React + TanStack Query] -- REST + Idempotency-Key + expected_version --> API[API process<br/>Fastify]
  B -- SSE invalidation signals --> API
  API -- transactions --> PG[(PostgreSQL 16)]
  API -- LISTEN item_changed --> PG
  W[Worker process<br/>outbox poller + scheduler] -- SKIP LOCKED claims --> PG
```

## Claim race (two users, same item)
```mermaid
sequenceDiagram
  participant A as User A
  participant B as User B
  participant API
  participant DB as PostgreSQL
  A->>API: POST /items/:id/claim (key a)
  B->>API: POST /items/:id/claim (key b)
  API->>DB: BEGIN; SELECT ... FOR UPDATE (A gets lock)
  API->>DB: (B waits on the row lock)
  API->>DB: UPDATE assignee=A, version+1; INSERT event claimed; INSERT outbox; pg_notify; COMMIT
  API-->>A: 200 item(assignee=A)
  API->>DB: (B proceeds) item already assigned -> ROLLBACK
  API-->>B: 409 already_claimed {assignee: A}
```

## Async flow
Mutation transaction writes `item_events` + `outbox` rows → commit → worker claims outbox rows (`SKIP LOCKED`) → handler inserts `notifications` (idempotent) → row `done`; failures retry with backoff, then `dead`.

## Data model summary
`users` ─< `team_memberships` >─ `teams` ─< `work_items` ─< `item_events` (append-only), `comments`, `approvals`, `item_watchers`; `notifications` (per user/event); `outbox` (per event/handler); `idempotency_keys` (per user/key).

## Request pipeline
validate (zod) → authenticate (JWT + DB actor) → idempotency (in tx) → lock item → visibility (404) → expected_version (409) → permission/guards (403/409) → update + event + outbox + notify → store response → commit.
~~~~

---

## 23. Traceability: Problem Statement → plan → proof

| Problem Statement item | Where addressed | Proof |
|---|---|---|
| Create/manage work items; what, why, state, importance, owner, history, next | §8, §10, §11 (Item DTO, `allowed_actions`), §17 | history-immutability, workflow tests |
| Multiple users, same item, same time | §12 (CB1–CB3), §14 | claim-race, optimistic-lock, idempotency, stream tests |
| Teams, multi-membership, differing responsibilities | §8 (`team_memberships.role`), §9 | permissions unit, authz tests |
| Authorization enforced by system, not UI only | §9.1, §12 CB5 | authz tests via direct API calls |
| Collaboration and history; changes visible; actions never silently disappear | §8 (`comments`, `item_events`, immutability trigger), §11 | history-immutability |
| Two users take responsibility | §12 CB1, §16.3 `claimItem` | claim-race |
| Viewing information another just changed | §12 CB2, §14, §17.4 | optimistic-lock, stale-banner |
| Multiple updates in short period | §12.1, `expected_version`, row lock | optimistic-lock (50 rapid updates) |
| User repeats action unsure of success | §12.2 idempotency, §17.2 intent keys | idempotency, idempotent-retry |
| Useful overview; find what needs attention | §15.4, §17.4 Dashboard | pagination-search, manual smoke |
| Usable as data grows; not load everything | §15.2, §15.5, §17.5 | pagination-search (EXPLAIN), seed-load |
| Optional async; consider failure/duplicate/delay | §13 | outbox, scheduler tests |
| Scale expectations | §8 indexes, §15.5, §14 limits | seed-load timings |
| Engineering expectations: data modelling / API / frontend state / authz / concurrency / errors / consistency / search / performance / maintainability | §8 / §11 / §17 / §9 / §12 / §18 / §8+§12.1 / §15 / §15.5+§17.5 / §5 (layering: pure domain, services, repos), lint, tests | all tests; code structure |
| ≥3 non-CRUD correctness situations | §12 (CB1–CB8) | tests listed in §12 |
| `ENGINEERING_DECISIONS.md` (~5 decisions) | §22.2 (five) | file exists |
| Automated tests for dangerous behaviour | §20 | `npm run test` |
| Submission: source, run instructions, setup, decisions, tests, limitations | §22, §21 | P9, P10 gates |
| "Full fledged plan" (this document) | whole document | — |
| "Smaller well-considered system over many incomplete features" | §2.2 out-of-scope list; §0 rule 1 | — |

---

## 24. Definition of Done (final checklist; every box needs evidence in `docs/PROGRESS.md`)

- [ ] Repository matches Section 5 and uses only Section 4 dependencies/versions (substitutions recorded).
- [ ] `npm run lint`, `npm run typecheck`, `npm run build`, `npm run test` all exit `0` from a fresh clone following `README.md` literally.
- [ ] All integration scenarios in Section 20.3 and frontend tests in 20.4 exist and pass; none weakened.
- [ ] Every mutation endpoint: validates input, requires `Idempotency-Key`, runs in one transaction with lock → authz → guard → update → event → outbox → notify.
- [ ] No endpoint returns an unbounded collection; no `OFFSET`; no SQL built by concatenating user input.
- [ ] Authorization verified by direct API tests; `403` vs `404` semantics as specified.
- [ ] Worker runs as a separate process; stopping it does not break any primary flow; failure/duplicate/delay tests pass.
- [ ] Seed users from the README exist; smoke checklist (21.2) executed and recorded.
- [ ] `README.md`, `ENGINEERING_DECISIONS.md`, `KNOWN_LIMITATIONS.md`, `docs/ARCHITECTURE.md` exist inside the repo with accurate content.
- [ ] Nothing from Section 2.2 was built.
- [ ] Any deviation from this plan is listed in `KNOWN_LIMITATIONS.md` with a reason.

*End of implementation plan.*
