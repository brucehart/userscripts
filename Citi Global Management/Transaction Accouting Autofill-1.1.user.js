// ==UserScript==
// @name         Transaction Accounting Autofill
// @namespace    https://github.com/brucehart/userscripts
// @version      1.1
// @description  Adds a command window to copy accounting codes from previous transactions.
// @author       Bruce J. Hart
// @match        https://www.globalmanagement.citidirect.com/sdng/fintrans/a/accountTransSummaryRender.do*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
    'use strict';

    // --- 1. STYLES FOR THE COMMAND WINDOW ---
    // This function injects CSS into the page to style our floating window.
    GM_addStyle(`
        #autofill-container {
            position: fixed;
            top: 150px;
            right: 20px;
            width: 320px;
            background-color: #f9f9f9;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            z-index: 10001;
            font-family: Arial, sans-serif;
            font-size: 14px;
            display: none; /* Initially hidden */
            flex-direction: column;
            padding: 15px;
        }
        #autofill-container h3 {
            margin-top: 0;
            margin-bottom: 15px;
            font-size: 16px;
            color: #333;
            text-align: center;
        }
        #autofill-select {
            width: 100%;
            padding: 8px;
            margin-bottom: 10px;
            border-radius: 4px;
            border: 1px solid #ddd;
        }
        #autofill-button, #autofill-close-button {
            padding: 10px 15px;
            cursor: pointer;
            border: none;
            border-radius: 4px;
            color: white;
            font-size: 14px;
        }
        #autofill-button {
            background-color: #4CAF50; /* Green */
            flex-grow: 1;
            margin-right: 10px;
        }
        #autofill-button:hover {
            background-color: #45a049;
        }
        #autofill-close-button {
            background-color: #f44336; /* Red */
        }
        #autofill-close-button:hover {
            background-color: #da190b;
        }
        #toggle-autofill-window {
            position: fixed;
            top: 150px;
            right: 20px;
            z-index: 10000;
            background-color: #007bff;
            color: white;
            padding: 10px 15px;
            border-radius: 5px;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .autofill-button-container {
            display: flex;
            justify-content: space-between;
        }
    `);

    // --- 2. CREATE AND APPEND THE UI ELEMENTS ---
    // The main container for our tool
    const container = document.createElement('div');
    container.id = 'autofill-container';
    container.innerHTML = `
        <h3>Accounting Autofill</h3>
        <select id="autofill-select">
            <option value="">-- Select a Template --</option>
        </select>
        <div class="autofill-button-container">
            <button id="autofill-button">Fill Codes</button>
            <button id="autofill-close-button">Close</button>
        </div>
    `;
    document.body.appendChild(container);

    // The button to show/hide the tool
    const toggleButton = document.createElement('button');
    toggleButton.id = 'toggle-autofill-window';
    toggleButton.textContent = 'Show Autofill';
    document.body.appendChild(toggleButton);

    const autofillSelect = document.getElementById('autofill-select');
    let transactionTemplates = [];

    // --- 3. CORE LOGIC FUNCTIONS ---

    /**
     * Finds and parses all completed transactions on the page to create templates.
     */
    function scanTransactions() {
        console.log("Scanning for completed transactions...");
        transactionTemplates = [];
        const uniqueTemplates = new Set();

        const transactionRows = document.querySelectorAll('#searchresults > tbody > tr[role="row"]');

        transactionRows.forEach((row, index) => {
            const staticContent = row.nextElementSibling.nextElementSibling.querySelector(`#ca_static_content_${index}`);
            if (!staticContent) return;

            // Extract the expense description
            const descDiv = staticContent.querySelector(`#expenseDescriptionStatic_${index}`);
            const description = descDiv ? descDiv.innerText.trim() : '';

            // If there's no description, it's likely not a filled-out transaction
            if (!description) return;

            // Extract accounting codes
            const codes = {};
            const codeHeaders = Array.from(staticContent.querySelectorAll('th[style*="word-wrap"]'));
            const codeValues = Array.from(staticContent.querySelectorAll('tr.trCAvalues > td > div[id^="static_acctCodeValueSection_"]'));

            codeHeaders.forEach((header, i) => {
                const key = header.innerText.trim();
                const valueDiv = codeValues[i];
                if (key && valueDiv) {
                    // Get the text from the 'i' tag, which holds the actual value
                    const valueNode = valueDiv.querySelector('i');
                    codes[key] = valueNode ? valueNode.innerText.trim() : '';
                }
            });

            // Create a unique key for this combination to avoid duplicates
            const templateKey = JSON.stringify({ description, ...codes });

            if (!uniqueTemplates.has(templateKey)) {
                uniqueTemplates.add(templateKey);
                transactionTemplates.push({
                    displayText: `Project: ${codes['Project'] || 'N/A'} | Tax: ${codes['Sales Tax Charged'] || 'N/A'}`,
                    data: { description, codes }
                });
            }
        });

        populateDropdown();
        console.log(`Found ${transactionTemplates.length} unique transaction templates.`);
    }

    /**
     * Fills the dropdown with the templates found by scanTransactions.
     */
    function populateDropdown() {
        autofillSelect.innerHTML = '<option value="">-- Select a Template --</option>'; // Clear existing options
        transactionTemplates.forEach((template, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = template.displayText;
            autofillSelect.appendChild(option);
        });
    }

    /**
     * Applies the selected template to the currently open transaction for editing.
     */
    function applySelectedTemplate() {
        const selectedIndex = autofillSelect.value;
        if (selectedIndex === "") {
            alert("Please select a template from the dropdown first.");
            return;
        }

        // Find which transaction is currently in edit mode
        const openEditDiv = document.querySelector('div[id^="ca_dynamic_content_"][style=""]');
        if (!openEditDiv) {
            alert("Please click 'Edit Accounting Codes' on a transaction before trying to fill.");
            return;
        }

        const template = transactionTemplates[selectedIndex].data;
        console.log("Applying template:", template);

        // Fill the expense description
        const descTextarea = openEditDiv.querySelector('textarea[name^="expenseDescription"]');
        if (descTextarea) {
            descTextarea.value = template.description;
        }

        // Fill the accounting codes
        const codeHeaders = Array.from(openEditDiv.querySelectorAll('label[id^="txtAcctCode_"]'));

        codeHeaders.forEach(label => {
            const key = label.innerText.trim();
            if (template.codes.hasOwnProperty(key)) {
                const inputId = label.id.replace('Label', '');
                const inputElement = document.getElementById(inputId) || document.querySelector(`input[aria-labelledby="${label.id}"]`);

                if (inputElement) {
                    if (inputElement.tagName === 'SELECT') {
                        // For dropdowns, find the option whose text matches
                        for (let option of inputElement.options) {
                            if (option.text === template.codes[key]) {
                                option.selected = true;
                                break;
                            }
                        }
                    } else {
                        // For text inputs
                        inputElement.value = template.codes[key];
                    }
                    // Trigger a change event so the page recognizes the update
                    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });

        alert("Accounting codes have been filled.");
    }


    // --- 4. EVENT LISTENERS ---
    document.getElementById('autofill-button').addEventListener('click', applySelectedTemplate);

    toggleButton.addEventListener('click', () => {
        const container = document.getElementById('autofill-container');
        if (container.style.display === 'none' || container.style.display === '') {
            scanTransactions(); // Re-scan every time it's opened
            container.style.display = 'flex';
            toggleButton.textContent = 'Hide Autofill';
        } else {
            container.style.display = 'none';
            toggleButton.textContent = 'Show Autofill';
        }
    });

    document.getElementById('autofill-close-button').addEventListener('click', () => {
        document.getElementById('autofill-container').style.display = 'none';
        toggleButton.textContent = 'Show Autofill';
    });

})();