import { setState } from './state.js';
import { idbGet, idbSet } from './storage.js';
import { escapeHtml } from './utils.js';

const W = window.WallpaperApp;
var toastTimer = null;
var abortController = null;

function loadModalImage(photo) {
    var img = W.dom.modalImg;
    img.style.aspectRatio = photo.width + ' / ' + photo.height;
    img.referrerPolicy = 'no-referrer';
    img.src = photo.medium || photo.full || photo.preview;
}
W.loadModalImage = loadModalImage;

function preloadAdjacent(idx, list) {
    [1, -1, 2, -2].forEach(function(offset) {
        var i = idx + offset;
        if (i < 0 || i >= list.length) return;
        var url = list[i].medium || list[i].full || list[i].preview;
        if (!url) return;
        var pre = new Image();
        pre.referrerPolicy = 'no-referrer';
        pre.src = url;
    });
}

// ---- 预览缩放 / 拖拽 ----
var zoom = { scale: 1, panX: 0, panY: 0 };
var zoomImgWrap = document.getElementById('modalImgWrap');
var zoomLevelEl = document.getElementById('zoomLevel');
var zoomControlsEl = document.getElementById('zoomControls');
var isPanning = false;
var panStart = { x: 0, y: 0 };
var panOrigin = { x: 0, y: 0 };

function applyZoom() {
    var img = W.dom.modalImg;
    img.style.transform = 'translate(' + zoom.panX + 'px, ' + zoom.panY + 'px) scale(' + zoom.scale + ')';
    img.style.transition = 'none';
    var pct = Math.round(zoom.scale * 100);
    zoomLevelEl.textContent = pct + '%';
    var zoomed = zoom.scale > 1.02;
    zoomControlsEl.classList.toggle('always-visible', zoomed);
    zoomImgWrap.classList.toggle('zoomed', zoomed);
    W._zoomScale = zoom.scale;
}

function resetZoom(animate) {
    zoom.scale = 1;
    zoom.panX = 0;
    zoom.panY = 0;
    isPanning = false;
    W._zoomScale = 1;
    var img = W.dom.modalImg;
    if (animate) {
        img.style.transition = 'transform 0.3s ease';
        setTimeout(function() { img.style.transition = 'none'; }, 300);
    } else {
        img.style.transition = 'none';
    }
    img.style.transform = '';
    zoomLevelEl.textContent = '100%';
    zoomControlsEl.classList.remove('always-visible');
    zoomImgWrap.classList.remove('zoomed', 'panning');
}
W.resetPreviewZoom = resetZoom;

function clampScale(s) { return Math.max(0.5, Math.min(5, s)); }

zoomImgWrap.addEventListener('wheel', function(e) {
    if (W.dom.modalOverlay.style.display !== 'flex') return;
    e.preventDefault();
    var factor = e.deltaY > 0 ? 1 / 1.15 : 1.15;
    if (e.ctrlKey) factor = e.deltaY > 0 ? 1 / 1.05 : 1.05;

    var rect = zoomImgWrap.getBoundingClientRect();
    var cx = rect.width / 2;
    var cy = rect.height / 2;
    var mx = e.clientX - rect.left - cx;
    var my = e.clientY - rect.top - cy;

    var imgX = (mx - zoom.panX) / zoom.scale;
    var imgY = (my - zoom.panY) / zoom.scale;

    var newScale = clampScale(zoom.scale * factor);

    zoom.panX = mx - imgX * newScale;
    zoom.panY = my - imgY * newScale;
    zoom.scale = newScale;

    if (Math.abs(zoom.scale - 1) < 0.03) {
        resetZoom(true);
        return;
    }
    applyZoom();
}, { passive: false });

zoomImgWrap.addEventListener('mousedown', function(e) {
    if (e.target.closest('.modal-nav') || e.target.closest('.zoom-controls') || e.target.closest('.modal-close')) return;
    if (zoom.scale <= 1.02) return;
    e.preventDefault();
    isPanning = true;
    panStart.x = e.clientX;
    panStart.y = e.clientY;
    panOrigin.x = zoom.panX;
    panOrigin.y = zoom.panY;
    zoomImgWrap.classList.add('panning');
});

