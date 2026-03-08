import path from 'node:path';

export function isSpaAppRoute(pathname = '') {
  return pathname === '/'
    || pathname === '/auth'
    || pathname === '/context'
    || pathname === '/chat';
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
