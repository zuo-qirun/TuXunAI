const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const guideUrl = "https://www.plonkit.net/guide";
const outPath = path.join(root, "data", "plonkit-guide.json");
const requestDelayMs = Number(process.env.PLOINKIT_DELAY_MS || 2200);
const maxRetries = Number(process.env.PLOINKIT_RETRIES || 4);
const forceRefresh = process.env.PLOINKIT_FORCE === "1";

const signalRules = [
  { tag: "drive-left", words: ["drives on the left", "left hand side", "left-hand traffic", "left side of the road", "left side driving"] },
  { tag: "drive-right", words: ["drives on the right", "right hand side", "right-hand traffic", "right side of the road", "right side driving"] },
  { tag: "low-cam", words: ["low-cam", "lower to the ground", "road will look wider", "lower perspective"] },
  { tag: "plate-white-long", words: ["short white licence plate", "white licence plate", "white plate", "white text", "short white"] },
  { tag: "plate-yellow", words: ["yellow version", "yellow plate", "yellow licence plate", "yellow text"] },
  { tag: "plate-black", words: ["black plate", "black text", "black licence plate"] },
  { tag: "plate-eu", words: ["european union", "blue strip", "eu", "european style"] },
  { tag: "yellow-center", words: ["yellow line", "yellow middle line", "yellow outside road lines", "yellow road line"] },
  { tag: "white-center", words: ["white line", "white middle line", "white road lines", "white sidelines"] },
  { tag: "red-shoulder", words: ["red soil", "red shoulder", "laterite", "red dirt"] },
  { tag: "snow-road", words: ["snow", "winter", "snow coverage", "snow poles", "snow prevention"] },
  { tag: "desert-road", words: ["desert", "arid", "dry", "barren", "dry environment"] },
  { tag: "concrete-pole", words: ["concrete pole", "round concrete", "utility poles", "electric poles"] },
  { tag: "wood-pole", words: ["wooden pole", "wood pole"] },
  { tag: "striped-bollard", words: ["bollard", "reflector", "striped bollard"] },
  { tag: "many-wires", words: ["guy wires", "wires", "cables", "transformer"] },
  { tag: "tropical", words: ["tropical", "palm", "jungle", "rainforest", "sugarcane", "banana"] },
  { tag: "temperate", words: ["forest", "trees", "wooded", "shrubs", "birch", "temperate"] },
  { tag: "mediterranean", words: ["mediterranean", "olive", "cypress"] },
  { tag: "nordic", words: ["nordic", "boreal", "arctic", "north", "snowfall", "cold"] },
  { tag: "mountain", words: ["mountain", "mountainous", "hills", "slope", "elevation"] },
  { tag: "flat", words: ["flat", "plains", "plain"] },
  { tag: "urban-dense", words: ["city", "urban", "downtown", "high-rise", "dense city", "large cities"] },
  { tag: "rural", words: ["rural", "village", "country house", "country houses", "towns or villages", "countryside"] },
  { tag: "us-sign", words: ["interstate", "county road", "road shield", "route shield", "mph", "highway shield"] },
  { tag: "eu-sign", words: ["directional sign", "intersection sign", "eu", "european", "road number"] },
  { tag: "blue-motorway", words: ["blue motorway", "blue highway", "blue sign"] },
  { tag: "green-highway", words: ["green highway", "green sign"] },
  { tag: "bilingual-sign", words: ["bilingual", "two languages", "english and", "double language"] },
  { tag: "kana", words: ["hiragana", "katakana", "kanji", "japanese"] },
  { tag: "hangul", words: ["hangul", "korean"] },
  { tag: "chinese", words: ["chinese", "mandarin", "traditional chinese", "simplified chinese"] },
  { tag: "thai", words: ["thai"] },
  { tag: "khmer", words: ["khmer"] },
  { tag: "arabic", words: ["arabic"] },
  { tag: "cyrillic", words: ["cyrillic"] },
  { tag: "devanagari", words: ["devanagari"] },
  { tag: "greek", words: ["greek"] }
];

function cleanText(value) {
  return String(value || "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractPreloadedData(html) {
  const match = html.match(/<script id="__PRELOADED_DATA__" type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
  if (!match) throw new Error("Could not find preloaded data");
  return JSON.parse(match[1]);
}

function collectTextNodes(node, sectionStack = [], out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectTextNodes(item, sectionStack, out);
    return out;
  }

  if (!node || typeof node !== "object") return out;

  const nextStack = node.title ? [...sectionStack, cleanText(node.title)] : sectionStack;

  if (node.kind === "tip" && node.data) {
    const lines = [];
    if (Array.isArray(node.data.text)) lines.push(...node.data.text);
    if (typeof node.data.text === "string") lines.push(node.data.text);
    const snippet = cleanText(lines.join(" "));
    if (snippet) {
      out.push({
        section: nextStack.join(" / "),
        text: snippet
      });
    }
  }

  if (node.kind === "map" && Array.isArray(node.text)) {
    const snippet = cleanText(node.text.join(" "));
    if (snippet) {
      out.push({
        section: nextStack.join(" / "),
        text: snippet
      });
    }
  }

  if (Array.isArray(node.items)) {
    collectTextNodes(node.items, nextStack, out);
  }

  if (Array.isArray(node.steps)) {
    collectTextNodes(node.steps, nextStack, out);
  }

  return out;
}

function inferSignals(text) {
  const lower = String(text || "").toLowerCase();
  const signals = new Set();
  for (const rule of signalRules) {
    if (rule.words.some((word) => lower.includes(word))) signals.add(rule.tag);
  }
  return signals;
}

function extractLocalities(text) {
  const source = String(text || "");
  const matches = new Set();
  const stopwords = new Set([
    "this",
    "that",
    "these",
    "those",
    "both",
    "note",
    "notes",
    "look",
    "lookout",
    "temperate",
    "tropical",
    "rural",
    "urban",
    "forest",
    "country",
    "countries",
    "city",
    "region",
    "island",
    "guide"
  ]);
  const patterns = [
    /(?:city of|town of|village of|prefecture of|region of|island of|exclusive to|unique to|common in|found in|most commonly found in|especially common in)\s+([A-Z][A-Za-z'&-]*(?:\s+[A-Z][A-Za-z'&-]*){0,3})/g,
    /\b([A-Z][A-Za-z'&-]*(?:\s+[A-Z][A-Za-z'&-]*){0,3})\s+(?:prefecture|city|region|island)\b/g
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const value = cleanText(match[1]);
      if (!value || value.length < 3) continue;
      if (/[.,/()]/.test(value)) continue;
      const pieces = value.split(/\s+/);
      if (pieces.some((piece) => stopwords.has(piece.toLowerCase()))) continue;
      if (pieces.length > 4) continue;
      matches.add(value);
    }
  }

  return [...matches].slice(0, 24);
}

