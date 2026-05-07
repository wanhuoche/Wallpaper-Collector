import { setState } from './state.js';

const W = window.WallpaperApp;
const STORAGE_KEY = 'wp_favorites';
const COLLECTIONS_KEY = 'wp_collections';
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天后清理墓碑

// ── 收藏夹管理 ──

function loadCollections() {
    try {
        var data = localStorage.getItem(COLLECTIONS_KEY);
        if (data) {
            var list = JSON.parse(data);
            // 清理过期墓碑
            var cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
            list = list.filter(function(c) { return !c.deletedAt || c.deletedAt > cutoff; });
            return list;
        }
    } catch (e) {}
    // 首次创建默认收藏夹
    var def = [{ id: '__default__', name: '默认收藏夹', createdAt: Date.now() }];
    localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(def));
    return def;
}

function saveCollections(list) {
    try { localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(list)); } catch (e) {}
}

// 保存收藏夹列表并推送到云端
function saveAndPushCollections(list) {
    saveCollections(list);
    pushFavorites();
}

// 以云端为基准合并收藏夹列表 — 对齐 mergeLocal 模式
function mergeCollections(cloudCols) {
    if (!cloudCols || cloudCols.length === 0) return false;

    var cloudMap = {};
    var maxCloudTime = 0;
    cloudCols.forEach(function(c) {
        cloudMap[c.id] = c;
        var ct = Math.max(c.createdAt || 0, c.deletedAt || 0);
        if (ct > maxCloudTime) maxCloudTime = ct;
    });

    var localMap = {};
    var addedCount = 0;
    W.state.collections.forEach(function(c) {
        var cloud = cloudMap[c.id];
        if (cloud) {
            var localTime = Math.max(c.createdAt || 0, c.deletedAt || 0);
            var cloudTime = Math.max(cloud.createdAt || 0, cloud.deletedAt || 0);
            localMap[c.id] = localTime > cloudTime ? c : cloud;
        } else {
            // 本地独有：时间戳比云端最新还新 → 离线新建；否则 → 已在其他设备删除，丢弃
            var localTime = Math.max(c.createdAt || 0, c.deletedAt || 0);
            if (localTime > maxCloudTime) {
                localMap[c.id] = c;
                addedCount++;
            }
        }
    });

    // 云端独有 → 加入本地
    Object.keys(cloudMap).forEach(function(id) {
        if (!localMap[id]) {
            localMap[id] = cloudMap[id];
            addedCount++;
        }
    });

    var merged = Object.values(localMap);
    // 清理过期墓碑（30 天）
    var cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    merged = merged.filter(function(c) {
        return !c.deletedAt || c.deletedAt > cutoff;
    });
    // 确保 __default__ 始终存在
    if (!merged.find(function(c) { return c.id === '__default__'; })) {
        merged.unshift({ id: '__default__', name: '默认收藏夹', createdAt: Date.now() });
    }

    W.state.collections = merged;
    saveCollections(merged);
    populateCollectionSelect();
    return addedCount > 0;
}

W.state.collections = loadCollections();
W.state.activeCollection = '__all__';

function getActiveCollections() {
    return W.state.collections;
}

function createCollection(name) {
    var id = 'col_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    W.state.collections.push({ id: id, name: name, createdAt: Date.now() });
    saveAndPushCollections(W.state.collections);
    populateCollectionSelect();
    return id;
}

function renameCollection(id, newName) {
    var col = W.state.collections.find(function(c) { return c.id === id; });
    if (col) { col.name = newName; saveAndPushCollections(W.state.collections); populateCollectionSelect(); }
}

function deleteCollection(id) {
    var name = (W.state.collections.find(function(c) { return c.id === id; }) || {}).name || '';
    // 把该收藏夹的图片保留，collectionId 改回 __default__
    W.state.favorites.forEach(function(f) {
        if (f.collectionIds && f.collectionIds.indexOf(id) >= 0) {
            f.collectionIds = f.collectionIds.filter(function(cid) { return cid !== id; });
            if (f.collectionIds.length === 0) f.collectionIds = ['__default__'];
        }
    });
    save(W.state.favorites);
    // 墓碑：标记 deletedAt 而非直接移除，保证跨设备同步能传播删除
    var col = W.state.collections.find(function(c) { return c.id === id; });
    if (col) { col.deletedAt = Date.now(); }
    saveAndPushCollections(W.state.collections);
    populateCollectionSelect();
    if (W.state.activeCollection === id) {
        W.state.activeCollection = '__all__';
        document.getElementById('collectionSelect').value = '__all__';
    }
    if (W.state.activeTab === 'favorites') render();
    W.showToast('已删除收藏夹「' + name + '」', 'success');
}

