// 零依赖 — 纯 Web Crypto API 实现
// bcrypt → PBKDF2 + SHA-256  |  JWT → HMAC-SHA256

const SECRET_RAW = new TextEncoder().encode('wallpaper-collector-secret-key-change-me');
const PBKDF2_ITERATIONS = 600000;
const JWT_EXPIRES = 7 * 24 * 60 * 60; // 7 天

// ── Base64URL ──

function base64url(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlDecode(b64) {
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  return atob(b64);
}

// ── 密码哈希 (PBKDF2) ──

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  const hash = new Uint8Array(bits);
  // 格式: salt:hash (both base64url)
  return base64url(String.fromCharCode(...salt)) + ':' + base64url(String.fromCharCode(...hash));
}

async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(':');
  const salt = new Uint8Array([...base64urlDecode(saltB64)].map(c => c.charCodeAt(0)));
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  return base64url(String.fromCharCode(...new Uint8Array(bits))) === hashB64;
}

// ── JWT ──

async function signToken(userId) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = { userId, iat: now, exp: now + JWT_EXPIRES };

  const key = await crypto.subtle.importKey(
    'raw', SECRET_RAW, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const data = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return data + '.' + base64url(String.fromCharCode(...new Uint8Array(sig)));
}

async function verifyToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid token');

  const key = await crypto.subtle.importKey(
    'raw', SECRET_RAW, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const data = parts[0] + '.' + parts[1];
  const sig = new Uint8Array([...base64urlDecode(parts[2])].map(c => c.charCodeAt(0)));

  const valid = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(data));
  if (!valid) throw new Error('invalid signature');

  const payload = JSON.parse(base64urlDecode(parts[1]));
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
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
  if (errors.length > 0) return json({ error: errors[0] }, 400);

  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE username = ? OR email = ?'
  ).bind(username, email).first();

  if (existing) return json({ error: '用户名或邮箱已被注册' }, 409);

  const hash = await hashPassword(password);
  const result = await env.DB.prepare(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
  ).bind(username, email, hash).run();

  const token = await signToken(result.meta.last_row_id);
  return json({ token, user: { id: result.meta.last_row_id, username, email } }, 201);
}

async function handleLogin(request, env) {
  const body = await request.json();
  const { email, password } = body;

  if (!email || !password) return json({ error: '请输入邮箱和密码' }, 400);

  const user = await env.DB.prepare(
    'SELECT id, username, email, password FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user) return json({ error: '邮箱或密码错误' }, 401);

  const match = await verifyPassword(password, user.password);
  if (!match) return json({ error: '邮箱或密码错误' }, 401);

  const token = await signToken(user.id);
  return json({ token, user: { id: user.id, username: user.username, email: user.email } });
}

async function handleMe(request, env) {
  const token = extractToken(request);
  if (!token) return json({ error: '请先登录' }, 401);

  let userId;
  try { userId = await verifyToken(token); }
  catch { return json({ error: '登录已过期，请重新登录' }, 401); }

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
  try { userId = await verifyToken(token); }
  catch { return json({ error: '登录已过期，请重新登录' }, 401); }

  const body = await request.json();
  const { oldPassword, newPassword } = body;

  if (!oldPassword || !newPassword || newPassword.length < 6 || newPassword.length > 12) {
    return json({ error: '新密码需 6-12 位' }, 400);
  }

  const user = await env.DB.prepare('SELECT password FROM users WHERE id = ?').bind(userId).first();
  if (!user) return json({ error: '用户不存在' }, 404);

  if (!(await verifyPassword(oldPassword, user.password))) {
    return json({ error: '原密码错误' }, 401);
  }

  const hash = await hashPassword(newPassword);
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

// ── 入口 ──

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace('/api/auth', '');

  if (path === '/health') return json({ status: 'ok' });

  const key = `${request.method} ${path}`;
  const handler = ROUTES[key];
  if (!handler) return json({ error: 'Not Found' }, 404);

  return handler(request, env);
}
