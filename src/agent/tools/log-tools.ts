import { tool } from "ai";
import { z } from "zod";
import { r2Append, r2Read } from "../r2";

type ToolContext = {
  bucket: R2Bucket;
  wikiId: string;
};

export function createLogTools(ctx: ToolContext) {
  const { bucket, wikiId } = ctx;

  return {
    appendLog: tool({
      description:
        "Append a timestamped entry to the wiki log. Use consistent prefixes like 'ingest | Title', 'query | Question', 'lint | Summary'.",
      inputSchema: z.object({
        entry: z
          .string()
          .describe(
            "Log entry text, e.g. 'ingest | Article about X — created 3 pages, updated 2'",
          ),
      }),
      execute: async ({ entry }) => {
        const key = `${wikiId}/wiki/log.md`;
        const now = new Date().toISOString().split("T")[0];
        const logEntry = `## [${now}] ${entry}`;
        await r2Append(bucket, key, logEntry);
        return { success: true, entry: logEntry };
      },
    }),

    readLog: tool({
      description: "Read the wiki activity log.",
      inputSchema: z.object({}),
      execute: async () => {
        const key = `${wikiId}/wiki/log.md`;
        const content = await r2Read(bucket, key);
        if (!content) return { content: "Log is empty." };
        return { content };
      },
    }),
  };
}
