# Multi-Format Source Ingestion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PDF and web-URL ingestion with dual storage (original + parsed Markdown), reachable from the UI, REST endpoints, and an agent tool.

**Architecture:** A shared `ingest` module owns validate → store original → parse via `env.AI.toMarkdown` → store parsed Markdown → upsert `sources` row. The WikiAgent Durable Object exposes RPC methods that wrap the module so HTTP endpoints and agent tools share one code path.

**Tech Stack:** TypeScript, Cloudflare Workers, Durable Objects (sqlite-backed), R2, Workers AI (`toMarkdown`), React 19, Tailwind, Vitest.

**Spec:** [docs/specs/2026-04-26-multi-format-ingestion-design.md](../specs/2026-04-26-multi-format-ingestion-design.md)

---

## Task 0: Set up Vitest

**Why:** Spec §9 requires unit tests; the project has no test framework yet.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `tsconfig.json` (modify if needed for vitest globals)

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

- [ ] **Step 2: Add `test` script to `package.json`**

In the `"scripts"` block add:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
});
```

- [ ] **Step 4: Sanity-check vitest runs**

```bash
npm test
```

Expected: `No test files found, exiting with code 0` (or non-zero in some versions). Either way, no crash. If it errors on "no tests", create a temporary `src/agent/_smoke.test.ts` with `import { test, expect } from "vitest"; test("smoke", () => expect(1).toBe(1));`, run `npm test`, see it pass, then delete the file.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: set up vitest"
```

---

## Task 1: ID & slug helpers (TDD)

**Why:** Both pipelines need a deterministic id from a name or URL. Isolate so it's easy to test.

**Files:**
- Create: `src/agent/ids.ts`
- Create: `src/agent/ids.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/agent/ids.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { slugify, sourceIdFromName, sourceIdFromUrl } from "./ids";

describe("slugify", () => {
  test("lowercases and replaces non-alphanumerics with hyphens", () => {
    expect(slugify("Hello World!")).toBe("hello-world");
  });
  test("collapses repeats, trims leading/trailing hyphens", () => {
    expect(slugify("  Foo -- Bar __ baz  ")).toBe("foo-bar-baz");
  });
  test("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    expect(slugify(long).length).toBeLessThanOrEqual(60);
  });
  test("returns 'untitled' for empty/garbage input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("   !!!  ")).toBe("untitled");
  });
});

describe("sourceIdFromName", () => {
  test("prefixes with given date and strips extension", () => {
    expect(sourceIdFromName("Some Article.pdf", "2026-04-26")).toBe(
      "2026-04-26-some-article",
    );
  });
});

describe("sourceIdFromUrl", () => {
  test("uses hostname and path tail", () => {
    expect(
      sourceIdFromUrl("https://example.com/blog/foo-bar?x=1", "2026-04-26"),
    ).toBe("2026-04-26-example-com-foo-bar");
  });
  test("falls back to hostname only when path is empty", () => {
    expect(sourceIdFromUrl("https://example.com/", "2026-04-26")).toBe(
      "2026-04-26-example-com",
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npm test -- src/agent/ids.test.ts
```
Expected: FAIL with module-not-found / function-not-defined.

- [ ] **Step 3: Implement `src/agent/ids.ts`**

```ts
const MAX_SLUG_LEN = 60;

export function slugify(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, "");
  return cleaned || "untitled";
}

function stripExt(name: string): string {
  return name.replace(/\.[^./]+$/, "");
}

export function sourceIdFromName(name: string, dateIso: string): string {
  return `${dateIso}-${slugify(stripExt(name))}`;
}

export function sourceIdFromUrl(url: string, dateIso: string): string {
  let host = "";
  let pathTail = "";
  try {
    const u = new URL(url);
    host = u.hostname;
    const segments = u.pathname.split("/").filter(Boolean);
    pathTail = segments[segments.length - 1] ?? "";
  } catch {
    // fall through with empty host/pathTail
  }
  const combined = pathTail ? `${host}-${pathTail}` : host;
  return `${dateIso}-${slugify(combined)}`;
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/agent/ids.test.ts
```
Expected: PASS (all 7 tests green).

- [ ] **Step 5: Commit**

