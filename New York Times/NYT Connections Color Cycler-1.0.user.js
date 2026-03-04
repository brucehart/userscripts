// ==UserScript==
// @name         NYT Connections Color Cycler
// @namespace    https://github.com/brucehart/userscripts
// @version      1.0
// @description  Keep the first click native, then cycle category colors on repeated clicks for Connections words.
// @author       Bruce J. Hart
// @match        https://www.nytimes.com/games/connections*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TILE_SELECTOR = [
    'button[data-testid*="card"]',
    'button[data-testid*="tile"]',
    'button[class*="Card-module_card"]',
    '[role="button"][data-testid*="card"]',
    '[role="button"][class*="Card-module_card"]'
  ].join(', ');

  const CYCLE_STATES = 5; // 0 = none, 1-4 = yellow/green/blue/purple
  const DATA_KEY = 'tmCycleState';
  const CYCLE_CLASS = 'tm-nyt-connections-cycle';

  injectStyles();
  document.addEventListener('click', onTileClick, true);

  function onTileClick(event) {
    const tile = getTileFromTarget(event.target);
    if (!tile || isDisabled(tile)) {
      return;
    }

    const cycleState = getCycleState(tile);

    // While in a custom color state, keep the tile unselected and just cycle colors.
    if (cycleState > 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      applyCycleState(tile, (cycleState + 1) % CYCLE_STATES);
      return;
    }

    // If the game currently marks this tile as selected, let the native click deselect it,
    // then place it into the first custom category color.
    if (isSelectedByGame(tile)) {
      const key = getTileKey(tile);
      setTimeout(() => {
        const liveTile = findTileByKey(key) || tile;
        if (document.contains(liveTile) && !isDisabled(liveTile)) {
          applyCycleState(liveTile, 1);
        }
      }, 0);
    }
  }

  function getTileFromTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }

    const tile = target.closest(TILE_SELECTOR);
    if (!tile || !isWordTile(tile)) {
      return null;
    }

    return tile;
  }

  function isWordTile(tile) {
    const label = ((tile.getAttribute('aria-label') || '') + ' ' + (tile.textContent || '')).toLowerCase();
    if (/(shuffle|submit|clear|deselect|mistake|continue|play|next|share|settings|help)/.test(label)) {
      return false;
    }

    const text = (tile.textContent || '').trim();
    return text.length > 0 && text.length <= 24;
  }

  function isDisabled(tile) {
    return tile.hasAttribute('disabled') || tile.getAttribute('aria-disabled') === 'true';
  }

  function isSelectedByGame(tile) {
    if (tile.getAttribute('aria-pressed') === 'true' || tile.getAttribute('aria-selected') === 'true') {
      return true;
    }

    const className = typeof tile.className === 'string' ? tile.className : '';
    return /selected/i.test(className);
  }

  function getCycleState(tile) {
    const raw = tile.dataset[DATA_KEY] || '0';
    const parsed = Number.parseInt(raw, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function applyCycleState(tile, state) {
    if (state === 0) {
      delete tile.dataset[DATA_KEY];
      tile.classList.remove(CYCLE_CLASS);
      return;
    }

    tile.dataset[DATA_KEY] = String(state);
    tile.classList.add(CYCLE_CLASS);
  }

  function getTileKey(tile) {
    return (tile.textContent || '').replace(/\s+/g, ' ').trim().toUpperCase();
  }

  function findTileByKey(key) {
    if (!key) {
      return null;
    }

    const tiles = document.querySelectorAll(TILE_SELECTOR);
    for (const tile of tiles) {
      if (isWordTile(tile) && getTileKey(tile) === key) {
        return tile;
      }
    }

    return null;
  }

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .${CYCLE_CLASS} {
        color: #1d1d1d !important;
        border-color: rgba(0, 0, 0, 0.35) !important;
        box-shadow: inset 0 0 0 2px rgba(0, 0, 0, 0.22) !important;
      }
      .${CYCLE_CLASS}[data-tm-cycle-state="1"] {
        background-color: #f9df6d !important;
      }
      .${CYCLE_CLASS}[data-tm-cycle-state="2"] {
        background-color: #a0c35a !important;
      }
      .${CYCLE_CLASS}[data-tm-cycle-state="3"] {
        background-color: #b0c4ef !important;
      }
      .${CYCLE_CLASS}[data-tm-cycle-state="4"] {
        background-color: #ba81c5 !important;
      }
    `;
    document.head.appendChild(style);
  }
})();
