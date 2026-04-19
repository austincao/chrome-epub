export function stripInvalidXmlCharacters(value) {
  return String(value ?? "").replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd]/g, "");
}

export function escapeXml(value) {
  return stripInvalidXmlCharacters(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeAttribute(value) {
  return escapeXml(value).replace(/"/g, "&quot;");
}

