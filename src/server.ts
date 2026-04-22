import { routeAgentRequest } from "agents";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routeAgentRequest(request, env);
    if (response) return response;
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
