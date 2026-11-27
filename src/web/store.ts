import { useEffect, useState } from "preact/hooks";
import { applyOp, replaceCookPlan, startCook as makeCook } from "../shared/cook";
import type { Cook, CookOp, Dish, Recipe, Task } from "../shared/types";

/** `/a/<secret>/` — everything the app talks to lives under it. */
export const BASE = location.pathname.match(/^\/a\/[^/]+\//)?.[0] ?? "/";
const KEY = `rp:${BASE}`;

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  until: number;
}

interface Persisted {
  recipes: Recipe[];
  cook: Cook | null;
  /** Recipe ids changed on this phone and not yet saved to the server. */
  dirty: string[];
  deleted: string[];
  /** Cook operations not yet sent. */
  ops: CookOp[];
  cookUnsent: boolean;
  planDirty: boolean;
  /** An imported recipe that has not been confirmed yet. Never synced. */
  draft: Recipe | null;
  /** Alerts acknowledged or already chimed, keyed `<cookId>:<taskId>:<kind>`. */
  acks: Record<string, true>;
  headsUp: boolean;
}

export interface State extends Persisted {
  net: "ok" | "offline";
  loaded: boolean;
  toasts: Toast[];
}

const blank: Persisted = {
  recipes: [], cook: null, dirty: [], deleted: [], ops: [], cookUnsent: false, planDirty: false, draft: null, acks: {}, headsUp: true,
};

function load(): State {
  let saved: Partial<Persisted> = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {}
  return { ...blank, ...saved, net: "ok", loaded: false, toasts: [] };
}

let S: State = load();
const listeners = new Set<() => void>();

function set(patch: Partial<State>) {
  S = { ...S, ...patch };
  const { net: _n, loaded: _l, toasts: _t, ...persisted } = S;
  try {
    localStorage.setItem(KEY, JSON.stringify(persisted));
  } catch {}
  listeners.forEach((l) => l());
}

export const getState = () => S;

export function useStore(): State {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return S;
}

export const activeCook = (s: State): Cook | null => (s.cook?.status === "active" ? s.cook : null);

// ---------- toasts ----------

let toastId = 0;
export function toast(text: string, action?: Toast["action"], ms = 4000) {
  const t: Toast = { id: ++toastId, text, action, until: Date.now() + ms };
  set({ toasts: [t] });
  setTimeout(() => set({ toasts: S.toasts.filter((x) => x.id !== t.id) }), ms);
}
export const dismissToast = (id: number) => set({ toasts: S.toasts.filter((x) => x.id !== id) });

// ---------- recipes ----------

export function saveRecipe(r: Recipe) {
  const next = { ...r, updatedAt: Date.now() };
  const exists = S.recipes.some((x) => x.id === r.id);
  set({
    recipes: exists ? S.recipes.map((x) => (x.id === r.id ? next : x)) : [...S.recipes, next],
    dirty: S.dirty.includes(r.id) ? S.dirty : [...S.dirty, r.id],
    deleted: S.deleted.filter((id) => id !== r.id),
  });
  syncSoon();
}

export function deleteRecipe(id: string) {
  set({ recipes: S.recipes.filter((r) => r.id !== id), dirty: S.dirty.filter((d) => d !== id), deleted: [...S.deleted, id] });
  syncSoon();
}

export const setDraft = (draft: Recipe | null) => set({ draft });

// ---------- cook ----------

export function startCook(recipe: Recipe, serveAt: number) {
  set({ cook: makeCook(recipe, serveAt, Date.now()), ops: [], cookUnsent: true, planDirty: false, acks: {} });
  syncSoon(0);
}

export function cookOp(op: CookOp) {
  if (!S.cook) return;
  set({ cook: applyOp(S.cook, op), ops: [...S.ops, op] });
  syncSoon(0);
}

export function editCookPlan(plan: { dishes: Dish[]; tasks: Task[] }) {
  if (!S.cook) return;
  set({ cook: replaceCookPlan(S.cook, plan), planDirty: true });
  syncSoon();
}

export const ack = (key: string) => set({ acks: { ...S.acks, [key]: true } });
export const setHeadsUp = (headsUp: boolean) => set({ headsUp });

