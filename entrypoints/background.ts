import { XHR_PORT, bytesToBase64, base64ToBytes, type XhrEvent, type XhrRequest } from '@/utils/protocol';

/**
 * Headers fetch() silently drops. GM_xmlhttpRequest lets the userscript set them
 * (Cookie, Referer, User-Agent, Origin...), so they are applied with a per-request
 * declarativeNetRequest session rule instead.
 */
const FORBIDDEN = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
]);
const isForbidden = (name: string) =>
  FORBIDDEN.has(name) || name.startsWith('proxy-') || name.startsWith('sec-');

let nextRuleId = 1;

export default defineBackground(() => {
  // Rules left over from a previous service-worker instance are stale.
  chrome.declarativeNetRequest.getSessionRules().then((rules) => {
    if (rules.length) {
      chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
    }
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== XHR_PORT) return;
    const controller = new AbortController();
    let done = false;
    port.onDisconnect.addListener(() => {
      if (!done) controller.abort();
    });
    port.onMessage.addListener((request: XhrRequest) => {
      const send = (event: XhrEvent) => {
        if (!done) port.postMessage(event);
      };
      performRequest(request, controller, send).finally(() => {
        done = true;
        port.disconnect();
      });
    });
  });

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === 'openTab') {
      chrome.tabs.create({
        url: message.url,
        active: message.active,
        index: sender.tab ? sender.tab.index + 1 : undefined,
        openerTabId: sender.tab?.id,
      });
    }
  });
});

async function performRequest(
  request: XhrRequest,
  controller: AbortController,
  send: (event: XhrEvent) => void,
) {
  const url = new URL(request.url).href;
  const method = (request.method || 'GET').toUpperCase();
  const headers = new Headers();
  const restricted: chrome.declarativeNetRequest.ModifyHeaderInfo[] = [];

  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const lower = name.toLowerCase();
    if (isForbidden(lower)) {
      restricted.push({ header: lower, operation: 'set' as chrome.declarativeNetRequest.HeaderOperation, value });
    } else {
      headers.set(name, value);
    }
  }
  // Like a userscript manager, don't leak the extension's own Origin when none was asked for.
  if (!restricted.some((h) => h.header === 'origin')) {
    restricted.push({ header: 'origin', operation: 'remove' as chrome.declarativeNetRequest.HeaderOperation });
  }

  const ruleId = nextRuleId++;
  await chrome.declarativeNetRequest.updateSessionRules({
    addRules: [
      {
        id: ruleId,
        priority: 1,
        action: {
          type: 'modifyHeaders' as chrome.declarativeNetRequest.RuleActionType,
          requestHeaders: restricted,
        },
        condition: {
          urlFilter: `|${url}|`,
          isUrlFilterCaseSensitive: true,
          tabIds: [chrome.tabs.TAB_ID_NONE],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['xmlhttprequest', 'other'] as chrome.declarativeNetRequest.ResourceType[],
        },
      },
    ],
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (request.timeout && request.timeout > 0) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, request.timeout);
  }

  try {
    send({ type: 'loadstart' });
    const response = await fetch(url, {
      method,
      headers,
      body: method === 'GET' || method === 'HEAD' ? undefined : decodeBody(request, headers),
      credentials: request.anonymous ? 'omit' : 'include',
      redirect: 'follow',
      signal: controller.signal,
    });
    // The request has left the browser with its headers; the rule is no longer needed.
    removeRule(ruleId);

    const total = Number(response.headers.get('content-length')) || 0;
    let rawHeaders = '';
    response.headers.forEach((value, name) => {
      rawHeaders += `${name}: ${value}\r\n`;
    });
    send({
      type: 'headers',
      status: response.status,
      statusText: response.statusText,
      responseHeaders: rawHeaders,
      finalUrl: response.url,
      total,
    });

    if (response.body) {
      const reader = response.body.getReader();
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        send({ type: 'chunk', data: bytesToBase64(value), loaded, total });
      }
    }
    send({ type: 'load' });
  } catch (error) {
    if (timedOut) send({ type: 'timeout' });
    else if (!controller.signal.aborted) send({ type: 'error', error: String(error) });
  } finally {
    clearTimeout(timer);
    removeRule(ruleId);
  }
}

function decodeBody(request: XhrRequest, headers: Headers): BodyInit | undefined {
  const body = request.body;
  if (!body) return undefined;
  switch (body.kind) {
    case 'text':
      return body.value;
    case 'base64':
      return base64ToBytes(body.value);
    case 'form': {
      const form = new FormData();
      for (const [key, value] of body.entries) form.append(key, value);
      headers.delete('content-type'); // let fetch set the multipart boundary
      return form;
    }
  }
}

function removeRule(id: number) {
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
}
