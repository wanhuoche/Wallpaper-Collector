import { setState, updateState } from './state.js';

window.WallpaperApp = window.WallpaperApp || {};
const W = window.WallpaperApp;

const TOKEN_KEY = 'wp_auth_token';
const API_BASE = (function() {
    var meta = document.querySelector('meta[name="api-base"]');
    if (meta && meta.content) return meta.content;
    return '';
})();

// ── Token 管理 ──

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function saveToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

// ── API 请求封装 ──

function api(path, options) {
    var url = API_BASE + path;
    var opts = Object.assign({}, options);
    var headers = opts.headers || {};

    headers['Content-Type'] = 'application/json';
    var token = getToken();
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }
    opts.headers = headers;

    if (opts.body && typeof opts.body === 'object') {
        opts.body = JSON.stringify(opts.body);
    }

    var controller = new AbortController();
    opts.signal = controller.signal;
    var timeout = setTimeout(function() { controller.abort(); }, 5000);

    return fetch(url, opts).then(function(res) {
        clearTimeout(timeout);
        return res.json().then(function(data) {
            if (!res.ok) {
                var err = new Error(data.error || '请求失败');
                err.status = res.status;
                throw err;
            }
            return data;
        });
    }).catch(function(err) {
        clearTimeout(timeout);
        if (err.name === 'AbortError') {
            throw new Error('服务器连接超时，请确认后端已启动');
        }
        throw err;
    });
}

// ── 认证 API ──

function register(username, email, password) {
    return api('/api/auth/register', {
        method: 'POST',
        body: { username: username, email: email, password: password }
    });
}

function login(email, password) {
    return api('/api/auth/login', {
        method: 'POST',
        body: { email: email, password: password }
    });
}

function getMe() {
    return api('/api/auth/me');
}

function changePassword(oldPassword, newPassword) {
    return api('/api/auth/password', {
        method: 'PUT',
        body: { oldPassword: oldPassword, newPassword: newPassword }
    });
}

// ── 登录态 ──

function checkAuth() {
    var token = getToken();
    if (!token) return Promise.resolve(null);

    return getMe().then(function(data) {
        setState('user', data.user);
        return data.user;
    }).catch(function() {
        clearToken();
        return null;
    });
}

async function logout() {
    clearToken();
    localStorage.removeItem('wp_favorites');
    setState('user', null);
    setState('favorites', []);
    updateNavUser();
    await W.storage.resetSettings();
    window.location.href = 'login.html';
}

// ── 导航栏用户 UI ──

function closeUserDropdown(e) {
    var navUser = document.getElementById('navUser');
    if (navUser && !navUser.contains(e.target)) {
        var dd = document.getElementById('navUserDropdown');
        if (dd) dd.classList.remove('open');
    }
}

function updateNavUser() {
    var nav = document.querySelector('.navbar-actions');
    if (!nav) return;

    var oldUser = nav.querySelector('.nav-user');
    if (oldUser) oldUser.remove();
    var oldLogin = nav.querySelector('.btn-login');
    if (oldLogin) oldLogin.remove();
    document.removeEventListener('click', closeUserDropdown);

    if (W.state.user) {
        var initials = (W.state.user.username || '?').charAt(0).toUpperCase();
        var html = '<div class="nav-user" id="navUser">'
            + '<span class="nav-avatar" title="' + W.state.user.username + '">' + initials + '</span>'
            + '<span class="nav-username">' + W.state.user.username + '</span>'
            + '<div class="nav-user-dropdown" id="navUserDropdown">'
            + '<div class="dropdown-item user-info-item">'
            + '<span class="user-info-name">' + W.state.user.username + '</span>'
            + '<span class="user-info-email">' + W.state.user.email + '</span>'
            + '</div>'
            + '<div class="dropdown-divider"></div>'
            + '<button class="dropdown-item logout-item" id="btnLogout">退出登录</button>'
            + '</div>'
            + '</div>';
        nav.insertAdjacentHTML('beforeend', html);

        document.getElementById('navUser').addEventListener('click', function(e) {
            e.stopPropagation();
            document.getElementById('navUserDropdown').classList.toggle('open');
        });
        document.getElementById('btnLogout').addEventListener('click', function(e) {
            e.stopPropagation();
            logout();
        });
        document.addEventListener('click', closeUserDropdown);
    } else {
        nav.insertAdjacentHTML('beforeend',
            '<button class="btn-login" id="btnLogin" onclick="location.href=\'login.html\'">登录</button>'
        );
    }
}

// ── 通用表单提交 ──

function handleFormSubmit(form, action) {
    var errorEl = form.querySelector('.auth-error');
    var btn = form.querySelector('.btn-auth');
    var btnText = btn.querySelector('.btn-auth-text');
    var btnSpinner = btn.querySelector('.btn-auth-spinner');

    form.addEventListener('submit', function(e) {
        e.preventDefault();
        errorEl.textContent = '';

        var fields = {};
        var inputs = form.querySelectorAll('.auth-input');
        var empty = false;
        inputs.forEach(function(input) {
            fields[input.name] = input.value.trim();
            if (!fields[input.name]) empty = true;
        });

        if (empty) {
            errorEl.textContent = '请填写所有字段';
            return;
        }

        btn.disabled = true;
        btnText.style.display = 'none';
        btnSpinner.style.display = '';

        action(fields).then(function(data) {
            saveToken(data.token);
            window.location.href = 'index.html';
        }).catch(function(err) {
            errorEl.textContent = err.message;
            btn.disabled = false;
            btnText.style.display = '';
            btnSpinner.style.display = 'none';
        });
    });
}

// ── 要求登录 ──

function requireAuth() {
    return checkAuth().then(function(user) {
        if (!user) {
            var page = window.location.pathname.split('/').pop();
            if (page !== 'login.html' && page !== 'register.html') {
                window.location.href = 'login.html';
            }
        }
        return user;
    });
}

// ── Public API ──

export const auth = {
    register: register,
    login: login,
    logout: logout,
    getMe: getMe,
    changePassword: changePassword,
    getToken: getToken,
    saveToken: saveToken,
    clearToken: clearToken,
    checkAuth: checkAuth,
    requireAuth: requireAuth,
    handleFormSubmit: handleFormSubmit,
    updateNavUser: updateNavUser,
};

// backward compat
W.auth = auth;
