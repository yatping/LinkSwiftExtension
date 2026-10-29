import $ from 'jquery';
import Swal from 'sweetalert2/dist/sweetalert2.js';
import md5 from 'js-md5';
import swalLight from 'sweetalert2/dist/sweetalert2.min.css?raw';
import swalDark from '@sweetalert2/theme-dark/dark.min.css?raw';
import runLinkSwift from '@/vendor/linkswift.user.js';
import { MATCHES, USERSCRIPT_VERSION } from '@/utils/matches';
import { BRIDGE_READY, HELLO, type BridgeMessage, type MainMessage, type SerializedBody } from '@/utils/protocol';

/**
 * Runs the LinkSwift userscript in the page's own JS world (it reads page globals
 * such as Baidu's `require` and Quark's `factStat`), with a Greasemonkey-compatible
 * API implemented on top of the isolated bridge content script.
 */
export default defineContentScript({
  matches: MATCHES,
  runAt: 'document_start',
  allFrames: true,
  world: 'MAIN',
  async main() {
    const { port, init } = await connectBridge();
    const gm = createGM(port, init);
    runLinkSwift({ ...gm, unsafeWindow: window, $, jQuery: $, Swal, md5 });
  },
});

type InitMessage = Extract<BridgeMessage, { type: 'init' }>;

/**
 * Hands a private MessagePort to the bridge and waits for its `init` reply.
 * Says hello again if the bridge announces itself later (content script order isn't guaranteed).
 */
function connectBridge(): Promise<{ port: MessagePort; init: InitMessage }> {
  return new Promise((resolve) => {
    let connected = false;
    const hello = () => {
      if (connected) return;
      const channel = new MessageChannel();
      channel.port1.onmessage = (e) => {
        if (connected || (e.data as BridgeMessage).type !== 'init') return;
        connected = true;
        window.removeEventListener('message', onReady);
        channel.port1.onmessage = null;
        resolve({ port: channel.port1, init: e.data });
      };
      window.postMessage(HELLO, location.origin, [channel.port2]);
    };
    const onReady = (event: MessageEvent) => {
      if (event.source === window && event.data === BRIDGE_READY) hello();
    };
    window.addEventListener('message', onReady);
    hello();
  });
}

type Handler = ((response: GMResponse) => void) | undefined;

interface GMRequestDetails {
  method?: string;
  url: string | URL;
  headers?: Record<string, unknown>;
  data?: unknown;
  responseType?: '' | 'text' | 'json' | 'blob' | 'arraybuffer' | 'document';
  timeout?: number;
  anonymous?: boolean;
  onloadstart?: Handler;
  onreadystatechange?: Handler;
  onprogress?: Handler;
  onload?: Handler;
  onerror?: Handler;
  ontimeout?: Handler;
  onabort?: Handler;
  onloadend?: Handler;
}

interface GMResponse {
  readyState: number;
  status: number;
  statusText: string;
  responseHeaders: string;
  finalUrl: string;
  response?: unknown;
  responseText?: string;
  responseXML?: Document | null;
  loaded?: number;
  total?: number;
  lengthComputable?: boolean;
  error?: string;
}