```bash
git add src/agent/ids.ts src/agent/ids.test.ts
git commit -m "feat(ingest): add id and slug helpers"
```

---

## Task 2: Schema migration & updated `SourceRow` type

**Why:** The `sources` table needs the new columns before any ingest code can write them. Migration must be idempotent (runs on every DO start).

**Files:**
- Modify: `src/agent/db.ts`

- [ ] **Step 1: Add a helper for idempotent ALTERs and update `initDb`**

Replace the current `sources` block in `src/agent/db.ts` with:

```ts
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
```

Note: the `sql` template tag requires a `TemplateStringsArray`. The cast above is the simplest way to send a one-off literal. If your `SqlTagged` impl rejects that, fall back to `sql\`\`.raw` style if available, or define a tiny `execRaw` helper that bypasses the tag.

- [ ] **Step 2: Update the `SourceRow` type**

Replace the existing `SourceRow` type:

```ts
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
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/agent/db.ts
git commit -m "feat(db): add dual-storage columns to sources table"
```

---

## Task 3: R2 byte helpers

**Why:** `r2.ts` only handles strings today. PDFs and HTML are bytes.

**Files:**
- Modify: `src/agent/r2.ts`

- [ ] **Step 1: Append byte-aware helpers to `src/agent/r2.ts`**

```ts
export async function r2WriteBytes(
  bucket: R2Bucket,
  key: string,
  bytes: ArrayBuffer | Uint8Array,
  mimeType?: string,
): Promise<void> {
  const body = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  await bucket.put(key, body, {
    httpMetadata: mimeType ? { contentType: mimeType } : undefined,
  });
}

export async function r2GetObject(
  bucket: R2Bucket,
  key: string,
): Promise<R2ObjectBody | null> {
  return (await bucket.get(key)) ?? null;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/agent/r2.ts
git commit -m "feat(r2): add byte-write and raw-get helpers"
```

---

## Task 4: Ingest module — text path (TDD)

**Why:** Start with the simplest path so we can lock the module's API and the test scaffolding.

**Files:**
- Create: `src/agent/ingest.ts`
- Create: `src/agent/ingest.test.ts`

- [ ] **Step 1: Write the failing test (text/markdown happy path)**

`src/agent/ingest.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- src/agent/ingest.test.ts
```
Expected: FAIL with "Cannot find module './ingest'".

- [ ] **Step 3: Implement minimal `src/agent/ingest.ts`**

