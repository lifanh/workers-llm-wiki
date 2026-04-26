import { createWorkersAI } from "workers-ai-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createAiGateway } from "ai-gateway-provider";
import { createUnified } from "ai-gateway-provider/providers/unified";
import type { ModelConfigRow } from "./db";

type ModelEnv = {
  AI: Ai;
  CLOUDFLARE_ACCOUNT_ID?: string;
  AI_GATEWAY_NAME?: string;
  AI_GATEWAY_TOKEN?: string;
  // Legacy: "<account_id>/<gateway_name>"
  AI_GATEWAY_ID?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  [key: string]: unknown;
};

/**
 * Map our internal provider name to the prefix expected by the AI Gateway
 * unified (OpenAI-compat) endpoint.
 *
 * See https://developers.cloudflare.com/ai-gateway/usage/chat-completion/
 */
function unifiedModelId(provider: string, model: string): string {
  switch (provider) {
    case "gemini":
      return `google-ai-studio/${model}`;
    case "google":
      return `google-ai-studio/${model}`;
    case "google-vertex-ai": {
      // Vertex AI requires "<publisher>/<model>" (e.g. "google/gemini-3.1-pro-preview").
      // If the user stored just "gemini-3.1-pro-preview", default the publisher to "google".
      const fq = model.includes("/") ? model : `google/${model}`;
      return `google-vertex-ai/${fq}`;
    }
    case "openai":
      return `openai/${model}`;
    case "anthropic":
      return `anthropic/${model}`;
    case "workers-ai":
      return `workers-ai/${model}`;
    default:
      // Allow already-prefixed ids like "openai/gpt-5.2" to pass through
      return model.includes("/") ? model : `${provider}/${model}`;
  }
}

function resolveGatewayConfig(env: ModelEnv): {
  accountId: string;
  gateway: string;
  apiKey?: string;
} | null {
  let accountId = env.CLOUDFLARE_ACCOUNT_ID;
  let gateway = env.AI_GATEWAY_NAME;

  // Backwards-compat: AI_GATEWAY_ID="<account_id>/<gateway_name>"
  if ((!accountId || !gateway) && env.AI_GATEWAY_ID) {
    const [acct, gw] = env.AI_GATEWAY_ID.split("/");
    if (acct && gw) {
      accountId = accountId ?? acct;
      gateway = gateway ?? gw;
    }
  }

  if (!accountId || !gateway) return null;
  return { accountId, gateway, apiKey: env.AI_GATEWAY_TOKEN };
}

export function resolveModel(config: ModelConfigRow, env: ModelEnv) {
  // ---------- AI Gateway (BYOK via unified OpenAI-compat endpoint) ----------
  if (config.gateway_enabled) {
    const gw = resolveGatewayConfig(env);
    if (!gw) {
      throw new Error(
        "AI Gateway is enabled for this tier but CLOUDFLARE_ACCOUNT_ID / AI_GATEWAY_NAME (or legacy AI_GATEWAY_ID) is not configured.",
      );
    }

    const aigateway = createAiGateway({
      accountId: gw.accountId,
      gateway: gw.gateway,
      apiKey: gw.apiKey,
    });

    // No apiKey passed to createUnified() => BYOK: keys stored in the gateway
    // dashboard are used. To override per-request, set a provider key here.
    const unified = createUnified();

    return aigateway(unified(unifiedModelId(config.provider, config.model)));
  }

  // ---------- Direct provider (no gateway) ----------
  switch (config.provider) {
    case "workers-ai": {
      const workersai = createWorkersAI({ binding: env.AI });
      return workersai(config.model as Parameters<typeof workersai>[0]);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
      return openai(config.model);
    }
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: env.ANTHROPIC_API_KEY });
      return anthropic(config.model);
    }
    case "gemini":
    case "google": {
      const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_API_KEY });
      return google(config.model);
    }
    case "google-vertex-ai":
      throw new Error(
        "Provider 'google-vertex-ai' is only available via AI Gateway (BYOK). Enable AI Gateway for this tier.",
      );
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}
