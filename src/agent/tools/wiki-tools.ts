import { tool } from "ai";
import { z } from "zod";
import { r2Read, r2Write, r2Delete } from "../r2";
import type { WikiPageRow } from "../db";

type ToolContext = {
  bucket: R2Bucket;
  sql: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => T[];
  wikiId: string;
  onPagesChanged: () => void;
};

export function createWikiTools(ctx: ToolContext) {
  const { bucket, sql, wikiId, onPagesChanged } = ctx;

  return {
    readPage: tool({
      description:
        "Read a wiki page by its path (e.g. 'entities/some-entity' or 'overview'). Returns the full markdown content.",
      inputSchema: z.object({
        path: z
          .string()
          .describe(
            "Page path relative to wiki directory, e.g. 'entities/some-entity'",
          ),
      }),
      execute: async ({ path }) => {
        const key = `${wikiId}/wiki/${path}.md`;
        const content = await r2Read(bucket, key);
        if (!content) return { error: `Page not found: ${path}` };
        return { path, content };
      },
    }),

    writePage: tool({
      description:
        "Create or update a wiki page. Writes markdown to R2 and updates the SQLite index. Use this for creating new pages and updating existing ones.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Page path, e.g. 'entities/some-entity' or 'overview'"),
        title: z.string().describe("Page title"),
        content: z
          .string()
          .describe("Full markdown content including frontmatter"),
        category: z
          .enum(["entity", "concept", "topic", "source"])
          .describe("Page category"),
        summary: z
          .string()
          .optional()
          .describe("One-line summary for the index"),
        tags: z
          .array(z.string())
          .optional()
          .describe("Tags for categorization"),
      }),
      execute: async ({ path, title, content, category, summary, tags }) => {
        const key = `${wikiId}/wiki/${path}.md`;
        await r2Write(bucket, key, content);

        const now = new Date().toISOString();
        const tagsJson = tags ? JSON.stringify(tags) : null;

        sql`DELETE FROM wiki_pages WHERE id = ${path}`;
        sql`INSERT INTO wiki_pages (id, title, summary, category, r2_key, updated_at, tags)
            VALUES (${path}, ${title}, ${summary ?? null}, ${category}, ${key}, ${now}, ${tagsJson})`;

        onPagesChanged();
        return { success: true, path, title };
      },
    }),

    deletePage: tool({
      description: "Delete a wiki page from R2 and the SQLite index.",
      inputSchema: z.object({
        path: z.string().describe("Page path to delete"),
      }),
      execute: async ({ path }) => {
        const key = `${wikiId}/wiki/${path}.md`;
        await r2Delete(bucket, key);
        sql`DELETE FROM wiki_pages WHERE id = ${path}`;
        onPagesChanged();
        return { success: true, path };
      },
    }),

    listPages: tool({
      description:
        "List wiki pages from the index. Optionally filter by category or tag. Returns page metadata, not full content.",
      inputSchema: z.object({
        category: z
          .enum(["entity", "concept", "topic", "source"])
          .optional()
          .describe("Filter by category"),
        tag: z.string().optional().describe("Filter by tag"),
      }),
      execute: async ({ category, tag }) => {
        let pages: WikiPageRow[];
        if (category) {
          pages =
            sql<WikiPageRow>`SELECT * FROM wiki_pages WHERE category = ${category} ORDER BY updated_at DESC`;
        } else {
          pages =
            sql<WikiPageRow>`SELECT * FROM wiki_pages ORDER BY updated_at DESC`;
        }

        if (tag) {
          pages = pages.filter((p) => {
            if (!p.tags) return false;
            const parsed = JSON.parse(p.tags) as string[];
            return parsed.includes(tag);
          });
        }

        return {
          count: pages.length,
          pages: pages.map((p) => ({
            id: p.id,
            title: p.title,
            summary: p.summary,
            category: p.category,
            tags: p.tags ? JSON.parse(p.tags) : [],
            updated_at: p.updated_at,
          })),
        };
      },
    }),

    readIndex: tool({
      description:
        "Read the full wiki index (index.md). Use this to get an overview of all pages when answering queries.",
      inputSchema: z.object({}),
      execute: async () => {
        const key = `${wikiId}/wiki/index.md`;
        const content = await r2Read(bucket, key);
        if (!content) return { content: "Index is empty. No pages yet." };
        return { content };
      },
    }),
  };
}
