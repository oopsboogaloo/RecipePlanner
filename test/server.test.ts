import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { serveAtForStart, startCook } from "../src/shared/cook";
import { christmasRoast } from "../src/shared/example";
import { MIN } from "../src/shared/timing";
import { handleApi } from "../src/worker/api";
import { buildMcpServer, handleMcp } from "../src/worker/mcp";
import { Service } from "../src/worker/service";
import { MemoryStore } from "../src/worker/store";

const T0 = Date.UTC(2026, 11, 25, 10, 0, 0);
const PRODUCT = {
  product: { title: "Squash Bowl", body_html: "<p>Intro.</p><h5>STEP 1</h5><p>Roast for 20 minutes.</p><h5>STEP 2</h5><p>Serve.</p>" },
};

let svc: Service;
let fetched: string[];
beforeEach(() => {
  fetched = [];
  svc = new Service(new MemoryStore(), (async (u: string) => {
    fetched.push(u);
    return u.includes("missing") ? new Response("no", { status: 404 }) : Response.json(PRODUCT);
  }) as unknown as typeof fetch);
});

const api = async (method: string, path: string, body?: unknown) => {
  const res = await handleApi(svc, new Request("https://x/api" + path, { method, body: body ? JSON.stringify(body) : undefined }), path);
  return { status: res.status, body: (await res.json()) as any };
};

