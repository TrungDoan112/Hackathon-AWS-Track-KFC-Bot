# Phase 3: Shared Human-Controlled Guard

> Covers: FR-07b (refactor existing control-mode checks onto one shared primitive, ahead of the new cart-edit route needing the same check).
> Testing note: `--tdd` not yet confirmed — written for default flow. This phase is a pure refactor of existing, already-tested behavior; regression coverage of the 3 existing call sites matters more here than new-feature tests.

## Requirements
All places in the codebase that need to know whether a session is currently human-controlled read that state through one shared, single source of truth — eliminating the duplicated inline checks — while preserving each caller's existing response behavior exactly (soft-mute for the bot's own generation checks, hard-reject for staff-facing routes).

## Steps
1. Introduce one shared way to read a session's human-controlled state, living alongside the existing control-mode read/write logic rather than as a new, separate module.
2. Keep the two existing response behaviors distinct: the bot's own reply-generation checks should still quietly skip/drop when a session is human-controlled (no error surfaced to the customer), while staff-facing routes should still reject outright when a session is NOT human-controlled.
3. Update both of the bot's existing generation-time checks (before starting to generate, and again right before sending) to read through the new shared primitive instead of checking the raw field inline.
4. Update the existing staff message-sending route's check to also read through the shared primitive instead of its own inline check.
5. Confirm the previously existing behavior is unchanged for all three of these call sites — same errors, same status codes, same customer-facing outcomes as before the refactor — before this phase is considered done.

## Success Criteria
- The bot still declines to reply (softly, no customer-facing error) when a session is human-controlled, verified against both the pre-generation and pre-send checks.
- The staff message-sending route still rejects with the same error and status code as before when the target session is not human-controlled.
- No caller duplicates the raw control-mode check anymore — all reads go through the one shared primitive.

## Risks
- This refactor touches live, working handoff behavior (take-over/hand-back/composer) shipped in a prior feature; a mistake here risks reintroducing the race condition that feature specifically fixed (a bot reply reaching a customer after hand-off). Mitigation: no new logic is added in this phase beyond the refactor itself, and existing handoff manual-verification steps are re-run before moving to Phase 4.
- Because this phase has no new observable feature (it's an internal refactor), it can look "done" without adequately re-verifying the 3 existing call sites — mitigation is Step 5 being a required, explicit check rather than assumed from passing an automated suite alone.