function populateCollectionSelect() {
    var sel = document.getElementById('collectionSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="__all__">全部</option>';
    W.state.collections.forEach(function(c) {
        if (c.deletedAt) return;
        var label = c.id === '__default__' ? c.name : c.name;
        sel.innerHTML += '<option value="' + c.id + '">' + escapeHtml(label) + '</option>';
    });
    sel.value = W.state.activeCollection || '__all__';
}

// 数据迁移：旧数据无 collectionIds → 补默认
function migrateFavorites() {
    var changed = false;
    W.state.favorites.forEach(function(f) {
        if (!f.collectionIds || f.collectionIds.length === 0) {
            f.collectionIds = ['__default__'];
            changed = true;
        }
    });
    if (changed) save(W.state.favorites);
}

// ── 收藏选择面板 ──

var _pickerResolve = null;
var _pickerPhoto = null;
var _pickerSource = null;

function showCollectionPicker(photo, source) {
    _pickerPhoto = photo;
    _pickerSource = source;
    var panel = document.getElementById('colPicker');
    var list = document.getElementById('colPickerList');
    var activeColl = W.state.activeCollection;
    list.innerHTML = '';
    W.state.collections.forEach(function(c) {
        if (c.deletedAt) return;
        var checked = c.id === '__default__' || c.id === activeColl;
        list.innerHTML += '<label class="col-picker-item">'
            + '<input type="checkbox" value="' + c.id + '"' + (checked ? ' checked' : '') + '>'
            + escapeHtml(c.name) + '</label>';
    });
    panel.style.display = 'block';
    // 定位在视口中央偏上
    panel.style.left = '50%';
    panel.style.top = '40%';
    panel.style.transform = 'translate(-50%, -50%)';

    return new Promise(function(resolve) {
        _pickerResolve = resolve;
    });
}

function hideCollectionPicker() {
    document.getElementById('colPicker').style.display = 'none';
    _pickerResolve = null;
}

// ── 墓碑清理 ──

function cleanTombstones(list) {
  var cutoff = Date.now() - TOMBSTONE_TTL;
  return list.filter(function(f) {
    return !f.deletedAt || f.deletedAt > cutoff;
  });
}

function load() {
    try {
        var data = localStorage.getItem(STORAGE_KEY);
        var list = data ? JSON.parse(data) : [];
        list = cleanTombstones(list);
        // 旧数据迁移
        list.forEach(function(f) {
            if (!f.collectionIds || f.collectionIds.length === 0) f.collectionIds = ['__default__'];
        });
        return list;
    } catch (e) {
        return [];
    }
}

function save(list) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch (e) {
        W.showToast('收藏存储空间不足，请清理一些收藏', 'error');
    }
}

// ── 云端 API ──

function cloudFetch(path, options) {
    var base = '';
    var meta = document.querySelector('meta[name="api-base"]');
    if (meta && meta.content) base = meta.content;

    var url = base + path;
    var opts = options || {};
    var headers = opts.headers || {};
    headers['Content-Type'] = 'application/json';
    var token = W.auth && W.auth.getToken ? W.auth.getToken() : null;
    if (token) headers['Authorization'] = 'Bearer ' + token;
    opts.headers = headers;
    if (opts.body && typeof opts.body === 'object') {
        opts.body = JSON.stringify(opts.body);
    }
    return fetch(url, opts).then(function(res) {
        return res.json().then(function(data) {
            if (!res.ok) throw new Error(data.error || '请求失败');
            return data;
        });
    });
}

// 单向推送本地收藏 + 收藏夹列表到云端
function pushFavorites() {
    var token = W.auth && W.auth.getToken ? W.auth.getToken() : null;
    if (!token) return Promise.resolve();

    return cloudFetch('/api/auth/favorites/sync', {
        method: 'POST',
        body: { favorites: W.state.favorites, collections: W.state.collections }
    }).then(function(data) {
        if (data.collections && data.collections.length > 0) {
            mergeCollections(data.collections);
        }
    }).catch(function(err) {
        console.warn('收藏推送失败:', err.message);
    });
}

// 双向同步：推送本地，用服务端合并结果覆盖本地
function syncWithCloud() {
    var token = W.auth && W.auth.getToken ? W.auth.getToken() : null;
    if (!token) return Promise.resolve();

    return cloudFetch('/api/auth/favorites/sync', {
        method: 'POST',
        body: { favorites: W.state.favorites, collections: W.state.collections }
    }).then(function(data) {
        if (data.favorites && data.favorites.length >= 0) {
            setState('favorites', data.favorites);
            save(data.favorites);
            updateCount();
            if (W.state.activeTab === 'favorites') render();
            if (W.state.activeTab === 'search') updateSearchCardFavButtons();
        }
        if (data.collections && data.collections.length > 0) {
            mergeCollections(data.collections);
        }
    }).catch(function(err) {
        console.warn('收藏同步失败:', err.message);
    });
}

