export async function upsertVector(
  index: VectorizeIndex,
  id: string,
  embedding: number[],
  metadata: { source: string; created_at: string },
): Promise<void> {
  await index.upsert([{ id, values: embedding, metadata }]);
}

export async function querySimilar(
  index: VectorizeIndex,
  embedding: number[],
  topK: number,
): Promise<string[]> {
  const result = await index.query(embedding, {
    topK,
    returnValues: false,
    returnMetadata: 'none',
  });
  return result.matches.map((m) => m.id);
}
