import { Readability } from "@mozilla/readability";
import { escapeAttribute, escapeXml } from "../lib/markup.js";

const ALLOWED_TAGS = new Set([
  "a",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "div",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "i",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "tr",
  "u",
  "ul",
]);

const VOID_TAGS = new Set(["br", "hr"]);
const UNWRAP_TAGS = new Set(["section"]);
const STYLE_PROPERTIES = new Set([
  "background-color",
  "color",
  "font-style",
  "font-weight",
  "text-align",
  "text-decoration",
  "text-transform",
]);

const SAFE_CSS_VALUE = /^[#(),.%/\-+\w\s]+$/;

export function extractArticleFromPage(options) {
  const preparedDocument = document.cloneNode(true);
  prepareDocumentForReadability(preparedDocument);

  const reader = new Readability(preparedDocument, {
    keepClasses: false,
  });

  const readabilityArticle = reader.parse() ?? buildFallbackArticle();
  const headingTitle = readHeadingTitle();
  const pageTitle = document.title || "";
  const pathnameTitle = readPathnameTitle(location.href);
  const titleCandidates = uniqueNonEmpty([
    readMetaContent(['meta[property="og:title"]', 'meta[name="og:title"]']),
    readMetaContent(['meta[name="twitter:title"]', 'meta[property="twitter:title"]']),
    readabilityArticle.title,
    headingTitle,
    pageTitle,
    pathnameTitle,
  ]);
  const siteCandidates = uniqueNonEmpty([
    readabilityArticle.siteName,
    readSiteName(),
    readMetaContent(['meta[name="application-name"]', 'meta[name="apple-mobile-web-app-title"]']),
    location.hostname,
  ]);
  const sanitized = sanitizeArticleHtml(readabilityArticle.content || document.body?.innerHTML || "", {
    baseUrl: location.href,
    includeImages: options.includeImages,
    includeLinks: options.includeLinks,
    preserveColors: options.preserveColors,
    preserveTextTransform: options.preserveTextTransform,
  });

  console.info("[chrome-epub] extraction", {
    sourceUrl: location.href,
    pageTitle,
    headingTitle,
    pathnameTitle,
    titleCandidates,
    siteCandidates,
    selectedTitle: titleCandidates[0] || "Untitled Article",
  });

  return {
    title: titleCandidates[0] || "Untitled Article",
    byline: readabilityArticle.byline || readByline(),
    excerpt: readabilityArticle.excerpt || readExcerpt(),
    siteName: siteCandidates[0] || location.hostname,
    language: document.documentElement.lang || navigator.language || "zh-CN",
    sourceUrl: location.href,
    publishedTime: readPublishedTime(),
    contentHtml: sanitized.html,
    images: sanitized.images,
    textLength: readabilityArticle.textContent?.length || 0,
    filenameMeta: {
      pageTitle,
      headingTitle,
      pathnameTitle,
      titleCandidates,
      siteCandidates,
      hostname: location.hostname,
    },
  };
}

function buildFallbackArticle() {
  return {
    title: document.title || "Untitled Article",
    content: document.body?.innerHTML || "",
    textContent: document.body?.textContent || "",
    byline: readByline(),
    excerpt: readExcerpt(),
    siteName: readSiteName(),
  };
}

function prepareDocumentForReadability(clonedDocument) {
  clonedDocument
    .querySelectorAll("script, noscript, style, iframe, svg, canvas, form, dialog")
    .forEach((element) => element.remove());

  clonedDocument.querySelectorAll("img").forEach((image) => {
    if (!isUsableImageSource(image.getAttribute("src"))) {
      const lazySource = resolveImageSource(image);
      if (lazySource) {
        image.setAttribute("src", lazySource);
      }
    }
  });
}

function sanitizeArticleHtml(html, options) {
  const parsedDocument = new DOMParser().parseFromString(html, "text/html");
  const state = {
    images: [],
    imageMap: new Map(),
    options,
  };

  const body = parsedDocument.body;
  const sanitizedHtml = Array.from(body.childNodes)
    .map((node) => sanitizeNode(node, state, { inPre: false }))
    .join("")
    .trim();

  return {
    html: sanitizedHtml || `<p>${escapeXml(document.title || "Untitled Article")}</p>`,
    images: state.images,
  };
}

function sanitizeNode(node, state, context) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = context.inPre
      ? node.textContent || ""
      : (node.textContent || "").replace(/\s+/g, " ");
    return escapeXml(text);
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }

  const tagName = node.tagName.toLowerCase();
  if (!ALLOWED_TAGS.has(tagName)) {
    return Array.from(node.childNodes)
      .map((child) => sanitizeNode(child, state, context))
      .join("");
  }

  if (VOID_TAGS.has(tagName)) {
    return `<${tagName} />`;
  }

  if (tagName === "img") {
    if (!state.options.includeImages) {
      return "";
    }

    const sourceUrl = resolveImageSource(node, state.options.baseUrl);
    if (!sourceUrl) {
      return "";
    }

    const imageAsset = registerImage(sourceUrl, node, state);
    if (!imageAsset) {
      return "";
    }

    const attributes = [`src="../${escapeAttribute(imageAsset.path)}"`];
    const altText = node.getAttribute("alt") || "";
    if (altText) {
      attributes.push(`alt="${escapeAttribute(altText)}"`);
    }

    const width = numericAttribute(node.getAttribute("width"));
    const height = numericAttribute(node.getAttribute("height"));
    if (width) {
      attributes.push(`width="${width}"`);
    }
    if (height) {
      attributes.push(`height="${height}"`);
    }

    return `<img ${attributes.join(" ")} />`;
  }

  const attributes = [];

  if (tagName === "a" && state.options.includeLinks) {
    const href = resolveHref(node.getAttribute("href"), state.options.baseUrl);
    if (href) {
      attributes.push(`href="${escapeAttribute(href)}"`);
    }
  }

  if (tagName === "td" || tagName === "th") {
    const colspan = numericAttribute(node.getAttribute("colspan"));
    const rowspan = numericAttribute(node.getAttribute("rowspan"));
    if (colspan) {
      attributes.push(`colspan="${colspan}"`);
    }
    if (rowspan) {
      attributes.push(`rowspan="${rowspan}"`);
    }
  }

  const styleValue = filterInlineStyle(node.getAttribute("style"), tagName, state.options);
  if (styleValue) {
    attributes.push(`style="${escapeAttribute(styleValue)}"`);
  }

  const childContext = {
    inPre: context.inPre || tagName === "pre",
  };

  const content = Array.from(node.childNodes)
    .map((child) => sanitizeNode(child, state, childContext))
    .join("");

  if (!hasMeaningfulContent(content) && !["div", "span", "p"].includes(tagName)) {
    return "";
  }

  if (UNWRAP_TAGS.has(tagName) && attributes.length === 0) {
    return content;
  }

  if (tagName === "span" && attributes.length === 0) {
    return content;
  }

  const openingTag = attributes.length ? `<${tagName} ${attributes.join(" ")}>` : `<${tagName}>`;
  return `${openingTag}${content}</${tagName}>`;
}

