import { routeAgentRequest } from "agents";
import { r2Read } from "./agent/r2";

export { WikiAgent } from "./agent/wiki-agent";

// Hardcoded to match WikiAgent's initialState.wikiId
const WIKI_ID = "default";

function isValidPath(path: string): boolean {
  return !!path && !path.includes("..") && !path.startsWith("/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // REST API: read a wiki page directly from R2
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
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    // REST API: read a source file directly from R2
    if (request.method === "GET" && url.pathname.startsWith("/api/sources/")) {
      const filename = decodeURIComponent(
        url.pathname.slice("/api/sources/".length),
      );
      if (!isValidPath(filename))
        return new Response("Invalid filename", { status: 400 });
      const content = await r2Read(
        env.WIKI_BUCKET,
        `${WIKI_ID}/sources/${filename}`,
      );
      if (!content) return new Response("Source not found", { status: 404 });
      return new Response(content, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    const response = await routeAgentRequest(request, env);
    if (response) return response;
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
