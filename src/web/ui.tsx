import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { fmtDuration } from "../shared/timing";
import type { Dish } from "../shared/types";
import { dismissToast, useStore } from "./store";

export function go(route: string) {
  location.hash = route;
}

export function useRoute(): string {
  const [route, setRoute] = useState(location.hash.slice(1));
  useEffect(() => {
    const on = () => setRoute(location.hash.slice(1));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Current time, re-rendering every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** Bottom sheet on a narrow screen; right-hand pane on a wide one. */
export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren; label?: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && props.onClose();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [props.onClose]);
  return (
    <div class="sheet-wrap">
      <div class="backdrop" onClick={props.onClose} />
      <section class="sheet" role="dialog" aria-modal="true" aria-label={props.label ?? props.title}>
        <header class="sheet-head">
          <h2>{props.title}</h2>
          <button class="icon-btn" aria-label="Close" onClick={props.onClose}>✕</button>
        </header>
        <div class="sheet-body">{props.children}</div>
      </section>
    </div>
  );
}

/** Minutes picker made of big buttons rather than a keyboard field. */
export function Stepper(props: { label: string; value: number; onChange: (v: number) => void; min?: number; zeroLabel?: string }) {
  const min = props.min ?? 0;
  const bump = (d: number) => props.onChange(Math.max(min, Math.min(7 * 24 * 60, props.value + d)));
  const btn = (d: number) => (
    <button type="button" class="step" onClick={() => bump(d)} disabled={d < 0 && props.value <= min} aria-label={`${props.label}: ${d > 0 ? "add" : "take off"} ${fmtDuration(d)}`}>
      {d > 0 ? "+" : "−"}{Math.abs(d) >= 60 ? `${Math.abs(d) / 60}h` : Math.abs(d)}
    </button>
  );
  return (
    <div class="stepper" role="group" aria-label={props.label}>
      <div class="stepper-value" aria-live="polite">{props.value === 0 && props.zeroLabel ? props.zeroLabel : fmtDuration(props.value)}</div>
      <div class="stepper-row">{btn(-60)}{btn(-15)}{btn(-5)}{btn(-1)}</div>
      <div class="stepper-row">{btn(60)}{btn(15)}{btn(5)}{btn(1)}</div>
    </div>
  );
}

export function DishTag(props: { dish?: Dish }) {
  if (!props.dish) return null;
  return (
    <span class="dish-tag" style={{ "--dish": props.dish.colour }}>
      {props.dish.name}
    </span>
  );
}

export function Toasts() {
  const { toasts } = useStore();
  if (!toasts.length) return null;
  return (
    <div class="toasts" role="status">
      {toasts.map((t) => (
        <div class="toast" key={t.id}>
          <span>{t.text}</span>
          {t.action && (
            <button onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>
  );
}

export function Confirm(props: { title: string; body: string; yes: string; danger?: boolean; onYes: () => void; onClose: () => void }) {
  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <p>{props.body}</p>
      <div class="row">
        <button class="btn" onClick={props.onClose}>Cancel</button>
        <button class={`btn ${props.danger ? "danger" : "primary"}`} onClick={() => { props.onYes(); props.onClose(); }}>{props.yes}</button>
      </div>
    </Sheet>
  );
}
