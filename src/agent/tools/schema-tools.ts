import { tool } from "ai";
import { z } from "zod";
import { r2Read, r2Write } from "../r2";

type ToolContext = {
  bucket: R2Bucket;
  wikiId: string;
};

export function createSchemaTools(ctx: ToolContext) {
  const { bucket, wikiId } = ctx;

  return {
    readSchema: tool({
      description:
        "Read the wiki schema (conventions, page formats, workflows). The schema guides how you maintain this specific wiki.",
      parameters: z.object({}),
      execute: async () => {
        const key = `${wikiId}/wiki/schema.md`;
        const content = await r2Read(bucket, key);
        if (!content)
          return {
            content:
              "No schema defined yet. You can create one with updateSchema.",
          };
        return { content };
      },
    }),

    updateSchema: tool({
      description:
        "Update the wiki schema. Use this to evolve conventions as the wiki grows.",
      parameters: z.object({
        content: z.string().describe("Full markdown content for schema.md"),
      }),
      execute: async ({ content }) => {
        const key = `${wikiId}/wiki/schema.md`;
        await r2Write(bucket, key, content);
        return { success: true };
      },
    }),
  };
}
