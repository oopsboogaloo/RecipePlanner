import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { viewCook } from "../shared/cook";
import { MIN } from "../shared/timing";
import type { Task } from "../shared/types";
import { audioReady, keepAwake, sounds, unlockAudio, vibrate } from "./alerts";
import { CookScreen, tick } from "./CookScreen";
import { Editor } from "./Editor";
import { Home } from "./Home";
import { ack, activeCook, BASE, getState, startSync, useStore } from "./store";
import { go, Toasts, useNow, useRoute } from "./ui";
import "./styles.css";

interface Alert {
  key: string;
  task: Task;
  kind: "start" | "finish";
}

const REPEAT_MS = 30_000;
const HEADS_UP_MS = 2 * MIN;

/** Works out what needs attention, and makes noise about it until acknowledged. */
function useAlerts(): { alerts: Alert[]; soundBlocked: boolean } {
  const s = useStore();
  const now = useNow(1000);
  const cook = activeCook(s);
  const lastSound = useRef(0);
  const sounded = useRef(new Set<string>());

  const alerts: Alert[] = [];
  let headsUp: string | null = null;
  if (cook) {
    const v = viewCook(cook, now);
    for (const x of v.now) {
      const kind = x.kind === "due" ? "start" : "finish";
      if (x.kind === "running" && x.at > now) continue;
      const key = `${cook.id}:${x.task.id}:${kind}`;
      if (!s.acks[key]) alerts.push({ key, task: x.task, kind });
    }
    for (const x of v.next) {
      const key = `${cook.id}:${x.task.id}:soon`;
      if (x.at - now <= HEADS_UP_MS && !s.acks[key]) headsUp = key;
    }
  }

  useEffect(() => keepAwake(!!cook), [!!cook]);

  useEffect(() => {
    const fresh = alerts.filter((a) => !sounded.current.has(a.key));
    if (alerts.length && (fresh.length || now - lastSound.current >= REPEAT_MS)) {
      fresh.forEach((a) => sounded.current.add(a.key));
      lastSound.current = now;
      (fresh[0] ?? alerts[0]).kind === "finish" ? sounds.finish() : sounds.start();
      vibrate([400, 150, 400, 150, 400]);
    } else if (headsUp) {
      if (getState().headsUp && !alerts.length) {
        sounds.headsUp();
        vibrate([150]);
      }
      ack(headsUp);
    }
    document.title = alerts.length ? `⏰ ${alerts[0].task.title}` : cook ? `Cooking — ${cook.name}` : "RecipePlanner";
  });

  return { alerts, soundBlocked: !!cook && !audioReady() };
}

function AlertBanner(props: { alerts: Alert[] }) {
  const cook = activeCook(useStore());
  const a = props.alerts[0];
  if (!a || !cook) return null;
  return (
    <div class={`alert ${a.kind}`} role="alert">
      <button class="alert-text" onClick={() => go("cook")}>
        <small>{a.kind === "start" ? "Time to start" : "Timer finished"}{props.alerts.length > 1 ? ` · ${props.alerts.length - 1} more` : ""}</small>
        <strong>{a.task.title}</strong>
      </button>
      <div class="alert-actions">
        <button class="btn" onClick={() => ack(a.key)}>Got it</button>
        <button class="btn primary" onClick={() => tick(cook, a.task)}>{a.kind === "start" && a.task.durationMin ? "Start" : "Done"}</button>
      </div>
    </div>
  );
}

function App() {
  const route = useRoute();
  const { alerts, soundBlocked } = useAlerts();
  const [, refresh] = useState(0);

  let screen;
  if (route === "cook") screen = <CookScreen />;
  else if (route === "cook/edit") screen = <Editor mode="cook" />;
  else if (route === "draft") screen = <Editor mode="draft" />;
  else if (route.startsWith("r/")) screen = <Editor mode="recipe" id={route.slice(2)} key={route} />;
  else screen = <Home />;

  return (
    <div class={alerts.length ? "app alerting" : "app"} onPointerDown={unlockAudio}>
      <AlertBanner alerts={alerts} />
      {soundBlocked && (
        <button class="sound-bar" onClick={() => { unlockAudio(); setTimeout(() => refresh((n) => n + 1), 300); }}>
          🔇 Tap to enable sound alerts
        </button>
      )}
      {screen}
      <Toasts />
    </div>
  );
}

render(<App />, document.getElementById("app")!);
startSync();
if ("serviceWorker" in navigator && BASE !== "/") void navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE }).catch(() => {});
