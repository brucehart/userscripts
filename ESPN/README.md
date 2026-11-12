# ESPN

## ESPN Remove Videos

Removes HTML video elements, recognized video player containers, and common embedded video players from ESPN.com and its subdomains. Runs at the start of page loading and watches for players added by scrolling, lazy loading, or navigation within the site. Pauses native videos and releases their media sources before removing them.

Recognized embeds include ESPN video URLs, YouTube, Vimeo, Dailymotion, and direct video or streaming playlist URLs. Video thumbnails and links outside recognized player containers remain visible. This script removes page elements; it does not guarantee that all video network requests are blocked. Players inside closed shadow roots or unrecognized third-party frames may require additional selectors.

## Installation

1. Install the Tampermonkey browser extension.
2. Open the raw [`ESPN Remove Videos-1.0.user.js`](./ESPN%20Remove%20Videos-1.0.user.js) file and confirm installation in Tampermonkey.
3. Visit or reload an ESPN.com page. No configuration is required.

## Manual verification

With the script enabled, check an ESPN homepage and an article that normally contains a video. Confirm that players disappear, audio stops, and article text remains readable. Scroll to load more content and navigate to another story to check dynamically inserted players.
