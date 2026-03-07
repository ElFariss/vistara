#!/bin/sh
set -eu

API_BASE_URL_VALUE="${API_BASE_URL:-}"
ESCAPED_API_BASE_URL="$(printf '%s' "$API_BASE_URL_VALUE" | sed 's/\\/\\\\/g; s/"/\\"/g')"

cat > /app/public/runtime-env.js <<EOF
window.__VISTARA_RUNTIME__ = Object.assign(
  {},
  window.__VISTARA_RUNTIME__ || {},
  {
    API_BASE_URL: "${ESCAPED_API_BASE_URL}",
  },
);
EOF

exec "$@"
