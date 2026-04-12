const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourcePath = path.join(root, "data", "plonkit-guide.json");
const outPath = path.join(root, "data", "coverage-and-generations.json");

const generationAliasMap = new Map([
  ["united states of america", ["united states", "usa", "us"]],
  ["south korea", ["republic of korea", "korea", "rok"]],
  ["north korea", ["democratic people's republic of korea", "dprk"]],
  ["czechia", ["czech republic"]],
  ["turkey", ["türkiye", "turkiye"]],
  ["russia", ["russian federation"]]
]);

function cleanText(value) {
  return String(value || "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function extractGenerations(country) {
  const generations = new Set();
  const notes = [];
  const chunks = [country.summary, ...(country.highlights || [])];

  for (const chunk of chunks) {
    const text = cleanText(chunk);
    if (!text) continue;

    const matches = [...text.matchAll(/(?:Generation|Gen)\s*([234])/gi)];
    if (!matches.length) continue;

    for (const match of matches) {
      generations.add(`G${match[1]}`);
    }

    if (notes.length < 4) {
      notes.push(text.length > 240 ? `${text.slice(0, 237)}...` : text);
    }
  }

  return {
    generations: [...generations].sort(),
    notes
  };
}

function buildAliases(country) {
  const aliases = new Set([country.title, country.code].filter(Boolean));
  const extra = generationAliasMap.get(normalizeKey(country.title)) || [];
  for (const item of extra) aliases.add(item);
  return [...aliases].filter(Boolean);
}

function main() {
  const raw = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const countries = Array.isArray(raw.countries) ? raw.countries : [];

  const playablePlaces = countries
    .map((country) => {
      const generation = extractGenerations(country);
      return {
        title: country.title,
        slug: country.slug,
        code: country.code || "",
        cat: Array.isArray(country.cat) ? country.cat : [],
        aliases: buildAliases(country),
        playable: true,
        continent: Array.isArray(country.cat) && country.cat.length ? country.cat[0] : "",
        signalTags: Array.isArray(country.signalTags) ? country.signalTags : [],
        localities: Array.isArray(country.localities) ? country.localities : [],
        generations: generation.generations,
        generationNotes: generation.notes,
        summary: country.summary || "",
        highlights: Array.isArray(country.highlights) ? country.highlights.slice(0, 8) : []
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, "en"));

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: "https://www.plonkit.net/guide",
    playablePolicy: "Any country or region not listed in playablePlaces should be treated as not playable.",
    playablePlaces
  };

  fs.writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath} with ${playablePlaces.length} playable places`);
}

main();
