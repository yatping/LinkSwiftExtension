# LinkSwiftExtension

The [LinkSwift](https://github.com/hmjz100/LinkSwift) userscript (网盘直链下载助手) packaged as a Manifest V3 Chrome extension built with [WXT](https://wxt.dev), so it runs without Tampermonkey.

Supports 百度网盘 / 阿里云盘 / 中国移动云盘 / 天翼云盘 / 迅雷云盘 / 光鸭云盘 / 夸克网盘 / UC网盘 / 123云盘.

## Credits

All of the download-link logic and UI comes from **[LinkSwift](https://github.com/hmjz100/LinkSwift)** by [hmjz100](https://github.com/hmjz100), which is based on 网盘直链下载助手 by 油小猴. This repository only adds the extension wrapper: a Greasemonkey API shim, the background request engine, and the popup. If LinkSwift is useful to you, please ⭐ the [original project](https://github.com/hmjz100/LinkSwift) and report bugs in the script itself [there](https://github.com/hmjz100/LinkSwift/issues).

## Build & install

```bash
npm install
npm run build        # -> .output/chrome-mv3
npm run zip          # -> .output/*.zip
npm run dev          # dev mode with auto-reload
```

Open `chrome://extensions`, turn on Developer mode, click **Load unpacked**, and choose `.output/chrome-mv3`.

The userscript's menu commands (⚙️ 设置 / 🍃️ 美化 / 📃 更新 / 🛠️ 调试) are in the toolbar popup.

## How it works

The userscript is kept **unmodified** in `vendor/linkswift.user.js`. At build time a small Vite plugin (`wxt.config.ts`) wraps it in a function, so the `GM_*` APIs, `$`, `Swal`, and `md5` are passed in as parameters and never become page globals.

| Layer | File | Role |
| --- | --- | --- |
| Main world | `entrypoints/linkswift.content.ts` | Runs the userscript in the page's JS world (it reads page globals). Provides the `GM_*` shim. |
| Isolated world | `entrypoints/bridge.content.ts` | Connects to the shim over a private `MessagePort`. Handles `chrome.storage`, the clipboard, and menu commands. |
| Service worker | `entrypoints/background.ts` | Runs `GM_xmlhttpRequest` with `fetch` and streams the response back. It sets headers fetch can't (Cookie, Referer, User-Agent, Origin) through per-request `declarativeNetRequest` session rules. Also opens tabs. |

## Updating the userscript

```bash
npm run update-userscript   # downloads the latest version from GitHub and regenerates utils/matches.ts
npm run build
```

If only the `@match` list changed locally, run `node scripts/sync-matches.mjs`.

## License

AGPL-3.0-or-later, the same license as upstream [LinkSwift](https://github.com/hmjz100/LinkSwift). `vendor/linkswift.user.js` is © 2022 hmjz100, and the original copyright notices are kept in that file.
