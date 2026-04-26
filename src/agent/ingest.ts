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
      const blob = new Blob([file.bytes as BlobPart], { type: mime });
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
