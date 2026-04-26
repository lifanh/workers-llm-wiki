import { tool } from "ai";
import { z } from "zod";
import type { ModelConfigRow } from "../db";

type ToolContext = {
  sql: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => T[];
};

export function createConfigTools(ctx: ToolContext) {
  const { sql } = ctx;

  return {
    modelConfig: tool({
      description:
        "Read or update the model configuration. There are two tiers: 'fast' (for simple ops like listing, classification) and 'capable' (for synthesis, complex queries). Each tier has a provider, model name, and gateway toggle.",
      inputSchema: z.object({
        action: z.enum(["read", "update"]).describe("Read or update config"),
        tier: z
          .enum(["fast", "capable"])
          .optional()
          .describe("Which model tier to read/update"),
        provider: z
          .enum([
            "workers-ai",
            "openai",
            "anthropic",
            "gemini",
            "google-vertex-ai",
          ])
          .optional()
          .describe(
            "Provider to set (for update). 'google-vertex-ai' requires gatewayEnabled=true.",
          ),
        model: z
          .string()
          .optional()
          .describe(
            "Model name to set (for update). For google-vertex-ai use ids like 'google/gemini-3.1-flash-lite-preview'.",
          ),
        gatewayEnabled: z
          .boolean()
          .optional()
          .describe("Enable AI Gateway for this tier (for update)"),
      }),
      execute: async ({ action, tier, provider, model, gatewayEnabled }) => {
        if (action === "read") {
          const configs =
            sql<ModelConfigRow>`SELECT * FROM model_config ORDER BY key`;
          return {
            configs: configs.map((c) => ({
              tier: c.key,
              provider: c.provider,
              model: c.model,
              gatewayEnabled: Boolean(c.gateway_enabled),
            })),
          };
        }

        if (!tier)
          return { error: "tier is required for update" };

        const updates: string[] = [];
        if (provider) {
          sql`UPDATE model_config SET provider = ${provider} WHERE key = ${tier}`;
          updates.push(`provider=${provider}`);
        }
        if (model) {
          sql`UPDATE model_config SET model = ${model} WHERE key = ${tier}`;
          updates.push(`model=${model}`);
        }
        if (gatewayEnabled !== undefined) {
          const val = gatewayEnabled ? 1 : 0;
          sql`UPDATE model_config SET gateway_enabled = ${val} WHERE key = ${tier}`;
          updates.push(`gatewayEnabled=${gatewayEnabled}`);
        }

        return { success: true, tier, updated: updates };
      },
    }),
  };
}
