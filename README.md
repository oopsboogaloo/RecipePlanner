# RecipePlanner

Plan a complex cook (a Christmas roast, say) as tasks timed back from serving,
then press Start and be told what to do and when. Phone-first, works folded
and unfolded on a Galaxy Fold, and a Claude chat can create and edit recipes
through a connector.

- [SPEC.md](SPEC.md) — what it does
- [PLAN.md](PLAN.md) — how it is built and what is left

## Run it locally

```sh
npm install
echo "APP_SECRET=local-dev-secret-0123456789" > .dev.vars
npm run dev
```

Open `http://localhost:8787/a/local-dev-secret-0123456789/`.

## Check it

```sh
npm test          # core logic, API and connector
npm run typecheck
npm run e2e       # drives the app in Chromium at folded and unfolded sizes
```

`npm run e2e` needs Playwright with Chromium available on the machine.
Screenshots are written to `e2e/shots/`.

## Deploy (Cloudflare, free tier)

Needs a Cloudflare account and a computer with Node.js.

1. `npx wrangler login`
2. `npx wrangler d1 create recipeplanner`, then put the printed
   `database_id` into `wrangler.jsonc`.
3. `npm run deploy` — note the `https://recipeplanner.<you>.workers.dev` address.
4. Choose a long random secret (for example `openssl rand -hex 24`) and store
   it: `npx wrangler secret put APP_SECRET`.
5. On the phone open `https://recipeplanner.<you>.workers.dev/a/<secret>/`
   and use the browser menu → **Add to Home screen**.

Anyone with that link can see and change the recipes, so treat it like a
password. To change it, repeat step 4 with a new value.

## Connect Claude

In Claude: **Settings → Connectors → Add custom connector**, with

- URL: `https://recipeplanner.<you>.workers.dev/mcp/<secret>`
- Authentication: **No sign in**

Then ask, for example, "Create a Christmas roast recipe for eight with a 5 kg
turkey in RecipePlanner", or "Load this Planthood recipe: <link>".
