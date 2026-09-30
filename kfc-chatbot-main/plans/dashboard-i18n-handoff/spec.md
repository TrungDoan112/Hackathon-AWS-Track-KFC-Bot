# Spec: Dashboard language toggle + human handoff in chat

**Date:** 2026-07-12
**Status:** Draft

---

## Problem Statement

Staff operating the KFC bot dashboard need to (1) view the dashboard UI in English as an alternative to the current hardcoded Vietnamese, and (2) take over a live conversation from the bot and reply as a human when the situation needs it (e.g. bot stuck, customer upset) — a capability that doesn't exist today since the dashboard is currently read-only.

---

## User Stories

<!-- P1 = MVP (must ship), P2 = nice-to-have, P3 = future/out-of-scope -->

- **[P1]** As a staff member, I want to toggle the dashboard UI between Vietnamese and English so that I can operate it in my preferred language.
  Accepted when: clicking the toggle re-renders all dashboard labels/text (headers, statuses, empty states, buttons) in the selected language without a page reload; the choice persists across page reloads in the same browser.

- **[P1]** As a staff member, I want to click "Tiếp quản" (Take over) on a session so that the bot stops auto-replying and I can respond to the customer myself.
  Accepted when: clicking take-over on a session immediately stops further bot-generated replies for that session; the dashboard shows a clear "human-controlled" status for the session.

- **[P1]** As a staff member, I want a message composer in the dashboard so that I can type and send a reply that reaches the customer through the same channel (Zalo) the bot uses.
  Accepted when: a sent message appears in the conversation transcript attributed to the human agent (not the bot) and is delivered to the customer via the existing Zalo outbound path.

- **[P1]** As a staff member, I want to hand control back to the bot when I'm done so that the bot resumes normal auto-replies.
  Accepted when: clicking "hand back" on a taken-over session re-enables bot auto-replies for that session going forward.

- **[P2]** As a staff member, I want the dashboard to visually flag which sessions are currently human-controlled (vs. bot-controlled) in a session list/overview, so I can tell state at a glance.

- **[P3]** _(out of scope) — bot auto-detecting bad situations and suggesting handoff without staff clicking take-over first._

- **[P3]** _(out of scope) — translating bot replies sent to customers into English; bot/customer-facing copy stays Vietnamese-only._

---

## Functional Requirements

<!-- Number each. Be specific. -->

1. FR-01: Dashboard exposes a language toggle control (VI/EN) visible on the main dashboard page.
2. FR-02: All static UI copy in `public/index.html` and dynamically rendered strings in `public/dashboard.js` are externalized into a string table and swapped based on the active language.
3. FR-03: Selected language persists in the browser (`localStorage`) and is applied on next page load without requiring re-selection.
4. FR-04: Each chat session has a state field (bot-controlled vs. human-controlled), defaulting to bot-controlled.
5. FR-05: A "Tiếp quản" (Take over) action, scoped to one session, flips that session to human-controlled and suppresses further bot-generated replies to that session's customer.
6. FR-06: When a session is human-controlled, the backend rejects/skips bot auto-reply generation for that session (no bot message is sent to the customer while human-controlled), even if new customer messages arrive.
7. FR-07: Dashboard adds a message composer (text input + send) that, when a session is human-controlled, sends the typed message to the customer via the existing Zalo outbound delivery path and records it in the session's message history with a role distinct from `assistant`/`user` (e.g. `human_agent`).
8. FR-08: A "hand back to bot" action, scoped to one session, flips that session back to bot-controlled, resuming normal auto-replies.
9. FR-09: The dashboard transcript view visually distinguishes human-agent messages from bot messages (e.g. different styling/label).

---

## Non-Functional Requirements

<!-- Use numbers, not adjectives. -->

- Performance: language toggle switches visible UI text in < 200ms (client-side only, no network round-trip).
- Security: none added beyond current posture — dashboard and new composer/take-over endpoints remain unauthenticated, consistent with the rest of this single-tenant demo app (see Out of Scope).
- Availability: take-over/hand-back state changes take effect for the very next inbound/outbound message on that session — no in-flight bot reply already generating should be sent after take-over is clicked (race condition documented in brainstorm report).

---

## Success Criteria

- [ ] 100% of visible dashboard strings (headers, buttons, statuses, empty states) render correctly in both VI and EN with no leftover hardcoded-language mixing.
- [ ] Language selection persists across a full page reload in the same browser, verified manually.
- [ ] Taking over a session stops 100% of further automated bot replies to that session until handed back (verified by sending a test customer message post-take-over and confirming no bot reply is sent).
- [ ] A human-agent-sent message reaches the customer via Zalo and appears correctly attributed in the dashboard transcript.
- [ ] Hand-back resumes bot auto-replies with no manual restart/redeploy required.

---

## Out of Scope

- Translating bot-generated replies sent to customers over Zalo (stays Vietnamese-only).
- Bot auto-detection/auto-suggestion of when to hand off to a human (manual trigger only, this iteration).
- Approval/edit queue for bot-drafted replies during human control (bot is fully muted, not shadow-running).
- Multi-agent/multi-operator assignment (who "owns" a taken-over session) — single implicit human actor assumed.
- Authentication/authorization for dashboard or composer access.

---

## Assumptions

- The dashboard remains a single, unauthenticated, single-tenant internal tool — no user accounts are being introduced by this feature.
- "Zalo outbound delivery path" already used by the bot (via `src/infrastructure/zalo/zalo-client.js`) can be reused/called directly to send a human-composed message; this needs verification during planning.
- Only one staff member interacts with a given session at a time (no concurrent-editor conflict handling needed).

---

## [NEEDS CLARIFICATION]

<!-- Remove section when empty. Items here block /ck:plan. -->

- [ ] Data model choice for human-sent messages (new `role: 'human_agent'` value vs. reusing `assistant` with a flag) — technical call, deferred to `/ck:plan` against `src/infrastructure/store.js`.
- [ ] Race-condition handling: if a bot reply is already streaming (SSE) when staff clicks "Tiếp quản" mid-generation, should it be allowed to finish, or cancelled? — deferred to `/ck:plan`.
