# NY Post

## NY Post Remove Videos

Removes HTML video elements and recognized video players from NYPost.com and its subdomains. Based on the ESPN Remove Videos script, it runs at the start of page loading and watches for players added by scrolling, lazy loading, or navigation within the site. Native videos are paused and their media sources released before removal.

Targets NY Post's video player containers, homepage video previews, JW Player, the Connatix outstream video slot, and WordPress video blocks. Recognized embeds include YouTube, Vimeo, Dailymotion, JW Player, and direct video or streaming playlist URLs. Article text, images, and links outside video containers remain visible.

This script removes page elements; it does not guarantee that all video network requests are blocked. Videos inside closed shadow roots or unrecognized third-party frames may require additional selectors.

## Installation

1. Install the Tampermonkey browser extension.
2. Open the raw [`NY Post Remove Videos-1.0.user.js`](./NY%20Post%20Remove%20Videos-1.0.user.js) file and confirm installation in Tampermonkey.
3. Visit or reload an NYPost.com page. No configuration is required.

## Manual verification

With the script enabled, check the homepage and an article that normally contains video. Confirm that homepage video previews, article players, embedded videos, and floating players disappear, audio stops, and article text and images remain readable. Scroll to load more content and navigate to another story to check dynamically inserted players. Check a video article as well as a story with an embedded YouTube video.
