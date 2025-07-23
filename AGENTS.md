# Repository Guidelines for AI Agents

This repository hosts various Tampermonkey userscripts. When modifying the code or documentation, agents should follow these rules:

1. **Keep script headers intact** – do not remove the existing `==UserScript==` metadata blocks.
2. **One folder per site** – new scripts should reside in a folder named after the target site. Include a `README.md` describing each script.
3. **Update documentation** – if scripts are added or removed, update the appropriate `README.md` files. The root `README.md` only lists folders.
4. **No build step required** – scripts are plain JavaScript files and do not require compilation or external dependencies.
5. **Testing** – there are no automated tests. Verify that scripts load in Tampermonkey and lint JavaScript if possible.

