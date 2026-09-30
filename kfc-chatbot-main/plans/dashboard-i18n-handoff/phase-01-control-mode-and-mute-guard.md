# Phase 1: Session control-mode schema, zalo_chat_id capture, and double mute guard

Testing: standard

Covers spec stories: P1 "take over stops bot replies" (FR-04, FR-05, FR-06), P1 "hand back resumes bot replies" (FR-08), and the availability NFR on race-condition safety. This is backend-only, no UI in this phase.

## Requirements
Every chat session gains a persisted control state (bot-controlled or human-controlled, defaulting to bot-controlled) and a persisted Zalo chat address, and the bot reliably stops generating or sending replies for a session the moment it's flipped to human-controlled — including replies that were already mid-generation when the flip happened.

## Steps
1. Before running any schema upgrade, copy the existing sqlite database file to a timestamped backup path (skip if the DB file doesn't exist yet, e.g. first run) so a failed upgrade always has a manual recovery path independent of the transaction/rollback logic.
2. Add a session-level control state (bot vs. human, defaulting to bot) and a stored Zalo chat address to the session record. Since there is no migration framework, perform this as an explicit, ordered startup upgrade: check for column/constraint presence, run any needed `ALTER TABLE`/table-rebuild inside a transaction (temporarily disable the `foreign_keys` pragma for the rebuild, verify row counts match before dropping the old table, roll back on any error), and record the applied schema version (e.g. `PRAGMA user_version` or a small metadata row) so a crash mid-upgrade doesn't silently reapply or skip work on next boot.
3. Widen the `messages.role` CHECK constraint to allow `human_agent` alongside `user`/`assistant`. In SQLite this requires a full table rebuild (new table with the new constraint → copy rows → drop old → rename → recreate indexes) — fold this into the same guarded, transactional upgrade routine from Step 2, not a separate ad-hoc migration.
4. Populate the Zalo chat address on **every** inbound Zalo-parsed message for a session (not only on session creation), so sessions that already existed before this feature shipped self-heal their address on their very next customer message, rather than remaining permanently addressless.
5. Add store-level operations to read and flip a session's control state. Make these idempotent: flipping to a state the session is already in returns the same success response without writing a duplicate activity event — only an actual state transition (bot→human or human→bot) is logged, so a double-click or retried request can't produce duplicate/misleading history entries.
6. Stop the bot from starting a new reply for a session that is currently human-controlled, for both the dashboard chat entry point and the Zalo webhook entry point, by centralizing the check in one shared place both paths already call through (`ChatService.chat()`).
7. Add a second check right before a bot reply would actually be delivered or saved, so that if control flips to human while a reply was already being generated, that reply is discarded instead of reaching the customer or the transcript. This discard must be signaled as its own distinct, typed outcome (e.g. a sentinel result or dedicated flag on the return value) — **not** an empty/falsy reply — because `zalo-webhook-service.js` currently treats an empty reply as a genuine agent failure and sends the customer-facing `FAILURE_REPLY` fallback message. Update `zalo-webhook-service.js`'s caller to explicitly check for the "discarded due to handoff" outcome and no-op (skip both the fallback send and the error activity log) rather than falling into its existing empty-reply/catch handling. Apply the same distinction on the SSE (`api.js`) side so a discarded reply doesn't emit a misleading `error` event to the dashboard.
8. Manually verify: start a session, take it over mid-reply-generation (or immediately after sending a customer message), and confirm no bot reply — and no fallback/failure message — is sent or stored for that session afterward; confirm a normal session with an unset control state still behaves exactly as it does today; confirm double-clicking take-over (or retrying the request) does not produce duplicate activity log entries; confirm a DB backup file was created before the schema upgrade ran.

## Success Criteria
- A newly created session defaults to bot-controlled with no manual setup.
- Flipping a session's control state to human-controlled is persisted and survives a server restart.
- Sending a Zalo message as a customer results in that session's Zalo address being stored, including for sessions that existed before this feature shipped.
- Once a session is human-controlled, no further bot-generated reply — including no fallback/failure message — is sent to the customer for that session, even if a reply was already in flight when control changed.
- An existing (pre-feature) local database starts up cleanly with the new fields/constraint applied and all existing sessions/messages intact, and the upgrade does not silently reapply or skip work if the process restarts mid-upgrade.
- Repeating a take-over or hand-back call for a session already in that state is a no-op (same success response, no duplicate activity event).

## Risks
- Reply already streaming when take-over is clicked could still reach the customer: mitigated by the second guard immediately before send/persist, with a discard signal distinguishable from a real failure so it doesn't trigger the existing `FAILURE_REPLY` fallback path — verified manually per Step 7.
- Existing sqlite files lack the new columns/constraint changes: mitigated by a transactional, versioned startup upgrade routine (not "create if not exists" alone), verified against an existing demo database, not just a fresh one.
- Webhook path populating the Zalo address only on inbound Zalo messages means a session created purely from the dashboard side (no inbound Zalo message yet) has no address: acceptable per spec (composer/take-over is scoped to real customer sessions), but must surface clearly rather than fail silently — flagged for Phase 2/3 to handle in the response/UI.
- Concurrent duplicate take-over/hand-back requests (double-click, retry): mitigated by making the store-level flip idempotent per Step 4.
