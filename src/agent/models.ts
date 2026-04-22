import { createWorkersAI } from "workers-ai-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import type { ModelConfigRow } from "./db";

type Env = {
  AI: Ai;
  AI_GATEWAY_ID?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
};

export function resolveModel(config: ModelConfigRow, env: Env) {
  const gatewayOpts =
    config.gateway_enabled && env.AI_GATEWAY_ID
      ? { gateway: { id: env.AI_GATEWAY_ID } }
      : undefined;

  switch (config.provider) {
    case "workers-ai": {
      const workersai = createWorkersAI({ binding: env.AI });
      return workersai(config.model as Parameters<typeof workersai>[0]);
    }
    case "openai": {
      const openai = createOpenAI({
        apiKey: env.OPENAI_API_KEY,
        ...(gatewayOpts && env.AI_GATEWAY_ID
          ? {
              baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/openai`,
            }
          : {}),
      });
      return openai(config.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({
        apiKey: env.ANTHROPIC_API_KEY,
        ...(gatewayOpts && env.AI_GATEWAY_ID
          ? {
              baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/anthropic`,
            }
          : {}),
      });
      return anthropic(config.model);
    }
    case "gemini": {
      const google = createGoogleGenerativeAI({
        apiKey: env.GOOGLE_API_KEY,
        ...(gatewayOpts && env.AI_GATEWAY_ID
          ? {
              baseURL: `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ID}/google-ai-studio`,
            }
          : {}),
      });
      return google(config.model);
    }
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
