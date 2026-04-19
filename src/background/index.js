import { buildEpubObjectUrl } from "../lib/epub.js";
import { buildDownloadFilename } from "../lib/filename.js";
import { CONTEXT_MENU_IDS, MESSAGE_TYPES } from "../lib/messages.js";
import { loadOptions } from "../lib/options.js";

const NOTIFICATION_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k/w8AAAAASUVORK5CYII=";

/** Blob URL → pending filename (until onDeterminingFilename consumes it). */
const pendingByBlobUrl = new Map();
/**
 * FIFO queue for data: URLs — Chrome may truncate `item.finalUrl` for huge data URLs,
 * so we cannot key the Map; one in-flight export at a time is still matched reliably.
 */
const pendingFilenameQueue = [];
/** downloadId → blob URL (revoke after download completes or fails). */
const blobUrlByDownloadId = new Map();

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

chrome.runtime.onStartup.addListener(() => {
  createContextMenus();
});

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (!isOurExtensionDownload(item)) {
    suggest();
    return;
  }

  const urlKey = pickBlobUrlKey(item);
  if (urlKey) {
    const blobPending = pendingByBlobUrl.get(urlKey);
    if (blobPending) {
      pendingByBlobUrl.delete(urlKey);
      logDeterminingFilename(item, blobPending);
      suggest({
        filename: blobPending.downloadFilename,
        conflictAction: "uniquify",
      });
      return;
    }
  }

  const primaryUrl =
    (typeof item.finalUrl === "string" && item.finalUrl) || (typeof item.url === "string" ? item.url : "");
  if (
    !primaryUrl.startsWith("blob:") &&
    pendingFilenameQueue.length > 0 &&
    (primaryUrl.startsWith("data:application/epub+zip") || item.mime === "application/epub+zip")
  ) {
    const queued = pendingFilenameQueue.shift();
    logDeterminingFilename(item, queued);
    suggest({
      filename: queued.downloadFilename,
      conflictAction: "uniquify",
    });
    return;
  }

  suggest();
});

chrome.downloads.onChanged.addListener((delta) => {
  const state = delta.state?.current;
  if (state !== "complete" && state !== "interrupted") {
    return;
  }

  const blobUrl = blobUrlByDownloadId.get(delta.id);
  if (!blobUrl) {
    return;
  }

  blobUrlByDownloadId.delete(delta.id);
  pendingByBlobUrl.delete(blobUrl);
  const revoke = globalThis.URL?.revokeObjectURL;
  if (typeof revoke === "function") {
    try {
      revoke.call(globalThis.URL, blobUrl);
    } catch (error) {
      console.warn("[chrome-epub] revokeObjectURL", error);
    }
  }
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === CONTEXT_MENU_IDS.EXPORT_PAGE && tab?.id) {
    exportTabToEpub(tab.id)
      .then((result) => notify("EPUB 已开始下载", result.filename))
      .catch((error) => notify("转为 EPUB 失败", error.message));
    return;
  }

  if (info.menuItemId === CONTEXT_MENU_IDS.EXPORT_LINK && info.linkUrl) {
    exportLinkedPageToEpub(info.linkUrl)
      .then((result) => notify("链接已转为 EPUB", result.filename))
      .catch((error) => notify("链接导出失败", error.message));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MESSAGE_TYPES.EXPORT_TAB) {
    return false;
  }

  Promise.resolve()
    .then(() => exportTabToEpub(message.tabId))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) =>
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "导出失败",
      }),
    );

  return true;
});

async function createContextMenus() {
  try {
    await chrome.contextMenus.removeAll();
  } catch (error) {
    console.warn("Failed to reset context menus", error);
  }

  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.EXPORT_PAGE,
    title: "转为 EPUB",
    contexts: ["page", "selection"],
  });

  chrome.contextMenus.create({
    id: CONTEXT_MENU_IDS.EXPORT_LINK,
    title: "将链接页面转为 EPUB",
    contexts: ["link"],
  });
}

async function exportLinkedPageToEpub(url) {
  ensureExportableUrl(url);
  const tab = await chrome.tabs.create({
    active: false,
    url,
  });

  try {
    await waitForTabComplete(tab.id, 45000);
    return await exportTabToEpub(tab.id);
  } finally {
    if (tab.id) {
      await chrome.tabs.remove(tab.id).catch(() => undefined);
    }
  }
}

