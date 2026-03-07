const LEVEL_ORDER = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = process.env.LOG_LEVEL?.toLowerCase() ?? 'info';
const minLevel = LEVEL_ORDER[configuredLevel] ?? LEVEL_ORDER.info;

export function createLogger(component) {
  return {
    debug: (message, meta) => log('debug', component, message, meta),
    info: (message, meta) => log('info', component, message, meta),
    warn: (message, meta) => log('warn', component, message, meta),
    error: (message, meta) => log('error', component, message, meta),
  };
}

function log(level, component, message, meta) {
  if (LEVEL_ORDER[level] < minLevel) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    component,
    message,
  };

  if (meta && Object.keys(meta).length > 0) {
    payload.meta = meta;
  }

  const json = JSON.stringify(payload);
  if (level === 'error') {
    console.error(json);
    return;
  }
  console.log(json);
}
