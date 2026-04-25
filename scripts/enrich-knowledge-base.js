const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const plonkitPath = path.join(root, "data", "plonkit-guide.json");
const knowledgePath = path.join(root, "data", "knowledge-base.json");

// English → Chinese country name mapping
const countryCN = {
  "United States of America": "美国",
  Canada: "加拿大",
  Mexico: "墨西哥",
  Japan: "日本",
  "South Korea": "韩国",
  "North Korea": "朝鲜",
  China: "中国大陆",
  Taiwan: "台湾",
  "Hong Kong": "香港",
  Macau: "澳门",
  Mongolia: "蒙古",
  Singapore: "新加坡",
  Malaysia: "马来西亚",
  Indonesia: "印度尼西亚",
  Thailand: "泰国",
  Cambodia: "柬埔寨",
  Philippines: "菲律宾",
  Vietnam: "越南",
  Laos: "老挝",
  Myanmar: "缅甸",
  India: "印度",
  Pakistan: "巴基斯坦",
  Bangladesh: "孟加拉国",
  "Sri Lanka": "斯里兰卡",
  Nepal: "尼泊尔",
  Bhutan: "不丹",
  "United Arab Emirates": "阿联酋",
  Qatar: "卡塔尔",
  Oman: "阿曼",
  Jordan: "约旦",
  Lebanon: "黎巴嫩",
  "Israel & the West Bank": "以色列/巴勒斯坦",
  Iraq: "伊拉克",
  Kuwait: "科威特",
  Kazakhstan: "哈萨克斯坦",
  Kyrgyzstan: "吉尔吉斯斯坦",
  Turkey: "土耳其",
  "United Kingdom": "英国",
  Ireland: "爱尔兰",
  France: "法国",
  Germany: "德国",
  Italy: "意大利",
  Spain: "西班牙",
  Netherlands: "荷兰",
  Poland: "波兰",
  Norway: "挪威",
  Sweden: "瑞典",
  Finland: "芬兰",
  Denmark: "丹麦",
  Iceland: "冰岛",
  Russia: "俄罗斯",
  Ukraine: "乌克兰",
  Belarus: "白俄罗斯",
  Estonia: "爱沙尼亚",
  Latvia: "拉脱维亚",
  Lithuania: "立陶宛",
  Czechia: "捷克",
  Slovakia: "斯洛伐克",
  Hungary: "匈牙利",
  Romania: "罗马尼亚",
  Bulgaria: "保加利亚",
  Serbia: "塞尔维亚",
  Croatia: "克罗地亚",
  Slovenia: "斯洛文尼亚",
  Montenegro: "黑山",
  "North Macedonia": "北马其顿",
  Albania: "阿尔巴尼亚",
  Greece: "希腊",
  Cyprus: "塞浦路斯",
  Malta: "马耳他",
  Austria: "奥地利",
  Switzerland: "瑞士",
  Belgium: "比利时",
  Luxembourg: "卢森堡",
  Portugal: "葡萄牙",
  Andorra: "安道尔",
  Monaco: "摩纳哥",
  "San Marino": "圣马力诺",
  Liechtenstein: "列支敦士登",
  Gibraltar: "直布罗陀",
  "Isle of Man": "马恩岛",
  Jersey: "泽西岛",
  "Faroe Islands": "法罗群岛",
  Svalbard: "斯瓦尔巴",
  Azores: "亚速尔群岛",
  Madeira: "马德拉",
  Brazil: "巴西",
  Argentina: "阿根廷",
  Chile: "智利",
  Peru: "秘鲁",
  Colombia: "哥伦比亚",
  Ecuador: "厄瓜多尔",
  Bolivia: "玻利维亚",
  Uruguay: "乌拉圭",
  "Costa Rica": "哥斯达黎加",
  Panama: "巴拿马",
  Guatemala: "危地马拉",
  "Dominican Republic": "多米尼加",
  "Puerto Rico": "波多黎各",
  "US Virgin Islands": "美属维尔京群岛",
  Bermuda: "百慕大",
  "Martinique": "马提尼克",
  "Curaçao": "库拉索",
  "Falkland Islands": "福克兰群岛",
  Greenland: "格陵兰",
  "South Africa": "南非",
  Nigeria: "尼日利亚",
  Kenya: "肯尼亚",
  Ghana: "加纳",
  Senegal: "塞内加尔",
  Tunisia: "突尼斯",
  Egypt: "埃及",
  Botswana: "博茨瓦纳",
  Namibia: "纳米比亚",
  Lesotho: "莱索托",
  Eswatini: "斯威士兰",
  Madagascar: "马达加斯加",
  Tanzania: "坦桑尼亚",
  Uganda: "乌干达",
  Rwanda: "卢旺达",
  Mali: "马里",
  Reunion: "留尼汪",
  "São Tomé and Príncipe": "圣多美和普林西比",
  Australia: "澳大利亚",
  "New Zealand": "新西兰",
  Guam: "关岛",
  "Northern Mariana Islands": "北马里亚纳群岛",
  "American Samoa": "美属萨摩亚",
  Vanuatu: "瓦努阿图",
  "Christmas Island": "圣诞岛",
  "Cocos Islands": "科科斯群岛",
  "Pitcairn Islands": "皮特凯恩群岛",
  Hawaii: "夏威夷",
  Alaska: "阿拉斯加",
  Antarctica: "南极洲",
  "Saint Pierre and Miquelon": "圣皮埃尔和密克隆",
  "US Minor Outlying Islands": "美国本土外小岛屿",
  "British Indian Ocean Territory": "英属印度洋领地",
  "South Georgia & Sandwich Islands": "南乔治亚和南桑威奇群岛",
};

