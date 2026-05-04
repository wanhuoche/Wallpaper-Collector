(function() {
    'use strict';

    window.WallpaperApp = window.WallpaperApp || {};
    var W = window.WallpaperApp;
    var STORAGE_KEY = 'wp_theme';
    var html = document.documentElement;

    function getSystemPreference() {
        if (window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
        return 'light';
    }

    function load() {
        try {
            return localStorage.getItem(STORAGE_KEY);
        } catch (e) {
            return null;
        }
    }

    function save(theme) {
        try {
            localStorage.setItem(STORAGE_KEY, theme);
        } catch (e) { /* ignore */ }
    }

    function apply(theme) {
        html.setAttribute('data-theme', theme);
    }

    function toggle() {
        var current = html.getAttribute('data-theme') || 'light';
        var next = current === 'dark' ? 'light' : 'dark';
        apply(next);
        save(next);
        updateIcon(next);
        return next;
    }

    function updateIcon(theme) {
        var btn = document.getElementById('btnTheme');
        if (btn) btn.textContent = theme === 'dark' ? '☀' : '🌙';
    }

    // Init
    var saved = load();
    var theme = saved || getSystemPreference();
    apply(theme);
    updateIcon(theme);

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!load()) { // only follow system if user hasn't manually set
            var next = e.matches ? 'dark' : 'light';
            apply(next);
            updateIcon(next);
        }
    });

    // Public API
    W.theme = {
        toggle: toggle,
        get: function() { return html.getAttribute('data-theme') || 'light'; },
    };
})();
