# Phase 3: Handoff dashboard UI

Testing: standard

Covers spec stories: P1 "take over a session" and "hand back to bot" (FR-05, FR-08) UI, P1 "message composer" UI (FR-07), P2 "flag human-controlled sessions at a glance" (FR-04), and the transcript visual distinction requirement (FR-09). Depends on Phase 2's routes.

## Requirements
Staff can see and change a session's control state from the dashboard, type and send a message to the customer when a session is human-controlled, and visually tell human-sent messages apart from bot and customer messages in the transcript and session list.

## Steps
1. Add a visible control-state indicator per session (in the session picker/list and on the selected session's panel) showing bot-controlled vs. human-controlled at a glance.
2. Add "Tiếp quản" (take over) and "hand back" actions scoped to the selected session, wired to the new backend routes, with the correct action shown/enabled based on current state.
3. Add a message composer (text input plus send action) that only appears or is usable when the selected session is human-controlled, and is disabled or hidden otherwise.
4. Wire the composer's send action to the new human-message route, clearing the input and giving feedback on success or failure (reusing the existing toast pattern).
5. Give human-sent messages a distinct visual treatment in the transcript view (styling and/or label) so they're clearly different from bot and customer messages.
6. Handle the "no Zalo address on file" case in the UI so staff get a clear explanation instead of a broken-looking composer.
7. Manually verify the full staff flow: take over a session, see the composer appear, send a message, see it appear correctly styled in the transcript, hand back, and confirm the composer disappears/disables and bot replies resume.

## Success Criteria
- The current session's control state (bot vs. human) is visible without opening any submenu, both in the session list and the selected session's detail area.
- Take-over and hand-back buttons correctly reflect and change the session's state, matching what the backend reports on the next refresh.
- The composer is only usable while the session is human-controlled, and a sent message shows up in the transcript with a distinct look from bot/customer messages.
- A session with no linked Zalo address shows a clear explanation in place of a non-functional composer.

## Risks
- Dashboard uses polling (not push) for updates: a state flip from another action might lag briefly before reflecting in the UI. Mitigation: reuse the existing poll cadence and optimistically disable buttons immediately after a click to avoid duplicate actions.
- New UI elements must not break the existing render/poll cycle for other panels (cart, orders, activity). Mitigation: add rendering as additive functions following the existing `render()` composition pattern, not by rewriting existing renderers.
- Interaction with Phase 4's i18n toggle: new strings introduced here (button labels, composer placeholder, status badges) must be added to the string table so Phase 4 doesn't need to retrofit this phase's markup. Mitigation: use the same `data-i18n` attribute convention from the start even though Phase 4 lands after this phase in this plan's ordering.
