import { useState } from "preact/hooks";
import { viewCook } from "../shared/cook";
import { christmasRoast } from "../shared/example";
import { htmlToText, planthoodToRecipe, splitSteps } from "../shared/planthood";
import { fmtDuration, fmtRelative, newId, planLengthMin } from "../shared/timing";
import type { Recipe } from "../shared/types";
import { activeCook, importPlanthood, saveRecipe, setDraft, useStore } from "./store";
import { go, Sheet, useNow } from "./ui";

export function Home() {
  const s = useStore();
  const now = useNow(5000);
  const cook = activeCook(s);
  const [importing, setImporting] = useState(false);

  const create = () => {
    const r: Recipe = { id: newId(), name: "New recipe", dishes: [], tasks: [], updatedAt: Date.now() };
    saveRecipe(r);
    go(`r/${r.id}`);
  };
  const addExample = () => {
    const r = { ...christmasRoast(), id: newId() };
    saveRecipe(r);
    go(`r/${r.id}`);
  };

  let banner = null;
  if (cook) {
    const v = viewCook(cook, now);
    const line = v.now.length
      ? `Now: ${v.now[0].task.title}`
      : v.next.length
        ? `Next: ${v.next[0].task.title} ${fmtRelative(v.next[0].at - now)}`
        : "Everything is done";
    banner = (
      <button class="cook-banner" onClick={() => go("cook")}>
        <strong>Cooking now — {cook.name}</strong>
        <span>{line}</span>
      </button>
    );
  }

  return (
    <div class="screen">
      <header class="top">
        <h1>RecipePlanner</h1>
        {s.net === "offline" && <span class="pill warn">Offline — saved on this phone</span>}
      </header>
      <main class="content split">
        <div class="pane">
          {banner}
          {s.draft && (
            <button class="card draft" onClick={() => go("draft")}>
              <strong>Unsaved import: {s.draft.name}</strong>
              <span>Tap to check the timings and save</span>
            </button>
          )}
          {s.recipes.length === 0 && s.loaded && (
            <div class="empty">
              <p>No recipes yet. Create one, import one, or start from the example.</p>
              <button class="btn" onClick={addExample}>Add the Christmas roast example</button>
            </div>
          )}
          <ul class="list">
            {s.recipes.map((r) => (
              <li key={r.id}>
                <button class="card" onClick={() => go(`r/${r.id}`)}>
                  <strong>{r.name}</strong>
                  <span>{r.tasks.length} {r.tasks.length === 1 ? "task" : "tasks"} · {fmtDuration(planLengthMin(r.tasks))}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </main>
      <footer class="bar">
        <button class="btn" onClick={() => setImporting(true)}>Import from Planthood</button>
        <button class="btn primary" onClick={create}>New recipe</button>
      </footer>
      {importing && <ImportSheet onClose={() => setImporting(false)} />}
    </div>
  );
}

function ImportSheet(props: { onClose: () => void }) {
  const [mode, setMode] = useState<"link" | "text">("link");
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const open = (r: Recipe) => {
    setDraft(r);
    props.onClose();
    go("draft");
  };
  const fromLink = async () => {
    setBusy(true);
    setError("");
    try {
      open(await importPlanthood(url));
    } catch (e) {
      setError((e as Error).message);
      setMode("text");
    } finally {
      setBusy(false);
    }
  };
  const fromText = () => {
    const { intro, steps } = splitSteps(htmlToText(text));
    if (!steps.length) return setError("Paste the recipe's steps first.");
    open(planthoodToRecipe({ title: title.trim() || "Imported recipe", url: url.trim(), intro, steps }));
  };
  const paste = async () => {
    try {
      setUrl((await navigator.clipboard.readText()).trim());
    } catch {
      setError("Could not read the clipboard; paste into the box instead.");
    }
  };

  return (
    <Sheet title="Import from Planthood" onClose={props.onClose}>
      {error && <p class="error" role="alert">{error}</p>}
      {mode === "link" ? (
        <>
          <label class="field">
            <span>Recipe link</span>
            <input type="url" inputMode="url" placeholder="https://recipes.planthood.co.uk/products/…" value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
          </label>
          <div class="row">
            <button class="btn" onClick={paste}>Paste from clipboard</button>
            <button class="btn primary" disabled={!url.trim() || busy} onClick={fromLink}>{busy ? "Loading…" : "Load recipe"}</button>
          </div>
          <button class="link" onClick={() => setMode("text")}>Paste recipe text instead</button>
        </>
      ) : (
        <>
          <label class="field">
            <span>Recipe name</span>
            <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Recipe text (with its STEP headings)</span>
            <textarea rows={8} value={text} onInput={(e) => setText(e.currentTarget.value)} />
          </label>
          <div class="row">
            <button class="btn" onClick={() => { setMode("link"); setError(""); }}>Use a link</button>
            <button class="btn primary" onClick={fromText}>Create draft</button>
          </div>
        </>
      )}
    </Sheet>
  );
}
