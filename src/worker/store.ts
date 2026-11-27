import type { Cook, Recipe } from "../shared/types";

export interface Store {
  listRecipes(): Promise<Recipe[]>;
  getRecipe(id: string): Promise<Recipe | null>;
  putRecipe(r: Recipe): Promise<void>;
  deleteRecipe(id: string): Promise<void>;
  getActiveCook(): Promise<Cook | null>;
  putCook(c: Cook): Promise<void>;
}

export class MemoryStore implements Store {
  recipes = new Map<string, Recipe>();
  cooks = new Map<string, Cook>();
  async listRecipes() {
    return structuredClone([...this.recipes.values()]).sort((a, b) => a.name.localeCompare(b.name));
  }
  async getRecipe(id: string) {
    return structuredClone(this.recipes.get(id) ?? null);
  }
  async putRecipe(r: Recipe) {
    this.recipes.set(r.id, structuredClone(r));
  }
  async deleteRecipe(id: string) {
    this.recipes.delete(id);
  }
  async getActiveCook() {
    return structuredClone([...this.cooks.values()].find((c) => c.status === "active") ?? null);
  }
  async putCook(c: Cook) {
    this.cooks.set(c.id, structuredClone(c));
  }
}

let schemaReady: Promise<unknown> | undefined;

export class D1Store implements Store {
  constructor(private db: D1Database) {}

  private ready() {
    schemaReady ??= this.db
      .batch([
        this.db.prepare("CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
        this.db.prepare("CREATE TABLE IF NOT EXISTS cooks (id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL, updated_at INTEGER NOT NULL)"),
      ])
      .catch((e) => {
        schemaReady = undefined;
        throw e;
      });
    return schemaReady;
  }

  async listRecipes() {
    await this.ready();
    const { results } = await this.db.prepare("SELECT body FROM recipes").all<{ body: string }>();
    return results.map((r) => JSON.parse(r.body) as Recipe).sort((a, b) => a.name.localeCompare(b.name));
  }
  async getRecipe(id: string) {
    await this.ready();
    const row = await this.db.prepare("SELECT body FROM recipes WHERE id = ?").bind(id).first<{ body: string }>();
    return row ? (JSON.parse(row.body) as Recipe) : null;
  }
  async putRecipe(r: Recipe) {
    await this.ready();
    await this.db
      .prepare("INSERT INTO recipes (id, body, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO UPDATE SET body = ?2, updated_at = ?3")
      .bind(r.id, JSON.stringify(r), r.updatedAt)
      .run();
  }
  async deleteRecipe(id: string) {
    await this.ready();
    await this.db.prepare("DELETE FROM recipes WHERE id = ?").bind(id).run();
  }
  async getActiveCook() {
    await this.ready();
    const row = await this.db
      .prepare("SELECT body FROM cooks WHERE status = 'active' ORDER BY updated_at DESC LIMIT 1")
      .first<{ body: string }>();
    return row ? (JSON.parse(row.body) as Cook) : null;
  }
  async putCook(c: Cook) {
    await this.ready();
    await this.db
      .prepare("INSERT INTO cooks (id, status, body, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET status = ?2, body = ?3, updated_at = ?4")
      .bind(c.id, c.status, JSON.stringify(c), Date.now())
      .run();
  }
}
