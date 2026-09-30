# Phase 5: Staff Cart-Edit Dashboard UI

> Covers: UI half of the P1 "add item to cart from dashboard" story (FR-08)
> Depends on: Phase 4 (backend route)
> Testing note: `--tdd` not yet confirmed — written for default flow; this phase is primarily manual/UI verification.

## Requirements
Staff viewing a human-controlled session's cart panel can search for a menu item, choose it (with quantity and variant if applicable), and add it to the cart with one click — and this control is hidden entirely for sessions that aren't currently human-controlled.

## Steps
1. Add an item search/select control and an "add to cart" button inline in the existing cart panel, following the panel's current layout and styling conventions.
2. Show this control only when the currently selected session is human-controlled, mirroring how the existing composer and take-over/hand-back controls already conditionally show based on control mode.
3. Wire the "add" action to call the new backend route from Phase 4, and refresh the cart display from the next dashboard snapshot once it succeeds.
4. Surface a clear, visible message if the add attempt is rejected (e.g. the session stopped being human-controlled between page load and the click), instead of failing silently.
5. Add the necessary VI/EN copy for the new control's labels and messages, consistent with the dashboard's existing language-toggle setup.
6. Manually verify the control disappears immediately (on next poll) if a session is handed back to the bot mid-view.

## Success Criteria
- On a human-controlled session, staff can search for an item, select it, and add it to the cart, with the change visible in the cart panel right after.
- On a bot-controlled session, no add-item control is visible in the cart panel at all.
- If an add attempt is rejected by the backend, the staff member sees a clear error rather than a silent failure.
- New UI text renders correctly in both Vietnamese and English via the existing language toggle.

## Risks
- A staff member could have the add-item control open in a stale view right as another staff member (or the customer) hands the session back to the bot — the client-side visibility check alone can't prevent this, which is exactly why Phase 4's server-side rejection exists as the real enforcement. Mitigation: Step 4 ensures this failure mode surfaces a clear message instead of looking broken.
- Without a dedicated menu browse experience elsewhere in the dashboard, the item search/select control introduced here is the first of its kind — keep it minimal (search + pick + quantity) rather than expanding scope into a full catalog browser.
