# Plan: Staff Anomaly Alerts + Dashboard Cart Editing
Status: 🟡 In Progress
Date: 2026-07-12
Mode: Hard

## Overview
Give staff an at-a-glance signal when a session needs attention (oversized cart, a bot stuck repeating itself, or sensitive customer language), and let staff who have taken over a session add menu items directly to that session's cart from the dashboard instead of relaying it back through chat.

## Phases
- [x] Phase 1: Anomaly detection (oversized cart, bot-stuck duplicate, sensitive keyword) — covers P1 stories "oversized cart flag", "bot stuck flag", "sensitive keyword flag" (FR-01, FR-02, FR-03, FR-04)
- [x] Phase 2: Dashboard anomaly badge — covers the visibility half of all three P1 anomaly stories (FR-05); explicitly defers the P2 "auto-clear on view" story
- [ ] Phase 3: Shared human-controlled guard — refactors the 3 existing `control_mode === 'human'` checks and introduces the primitive the new cart-edit route needs (FR-07b)
- [ ] Phase 4: Staff cart-edit backend route — covers the backend half of the P1 "add item to cart from dashboard" story (FR-06, FR-07)
- [ ] Phase 5: Staff cart-edit dashboard UI — covers the UI half of the P1 "add item to cart from dashboard" story (FR-08)

## Research Summary
Two researchers ran independently and converged on the same architecture with no disagreement:

