import { fetchItem, fetchItemContent, fetchSimilar } from '../api';
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

export async function renderDetail(
  container: HTMLElement,
  id: string
): Promise<void> {
  container.innerHTML = '<div class="loading">Loading...</div>';

  try {
    const item = await fetchItem(id);

    container.innerHTML = `
      <div class="card">
        <h1 style="font-size:20px;margin-bottom:12px;">${escapeHtml(item.title)}</h1>

        <div class="detail-section">
          <div class="card-meta" style="margin-bottom:12px;">
            ${item.tags.map((t) => `<span class="badge-tag">${escapeHtml(t)}</span>`).join('')}
            <span class="badge badge-gray">${item.status}</span>
            ${item.pin === 1 ? '<span title="Pinned">📌</span>' : ''}
          </div>
        </div>

        <div class="detail-section">
          <h2>Summary</h2>
          <p style="font-weight:600;font-size:15px;margin-bottom:8px;">${escapeHtml(item.summary_short)}</p>
          <p style="font-size:14px;color:#555;">${escapeHtml(item.summary_long)}</p>
        </div>

        <div class="detail-section">
          <h2>Scores</h2>
          <div class="score-grid">
            <div class="score-item">
              <div class="label">Base</div>
              <div class="value" style="color:${item.base_score >= 0.7 ? '#28a745' : item.base_score >= 0.4 ? '#ffc107' : '#6c757d'}">${Math.round(item.base_score * 100)}%</div>
            </div>
            <div class="score-item">
              <div class="label">Personal</div>
              <div class="value">${Math.round(item.personal_score * 100)}%</div>
            </div>
            <div class="score-item">
              <div class="label">Org</div>
              <div class="value">${Math.round(item.org_score * 100)}%</div>
            </div>
            <div class="score-item">
              <div class="label">Novelty</div>
              <div class="value">${Math.round(item.novelty * 100)}%</div>
            </div>
          </div>
        </div>

        <div class="detail-section">
          <h2>Content</h2>
          <button class="btn" id="toggle-content">Show full content</button>
          <div class="accordion-content" id="content-body"></div>
        </div>

        <div class="detail-section">
          <h2>Similar Articles</h2>
          <ul class="similar-list" id="similar-list">
            <li class="loading">Loading...</li>
          </ul>
        </div>

        <div class="detail-section">
          <h2>Actions</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button class="btn" data-action="mute">Mute</button>
            <button class="btn" data-action="archive">Archive</button>
            <button class="btn" data-action="pin">${item.pin === 1 ? 'Unpin' : 'Pin'}</button>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noopener" class="btn">Open original URL</a>
          </div>
        </div>

        <div style="font-size:12px;color:#999;margin-top:16px;">
          Source: ${escapeHtml(item.source)} | Created: ${item.created_at} | ID: ${item.id}
        </div>
      </div>
    `;

    // Content accordion
    const toggleBtn = container.querySelector('#toggle-content') as HTMLButtonElement;
    const contentBody = container.querySelector('#content-body') as HTMLElement;
    let contentLoaded = false;

    toggleBtn.addEventListener('click', async () => {
      if (!contentLoaded) {
        contentBody.textContent = 'Loading...';
        contentBody.classList.add('open');
        try {
          const text = await fetchItemContent(id);
          contentBody.textContent = text;
          contentLoaded = true;
        } catch {
          contentBody.textContent = 'Failed to load content.';
        }
      } else {
        contentBody.classList.toggle('open');
      }
      toggleBtn.textContent = contentBody.classList.contains('open')
        ? 'Hide content'
        : 'Show full content';
    });

    // Similar articles
    const similarList = container.querySelector('#similar-list') as HTMLElement;
    try {
      const similar = await fetchSimilar(id, 5);
      if (similar.length === 0) {
        similarList.innerHTML = '<li>No similar articles found.</li>';
      } else {
        similarList.innerHTML = similar
          .map(
            (s) =>
              `<li><a data-id="${s.id}" href="#/item/${s.id}">${escapeHtml(s.title)}</a>
               <span class="${scoreBadgeClass(s.base_score)}" style="margin-left:8px;">${Math.round(s.base_score * 100)}%</span></li>`
          )
          .join('');
        similarList.querySelectorAll('a[data-id]').forEach((a) => {
          a.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = (a as HTMLElement).dataset.id!;
            navigateTo(`/item/${targetId}`);
          });
        });
      }
    } catch {
      similarList.innerHTML = '<li>Failed to load similar articles.</li>';
    }
  } catch {
    container.innerHTML = '<div class="card">Item not found.</div>';
  }
}
