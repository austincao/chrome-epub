import JSZip from "jszip";
import { escapeAttribute, escapeXml, stripInvalidXmlCharacters } from "./markup.js";

const XML_DECLARATION = `<?xml version="1.0" encoding="utf-8"?>`;
const TRANSPARENT_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k/w8AAAAASUVORK5CYII=";

const BOOK_CSS = `
html, body {
  margin: 0;
  padding: 0;
}

body {
  font-family: serif;
  line-height: 1.6;
  color: #111111;
  background: #ffffff;
  margin: 0 5%;
}

h1, h2, h3, h4, h5, h6 {
  line-height: 1.25;
  margin: 1.2em 0 0.5em;
}

h1.book-title {
  margin-top: 0;
}

p, blockquote, ul, ol, pre, table, figure {
  margin: 0.8em 0;
}

blockquote {
  margin-left: 0;
  padding-left: 1em;
  border-left: 0.18em solid #cccccc;
  color: #444444;
}

pre, code {
  font-family: monospace;
}

pre {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f5f2ea;
  padding: 0.8em;
  border-radius: 0.3em;
}

a {
  color: #0d4f8b;
  text-decoration: underline;
}

img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 1em auto;
}

figure {
  text-align: center;
}

figcaption {
  color: #555555;
  font-size: 0.95em;
}

hr {
  border: 0;
  border-top: 0.08em solid #d5d1c8;
  margin: 1.5em 0;
}

table {
  width: 100%;
  border-collapse: collapse;
}

th, td {
  border: 0.06em solid #d8d4cc;
  padding: 0.4em;
  vertical-align: top;
}

.article-meta {
  margin: 0 0 1.6em;
  padding: 0.8em 0 1.1em;
  border-bottom: 0.08em solid #ddd7c8;
  color: #4d4d4d;
}

.article-meta p {
  margin: 0.25em 0;
}

.meta-label {
  font-weight: bold;
  margin-right: 0.5em;
}
`.trim();

export async function buildEpubObjectUrl(article) {
  const workingArticle = {
    ...article,
    contentHtml: stripInvalidXmlCharacters(article.contentHtml ?? ""),
  };

  if (!workingArticle.contentHtml.trim()) {
    throw new Error("正文提取结果为空，无法生成 EPUB。");
  }

  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  const metaInfFolder = zip.folder("META-INF");
  metaInfFolder.file("container.xml", buildContainerXml());

  const oebpsFolder = zip.folder("OEBPS");
  const imageAssets = await resolveImageAssets(workingArticle.images ?? []);
  const identifier = crypto.randomUUID();
  const modifiedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const language = workingArticle.language || "zh-CN";
  const firstCoverAsset = imageAssets[0]?.href ?? null;

  oebpsFolder.file("styles/book.css", BOOK_CSS);
  oebpsFolder.file("text/article.xhtml", buildArticleXhtml(workingArticle));
  oebpsFolder.file("nav.xhtml", buildNavXhtml(workingArticle.title, language));
  oebpsFolder.file("toc.ncx", buildTocNcx(workingArticle.title, identifier));
  oebpsFolder.file(
    "content.opf",
    buildContentOpf({
      article: workingArticle,
      identifier,
      language,
      modifiedAt,
      imageAssets,
      coverHref: firstCoverAsset,
    }),
  );

  for (const asset of imageAssets) {
    oebpsFolder.file(asset.href, asset.data);
  }

  const bytes = await zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });

  const blob = new Blob([bytes], { type: "application/epub+zip" });
  const createObjectUrl = globalThis.URL?.createObjectURL;
  if (typeof createObjectUrl === "function") {
    return createObjectUrl.call(globalThis.URL, blob);
  }

  const base64 = uint8ArrayToBase64(bytes);
  return `data:application/epub+zip;base64,${base64}`;
}