// 以云端为基准合并
function mergeLocal(cloudFavs) {
    if (!cloudFavs || cloudFavs.length === 0) return false;

    var cloudMap = {};
    var maxCloudSavedAt = 0;
    cloudFavs.forEach(function(f) {
        var key = f.full || f.medium || f.thumb;
        if (key) {
            cloudMap[key] = f;
            var ct = Math.max(f.savedAt || 0, f.deletedAt || 0);
            if (ct > maxCloudSavedAt) maxCloudSavedAt = ct;
        }
    });

    var localMap = {};
    var addedCount = 0;
    W.state.favorites.forEach(function(f) {
        var key = f.full || f.medium || f.thumb;
        if (!key) return;
        var cloud = cloudMap[key];
        if (cloud) {
            var localTs = Math.max(f.savedAt || 0, f.deletedAt || 0);
            var cloudTs = Math.max(cloud.savedAt || 0, cloud.deletedAt || 0);
            localMap[key] = localTs >= cloudTs ? f : cloud;
        } else if ((f.savedAt || 0) > maxCloudSavedAt) {
            localMap[key] = f;
            addedCount++;
        }
    });

    Object.keys(cloudMap).forEach(function(key) {
        if (!localMap[key]) {
            localMap[key] = cloudMap[key];
            addedCount++;
        }
    });

    var merged = Object.keys(localMap).map(function(k) { return localMap[k]; });
    merged.sort(function(a, b) { return (b.savedAt || 0) - (a.savedAt || 0); });

    setState('favorites', merged);
    save(merged);
    updateCount();
    return addedCount > 0;
}

// init 时先从云端拉取收藏列表 + 收藏夹列表
function pullFromCloud() {
    var token = W.auth && W.auth.getToken ? W.auth.getToken() : null;
    if (!token) return Promise.resolve();

    return cloudFetch('/api/auth/favorites', { method: 'GET' })
        .then(function(data) {
            var hasFavs = data.favorites && data.favorites.length > 0;
            var hasCols = data.collections && data.collections.length > 0;
            if (hasFavs) mergeLocal(data.favorites);
            if (hasCols) mergeCollections(data.collections);
            if (hasFavs || hasCols) {
                return cloudFetch('/api/auth/favorites/sync', {
                    method: 'POST',
                    body: { favorites: W.state.favorites, collections: W.state.collections }
                }).then(function(syncData) {
                    if (syncData.collections && syncData.collections.length > 0) {
                        mergeCollections(syncData.collections);
                    }
                });
            }
        }).catch(function(err) {
            console.warn('拉取云端收藏失败:', err.message);
        });
}

function isFavorite(id, source) {
    return W.state.favorites.some(function(f) {
        return String(f.id) === String(id) && f.source === source && !f.deletedAt;
    });
}

function toggle(photo, source) {
    source = source || photo.source || W.state.source;
    var list = W.state.favorites;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(photo.id) && list[i].source === source && !list[i].deletedAt) {
            idx = i;
            break;
        }
    }
    if (idx >= 0) {
        list[idx].deletedAt = Date.now();
        setState('favorites', list);
        save(list);
        pushFavorites();
        return false;
    }
    // 未收藏 → 需要外部调用 showCollectionPicker 后 addFavorite
    return null;
}

function addFavorite(photo, source, collectionIds) {
    if (!collectionIds || collectionIds.length === 0) collectionIds = ['__default__'];
    source = source || photo.source || W.state.source;
    var list = W.state.favorites;
    // 复活墓碑
    var deadIdx = -1;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(photo.id) && list[i].source === source && list[i].deletedAt) {
            deadIdx = i;
            break;
        }
    }
    if (deadIdx >= 0) {
        delete list[deadIdx].deletedAt;
        list[deadIdx].savedAt = Date.now();
        list[deadIdx].collectionIds = collectionIds.slice();
    } else {
        var fav = {};
        Object.keys(photo).forEach(function(k) { fav[k] = photo[k]; });
        fav.source = source;
        fav.savedAt = Date.now();
        fav.collectionIds = collectionIds.slice();
        list.unshift(fav);
    }
    setState('favorites', list);
    save(list);
    pushFavorites();
    return true;
}

