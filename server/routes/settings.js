const express = require('express');
const db = require('../db');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// GET /api/auth/settings — 获取云端设置
router.get('/settings', verifyToken, (req, res) => {
  const row = db.prepare(
    'SELECT settings_json FROM settings WHERE user_id = ?'
  ).get(req.userId);

  const settings = row ? JSON.parse(row.settings_json) : {};
  res.json({ settings });
});

// POST /api/auth/settings/sync — 上传本地设置，返回合并结果
router.post('/settings/sync', verifyToken, (req, res) => {
  const { settings: localSettings } = req.body;
  if (!localSettings || typeof localSettings !== 'object') {
    return res.status(400).json({ error: '缺少 settings 参数' });
  }

  const row = db.prepare(
    'SELECT settings_json FROM settings WHERE user_id = ?'
  ).get(req.userId);

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

  db.prepare(
    'INSERT OR REPLACE INTO settings (user_id, settings_json, updated_at) VALUES (?, ?, datetime(\'now\'))'
  ).run(req.userId, JSON.stringify(merged));

  res.json({ settings: merged });
});

module.exports = router;
