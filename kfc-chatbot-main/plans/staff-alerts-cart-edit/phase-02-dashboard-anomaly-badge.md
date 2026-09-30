# Phase 2: Dashboard Anomaly Badge

> Covers: visibility half of all three P1 anomaly stories (FR-05); the P2 "auto-clear badge on view" story is explicitly deferred, not built in this phase.
> Testing note: `--tdd` not yet confirmed — written for default flow; note what should be covered rather than prescribing a test-first sequence.

## Requirements
Any session with at least one unresolved anomaly (oversized cart, bot stuck, or sensitive keyword) shows a clearly distinguishable badge in the dashboard's session list, visible without opening the session, and reflected within one poll cycle of the anomaly being recorded.

## Steps
1. Extend the dashboard's session list read to also report whether each session has at least one anomaly event recorded, alongside the existing per-session counts it already returns.
2. Add a distinct visual badge to each session row in the dashboard session list that appears only for sessions with an anomaly, without disrupting the existing layout or the human-controlled indicator already shown there.
3. Confirm the badge shows up within the dashboard's normal poll cycle after an anomaly is recorded — no manual refresh needed.
4. Explicitly leave the badge showing regardless of whether staff have opened the session — auto-clearing on view is a P2 story and out of scope for this phase; note this in the UI/behavior so it isn't mistaken for a bug.
5. Spot-check that sessions with multiple different anomaly types still show a single, unambiguous badge (not one badge per anomaly type cluttering the row).

## Success Criteria
- A session that triggers any of the three anomaly checks shows the badge in the session list within one dashboard poll cycle, without needing the session to be opened.
- A session with no anomalies shows no badge.
- The badge is visually distinguishable at a glance from the existing human-controlled and status badges already on the session row.

## Risks
- Computing anomaly presence per session on every dashboard poll adds a subquery per session row — acceptable at this app's scale (single-tenant demo), but worth a quick sanity check that poll latency stays unaffected with a realistic number of sessions.
- Skipping badge auto-clear (P2) means a resolved anomaly stays flagged indefinitely until this is revisited — accepted per spec Out of Scope; flagged here for future planning.