describe("api", () => {
  it("saves, lists and deletes recipes", async () => {
    const r = christmasRoast(T0);
    expect((await api("PUT", `/recipes/${r.id}`, r)).status).toBe(200);
    expect((await api("GET", "/state")).body.recipes).toHaveLength(1);
    expect((await api("DELETE", `/recipes/${r.id}`)).status).toBe(200);
    expect((await api("GET", "/state")).body).toEqual({ recipes: [], cook: null });
  });
  it("returns plain-language validation errors", async () => {
    const res = await api("PUT", "/recipes/x", { name: "x", tasks: [{ title: "Roast potatoes", startOffsetMin: 10, durationMin: 60 }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ends after serving/);
  });
  it("runs a cook: start is idempotent, ops apply, one cook at a time", async () => {
    const r = christmasRoast(T0);
    await api("PUT", `/recipes/${r.id}`, r);
    const cook = startCook(r, serveAtForStart(r, T0), T0);
    expect((await api("POST", "/cook", cook)).body.rev).toBe(1);
    expect((await api("POST", "/cook", cook)).body.rev).toBe(1);
    expect((await api("POST", "/cook", { ...cook, id: "other" })).status).toBe(409);
    const after = await api("POST", "/cook/ops", { cookId: cook.id, ops: [{ type: "tick", taskId: "t1", at: T0 }, { type: "delay", minutes: 15, at: T0 }] });
    expect(after.body.taskState.t1.status).toBe("done");
    expect(after.body.serveAt).toBe(cook.serveAt + 15 * MIN);
    expect((await api("DELETE", `/recipes/${r.id}`)).status).toBe(409);
    await api("POST", "/cook/ops", { cookId: cook.id, ops: [{ type: "finish", at: T0 }] });
    expect((await api("GET", "/state")).body.cook).toBeNull();
    expect((await api("POST", "/cook/ops", { cookId: cook.id, ops: [] })).status).toBe(404);
  });
  it("imports a Planthood link as a draft and only fetches Planthood", async () => {
    const ok = await api("POST", "/planthood", { url: "https://recipes.planthood.co.uk/collections/menu/products/squash-bowl?variant=1" });
    expect(ok.body.recipe.tasks.map((t: any) => [t.startOffsetMin, t.durationMin])).toEqual([[22, 20], [2, undefined]]);
    expect(fetched).toEqual(["https://recipes.planthood.co.uk/products/squash-bowl.json"]);
    const bad = await api("POST", "/planthood", { url: "https://example.com/products/squash-bowl" });
    expect(bad.status).toBe(400);
    expect(fetched).toHaveLength(1);
    expect((await api("POST", "/planthood", { url: "https://recipes.planthood.co.uk/products/missing" })).body.error).toMatch(/HTTP 404/);
  });
});

describe("connector", () => {
  let now = T0;
  const connect = async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildMcpServer(svc, () => now).connect(a);
    const client = new Client({ name: "test", version: "1" });
    await client.connect(b);
    return async (name: string, args: Record<string, unknown> = {}) => {
      const res = (await client.callTool({ name, arguments: args })) as any;
      return { text: res.content[0].text as string, isError: !!res.isError };
    };
  };
  const id = (text: string, kind: string, near = "") => {
    const line = text.split("\n").find((l) => l.includes(near) && l.includes(`{${kind} `))!;
    return line.match(new RegExp(`\\{${kind} ([\\w-]+)\\}`))![1];
  };

  it("creates and edits a recipe by dish name", async () => {
    const call = await connect();
    const created = await call("create_recipe", {
      name: "Sunday roast",
      tasks: [
        { title: "Chicken in", minutes_before_serve: 100, duration_minutes: 80, dish: "Chicken" },
        { title: "Sprouts on", minutes_before_serve: 12, duration_minutes: 8, dish: "Veg" },
        { title: "Serve", minutes_before_serve: 0 },
      ],
    });
    expect(created.text).toContain("−1:40  [Chicken] Chicken in (1 h 20 m)");
    const list = await call("list_recipes");
    const rid = id(list.text, "recipe");
    const sprouts = id(created.text, "task", "Sprouts");
    expect((await call("update_task", { recipe_id: rid, task_id: sprouts, minutes_before_serve: 7 })).isError).toBe(true);
    const moved = await call("update_task", { recipe_id: rid, task_id: sprouts, minutes_before_serve: 10 });
    expect(moved.text).toContain("−0:10  [Veg] Sprouts on");
    const added = await call("add_tasks", { recipe_id: rid, tasks: [{ title: "Bread sauce", minutes_before_serve: 20, dish: "veg" }] });
    expect(added.text).toContain("[Veg] Bread sauce");
    expect((await call("shift_tasks", { recipe_id: rid, minutes_earlier: 5, dish: "Veg" })).text).toContain("−0:15  [Veg] Sprouts on");
    expect((await call("shift_tasks", { recipe_id: rid, minutes_earlier: -500 })).isError).toBe(true);
    expect((await call("delete_task", { recipe_id: rid, task_id: sprouts })).text).not.toContain("Sprouts");
    expect((await call("duplicate_recipe", { recipe_id: rid })).text).toContain("Sunday roast (copy)");
    expect((await call("get_recipe", { recipe_id: "nope" })).isError).toBe(true);
    expect((await svc.state()).recipes).toHaveLength(2);
  });

  it("reads and adjusts a live cook without ticking anything", async () => {
    const call = await connect();
    const r = christmasRoast(T0);
    await svc.saveRecipe(r);
    expect((await call("get_active_cook")).text).toBe("No cook is in progress.");
    const cook = await svc.startCook(startCook(r, serveAtForStart(r, T0), T0));
    await svc.cookOps(cook.id, [{ type: "tick", taskId: "t1", at: T0 }]);
    now = T0 + 41 * MIN;
    const status = await call("get_active_cook");
    expect(status.text).toContain("due (1 min late): Preheat oven");
    expect(status.text).toContain("DONE: 1 of 18");
    const delayed = await call("update_active_cook", { delay_minutes: 20, add_tasks: [{ title: "Bread sauce", minutes_before_serve: 25, dish: "Trimmings" }] });
    expect(delayed.text).toContain("Bread sauce");
    const live = (await svc.state()).cook!;
    expect(live.serveAt).toBe(cook.serveAt + 20 * MIN);
    expect(live.tasks).toHaveLength(19);
    expect(live.taskState.t1.status).toBe("done");
    expect((await call("update_active_cook", { update_tasks: [{ task_id: "t1", title: "x" }] })).isError).toBe(true);
    expect((await call("delete_recipe", { recipe_id: r.id })).isError).toBe(true);
    expect((await svc.state()).recipes[0].tasks).toHaveLength(18);
  });

  it("fetches a Planthood recipe for Claude to plan", async () => {
    const call = await connect();
    const res = await call("fetch_planthood_recipe", { url: "https://recipes.planthood.co.uk/products/squash-bowl" });
    expect(res.text).toContain("Title: Squash Bowl");
    expect(res.text).toContain("STEP 1: Roast for 20 minutes.");
    expect((await call("fetch_planthood_recipe", { url: "https://example.com/x" })).isError).toBe(true);
  });

  it("speaks MCP over stateless HTTP", async () => {
    const post = (body: unknown) =>
      handleMcp(svc, new Request("https://x/mcp/s", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify(body),
      }));
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    expect(init.status).toBe(200);
    expect(((await init.json()) as any).result.serverInfo.name).toBe("recipeplanner");
    const tools = (await (await post({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json()) as any;
    expect(tools.result.tools.map((t: any) => t.name).sort()).toEqual([
      "add_tasks", "create_recipe", "delete_recipe", "delete_task", "duplicate_recipe", "fetch_planthood_recipe",
      "get_active_cook", "get_recipe", "list_recipes", "shift_tasks", "update_active_cook", "update_recipe", "update_task",
    ]);
    expect((await handleMcp(svc, new Request("https://x/mcp/s"))).status).toBe(405);
  });
});
