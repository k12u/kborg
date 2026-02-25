import { Item } from '../types';
import { fetchItems } from '../api';
import { navigateTo } from '../router';

function scoreBadgeClass(score: number): string {
  if (score >= 0.7) return 'badge badge-green';
  if (score >= 0.4) return 'badge badge-yellow';
  return 'badge badge-gray';
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderCard(item: Item): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:start;">
      <a class="card-title" data-id="${item.id}">${escapeHtml(item.title)}</a>
      <span class="card-time">${formatTime(item.created_at)}</span>
    </div>
    <div class="card-summary">${escapeHtml(item.summary_short)}</div>
    <div class="card-meta">
      <span class="${scoreBadgeClass(item.base_score)}">${Math.round(item.base_score * 100)}%</span>
      ${item.pin === 1 ? '<span title="Pinned">📌</span>' : ''}
      <span class="badge badge-gray">${item.status}</span>
    </div>
  `;
  card.querySelector('.card-title')?.addEventListener('click', () => {
    navigateTo(`/item/${item.id}`);
  });
  return card;
}

export function renderRecent(container: HTMLElement): void {
  container.innerHTML = '<div class="loading">Loading...</div>';

  let cursor: string | undefined;
  let loading = false;
  let hasMore = true;

  const list = document.createElement('div');
  const sentinel = document.createElement('div');
  sentinel.className = 'loading';

  async function loadMore(): Promise<void> {
    if (loading || !hasMore) return;
    loading = true;
    sentinel.textContent = 'Loading...';
    try {
      const result = await fetchItems('recent', cursor);
      result.items.forEach((item) => {
        list.appendChild(renderCard(item));
      });
      cursor = result.nextCursor ?? undefined;
      hasMore = result.nextCursor !== null;
      if (!hasMore) sentinel.textContent = '';
    } catch {
      sentinel.textContent = 'Failed to load items.';
    }
    loading = false;
  }

  container.innerHTML = '';
  container.appendChild(list);
  container.appendChild(sentinel);

  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMore();
    }
  });
  observer.observe(sentinel);

  loadMore();
}
