const stickerScreen = require("./sticker.ui.js").default;
const manageScreenModule = require("./manage.ui.js");

const DEFAULT_STICKER_DIR = "/sdcard/Download/sticker";
const PROMPT_INJECT_ENV = "LOKI_STICKER_PROMPT_INJECT";
const PROMPT_MAX_ENV = "LOKI_STICKER_PROMPT_MAX";
const PROMPT_EXTRA_ENV = "LOKI_STICKER_PROMPT_EXTRA";
const PROFILE_CONFIG_ENV = "LOKI_STICKER_PROFILES";
const EXTERNAL_STICKERS_ENV = "LOKI_STICKER_EXTERNAL_LIST";
const INDEX_REFRESH_ENV = "LOKI_STICKER_INDEX_REFRESH_TOKEN";
const IMAGE_EXTS = ["gif", "png", "jpg", "jpeg", "webp"];
const INDEX_TTL_MS = 5 * 60 * 1000;
const STICKER_INDEX_CACHE_LIMIT = 12;

let stickerIndexCacheMap = {};
let stickerIndexRefreshToken = "";

function getConfiguredStickerDir() {
  return getConfiguredStickerDirs()[0] || DEFAULT_STICKER_DIR;
}

function readEnvValue(key) {
  try {
    if (typeof getEnv !== "function") return "";
    return String(getEnv(key) || "").trim();
  } catch (e) {
    return "";
  }
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function normalizePathList(paths) {
  const seen = {};
  const dirs = [];
  for (const item of paths || []) {
    const dir = normalizeAndroidDir(item);
    const key = normalizeKey(dir);
    if (!key || seen[key]) continue;
    seen[key] = true;
    dirs.push(dir);
  }
  return dirs;
}

function parseProfiles() {
  const raw = readEnvValue(PROFILE_CONFIG_ENV);
  const arr = parseJsonArray(raw);
  const profiles = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const paths = normalizePathList(Array.isArray(item.paths) ? item.paths : []);
    profiles.push({
      id: String(item.id || Date.now() + "").trim(),
      name: String(item.name || "表情包配置").trim() || "表情包配置",
      characterCardId: String(item.characterCardId || "").trim(),
      characterCardName: String(item.characterCardName || "").trim(),
      externalText: String(item.externalText || ""),
      paths
    });
  }
  return profiles;
}

function getLegacyConfiguredStickerDirs() {
  let configured = "";
  try {
    if (typeof getEnv === "function") {
      configured = String(getEnv("LOKI_STICKER_DIR") || getEnv("STICKER_DIR") || "").trim();
    }
  } catch (e) {
    configured = "";
  }

  const raw = configured || DEFAULT_STICKER_DIR;
  const parts = String(raw)
    .split(/[\n;,]+/)
    .map(x => normalizeAndroidDir(x))
    .filter(Boolean);

  const seen = {};
  const dirs = [];
  for (const dir of parts) {
    const key = normalizeKey(dir);
    if (!key || seen[key]) continue;
    seen[key] = true;
    dirs.push(dir);
  }
  return dirs.length > 0 ? dirs : [DEFAULT_STICKER_DIR];
}

function getConfiguredStickerDirs() {
  const profiles = parseProfiles();
  const paths = [];
  for (const profile of profiles) {
    for (const p of profile.paths || []) paths.push(p);
  }
  const fromProfiles = normalizePathList(paths);
  if (fromProfiles.length) return fromProfiles;
  return getLegacyConfiguredStickerDirs();
}

