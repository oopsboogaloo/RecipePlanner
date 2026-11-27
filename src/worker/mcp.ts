import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { dueAt, minDelayMin, stateOf, viewCook } from "../shared/cook";
import { fmtDuration, fmtRelative, MIN, newId, timelineText } from "../shared/timing";
import { DISH_COLOURS, type Cook, type Dish, type Task } from "../shared/types";
import { ValidationError } from "../shared/validate";
import type { Service } from "./service";

const taskIn = z.object({
  title: z.string().describe("Short imperative title, e.g. 'Potatoes on to boil'"),
  minutes_before_serve: z.number().describe("When the task starts, in minutes before serving (0 = at serving)"),
  duration_minutes: z.number().optional().describe("If the task runs for a set time (boil 10 min), its length; the cook gets a second alert when it ends"),
  dish: z.string().optional().describe("Name of the dish this task belongs to, e.g. 'Turkey'. Created if it does not exist"),
  notes: z.string().optional().describe("Method detail, temperatures, quantities"),
});
type TaskIn = z.infer<typeof taskIn>;

const taskPatch = taskIn.partial().extend({ task_id: z.string() });

interface Plan {
  dishes: Dish[];
  tasks: Task[];
}

function dishIdFor(plan: Plan, name: string | undefined): string | undefined {
  const n = name?.trim();
  if (!n) return undefined;
  const found = plan.dishes.find((d) => d.name.toLowerCase() === n.toLowerCase());
  if (found) return found.id;
  const dish = { id: newId(), name: n, colour: DISH_COLOURS[plan.dishes.length % DISH_COLOURS.length] };
  plan.dishes.push(dish);
  return dish.id;
}

function toTask(plan: Plan, t: TaskIn): Task {
  return {
    id: newId(),
    title: t.title,
    startOffsetMin: t.minutes_before_serve,
    ...(t.duration_minutes ? { durationMin: t.duration_minutes } : {}),
    ...(t.dish ? { dishId: dishIdFor(plan, t.dish) } : {}),
    ...(t.notes ? { notes: t.notes } : {}),
  };
}

function patchTask(plan: Plan, p: z.infer<typeof taskPatch>): void {
  const t = plan.tasks.find((x) => x.id === p.task_id);
  if (!t) throw new ValidationError(`No task with id '${p.task_id}'. Task ids are shown as {task …} in the timeline.`);
  if (p.title !== undefined) t.title = p.title;
  if (p.minutes_before_serve !== undefined) t.startOffsetMin = p.minutes_before_serve;
  if (p.duration_minutes !== undefined) {
    if (p.duration_minutes > 0) t.durationMin = p.duration_minutes;
    else delete t.durationMin;
  }
  if (p.dish !== undefined) {
    const id = dishIdFor(plan, p.dish);
    if (id) t.dishId = id;
    else delete t.dishId;
  }
  if (p.notes !== undefined) {
    if (p.notes) t.notes = p.notes;
    else delete t.notes;
  }
}

function deleteTask(plan: Plan, taskId: string): void {
  const i = plan.tasks.findIndex((x) => x.id === taskId);
  if (i < 0) throw new ValidationError(`No task with id '${taskId}'.`);
  plan.tasks.splice(i, 1);
}

