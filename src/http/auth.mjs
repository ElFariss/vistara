import { config } from '../config.mjs';
import { createToken, verifyToken } from '../utils/token.mjs';
import { get } from '../db.mjs';

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') {
    return null;
  }
  return token;
}

export function issueAuthToken(user) {
  return createToken(
    {
      sub: user.id,
      tenant_id: user.tenant_id,
      role: user.role,
      email: user.email,
    },
    config.jwtSecret,
    config.tokenTtlSeconds,
  );
}

export async function authenticateRequest(req) {
  const token = getBearerToken(req);
  if (!token) {
    return null;
  }

  const payload = verifyToken(token, config.jwtSecret);
  if (!payload?.sub || !payload.tenant_id) {
    return null;
  }

  const user = await get(
    `
      SELECT id, tenant_id, email, name, role, phone, phone_verified
      FROM users
      WHERE id = :id AND tenant_id = :tenant_id
    `,
    { id: payload.sub, tenant_id: payload.tenant_id },
  );

  if (!user) {
    return null;
  }

  return user;
}
