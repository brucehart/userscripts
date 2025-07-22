// ==UserScript==
// @name         Yahoo Team Points Extractor with Button
// @namespace    https://github.com/brucehart/userscripts
// @version      1.1
// @description  Adds a button to extract team names and projected points from Yahoo matchups tables, format them, and copy them to the clipboard upon button press.
// @author       Bruce J. Hart
// @match        *://*.yahoo.com/*
// @grant        GM_setClipboard
// ==/UserScript==

(function() {
    'use strict';

    // Create the button
    var button = document.createElement('button');
    button.innerText = 'Copy Team Data';
    button.style.position = 'fixed';
    button.style.top = '10px';
    button.style.right = '10px';
    button.style.zIndex = '1000';
    button.style.padding = '10px';
    button.style.backgroundColor = '#4CAF50';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.cursor = 'pointer';

    // Append button to the page
    document.body.appendChild(button);

    // Add click event to the button
    button.addEventListener('click', function() {
        var teams = [];
        var table = document.querySelector('.matchups-body table tbody');

        if (!table) {
            console.error("Table not found within .matchups-body. Please check the structure.");
            alert("Table not found within .matchups-body. Please check the structure.");
            return;
        }

        var tableRows = table.querySelectorAll('tr');

        tableRows.forEach(function(row) {
            var teamNameWithStanding = row.querySelector('td:nth-child(3)').textContent.trim();
            var projectedPoints = parseFloat(row.querySelector('td:nth-child(4)').textContent.trim());

            var teamNameParts = teamNameWithStanding.split(' ');
            var lastPart = teamNameParts[teamNameParts.length - 1];

            if (/\d+(st|nd|rd|th)$/.test(lastPart)) {
                teamNameParts.pop();
            }

            var cleanTeamName = teamNameParts.join(' ');

            if (projectedPoints > 0) {
                teams.push([cleanTeamName, projectedPoints]);
            }
        });

        var formattedData = teams.map(function(team) {
            return `${team[0]}, ${team[1]}`;
        }).join('\n');

        GM_setClipboard(formattedData);
        console.log("Data copied to clipboard:\n", formattedData);
    });
})();
