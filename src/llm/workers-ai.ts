export async function runChat(
  ai: Ai,
  messages: Array<{ role: string; content: string }>,
): Promise<string> {
  const result = await ai.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages,
    max_tokens: 1024,
    temperature: 0,
  });
  return (result as { response?: string }).response ?? '';
}

export async function runEmbedding(
  ai: Ai,
  text: string,
): Promise<number[]> {
  const result = await ai.run('@cf/baai/bge-base-en-v1.5', {
    text: [text],
  });
  return (result as { data: number[][] }).data[0];
}