document.addEventListener('mousemove', function(e) {
    if (!isPanning) return;
    zoom.panX = panOrigin.x + (e.clientX - panStart.x);
    zoom.panY = panOrigin.y + (e.clientY - panStart.y);
    applyZoom();
});

document.addEventListener('mouseup', function() {
    if (!isPanning) return;
    isPanning = false;
    zoomImgWrap.classList.remove('panning');
});

zoomImgWrap.addEventListener('dblclick', function(e) {
    if (e.target.closest('.modal-nav') || e.target.closest('.zoom-controls') || e.target.closest('.modal-close')) return;
    if (W.dom.modalOverlay.style.display !== 'flex') return;
    if (zoom.scale > 1.05) {
        resetZoom(true);
    } else {
        zoom.scale = 2;
        zoom.panX = 0;
        zoom.panY = 0;
        applyZoom();
    }
});

var pinchDist0 = 0;
var pinchScale0 = 1;
zoomImgWrap.addEventListener('touchstart', function(e) {
    if (e.touches.length === 2) {
        e.stopPropagation();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        pinchDist0 = Math.hypot(dx, dy);
        pinchScale0 = zoom.scale;
    } else if (e.touches.length === 1 && zoom.scale > 1.02) {
        e.stopPropagation();
        isPanning = true;
        panStart.x = e.touches[0].clientX;
        panStart.y = e.touches[0].clientY;
        panOrigin.x = zoom.panX;
        panOrigin.y = zoom.panY;
    }
}, { passive: true });

zoomImgWrap.addEventListener('touchmove', function(e) {
    if (e.touches.length === 2 && pinchDist0 > 0) {
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        var dy = e.touches[0].clientY - e.touches[1].clientY;
        var dist = Math.hypot(dx, dy);
        zoom.scale = clampScale(pinchScale0 * (dist / pinchDist0));
        applyZoom();
    } else if (e.touches.length === 1 && isPanning) {
        zoom.panX = panOrigin.x + (e.touches[0].clientX - panStart.x);
        zoom.panY = panOrigin.y + (e.touches[0].clientY - panStart.y);
        applyZoom();
    }
}, { passive: true });

zoomImgWrap.addEventListener('touchend', function(e) {
    if (e.touches.length < 2) pinchDist0 = 0;
    isPanning = false;
});

document.getElementById('btnZoomIn').addEventListener('click', function(e) {
    e.stopPropagation();
    zoom.scale = clampScale(zoom.scale * 1.3);
    applyZoom();
});
document.getElementById('btnZoomOut').addEventListener('click', function(e) {
    e.stopPropagation();
    var s = clampScale(zoom.scale / 1.3);
    if (Math.abs(s - 1) < 0.03) { resetZoom(true); return; }
    zoom.scale = s;
    applyZoom();
});
document.getElementById('btnZoomReset').addEventListener('click', function(e) {
    e.stopPropagation();
    resetZoom(true);
});

// ---- 工具函数 ----

function hasChineseChar(text) {
    return /[一-鿿]/.test(text);
}

function getOrientationForUnsplash(ratio) {
    if (ratio === 'all') return '';
    var parts = ratio.split(':');
    var w = Number(parts[0]);
    var h = Number(parts[1]);
    if (w === h) return 'squarish';
    return w > h ? 'landscape' : 'portrait';
}

function parseQuality() {
    var q = W.state.selectedQuality;
    if (q === 'all') return { minW: 1920, minH: 1080 };
    if (q === '4k') return { minW: 3840, minH: 0 };
    var parts = q.split('x');
    return { minW: Number(parts[0]) || 0, minH: Number(parts[1]) || 0 };
}

