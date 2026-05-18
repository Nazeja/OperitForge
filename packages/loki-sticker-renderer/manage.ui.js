const DEFAULT_DIR = "/sdcard/Download/sticker";
const PROMPT_INJECT_ENV = "LOKI_STICKER_PROMPT_INJECT";
const PROMPT_MAX_ENV = "LOKI_STICKER_PROMPT_MAX";
const PROMPT_EXTRA_ENV = "LOKI_STICKER_PROMPT_EXTRA";
const PROFILE_CONFIG_ENV = "LOKI_STICKER_PROFILES";
const EXTERNAL_STICKERS_ENV = "LOKI_STICKER_EXTERNAL_LIST";
const INDEX_REFRESH_ENV = "LOKI_STICKER_INDEX_REFRESH_TOKEN";
const EMPTY_LABEL_KEEPER = "\u200B";
const IMAGE_EXTS = ["gif", "png", "jpg", "jpeg", "webp"];

function trimSlash(s) {
  let v = String(s || "").trim().replace(/\\/g, "/");
  while (v.length > 1 && v.endsWith("/")) v = v.slice(0, -1);
  return v;
}

function normalizeOnePath(input) {
  let v = String(input || "").trim();
  if (!v) return "";
  if (v.startsWith("file://")) v = v.slice("file://".length);
  v = v.replace(/\\/g, "/");
  if (v.startsWith("/")) return trimSlash(v);
  return trimSlash("/sdcard/" + v.replace(/^\/+/, ""));
}

function parseInputPaths(input) {
  const parts = String(input || "")
    .split(/[\n;,]+/)
    .map(normalizeOnePath)
    .filter(Boolean);
  const seen = {};
  const paths = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    paths.push(p);
  }
  return paths;
}

