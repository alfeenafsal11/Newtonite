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
