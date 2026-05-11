# Instagram

Userscripts for Instagram.

## Instagram View Image in New Tab

Adds a custom right-click menu item on Instagram images named **View Image in New Tab**. Selecting it opens the resolved image URL in a new browser tab.

The script checks normal image elements first, including `srcset` for the largest available image, then falls back to CSS `background-image` URLs on nearby elements.

## Installation

1. Install the Tampermonkey extension in your browser.
2. Open the raw script file: [`Instagram View Image in New Tab-1.0.user.js`](./Instagram%20View%20Image%20in%20New%20Tab-1.0.user.js).
3. Tampermonkey will prompt you to add the script. Confirm the installation.
4. Visit Instagram and right-click an image to use **View Image in New Tab**.
