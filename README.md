# OpsFlow

Internal web application for coordinating operational work (customer issues, incidents, payment investigations,
compliance requests, operational tasks) across teams, with reliable ownership, approvals, history, and concurrency handling.

## What it does
- Work items with status, priority, owner, due date, tags, approval gate, comments, and a complete append-only history.
- Teams and per-team roles (viewer, member, approver, admin) enforced on the server; org-level `auditor` and `org_admin`.
- "What needs my attention" dashboard, team overview, filterable/searchable keyset-paginated list, in-app notifications.
- Correct under concurrency: atomic claim, optimistic locking, idempotent mutations, live staleness signals.
- Reliable async processing (transactional outbox) for notifications and background sweeps.

## Live Deployment

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/alfeenafsal11/Newtonite)

- **GitHub Repository:** [https://github.com/alfeenafsal11/Newtonite](https://github.com/alfeenafsal11/Newtonite)
- **One-Click Deployment:** Click the Deploy to Render button above, or import the repository in Render to launch the web service and PostgreSQL database automatically via [render.yaml](file:///d:/PROJECTS/Newtonite/render.yaml).
- **Demo Credentials:** Pre-seeded accounts (e.g., `admin@opsflow.test`, `support.lead@opsflow.test`, `pay.approver@opsflow.test`) with password `password123` or `Passw0rd!demo`.

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
Open http://localhost:5173 and sign in with a demo account (password for all: `password123`; dev only).

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
Large-data check (optional): `npm run seed:load` (≈50k items, 300k events) then `npm run test:api -- scale-explain`.

## Documentation
- `ENGINEERING_DECISIONS.md` — key decisions and trade-offs
- `KNOWN_LIMITATIONS.md` — what is intentionally missing or imperfect
- `docs/ARCHITECTURE.md` — diagrams and data flow
- `IMPLEMENTATION_PLAN.md` — the full plan this system was built from

## Assumptions

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
| A19 | Local Dev Environment | Native PostgreSQL 16 on Windows localhost:5432 is supported alongside Docker Compose. |