- **Anomaly detection hooks entirely into existing write paths, no new queries beyond what's already computed or one indexed SELECT**:
  - Oversized cart: checked inside `store.js` `updateCart()` right after `recalculateCart()` returns totals and item count are already known (around line 424-438) — zero extra queries.
  - Bot-stuck duplicate: checked inside `store.js` `addMessage()` (line 151-167) when `role === 'assistant'`, via one extra indexed SELECT for the immediately prior assistant message, inside the same transaction as the insert. This must be **post-persist** (matches FR-02's "checked after each bot reply is persisted"), not a pre-persist in-memory check in `chat-service.js`, to avoid a race if persistence fails after an in-memory check passed.
  - Sensitive keyword: also inside `addMessage()`, gated on `role === 'user'`, reusing `normalizeText` from `src/infrastructure/database.js:19-29` (already imported into `store.js`) — the same normalization path used by menu search, so VI diacritics/case are handled consistently with the rest of the app.
  - All three write a distinct `activity_events` row (`anomaly_oversized_cart`, `anomaly_bot_stuck`, `anomaly_sensitive_keyword`) via the existing `insertActivity()` — no new table, no new method signatures on any existing caller.
- **Dashboard badge**: computed as a correlated `EXISTS(SELECT 1 FROM activity_events WHERE session_id = s.id AND type LIKE 'anomaly_%')` subquery inside `dashboardSnapshot()`'s session list query (store.js:630-698), matching the existing `message_count`/`order_count` pattern there — not a denormalized column, since this codebase has no precedent for denormalized status flags and it would create a second source of truth.
- **P2 (auto-clear badge on view) is explicitly out of scope for this plan** per spec — noted as deferred in Phase 2, not built.
- **Cart-edit reuses the existing cart-mutation path**: the new staff route calls `store.updateCart(sessionId, { operations })`, the same method the agent's `update_cart` tool already uses — no new cart-mutation logic anywhere.
- **Shared control-mode guard**: introduced as a `store.js` method (not a new `src/application` module), since `store.js` already owns `getControlMode`/`setControlMode` and the `DomainError` class that `api.js` unwraps into JSON HTTP error responses. Key nuance found by both researchers: the guard has **two different callers with opposite polarity** — `chat-service.js`'s two inline checks (lines 53, 83) want "mute softly if human-controlled" (throw `HandoffMutedError`, a 200-with-SSE-event outcome, not a 409), while `api.js`'s `human-message` route and the new cart-edit route want "reject with 409 if NOT human-controlled". Rather than force both polarities through one throwing function with one meaning, the shared primitive exposes a plain control-mode read (or a single boolean) and each of the 4 call sites applies its own response semantics on top. All 4 call sites (2× `chat-service.js`, `api.js` human-message, new cart-edit route) are refactored to use it, per FR-07b.
- **Cart-edit UI**: inline in the existing cart panel (`public/index.html` / `dashboard.js` / `dashboard.css`) — item search/select + add button, shown only when the selected session is human-controlled, mirroring how the composer/take-over UI already conditionally renders based on `controlMode` from the prior handoff feature.

## Dependencies
None — no new external services, no new npm packages. Builds entirely on the existing `activity_events`, `sessions.control_mode`, and cart-mutation infrastructure shipped in `dashboard-i18n-handoff`.

## Risks
- HIGH: The shared control-mode guard touches 4 call sites across 2 files that currently have subtly different behavior on human-controlled sessions (soft-mute vs hard-reject). A careless refactor could flip the wrong polarity and either let the bot reply into a human-controlled session or block staff from sending. Mitigation: Phase 3 is scoped narrowly to just this refactor (no new feature logic mixed in), with explicit before/after behavior checks for all 4 call sites and manual verification against the existing take-over/hand-back/composer flows before touching anything cart-edit related.
- MEDIUM: "Cart has more than 10 items" is ambiguous between distinct product lines and total quantity across lines — the existing `itemCount` computed in `updateCart()` (line 424-426) is a `COUNT(*)` over `cart_items` rows (distinct lines), not a quantity sum. Mitigation: Phase 1 makes an explicit, documented decision (sum of `quantity` across lines, since "10 items" most naturally reads as item count, not distinct products ordered) rather than silently reusing the existing line-count variable.
- MEDIUM: Bot-stuck detection is exact case-sensitive string equality per FR-02/spec Assumptions — a bot reply that's semantically identical but differs by a trailing space, emoji, or punctuation won't trigger. Accepted per spec (explicitly out of scope: fuzzy/ML similarity); flagged here so it isn't mistaken for a bug later.
- LOW: The sensitive-keyword starter list (~25-30 VI/EN terms) lives in Phase 1's implementation as a plain data list, not a config file or DB table — updating it later requires a code change. Acceptable for this iteration per spec Assumptions (no NLP/sentiment model needed); noted for future config-driven follow-up if the list needs frequent tuning.
- LOW: No dedicated menu-listing endpoint currently exists for the dashboard (only `searchMenu(sessionId, query)`, which requires a session context tied to agent tool use). Phase 5's item picker needs read access to the product catalog. Mitigation: Phase 4 adds a small, session-independent menu-list read (reusing existing `products` table access patterns already in `store.js`), not a new subsystem.

### Red-team review findings (resolved)
- HIGH (fixed in Phase 1): raw substring keyword matching would false-positive against real menu item names (e.g. "bẩn" → "ban" is a substring of "Bánh Trứng" → "banh trung"). Fixed by requiring whole-token/phrase matching, not substring `.includes()`, plus a spot-check of the starter list against `kfc_menu.json` before shipping.
- HIGH (fixed in Phase 1): without dedup, a persistently oversized cart or a genuinely looping bot would insert a new duplicate anomaly row on every subsequent update/message. Fixed by a `NOT EXISTS`-gated insert (skip if an unresolved event of the same type already exists for the session), mirroring the badge's own `EXISTS` query shape.
- NOTED: the cart-edit route's control-mode check and the `updateCart` call are two separate operations (TOCTOU race if hand-back happens between them) — inherited, low-probability risk consistent with the existing `human-message` route's same check-then-act pattern; no fix required for this plan.
- NOTED: the new cart-edit route is unauthenticated and reachable cross-origin, causing a real cart mutation with no auth check — consistent with this app's explicit no-auth posture (spec Out of Scope) and the precedent already accepted in `dashboard-i18n-handoff`; flagged for continued conscious sign-off, not a new gap.

## Session Notes
<!-- Updated by cook automatically — do not edit manually -->

**Last active:** 2026-07-12 (Phase 2)
**Phase in progress:** phase-02-dashboard-anomaly-badge (complete)
**Status:** Phases 1-2 implemented and green; awaiting Hard-mode review gate approval to start Phase 3.

### Decisions made this session
- Sensitive-keyword list stored as pre-normalized token arrays in `database.js`, matched via whole-token/phrase sequence comparison (`matchesSensitiveKeyword`) — not substring `.includes()`.
- Dedup implemented as a shared `store.recordAnomalyOnce(sessionId, type, label, payload)` helper (existence check by `session_id` + `type`, no resolved/unresolved state yet — any prior row of that type blocks new inserts, matching spec's "unresolved" framing since nothing currently marks anomalies resolved).
- Oversized-cart check reads `SUM(quantity)` freshly after the transaction's writes, not the pre-existing `itemCount` (`COUNT(*)`) variable, per the plan's explicit MEDIUM-risk resolution.
- Bot-stuck check compares against the immediately preceding assistant message before the new one is inserted (post-persist per FR-02, using a `SELECT ... ORDER BY created_at DESC, id DESC LIMIT 1` inside the same transaction).
- Badge computed via `EXISTS(... type LIKE 'anomaly_%')` correlated subquery in `dashboardSnapshot()`'s session list, exposed as `hasAnomaly` boolean — one flag regardless of how many anomaly types/rows exist, per Step 5's "single unambiguous badge" requirement.
- UI: session list is a native `<select>` of `<option>`s (not row divs), so the badge is a `⚠️ ` prefix in the option label, ordered before the existing `🧑‍💼` human-controlled prefix — visually distinguishable at a glance, no new DOM structure needed. Verified live via `curl` against `/api/dashboard/snapshot`.

### Next immediate action
Wait for user approval (Hard-mode Review Gate) before starting Phase 3 (shared control_mode guard refactor).
