const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { buildExtensionZip } = require("./scripts/build-extension-zip");

const root = __dirname;
const extensionDir = path.join(root, "extension");
const extensionZipPath = path.join(root, "dist", "TuXunAI.zip");
const memoryPath = path.join(root, "data", "tuxun-memory.json");
loadDotEnv(path.join(root, ".env"));
const port = Number(process.env.PORT || 4173);
const defaultVisionProvider =
  process.env.NEWAPI_API_KEY || process.env.NEWAPI_BASE_URL || process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL
    ? "newapi"
    : "ollama";
const visionProvider = (process.env.VISION_PROVIDER || defaultVisionProvider).toLowerCase();
const visionMode = (process.env.VISION_MODE || "balanced").toLowerCase();
const openAiBaseUrl = normalizeOpenAiBaseUrl(process.env.OPENAI_BASE_URL || process.env.NEWAPI_BASE_URL);
const openAiTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 45000);
const agentReviewEnabled = process.env.AGENT_REVIEW !== "0";
const maxAgentReviewRounds = Math.max(1, Math.min(3, Number(process.env.AGENT_REVIEW_ROUNDS || 2)));
const defaultOllamaModel =
  visionMode === "accurate" ? "qwen3-vl:8b" : visionMode === "fast" ? "moondream" : "qwen3-vl:4b";
const visionModel =
  process.env.VISION_MODEL ||
  process.env.OLLAMA_MODEL ||
  process.env.OPENAI_MODEL ||
  (visionProvider === "openai" || visionProvider === "chatgpt" || visionProvider === "newapi" ? "gpt-5.4-mini" : defaultOllamaModel);
const ollamaHost = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/$/, "");
const isFastOllamaModel = visionModel.toLowerCase().includes("moondream");
const isQwenOllamaModel = visionModel.toLowerCase().includes("qwen3-vl");
const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || (isFastOllamaModel ? 30000 : 180000));
const codexAuthPath = path.join(process.env.USERPROFILE || "", ".codex", "auth.json");
const knowledgeBase = loadKnowledgeBase();
const guideKnowledge = loadGuideKnowledge();
const coverageKnowledge = loadCoverageKnowledge();
const tuxunDocSummary = loadTuxunDocSummary();
const coverageIndex = buildCoverageIndex(coverageKnowledge);
const allowedTags = collectAllowedTags(knowledgeBase);
const knowledgeBaseRef = buildKnowledgeBaseReference(knowledgeBase);
const tuxunPromptReferences = {
  china: buildTuxunPromptReference(tuxunDocSummary, "china"),
  world: buildTuxunPromptReference(tuxunDocSummary, "world")
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".zip": "application/zip"
};

function loadKnowledgeBase() {
  const knowledgePath = path.join(root, "data", "knowledge-base.json");
  const raw = fs.readFileSync(knowledgePath, "utf8");
  return JSON.parse(raw);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      if (!key || process.env[key] !== undefined) continue;
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch (error) {
    console.warn(`Failed to load env file: ${filePath}`, error);
  }
}

function loadGuideKnowledge() {
  const guidePath = path.join(root, "data", "plonkit-guide.json");
  if (!fs.existsSync(guidePath)) return { countries: [], generalPages: [] };
  try {
    return JSON.parse(fs.readFileSync(guidePath, "utf8"));
  } catch (error) {
    return { countries: [], generalPages: [] };
  }
}

function loadCoverageKnowledge() {
  const coveragePath = path.join(root, "data", "coverage-and-generations.json");
  if (!fs.existsSync(coveragePath)) return { playablePlaces: [], playablePolicy: "" };
  try {
    return JSON.parse(fs.readFileSync(coveragePath, "utf8"));
  } catch (error) {
    return { playablePlaces: [], playablePolicy: "" };
  }
}

function loadTuxunDocSummary() {
  const summaryPath = path.join(root, "data", "tuxun-doc-summary.json");
  if (!fs.existsSync(summaryPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  } catch (error) {
    return null;
  }
}

function normalizeGameMode(value) {
  return String(value || "").toLowerCase() === "china" ? "china" : "world";
}

function normalizeReasoningMode(value) {
  return String(value || "").toLowerCase() === "accurate" ? "accurate" : "fast";
}

function loadMemoryStore() {
  if (!fs.existsSync(memoryPath)) return { version: 1, items: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(memoryPath, "utf8"));
    return {
      version: 1,
      items: Array.isArray(parsed.items) ? parsed.items : []
    };
  } catch {
    return { version: 1, items: [] };
  }
}

function saveMemoryStore(store) {
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  const next = {
    version: 1,
    updatedAt: new Date().toISOString(),
    items: Array.isArray(store.items) ? store.items.slice(0, 400) : []
  };
  fs.writeFileSync(memoryPath, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function loadCodexAuth() {
  if (!fs.existsSync(codexAuthPath)) return { authMode: "", accessToken: "" };
  try {
    const auth = JSON.parse(fs.readFileSync(codexAuthPath, "utf8"));
    return {
      authMode: typeof auth.auth_mode === "string" ? auth.auth_mode : "",
      accessToken: typeof auth.tokens?.access_token === "string" ? auth.tokens.access_token : "",
      hasApiKey: Boolean(auth.OPENAI_API_KEY)
    };
  } catch (error) {
    return { authMode: "", accessToken: "", hasApiKey: false };
  }
}

function normalizeOpenAiBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return "https://api.openai.com/v1";
  return /\/v1$/i.test(raw) ? raw : `${raw}/v1`;
}

function resolveOpenAiBearerToken() {
  if (process.env.NEWAPI_API_KEY) {
    return { token: process.env.NEWAPI_API_KEY, source: "NEWAPI_API_KEY" };
  }

  if (process.env.OPENAI_API_KEY) {
    return { token: process.env.OPENAI_API_KEY, source: "OPENAI_API_KEY" };
  }

  const auth = loadCodexAuth();
  if (auth.accessToken && auth.authMode === "chatgpt") {
    return { token: auth.accessToken, source: "codex-chatgpt" };
  }

  return { token: "", source: "" };
}

function collectAllowedTags(base) {
  const tags = [];
  const seen = new Set();
  for (const group of base.groups || []) {
    for (const option of group.options || []) {
      if (seen.has(option.id)) continue;
      seen.add(option.id);
      tags.push(option.id);
    }
  }
  return tags;
}

function buildKnowledgeBaseReference(kb) {
  if (!kb || typeof kb !== "object") return "";

  const { groups, textHints, profiles } = kb;
  const sections = [];

  // 1. Tag descriptions — what each tag visually means
  if (Array.isArray(groups) && groups.length) {
    sections.push("## 视觉标签说明");
    for (const group of groups) {
      const options = (group.options || [])
        .map((o) => `${o.id}(${o.label})`)
        .join("、");
      sections.push(`- ${group.title}${group.multi ? "(多选)" : "(单选)"}: ${options}`);
    }
  }

  // 2. Text hint rules — what text patterns indicate which country/script
  if (Array.isArray(textHints) && textHints.length) {
    sections.push("\n## 文字线索→标签");
    for (const hint of textHints) {
      const samples = (hint.phrases || []).slice(0, 5).join("/");
      sections.push(`- ${samples} → ${hint.tag}(${hint.reason})`);
    }
  }

  // 3. Country profiles with tags and identifying notes
  if (Array.isArray(profiles) && profiles.length) {
    const byRegion = new Map();
    for (const p of profiles) {
      const region = p.region || "其他";
      if (!byRegion.has(region)) byRegion.set(region, []);
      byRegion.get(region).push(p);
    }

    sections.push("\n## 国家/地区特征索引");
    for (const [region, items] of byRegion) {
      const entries = [];
      for (const item of items) {
        const tags = (item.tags || []).slice(0, 12).join(",");
        const note = item.notes ? ` [注:${item.notes.slice(0, 100)}]` : "";
        entries.push(`${item.country}:${tags}${note}`);
      }
      sections.push(`### ${region}: ${entries.join(" | ")}`);
    }
  }

  return sections.join("\n");
}

function buildTuxunPromptReference(summary, gameMode = "world") {
  if (!summary || typeof summary !== "object") return "";

  const mode = normalizeGameMode(gameMode);
  const topicFilter = mode === "china"
    ? new Set(["china", "vegetation-climate", "language-text"])
    : new Set(["world-country-guides", "regionguessing", "confusable-countries", "pole-meta", "car-meta", "vegetation-climate", "language-text"]);
  const docs = Array.isArray(summary.importantDocs)
    ? summary.importantDocs
        .filter((doc) => Array.isArray(doc.topics) && doc.topics.some((topic) => topicFilter.has(topic)))
        .slice(0, mode === "china" ? 28 : 42)
    : [];

  const categories = Array.isArray(summary.categorySummary)
    ? summary.categorySummary
        .filter((item) => {
          const text = `${item.path} ${(item.examples || []).join(" ")}`;
          return mode === "china"
            ? /中国|省|自治区|上海|重庆|天津|香港|出租车|区号/.test(text)
            : /世界|Plonk|非洲|亚洲|欧洲|北美|南美|大洋|寻友|社区|地理/.test(text);
        })
        .slice(0, 12)
    : [];

  const lines = [
    mode === "china" ? "## 图寻中国模式知识摘要" : "## 图寻世界模式知识摘要",
    `来源：${summary.book?.name || "图寻文档"}，可用文档 ${summary.availableDocCount || "?"}/${summary.docCount || "?"} 篇。`,
    mode === "china"
      ? "中国模式只会出现中国街景。不要回答其他国家；country 固定为 China，countryZh 固定为 中国。重点输出省/自治区/直辖市/特别行政区、城市和区域方向。"
      : "世界模式不包含中国大陆街景。不要回答 China/中国大陆；出现中文时优先考虑香港、澳门、台湾、新加坡、马来西亚、海外华人区等世界覆盖可能性。",
    "",
    "核心参考目录："
  ];

  for (const item of categories) {
    lines.push(`- ${item.path}: ${item.examples.join("、")}`);
  }

  lines.push("");
  lines.push("重点文档/章节：");
  for (const doc of docs) {
    lines.push(`- ${doc.title}: ${(doc.headings || []).slice(0, 8).join(" / ")}`);
  }

  lines.push("");
  if (mode === "china") {
    lines.push(
      "中国模式判题顺序：",
      "1. 先找硬文字：省市县名、路名牌、店招、电话区号、车牌简称、道路编号、报警编号牌。",
      "2. 再看中国特有线索：蓝牌/新能源牌/出租车涂装、公交/路灯/护栏/指路牌、腾讯街景车代数与画质。",
      "3. 再用自然人文缩小区域：东北/华北/西北/西南/华南/华东的地形、植被、建筑和饮食店招。",
      "4. 需要给出 province/region、city、location，不要泛泛只回答中国。"
    );
  } else {
    lines.push(
      "世界模式判题顺序：",
      "1. 先找硬线索：语言文字、国别名、电话区号、车牌、道路编号、限速/路牌体系、驾驶方向。",
      "2. 再看 Meta：Google 街景车/相机、水箱、各洲电线杆、菲律宾贴纸、护栏/路桩/道路标线。",
      "3. 再用自然线索：植被、棕榈、气候、地形、海岸、建筑风格。",
      "4. 易混国家必须对照排除：墨西哥/西班牙/希腊/土耳其，东南亚，塞内加尔/尼日利亚/肯尼亚，哥伦比亚/厄瓜多尔/秘鲁。"
    );
  }

  return lines.join("\n");
}

function modePromptLines(gameMode = "world") {
  const mode = normalizeGameMode(gameMode);
  if (mode === "china") {
    return [
      "GAME MODE: TuXun China.",
      "The answer must be a Chinese street-view location. Do not choose any non-China country.",
      "Set country to \"China\", countryZh to \"中国\", continent to \"亚洲\".",
      "Focus on province/autonomous region/municipality/SAR, city, district/road/area, and rough direction inside China.",
      "Use China-specific clues: Chinese license plates, fixed phone area codes, taxi liveries, Chinese road/street signs, Tencent street-view camera/generation, regional vegetation, terrain, architecture, public transport, road signs, guardrails, lane markings."
    ];
  }

  return [
    "GAME MODE: TuXun World.",
    "World mode does not include mainland China street-view rounds. Never answer mainland China/China as the final country.",
    "If Chinese text appears, consider Hong Kong, Macau, Taiwan, Singapore, Malaysia, nearby countries, or overseas Chinese signs only when supported by visible evidence.",
    "Use world-country and regionguessing clues: language/script, license plates, road signs, driving side, road markings, Google car/camera, utility poles, bollards, vegetation, climate, architecture, and known confusable-country comparisons."
  ];
}

function promptReferenceForMode(gameMode = "world") {
  return tuxunPromptReferences[normalizeGameMode(gameMode)] || tuxunPromptReferences.world || "";
}

function tokenizeForSearch(value) {
  const text = String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!text) return [];
  const parts = text.split(/\s+/).filter((item) => item.length >= 2);
  const cjk = [...String(value || "").matchAll(/[\u4e00-\u9fff]{2,}/g)].map((match) => match[0]);
  return [...new Set([...parts, ...cjk])].slice(0, 40);
}

