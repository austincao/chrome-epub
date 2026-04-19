/**
 * Quick sanity check that article metadata maps to a title-based basename (no Node deps on Chrome).
 */
import { buildDownloadFilename } from "../src/lib/filename.js";

const marker = "PlaywrightEPUBTitleZ9Y8X7";
const article = {
  title: `${marker} 专用测试标题`,
  byline: "",
  excerpt: "",
  siteName: "fixture.test",
  language: "zh-CN",
  sourceUrl: "http://127.0.0.1:8765/article.html",
  publishedTime: "",
  contentHtml: "<p>x</p>",
  images: [],
  textLength: 400,
  filenameMeta: {
    pageTitle: `${marker} 专用测试标题`,
    headingTitle: `${marker} 正文大标题用于可读性检测`,
    pathnameTitle: "",
    titleCandidates: [`${marker} 专用测试标题`, `${marker} 正文大标题用于可读性检测`],
    siteCandidates: ["fixture.test"],
    hostname: "127.0.0.1",
  },
};

const relative = buildDownloadFilename(article, "EPUB");
if (!relative.includes(marker) || !relative.endsWith(".epub")) {
  console.error("Unexpected buildDownloadFilename output:", relative);
  process.exit(1);
}

console.log("verify-download-filename-unit: ok →", relative);
