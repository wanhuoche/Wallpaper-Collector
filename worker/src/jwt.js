import { SignJWT, jwtVerify } from 'jose';

const EXPIRES_IN = '7d';

let _secret = null;

export function setSecret(env) {
  if (_secret) return; // 仅首次初始化
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error('FATAL: 环境变量 JWT_SECRET 未设置，请在 Cloudflare 控制台配置 JWT_SECRET。');
  _secret = new TextEncoder().encode(secret);
}

function getSecret() {
  if (!_secret) throw new Error('FATAL: JWT_SECRET 环境变量未设置，请在 Cloudflare 控制台配置 JWT_SECRET。');
  return _secret;
}

export async function signToken(userId) {
  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(getSecret());
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, getSecret());
  return payload.userId;
}

export function extractToken(request) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}
