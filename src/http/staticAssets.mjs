import path from 'node:path';

export function normalizeStaticPathname(pathname = '') {
  const value = String(pathname || '').trim() || '/';
  if (value === '/') {
    return '/';
  }
  return value.replace(/\/+$/, '') || '/';
}

export function isSpaAppRoute(pathname = '') {
  const normalized = normalizeStaticPathname(pathname);
  return normalized === '/'
    || normalized === '/auth'
    || normalized === '/context'
    || normalized === '/chat';
}

export function isSharedStaticPath(pathname = '') {
  return normalizeStaticPathname(pathname).startsWith('/shared/');
}

export function resolveStaticRelativePath(pathname = '') {
  if (isSpaAppRoute(pathname)) {
    return '/index.html';
  }
  if (isSharedStaticPath(pathname)) {
    return normalizeStaticPathname(pathname).replace(/^\/shared/, '') || '/';
  }
  return pathname;
}

export function shouldDisableStaticCache({
  pathname = '',
  filePath = '',
} = {}) {
  const requestedExt = path.extname(filePath).toLowerCase();
  return isSpaAppRoute(pathname)
    || pathname === '/index.html'
    || requestedExt === '.js'
    || requestedExt === '.mjs'
    || requestedExt === '.css';
}