function getPromptStickerDirsForCard(cardId, cardName) {
  const profiles = parseProfiles();
  const normalizedCardId = String(cardId || "").trim();
  const normalizedCardName = String(cardName || "").trim();

  const boundById = normalizedCardId
    ? profiles.filter(p => String(p.characterCardId || "").trim() === normalizedCardId)
    : [];
  if (boundById.length) {
    const paths = [];
    for (const profile of boundById) {
      for (const p of profile.paths || []) paths.push(p);
    }
    return normalizePathList(paths);
  }

  const boundByName = normalizedCardName
    ? profiles.filter(p => String(p.characterCardName || "").trim() === normalizedCardName)
    : [];
  if (boundByName.length) {
    const paths = [];
    for (const profile of boundByName) {
      for (const p of profile.paths || []) paths.push(p);
    }
    return normalizePathList(paths);
  }

  const global = profiles.filter(p => !String(p.characterCardId || "").trim());
  if (global.length) {
    const paths = [];
    for (const profile of global) {
      for (const p of profile.paths || []) paths.push(p);
    }
    return normalizePathList(paths);
  }

  return getLegacyConfiguredStickerDirs();
}

function getExternalTextForAllProfiles() {
  const chunks = [];
  const legacy = readEnvValue(EXTERNAL_STICKERS_ENV);
  if (legacy) chunks.push(legacy);
  const profiles = parseProfiles();
  for (const profile of profiles) {
    const text = String(profile.externalText || "").trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n");
}

function getExternalTextForCard(cardId, cardName) {
  const profiles = parseProfiles();
  const normalizedCardId = String(cardId || "").trim();
  const normalizedCardName = String(cardName || "").trim();
  const chunks = [];
  const legacy = readEnvValue(EXTERNAL_STICKERS_ENV);
  if (legacy) chunks.push(legacy);

  const global = profiles.filter(p => !String(p.characterCardId || "").trim());
  for (const profile of global) {
    const text = String(profile.externalText || "").trim();
    if (text) chunks.push(text);
  }

  const byId = normalizedCardId ? profiles.filter(p => String(p.characterCardId || "").trim() === normalizedCardId) : [];
  const byName = (!byId.length && normalizedCardName) ? profiles.filter(p => String(p.characterCardName || "").trim() === normalizedCardName) : [];
  for (const profile of byId.concat(byName)) {
    const text = String(profile.externalText || "").trim();
    if (text) chunks.push(text);
  }
  return chunks.join("\n");
}

function parseExternalStickerRecords(text) {
  const map = {};
  const records = [];
  const errors = [];
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = String(lines[i] || "").trim();
    if (!raw || raw.startsWith("#")) continue;
    const m = raw.match(/^(.+?)\s*[:：]\s*(https?:\/\/\S+)\s*$/i);
    if (!m) {
      errors.push("第 " + (i + 1) + " 行格式错误：应为 表情名: https://图片URL");
      continue;
    }
    const name = String(m[1] || "").trim();
    const uri = String(m[2] || "").trim();
    if (!name || !uri) continue;
    const key = normalizeKey(name);
    map[key] = {
      fileName: name,
      baseName: name,
      displayName: name,
      displayFileName: name,
      ext: getExtension(uri),
      uri,
      sourceType: "external",
      path: uri
    };
  }
  for (const key of Object.keys(map)) records.push(map[key]);
  return { records, errors };
}

function addExternalStickersToIndex(index, externalText) {
  const parsed = parseExternalStickerRecords(externalText);
  for (const err of parsed.errors || []) index.errors.push(err);

  for (const record of parsed.records || []) {
    let displayName = record.baseName;
    const localConflict = !!pickBestRecord(index.byDisplayName && index.byDisplayName[normalizeKey(displayName)])
      || !!pickBestRecord(index.byBaseName && index.byBaseName[normalizeKey(displayName)]);
    if (localConflict) displayName = "EL-" + displayName;
    record.displayName = displayName;
    record.displayFileName = displayName;
    index.all.push(record);

    const displayKey = normalizeKey(displayName);
    if (!index.byDisplayName[displayKey]) index.byDisplayName[displayKey] = [];
    index.byDisplayName[displayKey].push(record);

    const baseKey = normalizeKey(record.baseName);
    if (!localConflict) {
      if (!index.byBaseName[baseKey]) index.byBaseName[baseKey] = [];
      index.byBaseName[baseKey].push(record);
    }
  }
}

