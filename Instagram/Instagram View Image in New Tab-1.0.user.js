// ==UserScript==
// @name         Instagram View Image in New Tab
// @namespace    https://github.com/brucehart/userscripts
// @version      1.8
// @description  Add right-click menu items on Instagram images and videos to open, save, or copy the real media.
// @author       Bruce J. Hart
// @match        https://www.instagram.com/*
// @match        https://instagram.com/*
// @run-at       document-idle
// @require      https://unpkg.com/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js
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
  const STATUS_ID = 'tm-instagram-view-image-status';
  const MAX_ANCESTOR_DEPTH = 8;
  const INSTAGRAM_MEDIA_PATH_PATTERN = /^\/(?:p|reel|reels|tv)\/[^/?#]+\/?/i;
  const INSTAGRAM_MEDIA_LINK_SELECTOR = 'a[href^="/p/"], a[href^="/reel/"], a[href^="/reels/"], a[href^="/tv/"]';
  const DASH_MANIFEST_KEY_PATTERN = /dash_manifest/i;
  const VIDEO_URL_KEY_PATTERN = /^(?:video_url|playable_url|playable_url_quality_hd|dash_manifest|video_dash_manifest|contentUrl|src|url)$/i;
  const MAX_OBJECT_SEARCH_DEPTH = 12;
  const MAX_OBJECT_SEARCH_NODES = 8000;
  const FFMPEG_CORE_URL = 'https://unpkg.com/@ffmpeg/core-st@0.11.1/dist/ffmpeg-core.js';
  let activeMedia = null;
  let menu = null;
  let statusBox = null;
  let ffmpegInstance = null;
  let ffmpegLoadPromise = null;
  let muxQueue = Promise.resolve();

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

  function createVideoDetails(videoUrl, audioUrl) {
    return {
      videoUrl: videoUrl || '',
      audioUrl: audioUrl || ''
    };
  }

  function hasVideoDetails(details) {
    return Boolean(details && details.videoUrl);
  }

  function hasSeparateAudio(details) {
    return Boolean(details && details.videoUrl && details.audioUrl && details.videoUrl !== details.audioUrl);
  }

  function videoDetailsFromUrl(url) {
    return createVideoDetails(url, '');
  }

  function mediaUrlFingerprint(url) {
    const normalizedUrl = normalizeAbsoluteUrl(url) || normalizeUrl(url);
    if (!normalizedUrl) return '';

    try {
      const parsed = new URL(normalizedUrl);
      return decodeURIComponent(parsed.pathname)
        .toLowerCase()
        .replace(/\/+$/g, '');
    } catch (e) {
      return '';
    }
  }

  function sameMediaUrl(leftUrl, rightUrl) {
    const leftFingerprint = mediaUrlFingerprint(leftUrl);
    const rightFingerprint = mediaUrlFingerprint(rightUrl);
    return Boolean(leftFingerprint && rightFingerprint && leftFingerprint === rightFingerprint);
  }

  function selectVideoDetails(candidates, preferredVideoUrl, requirePreferredMatch) {
    const seen = new Set();
    const uniqueCandidates = candidates.filter(function (details) {
      if (!hasVideoDetails(details)) return false;

      const key = `${details.videoUrl}\n${details.audioUrl || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (preferredVideoUrl) {
      const matchingCandidates = uniqueCandidates.filter(function (details) {
        return sameMediaUrl(details.videoUrl, preferredVideoUrl);
      });
      const matchingSeparateAudio = matchingCandidates.find(hasSeparateAudio);
      if (matchingSeparateAudio) return matchingSeparateAudio;
      if (matchingCandidates[0]) return matchingCandidates[0];
      if (requirePreferredMatch) return createVideoDetails('', '');
    }

    return uniqueCandidates.find(hasSeparateAudio) || uniqueCandidates[0] || createVideoDetails('', '');
  }

  function keySearchPriority(key) {
    if (DASH_MANIFEST_KEY_PATTERN.test(key)) return 0;
    if (/^(?:video_url|playable_url_quality_hd|playable_url|contentUrl)$/i.test(key)) return 1;
    if (/^(?:src|url)$/i.test(key)) return 2;
    return 3;
  }

  function numericAttribute(element, names) {
    for (const name of names) {
      const value = parseFloat(element.getAttribute(name) || '');
      if (Number.isFinite(value)) return value;
    }

    return 0;
  }

  function childElementsByName(element, localName) {
    const normalizedName = localName.toLowerCase();
    return [...element.children].filter(function (child) {
      return child.localName && child.localName.toLowerCase() === normalizedName;
    });
  }

  function firstChildTextByName(element, localName) {
    const child = childElementsByName(element, localName)[0];
    return child ? child.textContent || '' : '';
  }

  function dashAdaptationType(adaptationSet, representation) {
    const combinedAttributes = [
      adaptationSet.getAttribute('contentType'),
      adaptationSet.getAttribute('mimeType'),
      adaptationSet.getAttribute('codecs'),
      representation && representation.getAttribute('mimeType'),
      representation && representation.getAttribute('codecs')
    ].filter(Boolean).join(' ').toLowerCase();

    if (/audio|mp4a|opus|vorbis/.test(combinedAttributes)) return 'audio';
    if (/video|avc|hev|hvc|vp9|h26[45]/.test(combinedAttributes)) return 'video';
    return '';
  }

  function dashRepresentationScore(adaptationSet, representation, type) {
    const bandwidth = numericAttribute(representation, ['bandwidth'])
      || numericAttribute(adaptationSet, ['bandwidth']);

    if (type === 'audio') return bandwidth;

    const width = numericAttribute(representation, ['width']) || numericAttribute(adaptationSet, ['width']);
    const height = numericAttribute(representation, ['height']) || numericAttribute(adaptationSet, ['height']);
    return (height * 100000000) + (width * 100000) + bandwidth;
  }

  function bestDashBaseUrlsFromDocument(doc) {
    const parserError = doc.querySelector('parsererror');
    if (parserError) return createVideoDetails('', '');

    const best = {
      video: { url: '', score: -1 },
      audio: { url: '', score: -1 }
    };
    const adaptationSets = [...doc.getElementsByTagName('*')].filter(function (element) {
      return element.localName && element.localName.toLowerCase() === 'adaptationset';
    });

    for (const adaptationSet of adaptationSets) {
      let representations = childElementsByName(adaptationSet, 'Representation');
      if (!representations.length) representations = [adaptationSet];

      for (const representation of representations) {
        const type = dashAdaptationType(adaptationSet, representation);
        if (type !== 'video' && type !== 'audio') continue;

        const baseUrl = normalizeAbsoluteUrl(
          firstChildTextByName(representation, 'BaseURL')
          || firstChildTextByName(adaptationSet, 'BaseURL')
        );
        if (!baseUrl) continue;

        const score = dashRepresentationScore(adaptationSet, representation, type);
        if (score > best[type].score) {
          best[type] = { url: baseUrl, score };
        }
      }
    }

    return createVideoDetails(best.video.url, best.audio.url);
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

  function escapeBareXmlAmpersands(text) {
    return text.replace(/&(?!#\d+;|#x[0-9a-f]+;|[a-z][a-z0-9_.:-]*;)/gi, '&amp;');
  }

  function dashManifestTextCandidates(rawValue) {
    const candidates = [];
    const seen = new Set();

    function add(value) {
      if (typeof value !== 'string' || seen.has(value)) return;
      seen.add(value);
      candidates.push(value);
    }

    add(rawValue);
    add(decodeHtmlEntities(rawValue));

    return candidates;
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

  function videoDetailsFromDashManifest(rawValue) {
    for (const candidate of expandPossibleVideoStrings(rawValue)) {
      for (const manifestText of dashManifestTextCandidates(candidate)) {
        if (!/<BaseURL\b/i.test(manifestText)) continue;

        const safeManifestText = escapeBareXmlAmpersands(manifestText);
        const doc = new DOMParser().parseFromString(safeManifestText, 'application/xml');
        const details = bestDashBaseUrlsFromDocument(doc);
        if (hasVideoDetails(details)) return details;
      }

      const fallbackText = decodeHtmlEntities(candidate);
      const baseUrlMatch = fallbackText.match(/<BaseURL[^>]*>([\s\S]*?)<\/BaseURL>/i);
      if (!baseUrlMatch) continue;

      const url = normalizeAbsoluteUrl(baseUrlMatch[1]);
      if (isLikelyVideoUrl(url)) return videoDetailsFromUrl(url);
    }

    return createVideoDetails('', '');
  }

  function videoUrlFromDashManifest(rawValue) {
    return videoDetailsFromDashManifest(rawValue).videoUrl;
  }

  function normalizePotentialVideoDetails(rawValue) {
    if (typeof rawValue !== 'string') return createVideoDetails('', '');

    const manifestDetails = videoDetailsFromDashManifest(rawValue);
    if (hasVideoDetails(manifestDetails)) return manifestDetails;

    return videoDetailsFromUrl(normalizePotentialVideoUrl(rawValue));
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

  function collectVideoDetailsInValue(value, state, depth, candidates) {
    if (!value || state.nodes > MAX_OBJECT_SEARCH_NODES || depth > MAX_OBJECT_SEARCH_DEPTH) return;
    state.nodes += 1;

    if (typeof value === 'string') {
      const details = normalizePotentialVideoDetails(value);
      if (hasVideoDetails(details)) candidates.push(details);
      return;
    }
    if (typeof value !== 'object' && typeof value !== 'function') return;
    if (state.visited.has(value)) return;

    state.visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        collectVideoDetailsInValue(item, state, depth + 1, candidates);
      }
      return;
    }

    const keys = Object.keys(value).sort(function (left, right) {
      const priorityDelta = keySearchPriority(left) - keySearchPriority(right);
      return priorityDelta || 0;
    });

    for (const key of keys) {
      let nestedValue;
      try {
        nestedValue = value[key];
      } catch (e) {
        continue;
      }

      if (
        keySearchPriority(key) > 2
        && !VIDEO_URL_KEY_PATTERN.test(key)
        && (nestedValue === null || (typeof nestedValue !== 'object' && typeof nestedValue !== 'function'))
      ) {
        continue;
      }

      collectVideoDetailsInValue(nestedValue, state, depth + 1, candidates);
    }
  }

  function videoDetailsFromAttachedPageData(startElement, preferredVideoUrl) {
    const state = {
      visited: new WeakSet(),
      nodes: 0
    };
    const candidates = [];
    const elements = [];
    let element = startElement;
    let depth = 0;

    while (element && element.nodeType === Node.ELEMENT_NODE && depth <= MAX_ANCESTOR_DEPTH) {
      elements.push(element);
      element = element.parentElement;
      depth += 1;
    }

    for (const candidate of elements) {
      for (const key of Object.keys(candidate)) {
        if (!/react|fiber|props|inst|internal/i.test(key)) continue;

        let value;
        try {
          value = candidate[key];
        } catch (e) {
          continue;
        }

        collectVideoDetailsInValue(value, state, 0, candidates);
      }
    }

    return selectVideoDetails(candidates, preferredVideoUrl, false);
  }

  function videoDetailsFromPerformanceEntries(preferredVideoUrl, requirePreferredMatch) {
    if (!window.performance || typeof window.performance.getEntriesByType !== 'function') {
      return createVideoDetails('', '');
    }

    const entries = window.performance.getEntriesByType('resource').slice().reverse();
    const candidates = [];
    for (const entry of entries) {
      const url = normalizePotentialVideoUrl(entry.name);
      if (url) candidates.push(videoDetailsFromUrl(url));
    }

    return selectVideoDetails(candidates, preferredVideoUrl, requirePreferredMatch);
  }

  function videoDetailsFromPageGlobals(preferredVideoUrl, requirePreferredMatch) {
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
    const candidates = [];

    for (const name of globalNames) {
      let value;
      try {
        value = pageWindow[name];
      } catch (e) {
        continue;
      }

      collectVideoDetailsInValue(value, state, 0, candidates);
    }

    return selectVideoDetails(candidates, preferredVideoUrl, requirePreferredMatch);
  }

  function videoDetailsFromDocumentScripts(preferredVideoUrl, requirePreferredMatch) {
    const scripts = [...document.scripts].slice().reverse();
    const candidates = [];
    for (const script of scripts) {
      candidates.push(...extractVideoDetailsCandidatesFromHtml(script.textContent || ''));
    }

    return selectVideoDetails(candidates, preferredVideoUrl, requirePreferredMatch);
  }

  function extractVideoDetailsCandidatesFromHtml(html) {
    const decodedHtml = decodeHtmlEntities(html);
    const candidates = [];
    const patterns = [
      /"dash_manifest"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"video_dash_manifest"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"video_url"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"playable_url_quality_hd"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"playable_url"\s*:\s*"((?:\\.|[^"\\])+)"/,
      /"contentUrl"\s*:\s*"((?:\\.|[^"\\])+)"/
    ];

    for (const pattern of patterns) {
      const match = decodedHtml.match(pattern);
      if (!match) continue;

      const details = normalizePotentialVideoDetails(decodeJsonString(match[1]));
      if (hasVideoDetails(details)) candidates.push(details);
    }

    const doc = new DOMParser().parseFromString(decodedHtml, 'text/html');
    const metaVideo = doc.querySelector([
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[property="og:video:secure_url"]',
      'meta[name="twitter:player:stream"]'
    ].join(','));
    const metaUrl = metaVideo ? normalizePotentialVideoUrl(metaVideo.getAttribute('content')) : '';
    if (metaUrl) candidates.push(videoDetailsFromUrl(metaUrl));

    return candidates;
  }

  function extractVideoDetailsFromHtml(html, preferredVideoUrl, requirePreferredMatch) {
    return selectVideoDetails(
      extractVideoDetailsCandidatesFromHtml(html),
      preferredVideoUrl,
      requirePreferredMatch
    );
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

  function applyVideoDetailsToMedia(media, details) {
    if (!media || !hasVideoDetails(details)) return media;

    media.videoUrl = details.videoUrl;
    media.audioUrl = details.audioUrl || '';
    media.url = details.videoUrl;
    media.needsMuxing = hasSeparateAudio(details);
    media.filename = filenameFromMediaUrl(details.videoUrl, media.type);
    return media;
  }

  function directVideoDetailsFromMedia(media) {
    const url = normalizePotentialVideoUrl(media && (media.videoUrl || media.url));
    return url ? videoDetailsFromUrl(url) : createVideoDetails('', '');
  }

  function resolveVideoMedia(media) {
    if (!media) return Promise.resolve(null);
    if (media.needsMuxing && media.videoUrl && media.audioUrl) return Promise.resolve(media);

    const preferredDetails = directVideoDetailsFromMedia(media);
    const preferredVideoUrl = preferredDetails.videoUrl || '';
    const requirePreferredMatch = Boolean(preferredVideoUrl);
    let fallbackDetails = createVideoDetails('', '');
    function rememberFallback(details) {
      if (hasVideoDetails(details) && !hasVideoDetails(fallbackDetails)) {
        fallbackDetails = details;
      }
      return hasSeparateAudio(details);
    }

    if (media.videoElement) {
      const attachedDetails = videoDetailsFromAttachedPageData(media.videoElement, preferredVideoUrl);
      if (rememberFallback(attachedDetails)) {
        return Promise.resolve(applyVideoDetailsToMedia(media, attachedDetails));
      }
    }

    if (media.pageUrl) {
      if (media.resolvedMediaPromise) return media.resolvedMediaPromise;

      media.resolvedMediaPromise = getText(media.pageUrl)
        .then(function (html) {
          return extractVideoDetailsFromHtml(html, preferredVideoUrl, requirePreferredMatch);
        })
        .then(function (details) {
          if (hasVideoDetails(details)) return applyVideoDetailsToMedia(media, details);

          if (hasVideoDetails(fallbackDetails)) return applyVideoDetailsToMedia(media, fallbackDetails);

          if (hasVideoDetails(preferredDetails)) return applyVideoDetailsToMedia(media, preferredDetails);

          const scriptDetails = videoDetailsFromDocumentScripts(preferredVideoUrl, requirePreferredMatch);
          if (hasVideoDetails(scriptDetails)) return applyVideoDetailsToMedia(media, scriptDetails);

          const globalDetails = videoDetailsFromPageGlobals(preferredVideoUrl, requirePreferredMatch);
          if (hasVideoDetails(globalDetails)) return applyVideoDetailsToMedia(media, globalDetails);

          const performanceDetails = videoDetailsFromPerformanceEntries(preferredVideoUrl, requirePreferredMatch);
          if (hasVideoDetails(performanceDetails)) return applyVideoDetailsToMedia(media, performanceDetails);

          return media;
        })
        .catch(function (error) {
          console.warn('Instagram View Image in New Tab: could not resolve video URL.', error);

          if (hasVideoDetails(fallbackDetails)) return applyVideoDetailsToMedia(media, fallbackDetails);

          if (hasVideoDetails(preferredDetails)) return applyVideoDetailsToMedia(media, preferredDetails);

          const scriptDetails = videoDetailsFromDocumentScripts(preferredVideoUrl, requirePreferredMatch);
          if (hasVideoDetails(scriptDetails)) return applyVideoDetailsToMedia(media, scriptDetails);

          const globalDetails = videoDetailsFromPageGlobals(preferredVideoUrl, requirePreferredMatch);
          if (hasVideoDetails(globalDetails)) return applyVideoDetailsToMedia(media, globalDetails);

          const performanceDetails = videoDetailsFromPerformanceEntries(preferredVideoUrl, requirePreferredMatch);
          if (hasVideoDetails(performanceDetails)) return applyVideoDetailsToMedia(media, performanceDetails);

          return media;
        });

      return media.resolvedMediaPromise;
    }

    if (hasVideoDetails(fallbackDetails)) {
      return Promise.resolve(applyVideoDetailsToMedia(media, fallbackDetails));
    }

    if (hasVideoDetails(preferredDetails)) {
      return Promise.resolve(applyVideoDetailsToMedia(media, preferredDetails));
    }

    const scriptDetails = videoDetailsFromDocumentScripts(preferredVideoUrl, requirePreferredMatch);
    if (hasVideoDetails(scriptDetails)) {
      return Promise.resolve(applyVideoDetailsToMedia(media, scriptDetails));
    }

    const globalDetails = videoDetailsFromPageGlobals(preferredVideoUrl, requirePreferredMatch);
    if (hasVideoDetails(globalDetails)) {
      return Promise.resolve(applyVideoDetailsToMedia(media, globalDetails));
    }

    const performanceDetails = videoDetailsFromPerformanceEntries(preferredVideoUrl, requirePreferredMatch);
    if (hasVideoDetails(performanceDetails)) {
      return Promise.resolve(applyVideoDetailsToMedia(media, performanceDetails));
    }

    return Promise.resolve(media);
  }

  function resolveVideoMediaUrl(media) {
    return resolveVideoMedia(media).then(function (resolvedMedia) {
      return resolvedMedia ? resolvedMedia.videoUrl || resolvedMedia.url || '' : '';
    });
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
      videoUrl,
      audioUrl: '',
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
      videoUrl: media.videoUrl || media.url,
      audioUrl: media.audioUrl || '',
      type: media.type,
      pageUrl: media.pageUrl || '',
      videoElement: media.videoElement || null,
      needsMuxing: hasSeparateAudio(media),
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

  function ensureStatusBox() {
    if (statusBox) return statusBox;

    statusBox = document.createElement('div');
    statusBox.id = STATUS_ID;
    statusBox.innerHTML = `
      <div data-role="message"></div>
      <div data-role="detail"></div>
    `;
    document.body.appendChild(statusBox);

    const style = document.createElement('style');
    style.textContent = `
      #${STATUS_ID} {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 2147483647;
        display: none;
        max-width: min(360px, calc(100vw - 32px));
        padding: 10px 12px;
        background: #111;
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
        color: #fff;
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }

      #${STATUS_ID} [data-role="message"] {
        font-weight: 600;
      }

      #${STATUS_ID} [data-role="detail"] {
        margin-top: 2px;
        color: rgba(255, 255, 255, 0.72);
      }
    `;
    document.head.appendChild(style);

    return statusBox;
  }

  function showStatus(message, detail) {
    const box = ensureStatusBox();
    box.querySelector('[data-role="message"]').textContent = message || '';
    box.querySelector('[data-role="detail"]').textContent = detail || '';
    box.style.display = 'block';
  }

  function hideStatus() {
    if (statusBox) statusBox.style.display = 'none';
  }

  function formatPercent(value) {
    if (!Number.isFinite(value) || value <= 0) return '';
    return `${Math.min(100, Math.max(0, Math.round(value * 100)))}%`;
  }

  function progressDetail(event) {
    if (!event || !event.lengthComputable || !event.total) return '';
    return formatPercent(event.loaded / event.total);
  }

  function openUrlInTab(url) {
    if (typeof GM_openInTab === 'function') {
      GM_openInTab(url, { active: true, insert: true });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  }

  function saveBlob(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(objectUrl);
    }, 30000);
  }

  function getFfmpegLibrary() {
    const pageWindow = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
    return globalThis.FFmpeg || window.FFmpeg || pageWindow.FFmpeg || null;
  }

  function ensureFfmpeg() {
    const ffmpegLibrary = getFfmpegLibrary();
    if (!ffmpegLibrary || typeof ffmpegLibrary.createFFmpeg !== 'function') {
      return Promise.reject(new Error('ffmpeg.wasm did not load'));
    }

    if (!ffmpegInstance) {
      ffmpegInstance = ffmpegLibrary.createFFmpeg({
        log: false,
        corePath: FFMPEG_CORE_URL,
        progress: function (progress) {
          const percent = progress && Number.isFinite(progress.ratio) ? formatPercent(progress.ratio) : '';
          showStatus('Merging video and audio...', percent);
        }
      });
    }

    if (ffmpegInstance.isLoaded()) return Promise.resolve(ffmpegInstance);
    if (ffmpegLoadPromise) return ffmpegLoadPromise;

    showStatus('Loading video merger...', 'This can take a moment the first time.');
    ffmpegLoadPromise = ffmpegInstance.load()
      .then(function () {
        return ffmpegInstance;
      })
      .catch(function (error) {
        ffmpegLoadPromise = null;
        throw error;
      });

    return ffmpegLoadPromise;
  }

  function getBinary(url, label) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest({
          method: 'GET',
          url,
          responseType: 'arraybuffer',
          onprogress: function (event) {
            showStatus(`Downloading ${label}...`, progressDetail(event));
          },
          onload: function (response) {
            if (response.status >= 200 && response.status < 300 && response.response) {
              resolve(new Uint8Array(response.response));
            } else {
              reject(new Error(`${label} request failed with status ${response.status}`));
            }
          },
          onerror: function () {
            reject(new Error(`${label} request failed`));
          }
        });
      });
    }

    showStatus(`Downloading ${label}...`, '');
    return fetch(url, { credentials: 'omit' }).then(function (response) {
      if (!response.ok) throw new Error(`${label} request failed with status ${response.status}`);
      return response.arrayBuffer();
    }).then(function (buffer) {
      return new Uint8Array(buffer);
    });
  }

  function removeFfmpegFile(ffmpeg, filename) {
    try {
      ffmpeg.FS('unlink', filename);
    } catch (e) {
      // Missing cleanup files are harmless.
    }
  }

  function muxVideoMediaNow(media) {
    if (!media || !media.videoUrl || !media.audioUrl) {
      return Promise.reject(new Error('Missing separate video or audio stream'));
    }

    const id = `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
    const videoInput = `instagram-video-${id}.mp4`;
    const audioInput = `instagram-audio-${id}.m4a`;
    const output = `instagram-merged-${id}.mp4`;
    let ffmpegForCleanup = null;

    return ensureFfmpeg()
      .then(function (ffmpeg) {
        ffmpegForCleanup = ffmpeg;
        return getBinary(media.videoUrl, 'video stream')
          .then(function (videoBytes) {
            return getBinary(media.audioUrl, 'audio stream').then(function (audioBytes) {
              return { ffmpeg, videoBytes, audioBytes };
            });
          });
      })
      .then(function (payload) {
        const ffmpeg = payload.ffmpeg;
        showStatus('Preparing video and audio...', '');
        ffmpeg.FS('writeFile', videoInput, payload.videoBytes);
        ffmpeg.FS('writeFile', audioInput, payload.audioBytes);
        showStatus('Merging video and audio...', '');

        return ffmpeg.run(
          '-i', videoInput,
          '-i', audioInput,
          '-map', '0:v:0',
          '-map', '1:a:0',
          '-c', 'copy',
          '-shortest',
          '-movflags', '+faststart',
          output
        ).then(function () {
          const mergedBytes = ffmpeg.FS('readFile', output);
          return new Blob([mergedBytes], { type: 'video/mp4' });
        });
      })
      .finally(function () {
        if (!ffmpegForCleanup) return;
        removeFfmpegFile(ffmpegForCleanup, videoInput);
        removeFfmpegFile(ffmpegForCleanup, audioInput);
        removeFfmpegFile(ffmpegForCleanup, output);
      });
  }

  function muxVideoMedia(media) {
    const run = muxQueue.catch(function () {}).then(function () {
      return muxVideoMediaNow(media);
    });
    muxQueue = run.catch(function () {});
    return run;
  }

  function handleMuxFailure(error, media) {
    console.warn('Instagram View Image in New Tab: could not merge video and audio.', error);
    hideStatus();

    if (media && media.videoUrl) {
      window.alert('Found separate Instagram video and audio streams, but could not merge them in this browser. Falling back to the video-only stream.');
      return media.videoUrl;
    }

    window.alert('Found separate Instagram video and audio streams, but could not merge them in this browser.');
    return '';
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

    if (!media || media.type !== 'video') {
      resolveActiveMediaUrl(media).then(function (mediaUrl) {
        if (!mediaUrl) {
          handleMissingMediaUrl(media);
          return;
        }

        openUrlInTab(mediaUrl);
      });
      return;
    }

    resolveVideoMedia(media).then(function (resolvedMedia) {
      const mediaUrl = resolvedMedia && (resolvedMedia.videoUrl || resolvedMedia.url);
      if (!mediaUrl) {
        handleMissingMediaUrl(media);
        return;
      }

      if (!hasSeparateAudio(resolvedMedia)) {
        openUrlInTab(mediaUrl);
        return;
      }

      muxVideoMedia(resolvedMedia)
        .then(function (blob) {
          hideStatus();
          openUrlInTab(URL.createObjectURL(blob));
        })
        .catch(function (error) {
          const fallbackUrl = handleMuxFailure(error, resolvedMedia);
          if (fallbackUrl) openUrlInTab(fallbackUrl);
        });
    }).catch(function (error) {
      console.warn('Instagram View Image in New Tab: could not open media.', error);
      handleMissingMediaUrl(media);
    });
  }

  function saveActiveMedia() {
    const media = activeMedia;
    hideMenu();

    if (!media || media.type !== 'video') {
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
      return;
    }

    resolveVideoMedia(media).then(function (resolvedMedia) {
      const mediaUrl = resolvedMedia && (resolvedMedia.videoUrl || resolvedMedia.url);
      if (!mediaUrl) {
        handleMissingMediaUrl(media);
        return;
      }

      if (hasSeparateAudio(resolvedMedia)) {
        muxVideoMedia(resolvedMedia)
          .then(function (blob) {
            hideStatus();
            saveBlob(blob, resolvedMedia.filename);
          })
          .catch(function (error) {
            const fallbackUrl = handleMuxFailure(error, resolvedMedia);
            if (!fallbackUrl) return;

            if (typeof GM_download === 'function') {
              GM_download({
                url: fallbackUrl,
                name: resolvedMedia.filename,
                saveAs: true
              });
              return;
            }

            const link = document.createElement('a');
            link.href = fallbackUrl;
            link.download = resolvedMedia.filename;
            link.rel = 'noopener';
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            link.remove();
          });
        return;
      }

      if (typeof GM_download === 'function') {
        GM_download({
          url: mediaUrl,
          name: resolvedMedia.filename,
          saveAs: true
        });
        return;
      }

      const link = document.createElement('a');
      link.href = mediaUrl;
      link.download = resolvedMedia.filename;
      link.rel = 'noopener';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }).catch(function (error) {
      console.warn('Instagram View Image in New Tab: could not save media.', error);
      handleMissingMediaUrl(media);
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

  function copyVideoStreamUrls(media) {
    const text = hasSeparateAudio(media)
      ? `Video: ${media.videoUrl}\nAudio: ${media.audioUrl}`
      : media.videoUrl || media.url || '';

    return copyTextToClipboard(text).catch(handleCopyTextFailure);
  }

  function copyActiveMedia() {
    const media = activeMedia;
    hideMenu();

    if (!media) return;

    if (media.type === 'video') {
      resolveVideoMedia(media).then(function (resolvedMedia) {
        if (resolvedMedia && (resolvedMedia.videoUrl || resolvedMedia.url)) {
          copyVideoStreamUrls(resolvedMedia);
        } else {
          handleMissingMediaUrl(media);
        }
      }).catch(function (error) {
        console.warn('Instagram View Image in New Tab: could not copy video URL.', error);
        handleMissingMediaUrl(media);
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
