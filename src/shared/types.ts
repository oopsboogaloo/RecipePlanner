export interface Dish {
  id: string;
  name: string;
  colour: string;
}

export interface Task {
  id: string;
  title: string;
  dishId?: string;
  /** Minutes before serving that the task starts (>= 0). */
  startOffsetMin: number;
  /** If set, the task runs as a timer and has an end alert. */
  durationMin?: number;
  notes?: string;
}

export interface RecipeSource {
  kind: "planthood";
  url: string;
  title: string;
  importedAt: number;
}

export interface Recipe {
  id: string;
  name: string;
  description?: string;
  dishes: Dish[];
  tasks: Task[];
  source?: RecipeSource;
  updatedAt: number;
}

export type TaskStatus = "pending" | "running" | "done";

export interface TaskState {
  status: TaskStatus;
  startedAt?: number;
  endsAt?: number;
  doneAt?: number;
}

export interface Cook {
  id: string;
  recipeId: string;
  name: string;
  dishes: Dish[];
  tasks: Task[];
  startedAt: number;
  serveAt: number;
  status: "active" | "finished" | "abandoned";
  taskState: Record<string, TaskState>;
  /** Bumped on every server-side change. */
  rev: number;
}

/** Operations the phone sends during a cook. All carry the time they happened. */
export type CookOp =
  | { type: "tick"; taskId: string; at: number }
  | { type: "undo"; taskId: string; at: number }
  | { type: "delay"; minutes: number; at: number }
  | { type: "extend"; taskId: string; minutes: number; at: number }
  | { type: "finish"; at: number }
  | { type: "abandon"; at: number };

export interface AppState {
  recipes: Recipe[];
  cook: Cook | null;
}

export const DISH_COLOURS = [
  "#c2410c", "#b45309", "#4d7c0f", "#0f766e", "#1d4ed8", "#7e22ce", "#be185d", "#525252",
];
