// ==UserScript==
// @name         ESPN Remove Videos
// @namespace    https://github.com/brucehart/userscripts
// @version      1.1
// @description  Remove video players and embedded videos from ESPN pages, including dynamically loaded videos.
// @author       Bruce J. Hart
// @match        *://*.espn.com/*
// @run-at       document-start
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  // Target player containers rather than whole articles or generic media cards.
  const PLAYER_SELECTOR = [
    '.video-player',
    '.videoPlayer',
    '.VideoPlayer',
    '.video-container',
    '.espn-video-player',
    '.ClipsPlayerContainer',
    '.WebPlayerContainer',
    'disney-web-player',
    '[data-testid="video-player-espn"]',
    '.vjs-player',
    '.video-js',
    '[data-module="video-player"]',
    '[data-testid="video-player"]'
  ].join(', ');
  const REMOVE_SELECTOR = `video, ${PLAYER_SELECTOR}`;
  const CANDIDATE_SELECTOR = `${REMOVE_SELECTOR}, iframe, object, embed`;

  // Hide players immediately, before the observer gets a chance to remove them.
  GM_addStyle(`${REMOVE_SELECTOR} { display: none !important; }`);

  function isVideoEmbed(element) {
    const type = element.getAttribute('type') || '';
    if (/^video\//i.test(type)) return true;

    const source = element.getAttribute('src') || element.getAttribute('data');
    if (!source) return false;

    try {
      const url = new URL(source, document.baseURI);
      const host = url.hostname;
      const path = url.pathname;
      return (/(^|\.)espn\.com$/i.test(host) && /^\/(?:[^/]+\/)?video\//i.test(path))
        || (/(^|\.)(?:youtube\.com|youtube-nocookie\.com)$/i.test(host) && /^\/embed\//i.test(path))
        || (host === 'player.vimeo.com' && /^\/video\//i.test(path))
        || (/(^|\.)dailymotion\.com$/i.test(host) && /^\/embed\/video\//i.test(path))
        || /\.(?:mp4|webm|m4v|mov|m3u8|mpd)$/i.test(path);
    } catch {
      return false;
    }
  }

  function stopVideo(video) {
    video.pause();
    video.autoplay = false;
    video.removeAttribute('src');
    video.querySelectorAll('source').forEach(function (source) {
      source.removeAttribute('src');
      source.removeAttribute('srcset');
    });
    if (video.srcObject) video.srcObject = null;
    // Reset the media element to release an already loaded stream.
    video.load();
  }

  function removeCandidate(element) {
    if (!element.isConnected) return;
    if (!element.matches(REMOVE_SELECTOR) && !isVideoEmbed(element)) return;

    const player = element.closest(PLAYER_SELECTOR) || element;
    if (player.matches('video')) stopVideo(player);
    player.querySelectorAll('video').forEach(stopVideo);
    player.remove();
  }

  function scan(root) {
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(CANDIDATE_SELECTOR)) {
      removeCandidate(root);
    }
    if (root.isConnected) root.querySelectorAll(CANDIDATE_SELECTOR).forEach(removeCandidate);
  }

  // ESPN adds players after navigation, lazy loading, and scrolling. Inspect only
  // changed subtrees instead of repeatedly scanning the entire page.
  const observer = new MutationObserver(function (records) {
    records.forEach(function (record) {
      if (record.type === 'attributes') {
        scan(record.target);
      } else {
        record.addedNodes.forEach(function (node) {
          if (node.nodeType === Node.ELEMENT_NODE) scan(node);
        });
      }
    });
  });

  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'data', 'type', 'class', 'data-module', 'data-testid']
  });

  // Stop playback if a player starts before its removal is processed.
  document.addEventListener('play', function (event) {
    if (event.target instanceof HTMLVideoElement) {
      stopVideo(event.target);
      removeCandidate(event.target);
    }
  }, true);

  scan(document);
})();