function getStickerDirCacheKey(dirs, externalText) {
  return (dirs || []).join("\n") + "\n#external\n" + String(externalText || "");
}

function clearStickerIndexCache(cacheKey) {
  if (cacheKey) {
    delete stickerIndexCacheMap[cacheKey];
    return;
  }
  stickerIndexCacheMap = {};
}
function getCachedStickerIndex(cacheKey, now) {
  const cached = stickerIndexCacheMap[cacheKey];
  if (!cached) return null;
  if (now - cached.at >= INDEX_TTL_MS) {
    delete stickerIndexCacheMap[cacheKey];
    return null;
  }
  cached.lastUsed = now;
  return cached.index;
}
function setCachedStickerIndex(cacheKey, index, now) {
  stickerIndexCacheMap[cacheKey] = {
    index,
    at: now,
    lastUsed: now
  };
  const keys = Object.keys(stickerIndexCacheMap);
  if (keys.length <= STICKER_INDEX_CACHE_LIMIT) return;
  keys
    .sort((a, b) => (stickerIndexCacheMap[a].lastUsed || 0) - (stickerIndexCacheMap[b].lastUsed || 0))
    .slice(0, keys.length - STICKER_INDEX_CACHE_LIMIT)
    .forEach(key => delete stickerIndexCacheMap[key]);
}

function consumeIndexRefreshToken() {
  const token = readEnvValue(INDEX_REFRESH_ENV);
  if (token && token !== stickerIndexRefreshToken) {
    stickerIndexRefreshToken = token;
    clearStickerIndexCache();
    return true;
  }
  return false;
}

function normalizeAndroidDir(dir) {
  let normalized = String(dir || DEFAULT_STICKER_DIR).trim();
  if (!normalized) normalized = DEFAULT_STICKER_DIR;

  if (normalized.startsWith("file://")) {
    normalized = normalized.slice("file://".length);
  }

  normalized = normalized.replace(/\\/g, "/");
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized || DEFAULT_STICKER_DIR;
}

function registerToolPkg() {
  ToolPkg.registerToolboxUiModule({
    id: "loki_sticker_manager",
    runtime: "compose_dsl",
    screen: manageScreenModule,
    params: {},
    title: {
      zh: "表情包渲染器",
      en: "Sticker Renderer"
    }
  });

  ToolPkg.registerXmlRenderPlugin({
    id: "loki_sticker_xml_render",
    tag: "sticker",
    function: onXmlRender
  });

  ToolPkg.registerXmlRenderPlugin({
    id: "loki_meme_xml_render",
    tag: "meme",
    function: onXmlRender
  });

  ToolPkg.registerSystemPromptComposeHook({
    id: "loki_sticker_prompt_inject",
    function: onSystemPromptCompose
  });

  // MessageProcessingPlugin 旧实验入口已停用；稳定入口是 <meme> / <sticker> XML render hook。

  return true;
}

function getPayload(event) {
return event && event.eventPayload ? event.eventPayload : event || {};
}

function decodeEntities(text) {
  const amp = "&";
  return String(text || "")
    .replace(new RegExp(amp + "quot;", "g"), '"')
    .replace(new RegExp(amp + "#34;", "g"), '"')
    .replace(new RegExp(amp + "apos;", "g"), "'")
    .replace(new RegExp(amp + "#39;", "g"), "'")
    .replace(new RegExp(amp + "lt;", "g"), "<")
    .replace(new RegExp(amp + "gt;", "g"), ">")
    .replace(new RegExp(amp + "amp;", "g"), amp);
}