function hasMeaningfulContent(content) {
  const textOnly = content.replace(/<[^>]+>/g, " ").trim();
  return textOnly.length > 0 || /<(img|br|hr)\b/i.test(content);
}

function registerImage(sourceUrl, node, state) {
  const normalizedUrl = normalizeUrl(sourceUrl, state.options.baseUrl);
  if (!normalizedUrl || !isUsableImageSource(normalizedUrl)) {
    return null;
  }

  if (state.imageMap.has(normalizedUrl)) {
    return state.imageMap.get(normalizedUrl);
  }

  const mediaType = guessImageMediaType(normalizedUrl);
  const extension = extensionForMediaType(mediaType);
  const index = state.images.length + 1;
  const imageAsset = {
    id: `image-${index}`,
    sourceUrl: normalizedUrl,
    path: `images/image-${String(index).padStart(3, "0")}.${extension}`,
    mediaType,
    alt: node.getAttribute("alt") || "",
  };

  state.imageMap.set(normalizedUrl, imageAsset);
  state.images.push(imageAsset);
  return imageAsset;
}

function resolveImageSource(node, baseUrl = location.href) {
  const candidates = [
    node.getAttribute("src"),
    node.getAttribute("data-src"),
    node.getAttribute("data-original"),
    node.getAttribute("data-lazy-src"),
    node.getAttribute("data-actualsrc"),
    node.getAttribute("data-url"),
    pickFirstSrcSetCandidate(node.getAttribute("srcset")),
    pickFirstSrcSetCandidate(node.getAttribute("data-srcset")),
  ];

  const candidate = candidates.find((value) => isUsableImageSource(value));
  return candidate ? normalizeUrl(candidate, baseUrl) : "";
}

function resolveHref(value, baseUrl) {
  const normalized = normalizeUrl(value, baseUrl);
  if (!normalized) {
    return "";
  }

  const protocol = new URL(normalized).protocol;
  return ["http:", "https:", "mailto:"].includes(protocol) ? normalized : "";
}

