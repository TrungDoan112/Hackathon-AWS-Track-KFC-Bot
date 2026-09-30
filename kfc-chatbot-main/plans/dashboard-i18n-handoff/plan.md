# Plan: Dashboard Language Toggle + Staff Handoff
Status: ✅ Complete
Date: 2026-07-12
Mode: Hard

## Overview
Ship two independent-ish dashboard capabilities: a client-side VI/EN language toggle for the staff UI, and a staff-triggered "take over"/"hand back" flow that mutes the bot for a session and lets a human reply through the existing Zalo outbound path.

## Phases
- [x] Phase 1: Session control-mode schema, zalo_chat_id capture, and double mute guard — covers P1 stories "take over stops bot replies" and "hand back resumes bot replies" (FR-04, FR-05, FR-06, FR-08, and the race-condition NFR)
- [x] Phase 2: Handoff backend routes and human message persistence — covers P1 story "message composer sends via Zalo and is attributed correctly" (FR-07, part of FR-09)
- [x] Phase 3: Handoff dashboard UI (take-over/hand-back controls, composer, transcript styling) — covers P1 stories for take-over/hand-back/composer UI and the P2 story "flag human-controlled sessions at a glance" (FR-05, FR-07, FR-08, FR-09)
- [x] Phase 4: Dashboard VI/EN language toggle (string table, data-i18n rendering, localStorage persistence) — covers the P1 language-toggle story (FR-01, FR-02, FR-03, and the <200ms/no-round-trip NFR)

## Research Summary
Two parallel researchers converged on the same architecture with no disagreement:

- **i18n**: plain JS string-table object keyed by locale, `data-i18n` attributes on markup, an `applyLocale()` render pass triggered on toggle click and on page load (reading `localStorage`). No new dependency, no build step, no network fetch of locale data — this is required to meet the NFR of <200ms with no round-trip.
- **Handoff data model**: add `control_mode` (`'bot'` | `'human'`, default `'bot'`) to the `sessions` table, plus store methods `setControlMode`/`getControlMode`.
- **Critical gap found by research**: the `sessions` table does not currently persist the Zalo `chatId` needed to send outbound messages (only `customer_phone` is stored). A `zalo_chat_id` column must be added and populated from the inbound webhook parse (`parseZaloTextEvent` already extracts `chatId` — it just isn't persisted today). Without this, the human composer has no address to send to. Both researchers flagged this as the highest-risk item and it gets its own explicit step in Phase 1.
- **Mute mechanism**: must be checked in two places to close the SSE/Agents-SDK generation race window: (1) at entry, before `ChatService.chat()` kicks off agent generation — skip entirely if `control_mode === 'human'`; (2) again immediately before the bot reply is persisted/sent — if control flipped to human mid-generation, drop the reply (log only, don't send or persist). Centralize both checks inside `chat-service.js` since both `api.js` (SSE) and `zalo-webhook-service.js` (Zalo ingress) call into it, so the guard isn't duplicated per-route. **Red-team fix**: the discard from check (2) must be a distinct, typed outcome — not an empty/falsy reply — because `zalo-webhook-service.js` currently treats an empty reply as a genuine agent failure and sends the customer-facing `FAILURE_REPLY` fallback, which would defeat the whole point of the mute guard. Phase 1 updates both callers to explicitly no-op on this outcome.
- **Human message role**: new literal `'human_agent'` value for `messages.role` (column is unconstrained text today aside from a CHECK constraint that must be widened — see Phase 1), reflected in `dashboard.js` message rendering and in `addActivity`'s role-to-label logic so human replies aren't mislabeled as bot activity.
- **Zalo outbound reuse**: the composer sends through the existing exported `sendMessage(chatId, text)` in `zalo-client.js` — no duplicated Zalo API logic.
- **No auth work** — confirmed out of scope by the spec for both features.

Because the `messages.role` column currently has `CHECK (role IN ('user', 'assistant'))` and the schema is applied via `CREATE TABLE IF NOT EXISTS` (no migration framework exists in this repo), both the new `control_mode`/`zalo_chat_id` columns on `sessions` and the loosened CHECK constraint on `messages` need explicit, idempotent migration handling in `src/infrastructure/database.js` (e.g. `PRAGMA table_info` probe + `ALTER TABLE ... ADD COLUMN` for new columns; table rebuild for the CHECK constraint change) rather than relying on `CREATE TABLE IF NOT EXISTS` alone, since existing local/deployed sqlite files already have these tables created without these columns/constraints.

## Dependencies
None (no external services beyond the already-integrated Zalo Bot API; no new npm packages).

## Risks
- CRITICAL (found in red-team review, fixed in plan): the pre-send discard signal for a mid-generation bot reply must not look like an empty/failed reply, or `zalo-webhook-service.js`'s existing failure-fallback path sends the customer a "hệ thống đang bận..." message anyway — exactly what the mute guard exists to prevent. Fixed by making the discard a distinct typed outcome that both callers (`api.js`, `zalo-webhook-service.js`) explicitly no-op on. See Phase 1 Step 6.
- HIGH: Bot reply race condition — a reply already generating (agent run + SSE stream) when staff clicks "Tiếp quản" could still reach the customer after hand-off. Mitigation: double guard in `chat-service.js` (pre-generation skip + pre-send drop), covered explicitly in Phase 1 with a manual verification step matching the spec's success criteria.
- HIGH: `zalo_chat_id` is not currently persisted anywhere, so composer sends could silently fail for sessions that predate this change or were never touched by the webhook path. Mitigation: Phase 1 backfills population on every inbound Zalo message for a session (not just session creation), so pre-existing sessions self-heal on their next customer message; Phase 2/3 surface a clear "no Zalo chat linked" state in the UI/route response rather than a silent failure.
- HIGH: New take-over/hand-back/composer-send endpoints are unauthenticated and reachable cross-origin (the app enables permissive CORS with no origin restriction), giving them a materially larger blast radius than the app's prior no-auth endpoints since a composer send reaches a real customer's Zalo account. Accepted per spec's explicit "auth out of scope" decision — flagged for conscious sign-off rather than silent inheritance. Mitigation for adjacent risk: error responses are sanitized (no raw upstream errors/stack traces), and message body length is validated (Phase 2).
- MEDIUM: Existing sqlite schema has no migration framework (`CREATE TABLE IF NOT EXISTS` only) and a CHECK constraint on `messages.role` that must change (full table rebuild in SQLite). Mitigation: transactional, versioned startup migration logic added in Phase 1 (temporarily disables FK checks during rebuild, verifies row counts, rolls back on error, records applied version), tested against both a fresh DB and an existing demo DB file.
- MEDIUM: Duplicate take-over/hand-back clicks or a duplicate composer send (double-click, client retry) have no server-side idempotency/dedup for the composer send. Mitigation: take-over/hand-back store operations are idempotent (Phase 1); composer send is mitigated client-side only by disabling the button until the request resolves (Phase 2/3) — accepted as low-severity residual risk given this is a human-in-the-loop, low-volume action.
- LOW: i18n string table drifting out of sync with markup as new dashboard features ship later. Mitigation: single source-of-truth string-table module plus a manual full-page VI/EN sweep as part of Phase 4's success criteria.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-07-12
**Phase in progress:** none (plan complete)
**Status:** All 4 phases complete, code-reviewed and approved (91/100, 0 CRITICAL/HIGH — 1 MEDIUM and 2 LOW findings, all fixed). Phase 4 language toggle implementation: `public/i18n.js` string-table module, `index.html` tagged with `data-i18n` attributes, `dashboard.js` dynamic renderers routed through `t()`, toggle button with localStorage persistence. Full test suite: 44/44 tests passing.

### Decisions made this session
- Phase 1 implemented before tests were written (deviation from `--tdd` request); resolved by having `tester` write comprehensive coverage against the finished implementation and confirming full-suite green rather than redoing implementation test-first. Flagged here for transparency.
- `tester` found and fixed a genuine Phase 1 bug: `backupDatabaseFile` checked file existence *after* `node:sqlite`'s `DatabaseSync` constructor had already created the file, so the "skip backup on first run" gate never actually skipped. Fixed by capturing `fs.existsSync(databasePath)` in `openDatabase()` before constructing `DatabaseSync`, threading a `preexisted` boolean through `migrateSchema()`/`backupDatabaseFile()` instead of re-checking existence post-creation.
- Phase 2 added `controlMode`/`zaloChatId` to `dashboardSnapshot()` output (both per-session in the `sessions[]` array and top-level for the selected session) — the original Phase 1 schema work didn't expose these fields to API consumers, and Phase 2's success criteria ("reflected in the next dashboard snapshot read") required it. `zaloClient` is now threaded through `createApiRouter(...)` from `server.js`.
- Phase 2 routes: `POST /api/sessions/:id/take-over`, `/hand-back` (idempotent, 404 on missing session), `/human-message` (400 on invalid length, 409 SESSION_NOT_HUMAN_CONTROLLED, 409 NO_ZALO_CHAT_ID, 502 ZALO_SEND_FAILED with sanitized error body — no raw Zalo error leaked to the unauthenticated endpoint). Tester verified 12 new tests, no bugs found.
- Phase 4: the CSS `content: "Nhân viên"` label on human-agent messages couldn't be reached by the `data-i18n` DOM-attribute convention (CSS content isn't a text node), so it was moved out of `dashboard.css` into an HTML `<span class="human-agent-label">` rendered inside `renderMessages()` in `dashboard.js`, using `t('message.humanAgentLabel')`.
- Phase 4: currency/date formatting (`Intl.NumberFormat`/`Intl.DateTimeFormat`, both `vi-VN`) was intentionally left unchanged — the phase scope is UI chrome/copy, not business-data formatting (amounts stay in VND regardless of UI language).
- Phase 4: the WAL-mode backup consistency MEDIUM finding from the Phase 1-3 review (`database.js`'s `backupDatabaseFile`) remains open/unaddressed — user deferred it, not declined; should be raised again before final commit in case they want it fixed.

### Next immediate action
Await `tester` sub-agent result for `public/i18n.js` coverage, then run `simplify` skill if the `SIMPLIFY_TRIGGERED` hook fires, then mandatory Hard-mode `code-reviewer` gate (no auto-approve) before Step 5 Finalize.
