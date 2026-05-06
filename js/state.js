(function() {
    'use strict';

    var W = window.WallpaperApp;

    W.setState = function(key, value) {
        W.state[key] = value;
    };

    W.updateState = function(partial) {
        Object.keys(partial).forEach(function(key) {
            W.state[key] = partial[key];
        });
    };
})();
