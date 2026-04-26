import { describe, expect, test, vi } from "vitest";
import { ingestFile, IngestError } from "./ingest";

type Captured = { key: string; body: unknown; meta?: Record<string, unknown> };

function makeFakeBucket(captured: Captured[]): R2Bucket {
  return {
    put: vi.fn(async (key: string, body: unknown, opts?: any) => {
      captured.push({ key, body, meta: opts?.httpMetadata });
      return {} as any;
    }),
    get: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    head: vi.fn(),
    createMultipartUpload: vi.fn(),
    resumeMultipartUpload: vi.fn(),
  } as unknown as R2Bucket;
}

function makeFakeSql(rows: any[][] = []) {
  const calls: string[] = [];
  let i = 0;
  const sql: any = (strings: TemplateStringsArray) => {
    calls.push(strings.join("?"));
    const result = rows[i] ?? [];
    i++;
    return result;
  };
  sql.calls = calls;
  return sql;
}

const fakeAi = {
  toMarkdown: vi.fn(async (_files: any) => [
    { id: "x", name: "x", mimeType: "text/markdown", format: "markdown", tokens: 0, data: "PARSED" },
  ]),
} as unknown as Ai;

describe("ingestFile - text/markdown", () => {
  test("stores original + parsed (no toMarkdown call) and inserts row", async () => {
    const captured: Captured[] = [];
    const bucket = makeFakeBucket(captured);
    const sql = makeFakeSql();
    const bytes = new TextEncoder().encode("# hello\n\nworld");

    const row = await ingestFile({
      bucket,
      sql,
      ai: fakeAi,
      wikiId: "default",
      now: new Date("2026-04-26T00:00:00Z"),
      file: { name: "Hello.md", bytes, mimeType: "text/markdown" },
    });

    // R2 writes
    expect(captured.map((c) => c.key)).toEqual([
      "default/sources/originals/2026-04-26-hello.md",
      "default/sources/parsed/2026-04-26-hello.md",
    ]);
    // Did NOT invoke the AI for already-text input
    expect(fakeAi.toMarkdown).not.toHaveBeenCalled();
    // Returned row shape
    expect(row.source_type).toBe("text");
    expect(row.status).toBe("ingested");
    expect(row.parsed_r2_key).toBe("default/sources/parsed/2026-04-26-hello.md");
    expect(row.original_r2_key).toBe("default/sources/originals/2026-04-26-hello.md");
  });
});

describe("ingestFile - pdf", () => {
  test("stores original, calls toMarkdown, stores parsed, inserts row", async () => {
    (fakeAi.toMarkdown as any).mockClear();
    const captured: Captured[] = [];
    const bucket = makeFakeBucket(captured);
    const sql = makeFakeSql();
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF"

    const row = await ingestFile({
      bucket,
      sql,
      ai: fakeAi,
      wikiId: "default",
      now: new Date("2026-04-26T12:00:00Z"),
      file: { name: "report.pdf", bytes, mimeType: "application/pdf" },
    });

    expect(captured[0].key).toBe(
      "default/sources/originals/2026-04-26-report.pdf",
    );
    expect(captured[0].meta).toEqual({ contentType: "application/pdf" });
    expect(captured[1].key).toBe(
      "default/sources/parsed/2026-04-26-report.md",
    );
    expect(captured[1].body).toBe("PARSED");
    expect(fakeAi.toMarkdown).toHaveBeenCalledTimes(1);
    expect(row.source_type).toBe("pdf");
    expect(row.status).toBe("ingested");
  });
});
