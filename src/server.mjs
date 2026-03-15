import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { closeDatabase, initializeDatabase } from './db.mjs';
import { config } from './config.mjs';
import { Router } from './router.mjs';
import { authenticateRequest } from './http/auth.mjs';
import { resolveAllowedOrigin } from './http/cors.mjs';
import { createRateLimiter, resolveRateLimitPolicy } from './http/rateLimit.mjs';
import { getClientIp, parseRequestBody, parseUrl } from './http/request.mjs';
import { resolveHttpError, sendError, sendJson, sendMethodNotAllowed, sendNotFound } from './http/response.mjs';
import { applySecurityHeaders } from './http/securityHeaders.mjs';
import { resolveStaticRelativePath, shouldDisableStaticCache } from './http/staticAssets.mjs';
import { createLogger } from './utils/logger.mjs';
import { registerAuthRoutes } from './routes/auth.mjs';
import { registerBusinessRoutes } from './routes/business.mjs';
import { registerDataRoutes } from './routes/data.mjs';
import { registerChatRoutes } from './routes/chat.mjs';
import { registerDashboardRoutes } from './routes/dashboards.mjs';
import { registerInsightRoutes } from './routes/insights.mjs';
import { registerReportRoutes } from './routes/reports.mjs';
import { registerGoalRoutes } from './routes/goals.mjs';
import { registerInternalRoutes } from './routes/internal.mjs';

const logger = createLogger('server');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');
const distDir = path.resolve(__dirname, '../dist');

const router = new Router();
const defaultRateLimit = createRateLimiter(config.rateLimitPerMinute);
const demoAuthRateLimit = createRateLimiter(config.demoAuthRateLimitPerMinute);
let shuttingDown = false;

registerAuthRoutes(router);
registerBusinessRoutes(router);
registerDataRoutes(router);
registerChatRoutes(router);
registerDashboardRoutes(router);
registerInsightRoutes(router);
registerReportRoutes(router);
registerGoalRoutes(router);
registerInternalRoutes(router);

router.register('GET', '/api/health', async (ctx) => {
  return sendJson(ctx.res, 200, {
    ok: true,
    service: 'umkm-conversational-intelligence',
    env: config.env,
    gemini_model: config.geminiModel,
    python_agent_enabled: Boolean(config.pythonAgentBackendUrl),
    timestamp: new Date().toISOString(),
  });
});

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Vary', 'Origin');
  }
  const allowedOrigin = resolveAllowedOrigin(origin);
  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  }

  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
}

function serveStatic(pathname, res) {
  const relativePath = resolveStaticRelativePath(pathname);
  const normalized = path.normalize(relativePath).replace(/^([.]{2}[\/\\])+/, '');

  // Try dist/ first (Vite build output), then public/ (raw assets)
  const distTarget = path.join(distDir, normalized);
  const publicTarget = path.join(publicDir, normalized);
  const useViteBuild = fs.existsSync(distDir) && !config.servePublicAssets;

  let target = null;
  if (useViteBuild && distTarget.startsWith(distDir) && fs.existsSync(distTarget) && !fs.statSync(distTarget).isDirectory()) {
    target = distTarget;
  } else if (publicTarget.startsWith(publicDir) && fs.existsSync(publicTarget) && !fs.statSync(publicTarget).isDirectory()) {
    target = publicTarget;
  }

  // SPA fallback: serve index.html for non-file paths (HTML5 history routing)
  if (!target) {
    const indexTarget = useViteBuild
      ? path.join(distDir, 'index.html')
      : path.join(publicDir, 'index.html');
    if (fs.existsSync(indexTarget)) {
      target = indexTarget;
    }
  }

  if (!target) {
    return sendNotFound(res);
  }

  const content = fs.readFileSync(target);
  const disableCache = shouldDisableStaticCache({
    pathname,
    filePath: target,
  });
  res.writeHead(200, {
    'Content-Type': getContentType(target),
    'Cache-Control': disableCache ? 'no-store' : 'public, max-age=3600',
  });
  res.end(content);
}

