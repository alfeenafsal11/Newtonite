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
14. **Any pinned dependency substitutions** made during implementation are listed below. (None.)
