// ==UserScript==
// @name         Walgreens Order Helpers
// @namespace    https://github.com/brucehart/userscripts
// @version      1.5
// @description  Copy tab‑separated receipt row and copy PDF path placeholder to clipboard.
// @author       Bruce J. Hart
// @match        https://www.walgreens.com/orderhistory/order/details-ui*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  'use strict';

  /* ------------------------------------------------------------- *
   *  Helpers                                                       *
   * ------------------------------------------------------------- */
  const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
  const firstTextMatch = (rx) => (document.body.innerText.match(rx) || [])[0] || '';

  /** Extract the transaction date as a Date object. */
  function getTransactionDate() {
    const raw = firstTextMatch(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b|\d{1,2}\/\d{1,2}\/\d{4}/i);
    return raw ? new Date(raw.replace(/,/g, '')) : null;
  }

  /** Find the first “Total Rx Items:” and first “Total FSA Items:” values and return their sum. */
  function getEligibleTotal() {
    const rxMatch  = firstTextMatch(/Total\s+Rx\s+Items:\s*\$?([\d,.]+)/i);
    const fsaMatch = firstTextMatch(/Total\s+FSA[^\n]*Items?:\s*\$?([\d,.]+)/i);
    const rx  = rxMatch  ? parseFloat(rxMatch.replace(/[^\d.]/g, ''))  : 0;
    const fsa = fsaMatch ? parseFloat(fsaMatch.replace(/[^\d.]/g, '')) : 0;
    return (rx + fsa).toFixed(2); // "38.41"
  }

  /* ------------------------------------------------------------- *
   *  Button actions                                                *
   * ------------------------------------------------------------- */
  function copyRow() {
    const dt = getTransactionDate();
    if (!dt) return;
    const m = dt.getMonth() + 1;
    const d = dt.getDate();
    const y = dt.getFullYear().toString().slice(-2);
    const dateStr = `${m}/${d}/${y}`; // M/D/YY

    const total = getEligibleTotal();
    const row = `${dateStr}\t${dateStr}\t${dateStr}\t"Stef"\t"Walgreens"\t"Rx"\t${total}`;
    GM_setClipboard(row, 'text');
  }

  /** Copy the Google Drive path placeholder to clipboard. */
  function copyPdfPath() {
    const dt = getTransactionDate();
    if (!dt) return;
    const yyyy = dt.getFullYear();
    const iso  = dt.toISOString().slice(0, 10); // YYYY-MM-DD

    const [dollars, centsRaw] = getEligibleTotal().split('.');
    const cents = centsRaw.padStart(2, '0');

    const path = `G:\\My Drive\\Personal\\Health\\${yyyy}\\${iso}_Walgreens_${dollars}_${cents}.pdf`;
    GM_setClipboard(path, 'text');
  }

  /* ------------------------------------------------------------- *
   *  UI                                                            *
   * ------------------------------------------------------------- */
  function addButton(label, onclick, bottomPx) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.onclick = onclick;
    btn.style.cssText = `
      position:fixed; right:16px; bottom:${bottomPx}px;
      z-index:9999; padding:8px 12px;
      background:#d4430b; color:#fff; border:0; border-radius:8px;
      font:600 14px/1 sans-serif; cursor:pointer;
    `;
    document.body.appendChild(btn);
  }

  addButton('Copy row',   copyRow,    96);
  addButton('Copy PDF path', copyPdfPath, 48);

  GM_addStyle('button:hover{opacity:.85}');
})();