function docsForMode(gameMode = "world") {
  const mode = normalizeGameMode(gameMode);
  const topicFilter = mode === "china"
    ? new Set(["china", "vegetation-climate", "language-text"])
    : new Set(["world-country-guides", "regionguessing", "confusable-countries", "pole-meta", "car-meta", "vegetation-climate", "language-text"]);

  return Array.isArray(tuxunDocSummary?.importantDocs)
    ? tuxunDocSummary.importantDocs.filter((doc) => Array.isArray(doc.topics) && doc.topics.some((topic) => topicFilter.has(topic)))
    : [];
}

function relatedMemoryItems(analysis, placeGuess, gameMode = "world", limit = 6) {
  const mode = normalizeGameMode(gameMode);
  const store = loadMemoryStore();
  const seed = [
    placeGuess?.country,
    placeGuess?.countryZh,
    placeGuess?.region,
    placeGuess?.city,
    placeGuess?.location,
    ...(Array.isArray(placeGuess?.evidence) ? placeGuess.evidence : []),
    analysis?.summary,
    ...(Array.isArray(analysis?.textClues) ? analysis.textClues : []),
    ...(Array.isArray(analysis?.tags) ? analysis.tags.map((item) => `${item.tag} ${item.reason || ""}`) : [])
  ].join(" ");
  const tokens = tokenizeForSearch(seed);

  return store.items
    .filter((item) => item && item.gameMode === mode)
    .map((item) => {
      const haystack = `${item.title || ""} ${item.location || ""} ${item.clue || ""} ${item.knowledge || ""} ${(item.tags || []).join(" ")}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (haystack.includes(token.toLowerCase())) score += token.length >= 4 ? 3 : 1;
      }
      return { item, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(b.item.createdAt || "").localeCompare(String(a.item.createdAt || "")))
    .slice(0, limit)
    .map(({ item }) => item);
}

function memoryPromptReference(analysis, placeGuess, gameMode = "world") {
  const items = relatedMemoryItems(analysis, placeGuess, gameMode, 6);
  if (!items.length) return "";
  return [
    "## 用户确认过的常用知识点",
    ...items.map((item, index) => `#${index + 1} ${item.title || item.location || "记忆"}\n地点: ${item.location || ""}\n线索: ${item.clue || ""}\n知识点: ${item.knowledge || ""}`)
  ].join("\n");
}

function recentMemoryPromptReference(gameMode = "world", limit = 8) {
  const mode = normalizeGameMode(gameMode);
  const store = loadMemoryStore();
  const items = store.items
    .filter((item) => item && item.gameMode === mode)
    .slice(0, limit);
  if (!items.length) return "";
  return [
    "## 最近确认过的常用知识点",
    ...items.map((item, index) => `#${index + 1} ${item.title || item.location || "记忆"}\n地点: ${item.location || ""}\n线索: ${item.clue || ""}\n知识点: ${item.knowledge || ""}`)
  ].join("\n");
}

function relatedTuxunReferences(analysis, placeGuess, gameMode = "world", limit = 8) {
  const mode = normalizeGameMode(gameMode);
  const seed = [
    placeGuess?.country,
    placeGuess?.countryZh,
    placeGuess?.continent,
    placeGuess?.region,
    placeGuess?.city,
    placeGuess?.location,
    ...(Array.isArray(placeGuess?.alternatives) ? placeGuess.alternatives : []),
    ...(Array.isArray(placeGuess?.evidence) ? placeGuess.evidence : []),
    analysis?.summary,
    ...(Array.isArray(analysis?.textClues) ? analysis.textClues : []),
    ...(Array.isArray(analysis?.candidateRegions) ? analysis.candidateRegions : []),
    ...(Array.isArray(analysis?.candidateCities) ? analysis.candidateCities.map((item) => `${item.city || ""} ${item.country || ""}`) : []),
    ...(Array.isArray(analysis?.tags) ? analysis.tags.map((item) => `${item.tag} ${item.reason || ""}`) : [])
  ].join(" ");

  const tokens = tokenizeForSearch(seed);
  const hardHints = mode === "china"
    ? ["中国", "省", "市", "区号", "出租车", "车牌", "街景车", "植被", "建筑"]
    : ["易混", "电线杆", "街景车", "语言", "植被", "区域", "Plonk", "电话区号"];

  return docsForMode(mode)
    .map((doc) => {
      const text = `${doc.title} ${(doc.topics || []).join(" ")} ${(doc.headings || []).join(" ")}`.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (text.includes(token.toLowerCase())) score += token.length >= 4 ? 3 : 1;
      }
      for (const hint of hardHints) {
        if (text.includes(hint.toLowerCase())) score += 0.6;
      }
      if (mode === "china" && (doc.topics || []).includes("china")) score += 1.4;
      if (mode === "world" && (doc.topics || []).includes("confusable-countries")) score += 1.2;
      if (mode === "world" && ((doc.topics || []).includes("pole-meta") || (doc.topics || []).includes("car-meta"))) score += 0.9;
      return { doc, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.doc.wordCount - a.doc.wordCount)
    .slice(0, limit)
    .map((item) => item.doc);
}

function formatConcreteReference(doc, index) {
  const excerpts = Array.isArray(doc.excerpts) ? doc.excerpts.slice(0, 4) : [];
  const excerptText = excerpts.length
    ? excerpts.map((item) => `- ${item.heading}: ${item.text}`).join("\n")
    : `章节: ${(doc.headings || []).slice(0, 12).join(" / ")}`;
  return `#${index + 1} ${doc.title}\n主题: ${(doc.topics || []).join(", ")}\n${excerptText}`;
}

function buildAgentReviewPrompt(analysis, placeGuess, references, notes = "", gameMode = "world") {
  const refText = references.length
    ? references
        .map(formatConcreteReference)
        .join("\n\n")
    : "No focused document match; use only visible evidence and lower confidence if uncertain.";
  const memoryText = memoryPromptReference(analysis, placeGuess, gameMode);

  return [
    "You are the second-pass TuXun review agent.",
    "Return only JSON using the exact placeGuess schema.",
    ...modePromptLines(gameMode),
    "Task: Review the first model guess against the retrieved TuXun document references and the image.",
    "You may keep the guess, correct it, or lower confidence. Do not invent evidence that is not visible or supported by the references.",
    "If the retrieved references are only weakly related, say that in Chinese and keep confidence conservative.",
    "Use Chinese for reason, evidence, alternatives, location, region, city, and direction fields.",
    'Format: {"country":"","countryZh":"","continent":"","continentDirection":"","countryDirection":"","cityDirection":"","location":"","region":"","city":"","confidence":0,"reason":"","evidence":[],"alternatives":[]}',
    "",
    `Game mode: ${normalizeGameMode(gameMode)}`,
    `Notes: ${notes || "none"}`,
    `First guess: ${JSON.stringify(placeGuess)}`,
    `Visual tags: ${(analysis.tags || []).map((item) => `${item.tag}:${item.reason || ""}`).join(" | ") || "none"}`,
    `Text clues: ${(analysis.textClues || []).join(" | ") || "none"}`,
    `Candidate regions: ${(analysis.candidateRegions || []).join(", ") || "none"}`,
    `Candidate cities: ${Array.isArray(analysis.candidateCities) && analysis.candidateCities.length ? analysis.candidateCities.slice(0, 5).map((item) => `${item.city}${item.country ? ` (${item.country})` : ""}`).join(", ") : "none"}`,
    "",
    "Retrieved TuXun references:",
    refText,
    "",
    memoryText
  ].join("\n");
}

function normalizeCoverageKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function buildCoverageIndex(source) {
  const entries = Array.isArray(source.playablePlaces) ? source.playablePlaces : [];
  const byKey = new Map();

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const aliases = new Set([entry.title, entry.code, ...(Array.isArray(entry.aliases) ? entry.aliases : [])].filter(Boolean));
    const normalized = {
      ...entry,
      aliases: [...aliases]
    };
    for (const alias of aliases) {
      const key = normalizeCoverageKey(alias);
      if (!key) continue;
      if (!byKey.has(key)) byKey.set(key, normalized);
    }
  }

  return { entries, byKey };
}

function coverageInfoForPlace(country) {
  const raw = String(country || "").trim();
  if (!raw) return null;

  const key = normalizeCoverageKey(raw);
  if (!key) return null;

  const direct = coverageIndex.byKey.get(key);
  if (direct) return direct;

  for (const entry of coverageIndex.entries) {
    const titleKey = normalizeCoverageKey(entry.title);
    if (titleKey && (titleKey === key || titleKey.includes(key) || key.includes(titleKey))) return entry;

    for (const alias of entry.aliases || []) {
      const aliasKey = normalizeCoverageKey(alias);
      if (!aliasKey) continue;
      if (aliasKey === key || aliasKey.includes(key) || key.includes(aliasKey)) return entry;
    }
  }

  return null;
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization",
    "access-control-max-age": "86400"
  });
  res.end(body);
}

