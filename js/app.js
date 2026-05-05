(function() {
    'use strict';

    var W = window.WallpaperApp;
    var $ = function(s) { return document.querySelector(s); };

    // ---- 状态（默认值，启动时从 storage 加载覆盖）----
    W.state = {
        user: null,
        source: 'wallhaven',
        apiKeys: { wallhaven: '', pixabay: '', unsplash: '' },
        perPage: 30,
        ratioTolerance: 0.10,
        selectedRatio: 'all',
        selectedQuality: 'all',
        selectedPurity: 'safe',
        currentQuery: '',
        currentPage: 1,
        totalResults: 0,
        photos: [],
        allPhotos: [],
        isLoading: false,
        modalPhoto: null,
    };

    // ---- DOM 引用 ----
    W.dom = {
        searchInput: $('#searchInput'),
        btnSearch: $('#btnSearch'),
        ratioTags: $('#ratioTags'),
        qualityTags: $('#qualityTags'),
        purityTags: $('#purityTags'),
        resultsGrid: $('#resultsGrid'),
        resultsCount: $('#resultsCount'),
        loadMoreWrap: $('#loadMoreWrap'),
        btnLoadMore: $('#btnLoadMore'),
        modalOverlay: $('#modalOverlay'),
        modalImg: $('#modalImg'),
        modalInfo: $('#modalInfo'),
        modalDownload: $('#modalDownload'),
        modalFav: $('#modalFav'),
        modalClose: $('#modalClose'),
        toast: $('#toast'),
        btnSettings: $('#btnSettings'),
        settingsPanel: $('#settingsPanel'),
        settingsBackdrop: $('#settingsBackdrop'),
        btnCloseSettings: $('#btnCloseSettings'),
        btnSaveSettings: $('#btnSaveSettings'),
        settingSource: $('#settingSource'),
        settingApiKeyWallhaven: $('#settingApiKeyWallhaven'),
        settingApiKeyPixabay: $('#settingApiKeyPixabay'),
        settingApiKeyUnsplash: $('#settingApiKeyUnsplash'),
        settingPerPage: $('#settingPerPage'),
        settingRatioTolerance: $('#settingRatioTolerance'),
        wallhavenKeyGroup: $('#wallhavenKeyGroup'),
        pixabayKeyGroup: $('#pixabayKeyGroup'),
        unsplashKeyGroup: $('#unsplashKeyGroup'),
        sourceName: $('#sourceName'),
        sourceDot: $('.source-dot'),
        favCount: $('#favCount'),
        storageStatus: $('#storageStatus'),
        btnAutoSync: $('#btnAutoSync'),
        btnExport: $('#btnExport'),
        btnImport: $('#btnImport'),
    };

    var D = W.dom;

    // ---- 设置面板 ----
    function updateKeyGroups() {
        D.wallhavenKeyGroup.style.display = W.state.source === 'wallhaven' ? '' : 'none';
        D.pixabayKeyGroup.style.display = W.state.source === 'pixabay' ? '' : 'none';
        D.unsplashKeyGroup.style.display = W.state.source === 'unsplash' ? '' : 'none';
    }

    function openSettings() {
        D.settingSource.value = W.state.source;
        D.settingApiKeyWallhaven.value = W.state.apiKeys.wallhaven;
        D.settingApiKeyPixabay.value = W.state.apiKeys.pixabay;
        D.settingApiKeyUnsplash.value = W.state.apiKeys.unsplash;
        D.settingPerPage.value = W.state.perPage.toString();
        D.settingRatioTolerance.value = W.state.ratioTolerance.toString();
        updateKeyGroups();
        updateStorageStatus();
        D.settingsPanel.classList.add('open');
        D.settingsBackdrop.classList.add('open');
        document.body.style.overflow = 'hidden';
    }

    function closeSettings() {
        D.settingsPanel.classList.remove('open');
        D.settingsBackdrop.classList.remove('open');
        document.body.style.overflow = '';
    }

    D.btnSettings.addEventListener('click', openSettings);
    var btnTheme = document.getElementById('btnTheme');
    if (btnTheme) btnTheme.addEventListener('click', function() { W.theme.toggle(); });
    D.btnCloseSettings.addEventListener('click', closeSettings);
    D.settingsBackdrop.addEventListener('click', closeSettings);

    D.settingSource.addEventListener('change', function() {
        W.state.source = D.settingSource.value;
        updateKeyGroups();
    });

    D.btnSaveSettings.addEventListener('click', async function() {
        W.state.source = D.settingSource.value;
        W.state.apiKeys.wallhaven = D.settingApiKeyWallhaven.value.trim();
        W.state.apiKeys.pixabay = D.settingApiKeyPixabay.value.trim();
        W.state.apiKeys.unsplash = D.settingApiKeyUnsplash.value.trim();
        W.state.perPage = parseInt(D.settingPerPage.value) || 30;
        W.state.ratioTolerance = parseFloat(D.settingRatioTolerance.value) || 0.10;

        var synced = await W.storage.save();
        updateSourceIndicator();
        updateStorageStatus();
        closeSettings();
        W.showToast(synced ? '设置已保存并同步到磁盘 ✓' : '设置已保存 ✓', 'success');
    });

    function updateSourceIndicator() {
        var config = W.getCurrentConfig();
        D.sourceName.textContent = config ? config.name : '未配置';
        var hasKey = !!W.getCurrentApiKey();
        D.sourceDot.style.background = hasKey ? '#34c759' : '#ff3b30';
    }

    async function updateStorageStatus() {
        var enabled = await W.storage.isAutoSyncEnabled();
        var dot = D.storageStatus.querySelector('.storage-dot');
        var text = D.storageStatus.querySelector('.storage-text');
        if (enabled) {
            dot.style.background = '#34c759';
            text.textContent = '自动同步：已启用 ✓';
            D.btnAutoSync.textContent = '🔄 重选目录';
        } else {
            dot.style.background = '#ff9500';
            text.textContent = '自动同步：未启用（推荐启用，重启自动恢复）';
            D.btnAutoSync.textContent = '📁 选择存储目录';
        }
    }

    // 存储按钮事件
    D.btnAutoSync.addEventListener('click', async function() {
        var ok = await W.storage.setupAutoSync();
        if (ok) {
            updateStorageStatus();
            W.showToast('自动同步已启用 ✓', 'success');
        }
    });

    D.btnExport.addEventListener('click', function() {
        W.storage.exportToFile();
    });

    D.btnImport.addEventListener('click', async function() {
        var settings = await W.storage.importFromFile();
        if (!settings) return;
        W.storage.applySettings(settings);
        await W.storage.save();
        D.settingSource.value = W.state.source;
        D.settingApiKeyWallhaven.value = W.state.apiKeys.wallhaven;
        D.settingApiKeyPixabay.value = W.state.apiKeys.pixabay;
        D.settingApiKeyUnsplash.value = W.state.apiKeys.unsplash;
        D.settingPerPage.value = W.state.perPage.toString();
        D.settingRatioTolerance.value = W.state.ratioTolerance.toString();
        updateKeyGroups();
        updateSourceIndicator();
        updateStorageStatus();
        W.showToast('设置已导入 ✓', 'success');
    });

    // ---- 筛选标签 ----

    var filterDebounceTimer = null;
    function filterSearch() {
        clearTimeout(filterDebounceTimer);
        filterDebounceTimer = setTimeout(function() {
            W.state.isLoading = false;
            W.doSearch();
        }, 300);
    }

    D.ratioTags.addEventListener('click', function(e) {
        var tag = e.target.closest('.ratio-tag');
        if (!tag) return;
        D.ratioTags.querySelectorAll('.ratio-tag').forEach(function(t) { t.classList.remove('active'); });
        tag.classList.add('active');
        W.state.selectedRatio = tag.dataset.ratio;
        if (W.state.currentQuery) { W.state.currentPage = 1; W.state.allPhotos = []; W.favorites.switchTab('search'); filterSearch(); }
    });

    D.qualityTags.addEventListener('click', function(e) {
        var tag = e.target.closest('.quality-tag');
        if (!tag) return;
        D.qualityTags.querySelectorAll('.quality-tag').forEach(function(t) { t.classList.remove('active'); });
        tag.classList.add('active');
        W.state.selectedQuality = tag.dataset.quality;
        if (W.state.currentQuery) { W.state.currentPage = 1; W.state.allPhotos = []; W.favorites.switchTab('search'); filterSearch(); }
    });

    D.purityTags.addEventListener('click', function(e) {
        var tag = e.target.closest('.purity-tag');
        if (!tag) return;
        D.purityTags.querySelectorAll('.purity-tag').forEach(function(t) { t.classList.remove('active'); });
        tag.classList.add('active');
        W.state.selectedPurity = tag.dataset.purity;
        localStorage.setItem('wp_purity', W.state.selectedPurity);
        if (W.state.currentQuery) { W.state.currentPage = 1; W.state.allPhotos = []; W.favorites.switchTab('search'); filterSearch(); }
    });

    // ---- 搜索历史 ----
    var HIST_KEY = 'wp_search_history';
    var historyPanel = document.getElementById('searchHistory');

    function loadHistory() {
        try { return JSON.parse(localStorage.getItem(HIST_KEY)) || []; } catch(e) { return []; }
    }
    function saveHistory(list) {
        try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, 20))); } catch(e) {}
    }
    function addHistory(query) {
        var list = loadHistory();
        var idx = list.indexOf(query);
        if (idx >= 0) list.splice(idx, 1);
        list.unshift(query);
        saveHistory(list);
    }
    function renderHistory() {
        var list = loadHistory();
        if (list.length === 0) { historyPanel.style.display = 'none'; return; }
        var html = '';
        list.forEach(function(q) {
            html += '<div class="search-history-item" data-query="' + q.replace(/"/g, '&quot;') + '">'
                + '<span>' + q + '</span>'
                + '<span class="hist-delete" data-query="' + q.replace(/"/g, '&quot;') + '">✕</span>'
                + '</div>';
        });
        html += '<div class="search-history-clear" id="histClear">清除历史</div>';
        historyPanel.innerHTML = html;
        historyPanel.style.display = '';
    }
    function hideHistory() { setTimeout(function() { historyPanel.style.display = 'none'; }, 150); }

    D.searchInput.addEventListener('focus', renderHistory);
    D.searchInput.addEventListener('blur', hideHistory);

    // 一键清除搜索框
    var searchClear = document.getElementById('searchClear');
    function toggleClearBtn() { searchClear.classList.toggle('visible', D.searchInput.value.length > 0); }
    D.searchInput.addEventListener('input', toggleClearBtn);
    searchClear.addEventListener('click', function() {
        D.searchInput.value = '';
        searchClear.classList.remove('visible');
        D.searchInput.focus();
    });
    historyPanel.addEventListener('mousedown', function(e) { e.preventDefault(); });
    historyPanel.addEventListener('click', function(e) {
        var item = e.target.closest('.search-history-item');
        var clear = e.target.closest('.search-history-clear');
        var del = e.target.closest('.hist-delete');
        if (del) {
            e.stopPropagation();
            var list = loadHistory();
            var q = del.dataset.query;
            var idx = list.indexOf(q);
            if (idx >= 0) list.splice(idx, 1);
            saveHistory(list);
            renderHistory();
            return;
        }
        if (clear) {
            saveHistory([]);
            historyPanel.style.display = 'none';
            return;
        }
        if (item) {
            var query = item.dataset.query;
            D.searchInput.value = query;
            toggleClearBtn();
            historyPanel.style.display = 'none';
            D.btnSearch.click();
        }
    });

    // ---- 搜索触发 ----
    D.btnSearch.addEventListener('click', function() {
        W.state.currentQuery = D.searchInput.value.trim();
        W.state.currentPage = 1;
        W.state.allPhotos = [];
        if (!W.state.currentQuery) {
            W.showToast('请输入搜索关键词', 'error');
            return;
        }
        if (!W.getCurrentApiKey()) {
            W.showToast('请先设置 ' + W.getCurrentConfig().name + ' 的 API Key', 'error');
            openSettings();
            return;
        }
        addHistory(W.state.currentQuery);
        W.favorites.switchTab('search');
        W.doSearch();
    });

    D.searchInput.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') D.btnSearch.click();
    });

    D.btnLoadMore.addEventListener('click', function() {
        W.state.currentPage++;
        W.doSearch();
    });

    // 无限滚动
    var sentinel = document.getElementById('scrollSentinel');
    if (sentinel && 'IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function(entries) {
            entries.forEach(function(entry) {
                if (!entry.isIntersecting) return;
                // 只在搜索结果标签、未加载中、有更多结果时触发
                if (W.state.activeTab !== 'search') return;
                if (W.state.isLoading) return;
                if (D.loadMoreWrap.style.display === 'none') return;
                W.state.currentPage++;
                W.doSearch();
            });
        }, { rootMargin: '200px' });
        observer.observe(sentinel);
    }

    // ---- 预览弹窗事件 ----
    D.modalClose.addEventListener('click', W.closePreview);
    D.modalOverlay.addEventListener('click', function(e) {
        if (e.target === D.modalOverlay) W.closePreview();
    });
    document.addEventListener('keydown', function(e) {
        if (D.modalOverlay.style.display !== 'flex') return;
        if (e.key === 'Escape') { W.closePreview(); return; }
        if (e.key === 'ArrowLeft')  { e.preventDefault(); W.navigatePreview(-1); }
        if (e.key === 'ArrowRight') { e.preventDefault(); W.navigatePreview(1); }
    });
    var modalPrev = document.getElementById('modalPrev');
    var modalNext = document.getElementById('modalNext');
    if (modalPrev) modalPrev.addEventListener('click', function(e) { e.stopPropagation(); W.navigatePreview(-1); });
    if (modalNext) modalNext.addEventListener('click', function(e) { e.stopPropagation(); W.navigatePreview(1); });

    // 触摸滑动
    var touchStartX = 0;
    D.modalOverlay.addEventListener('touchstart', function(e) {
        if (e.touches.length === 1) touchStartX = e.touches[0].clientX;
    }, { passive: true });
    D.modalOverlay.addEventListener('touchend', function(e) {
        if (!touchStartX) return;
        if (W._zoomScale && W._zoomScale > 1.02) { touchStartX = 0; return; }
        var dx = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(dx) > 50) {
            W.navigatePreview(dx < 0 ? 1 : -1);
        }
        touchStartX = 0;
    });
    D.modalDownload.addEventListener('click', function() {
        if (W.state.modalPhoto) W.downloadPhoto(W.state.modalPhoto);
    });
    var btnViewOriginal = document.getElementById('btnViewOriginal');
    if (btnViewOriginal) {
        btnViewOriginal.addEventListener('click', function() {
            var photo = W.state.modalPhoto;
            if (!photo) return;
            W.resetPreviewZoom(false);
            W.dom.modalImg.referrerPolicy = 'no-referrer';
            W.dom.modalImg.src = photo.full || photo.medium || photo.preview;
            btnViewOriginal.textContent = '加载中...';
            btnViewOriginal.disabled = true;
            W.dom.modalImg.onload = function() {
                btnViewOriginal.textContent = '查看原图';
                btnViewOriginal.disabled = false;
            };
        });
    }
    D.modalFav.addEventListener('click', function() {
        if (!W.state.modalPhoto) return;
        var photo = W.state.modalPhoto;
        var added = W.favorites.toggle(photo, photo.source || W.state.source);
        W.favorites.updateModalFavButton();
        W.favorites.updateCount();
        if (W.state.activeTab === 'favorites') {
            W.favorites.render();
        } else {
            W.favorites.updateSearchCardFavButtons();
        }
        W.showToast(added ? '已添加到收藏 ♥' : '已取消收藏', 'success');
    });

    // ---- 回到顶部 ----
    var btnBackTop = document.getElementById('btnBackTop');
    if (btnBackTop) {
        window.addEventListener('scroll', function() {
            btnBackTop.classList.toggle('visible', window.scrollY > 400);
        }, { passive: true });
        btnBackTop.addEventListener('click', function() {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ---- 快捷键 ----
    document.addEventListener('keydown', function(e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
            e.preventDefault();
            D.searchInput.focus();
        }
        if ((e.ctrlKey || e.metaKey) && e.key === ',') {
            e.preventDefault();
            openSettings();
        }
    });

    // ---- 初始化（异步加载存储）----
    (async function init() {
        var settings = await W.storage.load();
        if (settings) W.storage.applySettings(settings);

        // 检查登录态
        var user = await W.auth.checkAuth();
        if (!user) {
            W.state.user = null;
        }
        W.auth.updateNavUser();

        updateSourceIndicator();
        updateStorageStatus();
        if (!W.getCurrentApiKey()) {
            D.resultsCount.textContent = '👈 请点击右上角 ⚙ 选择图源并填入 API Key（免费注册获取）';
            D.resultsGrid.innerHTML =
                '<div style="grid-column:1/-1;text-align:center;padding:60px 20px;">'
                + '<div style="font-size:48px;margin-bottom:16px;">🔑</div>'
                + '<h3 style="font-weight:600;margin-bottom:8px;">需要 API Key</h3>'
                + '<p style="color:#86868b;font-size:14px;">Wallhaven / Pixabay / Unsplash 均免费注册</p>'
                + '</div>';
        } else {
            D.resultsCount.textContent = '输入关键词开始搜索 · 当前图源：' + W.getCurrentConfig().name;
        }
    })();
})();