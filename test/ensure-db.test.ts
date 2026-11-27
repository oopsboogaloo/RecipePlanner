import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS helper used by the Deploy workflow
import { findDatabaseId, setDatabaseId } from "../scripts/ensure-db.mjs";

describe("deploy helper", () => {
  const id = "3f2c1a9e-1111-2222-3333-444455556666";
  it("finds the database id in wrangler's output, ignoring notices", () => {
    const out = `▲ [WARNING] something\n\n[\n {"uuid":"${id}","name":"recipeplanner"},{"uuid":"x","name":"other"}\n]\n`;
    expect(findDatabaseId(out, "recipeplanner")).toBe(id);
    expect(findDatabaseId("[]", "recipeplanner")).toBeNull();
    expect(() => findDatabaseId("error", "recipeplanner")).toThrow();
  });
  it("writes the id into the real wrangler.jsonc", () => {
    const next = setDatabaseId(readFileSync("wrangler.jsonc", "utf8"), id);
    expect(next).toContain(`"database_id": "${id}"`);
    expect(() => setDatabaseId(next, id)).toThrow(/placeholder/);
    expect(() => setDatabaseId("x", "not-an-id")).toThrow(/Unexpected/);
  });
});
