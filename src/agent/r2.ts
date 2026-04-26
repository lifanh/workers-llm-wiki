export async function r2Read(
  bucket: R2Bucket,
  key: string,
): Promise<string | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return obj.text();
}

export async function r2Write(
  bucket: R2Bucket,
  key: string,
  content: string,
): Promise<void> {
  await bucket.put(key, content);
}

export async function r2Delete(
  bucket: R2Bucket,
  key: string,
): Promise<void> {
  await bucket.delete(key);
}

export async function r2List(
  bucket: R2Bucket,
  prefix: string,
): Promise<string[]> {
  const listed = await bucket.list({ prefix });
  return listed.objects.map((obj) => obj.key);
}

export async function r2Append(
  bucket: R2Bucket,
  key: string,
  content: string,
): Promise<void> {
  const existing = await r2Read(bucket, key);
  const updated = existing ? existing + "\n" + content : content;
  await r2Write(bucket, key, updated);
}

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