function normalizeUrl(value, baseUrl) {
  if (!value) {
    return "";
  }

  if (value.startsWith("data:")) {
    return value;
  }

  try {
    return new URL(value, baseUrl).href;
  } catch {
    return "";
  }
}

function isUsableImageSource(value) {
  if (!value) {
    return false;
  }

  if (value.startsWith("data:image/")) {
    return true;
  }

  try {
    const url = new URL(value, location.href);
    return ["http:", "https:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function pickFirstSrcSetCandidate(value) {
  if (!value) {
    return "";
  }

  const firstCandidate = value.split(",")[0] || "";
  return firstCandidate.trim().split(/\s+/)[0] || "";
}

function filterInlineStyle(styleValue, tagName, options) {
  if (!styleValue) {
    return "";
  }

  const declarations = [];
  for (const chunk of styleValue.split(";")) {
    const [rawProperty, ...rawValueParts] = chunk.split(":");
    if (!rawProperty || rawValueParts.length === 0) {
      continue;
    }

    const property = rawProperty.trim().toLowerCase();
    const value = rawValueParts.join(":").trim();
    if (!STYLE_PROPERTIES.has(property) || !isSafeCssValue(property, value)) {
      continue;
    }

    if ((property === "color" || property === "background-color") && !options.preserveColors) {
      continue;
    }

    if (property === "text-transform" && !options.preserveTextTransform) {
      continue;
    }

    if (property === "text-align" && !["div", "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "p", "pre", "td", "th"].includes(tagName)) {
      continue;
    }

    declarations.push(`${property}: ${value}`);
  }

  return declarations.join("; ");
}

function isSafeCssValue(property, value) {
  if (!value || /url\s*\(|expression\s*\(|@import/i.test(value)) {
    return false;
  }

  if (property === "font-weight") {
    return /^(normal|bold|bolder|lighter|[1-9]00)$/i.test(value);
  }

  if (property === "font-style") {
    return /^(normal|italic|oblique)$/i.test(value);
  }

  if (property === "text-decoration") {
    return /^(none|underline|overline|line-through|underline line-through|line-through underline)$/i.test(value);
  }

  if (property === "text-transform") {
    return /^(none|uppercase|lowercase|capitalize)$/i.test(value);
  }

  if (property === "text-align") {
    return /^(left|right|center|justify|start|end)$/i.test(value);
  }

  return SAFE_CSS_VALUE.test(value);
}

function numericAttribute(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function guessImageMediaType(url) {
  if (url.startsWith("data:")) {
    return url.slice(5, url.indexOf(";")).toLowerCase();
  }

  const pathname = new URL(url).pathname.toLowerCase();
  if (pathname.endsWith(".png")) {
    return "image/png";
  }
  if (pathname.endsWith(".gif")) {
    return "image/gif";
  }
  if (pathname.endsWith(".webp")) {
    return "image/webp";
  }
  if (pathname.endsWith(".svg")) {
    return "image/svg+xml";
  }
  return "image/jpeg";
}

function extensionForMediaType(mediaType) {
  switch (mediaType) {
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/svg+xml":
      return "svg";
    default:
      return "jpg";
  }
}

function readPublishedTime() {
  return (
    readMetaContent([
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="parsely-pub-date"]',
      'meta[property="og:pubdate"]',
      'meta[name="pubdate"]',
      'meta[itemprop="datePublished"]',
    ]) || document.querySelector("time[datetime]")?.getAttribute("datetime") || ""
  );
}

function readByline() {
  return readMetaContent([
    'meta[name="author"]',
    'meta[property="author"]',
    'meta[name="parsely-author"]',
    'meta[itemprop="author"]',
  ]);
}

function readSiteName() {
  return readMetaContent(['meta[property="og:site_name"]']) || location.hostname;
}

function readExcerpt() {
  return readMetaContent(['meta[name="description"]', 'meta[property="og:description"]']);
}

function readHeadingTitle() {
  const heading = document.querySelector("article h1, main h1, h1, article h2, main h2");
  return heading?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function readPathnameTitle(url) {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      });

    const lastSegment = [...segments]
      .reverse()
      .find((segment) => /[A-Za-z\u4e00-\u9fff]/.test(segment));

    return (lastSegment || "")
      .replace(/\.[a-z0-9]{1,5}$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

function readMetaContent(selectors) {
  for (const selector of selectors) {
    const value = document.querySelector(selector)?.getAttribute("content")?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const results = [];

  for (const value of values) {
    const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(normalized);
  }

  return results;
}
