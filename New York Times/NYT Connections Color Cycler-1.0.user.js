// ==UserScript==
// @name         NYT Connections Color Cycler
// @namespace    https://github.com/brucehart/userscripts
// @version      1.0
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
  const pointerDownPhaseByKey = new Map(); // track phase at pointerdown time

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

    // Save the phase at pointerdown time so the click handler can use it
    pointerDownPhaseByKey.set(key, phase);

    // Only block native handlers for custom color phases (2+) when Ctrl is not held.
    // Phase 0 (unselected) and phase 1 (selected) need native handling:
    // - Phase 0: NYT selects the card
    // - Phase 1: NYT deselects the card (then we apply yellow in click handler)
    if (phase > 1 && !event.ctrlKey) {
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

    // Use the phase saved at pointerdown time, falling back to live phase
    const savedPhase = pointerDownPhaseByKey.get(key);
    pointerDownPhaseByKey.delete(key);

    const currentPhase = savedPhase !== undefined ? savedPhase : getCyclePhase(key, card);
    const ctrlPressed = event.ctrlKey;

    if (ctrlPressed) {
      if (currentPhase === 1) {
        // Native pointerdown already ran and deselected the card.
        // Prevent click from re-selecting and keep custom colors cleared.
        event.preventDefault();
        event.stopImmediatePropagation();
        setCustomState(key, 0);
        queueReapply();
        return;
      }

      // For phase 0 and custom color phases, clear custom colors and let native
      // selection logic run so Ctrl toggles selected/unselected only.
      setCustomState(key, 0);
      queueReapply();
      return;
    }

    if (currentPhase === 0) {
      // First click should be the site's native selected behavior.
      setCustomState(key, 0);
      return;
    }

    if (currentPhase === 1) {
      // Native pointerdown already ran and deselected the card.
      // Prevent the click from re-selecting it and apply yellow.
      event.preventDefault();
      event.stopImmediatePropagation();
      setCustomState(key, 1);
      queueReapplyAfterDeselection(key);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    const nextPhase = currentPhase >= MAX_CYCLE_PHASE ? 0 : currentPhase + 1;
    applyPhase(key, nextPhase);
  }

  function getCardFromTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    return target.closest(CARD_SELECTOR);
  }

  function getCardKey(card) {
    // Derive a stable key from the tile word/phrase only (exclude dynamic status text).
    const text = extractStableTileText(card);
    return text ? `text:${text}` : '';
  }

  function extractStableTileText(card) {
    const ariaLabel = card.getAttribute('aria-label');
    if (ariaLabel) {
      const ariaText = normalizeText(stripStateWords(ariaLabel.split(',')[0] || ''));
      if (ariaText) {
        return ariaText;
      }
    }

    const rawText = card.innerText || card.textContent || '';
    const lines = rawText.split(/\n+/);
    for (const line of lines) {
      const cleaned = normalizeText(stripStateWords(line));
      if (cleaned) {
        return cleaned;
      }
    }

    return '';
  }

  function stripStateWords(text) {
    return text.replace(/\b(?:SELECTED|UNSELECTED|NOT\s+SELECTED)\b/gi, ' ');
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

  function applyPhase(key, phase) {
    if (phase === 0 || phase === 1) {
      setCustomState(key, 0);
      queueReapply();
      return;
    }

    setCustomState(key, phase - 1);
    queueReapply();
  }

  function queueReapplyAfterDeselection(key, attempt = 0) {
    requestAnimationFrame(() => {
      const card = findCardByKey(key);
      if (!card || isDisabled(card)) {
        queueReapply();
        return;
      }

      if (!isSelectedByGame(card) || attempt >= 8) {
        queueReapply();
        return;
      }

      queueReapplyAfterDeselection(key, attempt + 1);
    });
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
    if (className.indexOf('Card-module_selected') !== -1) {
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