```ts
import { sourceIdFromName, sourceIdFromUrl, todayIso } from "./ids";
import { r2Write, r2WriteBytes } from "./r2";
import type { SourceRow } from "./db";

export class IngestError extends Error {
  constructor(
    public code:
      | "too_large"
      | "unsupported_mime"
      | "fetch_failed"
      | "parse_failed"
      | "bad_url",
    message: string,
  ) {
    super(message);
  }
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB
export const MAX_URL_BYTES = 10 * 1024 * 1024; // 10 MB

const TEXT_MIMES = new Set([
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/json",
]);
const PDF_MIME = "application/pdf";

type SqlTagged = <T = Record<string, unknown>>(
  s: TemplateStringsArray,
  ...v: (string | number | boolean | null)[]
) => T[];

type IngestCtx = {
  bucket: R2Bucket;
  sql: SqlTagged;
  ai: Ai;
  wikiId: string;
  now?: Date;
};

type IngestFileArgs = IngestCtx & {
  file: { name: string; bytes: Uint8Array; mimeType: string };
};

function extFor(mime: string, name: string): string {
  if (mime === PDF_MIME) return "pdf";
  if (mime === "text/markdown") return "md";
  if (mime === "text/csv") return "csv";
  if (mime === "application/json") return "json";
  if (mime.startsWith("text/")) return "txt";
  if (mime === "text/html" || mime === "application/xhtml+xml") return "html";
  const m = name.match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : "bin";
}

function classifyType(mime: string): "text" | "pdf" | "url" {
  if (mime === PDF_MIME) return "pdf";
  return "text";
}

function isTextish(mime: string): boolean {
  return TEXT_MIMES.has(mime) || mime.startsWith("text/");
}

export async function ingestFile(args: IngestFileArgs): Promise<SourceRow> {
  const { bucket, sql, ai, wikiId, file } = args;
  const now = args.now ?? new Date();

  if (file.bytes.byteLength > MAX_FILE_BYTES) {
    throw new IngestError(
      "too_large",
      `File exceeds ${MAX_FILE_BYTES} bytes`,
    );
  }
  const mime = file.mimeType || "application/octet-stream";
  if (mime !== PDF_MIME && !isTextish(mime)) {
    throw new IngestError("unsupported_mime", `Unsupported mime: ${mime}`);
  }

  const id = sourceIdFromName(file.name, todayIso(now));
  const ext = extFor(mime, file.name);
  const originalKey = `${wikiId}/sources/originals/${id}.${ext}`;
  const parsedKey = `${wikiId}/sources/parsed/${id}.md`;

  // 1. Persist original
  await r2WriteBytes(bucket, originalKey, file.bytes, mime);

  // 2. Parse
  let parsed: string;
  let status: "ingested" | "failed" = "ingested";
  try {
    if (isTextish(mime)) {
      parsed = new TextDecoder().decode(file.bytes);
    } else {
      const blob = new Blob([file.bytes], { type: mime });
      const result = await ai.toMarkdown([{ name: file.name, blob }]);
      const first = Array.isArray(result) ? result[0] : result;
      if (first.format === "error") {
        throw new IngestError("parse_failed", first.error);
      }
      parsed = first.data;
    }
    await r2Write(bucket, parsedKey, parsed);
  } catch (err) {
    status = "failed";
    parsed = "";
  }

  const row: SourceRow = {
    id,
    filename: file.name,
    r2_key: parsedKey, // legacy column
    source_type: classifyType(mime),
    source_url: null,
    original_r2_key: originalKey,
    original_mime_type: mime,
    parsed_r2_key: status === "ingested" ? parsedKey : null,
    status,
    ingested_at: status === "ingested" ? now.toISOString() : null,
    page_count: 0,
  };

  upsertRow(sql, row);
  return row;
}

function upsertRow(sql: SqlTagged, row: SourceRow): void {
  sql`DELETE FROM sources WHERE id = ${row.id}`;
  sql`INSERT INTO sources (
        id, filename, r2_key, source_type, source_url,
        original_r2_key, original_mime_type, parsed_r2_key,
        status, ingested_at, page_count
      ) VALUES (
        ${row.id}, ${row.filename}, ${row.r2_key}, ${row.source_type}, ${row.source_url},
        ${row.original_r2_key}, ${row.original_mime_type}, ${row.parsed_r2_key},
        ${row.status}, ${row.ingested_at}, ${row.page_count}
      )`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- src/agent/ingest.test.ts
```
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/agent/ingest.ts src/agent/ingest.test.ts
git commit -m "feat(ingest): text-file path"
```

---

## Task 5: Ingest module — PDF path (TDD)

**Files:**
- Modify: `src/agent/ingest.test.ts`
- (No new code in `src/agent/ingest.ts` — already handles PDF)

- [ ] **Step 1: Add PDF happy-path test**

Append to `src/agent/ingest.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests; verify pass**

