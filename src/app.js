(function () {
  const fallbackKnowledge = window.TUXUN_KNOWLEDGE || {
    groups: [],
    profiles: [],
    textHints: [],
    frameRules: [],
    nextChecks: []
  };

  let groups = [];
  let profiles = [];
  let textHints = [];
  let frameRules = [];
  let nextChecks = [];
  let optionIndex = new Map();

  const state = {
    selected: new Set(),
    text: "",
    notes: "",
    frameSignals: new Map(),
    autoSignals: new Map(),
    autoFindings: [],
    cityFindings: [],
    placeGuess: null,
    lastVisionAt: 0,
    visionInFlight: false,
    visionAvailable: false,
    visionProvider: "",
    visionMode: "",
    visionModel: "",
    visionMessage: "",
    visionMaxWidth: 640,
    stream: null,
    timer: null
  };

  const placeMetaFallbacks = new Map([
    ["Russia", { countryZh: "俄罗斯", continent: "亚洲 / 欧洲" }],
    ["Finland", { countryZh: "芬兰", continent: "欧洲" }],
    ["Sweden", { countryZh: "瑞典", continent: "欧洲" }],
    ["Norway", { countryZh: "挪威", continent: "欧洲" }],
    ["Denmark", { countryZh: "丹麦", continent: "欧洲" }],
    ["Iceland", { countryZh: "冰岛", continent: "欧洲" }],
    ["Estonia", { countryZh: "爱沙尼亚", continent: "欧洲" }],
    ["Latvia", { countryZh: "拉脱维亚", continent: "欧洲" }],
    ["Lithuania", { countryZh: "立陶宛", continent: "欧洲" }],
    ["Poland", { countryZh: "波兰", continent: "欧洲" }],
    ["Germany", { countryZh: "德国", continent: "欧洲" }],
    ["France", { countryZh: "法国", continent: "欧洲" }],
    ["Spain", { countryZh: "西班牙", continent: "欧洲" }],
    ["Portugal", { countryZh: "葡萄牙", continent: "欧洲" }],
    ["Italy", { countryZh: "意大利", continent: "欧洲" }],
    ["Netherlands", { countryZh: "荷兰", continent: "欧洲" }],
    ["Belgium", { countryZh: "比利时", continent: "欧洲" }],
    ["Switzerland", { countryZh: "瑞士", continent: "欧洲" }],
    ["Austria", { countryZh: "奥地利", continent: "欧洲" }],
    ["Czechia", { countryZh: "捷克", continent: "欧洲" }],
    ["Slovakia", { countryZh: "斯洛伐克", continent: "欧洲" }],
    ["Hungary", { countryZh: "匈牙利", continent: "欧洲" }],
    ["Romania", { countryZh: "罗马尼亚", continent: "欧洲" }],
    ["Bulgaria", { countryZh: "保加利亚", continent: "欧洲" }],
    ["Serbia", { countryZh: "塞尔维亚", continent: "欧洲" }],
    ["Croatia", { countryZh: "克罗地亚", continent: "欧洲" }],
    ["Slovenia", { countryZh: "斯洛文尼亚", continent: "欧洲" }],
    ["Greece", { countryZh: "希腊", continent: "欧洲" }],
    ["Turkey", { countryZh: "土耳其", continent: "亚洲 / 欧洲" }],
    ["Ukraine", { countryZh: "乌克兰", continent: "欧洲" }],
    ["Belarus", { countryZh: "白俄罗斯", continent: "欧洲" }],
    ["Georgia", { countryZh: "格鲁吉亚", continent: "亚洲 / 欧洲" }],
    ["Armenia", { countryZh: "亚美尼亚", continent: "亚洲 / 欧洲" }],
    ["Azerbaijan", { countryZh: "阿塞拜疆", continent: "亚洲 / 欧洲" }],
    ["Kazakhstan", { countryZh: "哈萨克斯坦", continent: "亚洲 / 欧洲" }],
    ["China", { countryZh: "中国", continent: "亚洲" }],
    ["Japan", { countryZh: "日本", continent: "亚洲" }],
    ["South Korea", { countryZh: "韩国", continent: "亚洲" }],
    ["North Korea", { countryZh: "朝鲜", continent: "亚洲" }],
    ["Mongolia", { countryZh: "蒙古", continent: "亚洲" }],
    ["India", { countryZh: "印度", continent: "亚洲" }],
    ["Thailand", { countryZh: "泰国", continent: "亚洲" }],
    ["Vietnam", { countryZh: "越南", continent: "亚洲" }],
    ["Malaysia", { countryZh: "马来西亚", continent: "亚洲" }],
    ["Singapore", { countryZh: "新加坡", continent: "亚洲" }],
    ["Indonesia", { countryZh: "印度尼西亚", continent: "亚洲" }],
    ["Australia", { countryZh: "澳大利亚", continent: "大洋洲" }],
    ["New Zealand", { countryZh: "新西兰", continent: "大洋洲" }],
    ["Canada", { countryZh: "加拿大", continent: "北美洲" }],
    ["United States", { countryZh: "美国", continent: "北美洲" }],
    ["Brazil", { countryZh: "巴西", continent: "南美洲" }],
    ["Argentina", { countryZh: "阿根廷", continent: "南美洲" }],
    ["Chile", { countryZh: "智利", continent: "南美洲" }],
    ["South Africa", { countryZh: "南非", continent: "非洲" }],
    ["Morocco", { countryZh: "摩洛哥", continent: "非洲" }],
    ["Egypt", { countryZh: "埃及", continent: "非洲" }],
    ["Israel", { countryZh: "以色列", continent: "亚洲" }],
    ["Saudi Arabia", { countryZh: "沙特阿拉伯", continent: "亚洲" }]
  ]);

  const els = {
    clueGrid: document.querySelector("#clueGrid"),
    candidateList: document.querySelector("#candidateList"),
    placeGuess: document.querySelector("#placeGuess"),
    cityList: document.querySelector("#cityList"),
    nextChecks: document.querySelector("#nextChecks"),
    textClues: document.querySelector("#textClues"),
    freeNotes: document.querySelector("#freeNotes"),
    startCapture: document.querySelector("#startCapture"),
    stopCapture: document.querySelector("#stopCapture"),
    clearFrame: document.querySelector("#clearFrame"),
    resetSignals: document.querySelector("#resetSignals"),
    upload: document.querySelector("#imageUpload"),
    video: document.querySelector("#screenVideo"),
    canvas: document.querySelector("#frameCanvas"),
    dropHint: document.querySelector("#dropHint"),
    metrics: document.querySelector("#visualMetrics"),
    visionStatus: document.querySelector("#visionStatus"),
    autoClues: document.querySelector("#autoClues"),
    captureStatus: document.querySelector("#captureStatus"),
    analysisStatus: document.querySelector("#analysisStatus")
  };

  const ctx = els.canvas.getContext("2d", { willReadFrequently: true });

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function compileTextHint(hint) {
    if (!hint || typeof hint !== "object") return null;
    const phrases = Array.isArray(hint.phrases) ? hint.phrases.filter(Boolean) : [];
    let pattern = hint.pattern;
    if (!pattern && phrases.length) {
      pattern = new RegExp(phrases.map((item) => escapeRegExp(item)).join("|"), hint.flags || "i");
    } else if (typeof pattern === "string") {
      pattern = new RegExp(pattern, hint.flags || "i");
    } else if (!(pattern instanceof RegExp)) {
      return null;
    }
    return { ...hint, pattern };
  }

  function normalizeKnowledge(raw) {
    const source = raw && typeof raw === "object" ? raw : fallbackKnowledge;
    const normalizedGroups = Array.isArray(source.groups) ? source.groups : [];
    const normalizedProfiles = Array.isArray(source.profiles) ? source.profiles : [];
    const normalizedNextChecks = Array.isArray(source.nextChecks) ? source.nextChecks : [];
    const normalizedFrameRules = Array.isArray(source.frameRules) ? source.frameRules : [];
    const normalizedHints = Array.isArray(source.textHints) ? source.textHints : [];

    return {
      groups: normalizedGroups,
      profiles: normalizedProfiles,
      nextChecks: normalizedNextChecks,
      frameRules: normalizedFrameRules,
      textHints: normalizedHints.map(compileTextHint).filter(Boolean)
    };
  }

  function setKnowledge(raw) {
    const knowledge = normalizeKnowledge(raw);
    groups = knowledge.groups;
    profiles = knowledge.profiles;
    nextChecks = knowledge.nextChecks;
    frameRules = knowledge.frameRules;
    textHints = knowledge.textHints;

    optionIndex = new Map();
    for (const group of groups) {
      for (const option of group.options || []) {
        optionIndex.set(option.id, option);
      }
    }
  }

  async function loadKnowledge() {
    setKnowledge(fallbackKnowledge);
    try {
      const response = await fetch("./data/knowledge-base.json?v=20260412", { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load knowledge base (${response.status})`);
      const raw = await response.json();
      setKnowledge(raw);
    } catch (error) {
      console.warn("Falling back to bundled knowledge", error);
    }
    renderClues();
    updateChips();
    renderResults();
    renderAutoClues();
  }

  function findOption(tag) {
    return optionIndex.get(tag) || null;
  }

  function tagWeight(tag) {
    return Number(findOption(tag)?.weight) || defaultTagWeight(tag);
  }

  function defaultTagWeight(tag) {
    if (tag.startsWith("drive")) return 3.8;
    if (["kana", "hangul", "thai", "khmer", "cyrillic", "arabic", "chinese", "devanagari", "greek"].includes(tag)) return 3.4;
    if (tag.startsWith("plate")) return 2.6;
    if (["yellow-center", "white-center", "double-yellow", "red-shoulder", "snow-road", "desert-road", "no-marking", "paved-road", "gravel-road", "dirt-road"].includes(tag)) return 2.2;
    if (["us-sign", "eu-sign", "blue-motorway", "green-highway", "bilingual-sign", "town-blue", "km-marker", "red-white-chevron"].includes(tag)) return 1.8;
    if (["car-roof-rack", "car-antenna", "low-cam", "blur-heavy", "trekker", "motorcycle"].includes(tag)) return 1.5;
    if (["concrete-pole", "wood-pole", "metal-pole", "striped-bollard", "round-bollard", "double-pole", "many-wires", "single-wire", "transmission-tower"].includes(tag)) return 1.4;
    if (["tropical", "temperate", "mediterranean", "nordic", "mountain", "flat", "urban-dense", "suburban", "rural", "coastal", "arid", "snowy", "wetland", "forest"].includes(tag)) return 1.2;
    if (["guardrail", "narrow-road", "wide-road", "roundabout-heavy", "fenced-road", "service-road", "motorway", "bridge-road"].includes(tag)) return 1.0;
    return 1.0;
  }

  function renderClues() {
    if (!groups.length) {
      els.clueGrid.innerHTML = `
        <div class="candidate">
          <div class="candidate-title">
            <h3>知识库加载中</h3>
            <span class="score-chip">...</span>
          </div>
          <p class="reasons">正在读取外置知识库。</p>
        </div>
      `;
      return;
    }

    els.clueGrid.innerHTML = groups
      .map(
        (group) => `
          <div class="clue-group" data-group="${group.id}">
            <h3>${group.title}</h3>
            <div class="chips">
              ${group.options
                .map(
                  (option) => `
                    <button class="chip" type="button" data-group="${group.id}" data-id="${option.id}">
                      ${option.label}
                    </button>
                  `
                )
                .join("")}
            </div>
          </div>
        `
      )
      .join("");
  }

  function selectedTags() {
    const tags = new Map();
    for (const tag of state.selected) tags.set(tag, "手动线索");
    for (const [tag, reason] of state.autoSignals) tags.set(tag, reason);
    for (const [tag, reason] of state.frameSignals) {
      if (!tags.has(tag)) tags.set(tag, reason);
    }
    for (const hint of textHints) {
      if (hint.pattern.test(state.text)) tags.set(hint.tag, hint.reason);
    }
    return tags;
  }

  function scoreProfile(profile, tags) {
    const reasons = [];
    let score = 0;

    for (const [tag, reason] of tags) {
      const weight = tagWeight(tag);
      if (profile.tags.includes(tag)) {
        score += weight;
        reasons.push(`${reason}：匹配 ${labelFor(tag)}`);
      } else if (weight >= 2.1) {
        const penalty = Math.min(weight * 0.9, 3.6);
        score -= penalty;
        reasons.push(`${reason}：与 ${labelFor(tag)} 不符`);
      }
    }

    for (const boost of profile.boosts || []) {
      const boostTags = Array.isArray(boost.tags) ? boost.tags : [];
      if (boostTags.length && boostTags.every((tag) => tags.has(tag))) {
        score += Number(boost.weight) || 0;
        if (boost.reason) reasons.push(`组合加成：${boost.reason}`);
      }
    }

    score = Math.max(0, score);
    return { profile, score, reasons };
  }

  function labelFor(tag) {
    return findOption(tag)?.label || tag;
  }

  function renderResults() {
    const tags = selectedTags();
    const scored = profiles
      .map((profile) => scoreProfile(profile, tags))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    if (!scored.length) {
      els.candidateList.innerHTML = `
        <div class="candidate">
          <div class="candidate-title">
            <h3>先给我一点线索</h3>
            <span class="score-chip">0%</span>
          </div>
          <p class="reasons">从文字、驾驶方向、车牌和道路标线开始，命中率会更高。</p>
        </div>
      `;
      els.nextChecks.innerHTML = defaultChecks().map((text) => `<li>${text}</li>`).join("");
      els.analysisStatus.textContent = "等待线索";
      return;
    }

    const top = scored[0].score || 1;
    els.candidateList.innerHTML = scored
      .map((item) => {
        const confidence = Math.round((item.score / top) * Math.min(96, 38 + top * 8));
        const reasons = item.reasons.slice(0, 3);
        if (!reasons.length) reasons.push(item.profile.notes);

        return `
          <article class="candidate">
            <div class="candidate-title">
              <h3>${item.profile.country} <span class="tag">${item.profile.region}</span></h3>
              <span class="score-chip">${confidence}%</span>
            </div>
            <div class="bar"><span style="width:${confidence}%"></span></div>
            <ul class="reasons">
              ${reasons.map((reason) => `<li>${reason}</li>`).join("")}
              <li>${item.profile.notes}</li>
            </ul>
          </article>
        `;
      })
      .join("");

    els.nextChecks.innerHTML = buildNextChecks(tags, scored[0].profile)
      .map((text) => `<li>${text}</li>`)
      .join("");
    els.analysisStatus.textContent = `当前最像：${scored[0].profile.country}`;
  }

  function renderCityResults() {
    if (!els.cityList) return;

    if (state.cityFindings.length) {
      els.cityList.innerHTML = state.cityFindings
        .map(
          (item) => `
            <article class="candidate candidate-city">
              <div class="candidate-title">
                <h3>${escapeHtml(item.city)}${item.country ? ` <span class="tag">${escapeHtml(item.country)}</span>` : ""}</h3>
                <span class="score-chip">${Math.round(item.confidence * 100)}%</span>
              </div>
              <div class="bar"><span style="width:${Math.round(item.confidence * 100)}%"></span></div>
              <ul class="reasons">
                <li>${escapeHtml(item.reason)}</li>
              </ul>
            </article>
          `
        )
        .join("");
      return;
    }

    els.cityList.innerHTML = `
      <div class="candidate candidate-city">
        <div class="candidate-title">
          <h3>城市候选</h3>
          <span class="score-chip">0%</span>
        </div>
        <p class="reasons">有路牌、地名、电话区号或更强的城市环境后，这里会开始出候选。</p>
      </div>
    `;
  }

  function renderPlaceGuess() {
    if (!els.placeGuess) return;

    const guess = state.placeGuess;
    if (!guess || (!guess.country && !guess.region && !guess.city)) {
      els.placeGuess.innerHTML = `
        <div class="candidate candidate-place">
          <div class="candidate-title">
            <h3>地点判断</h3>
            <span class="score-chip">0%</span>
          </div>
          <p class="reasons">让模型先看完画面，它会直接给出国家、洲别和位置判断。</p>
        </div>
      `;
      return;
    }

    const fallbackMeta = placeMetaFallbacks.get(guess.country) || {};
    const countryLabel = guess.countryZh || fallbackMeta.countryZh || guess.country || "地点判断";
    const originalCountry = countryLabel && guess.country && countryLabel !== guess.country ? guess.country : "";
    const continent = guess.continent || fallbackMeta.continent || "";
    const location = guess.location || [guess.region, guess.city].filter(Boolean).join(" / ");
    const directionItems = [
      guess.continentDirection ? `大洲方位：${guess.continentDirection}` : "",
      guess.countryDirection ? `国家方位：${guess.countryDirection}` : "",
      guess.cityDirection ? `城市方位：${guess.cityDirection}` : ""
    ].filter(Boolean);
    const confidence = Math.round((Number(guess.confidence) || 0) * 100);
    const evidence = Array.isArray(guess.evidence) ? guess.evidence.slice(0, 4) : [];
    const alternatives = Array.isArray(guess.alternatives) ? guess.alternatives.slice(0, 3) : [];
    const coverage = guess.coverage || {};
    const generationLabel = Array.isArray(coverage.generations) && coverage.generations.length
      ? coverage.generations.join(" / ")
      : "";
    const generationNotes = Array.isArray(coverage.generationNotes) ? coverage.generationNotes.slice(0, 2) : [];
    const coverageLabel = coverage.playable === false ? "不在覆盖" : coverage.playable ? "可玩覆盖" : "";

    els.placeGuess.innerHTML = `
      <article class="candidate candidate-place">
        <div class="candidate-title">
          <h3>${escapeHtml(countryLabel)}</h3>
          <span class="score-chip">${confidence}%</span>
        </div>
        <div class="bar"><span style="width:${confidence}%"></span></div>
        <div class="place-meta">
          ${coverageLabel ? `<span class="${coverage.playable === false ? "is-warning" : "is-ok"}">覆盖：${escapeHtml(coverageLabel)}</span>` : ""}
          ${generationLabel ? `<span>代际：${escapeHtml(generationLabel)}</span>` : ""}
          ${continent ? `<span>洲别：${escapeHtml(continent)}</span>` : ""}
          ${location ? `<span>位置：${escapeHtml(location)}</span>` : ""}
          ${directionItems.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
          ${originalCountry ? `<span>原文：${escapeHtml(originalCountry)}</span>` : ""}
        </div>
        <ul class="reasons">
          <li>${escapeHtml(guess.reason || "模型直接给出的地点判断")}</li>
          ${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
          ${generationNotes.length ? `<li>代际提示：${generationNotes.map((item) => escapeHtml(item)).join("；")}</li>` : ""}
          ${alternatives.length ? `<li>备选：${alternatives.map((item) => escapeHtml(item)).join("、")}</li>` : ""}
        </ul>
      </article>
    `;

    if (countryLabel) {
      els.analysisStatus.textContent = coverage.playable === false ? `第0步：${countryLabel} 不在图寻覆盖范围` : `地点判断：${countryLabel}`;
    }
  }

  function renderAutoClues() {
    if (!state.autoFindings.length) {
      els.autoClues.textContent = state.visionAvailable
        ? "等着自动识图结果。画面稳定后会自动读取文字、路牌、车牌、道路和环境。"
        : `${state.visionMessage || "视觉模型不可用"}，当前只使用本地颜色/场景粗略识别。`;
      return;
    }

    els.autoClues.innerHTML = state.autoFindings
      .map(
        (item) => `
          <span class="auto-clue" title="${escapeHtml(item.reason)}">
            ${escapeHtml(labelFor(item.tag))} · ${Math.round(item.confidence * 100)}%
          </span>
        `
      )
      .join("");
  }

  async function initVisionConfig() {
    try {
      const response = await fetch("/api/config");
      const config = await response.json();
      state.visionAvailable = Boolean(config.vision);
      state.visionProvider = config.provider || "";
      state.visionMode = config.mode || "";
      state.visionModel = config.model || "";
      state.visionMessage = config.message || "";
      state.visionMaxWidth = config.model?.includes("moondream") ? 384 : config.provider === "ollama" ? 640 : 960;
      els.visionStatus.textContent = state.visionAvailable
        ? `自动识图：${state.visionProvider}/${state.visionModel}${state.visionMode ? `/${state.visionMode}` : ""}`
        : state.visionMessage || "视觉模型未配置";
    } catch (error) {
      state.visionAvailable = false;
      els.visionStatus.textContent = "自动识图不可用";
    }
    renderAutoClues();
  }

  function scheduleVisionAnalysis(force = false) {
    if (!state.visionAvailable || state.visionInFlight || !els.canvas.width || !els.canvas.height) return;
    const now = Date.now();
    const interval = state.visionModel.includes("moondream") ? 2500 : state.visionProvider === "ollama" ? 15000 : 6000;
    if (!force && now - state.lastVisionAt < interval) return;
    state.lastVisionAt = now;
    sendVisionAnalysis();
  }

  async function sendVisionAnalysis() {
    state.visionInFlight = true;
    els.visionStatus.textContent = `正在自动识图：${state.visionProvider}/${state.visionModel}`;

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          image: makeVisionImage(),
          notes: state.notes
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "自动识图失败");
      applyVisionResult(result);
      els.visionStatus.textContent = `自动识图：${state.visionProvider}/${state.visionModel}`;
    } catch (error) {
      els.visionStatus.textContent = error.message || "自动识图失败";
    } finally {
      state.visionInFlight = false;
    }
  }

  function makeVisionImage() {
    const maxWidth = state.visionMaxWidth || 640;
    const ratio = Math.min(1, maxWidth / els.canvas.width);
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(els.canvas.width * ratio));
    out.height = Math.max(1, Math.round(els.canvas.height * ratio));
    out.getContext("2d").drawImage(els.canvas, 0, 0, out.width, out.height);
    return out.toDataURL("image/jpeg", 0.72);
  }

  function applyVisionResult(result) {
    const knownTags = new Set(optionIndex.keys());
    const findings = Array.isArray(result.tags)
      ? result.tags
          .filter((item) => knownTags.has(item.tag) && Number(item.confidence) >= 0.35)
          .slice(0, 12)
      : [];

    state.autoSignals.clear();
    state.autoFindings = findings.map((item) => ({
      tag: item.tag,
      reason: item.reason || "自动识图线索",
      confidence: Number(item.confidence) || 0.5
    }));

    state.placeGuess = result.placeGuess || null;

    state.cityFindings = Array.isArray(result.candidateCities)
      ? result.candidateCities
          .filter((item) => item && typeof item.city === "string" && item.city.trim())
          .slice(0, 6)
      : [];

    for (const item of state.autoFindings) {
      state.autoSignals.set(item.tag, `自动识图：${item.reason}`);
    }

    if (Array.isArray(result.textClues) && result.textClues.length) {
      const recognizedText = result.textClues.join(" ").trim();
      if (!els.textClues.value.trim()) {
        state.text = recognizedText;
        els.textClues.value = state.text;
      }
    }

    if (result.summary) {
      state.notes = result.summary;
      if (!els.freeNotes.value.trim()) {
        els.freeNotes.value = result.summary;
      }
    }

    renderAutoClues();
    renderResults();
    renderPlaceGuess();
    renderCityResults();
  }
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function defaultChecks() {
  return [
    "先看有没有文字、地名、电话区号或道路编号。",
    "确认车辆是左行还是右行。",
    "看车牌底色、中心线颜色、路牌样式和电线杆。"
  ];
}

function buildNextChecks(tags, topProfile) {
  const checks = [];
  for (const hint of nextChecks) {
    if (tags.has(hint.tag)) checks.push(hint.text);
  }
  if (!tags.has("drive-left") && !tags.has("drive-right")) {
    checks.push("尽快确认驾驶方向，这是排除国家的高优先级线索。");
  }
  if (![...tags.keys()].some((tag) => ["thai", "khmer", "hangul", "kana", "chinese", "cyrillic", "arabic", "latin"].includes(tag))) {
    checks.push("寻找文字：商店招牌、公交站牌、路牌、广告、车身和垃圾桶都可能有用。");
  }
  if (![...tags.keys()].some((tag) => tag.startsWith("plate"))) {
    checks.push("放大车辆，确认车牌颜色、形状和是否有欧盟蓝条。");
  }
  checks.push(`如果继续押 ${topProfile.country}，下一步优先找能推翻它的线索。`);
  return [...new Set(checks)].slice(0, 5);
}

function updateChips() {
  els.clueGrid.querySelectorAll(".chip").forEach((button) => {
    button.classList.toggle("is-active", state.selected.has(button.dataset.id));
  });
}

function onChipClick(event) {
  const button = event.target.closest(".chip");
  if (!button) return;

  const group = groups.find((item) => item.id === button.dataset.group);
  if (!group.multi) {
    for (const option of group.options) state.selected.delete(option.id);
  }

  if (state.selected.has(button.dataset.id)) {
    state.selected.delete(button.dataset.id);
  } else {
    state.selected.add(button.dataset.id);
  }

  updateChips();
  renderResults();
}

async function startCapture() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    els.captureStatus.textContent = "浏览器不支持屏幕捕获";
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 2 },
      audio: false
    });
    els.video.srcObject = state.stream;
    els.startCapture.disabled = true;
    els.stopCapture.disabled = false;
    els.captureStatus.textContent = "正在实时取帧";
    els.dropHint.classList.add("is-hidden");

    state.stream.getVideoTracks()[0].addEventListener("ended", stopCapture);
    state.timer = window.setInterval(captureFrame, 1500);
    window.setTimeout(captureFrame, 600);
  } catch (error) {
    els.captureStatus.textContent = "已取消捕获";
  }
}

function stopCapture() {
  if (state.timer) window.clearInterval(state.timer);
  state.timer = null;
  if (state.stream) {
    for (const track of state.stream.getTracks()) track.stop();
  }
  state.stream = null;
  els.video.srcObject = null;
  els.startCapture.disabled = false;
  els.stopCapture.disabled = true;
  els.captureStatus.textContent = "捕获已停止";
}
function captureFrame() {
    const video = els.video;
    if (!video.videoWidth || !video.videoHeight) return;
    drawToCanvas(video, video.videoWidth, video.videoHeight);
    analyzeFrame();
  }

  function drawToCanvas(source, width, height) {
    const maxWidth = 1280;
    const ratio = Math.min(1, maxWidth / width);
    els.canvas.width = Math.max(1, Math.round(width * ratio));
    els.canvas.height = Math.max(1, Math.round(height * ratio));
    ctx.drawImage(source, 0, 0, els.canvas.width, els.canvas.height);
    els.dropHint.classList.add("is-hidden");
  }

  function frameMetricsPass(metrics, condition) {
    const value = metrics[condition.metric];
    const target = Number(condition.value);
    if (!Number.isFinite(value) || !Number.isFinite(target)) return false;

    switch (condition.op) {
      case ">":
        return value > target;
      case ">=":
        return value >= target;
      case "<":
        return value < target;
      case "<=":
        return value <= target;
      case "==":
      case "=":
        return value === target;
      default:
        return false;
    }
  }

  function applyExternalFrameRules(metrics) {
    for (const rule of frameRules) {
      const conditions = Array.isArray(rule.conditions) ? rule.conditions : [];
      if (!conditions.length) continue;
      if (!conditions.every((condition) => frameMetricsPass(metrics, condition))) continue;
      state.frameSignals.set(rule.tag, rule.reason || "外置知识库判断");
    }
  }

  function analyzeFrame() {
    const width = els.canvas.width;
    const height = els.canvas.height;
    if (!width || !height) return;

    const data = ctx.getImageData(0, 0, width, height).data;
    const total = width * height;
    let sky = 0;
    let veg = 0;
    let road = 0;
    let yellow = 0;
    let white = 0;
    let redSoil = 0;
    let dark = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      const y = Math.floor(i / 4 / width);

      if (b > r + 18 && b > g - 4 && max > 105 && y < height * 0.55) sky++;
      if (g > r + 12 && g > b + 8 && sat > 28) veg++;
      if (Math.abs(r - g) < 16 && Math.abs(g - b) < 16 && max > 45 && max < 190 && y > height * 0.45) road++;
      if (r > 145 && g > 120 && b < 92 && y > height * 0.35) yellow++;
      if (r > 205 && g > 205 && b > 195 && y > height * 0.35) white++;
      if (r > 120 && g > 54 && g < 120 && b < 85 && y > height * 0.35) redSoil++;
      if (max < 38) dark++;
    }

    const pct = (count) => Math.round((count / total) * 100);
    const skyPct = pct(sky);
    const vegPct = pct(veg);
    const roadPct = pct(road);
    const yellowPct = pct(yellow);
    const whitePct = pct(white);
    const redPct = pct(redSoil);
    const darkPct = pct(dark);

    state.frameSignals.clear();
    if (vegPct > 22) state.frameSignals.set("tropical", "鐢婚潰妞嶈鍗犳瘮杈冮珮");
    if (vegPct > 12 && skyPct < 16) state.frameSignals.set("temperate", "鐢婚潰妞嶈鍜屽ぉ绌烘瘮渚嬪儚娓╁甫/鍩庨儕");
    if (roadPct > 14 && yellowPct > 2) state.frameSignals.set("yellow-center", "鐢婚潰妫€娴嬪埌杈冨榛勮壊閬撹矾鍏冪礌");
    if (roadPct > 14 && whitePct > 5) state.frameSignals.set("white-center", "鐢婚潰妫€娴嬪埌杈冨鐧借壊閬撹矾鍏冪礌");
    if (redPct > 3) state.frameSignals.set("red-shoulder", "鐢婚潰妫€娴嬪埌绾㈠湡/绾㈣壊璺偐");
    if (skyPct > 32 && vegPct < 6 && roadPct > 10) state.frameSignals.set("desert-road", "澶╃┖澶氥€佹琚皯锛屽儚骞叉棻閬撹矾");
    if (darkPct > 16 && skyPct < 10) state.frameSignals.set("urban-dense", "暗部和遮挡较多，可能是高密度城市");

    applyExternalFrameRules({
      skyPct,
      vegPct,
      roadPct,
      yellowPct,
      whitePct,
      redPct,
      darkPct
    });

    els.metrics.innerHTML = `
      <span>澶╃┖ ${skyPct}%</span>
      <span>妞嶈 ${vegPct}%</span>
      <span>閬撹矾 ${roadPct}%</span>
      <span>榛勭嚎 ${yellowPct}%</span>
      <span>鐧界嚎 ${whitePct}%</span>
    `;
    renderResults();
    scheduleVisionAnalysis();
  }

  function clearFrame() {
    if (state.timer || state.stream) stopCapture();
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    els.canvas.width = 0;
    els.canvas.height = 0;
    state.frameSignals.clear();
    state.autoSignals.clear();
    state.autoFindings = [];
    state.cityFindings = [];
    state.placeGuess = null;
    els.dropHint.classList.remove("is-hidden");
    els.metrics.innerHTML = `
      <span>澶╃┖ --</span>
      <span>妞嶈 --</span>
      <span>閬撹矾 --</span>
      <span>榛勭嚎 --</span>
      <span>鐧界嚎 --</span>
    `;
    els.captureStatus.textContent = "未开始捕获";
    renderAutoClues();
    renderResults();
    renderPlaceGuess();
    renderCityResults();
  }

  function resetSignals() {
    state.selected.clear();
    state.autoSignals.clear();
    state.autoFindings = [];
    state.cityFindings = [];
    state.placeGuess = null;
    state.text = "";
    state.notes = "";
    els.textClues.value = "";
    els.freeNotes.value = "";
    updateChips();
    renderAutoClues();
    renderResults();
    renderPlaceGuess();
    renderCityResults();
  }

  function loadImage(file) {
    if (!file?.type.startsWith("image/")) return;
    const img = new Image();
    img.onload = () => {
      drawToCanvas(img, img.naturalWidth, img.naturalHeight);
      analyzeFrame();
      scheduleVisionAnalysis(true);
      URL.revokeObjectURL(img.src);
      els.captureStatus.textContent = "已载入截图";
    };
    img.src = URL.createObjectURL(file);
  }

  function handlePaste(event) {
    const item = [...event.clipboardData.items].find((entry) => entry.type.startsWith("image/"));
    if (item) loadImage(item.getAsFile());
  }

  function handleDrop(event) {
    event.preventDefault();
    loadImage(event.dataTransfer.files[0]);
  }

  function bindEvents() {
    els.clueGrid.addEventListener("click", onChipClick);
    els.textClues.addEventListener("input", () => {
      state.text = els.textClues.value;
      renderResults();
    });
    els.freeNotes.addEventListener("input", () => {
      state.notes = els.freeNotes.value;
    });
    els.startCapture.addEventListener("click", startCapture);
    els.stopCapture.addEventListener("click", stopCapture);
    els.clearFrame.addEventListener("click", clearFrame);
    els.resetSignals.addEventListener("click", resetSignals);
    els.upload.addEventListener("change", () => loadImage(els.upload.files[0]));
    window.addEventListener("paste", handlePaste);
    window.addEventListener("dragover", (event) => event.preventDefault());
    window.addEventListener("drop", handleDrop);
  }

  bindEvents();
  loadKnowledge();
  initVisionConfig();
  renderAutoClues();
  renderResults();
  renderPlaceGuess();
  renderCityResults();
})();





