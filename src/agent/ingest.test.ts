import { describe, expect, test, vi } from "vitest";
import { ingestFile, IngestError } from "./ingest";
import { ingestUrl } from "./ingest";

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

describe("ingestFile - validation", () => {
  test("rejects oversize file", async () => {
    const captured: Captured[] = [];
    const bucket = makeFakeBucket(captured);
    const big = new Uint8Array(26 * 1024 * 1024);
    await expect(
      ingestFile({
        bucket,
        sql: makeFakeSql(),
        ai: fakeAi,
        wikiId: "default",
        file: { name: "big.pdf", bytes: big, mimeType: "application/pdf" },
      }),
    ).rejects.toBeInstanceOf(IngestError);
    expect(captured).toHaveLength(0); // nothing written
  });

  test("rejects unsupported mime", async () => {
    await expect(
      ingestFile({
        bucket: makeFakeBucket([]),
        sql: makeFakeSql(),
        ai: fakeAi,
        wikiId: "default",
        file: { name: "x.exe", bytes: new Uint8Array([0]), mimeType: "application/x-msdownload" },
      }),
    ).rejects.toMatchObject({ code: "unsupported_mime" });
  });
});

describe("ingestFile - toMarkdown failure", () => {
  test("inserts row with status='failed', original kept, parsed missing", async () => {
    const failingAi = {
      toMarkdown: vi.fn(async () => [
        { id: "x", name: "x", mimeType: "application/pdf", format: "error", error: "boom" },
      ]),
    } as unknown as Ai;
    const captured: Captured[] = [];
    const bucket = makeFakeBucket(captured);
    const sqlCalls: string[] = [];
    const sql: any = (strings: TemplateStringsArray) => {
      sqlCalls.push(strings.join("?"));
      return [];
    };
    const row = await ingestFile({
      bucket,
      sql,
      ai: failingAi,
      wikiId: "default",
      now: new Date("2026-04-26T00:00:00Z"),
      file: { name: "broken.pdf", bytes: new Uint8Array([0]), mimeType: "application/pdf" },
    });

    expect(captured.map((c) => c.key)).toEqual([
      "default/sources/originals/2026-04-26-broken.pdf",
    ]); // parsed NOT written
    expect(row.status).toBe("failed");
    expect(row.parsed_r2_key).toBeNull();
    expect(sqlCalls.some((s) => s.includes("INSERT INTO sources"))).toBe(true);
  });
});

describe("ingestUrl - happy path", () => {
  test("fetches html, stores original + parsed, inserts url row", async () => {
    (fakeAi.toMarkdown as any).mockClear();
    const captured: Captured[] = [];
    const bucket = makeFakeBucket(captured);
    const html = "<html><body><h1>Hi</h1><p>Hello</p></body></html>";
    const fetchMock = vi.fn(async () =>
      new Response(html, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    );

    const row = await ingestUrl({
      bucket,
      sql: makeFakeSql(),
      ai: fakeAi,
      wikiId: "default",
      now: new Date("2026-04-26T00:00:00Z"),
      url: "https://example.com/blog/foo",
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured[0].key).toBe(
      "default/sources/originals/2026-04-26-example-com-foo.html",
    );
    expect(captured[1].key).toBe(
      "default/sources/parsed/2026-04-26-example-com-foo.md",
    );
    expect(row.source_type).toBe("url");
    expect(row.source_url).toBe("https://example.com/blog/foo");
    expect(row.original_mime_type).toBe("text/html; charset=utf-8");
  });
});

describe("ingestUrl - SSRF guard", () => {
  test.each([
    "http://localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://169.254.169.254/",
    "ftp://example.com/",
    "file:///etc/passwd",
    "not-a-url",
  ])("rejects %s", async (bad) => {
    await expect(
      ingestUrl({
        bucket: makeFakeBucket([]),
        sql: makeFakeSql(),
        ai: fakeAi,
        wikiId: "default",
        url: bad,
        fetchImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: "bad_url" });
  });
});

describe("ingestUrl - non-2xx and bad content-type", () => {
  test("rejects 404", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    await expect(
      ingestUrl({
        bucket: makeFakeBucket([]),
        sql: makeFakeSql(),
        ai: fakeAi,
        wikiId: "default",
        url: "https://example.com/x",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "fetch_failed" });
  });

  test("rejects image content-type", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(new Uint8Array([0xff, 0xd8]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    await expect(
      ingestUrl({
        bucket: makeFakeBucket([]),
        sql: makeFakeSql(),
        ai: fakeAi,
        wikiId: "default",
        url: "https://example.com/x.jpg",
        fetchImpl: fetchMock,
      }),
    ).rejects.toMatchObject({ code: "unsupported_mime" });
  });
});
