export const DEFAULT_OPTIONS = Object.freeze({
  downloadFolder: "EPUB",
  includeImages: true,
  includeLinks: true,
  preserveColors: true,
  preserveTextTransform: true,
  saveAs: false,
});

export function sanitizeDownloadFolder(folder) {
  if (typeof folder !== "string") {
    return DEFAULT_OPTIONS.downloadFolder;
  }

  const parts = folder
    .split(/[\\/]+/)
    .map((part) => part.trim().replace(/[<>:"|?*\u0000-\u001f]/g, ""))
    .filter(Boolean)
    .slice(0, 4);

  return parts.length > 0 ? parts.join("/") : DEFAULT_OPTIONS.downloadFolder;
}

export function normalizeOptions(raw = {}) {
  return {
    downloadFolder: sanitizeDownloadFolder(raw.downloadFolder),
    includeImages: raw.includeImages !== false,
    includeLinks: raw.includeLinks !== false,
    preserveColors: raw.preserveColors !== false,
    preserveTextTransform: raw.preserveTextTransform !== false,
    saveAs: raw.saveAs === true,
  };
}

export async function loadOptions() {
  const stored = await chrome.storage.sync.get(DEFAULT_OPTIONS);
  return normalizeOptions(stored);
}

export async function saveOptions(partialOptions) {
  const nextOptions = normalizeOptions({
    ...(await loadOptions()),
    ...partialOptions,
  });
  await chrome.storage.sync.set(nextOptions);
  return nextOptions;
}