```bash
npm test -- src/agent/ingest.test.ts
```
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add src/agent/ingest.test.ts
git commit -m "test(ingest): pdf happy path"
```

---

## Task 6: Ingest module — failure paths (TDD)

**Files:**
- Modify: `src/agent/ingest.test.ts`
- Modify: `src/agent/ingest.ts` (refine failure handling so original is preserved)

- [ ] **Step 1: Add failure tests**

Append to `src/agent/ingest.test.ts`:

```ts
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
```

- [ ] **Step 2: Run tests**

```bash
npm test -- src/agent/ingest.test.ts
```
Expected: PASS (5 tests). The validation tests should pass because the existing implementation throws before any R2 write. The failure-mode test should pass because the existing code already swallows the throw and inserts a `failed` row.

If any test fails, refine `ingest.ts` to make the assertions hold (e.g., move R2 write of parsed into the try-block, leave the original write outside).

- [ ] **Step 3: Commit**

```bash
git add src/agent/ingest.ts src/agent/ingest.test.ts
git commit -m "test(ingest): validation and failure paths"
```

---

## Task 7: Ingest module — URL path with SSRF guard (TDD)

**Files:**
- Modify: `src/agent/ingest.ts` (add `ingestUrl`)
- Modify: `src/agent/ingest.test.ts` (add URL tests)

- [ ] **Step 1: Write failing URL tests**

Append to `src/agent/ingest.test.ts`:

```ts
import { ingestUrl } from "./ingest";

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
```

- [ ] **Step 2: Run tests; verify they fail**

```bash
npm test -- src/agent/ingest.test.ts
```
Expected: FAIL — `ingestUrl` not exported.

- [ ] **Step 3: Implement `ingestUrl` in `src/agent/ingest.ts`**

Append to `src/agent/ingest.ts`:

```ts
const URL_OK_MIMES = new Set([
  "text/html",
  "application/xhtml+xml",
  "text/plain",
]);

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "::1" || h === "0.0.0.0") return true;
  // IPv4 literal
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = m.slice(1).map((n) => parseInt(n, 10));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
  }
  return false;
}

type IngestUrlArgs = IngestCtx & {
  url: string;
  fetchImpl?: typeof fetch;
};

