// ==UserScript==
// @name         NYT Connections Color Cycler
// @namespace    https://github.com/brucehart/userscripts
// @version      1.11
// @description  Cycle Connections words through native selected and single/multi-color hint backgrounds.
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
  const TOOLBAR_ID = 'tm-nyt-connections-toolbar';
  const TOOLBAR_FLOAT_ATTR = 'data-tm-floating';
  const COLOR_BUTTONS = [
    { label: 'Yellow', state: 1, mask: 1, bg: '#f9df6d', text: '#1d1d1d' },
    { label: 'Green', state: 2, mask: 2, bg: '#a0c35a', text: '#1d1d1d' },
    { label: 'Blue', state: 3, mask: 4, bg: '#b0c4ef', text: '#1d1d1d' },
    { label: 'Purple', state: 4, mask: 8, bg: '#ba81c5', text: '#1d1d1d' }
  ];
  const ALL_COLOR_MASK = COLOR_BUTTONS.reduce((mask, config) => mask | config.mask, 0);
  const STRIPE_WIDTH_PX = 12;
  const customColorMaskByCardKey = new Map();
  const pointerDownPhaseByKey = new Map(); // track phase at pointerdown time

  let reapplyQueued = false;
  let toolbarDeselecting = false; // true while applyColorToSelectedCards deselects cards
  let gameHooksAttached = false;
  let gameObserver = null;
  let bootstrapObserver = null;

  injectStyles();
  activateWhenReady();

  function activateWhenReady() {
    if (hasGameCards()) {
      attachGameHooks();
      stopBootstrapObserver();
      queueReapply();
      return;
    }

    removeToolbar();
    startBootstrapObserver();
  }

  function attachGameHooks() {
    if (!gameHooksAttached) {
      window.addEventListener('pointerdown', onPointerDown, true);
      window.addEventListener('click', onCardClick, true);
      gameHooksAttached = true;
    }

    if (gameObserver) {
      return;
    }

    gameObserver = new MutationObserver(() => {
      if (!hasGameCards()) {
        stopGameObserver();
        removeToolbar();
        startBootstrapObserver();
        return;
      }

      queueReapply();
    });
    gameObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function startBootstrapObserver() {
    if (bootstrapObserver || hasGameCards()) {
      return;
    }

    bootstrapObserver = new MutationObserver(() => {
      if (hasGameCards()) {
        attachGameHooks();
        stopBootstrapObserver();
        queueReapply();
      }
    });
    bootstrapObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function stopBootstrapObserver() {
    if (!bootstrapObserver) {
      return;
    }

    bootstrapObserver.disconnect();
    bootstrapObserver = null;
  }

  function stopGameObserver() {
    if (!gameObserver) {
      return;
    }

    gameObserver.disconnect();
    gameObserver = null;
  }

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
    if (phase > 1 && !event.ctrlKey && !toolbarDeselecting) {
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
    const liveSelected = isSelectedByGame(card);
    const ctrlPressed = event.ctrlKey;

    if (ctrlPressed) {
      if (currentPhase === 1) {
        if (!liveSelected) {
          // The card was already deselected earlier in the event chain.
          // Stop the click from re-selecting it.
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        queueReapplyAfterDeselection(key);
        queueFallbackDeselection(key);
        return;
      }

      // Let Ctrl toggle selected/unselected only, preserving any custom colors.
      queueReapply();
      return;
    }

    if (currentPhase === 0) {
      // First click should be the site's native selected behavior.
      setCustomColorMask(key, 0);
      return;
    }

    if (currentPhase === 1) {
      // The site may deselect on pointerdown or click depending on the target.
      // Only block the click if the card is already deselected.
      addColorToCustomState(key, 1);
      if (!liveSelected) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      queueReapplyAfterDeselection(key);
      queueFallbackDeselection(key);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    applyNextCustomColor(key);
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

  function setCustomColorMask(key, mask) {
    const normalizedMask = normalizeColorMask(mask);
    if (normalizedMask === 0) {
      customColorMaskByCardKey.delete(key);
    } else {
      customColorMaskByCardKey.set(key, normalizedMask);
    }
  }

  function getCyclePhase(key, card) {
    if (isSelectedByGame(card)) {
      return 1;
    }

    return getCustomColorMask(key) > 0 ? 2 : 0;
  }

  function getCustomColorMask(key) {
    return normalizeColorMask(customColorMaskByCardKey.get(key) || 0);
  }

  function normalizeColorMask(mask) {
    return Number(mask) & ALL_COLOR_MASK;
  }

  function addColorToCustomState(key, state) {
    const config = getColorConfigByState(state);
    if (!config) {
      return;
    }

    setCustomColorMask(key, getCustomColorMask(key) | config.mask);
    queueReapply();
  }

  function applyNextCustomColor(key) {
    const currentMask = getCustomColorMask(key);
    if (currentMask === ALL_COLOR_MASK) {
      setCustomColorMask(key, 0);
      queueReapply();
      return;
    }

    const nextColor = COLOR_BUTTONS.find(config => (currentMask & config.mask) === 0);
    if (nextColor) {
      setCustomColorMask(key, currentMask | nextColor.mask);
    }
    queueReapply();
  }

  function getColorConfigByState(state) {
    return COLOR_BUTTONS.find(config => config.state === state) || null;
  }

  function getColorConfigsForMask(mask) {
    const normalizedMask = normalizeColorMask(mask);
    return COLOR_BUTTONS.filter(config => (normalizedMask & config.mask) !== 0);
  }

  function getCardBackground(mask) {
    const colors = getColorConfigsForMask(mask);
    if (colors.length === 0) {
      return '';
    }

    if (colors.length === 1) {
      return colors[0].bg;
    }

    let position = 0;
    const stops = [];
    for (const color of colors) {
      const nextPosition = position + STRIPE_WIDTH_PX;
      stops.push(`${color.bg} ${position}px`, `${color.bg} ${nextPosition}px`);
      position = nextPosition;
    }

    return `repeating-linear-gradient(45deg, ${stops.join(', ')})`;
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
      if (!hasGameCards()) {
        removeToolbar();
        return;
      }
      ensureToolbar();
      reapplyAllStates();
    });
  }

  function reapplyAllStates() {
    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      const key = getCardKey(card);
      const colorMask = key ? getCustomColorMask(key) : 0;
      applyStateToCard(card, colorMask);
    }
  }

  function applyStateToCard(card, colorMask) {
    if (!card) {
      return;
    }

    const normalizedMask = normalizeColorMask(colorMask);
    if (normalizedMask === 0) {
      card.classList.remove(CYCLE_CLASS);
      card.removeAttribute(CYCLE_ATTR);
      card.style.removeProperty('--tm-cycle-bg');
      return;
    }

    if (isSelectedByGame(card)) {
      card.classList.remove(CYCLE_CLASS);
      card.removeAttribute(CYCLE_ATTR);
      card.style.removeProperty('--tm-cycle-bg');
      return;
    }

    card.classList.add(CYCLE_CLASS);
    card.setAttribute(CYCLE_ATTR, String(normalizedMask));
    card.style.setProperty('--tm-cycle-bg', getCardBackground(normalizedMask));
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

  function ensureToolbar() {
    if (!document.body) {
      return;
    }

    if (!hasGameCards()) {
      removeToolbar();
      return;
    }

    const mountPoint = findToolbarMountPoint();
    let toolbar = document.getElementById(TOOLBAR_ID);

    if (!toolbar) {
      toolbar = createToolbar();
    }

    if (mountPoint) {
      toolbar.removeAttribute(TOOLBAR_FLOAT_ATTR);
      if (toolbar.parentElement !== mountPoint.parentElement || toolbar.nextElementSibling !== mountPoint) {
        mountPoint.insertAdjacentElement('beforebegin', toolbar);
      }
      return;
    }

    toolbar.setAttribute(TOOLBAR_FLOAT_ATTR, 'true');
    if (toolbar.parentElement !== document.body) {
      document.body.appendChild(toolbar);
    }
  }

  function hasGameCards() {
    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      if (isCardVisible(card)) {
        return true;
      }
    }

    return false;
  }

  function isCardVisible(card) {
    if (!(card instanceof Element)) {
      return false;
    }

    return card.getClientRects().length > 0;
  }

  function removeToolbar() {
    const toolbar = document.getElementById(TOOLBAR_ID);
    if (toolbar) {
      toolbar.remove();
    }
  }

  function findToolbarMountPoint() {
    const controlsButton = document.querySelector(
      'button[data-testid="shuffle-btn"], button[data-testid="submit-btn"], button[aria-label="Shuffle"], button[aria-label="Submit"]'
    );
    if (!controlsButton) {
      return null;
    }

    let node = controlsButton.parentElement;
    while (node && node !== document.body) {
      if (node.querySelectorAll('button').length >= 2) {
        return node;
      }
      node = node.parentElement;
    }

    return controlsButton.parentElement;
  }

  function createToolbar() {
    const toolbar = document.createElement('div');
    toolbar.id = TOOLBAR_ID;

    for (const config of COLOR_BUTTONS) {
      toolbar.appendChild(createToolbarButton(config.label, config.bg, config.text, () => {
        applyColorToSelectedCards(config.state);
      }));
    }

    toolbar.appendChild(createToolbarButton('Clear', '#ffffff', '#1d1d1d', () => {
      applyColorToSelectedCards(0);
    }));
    toolbar.appendChild(createToolbarButton('Clear All', '#ffffff', '#1d1d1d', clearAllCustomColors));
    return toolbar;
  }

  function createToolbarButton(label, backgroundColor, textColor, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.className = 'tm-nyt-connections-toolbar-button';
    button.style.setProperty('--tm-button-bg', backgroundColor);
    button.style.setProperty('--tm-button-text', textColor);
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  function applyColorToSelectedCards(state) {
    const selectedCards = getSelectedCards();
    if (selectedCards.length === 0) {
      return;
    }

    const colorConfig = state === 0 ? null : getColorConfigByState(state);
    for (const { card, key } of selectedCards) {
      if (colorConfig) {
        setCustomColorMask(key, getCustomColorMask(key) | colorConfig.mask);
      } else if (state === 0) {
        setCustomColorMask(key, 0);
      }
      queueReapplyAfterDeselection(key);
    }

    toolbarDeselecting = true;
    try {
      if (!clickDeselectAllButton()) {
        for (const { card } of selectedCards) {
          toggleCardSelectionOff(card);
        }
      }
    } finally {
      toolbarDeselecting = false;
    }

    queueReapply();
  }

  function getSelectedCards() {
    const cards = document.querySelectorAll(CARD_SELECTOR);
    const selectedCards = [];

    for (const card of cards) {
      if (isDisabled(card) || !isSelectedByGame(card)) {
        continue;
      }

      const key = getCardKey(card);
      if (!key) {
        continue;
      }

      selectedCards.push({ card, key });
    }

    return selectedCards;
  }

  function toggleCardSelectionOff(card) {
    const input = card.querySelector('input');
    if (input && !input.disabled && typeof input.click === 'function') {
      input.click();
      return;
    }

    if (typeof card.click === 'function') {
      card.click();
    }
  }

  function queueFallbackDeselection(key) {
    requestAnimationFrame(() => {
      const card = findCardByKey(key);
      if (!card || isDisabled(card) || !isSelectedByGame(card)) {
        return;
      }

      toggleCardSelectionOff(card);
      queueReapplyAfterDeselection(key);
    });
  }

  function clickDeselectAllButton() {
    const button = findControlButton('DESELECT ALL');
    if (!button || button.disabled) {
      return false;
    }

    button.click();
    return true;
  }

  function findControlButton(labelText) {
    const normalizedLabel = normalizeText(labelText);
    const buttons = document.querySelectorAll('button');

    for (const button of buttons) {
      const ariaLabel = button.getAttribute('aria-label');
      if (ariaLabel && normalizeText(ariaLabel) === normalizedLabel) {
        return button;
      }

      const text = button.textContent || '';
      if (normalizeText(text) === normalizedLabel) {
        return button;
      }
    }

    return null;
  }

  function clearAllCustomColors() {
    if (customColorMaskByCardKey.size === 0) {
      return;
    }

    customColorMaskByCardKey.clear();
    queueReapply();
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .${CYCLE_CLASS}:not([class*="Card-module_selected"]) {
        color: #1d1d1d !important;
        background: var(--tm-cycle-bg) !important;
        border-color: rgba(0, 0, 0, 0.35) !important;
        box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.22) !important;
      }
      #${TOOLBAR_ID} {
        display: flex;
        flex: 0 0 100%;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
        justify-content: center;
        width: 100%;
        min-width: 100%;
        box-sizing: border-box;
        margin: 12px 0;
        z-index: 9999;
      }
      #${TOOLBAR_ID}[${TOOLBAR_FLOAT_ATTR}="true"] {
        position: fixed;
        right: 16px;
        bottom: 16px;
        left: auto;
        width: auto;
        min-width: 0;
        max-width: calc(100vw - 32px);
        margin-top: 0;
        padding: 10px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.96);
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.18);
      }
      #${TOOLBAR_ID} .tm-nyt-connections-toolbar-button {
        appearance: none;
        border: 1px solid rgba(0, 0, 0, 0.2);
        border-radius: 999px;
        padding: 8px 14px;
        font: inherit;
        font-weight: 700;
        color: var(--tm-button-text);
        background: var(--tm-button-bg);
        cursor: pointer;
      }
      #${TOOLBAR_ID} .tm-nyt-connections-toolbar-button:hover {
        filter: brightness(0.97);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
})();