async function exportTabToEpub(tabId) {
  const tab = await chrome.tabs.get(tabId);
  ensureExportableUrl(tab.url);

  const options = await loadOptions();
  const extractionResponse = await requestArticleExtraction(tabId, options);

  if (!extractionResponse?.ok || !extractionResponse.article) {
    throw new Error(extractionResponse?.error || "无法从当前页面提取正文。");
  }

  const article = extractionResponse.article;
  const downloadUrl = await buildEpubObjectUrl(article);
  const targetFilename = buildDownloadFilename(article, options.downloadFolder);
  const downloadFilename = options.saveAs ? basenameOf(targetFilename) : targetFilename;
  const pendingEntry = {
    downloadFilename,
    saveAs: options.saveAs,
  };

  if (downloadUrl.startsWith("blob:")) {
    pendingByBlobUrl.set(downloadUrl, pendingEntry);
  } else {
    pendingFilenameQueue.push(pendingEntry);
  }

  console.info("[chrome-epub] download", {
    sourceUrl: article.sourceUrl,
    articleTitle: article.title,
    titleCandidates: article.filenameMeta?.titleCandidates ?? [],
    targetFilename,
    downloadFilename,
    saveAs: options.saveAs,
    transport: downloadUrl.startsWith("blob:") ? "blob" : "data",
  });

  let downloadId;
  try {
    const downloadOptions = {
      url: downloadUrl,
      conflictAction: "uniquify",
      saveAs: options.saveAs,
    };
    // Huge data: URLs often ignore `filename` on download(); rely on onDeterminingFilename instead.
    if (downloadUrl.startsWith("blob:")) {
      downloadOptions.filename = downloadFilename;
    }

    downloadId = await chrome.downloads.download(downloadOptions);
  } catch (error) {
    removePendingDownloadEntry(downloadUrl, pendingEntry);
    throw error;
  }

  if (downloadUrl.startsWith("blob:")) {
    blobUrlByDownloadId.set(downloadId, downloadUrl);
  }

  return {
    downloadId,
    filename: downloadFilename,
    title: article.title,
  };
}

function basenameOf(filename) {
  const value = String(filename ?? "");
  const parts = value.split("/");
  return parts[parts.length - 1] || "article.epub";
}

function pickBlobUrlKey(item) {
  const finalUrl = typeof item.finalUrl === "string" ? item.finalUrl : "";
  const url = typeof item.url === "string" ? item.url : "";
  if (finalUrl.startsWith("blob:")) {
    return finalUrl;
  }

  if (url.startsWith("blob:")) {
    return url;
  }

  return "";
}

function isOurExtensionDownload(item) {
  if (item.byExtensionId && item.byExtensionId !== chrome.runtime.id) {
    return false;
  }

  return true;
}

function logDeterminingFilename(item, pending) {
  console.info("[chrome-epub] determining-filename", {
    downloadItemId: item.id,
    currentFilename: item.filename,
    suggestedFilename: pending.downloadFilename,
    saveAs: pending.saveAs,
  });
}

function removePendingDownloadEntry(downloadUrl, pendingEntry) {
  if (downloadUrl.startsWith("blob:")) {
    pendingByBlobUrl.delete(downloadUrl);
    const revoke = globalThis.URL?.revokeObjectURL;
    if (typeof revoke === "function") {
      try {
        revoke.call(globalThis.URL, downloadUrl);
      } catch {
        /* ignore */
      }
    }
  } else {
    const index = pendingFilenameQueue.indexOf(pendingEntry);
    if (index !== -1) {
      pendingFilenameQueue.splice(index, 1);
    }
  }
}

async function requestArticleExtraction(tabId, options) {
  try {
    return await chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.EXTRACT_ARTICLE,
      options,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (!/Receiving end does not exist|Could not establish connection/i.test(message)) {
      throw error;
    }

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
    await delay(120);
    return chrome.tabs.sendMessage(tabId, {
      type: MESSAGE_TYPES.EXTRACT_ARTICLE,
      options,
    });
  }
}

function ensureExportableUrl(url) {
  if (!url) {
    throw new Error("当前页面没有可导出的 URL。");
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("仅支持 http 或 https 页面。");
    }
  } catch {
    throw new Error("当前页面 URL 无法导出。");
  }
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      reject(new Error("等待页面加载超时。"));
    }, timeoutMs);

    function handleUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(handleUpdated);
      resolve();
    }

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timeoutId);
        resolve();
        return;
      }
      chrome.tabs.onUpdated.addListener(handleUpdated);
    }).catch((error) => {
      clearTimeout(timeoutId);
      reject(error);
    });
  });
}

async function notify(title, message) {
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title,
      message,
    });
  } catch (error) {
    console.warn("Failed to show notification", error);
  }
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
