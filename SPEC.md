# RecipePlanner — Specification (v1)

A phone-first web tool for planning and running a complex, multi-dish cook
(e.g. a Christmas roast). You build a timed plan ahead of the day, press Start
when you begin, and the app tells you what to do and when, with alerts and
tick-off. A Claude chat can create and alter recipes through a connector.

## 1. Decisions taken

| Area | Decision |
|---|---|
| Claude integration | Hosted app with an MCP connector; any Claude chat can read/create/edit recipes |
| Timing model | Tasks are planned as "minutes before serving". At cook time: **Start now** or **Set serve time** |
| Alerts | Sound + on-screen flash (+ vibration where supported), screen kept awake. No push notifications |
| Users / devices | One user, one phone |
| Running late | A Delay button shifts all remaining tasks and the serve time together |
| Task content | Title, time, optional duration with end alert, notes, dish grouping |
| Planthood | Recipes can be loaded from a Planthood recipe link, in the app or by Claude |
| Hosting / access | Single Cloudflare Worker (free tier), access by secret link; no login screen |

## 2. Concepts

- **Recipe** — a reusable plan: a name, a set of dishes, and a list of tasks.
  Contains no absolute times.
- **Dish** — a label with a colour (Turkey, Potatoes, Gravy). Every task
  belongs to one dish, or to "General".
- **Task** — one thing to do, timed relative to serving.
- **Cook** — one run of a recipe. Created when you press Start; it takes a
  *copy* of the recipe and pins it to real clock times. At most one cook is
  active at a time.

## 3. Data model

```
Recipe
  id, name, description?, updatedAt
  source?:   { kind: "planthood", url, title, importedAt }
  dishes[]:  id, name, colour
  tasks[]:   id, title, dishId?,
             startOffsetMin   // minutes BEFORE serve that the task starts (>= 0)
             durationMin?     // if set, the task runs as a timer and has an end alert
             notes?           // free text: temps, quantities, method

Cook
  id, recipeId, recipeSnapshot (dishes + tasks, editable during the cook)
  startedAt, serveAt          // absolute timestamps
  status: active | finished | abandoned
  taskState{taskId}:  status: pending | running | done
                      startedAt?, endsAt?, doneAt?
```

Derived, never stored: a pending task's due time is
`serveAt − startOffsetMin`. All countdowns are computed from absolute
timestamps, so they are correct after a refresh, a closed tab or a phone restart.

## 4. Timing rules

- **Starting a cook**
  - *Start now*: `serveAt = now + (largest startOffsetMin)`. The app shows
    "Dinner at 15:10" before you confirm.
  - *Set serve time*: you pick a time; the app shows "Start at 10:40". If that
    is already in the past, it says which tasks are already overdue and offers
    to move serve time to the earliest possible.
  - Before the first task is due, the cook screen shows a countdown to it.
- **Task lifecycle**
  - No duration: `pending → done` on tick.
  - With duration: `pending → running` on tick (timer starts from the moment
    you tick, not from the planned time), then an end alert at `endsAt`, then
    `done` on a second tick. A running timer has its own `+1 / +5 min` control.
- **Delay**: `+5` / `+15` / custom minutes adds to `serveAt`, which moves every
  *pending* task. Running timers and done tasks are untouched. A negative
  delay ("catch up") is allowed down to the point no pending task would
  become overdue.
- **Overdue**: a pending task past its due time stays at the top, marked
  overdue with how late it is, until ticked or delayed.
- **Undo**: any tick can be undone for 10 seconds via a toast, and from the
  task's detail sheet afterwards.

## 5. Screens

Three screens, bottom-reachable controls, minimum 48 px touch targets,
readable at arm's length, light and dark themes, no login.

### 5.1 Recipes (home)
- List of recipes: name, number of tasks, total length ("4 h 30 m").
- If a cook is active: a prominent "Cooking now — next: Potatoes on in 12 min"
  banner that returns to the Cook screen.
