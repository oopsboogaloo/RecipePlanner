import { DISH_COLOURS, type Dish, type Recipe, type Task } from "./types";
import { endOffsetMin, newId } from "./timing";

export class ValidationError extends Error {}

const MAX_OFFSET = 7 * 24 * 60;

function str(v: unknown, what: string, max: number, required = true): string | undefined {
  if (v === undefined || v === null || v === "") {
    if (required) throw new ValidationError(`${what} is required`);
    return undefined;
  }
  if (typeof v !== "string") throw new ValidationError(`${what} must be text`);
  const s = v.trim();
  if (!s && required) throw new ValidationError(`${what} is required`);
  if (s.length > max) throw new ValidationError(`${what} is too long (max ${max} characters)`);
  return s || undefined;
}

function int(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new ValidationError(`${what} must be a number of minutes`);
  const n = Math.round(v);
  if (n < min || n > max) throw new ValidationError(`${what} must be between ${min} and ${max} minutes`);
  return n;
}

export function cleanDish(d: any, index = 0): Dish {
  const colour = typeof d?.colour === "string" && /^#[0-9a-fA-F]{6}$/.test(d.colour)
    ? d.colour
    : DISH_COLOURS[index % DISH_COLOURS.length];
  return { id: str(d?.id, "dish id", 40, false) ?? newId(), name: str(d?.name, "dish name", 40)!, colour };
}

export function cleanTask(t: any, dishIds: Set<string>): Task {
  const title = str(t?.title, "task title", 120)!;
  const startOffsetMin = int(t?.startOffsetMin, `'${title}' start time`, 0, MAX_OFFSET);
  const out: Task = { id: str(t?.id, "task id", 40, false) ?? newId(), title, startOffsetMin };
  if (t?.durationMin !== undefined && t.durationMin !== null && t.durationMin !== 0) {
    out.durationMin = int(t.durationMin, `'${title}' duration`, 1, MAX_OFFSET);
    if (endOffsetMin(out) < 0) {
      throw new ValidationError(
        `task '${title}' ends after serving: it starts ${startOffsetMin} min before serve but lasts ${out.durationMin} min`,
      );
    }
  }
  const dishId = str(t?.dishId, "dish", 40, false);
  if (dishId) {
    if (!dishIds.has(dishId)) throw new ValidationError(`task '${title}' refers to a dish that does not exist`);
    out.dishId = dishId;
  }
  const notes = str(t?.notes, `'${title}' notes`, 4000, false);
  if (notes) out.notes = notes;
  return out;
}

/** Validates and normalises a recipe from untrusted input. Throws ValidationError in plain language. */
export function cleanRecipe(input: any, now = Date.now()): Recipe {
  if (!input || typeof input !== "object") throw new ValidationError("recipe is missing");
  const dishesIn: any[] = Array.isArray(input.dishes) ? input.dishes : [];
  if (dishesIn.length > 30) throw new ValidationError("a recipe can have at most 30 dishes");
  const dishes = dishesIn.map(cleanDish);
  const dishIds = new Set(dishes.map((d) => d.id));
  if (dishIds.size !== dishes.length) throw new ValidationError("two dishes share the same id");
  const tasksIn: any[] = Array.isArray(input.tasks) ? input.tasks : [];
  if (tasksIn.length > 300) throw new ValidationError("a recipe can have at most 300 tasks");
  const tasks = tasksIn.map((t) => cleanTask(t, dishIds));
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length) throw new ValidationError("two tasks share the same id");
  const out: Recipe = {
    id: str(input.id, "recipe id", 40, false) ?? newId(),
    name: str(input.name, "recipe name", 100)!,
    dishes,
    tasks,
    updatedAt: now,
  };
  const description = str(input.description, "description", 2000, false);
  if (description) out.description = description;
  const s = input.source;
  if (s && s.kind === "planthood" && typeof s.url === "string") {
    out.source = {
      kind: "planthood",
      url: s.url.slice(0, 500),
      title: String(s.title ?? "").slice(0, 300),
      importedAt: Number(s.importedAt) || now,
    };
  }
  return out;
}
