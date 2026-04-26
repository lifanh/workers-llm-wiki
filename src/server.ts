import { routeAgentRequest, getAgentByName } from "agents";
import { r2Read, r2GetObject } from "./agent/r2";
import type { WikiAgent } from "./agent/wiki-agent";

export { WikiAgent } from "./agent/wiki-agent";

const WIKI_ID = "default";

function isValidPath(path: string): boolean {
  return !!path && !path.includes("..") && !path.startsWith("/");
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function getWikiAgent(env: Env) {
  return getAgentByName(
    env.WikiAgent as unknown as DurableObjectNamespace<WikiAgent>,
    WIKI_ID,
  ) as unknown as WikiAgent;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ---------- POST /api/ingest/file ----------
    if (request.method === "POST" && url.pathname === "/api/ingest/file") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return jsonResponse(
            { ok: false, error: "Missing 'file' field" },
            { status: 400 },
          );
        }
        const bytes = await file.arrayBuffer();
        const agent = await getWikiAgent(env);
        const row = await agent.ingestFileRpc({
          name: file.name,
          bytes,
          mimeType: file.type || "application/octet-stream",
        });
        return jsonResponse({ ok: true, source: row });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code as string | undefined;
        const status =
          code === "too_large" ? 413 : code === "unsupported_mime" ? 415 : 400;
        return jsonResponse({ ok: false, error: message, code }, { status });
      }
    }

    // ---------- POST /api/ingest/url ----------
    if (request.method === "POST" && url.pathname === "/api/ingest/url") {
      try {
        const body = (await request.json()) as { url?: string };
        if (!body.url || typeof body.url !== "string") {
          return jsonResponse(
            { ok: false, error: "Missing 'url'" },
            { status: 400 },
          );
        }
        const agent = await getWikiAgent(env);
        const row = await agent.ingestUrlRpc({ url: body.url });
        return jsonResponse({ ok: true, source: row });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code as string | undefined;
        const status =
          code === "bad_url"
            ? 400
            : code === "fetch_failed"
              ? 502
              : code === "unsupported_mime"
                ? 415
                : code === "too_large"
                  ? 413
                  : 500;
        return jsonResponse({ ok: false, error: message, code }, { status });
      }
    }

    // ---------- GET /api/originals/:id ----------
    if (request.method === "GET" && url.pathname.startsWith("/api/originals/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/originals/".length));
      if (!isValidPath(id)) return new Response("Invalid id", { status: 400 });
      const agent = await getWikiAgent(env);
      const row = await agent.getSourceRow(id);
      if (!row || !row.original_r2_key) {
        return new Response("Original not found", { status: 404 });
      }
      const obj = await r2GetObject(env.WIKI_BUCKET, row.original_r2_key);
      if (!obj) return new Response("Original missing in storage", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": row.original_mime_type ?? "application/octet-stream",
          "content-disposition": `inline; filename="${row.filename.replace(/"/g, "")}"`,
        },
      });
    }

    // ---------- GET /api/wiki/:path ----------
    if (request.method === "GET" && url.pathname.startsWith("/api/wiki/")) {
      const pagePath = decodeURIComponent(
        url.pathname.slice("/api/wiki/".length),
      );
      if (!isValidPath(pagePath))
        return new Response("Invalid page path", { status: 400 });
      const content = await r2Read(
        env.WIKI_BUCKET,
        `${WIKI_ID}/wiki/${pagePath}.md`,
      );
      if (!content) return new Response("Page not found", { status: 404 });
      return new Response(content, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    // ---------- GET /api/sources/:filename (parsed) ----------
    if (request.method === "GET" && url.pathname.startsWith("/api/sources/")) {
      const filename = decodeURIComponent(
        url.pathname.slice("/api/sources/".length),
      );
      if (!isValidPath(filename))
        return new Response("Invalid filename", { status: 400 });
      const agent = await getWikiAgent(env);
      const row = await agent.getSourceRowByFilename(filename);
      const key =
        row?.parsed_r2_key ?? `${WIKI_ID}/sources/${filename}`; // legacy fallback
      const content = await r2Read(env.WIKI_BUCKET, key);
      if (!content) return new Response("Source not found", { status: 404 });
      return new Response(content, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    const response = await routeAgentRequest(request, env);
    if (response) return response;
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
