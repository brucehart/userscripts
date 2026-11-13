# ESPN

## ESPN Remove Videos

Hides HTML video elements, recognized video player containers, and common embedded video players on ESPN.com and its subdomains. Runs at the start of page loading and watches for players added by scrolling, lazy loading, or navigation within the site. Mutes and pauses native videos, disables autoplay, and stops playback retries.

Version 1.2 keeps player elements and media sources intact. Removing player containers before ESPN's React code initializes can disrupt page rendering, potentially producing "Something Went Wrong" on team pages. Hiding the players allows ESPN to continue managing its own page elements.

Recognized players include ESPN game-page clip players and Disney web players, including players whose video is encapsulated in a shadow root. Recognized embeds include ESPN video URLs, YouTube, Vimeo, Dailymotion, and direct video or streaming playlist URLs. Video thumbnails and links outside recognized player containers remain visible. Hiding players does not block video network requests. Playback inside shadow roots or cross-origin frames cannot be reliably paused by this script; recognized containers are hidden, but audio may still require browser controls.

## Installation

1. Install the Tampermonkey browser extension.
2. Open the raw [`ESPN Remove Videos-1.2.user.js`](./ESPN%20Remove%20Videos-1.2.user.js) file and confirm installation or update in Tampermonkey. Disable any older duplicate installation.
3. Visit or reload an ESPN.com page. No configuration is required.

## Manual verification

With the script enabled, check the [Boston Celtics team page](https://www.espn.com/nba/team/_/name/bos/boston-celtics), an ESPN homepage, and an article that normally contains a video. Confirm that team content renders without "Something Went Wrong", players are hidden, native video audio stops, and article text remains readable. Scroll to load more content and navigate to another story to check dynamically inserted players.
