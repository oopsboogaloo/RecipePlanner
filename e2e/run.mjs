// End-to-end check: runs the Worker locally and drives the app in Chromium at
// Galaxy Fold folded and unfolded sizes. Usage: npm run e2e
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)("playwright");
const PORT = 8799;
const SECRET = "local-dev-secret-0123456789";
const ORIGIN = `http://127.0.0.1:${PORT}`;
const APP = `${ORIGIN}/a/${SECRET}/`;
const FOLDED = { width: 344, height: 882 };
const UNFOLDED = { width: 690, height: 829 };
const SHOTS = "e2e/shots";
const MIN = 60_000;

let failures = 0;
const check = (ok, what) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${what}`);
  if (!ok) failures++;
};

const state = mkdtempSync(join(tmpdir(), "rp-e2e-"));
const server = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--ip", "127.0.0.1", "--persist-to", state, "--var", `APP_SECRET:${SECRET}`], { stdio: "ignore", detached: true });
const stop = () => {
  try { process.kill(-server.pid); } catch {}
  rmSync(state, { recursive: true, force: true });
};
process.on("exit", stop);

for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${APP}api/state`)).ok) break;
  } catch {}
  if (i > 60) throw new Error("Worker did not start");
  await new Promise((r) => setTimeout(r, 500));
}