// ---------- sync ----------

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}api${path}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

export async function importPlanthood(url: string): Promise<Recipe> {
  let res: { status: number; data: any };
  try {
    res = await call("POST", "/planthood", { url });
  } catch {
    throw new Error("You appear to be offline. Paste the recipe text instead.");
  }
  if (res.status !== 200) throw new Error(res.data?.error ?? "Could not load that recipe.");
  return res.data.recipe as Recipe;
}

let syncing = false;
let again = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export function syncSoon(ms = 800) {
  clearTimeout(timer);
  timer = setTimeout(sync, ms);
}

export async function sync(): Promise<void> {
  if (syncing) {
    again = true;
    return;
  }
  syncing = true;
  try {
    for (const id of [...S.deleted]) {
      await call("DELETE", `/recipes/${id}`);
      set({ deleted: S.deleted.filter((d) => d !== id) });
    }
    for (const id of [...S.dirty]) {
      const rec = S.recipes.find((r) => r.id === id);
      const res = rec ? await call("PUT", `/recipes/${id}`, rec) : null;
      const unchanged = S.recipes.find((r) => r.id === id)?.updatedAt === rec?.updatedAt;
      if (!res || ((res.status === 200 || res.status === 400) && unchanged)) set({ dirty: S.dirty.filter((d) => d !== id) });
      if (res?.status === 400) toast(`Could not save: ${res.data?.error}`, undefined, 8000);
    }
    if (S.cook && S.cookUnsent) {
      const res = await call("POST", "/cook", S.cook);
      if (res.status === 200) set({ cookUnsent: false });
      else if (res.status === 409) {
        set({ cook: null, ops: [], cookUnsent: false, planDirty: false });
        toast("Another cook was already in progress, so that one is shown instead.", undefined, 8000);
      } else if (res.status === 400) {
        set({ cook: null, ops: [], cookUnsent: false, planDirty: false });
        toast(`Could not start: ${res.data?.error}`, undefined, 8000);
      }
    }
    if (S.cook && !S.cookUnsent && S.planDirty) {
      const res = await call("PUT", "/cook/plan", { cookId: S.cook.id, dishes: S.cook.dishes, tasks: S.cook.tasks });
      if (res.status !== 500) set({ planDirty: false });
      if (res.status === 400) toast(`Could not save: ${res.data?.error}`, undefined, 8000);
    }
    if (S.cook && !S.cookUnsent && S.ops.length) {
      const batch = S.ops;
      const res = await call("POST", "/cook/ops", { cookId: S.cook.id, ops: batch });
      if (res.status === 200 || res.status === 404) set({ ops: S.ops.slice(batch.length) });
    }
    const res = await call("GET", "/state");
    if (res.status === 200) merge(res.data.recipes, res.data.cook);
    set({ net: "ok", loaded: true });
  } catch {
    set({ net: "offline", loaded: true });
  } finally {
    syncing = false;
    if (again) {
      again = false;
      syncSoon(0);
    }
  }
}

function merge(serverRecipes: Recipe[], serverCook: Cook | null) {
  const keep = new Set(S.dirty);
  const gone = new Set(S.deleted);
  const recipes = serverRecipes.filter((r) => !keep.has(r.id) && !gone.has(r.id)).concat(S.recipes.filter((r) => keep.has(r.id)));
  recipes.sort((a, b) => a.name.localeCompare(b.name));
  const patch: Partial<State> = { recipes };
  if (!S.cookUnsent && !S.planDirty && !S.ops.length) {
    const prev = activeCook(S);
    if (prev && serverCook && prev.id === serverCook.id && prev.rev !== serverCook.rev) {
      if (JSON.stringify(prev.tasks) !== JSON.stringify(serverCook.tasks) || prev.serveAt !== serverCook.serveAt) toast("Plan updated");
    }
    patch.cook = serverCook;
  }
  set(patch);
}

export function startSync() {
  sync();
  setInterval(() => document.visibilityState === "visible" && sync(), 30_000);
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && sync());
  addEventListener("online", () => sync());
}
