const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const defaultSourceDir = path.join(repoRoot, "data", "tuxun-docs");
const sourceDir = process.env.TUXUN_DOCS_DIR ? path.resolve(process.env.TUXUN_DOCS_DIR) : defaultSourceDir;
const outputPath = path.join(repoRoot, "data", "tuxun-doc-summary.json");

const focusRules = [
  { test: /中国|省|自治区|市|出租车|区号|腾讯|车牌/, topic: "china" },
  { test: /电线杆|pole|贴纸/, topic: "pole-meta" },
  { test: /街景车|特殊街景车|metacar|car/, topic: "car-meta" },
  { test: /植被|棕榈|气候|柯本|生物群系/, topic: "vegetation-climate" },
  { test: /语言|文字|拉丁|婆罗米|电话区号/, topic: "language-text" },
  { test: /易混/, topic: "confusable-countries" },
  { test: /区域|region|俄罗斯|美国|印度尼西亚|菲律宾|墨西哥|新西兰|玻利维亚|智利|阿根廷|意大利|土耳其|秘鲁/, topic: "regionguessing" },
  { test: /Plonk|国家|博茨瓦纳|埃及|日本|韩国|法国|德国|巴西|加拿大|澳大利亚/, topic: "world-country-guides" }
];

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function resolveMarkdownPath(markdownPath) {
  const normalized = String(markdownPath || "").replaceAll("\\", "/");
  if (path.isAbsolute(normalized)) return normalized;
  const relative = normalized.startsWith("out/tuxun/")
    ? normalized.slice("out/tuxun/".length)
    : normalized;
  return path.join(sourceDir, relative.replaceAll("/", path.sep));
}

