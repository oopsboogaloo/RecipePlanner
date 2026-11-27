// Sound, vibration and keeping the screen awake.

let ctx: AudioContext | undefined;

/** Must be called from a tap: browsers only allow sound after a user gesture. */
export function unlockAudio() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state !== "running") void ctx.resume();
  } catch {}
}

export const audioReady = () => ctx?.state === "running";

function tones(notes: [freq: number, at: number, len: number][], volume = 0.5) {
  (window as any).__rpSounds = ((window as any).__rpSounds ?? 0) + 1;
  if (!ctx || ctx.state !== "running") return;
  const t0 = ctx.currentTime + 0.02;
  for (const [freq, at, len] of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, t0 + at);
    gain.gain.linearRampToValueAtTime(volume, t0 + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + at + len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + at);
    osc.stop(t0 + at + len + 0.05);
  }
}

export const sounds = {
  /** Rising three notes: something needs starting. */
  start: () => tones([[660, 0, 0.25], [880, 0.28, 0.25], [1175, 0.56, 0.5], [660, 1.3, 0.25], [880, 1.58, 0.25], [1175, 1.86, 0.5]]),
  /** Falling pairs: a timer has finished. */
  finish: () => tones([[1175, 0, 0.2], [784, 0.22, 0.4], [1175, 0.8, 0.2], [784, 1.02, 0.4], [1175, 1.6, 0.2], [784, 1.82, 0.6]]),
  /** One soft note: something is coming up. */
  headsUp: () => tones([[784, 0, 0.6]], 0.25),
};

export function vibrate(pattern: number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

let lock: { release(): Promise<void>; released?: boolean } | null = null;
let want = false;

async function acquire() {
  if (!want || document.visibilityState !== "visible" || (lock && !lock.released)) return;
  try {
    lock = await (navigator as any).wakeLock?.request("screen");
  } catch {
    lock = null;
  }
}

/** Keep the screen on while a cook is running; re-acquired whenever the page becomes visible. */
export function keepAwake(on: boolean) {
  want = on;
  if (on) void acquire();
  else {
    void lock?.release().catch(() => {});
    lock = null;
  }
}

document.addEventListener("visibilitychange", () => void acquire());
