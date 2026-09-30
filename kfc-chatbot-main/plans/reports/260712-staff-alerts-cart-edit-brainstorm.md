# Brainstorm: Staff anomaly alerts + dashboard cart editing

**Date:** 2026-07-12

## Ideas Explored

- **Anomaly triggers considered**: rapid-fire messaging (N msgs in M seconds), oversized cart/order, bot stuck repeating itself, sensitive/complaint keywords. All four were named by the user; rapid-fire messaging was deferred (needs a new timing-tracking mechanism not yet in the codebase, while the other three are cheap to check at message-handling time).
- **Staff notification channel considered**: badge/highlight on the session list vs. realtime toast vs. both. User picked badge-only for now — simpler, no risk of toast spam, staff already glances at the session picker.
- **Anomaly delivery mechanism considered**: reuse the existing `activity_events` table/stream (already powers the "Agent Activity" dashboard panel) vs. build a separate alerts table. Reuse won — scouting confirmed `store.insertActivity()` is already called from multiple places (cart updates, handoff events) and read by `dashboardSnapshot()`, so a new `type: 'anomaly_detected'` event slots in with zero new plumbing.
- **Cart-edit trigger scope considered**: staff picks items from menu vs. staff edits an agent-drafted cart vs. both. User picked "staff picks from menu, adds directly" — matches the existing `update_cart` tool's `operations` shape, so it's additive, not a new cart model.
- **Cart-edit availability considered**: always available vs. only when session is human-controlled. User picked human-controlled-only — avoids a race where the agent and a staff member mutate the same cart concurrently while the bot still owns the session.
- **Cart-edit UI location considered**: inline in the existing cart panel vs. a separate modal. User picked inline — less UI surface to build, and keeps cart edits visually tied to the cart they're changing.

## User's Direction

Two independent additions to the existing dashboard/handoff surface:

1. **Anomaly signal to staff** — flag a session on the dashboard's session list when: (a) cart/order exceeds 10 items or 1,000,000₫, (b) the bot's last reply is a near-duplicate of a recent prior reply in the same session (stuck/looping), or (c) a customer message contains a sensitive/complaint keyword. Surfaced via a badge on the session picker, backed by a new `activity_events` type so it reuses the existing activity stream and dashboard rendering path.
2. **Staff-triggered cart edit** — once a session is human-controlled (post take-over), staff can add menu items directly to that session's cart from the existing cart panel, calling the same `store.updateCart()` path the agent's `update_cart` tool already uses.

## Open Questions

- Exact sensitive-keyword list (starter set) — left for `/ck:plan` to draft against a reasonable Vietnamese complaint-language wordlist; not blocking, easy to extend later.
- Whether an anomaly badge should auto-clear (e.g. once staff opens the session, or once take-over happens) or persist until manually dismissed — needs a decision during planning.
- The "bot near-duplicate reply" check needs a similarity heuristic (exact match vs. fuzzy) — a technical call deferred to planning against `chat-service.js`.
- Rapid-fire message-count detection is explicitly deferred to a future iteration (no P1/P2 story for it in this spec) — flagged as P3.
- `control_mode === 'human'` guard is currently duplicated inline in 3 places (`chat-service.js` ×2, `api.js` ×1 for the `human-message` route); a 4th consumer (staff cart-edit route) should prompt extracting a shared guard helper rather than a 4th copy-paste — a planning decision, not a blocker.

## Risks

- **False positives on the oversized-cart trigger**: family-size combo orders could legitimately exceed 10 items; may need staff feedback after initial rollout to tune the threshold rather than treating 10/1,000,000₫ as final.
- **Near-duplicate detection cost/complexity**: comparing bot replies for similarity could be a simple string-equality check (cheap, will miss paraphrased loops) or a fuzzy-match (more accurate, more code) — planning should pick the cheapest option that satisfies the P1 story rather than over-building this.
- **Race with the mute guard**: staff cart edits must be blocked the moment control flips back to `bot` (hand-back) — reuses the same double-guard discipline established in the handoff feature, but needs an explicit check in the new route, not just at UI level (a staff cart-edit request could arrive after hand-back due to network delay).
