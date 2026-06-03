# New York Times Userscripts

This directory contains userscripts for New York Times pages.

## NYT Connections Color Cycler
On `https://www.nytimes.com/games/connections` (and `https://www.nytimes.com/crosswords/game/connections`), the first click behaves normally (word selected in dark gray). Repeated clicks on the same word then add unselected hint colors in order: yellow, green, blue, purple, then back to the default unselected state. Words with one hint color use a solid background; words with multiple hint colors use repeating diagonal stripes.

The script also adds `Yellow`, `Green`, `Blue`, `Purple`, `Clear`, and `Clear All` buttons to the page. The color buttons add that hint color to all currently selected cards, `Clear` removes all custom hint colors from the currently selected cards, and `Clear All` removes all custom hint colors from the board. Ctrl-click a custom-colored word to select it without clearing its colors before using the toolbar.
