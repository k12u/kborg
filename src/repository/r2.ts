export async function saveContent(
  bucket: R2Bucket,
  id: string,
  cleanText: string,
  meta: { url: string; processed_at: string }
): Promise<string> {
  const now = new Date();
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const key = `content/${yyyy}/${mm}/${id}.txt.gz`;

  // Compress with gzip
  const encoded = new TextEncoder().encode(cleanText);
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  writer.write(encoded);
  writer.close();

  // Collect into Uint8Array so R2 knows the content length
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const compressedBody = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    compressedBody.set(chunk, offset);
    offset += chunk.length;
  }

  await bucket.put(key, compressedBody, {
    httpMetadata: {
      contentEncoding: 'gzip',
      contentType: 'text/plain; charset=utf-8',
    },
    customMetadata: {
      url: meta.url,
      processed_at: meta.processed_at,
    },
  });

  return key;
}

export async function getContent(
  bucket: R2Bucket,
  key: string
): Promise<string> {
  const obj = await bucket.get(key);
  if (!obj) {
    throw new Error(`R2 object not found: ${key}`);
  }

  const ds = new DecompressionStream('gzip');
  const decompressed = obj.body.pipeThrough(ds);
  const reader = decompressed.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(merged);
}
