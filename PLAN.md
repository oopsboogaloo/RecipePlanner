# RecipePlanner — Build plan

Implements [SPEC.md](SPEC.md). One repository, one deployable Cloudflare Worker.

## Stack

- **Language:** TypeScript throughout.
- **Server:** Cloudflare Worker — JSON API, MCP endpoint, Planthood fetcher,
  static asset serving. Storage in D1 (tables created on first use).
- **Web app:** Preact + Vite single-page app, hand-written CSS, installable
  (manifest + service worker).
- **Shared core:** pure functions for validation, timing, cook state and
  Planthood parsing, used by server and web app alike, so the phone can run a
  cook offline with exactly the server's rules.
- **Tests:** Vitest for the shared core and the API/MCP handlers; Playwright
  for the UI at Galaxy Fold folded and unfolded sizes.

## Layout

```
src/shared/   types, validate, timing, cook (reducer), planthood, example
src/worker/   index (routing + auth), store (D1), service, api, mcp
src/web/      main, store (local state + sync), alerts, screens, styles
test/         unit and handler tests
e2e/          Playwright UI checks
```

## Key design points

- **Access:** `APP_SECRET` Worker secret. App at `/a/<secret>/`, API at
  `/a/<secret>/api/*`, connector at `/mcp/<secret>`. Anything else is a 404.
- **Recipes sync:** whole-recipe save, last write wins; the phone keeps a
  local copy and re-sends unsaved changes when back online.
- **Cook sync:** the phone sends small operations (tick, undo, delay, extend,
  finish). The same reducer applies them locally at once and on the server
  when it is reachable. Claude's edits change the task list and serve time
  but never tick state.
- **Timers:** always derived from absolute timestamps; a 1-second render
  tick only redraws.
- **MCP:** stateless handler using the official MCP TypeScript SDK's
  web-standard HTTP transport; tools call the same service layer as the API.

## Milestones

1. **Core** — types, validation, timing, cook reducer, Christmas roast
   example, Planthood parser; unit tests.
2. **Server** — D1 store, service layer, JSON API, secret-path auth,
   Planthood fetcher; handler tests.
3. **Connector** — MCP tools from SPEC §8 plus `fetch_planthood_recipe`;
   tested with a real MCP client against the local Worker.
4. **Web app: plan** — home, recipe editor, task sheet, Planthood import,
   narrow and wide layouts.
5. **Web app: cook** — start flow, live cook screen, tick/undo, timers,
   delay, alerts (sound, vibration, banner, repeat), wake lock, offline queue.
6. **Install + polish** — manifest, service worker, dark/light themes,
   Fold layout checks, acceptance criteria run-through.
7. **Deploy** — README with deployment steps; needs the owner's Cloudflare
   account (create D1 database, set `APP_SECRET`, deploy, add the connector
   in Claude). Cannot be done from the build session.

## Verification

- `npm test` — unit and handler tests.
- `npm run e2e` — builds, runs the Worker locally, drives the UI in Chromium
  at 344×882 (folded) and 690×829 (unfolded) and checks the acceptance
  criteria that can be automated (1–3, 5, 7, 8 and the MCP half of 6).
- Not automatable here: real sound/vibration on the phone, wake lock, and
  the live Claude connector — to be checked on the device after deployment.

## Status

- [x] Specification merged to `main`
- [x] 1 Core — 22 unit tests
- [x] 2 Server — API, storage, Planthood fetcher
- [x] 3 Connector — 13 tools, tested with an MCP client and over HTTP
- [x] 4 Web app: plan — home, editor, task/dish sheets, Planthood import
- [x] 5 Web app: cook — start flow, live screen, timers, delay, alerts,
      offline queue
- [ ] 6 Install + polish — manifest and service worker are written but not
      yet exercised by a test; dark theme not yet reviewed on screen;
      half-folded "tabletop" layout (optional in the spec) not started
- [ ] 7 Deploy — GitHub Actions workflow added (CI on pull requests, deploy
      on `main`); not yet run against a real Cloudflare account. Owner adds
      three repository secrets (README.md)

### Still to verify on the real phone

- Sound volume and vibration pattern in a noisy kitchen.
- Screen staying awake for a multi-hour cook.
- Layout breakpoint (600 px) against the Fold's real folded/unfolded widths.
- The connector from an actual Claude chat.
- Planthood import from the deployed Worker (the local test Worker could not
  reach the internet; the parser was checked against one real recipe).
