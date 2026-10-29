import { defineConfig } from 'wxt';
import type { Plugin } from 'vite';

/**
 * Turns vendor/*.user.js into an ES module that exports `run(env)`.
 * The original userscript stays untouched on disk; at build time its body is
 * wrapped in a function whose parameters shadow the Greasemonkey globals
 * (GM_*, unsafeWindow, $, Swal, md5, ...) so nothing leaks onto the page.
 */
function userscriptModule(): Plugin {
  const GLOBALS = [
    'unsafeWindow',
    'GM',
    'GM_info',
    'GM_xmlhttpRequest',
    'GM_setClipboard',
    'GM_setValue',
    'GM_getValue',
    'GM_deleteValue',
    'GM_openInTab',
    'GM_registerMenuCommand',
    'GM_getResourceText',
    '$',
    'jQuery',
    'Swal',
    'md5',
  ];
  return {
    name: 'linkswift-userscript-module',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('.user.js')) return;
      const body = code
        .replace(/^﻿/, '')
        // Page CSPs forbid `new Function` in the main world, and the throw would abort init.
        .replace(
          /^(\s*)(unsafeWindow\.console\.clear\s*=\s*new Function\(.*\);)\s*$/m,
          '$1try { $2 } catch {}',
        );
      return {
        code: `export default function run({ ${GLOBALS.join(', ')} }) {\n${body}\n}\n`,
        map: null,
      };
    },
  };
}

export default defineConfig({
  vite: () => ({
    plugins: [userscriptModule()],
  }),
  manifest: {
    name: 'LinkSwiftExtension',
    description:
      '网盘文件下载地址获取工具 | 百度网盘 / 阿里云盘 / 中国移动云盘 / 天翼云盘 / 迅雷云盘 / 光鸭云盘 / 夸克网盘 / UC网盘 / 123云盘',
    homepage_url: 'https://github.com/hmjz100/LinkSwift/',
    permissions: ['storage', 'clipboardWrite', 'declarativeNetRequestWithHostAccess'],
    // Equivalent of the userscript's `@connect *` (also covers aria2 / ABDM RPC on localhost).
    host_permissions: ['<all_urls>'],
    action: { default_title: 'LinkSwiftExtension' },
  },
});
