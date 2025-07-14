// ==UserScript==
// @name         Project Euler Difficulty Highlighter
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Adds a difficulty filter dropdown to the Progress page and highlights problems of that difficulty.
// @author       YourName
// @match        https://projecteuler.net/progress*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ------------------ helpers ------------------
  /** Wait until the Problems Solved header is present, then run callback */
  function waitForHeader(callback) {
    const headerEl =
      document.querySelector('#problems_solved_section h3') ||
      Array.from(document.querySelectorAll('h3')).find((h) =>
        h.textContent.trim().startsWith('Problems Solved')
      );
    if (headerEl) {
      callback(headerEl);
    } else {
      setTimeout(() => waitForHeader(callback), 250);
    }
  }

  /** Build <select> populated with --- plus 5–100 % in 5-point increments */
  function buildDropdown() {
    const select = document.createElement('select');
    select.id = 'pe-difficulty-select';
    select.style.marginLeft = '0.5rem';
    select.style.verticalAlign = 'middle';

    const offOpt = document.createElement('option');
    offOpt.value = '';
    offOpt.textContent = '---'; // "off" choice
    select.appendChild(offOpt);

    for (let pct = 5; pct <= 100; pct += 5) {
      const opt = document.createElement('option');
      opt.value = String(pct);
      opt.textContent = `${pct}%`;
      select.appendChild(opt);
    }
    return select;
  }

  /** Tag every <td class="tooltip"> with its numeric difficulty once */
  function tagAllCells() {
    document.querySelectorAll('td.tooltip').forEach((td) => {
      if (td.dataset.difficulty) return; // already done
      const ratingLine = td.querySelector('.tooltiptext_narrow .smaller');
      if (!ratingLine) return;
      const m = /([0-9]{1,3})%/.exec(ratingLine.textContent);
      if (m) td.dataset.difficulty = m[1];
    });
  }

  /** Add / remove the highlight class */
  function highlight(level) {
    // clear any existing
    document
      .querySelectorAll('td.pe-diff-highlight')
      .forEach((td) => td.classList.remove('pe-diff-highlight'));

    if (!level) return; // "off"

    document
      .querySelectorAll(`td[data-difficulty="${level}"]`)
      .forEach((td) => td.classList.add('pe-diff-highlight'));
  }

  /** Inject CSS for centring and highlight outline */
  function injectCSS() {
    const style = document.createElement('style');
    style.textContent = `
      /* Always keep numbers centred */
      td.tooltip { text-align: center; vertical-align: middle; }
      /* Make the <a> fill the cell so vertical centring is reliable */
      td.tooltip > a { display: inline-block; width: 100%; height: 100%; }

      /* Highlight class – use outline so borders never clash and content stays centred */
      .pe-diff-highlight {
        outline: 4px solid royalblue;
        outline-offset: -2px; /* pull outline inside a little */
      }
    `;
    document.head.appendChild(style);
  }

  // ------------------ boot ------------------
  injectCSS();

  waitForHeader((header) => {
    // Insert dropdown beside the heading
    header.appendChild(buildDropdown());

    // Tag cells now (and again shortly in case of delayed grids)
    tagAllCells();
    setTimeout(tagAllCells, 1200);

    document
      .getElementById('pe-difficulty-select')
      .addEventListener('change', (e) => highlight(e.target.value));
  });
})();