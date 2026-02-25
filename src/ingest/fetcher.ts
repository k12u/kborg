import { extractCleanText, extractPlainText, extractMarkdownText } from '../utils/html.js';

const SUPPORTED_CONTENT_TYPES = ['text/html', 'text/plain', 'text/markdown', 'text/x-markdown'];

function extractTitle(content: string, contentType: string, url: string): string {
  if (contentType.includes('text/html')) {
    const match = content.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return match ? match[1].trim().replace(/\s+/g, ' ') : url;
  }
  if (contentType.includes('text/markdown') || contentType.includes('text/x-markdown')) {
    // 最初の ATX heading (#〜######) をタイトルとして使う
    const match = content.match(/^#{1,6}\s+(.+)$/m);
    if (match) return match[1].trim();
  }
  // text/plain: 最初の非空行の先頭 100 文字
  const firstLine = content.split('\n').find((l) => l.trim());
  return firstLine ? firstLine.trim().slice(0, 100) : url;
}

export async function fetchAndExtract(
  url: string
): Promise<{ title: string; cleanText: string }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: {
      'User-Agent': 'kborg/1.0',
    },
  });

  const contentType = response.headers.get('content-type') || '';
  const supported = SUPPORTED_CONTENT_TYPES.some((t) => contentType.includes(t));
  if (!supported) {
    throw new Error(`Unsupported content type: ${contentType}`);
  }

  const content = await response.text();
  const title = extractTitle(content, contentType, url);

  let cleanText: string;
  if (contentType.includes('text/html')) {
    cleanText = await extractCleanText(content);
  } else if (contentType.includes('text/markdown') || contentType.includes('text/x-markdown')) {
    cleanText = extractMarkdownText(content);
  } else {
    cleanText = extractPlainText(content);
  }

  return { title, cleanText };
}
