// ==UserScript==
// @name         Instagram View Image in New Tab
// @namespace    https://github.com/brucehart/userscripts
// @version      1.0
// @description  Add a right-click menu item on Instagram images to open the real image URL in a new tab.
// @author       Bruce J. Hart
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-idle
// @grant        GM_openInTab
// ==/UserScript==

(function () {
  'use strict';

  const MENU_ID = 'tm-instagram-view-image-menu';
  const MAX_ANCESTOR_DEPTH = 8;
  let activeImageUrl = '';
  let menu = null;

  function normalizeUrl(rawUrl) {
    if (!rawUrl) return '';

    const cleaned = rawUrl.trim().replace(/^['"]|['"]$/g, '');
    if (!cleaned || cleaned === 'none') return '';

    try {
      return new URL(cleaned, window.location.href).href;
    } catch (e) {
      return '';
    }
  }

  function parseSrcset(srcset) {
    if (!srcset) return '';

    let bestUrl = '';
    let bestScore = -1;

    srcset.split(',').forEach(function (candidate) {
      const parts = candidate.trim().split(/\s+/);
      const url = normalizeUrl(parts[0]);
      if (!url) return;

      const descriptor = parts[1] || '';
      let score = 1;

      if (descriptor.endsWith('w')) {
        score = parseFloat(descriptor) || score;
      } else if (descriptor.endsWith('x')) {
        score = (parseFloat(descriptor) || score) * 10000;
      }

      if (score > bestScore) {
        bestScore = score;
        bestUrl = url;
      }
    });

    return bestUrl;
  }

  function imageUrlFromImg(img) {
    return parseSrcset(img.getAttribute('srcset')) || normalizeUrl(img.currentSrc) || normalizeUrl(img.src);
  }

  function backgroundUrlFromElement(element) {
    const backgroundImage = window.getComputedStyle(element).backgroundImage;
    if (!backgroundImage || backgroundImage === 'none') return '';

    const matches = [...backgroundImage.matchAll(/url\((?:"([^"]+)"|'([^']+)'|([^)]*))\)/g)];
    const urls = matches
      .map(function (match) {
        return normalizeUrl(match[1] || match[2] || match[3]);
      })
      .filter(Boolean)
      .filter(function (url) {
        return !url.startsWith('data:');
      });

    return urls[0] || '';
  }

  function rectContainsPoint(element, x, y) {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function imageUrlFromDescendant(element, x, y) {
    const images = [...element.querySelectorAll('img[src], img[srcset]')];
    const image = images.find(function (img) {
      return rectContainsPoint(img, x, y);
    });

    return image ? imageUrlFromImg(image) : '';
  }

  function imageUrlNearElement(startElement, x, y) {
    let element = startElement;
    let depth = 0;

    while (element && element.nodeType === Node.ELEMENT_NODE && depth <= MAX_ANCESTOR_DEPTH) {
      if (element instanceof HTMLImageElement) {
        const imgUrl = imageUrlFromImg(element);
        if (imgUrl) return imgUrl;
      }

      const descendantImgUrl = imageUrlFromDescendant(element, x, y);
      if (descendantImgUrl) return descendantImgUrl;

      const bgUrl = backgroundUrlFromElement(element);
      if (bgUrl) return bgUrl;

      element = element.parentElement;
      depth += 1;
    }

    return '';
  }

  function findImageUrlAtPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);

    for (const element of elements) {
      const imageUrl = imageUrlNearElement(element, x, y);
      if (imageUrl) return imageUrl;
    }

    return '';
  }

  function ensureMenu() {
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.innerHTML = '<button type="button">View Image in New Tab</button>';
    menu.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    menu.querySelector('button').addEventListener('click', openActiveImage);
    document.body.appendChild(menu);

    const style = document.createElement('style');
    style.textContent = `
      #${MENU_ID} {
        position: fixed;
        z-index: 2147483647;
        display: none;
        min-width: 190px;
        padding: 6px;
        background: #fff;
        border: 1px solid rgba(0, 0, 0, 0.16);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        color: #111;
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }

      #${MENU_ID} button {
        display: block;
        width: 100%;
        padding: 8px 10px;
        background: transparent;
        border: 0;
        border-radius: 6px;
        color: inherit;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }

      #${MENU_ID} button:hover,
      #${MENU_ID} button:focus {
        background: rgba(0, 0, 0, 0.08);
        outline: none;
      }
    `;
    document.head.appendChild(style);

    return menu;
  }

  function showMenu(x, y, imageUrl) {
    activeImageUrl = imageUrl;

    const currentMenu = ensureMenu();
    currentMenu.style.display = 'block';

    const menuRect = currentMenu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - menuRect.width - 8);
    const top = Math.min(y, window.innerHeight - menuRect.height - 8);

    currentMenu.style.left = `${Math.max(8, left)}px`;
    currentMenu.style.top = `${Math.max(8, top)}px`;
  }

  function hideMenu() {
    activeImageUrl = '';
    if (menu) menu.style.display = 'none';
  }

  function openActiveImage() {
    const imageUrl = activeImageUrl;
    hideMenu();

    if (!imageUrl) return;

    if (typeof GM_openInTab === 'function') {
      GM_openInTab(imageUrl, { active: true, insert: true });
    } else {
      window.open(imageUrl, '_blank', 'noopener');
    }
  }

  document.addEventListener('contextmenu', function (event) {
    if (menu && menu.contains(event.target)) return;

    const imageUrl = findImageUrlAtPoint(event.clientX, event.clientY);
    if (!imageUrl) {
      hideMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    showMenu(event.clientX, event.clientY, imageUrl);
  }, true);

  document.addEventListener('mousedown', function (event) {
    if (!menu || menu.style.display === 'none' || menu.contains(event.target)) return;
    hideMenu();
  }, true);

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') hideMenu();
  }, true);

  window.addEventListener('scroll', hideMenu, true);
  window.addEventListener('resize', hideMenu, true);
})();