function filterByRatio(photos) {
    if (W.state.selectedRatio === 'all') {
        return photos.map(function(p) { p.ratioMatch = 'all'; return p; });
    }
    var parts = W.state.selectedRatio.split(':');
    var target = Number(parts[0]) / Number(parts[1]);
    var tol = Number(W.state.ratioTolerance) || 0.10;
    var results = [];
    photos.forEach(function(p) {
        var w = Number(p.width) || 0;
        var h = Number(p.height) || 0;
        if (w === 0 || h === 0) return;
        var pr = w / h;
        var relDiff = Math.abs(pr - target) / target;
        if (relDiff <= tol) {
            var level = relDiff <= 0.03 ? 'perfect' : (relDiff <= tol * 0.5 ? 'good' : 'loose');
            results.push({ ratioMatch: level, ratioDiff: relDiff });
            Object.keys(p).forEach(function(k) {
                if (k !== 'ratioMatch' && k !== 'ratioDiff') results[results.length - 1][k] = p[k];
            });
        }
    });
    results.sort(function(a, b) { return a.ratioDiff - b.ratioDiff; });
    return results;
}

function filterByPurity(photos) {
    // 'sfw': 仅安全；'sketchy': Sketchy + NSFW（不含 SFW）
    if (W.state.selectedPurity === 'sfw') return photos.filter(function(p) { return p.purity === 'sfw'; });
    if (W.state.selectedPurity === 'sketchy') return photos.filter(function(p) { return p.purity !== 'sfw'; });
    // legacy 'all' / 'safe': no filter
    return photos;
}

function getCategoryBitmask() {
    var sel = W.state.selectedCategories;
    return [
        sel.indexOf('General') >= 0 ? '1' : '0',
        sel.indexOf('Anime') >= 0 ? '1' : '0',
        sel.indexOf('People') >= 0 ? '1' : '0',
    ].join('');
}

function filterByCategory(photos) {
    var sel = W.state.selectedCategories;
    if (sel.length === 3) return photos;
    return photos.filter(function(p) {
        if (!p.alt) return true;
        var cat = p.alt.charAt(0).toUpperCase() + p.alt.slice(1).toLowerCase();
        return sel.indexOf(cat) >= 0;
    });
}

function filterByQuality(photos) {
    var q = parseQuality();
    return photos.filter(function(p) {
        var w = Number(p.width) || 0;
        var h = Number(p.height) || 0;
        if (w === 0 || h === 0) return false;
        if (q.minW > 0 && q.minH > 0) return w >= q.minW && h >= q.minH;
        if (q.minW > 0) return w >= q.minW;
        if (q.minH > 0) return h >= q.minH;
        return true;
    });
}

// ── 翻译缓存 (IndexedDB，重启不丢) ──
var CACHE_KEY = 'trans_cache';
var MAX_CACHE_SIZE = 200;
var transCache = null;

async function ensureCache() {
    if (transCache) return transCache;
    try {
        var raw = await idbGet(CACHE_KEY);
        if (raw) { transCache = new Map(raw); return transCache; }
    } catch (e) {}
    // 从 localStorage 迁移旧缓存
    try {
        var old = localStorage.getItem('wp_trans_cache');
        if (old) {
            transCache = new Map(JSON.parse(old));
            localStorage.removeItem('wp_trans_cache');
            await saveTransCache();
            return transCache;
        }
    } catch (e) {}
    transCache = new Map();
    return transCache;
}

async function saveTransCache() {
    try {
        await idbSet(CACHE_KEY, Array.from(transCache));
    } catch (e) {}
}

async function cacheGet(key) {
    var c = await ensureCache();
    if (!c.has(key)) return null;
    var value = c.get(key);
    // LRU: move to end
    c.delete(key);
    c.set(key, value);
    return value;
}

async function cacheSet(key, value) {
    var c = await ensureCache();
    if (c.has(key)) c.delete(key);
    else if (c.size >= MAX_CACHE_SIZE) {
        var first = c.keys().next().value;
        c.delete(first);
    }
    c.set(key, value);
    saveTransCache();
}