function sendJson(res, status, value) {
  send(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function rebuildExtensionZip(reason = "startup") {
  try {
    const result = buildExtensionZip(extensionDir, extensionZipPath);
    console.log(`[extension] Packaged ${result.files} files into ${path.relative(root, result.outputFile)} (${result.bytes} bytes, ${reason})`);
  } catch (error) {
    console.warn(`[extension] Failed to package extension zip (${reason}): ${error.message}`);
  }
}

function watchExtensionZip() {
  if (!fs.existsSync(extensionDir)) return;

  let timer = null;
  const schedule = (reason) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      rebuildExtensionZip(reason);
    }, 500);
  };

  try {
    fs.watch(extensionDir, { recursive: true }, (eventType, filename) => {
      schedule(filename ? `${eventType}:${filename}` : eventType);
    });
    console.log(`[extension] Watching ${path.relative(root, extensionDir)} for zip updates`);
  } catch (error) {
    console.warn(`[extension] Recursive watch unavailable: ${error.message}`);
    const watchedDirs = new Set();
    const watchDir = (dir) => {
      if (watchedDirs.has(dir)) return;
      watchedDirs.add(dir);
      try {
        fs.watch(dir, (eventType, filename) => {
          if (filename) {
            const fullPath = path.join(dir, filename.toString());
            try {
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) watchDir(fullPath);
            } catch {}
          }
          schedule(filename ? `${eventType}:${path.relative(extensionDir, path.join(dir, filename.toString()))}` : eventType);
        });
      } catch (watchError) {
        console.warn(`[extension] Failed to watch ${dir}: ${watchError.message}`);
      }

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) watchDir(path.join(dir, entry.name));
      }
    };
    watchDir(extensionDir);
  }
}

