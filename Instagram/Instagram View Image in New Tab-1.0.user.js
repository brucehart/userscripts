// ==UserScript==
// @name         Instagram View Image in New Tab
// @namespace    https://github.com/brucehart/userscripts
// @version      1.0
// @description  Add right-click menu items on Instagram images to open, save, or copy the real image.
// @author       Bruce J. Hart
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-idle
// @grant        GM_openInTab
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const MENU_ID = 'tm-instagram-view-image-menu';
  const MAX_ANCESTOR_DEPTH = 8;
  let activeImageUrl = '';
  let activeImageFilename = '';
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

  function filenameFromImageUrl(imageUrl) {
    try {
      const url = new URL(imageUrl);
      const pathname = decodeURIComponent(url.pathname);
      const rawName = pathname.split('/').filter(Boolean).pop() || '';
      const extensionMatch = rawName.match(/\.(?:avif|gif|jpe?g|png|webp)\b/i);
      const extension = extensionMatch ? extensionMatch[0].toLowerCase() : '.jpg';
      const baseName = rawName
        .replace(/\.(?:avif|gif|jpe?g|png|webp).*$/i, '')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '');

      return `${baseName || 'instagram-image'}${extension}`;
    } catch (e) {
      return 'instagram-image.jpg';
    }
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
    menu.innerHTML = `
      <button type="button" data-action="open">View Image in New Tab</button>
      <button type="button" data-action="save">Save Image</button>
      <button type="button" data-action="copy">Copy Image</button>
    `;
    menu.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      event.stopPropagation();
    });
    menu.addEventListener('click', handleMenuClick);
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
    activeImageFilename = filenameFromImageUrl(imageUrl);

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
    activeImageFilename = '';
    if (menu) menu.style.display = 'none';
  }

  function handleMenuClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    if (button.dataset.action === 'open') {
      openActiveImage();
    } else if (button.dataset.action === 'save') {
      saveActiveImage();
    } else if (button.dataset.action === 'copy') {
      copyActiveImage();
    }
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

  function saveActiveImage() {
    const imageUrl = activeImageUrl;
    const filename = activeImageFilename || 'instagram-image.jpg';
    hideMenu();

    if (!imageUrl) return;

    if (typeof GM_download === 'function') {
      GM_download({
        url: imageUrl,
        name: filename,
        saveAs: true
      });
      return;
    }

    const link = document.createElement('a');
    link.href = imageUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function getImageBlob(imageUrl) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest({
          method: 'GET',
          url: imageUrl,
          responseType: 'blob',
          onload: function (response) {
            if (response.status >= 200 && response.status < 300 && response.response) {
              resolve(response.response);
            } else {
              reject(new Error(`Image request failed with status ${response.status}`));
            }
          },
          onerror: function () {
            reject(new Error('Image request failed'));
          }
        });
      });
    }

    return fetch(imageUrl, { credentials: 'omit' }).then(function (response) {
      if (!response.ok) throw new Error(`Image request failed with status ${response.status}`);
      return response.blob();
    });
  }

  function imageBlobToPngBlob(blob) {
    return new Promise(function (resolve, reject) {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();

      image.onload = function () {
        URL.revokeObjectURL(objectUrl);

        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;

        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        canvas.toBlob(function (pngBlob) {
          if (pngBlob) {
            resolve(pngBlob);
          } else {
            reject(new Error('Could not convert image for clipboard'));
          }
        }, 'image/png');
      };

      image.onerror = function () {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Could not load image for clipboard'));
      };

      image.src = objectUrl;
    });
  }

  function copyTextToClipboard(text) {
    return Promise.resolve().then(function () {
      if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(text, 'text');
        return;
      }

      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        return navigator.clipboard.writeText(text);
      }

      throw new Error('Clipboard text API is not available');
    });
  }

  function handleCopyTextFailure(error) {
    console.warn('Instagram View Image in New Tab: could not copy image URL fallback.', error);
  }

  function copyImageUrlFallback(imageUrl) {
    return copyTextToClipboard(imageUrl).catch(handleCopyTextFailure);
  }

  function copyActiveImage() {
    const imageUrl = activeImageUrl;
    hideMenu();

    if (!imageUrl) return;

    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem !== 'function') {
      copyImageUrlFallback(imageUrl);
      return;
    }

    getImageBlob(imageUrl)
      .then(imageBlobToPngBlob)
      .then(function (pngBlob) {
        return navigator.clipboard.write([
          new ClipboardItem({
            'image/png': pngBlob
          })
        ]);
      })
      .catch(function () {
        copyImageUrlFallback(imageUrl);
      });
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
