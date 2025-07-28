// ==UserScript==
// @name         Transaction Accounting Autofill
// @namespace    https://github.com/brucehart/userscripts
// @version      1.2
// @description  Adds a command window to copy accounting codes from previous transactions.
// @author       Bruce J. Hart
// @match        https://www.globalmanagement.citidirect.com/sdng/fintrans/a/accountTransSummaryRender.do*
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    // ---------- 1.  STYLES ----------
    GM_addStyle(`
        #autofill-container{position:fixed;top:150px;right:20px;width:320px;background:#f9f9f9;border:1px solid #ccc;border-radius:8px;
            box-shadow:0 4px 8px rgba(0,0,0,.1);z-index:10001;font:14px Arial,sans-serif;display:none;flex-direction:column;padding:15px}
        #autofill-container h3{margin:0 0 15px;font-size:16px;color:#333;text-align:center}
        #autofill-select{width:100%;padding:8px;margin-bottom:10px;border-radius:4px;border:1px solid #ddd}
        #autofill-button,#autofill-close-button{padding:10px 15px;cursor:pointer;border:none;border-radius:4px;color:#fff;font-size:14px}
        #autofill-button{background:#4caf50;flex-grow:1;margin-right:10px}
        #autofill-button:hover{background:#45a049}
        #autofill-close-button{background:#f44336}
        #autofill-close-button:hover{background:#da190b}
        #toggle-autofill-window{position:fixed;top:150px;right:20px;z-index:10000;background:#007bff;color:#fff;
            padding:10px 15px;border-radius:5px;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,.1)}
        .autofill-button-container{display:flex;justify-content:space-between}
    `);

    // ---------- 2.  UI ----------
    const container = document.createElement('div');
    container.id = 'autofill-container';
    container.innerHTML = `
        <h3>Accounting Autofill</h3>
        <select id="autofill-select"><option value="">-- Select a Template --</option></select>
        <div class="autofill-button-container">
            <button id="autofill-button">Fill Codes</button>
            <button id="autofill-close-button">Close</button>
        </div>`;
    document.body.appendChild(container);

    const toggleBtn = Object.assign(document.createElement('button'), {
        id: 'toggle-autofill-window',
        textContent: 'Show Autofill'
    });
    document.body.appendChild(toggleBtn);

    const dd = document.getElementById('autofill-select');
    let templates = [];

    // ---------- 3.  HELPERS ----------
    // Write value & mimic user typing so host page keeps it
    function fillInput(el, val) {
        el.focus();
        el.value = '';                            // clear any residual
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.value = val;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
    }

    // ---------- 4.  SCAN PAST TRANSACTIONS ----------
    function scanTransactions() {
        templates = [];
        const seen = new Set();
        const rows = document.querySelectorAll('#searchresults > tbody > tr[role="row"]');

        rows.forEach((row, idx) => {
            const staticContent = row.nextElementSibling?.nextElementSibling?.querySelector(`#ca_static_content_${idx}`);
            if (!staticContent) return;

            const desc = staticContent.querySelector(`#expenseDescriptionStatic_${idx}`)?.innerText.trim() || '';
            if (!desc) return; // skip incomplete records

            const codes = {};
            const headers = staticContent.querySelectorAll('th[style*="word-wrap"]');
            const values  = staticContent.querySelectorAll('tr.trCAvalues > td > div[id^="static_acctCodeValueSection_"]');

            headers.forEach((h, i) => {
                const key = h.innerText.trim();
                const val = values[i]?.querySelector('i')?.innerText.trim() || '';
                if (key) codes[key] = val;
            });

            const sig = JSON.stringify({ desc, ...codes });
            if (seen.has(sig)) return;
            seen.add(sig);

            templates.push({
                displayText: `Project: ${codes['Project'] || 'N/A'} | Tax: ${codes['Sales Tax Charged'] || 'N/A'}`,
                data: { desc, codes }
            });
        });

        // refresh dropdown
        dd.innerHTML = '<option value="">-- Select a Template --</option>';
        templates.forEach((t, i) => {
            dd.add(new Option(t.displayText, i));
        });
    }

    // ---------- 5.  APPLY TEMPLATE ----------
    function applyTemplate() {
        const idx = dd.value;
        if (idx === '') return alert('Pick a template first.');

        const editDiv = document.querySelector('div[id^="ca_dynamic_content_"][style=""]');
        if (!editDiv) return alert('Open “Edit Accounting Codes” on a transaction first.');

        const tpl = templates[idx].data;

        // Description textarea
        editDiv.querySelectorAll('textarea[name^="expenseDescription"]').forEach(t => fillInput(t, tpl.desc));

        // Accounting codes
        editDiv.querySelectorAll('label[id^="txtAcctCode_"]').forEach(label => {
            const key = label.innerText.trim();
            if (!(key in tpl.codes)) return;

            const raw = tpl.codes[key];                 // e.g. "1234 - Travel Canada"
            const codeOnly = raw.split(' - ')[0].trim();// => "1234"

            const inpId = label.id.replace('Label', '');
            const el = document.getElementById(inpId) || editDiv.querySelector(`input[aria-labelledby="${label.id}"]`);
            if (!el) return;

            if (el.tagName === 'SELECT') {
                // Prefer exact match on text, else startsWith(codeOnly)
                Array.from(el.options).some(o => {
                    if (o.text.trim() === raw || o.text.trim().startsWith(codeOnly)) {
                        el.value = o.value;
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    }
                    return false;
                });
            } else {
                fillInput(el, codeOnly);
            }
        });

        alert('Accounting codes filled.');
    }

    // ---------- 6.  EVENTS ----------
    document.getElementById('autofill-button').addEventListener('click', applyTemplate);
    toggleBtn.addEventListener('click', () => {
        const v = container.style.display;
        if (!v || v === 'none') {
            scanTransactions();
            container.style.display = 'flex';
            toggleBtn.textContent = 'Hide Autofill';
        } else {
            container.style.display = 'none';
            toggleBtn.textContent = 'Show Autofill';
        }
    });
    document.getElementById('autofill-close-button').addEventListener('click', () => {
        container.style.display = 'none';
        toggleBtn.textContent = 'Show Autofill';
    });
})();