function createGM(bridge: MessagePort, init: InitMessage) {
  const send = (message: MainMessage) => bridge.postMessage(message);
  const storage = new Map(Object.entries(init.storage));
  const menuHandlers = new Map<number, () => void>();
  const requests = new Map<number, (message: BridgeMessage) => void>();
  let nextId = 1;

  bridge.onmessage = (e) => {
    const message = e.data as BridgeMessage;
    switch (message.type) {
      case 'storage:changed':
        if (message.deleted) storage.delete(message.key);
        else storage.set(message.key, message.value);
        break;
      case 'menu:invoke':
        menuHandlers.get(message.id)?.();
        break;
      default:
        if ('reqId' in message) requests.get(message.reqId)?.(message);
    }
  };

  const clone = <T,>(value: T): T => (value === undefined ? value : structuredClone(value));

  const GM_getValue = (key: string, defaultValue?: unknown) =>
    storage.has(key) ? clone(storage.get(key)) : defaultValue;
  const GM_setValue = (key: string, value: unknown) => {
    // Round-trip through JSON like userscript managers do (drops functions/undefined).
    const stored = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    storage.set(key, stored);
    send({ type: 'storage:set', key, value: stored });
  };
  const GM_deleteValue = (key: string) => {
    storage.delete(key);
    send({ type: 'storage:delete', key });
  };
  const GM_setClipboard = (text: unknown) => send({ type: 'clipboard', text: String(text) });
  const GM_openInTab = (url: string, options?: boolean | { active?: boolean }) => {
    const active = typeof options === 'boolean' ? !options : options?.active !== false;
    send({ type: 'openTab', url: new URL(url, location.href).href, active });
  };
  const GM_registerMenuCommand = (caption: string, handler: () => void) => {
    const id = nextId++;
    menuHandlers.set(id, handler);
    send({ type: 'menu:register', id, caption });
    return id;
  };
  const resources: Record<string, string> = { SwalLigt: swalLight, SwalDark: swalDark };
  const GM_getResourceText = (name: string) => resources[name] ?? null;

  const GM_xmlhttpRequest = (details: GMRequestDetails) => {
    const reqId = nextId++;
    let state: GMResponse = {
      readyState: 1,
      status: 0,
      statusText: '',
      responseHeaders: '',
      finalUrl: String(details.url),
    };
    let settled = false;
    const fire = (name: keyof GMRequestDetails, extra: Partial<GMResponse> = {}) => {
      const handler = details[name] as Handler;
      try {
        handler?.call(control, { ...state, ...extra });
      } catch (error) {
        console.error('[LinkSwift] GM_xmlhttpRequest callback failed', error);
      }
    };
    const end = () => {
      settled = true;
      requests.delete(reqId);
      fire('onloadend');
    };

    requests.set(reqId, (message) => {
      if (settled) return;
      switch (message.type) {
        case 'xhr:headers':
          state = { ...state, readyState: 2, status: message.status, statusText: message.statusText, responseHeaders: message.responseHeaders, finalUrl: message.finalUrl };
          fire('onreadystatechange');
          if (!settled) {
            state = { ...state, readyState: 3 };
            fire('onreadystatechange');
          }
          break;
        case 'xhr:progress':
          fire('onprogress', { loaded: message.loaded, total: message.total, lengthComputable: message.total > 0 });
          break;
        case 'xhr:load':
          state = { ...state, readyState: 4, ...decodeResponse(message.body, details.responseType, state.responseHeaders) };
          fire('onreadystatechange');
          fire('onload');
          end();
          break;
        case 'xhr:error':
          state = { ...state, readyState: 4, error: message.error };
          fire('onerror');
          end();
          break;
        case 'xhr:timeout':
          state = { ...state, readyState: 4 };
          fire('ontimeout');
          end();
          break;
      }
    });

    const control = {
      abort() {
        if (settled) return;
        send({ type: 'xhr:abort', reqId });
        state = { ...state, readyState: 4 };
        fire('onabort');
        end();
      },
      getAllResponseHeaders: () => state.responseHeaders,
    };

    serializeBody(details.data).then((body) => {
      if (settled) return;
      send({
        type: 'xhr:start',
        reqId,
        request: {
          method: details.method ?? 'GET',
          url: new URL(String(details.url), location.href).href,
          headers: flattenHeaders(details.headers),
          body,
          timeout: details.timeout,
          anonymous: details.anonymous,
        },
      });
      fire('onloadstart');
    });
    return control;
  };

  const GM_info = {
    script: {
      name: 'LinkSwift',
      version: USERSCRIPT_VERSION,
      author: 'Hmjz100、油小猴',
      matches: MATCHES,
    },
    scriptHandler: 'LinkSwiftExtension',
    version: init.version,
  };

  const GM = {
    info: GM_info,
    getValue: async (key: string, def?: unknown) => GM_getValue(key, def),
    setValue: async (key: string, value: unknown) => GM_setValue(key, value),
    deleteValue: async (key: string) => GM_deleteValue(key),
    setClipboard: async (text: unknown) => GM_setClipboard(text),
    openInTab: async (url: string, options?: boolean | { active?: boolean }) => GM_openInTab(url, options),
    xmlHttpRequest: GM_xmlhttpRequest,
    registerMenuCommand: GM_registerMenuCommand,
    getResourceText: async (name: string) => GM_getResourceText(name),
  };

  return {
    GM,
    GM_info,
    GM_xmlhttpRequest,
    GM_setClipboard,
    GM_setValue,
    GM_getValue,
    GM_deleteValue,
    GM_openInTab,
    GM_registerMenuCommand,
    GM_getResourceText,
  };
}

function flattenHeaders(headers: Record<string, unknown> = {}): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue;
    flat[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return flat;
}

async function serializeBody(data: unknown): Promise<SerializedBody | undefined> {
  if (data === undefined || data === null) return undefined;
  if (typeof data === 'string') return { kind: 'text', value: data };
  if (data instanceof URLSearchParams) return { kind: 'text', value: data.toString() };
  if (data instanceof FormData) {
    return { kind: 'form', entries: [...data.entries()].map(([k, v]) => [k, String(v)]) };
  }
  if (data instanceof Blob) return { kind: 'base64', value: toBase64(new Uint8Array(await data.arrayBuffer())) };
  if (data instanceof ArrayBuffer) return { kind: 'base64', value: toBase64(new Uint8Array(data)) };
  if (ArrayBuffer.isView(data)) {
    return { kind: 'base64', value: toBase64(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)) };
  }
  return { kind: 'text', value: String(data) };
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function decodeResponse(
  buffer: ArrayBuffer,
  responseType: GMRequestDetails['responseType'],
  rawHeaders: string,
): Partial<GMResponse> {
  const contentType = /^content-type:\s*(.*)$/im.exec(rawHeaders)?.[1]?.trim() ?? '';
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim();
  const text = () => {
    try {
      return new TextDecoder(charset || 'utf-8').decode(buffer);
    } catch {
      return new TextDecoder().decode(buffer);
    }
  };
  switch (responseType) {
    case 'arraybuffer':
      return { response: buffer };
    case 'blob':
      return { response: new Blob([buffer], { type: contentType }) };
    case 'json': {
      const responseText = text();
      let response: unknown;
      try {
        response = JSON.parse(responseText);
      } catch {
        response = undefined;
      }
      return { response, responseText };
    }
    case 'document': {
      const responseText = text();
      const doc = new DOMParser().parseFromString(responseText, contentType.includes('xml') ? 'text/xml' : 'text/html');
      return { response: doc, responseText, responseXML: doc };
    }
    default: {
      const responseText = text();
      return { response: responseText, responseText };
    }
  }
}