function extractPartialPlaceFields(partialJson) {
  const fields = {};
  const stringFields = [
    "country", "countryZh", "continent", "continentDirection",
    "countryDirection", "cityDirection", "location", "region", "city", "reason"
  ];
  for (const field of stringFields) {
    const match = partialJson.match(new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (match) fields[field] = match[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  const confMatch = partialJson.match(/"confidence"\s*:\s*([0-9.]+)/);
  if (confMatch) fields.confidence = parseFloat(confMatch[1]);
  return fields;
}

function combinedStreamingPrompt(notes = "", frameCount = 1, gameMode = "world") {
  const lines = [
    "You are a GeoGuessr location judge. Return only JSON.",
    "IMPORTANT — output order: write the placeGuess field FIRST, then tags, textClues, candidateRegions, candidateCities, summary.",
    ...modePromptLines(gameMode),
    frameCount > 1 ? `You are given ${frameCount} frames from the same round.` : "You are given one frame.",
    "Infer country, countryZh, continent, region, city, confidence, reason, evidence, alternatives from the image.",
    "For city, output the best likely city; leave empty only when no city-level signal exists.",
    "Use Chinese for reason, evidence, alternatives, location, region, city, direction fields.",
    "Keep country as English canonical name, countryZh in Chinese.",
    "continentDirection, countryDirection, cityDirection describe rough position: 大洲东北部, 国家西南部, 城市北郊.",
    "The placeGuess object MUST be the very first field in the JSON output.",
    "After placeGuess, fill tags (clue tags from the allowed list), textClues, candidateRegions, candidateCities, and a one-line summary.",
    `Allowed clue tags: ${allowedTags.join(", ")}`,
    `Summary: ${notes || "none"}`,
    "",
    recentMemoryPromptReference(gameMode),
    "",
    promptReferenceForMode(gameMode),
    "",
    knowledgeBaseRef
  ];
  return lines.join("\n");
}

async function streamCombinedAnalysis(res, images, notes, gameMode = "world", reasoningMode = "accurate") {
  const normalizedImages = normalizeImageInputs(images);
  assertImages(normalizedImages);
  const auth = resolveOpenAiBearerToken();
  if (!auth.token) {
    sendSSE(res, "error", { message: "AI 认证不可用" });
    sendSSE(res, "done", {});
    return;
  }

  const prompt = combinedStreamingPrompt(notes, normalizedImages.length, gameMode);
  const { controller, timeout } = withTimeout(70000);
  let fullContent = "";
  let placeSent = false;
  let reasonSentLen = 0;
  const sentFields = new Set();
  let lastTagCount = 0;

  try {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          ...normalizedImages.map((image) => ({ type: "image_url", image_url: { url: image } }))
        ]
      }
    ];

    const response = await fetch(`${openAiBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: visionModel,
        stream: true,
        messages,
        response_format: { type: "json_object" },
        max_tokens: 1200,
        temperature: 0.1
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error?.message || "streaming analysis failed");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const rawData = trimmed.slice(6);
        if (rawData === "[DONE]") continue;

        try {
          const parsed = JSON.parse(rawData);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (!delta) continue;
          fullContent += delta;

          const fields = extractPartialPlaceFields(fullContent);

          if (!placeSent && (fields.city || fields.countryZh)) {
            placeSent = true;
            const place = {};
            const keys = ["country", "countryZh", "continent", "continentDirection", "countryDirection", "cityDirection", "location", "region", "city", "confidence"];
            for (const key of keys) {
              if (fields[key] !== undefined) { place[key] = fields[key]; sentFields.add(key); }
            }
            sendSSE(res, "place", place);
          }

          if (placeSent) {
            const updates = {};
            for (const key of ["country", "countryZh", "continent", "continentDirection", "countryDirection", "cityDirection", "location", "region", "city", "confidence"]) {
              if (fields[key] !== undefined && !sentFields.has(key)) {
                updates[key] = fields[key];
                sentFields.add(key);
              }
            }
            if (Object.keys(updates).length) sendSSE(res, "place", updates);
          }

          if (placeSent && fields.reason && fields.reason.length > reasonSentLen) {
            const chunk = fields.reason.slice(reasonSentLen);
            reasonSentLen = fields.reason.length;
            if (chunk) sendSSE(res, "reason", { chunk });
          }

          const tagMatch = fullContent.match(/"tags"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
          if (tagMatch) {
            const tagBlock = tagMatch[1];
            const currentTags = [...tagBlock.matchAll(/"tag"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
            if (currentTags.length > lastTagCount) {
              lastTagCount = currentTags.length;
              sendSSE(res, "tags", { tags: currentTags });
            }
          }
        } catch (e) {
          // skip malformed chunks
        }
      }
    }

    const parsed = parseModelJson(fullContent);
    if (!parsed) {
      sendSSE(res, "error", { message: "无法解析模型输出" });
      sendSSE(res, "done", {});
      return;
    }

    const analysis = normalizeVisionResult(parsed, gameMode);
    const guideContext = buildGuideContext(analysis, 4);
    let placeGuess = normalizePlaceGuess(parsed.placeGuess || {}, guideContext, gameMode);
    if (normalizeReasoningMode(reasoningMode) === "accurate") {
      sendSSE(res, "status", { message: "正在检索图寻资料复核…" });
    }
    placeGuess = await reviewPlaceGuessWithOpenAi(normalizedImages[0], analysis, placeGuess, notes, gameMode, reasoningMode);

    sendSSE(res, "done", {
      placeGuess,
      tags: analysis.tags,
      textClues: analysis.textClues,
      candidateCities: analysis.candidateCities,
      candidateRegions: analysis.candidateRegions
    });
  } catch (error) {
    if (error.name === "AbortError") {
      sendSSE(res, "error", { message: "识图超时" });
    } else {
      sendSSE(res, "error", { message: error.message || "识图失败" });
    }
    sendSSE(res, "done", {});
  } finally {
    clearTimeout(timeout);
  }
}

function readJson(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = "";
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Payload too large"));
        req.destroy();
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const filePath = path.normalize(path.join(root, requested));
  const relative = path.relative(root, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return filePath;
}

function isPublicFile(filePath) {
  const relative = path.relative(root, filePath).replaceAll("\\", "/");
  return (
    relative === "index.html" ||
    relative === "styles.css" ||
    relative.startsWith("src/") ||
    relative.startsWith("data/") ||
    relative === "dist/TuXunAI.zip"
  );
}

function withTimeout(ms = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  return { controller, timeout };
}

function assertImage(image) {
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    const error = new Error("Expected a data:image URL");
    error.status = 400;
    throw error;
  }
}

function normalizeImageInputs(input) {
  if (Array.isArray(input)) return input.filter((item) => typeof item === "string" && item.startsWith("data:image/"));
  if (typeof input === "string" && input.startsWith("data:image/")) return [input];
  return [];
}

function assertImages(images) {
  if (!Array.isArray(images) || !images.length) {
    const error = new Error("Expected at least one data:image URL");
    error.status = 400;
    throw error;
  }
  for (const image of images) {
    assertImage(image);
  }
}

function base64FromDataUrl(image) {
  return image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function visionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "tags", "textClues", "candidateRegions", "candidateCities", "confidence", "nextChecks", "placeGuess"],
    properties: {
      summary: { type: "string" },
      tags: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["tag", "reason", "confidence"],
          properties: {
            tag: { type: "string", enum: allowedTags },
            reason: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      },
      textClues: {
        type: "array",
        items: { type: "string" }
      },
      candidateRegions: {
        type: "array",
        items: { type: "string" }
      },
      candidateCities: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["city", "country", "reason", "confidence"],
          properties: {
            city: { type: "string" },
            country: { type: "string" },
            reason: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      nextChecks: {
        type: "array",
        items: { type: "string" }
      },
      placeGuess: placeGuessSchema()
    }
  };
}

function placeGuessSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "country",
      "countryZh",
      "continent",
      "continentDirection",
      "countryDirection",
      "cityDirection",
      "location",
      "region",
      "city",
      "confidence",
      "reason",
      "evidence",
      "alternatives"
    ],
    properties: {
      country: { type: "string" },
      countryZh: { type: "string" },
      continent: { type: "string" },
      continentDirection: { type: "string" },
      countryDirection: { type: "string" },
      cityDirection: { type: "string" },
      location: { type: "string" },
      region: { type: "string" },
      city: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" }
      },
      alternatives: {
        type: "array",
        items: { type: "string" }
      }
    }
  };
}

function analysisPrompt(notes = "", frameCount = 1, gameMode = "world") {
  if (isFastOllamaModel) {
    return [
      "Describe this geolocation image for TuXun.",
      ...modePromptLines(gameMode),
      "Focus on visible text, signs, road markings, vehicles, poles, camera/car meta, vegetation, terrain, architecture, and likely region.",
      `Notes: ${notes || "none"}`
    ].join("\n");
  }

  const lines = [
    "You are a GeoGuessr location judge.",
    "Return only JSON.",
    "Do not run a second pass or wait for another model call.",
    ...modePromptLines(gameMode),
    frameCount > 1 ? `You are given ${frameCount} frames from the same round. Analyze them together.` : "You are given one frame.",
    "Infer the most likely country, countryZh, continent, region, and city directly from the image. Prefer a city-level best guess whenever the scene gives any useful urban, road, landscape, language, or regional clue.",
    "Use the extracted clues as support, but do not invent hard evidence.",
    "For city, output the best likely city or nearest city-level area; leave city empty only when there is no meaningful city-level signal at all.",
    "Use Chinese for reason, evidence, alternatives, location, region, city, and direction fields. Keep country as an English canonical country name for coverage matching, and provide countryZh in Chinese.",
    "Also provide continent, continentDirection, countryDirection, cityDirection, and a concise location label.",
    "Direction fields should describe rough relative position, for example: 大洲东北部, 国家西南部, 城市北郊 / 市中心偏东 / 城市周边无法判断.",
    "countryZh and continent are required and must be filled in the same first-pass JSON.",
    "The placeGuess field must be present in the same JSON output.",
    'placeGuess format: {"country":"","countryZh":"","continent":"","continentDirection":"","countryDirection":"","cityDirection":"","location":"","region":"","city":"","confidence":0,"reason":"","evidence":[],"alternatives":[]}',
    `Summary: ${notes || "none"}`,
    "If the image has clues for placeGuess, include them in evidence and reason.",
    `Allowed clue tags: ${allowedTags.join(", ")}`,
    "Keep candidateRegions as countries or large regions only.",
    "Fill candidateCities with city-level candidates when possible, ordered by likelihood.",
    "Output the JSON structure required by the schema.",
    "",
    recentMemoryPromptReference(gameMode),
    "",
    promptReferenceForMode(gameMode),
    "",
    knowledgeBaseRef
  ];
  return lines.join("\n");
}

function extractOpenAiOutputText(data) {
  if (typeof data.output_text === "string") return data.output_text;
  const chunks = [];
  for (const item of data.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.value === "string") chunks.push(content.value);
    }
  }
  return chunks.join("\n");
}

function parseModelJson(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    return JSON.parse(match[0]);
  }
}

function inferTagsFromText(text) {
  const lower = String(text || "").toLowerCase();
  const rules = [
    { tag: "rural", words: ["rural", "countryside", "village", "farm", "field", "remote", "county road"], reason: "Scene looks rural or remote." },
    { tag: "urban-dense", words: ["urban", "building", "street", "traffic", "high-rise", "downtown"], reason: "Scene looks urban and dense." },
    { tag: "suburban", words: ["suburban", "suburb", "residential", "housing"], reason: "Scene looks suburban." },
    { tag: "forest", words: ["forest", "wooded", "woods", "woodland"], reason: "Scene has clear forest cover." },
    { tag: "coastal", words: ["coast", "coastal", "shore", "beach", "seaside"], reason: "Scene looks coastal." },
    { tag: "mountain", words: ["mountain", "hill", "hilly", "slope"], reason: "Scene suggests mountains or hills." },
    { tag: "flat", words: ["flat", "plain", "open field"], reason: "Scene looks flat and open." },
    { tag: "tropical", words: ["tropical", "palm", "rainforest"], reason: "Scene has tropical vegetation." },
    { tag: "temperate", words: ["trees", "tree-lined", "forest", "wooded", "shrubs", "temperate"], reason: "Scene has temperate vegetation." },
    { tag: "mediterranean", words: ["mediterranean", "olive", "cypress"], reason: "Scene suggests Mediterranean vegetation." },
    { tag: "nordic", words: ["nordic", "boreal", "spruce", "birch"], reason: "Scene suggests Nordic or boreal conditions." },
    { tag: "arid", words: ["desert", "arid", "dry", "barren"], reason: "Scene looks dry and arid." },
    { tag: "snowy", words: ["snow", "snowy", "ice", "winter", "frozen"], reason: "Scene suggests snow or cold weather." },
    { tag: "yellow-center", words: ["yellow line", "yellow road marking"], reason: "Yellow center line is mentioned." },
    { tag: "white-center", words: ["white line", "white road marking"], reason: "White center line is mentioned." },
    { tag: "double-yellow", words: ["double yellow"], reason: "Double yellow line is mentioned." },
    { tag: "red-shoulder", words: ["dirt road", "gravel", "soil", "unpaved", "mud road"], reason: "Road looks unpaved or gravelly." },
    { tag: "no-marking", words: ["unmarked", "no marking", "no lane line"], reason: "No visible road markings are mentioned." },
    { tag: "paved-road", words: ["paved", "asphalt", "concrete road"], reason: "Road looks paved." },
    { tag: "gravel-road", words: ["gravel", "stones", "pebble"], reason: "Road looks gravelly." },
    { tag: "dirt-road", words: ["dirt road", "unpaved", "mud road", "earth road"], reason: "Road looks dirt or unpaved." },
    { tag: "drive-left", words: ["left hand traffic", "left-hand traffic", "left side driving"], reason: "Left-hand traffic is mentioned." },
    { tag: "drive-right", words: ["right hand traffic", "right-hand traffic", "right side driving"], reason: "Right-hand traffic is mentioned." },
    { tag: "latin", words: ["latin text", "english text", "letters", "sign text"], reason: "Latin script is mentioned." },
    { tag: "cyrillic", words: ["cyrillic"], reason: "Cyrillic script is mentioned." },
    { tag: "arabic", words: ["arabic", "arabic script"], reason: "Arabic script is mentioned." },
    { tag: "thai", words: ["thai"], reason: "Thai script is mentioned." },
    { tag: "khmer", words: ["khmer"], reason: "Khmer script is mentioned." },
    { tag: "hangul", words: ["hangul"], reason: "Hangul is mentioned." },
    { tag: "kana", words: ["kana", "japanese"], reason: "Japanese kana is mentioned." },
    { tag: "chinese", words: ["chinese", "hanzi", "simplified", "traditional"], reason: "Chinese script is mentioned." },
    { tag: "devanagari", words: ["devanagari"], reason: "Devanagari script is mentioned." },
    { tag: "greek", words: ["greek"], reason: "Greek script is mentioned." },
    { tag: "us-sign", words: ["interstate", "county road", "route shield", "highway shield", "mph", "exit"], reason: "US-style road signage is mentioned." },
    { tag: "eu-sign", words: ["european", "eu sign", "km/h"], reason: "European-style road signage is mentioned." },
    { tag: "blue-motorway", words: ["blue motorway", "blue highway"], reason: "Blue motorway sign is mentioned." },
    { tag: "green-highway", words: ["green highway", "green motorway"], reason: "Green highway sign is mentioned." },
    { tag: "bilingual-sign", words: ["bilingual"], reason: "Bilingual signage is mentioned." }
  ];

  return rules.flatMap((rule) => {
    const hit = rule.words.some((word) => {
      const index = lower.indexOf(word);
      return index >= 0 && !isNegatedClue(lower, index, word.length);
    });
    if (!hit) return [];
    return [{ tag: rule.tag, reason: rule.reason, confidence: 0.52 }];
  });
}

function isNegatedClue(text, index, length) {
  const start = Math.max(0, index - 24);
  const end = Math.min(text.length, index + length + 24);
  const context = text.slice(start, end);
  return /not|no |without|exclude|except|鎺掗櫎|娌℃湁|鐒鏃爘涓嶅|涓嶆槸|涓嶇鍚坾骞堕潪/.test(context);
}

function normalizeVisionResult(value, gameMode = "world") {
  const result = value && typeof value === "object" ? value : {};
  const normalized = {
    summary: typeof result.summary === "string" ? result.summary : "",
    tags: [],
    textClues: Array.isArray(result.textClues) ? result.textClues.filter((item) => typeof item === "string") : [],
    candidateRegions: Array.isArray(result.candidateRegions)
      ? result.candidateRegions.filter((item) => typeof item === "string")
      : [],
    candidateCities: Array.isArray(result.candidateCities)
      ? result.candidateCities
          .filter((item) => item && typeof item.city === "string" && item.city.trim())
          .map((item) => ({
            city: item.city.trim(),
            country: typeof item.country === "string" ? item.country.trim() : "",
            reason: typeof item.reason === "string" ? item.reason : "Model provided this city candidate.",
            confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5))
          }))
      : [],
    confidence: Number.isFinite(Number(result.confidence)) ? Number(result.confidence) : 0,
    nextChecks: Array.isArray(result.nextChecks) ? result.nextChecks.filter((item) => typeof item === "string") : [],
    placeGuess: null
  };

  if (Array.isArray(result.tags)) {
    normalized.tags = result.tags
      .filter((item) => item && allowedTags.includes(item.tag))
      .map((item) => ({
        tag: item.tag,
        reason: typeof item.reason === "string" ? item.reason : "Model recognized this clue.",
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0.5))
      }));
  } else {
    normalized.tags = allowedTags.flatMap((tag) => {
      const valueForTag = result[tag];
      const hit =
        valueForTag === true ||
        (typeof valueForTag === "string" && valueForTag.trim()) ||
        (Array.isArray(valueForTag) && valueForTag.length);
      if (!hit) return [];
      return [
        {
          tag,
          reason: Array.isArray(valueForTag) ? valueForTag.join(", ") || "Model recognized this clue." : String(valueForTag),
          confidence: 0.5
        }
      ];
    });
  }

  const compactSummary = String(normalized.summary || "").replace(/\s+/g, " ").trim();
  normalized.summary = normalized.tags.length
    ? normalized.tags.map((item) => item.tag).slice(0, 5).join(" / ")
    : compactSummary.slice(0, 120);

  if (result.placeGuess && typeof result.placeGuess === "object") {
    normalized.placeGuess = normalizePlaceGuess(result.placeGuess, [], gameMode);
  }

  return normalized;
}

function normalizeVisionResultFromText(text, gameMode = "world") {
  const rawText = String(text || "").replace(/<\/?think>/gi, "").trim();
  const tags = inferTagsFromText(rawText);
  const compact = rawText.replace(/\s+/g, " ").trim();
  const summary =
    compact.length > 200
      ? tags.map((item) => item.tag).slice(0, 5).join(" / ") || compact.slice(0, 120)
      : compact;
  return normalizeVisionResult({
    summary,
    tags,
    textClues: [],
    candidateRegions: [],
    candidateCities: [],
    confidence: 0.45,
    nextChecks: []
  }, gameMode);
}

function guideAnalysisTokens(analysis) {
  const tokens = new Set();
  const add = (value) => {
    const text = String(value || "").toLowerCase().trim();
    if (text) tokens.add(text);
  };

  for (const item of analysis.tags || []) add(item.tag);
  for (const item of analysis.textClues || []) add(item);
  for (const item of analysis.candidateRegions || []) add(item);
  for (const item of analysis.candidateCities || []) {
    if (item?.city) add(item.city);
    if (item?.country) add(item.country);
  }
  add(analysis.summary);
  return [...tokens];
}

function scoreGuideCountry(country, analysis) {
  const tokens = guideAnalysisTokens(analysis);
  const haystack = String(country.searchableText || `${country.summary || ""} ${country.highlights?.join(" ") || ""} ${country.localities?.join(" ") || ""}`).toLowerCase();
  let score = 0;
  const reasons = [];
  let hardEvidence = 0;

  for (const tag of analysis.tags || []) {
    if ((country.signalTags || []).includes(tag.tag)) {
      const weight = tagWeightForGuide(tag.tag);
      score += weight;
      if (weight >= 2) hardEvidence += 1;
      reasons.push(`tag:${tag.tag}`);
    }
  }

  for (const token of tokens) {
    if (!token || token.length < 3) continue;
    if (haystack.includes(token)) {
      score += 1.2;
      reasons.push(`text:${token}`);
    }
  }

  if (country.title && String(analysis.summary || "").toLowerCase().includes(country.title.toLowerCase())) {
    score += 2.5;
    hardEvidence += 1;
    reasons.push("title-match");
  }

  if (Array.isArray(country.cat) && country.cat.some((cat) => (analysis.candidateRegions || []).some((region) => String(region).toLowerCase().includes(cat.toLowerCase())))) {
    score += 0.8;
    reasons.push("region-match");
  }

  return { score, reasons, hardEvidence };
}

function tagWeightForGuide(tag) {
  if (tag.startsWith("drive")) return 4;
  if (["kana", "hangul", "thai", "khmer", "cyrillic", "arabic", "chinese", "devanagari", "greek"].includes(tag)) return 3.6;
  if (tag.startsWith("plate")) return 2.7;
  if (["yellow-center", "white-center", "red-shoulder", "snow-road", "desert-road", "paved-road", "dirt-road", "gravel-road", "no-marking"].includes(tag)) return 2.2;
  if (["us-sign", "eu-sign", "blue-motorway", "green-highway", "bilingual-sign"].includes(tag)) return 2;
  if (["low-cam", "car-roof-rack", "car-antenna", "trekker", "blur-heavy"].includes(tag)) return 1.8;
  if (["concrete-pole", "wood-pole", "striped-bollard", "double-pole", "many-wires"].includes(tag)) return 1.6;
  if (["tropical", "temperate", "mediterranean", "nordic", "mountain", "flat", "urban-dense", "suburban", "rural", "coastal", "arid", "snowy", "forest"].includes(tag)) return 1.3;
  return 1;
}

function selectGuideHighlights(country, analysis, limit = 5) {
  const tokens = guideAnalysisTokens(analysis);
  const highlights = Array.isArray(country.highlights) ? country.highlights : [];
  const scored = highlights
    .map((text) => {
      const lower = String(text || "").toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (token && token.length >= 3 && lower.includes(token)) score += 1;
      }
      for (const locality of country.localities || []) {
        if (locality && lower.includes(String(locality).toLowerCase())) score += 1.5;
      }
      if (country.signalTags?.includes("drive-left") && /left|low-cam|japan|hong kong/i.test(lower)) score += 0.5;
      return { text, score };
    })
    .sort((a, b) => b.score - a.score);

  const selected = scored.filter((item) => item.score > 0).slice(0, limit).map((item) => item.text);
  if (selected.length) return selected;
  return highlights.slice(0, limit);
}

function buildGuideContext(analysis, limit = 4) {
  if (!Array.isArray(guideKnowledge.countries) || !guideKnowledge.countries.length) return [];
  const ranked = guideKnowledge.countries
    .map((country) => {
    const scored = scoreGuideCountry(country, analysis);
    return {
      ...country,
      score: scored.score,
      hardEvidence: scored.hardEvidence,
      reasons: scored.reasons
    };
  })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map((country) => ({
    title: country.title,
    slug: country.slug,
    code: country.code,
    cat: country.cat,
    score: country.score,
    hardEvidence: country.hardEvidence || 0,
    summary: country.summary,
    signalTags: country.signalTags || [],
    localities: country.localities || [],
    highlights: selectGuideHighlights(country, analysis)
  }));
}

function buildGuidePrompt(analysis, context) {
  const lines = [
    "You are a geolocation judge.",
    "Use only the image clues and the guide snippets below.",
    "The game only uses places from the playable coverage whitelist. Do not force a guess outside it.",
    "Prefer country first, then region, then a city-level best guess whenever there is any useful support.",
    "Return only JSON.",
    "Use Chinese for region, city, reason, evidence, alternatives, and direction fields.",
    "Also include rough directions: continentDirection, countryDirection, cityDirection.",
    'Format: {"country":"","countryZh":"","continent":"","continentDirection":"","countryDirection":"","cityDirection":"","location":"","region":"","city":"","confidence":0,"reason":"","evidence":[],"alternatives":[]}',
    `Image summary: ${analysis.summary || "none"}`,
    `Tags: ${(analysis.tags || []).map((item) => item.tag).join(", ") || "none"}`,
    `Text clues: ${(analysis.textClues || []).join(" | ") || "none"}`,
    `Candidate regions: ${(analysis.candidateRegions || []).join(", ") || "none"}`
  ];

  if (Array.isArray(analysis.candidateCities) && analysis.candidateCities.length) {
    lines.push(
      `Candidate cities: ${analysis.candidateCities
        .slice(0, 3)
        .map((item) => `${item.city}${item.country ? ` (${item.country})` : ""}`)
        .join(", ")}`
    );
  }

  lines.push("Guide snippets follow. Use them as evidence, not as a script to repeat.");
  lines.push("");
  lines.push(knowledgeBaseRef);
  lines.push("");

  context.forEach((country, index) => {
    lines.push(
      `#${index + 1} ${country.title}${country.cat?.length ? ` / ${country.cat.join(", ")}` : ""}`,
      `Signal tags: ${(country.signalTags || []).slice(0, 12).join(", ") || "none"}`,
      `Localities: ${(country.localities || []).slice(0, 12).join(", ") || "none"}`,
      `Summary: ${country.summary || "none"}`
    );
    for (const highlight of country.highlights || []) {
      lines.push(`- ${highlight}`);
    }
  });

  return lines.join("\n");
}