// 仅从指定收藏夹移除（还有其他收藏夹则保留图片，只剩一个则彻底取消收藏）
function removeFromCollection(photo, source, collectionId) {
    source = source || photo.source || W.state.source;
    var list = W.state.favorites;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(photo.id) && list[i].source === source && !list[i].deletedAt) {
            var cids = (list[i].collectionIds || ['__default__']).filter(function(cid) { return cid !== collectionId; });
            if (cids.length === 0) {
                // 无处可放 → 彻底取消收藏
                list[i].deletedAt = Date.now();
            } else {
                list[i].collectionIds = cids;
            }
            setState('favorites', list);
            save(list);
            pushFavorites();
            return true;
        }
    }
    return false;
}

// 收藏夹切换事件
var colSelect = document.getElementById('collectionSelect');
if (colSelect) {
    colSelect.addEventListener('change', function() {
        W.state.activeCollection = colSelect.value;
        if (W.state.activeTab === 'favorites') render();
    });
}

// 绑定导入/导出按钮（每次 render 后调用）
function bindImportButtons() {
    var btnJSON = document.getElementById('btnExportJSON');
    var btnHTML = document.getElementById('btnExportHTML');
    var btnImport = document.getElementById('btnImportJSON');
    if (btnJSON) btnJSON.addEventListener('click', exportJSON);
    if (btnHTML) btnHTML.addEventListener('click', exportHTML);
    if (btnImport) btnImport.addEventListener('click', function() { document.getElementById('importFileInput').click(); });

    var fileInput = document.getElementById('importFileInput');
    if (fileInput) {
        fileInput.addEventListener('change', function() {
            var file = fileInput.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var data = JSON.parse(e.target.result);
                    if (!Array.isArray(data)) throw new Error('格式错误');
                    importFavorites(data);
                } catch (err) {
                    W.showToast('导入失败: JSON 格式不正确', 'error');
                }
            };
            reader.readAsText(file);
            fileInput.value = '';
        });
    }
}

function render() {
    var list = W.state.favorites.filter(function(f) { return !f.deletedAt; });
    // 按收藏夹筛选
    var ac = W.state.activeCollection || '__all__';
    if (ac !== '__all__') {
        list = list.filter(function(f) { return (f.collectionIds || ['__default__']).indexOf(ac) >= 0; });
    }
    W.state._displayFavorites = list;

    // 导入按钮始终显示（空收藏夹也需要导入入口）
    var importBarStart = '<div class="fav-export-bar">'
        + '<button class="fav-export-btn" id="btnImportJSON">📥 导入 JSON</button>'
        + '<input type="file" id="importFileInput" accept=".json" style="display:none">';
    var importBarEnd = '</div>';

    if (list.length === 0) {
        W.dom.resultsGrid.innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">'
            + '<div style="font-size:48px;margin-bottom:16px;">💝</div>'
            + '<h3 style="font-weight:600;margin-bottom:8px;">收藏夹是空的</h3>'
            + '<p style="color:#86868b;font-size:14px;">搜索壁纸并点击 ♡ 按钮收藏喜欢的图片</p>'
            + '<p style="margin-top:12px;">' + importBarStart + importBarEnd + '</p>'
            + '</div>';
        bindImportButtons();
        return;
    }
    var html = importBarStart
        + '<button class="fav-export-btn" id="btnExportJSON" style="margin-left:8px;">📋 导出 JSON</button>'
        + '<button class="fav-export-btn" id="btnExportHTML" style="margin-left:8px;">🖼 导出 HTML 画廊</button>'
        + importBarEnd;
    list.forEach(function(photo, idx) {
        var res = photo.width + '\xD7' + photo.height;
        var ratioBadge = photo.ratioMatch && photo.ratioMatch !== 'all'
            ? '<span class="card-badge ' + photo.ratioMatch + '">' + (photo.ratioMatch === 'perfect' ? '精确' : photo.ratioMatch === 'good' ? '接近' : '宽松') + '</span>'
            : '';
        var purityBadge = '';
        if (photo.purity === 'nsfw') {
            purityBadge = '<span class="card-badge nsfw">NSFW</span>';
        } else if (photo.purity === 'sketchy') {
            purityBadge = '<span class="card-badge sketchy">Sketchy</span>';
        }
        html += '<div class="image-card" data-fav-index="' + idx + '" title="' + res + '">'
            + '<input type="checkbox" class="card-check" data-fav-index="' + idx + '">'
            + '<img src="' + photo.thumb + '" alt="' + escapeHtml(photo.alt) + '" loading="lazy"'
            + ' onerror="this.parentElement.innerHTML=\'<span style=font-size:40px;color:#d1d1d6;>🖼</span>\'" />'
            + ratioBadge + purityBadge
            + '<div class="card-overlay"><span class="card-res">' + res + '</span>'
            + '<div class="card-actions">'
            + '<button class="card-fav active" data-fav-index="' + idx + '">♥</button>'
            + '<button class="card-download" data-fav-index="' + idx + '">⬇</button>'
            + '</div></div></div>';
    });
    W.dom.resultsGrid.innerHTML = html;

    W.dom.resultsGrid.querySelectorAll('.image-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
            if (e.target.closest('.card-download') || e.target.closest('.card-fav') || e.target.closest('.card-check')) return;
            openFavPreview(parseInt(card.querySelector('.card-fav').dataset.favIndex));
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-check').forEach(function(cb) {
        cb.addEventListener('change', function(e) {
            e.stopPropagation();
            var idx = parseInt(cb.dataset.favIndex);
            var photo = W.state._displayFavorites[idx];
            if (!photo) return;
            if (cb.checked) {
                W.state.selectedPhotos.push(photo);
            } else {
                W.state.selectedPhotos = W.state.selectedPhotos.filter(function(p) { return p.id !== photo.id || (p.source || '') !== (photo.source || ''); });
            }
            W._updateMultiSelectUI();
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-download').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            W.downloadPhoto(W.state._displayFavorites[parseInt(btn.dataset.favIndex)]);
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-fav').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(btn.dataset.favIndex);
            var photo = W.state._displayFavorites[idx];
            toggle(photo, photo.source);
            updateCount();
            render();
            if (W.state.activeTab === 'search') {
                updateSearchCardFavButtons();
            }
        });
    });

    bindImportButtons();
}

