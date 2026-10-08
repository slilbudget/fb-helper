// Stand-ins for the browser, shared by the unit tests that run the extension's modules in plain Node: a fake chrome.storage / chrome.cookies,
// the Web Locks API, and a fake Graph behind fetch. Nothing here is a test (node --test only runs *.test.mjs).
import { setLang } from "../fb-helper/js/i18n.js";
import { setGraphUrl } from "../fb-helper/js/config.js";
import { state } from "../fb-helper/js/state.js";

// Web Locks stand-in (one at a time is enough for these tests), the Graph origin of the fakes, and the English strings the assertions read.
export async function setup() {
  Object.defineProperty(globalThis, "navigator", { value: { locks: { request: (_name, fn) => fn() } }, configurable: true, writable: true });
  setGraphUrl("https://graph.test/");
  await setLang("en");
}

// chrome.storage.session / local and chrome.cookies, backed by plain objects. → { store (session), local, calls, cookies }.
export function fakeChrome({ session = {}, cookies = {}, local = {} } = {}) {
  const store = structuredClone(session), localStore = structuredClone(local), calls = { get: [], set: [], remove: [], cookie: 0, localSet: [] };
  const keysOf = (src, k) => (typeof k === "string" ? [k] : Array.isArray(k) ? k : Object.keys(k || src));
  globalThis.chrome = {
    storage: {
      session: {
        get: async (keys) => { calls.get.push(keys); return Object.fromEntries(keysOf(store, keys).filter((k) => k in store).map((k) => [k, structuredClone(store[k])])); },
        set: async (patch) => { calls.set.push(patch); Object.assign(store, structuredClone(patch)); },
        remove: async (keys) => { calls.remove.push(keys); for (const k of keysOf(store, keys)) delete store[k]; },
      },
      local: {
        get: async (keys) => Object.fromEntries(keysOf(localStore, keys).filter((k) => k in localStore).map((k) => [k, structuredClone(localStore[k])])),
        set: async (patch) => { calls.localSet.push(patch); Object.assign(localStore, structuredClone(patch)); },
      },
    },
    cookies: { get: async ({ name }) => { calls.cookie++; return name in cookies ? { value: cookies[name] } : null; } },
  };
  return { store, local: localStore, calls, cookies };
}

// A fake Graph behind fetch: handler(url, n) → { status, body, headers, notJson, reject, hang }; every url is recorded, urls.opts holds the second argument
// of every fetch. status / body / headers make the answer; notJson = the body is not JSON (res.json() throws); reject = the fetch itself fails (a
// network error, a timeout: the Error to reject with); hang = never answers, rejects with the signal's reason when the request is aborted.
export function fakeGraph(handler) {
  const urls = [];
  urls.opts = [];
  globalThis.fetch = async (url, opts) => {
    const u = new URL(url); urls.push(u); urls.opts.push(opts);
    const out = handler(u, urls.length) || {};
    if (out.reject) throw out.reject;
    if (out.hang) await new Promise((_, reject) => opts.signal.addEventListener("abort", () => reject(opts.signal.reason)));
    return { ok: (out.status || 200) < 400, status: out.status || 200, headers: new Headers(out.headers || {}),
      json: async () => { if (out.notJson) throw new SyntaxError("Unexpected token < in JSON at position 0"); return out.body; } };
  };
  return urls;
}

// A token, no dead mark, no pause, an empty budget, a fresh skip set and a fake chrome: the state a request starts from.
export const TOKEN = "EAAB" + "x".repeat(70);
export function prime(over = {}) {
  const fake = fakeChrome();
  Object.assign(state, { token: TOKEN, dead: [], cooldownUntil: 0, budget: [], usage: null, gen: state.gen, skip: new Set(), ...over });
  return fake;
}