function getFileNameOnly(name) {
  return String(name || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop() || "";
}

function stripExtension(name) {
  return String(name || "").replace(/\.(gif|png|jpe?g|webp)$/i, "");
}

function getExtension(name) {
  const m = String(name || "").match(/\.([^.]+)$/);
  return m ? m[1].toLowerCase() : "";
}

function hasImageExtension(name) {
  return IMAGE_EXTS.indexOf(getExtension(name)) >= 0;
}

function normalizeKey(text) {
  return String(text || "").trim().toLowerCase();
}

function escapeDisplayText(text) {
  return String(text || "sticker").replace(/[\[\]]/g, "");
}

function encodeFileUriPath(path) {
  // Operit 已实测支持中文 file URI，例如 file:///sdcard/Download/sticker/瘫.gif
  return "file://" + path;
}

function parseStickerName(xmlContent, tagName) {
  const xml = decodeEntities(xmlContent || "").trim();
  const tag = String(tagName || "sticker").toLowerCase().replace(/[^a-z0-9_-]/g, "") || "sticker";

  const attrPatterns = [
    /\bname\s*=\s*"([^"]+)"/i,
    /\bname\s*=\s*'([^']+)'/i,
    /\bsrc\s*=\s*"([^"]+)"/i,
    /\bsrc\s*=\s*'([^']+)'/i
  ];

  for (const pattern of attrPatterns) {
    const m = xml.match(pattern);
    if (m && m[1]) return getFileNameOnly(m[1]);
  }

  const body = xml.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + tag + ">", "i"));
  if (body && body[1]) return getFileNameOnly(body[1]);

  return "";
}

function extPriority(ext) {
  const idx = IMAGE_EXTS.indexOf(String(ext || "").toLowerCase());
  return idx >= 0 ? idx : 999;
}

function sortStickerRecords(records) {
  return records.sort((a, b) => {
    const p = extPriority(a.ext) - extPriority(b.ext);
    if (p !== 0) return p;
    return String(a.fileName).localeCompare(String(b.fileName));
  });
}

async function scanStickerIndex(force, overrideDirs, overrideExternalText) {
  const refreshed = consumeIndexRefreshToken();
  if (refreshed) force = true;
  const now = Date.now();
  const stickerDirs = overrideDirs !== undefined ? normalizePathList(overrideDirs) : normalizePathList(getConfiguredStickerDirs());
  const externalText = overrideExternalText !== undefined ? String(overrideExternalText || "") : getExternalTextForAllProfiles();
  const cacheKey = getStickerDirCacheKey(stickerDirs, externalText);
  const multiDir = stickerDirs.length > 1;
  if (!force) {
    const cached = getCachedStickerIndex(cacheKey, now);
    if (cached) return cached;
  }

  const index = {
    stickerDir: stickerDirs[0] || DEFAULT_STICKER_DIR,
    stickerDirs,
    multiDir,
    byFullName: {},
    byBaseName: {},
    byDisplayName: {},
    all: [],
    errors: [],
    error: null
  };

  for (let dirIdx = 0; dirIdx < stickerDirs.length; dirIdx += 1) {
    const stickerDir = stickerDirs[dirIdx];
    try {
      const listing = await Tools.Files.list(stickerDir, "android");
      const entries = Array.isArray(listing && listing.entries) ? listing.entries : [];

      for (const entry of entries) {
        if (!entry || entry.isDirectory) continue;
        const fileName = String(entry.name || "").trim();
        if (!fileName || !hasImageExtension(fileName)) continue;

        const ext = getExtension(fileName);
        const baseName = stripExtension(fileName);
        const prefix = String(dirIdx + 1) + "-";
        const displayName = multiDir ? prefix + baseName : baseName;
        const displayFileName = multiDir ? prefix + fileName : fileName;
        const record = {
          fileName,
          baseName,
          displayName,
          displayFileName,
          dirIndex: dirIdx + 1,
          dirPath: stickerDir,
          ext,
          path: `${stickerDir}/${fileName}`,
          size: entry.size || 0,
          lastModified: entry.lastModified || ""
        };

        index.all.push(record);

        const fullKey = normalizeKey(fileName);
        if (!index.byFullName[fullKey]) index.byFullName[fullKey] = [];
        index.byFullName[fullKey].push(record);

        const displayFullKey = normalizeKey(displayFileName);
        if (!index.byFullName[displayFullKey]) index.byFullName[displayFullKey] = [];
        index.byFullName[displayFullKey].push(record);

        const baseKey = normalizeKey(baseName);
        if (!index.byBaseName[baseKey]) index.byBaseName[baseKey] = [];
        index.byBaseName[baseKey].push(record);

        const displayKey = normalizeKey(displayName);
        if (!index.byDisplayName[displayKey]) index.byDisplayName[displayKey] = [];
        index.byDisplayName[displayKey].push(record);
      }
    } catch (e) {
      index.errors.push(`${stickerDir}: ${String((e && e.message) || e || "扫描目录失败")}`);
    }
  }

  addExternalStickersToIndex(index, externalText);

  for (const key of Object.keys(index.byFullName)) {
    index.byFullName[key] = sortStickerRecords(index.byFullName[key]);
  }
  for (const key of Object.keys(index.byBaseName)) {
    index.byBaseName[key] = sortStickerRecords(index.byBaseName[key]);
  }
  for (const key of Object.keys(index.byDisplayName)) {
    index.byDisplayName[key] = sortStickerRecords(index.byDisplayName[key]);
  }
  index.all = sortStickerRecords(index.all);
  if (index.all.length === 0 && index.errors.length > 0) {
    index.error = index.errors.join("; ");
  }

  setCachedStickerIndex(cacheKey, index, now);
  return index;
}

