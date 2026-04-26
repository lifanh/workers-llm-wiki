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

  // --- migration: dual-storage columns (originals + parsed) ---
  const sourceCols = sql<{ name: string }>`PRAGMA table_info(sources)`.map(
    (c) => c.name,
  );
  const addCol = (name: string, ddl: string) => {
    if (!sourceCols.includes(name)) {
      // Cannot use parameter binding for ALTER TABLE.
      // Column names/DDL are static, not user input — safe.
      sql([`ALTER TABLE sources ADD COLUMN ${name} ${ddl}`] as unknown as TemplateStringsArray);
    }
  };
  addCol("source_type", "TEXT NOT NULL DEFAULT 'text'");
  addCol("source_url", "TEXT");
  addCol("original_r2_key", "TEXT");
  addCol("original_mime_type", "TEXT");
  addCol("parsed_r2_key", "TEXT");

  // Backfill: existing rows get parsed_r2_key = r2_key.
  sql`UPDATE sources SET parsed_r2_key = r2_key WHERE parsed_r2_key IS NULL`;

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
  r2_key: string; // legacy; equals parsed_r2_key for new rows
  ingested_at: string | null;
  status: string;
  page_count: number;
  source_type: string; // 'text' | 'pdf' | 'url'
  source_url: string | null;
  original_r2_key: string | null;
  original_mime_type: string | null;
  parsed_r2_key: string | null;
};

export type ModelConfigRow = {
  key: string;
  provider: string;
  model: string;
  gateway_enabled: number;
};
