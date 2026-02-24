import { Item } from '../types';
import { searchItems } from '../api';
import { navigateTo } from '../router';

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function scoreBadgeClass(score: number): string {
  if (score >= 0.7) return 'badge badge-green';
  if (score >= 0.4) return 'badge badge-yellow';
  return 'badge badge-gray';
}

function renderResultCard(item: Item): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <a class="card-title" data-id="${item.id}">${escapeHtml(item.title)}</a>
    <div class="card-summary">${escapeHtml(item.summary_short)}</div>
    <div class="card-meta">
      <span class="${scoreBadgeClass(item.base_score)}">${Math.round(item.base_score * 100)}%</span>
      ${item.tags.map((t) => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('')}
    </div>
  `;
  card.querySelector('.card-title')?.addEventListener('click', () => {
    navigateTo(`/item/${item.id}`);
  });
  return card;
}

export function renderSearch(container: HTMLElement): void {
  container.innerHTML = '';

  const form = document.createElement('form');
  form.innerHTML = `<input type="text" class="search-input" placeholder="キーワードで検索..." autofocus />`;
  container.appendChild(form);

  const results = document.createElement('div');
  container.appendChild(results);

  const input = form.querySelector('input') as HTMLInputElement;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;

    results.innerHTML = '<div class="loading">Searching...</div>';

    try {
      const items = await searchItems(q);
      results.innerHTML = '';
      if (items.length === 0) {
        results.innerHTML = '<div class="card">No results found.</div>';
      } else {
        items.forEach((item) => {
          results.appendChild(renderResultCard(item));
        });
      }
    } catch {
      results.innerHTML = '<div class="card">Search failed.</div>';
    }
  });
}
