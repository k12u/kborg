type RouteHandler = (container: HTMLElement, params?: Record<string, string>) => void;

interface Route {
  pattern: RegExp;
  handler: RouteHandler;
  paramNames: string[];
}

const routes: Route[] = [];
let appContainer: HTMLElement | null = null;

export function registerRoute(
  path: string,
  handler: RouteHandler
): void {
  const paramNames: string[] = [];
  const patternStr = path.replace(/:(\w+)/g, (_match, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({
    pattern: new RegExp(`^${patternStr}$`),
    handler,
    paramNames,
  });
}

export function navigateTo(path: string): void {
  window.location.hash = path;
}

function resolve(): void {
  if (!appContainer) return;

  const hash = window.location.hash.slice(1) || '/';
  appContainer.innerHTML = '';

  // Update active tab
  document.querySelectorAll('nav a').forEach((a) => {
    const href = (a as HTMLAnchorElement).getAttribute('href') ?? '';
    const tabHash = href.slice(1) || '/';
    if (hash === tabHash || (hash.startsWith(tabHash) && tabHash !== '/')) {
      a.classList.add('active');
    } else if (tabHash === '/' && hash === '/') {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });

  for (const route of routes) {
    const match = hash.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });
      route.handler(appContainer, params);
      return;
    }
  }

  // Fallback: show first route (browse)
  if (routes.length > 0) {
    routes[0].handler(appContainer);
  }
}

export function initRouter(container: HTMLElement): void {
  appContainer = container;
  window.addEventListener('hashchange', resolve);
  resolve();
}
