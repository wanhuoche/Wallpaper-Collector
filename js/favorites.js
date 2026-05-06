import { setState } from './state.js';

const W = window.WallpaperApp;
const STORAGE_KEY = 'wp_favorites';
const DELETED_KEY = 'wp_fav_deleted';

// ── 删除追踪（防推送失败时云端旧数据回流）──

function loadDeleted() {
    try {
        var data = localStorage.getItem(DELETED_KEY);
        return data ? JSON.parse(data) : {};
    } catch (e) { return {}; }
}

function recordDelete(id, source) {
    var del = loadDeleted();
    del[id + '_' + source] = Date.now();
    try { localStorage.setItem(DELETED_KEY, JSON.stringify(del)); } catch (e) {}
}

function clearDeleted() {
    try { localStorage.removeItem(DELETED_KEY); } catch (e) {}
}

function filterDeleted(items) {
    var del = loadDeleted();
    if (Object.keys(del).length === 0) return items;
    return items.filter(function(f) {
        var key = (f.id || '') + '_' + (f.source || '');
        return !del[key];
    });
}

function load() {
    try {
        var data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
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
    }).then(function() {
        clearDeleted(); // 推送成功，云端已是权威状态
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

    // 先过滤掉本地记录为已删除的项（推送未完成的情况下防回流）
    var filtered = filterDeleted(cloudFavs);
    if (filtered.length === 0) return false;

    var cloudMap = {};
    var maxCloudSavedAt = 0;
    filtered.forEach(function(f) {
        var key = f.full || f.medium || f.thumb;
        if (key) {
            cloudMap[key] = f;
            if ((f.savedAt || 0) > maxCloudSavedAt) maxCloudSavedAt = f.savedAt || 0;
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
        return String(f.id) === String(id) && f.source === source;
    });
}

function toggle(photo, source) {
    source = source || photo.source || W.state.source;
    var list = W.state.favorites;
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(photo.id) && list[i].source === source) {
            idx = i;
            break;
        }
    }
    var added;
    if (idx >= 0) {
        list.splice(idx, 1);
        recordDelete(photo.id, source);  // 记下删除，防止推送未完成时云端回流
        added = false;
    } else {
        var fav = {};
        Object.keys(photo).forEach(function(k) { fav[k] = photo[k]; });
        fav.source = source;
        fav.savedAt = Date.now();
        list.unshift(fav);
        added = true;
    }
    setState('favorites', list);
    save(list);

    pushFavorites(); // 异步推送，推送成功后 clearDeleted()

    return added;
}

function render() {
    var list = W.state.favorites;
    if (list.length === 0) {
        W.dom.resultsGrid.innerHTML =
            '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">'
            + '<div style="font-size:48px;margin-bottom:16px;">💝</div>'
            + '<h3 style="font-weight:600;margin-bottom:8px;">收藏夹是空的</h3>'
            + '<p style="color:#86868b;font-size:14px;">搜索壁纸并点击 ♡ 按钮收藏喜欢的图片</p>'
            + '</div>';
        return;
    }
    var html = '';
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
            if (e.target.closest('.card-download') || e.target.closest('.card-fav')) return;
            openFavPreview(parseInt(card.querySelector('.card-fav').dataset.favIndex));
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-download').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            W.downloadPhoto(W.state.favorites[parseInt(btn.dataset.favIndex)]);
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-fav').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(btn.dataset.favIndex);
            var photo = W.state.favorites[idx];
            toggle(photo, photo.source);
            updateCount();
            render();
            if (W.state.activeTab === 'search') {
                updateSearchCardFavButtons();
            }
        });
    });
}

function openFavPreview(idx) {
    var photo = W.state.favorites[idx];
    if (!photo) return;
    W.resetPreviewZoom(false);
    W.state.modalIndex = idx;
    W.state.modalSource = 'favorites';
    W.state.modalPhoto = photo;
    W.loadModalImage(photo);
    W.dom.modalInfo.textContent = (idx + 1) + ' / ' + W.state.favorites.length + '  ' + photo.width + '\xD7' + photo.height + ' \xB7 ' + (photo.photographer || '');
    W.dom.modalOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    updateModalFavButton();
}

function updateCount() {
    var count = W.state.favorites.length;
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
    if (W.state.activeTab === 'search') {
        W.state._searchGridHTML = W.dom.resultsGrid.innerHTML;
    }
    W.state.activeTab = tabName;
    tabs.forEach(function(t) { t.classList.remove('active'); });
    var targetTab = document.querySelector('.results-tab[data-tab="' + tabName + '"]');
    if (targetTab) targetTab.classList.add('active');

    if (tabName === 'favorites') {
        document.getElementById('hideFavedLabel').style.display = 'none';
        W.dom.loadMoreWrap.style.display = 'none';
        W.dom.resultsCount.textContent = '收藏夹 · 共 ' + W.state.favorites.length + ' 张';
        render();
    } else {
        document.getElementById('hideFavedLabel').style.display = W.state.photos.length > 0 ? '' : 'none';
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
