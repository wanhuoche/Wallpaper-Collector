import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode('wallpaper-collector-secret-key');
const EXPIRES_IN = '7d';
const BCRYPT_ROUNDS = 10;

// ── JWT ──

async function signToken(userId) {
  return await new SignJWT({ userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES_IN)
    .sign(SECRET);
}

async function verifyToken(token) {
  const { payload } = await jwtVerify(token, SECRET);
  return payload.userId;
}

function extractToken(request) {
  const header = request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) return null;
  return header.slice(7);
}

// ── 输入校验 ──

const USERNAME_RE = /^[a-zA-Z0-9_一-龥]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateRegister(body) {
  const errors = [];
  if (!body.username || !USERNAME_RE.test(body.username)) {
    errors.push('用户名需 3-20 个字符（字母/数字/下划线/中文）');
  }
  if (!body.email || !EMAIL_RE.test(body.email)) {
    errors.push('邮箱格式不正确');
  }
  if (!body.password || body.password.length < 6 || body.password.length > 12) {
    errors.push('密码需 6-12 位');
  }
  return errors;
}

// ── Helpers ──

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Routes ──

async function handleRegister(request, env) {
  const body = await request.json();
  const { username, email, password } = body;

  const errors = validateRegister(body);
  if (errors.length > 0) {
    return json({ error: errors[0] }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ? OR email = ?'
  ).bind(username, email).first();

  if (existing) {
    return json({ error: '用户名或邮箱已被注册' }, 409);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = await env.DB.prepare(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
  ).bind(username, email, hash).run();

  const token = await signToken(result.meta.last_row_id);

  return json({ token, user: { id: result.meta.last_row_id, username, email } }, 201);
}

async function handleLogin(request, env) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return json({ error: '请输入邮箱和密码' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, email, password FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user) {
    return json({ error: '邮箱或密码错误' }, 401);
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return json({ error: '邮箱或密码错误' }, 401);
  }

  const token = await signToken(user.id);

  return json({ token, user: { id: user.id, username: user.username, email: user.email } });
}

async function handleMe(request, env) {
  const token = extractToken(request);
  if (!token) return json({ error: '请先登录' }, 401);

  let userId;
  try {
    userId = await verifyToken(token);
  } catch {
    return json({ error: '登录已过期，请重新登录' }, 401);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, email, avatar, created_at FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user) return json({ error: '用户不存在' }, 404);

  return json({ user });
}

async function handlePassword(request, env) {
  const token = extractToken(request);
  if (!token) return json({ error: '请先登录' }, 401);

  let userId;
  try {
    userId = await verifyToken(token);
  } catch {
    return json({ error: '登录已过期，请重新登录' }, 401);
  }

  const body = await request.json();
  const { oldPassword, newPassword } = body;

  if (!oldPassword || !newPassword || newPassword.length < 6 || newPassword.length > 12) {
    return json({ error: '新密码需 6-12 位' }, 400);
  }

  const user = await env.DB.prepare('SELECT password FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: '用户不存在' }, 404);

  if (!(await bcrypt.compare(oldPassword, user.password))) {
    return json({ error: '原密码错误' }, 401);
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await env.DB.prepare(
    'UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(hash, userId).run();

  return json({ message: '密码已更新' });
}

// ── 路由表 ──

const ROUTES = {
  'POST /register': handleRegister,
  'POST /login':    handleLogin,
  'GET /me':        handleMe,
  'PUT /password':  handlePassword,
};

// ── Pages Function 入口 ──

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/auth', '');

  if (path === '/health') {
    return json({ status: 'ok' });
  }

  const key = `${request.method} ${path}`;
  const handler = ROUTES[key];

  if (!handler) {
    return json({ error: 'Not Found' }, 404);
  }

  return handler(request, env);
}