function countryMetaForPlace(country) {
  const lookup = {
    Russia: { countryZh: "俄罗斯", continent: "亚洲 / 欧洲" },
    Finland: { countryZh: "芬兰", continent: "欧洲" },
    Sweden: { countryZh: "瑞典", continent: "欧洲" },
    Norway: { countryZh: "挪威", continent: "欧洲" },
    Denmark: { countryZh: "丹麦", continent: "欧洲" },
    Iceland: { countryZh: "冰岛", continent: "欧洲" },
    Estonia: { countryZh: "爱沙尼亚", continent: "欧洲" },
    Latvia: { countryZh: "拉脱维亚", continent: "欧洲" },
    Lithuania: { countryZh: "立陶宛", continent: "欧洲" },
    Poland: { countryZh: "波兰", continent: "欧洲" },
    Germany: { countryZh: "德国", continent: "欧洲" },
    France: { countryZh: "法国", continent: "欧洲" },
    Spain: { countryZh: "西班牙", continent: "欧洲" },
    Portugal: { countryZh: "葡萄牙", continent: "欧洲" },
    Italy: { countryZh: "意大利", continent: "欧洲" },
    Netherlands: { countryZh: "荷兰", continent: "欧洲" },
    Belgium: { countryZh: "比利时", continent: "欧洲" },
    Switzerland: { countryZh: "瑞士", continent: "欧洲" },
    Austria: { countryZh: "奥地利", continent: "欧洲" },
    Czechia: { countryZh: "捷克", continent: "欧洲" },
    Slovakia: { countryZh: "斯洛伐克", continent: "欧洲" },
    Hungary: { countryZh: "匈牙利", continent: "欧洲" },
    Romania: { countryZh: "罗马尼亚", continent: "欧洲" },
    Bulgaria: { countryZh: "保加利亚", continent: "欧洲" },
    Serbia: { countryZh: "塞尔维亚", continent: "欧洲" },
    Croatia: { countryZh: "克罗地亚", continent: "欧洲" },
    Slovenia: { countryZh: "斯洛文尼亚", continent: "欧洲" },
    Greece: { countryZh: "希腊", continent: "欧洲" },
    Turkey: { countryZh: "土耳其", continent: "亚洲 / 欧洲" },
    Ukraine: { countryZh: "乌克兰", continent: "欧洲" },
    Belarus: { countryZh: "白俄罗斯", continent: "欧洲" },
    Georgia: { countryZh: "格鲁吉亚", continent: "亚洲 / 欧洲" },
    Armenia: { countryZh: "亚美尼亚", continent: "亚洲 / 欧洲" },
    Azerbaijan: { countryZh: "阿塞拜疆", continent: "亚洲 / 欧洲" },
    Kazakhstan: { countryZh: "哈萨克斯坦", continent: "亚洲 / 欧洲" },
    China: { countryZh: "中国", continent: "亚洲" },
    Japan: { countryZh: "日本", continent: "亚洲" },
    "South Korea": { countryZh: "韩国", continent: "亚洲" },
    "North Korea": { countryZh: "朝鲜", continent: "亚洲" },
    Mongolia: { countryZh: "蒙古", continent: "亚洲" },
    India: { countryZh: "印度", continent: "亚洲" },
    Nepal: { countryZh: "尼泊尔", continent: "亚洲" },
    Bhutan: { countryZh: "不丹", continent: "亚洲" },
    Bangladesh: { countryZh: "孟加拉国", continent: "亚洲" },
    Pakistan: { countryZh: "巴基斯坦", continent: "亚洲" },
    Thailand: { countryZh: "泰国", continent: "亚洲" },
    Laos: { countryZh: "老挝", continent: "亚洲" },
    Cambodia: { countryZh: "柬埔寨", continent: "亚洲" },
    Vietnam: { countryZh: "越南", continent: "亚洲" },
    Malaysia: { countryZh: "马来西亚", continent: "亚洲" },
    Singapore: { countryZh: "新加坡", continent: "亚洲" },
    Indonesia: { countryZh: "印度尼西亚", continent: "亚洲" },
    Philippines: { countryZh: "菲律宾", continent: "亚洲" },
    Australia: { countryZh: "澳大利亚", continent: "大洋洲" },
    "New Zealand": { countryZh: "新西兰", continent: "大洋洲" },
    Canada: { countryZh: "加拿大", continent: "北美洲" },
    "United States": { countryZh: "美国", continent: "北美洲" },
    Mexico: { countryZh: "墨西哥", continent: "北美洲" },
    Brazil: { countryZh: "巴西", continent: "南美洲" },
    Argentina: { countryZh: "阿根廷", continent: "南美洲" },
    Chile: { countryZh: "智利", continent: "南美洲" },
    Peru: { countryZh: "秘鲁", continent: "南美洲" },
    Colombia: { countryZh: "哥伦比亚", continent: "南美洲" },
    Ecuador: { countryZh: "厄瓜多尔", continent: "南美洲" },
    Bolivia: { countryZh: "玻利维亚", continent: "南美洲" },
    Uruguay: { countryZh: "乌拉圭", continent: "南美洲" },
    Paraguay: { countryZh: "巴拉圭", continent: "南美洲" },
    "South Africa": { countryZh: "南非", continent: "非洲" },
    Namibia: { countryZh: "纳米比亚", continent: "非洲" },
    Botswana: { countryZh: "博茨瓦纳", continent: "非洲" },
    Zambia: { countryZh: "赞比亚", continent: "非洲" },
    Zimbabwe: { countryZh: "津巴布韦", continent: "非洲" },
    Kenya: { countryZh: "肯尼亚", continent: "非洲" },
    Tanzania: { countryZh: "坦桑尼亚", continent: "非洲" },
    Uganda: { countryZh: "乌干达", continent: "非洲" },
    Rwanda: { countryZh: "卢旺达", continent: "非洲" },
    Ethiopia: { countryZh: "埃塞俄比亚", continent: "非洲" },
    Morocco: { countryZh: "摩洛哥", continent: "非洲" },
    Algeria: { countryZh: "阿尔及利亚", continent: "非洲" },
    Tunisia: { countryZh: "突尼斯", continent: "非洲" },
    Egypt: { countryZh: "埃及", continent: "非洲" },
    Israel: { countryZh: "以色列", continent: "亚洲" },
    Jordan: { countryZh: "约旦", continent: "亚洲" },
    "Saudi Arabia": { countryZh: "沙特阿拉伯", continent: "亚洲" },
    UAE: { countryZh: "阿联酋", continent: "亚洲" },
    Oman: { countryZh: "阿曼", continent: "亚洲" },
    Qatar: { countryZh: "卡塔尔", continent: "亚洲" },
    Kuwait: { countryZh: "科威特", continent: "亚洲" },
    Bahrain: { countryZh: "巴林", continent: "亚洲" },
    Iraq: { countryZh: "伊拉克", continent: "亚洲" },
    Iran: { countryZh: "伊朗", continent: "亚洲" }
  };
  return lookup[country] || { countryZh: country || "", continent: "" };
}

