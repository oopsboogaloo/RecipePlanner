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

## Deploy from GitHub (no computer needed)

The app runs on Cloudflare's free tier; GitHub does the deploying. Every
change merged to `main` is deployed by the **Deploy** workflow, which also
creates the database the first time.

One-off setup, all possible from a phone or tablet browser:

1. **Cloudflare account** — sign up at dash.cloudflare.com. Open **Workers &
   Pages** once so the account gets its `workers.dev` address. Copy the
   **Account ID** shown there.
2. **Cloudflare API token** — My Profile → API Tokens → Create Token → start
   from the **Edit Cloudflare Workers** template, add the permission
   **Account → D1 → Edit**, limit it to your account, and create it. Copy the
   token (it is shown once).
3. **App secret** — make up a long random string of letters and digits (30 or
   more characters). This becomes part of the app's address.
4. **GitHub secrets** — in this repository: Settings → Secrets and variables →
   Actions → New repository secret. Add three:
   `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `APP_SECRET`.
5. **Deploy** — merge to `main` (or Actions → Deploy → Run workflow). The run's
   summary shows the Worker address.
6. On the phone open `https://<worker address>/a/<APP_SECRET>/` and use the
   browser menu → **Add to Home screen**.

To deploy from a computer instead: `npx wrangler login`,
`npx wrangler d1 create recipeplanner` (put the id in `wrangler.jsonc`),
`npm run deploy`, then `npx wrangler secret put APP_SECRET`.

Anyone with that link can see and change the recipes, so treat it like a
password. To change it, update the `APP_SECRET` repository secret and run the Deploy workflow again.

## Connect Claude

In Claude: **Settings → Connectors → Add custom connector**, with

- URL: `https://<worker address>/mcp/<APP_SECRET>`
- Authentication: **No sign in**

Then ask, for example, "Create a Christmas roast recipe for eight with a 5 kg
turkey in RecipePlanner", or "Load this Planthood recipe: <link>".
