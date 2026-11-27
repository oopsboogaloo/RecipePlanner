import type { Cook, CookOp, Recipe, Task, TaskState } from "./types";
import { MIN, newId, planLengthMin } from "./timing";

export function stateOf(cook: Cook, taskId: string): TaskState {
  return cook.taskState[taskId] ?? { status: "pending" };
}

export function dueAt(cook: Cook, task: Task): number {
  return cook.serveAt - task.startOffsetMin * MIN;
}

/** Serve time if cooking starts at `now`. */
export function serveAtForStart(recipe: Pick<Recipe, "tasks">, now: number): number {
  return now + planLengthMin(recipe.tasks) * MIN;
}

/** Start time needed to serve at `serveAt`. */
export function startForServeAt(recipe: Pick<Recipe, "tasks">, serveAt: number): number {
  return serveAt - planLengthMin(recipe.tasks) * MIN;
}

export function startCook(recipe: Recipe, serveAt: number, now: number): Cook {
  return {
    id: newId(),
    recipeId: recipe.id,
    name: recipe.name,
    dishes: structuredClone(recipe.dishes),
    tasks: structuredClone(recipe.tasks),
    startedAt: now,
    serveAt,
    status: "active",
    taskState: {},
    rev: 0,
  };
}

/**
 * Most negative delay allowed at `now`: pulling the schedule earlier must not
 * push a pending task that is still in the future into the past.
 */
export function minDelayMin(cook: Cook, now: number): number {
  let slack = Infinity;
  for (const t of cook.tasks) {
    if (stateOf(cook, t.id).status !== "pending") continue;
    const ahead = dueAt(cook, t) - now;
    if (ahead > 0) slack = Math.min(slack, ahead);
  }
  return slack === Infinity ? 0 : -Math.floor(slack / MIN);
}

/** Pure reducer: the phone and the server both apply operations with this. */
export function applyOp(cook: Cook, op: CookOp): Cook {
  if (cook.status !== "active") return cook;
  const next: Cook = { ...cook, taskState: { ...cook.taskState } };
  switch (op.type) {
    case "tick": {
      const task = cook.tasks.find((t) => t.id === op.taskId);
      if (!task) return cook;
      const s = stateOf(cook, task.id);
      if (s.status === "pending" && task.durationMin) {
        next.taskState[task.id] = { status: "running", startedAt: op.at, endsAt: op.at + task.durationMin * MIN };
      } else if (s.status !== "done") {
        next.taskState[task.id] = { ...s, status: "done", doneAt: op.at };
      }
      return next;
    }
    case "undo": {
      const s = stateOf(cook, op.taskId);
      if (s.status === "done" && s.endsAt !== undefined) {
        next.taskState[op.taskId] = { status: "running", startedAt: s.startedAt, endsAt: s.endsAt };
      } else {
        delete next.taskState[op.taskId];
      }
      return next;
    }
    case "delay": {
      const minutes = Math.max(Math.round(op.minutes), minDelayMin(cook, op.at));
      next.serveAt = cook.serveAt + minutes * MIN;
      return next;
    }
    case "extend": {
      const s = stateOf(cook, op.taskId);
      if (s.status !== "running" || s.endsAt === undefined) return cook;
      next.taskState[op.taskId] = { ...s, endsAt: Math.max(op.at, s.endsAt) + Math.round(op.minutes) * MIN };
      return next;
    }
    case "finish":
      next.status = "finished";
      return next;
    case "abandon":
      next.status = "abandoned";
      return next;
  }
}

export interface CookView {
  /** Due or overdue pending tasks, and running timers, most urgent first. */
  now: { task: Task; state: TaskState; at: number; kind: "due" | "running" }[];
  /** Pending tasks not yet due, soonest first. */
  next: { task: Task; at: number }[];
  done: { task: Task; state: TaskState }[];
  allDone: boolean;
}

export function viewCook(cook: Cook, now: number): CookView {
  const v: CookView = { now: [], next: [], done: [], allDone: false };
  for (const task of cook.tasks) {
    const state = stateOf(cook, task.id);
    if (state.status === "done") v.done.push({ task, state });
    else if (state.status === "running") v.now.push({ task, state, at: state.endsAt ?? now, kind: "running" });
    else {
      const at = dueAt(cook, task);
      if (at <= now) v.now.push({ task, state, at, kind: "due" });
      else v.next.push({ task, at });
    }
  }
  v.now.sort((a, b) => a.at - b.at);
  v.next.sort((a, b) => a.at - b.at);
  v.done.sort((a, b) => (b.state.doneAt ?? 0) - (a.state.doneAt ?? 0));
  v.allDone = cook.tasks.length > 0 && v.done.length === cook.tasks.length;
  return v;
}

/**
 * Replace the task list of a live cook (an edit from the editor or from Claude)
 * while keeping tick state for tasks that still exist.
 */
export function replaceCookPlan(cook: Cook, plan: Pick<Recipe, "dishes" | "tasks">): Cook {
  const ids = new Set(plan.tasks.map((t) => t.id));
  const taskState: Cook["taskState"] = {};
  for (const [id, s] of Object.entries(cook.taskState)) if (ids.has(id)) taskState[id] = s;
  return { ...cook, dishes: plan.dishes, tasks: plan.tasks, taskState };
}
