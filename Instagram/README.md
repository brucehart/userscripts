# Instagram

Userscripts for Instagram.

## Instagram View Image in New Tab

Adds a custom right-click menu on Instagram images and videos with actions to:

- **View Image in New Tab**
- **Save Image**
- **Copy Image**
- **View Video in New Tab**
- **Save Video**
- **Copy Video URL**

The script checks video elements first, then normal image elements, including `srcset` for the largest available image, and finally falls back to CSS `background-image` URLs on nearby elements. Images are copied as image data when the browser supports it, with a URL fallback. Videos are copied as their direct video URL. If Instagram only exposes a temporary `blob:` playback URL, the script tries to resolve the real video URL from page data, loaded resource URLs, or the surrounding post or reel page before opening, saving, or copying it.

Some Instagram videos expose separate DASH video and audio streams. When both streams are found, **View Video in New Tab** and **Save Video** download both streams and merge them in the browser with a pinned `ffmpeg.wasm` dependency loaded from unpkg. The first merge can take a moment while FFmpeg loads, and long videos may take longer. **Copy Video URL** copies both source stream URLs when the audio is separate because the merged `blob:` URL only works in the current browser session.

## Installation

1. Install the Tampermonkey extension in your browser.
2. Open the raw script file: [`Instagram View Image in New Tab-1.0.user.js`](./Instagram%20View%20Image%20in%20New%20Tab-1.0.user.js).
3. Tampermonkey will prompt you to add the script. Confirm the installation.
4. Visit Instagram and right-click an image or video to open the custom media menu.
