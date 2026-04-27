import { AIChatAgent } from "@cloudflare/ai-chat";
import {
  streamText,
  convertToModelMessages,
} from "ai";
import { DEFAULT_MODEL_PROVIDER, DEFAULT_MODEL_NAME } from "./config";
import { initDb, type ModelConfigRow } from "./db";
import { ingestFile, ingestUrl } from "./ingest";
import type { SourceRow } from "./db";
import { resolveModel } from "./models";
import { buildSystemPrompt } from "./prompts";
import { r2Read } from "./r2";
import { createWikiTools } from "./tools/wiki-tools";
import { createSourceTools } from "./tools/source-tools";
import { createSchemaTools } from "./tools/schema-tools";
import { createLogTools } from "./tools/log-tools";
import { createConfigTools } from "./tools/config-tools";

type WikiState = {
  wikiId: string;
  pageCount: number;
  sourceCount: number;
  lastActivity: string;
  currentOperation: string | null;
  pageIndex: Array<{
    id: string;
    title: string;
    category: string;
    summary: string | null;
  }>;
  sourceIndex: Array<{
    id: string;
    filename: string;
    status: string;
    source_type: string;
    source_url: string | null;
  }>;
};

export class WikiAgent extends AIChatAgent<Env, WikiState> {
  initialState: WikiState = {
    wikiId: "default",
    pageCount: 0,
    sourceCount: 0,
    lastActivity: new Date().toISOString(),
    currentOperation: null,
    pageIndex: [],
    sourceIndex: [],
  };

  // Bound version of `this.sql` so it can be safely passed to helpers/tools
  // without losing its `this` binding (the underlying impl reads `this.ctx`).
  private get boundSql() {
    return this.sql.bind(this) as typeof this.sql;
  }

  async onStart() {
    initDb(this.boundSql, this.env as any);
    this.syncStateFromDb();
  }

  private syncStateFromDb() {
    const pages =
      this.sql<{ id: string; title: string; category: string; summary: string | null }>`SELECT id, title, category, summary FROM wiki_pages ORDER BY updated_at DESC`;
    const sources =
      this.sql<{ id: string; filename: string; status: string; source_type: string; source_url: string | null }>`
        SELECT id, filename, status, source_type, source_url FROM sources ORDER BY rowid DESC`;

    this.setState({
      ...this.state,
      pageCount: pages.length,
      sourceCount: sources.length,
      lastActivity: new Date().toISOString(),
      pageIndex: pages,
      sourceIndex: sources,
    });
  }

  async ingestFileRpc(input: {
    name: string;
    bytes: ArrayBuffer;
    mimeType: string;
  }): Promise<SourceRow> {
    const row = await ingestFile({
      bucket: this.env.WIKI_BUCKET,
      sql: this.boundSql,
      ai: this.env.AI,
      wikiId: this.state.wikiId,
      file: {
        name: input.name,
        bytes: new Uint8Array(input.bytes),
        mimeType: input.mimeType,
      },
    });
    this.syncStateFromDb();
    return row;
  }

  async ingestUrlRpc(input: { url: string }): Promise<SourceRow> {
    const row = await ingestUrl({
      bucket: this.env.WIKI_BUCKET,
      sql: this.boundSql,
      ai: this.env.AI,
      wikiId: this.state.wikiId,
      url: input.url,
    });
    this.syncStateFromDb();
    return row;
  }

  async getSourceRow(id: string): Promise<SourceRow | null> {
    const rows = this.sql<SourceRow>`SELECT * FROM sources WHERE id = ${id}`;
    return rows[0] ?? null;
  }

  async getSourceRowByFilename(filename: string): Promise<SourceRow | null> {
    const rows =
      this.sql<SourceRow>`SELECT * FROM sources WHERE filename = ${filename} OR id = ${filename.replace(/\.[^.]+$/, "")} LIMIT 1`;
    return rows[0] ?? null;
  }

  private getModelConfig(tier: "fast" | "capable"): ModelConfigRow {
    const rows =
      this.sql<ModelConfigRow>`SELECT * FROM model_config WHERE key = ${tier}`;
    if (rows.length === 0) {
      return {
        key: tier,
        provider: DEFAULT_MODEL_PROVIDER,
        model: DEFAULT_MODEL_NAME,
        gateway_enabled: 0,
      };
    }
    return rows[0];
  }

  async onChatMessage(
    _onFinish?: unknown,
    options?: { body?: unknown; abortSignal?: AbortSignal },
  ) {
    const wikiId = this.state.wikiId;
    const bucket = this.env.WIKI_BUCKET;

    // Read schema for system prompt
    const schemaContent = await r2Read(bucket, `${wikiId}/wiki/schema.md`);
    const systemPrompt = buildSystemPrompt(wikiId, schemaContent);

    // Build tool context
    const toolCtx = {
      bucket,
      sql: this.boundSql,
      wikiId,
      ai: this.env.AI,
      onPagesChanged: () => this.syncStateFromDb(),
    };

    const capableConfig = this.getModelConfig("capable");
    const model = resolveModel(capableConfig, this.env as any) as any;

    // Handle file uploads from options.body
    const body = options?.body as
      | { file?: { name: string; content: string } }
      | undefined;
    let extraMessages: Array<{ role: "user"; content: string }> = [];
    if (body?.file) {
      extraMessages = [
        {
          role: "user",
          content: `[File uploaded: ${body.file.name}]\n\nContent:\n${body.file.content}`,
        },
      ];
    }

    const allTools = {
      ...createWikiTools(toolCtx),
      ...createSourceTools(toolCtx),
      ...createSchemaTools(toolCtx),
      ...createLogTools(toolCtx),
      ...createConfigTools(toolCtx),
    };

    const result = (streamText as any)({
      model,
      system: systemPrompt,
      messages: [
        ...(await convertToModelMessages(this.messages)),
        ...extraMessages,
      ],
      tools: allTools,
      maxSteps: 15,
      onFinish: async () => {
        this.syncStateFromDb();
      },
    });

    return result.toUIMessageStreamResponse();
  }
}