function pickBestRecord(records) {
  return Array.isArray(records) && records.length > 0 ? records[0] : null;
}

async function resolveStickerRecord(name) {
  const raw = getFileNameOnly(name);
  if (!raw) return { record: null, reason: "empty" };

  let index = await scanStickerIndex(false);
  let record = findRecordInIndex(index, raw);
  if (record) return { record, index };

  // 缓存期内新增表情包时，第一次找不到就强制刷新一次。
  index = await scanStickerIndex(true);
  record = findRecordInIndex(index, raw);
  if (record) return { record, index };

  return { record: null, index, reason: index.error || "not_found" };
}

function findRecordInIndex(index, rawName) {
  if (!index) return null;
  const raw = getFileNameOnly(rawName);
  if (!raw) return null;

  const displayHit = pickBestRecord(index.byDisplayName && index.byDisplayName[normalizeKey(stripExtension(raw))]);
  if (displayHit) return displayHit;

  if (hasImageExtension(raw)) {
    const byFull = pickBestRecord(index.byFullName[normalizeKey(raw)]);
    if (byFull) return byFull;

    // 如果写了后缀但文件后缀不匹配，也尝试按 basename 找。
    const byBaseFromFull = pickBestRecord(index.byBaseName[normalizeKey(stripExtension(raw))]);
    if (byBaseFromFull) return byBaseFromFull;
  }

  return pickBestRecord(index.byBaseName[normalizeKey(stripExtension(raw))]);
}

function getStickerSuggestions(index, rawName, limit) {
  if (!index || !Array.isArray(index.all)) return [];
  const raw = normalizeKey(stripExtension(getFileNameOnly(rawName)));
  if (!raw) return [];

  const scored = [];
  const seen = {};
  for (const record of index.all) {
    const base = String(record.displayName || record.baseName || "");
    const key = normalizeKey(base);
    if (!key || seen[key]) continue;
    seen[key] = true;

    let score = 0;
    if (key === raw) score += 100;
    if (key.indexOf(raw) >= 0 || raw.indexOf(key) >= 0) score += 50;
    score += commonPrefixLength(key, raw);
    score += commonSubstringBonus(key, raw);

    if (score > 0) scored.push({ base, score });
  }

  scored.sort((a, b) => b.score - a.score || a.base.localeCompare(b.base));
  return scored.slice(0, limit || 5).map(x => x.base);
}

