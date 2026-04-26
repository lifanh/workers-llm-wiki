import { DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_NAME } from "./config";

type SqlTagged = <T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: (string | number | boolean | null)[]
) => T[];

export function initDb(sql: SqlTagged, env?: Record<string, unknown>): void {
  sql`CREATE TABLE IF NOT EXISTS wiki_pages (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT,
    category TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    tags TEXT
  )`;

  sql`CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    ingested_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    page_count INTEGER DEFAULT 0
  )`;

  sql`CREATE TABLE IF NOT EXISTS model_config (
    key TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    gateway_enabled INTEGER DEFAULT 0
  )`;

  // Seed default model config if empty
  const existing = sql`SELECT key FROM model_config LIMIT 1`;
  if (existing.length === 0) {
    const fastProvider = (env?.DEFAULT_FAST_MODEL_PROVIDER as string | undefined) ?? DEFAULT_MODEL_PROVIDER;
    const fastModel = (env?.DEFAULT_FAST_MODEL_NAME as string | undefined) ?? DEFAULT_MODEL_NAME;
    const fastGatewayEnabled = env?.DEFAULT_FAST_GATEWAY_ENABLED === 'true' ? 1 : 0;
    
    const capableProvider = (env?.DEFAULT_CAPABLE_MODEL_PROVIDER as string | undefined) ?? DEFAULT_MODEL_PROVIDER;
    const capableModel = (env?.DEFAULT_CAPABLE_MODEL_NAME as string | undefined) ?? DEFAULT_MODEL_NAME;
    const capableGatewayEnabled = env?.DEFAULT_CAPABLE_GATEWAY_ENABLED === 'true' ? 1 : 0;

    sql`INSERT INTO model_config (key, provider, model, gateway_enabled)
        VALUES ('fast', ${fastProvider}, ${fastModel}, ${fastGatewayEnabled})`;
    sql`INSERT INTO model_config (key, provider, model, gateway_enabled)
        VALUES ('capable', ${capableProvider}, ${capableModel}, ${capableGatewayEnabled})`;
  }
}

export type WikiPageRow = {
  id: string;
  title: string;
  summary: string | null;
  category: string;
  r2_key: string;
  updated_at: string;
  tags: string | null;
};

export type SourceRow = {
  id: string;
  filename: string;
  r2_key: string;
  ingested_at: string | null;
  status: string;
  page_count: number;
};

export type ModelConfigRow = {
  key: string;
  provider: string;
  model: string;
  gateway_enabled: number;
};