function exportJSON() {
    var list = W.state.favorites.filter(function(f) { return !f.deletedAt; });
    var data = list.map(function(f) {
        return {
            id: f.id, width: f.width, height: f.height,
            full: f.full, medium: f.medium, thumb: f.thumb, preview: f.preview,
            alt: f.alt, purity: f.purity, photographer: f.photographer,
            sourceUrl: f.sourceUrl, source: f.source, savedAt: f.savedAt,
            collectionIds: f.collectionIds || ['__default__']
        };
    });
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '壁纸收藏_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a);
    a.click(); a.remove();
    URL.revokeObjectURL(url);
    W.showToast('已导出 ' + data.length + ' 条收藏 ✓', 'success');
}

function exportHTML() {
    var list = W.state.favorites.filter(function(f) { return !f.deletedAt; });
    var items = list.map(function(f) {
        var src = f.medium || f.thumb || '';
        return '      <div class="item">'
            + '<img src="' + escapeHtml(src) + '" loading="lazy" referrerpolicy="no-referrer" />'
            + '<div class="info">'
            + '<span class="res">' + f.width + '\xD7' + f.height + '</span>'
            + (f.photographer ? '<span class="author">' + escapeHtml(f.photographer) + '</span>' : '')
            + '</div></div>';
    }).join('\n');

    var html = '<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>壁纸收藏</title>\n<style>\n'
        + '*{margin:0;padding:0;box-sizing:border-box}'
        + 'body{background:#000;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",sans-serif;padding:24px}'
        + 'h1{text-align:center;font-size:24px;font-weight:600;margin-bottom:4px}'
        + '.sub{text-align:center;font-size:13px;color:#86868b;margin-bottom:32px}'
        + '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;max-width:1400px;margin:0 auto}'
        + '.item{background:#1c1c1e;border-radius:12px;overflow:hidden}'
        + '.item img{width:100%;display:block;aspect-ratio:16/10;object-fit:cover}'
        + '.info{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;font-size:13px;color:#aaa}'
        + '@media(max-width:640px){body{padding:12px}.grid{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}}'
        + '</style>\n</head>\n<body>\n'
        + '<h1>🖼 壁纸收藏</h1>\n'
        + '<p class="sub">共 ' + list.length + ' 张 · ' + new Date().toISOString().slice(0, 10) + '</p>\n'
        + '<div class="grid">\n' + items + '\n</div>\n</body>\n</html>';

    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = '壁纸收藏_' + new Date().toISOString().slice(0, 10) + '.html';
    document.body.appendChild(a);
    a.click(); a.remove();
    URL.revokeObjectURL(url);
    W.showToast('已导出 HTML 画廊 ✓', 'success');
}

