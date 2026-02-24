import type { Env } from './types.js';
import { handleIngest } from './ingest/handler.js';
import {
  handleItemsList,
  handleItemDetail,
  handleItemContent,
  handleItemSimilar,
  handleItemStatus,
  handleItemPin,
} from './portal/items.js';
import { handleSearch } from './portal/search.js';

// CORS ヘッダー（Cloudflare Pages オリジンを許可）
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    headers.set(k, v);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    try {
      let response: Response;

      // POST /api/ingest
      if (method === 'POST' && pathname === '/api/ingest') {
        response = await handleIngest(request, env);
      }
      // GET /api/items
      else if (method === 'GET' && pathname === '/api/items') {
        response = await handleItemsList(request, env);
      }
      // GET /api/search
      else if (method === 'GET' && pathname === '/api/search') {
        response = await handleSearch(request, env);
      }
      // /api/items/:id/*
      else if (pathname.startsWith('/api/items/')) {
        const rest = pathname.slice('/api/items/'.length);
        const parts = rest.split('/');
        const id = parts[0];

        if (!id) {
          response = Response.json({ error: 'Missing item id' }, { status: 400 });
        } else if (method === 'GET' && parts.length === 1) {
          // GET /api/items/:id
          response = await handleItemDetail(request, env, id);
        } else if (method === 'GET' && parts[1] === 'content') {
          // GET /api/items/:id/content
          response = await handleItemContent(request, env, id);
        } else if (method === 'GET' && parts[1] === 'similar') {
          // GET /api/items/:id/similar
          response = await handleItemSimilar(request, env, id);
        } else if (method === 'PATCH' && parts[1] === 'status') {
          // PATCH /api/items/:id/status
          response = await handleItemStatus(request, env, id);
        } else if (method === 'PATCH' && parts[1] === 'pin') {
          // PATCH /api/items/:id/pin
          response = await handleItemPin(request, env, id);
        } else {
          response = Response.json({ error: 'Not Found' }, { status: 404 });
        }
      } else {
        response = Response.json({ error: 'Not Found' }, { status: 404 });
      }

      return corsResponse(response);
    } catch (err) {
      console.error('Unhandled error:', err);
      const message = err instanceof Error ? err.message : 'Internal Server Error';
      return corsResponse(
        Response.json({ error: message }, { status: 500 })
      );
    }
  },
} satisfies ExportedHandler<Env>;
