const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { signToken, verifyToken } = require('../middleware/auth');

const router = express.Router();
const BCRYPT_ROUNDS = 12;

// 简易 IP 限流（登录接口）
const loginAttempts = new Map();
const LOGIN_LIMIT = 10;       // 每分钟最多 10 次
const LOGIN_WINDOW = 60_000;

function checkLoginLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (record && now - record.start < LOGIN_WINDOW) {
    record.count++;
    if (record.count > LOGIN_LIMIT) {
      return res.status(429).json({ error: '请求过于频繁，请稍后重试' });
    }
  } else {
    loginAttempts.set(ip, { start: now, count: 1 });
  }
  next();
}

// 每 5 分钟清理一次过期记录
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW;
  for (const [ip, record] of loginAttempts) {
    if (record.start < cutoff) loginAttempts.delete(ip);
  }
}, 300_000);

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

// ── POST /api/auth/register ──
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;

  const errors = validateRegister(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: errors[0] });
  }

  // 检查用户名或邮箱是否已存在
  const existing = db.prepare(
    'SELECT id FROM users WHERE username = ? OR email = ?'
  ).get(username, email);

  if (existing) {
    // 不泄露具体哪个字段冲突
    return res.status(409).json({ error: '用户名或邮箱已被注册' });
  }

  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const result = db.prepare(
    'INSERT INTO users (username, email, password) VALUES (?, ?, ?)'
  ).run(username, email, hash);

  const token = signToken(result.lastInsertRowid);

  res.status(201).json({
    token,
    user: { id: result.lastInsertRowid, username, email },
  });
});

// ── POST /api/auth/login ──
router.post('/login', checkLoginLimit, async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: '请输入邮箱和密码' });
  }

  const user = db.prepare(
    'SELECT id, username, email, password FROM users WHERE email = ?'
  ).get(email);

  if (!user) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }

  const token = signToken(user.id);

  res.json({
    token,
    user: { id: user.id, username: user.username, email: user.email },
  });
});

// ── GET /api/auth/me ──
router.get('/me', verifyToken, (req, res) => {
  const user = db.prepare(
    'SELECT id, username, email, avatar, created_at FROM users WHERE id = ?'
  ).get(req.userId);

  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  res.json({ user });
});

// ── PUT /api/auth/password ──
router.put('/password', verifyToken, async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword || newPassword.length < 8 || newPassword.length > 16) {
    return res.status(400).json({ error: '新密码需 8-16 位' });
  }

  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }

  if (!(await bcrypt.compare(oldPassword, user.password))) {
    return res.status(401).json({ error: '原密码错误' });
  }

  const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  db.prepare('UPDATE users SET password = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(hash, req.userId);

  res.json({ message: '密码已更新' });
});

module.exports = router;
