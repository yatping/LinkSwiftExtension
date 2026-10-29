/**
 * Messages exchanged between the three layers:
 *   main world (userscript + GM shim)  <-MessagePort->  isolated bridge  <-chrome.runtime->  background
 */

export const HELLO = '__linkswift_hello__';
export const BRIDGE_READY = '__linkswift_bridge_ready__';
export const XHR_PORT = 'linkswift-xhr';
export const STORAGE_PREFIX = 'gm:';

/** Request body, serialised so it can cross chrome.runtime messaging (JSON only). */
export type SerializedBody =
  | { kind: 'text'; value: string }
  | { kind: 'base64'; value: string }
  | { kind: 'form'; entries: [string, string][] };

export interface XhrRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: SerializedBody;
  timeout?: number;
  anonymous?: boolean;
}

/** Background -> bridge events for one request (one chrome.runtime port per request). */
export type XhrEvent =
  | { type: 'loadstart' }
  | {
      type: 'headers';
      status: number;
      statusText: string;
      responseHeaders: string;
      finalUrl: string;
      total: number;
    }
  | { type: 'chunk'; data: string; loaded: number; total: number }
  | { type: 'load' }
  | { type: 'error'; error: string }
  | { type: 'timeout' };

/** Main world -> bridge. */
export type MainMessage =
  | { type: 'storage:set'; key: string; value: unknown }
  | { type: 'storage:delete'; key: string }
  | { type: 'clipboard'; text: string }
  | { type: 'openTab'; url: string; active: boolean }
  | { type: 'menu:register'; id: number; caption: string }
  | { type: 'xhr:start'; reqId: number; request: XhrRequest }
  | { type: 'xhr:abort'; reqId: number };

/** Bridge -> main world. */
export type BridgeMessage =
  | { type: 'init'; storage: Record<string, unknown>; version: string }
  | { type: 'storage:changed'; key: string; value: unknown; deleted: boolean }
  | { type: 'menu:invoke'; id: number }
  | { type: 'xhr:headers'; reqId: number; status: number; statusText: string; responseHeaders: string; finalUrl: string; total: number }
  | { type: 'xhr:progress'; reqId: number; loaded: number; total: number }
  | { type: 'xhr:load'; reqId: number; body: ArrayBuffer }
  | { type: 'xhr:error'; reqId: number; error: string }
  | { type: 'xhr:timeout'; reqId: number };

/** Popup/background -> bridge (chrome.tabs.sendMessage). */
export type TabMessage = { type: 'menu:list' } | { type: 'menu:invoke'; id: number };

export interface MenuCommand {
  id: number;
  caption: string;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
