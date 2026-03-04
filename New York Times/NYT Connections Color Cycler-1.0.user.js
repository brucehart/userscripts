// ==UserScript==
// @name         NYT Connections Color Cycler
// @namespace    https://github.com/brucehart/userscripts
// @version      1.8
// @description  Keep the first click native, then cycle category colors on repeated clicks for Connections words.
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
  const customStateByCardKey = new Map();
  const armedByCardKey = new Map(); // true after first native select click

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

    const customState = customStateByCardKey.get(key) || 0;
    const armed = armedByCardKey.get(key) === true;
    if (customState > 0 || armed) {
      // Intercept only when we are in custom mode or on second-click transition.
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

    const customState = customStateByCardKey.get(key) || 0;
    const selected = isSelectedByGame(card);

    if (customState > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();

      const nextState = customState >= MAX_COLOR_STATE ? 0 : customState + 1;
      setCustomState(key, nextState);
      if (nextState === 0) {
        armedByCardKey.set(key, false);
      }
      if (selected) {
        setNativeSelected(key, false);
      } else {
        queueReapply();
      }
      return;
    }

    const armed = armedByCardKey.get(key) === true;

    if (armed) {
      // Second click: selected -> yellow.
      event.preventDefault();
      event.stopImmediatePropagation();
      armedByCardKey.set(key, false);
      setCustomState(key, 1);
      setNativeSelected(key, false);
      return;
    }

    // First click: allow native selected state.
    if (!selected) {
      armedByCardKey.set(key, true);
    }
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
      if (key && state === 0) {
        // If the card is no longer selected (e.g., Deselect All), clear armed flag.
        if (!isSelectedByGame(card)) {
          armedByCardKey.set(key, false);
        }
      }
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
