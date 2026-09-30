# Brainstorm: Dashboard language toggle + human handoff in chat

**Date:** 2026-07-12

## Ideas Explored

- **Language scope — dashboard-only vs full bot**: Considered whether EN/VI should also apply to bot replies sent to customers over Zalo. Dismissed for now — bot replies are a separate, much larger surface (agent prompts, per-session locale, customer-facing risk) and the user only needs this for internal staff viewing the dashboard.
- **Handoff trigger — manual vs auto-detect vs hybrid**: Considered having the bot self-detect "bad" situations (repeated failures, angry customer) and auto-suggest handoff. Dismissed for v1 — requires modifying `kfc-agent.js` detection logic, unproven without usage data. Manual "Tiếp quản" (take over) button chosen as the simpler, more controllable starting point. Auto-suggest noted as a natural P2/future addition once the manual flow proves out.
- **Bot behavior during handoff — silent vs shadow-run-with-approval**: Considered letting the bot keep generating replies in the background for staff to approve/edit before sending. Dismissed — adds an approval queue UI and reply-conflict handling neither requested nor currently supported by the read-only dashboard. Full mute (bot fully disabled per session until handed back) chosen for clarity and to avoid bot/human reply collisions.
- **i18n implementation approach** (not yet decided, flagged for /ck:plan): no i18n library exists in the repo today; all dashboard copy is hardcoded Vietnamese literals in `public/index.html` / `public/dashboard.js`. Planning phase needs to pick a lightweight approach (e.g. JSON string table + a render-time swap) appropriate for a vanilla JS, no-build-step frontend.

## User's Direction

- Language toggle: **dashboard UI only** (staff/admin-facing), not the bot's customer-facing replies over Zalo.
- Handoff: **staff-triggered**, via a "Tiếp quản" (take over) button on the dashboard.
- Staff **reply directly from the dashboard** — this requires adding a message composer, which doesn't currently exist (dashboard is read-only today).
- While a session is taken over, the **bot is fully silenced** for that session until staff explicitly hands control back.

## Open Questions

- How is the EN/VI preference persisted — per-browser (`localStorage`) is the natural default for this single-tenant, unauthenticated dashboard, but not explicitly confirmed.
- Data model for human-sent messages: new `role` value (e.g. `human_agent`) vs. reusing `assistant` role with a separate flag — left for `/ck:plan` to decide against `src/infrastructure/store.js`.
- No auth exists anywhere in this app today (single-tenant demo). Handoff introduces a "someone is now typing as the business" surface — worth a deliberate call in planning on whether this ships without auth (matches current app posture) or needs a minimal safeguard.

## Risks

- **No existing i18n scaffolding** — building it from scratch on a hardcoded-string, no-build-step frontend risks missed strings / inconsistent coverage if not done systematically (e.g. a full sweep of `index.html`/`dashboard.js`).
- **Bot/human collision** — even with "full mute" chosen, the take-over/hand-back transition needs to be race-safe (e.g. a bot reply already in-flight via SSE when staff clicks "Tiếp quản") or customers could receive a bot message after a human already started responding.
- **Unauthenticated composer** — anyone who can load the dashboard URL can now send messages as the business to a live customer session; low risk in current single-tenant demo context but worth flagging explicitly rather than silently inheriting.