function importFavorites(imported) {
    // 如果当前正在查看某个具体收藏夹，导入项自动归入该收藏夹
    var targetCol = W.state.activeCollection;
    if (targetCol === '__all__') targetCol = null;

    // 建立现有收藏的查找索引：key → index in W.state.favorites
    var existingIdx = {};  // 'id|source' → index
    var existingUrlIdx = {};  // URL → index (fallback)
    W.state.favorites.forEach(function(f, i) {
        if (f.deletedAt) return;
        if (f.id && f.source) existingIdx[f.id + '|' + f.source] = i;
        [f.full, f.medium, f.thumb, f.preview].forEach(function(u) {
            if (u && !existingUrlIdx[u]) existingUrlIdx[u] = i;
        });
    });

    var now = Date.now();
    var added = 0;
    var merged = 0;
    var skippedNoUrl = 0;
    imported.forEach(function(item) {
        if (!item.full && !item.medium && !item.thumb && !item.preview) { skippedNoUrl++; return; }

        // 查找是否已存在
        var matchIdx = -1;
        if (item.id && item.source && existingIdx[item.id + '|' + item.source] !== undefined) {
            matchIdx = existingIdx[item.id + '|' + item.source];
        } else {
            [item.full, item.medium, item.thumb, item.preview].some(function(u) {
                if (u && existingUrlIdx[u] !== undefined) {
                    matchIdx = existingUrlIdx[u];
                    return true;
                }
            });
        }

        if (matchIdx >= 0) {
            // 已存在 → 合并 collectionIds
            var existing = W.state.favorites[matchIdx];
            // 如果被墓碑过，复活
            if (existing.deletedAt) { delete existing.deletedAt; existing.savedAt = now; }
            var newCols = (item.collectionIds && item.collectionIds.length > 0) ? item.collectionIds : ['__default__'];
            if (targetCol && newCols.indexOf(targetCol) < 0) newCols.push(targetCol);
            var curCols = existing.collectionIds || ['__default__'];
            var changed = false;
            newCols.forEach(function(cid) {
                if (curCols.indexOf(cid) < 0) { curCols.push(cid); changed = true; }
            });
            if (changed) { existing.collectionIds = curCols; existing.savedAt = now; merged++; }
        } else {
            // 新图片 → 添加
            var colIds = (item.collectionIds && item.collectionIds.length > 0) ? item.collectionIds.slice() : ['__default__'];
            if (targetCol && colIds.indexOf(targetCol) < 0) colIds.push(targetCol);
            var fav = {
                id: item.id || (item.thumb || '').slice(-16),
                width: item.width || 0, height: item.height || 0,
                full: item.full || '', medium: item.medium || '', thumb: item.thumb || '',
                preview: item.preview || '', alt: item.alt || '',
                purity: item.purity || 'sfw', photographer: item.photographer || '',
                sourceUrl: item.sourceUrl || '', source: item.source || '',
                savedAt: item.savedAt || now, deletedAt: 0,
                collectionIds: colIds
            };
            W.state.favorites.push(fav);
            var idx = W.state.favorites.length - 1;
            if (fav.id && fav.source) existingIdx[fav.id + '|' + fav.source] = idx;
            [fav.full, fav.medium, fav.thumb, fav.preview].forEach(function(u) {
                if (u && existingUrlIdx[u] === undefined) existingUrlIdx[u] = idx;
            });
            added++;
        }
    });

    if (added > 0 || merged > 0) {
        save(W.state.favorites);
        updateCount();
        updateSearchCardFavButtons();
        if (W.state.user) pushFavorites();
        if (W.state.activeTab === 'favorites') render();
        var parts = [];
        if (added > 0) parts.push('新增 ' + added + ' 张');
        if (merged > 0) parts.push('合并 ' + merged + ' 张到收藏夹');
        W.showToast(parts.join('，') + ' ✓', 'success');
    } else {
        W.showToast('没有新图片可导入（全部重复）', '');
    }
}

function openFavPreview(idx) {
    var list = W.state._displayFavorites || W.state.favorites.filter(function(f) { return !f.deletedAt; });
    var photo = list[idx];
    if (!photo) return;
    W.resetPreviewZoom(false);
    W.state.modalIndex = idx;
    W.state.modalSource = 'favorites';
    W.state.modalPhoto = photo;
    W.loadModalImage(photo);
    W.dom.modalInfo.textContent = (idx + 1) + ' / ' + list.length + '  ' + photo.width + '\xD7' + photo.height + ' \xB7 ' + (photo.photographer || '');
    W.dom.modalOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    updateModalFavButton();
}

function updateCount() {
    var count = W.state.favorites.filter(function(f) { return !f.deletedAt; }).length;
    var el = W.dom.favCount;
    if (el) {
        el.textContent = count;
        el.style.display = count > 0 ? '' : 'none';
    }
}

