import bcrypt from 'bcryptjs';
import { setSecret, signToken, verifyToken, extractToken } from './jwt.js';

const BCRYPT_ROUNDS = 12;

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

// ── 限流 ──
const rateLimit = new Map();
const RATE_LIMIT = 10;
const RATE_WINDOW = 60_000;

function checkRateLimit(ip, path) {
  if (path !== '/login') return true;
  const key = ip + ':login';
  const now = Date.now();
  const record = rateLimit.get(key);
  if (record && now - record.start < RATE_WINDOW) {
    record.count++;
    return record.count <= RATE_LIMIT;
  }
  rateLimit.set(key, { start: now, count: 1 });
  return true;
}

// ── Helpers ──

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function corsResponse(request, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
    },
  });
}

// ── 认证中间件 ──

async function authRequired(request) {
  const token = extractToken(request);
  if (!token) return null;
  try {
    return await verifyToken(token);
  } catch {
    return null;
  }
}

// ── Routes ──

async function handleRegister(request, env) {
  const body = await request.json();
  const { username, email, password } = body;

  const errors = validateRegister(body);
  if (errors.length > 0) {
    return corsResponse(request, { error: errors[0] }, 400);
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ? OR email = ?'
  ).bind(username, email).first();

  if (existing) {
    return corsResponse(request, { error: '用户名或邮箱已被注册' }, 409);
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = await env.DB.prepare(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
  ).bind(username, email, hash).run();

  const token = await signToken(result.meta.last_row_id);

  return corsResponse(request, {
    token,
    user: { id: result.meta.last_row_id, username, email },
  }, 201);
}

async function handleLogin(request, env) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) {
    return corsResponse(request, { error: '请输入邮箱和密码' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, email, password FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user) {
    return corsResponse(request, { error: '邮箱或密码错误' }, 401);
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return corsResponse(request, { error: '邮箱或密码错误' }, 401);
  }

  const token = await signToken(user.id);

  return corsResponse(request, {
    token,
    user: { id: user.id, username: user.username, email: user.email },
  });
}

async function handleMe(request, env) {
  const userId = await authRequired(request);
  if (!userId) {
    return corsResponse(request, { error: '请先登录' }, 401);
  }

  const user = await env.DB.prepare(
    'SELECT id, username, email, avatar, created_at FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user) {
    return corsResponse(request, { error: '用户不存在' }, 404);
  }

  return corsResponse(request, { user });
}

async function handleChangePassword(request, env) {
  const userId = await authRequired(request);
  if (!userId) {
    return corsResponse(request, { error: '请先登录' }, 401);
  }

  const body = await request.json();
  const { oldPassword, newPassword } = body;

  if (!oldPassword || !newPassword || newPassword.length < 6 || newPassword.length > 12) {
    return corsResponse(request, { error: '新密码需 6-12 位' }, 400);
  }

  const user = await env.DB.prepare(
    'SELECT password FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user) {
    return corsResponse(request, { error: '用户不存在' }, 404);
  }

  if (!(await bcrypt.compare(oldPassword, user.password))) {
    return corsResponse(request, { error: '原密码错误' }, 401);
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await env.DB.prepare(
    'UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(hash, userId).run();

  return corsResponse(request, { message: '密码已更新' });
}

// ── 路由表 ──

const routes = [
  { method: 'POST',   path: '/api/auth/register', handler: handleRegister },
  { method: 'POST',   path: '/api/auth/login',    handler: handleLogin },
  { method: 'GET',    path: '/api/auth/me',       handler: handleMe },
  { method: 'PUT',    path: '/api/auth/password', handler: handleChangePassword },
  { method: 'GET',    path: '/api/health',         handler: () => json({ status: 'ok' }) },
];

// ── Worker 入口 ──

export default {
  async fetch(request, env) {
    // 懒初始化 JWT Secret（仅首次请求）
    setSecret(env);

    const url = new URL(request.url);
    const { pathname } = url;

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // 登录限流
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!checkRateLimit(ip, pathname === '/api/auth/login' ? '/login' : pathname)) {
      return corsResponse(request, { error: '请求过于频繁，请稍后重试' }, 429);
    }

    // 路由匹配
    for (const route of routes) {
      if (request.method === route.method && pathname === route.path) {
        return route.handler(request, env);
      }
    }

    return corsResponse(request, { error: 'Not Found' }, 404);
  },
};
