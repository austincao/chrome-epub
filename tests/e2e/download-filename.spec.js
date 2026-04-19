import path from "node:path";
import { mkdirSync } from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { test as base, chromium, expect } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..", "..");
const pathToExtension = path.join(repoRoot, "dist");

const TITLE_MARKER = "PlaywrightEPUBTitleZ9Y8X7";

const test = base.extend({
  context: async ({}, use) => {
    const userDataDir = path.join(os.tmpdir(), `chrome-epub-pw-${process.pid}-${Date.now()}`);
    mkdirSync(userDataDir, { recursive: true });
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });
    await use(context);
    await context.close();
  },
});

test("exported EPUB download path contains article title (not generic 下载)", async ({ context }) => {
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  const extensionId = serviceWorker.url().split("/")[2];

  // Drive the extension from an extension-origin page (options). Evaluating on the MV3
  // service worker from Playwright can fail with "Receiving end does not exist".
  const hostPage = await context.newPage();
  await hostPage.goto(`chrome-extension://${extensionId}/options/options.html`, { waitUntil: "load" });

  const articlePage = await context.newPage();
  await articlePage.goto("http://127.0.0.1:8765/article.html", { waitUntil: "networkidle" });
  await new Promise((r) => setTimeout(r, 1500));

  const savedPath = await hostPage.evaluate(
    async ({ titleMarker, exportType }) => {
      const tabs = await chrome.tabs.query({ url: "http://127.0.0.1:8765/*" });
      const tab = tabs.find((t) => t.url?.includes("article.html"));
      if (!tab?.id) {
        throw new Error(`fixture tab not found; tabs=${JSON.stringify(tabs.map((t) => t.url))}`);
      }

      const response = await chrome.runtime.sendMessage({
        type: exportType,
        tabId: tab.id,
      });

      if (!response?.ok) {
        throw new Error(response?.error || "export-tab failed");
      }

      const intendedFilename = response.result?.filename;
      if (typeof intendedFilename !== "string" || !intendedFilename.includes(titleMarker)) {
        throw new Error(`export result.filename missing title: ${JSON.stringify(response.result)}`);
      }

      const downloadId = response.result?.downloadId;
      if (typeof downloadId !== "number") {
        throw new Error(`missing downloadId: ${JSON.stringify(response.result)}`);
      }

      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        const rows = await chrome.downloads.search({ id: downloadId });
        const item = rows[0];
        if (item?.error) {
          throw new Error(String(item.error));
        }

        if (item?.state === "complete" && typeof item.filename === "string") {
          const diskPath = item.filename;
          const playwrightHijack = diskPath.includes("playwright-artifacts");
          if (playwrightHijack) {
            return { intendedFilename, diskPath, playwrightHijack: true };
          }

          if (diskPath.endsWith(".epub") && diskPath.includes(titleMarker)) {
            return { intendedFilename, diskPath, playwrightHijack: false };
          }

          throw new Error(`unexpected disk filename: ${diskPath}; intended=${intendedFilename}`);
        }

        await new Promise((r) => setTimeout(r, 400));
      }

      const rows = await chrome.downloads.search({ id: downloadId });
      throw new Error(`timeout; row=${JSON.stringify(rows[0] ?? null)}`);
    },
    { titleMarker: TITLE_MARKER, exportType: "export-tab" },
  );

  expect(savedPath.intendedFilename).toContain(TITLE_MARKER);
  expect(savedPath.intendedFilename).toMatch(/\.epub$/i);

  if (!savedPath.playwrightHijack) {
    expect(savedPath.diskPath).toContain(TITLE_MARKER);
    expect(savedPath.diskPath).toMatch(/\.epub$/i);
    const baseName = savedPath.diskPath.split(/[/\\]/).pop() ?? "";
    expect(baseName).not.toBe("下载");
    expect(baseName).not.toMatch(/^download(\s*\(\d+\))?\.epub$/i);
  }
});
