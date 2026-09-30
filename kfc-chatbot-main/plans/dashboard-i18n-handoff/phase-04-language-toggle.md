# Phase 4: Dashboard VI/EN language toggle

Testing: standard

Covers spec story: P1 "toggle the dashboard UI between Vietnamese and English" (FR-01, FR-02, FR-03) and the associated NFR (<200ms, no network round-trip). This phase is independent of Phases 1-3 and touches only dashboard-facing frontend files — it does not touch bot or customer-facing text.

## Requirements
Staff can switch the dashboard between Vietnamese and English with a single click; every visible label, status, button, and empty-state message updates immediately without a page reload, and the chosen language is remembered the next time the dashboard is opened in the same browser.

## Steps
1. Build a single local string table covering both languages for every piece of static and dynamically rendered dashboard copy (headers, buttons, statuses, empty states, toasts) — including any new copy introduced by Phase 3's handoff UI.
2. Mark up the static HTML so every translatable piece of text is tagged for language swapping, replacing hardcoded Vietnamese strings.
3. Update the dashboard's dynamic rendering code (session list, cart, orders, activity, messages, and Phase 3's control-mode/composer UI) to pull labels from the string table instead of hardcoding Vietnamese.
4. Add a language toggle control to the dashboard header and a render pass that re-applies the current language to the whole page on toggle click and on initial page load.
5. Persist the selected language in the browser and read it back on load so the choice survives a full page reload, defaulting to Vietnamese if nothing is stored.
6. Confirm nothing here touches bot-generated replies or any customer-facing Zalo text — those remain Vietnamese-only regardless of dashboard language.
7. Manually verify: toggle language and confirm every visible dashboard string changes with no leftover mixed-language text, reload the page and confirm the choice persists, and time the toggle to confirm it feels instant.

## Success Criteria
- Every visible dashboard string (headers, buttons, statuses, empty states) renders correctly in both Vietnamese and English with no mixed-language leftovers.
- The language choice persists across a full page reload in the same browser.
- The toggle updates all visible text in under 200ms with no network request involved.
- Bot-generated replies and any Zalo-facing text remain unaffected and stay Vietnamese-only.

## Risks
- New copy from Phase 3 (composer, take-over/hand-back buttons, control-mode badges) could be missed if this phase isn't sequenced or reviewed against Phase 3's final markup. Mitigation: Step 1 explicitly includes a pass over Phase 3's additions before considering the string table complete.
- Dynamically generated content that embeds data (e.g. "X tin nhắn" counts, timestamps) needs template-level translation, not just static swapping. Mitigation: string table stores phrase templates with placeholders, exercised by Step 3.
- Risk of scope creep into translating order/activity data itself (product names, customer-facing content): explicitly out of scope per spec; only chrome/UI copy is translated, not underlying business data.
