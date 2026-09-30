# Spec: Staff anomaly alerts + dashboard cart editing

**Date:** 2026-07-12
**Status:** Draft

---

## Problem Statement

Staff monitoring the KFC bot dashboard currently have no way to know a session needs attention unless they happen to be watching it — there's no signal for oversized orders, a bot stuck repeating itself, or a customer using complaint language. Separately, once staff take over a session (existing handoff feature), they can only reply by text — they can't add a menu item to the customer's cart themselves, so correcting or completing an order requires asking the customer to re-request items through chat.

---

## User Stories

<!-- P1 = MVP (must ship), P2 = nice-to-have, P3 = future/out-of-scope -->

- **[P1]** As a staff member, I want a session to be visibly flagged on the dashboard when its cart/order is unusually large, so that I can review it before it's confirmed.
  Accepted when: a session whose cart exceeds 10 items or 1,000,000₫ shows a distinct badge on the session list, without requiring the staff member to open the session first.

- **[P1]** As a staff member, I want a session to be visibly flagged when the bot appears stuck repeating itself, so that I know to step in.
  Accepted when: two or more consecutive bot replies in the same session are near-duplicates of each other, the session shows the same anomaly badge on the session list.

- **[P1]** As a staff member, I want a session to be visibly flagged when a customer message contains sensitive/complaint language, so that I can prioritize it.
  Accepted when: a customer message matching a configured keyword list triggers the same anomaly badge on the session list.

- **[P1]** As a staff member, once I've taken over a session, I want to add a menu item directly to that session's cart from the dashboard, so that I can fix or complete an order without relaying it back through chat.
  Accepted when: selecting an item and clicking add updates the session's cart (reflected in the next dashboard snapshot) and is rejected if the session is not currently human-controlled.

- **[P2]** As a staff member, I want the anomaly badge to clear once I've opened/reviewed the flagged session, so that resolved flags don't clutter the session list.

- **[P3]** _(out of scope) — detecting rapid-fire messaging (N messages in M seconds) as an anomaly trigger; deferred, no timing-tracking mechanism exists yet._

- **[P3]** _(out of scope) — staff editing/removing existing cart line items (only adding new items is in scope this iteration)._

---

## Functional Requirements

<!-- Number each. Be specific. -->

1. FR-01: Backend computes an "oversized order" anomaly when a session's cart has more than 10 items OR a total exceeding 1,000,000₫, checked whenever the cart is updated.
2. FR-02: Backend computes a "bot stuck" anomaly when the two most recent consecutive `assistant`-role messages in a session are exact text matches (case-sensitive string equality, no fuzzy/similarity scoring), checked after each bot reply is persisted.
3. FR-03: Backend computes a "sensitive keyword" anomaly when an inbound customer message matches an entry in a configured VI/EN keyword/phrase list (normalized match, case/diacritic-insensitive, consistent with the existing `normalizeText` used for menu search), checked when the message is received. Starter list (~25-30 terms covering complaint, legal threat, fraud, food-safety, and abuse language) — see Assumptions.
4. FR-04: Each anomaly is recorded as a new `activity_events` row with a distinct type (e.g. `anomaly_oversized_cart`, `anomaly_bot_stuck`, `anomaly_sensitive_keyword`), reusing the existing activity-event mechanism — no new table.
5. FR-05: The dashboard session list shows a visible badge on any session with at least one unresolved anomaly event, sourced from the existing `dashboardSnapshot()` read path.
6. FR-06: A new staff-facing route allows adding a menu item to a session's cart, accepting an item selection (product id, variant, quantity) and calling the same cart-mutation path (`store.updateCart`) the agent's `update_cart` tool already uses.
7. FR-07: The add-to-cart route is rejected (409) unless the target session's `control_mode` is `human` at the time of the request — re-checked server-side via a shared guard helper, not just gated in the UI.
8. FR-07b: The existing inline `control_mode === 'human'` checks in `chat-service.js` (×2) and `api.js`'s `human-message` route are refactored to call the same shared guard helper introduced for the new cart-edit route, eliminating the duplicated pattern.
8. FR-08: The cart panel in the dashboard shows an item-add control (search/select from menu + add button) only when the currently selected session is human-controlled.

---

## Non-Functional Requirements

<!-- Use numbers, not adjectives. -->

- Performance: anomaly checks run inline with existing message/cart-update handling and must not add a network round-trip or noticeably delay the bot's reply latency (checks are in-process, not external calls).
- Security: no auth added, consistent with the rest of this single-tenant demo app's current posture (see `plans/dashboard-i18n-handoff/spec.md` precedent).
- Availability: an anomaly badge must reflect within one dashboard poll cycle (≤ 1s) of the triggering event being persisted.

---

## Success Criteria

- [ ] A cart exceeding 10 items or 1,000,000₫ shows the anomaly badge on the session list within one poll cycle.
- [ ] Two consecutive near-duplicate bot replies trigger the anomaly badge for that session.
- [ ] A customer message containing a configured sensitive keyword triggers the anomaly badge for that session.
- [ ] Adding an item to a human-controlled session's cart from the dashboard updates the cart and is visible in the next dashboard snapshot.
- [ ] Attempting to add an item to a bot-controlled (not taken-over) session's cart is rejected with a clear error, verified by a direct API call bypassing the UI gate.

---

## Out of Scope

- Rapid-fire message-count anomaly detection (deferred — no existing timing-tracking mechanism).
- Editing or removing existing cart line items from the dashboard (only adding new items).
- Auto-clearing/dismissing anomaly badges (P2, not required for MVP — deferred to planning to decide if it ships this iteration).
- Authentication/authorization for the new cart-edit route, consistent with existing unauthenticated dashboard endpoints.
- Fuzzy/ML-based similarity for "bot stuck" detection beyond a simple text-similarity check.

---

## Assumptions

- The `control_mode` guard pattern from the existing handoff feature (`sessions.control_mode`) is reused as-is; no new session-state field is needed for cart-edit gating.
- `activity_events` can absorb three new event types without schema changes (the table already stores `type`, `label`, and a JSON `payload` column per the existing schema).
- A simple keyword-list match (case-insensitive substring or normalized-text match, consistent with the existing `normalizeText` used for menu search) is sufficient for the sensitive-keyword trigger — no NLP/sentiment model needed.
- Starter VI/EN sensitive-keyword list (~25-30 terms, to be finalized in the phase file):
  - VI: khiếu nại, phàn nàn, tố cáo, kiện, luật sư, báo công an, công an, lừa đảo, lừa gạt, ngộ độc, dị ứng, dị vật, côn trùng, tóc trong đồ ăn, hỏng, ôi thiu, mốc, bẩn, thái độ tệ, chửi, xúc phạm, bồi thường, hoàn tiền, bóc phốt, tẩy chay
  - EN: complaint, lawsuit, lawyer, sue, police, scam, fraud, food poisoning, allergic reaction, foreign object, insect, hair in food, moldy, expired, refund, compensation, disgusting, terrible service, report this, boycott
- Bot-stuck detection uses exact case-sensitive string equality between the two most recent consecutive bot replies — cheapest option that satisfies the P1 story; no similarity scoring.
- The `control_mode === 'human'` guard is extracted into one shared helper (exact location — e.g. `store.js` or a new `src/application` module — is a planning decision) and all 4 consumers (2× `chat-service.js`, `api.js`'s `human-message` route, and the new cart-edit route) call it instead of duplicating the check.
