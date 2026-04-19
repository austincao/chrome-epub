import { MESSAGE_TYPES } from "../lib/messages.js";
import { DEFAULT_OPTIONS, normalizeOptions } from "../lib/options.js";
import { extractArticleFromPage } from "./article-extractor.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== MESSAGE_TYPES.EXTRACT_ARTICLE) {
    return false;
  }

  Promise.resolve()
    .then(() => {
      const options = normalizeOptions({
        ...DEFAULT_OPTIONS,
        ...(message.options ?? {}),
      });

      return extractArticleFromPage(options);
    })
    .then((article) => sendResponse({ ok: true, article }))
    .catch((error) => {
      console.error("Failed to extract article", error);
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "正文提取失败",
      });
    });

  return true;
});