async function translateToEnglish(text) {
    var cached = await cacheGet(text);
    if (cached) { return cached; }

    try {
        var resp = await fetch(
            'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=zh|en'
        );
        var data = await resp.json();
        if (data.responseStatus === 200 && data.responseData && data.responseData.translatedText) {
            var translated = data.responseData.translatedText;
            if (translated.toLowerCase() !== text.toLowerCase()) {
                await cacheSet(text, translated);
                return translated;
            }
        }
    } catch (e) {
        console.warn('翻译失败:', e);
    }
    // cache negative results too (avoid repeated failed API calls for same text)
    await cacheSet(text, text);
    return text;
}

// ---- 公共函数 ----

function getCurrentConfig() {
    return W.SOURCE_CONFIG[W.state.source];
}
W.getCurrentConfig = getCurrentConfig;

function getCurrentApiKey() {
    return W.state.apiKeys[W.state.source];
}
W.getCurrentApiKey = getCurrentApiKey;

function showToast(msg, type) {
    clearTimeout(toastTimer);
    var toast = W.dom.toast;
    toast.textContent = msg;
    toast.className = 'toast ' + (type || '') + ' show';
    toastTimer = setTimeout(function() { toast.classList.remove('show'); }, 2200);
}
W.showToast = showToast;

// ---- 渲染 ----

function renderSkeletons() {
    var count = Math.min(W.state.perPage, 30);
    var html = '';
    for (var i = 0; i < count; i++) html += '<div class="skeleton"></div>';
    W.dom.resultsGrid.innerHTML = html;
}

function renderResults() {
    var photos = W.state.photos;
    if (W.state.hideFaved) {
        photos = photos.filter(function(p) { return !W.favorites.isFavorite(p.id, W.state.source); });
    }
    document.getElementById('hideFavedLabel').style.display = W.state.activeTab === 'search' && W.state.photos.length > 0 ? '' : 'none';
    document.getElementById('multiSelectLabel').style.display = W.state.activeTab === 'search' && W.state.photos.length > 0 ? '' : 'none';

    if (photos.length === 0) {
        var msg = W.state.hideFaved ? '当前筛选下所有图片都已收藏，取消"隐藏已收藏"查看更多' : '没有找到匹配的壁纸，试试其他关键词或放宽筛选';
        W.dom.resultsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#86868b;">😔 ' + msg + '</div>';
        return;
    }
    W.state._displayPhotos = photos;
    var html = '';
    photos.forEach(function(photo, idx) {
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
        var isFav = W.favorites.isFavorite(photo.id, W.state.source);
        var favClass = isFav ? ' active' : '';
        var favIcon = isFav ? '♥' : '♡';
        var delay = Math.min(idx, 24) * 0.04;
        html += '<div class="image-card" data-index="' + idx + '" title="' + res + '" style="animation-delay:' + delay.toFixed(2) + 's">'
            + '<input type="checkbox" class="card-check" data-index="' + idx + '">'
            + '<img src="' + photo.thumb + '" alt="' + escapeHtml(photo.alt) + '" loading="lazy"'
            + ' onerror="this.parentElement.innerHTML=\'<span style=font-size:40px;color:#d1d1d6;>🖼</span>\'" />'
            + ratioBadge + purityBadge
            + '<div class="card-overlay"><span class="card-res">' + res + '</span>'
            + '<div class="card-actions">'
            + '<button class="card-fav' + favClass + '" data-index="' + idx + '">' + favIcon + '</button>'
            + '<button class="card-download" data-index="' + idx + '">⬇</button>'
            + '</div></div></div>';
    });
    W.dom.resultsGrid.innerHTML = html;
    attachCardListeners();
}
W._renderResults = renderResults;

