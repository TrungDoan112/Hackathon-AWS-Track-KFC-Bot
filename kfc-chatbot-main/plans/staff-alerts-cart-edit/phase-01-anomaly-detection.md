# Phase 1: Anomaly Detection

> Covers: P1 stories "oversized cart flag", "bot stuck flag", "sensitive keyword flag" (FR-01, FR-02, FR-03, FR-04)
> Testing note: `--tdd` has not been confirmed for this plan yet — this phase is written for default (implementation-first, tests-after) flow. If the user opts into `--tdd` before `/ck:cook` starts, tests for the three checks below should be written before the implementation instead.

## Requirements
The system automatically detects three anomaly conditions — an oversized cart, a bot repeating itself, and a customer using sensitive/complaint language — and records each occurrence as an activity event the moment it happens, with no extra round-trips or noticeable delay to the bot's reply.

## Steps
1. Decide and document what "more than 10 items" means for a cart (total quantity across all lines, not distinct products) so the oversized-cart check has one unambiguous definition.
2. When a cart is updated, check the newly recalculated totals against the oversized-cart thresholds (more than 10 items, or more than 1,000,000₫) and record an anomaly event if either is exceeded.
3. Build a small, reusable list of sensitive VI/EN keywords and phrases (complaint, legal threat, fraud, food-safety, and abuse language) that can be matched against normalized message text.
4. When a customer message comes in, check it against the sensitive-keyword list using the same case/diacritic-insensitive normalization already used for menu search — but match whole tokens/phrases (split normalized text on spaces and compare token sequences), not a raw substring `.includes()` check. A raw substring check produces false positives: the keyword "bẩn" normalizes to "ban", which is a substring of "banh trung" (menu item "Bánh Trứng"). Record an anomaly event only on a whole-token match. Before shipping, spot-check the starter keyword list against actual `kfc_menu.json` item names to catch any remaining collisions.
5. When a bot reply is saved, compare it to the immediately preceding bot reply in the same session; if they're an exact match, record a "bot stuck" anomaly event.
6. Before inserting any of the three anomaly event types, check whether an unresolved event of that same type already exists for the session (a `NOT EXISTS` check against `activity_events`, mirroring the badge query's own `EXISTS` shape in Phase 2) — skip the insert if one does. This prevents a persistently oversized cart or a genuinely looping bot from spamming a new duplicate row on every subsequent update/message.
7. Make sure all three checks happen as part of the same save operation they're attached to (cart update, message save) rather than as separate follow-up calls, so nothing can save without a check running and nothing adds a network round-trip.
8. Verify each of the three checks produces a distinct, identifiable activity event so the dashboard (Phase 2) can tell them apart.

## Success Criteria
- Updating a cart to more than 10 total items, or a total exceeding 1,000,000₫, produces exactly one new anomaly-type activity event for that session, and repeated updates while still over threshold produce no further duplicates.
- Two consecutive, exactly-matching bot replies in the same session produce one "bot stuck" anomaly event; non-matching consecutive replies produce none; further consecutive matches (a genuine loop) produce no further duplicates while the prior event is unresolved.
- A customer message containing a configured sensitive keyword (in Vietnamese or English, regardless of diacritics/case) produces a "sensitive keyword" anomaly event when matched as a whole token/phrase; a message with none of the keywords, or one that only contains a keyword as a substring of an unrelated word (e.g. a menu item name), produces none.
- None of the three checks measurably slow down cart updates or message saves — they run in the same transaction/call as the existing write, no new external calls.

## Risks
- Ambiguity in "10 items" (line count vs total quantity) could produce a definition mismatch with staff expectations — resolved explicitly in Step 1 and documented in code so it isn't silently reinterpreted later.
- The exact-match bot-stuck check will miss near-duplicates that differ by a trailing character — accepted per spec (no fuzzy matching in scope for this iteration).
- A starter keyword list can't cover every real complaint phrasing — accepted as good-enough per spec Assumptions; the list is easy to extend later since it's plain data.
- Raw substring keyword matching would false-positive against real menu item names (e.g. "bẩn" → "ban" is a substring of "Bánh Trứng" → "banh trung") — fixed by requiring whole-token/phrase matching in Step 4, not accepted as residual risk.
- Without the dedup check in Step 6, a persistently oversized cart or looping bot would spam duplicate anomaly rows indefinitely — fixed by the `NOT EXISTS`-gated insert, not accepted as residual risk.
