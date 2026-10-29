import { MATCHES } from '@/utils/matches';
import {
  BRIDGE_READY,
  HELLO,
  STORAGE_PREFIX,
  XHR_PORT,
  base64ToBytes,
  type BridgeMessage,
  type MainMessage,
  type MenuCommand,
  type TabMessage,
  type XhrEvent,
} from '@/utils/protocol';

/**
 * Isolated-world half of the GM API. The main-world script cannot touch chrome.*,
 * so it talks to this script over a private MessagePort, and this script forwards
 * to chrome.storage / the background service worker.
 */
export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_start',
  allFrames: true,
  main() {
    let port: MessagePort | undefined;
    const menu: MenuCommand[] = [];
    const requests = new Map<number, chrome.runtime.Port>();

    const post = (message: BridgeMessage, transfer: Transferable[] = []) => port?.postMessage(message, transfer);

    // Accept exactly one port: the main-world script runs before any page script at
    // document_start, so the first HELLO is ours.
    const onWindowMessage = async (event: MessageEvent) => {
      if (event.source !== window || event.data !== HELLO || port || !event.ports[0]) return;
      window.removeEventListener('message', onWindowMessage);
      port = event.ports[0];
      port.onmessage = (e) => handle(e.data as MainMessage);
      post({ type: 'init', storage: await readStorage(), version: chrome.runtime.getManifest().version });
    };
    window.addEventListener('message', onWindowMessage);
    // In case the main-world script was injected first and its HELLO went unheard.
    window.postMessage(BRIDGE_READY, location.origin);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [fullKey, change] of Object.entries(changes)) {
        if (!fullKey.startsWith(STORAGE_PREFIX)) continue;
        const key = fullKey.slice(STORAGE_PREFIX.length);
        post({ type: 'storage:changed', key, value: change.newValue, deleted: !('newValue' in change) });
      }
    });

    chrome.runtime.onMessage.addListener((message: TabMessage, _sender, sendResponse) => {
      if (window !== window.top && menu.length === 0) return; // let the frame that owns the menu answer
      if (message.type === 'menu:list') sendResponse(menu);
      else if (message.type === 'menu:invoke') post({ type: 'menu:invoke', id: message.id });
    });

    function handle(message: MainMessage) {
      switch (message.type) {
        case 'storage:set':
          chrome.storage.local.set({ [STORAGE_PREFIX + message.key]: message.value });
          break;
        case 'storage:delete':
          chrome.storage.local.remove(STORAGE_PREFIX + message.key);
          break;
        case 'clipboard':
          copyText(message.text);
          break;
        case 'openTab':
          chrome.runtime.sendMessage(message);
          break;
        case 'menu:register':
          menu.push({ id: message.id, caption: message.caption });
          break;
        case 'xhr:start':
          startRequest(message.reqId, message.request);
          break;
        case 'xhr:abort':
          requests.get(message.reqId)?.disconnect();
          requests.delete(message.reqId);
          break;
      }
    }

    function startRequest(reqId: number, request: Extract<MainMessage, { type: 'xhr:start' }>['request']) {
      const bg = chrome.runtime.connect({ name: XHR_PORT });
      requests.set(reqId, bg);
      const chunks: Uint8Array[] = [];
      let size = 0;
      let finished = false;
      const finish = () => {
        finished = true;
        requests.delete(reqId);
      };

      bg.onMessage.addListener((event: XhrEvent) => {
        switch (event.type) {
          case 'headers':
            post({ type: 'xhr:headers', reqId, ...omitType(event) });
            break;
          case 'chunk': {
            const bytes = base64ToBytes(event.data);
            chunks.push(bytes);
            size += bytes.byteLength;
            post({ type: 'xhr:progress', reqId, loaded: event.loaded, total: event.total });
            break;
          }
          case 'load': {
            const body = new Uint8Array(size);
            let offset = 0;
            for (const chunk of chunks) {
              body.set(chunk, offset);
              offset += chunk.byteLength;
            }
            finish();
            post({ type: 'xhr:load', reqId, body: body.buffer }, [body.buffer]);
            break;
          }
          case 'error':
            finish();
            post({ type: 'xhr:error', reqId, error: event.error });
            break;
          case 'timeout':
            finish();
            post({ type: 'xhr:timeout', reqId });
            break;
        }
      });
      bg.onDisconnect.addListener(() => {
        // Background went away (e.g. service worker restarted) without a terminal event.
        if (!finished && requests.has(reqId)) {
          finish();
          post({ type: 'xhr:error', reqId, error: 'Connection to background lost' });
        }
      });
      bg.postMessage(request);
    }
  },
});

async function readStorage(): Promise<Record<string, unknown>> {
  const all = await chrome.storage.local.get(null);
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(STORAGE_PREFIX)) values[key.slice(STORAGE_PREFIX.length)] = value;
  }
  return values;
}

/** With the clipboardWrite permission, execCommand works from a content script without a user gesture. */
function copyText(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;top:-9999px;opacity:0';
  (document.body ?? document.documentElement).append(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) navigator.clipboard?.writeText(text).catch(() => {});
}

function omitType<T extends { type: string }>(event: T): Omit<T, 'type'> {
  const { type: _type, ...rest } = event;
  return rest;
}