- Actions: New recipe, Import from Planthood, open, duplicate, delete (with
  confirm).

### 5.2 Recipe editor
- Name, description, dishes (name + colour).
- Tasks shown as a timeline sorted by time, each row: time before serve
  ("−1 h 30"), dish colour, title, duration if any.
- Add/edit a task in a bottom sheet: title, dish, "starts ___ before
  serving" (hours/minutes steppers, not a free-text field), optional
  duration, notes.
- A task with a duration also shows when it ends ("ends −0:45"), so overlaps
  such as oven clashes are visible.
- Autosaves every change; no Save button to forget.
- **Start cooking** button → choice of *Start now* / *Set serve time* →
  confirmation showing start and serve times.

### 5.3 Cook (live)
- Header: current clock time, serve time, Delay button.
- **Now** section: tasks that are due or overdue, and running timers with
  live countdowns. Large cards, one-tap tick.
- **Next up** section: upcoming tasks in order with real clock time and
  "in 12 min".
- **Done** section: collapsed by default.
- Tap a task for its notes; long-press or the sheet to undo/skip.
- Ending: when all tasks are done, or via "Finish cook" (confirm).
  "Abandon cook" is available in a menu (confirm).

## 6. Alerts

- Fired when a task becomes due and when a running task's timer ends.
- Each alert: a distinct sound (different for "start" and "finish"), a
  full-width flashing banner naming the task, vibration where available, and
  the page title updated.
- The alert **repeats every 30 s until acknowledged** (ticking the task, or
  "Got it").
- A 2-minute "coming up" heads-up (soft chime, no repeat) precedes each
  task; can be turned off.
- The screen is kept awake for the whole active cook using the Screen Wake
  Lock API, re-acquired whenever the page becomes visible again.
- Sound is unlocked by the tap on Start cooking. If the page is reloaded
  mid-cook, a "Tap to enable sound" bar appears until tapped.