function normalizePlaceGuess(value, context = [], gameMode = "world") {
  const result = value && typeof value === "object" ? value : {};
  const mode = normalizeGameMode(gameMode);
  const resultCountry = mode === "china" && !result.country ? "China" : result.country;
  const countryMeta = countryMetaForPlace(resultCountry);
  const isMainlandChinaInWorld = mode === "world" && normalizeCoverageKey(resultCountry) === "china";
  const coverage = mode === "china"
    ? { title: "China", code: "CN", continent: "Asia", generations: [], generationNotes: ["图寻中国模式：使用中国街景题库判断"] }
    : isMainlandChinaInWorld
      ? null
      : coverageInfoForPlace(resultCountry);
  const generationNotes = Array.isArray(coverage?.generationNotes) ? coverage.generationNotes.slice(0, 3) : [];
  const generations = Array.isArray(coverage?.generations) ? coverage.generations.slice(0, 4) : [];
  const normalized = {
    country: mode === "china" ? "China" : typeof result.country === "string" ? result.country.trim() : "",
    countryZh: mode === "china" ? "中国" : typeof result.countryZh === "string" && result.countryZh.trim() ? result.countryZh.trim() : countryMeta.countryZh,
    continent: mode === "china" ? "亚洲" : typeof result.continent === "string" && result.continent.trim() ? result.continent.trim() : countryMeta.continent,
    continentDirection: typeof result.continentDirection === "string" ? result.continentDirection.trim() : "",
    countryDirection: typeof result.countryDirection === "string" ? result.countryDirection.trim() : "",
    cityDirection: typeof result.cityDirection === "string" ? result.cityDirection.trim() : "",
    location: typeof result.location === "string" && result.location.trim() ? result.location.trim() : "",
    region: typeof result.region === "string" ? result.region.trim() : "",
    city: typeof result.city === "string" ? result.city.trim() : "",
    confidence: Number.isFinite(Number(result.confidence)) ? Math.max(0, Math.min(1, Number(result.confidence))) : 0,
    reason: typeof result.reason === "string" ? result.reason.trim() : "",
    evidence: Array.isArray(result.evidence) ? result.evidence.filter((item) => typeof item === "string") : [],
    alternatives: Array.isArray(result.alternatives) ? result.alternatives.filter((item) => typeof item === "string") : [],
    guideMatches: context.map((item) => item.title),
    coverage: coverage
      ? {
          playable: true,
          title: coverage.title,
          code: coverage.code || "",
          continent: coverage.continent || "",
          generations,
          generationNotes
        }
      : resultCountry
        ? {
            playable: false,
            title: String(resultCountry).trim(),
            code: "",
            continent: "",
            generations: [],
            generationNotes: []
          }
        : null
  };

  if (!normalized.country && !normalized.region && !normalized.city) {
    normalized.confidence = Math.min(normalized.confidence || 0, 0.18);
    normalized.reason = normalized.reason || "Insufficient evidence for a confident place guess.";
  }

  if (!normalized.location) {
    normalized.location = normalized.region || normalized.city || normalized.countryZh || normalized.country || "";
  }

  if (normalized.coverage && !normalized.coverage.playable) {
    const warning = "不在图寻可玩覆盖范围";
    if (!normalized.reason) {
      normalized.reason = warning;
    } else if (!normalized.reason.includes(warning)) {
      normalized.reason = `${normalized.reason}；${warning}`;
    }
  }

  if (normalized.coverage && normalized.coverage.playable && !normalized.coverage.generations.length && Array.isArray(coverageKnowledge.playablePlaces)) {
    const matched = coverageKnowledge.playablePlaces.find((item) => item.title === normalized.coverage.title);
    if (matched && Array.isArray(matched.generations)) {
      normalized.coverage.generations = matched.generations.slice(0, 4);
    }
    if (matched && Array.isArray(matched.generationNotes)) {
      normalized.coverage.generationNotes = matched.generationNotes.slice(0, 3);
    }
  }

  return normalized;
}

