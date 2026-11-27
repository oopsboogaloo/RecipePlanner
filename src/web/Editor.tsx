import { useState } from "preact/hooks";
import { serveAtForStart, startForServeAt, stateOf } from "../shared/cook";
import { endOffsetMin, fmtClock, fmtDuration, fmtOffset, MIN, newId, planLengthMin, sortTasks } from "../shared/timing";
import { DISH_COLOURS, type Cook, type Dish, type Recipe, type Task } from "../shared/types";
import { cleanTask } from "../shared/validate";
import { unlockAudio } from "./alerts";
import { activeCook, deleteRecipe, editCookPlan, saveRecipe, setDraft, startCook, toast, useStore } from "./store";
import { Confirm, DishTag, go, Sheet, Stepper } from "./ui";

type Mode = "recipe" | "draft" | "cook";
type Plan = Pick<Recipe, "name" | "description" | "dishes" | "tasks">;

export function Editor(props: { mode: Mode; id?: string }) {
  const s = useStore();
  const cook = activeCook(s);
  const recipe = props.mode === "recipe" ? s.recipes.find((r) => r.id === props.id) : props.mode === "draft" ? s.draft : null;
  const plan: Plan | null | undefined = props.mode === "cook" ? cook : recipe;

  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [dishEdit, setDishEdit] = useState<Dish | "new" | null>(null);
  const [starting, setStarting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!plan) {
    return (
      <div class="screen">
        <header class="top"><button class="icon-btn" aria-label="Back" onClick={() => go("")}>←</button><h1>Not found</h1></header>
        <main class="content"><p class="empty">{s.loaded ? "That recipe no longer exists." : "Loading…"}</p></main>
      </div>
    );
  }

  const change = (patch: Partial<Plan>) => {
    const next = { ...plan, ...patch };
    if (props.mode === "cook") editCookPlan({ dishes: next.dishes, tasks: next.tasks });
    else if (props.mode === "draft") setDraft({ ...(recipe as Recipe), ...next });
    else saveRecipe({ ...(recipe as Recipe), ...next });
  };

  const dishOf = (t: Task) => plan.dishes.find((d) => d.id === t.dishId);
  const tasks = sortTasks(plan.tasks);
  const back = () => go(props.mode === "cook" ? "cook" : "");

  const saveTask = (t: Task) => {
    change({ tasks: plan.tasks.some((x) => x.id === t.id) ? plan.tasks.map((x) => (x.id === t.id ? t : x)) : [...plan.tasks, t] });
    setEditing(null);
  };
  const removeTask = (id: string) => {
    const before = plan.tasks;
    change({ tasks: plan.tasks.filter((x) => x.id !== id) });
    setEditing(null);
    toast("Task deleted", { label: "Undo", run: () => change({ tasks: before }) }, 10_000);
  };
  const saveDish = (d: Dish) => {
    change({ dishes: plan.dishes.some((x) => x.id === d.id) ? plan.dishes.map((x) => (x.id === d.id ? d : x)) : [...plan.dishes, d] });
    setDishEdit(null);
  };
  const removeDish = (id: string) => {
    change({ dishes: plan.dishes.filter((d) => d.id !== id), tasks: plan.tasks.map(({ dishId, ...t }) => (dishId === id ? t : { ...t, dishId })) });
    setDishEdit(null);
  };
  const saveDraft = () => {
    const r = recipe as Recipe;
    saveRecipe(r);
    setDraft(null);
    go(`r/${r.id}`);
    toast("Recipe saved");
  };

  return (
    <div class={`screen ${editing ? "has-side" : ""}`}>
      <header class="top">
        <button class="icon-btn" aria-label="Back" onClick={back}>←</button>
        {props.mode === "cook" ? (
          <h1>Edit plan — {plan.name}</h1>
        ) : (
          <input class="title-input" aria-label="Recipe name" value={plan.name} onChange={(e) => change({ name: e.currentTarget.value.trim() || "Untitled" })} />
        )}
        {props.mode === "recipe" && <button class="icon-btn" aria-label="More" onClick={() => setMenu(true)}>⋯</button>}
      </header>

      <main class="content">
        <div class="main-pane">
          {props.mode === "draft" && (
            <div class="notice" role="note">
              <strong>Check timings.</strong> Imported from Planthood by simple rules: steps are laid end to end, so move anything that can overlap.
            </div>
          )}
          {props.mode === "cook" && <div class="notice" role="note">Changes apply to the cook in progress only, not the saved recipe.</div>}
          {props.mode !== "cook" && (
            <textarea class="desc" aria-label="Description" rows={2} placeholder="Description (optional)" value={plan.description ?? ""} onChange={(e) => change({ description: e.currentTarget.value.trim() || undefined })} />
          )}

          <div class="chips" aria-label="Dishes">
            {plan.dishes.map((d) => (
              <button class="chip" key={d.id} style={{ "--dish": d.colour }} onClick={() => setDishEdit(d)}>{d.name}</button>
            ))}
            <button class="chip add" onClick={() => setDishEdit("new")}>+ Dish</button>
          </div>

          <div class="summary">{tasks.length} {tasks.length === 1 ? "task" : "tasks"} · starts {fmtDuration(planLengthMin(tasks))} before serving</div>
          {tasks.length === 0 && <p class="empty">No tasks yet. Add the first one below.</p>}
          <ol class="timeline">
            {tasks.map((t) => {
              const d = dishOf(t);
              const done = props.mode === "cook" && cook && stateOf(cook, t.id).status !== "pending";
              return (
                <li key={t.id}>
                  <button class={`task-row ${editing !== "new" && editing?.id === t.id ? "selected" : ""} ${done ? "dim" : ""}`} style={{ "--dish": d?.colour ?? "var(--line)" }} onClick={() => setEditing(t)}>
                    <span class="when">
                      {fmtOffset(t.startOffsetMin)}
                      {t.durationMin ? <small>ends {fmtOffset(endOffsetMin(t))}</small> : null}
                    </span>
                    <span class="what">
                      <span class="task-title">{t.title}</span>
                      <span class="meta">
                        <DishTag dish={d} />
                        {t.durationMin ? <span class="dur">⏱ {fmtDuration(t.durationMin)}</span> : null}
                        {t.notes ? <span class="dur">notes</span> : null}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {props.mode !== "cook" && recipe?.source && (
            <p class="source">Imported from <a href={recipe.source.url} target="_blank" rel="noreferrer noopener">Planthood</a></p>
          )}
        </div>
      </main>

      <footer class="bar">
        <button class="btn" onClick={() => setEditing("new")}>+ Add task</button>
        {props.mode === "recipe" && <button class="btn primary" disabled={!tasks.length} onClick={() => setStarting(true)}>Start cooking</button>}
        {props.mode === "draft" && (
          <>
            <button class="btn" onClick={() => { setDraft(null); go(""); }}>Discard</button>
            <button class="btn primary" onClick={saveDraft}>Save recipe</button>
          </>
        )}
        {props.mode === "cook" && <button class="btn primary" onClick={back}>Back to cooking</button>}
      </footer>

      {editing && (
        <TaskSheet key={editing === "new" ? "new" : editing.id} task={editing === "new" ? null : editing} dishes={plan.dishes} onSave={saveTask} onDelete={removeTask} onClose={() => setEditing(null)} />
      )}
      {dishEdit && (
        <DishSheet key={dishEdit === "new" ? "new" : dishEdit.id} dish={dishEdit === "new" ? null : dishEdit} count={plan.dishes.length} onSave={saveDish} onDelete={removeDish} onClose={() => setDishEdit(null)} />
      )}
      {starting && recipe && <StartSheet recipe={recipe} busy={cook} onClose={() => setStarting(false)} />}
      {menu && recipe && (
        <Sheet title={recipe.name} onClose={() => setMenu(false)}>
          <div class="stack">
            <button class="btn" onClick={() => {
              const copy = { ...recipe, id: newId(), name: `${recipe.name} (copy)`, source: undefined };
              saveRecipe(copy);
              setMenu(false);
              go(`r/${copy.id}`);
              toast("Recipe duplicated");
            }}>Duplicate</button>
            <button class="btn danger" onClick={() => { setMenu(false); setConfirmDelete(true); }}>Delete recipe</button>
          </div>
        </Sheet>
      )}
      {confirmDelete && recipe && (
        cook?.recipeId === recipe.id
          ? <Confirm title="Can't delete yet" body="This recipe is being cooked right now. Finish or abandon the cook first." yes="OK" onYes={() => {}} onClose={() => setConfirmDelete(false)} />
          : <Confirm title="Delete recipe?" body={`"${recipe.name}" will be removed for good.`} yes="Delete" danger onYes={() => { deleteRecipe(recipe.id); go(""); }} onClose={() => setConfirmDelete(false)} />
      )}
    </div>
  );
}

function TaskSheet(props: { task: Task | null; dishes: Dish[]; onSave: (t: Task) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const t = props.task;
  const [title, setTitle] = useState(t?.title ?? "");
  const [dishId, setDishId] = useState(t?.dishId);
  const [start, setStart] = useState(t?.startOffsetMin ?? 30);
  const [timed, setTimed] = useState(!!t?.durationMin);
  const [duration, setDuration] = useState(t?.durationMin ?? 10);
  const [notes, setNotes] = useState(t?.notes ?? "");
  const [error, setError] = useState("");

  const save = () => {
    try {
      props.onSave(cleanTask({ id: t?.id, title, dishId, startOffsetMin: start, durationMin: timed ? duration : undefined, notes }, new Set(props.dishes.map((d) => d.id))));
    } catch (e) {
      setError((e as Error).message.replace(/^task /, "Task ").replace(/^'.*?' /, "The ") + ".");
    }
  };

  return (
    <Sheet title={t ? "Edit task" : "New task"} onClose={props.onClose}>
      <label class="field">
        <span>What to do</span>
        <input value={title} placeholder="e.g. Potatoes on to boil" onInput={(e) => setTitle(e.currentTarget.value)} />
      </label>
      {props.dishes.length > 0 && (
        <div class="field">
          <span>Dish</span>
          <div class="chips">
            <button class={`chip ${!dishId ? "on" : ""}`} aria-pressed={!dishId} onClick={() => setDishId(undefined)}>General</button>
            {props.dishes.map((d) => (
              <button key={d.id} class={`chip ${dishId === d.id ? "on" : ""}`} aria-pressed={dishId === d.id} style={{ "--dish": d.colour }} onClick={() => setDishId(d.id)}>{d.name}</button>
            ))}
          </div>
        </div>
      )}
      <div class="field">
        <span>Starts before serving</span>
        <Stepper label="Starts before serving" value={start} onChange={setStart} zeroLabel="At serving" />
      </div>
      <label class="check">
        <input type="checkbox" checked={timed} onChange={(e) => setTimed(e.currentTarget.checked)} />
        <span>Runs for a set time (alert me when it finishes)</span>
      </label>
      {timed && (
        <div class="field">
          <span>Runs for</span>
          <Stepper label="Runs for" value={duration} onChange={setDuration} min={1} />
          <small class={start - duration < 0 ? "error" : "hint"}>
            {start - duration < 0 ? `Ends ${fmtDuration(duration - start)} after serving — start it earlier or shorten it.` : `Ends ${fmtOffset(start - duration)} (${fmtDuration(start - duration)} before serving)`}
          </small>
        </div>
      )}
      <label class="field">
        <span>Notes</span>
        <textarea rows={3} value={notes} placeholder="Temperatures, quantities, method" onInput={(e) => setNotes(e.currentTarget.value)} />
      </label>
      {error && <p class="error" role="alert">{error}</p>}
      <div class="row">
        {t && <button class="btn danger" onClick={() => props.onDelete(t.id)}>Delete</button>}
        <button class="btn primary" onClick={save}>Save task</button>
      </div>
    </Sheet>
  );
}

function DishSheet(props: { dish: Dish | null; count: number; onSave: (d: Dish) => void; onDelete: (id: string) => void; onClose: () => void }) {
  const [name, setName] = useState(props.dish?.name ?? "");
  const [colour, setColour] = useState(props.dish?.colour ?? DISH_COLOURS[props.count % DISH_COLOURS.length]);
  return (
    <Sheet title={props.dish ? "Edit dish" : "New dish"} onClose={props.onClose}>
      <label class="field">
        <span>Name</span>
        <input value={name} placeholder="e.g. Potatoes" maxLength={40} onInput={(e) => setName(e.currentTarget.value)} />
      </label>
      <div class="field">
        <span>Colour</span>
        <div class="swatches">
          {DISH_COLOURS.map((c) => (
            <button key={c} class={`swatch ${c === colour ? "on" : ""}`} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={c === colour} onClick={() => setColour(c)} />
          ))}
        </div>
      </div>
      <div class="row">
        {props.dish && <button class="btn danger" onClick={() => props.onDelete(props.dish!.id)}>Delete</button>}
        <button class="btn primary" disabled={!name.trim()} onClick={() => props.onSave({ id: props.dish?.id ?? newId(), name: name.trim(), colour })}>Save dish</button>
      </div>
    </Sheet>
  );
}

function StartSheet(props: { recipe: Recipe; busy: Cook | null; onClose: () => void }) {
  const { recipe } = props;
  const [mode, setMode] = useState<"now" | "serve">("now");
  const now = Date.now();
  const defaultServe = serveAtForStart(recipe, now) + 30 * MIN;
  const [time, setTime] = useState(fmtClock(Math.ceil(defaultServe / (5 * MIN)) * 5 * MIN));

  if (props.busy) {
    return (
      <Sheet title="Start cooking" onClose={props.onClose}>
        <p>You are already cooking <strong>{props.busy.name}</strong>. Finish that cook before starting another.</p>
        <button class="btn primary" onClick={() => go("cook")}>Go to the cook</button>
      </Sheet>
    );
  }

  // The chosen clock time, today, or tomorrow if that time has already passed.
  const [hh, mm] = time.split(":").map(Number);
  const picked = new Date(now);
  picked.setHours(hh || 0, mm || 0, 0, 0);
  if (picked.getTime() <= now) picked.setDate(picked.getDate() + 1);
  const earliest = serveAtForStart(recipe, now);
  const serveAt = mode === "now" ? earliest : picked.getTime();
  const startAt = startForServeAt(recipe, serveAt);
  const overdue = recipe.tasks.filter((t) => serveAt - t.startOffsetMin * MIN < now - MIN).length;
  const day = (ts: number) => (new Date(ts).toDateString() === new Date(now).toDateString() ? "" : " tomorrow");

  const start = (at: number) => {
    unlockAudio();
    startCook(recipe, at);
    props.onClose();
    go("cook");
  };

  return (
    <Sheet title="Start cooking" onClose={props.onClose}>
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected={mode === "now"} class={mode === "now" ? "on" : ""} onClick={() => setMode("now")}>Start now</button>
        <button role="tab" aria-selected={mode === "serve"} class={mode === "serve" ? "on" : ""} onClick={() => setMode("serve")}>Set serve time</button>
      </div>
      {mode === "serve" && (
        <label class="field">
          <span>Serve at</span>
          <input class="time-input" type="time" value={time} onInput={(e) => setTime(e.currentTarget.value)} />
        </label>
      )}
      <dl class="times">
        <div><dt>Start</dt><dd>{mode === "now" || startAt <= now ? "Now" : fmtClock(startAt) + day(startAt)}</dd></div>
        <div><dt>Serve</dt><dd>{fmtClock(serveAt)}{day(serveAt)}</dd></div>
      </dl>
      {mode === "serve" && overdue > 0 && (
        <div class="notice warn" role="alert">
          That is too soon: {overdue} {overdue === 1 ? "task is" : "tasks are"} already overdue. The earliest you can serve is {fmtClock(earliest)}.
          <button class="btn" onClick={() => start(earliest)}>Serve at {fmtClock(earliest)} instead</button>
        </div>
      )}
      <button class="btn primary big" onClick={() => start(serveAt)}>
        {mode === "now" ? `Start — dinner at ${fmtClock(serveAt)}` : overdue ? "Start anyway" : startAt <= now ? "Start now" : `Start — first task at ${fmtClock(startAt)}`}
      </button>
    </Sheet>
  );
}
