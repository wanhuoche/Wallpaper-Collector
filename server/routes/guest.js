const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

const GUEST_LIMIT = 20;
const LOGGED_IN_LIMIT = 40;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function checkRateLimit(ip, userId) {
  const date = todayStr();
  const row = db.prepare(
    'SELECT count FROM guest_usage WHERE ip = ? AND date = ?'
  ).get(ip, date);

  const used = row ? row.count : 0;
  const limit = userId ? LOGGED_IN_LIMIT : GUEST_LIMIT;
  return { allowed: used < limit, used, limit };
}

function incrementUsage(ip) {
  const date = todayStr();
  db.prepare(
    'INSERT INTO guest_usage (ip, date, count) VALUES (?, ?, 1) ON CONFLICT (ip, date) DO UPDATE SET count = count + 1'
  ).run(ip, date);
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
  if (!resp.ok) throw new Error('Wallhaven API error: ' + resp.status);
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
  if (!resp.ok) throw new Error('Pixabay API error: ' + resp.status);
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
  if (!resp.ok) throw new Error('Unsplash API error: ' + resp.status);
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

// POST /api/guest/search — 游客代理搜索 + IP 限流
router.post('/guest/search', async (req, res) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';

  // 尝试解析用户身份
  let userId = null;
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      const { JWT_SECRET } = require('../middleware/auth');
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      userId = payload.userId;
    } catch (e) { /* token 无效，按游客处理 */ }
  }

  // 限流
  const limitCheck = checkRateLimit(ip, userId);
  if (!limitCheck.allowed) {
    return res.status(429).json({
      error: '今日搜索次数已用完（' + limitCheck.limit + ' 次），请填写自己的 API Key 或明天再试',
      usage: { used: limitCheck.used, limit: limitCheck.limit, remaining: 0 },
    });
  }

  const { source, query, page, perPage, ratio, purity, categories, minWidth, minHeight } = req.body;
  if (!source || !query) {
    return res.status(400).json({ error: '缺少 source 或 query 参数' });
  }

  // 读取 API Key
  const keyRow = db.prepare('SELECT value FROM config WHERE key = ?').get(source + '_api_key');
  if (!keyRow || !keyRow.value) {
    return res.status(500).json({ error: '图源 ' + source + ' 的 API Key 未配置，请联系管理员' });
  }
  const apiKey = keyRow.value;

  // 比例映射
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
        return res.status(400).json({ error: '未知图源: ' + source });
    }

    incrementUsage(ip);
    const newUsed = limitCheck.used + 1;
    res.json({
      total: result.total,
      photos: result.photos,
      usage: { used: newUsed, limit: limitCheck.limit, remaining: limitCheck.limit - newUsed },
    });
  } catch (err) {
    console.error('Guest search proxy error:', err.message);
    res.status(502).json({ error: '搜索代理请求失败，请稍后重试' });
  }
});

module.exports = router;