async function guessPlaceWithGuide(analysis) {
  if (visionProvider !== "ollama" || !Array.isArray(guideKnowledge.countries) || !guideKnowledge.countries.length) return null;

  const context = buildGuideContext(analysis, 4);
  if (!context.length || (context[0].hardEvidence || 0) < 1) {
    return normalizePlaceGuess({ reason: "Insufficient evidence for guide guess.", confidence: 0 }, context);
  }

  const prompt = buildGuidePrompt(analysis, context);
  const { controller, timeout } = withTimeout(Math.min(ollamaTimeoutMs, 45000));

  try {
    const response = await fetch(`${ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        stream: false,
        format: "json",
        think: false,
        options: {
          temperature: 0.1,
          num_predict: 320
        },
        keep_alive: "10m",
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      }),
      signal: controller.signal
    });

    const data = await response.json();
    if (!response.ok) {
      const message = typeof data.error === "string" ? data.error : data.error?.message || "guide guess failed";
      return normalizePlaceGuess({ reason: message, confidence: 0 }, context);
    }

    const content = data.message?.content || "";
    const thinking = data.message?.thinking || "";
    const parsed = parseModelJson(content) || parseModelJson(thinking) || {};
    const normalized = normalizePlaceGuess(parsed, context);
    if (!normalized.reason && !parsed.country && !parsed.region && !parsed.city && context[0]) {
      normalized.reason = `guide top match: ${context[0].title}`;
    }
    return normalized;
  } catch (error) {
    if (error.name === "AbortError") return normalizePlaceGuess({ reason: "guide guess timed out", confidence: 0 }, context);
    return normalizePlaceGuess({ reason: error.message || "guide guess failed", confidence: 0 }, context);
  } finally {
    clearTimeout(timeout);
  }
}

async function ollamaStatus() {
  const { controller, timeout } = withTimeout(1200);
  try {
    const response = await fetch(`${ollamaHost}/api/tags`, { signal: controller.signal });
    if (!response.ok) {
      return { available: false, modelAvailable: false, models: [] };
    }
    const data = await response.json();
    const models = (data.models || []).map((model) => model.name);
    const modelAvailable = models.some(
      (name) => name === visionModel || name === `${visionModel}:latest` || name.startsWith(`${visionModel}:`)
    );
    return {
      available: true,
      modelAvailable,
      models
    };
  } catch (error) {
    return { available: false, modelAvailable: false, models: [] };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWithOllama(images, notes = "", gameMode = "world") {
  const normalizedImages = normalizeImageInputs(images);
  assertImages(normalizedImages);
  const { controller, timeout } = withTimeout(ollamaTimeoutMs);

  try {
    const response = await fetch(`${ollamaHost}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: visionModel,
        stream: false,
        ...(isFastOllamaModel || isQwenOllamaModel ? {} : { format: "json" }),
        think: false,
        options: {
          temperature: 0.1,
          num_predict: isFastOllamaModel ? 220 : isQwenOllamaModel ? 280 : 700
        },
        keep_alive: "10m",
        messages: [
          {
            role: "user",
            content: isFastOllamaModel ? analysisPrompt(notes, normalizedImages.length, gameMode) : `/no_think\n${analysisPrompt(notes, normalizedImages.length, gameMode)}`,
            images: normalizedImages.map((image) => base64FromDataUrl(image))
          }
        ]
      }),
      signal: controller.signal
    });

    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || "Ollama vision request failed");
      error.status = response.status;
      throw error;
    }

    const content = data.message?.content || "";
    const thinking = data.message?.thinking || "";
    if (isFastOllamaModel) return normalizeVisionResultFromText(content, gameMode);
    if (isQwenOllamaModel && !content.trim() && thinking.trim()) return normalizeVisionResultFromText(thinking, gameMode);

    const parsed = parseModelJson(content);
    if (!parsed) {
      if (isQwenOllamaModel && thinking.trim()) return normalizeVisionResultFromText(thinking, gameMode);
      if (isFastOllamaModel) return normalizeVisionResultFromText(content, gameMode);
      const error = new Error("Ollama returned no parseable JSON");
      error.status = 502;
      throw error;
    }
    const normalized = normalizeVisionResult(parsed, gameMode);
    if (isFastOllamaModel && !normalized.tags.length && content.trim()) {
      return normalizeVisionResultFromText(content, gameMode);
    }
    return normalized;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`Ollama vision request timed out after ${Math.round(ollamaTimeoutMs / 1000)}s`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWithOpenAi(images, notes = "", gameMode = "world") {
  const normalizedImages = normalizeImageInputs(images);
  assertImages(normalizedImages);
  const auth = resolveOpenAiBearerToken();
  if (!auth.token) {
    const error = new Error("OPENAI_API_KEY is not configured and Codex ChatGPT auth is unavailable");
    error.status = 503;
    throw error;
  }

  const { controller, timeout } = withTimeout(openAiTimeoutMs);
  try {
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: visionModel,
        max_output_tokens: 650,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: analysisPrompt(notes, normalizedImages.length, gameMode) }].concat(
              normalizedImages.map((image) => ({ type: "input_image", image_url: image }))
            )
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "tuxun_visual_clues",
            strict: true,
            schema: visionSchema()
          }
        }
      }),
      signal: controller.signal
    });

    const data = await response.json();
    if (!response.ok) {
      const message =
        data.error?.message ||
        (auth.source === "codex-chatgpt"
          ? "Codex ChatGPT auth does not have the api.responses.write scope needed for vision requests"
          : "OpenAI vision request failed");
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const parsed = parseModelJson(extractOpenAiOutputText(data));
    if (!parsed) {
      const error = new Error("OpenAI returned no parseable JSON");
      error.status = 502;
      throw error;
    }
    return normalizeVisionResult(parsed, gameMode);
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`OpenAI vision request timed out after ${Math.round(openAiTimeoutMs / 1000)}s`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function placeGuessSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "country",
      "countryZh",
      "continent",
      "continentDirection",
      "countryDirection",
      "cityDirection",
      "location",
      "region",
      "city",
      "confidence",
      "reason",
      "evidence",
      "alternatives"
    ],
    properties: {
      country: { type: "string" },
      countryZh: { type: "string" },
      continent: { type: "string" },
      continentDirection: { type: "string" },
      countryDirection: { type: "string" },
      cityDirection: { type: "string" },
      location: { type: "string" },
      region: { type: "string" },
      city: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
      evidence: {
        type: "array",
        items: { type: "string" }
      },
      alternatives: {
        type: "array",
        items: { type: "string" }
      }
    }
  };
}

function buildPlaceGuessPrompt(analysis, notes = "", guideContext = [], gameMode = "world") {
  const lines = [
    "You are a GeoGuessr location judge.",
    "Return only JSON.",
    ...modePromptLines(gameMode),
    "Guess the most likely country, countryZh, continent, region, and city from the image. Prefer a city-level best guess whenever there is any useful support.",
    "Use the extracted clues as support, but do not invent hard evidence.",
    "For city, output the best likely city or nearest city-level area; leave city empty only when there is no meaningful city-level signal at all.",
    "Use Chinese for reason, evidence, alternatives, location, region, city, and direction fields. Keep country as an English canonical country name for coverage matching, and provide countryZh in Chinese.",
    "Also provide continentDirection, countryDirection, and cityDirection.",
    "Direction fields should describe rough relative position, for example: 大洲东北部, 国家西南部, 城市北郊 / 市中心偏东 / 城市周边无法判断.",
    "countryZh and continent are required and must be filled directly by the model.",
    'Format: {"country":"","countryZh":"","continent":"","continentDirection":"","countryDirection":"","cityDirection":"","location":"","region":"","city":"","confidence":0,"reason":"","evidence":[],"alternatives":[]}',
    `Summary: ${analysis.summary || "none"}`,
    `Tags: ${(analysis.tags || []).map((item) => item.tag).join(", ") || "none"}`,
    `Text clues: ${(analysis.textClues || []).join(" | ") || "none"}`,
    `Candidate regions: ${(analysis.candidateRegions || []).join(", ") || "none"}`,
    `Candidate cities: ${Array.isArray(analysis.candidateCities) && analysis.candidateCities.length ? analysis.candidateCities.slice(0, 3).map((item) => `${item.city}${item.country ? ` (${item.country})` : ""}`).join(", ") : "none"}`,
    `Notes: ${notes || "none"}`,
    "",
    memoryPromptReference(analysis, null, gameMode),
    "",
    promptReferenceForMode(gameMode),
    "",
    knowledgeBaseRef
  ];

  if (Array.isArray(guideContext) && guideContext.length) {
    lines.push("");
    lines.push("知识库中与当前线索匹配度最高的国家/地区参考:");
    guideContext.forEach((country, index) => {
      lines.push(
        `#${index + 1} ${country.title}${country.cat?.length ? ` / ${country.cat.join(", ")}` : ""}`,
        `特征标签: ${(country.signalTags || []).slice(0, 12).join(", ") || "none"}`,
        `主要城市: ${(country.localities || []).slice(0, 10).join(", ") || "none"}`,
        `概况: ${country.summary || "none"}`
      );
      for (const highlight of country.highlights || []) {
        lines.push(`- ${highlight}`);
      }
    });
  }

  return lines.join("\n");
}

async function guessPlaceWithOpenAi(image, analysis, notes = "", guideContext = [], gameMode = "world") {
  assertImage(image);
  const auth = resolveOpenAiBearerToken();
  if (!auth.token) {
    return normalizePlaceGuess({ reason: "OpenAI auth unavailable", confidence: 0 }, [], gameMode);
  }

  const { controller, timeout } = withTimeout(30000);
  try {
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: visionModel,
        max_output_tokens: 360,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildPlaceGuessPrompt(analysis, notes, guideContext, gameMode) },
              { type: "input_image", image_url: image }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "tuxun_place_guess",
            strict: true,
            schema: placeGuessSchema()
          }
        }
      }),
      signal: controller.signal
    });

    const data = await response.json();
    if (!response.ok) {
      return normalizePlaceGuess({ reason: data.error?.message || "place guess failed", confidence: 0 }, [], gameMode);
    }

    const parsed = parseModelJson(extractOpenAiOutputText(data));
    if (!parsed) {
      return normalizePlaceGuess({ reason: "OpenAI returned no parseable place guess", confidence: 0 }, [], gameMode);
    }
    return normalizePlaceGuess(parsed, [], gameMode);
  } finally {
    clearTimeout(timeout);
  }
}

