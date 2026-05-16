// ==UserScript==
// @name         Instagram View Image in New Tab
// @namespace    https://github.com/brucehart/userscripts
// @version      1.5
// @description  Add right-click menu items on Instagram images and videos to open, save, or copy the real media.
// @author       Bruce J. Hart
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-idle
// @grant        GM_openInTab
// @grant        GM_download
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  const MENU_ID = 'tm-instagram-view-image-menu';
  const MAX_ANCESTOR_DEPTH = 8;
  const INSTAGRAM_MEDIA_PATH_PATTERN = /^\/(?:p|reel|reels|tv)\/[^/?#]+\/?/i;
  const INSTAGRAM_MEDIA_LINK_SELECTOR = 'a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"], a[href^="/tv/"]';
  const VIDEO_URL_KEY_PATTERN = /^(?:video_url|playable_url|playable_url_quality_hd|dash_manifest|contentUrl|src|url)$/i;
  const MAX_OBJECT_SEARCH_DEPTH = 8;
  const MAX_OBJECT_SEARCH_NODES = 2500;
  let activeMedia = null;
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

  function isHttpUrl(url) {
    return /^https?:\/\//i.test(url);
  }

  function isBlobUrl(url) {
    return /^blob:/i.test(url);
  }

  function isUsableMediaUrl(url) {
    return isHttpUrl(url) && !isBlobUrl(url);
  }

  function isLikelyVideoUrl(url) {
    if (!isUsableMediaUrl(url)) return false;

    try {
      const parsed = new URL(url);
      const pathname = parsed.pathname.toLowerCase();
      const hostname = parsed.hostname.toLowerCase();
      if (/(^|\.)instagram\.com$/i.test(hostname)) return false;

      return /\.(?:m4v|mov|mp4|webm)(?:$|[?#])/i.test(url)
        || pathname.includes('.mp4')
        || (/(^|\.)fbcdn\.net$/i.test(hostname) && /\/v\/t\d+\./i.test(pathname))
        || (/(^|\.)cdninstagram\.com$/i.test(hostname) && /\/v\//i.test(pathname));
    } catch (e) {
      return false;
    }
  }

  function currentInstagramMediaPageUrl() {
    return INSTAGRAM_MEDIA_PATH_PATTERN.test(window.location.pathname) ? window.location.href : '';
  }

  function instagramMediaPageUrlFromHref(href) {
    const url = normalizeUrl(href);
    if (!url) return '';

    try {
      const parsed = new URL(url);
      const isInstagramHost = /(^|\.)instagram\.com$/i.test(parsed.hostname);
      return isInstagramHost && INSTAGRAM_MEDIA_PATH_PATTERN.test(parsed.pathname) ? parsed.href : '';
    } catch (e) {
      return '';
    }
  }

  function instagramMediaPageUrlFromContainer(container) {
    if (!container) return '';

    const links = [...container.querySelectorAll(INSTAGRAM_MEDIA_LINK_SELECTOR)];
    for (const link of links) {
      const url = instagramMediaPageUrlFromHref(link.getAttribute('href'));
      if (url) return url;
    }

    return '';
  }

  function instagramMediaPageUrlFromElement(startElement) {
    let element = startElement;
    let depth = 0;

    while (element && element.nodeType === Node.ELEMENT_NODE && depth <= MAX_ANCESTOR_DEPTH) {
      if (element instanceof HTMLAnchorElement) {
        const url = instagramMediaPageUrlFromHref(element.getAttribute('href'));
        if (url) return url;
      }

      const url = instagramMediaPageUrlFromContainer(element);
      if (url) return url;

      element = element.parentElement;
      depth += 1;
    }

    const containers = [
      startElement.closest('article'),
      startElement.closest('[role="dialog"]'),
      startElement.closest('section')
    ].filter(Boolean);

    for (const container of containers) {
      const url = instagramMediaPageUrlFromContainer(container);
      if (url) return url;
    }

    return currentInstagramMediaPageUrl();
  }

  function videoUrlFromVideo(video) {
    const directUrl = normalizeUrl(video.currentSrc) || normalizeUrl(video.src);
    if (isLikelyVideoUrl(directUrl)) return directUrl;

    const source = [...video.querySelectorAll('source[src]')]
      .map(function (element) {
        return normalizeUrl(element.src);
      })
      .find(isLikelyVideoUrl);

    return source || '';
  }

  function filenameFromMediaUrl(mediaUrl, mediaType) {
    const isVideo = mediaType === 'video';
    const extensionPattern = isVideo
      ? /\.(?:m4v|mov|mp4|webm)\b/i
      : /\.(?:avif|gif|jpe?g|png|webp)\b/i;
    const defaultExtension = isVideo ? '.mp4' : '.jpg';
    const defaultBaseName = isVideo ? 'instagram-video' : 'instagram-image';

    try {
      const url = new URL(mediaUrl);
      const pathname = decodeURIComponent(url.pathname);
      const rawName = pathname.split('/').filter(Boolean).pop() || '';
      const extensionMatch = rawName.match(extensionPattern);
      const extension = extensionMatch ? extensionMatch[0].toLowerCase() : defaultExtension;
      const baseName = rawName
        .replace(extensionPattern, '')
        .replace(/[^a-z0-9._-]+/gi, '-')
        .replace(/^-+|-+$/g, '');

      return `${baseName || defaultBaseName}${extension}`;
    } catch (e) {
      return `${defaultBaseName}${defaultExtension}`;
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

  function decodeHtmlEntities(text) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
  }

  function decodeJsonString(rawValue) {
    try {
      return JSON.parse(`"${rawValue}"`);
    } catch (e) {
      return rawValue
        .replace(/\\\//g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\u003d/g, '=')
        .replace(/\\u003f/g, '?');
    }
  }

  function decodeUriComponentSafely(rawValue) {
    try {
      return decodeURIComponent(rawValue);
    } catch (e) {
      return rawValue;
    }
  }

  function normalizeAbsoluteUrl(rawUrl) {
    if (typeof rawUrl !== 'string') return '';

    const cleaned = decodeHtmlEntities(rawUrl)
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .replace(/\\\//g, '/');

    if (!/^https?:\/\//i.test(cleaned)) return '';

    try {
      return new URL(cleaned).href;
    } catch (e) {
      return '';
    }
  }

  function expandPossibleVideoStrings(rawValue) {
    const initialValues = [
      rawValue,
      decodeHtmlEntities(rawValue),
      rawValue.replace(/\\\//g, '/'),
      decodeHtmlEntities(rawValue).replace(/\\\//g, '/'),
      decodeJsonString(rawValue)
    ];
    const expandedValues = [];
    const seen = new Set();

    function addValue(value) {
      if (typeof value !== 'string' || seen.has(value)) return;
      seen.add(value);
      expandedValues.push(value);
    }

    initialValues.forEach(function (value) {
      addValue(value);
      addValue(decodeUriComponentSafely(value));
      addValue(decodeHtmlEntities(decodeUriComponentSafely(value)));
    });

    return expandedValues;
  }

  function videoUrlFromDashManifest(rawValue) {
    for (const candidate of expandPossibleVideoStrings(rawValue)) {
      const baseUrlMatch = candidate.match(/<BaseURL>([\s\S]*?)<\/BaseURL>/i);
      if (!baseUrlMatch) continue;

      const url = normalizeAbsoluteUrl(baseUrlMatch[1]);
      if (isLikelyVideoUrl(url)) return url;
    }

    return '';
  }

  function normalizePotentialVideoUrl(rawValue) {
    if (typeof rawValue !== 'string') return '';

    const manifestUrl = videoUrlFromDashManifest(rawValue);
    if (manifestUrl) return manifestUrl;

    for (const candidate of expandPossibleVideoStrings(rawValue)) {
      const embeddedUrls = candidate.match(/https?:\/\/[^"'\s<>]+/g) || [];
      for (const embeddedUrl of embeddedUrls) {
        const normalizedEmbeddedUrl = normalizeAbsoluteUrl(embeddedUrl);
        if (isLikelyVideoUrl(normalizedEmbeddedUrl)) return normalizedEmbeddedUrl;
      }

      const directUrl = normalizeAbsoluteUrl(candidate);
      if (isLikelyVideoUrl(directUrl)) return directUrl;
    }

    return '';
  }

  function findVideoUrlInValue(value, state, depth) {
    if (!value || state.nodes > MAX_OBJECT_SEARCH_NODES || depth > MAX_OBJECT_SEARCH_DEPTH) return '';
    state.nodes += 1;

    if (typeof value === 'string') return normalizePotentialVideoUrl(value);
    if (typeof value !== 'object' && typeof value !== 'function') return '';
    if (state.visited.has(value)) return '';

    state.visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        const url = findVideoUrlInValue(item, state, depth + 1);
        if (url) return url;
      }
      return '';
    }

    const keys = Object.keys(value);
    const priorityKeys = keys.filter(function (key) {
      return VIDEO_URL_KEY_PATTERN.test(key);
    });
    const remainingKeys = keys.filter(function (key) {
      return !VIDEO_URL_KEY_PATTERN.test(key);
    });

    for (const key of priorityKeys.concat(remainingKeys)) {
      let nestedValue;
      try {
        nestedValue = value[key];
      } catch (e) {
        continue;
      }

      const url = findVideoUrlInValue(nestedValue, state, depth + 1);
      if (url) return url;
    }

    return '';
  }

  function findVideoUrlInElementData(element) {
    const state = {
      visited: new WeakSet(),
      nodes: 0
    };

    for (const key of Object.keys(element)) {
      if (!/react|fiber|props|inst|internal/i.test(key)) continue;

      let value;
      try {
        value = element[key];
      } catch (e) {
        continue;
      }

      const url = findVideoUrlInValue(value, state, 0);
      if (url) return url;
    }

    return '';
  }

  function videoUrlFromAttachedPageData(startElement) {
    const elements = [];
    let element = startElement;
    let depth = 0;

    while (element && element.nodeType === Node.ELEMENT_NODE && depth <= MAX_ANCESTOR_DEPTH) {
      elements.push(element);
      element = element.parentElement;
      depth += 1;
    }

    for (const candidate of elements) {
      const url = findVideoUrlInElementData(candidate);
      if (url) return url;
    }

    return '';
  }

  function videoUrlFromPerformanceEntries() {
    if (!window.performance || typeof window.performance.getEntriesByType !== 'function') return '';

    const entries = window.performance.getEntriesByType('resource').slice().reverse();
    for (const entry of entries) {
      const url = normalizePotentialVideoUrl(entry.name);
      if (url) return url;
    }

    return '';
  }

  function videoUrlFromPageGlobals() {
    const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    const globalNames = [
      '_sharedData',
      '__additionalData',
      '__initialData',
      '__data',
      '__INSTAGRAM_DATA__'
    ];
    const state = {
      visited: new WeakSet(),
      nodes: 0
    };

    for (const name of globalNames) {
      let value;
      try {
        value = pageWindow[name];
      } catch (e) {
        continue;
      }

      const url = findVideoUrlInValue(value, state, 0);
      if (url) return url;
    }

    return '';
  }

  function videoUrlFromDocumentScripts() {
    const scripts = [...document.scripts].slice().reverse();
    for (const script of scripts) {
      const url = extractVideoUrlFromHtml(script.textContent || '');
      if (url) return url;
    }

    return '';
  }

  function extractVideoUrlFromHtml(html) {
    const decodedHtml = decodeHtmlEntities(html);
    const doc = new DOMParser().parseFromString(decodedHtml, 'text/html');
    const metaVideo = doc.querySelector([
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[property="og:video:secure_url"]',
      'meta[name="twitter:player:stream"]'
    ].join(','));
    const metaUrl = metaVideo ? normalizePotentialVideoUrl(metaVideo.getAttribute('content')) : '';
    if (metaUrl) return metaUrl;

    const patterns = [
      /"video_url"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"playable_url_quality_hd"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"playable_url"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"contentUrl"\s*:\s*"((?:\\.|[^"\\])+)"/
    ];

    for (const pattern of patterns) {
      const match = decodedHtml.match(pattern);
      if (!match) continue;

      const url = normalizePotentialVideoUrl(decodeJsonString(match[1]));
      if (url) return url;
    }

    return '';
  }

  function getText(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'text',
          onload: function (response) {
            if (response.status >= 200 && response.status < 300 && response.responseText) {
              resolve(response.responseText);
            } else {
              reject(new Error(`Page request failed with status ${response.status}`));
            }
          },
          onerror: function () {
            reject(new Error('Page request failed'));
          }
        });
      });
    }

    return fetch(url, { credentials: 'include' }).then(function (response) {
      if (!response.ok) throw new Error(`Page request failed with status ${response.status}`);
      return response.text();
    });
  }

  function resolveVideoMediaUrl(media) {
    if (media.url && isLikelyVideoUrl(media.url)) return Promise.resolve(media.url);
    if (media.videoElement) {
      const attachedUrl = videoUrlFromAttachedPageData(media.videoElement);
      if (attachedUrl) {
        media.url = attachedUrl;
        media.filename = filenameFromMediaUrl(attachedUrl, media.type);
        return Promise.resolve(attachedUrl);
      }
    }

    const performanceUrl = videoUrlFromPerformanceEntries();
    if (performanceUrl) {
      media.url = performanceUrl;
      media.filename = filenameFromMediaUrl(performanceUrl, media.type);
      return Promise.resolve(performanceUrl);
    }

    const globalUrl = videoUrlFromPageGlobals();
    if (globalUrl) {
      media.url = globalUrl;
      media.filename = filenameFromMediaUrl(globalUrl, media.type);
      return Promise.resolve(globalUrl);
    }

    const scriptUrl = videoUrlFromDocumentScripts();
    if (scriptUrl) {
      media.url = scriptUrl;
      media.filename = filenameFromMediaUrl(scriptUrl, media.type);
      return Promise.resolve(scriptUrl);
    }

    if (!media.pageUrl) return Promise.resolve('');

    if (media.resolvedUrlPromise) return media.resolvedUrlPromise;

    media.resolvedUrlPromise = getText(media.pageUrl)
      .then(extractVideoUrlFromHtml)
      .then(function (videoUrl) {
        media.url = videoUrl;
        media.filename = filenameFromMediaUrl(videoUrl, media.type);
        return videoUrl;
      })
      .catch(function (error) {
        console.warn('Instagram View Image in New Tab: could not resolve video URL.', error);
        return '';
      });

    return media.resolvedUrlPromise;
  }

  function resolveActiveMediaUrl(media) {
    if (!media) return Promise.resolve('');
    if (media.type === 'video') return resolveVideoMediaUrl(media);
    return Promise.resolve(media.url);
  }

  function handleMissingMediaUrl(media) {
    const mediaLabel = media && media.type === 'video' ? 'video' : 'media';
    window.alert(`Could not find a downloadable ${mediaLabel} URL for this Instagram item.`);
  }

  function rectContainsPoint(element, x, y) {
    const rect = element.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function mediaFromUrl(url, type, pageUrl) {
    return url || pageUrl ? { url, type, pageUrl: pageUrl || '' } : null;
  }

  function mediaFromVideo(video) {
    const videoUrl = videoUrlFromVideo(video);
    const pageUrl = instagramMediaPageUrlFromElement(video);
    return {
      url: videoUrl,
      type: 'video',
      pageUrl,
      videoElement: video
    };
  }

  function mediaFromDescendant(element, x, y) {
    const videos = [...element.querySelectorAll('video')];
    const video = videos.find(function (candidate) {
      return rectContainsPoint(candidate, x, y);
    });
    if (video) {
      const videoMedia = mediaFromVideo(video);
      if (videoMedia) return videoMedia;
    }

    const images = [...element.querySelectorAll('img[src], img[srcset]')];
    const image = images.find(function (img) {
      return rectContainsPoint(img, x, y);
    });

    return image ? mediaFromUrl(imageUrlFromImg(image), 'image') : null;
  }

  function mediaNearElement(startElement, x, y) {
    let element = startElement;
    let depth = 0;

    while (element && element.nodeType === Node.ELEMENT_NODE && depth <= MAX_ANCESTOR_DEPTH) {
      if (element instanceof HTMLVideoElement) {
        const videoMedia = mediaFromVideo(element);
        if (videoMedia) return videoMedia;
      }

      if (element instanceof HTMLImageElement) {
        const imgUrl = imageUrlFromImg(element);
        if (imgUrl) return mediaFromUrl(imgUrl, 'image');
      }

      const descendantMedia = mediaFromDescendant(element, x, y);
      if (descendantMedia) return descendantMedia;

      const bgUrl = backgroundUrlFromElement(element);
      if (bgUrl) return mediaFromUrl(bgUrl, 'image');

      element = element.parentElement;
      depth += 1;
    }

    return null;
  }

  function findMediaAtPoint(x, y) {
    const elements = document.elementsFromPoint(x, y);

    for (const element of elements) {
      const media = mediaNearElement(element, x, y);
      if (media) return media;
    }

    return null;
  }

  function ensureMenu() {
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = MENU_ID;
    menu.innerHTML = `
      <button type="button" data-action="open"></button>
      <button type="button" data-action="save"></button>
      <button type="button" data-action="copy"></button>
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

  function setMenuLabels(mediaType) {
    const isVideo = mediaType === 'video';
    const openLabel = isVideo ? 'View Video in New Tab' : 'View Image in New Tab';
    const saveLabel = isVideo ? 'Save Video' : 'Save Image';
    const copyLabel = isVideo ? 'Copy Video URL' : 'Copy Image';

    menu.querySelector('[data-action="open"]').textContent = openLabel;
    menu.querySelector('[data-action="save"]').textContent = saveLabel;
    menu.querySelector('[data-action="copy"]').textContent = copyLabel;
  }

  function showMenu(x, y, media) {
    activeMedia = {
      url: media.url,
      type: media.type,
      pageUrl: media.pageUrl || '',
      videoElement: media.videoElement || null,
      filename: filenameFromMediaUrl(media.url, media.type)
    };

    const currentMenu = ensureMenu();
    setMenuLabels(media.type);
    currentMenu.style.display = 'block';

    const menuRect = currentMenu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - menuRect.width - 8);
    const top = Math.min(y, window.innerHeight - menuRect.height - 8);

    currentMenu.style.left = `${Math.max(8, left)}px`;
    currentMenu.style.top = `${Math.max(8, top)}px`;
  }

  function hideMenu() {
    activeMedia = null;
    if (menu) menu.style.display = 'none';
  }

  function handleMenuClick(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    if (button.dataset.action === 'open') {
      openActiveMedia();
    } else if (button.dataset.action === 'save') {
      saveActiveMedia();
    } else if (button.dataset.action === 'copy') {
      copyActiveMedia();
    }
  }

  function openActiveMedia() {
    const media = activeMedia;
    hideMenu();

    resolveActiveMediaUrl(media).then(function (mediaUrl) {
      if (!mediaUrl) {
        handleMissingMediaUrl(media);
        return;
      }

      if (typeof GM_openInTab === 'function') {
        GM_openInTab(mediaUrl, { active: true, insert: true });
      } else {
        window.open(mediaUrl, '_blank', 'noopener');
      }
    });
  }

  function saveActiveMedia() {
    const media = activeMedia;
    hideMenu();

    resolveActiveMediaUrl(media).then(function (mediaUrl) {
      if (!media || !mediaUrl) {
        handleMissingMediaUrl(media);
        return;
      }

      if (typeof GM_download === 'function') {
        GM_download({
          url: mediaUrl,
          name: media.filename,
          saveAs: true
        });
        return;
      }

      const link = document.createElement('a');
      link.href = mediaUrl;
      link.download = media.filename;
      link.rel = 'noopener';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
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
    console.warn('Instagram View Image in New Tab: could not copy media URL fallback.', error);
  }

  function copyMediaUrlFallback(mediaUrl) {
    return copyTextToClipboard(mediaUrl).catch(handleCopyTextFailure);
  }

  function copyActiveMedia() {
    const media = activeMedia;
    hideMenu();

    if (!media) return;

    if (media.type === 'video') {
      resolveActiveMediaUrl(media).then(function (mediaUrl) {
        if (mediaUrl) {
          copyMediaUrlFallback(mediaUrl);
        } else {
          handleMissingMediaUrl(media);
        }
      });
      return;
    }

    if (!media.url) return;

    if (!navigator.clipboard || typeof navigator.clipboard.write !== 'function' || typeof ClipboardItem !== 'function') {
      copyMediaUrlFallback(media.url);
      return;
    }

    getImageBlob(media.url)
      .then(imageBlobToPngBlob)
      .then(function (pngBlob) {
        return navigator.clipboard.write([
          new ClipboardItem({
            'image/png': pngBlob
          })
        ]);
      })
      .catch(function () {
        copyMediaUrlFallback(media.url);
      });
  }

  document.addEventListener('contextmenu', function (event) {
    if (menu && menu.contains(event.target)) return;

    const media = findMediaAtPoint(event.clientX, event.clientY);
    if (!media) {
      hideMenu();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    showMenu(event.clientX, event.clientY, media);
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
