# Phase 2: Handoff backend routes and human message delivery

Testing: standard

Covers spec story: P1 "message composer sends via Zalo and is attributed correctly" (FR-07), plus the backend half of "take over"/"hand back" actions (FR-05, FR-08) and part of the transcript distinction requirement (FR-09). Depends on Phase 1's control-mode and zalo_chat_id groundwork.

## Requirements
Staff can trigger take-over and hand-back for a specific session through the API, and can send a message that is delivered to the customer over the existing Zalo channel and recorded in that session's transcript as a human-sent message, distinct from bot and customer messages.

## Steps
1. Add an endpoint that flips a session to human-controlled, following the same request/response conventions as the existing dashboard endpoints (uses Phase 1's idempotent store method, so repeat calls are safe).
2. Add an endpoint that flips a session back to bot-controlled, same conventions.
3. Add an endpoint that accepts a staff-typed message for a session, sends it to the customer through the existing Zalo outbound delivery used by the bot, and only proceeds if the session actually has a Zalo address on file and is currently human-controlled. Validate the message body with the same length/emptiness bounds already used for the existing `/api/chat` endpoint's message field (trim, min 1, max 4000 chars) — reject anything outside that range before attempting delivery.
4. Record every staff-sent message in the session's message history under the new human-sender label, and log a corresponding activity event that's clearly distinguishable from bot or customer activity.
5. Handle and surface clear error responses for the edge cases: sending while the session is still bot-controlled, sending to a session with no Zalo address, and the underlying Zalo delivery failing. Error responses use the existing `{ error: { code, message } }` convention with a sanitized message — never forward raw upstream Zalo API error bodies or Node stack traces to the client, since this endpoint is unauthenticated and reachable cross-origin (the app enables permissive CORS).
6. Note the composer send endpoint has no dedup protection against a double-click or client-side retry sending the same message twice (unlike the Zalo ingress path, which dedupes on `external_id`). Mitigate at minimum by disabling the send button client-side until the request resolves (implemented in Phase 3); accept residual risk of a rare duplicate send as low-severity given this is a human-in-the-loop, low-volume action.
7. Manually verify end-to-end: take over a real (or test) Zalo session, send a composer message, confirm it arrives on the Zalo side and appears correctly attributed in the snapshot data, then hand back and confirm bot replies resume. Also verify an over-length or empty composer message is rejected with a clear error and not sent.

## Success Criteria
- Take-over and hand-back requests update the session's control state and are reflected in the next dashboard snapshot read.
- A staff-sent message reaches the customer via Zalo and is stored with a role distinct from customer and bot messages.
- Sending a message to a bot-controlled session, or to a session without a Zalo address, is rejected with a clear error rather than silently failing or crashing.
- Hand-back immediately re-enables normal bot auto-replies for that session with no restart required.

## Risks
- Sending to a session with no stored Zalo address: mitigated by an explicit precondition check in the send endpoint (Step 3/5) that returns a clear error instead of attempting a doomed API call.
- Zalo API failures (network, rate limit) during a human send: mitigated by surfacing a sanitized version of the existing Zalo client's error/retry behavior through the endpoint's error response (not raw upstream errors) rather than swallowing it, so staff know the message didn't go out.
- Double-guard from Phase 1 and this phase's endpoints must agree on what "human-controlled" means: mitigated by having both read/write through the same store methods added in Phase 1, no parallel state tracking.
- These are unauthenticated, cross-origin-reachable, mutating endpoints that can send arbitrary text to a real customer's Zalo account — a materially larger blast radius than the app's prior no-auth read/order-taking endpoints. Accepted per spec's explicit "auth out of scope" decision; flagged here for conscious stakeholder awareness rather than silent inheritance of the existing no-auth posture.
- Composer send has no server-side dedup against double-submit/retry: mitigated client-side only (Step 6/Phase 3); accepted as low-severity residual risk.
