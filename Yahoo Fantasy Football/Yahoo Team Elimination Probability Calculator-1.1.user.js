// ==UserScript==
// @name         Yahoo Team Elimination Probability Calculator
// @namespace    https://github.com/brucehart/userscripts
// @version      1.1
// @description  Calculate and display the elimination probabilities for Yahoo teams based on their projected scores and a user-defined standard deviation.
// @author       Bruce J. Hart
// @match        https://football.fantasysports.yahoo.com/*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // Default standard deviation
    let stddev = 20.10485;

    // Create input for standard deviation
    const stddevInput = document.createElement('input');
    stddevInput.type = 'number';
    stddevInput.value = stddev;
    stddevInput.placeholder = 'Enter standard deviation';
    stddevInput.style.marginRight = '10px';

    // Create compute button
    const computeButton = document.createElement('button');
    computeButton.innerText = 'Compute Elimination Probabilities';

    // Create floating result dialog
    const resultDialog = document.createElement('div');
    resultDialog.style.position = 'fixed';
    resultDialog.style.top = '20px';
    resultDialog.style.right = '20px';
    resultDialog.style.width = '300px';
    resultDialog.style.padding = '15px';
    resultDialog.style.backgroundColor = 'white';
    resultDialog.style.border = '1px solid #ccc';
    resultDialog.style.zIndex = '1000';
    resultDialog.style.display = 'none';
    resultDialog.style.overflowY = 'auto';
    document.body.appendChild(resultDialog);

    // Append elements to the page
    const controlsContainer = document.createElement('div');
    controlsContainer.style.position = 'fixed';
    controlsContainer.style.top = '10px';
    controlsContainer.style.right = '10px';
    controlsContainer.style.zIndex = '1000';
    controlsContainer.appendChild(stddevInput);
    controlsContainer.appendChild(computeButton);
    document.body.appendChild(controlsContainer);

    // Define the error function erf(x)
    function erf(x) {
        const a1 =  0.254829592;
        const a2 = -0.284496736;
        const a3 =  1.421413741;
        const a4 = -1.453152027;
        const a5 =  1.061405429;
        const p  =  0.3275911;

        const sign = (x >= 0) ? 1 : -1;
        x = Math.abs(x);

        const t = 1.0 / (1.0 + p * x);
        const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

        return sign * y;
    }

    // Standard normal PDF
    function phi(x) {
        const INV_SQRT_2PI = 0.3989422804014327;
        return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
    }

    // Standard normal CDF
    function Phi(x) {
        return 0.5 * (1 + erf(x / Math.sqrt(2)));
    }

    // Compute elimination probability for team i
    function computePi(i, mu, sigma) {
        const mu_min = Math.min(...mu);
        const mu_max = Math.max(...mu);
        const x_min = mu_min - 6 * sigma;
        const x_max = mu_max + 6 * sigma;
        const N = 1000;
        const dx = (x_max - x_min) / N;

        let sum = 0.0;

        for (let k = 0; k <= N; ++k) {
            const x = x_min + k * dx;
            const z_i = (x - mu[i]) / sigma;
            const f_i = phi(z_i) / sigma;

            let product = 1.0;
            for (let j = 0; j < mu.length; ++j) {
                if (j !== i) {
                    const z_j = (x - mu[j]) / sigma;
                    const P_j = 1.0 - Phi(z_j);
                    product *= P_j;
                }
            }

            const integrand = f_i * product;
            sum += (k === 0 || k === N) ? 0.5 * integrand : integrand;
        }

        return sum * dx;
    }

    // Event listener for compute button
    computeButton.addEventListener('click', () => {
        stddev = parseFloat(stddevInput.value);

        const teams = [];
        const table = document.querySelector('.matchups-body table tbody');
        if (!table) {
            alert("Table not found within .matchups-body. Please check the structure.");
            return;
        }

        // Extract team data
        const tableRows = table.querySelectorAll('tr');
        tableRows.forEach(row => {
            const teamNameWithStanding = row.querySelector('td:nth-child(3)').textContent.trim();
            const projectedPoints = parseFloat(row.querySelector('td:nth-child(4)').textContent.trim());
            const teamName = teamNameWithStanding.split(' ').slice(0, -1).join(' ');

            if (projectedPoints > 0) {
                teams.push({ name: teamName, projectedScore: projectedPoints, eliminationProbability: 0.0 });
            }
        });

        const mu = teams.map(team => team.projectedScore);

        // Calculate elimination probabilities
        teams.forEach((team, i) => {
            const eliminationProbability = computePi(i, mu, stddev) * 100.0;
            team.eliminationProbability = Math.round(eliminationProbability * 100) / 100;
        });

        teams.sort((a, b) => b.eliminationProbability - a.eliminationProbability);

        // Display results
        resultDialog.innerHTML = '<strong>Elimination Probabilities:</strong><br>';
        teams.forEach(team => {
            resultDialog.innerHTML += `${team.name}: ${team.eliminationProbability}%<br>`;
        });
        resultDialog.style.display = 'block';
    });

    // Close dialog with escape key
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            resultDialog.style.display = 'none';
        }
    });
})();
