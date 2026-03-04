// ==UserScript==
// @name         NYT Connections Color Cycler
// @namespace    https://github.com/brucehart/userscripts
// @version      1.4
// @description  Keep the first click native, then cycle category colors on repeated clicks for Connections words.
// @author       Bruce J. Hart
// @match        https://www.nytimes.com/games/connections*
// @match        https://www.nytimes.com/crosswords/game/connections*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CARD_SELECTOR = 'label[data-testid="card-label"]';
  const CYCLE_CLASS = 'tm-nyt-connections-cycle';
  const CYCLE_ATTR = 'data-tm-connections-cycle';
  const STATE_COUNT = 5; // 0 = none, 1-4 = yellow/green/blue/purple
  const stateByCardKey = new Map();
  const actionVersionByCardKey = new Map();
  const pointerWasSelectedByCardKey = new Map();

  let reapplyQueued = false;

  injectStyles();
  queueReapply();
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('click', onCardClick, true);

  const observer = new MutationObserver(() => {
    queueReapply();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  function onPointerDown(event) {
    const card = getCardFromTarget(event.target);
    if (!card || isDisabled(card)) {
      return;
    }

    const key = getCardKey(card);
    if (!key) {
      return;
    }

    const state = stateByCardKey.get(key) || 0;
    const wasSelected = isSelectedByGame(card);
    pointerWasSelectedByCardKey.set(key, wasSelected);

    if (state > 0 || wasSelected) {
      // Block NYT's own pointer handlers for custom cycle transitions.
      event.stopImmediatePropagation();
    }
  }

  function onCardClick(event) {
    const card = getCardFromTarget(event.target);
    if (!card || isDisabled(card)) {
      return;
    }

    const key = getCardKey(card);
    if (!key) {
      return;
    }

    const state = stateByCardKey.get(key) || 0;
    const wasSelectedOnPointerDown = pointerWasSelectedByCardKey.get(key) === true;
    pointerWasSelectedByCardKey.delete(key);

    const shouldInterceptClick = state > 0 || wasSelectedOnPointerDown;
    if (!shouldInterceptClick) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    const actionVersion = bumpActionVersion(key);

    if (state > 0) {
      const nextState = (state + 1) % STATE_COUNT;
      setState(key, nextState);
      applyStateWithRetry(key, nextState, actionVersion);
      return;
    }

    // state 0 + selected by game -> second click becomes yellow.
    setState(key, 1);
    applyStateWithRetry(key, 1, actionVersion);
  }

  function getCardFromTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    return target.closest(CARD_SELECTOR);
  }

  function getCardKey(card) {
    const id = card.getAttribute('for');
    if (id) {
      return `id:${id}`;
    }

    const text = normalizeText(card.textContent || '');
    return text ? `text:${text}` : '';
  }

  function findCardByKey(key) {
    if (!key) {
      return null;
    }

    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      if (getCardKey(card) === key) {
        return card;
      }
    }
    return null;
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function setState(key, state) {
    if (state === 0) {
      stateByCardKey.delete(key);
    } else {
      stateByCardKey.set(key, state);
    }
  }

  function bumpActionVersion(key) {
    const next = (actionVersionByCardKey.get(key) || 0) + 1;
    actionVersionByCardKey.set(key, next);
    return next;
  }

  function isCurrentActionVersion(key, version) {
    return (actionVersionByCardKey.get(key) || 0) === version;
  }

  function applyStateWithRetry(key, state, version, attempt = 0) {
    requestAnimationFrame(() => {
      if (!isCurrentActionVersion(key, version)) {
        return;
      }

      const liveCard = findCardByKey(key);
      if (!liveCard || isDisabled(liveCard)) {
        return;
      }

      if (isSelectedByGame(liveCard) && attempt < 4) {
        deselectCard(liveCard);
        applyStateWithRetry(key, state, version, attempt + 1);
        return;
      }

      applyStateToCard(liveCard, state);
    });
  }

  function deselectCard(card) {
    const target = card.firstElementChild || card;
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      keyCode: 32,
      which: 32,
      bubbles: true,
      cancelable: true
    }));
  }

  function queueReapply() {
    if (reapplyQueued) {
      return;
    }
    reapplyQueued = true;

    requestAnimationFrame(() => {
      reapplyQueued = false;
      reapplyAllStates();
    });
  }

  function reapplyAllStates() {
    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      const key = getCardKey(card);
      const state = key ? (stateByCardKey.get(key) || 0) : 0;
      applyStateToCard(card, state);
    }
  }

  function applyStateToCard(card, state) {
    if (!card) {
      return;
    }

    if (state === 0 || isSelectedByGame(card)) {
      card.classList.remove(CYCLE_CLASS);
      card.removeAttribute(CYCLE_ATTR);
      return;
    }

    card.classList.add(CYCLE_CLASS);
    card.setAttribute(CYCLE_ATTR, String(state));
  }

  function isDisabled(card) {
    if (card.getAttribute('aria-disabled') === 'true') {
      return true;
    }

    const input = card.querySelector('input');
    return Boolean(input && input.disabled);
  }

  function isSelectedByGame(card) {
    if (card.getAttribute('aria-pressed') === 'true' || card.getAttribute('aria-selected') === 'true') {
      return true;
    }

    const className = typeof card.className === 'string' ? card.className : '';
    if (className.indexOf('Card-module_selected') !== -1 || /\bselected\b/i.test(className)) {
      return true;
    }

    const input = card.querySelector('input');
    return Boolean(input && input.checked);
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .${CYCLE_CLASS}:not([class*="Card-module_selected"]) {
        color: #1d1d1d !important;
        border-color: rgba(0, 0, 0, 0.35) !important;
        box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.22) !important;
      }
      .${CYCLE_CLASS}[${CYCLE_ATTR}="1"]:not([class*="Card-module_selected"]) {
        background-color: #f9df6d !important;
      }
      .${CYCLE_CLASS}[${CYCLE_ATTR}="2"]:not([class*="Card-module_selected"]) {
        background-color: #a0c35a !important;
      }
      .${CYCLE_CLASS}[${CYCLE_ATTR}="3"]:not([class*="Card-module_selected"]) {
        background-color: #b0c4ef !important;
      }
      .${CYCLE_CLASS}[${CYCLE_ATTR}="4"]:not([class*="Card-module_selected"]) {
        background-color: #ba81c5 !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();