function displayInputFromPaths(paths) {
  return (paths || []).map(p => String(p).replace(/^\/sdcard\//, "")).join("\n");
}

function readEnvText(key) {
  try {
    if (typeof getEnv !== "function") return "";
    return String(getEnv(key) || "");
  } catch (e) {
    return "";
  }
}

function readPromptMax() {
  const n = parseInt(String(readEnvText(PROMPT_MAX_ENV) || "2").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.max(1, Math.min(n, 20));
}

function cleanExtraRulesText(text) {
  return String(text || "").replace(/\u200B/g, "").trim();
}

function displayExtraRulesText(text) {
  const cleaned = cleanExtraRulesText(text);
  return cleaned || EMPTY_LABEL_KEEPER;
}

function readExtraRules() {
  return readEnvText(PROMPT_EXTRA_ENV).trim();
}

function readInjectEnabled() {
  try {
    if (typeof getEnv !== "function") return false;
    const raw = String(getEnv(PROMPT_INJECT_ENV) || "").trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  } catch (e) {
    return false;
  }
}

function parseProfilesText(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(String(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function readProfiles(ctx) {
  const raw = ctx && ctx.getEnv ? String(ctx.getEnv(PROFILE_CONFIG_ENV) || "") : readEnvText(PROFILE_CONFIG_ENV);
  const arr = parseProfilesText(raw);
  return arr.filter(x => x && typeof x === "object").map((x, i) => ({
    id: String(x.id || "profile_" + Date.now() + "_" + i),
    name: String(x.name || "表情包配置" + (i + 1)),
    characterCardId: String(x.characterCardId || ""),
    characterCardName: String(x.characterCardName || ""),
    externalText: String(x.externalText || ""),
    paths: parseInputPaths((x.paths || []).join("\n"))
  }));
}

function pathFolderName(path) {
  const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function profilePathSummary(paths) {
  const names = (paths || []).map(pathFolderName).filter(Boolean);
  return names.length ? names.join(", ") : "未配置路径";
}

function parseExternalText(text) {
  const records = [];
  const errors = [];
  const seen = {};
  const lines = String(text || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const raw = String(lines[i] || "").trim();
    if (!raw || raw.startsWith("#")) continue;
    const m = raw.match(/^(.+?)\s*[:：]\s*(https?:\/\/\S+)\s*$/i);
    if (!m) { errors.push("第 " + (i + 1) + " 行格式错误"); continue; }
    const name = String(m[1] || "").trim();
    const uri = String(m[2] || "").trim();
    if (!name || !uri) { errors.push("第 " + (i + 1) + " 行为空"); continue; }
    seen[name.toLowerCase()] = { name, uri };
  }
  Object.keys(seen).forEach(k => records.push(seen[k]));
  return { records, errors };
}

function externalSummary(text) {
  const parsed = parseExternalText(text);
  return "外链 " + parsed.records.length + " 个" + (parsed.errors.length ? "，错误 " + parsed.errors.length + " 行" : "");
}

function profilesSummary(profiles) {
  if (!profiles || !profiles.length) return "暂无表情包配置";
  return profiles.map((p, i) => {
    const target = p.characterCardId ? (p.characterCardName || "已绑定角色卡") : "全局默认";
    return (i + 1) + ". " + target + "｜" + profilePathSummary(p.paths) + "｜" + externalSummary(p.externalText);
  }).join("\n");
}

function buildProfileFromState(paths, cardId, cardName, externalText) {
  return {
    id: cardId ? "card_" + String(cardId) : "global",
    name: cardId ? (cardName || "已绑定角色卡") : "全局默认",
    characterCardId: String(cardId || "").trim(),
    characterCardName: String(cardName || "").trim(),
    externalText: String(externalText || ""),
    paths: paths || []
  };
}

function upsertProfile(profiles, nextProfile) {
  const key = String(nextProfile.characterCardId || "").trim();
  const result = [];
  let replaced = false;
  for (const p of profiles || []) {
    const pKey = String(p.characterCardId || "").trim();
    if (pKey === key) {
      if (!replaced) {
        result.push(nextProfile);
        replaced = true;
      }
    } else {
      result.push(p);
    }
  }
  if (!replaced) result.push(nextProfile);
  return result;
}

function findProfileForCard(profiles, cardId) {
  const key = String(cardId || "").trim();
  for (const p of profiles || []) {
    const pKey = String(p.characterCardId || "").trim();
    if (pKey === key) return p;
  }
  return null;
}

function removeProfileForCard(profiles, cardId) {
  const key = String(cardId || "").trim();
  return (profiles || []).filter(function (p) {
    return String(p && p.characterCardId || "").trim() !== key;
  });
}

function getPathsForCard(profiles, cardId) {
  const profile = findProfileForCard(profiles, cardId);
  return profile && Array.isArray(profile.paths) ? profile.paths : [];
}

function clampPromptMax(raw) {
  const n = parseInt(String(raw || "").trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return 2;
  return Math.max(1, Math.min(n, 20));
}

function buildPrompt(stickers, options) {
  const names = stickers.map(x => x.displayName || x.name).filter(Boolean).join(" | ");
  const maxPerReply = clampPromptMax(options && options.maxPerReply);
  const extraRules = String(options && options.extraRules || "").trim();
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

async function scanDirs(paths) {
  const dirs = paths && paths.length ? paths : [];
  const multiDir = dirs.length > 1;
  const stickers = [];
  const errors = [];
  for (let i = 0; i < dirs.length; i += 1) {
    const dir = dirs[i];
    try {
      const listing = await Tools.Files.list(dir);
      const entries = Array.isArray(listing) ? listing : (Array.isArray(listing && listing.entries) ? listing.entries : []);
      for (const e of entries) {
        if (!e || e.isDirectory) continue;
        const fileName = String(e.name || "").trim();
        if (!fileName || !/\.(gif|png|jpe?g|webp)$/i.test(fileName)) continue;
        const name = String(fileName).replace(/\.(gif|png|jpe?g|webp)$/i, "");
        const prefix = String(i + 1) + "-";
        stickers.push({
          fileName,
          name,
          displayName: multiDir ? prefix + name : name,
          dirIndex: i + 1,
          dirPath: dir
        });
      }
    } catch (e) {
      errors.push(dir + ": " + String((e && e.message) || e));
    }
  }
  stickers.sort((a, b) => a.displayName.localeCompare(b.displayName));
  return { stickers, errors, multiDir };
}

function mergeExternalForDisplay(stickers, externalText) {
  const parsed = parseExternalText(externalText);
  const localNames = {};
  for (const s of stickers || []) localNames[String(s.displayName || s.name || "").toLowerCase()] = true;
  const external = parsed.records.map(function (r) {
    const conflict = localNames[String(r.name || "").toLowerCase()];
    return {
      name: r.name,
      displayName: conflict ? "EL-" + r.name : r.name,
      uri: r.uri,
      sourceType: "external"
    };
  });
  return { stickers: (stickers || []).concat(external), errors: parsed.errors, externalCount: external.length };
}

function Screen(ctx) {
  const UI = ctx.UI;
  const initialPaths = parseInputPaths(ctx.getEnv ? (ctx.getEnv("LOKI_STICKER_DIR") || "") : "");
  const [input, setInput] = ctx.useState("input", displayInputFromPaths(initialPaths));
  const [path, setPath] = ctx.useState("path", initialPaths.join("\n"));
  const [status, setStatus] = ctx.useState("status", "未扫描");
  const [listText, setListText] = ctx.useState("listText", "");
  const [promptText, setPromptText] = ctx.useState("promptText", "");
  const [mode, setMode] = ctx.useState("mode", "scan");
  const [injectEnabled, setInjectEnabled] = ctx.useState("injectEnabled", readInjectEnabled());
  const [maxPerReply, setMaxPerReply] = ctx.useState("maxPerReply", String(readPromptMax()));
  const [extraRules, setExtraRules] = ctx.useState("extraRules", displayExtraRulesText(readExtraRules()));
  const [profiles, setProfiles] = ctx.useState("profiles", readProfiles(ctx));
  const [cards, setCards] = ctx.useState("cards", []);
  const [cardsLoadedOnce, setCardsLoadedOnce] = ctx.useState("cardsLoadedOnce", false);
  const [showCardPicker, setShowCardPicker] = ctx.useState("showCardPicker", false);
  const [selectedCardId, setSelectedCardId] = ctx.useState("selectedCardId", "");
  const [selectedCardName, setSelectedCardName] = ctx.useState("selectedCardName", "");
  const [pathInputVersion, setPathInputVersion] = ctx.useState("pathInputVersion", "0");
  const [externalInput, setExternalInput] = ctx.useState("externalInput", readEnvText(EXTERNAL_STICKERS_ENV));
  const [externalInputVersion, setExternalInputVersion] = ctx.useState("externalInputVersion", "0");

  function currentPaths() {
    return parseInputPaths(input);
  }

  function formatList(stickers) {
    if (!stickers || !stickers.length) return "未配置本地或外链表情包";
    return stickers.map(x => {
      const src = x.uri || ((x.dirPath || "") + "/" + x.fileName);
      return (x.displayName || x.name) + "  →  " + src;
    }).join("\n") || "目录中没有找到支持的图片文件";
  }

  async function savePromptSettings() {
    const nextMax = clampPromptMax(maxPerReply);
    const nextExtra = cleanExtraRulesText(extraRules);
    setMaxPerReply(String(nextMax));
    setExtraRules(displayExtraRulesText(nextExtra));
    if (ctx.setEnv) {
      await ctx.setEnv(PROMPT_MAX_ENV, String(nextMax));
      await ctx.setEnv(PROMPT_EXTRA_ENV, nextExtra);
    }
    setStatus("已保存提示词设置：最多 " + nextMax + " 张 / 自定义规则已保存");
  }

  async function scan() {
    const paths = currentPaths();
    setPath(paths.join("\n"));
    try {
      const result = await scanDirs(paths);
      const merged = mergeExternalForDisplay(result.stickers, externalInput);
      setMode("scan");
      const suffix = result.multiDir ? "，多路径前缀模式已启用" : "";
      const warn = result.errors.length ? "；失败 " + result.errors.length + " 个目录" : "";
      const extWarn = merged.errors.length ? "；外链错误 " + merged.errors.length + " 行" : "";
      setStatus("扫描完成：本地 " + result.stickers.length + " 个，外链 " + merged.externalCount + " 个" + suffix + warn + extWarn);
      setListText(formatList(merged.stickers));
    } catch (e) {
      setStatus("扫描失败：" + String((e && e.message) || e));
      setListText("");
    }
  }

  async function forceRebuildIndex() {
    const token = String(Date.now());
    if (ctx.setEnv) await ctx.setEnv(INDEX_REFRESH_ENV, token);
    try {
      const paths = currentPaths();
      setPath(paths.join("\n"));
      const result = await scanDirs(paths);
      const merged = mergeExternalForDisplay(result.stickers, externalInput);
      setMode("scan");
      const suffix = result.multiDir ? "，多路径前缀模式已启用" : "";
      const warn = result.errors.length ? "；失败 " + result.errors.length + " 个目录" : "";
      const extWarn = merged.errors.length ? "；外链错误 " + merged.errors.length + " 行" : "";
      setStatus("已请求重建索引：本地 " + result.stickers.length + " 个，外链 " + merged.externalCount + " 个" + suffix + warn + extWarn);
      setListText(formatList(merged.stickers));
    } catch (e) {
      setStatus("已请求重建索引；当前目录扫描失败：" + String((e && e.message) || e));
    }
  }

  async function generatePrompt() {
    const paths = currentPaths();
    setPath(paths.join("\n"));
    try {
      const result = await scanDirs(paths);
      const merged = mergeExternalForDisplay(result.stickers, externalInput);
      const nextMax = clampPromptMax(maxPerReply);
      const nextExtra = cleanExtraRulesText(extraRules);
      setMode("prompt");
      const suffix = result.multiDir ? "，已使用 1- / 2- 数字前缀" : "";
      const extWarn = merged.errors.length ? "；外链错误 " + merged.errors.length + " 行" : "";
      setStatus("提示词已生成：本地 " + result.stickers.length + " 个，外链 " + merged.externalCount + " 个" + suffix + extWarn);
      setListText(formatList(merged.stickers));
      setPromptText(buildPrompt(merged.stickers, { maxPerReply: nextMax, extraRules: nextExtra }));
    } catch (e) {
      setStatus("生成失败：" + String((e && e.message) || e));
      setPromptText("");
    }
  }

  async function toggleInject() {
    const next = !injectEnabled;
    setInjectEnabled(next);
    if (ctx.setEnv) await ctx.setEnv(PROMPT_INJECT_ENV, next ? "true" : "false");
    setStatus(next ? "已开启自动注入：提示词会追加到 system prompt" : "已关闭自动注入");
  }

  async function loadCards() {
    try {
      if (!Tools.Chat || !Tools.Chat.listCharacterCards) {
        setCardsLoadedOnce(true);
        return;
      }
      const result = await Tools.Chat.listCharacterCards();
      const list = Array.isArray(result && result.cards)
        ? result.cards.map(c => ({
            id: String(c && c.id || ""),
            name: String(c && c.name || ""),
            description: String((c && (c.description || c.desc || c.summary || c.subtitle)) || "")
          })).filter(c => c.id)
        : [];
      setCards(list);
      setCardsLoadedOnce(true);
    } catch (e) {
      setCardsLoadedOnce(true);
    }
  }

  function chooseCard(card) {
    const nextCardId = card && card.id ? String(card.id) : "";
    const nextCardName = card && card.name ? String(card.name) : "";
    setSelectedCardId(nextCardId);
    setSelectedCardName(nextCardName);
    setShowCardPicker(false);

    const selectedProfile = findProfileForCard(profiles, nextCardId);
    const savedPaths = selectedProfile && Array.isArray(selectedProfile.paths) ? selectedProfile.paths : [];
    if (savedPaths.length) {
      setInput(displayInputFromPaths(savedPaths));
      setPath(savedPaths.join("\n"));
    } else {
      setInput("");
      setPath("");
    }
    setExternalInput(selectedProfile ? String(selectedProfile.externalText || "") : "");
    setPathInputVersion(String(Date.now()));
    setExternalInputVersion(String(Date.now()));
    setMode("scan");
    setListText("");
    setPromptText("");
    setStatus(nextCardName ? "已切换到：" + nextCardName : "已切换到：全局默认");
  }

  async function saveProfile() {
    const paths = currentPaths();
    const value = paths.join("\n");
    setPath(value);
    const profile = buildProfileFromState(paths, selectedCardId, selectedCardName, externalInput);
    const next = upsertProfile(profiles, profile);
    setProfiles(next);
    if (ctx.setEnv) await ctx.setEnv(PROFILE_CONFIG_ENV, JSON.stringify(next));
    if (ctx.setEnv && !String(selectedCardId || "").trim()) {
      await ctx.setEnv("LOKI_STICKER_DIR", value);
      await ctx.setEnv(EXTERNAL_STICKERS_ENV, externalInput);
    }
    setStatus("当前配置已保存");
  }

  async function clearCurrentProfile() {
    const next = removeProfileForCard(profiles, selectedCardId);
    setProfiles(next);
    setInput("");
    setPath("");
    setExternalInput("");
    setPathInputVersion(String(Date.now()));
    setExternalInputVersion(String(Date.now()));
    setMode("scan");
    setListText("");
    setPromptText("");
    if (ctx.setEnv) {
      await ctx.setEnv(PROFILE_CONFIG_ENV, JSON.stringify(next));
      if (!String(selectedCardId || "").trim()) {
        await ctx.setEnv("LOKI_STICKER_DIR", "");
        await ctx.setEnv(EXTERNAL_STICKERS_ENV, "");
      }
    }
    setStatus("已清除当前配置：" + selectedCardLabel);
  }

  async function clearProfiles() {
    setProfiles([]);
    setInput("");
    setPath("");
    setExternalInput("");
    setPathInputVersion(String(Date.now()));
    setExternalInputVersion(String(Date.now()));
    setMode("scan");
    setListText("");
    setPromptText("");
    if (ctx.setEnv) {
      await ctx.setEnv(PROFILE_CONFIG_ENV, "");
      await ctx.setEnv("LOKI_STICKER_DIR", "");
      await ctx.setEnv(EXTERNAL_STICKERS_ENV, "");
    }
    setStatus("已清空全部表情包配置");
  }

  if (!cardsLoadedOnce) {
    setCardsLoadedOnce(true);
    loadCards();
  }

  const selectedCardLabel = selectedCardId ? (selectedCardName || "已绑定角色卡") : "全局默认";
  const selectedCardHint = selectedCardId ? "已绑定角色卡" : "全局默认有效";

  const resultSection = mode === "prompt" ? [
    UI.Text({ text: "生成的提示词", fontSize: 14, bold: true }),
    UI.Text({ text: "也可以复制这段提示词，自行放入用户偏好、角色卡或其他提示词位置。", fontSize: 12 }),
    UI.TextField({
      value: promptText || "点击“生成提示词”后显示",
      onValueChange: function () {},
      label: "生成的提示词（长按/全选复制）",
      readOnly: true,
      singleLine: false,
      minLines: 10,
      maxLines: 24,
      style: { fontSize: 12 }
    })
  ] : [
    UI.Text({ text: "表情列表", fontSize: 14, bold: true }),
    UI.Text({ text: listText || "点击“扫描目录”后显示", fontSize: 12 })
  ];

  return UI.LazyColumn({ padding: 16 }, [
    UI.Text({ text: "洛玑表情包渲染器", fontSize: 20, bold: true }),
    UI.Spacer({ height: 12 }),
    UI.Text({ text: "步骤 1：选择配置角色或全局", fontSize: 13, bold: true }),
    UI.Spacer({ height: 8 }),
    UI.Box(
      { fillMaxWidth: true },
      [
        UI.OutlinedButton(
          {
            onClick: function () { setShowCardPicker(!showCardPicker); },
            fillMaxWidth: true,
            shape: { cornerRadius: 14 }
          },
          [
            UI.Row(
              {
                fillMaxWidth: true,
                horizontalArrangement: "spaceBetween",
                verticalAlignment: "center"
              },
              [
                UI.Column({ weight: 1, spacing: 2 }, [
                  UI.Text({
                    text: selectedCardLabel,
                    fontWeight: "medium",
                    maxLines: 1,
                    overflow: "ellipsis"
                  }),
                  UI.Text({
                    text: selectedCardHint,
                    fontSize: 12
                  })
                ]),
                UI.Icon({
                  name: showCardPicker ? "arrowDropUp" : "arrowDropDown",
                  size: 20
                })
              ]
            )
          ]
        ),
        UI.DropdownMenu(
          {
            expanded: showCardPicker,
            properties: { focusable: true },
            onDismissRequest: function () { setShowCardPicker(false); }
          },
          [
            UI.Box(
              {
                modifier: ctx.Modifier.fillMaxWidth().clickable(function () { chooseCard(null); }).padding({ horizontal: 16, vertical: 12 })
              },
              [UI.Text({ text: "不绑定（全局默认）", fontWeight: !selectedCardId ? "bold" : "normal" })]
            ),
            UI.HorizontalDivider({ thickness: 1 }),
            ...(cards.length
              ? cards.map(function (card) {
                  return UI.Box(
                    {
                      modifier: ctx.Modifier.fillMaxWidth().clickable(function () { chooseCard(card); }).padding({ horizontal: 16, vertical: 12 })
                    },
                    [
                      UI.Row(
                        {
                          fillMaxWidth: true,
                          horizontalArrangement: "spaceBetween",
                          verticalAlignment: "center"
                        },
                        [
                          UI.Column({ weight: 1, spacing: 2 }, [
                            UI.Text({
                              text: card.name || card.id,
                              fontWeight: card.id === selectedCardId ? "bold" : "normal",
                              maxLines: 1,
                              overflow: "ellipsis"
                            }),
                            UI.Text({
                              text: card.description || "未填写描述",
                              fontSize: 12,
                              maxLines: 1,
                              overflow: "ellipsis"
                            })
                          ]),
                          card.id === selectedCardId ? UI.Icon({ name: "check", size: 18 }) : UI.Spacer({ width: 18 })
                        ]
                      )
                    ]
                  );
                })
              : [
                  UI.Box(
                    {
                      modifier: ctx.Modifier.fillMaxWidth().padding({ horizontal: 16, vertical: 12 })
                    },
                    [UI.Text({ text: cardsLoadedOnce ? "没有可用角色卡" : "正在静默读取角色卡……", fontSize: 12 })]
                  )
                ])
          ]
        )
      ]
    ),
    UI.Spacer({ height: 10 }),
    UI.Text({ text: "步骤 2：填写表情包路径", fontSize: 13, bold: true }),
    UI.TextField({
      key: "path-input-" + selectedCardId + "-" + pathInputVersion,
      rememberKey: "path-input-" + selectedCardId + "-" + pathInputVersion,
      value: input,
      onValueChange: setInput,
      label: "表情包路径",
      placeholder: "示例：Download/sticker。若未开启 Shizuku 权限，请使用下方的外链列表。",
      singleLine: false,
      minLines: 3,
      maxLines: 8
    }),
    UI.Spacer({ height: 10 }),
    UI.Text({ text: "外链表情包列表", fontSize: 13, bold: true }),
    UI.Text({ text: "每行一个：表情名: https://图片URL。支持英文冒号或中文冒号，空行和 # 注释会被忽略。", fontSize: 12 }),
    UI.TextField({
      key: "external-input-" + selectedCardId + "-" + externalInputVersion,
      rememberKey: "external-input-" + selectedCardId + "-" + externalInputVersion,
      value: externalInput,
      onValueChange: setExternalInput,
      label: "外链表情包",
      placeholder: "示例：哇塞: https://1234567.example/sticker.gif",
      singleLine: false,
      minLines: 4,
      maxLines: 10
    }),
    UI.Text({ text: externalSummary(externalInput), fontSize: 12 }),
    UI.Spacer({ height: 12 }),
    UI.Row(
      {
        fillMaxWidth: true,
        horizontalArrangement: "start",
        verticalAlignment: "center"
      },
      [
        UI.Button({ text: "保存当前配置", onClick: saveProfile }),
        UI.Spacer({ width: 8 }),
        UI.Button({ text: "清除当前配置", onClick: clearCurrentProfile })
      ]
    ),
    UI.Spacer({ height: 8 }),
    UI.Button({ text: "清空所有配置", onClick: clearProfiles }),
    UI.Spacer({ height: 6 }),
    UI.Text({ text: "已保存配置：\n" + profilesSummary(profiles), fontSize: 12 }),
    UI.Spacer({ height: 10 }),
    UI.Text({ text: "步骤 3：扫描目录", fontSize: 13, bold: true }),
    UI.Row(
      {
        fillMaxWidth: true,
        horizontalArrangement: "start",
        verticalAlignment: "center"
      },
      [
        UI.Button({ text: "扫描目录", onClick: scan }),
        UI.Spacer({ width: 12 }),
        UI.Button({ text: "重建索引", onClick: forceRebuildIndex })
      ]
    ),
    UI.Spacer({ height: 10 }),
    UI.Text({ text: "步骤 4：调整提示词规则", fontSize: 13, bold: true }),
    UI.TextField({
      value: maxPerReply,
      onValueChange: setMaxPerReply,
      label: "单次最多表情数（默认 2）",
      placeholder: "2"
    }),
    UI.Spacer({ height: 8 }),
    UI.TextField({
      value: extraRules,
      onValueChange: function (value) { setExtraRules(displayExtraRulesText(value)); },
      label: "自定义补充规则",
      placeholder: "",
      singleLine: false,
      minLines: 4,
      maxLines: 8
    }),
    UI.Spacer({ height: 8 }),
    UI.Button({ text: "保存提示词设置", onClick: savePromptSettings }),
    UI.Spacer({ height: 10 }),
    UI.Text({ text: "步骤 5：生成提示词", fontSize: 13, bold: true }),
    UI.Button({ text: "生成提示词", onClick: generatePrompt }),
    UI.Spacer({ height: 8 }),
    UI.Button({ text: injectEnabled ? "关闭自动注入" : "开启自动注入", onClick: toggleInject }),
    UI.Text({ text: "自动注入：" + (injectEnabled ? "已开启" : "已关闭"), fontSize: 13, bold: true }),
    UI.Text({ text: "开启后，插件会把表情包提示词追加到 system prompt；如果你想自己控制位置，可以关闭它并手动复制提示词。", fontSize: 12 }),
    UI.Spacer({ height: 12 }),
    UI.Text({ text: status, fontSize: 14, bold: true }),
    UI.Spacer({ height: 8 })
  ].concat(resultSection));
}

exports.default = Screen;