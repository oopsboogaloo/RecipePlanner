import { useState } from "preact/hooks";
import { dueAt, minDelayMin, stateOf, viewCook } from "../shared/cook";
import { fmtClock, fmtCountdown, fmtDuration, fmtRelative } from "../shared/timing";
import type { Cook, Task } from "../shared/types";
import { activeCook, cookOp, setHeadsUp, toast, useStore } from "./store";
import { Confirm, DishTag, go, Sheet, Stepper, useNow } from "./ui";

/** Tick a task, with a 10-second undo. */
export function tick(cook: Cook, task: Task) {
  const was = stateOf(cook, task.id).status;
  cookOp({ type: "tick", taskId: task.id, at: Date.now() });
  const label = was === "pending" && task.durationMin ? `Started: ${task.title}` : `Done: ${task.title}`;
  toast(label, { label: "Undo", run: () => cookOp({ type: "undo", taskId: task.id, at: Date.now() }) }, 10_000);
}

export function CookScreen() {
  const s = useStore();
  // Re-render every second, but always draw with the exact current time so a
  // timer started a moment ago never shows more than its full length.
  useNow(1000);
  const now = Date.now();
  const cook = activeCook(s);
  const [detail, setDetail] = useState<string | null>(null);
  const [delaying, setDelaying] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<"finish" | "abandon" | null>(null);

  if (!cook) {
    return (
      <div class="screen">
        <header class="top"><button class="icon-btn" aria-label="Back" onClick={() => go("")}>←</button><h1>No cook in progress</h1></header>
        <main class="content"><p class="empty">Open a recipe and press Start cooking.</p></main>
      </div>
    );
  }

  const v = viewCook(cook, now);
  const dish = (t: Task) => cook.dishes.find((d) => d.id === t.dishId);
  const detailTask = cook.tasks.find((t) => t.id === detail);
  const end = (type: "finish" | "abandon") => {
    cookOp({ type, at: Date.now() });
    go("");
    toast(type === "finish" ? "Cook finished. Enjoy!" : "Cook abandoned");
  };

  return (
    <div class="screen cook">
      <header class="top">
        <button class="icon-btn" aria-label="Back to recipes" onClick={() => go("")}>←</button>
        <div class="clock">
          <span class="clock-now">{fmtClock(now)}</span>
          <span class="clock-serve">Serve {fmtClock(cook.serveAt)} <span class="nowrap">· {fmtRelative(cook.serveAt - now)}</span></span>
        </div>
        <button class="btn small" onClick={() => setDelaying(true)}>Delay</button>
        <button class="icon-btn" aria-label="More" onClick={() => setMenu(true)}>⋯</button>
      </header>

      <main class="content split">
        <section class="pane" aria-label="Now">
          <h2 class="section">Now</h2>
          {v.allDone && (
            <div class="now-card done-card">
              <strong>All done — enjoy!</strong>
              <button class="btn primary big" onClick={() => end("finish")}>Finish cook</button>
            </div>
          )}
          {!v.allDone && v.now.length === 0 && (
            <div class="now-card idle">
              {v.next.length ? (
                <>
                  <span class="idle-label">Nothing to do right now. Next task in</span>
                  <span class="countdown">{fmtCountdown(v.next[0].at - now)}</span>
                  <span class="idle-label">{v.next[0].task.title}</span>
                </>
              ) : (
                <span class="idle-label">Nothing to do right now.</span>
              )}
            </div>
          )}
          {v.now.map(({ task, state, at, kind }) => {
            const over = kind === "running" && at <= now;
            return (
              <article key={task.id} class={`now-card ${kind} ${over ? "over" : ""} ${kind === "due" && now - at > 60_000 ? "late" : ""}`} style={{ "--dish": dish(task)?.colour ?? "var(--accent)" }}>
                <button class="now-main" onClick={() => setDetail(task.id)} aria-label={`Details: ${task.title}`}>
                  <span class="meta"><DishTag dish={dish(task)} />{kind === "due" ? <span>Due {fmtClock(at)} · {fmtRelative(at - now)}</span> : <span>{over ? "Time's up" : `Until ${fmtClock(at)}`}</span>}</span>
                  <span class="now-title">{task.title}</span>
                  {kind === "running" && <span class="countdown">{over ? "0:00" : fmtCountdown(at - now)}</span>}
                </button>
                <div class="now-actions">
                  {kind === "running" && (
                    <>
                      <button class="btn" onClick={() => cookOp({ type: "extend", taskId: task.id, minutes: 1, at: Date.now() })}>+1 min</button>
                      <button class="btn" onClick={() => cookOp({ type: "extend", taskId: task.id, minutes: 5, at: Date.now() })}>+5 min</button>
                    </>
                  )}
                  <button class="btn primary big" onClick={() => tick(cook, task)}>
                    {kind === "running" ? "Done" : task.durationMin ? `Start · ${fmtDuration(task.durationMin)} timer` : "Done"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <section class="pane" aria-label="Next up">
          <h2 class="section">Next up</h2>
          {v.next.length === 0 && <p class="empty small">Nothing left to start.</p>}
          <ol class="next">
            {v.next.map(({ task, at }) => (
              <li key={task.id}>
                <button class="next-row" style={{ "--dish": dish(task)?.colour ?? "var(--line)" }} onClick={() => setDetail(task.id)}>
                  <span class="when">{fmtClock(at)}<small>{fmtRelative(at - now)}</small></span>
                  <span class="what">
                    <span class="task-title">{task.title}</span>
                    <span class="meta"><DishTag dish={dish(task)} />{task.durationMin ? <span class="dur">⏱ {fmtDuration(task.durationMin)}</span> : null}</span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {v.done.length > 0 && (
            <details class="done">
              <summary>Done ({v.done.length})</summary>
              <ol class="next">
                {v.done.map(({ task, state }) => (
                  <li key={task.id}>
                    <button class="next-row dim" style={{ "--dish": dish(task)?.colour ?? "var(--line)" }} onClick={() => setDetail(task.id)}>
                      <span class="when">✓<small>{state.doneAt ? fmtClock(state.doneAt) : ""}</small></span>
                      <span class="what"><span class="task-title">{task.title}</span></span>
                    </button>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </section>
      </main>

      {detailTask && <TaskDetail cook={cook} task={detailTask} now={now} onClose={() => setDetail(null)} />}
      {delaying && <DelaySheet cook={cook} now={now} onClose={() => setDelaying(false)} />}
      {menu && (
        <Sheet title={cook.name} onClose={() => setMenu(false)}>
          <div class="stack">
            <button class="btn" onClick={() => { setMenu(false); go("cook/edit"); }}>Edit plan</button>
            <label class="check">
              <input type="checkbox" checked={s.headsUp} onChange={(e) => setHeadsUp(e.currentTarget.checked)} />
              <span>Chime 2 minutes before each task</span>
            </label>
            <button class="btn" onClick={() => { setMenu(false); setConfirm("finish"); }}>Finish cook</button>
            <button class="btn danger" onClick={() => { setMenu(false); setConfirm("abandon"); }}>Abandon cook</button>
          </div>
        </Sheet>
      )}
      {confirm === "finish" && <Confirm title="Finish cook?" body={v.allDone ? "Everything is ticked off." : `${cook.tasks.length - v.done.length} tasks are not ticked off yet.`} yes="Finish" onYes={() => end("finish")} onClose={() => setConfirm(null)} />}
      {confirm === "abandon" && <Confirm title="Abandon cook?" body="The timers stop and progress is discarded. The recipe itself is kept." yes="Abandon" danger onYes={() => end("abandon")} onClose={() => setConfirm(null)} />}
    </div>
  );
}

function TaskDetail(props: { cook: Cook; task: Task; now: number; onClose: () => void }) {
  const { cook, task, now } = props;
  const st = stateOf(cook, task.id);
  const dish = cook.dishes.find((d) => d.id === task.dishId);
  const act = (fn: () => void) => { fn(); props.onClose(); };
  return (
    <Sheet title={task.title} onClose={props.onClose}>
      <p class="meta">
        <DishTag dish={dish} />
        {st.status === "pending" && <span>Due {fmtClock(dueAt(cook, task))} · {fmtRelative(dueAt(cook, task) - now)}</span>}
        {st.status === "running" && <span>Running until {fmtClock(st.endsAt!)}</span>}
        {st.status === "done" && <span>Done{st.doneAt ? ` at ${fmtClock(st.doneAt)}` : ""}</span>}
        {task.durationMin ? <span class="dur">⏱ {fmtDuration(task.durationMin)}</span> : null}
      </p>
      {task.notes ? <p class="notes">{task.notes}</p> : <p class="hint">No notes for this task.</p>}
      <div class="row">
        {st.status !== "pending" && <button class="btn" onClick={() => act(() => cookOp({ type: "undo", taskId: task.id, at: Date.now() }))}>{st.status === "done" ? "Undo" : "Stop timer"}</button>}
        {st.status !== "done" && (
          <button class="btn primary" onClick={() => act(() => tick(cook, task))}>
            {st.status === "running" ? "Done" : task.durationMin ? "Start timer now" : "Mark done"}
          </button>
        )}
      </div>
    </Sheet>
  );
}

function DelaySheet(props: { cook: Cook; now: number; onClose: () => void }) {
  const [custom, setCustom] = useState(10);
  const limit = minDelayMin(props.cook, props.now);
  const delay = (minutes: number) => {
    cookOp({ type: "delay", minutes, at: Date.now() });
    props.onClose();
    toast(minutes > 0 ? `Everything moved ${minutes} min later` : `Everything moved ${-minutes} min earlier`, { label: "Undo", run: () => cookOp({ type: "delay", minutes: -minutes, at: Date.now() }) }, 10_000);
  };
  return (
    <Sheet title="Running late?" onClose={props.onClose}>
      <p>Moves every task you haven't started, and the serve time. Running timers are not affected.</p>
      <div class="row">
        <button class="btn primary big" onClick={() => delay(5)}>+5 min</button>
        <button class="btn primary big" onClick={() => delay(15)}>+15 min</button>
      </div>
      <div class="field">
        <span>Another amount</span>
        <Stepper label="Delay by" value={custom} onChange={setCustom} min={1} />
        <button class="btn" onClick={() => delay(custom)}>Delay {fmtDuration(custom)}</button>
      </div>
      <div class="field">
        <span>Ahead of schedule?</span>
        <button class="btn" disabled={limit > -5} onClick={() => delay(-5)}>Bring everything 5 min earlier</button>
        {limit > -5 && <small class="hint">Not possible: the next task is less than 5 minutes away.</small>}
      </div>
    </Sheet>
  );
}