// Category → Chinese region mapping
const regionMap = {
  "North America": "北美",
  "South America": "南美",
  Europe: "欧洲",
  Asia: "亚洲",
  Africa: "非洲",
  Oceania: "大洋洲",
  Antarctica: "南极洲",
};

// Tag priority categories for boost generation
const tagBoostPairs = [
  ["drive-left", "latin"],
  ["drive-left", "kana"],
  ["drive-left", "plate-yellow"],
  ["drive-left", "plate-black"],
  ["cyrillic", "snow-road"],
  ["cyrillic", "wood-pole"],
  ["kana", "concrete-pole"],
  ["hangul", "concrete-pole"],
  ["chinese", "plate-blue"],
  ["chinese", "plate-green"],
  ["thai", "tropical"],
  ["khmer", "tropical"],
  ["arabic", "desert-road"],
  ["devanagari", "many-wires"],
  ["devanagari", "drive-left"],
  ["greek", "mediterranean"],
  ["plate-yellow", "drive-left"],
  ["yellow-center", "us-sign"],
  ["yellow-center", "drive-left"],
  ["bilingual-sign", "nordic"],
  ["yellow-center", "wide-road"],
];

function cleanText(value) {
  return String(value || "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function pickNote(highlights) {
  if (!Array.isArray(highlights) || !highlights.length) return "";
  // Pick the shortest highlight that is long enough
  const candidates = highlights
    .map((h) => cleanText(h))
    .filter((t) => t.length >= 15 && t.length <= 200);
  if (!candidates.length) return cleanText(highlights[0] || "").slice(0, 200);
  // Prefer ones without NOTE: prefix
  const noNote = candidates.filter((t) => !t.toUpperCase().startsWith("NOTE"));
  const pool = noNote.length ? noNote : candidates;
  pool.sort((a, b) => a.length - b.length);
  return pool[0];
}

function generateBoosts(tags) {
  const boosts = [];
  for (const [t1, t2] of tagBoostPairs) {
    if (tags.includes(t1) && tags.includes(t2)) {
      const tagNames = {
        "drive-left": "左行",
        "drive-right": "右行",
        kana: "日文假名",
        hangul: "韩文",
        chinese: "中文",
        thai: "泰文",
        khmer: "高棉文",
        arabic: "阿拉伯文",
        cyrillic: "西里尔字母",
        devanagari: "天城文",
        greek: "希腊文",
        latin: "拉丁字母",
        "plate-yellow": "黄牌",
        "plate-black": "黑牌",
        "plate-blue": "蓝牌",
        "plate-green": "绿牌",
        "plate-white-long": "白底长牌",
        "concrete-pole": "混凝土杆",
        "wood-pole": "木杆",
        "desert-road": "荒漠道路",
        "snow-road": "雪地道路",
        tropical: "热带",
        mediterranean: "地中海感",
        nordic: "北欧/寒带",
        "yellow-center": "黄中线",
        "us-sign": "美式路牌",
        "bilingual-sign": "双语路牌",
        "many-wires": "密集线缆",
        "wide-road": "宽路",
      };
      const r1 = tagNames[t1] || t1;
      const r2 = tagNames[t2] || t2;
      boosts.push({ tags: [t1, t2], weight: 1.2, reason: `${r1} + ${r2}` });
    }
  }
  return boosts.slice(0, 5);
}

function main() {
  if (!fs.existsSync(plonkitPath)) {
    console.error("plonkit-guide.json not found. Run npm run crawl:guide first.");
    process.exit(1);
  }

  const guide = JSON.parse(fs.readFileSync(plonkitPath, "utf8"));
  const knowledge = JSON.parse(fs.readFileSync(knowledgePath, "utf8"));

  // Build set of existing country names for dedup
  const existingNames = new Set(knowledge.profiles.map((p) => p.country));
  const existingByCN = new Map();
  for (const p of knowledge.profiles) {
    existingByCN.set(p.country, p);
  }

  // Collect all valid tags from groups
  const validTags = new Set();
  for (const group of knowledge.groups) {
    for (const opt of group.options) {
      validTags.add(opt.id);
    }
  }

  let added = 0;
  let enriched = 0;

  for (const country of guide.countries) {
    const cnName = countryCN[country.title];
    if (!cnName) {
      console.log(`Skip (no CN name): ${country.title}`);
      continue;
    }

    // Filter signalTags to only valid knowledge-base tags
    const filteredTags = (country.signalTags || []).filter((t) =>
      validTags.has(t)
    );
    if (filteredTags.length === 0) {
      console.log(`Skip (no valid tags): ${country.title}`);
      continue;
    }

    // Determine region
    const cat = Array.isArray(country.cat) ? country.cat[0] : "";
    const region = regionMap[cat] || cat || "";

    const note = pickNote(country.highlights);
    const boosts = generateBoosts(filteredTags);

    if (existingNames.has(cnName)) {
      // Enrich existing profile
      const existing = existingByCN.get(cnName);
      const existingTags = new Set(existing.tags || []);
      let tagAdded = false;
      for (const t of filteredTags) {
        if (!existingTags.has(t)) {
          existing.tags.push(t);
          tagAdded = true;
        }
      }
      // Only add note if existing doesn't have one from plonkit
      if (!existing.noteSource || existing.noteSource !== "plonkit") {
        if (note && (!existing.notes || existing.notes.length < 120)) {
          existing.notes = note;
          existing.noteSource = "plonkit";
        }
      }
      // Merge boosts
      if (!existing.boosts) existing.boosts = [];
      const existingBoostKeys = new Set(
        existing.boosts.map((b) => (b.tags || []).sort().join("+"))
      );
      for (const boost of boosts) {
        const key = [...boost.tags].sort().join("+");
        if (!existingBoostKeys.has(key)) {
          existing.boosts.push(boost);
        }
      }
      if (tagAdded || boosts.length) {
        enriched++;
        console.log(`Enriched: ${cnName}`);
      }
    } else {
      // Create new profile
      const profile = {
        country: cnName,
        region,
        tags: filteredTags,
        notes: note,
        noteSource: "plonkit",
      };
      if (boosts.length) profile.boosts = boosts;

      knowledge.profiles.push(profile);
      existingNames.add(cnName);
      existingByCN.set(cnName, profile);
      added++;
      console.log(`Added: ${cnName} (${region})`);
    }
  }

  // Sort profiles by region then country
  knowledge.profiles.sort((a, b) => {
    const r = (a.region || "").localeCompare(b.region || "", "zh");
    if (r !== 0) return r;
    return a.country.localeCompare(b.country, "zh");
  });

  fs.writeFileSync(knowledgePath, JSON.stringify(knowledge, null, 2) + "\n", "utf8");
  console.log(
    `\nDone: ${added} new profiles added, ${enriched} existing profiles enriched.`
  );
}

main();
