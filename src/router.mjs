function compilePath(pathPattern) {
  const parts = pathPattern.split('/').filter(Boolean);
  const paramNames = [];

  const regexParts = parts.map((part) => {
    if (part.startsWith(':')) {
      const name = part.slice(1);
      paramNames.push(name);
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });

  const regex = new RegExp(`^/${regexParts.join('/')}$`);
  return { regex, paramNames };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  register(method, pathPattern, handler, options = {}) {
    const upperMethod = method.toUpperCase();
    const { regex, paramNames } = compilePath(pathPattern);
    this.routes.push({
      method: upperMethod,
      pathPattern,
      regex,
      paramNames,
      handler,
      auth: Boolean(options.auth),
    });
  }

  match(method, path) {
    const upperMethod = method.toUpperCase();

    for (const route of this.routes) {
      if (route.method !== upperMethod) {
        continue;
      }
      const match = route.regex.exec(path);
      if (!match) {
        continue;
      }

      const params = {};
      try {
        route.paramNames.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1]);
        });
      } catch {
        return null;
      }

      return {
        route,
        params,
      };
    }

    return null;
  }

  hasPath(path) {
    return this.routes.some((route) => route.regex.test(path));
  }
}
