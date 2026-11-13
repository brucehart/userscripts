// ==UserScript==
// @name         ESPN Remove Videos
// @namespace    https://github.com/brucehart/userscripts
// @version      1.2
// @description  Hide video players and stop native video playback on ESPN without removing page elements.
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
  const HIDE_SELECTOR = `video, ${PLAYER_SELECTOR}`;
  const CANDIDATE_SELECTOR = `${HIDE_SELECTOR}, iframe, object, embed`;

  // Keep React-owned elements in place so ESPN can hydrate and update them.
  // Removing server-rendered player containers can trigger its error boundary.
  GM_addStyle(`${HIDE_SELECTOR} { display: none !important; }`);

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
    // Leave sources and player children intact: ESPN owns their lifecycle.
    // Muting also covers the short interval before a play event is handled.
    if (!video.muted) video.muted = true;
    if (video.autoplay) video.autoplay = false;
    if (!video.paused) video.pause();
  }

  function hideCandidate(element) {
    if (!element.isConnected) return;
    if (!element.matches(HIDE_SELECTOR) && !isVideoEmbed(element)) return;

    const player = element.closest(PLAYER_SELECTOR) || element;
    // Inline styling also covers recognized frames without hiding unrelated embeds.
    if (!player.matches(HIDE_SELECTOR)
      && (player.style.getPropertyValue('display') !== 'none'
        || player.style.getPropertyPriority('display') !== 'important')) {
      player.style.setProperty('display', 'none', 'important');
    }
    if (player.matches('video')) stopVideo(player);
    player.querySelectorAll('video').forEach(stopVideo);
  }

  function scan(root) {
    if (root.nodeType === Node.ELEMENT_NODE && root.matches(CANDIDATE_SELECTOR)) {
      hideCandidate(root);
    }
    if (root.isConnected) root.querySelectorAll(CANDIDATE_SELECTOR).forEach(hideCandidate);
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
    attributeFilter: ['src', 'data', 'type', 'class', 'style', 'autoplay', 'data-module', 'data-testid']
  });

  // Stop initial playback and retries by autoplaying players.
  function onPlayback(event) {
    if (event.target instanceof HTMLVideoElement) {
      stopVideo(event.target);
      hideCandidate(event.target);
    }
  }

  document.addEventListener('play', onPlayback, true);
  document.addEventListener('volumechange', onPlayback, true);

  scan(document);
})();