function createSummary(country, highlights, signalTags) {
  const notable = [...signalTags].slice(0, 6).join(", ");
  const first = highlights[0] ? ` ${highlights[0]}` : "";
  return cleanText(`${country.title}: ${notable}.${first}`).slice(0, 280);
}

function pickHighlights(entries) {
  const highlights = [];
  for (const entry of entries) {
    const text = cleanText(entry.text);
    if (!text) continue;
    if (text.length < 18) continue;
    if (highlights.includes(text)) continue;
    highlights.push(text);
    if (highlights.length >= 40) break;
  }
  return highlights;
}

async function fetchHtml(url) {
  let attempt = 0;
  while (true) {
    const response = await fetch(url, {
      headers: {
        "user-agent": "CodexPlonkitCrawler/1.0",
        accept: "text/html,application/xhtml+xml"
      }
    });
    if (response.ok) return response.text();

    const status = response.status;
    const retryAfter = Number(response.headers.get("retry-after") || 0);
    const shouldRetry = status === 429 || status >= 500;
    if (!shouldRetry || attempt >= maxRetries) {
      throw new Error(`Failed to fetch ${url}: ${status}`);
    }

    const delayMs = retryAfter
      ? retryAfter * 1000
      : Math.min(12000, 1000 * Math.pow(2, attempt + 1));
    await sleep(delayMs + 250);
    attempt += 1;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const guideHtml = await fetchHtml(guideUrl);
  const guideData = extractPreloadedData(guideHtml);
  const entries = Array.isArray(guideData.data) ? guideData.data : [];
  const countries = entries.filter((item) => item && item.slug && !String(item.slug).startsWith("maps") && item.cat && !item.cat.includes("General Guide"));
  const generalPages = entries.filter((item) => item && item.slug && item.cat && item.cat.includes("General Guide"));

  const existingBySlug = new Map();
  if (!forceRefresh && fs.existsSync(outPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
      for (const item of existing.countries || []) {
        if (item && item.slug) existingBySlug.set(item.slug, item);
      }
    } catch {
      // Ignore stale or partial cache.
    }
  }

  const results = [];
  const failures = [];
  for (const entry of countries) {
    if (!forceRefresh && existingBySlug.has(entry.slug)) {
      results.push(existingBySlug.get(entry.slug));
      process.stdout.write(`Skipped ${entry.slug} (cached)\n`);
      await sleep(requestDelayMs);
      continue;
    }

    try {
      const pageHtml = await fetchHtml(`https://www.plonkit.net/${entry.slug}`);
      const pageData = extractPreloadedData(pageHtml);
      const publicData = pageData.data?.public || {};
      const steps = Array.isArray(publicData.steps) ? publicData.steps : [];
      const nodes = collectTextNodes(steps);
      const highlights = pickHighlights(nodes);
      const signalTags = new Set();
      for (const item of nodes) {
        for (const tag of inferSignals(item.text)) signalTags.add(tag);
      }
      const searchableText = cleanText(nodes.map((item) => item.text).join(" "));
      const localities = extractLocalities(searchableText);

      results.push({
        title: entry.title,
        slug: entry.slug,
        code: entry.code || "",
        cat: entry.cat || [],
        updatedAt: entry.updatedAt || publicData.updatedAt || "",
        summary: createSummary(entry, highlights, signalTags),
        signalTags: [...signalTags].sort(),
        localities,
        highlights,
        searchableText
      });

      process.stdout.write(`Fetched ${entry.slug}\n`);
    } catch (error) {
      failures.push({ slug: entry.slug, title: entry.title, error: error.message });
      process.stdout.write(`Failed ${entry.slug}: ${error.message}\n`);
    } finally {
      await sleep(requestDelayMs);
    }

    if ((results.length + failures.length) % 5 === 0) {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(
        outPath,
        `${JSON.stringify(
          {
            version: 1,
            generatedAt: new Date().toISOString(),
            source: guideUrl,
            guideCount: results.length,
            generalPages,
            failures,
            countries: results
          },
          null,
          2
        )}\n`,
        "utf8"
      );
    }
  }

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: guideUrl,
    guideCount: results.length,
    generalPages,
    failures,
    countries: results
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
