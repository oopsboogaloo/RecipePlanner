// Used by the Deploy workflow: makes sure the D1 database exists and writes its
// id into wrangler.jsonc for this run (the change is not committed).
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const NAME = "recipeplanner";
const PLACEHOLDER = "00000000-0000-0000-0000-000000000000";
const wrangler = (...args) => execFileSync("npx", ["wrangler", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });

/** `wrangler d1 list --json` may print notices around the JSON; take the array. */
export function findDatabaseId(listOutput, name) {
  // Notices can contain "[" too, so try each one until the rest parses as a list.
  let dbs;
  for (let i = listOutput.indexOf("["); i >= 0 && !dbs; i = listOutput.indexOf("[", i + 1)) {
    try {
      const parsed = JSON.parse(listOutput.slice(i, listOutput.lastIndexOf("]") + 1));
      if (Array.isArray(parsed)) dbs = parsed;
    } catch {}
  }
  if (!dbs) throw new Error("Could not read the database list from wrangler.");
  return dbs.find((d) => d.name === name)?.uuid ?? null;
}

export function setDatabaseId(config, id) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error(`Unexpected database id: ${id}`);
  if (!config.includes(PLACEHOLDER)) throw new Error("wrangler.jsonc no longer contains the placeholder database id.");
  return config.replace(PLACEHOLDER, id);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let id = findDatabaseId(wrangler("d1", "list", "--json"), NAME);
  if (!id) {
    console.log(`Creating D1 database '${NAME}'`);
    wrangler("d1", "create", NAME);
    id = findDatabaseId(wrangler("d1", "list", "--json"), NAME);
  }
  if (!id) throw new Error(`Database '${NAME}' was not found after creating it.`);
  writeFileSync("wrangler.jsonc", setDatabaseId(readFileSync("wrangler.jsonc", "utf8"), id));
  console.log(`Using D1 database '${NAME}' (${id})`);
}
