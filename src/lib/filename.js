import { sanitizeDownloadFolder } from "./options.js";

const FILE_REPLACEMENTS = /[<>:"/\\|?*\u0000-\u001f]/g;
const TITLE_MAX_LENGTH = 88;
const SITE_MAX_LENGTH = 24;
const COMMON_SUBDOMAINS = new Set([
  "amp",
  "app",
  "blog",
  "cn",
  "en",
  "global",
  "m",
  "mobile",
  "news",
  "static",
  "wap",
  "web",
  "www",
  "wwww",
]);
const COMMON_DOMAIN_SUFFIX_PARTS = new Set(["ac", "co", "com", "edu", "gov", "net", "org"]);
const GENERIC_TITLE_TERMS = new Set([
  "article",
  "home",
  "homepage",
  "index",
  "news",
  "post",
  "untitled article",
  "主页",
  "全文",
  "图集",
  "首页",
  "文章",
  "资讯",
  "视频",
  "详情",
  "频道",
]);
const NOISE_SEGMENTS = [
  /^app$/i,
  /^home$/i,
  /^homepage$/i,
  /^index$/i,
  /^news$/i,
  /^post$/i,
  /^video$/i,
  /^web$/i,
  /^专题$/i,
  /^专栏$/i,
  /^主页$/i,
  /^全文$/i,
  /^图集$/i,
  /^首页$/i,
  /^视频$/i,
  /^频道$/i,
  /^资讯$/i,
  /^新闻$/i,
  /^文章$/i,
  /^详情$/i,
  /^(login|sign in|register)$/i,
  /^(登录|注册|下载|打开|分享|转载)$/i,
];
const STRIP_PREFIX_PATTERNS = [
  /^(?:直播|更新|快讯|专题|专栏|图集|视频|滚动|独家|推荐|阅读|全文|深度|观察)\s*[:：丨|｜-]+\s*/i,
];
const STRIP_SUFFIX_PATTERNS = [
  /\s*[-|｜丨·•:：]+\s*(?:首页|官网|官方|专题|专栏|频道|资讯|新闻|视频|图集)\s*$/i,
  /\s*\(\s*(?:图|组图|视频)\s*\)\s*$/i,
];

export function sanitizeFilename(value, fallback = "article") {
  const normalized = String(value ?? "")
    .replace(FILE_REPLACEMENTS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  const safe = normalized || fallback;
  return safe.slice(0, 120);
}

export function buildDownloadFilename(article, folder) {
  const safeFolder = sanitizeDownloadFolder(folder);
  const basename = buildArticleBasename(article);
  return safeFolder ? `${safeFolder}/${basename}.epub` : `${basename}.epub`;
}

function buildArticleBasename(article = {}) {
  const sitePart = chooseSiteName(article);
  const titlePart = chooseTitle(article, sitePart);
  return sanitizeFilename(titlePart || article.title || "article", "article");
}

function chooseSiteName(article) {
  const candidates = uniqueNonEmpty([
    article.siteName,
    ...(article.filenameMeta?.siteCandidates ?? []),
    deriveSiteLabelFromUrl(article.sourceUrl),
  ]);

  for (const candidate of candidates) {
    const cleaned = cleanSiteCandidate(candidate, article.sourceUrl);
    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

function chooseTitle(article, sitePart) {
  const siteAliasValues = uniqueNonEmpty([
    sitePart,
    article.siteName,
    ...(article.filenameMeta?.siteCandidates ?? []),
    deriveSiteLabelFromUrl(article.sourceUrl),
    article.filenameMeta?.hostname,
  ]);
  const siteAliases = siteAliasValues.map((value) => normalizeComparable(value)).filter(Boolean);

  const rawCandidates = uniqueNonEmpty([
    ...(article.filenameMeta?.titleCandidates ?? []),
    article.title,
    article.filenameMeta?.headingTitle,
    article.filenameMeta?.pageTitle,
    article.filenameMeta?.pathnameTitle,
  ]);

  let bestCandidate = "";
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const rawCandidate of rawCandidates) {
    const variants = generateTitleVariants(rawCandidate, siteAliasValues, siteAliases, article.sourceUrl);
    for (const variant of variants) {
      const score = scoreTitleCandidate(variant, siteAliases);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = variant;
      }
    }
  }

  if (!bestCandidate) {
    bestCandidate = deriveTitleFromUrl(article.sourceUrl);
  }

  const strippedCandidate = stripSiteAliases(bestCandidate, siteAliasValues, siteAliases);
  const sanitized = sanitizeFilename(strippedCandidate || bestCandidate, "article");
  return sanitized.slice(0, TITLE_MAX_LENGTH).trim() || "article";
}

function generateTitleVariants(rawCandidate, siteAliasValues, siteAliases, sourceUrl) {
  const normalized = normalizeText(rawCandidate);
  if (!normalized) {
    return [];
  }

  const variants = [];
  const push = (value) => {
    const normalizedValue = cleanupTitleCandidate(value, siteAliasValues, siteAliases, sourceUrl);
    if (!normalizedValue) {
      return;
    }

    if (!variants.includes(normalizedValue)) {
      variants.push(normalizedValue);
    }
  };

  push(normalized);

  const segments = splitTitleSegments(normalized);
  const meaningfulSegments = segments.filter((segment) => isMeaningfulTitleSegment(segment, siteAliases));

  for (const segment of meaningfulSegments) {
    push(segment);
  }

  if (meaningfulSegments.length >= 2) {
    push(meaningfulSegments.join(" - "));
  }

  if (segments.length >= 2) {
    push(segments[segments.length - 1]);
    push(segments[0]);
  }

  return variants;
}

function cleanupTitleCandidate(value, siteAliasValues, siteAliases, sourceUrl) {
  let title = normalizeText(value);
  if (!title) {
    return "";
  }

  title = title
    .replace(/^[\[\(【「『《]+/, "")
    .replace(/[\]\)】」』》]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const pattern of STRIP_PREFIX_PATTERNS) {
    title = title.replace(pattern, "").trim();
  }

  for (const pattern of STRIP_SUFFIX_PATTERNS) {
    title = title.replace(pattern, "").trim();
  }

  title = stripSiteAliases(title, siteAliasValues, siteAliases);

  if (GENERIC_TITLE_TERMS.has(normalizeComparable(title))) {
    return "";
  }

  return title;
}

function stripSiteAliases(title, siteAliasValues, siteAliases) {
  let result = normalizeText(title);

  for (const alias of siteAliasValues) {
    const normalizedAlias = normalizeText(alias);
    if (!normalizedAlias) {
      continue;
    }

    const escapedAlias = escapeRegExp(normalizedAlias);
    const edgePatterns = [
      new RegExp(`^${escapedAlias}(?:\\s*[-|｜丨·•:：]+\\s*|\\s+)`, "i"),
      new RegExp(`(?:\\s*[-|｜丨·•:：]+\\s*|\\s+)${escapedAlias}$`, "i"),
      new RegExp(`^${escapedAlias}$`, "i"),
    ];

    for (const pattern of edgePatterns) {
      result = result.replace(pattern, " ").replace(/\s+/g, " ").trim();
    }
  }

  if (siteAliases.includes(normalizeComparable(result))) {
    return "";
  }

  return result;
}

function splitTitleSegments(value) {
  const normalized = value
    .replace(/\s+[|｜丨]\s+/g, "|")
    .replace(/\s+[-—–:：·•»›]\s+/g, "|")
    .replace(/\s+\/\s+/g, "|");

  return normalized
    .split("|")
    .map((segment) => normalizeText(segment))
    .filter(Boolean);
}

function isMeaningfulTitleSegment(segment, siteAliases) {
  const comparable = normalizeComparable(segment);
  if (!comparable || comparable.length < 4) {
    return false;
  }

  if (siteAliases.includes(comparable)) {
    return false;
  }

  if (GENERIC_TITLE_TERMS.has(comparable)) {
    return false;
  }

  return !NOISE_SEGMENTS.some((pattern) => pattern.test(segment));
}

function scoreTitleCandidate(candidate, siteAliases) {
  const comparable = normalizeComparable(candidate);
  if (!comparable) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;
  const plainText = candidate.replace(/\s+/g, " ").trim();
  const length = plainText.length;

  if (length >= 8 && length <= TITLE_MAX_LENGTH) {
    score += 40;
  } else if (length >= 5) {
    score += 18;
  } else {
    score -= 40;
  }

  if (/[\u4e00-\u9fff]/.test(plainText)) {
    score += 18;
  }

  if (/[A-Za-z]/.test(plainText)) {
    score += 12;
  }

  if (/\d/.test(plainText)) {
    score += 4;
  }

  if (!/[A-Za-z\u4e00-\u9fff]/.test(plainText)) {
    score -= 40;
  }

  if (siteAliases.includes(comparable)) {
    score -= 80;
  }

  if (GENERIC_TITLE_TERMS.has(comparable)) {
    score -= 120;
  }

  if (/\b(?:www|http|https|com|net|org|cn)\b/i.test(plainText)) {
    score -= 30;
  }

  if (/^\d+$/.test(plainText)) {
    score -= 80;
  }

  if (/^[\W_]+$/.test(plainText)) {
    score -= 120;
  }

  if (NOISE_SEGMENTS.some((pattern) => pattern.test(plainText))) {
    score -= 50;
  }

  score -= countSeparators(plainText) * 6;
  score += Math.min(meaningfulCharacterCount(plainText), 40);

  return score;
}

function cleanSiteCandidate(value, sourceUrl) {
  let site = normalizeText(value);
  if (!site) {
    return "";
  }

  if (site.includes(".")) {
    site = deriveSiteLabelFromHost(site) || site;
  }

  site = site
    .replace(/^www\./i, "")
    .replace(/\s*(?:官方网站|官网|官方首页|首页)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!site && sourceUrl) {
    site = deriveSiteLabelFromUrl(sourceUrl);
  }

  return sanitizeFilename(site, "").slice(0, SITE_MAX_LENGTH);
}

function deriveSiteLabelFromUrl(sourceUrl) {
  try {
    const { hostname } = new URL(sourceUrl);
    return deriveSiteLabelFromHost(hostname);
  } catch {
    return "";
  }
}

function deriveSiteLabelFromHost(hostname) {
  const labels = String(hostname ?? "")
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean)
    .filter((label) => !COMMON_SUBDOMAINS.has(label));

  if (labels.length === 0) {
    return "";
  }

  if (labels.length === 1) {
    return labels[0];
  }

  const tldIndex = labels.length - 1;
  const secondLevelIndex = tldIndex - 1;
  const secondLevel = labels[secondLevelIndex];

  if (COMMON_DOMAIN_SUFFIX_PARTS.has(secondLevel) && labels.length >= 3) {
    return labels[labels.length - 3];
  }

  return secondLevel;
}

function deriveTitleFromUrl(sourceUrl) {
  try {
    const { pathname } = new URL(sourceUrl);
    const segments = pathname
      .split("/")
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      })
      .map((segment) => segment.replace(/\.[a-z0-9]{1,5}$/i, "").trim())
      .filter(Boolean);

    const candidate = [...segments]
      .reverse()
      .find((segment) => /[A-Za-z\u4e00-\u9fff]/.test(segment) && !/^\d+$/.test(segment));

    return normalizeText((candidate || "").replace(/[-_]+/g, " "));
  } catch {
    return "";
  }
}

function countSeparators(value) {
  const matches = value.match(/[|｜丨:：·•/\\-]/g);
  return matches ? matches.length : 0;
}

function meaningfulCharacterCount(value) {
  const matches = value.match(/[A-Za-z\u4e00-\u9fff0-9]/g);
  return matches ? matches.length : 0;
}

function normalizeText(value) {
  return String(value ?? "")
    .replace(FILE_REPLACEMENTS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeComparable(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[\s\-[\](){}【】「」『』《》|｜丨·•:：/\\]+/g, "");
}

function uniqueNonEmpty(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const normalized = normalizeText(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