### Platform constraints (checked November 2026)
- Wake Lock works in Safari on iOS 16.4+, but in an app added to the home
  screen only from iOS 18.4 ([caniuse](https://caniuse.com/wake-lock),
  [WebKit bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545)).
- `navigator.vibrate` is not implemented in Safari/iOS; vibration is
  Android-only and the design must not depend on it
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/vibrate),
  [W3C implementation report](https://w3c.github.io/vibration/reports/implementation.html)).
- iOS will not play Web Audio until a user gesture has occurred
  ([WebKit bug 149367](https://bugs.webkit.org/show_bug.cgi?id=149367)).
- **Known limitation of v1:** if the phone is locked or another app is in
  front, no alert is delivered. On return, the app immediately shows and
  sounds anything missed. Push notifications are a possible v2.

## 7. State and persistence

- The server is the source of truth for recipes and the active cook, so
  Claude can see and change both.
- The phone keeps a local copy (localStorage/IndexedDB) and runs all timers
  locally, so a cook keeps working through a Wi-Fi drop. Changes made offline
  are queued and sent when the connection returns.
- The phone re-fetches when the page becomes visible and every 30 s during
  a cook, so edits made by Claude appear without a manual refresh, with a
  brief "Recipe updated" notice.
- Conflict rule: last write wins per task; tick state from the phone is never
  overwritten by a recipe edit.

## 8. Claude connector (MCP)

A remote MCP endpoint on the same Worker, added once in Claude as a custom
connector. Custom connectors work in claude.ai and the mobile apps and must
be reachable over the public internet; "No sign in" is a supported
authentication setting
([Anthropic: custom connectors using remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)).

Tools:

| Tool | Purpose |
|---|---|
| `list_recipes` | Names, ids, task counts, durations |
| `get_recipe` | Full recipe |
| `create_recipe` | Create from name, dishes and tasks in one call |
| `update_recipe` | Change name, description, dishes |
| `add_tasks` / `update_task` / `delete_task` | Edit tasks; times given as minutes before serve |
| `shift_tasks` | Move a dish's tasks (or all) earlier/later by N minutes |
| `duplicate_recipe` / `delete_recipe` | Housekeeping |
| `fetch_planthood_recipe` | Given a Planthood link, return its title and step text for Claude to turn into a timed recipe |
| `get_active_cook` | Live status: serve time, what is due, running, done |
| `update_active_cook` | Edit tasks of the live cook, or delay it by N minutes |

Rules:
- Every tool validates input and returns plain-language errors (e.g. "task
  'Roast potatoes' ends after serving").
- Tool results include a human-readable timeline so Claude can read it back.
- Claude cannot start, finish or abandon a cook, and cannot tick tasks; those
  stay with the person in the kitchen.
- `delete_recipe` is refused while that recipe has an active cook.

## 9. Planthood import

Planthood publishes its cooking instructions at `recipes.planthood.co.uk`
([Planthood help: preparing your meals](https://planthood.gorgias.help/en-GB/how-to-prepare-your-meals-493357)).

### What the source looks like (checked November 2026, 5 recipes from one menu)
- The site is a public Shopify store; no login is needed. Each recipe is a
  product, and the store's standard JSON view of a product or menu collection
  returns the title and the method as HTML.
- The method is a short intro line followed by "STEP 1", "STEP 2"... blocks
  of free text. Step headings are not marked up consistently (some are
  headings, some plain text).
- **There are no structured timings.** Durations and oven temperatures only
  appear inside the prose ("roast in the oven for 15 minutes", "simmer on low
  for 5 minutes", "220°C / 200°C fan"). Recipes are short (4–5 steps).
- This is not an official API and could change without notice.

### In-app import
1. Home → **Import from Planthood** → paste a recipe link (or use the phone's
   share sheet / clipboard button).
2. The server fetches that one recipe (the phone cannot, because of
   cross-site browser rules) and builds a draft:
   - one task per STEP, in order, with the full step text as the task's notes
     and a short title taken from the first sentence;
   - where a step states a time, the task gets that duration (the upper value
     of a range, so "5-6 minutes" → 6);
   - steps with no stated time get a default of 2 minutes of hands-on time;
   - tasks are laid end to end and converted to "minutes before serve".
3. The draft opens in the editor with a "Check timings" banner, since the
   conversion is rule-based and will not spot steps that can overlap (e.g.
   chopping while something roasts). Nothing is saved until confirmed.
4. If the link cannot be read, the app says so and offers **Paste recipe
   text** instead, which runs the same conversion on pasted text.

### Import by Claude
- "Load this Planthood recipe: <link>" → Claude calls
  `fetch_planthood_recipe`, reads the steps, and calls `create_recipe` with a
  properly overlapped timeline (preheat first, prep during cooking time).
  This is the higher-quality route, because it understands the prose.
- Claude can also combine several Planthood recipes into one cook with a
  shared serve time.

### Rules
- Fetch only the single recipe the user asked for, on demand; no crawling or
  bulk copying. Imported recipes keep a link back to the original page.
- Only `recipes.planthood.co.uk` and `planthood.co.uk` links are accepted by
  the fetcher.
- Planthood's terms of use have not been reviewed; this is specified for
  personal use of recipes the user has bought.

## 10. Architecture

- **One Cloudflare Worker** serving: the static web app, a small JSON API,
  and the MCP endpoint. Storage in Cloudflare D1 (two tables: recipes,
  cooks; bodies stored as JSON).
- MCP is implemented as a stateless request handler; Cloudflare's current
  guidance is that a Durable Object is no longer needed just to speak MCP
  ([Cloudflare: the next generation of MCP](https://blog.cloudflare.com/mcp-v2/)).
  Exact SDK and transport to be confirmed against Cloudflare's and
  Anthropic's docs at build time.
- **Front end**: a small single-page app (TypeScript, light framework such
  as Preact), installable to the home screen (manifest + service worker
  caching the app shell).
- **Access**: one long random secret generated at deploy time. The app is
  opened at `https://<host>/a/<secret>/`; the connector URL is
  `https://<host>/mcp/<secret>`. Requests without the correct secret get a
  404. The secret can be rotated by redeploying with a new value. No personal
  data is stored beyond recipe text.

## 11. Worked example — Christmas roast

Illustrative timings for a 5 kg turkey; to be adjusted to the actual bird and
oven. Times are before serving.

| Before serve | Dish | Task | Duration |
|---|---|---|---|
| −4:55 | Turkey | Take turkey out of the fridge | — |
| −4:15 | General | Preheat oven to 180 °C fan | — |
| −3:55 | Turkey | Turkey into the oven | 3 h 10 |
| −2:00 | Potatoes | Peel and chop potatoes and parsnips | 20 min |
| −1:35 | Potatoes | Roasting tin with fat into the oven | — |
| −1:30 | Potatoes | Potatoes on to boil (parboil) | 10 min |
| −1:15 | Potatoes | Drain, rough up, into the hot fat | 60 min |
| −1:00 | Trimmings | Pigs in blankets into the oven | 40 min |
| −0:50 | Veg | Parsnips into the oven | 40 min |
| −0:45 | Turkey | Turkey out; rest under foil; oven up to 200 °C | 45 min |
| −0:40 | Gravy | Make gravy from the roasting juices | 20 min |
| −0:35 | Potatoes | Turn the roast potatoes | — |
| −0:30 | Trimmings | Stuffing into the oven | 25 min |
| −0:20 | Veg | Carrots on to boil | 15 min |
| −0:15 | General | Warm plates and serving dishes | — |
| −0:12 | Veg | Sprouts on to boil | 8 min |
| −0:10 | Turkey | Carve the turkey | 10 min |
| 0:00 | General | Serve | — |

Walk-through:
1. Weeks ahead, in a Claude chat: "Create a Christmas roast recipe for 8 with
   a 5 kg turkey" → Claude calls `create_recipe`; it appears in the app.
2. You adjust tasks in the editor, or ask Claude: "move the sprouts 5 minutes
   later and add bread sauce".
3. On the day, open the recipe → **Start cooking** → *Set serve time 15:00* →
   app says "Start at 10:05".
4. At 13:30 the phone chimes: "Potatoes on to boil". You tick it; a 10-minute
   timer runs; at 13:40 it chimes "Potatoes: done parboiling".
5. Turkey needs longer → **Delay +15** → every remaining task and the serve
   time move to 15:15.
6. All tasks ticked → cook finishes; the recipe is unchanged and reusable.

## 12. Out of scope for v1

- Push notifications / alerts while the phone is locked.
- Multiple users, sharing, or multi-device live sync.
- Task dependencies and automatic rescheduling.
- Ingredients and shopping lists.
- Scaling recipes by servings or weight.
- More than one active cook at a time.

## 13. Acceptance criteria

1. A recipe with 15+ tasks can be created and edited entirely on a phone,
   one-handed, with no horizontal scrolling.
2. Starting a cook by either method shows correct start and serve times
   before confirming.
3. Closing the browser mid-cook and reopening restores the exact state and
   correct countdowns.
4. A due task produces sound and a visible alert within 2 seconds of its
   time, repeating until acknowledged, with the screen staying awake.
5. Delay moves all pending tasks and the serve time; done and running tasks
   are unaffected.
6. From a Claude chat with the connector added, creating the Christmas roast
   and then changing one task is reflected in the app within 30 seconds.
7. Pasting a Planthood recipe link produces an editable draft with one task
   per step, stated cooking times captured as durations, and the original
   step text in the notes.
8. The cook continues to alert correctly with the network disconnected.
