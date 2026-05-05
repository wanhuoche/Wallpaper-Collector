// 零依赖 — 纯 Web Crypto API 实现
// bcrypt → PBKDF2 + SHA-256  |  JWT → HMAC-SHA256

const SECRET_RAW = new TextEncoder().encode('wallpaper-collector-secret-key-change-me');
const PBKDF2_ITERATIONS = 100000;  // Workers 上限
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
  if (!body.password || body.password.length < 8 || body.password.length > 16) {
    errors.push('密码需 8-16 位');
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

  if (!oldPassword || !newPassword || newPassword.length < 8 || newPassword.length > 16) {
    return json({ error: '新密码需 8-16 位' }, 400);
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

// ── 收藏夹 ──

async function handleGetFavorites(request, env) {
  const token = extractToken(request);
  if (!token) return json({ error: '请先登录' }, 401);
  let userId;
  try { userId = await verifyToken(token); }
  catch { return json({ error: '登录已过期' }, 401); }

  const rows = await env.DB.prepare(
    'SELECT photo_data, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(userId).all();

  const list = rows.results.map(r => JSON.parse(r.photo_data));
  return json({ favorites: list });
}

async function handleSyncFavorites(request, env) {
  const token = extractToken(request);
  if (!token) return json({ error: '请先登录' }, 401);
  let userId;
  try { userId = await verifyToken(token); }
  catch { return json({ error: '登录已过期' }, 401); }

  const body = await request.json();
  const localFavs = body.favorites || [];

  const rows = await env.DB.prepare(
    'SELECT photo_id, photo_data, created_at FROM favorites WHERE user_id = ?'
  ).bind(userId).all();
  const cloudMap = {};
  rows.results.forEach(r => { cloudMap[r.photo_id] = r; });

  const merged = {};
  Object.entries(cloudMap).forEach(([photoId, row]) => {
    const data = JSON.parse(row.photo_data);
    merged[photoId] = { ...data, savedAt: data.savedAt || 0, _from: 'cloud' };
  });
  localFavs.forEach(fav => {
    const photoId = fav.full || fav.medium || fav.thumb;
    const cloud = merged[photoId];
    if (!cloud || (fav.savedAt || 0) > (cloud.savedAt || 0)) {
      merged[photoId] = { ...fav, _from: 'local' };
    }
  });

  const upsert = env.DB.prepare(
    'INSERT OR REPLACE INTO favorites (user_id, photo_id, photo_data, created_at) VALUES (?, ?, ?, datetime(?))'
  );
  const batch = [];
  Object.entries(merged).forEach(([photoId, fav]) => {
    const data = { ...fav };
    delete data._from;
    batch.push(upsert.bind(userId, photoId, JSON.stringify(data), fav.savedAt ? new Date(fav.savedAt).toISOString() : new Date().toISOString()));
  });

  for (let i = 0; i < batch.length; i += 50) {
    const chunk = batch.slice(i, i + 50);
    await env.DB.batch(chunk);
  }

  const resultList = Object.values(merged).map(fav => {
    const clean = { ...fav };
    delete clean._from;
    return clean;
  });

  return json({ favorites: resultList });
}

// ═══════════════════════════════════════
//  设置云端同步
// ═══════════════════════════════════════

// GET /settings — 获取云端设置
async function handleGetSettings(request, env) {
  const token = extractToken(request);
  if (!token) return json({ error: '请先登录' }, 401);
  let userId;
  try { userId = await verifyToken(token); }
  catch { return json({ error: '登录已过期' }, 401); }

  const row = await env.DB.prepare(
    'SELECT settings_json FROM settings WHERE user_id = ?'
  ).bind(userId).first();

  const settings = row ? JSON.parse(row.settings_json) : {};
  return json({ settings });
}

// POST /settings/sync — 上传本地设置，返回合并结果（云端优先）
async function handleSyncSettings(request, env) {
  const token = extractToken(request);
  if (!token) return json({ error: '请先登录' }, 401);
  let userId;
  try { userId = await verifyToken(token); }
  catch { return json({ error: '登录已过期' }, 401); }

  const body = await request.json();
  const localSettings = body.settings || {};

  // 读取云端已有设置
  const row = await env.DB.prepare(
    'SELECT settings_json FROM settings WHERE user_id = ?'
  ).bind(userId).first();

  let cloudSettings = {};
  if (row) {
    try { cloudSettings = JSON.parse(row.settings_json); } catch (e) {}
  }

  // 合并：云端已有的 key 保留云端值，本地新增的 key 加入
  const merged = { ...localSettings };
  if (row) {
    Object.keys(cloudSettings).forEach(k => {
      if (k === 'apiKeys' && cloudSettings.apiKeys && localSettings.apiKeys) {
        merged.apiKeys = { ...localSettings.apiKeys, ...cloudSettings.apiKeys };
      } else {
        merged[k] = cloudSettings[k];
      }
    });
  }

  // 写入
  await env.DB.prepare(
    'INSERT OR REPLACE INTO settings (user_id, settings_json, updated_at) VALUES (?, ?, datetime(\'now\'))'
  ).bind(userId, JSON.stringify(merged)).run();

  return json({ settings: merged });
}

// ═══════════════════════════════════════
//  游客代理搜索 + 限流
// ═══════════════════════════════════════

const GUEST_LIMIT = 20;       // 未登录每日次数
const LOGGED_IN_LIMIT = 40;   // 已登录但无自有 Key 每日次数

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

async function checkRateLimit(env, ip, userId) {
  const date = todayStr();
  const row = await env.DB.prepare(
    'SELECT count FROM guest_usage WHERE ip = ? AND date = ?'
  ).bind(ip, date).first();

  const used = row ? row.count : 0;
  const limit = userId ? LOGGED_IN_LIMIT : GUEST_LIMIT;

  if (used >= limit) {
    return { allowed: false, used, limit };
  }
  return { allowed: true, used, limit };
}

async function incrementUsage(env, ip) {
  const date = todayStr();
  await env.DB.prepare(
    'INSERT INTO guest_usage (ip, date, count) VALUES (?, ?, 1) ON CONFLICT (ip, date) DO UPDATE SET count = count + 1'
  ).bind(ip, date).run();
}

// ── 图源代理 ──

async function proxyWallhaven(apiKey, query, page, perPage, ratio, purity, minWidth, minHeight, categories) {
  const params = new URLSearchParams();
  params.set('q', query);
  params.set('per_page', perPage);
  params.set('page', page);
  if (ratio) params.set('ratios', ratio);
  params.set('purity', purity === 'all' ? '111' : '110');
  if (categories && categories !== '111') params.set('categories', categories);
  if (minWidth && minHeight) {
    params.set('atleast', minWidth + 'x' + minHeight);
  } else if (minWidth) {
    params.set('atleast', minWidth + 'x0');
  }

  const resp = await fetch('https://wallhaven.cc/api/v1/search?' + params.toString(), {
    headers: { 'X-API-Key': apiKey },
  });
  if (!resp.ok) {
    throw new Error('Wallhaven API error: ' + resp.status);
  }
  const data = await resp.json();
  return {
    total: data.meta?.total || 0,
    photos: (data.data || []).map(p => ({
      id: p.id,
      width: p.dimension_x,
      height: p.dimension_y,
      thumb: p.thumbs?.small || p.thumbs?.original,
      medium: p.thumbs?.original,
      full: p.path,
      preview: p.thumbs?.large || p.thumbs?.original,
      alt: p.category || '',
      purity: p.purity || 'sfw',
      photographer: 'Wallhaven',
      sourceUrl: p.url,
    })),
  };
}

async function proxyPixabay(apiKey, query, page, perPage, minWidth, minHeight) {
  const params = new URLSearchParams();
  params.set('key', apiKey);
  params.set('q', query);
  params.set('per_page', perPage);
  params.set('page', page);
  params.set('image_type', 'photo');
  params.set('safesearch', 'true');
  if (minWidth) params.set('min_width', minWidth);
  if (minHeight) params.set('min_height', minHeight);

  const resp = await fetch('https://pixabay.com/api/?' + params.toString());
  if (!resp.ok) {
    throw new Error('Pixabay API error: ' + resp.status);
  }
  const data = await resp.json();
  return {
    total: data.totalHits || data.total || 0,
    photos: (data.hits || []).map(p => ({
      id: p.id,
      width: p.imageWidth,
      height: p.imageHeight,
      thumb: p.webformatURL,
      full: p.largeImageURL,
      preview: p.largeImageURL || p.webformatURL,
      alt: p.tags,
      photographer: p.user,
      sourceUrl: p.pageURL,
    })),
  };
}

async function proxyUnsplash(apiKey, query, page, perPage, orientation) {
  const params = new URLSearchParams();
  params.set('query', query);
  params.set('per_page', perPage);
  params.set('page', page);
  if (orientation) params.set('orientation', orientation);

  const resp = await fetch('https://api.unsplash.com/search/photos?' + params.toString(), {
    headers: { 'Authorization': 'Client-ID ' + apiKey },
  });
  if (!resp.ok) {
    throw new Error('Unsplash API error: ' + resp.status);
  }
  const data = await resp.json();
  return {
    total: data.total || 0,
    photos: (data.results || []).map(p => ({
      id: p.id,
      width: p.width,
      height: p.height,
      thumb: p.urls?.small,
      full: p.urls?.raw + '&w=2560',
      preview: p.urls?.regular || p.urls?.small,
      alt: p.alt_description || p.description || '',
      photographer: p.user?.name,
      sourceUrl: p.links?.html,
    })),
  };
}

// POST /guest/search — 游客代理搜索 + IP 限流
async function handleGuestSearch(request, env) {
  // 解析 IP
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  // 尝试解析用户身份（用于限流档位）
  let userId = null;
  const token = extractToken(request);
  if (token) {
    try { userId = await verifyToken(token); } catch (e) { /* token 无效，按游客处理 */ }
  }

  // 限流检查
  const limitCheck = await checkRateLimit(env, ip, userId);
  if (!limitCheck.allowed) {
    return json({
      error: '今日搜索次数已用完（' + limitCheck.limit + ' 次），请填写自己的 API Key 或明天再试',
      usage: { used: limitCheck.used, limit: limitCheck.limit, remaining: 0 },
    }, 429);
  }

  const body = await request.json();
  const { source, query, page, perPage, ratio, purity, categories, minWidth, minHeight } = body;

  if (!source || !query) {
    return json({ error: '缺少 source 或 query 参数' }, 400);
  }

  // 读取 API Key
  const keyRow = await env.DB.prepare(
    'SELECT value FROM config WHERE key = ?'
  ).bind(source + '_api_key').first();

  if (!keyRow || !keyRow.value) {
    return json({ error: '图源 ' + source + ' 的 API Key 未配置，请联系管理员' }, 500);
  }

  const apiKey = keyRow.value;

  // 比例映射（Wandhaven 用 16x9 格式，Unsplash 用 landscape/portrait/squarish）
  let ratioParam = '';
  let orientation = '';
  if (ratio && ratio !== 'all') {
    const parts = ratio.split(':');
    const w = parseInt(parts[0]);
    const h = parseInt(parts[1]);
    if (source === 'wallhaven') {
      ratioParam = parts[0] + 'x' + parts[1];
    } else if (source === 'unsplash') {
      if (w === h) orientation = 'squarish';
      else orientation = w > h ? 'landscape' : 'portrait';
    }
  }

  try {
    let result;
    switch (source) {
      case 'wallhaven':
        result = await proxyWallhaven(apiKey, query, page, perPage, ratioParam, purity, minWidth, minHeight, categories);
        break;
      case 'pixabay':
        result = await proxyPixabay(apiKey, query, page, perPage, minWidth, minHeight);
        break;
      case 'unsplash':
        result = await proxyUnsplash(apiKey, query, page, perPage, orientation);
        break;
      default:
        return json({ error: '未知图源: ' + source }, 400);
    }

    // 增加使用计数
    await incrementUsage(env, ip);

    const newUsed = limitCheck.used + 1;
    return json({
      total: result.total,
      photos: result.photos,
      usage: { used: newUsed, limit: limitCheck.limit, remaining: limitCheck.limit - newUsed },
    });
  } catch (err) {
    console.error('Guest search proxy error:', err.message);
    return json({ error: '搜索代理请求失败，请稍后重试' }, 502);
  }
}

// ═══════════════════════════════════════
//  路由表
// ═══════════════════════════════════════

const ROUTES = {
  'POST /register':       handleRegister,
  'POST /login':          handleLogin,
  'GET /me':              handleMe,
  'PUT /password':        handlePassword,
  'GET /favorites':       handleGetFavorites,
  'POST /favorites/sync': handleSyncFavorites,
  'GET /settings':        handleGetSettings,
  'POST /settings/sync':  handleSyncSettings,
};

// ── 入口 ──

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let path = url.pathname.replace('/api/auth', '');

  // 也处理 /api/guest/* 和 /api/health 等非 auth 前缀路径
  if (path.startsWith('/api/')) {
    path = path.replace('/api', '');
  }

  if (path === '/health') return json({ status: 'ok' });

  // 游客搜索
  if (path === '/guest/search' && request.method === 'POST') {
    return handleGuestSearch(request, env);
  }

  const key = `${request.method} ${path}`;
  const handler = ROUTES[key];
  if (!handler) return json({ error: 'Not Found' }, 404);

  return handler(request, env);
}
