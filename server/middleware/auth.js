const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'wallpaper-collector-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function verifyToken(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: '请先登录' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '登录已过期，请重新登录' });
    }
    return res.status(401).json({ error: '登录无效，请重新登录' });
  }
}

module.exports = { signToken, verifyToken, JWT_SECRET };
