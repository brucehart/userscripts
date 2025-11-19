// ==UserScript==
// @name         Disable Page Visibility (IG / YouTube / Facebook)
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Prevent pages from detecting when you switch tabs so videos keep playing in the background.
// @author       You
// @match        *://*.youtube.com/*
// @match        *://m.youtube.com/*
// @match        *://*.instagram.com/*
// @match        *://*.facebook.com/*
// @match        *://web.facebook.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    function patchVisibilityAPI() {
        try {
            Object.defineProperty(document, 'visibilityState', {
                get: function () { return 'visible'; },
                configurable: true
            });
        } catch (e) {
            // Some sites may make this non-configurable; ignore if so.
        }

        try {
            Object.defineProperty(document, 'hidden', {
                get: function () { return false; },
                configurable: true
            });
        } catch (e) {
            // Same as above.
        }

        // Block visibilitychange events from reaching page scripts
        const stopEvent = function (e) {
            e.stopImmediatePropagation();
        };

        document.addEventListener('visibilitychange', stopEvent, true);
        document.addEventListener('webkitvisibilitychange', stopEvent, true);
        document.addEventListener('mozvisibilitychange', stopEvent, true);
        document.addEventListener('msvisibilitychange', stopEvent, true);
    }

    patchVisibilityAPI();
})();
