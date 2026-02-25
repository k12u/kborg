import { registerRoute, initRouter } from './router';
import { renderBrowse } from './views/browse';
import { renderRecent } from './views/recent';
import { renderOrg } from './views/org';
import { renderDetail } from './views/detail';
import { renderSearch } from './views/search';

registerRoute('/', (container) => renderBrowse(container));
registerRoute('/recent', (container) => renderRecent(container));
registerRoute('/org', (container) => renderOrg(container));
registerRoute('/item/:id', (container, params) => {
  if (params?.id) renderDetail(container, params.id);
});
registerRoute('/search', (container) => renderSearch(container));

const app = document.getElementById('app');
if (app) {
  initRouter(app);
}
