# GavelHawk

Chrome MV3 extension for GovDeals. Plain JS, no build step; load unpacked from the repo root.

Start every session by reading `HANDOFF.md`: it has the current state, blockers and numbered next steps.
When you finish a round of work, update `HANDOFF.md` (move done items to Completed, drop resolved blockers) and push.

- All GovDeals page-layout knowledge belongs in `src/content/selectors.js`. Don't scatter selectors elsewhere.
- Home ZIP / travel radius / costs are defaults in `src/shared/cost.js` and must stay user-editable in Settings.
- Never place a real bid the owner hasn't approved.