function attachCardListeners() {
    var list = W.state._displayPhotos || W.state.photos;
    W.dom.resultsGrid.querySelectorAll('.image-card').forEach(function(card) {
        card.addEventListener('click', function(e) {
            if (e.target.closest('.card-download') || e.target.closest('.card-fav') || e.target.closest('.card-check')) return;
            openPreview(parseInt(card.dataset.index));
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-check').forEach(function(cb) {
        cb.addEventListener('change', function(e) {
            e.stopPropagation();
            var idx = parseInt(cb.dataset.index);
            var photo = list[idx];
            if (!photo) return;
            if (cb.checked) {
                W.state.selectedPhotos.push(photo);
            } else {
                W.state.selectedPhotos = W.state.selectedPhotos.filter(function(p) { return p.id !== photo.id || (p.source || W.state.source) !== (photo.source || W.state.source); });
            }
            W._updateMultiSelectUI();
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-download').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            downloadPhoto(list[parseInt(btn.dataset.index)]);
        });
    });
    W.dom.resultsGrid.querySelectorAll('.card-fav').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!W.state.user) { location.href = 'login.html'; return; }
            var idx = parseInt(btn.dataset.index);
            var photo = list[idx];
            if (!photo) return;
            var isFav = W.favorites.isFavorite(photo.id, W.state.source);
            if (isFav) {
                // 已收藏 → 直接取消
                W.favorites.toggle(photo, W.state.source);
                W.favorites.updateCount();
                W.showToast('已取消收藏', 'success');
                btn.textContent = '♡';
                btn.classList.remove('active');
            } else {
                // 未收藏 → 弹出选择面板
                W.favorites.showCollectionPicker(photo, W.state.source).then(function(collectionIds) {
                    if (!collectionIds) return; // 取消
                    W.favorites.addFavorite(photo, W.state.source, collectionIds);
                    W.favorites.updateCount();
                    W.showToast('已添加到收藏 ♥', 'success');
                    if (W.state.activeTab === 'favorites' && W.state.activeCollection !== '__all__') {
                        // 如果当前筛选的收藏夹不在选择中，刷新后可能看不到
                        if (collectionIds.indexOf(W.state.activeCollection) < 0) {
                            W.favorites.render(); // 可能在当前筛选下不显示
                        }
                    }
                    if (W.state.hideFaved) {
                        W.state.photos = W.state.allPhotos;
                        renderResults();
                    } else {
                        btn.textContent = '♥';
                        btn.classList.add('active');
                    }
                });
            }
        });
    });
}
W.attachCardListeners = attachCardListeners;

// ---- 预览 ----

function openPreview(idx) {
    var list = W.state._displayPhotos || W.state.photos;
    var photo = list[idx];
    if (!photo) return;
    resetZoom(false);
    W.state.modalIndex = idx;
    W.state.modalSource = 'search';
    W.state.modalPhoto = photo;
    loadModalImage(photo);
    W.dom.modalInfo.textContent = (idx + 1) + ' / ' + list.length + '  ' + photo.width + '\xD7' + photo.height + ' \xB7 ' + (photo.photographer || '');
    W.dom.modalOverlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    W.favorites.updateModalFavButton();
    updateNavButtons();
    preloadAdjacent(idx, list);
}
W.openPreview = openPreview;

function closePreview() {
    resetZoom(false);
    W.dom.modalOverlay.style.display = 'none';
    document.body.style.overflow = '';
    W.state.modalPhoto = null;
    W.dom.modalImg.src = '';
}
W.closePreview = closePreview;

function updateNavButtons() {
    var list = W.state.modalSource === 'favorites' ? (W.state._displayFavorites || W.state.favorites.filter(function(f){return !f.deletedAt;})) : W.state.photos;
    var idx = W.state.modalIndex;
    var prev = document.getElementById('modalPrev');
    var next = document.getElementById('modalNext');
    if (prev) prev.style.visibility = idx > 0 ? '' : 'hidden';
    if (next) next.style.visibility = idx < list.length - 1 ? '' : 'hidden';
}

function navigatePreview(direction) {
    if (!W.state.modalPhoto) return;
    resetZoom(false);
    var list = W.state.modalSource === 'favorites' ? (W.state._displayFavorites || W.state.favorites.filter(function(f){return !f.deletedAt;})) : (W.state._displayPhotos || W.state.photos);
    var newIdx = W.state.modalIndex + direction;
    if (newIdx < 0 || newIdx >= list.length) return;
    var photo = list[newIdx];
    W.state.modalIndex = newIdx;
    W.state.modalPhoto = photo;
    loadModalImage(photo);
    W.dom.modalInfo.textContent = (newIdx + 1) + ' / ' + list.length + '  ' + photo.width + '\xD7' + photo.height + ' \xB7 ' + (photo.photographer || '');
    W.favorites.updateModalFavButton();
    updateNavButtons();
    preloadAdjacent(newIdx, list);
}
W.navigatePreview = navigatePreview;

