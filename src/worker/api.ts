import { planthoodToRecipe } from "../shared/planthood";
import { ValidationError } from "../shared/validate";
import { ConflictError, NotFoundError, type Service } from "./service";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function errorResponse(e: unknown): Response {
  const message = e instanceof Error ? e.message : "Something went wrong";
  if (e instanceof ValidationError) return json({ error: message }, 400);
  if (e instanceof NotFoundError) return json({ error: message }, 404);
  if (e instanceof ConflictError) return json({ error: message }, 409);
  console.error(e);
  return json({ error: "Something went wrong on the server." }, 500);
}

/** `path` is the part after `/api`, e.g. `/recipes/abc`. */
export async function handleApi(svc: Service, request: Request, path: string): Promise<Response> {
  try {
    const method = request.method;
    const body = async () => {
      try {
        return (await request.json()) as any;
      } catch {
        throw new ValidationError("request body must be JSON");
      }
    };
    const recipe = path.match(/^\/recipes\/([\w-]{1,40})$/);

    if (method === "GET" && path === "/state") return json(await svc.state());
    if (method === "PUT" && recipe) return json(await svc.saveRecipe({ ...(await body()), id: recipe[1] }));
    if (method === "DELETE" && recipe) {
      await svc.deleteRecipe(recipe[1]);
      return json({ ok: true });
    }
    if (method === "POST" && path === "/cook") return json(await svc.startCook(await body()));
    if (method === "POST" && path === "/cook/ops") {
      const b = await body();
      return json(await svc.cookOps(String(b.cookId), b.ops));
    }
    if (method === "PUT" && path === "/cook/plan") {
      const b = await body();
      return json(await svc.updateCookPlan(b, String(b.cookId)));
    }
    if (method === "POST" && path === "/planthood") {
      const src = await svc.fetchPlanthood((await body()).url);
      return json({ recipe: planthoodToRecipe(src) });
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return errorResponse(e);
  }
}