function uint8ArrayToBase64(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function buildContainerXml() {
  return `${XML_DECLARATION}
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`;
}

function buildArticleXhtml(article) {
  const title = article.title || "Untitled Article";
  const metaLines = [];

  if (article.byline) {
    metaLines.push(
      `<p><span class="meta-label">作者</span>${escapeXml(article.byline)}</p>`,
    );
  }

  if (article.siteName) {
    metaLines.push(
      `<p><span class="meta-label">来源</span>${escapeXml(article.siteName)}</p>`,
    );
  }

  if (article.publishedTime) {
    metaLines.push(
      `<p><span class="meta-label">发布时间</span>${escapeXml(formatDisplayDate(article.publishedTime))}</p>`,
    );
  }

  if (article.sourceUrl) {
    metaLines.push(
      `<p><span class="meta-label">原文链接</span><a href="${escapeAttribute(article.sourceUrl)}">${escapeXml(article.sourceUrl)}</a></p>`,
    );
  }

  const articleMeta = metaLines.length
    ? `<section class="article-meta">${metaLines.join("")}</section>`
    : "";

  return `${XML_DECLARATION}
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${escapeAttribute(article.language || "zh-CN")}">
  <head>
    <meta charset="utf-8" />
    <title>${escapeXml(title)}</title>
    <link rel="stylesheet" type="text/css" href="../styles/book.css" />
  </head>
  <body>
    <article>
      <h1 class="book-title">${escapeXml(title)}</h1>
      ${articleMeta}
      ${article.contentHtml}
    </article>
  </body>
</html>`;
}

function buildNavXhtml(title, language) {
  return `${XML_DECLARATION}
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttribute(language)}">
  <head>
    <meta charset="utf-8" />
    <title>目录</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
        <li><a href="text/article.xhtml">${escapeXml(title || "正文")}</a></li>
      </ol>
    </nav>
  </body>
</html>`;
}

function buildTocNcx(title, identifier) {
  return `${XML_DECLARATION}
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${escapeAttribute(identifier)}" />
    <meta name="dtb:depth" content="1" />
    <meta name="dtb:totalPageCount" content="0" />
    <meta name="dtb:maxPageNumber" content="0" />
  </head>
  <docTitle>
    <text>${escapeXml(title || "正文")}</text>
  </docTitle>
  <navMap>
    <navPoint id="navpoint-1" playOrder="1">
      <navLabel>
        <text>${escapeXml(title || "正文")}</text>
      </navLabel>
      <content src="text/article.xhtml" />
    </navPoint>
  </navMap>
</ncx>`;
}

function buildContentOpf({ article, identifier, language, modifiedAt, imageAssets, coverHref }) {
  const title = article.title || "Untitled Article";
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />`,
    `<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml" />`,
    `<item id="article" href="text/article.xhtml" media-type="application/xhtml+xml" />`,
    `<item id="styles" href="styles/book.css" media-type="text/css" />`,
  ];

  for (const asset of imageAssets) {
    const coverProperty = coverHref === asset.href ? ` properties="cover-image"` : "";
    manifestItems.push(
      `<item id="${escapeAttribute(asset.id)}" href="${escapeAttribute(asset.href)}" media-type="${escapeAttribute(asset.mediaType)}"${coverProperty} />`,
    );
  }

  const metadataLines = [
    `<dc:identifier id="bookid">${escapeXml(identifier)}</dc:identifier>`,
    `<dc:title>${escapeXml(title)}</dc:title>`,
    `<dc:language>${escapeXml(language)}</dc:language>`,
    `<meta property="dcterms:modified">${escapeXml(modifiedAt)}</meta>`,
  ];

  if (article.byline) {
    metadataLines.push(`<dc:creator>${escapeXml(article.byline)}</dc:creator>`);
  }

  if (article.siteName) {
    metadataLines.push(`<dc:publisher>${escapeXml(article.siteName)}</dc:publisher>`);
  }

  if (article.sourceUrl) {
    metadataLines.push(`<dc:source>${escapeXml(article.sourceUrl)}</dc:source>`);
  }

  const publishedDate = normalizeIsoDate(article.publishedTime);
  if (publishedDate) {
    metadataLines.push(`<dc:date>${escapeXml(publishedDate)}</dc:date>`);
  }

  if (article.excerpt) {
    metadataLines.push(`<dc:description>${escapeXml(article.excerpt)}</dc:description>`);
  }

  return `${XML_DECLARATION}
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="3.0" unique-identifier="bookid" xml:lang="${escapeAttribute(language)}">
  <metadata>
    ${metadataLines.join("\n    ")}
  </metadata>
  <manifest>
    ${manifestItems.join("\n    ")}
  </manifest>
  <spine toc="toc">
    <itemref idref="article" />
  </spine>
</package>`;
}

async function resolveImageAssets(imageDescriptors) {
  const tasks = imageDescriptors.map((descriptor) => async () => fetchImageAsset(descriptor));
  return runWithConcurrency(tasks, 4);
}

async function fetchImageAsset(descriptor) {
  try {
    if (descriptor.sourceUrl.startsWith("data:")) {
      return decodeDataUrl(descriptor);
    }

    const response = await fetch(descriptor.sourceUrl, {
      redirect: "follow",
      signal: createTimeoutSignal(20000),
    });

    if (!response.ok) {
      throw new Error(`Image request failed with status ${response.status}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      id: descriptor.id,
      href: descriptor.path,
      mediaType: normalizeMediaType(response.headers.get("content-type")) || descriptor.mediaType || "image/jpeg",
      data: bytes,
    };
  } catch (error) {
    console.warn("Falling back to placeholder image:", descriptor.sourceUrl, error);
    return {
      id: descriptor.id,
      href: descriptor.path,
      mediaType: "image/png",
      data: decodeBase64(TRANSPARENT_PNG_BASE64),
    };
  }
}

function decodeDataUrl(descriptor) {
  const match = descriptor.sourceUrl.match(/^data:([^;,]+)?(;base64)?,([\s\S]+)$/i);
  if (!match) {
    throw new Error("Unsupported data URL");
  }

  const mediaType = normalizeMediaType(match[1]) || descriptor.mediaType || "image/png";
  const payload = match[3] || "";
  const data = match[2] ? decodeBase64(payload) : new TextEncoder().encode(decodeURIComponent(payload));

  return {
    id: descriptor.id,
    href: descriptor.path,
    mediaType,
    data,
  };
}

function createTimeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

function normalizeMediaType(contentType) {
  return String(contentType ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function decodeBase64(value) {
  const buffer = atob(value);
  return Uint8Array.from(buffer, (character) => character.charCodeAt(0));
}

async function runWithConcurrency(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await tasks[currentIndex]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeIsoDate(value) {
  if (!value) {
    return "";
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? "" : parsed.toISOString();
}

function formatDisplayDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}