// ---- 下载 ----

async function tryBlobDownload(url) {
    var resp = await fetch(url);
    var blob = await resp.blob();
    return blob;
}

async function downloadPhoto(photo) {
    var url = photo.full || photo.preview;
    if (!url) { W.showToast('下载链接不可用', 'error'); return; }
    W.showToast('下载中...', '');

    var urls = [url];
    if (W.state.source === 'wallhaven') {
        var config = W.getCurrentConfig();
        urls.push(config.baseUrl + '?url=' + encodeURIComponent(url));
    }

    for (var i = 0; i < urls.length; i++) {
        try {
            var blob = await tryBlobDownload(urls[i]);
            var ext = blob.type.split('/')[1] || 'jpg';
            var name = (photo.alt || '').replace(/[\/\\:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 60).trim();
            if (name) name = name + '_';
            var filename = name + photo.width + 'x' + photo.height + '_' + photo.id + '.' + ext;
            var blobUrl = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = blobUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(blobUrl);
            W.showToast('下载完成 ✓', 'success');
            return;
        } catch (err) {
            if (i < urls.length - 1) continue;
            window.open(url, '_blank');
            W.showToast('已在新标签页打开原图', '');
        }
    }
}
W.downloadPhoto = downloadPhoto;

// ---- 搜索 ----

async function doSearch() {
    if (!W.state._ready) return;
    if (W.state.isLoading) return;
    if (abortController) abortController.abort();
    abortController = new AbortController();
    var signal = abortController.signal;

    setState('isLoading', true);
    W.dom.btnSearch.disabled = true;
    if (W.state.currentPage === 1) {
        W.dom.resultsCount.textContent = '正在搜索...';
        renderSkeletons();
        W.dom.loadMoreWrap.style.display = 'none';
    } else {
        W.dom.btnLoadMore.disabled = true;
        W.dom.btnLoadMore.textContent = '加载中...';
    }

    var query = W.state.currentQuery;
    if (W.state.source === 'wallhaven' && hasChineseChar(query)) {
        if (W.state.currentPage === 1) {
            W.dom.resultsCount.textContent = '正在翻译中文关键词...';
        }
        query = await translateToEnglish(query);
        if (signal.aborted) return;
        if (W.state.currentPage === 1) {
            W.dom.resultsCount.textContent = '翻译结果："' + query + '"，正在搜索...';
        }
    }

    var config = W.getCurrentConfig();
    var quality = parseQuality();
    var useGuestProxy = !W.getCurrentApiKey() && !W.state.user;

    var parsed;
    if (useGuestProxy) {
        var apiBase = (function() {
            var meta = document.querySelector('meta[name="api-base"]');
            return meta ? meta.content : '';
        })();

        var guestBody = {
            source: W.state.source,
            query: query,
            page: W.state.currentPage,
            perPage: W.state.perPage,
            ratio: W.state.selectedRatio,
            purity: W.state.selectedPurity,
            minWidth: quality.minW,
            minHeight: quality.minH,
        };

        var guestHeaders = { 'Content-Type': 'application/json' };
        var token = W.auth && W.auth.getToken ? W.auth.getToken() : null;
        if (token) guestHeaders['Authorization'] = 'Bearer ' + token;

        try {
            var resp = await fetch(apiBase + '/api/guest/search', {
                method: 'POST',
                headers: guestHeaders,
                body: JSON.stringify(guestBody),
                signal: signal,
            });

            if (!resp.ok) {
                var errData = await resp.json().catch(function() { return {}; });
                if (resp.status === 429) {
                    var isLoggedIn = !!(W.state.user);
                    var ctaHtml = '<div style="grid-column:1/-1;text-align:center;padding:50px 20px;">'
                        + '<div style="font-size:48px;margin-bottom:16px;">⏰</div>'
                        + '<h3 style="font-weight:600;margin-bottom:8px;color:var(--text);">今日搜索次数已用完</h3>'
                        + '<p style="color:#86868b;font-size:14px;margin-bottom:20px;">' + (errData.error || '请明天再试') + '</p>';
                    if (!isLoggedIn) {
                        ctaHtml += '<a href="login.html" style="display:inline-block;padding:10px 24px;background:var(--accent);color:#fff;border-radius:20px;text-decoration:none;font-weight:600;margin-right:8px;">登录（提升至 40 次/天）</a>';
                    }
                    ctaHtml += '<button onclick="document.getElementById(\'btnSettings\').click()" style="display:inline-block;padding:10px 24px;background:#fff;color:var(--accent);border:1.5px solid var(--accent);border-radius:20px;cursor:pointer;font-weight:600;font-family:inherit;font-size:13px;">填写自己的 API Key（无限制）</button>'
                        + '</div>';
                    W.dom.resultsGrid.innerHTML = ctaHtml;
                    W.dom.resultsCount.textContent = '今日次数已用完 · 明天自动重置';
                    W.dom.loadMoreWrap.style.display = 'none';
                    setState('isLoading', false);
                    W.dom.btnSearch.disabled = false;
                    return;
                }
                var errMsg = errData.error || '请求失败 (' + resp.status + ')';
                throw new Error(errMsg);
            }

            var guestData = await resp.json();
            parsed = { total: guestData.total, photos: guestData.photos };

            if (guestData.usage) {
                W._guestUsage = guestData.usage;
                var remaining = guestData.usage.remaining;
                var limit = guestData.usage.limit;
                W.dom.resultsCount.dataset.usage = '今日剩余 ' + remaining + ' / ' + limit + ' 次';
            }
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            throw err;
        }
    } else {
        W._guestUsage = null;
        W.dom.resultsCount.dataset.usage = '';
        var ratioParam = config.mapRatio(W.state.selectedRatio);
        var orientation = getOrientationForUnsplash(W.state.selectedRatio);
        var purityMap = { sfw: '100', sketchy: '011', safe: '011', all: '111' };
        var purityParam = W.state.source === 'wallhaven'
            ? (purityMap[W.state.selectedPurity] || '110')
            : '';

        var params;
        if (W.state.source === 'pixabay') {
            var temp = { minWidth: quality.minW, minHeight: quality.minH };
            params = config.buildParams(query, W.state.perPage, W.state.currentPage, temp);
            params.set('key', W.getCurrentApiKey());
        } else {
            params = config.buildParams(query, W.state.perPage, W.state.currentPage, {
                ratioParam: ratioParam,
                minWidth: quality.minW,
                minHeight: quality.minH,
                orientation: orientation,
                purityParam: purityParam,
            });
        }

        var url;
        if (W.state.source === 'wallhaven') {
            var targetUrl = 'https://wallhaven.cc/api/v1/search?' + params.toString();
            url = config.baseUrl + '?url=' + encodeURIComponent(targetUrl);
        } else {
            var sep = config.baseUrl.indexOf('?') !== -1 ? '&' : '?';
            url = config.baseUrl + sep + params.toString();
        }
        var headers = config.getAuthHeader(W.getCurrentApiKey());

        try {
            var resp2 = await fetch(url, { headers: headers, signal: signal });
            if (!resp2.ok) {
                var errMsg2;
                if (resp2.status === 401) {
                    errMsg2 = 'API Key 无效或已过期，请在设置中更新';
                } else if (resp2.status === 403) {
                    errMsg2 = 'API 拒绝访问（403），请检查 API Key 权限';
                } else if (resp2.status === 429) {
                    errMsg2 = '请求过于频繁，请稍后重试';
                } else if (resp2.status >= 500) {
                    errMsg2 = '图源服务器故障（' + resp2.status + '），请稍后重试';
                } else {
                    var errData2 = await resp2.json().catch(function() { return {}; });
                    errMsg2 = errData2.error || (errData2.errors && errData2.errors[0]) || '请求失败 (' + resp2.status + ')';
                }
                throw new Error(errMsg2);
            }
            var data2 = await resp2.json();
            parsed = config.parseResponse(data2);
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            throw err;
        }
    }

    try {
        W.state.totalResults = parsed.total;

        var rawCount = parsed.photos.length;
        var newPhotos = parsed.photos;
        newPhotos = filterByRatio(newPhotos);
        newPhotos = filterByQuality(newPhotos);
        newPhotos = filterByPurity(newPhotos);
        newPhotos = filterByCategory(newPhotos);

        if (W.state.currentPage === 1) W.state.allPhotos = newPhotos;
        else W.state.allPhotos = W.state.allPhotos.concat(newPhotos);

        var MAX_CACHED = 500;
        if (W.state.allPhotos.length > MAX_CACHED) {
            W.state.allPhotos = W.state.allPhotos.slice(W.state.allPhotos.length - MAX_CACHED);
        }

        W.state.photos = W.state.allPhotos;
        renderResults();

        var hasMore = rawCount > 0 && W.state.allPhotos.length < parsed.total;
        W.dom.loadMoreWrap.style.display = hasMore ? '' : 'none';
        W.dom.btnLoadMore.textContent = '加载更多';
        W.dom.btnLoadMore.disabled = false;

        var countMsg = '找到 ' + parsed.total + ' 张，已加载 ' + W.state.allPhotos.length + ' 张（"' + W.state.currentQuery + '" · ' + (W.state.selectedRatio === 'all' ? '全部比例' : W.state.selectedRatio) + '）';
        if (W._guestUsage && W._guestUsage.remaining !== undefined) {
            countMsg += ' · 今日剩余 ' + W._guestUsage.remaining + ' / ' + W._guestUsage.limit + ' 次';
        } else if (!useGuestProxy) {
            countMsg += ' · 使用个人 API Key';
        }
        W.dom.resultsCount.textContent = countMsg;

        setState('isLoading', false);
        // 自动补拉暂时禁用（手机端筛选后卡加载）
        // if (W.state.allPhotos.length < W.state.perPage
        //     && rawCount > 0
        //     && parsed.total > W.state.allPhotos.length
        // ) {
        //     if (!W.state._autoFillCount) W.state._autoFillCount = 0;
        //     if (W.state._autoFillCount < 5) {
        //         W.state._autoFillCount++;
        //         W.state.currentPage++;
        //         doSearch();
        //         return;
        //     }
        // }
        // W.state._autoFillCount = 0;
    } catch (err) {
        if (err.name === 'AbortError') return;
        if (err.message === 'Failed to fetch') {
            err = new Error('网络连接失败，请检查网络后重试');
        }
        console.error(err);
        if (W.state.currentPage === 1) {
            W.dom.resultsGrid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:#ff3b30;">❌ ' + escapeHtml(err.message) + '</div>';
        }
        W.showToast('搜索失败: ' + err.message, 'error');
    }
    setState('isLoading', false);
    W.dom.btnSearch.disabled = false;
    W.dom.btnLoadMore.disabled = false;
    W.dom.btnLoadMore.textContent = '加载更多';
    // 自动补拉期间无限滚动被跳过，补完后若 sentinel 仍在视口则补触发
    if (W.state._pendingScrollLoad && !W.state._autoFillCount) {
        W.state._pendingScrollLoad = false;
        if (W.dom.loadMoreWrap.style.display !== 'none'
            && W.state.activeTab === 'search'
            && W.state.allPhotos.length < W.state.totalResults) {
            W.state.currentPage++;
            doSearch();
        }
    }
}
W.doSearch = doSearch;

// ── Exports ──

export {
    loadModalImage,
    resetZoom,
    showToast,
    getCurrentConfig,
    getCurrentApiKey,
    doSearch,
    downloadPhoto,
    openPreview,
    closePreview,
    navigatePreview,
    attachCardListeners,
    renderResults,
};
