import { describe, expect, it } from "vitest";
import { christmasRoast } from "../src/shared/example";
import { applyOp, dueAt, minDelayMin, replaceCookPlan, serveAtForStart, startCook, startForServeAt, viewCook } from "../src/shared/cook";
import { fmtCountdown, fmtDuration, fmtOffset, fmtRelative, MIN, planLengthMin, sortTasks, timelineText } from "../src/shared/timing";
import { cleanRecipe, ValidationError } from "../src/shared/validate";
import { htmlToText, parsePlanthoodProduct, planthoodJsonUrl, planthoodToRecipe, splitSteps, stepDurationMin } from "../src/shared/planthood";

const T0 = Date.UTC(2026, 11, 25, 10, 0, 0);

describe("example recipe", () => {
  const r = christmasRoast(T0);
  it("is valid and 4 h 55 m long", () => {
    expect(cleanRecipe(r).tasks).toHaveLength(18);
    expect(planLengthMin(r.tasks)).toBe(295);
    expect(fmtDuration(295)).toBe("4 h 55 m");
  });
  it("no timed task ends after serving", () => {
    for (const t of r.tasks) expect(t.startOffsetMin - (t.durationMin ?? 0)).toBeGreaterThanOrEqual(0);
  });
  it("prints a readable timeline", () => {
    const text = timelineText(r);
    expect(text).toContain("−1:30  [Potatoes] Potatoes on to boil (parboil) (10 m)");
    expect(timelineText(r, new Date(2026, 11, 25, 15, 0).getTime())).toContain("13:30  [Potatoes] Potatoes on to boil");
  });
});

describe("formatting", () => {
  it("formats offsets, countdowns and relative times", () => {
    expect(fmtOffset(90)).toBe("−1:30");
    expect(fmtOffset(0)).toBe("0:00");
    expect(fmtCountdown(65_000)).toBe("1:05");
    expect(fmtCountdown(3_723_000)).toBe("1:02:03");
    expect(fmtCountdown(-5)).toBe("0:00");
    expect(fmtRelative(12 * MIN)).toBe("in 12 min");
    expect(fmtRelative(-3 * MIN)).toBe("3 min late");
  });
  it("sorts tasks earliest first", () => {
    const s = sortTasks([{ id: "a", title: "a", startOffsetMin: 5 }, { id: "b", title: "b", startOffsetMin: 50 }]);
    expect(s.map((t) => t.id)).toEqual(["b", "a"]);
  });
});

