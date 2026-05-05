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
router.post('/favorites/sync', verifyToken, (req, res) => {
  const { favorites: localFavs } = req.body;
  const userId = req.userId;

  // 拉取云端数据
  const rows = db.prepare(
    'SELECT photo_id, photo_data FROM favorites WHERE user_id = ?'
  ).all(userId);
  const cloudMap = {};
  rows.forEach(r => { cloudMap[r.photo_id] = r; });

  // 双向合并
  const merged = {};
  Object.entries(cloudMap).forEach(([photoId, row]) => {
    const data = JSON.parse(row.photo_data);
    merged[photoId] = { ...data, savedAt: data.savedAt || 0 };
  });
  (localFavs || []).forEach(fav => {
    const photoId = fav.full || fav.medium || fav.thumb;
    const cloud = merged[photoId];
    if (!cloud || (fav.savedAt || 0) > (cloud.savedAt || 0)) {
      merged[photoId] = fav;
    }
  });

  // 写入
  const upsert = db.prepare(
    'INSERT OR REPLACE INTO favorites (user_id, photo_id, photo_data, created_at) VALUES (?, ?, ?, datetime(?))'
  );
  const transaction = db.transaction(() => {
    Object.entries(merged).forEach(([photoId, fav]) => {
      upsert.run(userId, photoId, JSON.stringify(fav), fav.savedAt ? new Date(fav.savedAt).toISOString() : new Date().toISOString());
    });
  });
  transaction();

  const resultList = Object.values(merged);
  res.json({ favorites: resultList });
});

module.exports = router;