function commonPrefixLength(a, b) {
  let n = 0;
  const len = Math.min(a.length, b.length);
  while (n < len && a[n] === b[n]) n += 1;
  return n;
}

function commonSubstringBonus(a, b) {
  // 轻量候选提示，不做复杂编辑距离，避免渲染时太重。
  let best = 0;
  for (let i = 0; i < a.length; i += 1) {
    for (let j = i + 1; j <= a.length; j += 1) {
      const part = a.slice(i, j);
      if (part.length > best && b.indexOf(part) >= 0) best = part.length;
    }
  }
  return best;
}

function buildNotFoundText(name, index, reason) {
  if (reason && reason !== "not_found") {
    return `[meme:${name} ${reason}]`;
  }
  const suggestions = getStickerSuggestions(index, name, 3);
  if (suggestions.length > 0) {
    return `[meme:${name} 未找到。是不是：${suggestions.join(" / ")}]`;
  }
  return `[meme:${name} 未找到]`;
}

async function onXmlRender(event) {
  const payload = getPayload(event);
  const tagName = String(payload.tagName || "").toLowerCase();
  if (tagName && tagName !== "sticker" && tagName !== "meme") {
    return { handled: false };
  }

  const name = parseStickerName(payload.xmlContent || "", tagName || "sticker");
  if (!name) {
    return { handled: true, text: "[meme:缺少名称]" };
  }

  try {
    const resolved = await resolveStickerRecord(name);
  if (!resolved.record) {
    return { handled: true, text: buildNotFoundText(name, resolved.index, resolved.reason) };
  }

  const record = resolved.record;
  const displayName = escapeDisplayText(record.displayName || record.baseName || stripExtension(name));
  const uri = record.uri || encodeFileUriPath(record.path);

  return {
    handled: true,
    composeDsl: {
      screen: stickerScreen,
      state: {
        key: "sticker-" + (record.uri || record.path),
        name: displayName,
        fileName: record.fileName,
        ext: record.ext,
        path: record.path,
        uri,
        fileUri: uri
      },
      memo: {}
    }
  };
  } catch (e) {
    return { handled: true, text: "[meme:" + name + " 渲染暂时失败，请点重建索引后重试]" };
  }
}