export async function ingestUrl(args: IngestUrlArgs): Promise<SourceRow> {
  const { bucket, sql, ai, wikiId, url } = args;
  const now = args.now ?? new Date();
  const fetchImpl = args.fetchImpl ?? fetch;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IngestError("bad_url", `Not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new IngestError("bad_url", `Unsupported protocol: ${parsed.protocol}`);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new IngestError("bad_url", `Refusing to fetch private host: ${parsed.hostname}`);
  }

  const res = await fetchImpl(url, {
    redirect: "follow",
    headers: {
      "user-agent":
        "workers-llm-wiki/1.0 (+https://github.com/lifanh/workers-llm-wiki)",
      accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5",
    },
  });
  if (!res.ok) {
    throw new IngestError(
      "fetch_failed",
      `Fetch returned ${res.status} ${res.statusText}`,
    );
  }
  const ct = res.headers.get("content-type") ?? "";
  const ctBase = ct.split(";")[0].trim().toLowerCase();
  if (!URL_OK_MIMES.has(ctBase)) {
    throw new IngestError(
      "unsupported_mime",
      `Unsupported content-type: ${ct}`,
    );
  }

  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.byteLength > MAX_URL_BYTES) {
    throw new IngestError(
      "too_large",
      `URL response exceeds ${MAX_URL_BYTES} bytes`,
    );
  }

  const id = sourceIdFromUrl(url, todayIso(now));
  const ext = ctBase === "text/plain" ? "txt" : "html";
  const originalKey = `${wikiId}/sources/originals/${id}.${ext}`;
  const parsedKey = `${wikiId}/sources/parsed/${id}.md`;

  await r2WriteBytes(bucket, originalKey, buf, ct);

  let parsedText: string;
  let status: "ingested" | "failed" = "ingested";
  try {
    if (ctBase === "text/plain") {
      parsedText = new TextDecoder().decode(buf);
    } else {
      const blob = new Blob([buf], { type: ctBase });
      const result = await ai.toMarkdown([{ name: `${id}.html`, blob }]);
      const first = Array.isArray(result) ? result[0] : result;
      if (first.format === "error") {
        throw new IngestError("parse_failed", first.error);
      }
      parsedText = first.data;
    }
    await r2Write(bucket, parsedKey, parsedText);
  } catch {
    status = "failed";
    parsedText = "";
  }

  const row: SourceRow = {
    id,
    filename: parsed.hostname + parsed.pathname,
    r2_key: parsedKey,
    source_type: "url",
    source_url: url,
    original_r2_key: originalKey,
    original_mime_type: ct,
    parsed_r2_key: status === "ingested" ? parsedKey : null,
    status,
    ingested_at: status === "ingested" ? now.toISOString() : null,
    page_count: 0,
  };

  upsertRow(sql, row);
  return row;
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- src/agent/ingest.test.ts
```
Expected: PASS (all URL tests + earlier ones).

- [ ] **Step 5: Commit**

```bash
git add src/agent/ingest.ts src/agent/ingest.test.ts
git commit -m "feat(ingest): url path with SSRF guard"
```

---

## Task 8: WikiAgent RPC methods + state sync

**Why:** HTTP endpoints and the agent tool both need to call ingest through the DO so writes go to the same sqlite.

**Files:**
- Modify: `src/agent/wiki-agent.ts`

- [ ] **Step 1: Add public RPC methods**

In `src/agent/wiki-agent.ts`, import:
```ts
import { ingestFile, ingestUrl } from "./ingest";
import type { SourceRow } from "./db";
```

Add inside the `WikiAgent` class (after `syncStateFromDb`):
```ts
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
```

- [ ] **Step 2: Update `syncStateFromDb` to include type info in state**

Replace the inner select:
```ts
    const sources =
      this.sql<{ id: string; filename: string; status: string; source_type: string; source_url: string | null }>`
        SELECT id, filename, status, source_type, source_url FROM sources ORDER BY rowid DESC`;
```

And update the `WikiState.sourceIndex` type to:
```ts
  sourceIndex: Array<{
    id: string;
    filename: string;
    status: string;
    source_type: string;
    source_url: string | null;
  }>;
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/agent/wiki-agent.ts
git commit -m "feat(agent): rpc methods for ingestFile/ingestUrl"
```

---

## Task 9: Source-tools — add `ingestUrl` agent tool

**Files:**
- Modify: `src/agent/tools/source-tools.ts`

- [ ] **Step 1: Add the new tool**

In `src/agent/tools/source-tools.ts`, add to imports:
```ts
import { ingestUrl as ingestUrlImpl } from "../ingest";
```

Extend the `ToolContext` to include `ai`:
```ts
type ToolContext = {
  bucket: R2Bucket;
  sql: <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => T[];
  wikiId: string;
  ai: Ai;
};
```

Add a new tool at the end of the returned object:
```ts
    ingestUrl: tool({
      description:
        "Fetch a web page and ingest it as a source. Stores the original HTML and a parsed Markdown rendering. Use this when the user asks to ingest a URL.",
      inputSchema: z.object({
        url: z.string().url().describe("Full http(s) URL to ingest"),
      }),
      execute: async ({ url }) => {
        try {
          const row = await ingestUrlImpl({
            bucket,
            sql,
            ai: ctx.ai,
            wikiId,
            url,
          });
          return {
            success: true,
            id: row.id,
            filename: row.filename,
            source_url: row.source_url,
            status: row.status,
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
          };
        }
      },
    }),
```

(Use `ctx.ai` instead of destructured `ai` to keep the existing destructure block intact, or include `ai` in the destructure.)

- [ ] **Step 2: Pass `ai` from `wiki-agent.ts`**

In `src/agent/wiki-agent.ts`, in `onChatMessage`, update the `toolCtx`:
```ts
    const toolCtx = {
      bucket,
      sql: this.boundSql,
      wikiId,
      ai: this.env.AI,
      onPagesChanged: () => this.syncStateFromDb(),
    };
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/agent/tools/source-tools.ts src/agent/wiki-agent.ts
git commit -m "feat(tools): expose ingestUrl as agent tool"
```

---

## Task 10: HTTP endpoints

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add ingest + originals endpoints**

Replace `src/server.ts` with:

```ts
import { routeAgentRequest, getAgentByName } from "agents";
import { r2Read, r2GetObject } from "./agent/r2";
import type { WikiAgent } from "./agent/wiki-agent";

export { WikiAgent } from "./agent/wiki-agent";

const WIKI_ID = "default";

function isValidPath(path: string): boolean {
  return !!path && !path.includes("..") && !path.startsWith("/");
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

async function getWikiAgent(env: Env) {
  return getAgentByName(env.WikiAgent, WIKI_ID) as unknown as WikiAgent;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ---------- POST /api/ingest/file ----------
    if (request.method === "POST" && url.pathname === "/api/ingest/file") {
      try {
        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return jsonResponse(
            { ok: false, error: "Missing 'file' field" },
            { status: 400 },
          );
        }
        const bytes = await file.arrayBuffer();
        const agent = await getWikiAgent(env);
        const row = await agent.ingestFileRpc({
          name: file.name,
          bytes,
          mimeType: file.type || "application/octet-stream",
        });
        return jsonResponse({ ok: true, source: row });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code as string | undefined;
        const status =
          code === "too_large" ? 413 : code === "unsupported_mime" ? 415 : 400;
        return jsonResponse({ ok: false, error: message, code }, { status });
      }
    }

    // ---------- POST /api/ingest/url ----------
    if (request.method === "POST" && url.pathname === "/api/ingest/url") {
      try {
        const body = (await request.json()) as { url?: string };
        if (!body.url || typeof body.url !== "string") {
          return jsonResponse(
            { ok: false, error: "Missing 'url'" },
            { status: 400 },
          );
        }
        const agent = await getWikiAgent(env);
        const row = await agent.ingestUrlRpc({ url: body.url });
        return jsonResponse({ ok: true, source: row });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const code = (err as any)?.code as string | undefined;
        const status =
          code === "bad_url"
            ? 400
            : code === "fetch_failed"
              ? 502
              : code === "unsupported_mime"
                ? 415
                : code === "too_large"
                  ? 413
                  : 500;
        return jsonResponse({ ok: false, error: message, code }, { status });
      }
    }

    // ---------- GET /api/originals/:id ----------
    if (request.method === "GET" && url.pathname.startsWith("/api/originals/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/originals/".length));
      if (!isValidPath(id)) return new Response("Invalid id", { status: 400 });
      const agent = await getWikiAgent(env);
      const row = await agent.getSourceRow(id);
      if (!row || !row.original_r2_key) {
        return new Response("Original not found", { status: 404 });
      }
      const obj = await r2GetObject(env.WIKI_BUCKET, row.original_r2_key);
      if (!obj) return new Response("Original missing in storage", { status: 404 });
      return new Response(obj.body, {
        headers: {
          "content-type": row.original_mime_type ?? "application/octet-stream",
          "content-disposition": `inline; filename="${row.filename.replace(/"/g, "")}"`,
        },
      });
    }

    // ---------- GET /api/wiki/:path ----------
    if (request.method === "GET" && url.pathname.startsWith("/api/wiki/")) {
      const pagePath = decodeURIComponent(
        url.pathname.slice("/api/wiki/".length),
      );
      if (!isValidPath(pagePath))
        return new Response("Invalid page path", { status: 400 });
      const content = await r2Read(
        env.WIKI_BUCKET,
        `${WIKI_ID}/wiki/${pagePath}.md`,
      );
      if (!content) return new Response("Page not found", { status: 404 });
      return new Response(content, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    // ---------- GET /api/sources/:filename (parsed) ----------
    if (request.method === "GET" && url.pathname.startsWith("/api/sources/")) {
      const filename = decodeURIComponent(
        url.pathname.slice("/api/sources/".length),
      );
      if (!isValidPath(filename))
        return new Response("Invalid filename", { status: 400 });
      const agent = await getWikiAgent(env);
      const row = await agent.getSourceRowByFilename(filename);
      const key =
        row?.parsed_r2_key ?? `${WIKI_ID}/sources/${filename}`; // legacy fallback
      const content = await r2Read(env.WIKI_BUCKET, key);
      if (!content) return new Response("Source not found", { status: 404 });
      return new Response(content, {
        headers: { "content-type": "text/markdown; charset=utf-8" },
      });
    }

    const response = await routeAgentRequest(request, env);
    if (response) return response;
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 2: Type-check & local sanity build**

```bash
npx tsc --noEmit
npm run build
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat(server): /api/ingest/file, /api/ingest/url, /api/originals/:id"
```

---

## Task 11: ChatPanel — switch file upload to fetch

**Why:** Eliminate the binary-`readAsText` crash and use the new endpoint.

**Files:**
- Modify: `src/app/components/ChatPanel.tsx`

- [ ] **Step 1: Replace `handleFileUpload`**

Remove the existing function (and the temporary text-only guard added earlier) and replace with:

```ts
  const [isUploading, setIsUploading] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      alert(`"${file.name}" is too large (max 25 MB).`);
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/ingest/file", { method: "POST", body: fd });
      const data = (await res.json()) as
        | { ok: true; source: { id: string; filename: string; status: string } }
        | { ok: false; error: string };
      if (!data.ok) {
        alert(`Failed to ingest "${file.name}": ${data.error}`);
        return;
      }
      sendMessage({
        text: `Ingested file "${data.source.filename}" (id: ${data.source.id}, status: ${data.source.status}). Please review and proceed.`,
      });
    } catch (err) {
      alert(
        `Failed to ingest "${file.name}": ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsUploading(false);
    }
  };
