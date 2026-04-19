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
async function saveOptions(partialOptions) {
  const nextOptions = normalizeOptions({
    ...await loadOptions(),
    ...partialOptions
  });
  await chrome.storage.sync.set(nextOptions);
  return nextOptions;
}

// src/options/index.js
var form = document.getElementById("options-form");
var statusElement = document.getElementById("status");
var downloadFolderInput = document.getElementById("download-folder");
var includeImagesInput = document.getElementById("include-images");
var includeLinksInput = document.getElementById("include-links");
var preserveColorsInput = document.getElementById("preserve-colors");
var preserveTextTransformInput = document.getElementById("preserve-text-transform");
var saveAsInput = document.getElementById("save-as");
init().catch((error) => {
  console.error(error);
  statusElement.textContent = error.message || "\u521D\u59CB\u5316\u5931\u8D25";
});
async function init() {
  const options = await loadOptions();
  render(options);
}
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusElement.textContent = "\u6B63\u5728\u4FDD\u5B58...";
  try {
    const options = await saveOptions({
      downloadFolder: downloadFolderInput.value,
      includeImages: includeImagesInput.checked,
      includeLinks: includeLinksInput.checked,
      preserveColors: preserveColorsInput.checked,
      preserveTextTransform: preserveTextTransformInput.checked,
      saveAs: saveAsInput.checked
    });
    render(options);
    statusElement.textContent = "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58";
  } catch (error) {
    console.error(error);
    statusElement.textContent = error.message || "\u4FDD\u5B58\u5931\u8D25";
  }
});
function render(options) {
  downloadFolderInput.value = options.downloadFolder;
  includeImagesInput.checked = options.includeImages;
  includeLinksInput.checked = options.includeLinks;
  preserveColorsInput.checked = options.preserveColors;
  preserveTextTransformInput.checked = options.preserveTextTransform;
  saveAsInput.checked = options.saveAs;
}