function cookText(cook: Cook, now: number): string {
  const v = viewCook(cook, now);
  const dish = new Map(cook.dishes.map((d) => [d.id, d.name]));
  const label = (t: Task) => `${t.dishId && dish.get(t.dishId) ? `[${dish.get(t.dishId)}] ` : ""}${t.title} {task ${t.id}}`;
  const lines = [
    `Cooking: ${cook.name}. Serving in ${fmtDuration((cook.serveAt - now) / MIN)} (${fmtRelative(cook.serveAt - now)}).`,
    `Times below are relative to now, because the server does not know the cook's time zone.`,
    "",
    "NOW:",
    ...(v.now.length
      ? v.now.map((x) => (x.kind === "running" ? `  running, ${fmtRelative(x.at - now)} left: ${label(x.task)}` : `  due (${fmtRelative(x.at - now)}): ${label(x.task)}`))
      : ["  nothing due"]),
    "",
    "NEXT UP:",
    ...(v.next.length ? v.next.map((x) => `  ${fmtRelative(x.at - now)}: ${label(x.task)}${x.task.durationMin ? ` (${fmtDuration(x.task.durationMin)})` : ""}`) : ["  nothing"]),
    "",
    `DONE: ${v.done.length} of ${cook.tasks.length}`,
  ];
  return lines.join("\n");
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

/** Wraps a tool so that expected errors come back as readable tool errors. */
function tool<A>(fn: (args: A) => Promise<string>) {
  return async (args: A) => {
    try {
      return text(await fn(args));
    } catch (e) {
      return { ...text(e instanceof Error ? e.message : "Something went wrong"), isError: true };
    }
  };
}

export function buildMcpServer(svc: Service, now: () => number = Date.now): McpServer {
  const server = new McpServer(
    { name: "recipeplanner", version: "1.0.0" },
    {
      instructions:
        "RecipePlanner holds timed cooking plans. Every task is timed in minutes BEFORE serving " +
        "(minutes_before_serve: 90 means an hour and a half before the food is served). A task with " +
        "duration_minutes runs as a timer. Plan backwards from serving, overlap tasks where the cook " +
        "has free hands, and keep titles short. You cannot start, finish or tick off a cook; the person " +
        "cooking does that in the app.",
    },
  );
  const ro = { readOnlyHint: true };

  server.registerTool("list_recipes", { description: "List all saved recipes with ids, task counts and total length.", inputSchema: {}, annotations: ro },
    tool(async () => {
      const { recipes, cook } = await svc.state();
      if (!recipes.length) return "No recipes yet.";
      const lines = recipes.map((r) => `${r.name} {recipe ${r.id}} — ${r.tasks.length} tasks, ${fmtDuration(Math.max(0, ...r.tasks.map((t) => t.startOffsetMin)))}`);
      return lines.join("\n") + (cook ? `\n\nA cook is in progress: ${cook.name}. Use get_active_cook.` : "");
    }));

  server.registerTool("get_recipe", { description: "Get one recipe as a timeline, including task ids and notes.", inputSchema: { recipe_id: z.string() }, annotations: ro },
    tool(async ({ recipe_id }: { recipe_id: string }) => {
      const r = await svc.recipe(recipe_id);
      const notes = r.tasks.filter((t) => t.notes).map((t) => `{task ${t.id}} notes: ${t.notes}`);
      return [timelineText(r), r.description ? `\nDescription: ${r.description}` : "", r.source ? `Source: ${r.source.url}` : "", notes.length ? "\n" + notes.join("\n") : ""].filter(Boolean).join("\n");
    }));

  server.registerTool("create_recipe",
    {
      description: "Create a recipe with all its tasks in one call. Tasks are timed in minutes before serving.",
      inputSchema: {
        name: z.string(),
        description: z.string().optional(),
        tasks: z.array(taskIn),
        source_url: z.string().optional().describe("Original page, if the recipe was loaded from Planthood"),
      },
    },
    tool(async (a: { name: string; description?: string; tasks: TaskIn[]; source_url?: string }) => {
      const plan: Plan = { dishes: [], tasks: [] };
      plan.tasks = a.tasks.map((t) => toTask(plan, t));
      const r = await svc.saveRecipe({
        name: a.name, description: a.description, ...plan,
        ...(a.source_url ? { source: { kind: "planthood", url: a.source_url, title: a.name } } : {}),
      });
      return `Created.\n\n${timelineText(r)}`;
    }));

  server.registerTool("update_recipe",
    { description: "Rename a recipe, change its description, or rename a dish.", inputSchema: { recipe_id: z.string(), name: z.string().optional(), description: z.string().optional(), rename_dish: z.object({ from: z.string(), to: z.string() }).optional() } },
    tool(async (a: { recipe_id: string; name?: string; description?: string; rename_dish?: { from: string; to: string } }) => {
      const r = await svc.recipe(a.recipe_id);
      if (a.name !== undefined) r.name = a.name;
      if (a.description !== undefined) r.description = a.description;
      if (a.rename_dish) {
        const d = r.dishes.find((x) => x.name.toLowerCase() === a.rename_dish!.from.toLowerCase());
        if (!d) throw new ValidationError(`No dish called '${a.rename_dish.from}'.`);
        d.name = a.rename_dish.to;
      }
      return `Updated.\n\n${timelineText(await svc.saveRecipe(r))}`;
    }));

  server.registerTool("add_tasks", { description: "Add tasks to a recipe.", inputSchema: { recipe_id: z.string(), tasks: z.array(taskIn).min(1) } },
    tool(async (a: { recipe_id: string; tasks: TaskIn[] }) => {
      const r = await svc.recipe(a.recipe_id);
      r.tasks.push(...a.tasks.map((t) => toTask(r, t)));
      return `Added ${a.tasks.length}.\n\n${timelineText(await svc.saveRecipe(r))}`;
    }));

  server.registerTool("update_task",
    { description: "Change one task of a recipe. Only the fields given are changed. duration_minutes 0 removes the timer.", inputSchema: { recipe_id: z.string(), ...taskPatch.shape } },
    tool(async (a: { recipe_id: string } & z.infer<typeof taskPatch>) => {
      const r = await svc.recipe(a.recipe_id);
      patchTask(r, a);
      return `Updated.\n\n${timelineText(await svc.saveRecipe(r))}`;
    }));

  server.registerTool("delete_task", { description: "Remove one task from a recipe.", inputSchema: { recipe_id: z.string(), task_id: z.string() }, annotations: { destructiveHint: true } },
    tool(async (a: { recipe_id: string; task_id: string }) => {
      const r = await svc.recipe(a.recipe_id);
      deleteTask(r, a.task_id);
      return `Deleted.\n\n${timelineText(await svc.saveRecipe(r))}`;
    }));

  server.registerTool("shift_tasks",
    {
      description: "Move all tasks of a recipe, or only one dish's tasks, earlier or later relative to serving.",
      inputSchema: {
        recipe_id: z.string(),
        minutes_earlier: z.number().describe("Positive moves tasks earlier (further from serving); negative moves them later"),
        dish: z.string().optional().describe("Only shift this dish's tasks"),
      },
    },
    tool(async (a: { recipe_id: string; minutes_earlier: number; dish?: string }) => {
      const r = await svc.recipe(a.recipe_id);
      let dishId: string | undefined;
      if (a.dish) {
        dishId = r.dishes.find((d) => d.name.toLowerCase() === a.dish!.toLowerCase())?.id;
        if (!dishId) throw new ValidationError(`No dish called '${a.dish}'.`);
      }
      const hit = r.tasks.filter((t) => !dishId || t.dishId === dishId);
      for (const t of hit) t.startOffsetMin += a.minutes_earlier;
      return `Shifted ${hit.length} tasks.\n\n${timelineText(await svc.saveRecipe(r))}`;
    }));

  server.registerTool("duplicate_recipe", { description: "Copy a recipe.", inputSchema: { recipe_id: z.string(), new_name: z.string().optional() } },
    tool(async (a: { recipe_id: string; new_name?: string }) => `Copied.\n\n${timelineText(await svc.duplicateRecipe(a.recipe_id, a.new_name))}`));

  server.registerTool("delete_recipe", { description: "Delete a recipe permanently. Refused while it is being cooked.", inputSchema: { recipe_id: z.string() }, annotations: { destructiveHint: true } },
    tool(async (a: { recipe_id: string }) => {
      const r = await svc.recipe(a.recipe_id);
      await svc.deleteRecipe(r.id);
      return `Deleted '${r.name}'.`;
    }));

  server.registerTool("get_active_cook", { description: "Live status of the cook in progress: what is due, running, coming up and done.", inputSchema: {}, annotations: ro },
    tool(async () => {
      const { cook } = await svc.state();
      return cook ? cookText(cook, now()) : "No cook is in progress.";
    }));

  server.registerTool("update_active_cook",
    {
      description:
        "Change the cook in progress: delay everything not yet started, or add, change or remove tasks. " +
        "Does not start, finish or tick anything. minutes_before_serve is relative to the current serve time.",
      inputSchema: {
        delay_minutes: z.number().optional().describe("Push the serve time and all pending tasks back by this many minutes (negative to catch up)"),
        add_tasks: z.array(taskIn).optional(),
        update_tasks: z.array(taskPatch).optional(),
        delete_task_ids: z.array(z.string()).optional(),
      },
    },
    tool(async (a: { delay_minutes?: number; add_tasks?: TaskIn[]; update_tasks?: z.infer<typeof taskPatch>[]; delete_task_ids?: string[] }) => {
      let { cook } = await svc.state();
      if (!cook) throw new ValidationError("No cook is in progress.");
      const t = now();
      if (a.add_tasks?.length || a.update_tasks?.length || a.delete_task_ids?.length) {
        const plan: Plan = { dishes: structuredClone(cook.dishes), tasks: structuredClone(cook.tasks) };
        for (const id of a.delete_task_ids ?? []) deleteTask(plan, id);
        for (const p of a.update_tasks ?? []) {
          if (stateOf(cook, p.task_id).status === "done") throw new ValidationError(`Task '${p.task_id}' is already done and cannot be changed.`);
          patchTask(plan, p);
        }
        plan.tasks.push(...(a.add_tasks ?? []).map((x) => toTask(plan, x)));
        cook = await svc.updateCookPlan(plan, cook.id);
      }
      let note = "";
      if (a.delay_minutes) {
        const min = minDelayMin(cook, t);
        if (a.delay_minutes < min) note = `\n(Catch-up limited to ${-min} min so that no upcoming task becomes overdue.)`;
        cook = await svc.cookOps(cook.id, [{ type: "delay", minutes: a.delay_minutes, at: t }]);
      }
      const overdue = cook.tasks.filter((x) => stateOf(cook!, x.id).status === "pending" && dueAt(cook!, x) < t - MIN).length;
      return `Updated.${note}${overdue ? `\n${overdue} task(s) are now overdue.` : ""}\n\n${cookText(cook, t)}`;
    }));

  server.registerTool("fetch_planthood_recipe",
    {
      description:
        "Fetch a Planthood recipe's title and step text from its link (recipes.planthood.co.uk/products/…). " +
        "Timings are only in the prose. Read the steps, then call create_recipe with a sensible overlapped " +
        "timeline, putting each step's full text in the task notes and passing source_url.",
      inputSchema: { url: z.string() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    tool(async (a: { url: string }) => {
      const p = await svc.fetchPlanthood(a.url);
      return [`Title: ${p.title}`, `Source: ${p.url}`, p.intro ? `Intro: ${p.intro}` : "", "", ...p.steps.map((s, i) => `STEP ${i + 1}: ${s}`)].filter((l) => l !== "").join("\n");
    }));

  return server;
}

export async function handleMcp(svc: Service, request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }), {
      status: 405,
      headers: { allow: "POST", "content-type": "application/json" },
    });
  }
  // Stateless: a fresh server and transport per request, plain JSON responses.
  const server = buildMcpServer(svc);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(request);
}

