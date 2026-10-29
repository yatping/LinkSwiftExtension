// Downloads the latest LinkSwift userscript from GitHub into vendor/ and refreshes the match list.
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const URL_RAW =
  'https://raw.githubusercontent.com/hmjz100/LinkSwift/main/' +
  encodeURIComponent('（改）网盘直链下载助手.user.js');

const res = await fetch(URL_RAW);
if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
const text = await res.text();
if (!text.includes('==UserScript==')) throw new Error('Downloaded file is not a userscript');

writeFileSync(new URL('../vendor/linkswift.user.js', import.meta.url), text);
console.log(`Saved ${text.length} bytes to vendor/linkswift.user.js`);
execFileSync(process.execPath, [new URL('./sync-matches.mjs', import.meta.url).pathname], { stdio: 'inherit' });
