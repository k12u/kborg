const MAX_LENGTH = 30720; // ~30KB

// ── plain text ────────────────────────────────────────────────────────────────

export function extractPlainText(text: string): string {
  let result = text.replace(/\s+/g, ' ').trim();
  if (result.length > MAX_LENGTH) result = result.slice(0, MAX_LENGTH);
  return result;
}

// ── markdown ──────────────────────────────────────────────────────────────────

const MARKDOWN_PATTERNS: Array<[RegExp, string]> = [
  [/```[\s\S]*?```/g, ''],             // fenced code blocks → 除去
  [/`([^`\n]+)`/g, '$1'],              // inline code → テキストを残す
  [/!\[[^\]]*\]\([^)]*\)/g, ''],       // images → 除去
  [/\[([^\]]+)\]\([^)]+\)/g, '$1'],    // links → テキストを残す
  [/\*{1,3}([^*\n]+)\*{1,3}/g, '$1'], // bold/italic (* 系) → テキストを残す
  [/_{1,3}([^_\n]+)_{1,3}/g, '$1'],   // bold/italic (_ 系) → テキストを残す
  [/^#{1,6}\s+/gm, ''],               // ATX headings → マーカー除去
  [/^>\s*/gm, ''],                     // blockquotes → マーカー除去
  [/^[-*+]\s+/gm, ''],                // unordered list markers → 除去
  [/^\d+\.\s+/gm, ''],               // ordered list markers → 除去
  [/^[-*_]{3,}\s*$/gm, ''],           // horizontal rules → 除去
];

export function extractMarkdownText(text: string): string {
  let result = text;
  for (const [pattern, replacement] of MARKDOWN_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  result = result.replace(/\s+/g, ' ').trim();
  if (result.length > MAX_LENGTH) result = result.slice(0, MAX_LENGTH);
  return result;
}

// ── HTML (HTMLRewriter) ───────────────────────────────────────────────────────

const REMOVE_TAGS = ['script', 'style', 'nav', 'header', 'footer'];

const CONTENT_SELECTORS = [
  'article',
  'main',
  '[class*="content"]',
  '[class*="post"]',
  '[id*="content"]',
];

export async function extractCleanText(html: string): Promise<string> {
  let contentText = '';
  let bodyText = '';
  let insideRemoveTag = 0;
  let insideContent = 0;

  const rewriter = new HTMLRewriter();

  // Track removed tags: increment on open, decrement on close
  for (const tag of REMOVE_TAGS) {
    rewriter.on(tag, {
      element(element) {
        insideRemoveTag++;
        element.onEndTag(() => {
          insideRemoveTag--;
        });
      },
    });
  }

  // Track content areas: increment on open, decrement on close
  for (const selector of CONTENT_SELECTORS) {
    rewriter.on(selector, {
      element(element) {
        insideContent++;
        element.onEndTag(() => {
          insideContent--;
        });
      },
    });
  }

  // Capture all text nodes
  rewriter.on('*', {
    text(text) {
      if (insideRemoveTag > 0) return;
      const t = text.text;
      if (!t) return;
      if (insideContent > 0) {
        contentText += t + ' ';
      }
      bodyText += t + ' ';
    },
  });

  const response = rewriter.transform(new Response(html));
  await response.text(); // Consume to trigger handlers

  // Prefer content text, fall back to body text
  let result = contentText.trim() || bodyText.trim();

  // Normalize whitespace
  result = result.replace(/\s+/g, ' ').trim();

  // Truncate if needed
  if (result.length > MAX_LENGTH) {
    result = result.slice(0, MAX_LENGTH);
  }

  return result;
}
