# New York Times Userscripts

This directory contains userscripts for New York Times pages.

## NYT Connections Color Cycler
On `https://www.nytimes.com/games/connections` (and `https://www.nytimes.com/crosswords/game/connections`), the first click behaves normally (word selected in dark gray). Repeated clicks on the same word then cycle through unselected hint colors: yellow, green, blue, purple, then back to the default unselected state.

The script also adds `Yellow`, `Blue`, `Green`, `Purple`, `Clear`, and `Clear All` buttons to the page. The color buttons apply that hint color to all currently selected cards, `Clear` removes custom hint colors from the currently selected cards, and `Clear All` removes all custom hint colors from the board.
