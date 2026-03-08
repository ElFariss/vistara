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

export function resolveStaticRelativePath(pathname = '') {
  return isSpaAppRoute(pathname) ? '/index.html' : pathname;
}

export function shouldDisableStaticCache({
  pathname = '',
  filePath = '',
} = {}) {
  const requestedExt = path.extname(filePath).toLowerCase();
  return isSpaAppRoute(pathname)
    || pathname === '/index.html'
    || requestedExt === '.js'
    || requestedExt === '.css';
}