function updateModalFavButton() {
    var btn = W.dom.modalFav;
    if (!btn || !W.state.modalPhoto) return;
    var photo = W.state.modalPhoto;
    var fav = isFavorite(photo.id, photo.source || W.state.source);
    btn.textContent = fav ? '♥' : '♡';
    btn.classList.toggle('active', fav);
}

function updateSearchCardFavButtons() {
    var grid = W.dom.resultsGrid;
    if (!grid) return;
    var btns = grid.querySelectorAll('.card-fav');
    btns.forEach(function(btn) {
        var idx = parseInt(btn.dataset.index);
        if (isNaN(idx)) idx = parseInt(btn.dataset.favIndex);
        var photo;
        if (W.state.activeTab === 'search') {
            photo = W.state.photos[idx];
        }
        if (!photo) return;
        var fav = isFavorite(photo.id, photo.source || W.state.source);
        btn.textContent = fav ? '♥' : '♡';
        btn.classList.toggle('active', fav);
    });
}

function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
}

// ---- Init ----
W.state.favorites = load();
W.state.activeTab = 'search';

if (!W.dom.favCount) W.dom.favCount = document.getElementById('favCount');
if (!W.dom.modalFav) W.dom.modalFav = document.getElementById('modalFav');

var tabs = document.querySelectorAll('.results-tab');

function switchTab(tabName) {
    if (W.state.activeTab === tabName) return;
    // 切标签退出多选
    var msToggle = document.getElementById('multiSelectToggle');
    if (msToggle && msToggle.checked) { msToggle.checked = false; W.state.multiSelect = false; W.state.selectedPhotos = []; document.body.classList.remove('multi-select-active'); }
    if (W.state.activeTab === 'search') {
        W.state._searchGridHTML = W.dom.resultsGrid.innerHTML;
    }
    W.state.activeTab = tabName;
    tabs.forEach(function(t) { t.classList.remove('active'); });
    var targetTab = document.querySelector('.results-tab[data-tab="' + tabName + '"]');
    if (targetTab) targetTab.classList.add('active');

    if (tabName === 'favorites') {
        document.getElementById('hideFavedLabel').style.display = 'none';
        document.getElementById('multiSelectLabel').style.display = W.state.favorites.filter(function(f) { return !f.deletedAt; }).length > 0 ? '' : 'none';
        document.getElementById('multiSelectBar').style.display = 'none';
        document.getElementById('collectionFilter').style.display = '';
        populateCollectionSelect();
        W.dom.loadMoreWrap.style.display = 'none';
        W.dom.resultsCount.textContent = '收藏夹 · 共 ' + W.state.favorites.filter(function(f) { return !f.deletedAt; }).length + ' 张';
        render();
    } else {
        document.getElementById('hideFavedLabel').style.display = W.state.photos.length > 0 ? '' : 'none';
        document.getElementById('multiSelectLabel').style.display = W.state.photos.length > 0 ? '' : 'none';
        document.getElementById('multiSelectBar').style.display = 'none';
        document.getElementById('collectionFilter').style.display = 'none';
        if (typeof W.state._searchGridHTML === 'string') {
            W.dom.resultsGrid.innerHTML = W.state._searchGridHTML;
            W.attachCardListeners();
            updateSearchCardFavButtons();
        }
        if (W.state.photos.length > 0) {
            var hasMore = W.state.allPhotos.length < W.state.totalResults;
            W.dom.loadMoreWrap.style.display = hasMore ? '' : 'none';
            W.dom.resultsCount.textContent =
                '找到 ' + W.state.totalResults + ' 张，已加载 ' + W.state.allPhotos.length + ' 张（"' + W.state.currentQuery + '" · ' + (W.state.selectedRatio === 'all' ? '全部比例' : W.state.selectedRatio) + '）';
        } else if (!W.getCurrentApiKey()) {
            W.dom.resultsCount.textContent = '👈 请点击右上角 ⚙ 选择图源并填入 API Key（免费注册获取）';
        } else {
            var favInitMsg = '输入关键词开始搜索 · 当前图源：' + W.getCurrentConfig().name;
            if (!W.state.user) favInitMsg += '（已填写个人 API Key，不消耗次数）';
            W.dom.resultsCount.textContent = favInitMsg;
        }
    }
}

tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
        switchTab(tab.dataset.tab);
    });
});

updateCount();

// ── 收藏夹管理面板事件 ──

var btnMgmt = document.getElementById('btnManageCollections');
var mgmtOverlay = document.getElementById('colMgmtOverlay');
var btnCloseMgmt = document.getElementById('btnCloseMgmt');
var btnAddCol = document.getElementById('btnAddCollection');
var colNewName = document.getElementById('colNewName');

