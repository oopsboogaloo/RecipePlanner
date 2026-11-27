import { applyOp, replaceCookPlan } from "../shared/cook";
import { parsePlanthoodProduct, planthoodJsonUrl, type PlanthoodRecipe } from "../shared/planthood";
import { newId } from "../shared/timing";
import type { AppState, Cook, CookOp, Recipe } from "../shared/types";
import { cleanRecipe, ValidationError } from "../shared/validate";
import type { Store } from "./store";

export class NotFoundError extends Error {}
export class ConflictError extends Error {}

const MAX_REMEMBERED_OPS = 1000;

export class Service {
  constructor(
    public store: Store,
    private fetcher: typeof fetch = fetch,
  ) {}

  async state(): Promise<AppState> {
    const [recipes, cook] = await Promise.all([this.store.listRecipes(), this.store.getActiveCook()]);
    return { recipes, cook };
  }

  async recipe(id: string): Promise<Recipe> {
    const r = await this.store.getRecipe(id);
    if (!r) throw new NotFoundError(`No recipe with id '${id}'. Use list_recipes to see what exists.`);
    return r;
  }

  async saveRecipe(input: unknown, now = Date.now()): Promise<Recipe> {
    const r = cleanRecipe(input, now);
    await this.store.putRecipe(r);
    return r;
  }

  async deleteRecipe(id: string): Promise<void> {
    const cook = await this.store.getActiveCook();
    if (cook?.recipeId === id) {
      throw new ConflictError("That recipe is being cooked right now; finish or abandon the cook before deleting it.");
    }
    await this.store.deleteRecipe(id);
  }

  async duplicateRecipe(id: string, name?: string): Promise<Recipe> {
    const src = await this.recipe(id);
    const { source: _source, ...rest } = src;
    return this.saveRecipe({ ...rest, id: newId(), name: name ?? `${src.name} (copy)` });
  }

  /** The phone creates the cook (so starting works offline) and uploads it. Idempotent per cook id. */
  async startCook(input: Cook): Promise<Cook> {
    const active = await this.store.getActiveCook();
    if (active && active.id !== input?.id) throw new ConflictError("Another cook is already in progress.");
    if (active) return active;
    if (!input || typeof input.id !== "string" || !Number.isFinite(input.serveAt) || !Number.isFinite(input.startedAt)) {
      throw new ValidationError("cook is missing its id or times");
    }
    const plan = cleanRecipe({ id: input.recipeId, name: input.name, dishes: input.dishes, tasks: input.tasks });
    if (!plan.tasks.length) throw new ValidationError("a cook needs at least one task");
    const cook: Cook = {
      id: input.id.slice(0, 40),
      recipeId: plan.id,
      name: plan.name,
      dishes: plan.dishes,
      tasks: plan.tasks,
      startedAt: input.startedAt,
      serveAt: input.serveAt,
      status: "active",
      taskState: {},
      rev: 1,
    };
    await this.store.putCook(cook);
    return cook;
  }

  private async activeCook(cookId?: string): Promise<Cook> {
    const cook = await this.store.getActiveCook();
    if (!cook || (cookId !== undefined && cook.id !== cookId)) throw new NotFoundError("There is no cook in progress.");
    return cook;
  }

  /**
   * Read-change-write on the live cook. The write only succeeds if nobody else
   * changed the cook in between; otherwise the change is re-applied to the
   * fresh copy, so a tick and a plan edit arriving together both survive.
   */
  private async mutateCook(cookId: string | undefined, change: (cook: Cook) => Cook): Promise<Cook> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const cook = await this.activeCook(cookId);
      const next = { ...change(cook), rev: cook.rev + 1 };
      if (await this.store.putCook(next, cook.rev)) return next;
    }
    throw new ConflictError("The cook is being changed by something else; try again.");
  }

  async cookOps(cookId: string, ops: CookOp[]): Promise<Cook> {
    if (!Array.isArray(ops) || ops.length > 500) throw new ValidationError("bad operations");
    for (const op of ops) {
      if (!op || typeof op.type !== "string" || !Number.isFinite(op.at)) throw new ValidationError("bad operation");
      if ((op.type === "delay" || op.type === "extend") && !Number.isFinite(op.minutes)) throw new ValidationError("bad operation");
    }
    return this.mutateCook(cookId, (cook) => {
      // The phone re-sends a batch if it never saw our reply; skip what was already applied.
      const applied = new Set(cook.applied ?? []);
      const order = [...(cook.applied ?? [])];
      for (const op of ops) {
        if (typeof op.id === "string") {
          if (applied.has(op.id)) continue;
          applied.add(op.id);
          order.push(op.id.slice(0, 40));
        }
        cook = applyOp(cook, op);
      }
      return { ...cook, applied: order.slice(-MAX_REMEMBERED_OPS) };
    });
  }

  /** Replace the live cook's dishes and tasks, keeping tick state. */
  async updateCookPlan(plan: { dishes: unknown; tasks: unknown }, cookId?: string): Promise<Cook> {
    const first = await this.activeCook(cookId);
    const clean = cleanRecipe({ id: first.recipeId, name: first.name, dishes: plan.dishes, tasks: plan.tasks });
    return this.mutateCook(cookId, (cook) => replaceCookPlan(cook, clean));
  }

  async fetchPlanthood(link: string): Promise<PlanthoodRecipe> {
    const jsonUrl = planthoodJsonUrl(String(link ?? ""));
    if (!jsonUrl) {
      throw new ValidationError("That is not a Planthood recipe link. It should look like https://recipes.planthood.co.uk/products/…");
    }
    let res: Response;
    try {
      res = await this.fetcher(jsonUrl, { headers: { accept: "application/json", "user-agent": "RecipePlanner/1 (personal recipe import)" }, redirect: "error" });
    } catch {
      throw new ValidationError("Could not reach Planthood. Check the connection, or paste the recipe text instead.");
    }
    if (!res.ok) throw new ValidationError(`Planthood did not return that recipe (HTTP ${res.status}). Check the link, or paste the recipe text instead.`);
    const text = await res.text();
    if (text.length > 500_000) throw new ValidationError("That page is too large to be a recipe.");
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new ValidationError("Planthood returned something that is not a recipe. Paste the recipe text instead.");
    }
    try {
      return parsePlanthoodProduct(json, link.trim().split(/[?#]/)[0]);
    } catch (e) {
      throw new ValidationError((e as Error).message);
    }
  }
}
