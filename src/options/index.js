import { loadOptions, saveOptions } from "../lib/options.js";

const form = document.getElementById("options-form");
const statusElement = document.getElementById("status");
const downloadFolderInput = document.getElementById("download-folder");
const includeImagesInput = document.getElementById("include-images");
const includeLinksInput = document.getElementById("include-links");
const preserveColorsInput = document.getElementById("preserve-colors");
const preserveFontSizeInput = document.getElementById("preserve-font-size");
const preserveTextTransformInput = document.getElementById("preserve-text-transform");
const saveAsInput = document.getElementById("save-as");

init().catch((error) => {
  console.error(error);
  statusElement.textContent = error.message || "初始化失败";
});

async function init() {
  const options = await loadOptions();
  render(options);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusElement.textContent = "正在保存...";

  try {
    const options = await saveOptions({
      downloadFolder: downloadFolderInput.value,
      includeImages: includeImagesInput.checked,
      includeLinks: includeLinksInput.checked,
      preserveColors: preserveColorsInput.checked,
      preserveFontSize: preserveFontSizeInput.checked,
      preserveTextTransform: preserveTextTransformInput.checked,
      saveAs: saveAsInput.checked,
    });
    render(options);
    statusElement.textContent = "设置已保存";
  } catch (error) {
    console.error(error);
    statusElement.textContent = error.message || "保存失败";
  }
});

function render(options) {
  downloadFolderInput.value = options.downloadFolder;
  includeImagesInput.checked = options.includeImages;
  includeLinksInput.checked = options.includeLinks;
  preserveColorsInput.checked = options.preserveColors;
  preserveFontSizeInput.checked = options.preserveFontSize;
  preserveTextTransformInput.checked = options.preserveTextTransform;
  saveAsInput.checked = options.saveAs;
}