async function reviewPlaceGuessWithOpenAi(image, analysis, placeGuess, notes = "", gameMode = "world", reasoningMode = "accurate") {
  if (!agentReviewEnabled || normalizeReasoningMode(reasoningMode) !== "accurate" || !placeGuess) return placeGuess;
  assertImage(image);
  const auth = resolveOpenAiBearerToken();
  if (!auth.token) return placeGuess;

  let current = placeGuess;
  const seenSignatures = new Set();

  for (let round = 0; round < maxAgentReviewRounds; round += 1) {
    const signature = [current.country, current.region, current.city, current.location].map((item) => String(item || "").toLowerCase()).join("|");
    if (seenSignatures.has(signature)) break;
    seenSignatures.add(signature);

    const references = relatedTuxunReferences(analysis, current, gameMode, round === 0 ? 8 : 10);
    const { controller, timeout } = withTimeout(Math.min(openAiTimeoutMs, 45000));
    try {
      const response = await fetch(`${openAiBaseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${auth.token}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: visionModel,
          max_output_tokens: 520,
          input: [
            {
              role: "user",
              content: [
                { type: "input_text", text: buildAgentReviewPrompt(analysis, current, references, notes, gameMode) },
                { type: "input_image", image_url: image }
              ]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "tuxun_agent_review_place_guess",
              strict: true,
              schema: placeGuessSchema()
            }
          }
        }),
        signal: controller.signal
      });

      const data = await response.json();
      if (!response.ok) return current;
      const parsed = parseModelJson(extractOpenAiOutputText(data));
      if (!parsed) return current;

      const reviewed = normalizePlaceGuess(parsed, [], gameMode);
      reviewed.reviewed = true;
      reviewed.reviewRounds = round + 1;
      reviewed.reviewSources = references.map((doc) => doc.title);
      if (!reviewed.evidence.some((item) => item.includes("复核参考")) && references.length) {
        reviewed.evidence = reviewed.evidence.concat(`复核参考：${references.slice(0, 3).map((doc) => doc.title).join("、")}`).slice(0, 6);
      }

      const nextSignature = [reviewed.country, reviewed.region, reviewed.city, reviewed.location].map((item) => String(item || "").toLowerCase()).join("|");
      current = reviewed;
      if (nextSignature === signature) break;
    } catch {
      return current;
    } finally {
      clearTimeout(timeout);
    }
  }

  return current;
}

function memorySchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["items"],
    properties: {
      items: {
        type: "array",
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "location", "clue", "knowledge", "tags"],
          properties: {
            title: { type: "string" },
            location: { type: "string" },
            clue: { type: "string" },
            knowledge: { type: "string" },
            tags: {
              type: "array",
              items: { type: "string" }
            }
          }
        }
      }
    }
  };
}

function buildMemoryPrompt(payload) {
  return [
    "You create reusable TuXun geolocation memory after the user marked an answer as accurate.",
    "Return only JSON. Write concise, generalizable knowledge points, not a recap of one screenshot.",
    "Prefer clues that can help future fast guesses: visible signs, plates, taxi livery, pole/car meta, vegetation, architecture, road markings, city/province/region cues.",
    "Use Chinese.",
    `Game mode: ${normalizeGameMode(payload.gameMode)}`,
    `Confirmed result: ${JSON.stringify(payload.result || {})}`,
    `Notes: ${payload.notes || "none"}`,
    'Format: {"items":[{"title":"","location":"","clue":"","knowledge":"","tags":[]}]}'
  ].join("\n");
}

async function generateMemoryItems(payload) {
  const auth = resolveOpenAiBearerToken();
  const guess = payload.result?.placeGuess || {};
  const fallback = {
    title: `${guess.countryZh || guess.country || "地点"} 常用线索`,
    location: [guess.countryZh || guess.country, guess.region, guess.city].filter(Boolean).join(" / "),
    clue: Array.isArray(guess.evidence) && guess.evidence.length ? guess.evidence.slice(0, 2).join("；") : guess.reason || "用户确认该判断准确",
    knowledge: guess.reason || "该地点判断被用户确认准确，可作为后续同类线索参考。",
    tags: Array.isArray(payload.result?.tags) ? payload.result.tags.slice(0, 6).map((item) => item.tag).filter(Boolean) : []
  };

  if (!auth.token || !(visionProvider === "openai" || visionProvider === "chatgpt" || visionProvider === "newapi")) {
    return [fallback];
  }

  const { controller, timeout } = withTimeout(Math.min(openAiTimeoutMs, 30000));
  try {
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${auth.token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: visionModel,
        max_output_tokens: 420,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: buildMemoryPrompt(payload) }]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "tuxun_memory_items",
            strict: true,
            schema: memorySchema()
          }
        }
      }),
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) return [fallback];
    const parsed = parseModelJson(extractOpenAiOutputText(data));
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    return items.length ? items : [fallback];
  } catch {
    return [fallback];
  } finally {
    clearTimeout(timeout);
  }
}

async function rememberAccurateResult(payload) {
  const generated = await generateMemoryItems(payload);
  const store = loadMemoryStore();
  const now = new Date().toISOString();
  const gameMode = normalizeGameMode(payload.gameMode);
  const result = payload.result || {};
  const items = generated
    .filter((item) => item && (item.knowledge || item.clue || item.title))
    .map((item) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      gameMode,
      title: String(item.title || "").slice(0, 80),
      location: String(item.location || "").slice(0, 120),
      clue: String(item.clue || "").slice(0, 260),
      knowledge: String(item.knowledge || "").slice(0, 420),
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).slice(0, 40)).slice(0, 8) : [],
      sourceGuess: result.placeGuess
        ? {
            country: result.placeGuess.country || "",
            countryZh: result.placeGuess.countryZh || "",
            region: result.placeGuess.region || "",
            city: result.placeGuess.city || "",
            confidence: result.placeGuess.confidence || 0
          }
        : null
    }));

  store.items = [...items, ...store.items];
  return saveMemoryStore(store);
}

async function analyzeImage(imageOrImages, notes = "", gameMode = "world", reasoningMode = "accurate") {
  const mode = normalizeGameMode(gameMode);
  const images = normalizeImageInputs(imageOrImages);
  assertImages(images);
  let analysis;
  if (visionProvider === "openai" || visionProvider === "chatgpt" || visionProvider === "newapi") analysis = await analyzeWithOpenAi(images, notes, mode);
  else if (visionProvider === "ollama") analysis = await analyzeWithOllama(images, notes, mode);
  else {
    const error = new Error(`Unsupported VISION_PROVIDER: ${visionProvider}`);
    error.status = 400;
    throw error;
  }

  if (mode === "china") {
    if (analysis.placeGuess) {
      const placeGuess = normalizePlaceGuess(analysis.placeGuess, [], mode);
      analysis.placeGuess = visionProvider === "openai" || visionProvider === "chatgpt" || visionProvider === "newapi"
        ? await reviewPlaceGuessWithOpenAi(images[0], analysis, placeGuess, notes, mode, reasoningMode)
        : placeGuess;
    }
  } else if (visionProvider === "ollama") {
    const placeGuess = await guessPlaceWithGuide(analysis);
    if (placeGuess) {
      analysis.placeGuess = placeGuess;
    }
  } else if (visionProvider === "openai" || visionProvider === "chatgpt" || visionProvider === "newapi") {
    const guideContext = buildGuideContext(analysis, 4);
    if (guideContext.length && (guideContext[0].hardEvidence || 0) >= 1) {
      const placeGuess = await guessPlaceWithOpenAi(images[0], analysis, notes, guideContext, mode);
      if (placeGuess) {
        analysis.placeGuess = await reviewPlaceGuessWithOpenAi(images[0], analysis, placeGuess, notes, mode, reasoningMode);
      }
    } else {
      const placeGuess = await guessPlaceWithOpenAi(images[0], analysis, notes, [], mode);
      if (placeGuess) {
        analysis.placeGuess = await reviewPlaceGuessWithOpenAi(images[0], analysis, placeGuess, notes, mode, reasoningMode);
      }
    }
  }

  return analysis;
}

async function configPayload() {
  if (visionProvider === "openai" || visionProvider === "chatgpt" || visionProvider === "newapi") {
    const auth = resolveOpenAiBearerToken();
    return {
      vision: Boolean(auth.token),
      provider: visionProvider,
      model: visionModel,
      baseUrl: openAiBaseUrl,
      authSource: auth.source || "none",
      agentReview: agentReviewEnabled,
      agentReviewRounds: maxAgentReviewRounds,
      message: auth.token
        ? auth.source === "codex-chatgpt"
          ? "OpenAI vision enabled via Codex ChatGPT auth"
          : "OpenAI vision enabled"
        : "OPENAI_API_KEY is not configured and Codex ChatGPT auth is unavailable"
    };
  }

  if (visionProvider === "ollama") {
    const status = await ollamaStatus();
    return {
      vision: status.available && status.modelAvailable,
      provider: visionProvider,
      mode: visionMode,
      model: visionModel,
      host: ollamaHost,
      timeoutMs: ollamaTimeoutMs,
      agentReview: false,
      models: status.models,
      message: !status.available
        ? "Ollama is not running or not reachable"
        : status.modelAvailable
          ? "Ollama vision enabled"
          : `Ollama model is not installed: ${visionModel}`
    };
  }

  return {
    vision: false,
    provider: visionProvider,
    model: visionModel,
    message: `Unsupported VISION_PROVIDER: ${visionProvider}`
  };
}

rebuildExtensionZip();
watchExtensionZip();

http
  .createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      send(res, 204, "");
      return;
    }

    if (req.method === "GET" && req.url === "/api/config") {
      sendJson(res, 200, await configPayload());
      return;
    }

    if (req.method === "GET" && req.url === "/api/memory") {
      sendJson(res, 200, loadMemoryStore());
      return;
    }

    if (req.method === "POST" && req.url === "/api/memory/confirm") {
      try {
        const body = await readJson(req, 2 * 1024 * 1024);
        if (!body.accurate) {
          sendJson(res, 200, { ok: true, remembered: false });
          return;
        }
        const store = await rememberAccurateResult({
          gameMode: body.gameMode,
          result: body.result,
          notes: body.notes
        });
        sendJson(res, 200, { ok: true, remembered: true, count: store.items.length, items: store.items.slice(0, 3) });
      } catch (error) {
        sendJson(res, error.status || 500, { error: error.message || "Failed to save memory" });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/analyze") {
      try {
        const body = await readJson(req);
        const inputImages = Array.isArray(body.images) && body.images.length ? body.images : body.image;
        const result = await analyzeImage(inputImages, body.notes, body.gameMode, body.reasoningMode);
        sendJson(res, 200, result);
      } catch (error) {
        sendJson(res, error.status || 500, {
          error: error.message || "Analysis failed"
        });
      }
      return;
    }

    if (req.method === "POST" && req.url === "/api/analyze-stream") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type, authorization"
      });

      try {
        const body = await readJson(req);
        const inputImages = Array.isArray(body.images) && body.images.length ? body.images : body.image;
        const images = normalizeImageInputs(inputImages);
        assertImages(images);
        const notes = body.notes || "";
        const gameMode = normalizeGameMode(body.gameMode);
        const reasoningMode = normalizeReasoningMode(body.reasoningMode);

        sendSSE(res, "status", { message: "正在识图…" });

        if (visionProvider === "ollama") {
          const analysis = await analyzeWithOllama(images, notes, gameMode);

          sendSSE(res, "analysis", {
            summary: analysis.summary,
            tags: analysis.tags,
            textClues: analysis.textClues,
            candidateCities: analysis.candidateCities,
            candidateRegions: analysis.candidateRegions
          });

          const placeGuess = gameMode === "china"
            ? analysis.placeGuess ? normalizePlaceGuess(analysis.placeGuess, [], gameMode) : null
            : await guessPlaceWithGuide(analysis);
          if (placeGuess) {
            sendSSE(res, "place", {
              country: placeGuess.country,
              countryZh: placeGuess.countryZh,
              continent: placeGuess.continent,
              continentDirection: placeGuess.continentDirection,
              countryDirection: placeGuess.countryDirection,
              cityDirection: placeGuess.cityDirection,
              location: placeGuess.location,
              region: placeGuess.region,
              city: placeGuess.city,
              confidence: placeGuess.confidence
            });
            sendSSE(res, "reason", { chunk: placeGuess.reason || "" });
            sendSSE(res, "done", { placeGuess, tags: analysis.tags });
          } else {
            sendSSE(res, "done", {});
          }
        } else {
          await streamCombinedAnalysis(res, images, notes, gameMode, reasoningMode);
        }

        res.end();
      } catch (error) {
        sendSSE(res, "error", { message: error.message || "分析失败" });
        res.end();
      }
      return;
    }

    if (req.method !== "GET") {
      send(res, 405, "Method not allowed");
      return;
    }

    const filePath = safePath(req.url || "/");
    if (!filePath) {
      send(res, 403, "Forbidden");
      return;
    }
    if (!isPublicFile(filePath)) {
      send(res, 404, "Not found");
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        send(res, 404, "Not found");
        return;
      }
      send(res, 200, data, types[path.extname(filePath)] || "application/octet-stream");
    });
  })
  .listen(port, () => {
    console.log(`TuXun AI assistant is running at http://localhost:${port}`);
    console.log(`Vision provider: ${visionProvider} (${visionModel})`);
  });
