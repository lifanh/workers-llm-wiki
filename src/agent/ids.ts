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
