// ==UserScript==
// @name         NYT Connections Color Cycler
// @namespace    https://github.com/brucehart/userscripts
// @version      1.10
// @description  Cycle Connections words through native selected, yellow, green, blue, and purple states.
// @author       Bruce J. Hart
// @match        https://www.nytimes.com/games/connections*
// @match        https://www.nytimes.com/crosswords/game/connections*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const CARD_SELECTOR = 'label[data-testid="card-label"]';
  const CYCLE_CLASS = 'tm-nyt-connections-cycle';
  const CYCLE_ATTR = 'data-tm-connections-cycle';
  const MAX_COLOR_STATE = 4; // 1-4 = yellow/green/blue/purple, 0 = none
  const MAX_CYCLE_PHASE = MAX_COLOR_STATE + 1; // 0=unselected,1=selected,2-5=colors
  const customStateByCardKey = new Map();

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
    if (!event.isTrusted) {
      return;
    }

    const card = getCardFromTarget(event.target);
    if (!card || isDisabled(card)) {
      return;
    }

    const key = getCardKey(card);
    if (!key) {
      return;
    }

    const phase = getCyclePhase(key, card);
    // Let phase 0 (unselected -> native selected) run through NYT handlers.
    // Intercept every other phase so only one scripted step happens per click.
    if (phase > 0) {
      event.stopImmediatePropagation();
    }
  }

  function onCardClick(event) {
    if (!event.isTrusted) {
      return;
    }

    const card = getCardFromTarget(event.target);
    if (!card || isDisabled(card)) {
      return;
    }

    const key = getCardKey(card);
    if (!key) {
      return;
    }

    const currentPhase = getCyclePhase(key, card);
    if (currentPhase === 0) {
      // First click should be the site's native selected behavior.
      setCustomState(key, 0);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const nextPhase = currentPhase >= MAX_CYCLE_PHASE ? 0 : currentPhase + 1;
    applyPhase(key, card, nextPhase);
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

  function setCustomState(key, state) {
    if (state === 0) {
      customStateByCardKey.delete(key);
    } else {
      customStateByCardKey.set(key, state);
    }
  }

  function getCyclePhase(key, card) {
    if (isSelectedByGame(card)) {
      return 1;
    }

    const customState = customStateByCardKey.get(key) || 0;
    if (customState > 0) {
      return customState + 1;
    }

    return 0;
  }

  function applyPhase(key, card, phase) {
    const selected = isSelectedByGame(card);

    if (phase === 0) {
      setCustomState(key, 0);
      if (selected) {
        setNativeSelected(key, false);
      } else {
        queueReapply();
      }
      return;
    }

    if (phase === 1) {
      setCustomState(key, 0);
      if (!selected) {
        setNativeSelected(key, true);
      } else {
        queueReapply();
      }
      return;
    }

    setCustomState(key, phase - 1);
    if (selected) {
      setNativeSelected(key, false);
    } else {
      queueReapply();
    }
  }

  function setNativeSelected(key, desiredSelected, attempt = 0) {
    requestAnimationFrame(() => {
      const card = findCardByKey(key);
      if (!card || isDisabled(card)) {
        return;
      }

      if (isSelectedByGame(card) === desiredSelected) {
        queueReapply();
        return;
      }

      dispatchNativeToggle(card);

      if (attempt < 8) {
        setNativeSelected(key, desiredSelected, attempt + 1);
      } else {
        queueReapply();
      }
    });
  }

  function dispatchNativeToggle(card) {
    const forId = card.getAttribute('for');
    if (forId) {
      const input = document.getElementById(forId);
      if (input && typeof input.click === 'function') {
        input.click();
        return;
      }
    }

    const inputInside = card.querySelector('input');
    if (inputInside && typeof inputInside.click === 'function') {
      inputInside.click();
      return;
    }

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
      const state = key ? (customStateByCardKey.get(key) || 0) : 0;
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
    if (
      card.getAttribute('aria-pressed') === 'true' ||
      card.getAttribute('aria-selected') === 'true' ||
      card.getAttribute('aria-checked') === 'true' ||
      card.getAttribute('data-state') === 'selected'
    ) {
      return true;
    }

    const className = typeof card.className === 'string' ? card.className : '';
    if (className.indexOf('Card-module_selected') !== -1 || /\bselected\b/i.test(className)) {
      return true;
    }

    const selectedDescendant = card.querySelector(
      'input:checked, [aria-checked="true"], [aria-pressed="true"], [aria-selected="true"], [data-state="selected"], [class*="Card-module_selected"]'
    );
    if (selectedDescendant) {
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