try {
  await initializeDatabase();
} catch (error) {
  logger.error('database_init_failed', { error: error.message });
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const method = req.method || 'GET';
  const { pathname, searchParams } = parseUrl(req);

  applySecurityHeaders(res);
  applyCors(req, res);

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!pathname.startsWith('/api')) {
    if (method !== 'GET' && method !== 'HEAD') {
      return sendMethodNotAllowed(res);
    }
    return serveStatic(pathname, res);
  }

  if (shuttingDown) {
    return sendError(res, 503, 'SERVER_SHUTTING_DOWN', 'Server sedang dimatikan. Coba lagi sebentar.');
  }

  const ip = getClientIp(req);
  const rateLimitPolicy = resolveRateLimitPolicy(pathname, {
    defaultLimitPerMinute: config.rateLimitPerMinute,
    demoAuthLimitPerMinute: config.demoAuthRateLimitPerMinute,
  });
  if (rateLimitPolicy.enabled) {
    const limiter = rateLimitPolicy.scope === 'auth-demo' ? demoAuthRateLimit : defaultRateLimit;
    const limit = limiter(`${ip}:${rateLimitPolicy.scope}`);
    res.setHeader('X-RateLimit-Remaining', String(limit.remaining ?? 0));
    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfterSeconds || 60));
      return sendError(res, 429, 'RATE_LIMITED', 'Terlalu banyak permintaan. Coba lagi sebentar.');
    }
  }

  const match = router.match(method, pathname);
  if (!match) {
    if (router.hasPath(pathname)) {
      return sendMethodNotAllowed(res);
    }
    return sendNotFound(res);
  }

  const { route, params } = match;
  const bodyCache = { value: null, loaded: false };

  const ctx = {
    req,
    res,
    method,
    path: pathname,
    query: searchParams,
    params,
    user: null,
    ip,
    getBody: async () => {
      if (bodyCache.loaded) {
        return bodyCache.value;
      }
      bodyCache.value = await parseRequestBody(req);
      bodyCache.loaded = true;
      return bodyCache.value;
    },
  };

  if (route.auth) {
    const user = await authenticateRequest(req);
    if (!user) {
      return sendError(res, 401, 'UNAUTHORIZED', 'Token tidak valid atau kadaluwarsa.');
    }
    ctx.user = user;
  }

  try {
    await route.handler(ctx);
    logger.info('request_complete', {
      method,
      path: pathname,
      statusCode: res.statusCode,
      duration_ms: Date.now() - started,
      user_id: ctx.user?.id || null,
    });
  } catch (error) {
    logger.error('request_failed', {
      method,
      path: pathname,
      error: error.message,
      stack: error.stack,
    });

    if (!res.headersSent) {
      const httpError = resolveHttpError(error, {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        message: 'Terjadi kesalahan internal server.',
      });
      sendError(res, httpError.statusCode, httpError.code, httpError.message);
    } else {
      res.end();
    }
  }
});

async function listenWithRetry(startPort, maxAttempts = 5) {
  let port = startPort;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const actualPort = port;

    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.off('error', onError);
          reject(err);
        };

        server.once('error', onError);
        server.listen(actualPort, () => {
          server.off('error', onError);
          resolve();
        });
      });

      logger.info('server_started', {
        port: actualPort,
        env: config.env,
        gemini_model: config.geminiModel,
        gemini_enabled: Boolean(config.geminiApiKey),
        python_agent_enabled: Boolean(config.pythonAgentBackendUrl),
      });

      return actualPort;
    } catch (error) {
      if (error.code === 'EADDRINUSE' && attempt < maxAttempts) {
        logger.warn('port_in_use_retry', { port: actualPort, next: actualPort + 1 });
        port = actualPort + 1;
        continue;
      }
      throw error;
    }
  }

  throw new Error('No available port after retries');
}

listenWithRetry(config.port).catch((error) => {
  logger.error('server_start_failed', { error: error.message });
  process.exit(1);
});

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info('server_shutdown_started', { signal });

  const forceTimer = setTimeout(() => {
    logger.error('server_shutdown_forced', { signal });
    process.exit(1);
  }, 10000);
  forceTimer.unref();

  try {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
    await closeDatabase();
    clearTimeout(forceTimer);
    logger.info('server_shutdown_complete', { signal });
    process.exit(0);
  } catch (error) {
    clearTimeout(forceTimer);
    logger.error('server_shutdown_failed', { signal, error: error.message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
