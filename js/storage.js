(function() {
    'use strict';

    var W = window.WallpaperApp;

    // ═══════════════════════════════════════
    //  IndexedDB 层 — 替代 localStorage，更不易被清理
    // ═══════════════════════════════════════

    var DB_NAME = 'wallpaper-db';
    var DB_VERSION = 1;
    var STORE = 'settings';
    var FILE_NAME = '壁纸收集器设置.json';

    function openDB() {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE);
                }
            };
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { reject(e.target.error); };
        });
    }

    function idbGet(key) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE, 'readonly');
                var req = tx.objectStore(STORE).get(key);
                req.onsuccess = function() { resolve(req.result); };
                req.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    function idbSet(key, value) {
        return openDB().then(function(db) {
            return new Promise(function(resolve, reject) {
                var tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put(value, key);
                tx.oncomplete = function() { resolve(); };
                tx.onerror = function(e) { reject(e.target.error); };
            });
        });
    }

    // ═══════════════════════════════════════
    //  设置收集 / 应用
    // ═══════════════════════════════════════

    function collectSettings() {
        return {
            source: W.state.source,
            apiKeys: {
                wallhaven: W.state.apiKeys.wallhaven,
                pixabay: W.state.apiKeys.pixabay,
                unsplash: W.state.apiKeys.unsplash,
            },
            perPage: W.state.perPage,
            ratioTolerance: W.state.ratioTolerance,
            purity: W.state.selectedPurity,
        };
    }

    function applySettings(s) {
        if (!s) return;
        if (s.source) W.state.source = s.source;
        if (s.apiKeys) {
            if (s.apiKeys.wallhaven !== undefined) W.state.apiKeys.wallhaven = s.apiKeys.wallhaven;
            if (s.apiKeys.pixabay !== undefined) W.state.apiKeys.pixabay = s.apiKeys.pixabay;
            if (s.apiKeys.unsplash !== undefined) W.state.apiKeys.unsplash = s.apiKeys.unsplash;
        }
        if (s.perPage) W.state.perPage = s.perPage;
        if (s.ratioTolerance !== undefined) W.state.ratioTolerance = s.ratioTolerance;
        if (s.purity) {
            W.state.selectedPurity = s.purity;
            localStorage.setItem('wp_purity', s.purity);
        }
    }

    // ═══════════════════════════════════════
    //  localStorage → 只做迁移数据源，不再写入
    // ═══════════════════════════════════════

    function loadFromLocalStorage() {
        var keyW = localStorage.getItem('wp_api_wallhaven');
        var keyP = localStorage.getItem('wp_api_pixabay');
        var keyU = localStorage.getItem('wp_api_unsplash');
        if (!keyW && !keyP && !keyU) return null;

        // 迁移完成后清除，避免下次误读
        var settings = {
            source: localStorage.getItem('wp_source') || 'wallhaven',
            apiKeys: { wallhaven: keyW || '', pixabay: keyP || '', unsplash: keyU || '' },
            perPage: parseInt(localStorage.getItem('wp_per_page') || '30'),
            ratioTolerance: parseFloat(localStorage.getItem('wp_ratio_tolerance') || '0.10'),
            purity: localStorage.getItem('wp_purity') || 'safe',
        };
        localStorage.removeItem('wp_api_wallhaven');
        localStorage.removeItem('wp_api_pixabay');
        localStorage.removeItem('wp_api_unsplash');
        localStorage.removeItem('wp_source');
        localStorage.removeItem('wp_per_page');
        localStorage.removeItem('wp_ratio_tolerance');
        return settings;
    }

    // ═══════════════════════════════════════
    //  File System Access API — 自动磁盘同步（Chrome / Edge）
    // ═══════════════════════════════════════

    function supportsFSA() {
        return typeof window.showDirectoryPicker === 'function';
    }

    async function getSavedDirHandle() {
        try {
            return await idbGet('dirHandle');
        } catch (e) {
            return null;
        }
    }

    async function saveDirHandle(handle) {
        await idbSet('dirHandle', handle);
    }

    async function ensurePermission(dirHandle, mode) {
        try {
            var opts = { mode: mode }; // 'read' or 'readwrite'
            var perm = await dirHandle.queryPermission(opts);
            if (perm === 'granted') return true;
            perm = await dirHandle.requestPermission(opts);
            return perm === 'granted';
        } catch (e) {
            return false;
        }
    }

    async function loadFromFile() {
        if (!supportsFSA()) return null;
        try {
            var dirHandle = await getSavedDirHandle();
            if (!dirHandle) return null;
            if (!(await ensurePermission(dirHandle, 'read'))) return null;
            var fileHandle = await dirHandle.getFileHandle(FILE_NAME);
            var file = await fileHandle.getFile();
            var text = await file.text();
            return JSON.parse(text);
        } catch (e) {
            return null; // 文件不存在或权限丢失
        }
    }

    async function syncToFile(settings) {
        if (!supportsFSA()) return false;
        try {
            var dirHandle = await getSavedDirHandle();
            if (!dirHandle) return false;
            if (!(await ensurePermission(dirHandle, 'readwrite'))) return false;
            var fileHandle = await dirHandle.getFileHandle(FILE_NAME, { create: true });
            var writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(settings, null, 2));
            await writable.close();
            return true;
        } catch (e) {
            console.warn('Auto-sync failed:', e);
            return false;
        }
    }

    // ═══════════════════════════════════════
    //  手动导入 / 导出（兜底）
    // ═══════════════════════════════════════

    function exportToFile() {
        var settings = collectSettings();
        var blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = FILE_NAME;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        W.showToast('设置已导出 ✓', 'success');
    }

    function importFromFile() {
        return new Promise(function(resolve) {
            var input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.onchange = async function() {
                var file = input.files[0];
                if (!file) { resolve(null); return; }
                try {
                    var text = await file.text();
                    var settings = JSON.parse(text);
                    resolve(settings);
                } catch (e) {
                    W.showToast('文件格式错误', 'error');
                    resolve(null);
                }
            };
            input.click();
        });
    }

    // ═══════════════════════════════════════
    //  Public API → W.storage
    // ═══════════════════════════════════════

    W.storage = {

        /** 初始化加载：文件 → IndexedDB → localStorage，返回合并后的设置 */
        load: async function() {
            // 1. 尝试从磁盘文件读取（最可靠）
            var settings = await loadFromFile();
            if (settings) {
                await idbSet('settings', settings); // 同步到 IndexedDB 做备份
                return settings;
            }
            // 2. 尝试从 IndexedDB 读取
            settings = await idbGet('settings');
            if (settings) return settings;
            // 3. 从旧 localStorage 迁移
            settings = loadFromLocalStorage();
            if (settings) {
                await idbSet('settings', settings);
            }
            return settings;
        },

        /** 保存：写入 IndexedDB，如果已启用自动同步则同时写入磁盘 */
        save: async function() {
            var settings = collectSettings();
            await idbSet('settings', settings);
            var synced = await syncToFile(settings);
            return synced;
        },

        /** 启用自动磁盘同步（需要用户选择目录，仅 Chrome/Edge） */
        setupAutoSync: async function() {
            if (!supportsFSA()) {
                W.showToast('当前浏览器不支持，请使用 Chrome 或 Edge', 'error');
                return false;
            }
            try {
                var handle = await window.showDirectoryPicker({ mode: 'readwrite' });
                await saveDirHandle(handle);
                await syncToFile(collectSettings());
                return true;
            } catch (e) {
                if (e.name !== 'AbortError') console.warn('setupAutoSync failed:', e);
                return false;
            }
        },

        /** 检查是否已启用自动同步 */
        isAutoSyncEnabled: async function() {
            if (!supportsFSA()) return false;
            return !!(await getSavedDirHandle());
        },

        /** 取消自动同步（清除保存的目录句柄） */
        disableAutoSync: async function() {
            await idbSet('dirHandle', null);
        },

        /** 手动导出 JSON 文件 */
        exportToFile: exportToFile,

        /** 手动导入 JSON 文件，返回设置对象 */
        importFromFile: importFromFile,

        /** 将设置对象合并到 W.state */
        applySettings: applySettings,
    };
})();
