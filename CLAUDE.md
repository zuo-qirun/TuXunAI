# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```
npm start              # Start the local AI server on http://localhost:4173
npm run deploy          # Deploy to remote server via SSH tar pipe
npm run deploy:watch    # Auto-deploy on file changes (3s debounce)
npm run crawl:guide     # Crawl plonkit.net to rebuild data/plonkit-guide.json
npm run build:coverage  # Extract coverage/generation data from plonkit guide
```

No test suite or lint step exists. `node -c server.js` checks syntax only.

## Architecture

This is a GeoGuessr practice assistant. A central Node.js server (`server.js`, port 4173) accepts screenshots via `POST /api/analyze`, calls a vision model (OpenAI/NewAPI or Ollama), and returns structured JSON with tags, place guess, and evidence. Two frontends consume this endpoint:

- **Web app**: `index.html` loads `src/app.js`. Does pixel-level canvas analysis client-side (sky%, vegetation%, road colors), renders clickable clue tags from the knowledge base, scores countries against selected tags, and sends screenshots to `/api/analyze` for AI vision analysis.
- **Chrome extension**: `extension/popup.js` captures the active tab via `chrome.tabs.captureVisibleTab()`, optionally simulates drags via `chrome.debugger` for multi-frame burst, and POSTs screenshots to the same `/api/analyze`. The server URL is configurable and stored in `localStorage`.

The server stores no state between requests. It is a pure proxy that builds prompts, calls upstream AI, and normalizes results.

## Knowledge base (data/knowledge-base.json)

The single source of truth for all location clues. Contains five sections:
- **groups** — Clue categories (drive, road-marking, plates, script, signs, streetview, poles, environment, infrastructure) with tag IDs, labels, and weights.
- **textHints** — Text patterns that infer tags (e.g., `.jp` → `kana`).
- **frameRules** — Pixel-percentage thresholds that infer tags client-side.
- **nextChecks** — Contextual "what to check next" suggestions keyed by tag.
- **profiles** — Country profiles with associated tags, notes, and boost combinations.

The data pipeline: `build-plonkit-guide.js` → `plonkit-guide.json` → `enrich-knowledge-base.js` merges into `knowledge-base.json`. Always edit `knowledge-base.json` for judgment rules; the scripts are for data ingestion.

## Prompt engineering (server.js)

The server builds AI prompts by injecting the knowledge base into a structured reference text (`buildKnowledgeBaseReference`): tag descriptions, text hint rules, and country profiles with notes. This reference is included in all prompts.

**OpenAI/NewAPI flow**: First pass (`analysisPrompt`) → returns tags/summary/candidates with JSON schema enforcement → `buildGuideContext` scores `plonkit-guide.json` countries against the analysis → second pass (`buildPlaceGuessPrompt` with optional guide context) → structured place guess via `guessPlaceWithOpenAi`.

**Ollama flow**: First pass (same `analysisPrompt`) → `buildGuideContext` scores guide countries → second pass (`buildGuidePrompt`) includes full guide snippets for top matches → `guessPlaceWithGuide`.

The `analysisPrompt` function has a fast-path for `moondream` that only says "Describe this image."

## Configuration

`.env` at the repo root sets `VISION_PROVIDER`, `NEWAPI_BASE_URL`, `NEWAPI_API_KEY`, `VISION_MODEL`, `PORT`, `OLLAMA_HOST`. The server reads it via a custom `loadDotEnv()` parser (no `dotenv` dependency). Provider defaults to `"newapi"` when OpenAI/NewAPI credentials exist, otherwise `"ollama"`.

## Deployment (scripts/deploy.js)

Targets `tuxunai.zuoqirun.top` via SSH. Creates a local tar (excluding `.git`, `node_modules`, `.env`, `.claude`, `pem`, `dist`, `*.log`, `test.png`), pipes it through SSH, extracts on the remote under `/www/wwwroot/tuxunai`, then runs `pm2 restart`. Watch mode uses `fs.watch` with a 3-second debounce.
