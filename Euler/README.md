# Project Euler Userscripts

This directory contains userscripts for Project Euler pages.

## Project Euler Progress Local Solved Overlay
On `https://projecteuler.net/progress`, adds a small panel for storing extra solved problem IDs in Tampermonkey storage. Those stored IDs are rendered as solved on the page, and the top solved-problem count is updated without double counting problems that are already marked solved on the site. The panel also includes an import button that pulls the shared solved-problems gist and saves it through the same parsing flow as the textarea.
