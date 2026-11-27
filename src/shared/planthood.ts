import type { Recipe, Task } from "./types";
import { newId } from "./timing";

export const PLANTHOOD_HOSTS = ["recipes.planthood.co.uk", "planthood.co.uk", "www.planthood.co.uk"];

export interface PlanthoodRecipe {
  title: string;
  url: string;
  intro?: string;
  steps: string[];
}

/** Returns the JSON endpoint for a Planthood recipe link, or null if the link is not one. */
export function planthoodJsonUrl(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !PLANTHOOD_HOSTS.includes(u.hostname)) return null;
  const m = u.pathname.match(/\/products\/([a-z0-9][a-z0-9-]*)/i);
  if (!m) return null;
  return `https://${u.hostname}/products/${m[1]}.json`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/h\d|\/li|\/div|hr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();
}

/** Splits a recipe's text into its intro and its "STEP n" blocks. */
export function splitSteps(text: string): { intro?: string; steps: string[] } {
  const parts = text.split(/(?:^|\n)\s*STEP\s*\d+\s*[:.\-–]?\s*(?:\n|$)/i);
  if (parts.length < 2) {
    // No STEP headings: treat each paragraph as a step.
    const paras = text.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    return { steps: paras };
  }
  const clean = (s: string) => s.replace(/\s*\n\s*/g, " ").trim();
  const intro = clean(parts[0]);
  return { intro: intro || undefined, steps: parts.slice(1).map(clean).filter(Boolean) };
}

export function parsePlanthoodProduct(json: any, url: string): PlanthoodRecipe {
  const p = json?.product ?? json;
  if (!p || typeof p.title !== "string" || typeof p.body_html !== "string") {
    throw new Error("That page does not look like a Planthood recipe.");
  }
  const { intro, steps } = splitSteps(htmlToText(p.body_html));
  if (!steps.length) throw new Error("No cooking steps were found on that page.");
  return { title: p.title.trim(), url, intro, steps };
}

const DURATION = /(\d+(?:\.\d+)?)(?:\s*(?:-|–|to)\s*(\d+(?:\.\d+)?))?\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/gi;

/**
 * Minutes of timed cooking stated in a step. Uses the upper value of a range,
 * adds up successive timings, and ignores sentences describing an alternative
 * method ("If you don't have…", "alternatively…").
 */
export function stepDurationMin(step: string): number | undefined {
  let total = 0;
  for (const sentence of step.split(/(?<=[.!?])\s+/)) {
    if (/^\s*if you (don't|do not|dont)\b|alternativ/i.test(sentence)) continue;
    for (const m of sentence.matchAll(DURATION)) {
      const n = Number(m[2] ?? m[1]);
      const unit = m[3].toLowerCase();
      total += unit.startsWith("h") ? n * 60 : unit.startsWith("s") ? n / 60 : n;
    }
  }
  return total > 0 ? Math.max(1, Math.ceil(total)) : undefined;
}

export function stepTitle(step: string): string {
  const first = step.split(/(?<=[.!?])\s+/)[0].replace(/[.!?]+$/, "").trim();
  return first.length <= 70 ? first : first.slice(0, 67).replace(/\s+\S*$/, "") + "…";
}

/** Default hands-on time for a step that states no time. */
export const DEFAULT_STEP_MIN = 2;

/**
 * Rule-based draft: one task per step, laid end to end, then converted to
 * "minutes before serve". Timings need checking by the cook.
 */
export function planthoodToRecipe(src: PlanthoodRecipe, now = Date.now()): Recipe {
  const lengths = src.steps.map((s) => stepDurationMin(s));
  const total = lengths.reduce<number>((a, l) => a + (l ?? DEFAULT_STEP_MIN), 0);
  let elapsed = 0;
  const tasks: Task[] = src.steps.map((step, i) => {
    const t: Task = { id: newId(), title: stepTitle(step), startOffsetMin: total - elapsed, notes: step };
    if (lengths[i]) t.durationMin = lengths[i];
    elapsed += lengths[i] ?? DEFAULT_STEP_MIN;
    return t;
  });
  return {
    id: newId(),
    name: src.title.length > 100 ? src.title.slice(0, 99) + "…" : src.title,
    description: src.intro,
    dishes: [],
    tasks,
    source: { kind: "planthood", url: src.url, title: src.title, importedAt: now },
    updatedAt: now,
  };
}
