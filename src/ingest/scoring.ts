import type { Env, IngestContext } from '../types.js';
import { runChat } from '../llm/workers-ai.js';

export interface ScoringResult {
  title: string;
  summary_short: string;
  summary_long: string;
  tags: string[];
  personal_score: number;
  org_score: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function fallback(ctx: IngestContext): ScoringResult {
  return {
    title: ctx.title,
    summary_short: ctx.cleanText.slice(0, 80),
    summary_long: ctx.cleanText.slice(0, 400),
    tags: [],
    personal_score: 0.5,
    org_score: 0.5,
  };
}

export async function scoreContent(
  env: Env,
  ctx: IngestContext,
): Promise<ScoringResult> {
  try {
    const profile = await env.DB.prepare(
      'SELECT interests FROM user_profile WHERE id=1',
    ).first<{ interests: string }>();
    const interests: string[] = profile?.interests
      ? JSON.parse(profile.interests)
      : [];

    const orgRows = await env.DB.prepare(
      'SELECT theme FROM org_themes ORDER BY weight DESC LIMIT 20',
    ).all<{ theme: string }>();
    const orgThemes = orgRows.results.map((r) => r.theme);

    const tagRows = await env.DB.prepare(
      'SELECT tag FROM tag_vocabulary ORDER BY usage_count DESC LIMIT 50',
    ).all<{ tag: string }>();
    const existingTags = tagRows.results.map((r) => r.tag);

    const contentTruncated = ctx.cleanText.slice(0, 3000);

    const systemPrompt = 'You are a knowledge curation assistant.';
    const userPrompt = `Analyze the following article and return a JSON object.

User interests: ${JSON.stringify(interests)}
Organization themes: ${orgThemes.join(', ')}

Article URL: ${ctx.url}
Article title: ${ctx.title}
Article content (first 3000 chars):
---
${contentTruncated}
---

Return ONLY a JSON object with these fields:
{
  "title": "article title (use original if adequate, improve if needed)",
  "summary_short": "one-line summary, max 80 characters",
  "summary_long": "detailed summary, max 400 characters",
  "tags": ["tag1", "tag2", ...],
  "personal_score": 0.0-1.0,
  "org_score": 0.0-1.0
}

Preferred tags: ${existingTags.join(', ')}`;

    const response = await runChat(env.AI, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ]);

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return fallback(ctx);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      title: typeof parsed.title === 'string' ? parsed.title : ctx.title,
      summary_short:
        typeof parsed.summary_short === 'string'
          ? parsed.summary_short.slice(0, 80)
          : ctx.cleanText.slice(0, 80),
      summary_long:
        typeof parsed.summary_long === 'string'
          ? parsed.summary_long.slice(0, 400)
          : ctx.cleanText.slice(0, 400),
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t: unknown) => typeof t === 'string').slice(0, 5)
        : [],
      personal_score: clamp(
        typeof parsed.personal_score === 'number' ? parsed.personal_score : 0.5,
        0,
        1,
      ),
      org_score: clamp(
        typeof parsed.org_score === 'number' ? parsed.org_score : 0.5,
        0,
        1,
      ),
    };
  } catch {
    return fallback(ctx);
  }
}
