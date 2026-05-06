const W = window.WallpaperApp || {};

export function setState(key, value) {
    W.state[key] = value;
}

export function updateState(partial) {
    Object.keys(partial).forEach(key => {
        W.state[key] = partial[key];
    });
}

// backward compat — unconverted modules still reach these via W.setState / W.updateState
window.WallpaperApp = W;
W.setState = setState;
W.updateState = updateState;
