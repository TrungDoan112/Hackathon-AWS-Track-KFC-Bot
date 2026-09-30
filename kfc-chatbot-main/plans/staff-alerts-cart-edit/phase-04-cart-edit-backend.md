# Phase 4: Staff Cart-Edit Backend Route

> Covers: backend half of the P1 "add item to cart from dashboard" story (FR-06, FR-07)
> Depends on: Phase 3 (shared human-controlled guard)
> Testing note: `--tdd` not yet confirmed — written for default flow; note what should be covered.

## Requirements
Staff who have taken over a session can add a menu item (with quantity and any variant) to that session's cart through a new dashboard-facing route, which uses the exact same cart-mutation path the bot's own ordering tool already uses, and is rejected outright if the session isn't currently human-controlled.

## Steps
1. Add a new staff-facing route that accepts a session, a chosen menu item, a variant if applicable, and a quantity.
2. Before making any change, check the session is human-controlled using the shared guard from Phase 3; reject the request immediately (with a clear, distinct error) if it isn't.
3. Route the accepted request through the exact same cart-update path the bot's ordering tool already uses, rather than writing any new cart-mutation logic.
4. Add a small, session-independent way to look up the menu catalog (item names, prices, variants) so the new route — and the picker UI in Phase 5 — can validate and display item choices without depending on an active chat session.
5. Confirm the resulting cart change shows up in the next dashboard snapshot exactly like any other cart update would.
6. Confirm a direct call to the new route against a session that is NOT human-controlled is rejected with a clear error, independent of any UI gating.

## Success Criteria
- Adding an item to a human-controlled session's cart via the new route updates that session's cart, visible in the next dashboard snapshot.
- The same request against a session that is not human-controlled is rejected with a distinct, clear error — verified by calling the route directly, not just through the UI.
- No new cart-calculation logic exists outside the route calling the existing cart-update path — totals, discounts, and item counts stay computed exactly the way they already are for bot-driven cart changes.

## Risks
- If the new route bypasses the shared guard (e.g. checks control mode with its own inline logic instead of Phase 3's primitive), the duplicated-check problem FR-07b exists to eliminate would just move rather than disappear. Mitigation: Step 2 explicitly requires using the Phase 3 primitive, and this is checked before Phase 4 is considered complete.
- Reusing the existing cart-update path means any of its existing validation errors (invalid quantity, missing product, submitted/locked cart) now also surface through this new route — acceptable and expected, but the route's error responses should stay consistent with the rest of the API's error shape rather than leaking a different format.
