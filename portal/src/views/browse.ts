import { Item } from '../types';
import { fetchItems } from '../api';
import { navigateTo } from '../router';

function scoreBadgeClass(score: number): string {
  if (score >= 0.7) return 'badge badge-green';
  if (score >= 0.4) return 'badge badge-yellow';
  return 'badge badge-gray';
}

function renderCard(item: Item): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <a class="card-title" data-id="${item.id}">${escapeHtml(item.title)}</a>
    <div class="card-summary">${escapeHtml(item.summary_short)}</div>
    <div class="card-meta">
      <span class="${scoreBadgeClass(item.base_score)}">${Math.round(item.base_score * 100)}%</span>
      ${item.pin === 1 ? '<span title="Pinned">📌</span>' : ''}
      ${item.tags.map((t) => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('')}
      <button class="btn" data-action="mute" data-id="${item.id}">mute</button>
      <button class="btn" data-action="archive" data-id="${item.id}">archive</button>
    </div>
  `;
  card.querySelector('.card-title')?.addEventListener('click', () => {
    navigateTo(`/item/${item.id}`);
  });
  return card;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

export function renderBrowse(container: HTMLElement): void {
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
      const result = await fetchItems('browse', cursor);
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