const mcp = async (name, args = {}) => {
  const res = await fetch(`${ORIGIN}/mcp/${SECRET}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  return (await res.json()).result;
};

mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();
const START = new Date(2026, 11, 25, 10, 0, 0);

async function open(viewport) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(m.text()) && errors.push(m.text()));
  await page.clock.install({ time: START });
  await page.goto(APP);
  return { context, page, errors };
}
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const sounds = (page) => page.evaluate(() => window.__rpSounds ?? 0);
// Move the page's clock on, then give the UI a moment to redraw.
const ff = async (page, ms) => {
  await page.clock.fastForward(ms);
  await page.waitForTimeout(150);
};
const is = (got, want, what) => check(want instanceof RegExp ? want.test(got) : got === want, `${what}${(want instanceof RegExp ? want.test(got) : got === want) ? "" : ` (got ${JSON.stringify(got)})`}`);

try {
  // ---------- folded: build a recipe ----------
  console.log("Folded (344×882): plan");
  let { context, page, errors } = await open(FOLDED);
  await page.getByRole("button", { name: "Add the Christmas roast example" }).click();
  await page.getByText("18 tasks · starts 4 h 55 m before serving").waitFor();
  check(true, "example recipe opens with 18 tasks, 4 h 55 m");
  check(await noSideScroll(page), "editor has no sideways scrolling");
  await shot(page, "folded-editor");

  await page.getByRole("button", { name: "+ Add task" }).click();
  await page.getByPlaceholder("e.g. Potatoes on to boil").fill("Bread sauce");
  await page.getByRole("button", { name: "Trimmings" }).last().click();
  await page.getByRole("button", { name: "Starts before serving: take off 5 m" }).click();
  await page.getByText("Runs for a set time").click();
  await page.getByRole("button", { name: "Runs for: add 15 m" }).click();
  await page.getByRole("button", { name: "Runs for: add 15 m" }).click();
  await page.getByText(/Ends 15 m after serving/).waitFor();
  check(true, "task sheet warns when a timer would end after serving");
  await shot(page, "folded-task-sheet");
  await page.getByRole("button", { name: "Runs for: take off 15 m" }).click();
  await page.getByRole("button", { name: "Save task" }).click();
  await page.getByText("19 tasks").waitFor();
  check(await page.getByText("Bread sauce").isVisible(), "task added with steppers only (no typing of times)");

  // ---------- start: both methods show the right times ----------
  await page.getByRole("button", { name: "Start cooking" }).click();
  await page.getByRole("button", { name: "Start — dinner at 14:55" }).waitFor();
  check(true, "Start now shows dinner at 14:55 (10:00 + 4 h 55 m)");
  await page.getByRole("tab", { name: "Set serve time" }).click();
  await page.locator("input[type=time]").fill("16:00");
  await page.getByRole("button", { name: "Start — first task at 11:05" }).waitFor();
  check(true, "Serve at 16:00 shows first task at 11:05");
  await page.locator("input[type=time]").fill("12:00");
  await page.getByText(/already overdue. The earliest you can serve is 14:55/).waitFor();
  check(true, "too-early serve time is explained and the earliest time offered");
  await shot(page, "folded-start");
  await page.locator("input[type=time]").fill("15:00");
  await page.getByRole("button", { name: "Start — first task at 10:05" }).click();

  // ---------- cook ----------
  console.log("Folded: cook");
  await page.getByText("Serve 15:00").waitFor();
  await page.getByText("Nothing to do right now. Next task in").waitFor();
  is(await page.locator(".countdown").textContent(), /^(5:00|4:5\d)$/, "countdown to the first task shows about 5:00");
  check((await sounds(page)) === 0, "no sound before anything is due");

  await ff(page, 3 * MIN + 2000);
  is(await sounds(page), 1, "soft heads-up chime 2 minutes before a task");
  await ff(page, 2 * MIN);
  await page.getByRole("alert").getByText("Take turkey out of the fridge").waitFor();
  check((await sounds(page)) === 2, "alert sounds when a task becomes due");
  await shot(page, "folded-alert");
  await ff(page, 31_000);
  is(await sounds(page), 3, "alert repeats after 30 seconds");
  await page.getByRole("button", { name: "Got it" }).click();
  await ff(page, 61_000);
  check((await sounds(page)) === 3 && !(await page.getByRole("alert").isVisible()), "acknowledged alert goes quiet");
  check(await page.locator(".now-card.due").getByText("Take turkey out").isVisible(), "acknowledged task stays under Now until ticked");
  await page.locator(".now-card.due").getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  check(await page.locator(".now-card.due").isVisible(), "undo puts a ticked task back");
  await page.locator(".now-card.due").getByRole("button", { name: "Done" }).click();
  await page.getByText("Done (1)").waitFor();

  // Jump to the turkey going in (10:55 + 3 h 10 timer).
  await ff(page, 60 * MIN);
  await page.getByRole("button", { name: "Got it" }).click(); // preheat
  await page.locator(".now-card.due", { hasText: "Preheat" }).getByRole("button", { name: "Done" }).click();
  const turkey = page.locator(".now-card", { hasText: "Turkey into the oven" });
  await turkey.getByRole("button", { name: /Start · 3 h 10 m timer/ }).click();
  await turkey.locator(".countdown").waitFor();
  is(await turkey.locator(".countdown").textContent(), /^3:(10:00|09:5\d)$/, "ticking a timed task starts its countdown from now");
  await shot(page, "folded-cook");
  check(await noSideScroll(page), "cook screen has no sideways scrolling");

  // Reload: state and countdowns survive.
  await ff(page, 10 * MIN);
  await page.reload();
  await page.getByText("Serve 15:00").waitFor();
  is(await page.locator(".now-card.running .countdown").textContent(), /^(3:00:00|2:59:[345]\d)$/, "reload restores the cook with a correct countdown");
  check(await page.getByText("Done (2)").isVisible(), "reload keeps ticked tasks");
  await page.getByRole("button", { name: /Tap to enable sound/ }).click();
  check(true, "after reload a 'Tap to enable sound' bar is shown");

  // Delay.
  const endsBefore = await page.locator(".now-card.running .meta").textContent();
  await page.getByRole("button", { name: "Delay" }).click();
  await shot(page, "folded-delay");
  await page.getByRole("button", { name: "+15 min" }).click();
  await page.getByText("Serve 15:15").waitFor();
  check((await page.locator(".now-card.running .meta").textContent()) === endsBefore, "delay moves serve time to 15:15 but not the running timer");
  check((await page.locator(".next-row").first().textContent()).includes("13:15"), "delay moves the next pending task (13:00 → 13:15)");

  // Offline: alerts and ticking still work, then sync on reconnect.
  await context.setOffline(true);
  const before = await sounds(page);
  await ff(page, 2 * 60 * MIN);
  await page.getByRole("alert").waitFor();
  check((await sounds(page)) > before, "alerts still fire with the network disconnected");
  await page.getByRole("alert").getByRole("button", { name: "Start", exact: true }).click();
  await page.getByText("Done (2)").waitFor();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1500);
  const server1 = await (await fetch(`${APP}api/state`)).json();
  const running = Object.values(server1.cook.taskState).filter((s) => s.status === "running").length;
  check(running === 2 && server1.cook.serveAt === new Date(2026, 11, 25, 15, 15).getTime(), "offline ticks reach the server after reconnecting");

  // ---------- connector edits show up in the app ----------
  console.log("Connector");
  const live = await mcp("update_active_cook", { delay_minutes: 10, add_tasks: [{ title: "Cranberry sauce", minutes_before_serve: 30, dish: "Trimmings" }] });
  check(!live.isError, "Claude can delay and add to the live cook");
  const created = await mcp("create_recipe", { name: "Boxing Day curry", tasks: [{ title: "Rice on", minutes_before_serve: 15, duration_minutes: 12, dish: "Rice" }, { title: "Serve", minutes_before_serve: 0 }] });
  check(!created.isError, "Claude can create a recipe");
  await ff(page, 31_000);
  await page.getByText("Serve 15:25").waitFor();
  check(await page.getByText("Cranberry sauce").isVisible(), "live cook picks up Claude's changes within 30 seconds");
  check(await page.getByText("Done (2)").isVisible(), "Claude's edit does not disturb ticked tasks");
  await page.getByRole("button", { name: "Back to recipes" }).click();
  await page.getByText("Boxing Day curry").waitFor();
  check(true, "recipe created by Claude appears in the app");
  check(await page.getByText("Cooking now — Christmas roast").isVisible(), "home shows the cooking-now banner");
  await shot(page, "folded-home");
  check(errors.length === 0, `no script errors on the folded run${errors.length ? ": " + errors.join(" | ") : ""}`);

  // ---------- unfolded ----------
  console.log("Unfolded (690×829)");
  await page.setViewportSize(UNFOLDED);
  await page.getByText("Cooking now — Christmas roast").click();
  await page.getByText("Serve 15:25").waitFor();
  const boxes = await page.evaluate(() => [...document.querySelectorAll(".content.split > .pane")].map((p) => p.getBoundingClientRect().toJSON()));
  check(boxes.length === 2 && boxes[0].right <= 345 - 8 && boxes[1].left >= 345 + 8 && Math.abs(boxes[0].top - boxes[1].top) < 2, "unfolding mid-cook shows Now and Next up side by side, clear of the fold");
  check(await page.getByText("Done (2)").isVisible(), "unfolding keeps the cook state");
  await shot(page, "unfolded-cook");
  await page.locator(".next-row").first().click();
  const sheet = await page.locator(".sheet").boundingBox();
  check(sheet.x >= 345, "task details open in the right-hand pane when unfolded");
  await shot(page, "unfolded-detail");
  await page.setViewportSize(FOLDED);
  check(await page.locator(".sheet").isVisible(), "folding keeps the open panel");
  await page.getByRole("button", { name: "Close" }).click();
  await page.setViewportSize(UNFOLDED);

  // Finish the cook, then edit a recipe in two panes.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Finish cook" }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByText("Boxing Day curry").waitFor();
  check(!(await page.getByText("Cooking now").isVisible()), "finishing ends the cook");
  await page.waitForTimeout(800);
  check((await (await fetch(`${APP}api/state`)).json()).cook === null, "server has no active cook after finishing");
  await page.getByText("Christmas roast").first().click();
  check(await page.getByText("19 tasks").isVisible(), "recipe is unchanged by the cook (19 tasks, no cranberry sauce)");
  await page.getByText("Potatoes on to boil (parboil)").click();
  await shot(page, "unfolded-editor");
  check(await noSideScroll(page), "unfolded editor has no sideways scrolling");
  await page.getByRole("button", { name: "Close" }).click();
  await context.close();

  // ---------- finishing offline, then starting again ----------
  console.log("Offline finish, then a new cook");
  ({ context, page, errors } = await open(FOLDED));
  await page.getByText("Boxing Day curry").click();
  await page.getByRole("button", { name: "Start cooking" }).click();
  await page.getByRole("button", { name: /Start — dinner at/ }).click();
  await page.getByText(/^Serve /).waitFor();
  await page.waitForTimeout(800);
  await context.setOffline(true);
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Finish cook" }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await page.getByText("Christmas roast").first().click();
  await page.getByRole("button", { name: "Start cooking" }).click();
  await page.getByRole("button", { name: /Start — dinner at/ }).click();
  await page.getByText(/^Serve /).waitFor();
  await page.locator(".next-row").first().waitFor();
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1500);
  const afterRestart = await (await fetch(`${APP}api/state`)).json();
  check(afterRestart.cook?.name === "Christmas roast", "a cook started after finishing another offline survives reconnecting");
  check(await page.getByText(/^Serve /).isVisible(), "the new cook is still on screen");
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: "Abandon cook" }).click();
  await page.getByRole("button", { name: "Abandon", exact: true }).click();
  await page.waitForTimeout(1200);
  check(errors.length === 0, `no script errors${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();

  // ---------- installed app shell works offline after the very first visit ----------
  console.log("Offline reopen");
  {
    const ctx = await browser.newContext({ viewport: FOLDED });
    const p = await ctx.newPage();
    await p.goto(APP);
    await p.getByText("Christmas roast").first().waitFor();
    await p.waitForFunction(async () => (await (await caches.open("rp-shell-v1")).keys()).length >= 4);
    await ctx.setOffline(true);
    await p.reload();
    await p.getByText("Christmas roast").first().waitFor({ timeout: 5000 });
    await p.getByText("Offline — saved on this phone").waitFor({ timeout: 5000 });
    check(true, "app reopens offline after a single visit, showing saved recipes");
    await ctx.close();
  }

  // ---------- Planthood import (response mocked; parser is unit-tested) ----------
  console.log("Planthood import");
  ({ context, page, errors } = await open(FOLDED));
  await page.route("**/products/*.json", (r) => r.abort());
  await page.getByRole("button", { name: "Import from Planthood" }).click();
  await page.getByPlaceholder(/recipes.planthood.co.uk/).fill("https://example.com/products/x");
  await page.getByRole("button", { name: "Load recipe" }).click();
  await page.getByText(/not a Planthood recipe link/).waitFor();
  check(true, "non-Planthood links are refused and paste-text is offered");
  await page.getByLabel("Recipe name").fill("Squash bowl");
  await page.getByLabel(/Recipe text/).fill("Before you start, rinse the veg.\nSTEP 1\nPreheat your oven to 200°C.\nSTEP 2\nRoast the squash for 20-25 minutes.\nSTEP 3\nServe.");
  await page.getByRole("button", { name: "Create draft" }).click();
  await page.getByText("Check timings.").waitFor();
  check(await page.getByText("3 tasks · starts 29 m before serving").isVisible(), "pasted text becomes a 3-task draft with the stated 25 min captured");
  await shot(page, "folded-import-draft");
  check((await (await fetch(`${APP}api/state`)).json()).recipes.every((r) => r.name !== "Squash bowl"), "draft is not saved until confirmed");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await page.getByText("Recipe saved").waitFor();
  await page.waitForTimeout(1500);
  check((await (await fetch(`${APP}api/state`)).json()).recipes.some((r) => r.name === "Squash bowl"), "confirmed draft is saved to the server");
  check(errors.length === 0, `no script errors on the import run${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
} catch (e) {
  failures++;
  console.log("  FAIL (stopped) " + e.message.split("\n").slice(0, 6).join("\n    "));
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
