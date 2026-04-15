// ==UserScript==
// @name         Project Euler Progress Local Solved Overlay
// @namespace    https://github.com/brucehart/userscripts
// @version      1.3
// @description  Store extra solved Project Euler problems in Tampermonkey storage and render the progress page as if they are solved.
// @author       Bruce J. Hart
// @match        https://projecteuler.net/progress*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      gist.githubusercontent.com
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'projectEulerProgressLocalSolved';
  const PANEL_ID = 'tm-pe-local-solved-panel';
  const STYLE_ID = 'tm-pe-local-solved-style';
  const INPUT_ID = 'tm-pe-local-solved-input';
  const STATUS_ID = 'tm-pe-local-solved-status';
  const COUNT_ID = 'tm-pe-local-solved-count';
  const LIST_ID = 'tm-pe-local-solved-list';
  const SAVE_ID = 'tm-pe-local-solved-save';
  const IMPORT_ID = 'tm-pe-local-solved-import';
  const CLEAR_ID = 'tm-pe-local-solved-clear';
  const OVERLAY_ATTR = 'data-tm-pe-local-solved';
  const SUMMARY_PATTERN = /Solved\s+(\d+)\s+out of\s+(\d+)\s+problems\s+\(([\d.]+)%\)/i;
  const SOLVED_PROBLEMS_GIST_URL = 'https://gist.githubusercontent.com/brucehart/0b68fb617553e81b2961c3c3e7688928/raw/solved-problems.txt';

  let observer = null;
  let applyQueued = false;
  let latestSnapshot = null;

  startWhenReady();

  function startWhenReady() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initialize, { once: true });
      return;
    }

    initialize();
  }

  function initialize() {
    injectStyles();
    ensurePanel();
    queueApply();
    startObserver();
  }

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        margin: 0 0 1.5rem;
        padding: 1rem;
        border: 1px solid #d9c9a7;
        border-radius: 6px;
        background: #fbf7ef;
        color: #333;
      }

      #${PANEL_ID} h3 {
        margin: 0 0 0.5rem;
      }

      #${PANEL_ID} p {
        margin: 0 0 0.75rem;
      }

      #${INPUT_ID} {
        width: 100%;
        min-height: 5.5rem;
        box-sizing: border-box;
        padding: 0.5rem;
        border: 1px solid #bba77d;
        border-radius: 4px;
        resize: vertical;
        font: inherit;
      }

      .tm-pe-local-solved-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin: 0.75rem 0;
      }

      .tm-pe-local-solved-actions button {
        padding: 0.45rem 0.8rem;
        border: 1px solid #9f8a5f;
        border-radius: 4px;
        background: #f0e1bd;
        color: #222;
        cursor: pointer;
        font: inherit;
      }

      .tm-pe-local-solved-actions button:hover {
        background: #e9d4a3;
      }

      .tm-pe-local-solved-actions button:disabled {
        cursor: wait;
        opacity: 0.7;
      }

      #${STATUS_ID} {
        min-height: 1.2rem;
        margin: 0.35rem 0 0.75rem;
        color: #5b4523;
      }

      .tm-pe-local-solved-current {
        font-size: 0.95rem;
      }

      #${LIST_ID} {
        margin-top: 0.35rem;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        font-family: Consolas, Monaco, monospace;
      }
    `;
    document.head.appendChild(style);
  }

  function startObserver() {
    const root = document.getElementById('problems_section');
    if (!root) {
      return;
    }

    if (!observer) {
      observer = new MutationObserver((mutations) => {
        if (!mutations.some(hasRelevantMutation)) {
          return;
        }
        queueApply();
      });
    }

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
  }

  function hasRelevantMutation(mutation) {
    if (mutation.type === 'attributes') {
      return !isManagedOverlayCell(mutation.target) && !isScriptOwnedNode(mutation.target);
    }

    return [...mutation.addedNodes, ...mutation.removedNodes].some((node) => !isScriptOwnedNode(node));
  }

  function isScriptOwnedNode(node) {
    if (!(node instanceof Element)) {
      return false;
    }

    return node.id === PANEL_ID || Boolean(node.closest(`#${PANEL_ID}`));
  }

  function isManagedOverlayCell(node) {
    return node instanceof Element && node.getAttribute(OVERLAY_ATTR) === 'true';
  }

  function queueApply() {
    if (applyQueued) {
      return;
    }

    applyQueued = true;
    window.requestAnimationFrame(() => {
      applyQueued = false;
      applyPageState();
    });
  }

  function applyPageState() {
    const progressPage = document.getElementById('progress_page');
    const problemsSection = document.getElementById('problems_section');
    if (!progressPage || !problemsSection) {
      return;
    }

    if (observer) {
      observer.disconnect();
    }

    try {
      ensurePanel();
      clearLocalSolvedOverlays();

      const summaryHeading = findSummaryHeading();
      const problemMap = collectProblemCells(progressPage);
      const siteSolved = collectSiteSolved(problemMap);
      const totalProblems = parseTotalProblems(summaryHeading, problemMap);
      const storedProblems = loadStoredProblems();
      const normalizedStored = normalizeProblemIds(storedProblems, totalProblems);
      const prunedLocal = normalizedStored.filter((problemId) => !siteSolved.has(problemId));

      if (!arraysEqual(normalizedStored, prunedLocal)) {
        saveStoredProblems(prunedLocal);
      }

      applyLocalSolvedOverlays(problemMap, prunedLocal);

      if (summaryHeading && totalProblems > 0) {
        updateSolvedSummary(summaryHeading, siteSolved.size + prunedLocal.length, totalProblems);
      }

      latestSnapshot = {
        problemMap,
        siteSolved,
        totalProblems,
        storedLocal: prunedLocal
      };
      updatePanelState(prunedLocal);
    } finally {
      startObserver();
    }
  }

  function clearLocalSolvedOverlays() {
    document.querySelectorAll(`[${OVERLAY_ATTR}="true"]`).forEach((cell) => {
      cell.removeAttribute(OVERLAY_ATTR);
      cell.classList.remove('problem_solved');
      cell.classList.add('problem_unsolved');
    });
  }

  function findSummaryHeading() {
    return Array.from(document.querySelectorAll('#progress_page h3')).find((heading) => SUMMARY_PATTERN.test(heading.textContent || '')) || null;
  }

  function parseTotalProblems(summaryHeading, problemMap) {
    if (summaryHeading) {
      const match = (summaryHeading.textContent || '').match(SUMMARY_PATTERN);
      if (match) {
        return Number(match[2]);
      }
    }

    return problemMap.size;
  }

  function collectProblemCells(root) {
    const problemMap = new Map();
    const links = root.querySelectorAll('a[href*="problem="]');

    links.forEach((link) => {
      const href = link.getAttribute('href') || '';
      const match = href.match(/problem=(\d+)/);
      if (!match) {
        return;
      }

      const problemId = Number(match[1]);
      const cell = link.closest('td');
      if (!cell) {
        return;
      }

      const cells = problemMap.get(problemId) || [];
      if (!cells.includes(cell)) {
        cells.push(cell);
      }
      problemMap.set(problemId, cells);
    });

    return problemMap;
  }

  function collectSiteSolved(problemMap) {
    const siteSolved = new Set();

    problemMap.forEach((cells, problemId) => {
      if (cells.some((cell) => cell.classList.contains('problem_solved'))) {
        siteSolved.add(problemId);
      }
    });

    return siteSolved;
  }

  function applyLocalSolvedOverlays(problemMap, problemIds) {
    problemIds.forEach((problemId) => {
      const cells = problemMap.get(problemId) || [];
      cells.forEach((cell) => {
        if (cell.classList.contains('problem_solved')) {
          return;
        }

        cell.classList.remove('problem_unsolved');
        cell.classList.add('problem_solved');
        cell.setAttribute(OVERLAY_ATTR, 'true');
      });
    });
  }

  function updateSolvedSummary(summaryHeading, solvedCount, totalProblems) {
    const percent = ((solvedCount / totalProblems) * 100).toFixed(1);
    summaryHeading.textContent = `Solved ${solvedCount} out of ${totalProblems} problems (${percent}%)`;
  }

  function ensurePanel() {
    const problemsSection = document.getElementById('problems_section');
    if (!problemsSection) {
      return null;
    }

    let panel = document.getElementById(PANEL_ID);
    if (panel && panel.isConnected) {
      return panel;
    }

    panel = buildPanel();
    const problemsSolvedSection = document.getElementById('problems_solved_section');
    problemsSection.insertBefore(panel, problemsSolvedSection || problemsSection.firstChild);
    syncEditorFromStored();
    return panel;
  }

  function buildPanel() {
    const panel = document.createElement('section');
    panel.id = PANEL_ID;
    panel.className = 'noprint';

    const heading = document.createElement('h3');
    heading.textContent = 'Local Solved Problems';

    const description = document.createElement('p');
    description.textContent = 'Enter extra solved problem IDs separated by commas, spaces, or new lines, or import the shared gist list.';

    const textarea = document.createElement('textarea');
    textarea.id = INPUT_ID;
    textarea.rows = 4;
    textarea.placeholder = 'Example: 311, 369, 825';
    textarea.addEventListener('input', () => {
      textarea.dataset.dirty = 'true';
    });

    const actions = document.createElement('div');
    actions.className = 'tm-pe-local-solved-actions';

    const saveButton = document.createElement('button');
    saveButton.id = SAVE_ID;
    saveButton.type = 'button';
    saveButton.textContent = 'Save Local Extras';
    saveButton.addEventListener('click', handleSave);

    const importButton = document.createElement('button');
    importButton.id = IMPORT_ID;
    importButton.type = 'button';
    importButton.textContent = 'Import Gist List';
    importButton.addEventListener('click', handleImportFromGist);

    const clearButton = document.createElement('button');
    clearButton.id = CLEAR_ID;
    clearButton.type = 'button';
    clearButton.textContent = 'Clear Local Extras';
    clearButton.addEventListener('click', handleClear);

    actions.appendChild(saveButton);
    actions.appendChild(importButton);
    actions.appendChild(clearButton);

    const status = document.createElement('div');
    status.id = STATUS_ID;
    status.setAttribute('aria-live', 'polite');

    const current = document.createElement('div');
    current.className = 'tm-pe-local-solved-current';
    current.innerHTML = `<strong>Stored locally:</strong> <span id="${COUNT_ID}">0</span>`;

    const list = document.createElement('div');
    list.id = LIST_ID;
    list.textContent = 'None';

    current.appendChild(list);

    panel.appendChild(heading);
    panel.appendChild(description);
    panel.appendChild(textarea);
    panel.appendChild(actions);
    panel.appendChild(status);
    panel.appendChild(current);

    return panel;
  }

  function handleSave() {
    const input = document.getElementById(INPUT_ID);
    if (!input) {
      return;
    }

    saveEditorValue(input.value, 'Saved');
  }

  async function handleImportFromGist() {
    const input = document.getElementById(INPUT_ID);
    if (!input) {
      return;
    }

    setImportButtonLoading(true);
    setStatus('Loading solved problems from gist...');

    try {
      const raw = (await fetchRemoteText(SOLVED_PROBLEMS_GIST_URL)).trim();
      input.value = raw;
      input.dataset.dirty = 'true';
      saveEditorValue(input.value, 'Imported');
    } catch (error) {
      console.warn('Project Euler local solved overlay could not load the gist problem list.', error);
      setStatus(`Could not load the gist problem list: ${error.message}`);
    } finally {
      setImportButtonLoading(false);
    }
  }

  function saveEditorValue(rawValue, actionLabel) {
    const snapshot = latestSnapshot || {
      siteSolved: new Set(),
      totalProblems: 0
    };
    const parsed = parseInput(rawValue, snapshot.totalProblems);
    const alreadySolved = parsed.valid.filter((problemId) => snapshot.siteSolved.has(problemId));
    const localOnly = parsed.valid.filter((problemId) => !snapshot.siteSolved.has(problemId));

    saveStoredProblems(localOnly);
    const input = document.getElementById(INPUT_ID);
    if (input) {
      input.value = localOnly.join(', ');
      input.dataset.dirty = 'false';
    }
    queueApply();

    const messageParts = [];
    if (localOnly.length === 0) {
      messageParts.push(`${actionLabel} an empty local list.`);
    } else {
      messageParts.push(`${actionLabel} ${localOnly.length} local problem${localOnly.length === 1 ? '' : 's'}.`);
    }

    if (alreadySolved.length > 0) {
      messageParts.push(`Skipped ${alreadySolved.length} problem${alreadySolved.length === 1 ? '' : 's'} already solved on Project Euler.`);
    }

    if (parsed.invalid.length > 0) {
      messageParts.push(`Ignored invalid entries: ${summarizeTokens(parsed.invalid)}.`);
    }

    setStatus(messageParts.join(' '));
  }

  function handleClear() {
    const input = document.getElementById(INPUT_ID);
    saveStoredProblems([]);
    if (input) {
      input.value = '';
      input.dataset.dirty = 'false';
    }

    setStatus('Cleared all locally stored extra solved problems.');
    queueApply();
  }

  function updatePanelState(storedLocal) {
    const count = document.getElementById(COUNT_ID);
    const list = document.getElementById(LIST_ID);
    if (count) {
      count.textContent = String(storedLocal.length);
    }

    if (list) {
      list.textContent = storedLocal.length > 0 ? storedLocal.join(', ') : 'None';
    }

    syncEditorFromStored(storedLocal);
  }

  function syncEditorFromStored(storedLocal) {
    const input = document.getElementById(INPUT_ID);
    if (!input || input.dataset.dirty === 'true') {
      return;
    }

    const problems = Array.isArray(storedLocal) ? storedLocal : normalizeProblemIds(loadStoredProblems(), latestSnapshot?.totalProblems || 0);
    input.value = problems.join(', ');
    input.dataset.dirty = 'false';
  }

  function setStatus(message) {
    const status = document.getElementById(STATUS_ID);
    if (status) {
      status.textContent = message;
    }
  }

  function setImportButtonLoading(isLoading) {
    const button = document.getElementById(IMPORT_ID);
    if (!button) {
      return;
    }

    button.disabled = isLoading;
    button.textContent = isLoading ? 'Importing...' : 'Import Gist List';
  }

  function parseInput(raw, totalProblems) {
    const tokens = raw.split(/[\s,]+/).map((token) => token.trim()).filter(Boolean);
    const invalid = [];
    const valid = [];
    const seen = new Set();

    tokens.forEach((token) => {
      if (!/^\d+$/.test(token)) {
        invalid.push(token);
        return;
      }

      const problemId = Number(token);
      if (problemId < 1 || (totalProblems > 0 && problemId > totalProblems)) {
        invalid.push(token);
        return;
      }

      if (seen.has(problemId)) {
        return;
      }

      seen.add(problemId);
      valid.push(problemId);
    });

    valid.sort((left, right) => left - right);
    return { valid, invalid };
  }

  function summarizeTokens(tokens) {
    const uniqueTokens = [];
    const seen = new Set();

    tokens.forEach((token) => {
      if (seen.has(token)) {
        return;
      }

      seen.add(token);
      uniqueTokens.push(token);
    });

    const preview = uniqueTokens.slice(0, 8).join(', ');
    if (uniqueTokens.length <= 8) {
      return preview;
    }

    return `${preview}, ...`;
  }

  function loadStoredProblems() {
    try {
      const stored = GM_getValue(STORAGE_KEY, null);
      if (Array.isArray(stored)) {
        return stored;
      }

      const legacy = loadLegacyStoredProblems();
      if (!Array.isArray(legacy) || legacy.length === 0) {
        return [];
      }

      GM_setValue(STORAGE_KEY, legacy);
      window.localStorage.removeItem(STORAGE_KEY);
      return legacy;
    } catch (error) {
      return [];
    }
  }

  function saveStoredProblems(problemIds) {
    const normalized = normalizeProblemIds(problemIds, latestSnapshot?.totalProblems || 0);
    try {
      GM_setValue(STORAGE_KEY, normalized);
    } catch (error) {
      console.warn('Project Euler local solved overlay could not write Tampermonkey storage.', error);
    }
    return normalized;
  }

  function loadLegacyStoredProblems() {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  }

  function normalizeProblemIds(problemIds, totalProblems) {
    const normalized = [];
    const seen = new Set();

    problemIds.forEach((value) => {
      const problemId = Number(value);
      if (!Number.isInteger(problemId) || problemId < 1) {
        return;
      }

      if (totalProblems > 0 && problemId > totalProblems) {
        return;
      }

      if (seen.has(problemId)) {
        return;
      }

      seen.add(problemId);
      normalized.push(problemId);
    });

    normalized.sort((left, right) => left - right);
    return normalized;
  }

  function arraysEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }

    return left.every((value, index) => value === right[index]);
  }

  function fetchRemoteText(url) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('GM_xmlhttpRequest is unavailable.'));
        return;
      }

      GM_xmlhttpRequest({
        method: 'GET',
        url,
        timeout: 15000,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText || '');
            return;
          }

          reject(new Error(`Request failed with status ${response.status}.`));
        },
        onerror: () => {
          reject(new Error('Network request failed.'));
        },
        ontimeout: () => {
          reject(new Error('Request timed out.'));
        }
      });
    });
  }
})();
