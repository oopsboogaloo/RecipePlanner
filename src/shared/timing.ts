import type { Recipe, Task } from "./types";

export const MIN = 60_000;

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Total length of a plan: the earliest task start, in minutes before serve. */
export function planLengthMin(tasks: Task[]): number {
  return tasks.reduce((m, t) => Math.max(m, t.startOffsetMin), 0);
}

/** Minutes before serve at which a timed task ends (negative = after serving). */
export function endOffsetMin(t: Task): number {
  return t.startOffsetMin - (t.durationMin ?? 0);
}

/** Tasks in the order they happen: earliest first, stable for equal times. */
export function sortTasks<T extends Task>(tasks: T[]): T[] {
  return tasks
    .map((t, i) => ({ t, i }))
    .sort((a, b) => b.t.startOffsetMin - a.t.startOffsetMin || a.i - b.i)
    .map((x) => x.t);
}

/** "4 h 30 m", "45 m", "0 m". */
export function fmtDuration(min: number): string {
  const m = Math.round(Math.abs(min));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h} h ${r} m`;
  if (h) return `${h} h`;
  return `${r} m`;
}

/** "−1:30" for 90 minutes before serve, "0:00" at serve, "+0:05" after. */
export function fmtOffset(min: number): string {
  const m = Math.abs(Math.round(min));
  const s = `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
  return min > 0 ? `−${s}` : min < 0 ? `+${s}` : s;
}

/** Wall-clock "15:05". */
export function fmtClock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Countdown "1:02:03" / "12:05" from milliseconds (never negative). */
export function fmtCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "in 12 min", "in 1 h 5 m", "now", "3 min late". */
export function fmtRelative(ms: number): string {
  const min = Math.round(ms / MIN);
  if (min === 0) return "now";
  if (min > 0) return min < 60 ? `in ${min} min` : `in ${fmtDuration(min)}`;
  return -min < 60 ? `${-min} min late` : `${fmtDuration(-min)} late`;
}

/** Plain-text timeline, used in connector results so Claude can read a plan back. */
export function timelineText(r: Pick<Recipe, "name" | "dishes" | "tasks">, serveAt?: number): string {
  const dish = new Map(r.dishes.map((d) => [d.id, d.name]));
  const lines = sortTasks(r.tasks).map((t) => {
    const when = serveAt === undefined ? fmtOffset(t.startOffsetMin) : fmtClock(serveAt - t.startOffsetMin * MIN);
    const d = t.dishId && dish.get(t.dishId) ? `[${dish.get(t.dishId)}] ` : "";
    const dur = t.durationMin ? ` (${fmtDuration(t.durationMin)})` : "";
    return `${when}  ${d}${t.title}${dur}  {task ${t.id}}`;
  });
  const head = `${r.name} — ${r.tasks.length} tasks, ${fmtDuration(planLengthMin(r.tasks))} before serving`;
  return [head, ...lines].join("\n");
}
