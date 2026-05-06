const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/auth/favorites
router.get('/favorites', verifyToken, (req, res) => {
  const rows = db.prepare(
    'SELECT photo_data FROM favorites WHERE user_id = ? ORDER BY created_at DESC'
  ).all(req.userId);

  const list = rows.map(r => JSON.parse(r.photo_data));
  res.json({ favorites: list });
});

// POST /api/auth/favorites/sync
// 客户端发送完整收藏列表，服务端替换式写入（支持删除同步）
router.post('/favorites/sync', verifyToken, (req, res) => {
  const { favorites: localFavs } = req.body;
  const userId = req.userId;
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    // 先删后插，确保删除能同步
    db.prepare('DELETE FROM favorites WHERE user_id = ?').run(userId);

    const insert = db.prepare(
      'INSERT INTO favorites (user_id, photo_id, photo_data, created_at) VALUES (?, ?, ?, ?)'
    );
    (localFavs || []).forEach(fav => {
      const photoId = fav.full || fav.medium || fav.thumb;
      if (!photoId) return;
      insert.run(userId, photoId, JSON.stringify(fav), fav.savedAt ? new Date(fav.savedAt).toISOString() : now);
    });
  });
  transaction();

  res.json({ favorites: localFavs || [] });
});

module.exports = router;
