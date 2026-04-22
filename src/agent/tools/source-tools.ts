import { tool } from "ai";
import { z } from "zod";
import { r2Read, r2Write, r2List } from "../r2";
import type { SourceRow } from "../db";

type ToolContext = {
  bucket: R2Bucket;
  sql: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => T[];
  wikiId: string;
};

export function createSourceTools(ctx: ToolContext) {
  const { bucket, sql, wikiId } = ctx;

  return {
    saveSource: tool({
      description:
        "Save a source document to storage. Use this when the user provides text to ingest or after receiving an uploaded file.",
      inputSchema: z.object({
        filename: z
          .string()
          .describe(
            "Filename for the source, e.g. '2026-04-22-article-title.md'",
          ),
        content: z.string().describe("Full text content of the source"),
      }),
      execute: async ({ filename, content }) => {
        const key = `${wikiId}/sources/${filename}`;
        await r2Write(bucket, key, content);

        const id = filename.replace(/\.[^.]+$/, "");
        sql`DELETE FROM sources WHERE id = ${id}`;
        sql`INSERT INTO sources (id, filename, r2_key, status)
            VALUES (${id}, ${filename}, ${key}, 'pending')`;

        return { success: true, filename, key };
      },
    }),

    readSource: tool({
      description: "Read a source document from storage.",
      inputSchema: z.object({
        filename: z.string().describe("Source filename to read"),
      }),
      execute: async ({ filename }) => {
        const key = `${wikiId}/sources/${filename}`;
        const content = await r2Read(bucket, key);
        if (!content) return { error: `Source not found: ${filename}` };
        return { filename, content };
      },
    }),

    listSources: tool({
      description:
        "List all sources with their ingestion status. Optionally filter by status.",
      inputSchema: z.object({
        status: z
          .enum(["pending", "ingested", "failed"])
          .optional()
          .describe("Filter by ingestion status"),
      }),
      execute: async ({ status }) => {
        let sources: SourceRow[];
        if (status) {
          sources =
            sql<SourceRow>`SELECT * FROM sources WHERE status = ${status} ORDER BY rowid DESC`;
        } else {
          sources =
            sql<SourceRow>`SELECT * FROM sources ORDER BY rowid DESC`;
        }

        return {
          count: sources.length,
          sources: sources.map((s) => ({
            id: s.id,
            filename: s.filename,
            status: s.status,
            ingested_at: s.ingested_at,
            page_count: s.page_count,
          })),
        };
      },
    }),
  };
}