describe("validation", () => {
  it("rejects a task that ends after serving, in plain language", () => {
    const bad = { name: "x", dishes: [], tasks: [{ title: "Roast potatoes", startOffsetMin: 30, durationMin: 60 }] };
    expect(() => cleanRecipe(bad)).toThrow(/task 'Roast potatoes' ends after serving/);
    expect(() => cleanRecipe(bad)).toThrow(ValidationError);
  });
  it("rejects unknown dishes, missing names and bad numbers", () => {
    expect(() => cleanRecipe({ name: "", tasks: [] })).toThrow(/recipe name is required/);
    expect(() => cleanRecipe({ name: "x", tasks: [{ title: "t", startOffsetMin: -1 }] })).toThrow(/between 0/);
    expect(() => cleanRecipe({ name: "x", tasks: [{ title: "t", startOffsetMin: 1, dishId: "nope" }] })).toThrow(/dish that does not exist/);
  });
  it("fills in ids and colours", () => {
    const r = cleanRecipe({ name: " Roast ", dishes: [{ name: "Veg" }], tasks: [{ title: "Peel", startOffsetMin: 10.4 }] });
    expect(r.name).toBe("Roast");
    expect(r.dishes[0].colour).toMatch(/^#/);
    expect(r.tasks[0].id).toBeTruthy();
    expect(r.tasks[0].startOffsetMin).toBe(10);
  });
});

describe("cook", () => {
  const r = christmasRoast(T0);
  it("computes start and serve times both ways", () => {
    expect(serveAtForStart(r, T0)).toBe(T0 + 295 * MIN);
    expect(startForServeAt(r, T0 + 295 * MIN)).toBe(T0);
  });
  it("runs the task lifecycle and timers from the moment of ticking", () => {
    let c = startCook(r, serveAtForStart(r, T0), T0);
    const boil = r.tasks.find((t) => t.title.startsWith("Potatoes on"))!;
    expect(dueAt(c, boil)).toBe(c.serveAt - 90 * MIN);
    const late = dueAt(c, boil) + 3 * MIN;
    c = applyOp(c, { type: "tick", taskId: boil.id, at: late });
    expect(c.taskState[boil.id]).toMatchObject({ status: "running", endsAt: late + 10 * MIN });
    c = applyOp(c, { type: "extend", taskId: boil.id, minutes: 5, at: late + MIN });
    expect(c.taskState[boil.id].endsAt).toBe(late + 15 * MIN);
    c = applyOp(c, { type: "tick", taskId: boil.id, at: late + 15 * MIN });
    expect(c.taskState[boil.id].status).toBe("done");
    c = applyOp(c, { type: "undo", taskId: boil.id, at: late + 16 * MIN });
    expect(c.taskState[boil.id].status).toBe("running");
    c = applyOp(c, { type: "undo", taskId: boil.id, at: late + 16 * MIN });
    expect(c.taskState[boil.id]).toBeUndefined();
  });
  it("ticks an untimed task straight to done", () => {
    let c = startCook(r, serveAtForStart(r, T0), T0);
    c = applyOp(c, { type: "tick", taskId: "t1", at: T0 });
    expect(c.taskState.t1.status).toBe("done");
  });
  it("delay moves pending tasks and serve time, not running or done ones", () => {
    let c = startCook(r, serveAtForStart(r, T0), T0);
    c = applyOp(c, { type: "tick", taskId: "t1", at: T0 });
    c = applyOp(c, { type: "tick", taskId: "t3", at: T0 + 60 * MIN });
    const endsAt = c.taskState.t3.endsAt;
    const before = dueAt(c, r.tasks[5]);
    c = applyOp(c, { type: "delay", minutes: 15, at: T0 + 61 * MIN });
    expect(c.serveAt).toBe(T0 + (295 + 15) * MIN);
    expect(dueAt(c, r.tasks[5])).toBe(before + 15 * MIN);
    expect(c.taskState.t3.endsAt).toBe(endsAt);
    expect(c.taskState.t1.doneAt).toBe(T0);
  });
  it("limits catching up so nothing upcoming becomes overdue", () => {
    let c = startCook(r, serveAtForStart(r, T0) + 30 * MIN, T0);
    expect(minDelayMin(c, T0)).toBe(-30);
    c = applyOp(c, { type: "delay", minutes: -120, at: T0 });
    expect(c.serveAt).toBe(serveAtForStart(r, T0));
  });
  it("groups tasks into now / next / done", () => {
    let c = startCook(r, serveAtForStart(r, T0), T0);
    let v = viewCook(c, T0 + 41 * MIN);
    expect(v.now.map((x) => x.task.id)).toEqual(["t1", "t2"]);
    expect(v.next[0].task.id).toBe("t3");
    c = applyOp(c, { type: "tick", taskId: "t1", at: T0 });
    v = viewCook(c, T0 + 41 * MIN);
    expect(v.done.map((x) => x.task.id)).toEqual(["t1"]);
    for (const t of r.tasks) {
      c = applyOp(c, { type: "tick", taskId: t.id, at: T0 });
      c = applyOp(c, { type: "tick", taskId: t.id, at: T0 });
    }
    expect(viewCook(c, T0).allDone).toBe(true);
  });
  it("keeps tick state when the plan is edited mid-cook", () => {
    let c = startCook(r, serveAtForStart(r, T0), T0);
    c = applyOp(c, { type: "tick", taskId: "t1", at: T0 });
    c = applyOp(c, { type: "tick", taskId: "t2", at: T0 });
    c = replaceCookPlan(c, { dishes: r.dishes, tasks: r.tasks.filter((t) => t.id !== "t2") });
    expect(Object.keys(c.taskState)).toEqual(["t1"]);
  });
  it("ignores operations once finished", () => {
    let c = startCook(r, serveAtForStart(r, T0), T0);
    c = applyOp(c, { type: "finish", at: T0 });
    expect(applyOp(c, { type: "tick", taskId: "t1", at: T0 })).toBe(c);
  });
});

describe("planthood", () => {
  // Synthetic fixture in the same shape as the store's product JSON.
  const body =
    "<p><em>Before you start, take out all the ingredients.</em></p>\n<h5>STEP 1</h5>\n<hr>\n" +
    "<p>Preheat your oven to 220&deg;C / 200&deg;C fan and take out a large saucepan.</p>\n<h5>STEP 2</h5>\n<hr>\n" +
    "<p>Microwave the <strong>squash</strong> for 5-6 minutes, then roast in the oven for 15 minutes or until soft. " +
    "If you don't have a microwave you can bake it from raw, around 30 minutes.</p>\n<p>STEP 3</p>\n" +
    "<p>Warm the <strong>flatbreads</strong> for 30-60 seconds. You can alternatively grill them for 5 minutes.</p>\n" +
    "<h5>STEP 4</h5><p>Serve &amp; enjoy!</p>";
  const product = { product: { title: "Roast Squash Bowl", body_html: body } };
  const url = "https://recipes.planthood.co.uk/products/roast-squash-bowl";

  it("accepts only Planthood product links", () => {
    expect(planthoodJsonUrl(url)).toBe(url + ".json");
    expect(planthoodJsonUrl("https://recipes.planthood.co.uk/collections/menu-25-11-03/products/roast-squash-bowl?x=1")).toBe(url + ".json");
    expect(planthoodJsonUrl("https://evil.example/products/roast-squash-bowl")).toBeNull();
    expect(planthoodJsonUrl("http://recipes.planthood.co.uk/products/a")).toBeNull();
    expect(planthoodJsonUrl("https://recipes.planthood.co.uk/")).toBeNull();
    expect(planthoodJsonUrl("not a link")).toBeNull();
  });
  it("splits steps even when headings are inconsistent", () => {
    const p = parsePlanthoodProduct(product, url);
    expect(p.intro).toBe("Before you start, take out all the ingredients.");
    expect(p.steps).toHaveLength(4);
    expect(p.steps[0]).toBe("Preheat your oven to 220°C / 200°C fan and take out a large saucepan.");
    expect(p.steps[3]).toBe("Serve & enjoy!");
  });
  it("reads stated times, using the top of a range and skipping alternatives", () => {
    const p = parsePlanthoodProduct(product, url);
    expect(p.steps.map(stepDurationMin)).toEqual([undefined, 21, 1, undefined]);
    expect(stepDurationMin("Simmer for 1 hour 10 minutes.")).toBe(70);
  });
  it("builds an end-to-end draft counted back from serving", () => {
    const r = planthoodToRecipe(parsePlanthoodProduct(product, url), T0);
    expect(r.name).toBe("Roast Squash Bowl");
    expect(r.tasks.map((t) => [t.startOffsetMin, t.durationMin])).toEqual([[26, undefined], [24, 21], [3, 1], [2, undefined]]);
    expect(r.tasks[1].notes).toContain("Microwave the squash");
    expect(r.source).toMatchObject({ kind: "planthood", url });
    expect(() => cleanRecipe(r)).not.toThrow();
  });
  it("falls back to paragraphs for pasted text without STEP headings", () => {
    expect(splitSteps(htmlToText("Chop the onion.\n\nFry for 5 minutes.")).steps).toHaveLength(2);
  });
  it("rejects pages that are not recipes", () => {
    expect(() => parsePlanthoodProduct({}, url)).toThrow(/does not look like/);
  });
});