function renderMgmtList() {
    var listEl = document.getElementById('colMgmtList');
    if (!listEl) return;
    var html = '';
    W.state.collections.forEach(function(c) {
        if (c.id === '__default__' || c.deletedAt) return;
        var count = W.state.favorites.filter(function(f) {
            return !f.deletedAt && (f.collectionIds || []).indexOf(c.id) >= 0;
        }).length;
        html += '<div class="col-mgmt-item">'
            + '<span class="name">' + escapeHtml(c.name) + '</span>'
            + '<span class="count">' + count + ' 张</span>'
            + '<button class="act edit" data-id="' + c.id + '">✎</button>'
            + '<button class="act del" data-id="' + c.id + '">✕</button>'
            + '</div>';
    });
    listEl.innerHTML = html || '<div style="color:#86868b;font-size:13px;text-align:center;padding:12px;">暂无自定义收藏夹</div>';

    // 编辑
    listEl.querySelectorAll('.act.edit').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var id = btn.dataset.id;
            var col = W.state.collections.find(function(c) { return c.id === id; });
            if (!col) return;
            var newName = prompt('重命名收藏夹', col.name);
            if (newName && newName.trim() && newName.trim() !== col.name) {
                renameCollection(id, newName.trim());
                renderMgmtList();
                if (W.state.activeTab === 'favorites') render();
            }
        });
    });
    // 删除
    listEl.querySelectorAll('.act.del').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var id = btn.dataset.id;
            var col = W.state.collections.find(function(c) { return c.id === id; });
            if (!col) return;
            var count = W.state.favorites.filter(function(f) {
                return !f.deletedAt && (f.collectionIds || []).indexOf(id) >= 0;
            }).length;
            if (confirm('确定删除收藏夹「' + col.name + '」？\n其中的 ' + count + ' 张图片将移回默认收藏夹。')) {
                deleteCollection(id);
                renderMgmtList();
            }
        });
    });
}

if (btnMgmt) {
    btnMgmt.addEventListener('click', function() {
        renderMgmtList();
        mgmtOverlay.style.display = 'flex';
    });
}
if (btnCloseMgmt) {
    btnCloseMgmt.addEventListener('click', function() {
        mgmtOverlay.style.display = 'none';
    });
}
mgmtOverlay.addEventListener('click', function(e) {
    if (e.target === mgmtOverlay) mgmtOverlay.style.display = 'none';
});
if (btnAddCol) {
    btnAddCol.addEventListener('click', function() {
        var name = (colNewName.value || '').trim();
        if (!name) return;
        if (W.state.collections.find(function(c) { return c.name === name && !c.deletedAt; })) {
            W.showToast('收藏夹名称已存在', 'error');
            return;
        }
        createCollection(name);
        colNewName.value = '';
        renderMgmtList();
    });
}
if (colNewName) {
    colNewName.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') btnAddCol.click();
    });
}

// ── 选择面板事件 ──

document.getElementById('btnPickerConfirm').addEventListener('click', function() {
    var checkedIds = [];
    document.querySelectorAll('#colPickerList input:checked').forEach(function(cb) {
        checkedIds.push(cb.value);
    });
    var resolve = _pickerResolve;
    hideCollectionPicker();
    if (resolve) resolve(checkedIds);
});

document.getElementById('btnPickerCancel').addEventListener('click', function() {
    var resolve = _pickerResolve;
    hideCollectionPicker();
    if (resolve) resolve(null);
});

// 点击面板外部关闭
document.addEventListener('click', function(e) {
    var picker = document.getElementById('colPicker');
    if (picker && picker.style.display === 'block'
        && !picker.contains(e.target)
        && !e.target.closest('.card-fav')
        && !e.target.closest('#modalFav')) {
        var resolve = _pickerResolve;
        hideCollectionPicker();
        if (resolve) resolve(null);
    }
});

// ── Public API ──

export const favorites = {
    load: load,
    save: save,
    isFavorite: isFavorite,
    toggle: toggle,
    addFavorite: addFavorite,
    removeFromCollection: removeFromCollection,
    showCollectionPicker: showCollectionPicker,
    hideCollectionPicker: hideCollectionPicker,
    render: render,
    updateCount: updateCount,
    updateModalFavButton: updateModalFavButton,
    updateSearchCardFavButtons: updateSearchCardFavButtons,
    switchTab: switchTab,
    syncWithCloud: syncWithCloud,
    pullFromCloud: pullFromCloud,
    mergeLocal: mergeLocal,
};

// backward compat
W.favorites = favorites;
