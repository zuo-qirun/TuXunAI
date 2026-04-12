const DEFAULT_API_BASE = "http://localhost:4173";

const els = {
  status: document.querySelector("#status"),
  captureBtn: document.querySelector("#captureBtn"),
  saveServerUrl: document.querySelector("#saveServerUrl"),
  serverUrl: document.querySelector("#serverUrl"),
  preview: document.querySelector("#preview"),
  place: document.querySelector("#place"),
  details: document.querySelector("#details")
};

let apiBase = DEFAULT_API_BASE;

function setStatus(text, tone = "") {
  els.status.textContent = text;
  els.status.className = tone ? `pill ${tone}` : "pill";
}

function setText(target, text, muted = false) {
  target.textContent = text;
  target.className = muted ? "muted" : "";
}

function normalizeBaseUrl(value) {
  const raw = String(value || "").trim().replace(/\/+$/, "");
  if (!raw) return DEFAULT_API_BASE;
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function captureVisibleTab() {
  return new Promise((resolve, reject) => {
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(dataUrl);
    });
  });
}

function decodeImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("无法解析截图"));
    image.src = dataUrl;
  });
}

async function resizeImage(dataUrl, maxWidth = 1440, quality = 0.84) {
  const image = await decodeImage(dataUrl);
  const scale = Math.min(1, maxWidth / image.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || `请求失败：${response.status}`);
  }
  return data;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderResult(result) {
  const guess = result.placeGuess || {};
  const country = guess.countryZh || guess.country || "未识别";
  const continent = guess.continent || "";
  const location = guess.location || [guess.region, guess.city].filter(Boolean).join(" / ");
  const coverage = guess.coverage || {};
  const coverageLabel = coverage.playable === false ? "不在覆盖" : coverage.playable ? "可玩覆盖" : "";
  const generations = Array.isArray(coverage.generations) ? coverage.generations.join(" / ") : "";
  const confidence = Math.round((Number(guess.confidence) || 0) * 100);

  els.place.innerHTML = `
    <strong>${escapeHtml(country)}</strong>
    <div class="meta">
      ${coverageLabel ? `<span class="${coverage.playable === false ? "warning" : ""}">覆盖：${escapeHtml(coverageLabel)}</span>` : ""}
      ${continent ? `<span>洲别：${escapeHtml(continent)}</span>` : ""}
      ${location ? `<span>位置：${escapeHtml(location)}</span>` : ""}
      ${generations ? `<span>代际：${escapeHtml(generations)}</span>` : ""}
      <span>置信度：${confidence}%</span>
    </div>
  `;

  const parts = [];
  if (guess.reason) parts.push(`理由：${guess.reason}`);
  if (Array.isArray(guess.evidence) && guess.evidence.length) parts.push(`证据：${guess.evidence.slice(0, 4).join("；")}`);
  if (Array.isArray(guess.alternatives) && guess.alternatives.length) parts.push(`备选：${guess.alternatives.slice(0, 3).join("、")}`);
  if (Array.isArray(coverage.generationNotes) && coverage.generationNotes.length) {
    parts.push(`代际提示：${coverage.generationNotes.slice(0, 2).join("；")}`);
  }
  if (Array.isArray(result.tags) && result.tags.length) {
    parts.push(`线索：${result.tags.slice(0, 6).map((item) => item.tag).join(" / ")}`);
  }

  setText(els.details, parts.length ? parts.join("\n") : "模型没有返回更多说明。");
}

async function analyzeCurrentTab() {
  els.captureBtn.disabled = true;
  setStatus("正在截图…");
  setText(els.details, "正在抓取当前标签页的可见区域。", true);
  els.preview.removeAttribute("src");
  els.preview.style.display = "none";

  try {
    const rawImage = await captureVisibleTab();
    const image = await resizeImage(rawImage);
    els.preview.src = image;
    els.preview.style.display = "block";

    setStatus("正在识图…");
    const result = await fetchJson(`${apiBase}/api/analyze`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image, notes: "chrome extension capture" })
    });

    renderResult(result);
    setStatus("识图完成");
  } catch (error) {
    setStatus("识图失败", "warning");
    setText(els.details, error.message || "出现了一个错误。");
    els.place.innerHTML = `<span class="muted">没有结果。</span>`;
  } finally {
    els.captureBtn.disabled = false;
  }
}

async function loadConfig() {
  try {
    const config = await fetchJson(`${apiBase}/api/config`);
    const label = config.vision ? `${config.provider}/${config.model}` : config.message || "视觉不可用";
    setStatus(label);
    setText(els.details, `本地服务已连接。${config.vision ? "点击按钮即可抓图识图。" : config.message || ""}`, true);
    if (config.vision) {
      setTimeout(() => analyzeCurrentTab(), 180);
    }
  } catch (error) {
    setStatus("本地服务未连接", "warning");
    setText(els.details, `无法连接到 ${apiBase}。先启动本地助手，再回到这里点击识图。`, true);
  }
}

async function loadSavedServerUrl() {
  const stored = await chrome.storage.local.get({ serverUrl: DEFAULT_API_BASE });
  apiBase = normalizeBaseUrl(stored.serverUrl);
  els.serverUrl.value = apiBase;
}

async function saveServerUrl() {
  apiBase = normalizeBaseUrl(els.serverUrl.value);
  els.serverUrl.value = apiBase;
  await chrome.storage.local.set({ serverUrl: apiBase });
  setStatus("地址已保存");
  await loadConfig();
}

els.captureBtn.addEventListener("click", analyzeCurrentTab);
els.saveServerUrl.addEventListener("click", saveServerUrl);
els.serverUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveServerUrl();
  }
});

(async () => {
  await loadSavedServerUrl();
  await loadConfig();
})();
