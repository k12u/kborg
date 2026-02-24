import { Item, ItemsListResponse } from './types';
import { mockItems } from './mock';

const API_BASE = import.meta.env.VITE_API_BASE ?? '';

function useMock(): boolean {
  return API_BASE === '';
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<T>;
}

export async function fetchItems(
  view: 'browse' | 'recent' | 'org',
  cursor?: string,
  limit = 20
): Promise<ItemsListResponse> {
  if (useMock()) {
    let items = [...mockItems];
    if (view === 'browse') {
      items = items
        .filter((i) => i.status === 'active')
        .sort((a, b) => b.pin - a.pin || b.base_score - a.base_score);
    } else if (view === 'recent') {
      items.sort((a, b) => b.created_at.localeCompare(a.created_at));
    } else if (view === 'org') {
      items = items
        .filter((i) => i.status === 'active' && i.org_score >= 0.6)
        .sort((a, b) => b.org_score - a.org_score);
    }
    return { items, nextCursor: null };
  }
  const params = new URLSearchParams({ view, limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJSON<ItemsListResponse>(`${API_BASE}/api/items?${params}`);
}

export async function fetchItem(id: string): Promise<Item> {
  if (useMock()) {
    const item = mockItems.find((i) => i.id === id);
    if (!item) throw new Error('Item not found');
    return item;
  }
  return fetchJSON<Item>(`${API_BASE}/api/items/${id}`);
}

export async function fetchItemContent(id: string): Promise<string> {
  if (useMock()) {
    return `This is the full content of the article "${id}".\n\nLorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\nDuis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.`;
  }
  const res = await fetch(`${API_BASE}/api/items/${id}/content`);
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.text();
}

export async function fetchSimilar(id: string, topK = 10): Promise<Item[]> {
  if (useMock()) {
    return mockItems.filter((i) => i.id !== id).slice(0, topK);
  }
  return fetchJSON<Item[]>(`${API_BASE}/api/items/${id}/similar?topK=${topK}`);
}

export async function searchItems(q: string, limit = 10): Promise<Item[]> {
  if (useMock()) {
    const lower = q.toLowerCase();
    return mockItems.filter(
      (i) =>
        i.title.toLowerCase().includes(lower) ||
        i.summary_short.toLowerCase().includes(lower) ||
        i.summary_long.toLowerCase().includes(lower) ||
        i.tags.some((t) => t.includes(lower))
    ).slice(0, limit);
  }
  const params = new URLSearchParams({ q, limit: String(limit) });
  return fetchJSON<Item[]>(`${API_BASE}/api/search?${params}`);
}

export async function updateStatus(
  id: string,
  status: string,
  apiKey: string
): Promise<void> {
  if (useMock()) return;
  const res = await fetch(`${API_BASE}/api/items/${id}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function updatePin(
  id: string,
  pin: 0 | 1,
  apiKey: string
): Promise<void> {
  if (useMock()) return;
  const res = await fetch(`${API_BASE}/api/items/${id}/pin`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}
