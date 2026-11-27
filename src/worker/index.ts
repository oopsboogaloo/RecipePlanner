import { handleApi } from "./api";
import { handleMcp } from "./mcp";
import { Service } from "./service";
import { D1Store } from "./store";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  APP_SECRET?: string;
}

const notFound = () => new Response("Not found", { status: 404 });

function sameSecret(given: string, expected: string): boolean {
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function manifest(base: string): Response {
  return new Response(
    JSON.stringify({
      name: "RecipePlanner",
      short_name: "Cook",
      start_url: base,
      scope: base,
      display: "standalone",
      background_color: "#faf7f2",
      theme_color: "#b45309",
      icons: [
        { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
        { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      ],
    }),
    { headers: { "content-type": "application/manifest+json" } },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Static files carry no data and are public.
    if (path.startsWith("/assets/") || path === "/icon.svg" || path === "/icon-maskable.svg") return env.ASSETS.fetch(request);

    const secret = env.APP_SECRET ?? "";
    if (secret.length < 16) return new Response("APP_SECRET is not configured (needs 16+ characters).", { status: 500 });

    const m = path.match(/^\/(a|mcp)\/([^/]+)(\/.*)?$/);
    if (!m || !sameSecret(m[2], secret)) return notFound();
    const [, kind, , rest = ""] = m;
    const svc = () => new Service(new D1Store(env.DB));

    if (kind === "mcp") return rest === "" || rest === "/" ? handleMcp(svc(), request) : notFound();

    if (rest === "") return Response.redirect(`${url.origin}${path}/`, 301);
    if (rest.startsWith("/api/")) return handleApi(svc(), request, rest.slice(4));
    if (rest === "/manifest.webmanifest") return manifest(`/a/${secret}/`);
    if (rest === "/sw.js") {
      const res = await env.ASSETS.fetch(new Request(`${url.origin}/sw.js`));
      return new Response(res.body, { headers: { "content-type": "text/javascript", "cache-control": "no-cache" } });
    }
    if (rest === "/") {
      const res = await env.ASSETS.fetch(new Request(`${url.origin}/`));
      const headers = new Headers(res.headers);
      headers.set("cache-control", "no-cache");
      headers.set("referrer-policy", "no-referrer");
      headers.set("x-robots-tag", "noindex");
      return new Response(res.body, { status: res.status, headers });
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;
