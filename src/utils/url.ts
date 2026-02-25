const UTM_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
]);

export function normalizeUrl(url: string): string {
  const parsed = new URL(url);

  // Remove UTM parameters
  for (const key of [...parsed.searchParams.keys()]) {
    if (UTM_PARAMS.has(key)) {
      parsed.searchParams.delete(key);
    }
  }

  // Sort query parameters alphabetically
  parsed.searchParams.sort();

  // Remove fragment
  parsed.hash = '';

  let result = parsed.toString();

  // Remove trailing slash (but not for root path)
  if (result.endsWith('/') && parsed.pathname !== '/') {
    result = result.slice(0, -1);
  }

  return result;
}

export async function hashUrl(url: string): Promise<string> {
  const normalized = normalizeUrl(url);
  const data = new TextEncoder().encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
