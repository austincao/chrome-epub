import { MESSAGE_TYPES } from "../lib/messages.js";
import { loadOptions } from "../lib/options.js";

const pageTitleElement = document.getElementById("page-title");
const pageUrlElement = document.getElementById("page-url");
const settingsSummaryElement = document.getElementById("settings-summary");
const statusElement = document.getElementById("status");
const exportButton = document.getElementById("export-button");
const optionsButton = document.getElementById("open-options");

let currentTab = null;

init().catch((error) => {
  console.error(error);
  setStatus(error.message || "初始化失败");
});

async function init() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  currentTab = tab ?? null;

  if (!currentTab) {
    exportButton.disabled = true;
    pageTitleElement.textContent = "未找到当前标签页";
    return;
  }

  pageTitleElement.textContent = currentTab.title || "未命名页面";
  pageUrlElement.textContent = currentTab.url || "";
  exportButton.disabled = !isExportableUrl(currentTab.url);

  if (!isExportableUrl(currentTab.url)) {
    setStatus("当前页面不是可导出的 http/https 文章页面。");
  }

  const options = await loadOptions();
  const folderLabel = `下载到 Downloads/${options.downloadFolder}/`;
  const imageLabel = options.includeImages ? "保留图片" : "不导出图片";
  const styleLabel = options.preserveColors ? "保留颜色" : "仅保留基础格式";
  settingsSummaryElement.textContent = `${folderLabel} · ${imageLabel} · ${styleLabel}`;
}

exportButton.addEventListener("click", async () => {
  if (!currentTab?.id) {
    return;
  }

  exportButton.disabled = true;
  setStatus("正在提取正文并生成 EPUB...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: MESSAGE_TYPES.EXPORT_TAB,
      tabId: currentTab.id,
    });

    if (!response?.ok) {
      throw new Error(response?.error || "导出失败");
    }

    setStatus(`已开始下载：${response.result.filename}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "导出失败");
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

