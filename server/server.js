const express = require('express');
const authRoutes = require('./routes/auth');
const favoritesRoutes = require('./routes/favorites');
const settingsRoutes = require('./routes/settings');
const guestRoutes = require('./routes/guest');

const app = express();
const PORT = process.env.PORT || 3000;

// 信任代理 IP（Cloudflare 或本地反向代理）
app.set('trust proxy', 1);

// 解析 JSON 请求体
app.use(express.json());

// CORS — 允许前端跨域访问
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// 路由
app.use('/api/auth', authRoutes);
app.use('/api/auth', favoritesRoutes);
app.use('/api/auth', settingsRoutes);
app.use('/api', guestRoutes);

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
