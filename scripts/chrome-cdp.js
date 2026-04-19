#!/usr/bin/env node

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      pending.get(msg.id)?.(msg);
      pending.delete(msg.id);
      return;
    }
    for (const fn of listeners) fn(msg);
  };

  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });

  return {
    onEvent(fn) {
      listeners.push(fn);
    },
    send(method, params = {}) {
      return new Promise((resolve) => {
        const mid = ++id;
        pending.set(mid, resolve);
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    },
    close() {
      try {
        ws.close();
      } catch {}
    },
  };
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  return response.json();
}

async function waitForTarget(predicate, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const targets = await fetchJson("http://127.0.0.1:9222/json/list");
    const match = targets.find(predicate);
    if (match) {
      return match;
    }
    await sleep(250);
  }
  throw new Error("target not found");
}

export async function createTarget(url) {
  const version = await fetchJson("http://127.0.0.1:9222/json/version");
  const browser = await connect(version.webSocketDebuggerUrl);
  const created = await browser.send("Target.createTarget", { url });
  browser.close();
  return waitForTarget((target) => target.id === created.result.targetId, 10000);
}

export async function openTarget(url) {
  const target = await createTarget(url);
  return connect(target.webSocketDebuggerUrl);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.error("usage: chrome-cdp.js <url>");
    process.exit(1);
  }

  const target = await createTarget(url);
  console.log(JSON.stringify(target, null, 2));
}
