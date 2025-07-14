# Userscripts

This repository contains a collection of userscripts designed for use with [Tampermonkey](https://www.tampermonkey.net/). Userscripts are small pieces of JavaScript that can modify or enhance websites directly in your browser. They run after a page loads and can add new features, automate tasks or change the look and feel of a site.

## What is Tampermonkey?

[Tampermonkey](https://www.tampermonkey.net/) is a popular browser extension that allows you to install and manage userscripts. It is available for Chrome, Firefox, Edge and other browsers. Once installed, Tampermonkey provides an interface to enable, disable and edit individual scripts.

## Installing Tampermonkey

1. Visit the [Tampermonkey download page](https://www.tampermonkey.net/) in your browser.
2. Choose the appropriate version for your browser (e.g. Chrome Web Store for Chrome users, Add-ons page for Firefox, etc.).
3. Install the extension and accept any prompts that your browser displays.

After installation you should see the Tampermonkey icon in your browser toolbar.

## Using the scripts in this repository

1. Click on any of the `*.user.js` files in this repository to open the raw script.
2. Your browser will detect that you have Tampermonkey installed and will prompt you to install the script.
3. Confirm the installation. The script will now appear in your Tampermonkey dashboard.
4. Visit the site specified in the `@match` section of the script header (for example, the Yahoo Fantasy Football pages for the scripts in the `Yahoo Fantasy Football` directory).

You can enable or disable scripts at any time through the Tampermonkey dashboard. Each script also contains inline comments describing what it does and any options you can configure.

## Yahoo Fantasy Football Scripts

The `Yahoo Fantasy Football` folder includes two scripts:

- **Yahoo Team Elimination Probability Calculator** – calculates elimination probabilities for each team and displays them on the matchups page.
- **Yahoo Team Points Extractor with Button** – adds a button to quickly copy team names and projected points to your clipboard.

Feel free to customize these scripts to suit your league or use them as examples for your own experiments.

## License

This repository is released under the MIT License. See the [LICENSE](LICENSE) file for details.
