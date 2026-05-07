import { setState } from './state.js';

const W = window.WallpaperApp;
const STORAGE_KEY = 'wp_favorites';
const TOMBSTONE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 天后清理墓碑

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
        return cleanTombstones(list);
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

// 单向推送本地收藏到云端，不覆盖本地状态
function pushFavorites() {
    var token = W.auth && W.auth.getToken ? W.auth.getToken() : null;
    if (!token) return Promise.resolve();

    return cloudFetch('/api/auth/favorites/sync', {
        method: 'POST',
        body: { favorites: W.state.favorites }
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
        body: { favorites: W.state.favorites }
    }).then(function(data) {
        if (data.favorites && data.favorites.length >= 0) {
            setState('favorites', data.favorites);
            save(data.favorites);
            updateCount();
            if (W.state.activeTab === 'favorites') render();
            if (W.state.activeTab === 'search') updateSearchCardFavButtons();
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
            localMap[key] = (f.savedAt || 0) > (cloud.savedAt || 0) ? f : cloud;
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

// init 时先从云端拉取收藏列表
function pullFromCloud() {
    var token = W.auth && W.auth.getToken ? W.auth.getToken() : null;
    if (!token) return Promise.resolve();

    return cloudFetch('/api/auth/favorites', { method: 'GET' })
        .then(function(data) {
            if (data.favorites && data.favorites.length > 0) {
                mergeLocal(data.favorites);
                return cloudFetch('/api/auth/favorites/sync', {
                    method: 'POST',
                    body: { favorites: W.state.favorites }
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
    var added;
    if (idx >= 0) {
        list[idx].deletedAt = Date.now();  // 墓碑：标记删除而非删除，跨设备同步可见
        added = false;
    } else {
        // 检查是否之前删过（墓碑还在列表中），有则复活
        var deadIdx = -1;
        for (var j = 0; j < list.length; j++) {
            if (String(list[j].id) === String(photo.id) && list[j].source === source && list[j].deletedAt) {
                deadIdx = j;
                break;
            }
        }
        if (deadIdx >= 0) {
            delete list[deadIdx].deletedAt;
            list[deadIdx].savedAt = Date.now();
        } else {
            var fav = {};
            Object.keys(photo).forEach(function(k) { fav[k] = photo[k]; });
            fav.source = source;
            fav.savedAt = Date.now();
            list.unshift(fav);
        }
        added = true;
    }
    setState('favorites', list);
    save(list);

    pushFavorites();

    return added;
}

function render() {
    var list = W.state.favorites.filter(function(f) { return !f.deletedAt; });
    W.state._displayFavorites = list;
    if (list.length === 0) {
        W.dom.resultsGrid.innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">'
            + '<div style="font-size:48px;margin-bottom:16px;">💝</div>'
            + '<h3 style="font-weight:600;margin-bottom:8px;">收藏夹是空的</h3>'
            + '<p style="color:#86868b;font-size:14px;">搜索壁纸并点击 ♡ 按钮收藏喜欢的图片</p>'
            + '</div>';
        return;
    }
    var html = '<div class="fav-export-bar">'
        + '<button class="fav-export-btn" id="btnExportJSON">📋 导出 JSON</button>'
        + '<button class="fav-export-btn" id="btnExportHTML">🖼 导出 HTML 画廊</button>'
        + '</div>';
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

    // 导出按钮
    var btnJSON = document.getElementById('btnExportJSON');
    var btnHTML = document.getElementById('btnExportHTML');
    if (btnJSON) btnJSON.addEventListener('click', exportJSON);
    if (btnHTML) btnHTML.addEventListener('click', exportHTML);
}

function exportJSON() {
    var list = W.state.favorites.filter(function(f) { return !f.deletedAt; });
    var data = list.map(function(f) {
        return {
            id: f.id, width: f.width, height: f.height,
            full: f.full, medium: f.medium, thumb: f.thumb, preview: f.preview,
            alt: f.alt, purity: f.purity, photographer: f.photographer,
            sourceUrl: f.sourceUrl, source: f.source, savedAt: f.savedAt
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
        W.dom.loadMoreWrap.style.display = 'none';
        W.dom.resultsCount.textContent = '收藏夹 · 共 ' + W.state.favorites.filter(function(f) { return !f.deletedAt; }).length + ' 张';
        render();
    } else {
        document.getElementById('hideFavedLabel').style.display = W.state.photos.length > 0 ? '' : 'none';
        document.getElementById('multiSelectLabel').style.display = W.state.photos.length > 0 ? '' : 'none';
        document.getElementById('multiSelectBar').style.display = 'none';
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

// ── Public API ──

export const favorites = {
    load: load,
    save: save,
    isFavorite: isFavorite,
    toggle: toggle,
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