```

- [ ] **Step 2: Update file input `accept` and disabled state**

Change the `<input type="file" />` to:
```tsx
<input
  type="file"
  className="hidden"
  accept=".md,.txt,.json,.csv,.pdf,text/*,application/pdf"
  onChange={handleFileUpload}
  disabled={isUploading}
/>
```

And the wrapping `<label>`:
```tsx
<label className={`flex items-center cursor-pointer ${isUploading ? "opacity-50 pointer-events-none" : "text-gray-400 hover:text-gray-600"}`}>
  <span className="text-xl">📎</span>
  ...
</label>
```

- [ ] **Step 3: Build & sanity-check**

```bash
npm run build
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/ChatPanel.tsx
git commit -m "feat(ui): post uploads to /api/ingest/file"
```

---

## Task 12: ChatPanel — add 🔗 URL button

**Files:**
- Modify: `src/app/components/ChatPanel.tsx`

- [ ] **Step 1: Add URL state and handler**

Inside `ChatPanel`:
```ts
  const [urlInputOpen, setUrlInputOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [isIngestingUrl, setIsIngestingUrl] = useState(false);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlValue.trim();
    if (!url) return;
    setIsIngestingUrl(true);
    try {
      const res = await fetch("/api/ingest/url", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as
        | { ok: true; source: { id: string; filename: string; status: string; source_url: string } }
        | { ok: false; error: string };
      if (!data.ok) {
        alert(`Failed to ingest URL: ${data.error}`);
        return;
      }
      sendMessage({
        text: `Ingested URL "${data.source.source_url}" as source ${data.source.id} (status: ${data.source.status}). Please review and proceed.`,
      });
      setUrlValue("");
      setUrlInputOpen(false);
    } catch (err) {
      alert(`Failed to ingest URL: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsIngestingUrl(false);
    }
  };
```

- [ ] **Step 2: Add the 🔗 button + inline form to the input row**

Just before the existing `<label>` (📎) inside the form, add:
```tsx
<button
  type="button"
  onClick={() => setUrlInputOpen((v) => !v)}
  className="text-gray-400 hover:text-gray-600 text-xl"
  title="Ingest a web URL"
  disabled={isIngestingUrl}
>
  🔗
</button>
```

And above the existing form (still inside the input panel `<div>`), conditionally render:
```tsx
{urlInputOpen && (
  <form onSubmit={handleUrlSubmit} className="flex gap-2 mb-2">
    <input
      type="url"
      placeholder="https://example.com/article"
      value={urlValue}
      onChange={(e) => setUrlValue(e.target.value)}
      className="flex-1 border border-gray-300 rounded-lg px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      disabled={isIngestingUrl}
      autoFocus
    />
    <button
      type="submit"
      disabled={isIngestingUrl || !urlValue.trim()}
      className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
    >
      {isIngestingUrl ? "Ingesting..." : "Ingest"}
    </button>
  </form>
)}
```

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/ChatPanel.tsx
git commit -m "feat(ui): 🔗 button to ingest web URLs"
```

---

## Task 13: Sidebar — type icon + "open original" link

**Files:**
- Modify: `src/app/components/Sidebar.tsx`

- [ ] **Step 1: Inspect current Sidebar source rendering**

Read `src/app/components/Sidebar.tsx` to find the source list rendering (`source.status === "ingested" ? "✓" : "○"`). Locate the `source` object's available fields — they come from `state.sourceIndex` which now has `source_type` and `source_url` (Task 8).

- [ ] **Step 2: Replace the source row content**

Find the block rendering each `source` and update it to:
```tsx
<div className="flex items-center gap-1">
  <span className="mr-1">{source.status === "ingested" ? "✓" : source.status === "failed" ? "✗" : "○"}</span>
  <span title={source.source_type} className="text-base leading-none">
    {source.source_type === "pdf" ? "📄" : source.source_type === "url" ? "🔗" : "📝"}
  </span>
  <button
    type="button"
    onClick={() => onSelectSource?.(source.id)}
    className="text-left flex-1 truncate hover:underline"
    title={source.source_url ?? source.filename}
  >
    {source.filename}
  </button>
  <a
    href={`/api/originals/${encodeURIComponent(source.id)}`}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-gray-400 hover:text-gray-600"
    title="Open original"
  >
    ↗
  </a>
</div>
```

(Keep whatever wrapper / list structure already exists — only swap the inner row.)

- [ ] **Step 3: Build**

```bash
npm run build
```
Expected: success. If `onSelectSource` doesn't exist on the props, leave the existing click behaviour and just add the type icon and the `↗` link.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/Sidebar.tsx
git commit -m "feat(ui): show source type icon and original link in sidebar"
```

---

## Task 14: Cleanup — delete `FileUpload.tsx`

**Files:**
- Delete: `src/app/components/FileUpload.tsx`

- [ ] **Step 1: Confirm nothing imports it**

```bash
rg "FileUpload" src/
```
Expected: no matches outside the file itself.

- [ ] **Step 2: Delete it and commit**

```bash
git rm src/app/components/FileUpload.tsx
git commit -m "chore: remove unused FileUpload component"
```

---

## Task 15: End-to-end manual verification

**Files:** none (manual)

- [ ] **Step 1: Run all unit tests**

```bash
npm test
```
Expected: ALL pass (slug, ids, ingestFile text/pdf/validation/failure, ingestUrl happy/SSRF/4xx/wrong-mime).

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit && npm run build
```
Expected: 0 errors.

- [ ] **Step 3: Run dev server**

```bash
npm run dev
```

- [ ] **Step 4: Walk the manual checklist (from spec §9)**

In the running app:
1. Upload a small `.md` file → row appears with 📝 ✓; "view parsed" works.
2. Upload a 1–3 MB PDF → row appears with 📄 ✓; "view parsed" shows extracted Markdown; "↗" downloads the PDF unchanged.
3. Click 🔗, paste a real article URL (e.g. `https://en.wikipedia.org/wiki/Cloudflare_Workers`) → row appears with 🔗 ✓; parsed view shows readable text; "↗" returns the captured HTML.
4. Try a >25 MB file → user-friendly alert, no crash, no row created.
5. Try `http://localhost/foo` → alert "Refusing to fetch private host"; no crash.
6. In chat, ask the agent: "Please ingest https://example.com/" → it should call the `ingestUrl` tool and report back.

- [ ] **Step 5: Final commit (if any leftover changes)**

```bash
git status
# If clean, you're done. Otherwise:
git add -A
git commit -m "chore: post-verification cleanup"
```

---

## Self-review notes

- **Spec coverage**: every section of the design maps to a task — schema (Task 2), R2 helpers (Task 3), ingest module text/PDF/URL/failure (Tasks 4–7), DO RPC (Task 8), agent tool (Task 9), endpoints (Task 10), UI file/URL (Tasks 11–12), Sidebar (Task 13), cleanup (Task 14), verification (Task 15).
- **Type/name consistency**: `ingestFile` / `ingestUrl` (module) ↔ `ingestFileRpc` / `ingestUrlRpc` (DO methods) — kept distinct so the module functions can be unit-tested without a DO. `SourceRow` extended in Task 2 is consumed everywhere in Tasks 4–10.
- **No placeholders**: every step has actual code and a runnable command.
- **Risk note**: the `ALTER TABLE` template-tag escape hatch in Task 2 is the most fragile part. If the DO's `sql` rejects the manual `TemplateStringsArray` cast, the worker will throw on first start. Mitigation: smoke-test by starting `npm run dev` immediately after Task 2 against the existing DO storage, *before* moving on. Fallback: define a tiny `execRaw(sql, "ALTER TABLE ...")` helper that uses the underlying SQL execution API (e.g. `this.ctx.storage.sql.exec(...)`).
