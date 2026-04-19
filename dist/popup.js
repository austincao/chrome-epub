// src/lib/messages.js
var MESSAGE_TYPES = Object.freeze({
  EXPORT_TAB: "export-tab",
  EXTRACT_ARTICLE: "extract-article"
});
var CONTEXT_MENU_IDS = Object.freeze({
  EXPORT_PAGE: "convert-page-to-epub",
  EXPORT_LINK: "convert-link-to-epub"
});

// src/lib/options.js
var DEFAULT_OPTIONS = Object.freeze({
  downloadFolder: "EPUB",
  includeImages: true,
  includeLinks: true,
  preserveColors: true,
  preserveTextTransform: true,
  saveAs: false
});
function sanitizeDownloadFolder(folder) {
  if (typeof folder !== "string") {
    return DEFAULT_OPTIONS.downloadFolder;
  }
  const parts = folder.split(/[\\/]+/).map((part) => part.trim().replace(/[<>:"|?*\u0000-\u001f]/g, "")).filter(Boolean).slice(0, 4);
  return parts.length > 0 ? parts.join("/") : DEFAULT_OPTIONS.downloadFolder;
}
function normalizeOptions(raw = {}) {
  return {
    downloadFolder: sanitizeDownloadFolder(raw.downloadFolder),
    includeImages: raw.includeImages !== false,
    includeLinks: raw.includeLinks !== false,
    preserveColors: raw.preserveColors !== false,
    preserveTextTransform: raw.preserveTextTransform !== false,
    saveAs: raw.saveAs === true
  };
}
async function loadOptions() {
  const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  return normalizeOptions(stored);
}

// src/popup/index.js
var pageTitleElement = document.getElementById("page-title");
var pageUrlElement = document.getElementById("page-url");
var settingsSummaryElement = document.getElementById("settings-summary");
var statusElement = document.getElementById("status");
var exportButton = document.getElementById("export-button");
var optionsButton = document.getElementById("open-options");
var currentTab = null;
init().catch((error) => {
  console.error(error);
  setStatus(error.message || "\u521D\u59CB\u5316\u5931\u8D25");
});
async function init() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  currentTab = tab ?? null;
  if (!currentTab) {
    exportButton.disabled = true;
    pageTitleElement.textContent = "\u672A\u627E\u5230\u5F53\u524D\u6807\u7B7E\u9875";
    return;
  }
  pageTitleElement.textContent = currentTab.title || "\u672A\u547D\u540D\u9875\u9762";
  pageUrlElement.textContent = currentTab.url || "";
  exportButton.disabled = !isExportableUrl(currentTab.url);
  if (!isExportableUrl(currentTab.url)) {
    setStatus("\u5F53\u524D\u9875\u9762\u4E0D\u662F\u53EF\u5BFC\u51FA\u7684 http/https \u6587\u7AE0\u9875\u9762\u3002");
  }
  const options = await loadOptions();
  const folderLabel = `\u4E0B\u8F7D\u5230 Downloads/${options.downloadFolder}/`;
  const imageLabel = options.includeImages ? "\u4FDD\u7559\u56FE\u7247" : "\u4E0D\u5BFC\u51FA\u56FE\u7247";
  const styleLabel = options.preserveColors ? "\u4FDD\u7559\u989C\u8272" : "\u4EC5\u4FDD\u7559\u57FA\u7840\u683C\u5F0F";
  settingsSummaryElement.textContent = `${folderLabel} \xB7 ${imageLabel} \xB7 ${styleLabel}`;
}
exportButton.addEventListener("click", async () => {
  if (!currentTab?.id) {
    return;
  }
  exportButton.disabled = true;
  setStatus("\u6B63\u5728\u63D0\u53D6\u6B63\u6587\u5E76\u751F\u6210 EPUB...");
  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.EXPORT_TAB,
      tabId: currentTab.id
    });
    if (!response?.ok) {
      throw new Error(response?.error || "\u5BFC\u51FA\u5931\u8D25");
    }
    setStatus(`\u5DF2\u5F00\u59CB\u4E0B\u8F7D\uFF1A${response.result.filename}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "\u5BFC\u51FA\u5931\u8D25");
  } finally {
    exportButton.disabled = !isExportableUrl(currentTab?.url);
  }
});
optionsButton.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
function setStatus(value) {
  statusElement.textContent = value;
}
function isExportableUrl(url) {
  if (!url) {
    return false;
  }
  try {
    const parsed = new URL(url);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
