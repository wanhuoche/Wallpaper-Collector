import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  'wallpaper-collector-secret-key-change-in-production'
);
const EXPIRES_IN = '7d';

export async function signToken(userId) {
  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(SECRET);
}

export async function verifyToken(token) {
  const { payload } = await jwtVerify(token, SECRET);
  return payload.userId;
}

export function extractToken(request) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}