function isPromptInjectEnabled() {
  try {
    if (typeof getEnv !== "function") return false;
    const raw = String(getEnv(PROMPT_INJECT_ENV) || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  } catch (e) {
    return false;
  }
}

function readPromptSetting(key, fallback) {
  try {
    if (typeof getEnv !== "function") return fallback;
    const raw = String(getEnv(key) || "").trim();
    return raw || fallback;
  } catch (e) {
    return fallback;
  }
}

function clampPromptMax(raw) {
  const n = parseInt(String(raw || "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.max(1, Math.min(n, 20));
}

function formatStickerNameList(records) {
  return (records || [])
    .map(x => x.displayName || x.baseName)
    .filter(Boolean)
    .join(" | ");
}

function buildStickerPromptFromRecords(records) {
  const names = formatStickerNameList(records);
  const maxPerReply = clampPromptMax(readPromptSetting(PROMPT_MAX_ENV, "2"));
  const extraRules = String(readPromptSetting(PROMPT_EXTRA_ENV, "")).trim();
  const lines = [
    "<stickers_list>",
    "You can use suitable stickers from the valid names list when they fit the conversation.",
    "",
    "[Rules]",
    "- Use exactly: <meme>name</meme> (also supports <sticker>name</sticker>)",
    "- Do not wrap sticker tags in Markdown/code blocks.",
    "- Use at most " + maxPerReply + " stickers per reply.",
    "- Use stickers only when they naturally fit the emotion or situation; you do not need to include stickers in every reply.",
    "- Use only valid names from the list; never invent names.",
    "- In [Valid names], sticker names are separated by ` | `. The separator is not part of the name."
  ];

  if (extraRules) {
    lines.push("- Follow these extra rules:");
    lines.push(extraRules);
  }

  lines.push(
    "",
    "[Valid names]",
    names || "(none)",
    "",
    "[Example]",
    "今天是周四，按照传统",
    "<meme>V你50</meme>",
    "请收好",
    "</stickers_list>"
  );

  return lines.join("\n");
}

async function resolveCurrentCharacterCardIdentity(event) {
  let cardId = "";
  let cardName = "";

  try {
    const directCardId = typeof getCallerCardId === "function" ? getCallerCardId() : undefined;
    if (directCardId && String(directCardId).trim()) cardId = String(directCardId).trim();
  } catch (e) {}

  try {
    const payload = getPayload(event);
    const metadata = payload && payload.metadata ? payload.metadata : {};
    const metaName = metadata.groupOrchestrationRoleName || metadata.characterCardName || metadata.roleName || metadata.name || "";
    if (metaName && String(metaName).trim()) cardName = String(metaName).trim();
  } catch (e) {}

  try {
    const payload = getPayload(event);
    const chatId = payload && payload.chatId;
    if (chatId && Tools.Chat && Tools.Chat.findChat) {
      const chatResult = await Tools.Chat.findChat({ query: String(chatId), match: "exact", index: 0 });
      const chatCardName = String(
        chatResult &&
        chatResult.chat &&
        (chatResult.chat.characterCardName || chatResult.chat.characterName || chatResult.chat.roleName || "")
      ).trim();
      if (chatCardName && !cardName) cardName = chatCardName;
    }
  } catch (e) {}

  try {
    if (!cardId && cardName && Tools.Chat && Tools.Chat.listCharacterCards) {
      const cardResult = await Tools.Chat.listCharacterCards();
      const cards = Array.isArray(cardResult && cardResult.cards) ? cardResult.cards : [];
      const matched = cards.find(card => String(card && card.name || "").trim() === cardName);
      if (matched && matched.id) cardId = String(matched.id).trim();
    }
  } catch (e) {}

  return {
    cardId: String(cardId || "").trim(),
    cardName: String(cardName || "").trim()
  };
}

async function onSystemPromptCompose(event) {
  const stage = (event && (event.eventName || event.event)) || "";
  if (stage !== "after_compose_system_prompt") return null;
  if (!isPromptInjectEnabled()) return null;

  const payload = getPayload(event);
  const currentPrompt = String(payload.systemPrompt || "");
  const identity = await resolveCurrentCharacterCardIdentity(event);
  const promptDirs = getPromptStickerDirsForCard(identity.cardId, identity.cardName);
  const promptExternalText = getExternalTextForCard(identity.cardId, identity.cardName);
  const index = await scanStickerIndex(false, promptDirs, promptExternalText);
  if (index.error) return { systemPrompt: currentPrompt };

  const injection = buildStickerPromptFromRecords(index.all);
  if (!injection || currentPrompt.indexOf("<stickers_list>") >= 0) {
    return { systemPrompt: currentPrompt };
  }
  return { systemPrompt: currentPrompt + "\n\n" + injection };
}

async function onMessageProcessing(event) {
  return { matched: false };
}

exports.registerToolPkg = registerToolPkg;
exports.onXmlRender = onXmlRender;
exports.onMessageProcessing = onMessageProcessing;
exports.onSystemPromptCompose = onSystemPromptCompose;

// 导出少量函数，方便未来调试。
exports.scanStickerIndex = scanStickerIndex;
exports.resolveStickerRecord = resolveStickerRecord;
exports.clearStickerIndexCache = clearStickerIndexCache;
exports.resolveCurrentCharacterCardIdentity = resolveCurrentCharacterCardIdentity;