function markdownHeadings(markdownPath) {
  const fullPath = resolveMarkdownPath(markdownPath);
  if (!fs.existsSync(fullPath)) return [];
  const raw = fs.readFileSync(fullPath, "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => /^#{1,3}\s+/.test(line))
    .map((line) => line.replace(/^#{1,3}\s+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^!\[/.test(line))
    .slice(0, 16);
}

function cleanMarkdownText(value) {
  return String(value || "")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[[^\]]*]\([^)]*\)/g, (match) => match.replace(/^\[|\]\([^)]*\)$/g, ""))
    .replace(/[`*_>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownExcerpts(markdownPath) {
  const fullPath = resolveMarkdownPath(markdownPath);
  if (!fs.existsSync(fullPath)) return [];

  const lines = fs.readFileSync(fullPath, "utf8").split(/\r?\n/);
  const excerpts = [];
  let currentHeading = "";
  let bucket = [];

  function flush() {
    const text = bucket.map(cleanMarkdownText).filter(Boolean).join(" ");
    if (currentHeading && text) {
      excerpts.push({
        heading: currentHeading,
        text: text.slice(0, 420)
      });
    }
    bucket = [];
  }

  for (const line of lines) {
    if (/^#{1,3}\s+/.test(line)) {
      flush();
      currentHeading = cleanMarkdownText(line.replace(/^#{1,3}\s+/, ""));
      continue;
    }
    if (!currentHeading || excerpts.length >= 8) continue;
    const cleaned = cleanMarkdownText(line);
    if (!cleaned || /^https?:\/\//i.test(cleaned) || cleaned.length < 8) continue;
    if (bucket.join(" ").length < 520) bucket.push(cleaned);
  }
  flush();

  return excerpts
    .filter((item) => item.text.length >= 30)
    .slice(0, 8);
}

function inferTopics(title) {
  const topics = [];
  for (const rule of focusRules) {
    if (rule.test.test(title)) topics.push(rule.topic);
  }
  return topics.length ? topics : ["general"];
}

function buildCategoryPath(toc, item) {
  const byUuid = new Map(toc.filter((entry) => entry.uuid).map((entry) => [entry.uuid, entry]));
  const pathItems = [];
  let current = item;
  const seen = new Set();
  while (current?.parent_uuid && !seen.has(current.parent_uuid)) {
    seen.add(current.parent_uuid);
    current = byUuid.get(current.parent_uuid);
    if (current?.title) pathItems.unshift(current.title);
  }
  return pathItems;
}

function summarizeCategories(toc) {
  const docs = toc.filter((item) => item.type === "DOC");
  const groups = new Map();

  for (const doc of docs) {
    const categoryPath = buildCategoryPath(toc, doc);
    const key = categoryPath.slice(0, 3).join(" / ") || "根目录";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(doc.title);
  }

  return [...groups.entries()]
    .map(([pathName, titles]) => ({
      path: pathName,
      count: titles.length,
      examples: titles.slice(0, 8)
    }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
}

function main() {
  const metadata = readJson(path.join(sourceDir, "metadata.json"), {});
  const toc = readJson(path.join(sourceDir, "toc.json"), []);
  const docs = Array.isArray(metadata.docs) ? metadata.docs : [];

  const importantDocs = docs
    .filter((doc) => doc.word_count > 0)
    .map((doc) => ({
      order: doc.order,
      title: doc.title,
      slug: doc.slug,
      markdownPath: doc.markdown_path,
      wordCount: doc.word_count,
      updatedAt: doc.content_updated_at,
      topics: inferTopics(doc.title),
      headings: markdownHeadings(doc.markdown_path),
      excerpts: markdownExcerpts(doc.markdown_path)
    }))
    .filter((doc) => doc.wordCount >= 1200 || doc.topics.some((topic) => topic !== "general"))
    .sort((a, b) => {
      const topicWeight = (item) => item.topics.includes("confusable-countries") || item.topics.includes("pole-meta") || item.topics.includes("car-meta") ? 2 : 0;
      return topicWeight(b) - topicWeight(a) || b.wordCount - a.wordCount;
    })
    .slice(0, 80);

  const summary = {
    source: metadata.source || "local tuxun docs",
    crawledAt: metadata.crawled_at || "",
    book: metadata.book || {},
    docCount: metadata.count || docs.length,
    availableDocCount: docs.length,
    errors: Array.isArray(metadata.errors)
      ? metadata.errors.map((item) => ({ slug: item.slug, title: item.title, message: item.message }))
      : [],
    categorySummary: summarizeCategories(toc).slice(0, 28),
    promptGuidelines: [
      "Use TuXun documents as a geolocation checklist, not as permission to invent evidence.",
      "The user-selected game mode controls the prompt: China mode and World mode must use separate assumptions.",
      "China mode only contains Chinese street-view rounds; force the answer into China and focus on province/city/region.",
      "World mode excludes mainland China; never answer mainland China even when Chinese text appears.",
      "Prefer hard clues before vibes: readable text, administrative names, phone/area codes, road numbers, license plates, taxi liveries, bollards, road signs, street-view car/camera, utility poles.",
      "Use natural clues after hard clues: terrain, vegetation, climate, snow, coastline, urban density, architecture, road surface, lane markings, guardrails.",
      "For China, explicitly check plates/province abbreviations, fixed phone area codes, taxi and bus liveries, road and street-name signs, terrain/vegetation belts, architecture, and street-view car generations.",
      "For world rounds, explicitly check Plonk It country pages, regional guessing guides, easy-confusion docs, pole meta, special car meta, vegetation/climate, language/script, and phone-code docs.",
      "When countries are commonly confused, compare them side by side and name the clue that separates them. Important sets include Mexico/Spain/Greece/Turkey, Southeast Asia, Senegal/Nigeria/Kenya, and Colombia/Ecuador/Peru.",
      "If the best guess is weak, return lower confidence and include alternatives plus what clue would disambiguate next.",
      "Use Chinese for explanations, evidence, alternatives, location labels, and direction fields. Keep country as English canonical name for coverage matching."
    ],
    promptReference: [
      "图寻文档摘要：251 篇左右，覆盖中国模式教程、世界模式国家教程、区域猜测进阶、易混国家、特殊街景车、电线杆 meta、出租车/区号/车牌、植被气候、语言文字、电话区号和平台规则。",
      "中国资料重点：图寻中国入门、匹配入门、中国固定电话区号、中国出租车大全、全国主要城市出租车，以及天津/山西/内蒙古/吉林/广西/云南/新疆/河北/上海/福建/重庆/海南/甘孜/西藏/香港等精选省市教程。",
      "世界资料重点：Plonk It 国家页覆盖非洲、亚洲、欧洲、北美、大洋洲、南美，并另有意大利、土耳其、菲律宾、南非、俄罗斯、墨西哥、新西兰、玻利维亚、智利、秘鲁、美国、印尼、阿根廷、加拿大等区域猜测进阶文档。",
      "Meta 资料重点：各洲电线杆 meta 汇总、菲律宾电线杆贴纸、特殊街景车进阶、基础特殊街景车、水箱教程、国家电话区号、语言文字/婆罗米/拉丁字母、全球/中国/欧洲/印尼/新西兰植被与棕榈。",
      "判题顺序：硬文字/号码/道路/车牌/出租车 > 覆盖与街景车/相机/电线杆 > 道路设施/标线/护栏/路牌 > 植被气候地形建筑 > 易混国家对照与区域细分。"
    ],
    importantDocs
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[tuxun] Wrote ${outputPath} (${importantDocs.length} focused docs)`);
}

main();
