const DEFAULT_API_BASE = "http://localhost:4173";
const BURST_COUNT = 3;
const BURST_DELAY_MS = 450;
const CENTER_DRAG_COUNT = 5;
const CENTER_DRAG_PIXELS = 220;
const CENTER_DRAG_STEP_DELAY_MS = 12;
const CENTER_DRAG_DELAY_MS = 35;
const HISTORY_KEY = "searchHistory";
const MODE_KEY = "aiMode";
const GAME_MODE_KEY = "gameMode";
const REASONING_MODE_KEY = "reasoningMode";
const MAX_HISTORY_ITEMS = 12;

const els = {
  status: document.querySelector("#status"),
  captureBtn: document.querySelector("#captureBtn"),
  burstBtn: document.querySelector("#burstBtn"),
  saveServerUrl: document.querySelector("#saveServerUrl"),
  serverUrl: document.querySelector("#serverUrl"),
  aiMode: document.querySelector("#aiMode"),
  modeHint: document.querySelector("#modeHint"),
  gameMode: document.querySelector("#gameMode"),
  gameModeHint: document.querySelector("#gameModeHint"),
  reasoningMode: document.querySelector("#reasoningMode"),
  reasoningModeHint: document.querySelector("#reasoningModeHint"),
  preview: document.querySelector("#preview"),
  place: document.querySelector("#place"),
  details: document.querySelector("#details"),
  feedbackPanel: document.querySelector("#feedbackPanel"),
  markAccurate: document.querySelector("#markAccurate"),
  markWrong: document.querySelector("#markWrong"),
  feedbackStatus: document.querySelector("#feedbackStatus"),
  historyList: document.querySelector("#historyList"),
  clearHistory: document.querySelector("#clearHistory")
};

let apiBase = DEFAULT_API_BASE;
let activeConfig = null;
let lastResult = null;
let lastGameMode = "world";
let lastReasoningMode = "fast";

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStoredServerUrl() {
  return Promise.resolve(localStorage.getItem("serverUrl") || DEFAULT_API_BASE);
}

function writeStoredServerUrl(value) {
  const nextValue = normalizeBaseUrl(value);
  localStorage.setItem("serverUrl", nextValue);
  return Promise.resolve();
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
}

function readStoredMode() {
  return localStorage.getItem(MODE_KEY) || "auto";
}

function writeStoredMode(value) {
  localStorage.setItem(MODE_KEY, value);
}

function readStoredGameMode() {
  return localStorage.getItem(GAME_MODE_KEY) || "world";
}

function writeStoredGameMode(value) {
  localStorage.setItem(GAME_MODE_KEY, value);
}

function readStoredReasoningMode() {
  return localStorage.getItem(REASONING_MODE_KEY) || "fast";
}

function writeStoredReasoningMode(value) {
  localStorage.setItem(REASONING_MODE_KEY, value);
}

function modeLabel(value) {
  if (value === "single") return "单帧快速";
  if (value === "burst") return "三连拍稳判";
  return "智能选择";
}

function selectedMode() {
  return els.aiMode.value || "auto";
}

function selectedGameMode() {
  return els.gameMode.value === "china" ? "china" : "world";
}

function gameModeLabel(value = selectedGameMode()) {
  return value === "china" ? "中国" : "世界";
}

function selectedReasoningMode() {
  return els.reasoningMode.value === "accurate" ? "accurate" : "fast";
}

function reasoningModeLabel(value = selectedReasoningMode()) {
  return value === "accurate" ? "精准" : "快速";
}

function updateGameModeHint() {
  els.gameModeHint.textContent = selectedGameMode() === "china"
    ? "中国模式只在中国街景中判断省、市和区域。"
    : "世界模式不会把中国大陆作为答案。";
}

function updateReasoningModeHint() {
  els.reasoningModeHint.textContent = selectedReasoningMode() === "accurate"
    ? "精准模式会检索具体资料复核，答案改变后会继续检索再判断。"
    : "快速模式不启用复核，适合连续快速判断。";
}

function effectiveFrameCount(mode = selectedMode()) {
  if (mode === "single") return 1;
  if (mode === "burst") return BURST_COUNT;
  const model = String(activeConfig?.model || "").toLowerCase();
  if (activeConfig?.provider === "ollama" && (model.includes("moondream") || model.includes("fast"))) return 1;
  return BURST_COUNT;
}

function updateModeHint() {
  const mode = selectedMode();
  const frames = effectiveFrameCount(mode);
  const model = activeConfig?.model ? `${activeConfig.provider}/${activeConfig.model}` : "当前模型";
  els.modeHint.textContent = mode === "auto"
    ? `${model} 将使用 ${frames} 张截图。`
    : `${modeLabel(mode)} 将使用 ${frames} 张截图。`;
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

async function makeThumbnail(dataUrl) {
  if (!dataUrl) return "";
  try {
    return await resizeImage(dataUrl, 260, 0.62);
  } catch {
    return "";
  }
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

async function getActiveTabId() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== "number") {
        reject(new Error("找不到当前标签页"));
        return;
      }
      resolve(tab.id);
    });
  });
}

function debuggerAttach(target) {
  return new Promise((resolve, reject) => {
    chrome.debugger.attach(target, "1.3", () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

function debuggerDetach(target) {
  return new Promise((resolve) => {
    chrome.debugger.detach(target, () => resolve());
  });
}

function debuggerSend(target, method, params = {}) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand(target, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(result);
    });
  });
}

async function dragWithDebugger(tabId, direction = 1) {
  const target = { tabId };
  let attached = false;
  let startX = 640;
  let startY = 360;
  let endX = 420;
  let endY = 360;

  try {
    await debuggerAttach(target);
    attached = true;
    await debuggerSend(target, "Page.enable");

    const metrics = await debuggerSend(target, "Page.getLayoutMetrics");
    const viewport = metrics?.cssVisualViewport || metrics?.cssLayoutViewport || {};
    const width = Math.max(1, Math.round(viewport.clientWidth || viewport.pageX || 1280));
    const height = Math.max(1, Math.round(viewport.clientHeight || viewport.pageY || 720));
    startX = Math.round(width / 2);
    startY = Math.round(height / 2);
    const dragPixels = Math.min(CENTER_DRAG_PIXELS, Math.max(80, Math.round(width * 0.22)));
    const deltaX = direction >= 0 ? -dragPixels : dragPixels;
    endX = startX + deltaX;
    endY = startY;

    for (let dragIndex = 0; dragIndex < CENTER_DRAG_COUNT; dragIndex += 1) {
      await debuggerSend(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: startX,
        y: startY,
        button: "none",
        buttons: 0
      });

      await debuggerSend(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: startX,
        y: startY,
        button: "left",
        buttons: 1,
        clickCount: 1
      });

      const steps = 5;
      for (let i = 1; i <= steps; i += 1) {
        const t = i / steps;
        await debuggerSend(target, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: Math.round(startX + (endX - startX) * t),
          y: Math.round(startY + (endY - startY) * t),
          button: "left",
          buttons: 1
        });
        await sleep(CENTER_DRAG_STEP_DELAY_MS);
      }

      await debuggerSend(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: endX,
        y: endY,
        button: "left",
        buttons: 0,
        clickCount: 1
      });

      await sleep(CENTER_DRAG_DELAY_MS);
    }
  } finally {
    if (attached) {
      await debuggerDetach(target);
    }
  }
}

async function nudgeCurrentTab(direction = 1) {
  try {
    const tabId = await getActiveTabId();
    await dragWithDebugger(tabId, direction);
  } catch (error) {
    try {
      const tabId = await getActiveTabId();
      if (!chrome.scripting?.executeScript) return;
      await chrome.scripting.executeScript({
        target: { tabId },
        args: [direction, CENTER_DRAG_COUNT, CENTER_DRAG_PIXELS, CENTER_DRAG_STEP_DELAY_MS, CENTER_DRAG_DELAY_MS],
        func: async (dir, dragCount, dragPixels, dragStepDelayMs, dragDelayMs) => {
          const key = dir >= 0 ? "ArrowRight" : "ArrowLeft";
          const centerX = Math.round(window.innerWidth / 2);
          const centerY = Math.round(window.innerHeight / 2);
          const offset = Math.min(dragPixels, Math.max(80, Math.round(window.innerWidth * 0.22)));
          const endX = centerX + (dir >= 0 ? -offset : offset);
          const dispatch = (type, init = {}) => {
            const eventInit = {
              bubbles: true,
              cancelable: true,
              composed: true,
              key,
              code: key,
              ...init
            };
            window.dispatchEvent(new KeyboardEvent(type, eventInit));
            document.dispatchEvent(new KeyboardEvent(type, eventInit));
          };
          dispatch("keydown");
          dispatch("keyup");

          const target = document.elementFromPoint(centerX, centerY) || document.body || document.documentElement;
          const start = {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: centerX,
            clientY: centerY,
            button: 0,
            buttons: 1
          };
          const fire = (EventClass, type, init) => {
            if (typeof EventClass === "function") {
              target.dispatchEvent(new EventClass(type, init));
            }
          };
          for (let dragIndex = 0; dragIndex < dragCount; dragIndex += 1) {
            fire(MouseEvent, "mousemove", { ...start, buttons: 0 });
            fire(window.PointerEvent, "pointerdown", { ...start, pointerId: 1, pointerType: "mouse", isPrimary: true });
            fire(MouseEvent, "mousedown", start);

            const steps = 5;
            for (let i = 1; i <= steps; i += 1) {
              const move = {
                ...start,
                clientX: Math.round(centerX + (endX - centerX) * (i / steps)),
                clientY: centerY
              };
              fire(window.PointerEvent, "pointermove", { ...move, pointerId: 1, pointerType: "mouse", isPrimary: true });
              fire(MouseEvent, "mousemove", move);
              await new Promise((resolve) => setTimeout(resolve, dragStepDelayMs));
            }

            const end = { ...start, clientX: endX, buttons: 0 };
            fire(window.PointerEvent, "pointerup", { ...end, pointerId: 1, pointerType: "mouse", isPrimary: true });
            fire(MouseEvent, "mouseup", end);
            await new Promise((resolve) => setTimeout(resolve, dragDelayMs));
          }
        }
      });
    } catch {
      // Best-effort only.
    }
  }
}

async function captureFrames(frameCount = 1) {
  const frames = [];
  for (let i = 0; i < frameCount; i += 1) {
    if (i > 0) {
      await nudgeCurrentTab(1);
      await sleep(BURST_DELAY_MS);
    }
    const rawImage = await captureVisibleTab();
    frames.push(await resizeImage(rawImage));
  }
  return frames;
}

function renderPlaceGuess(guess) {
  const country = guess.countryZh || guess.country || "未识别";
  const continent = guess.continent || "";
  const location = guess.location || [guess.region, guess.city].filter(Boolean).join(" / ");
  const rawConf = Number(guess.confidence) || 0;
  const confidence = Math.round(rawConf > 1 ? rawConf : rawConf * 100);
  const directions = [
    guess.continentDirection ? `大洲方位：${guess.continentDirection}` : "",
    guess.countryDirection ? `国家方位：${guess.countryDirection}` : "",
    guess.cityDirection ? `城市方位：${guess.cityDirection}` : ""
  ].filter(Boolean);

  let metaHtml = "";
  if (continent) metaHtml += `<span>洲别：${escapeHtml(continent)}</span>`;
  if (location) metaHtml += `<span>位置：${escapeHtml(location)}</span>`;
  metaHtml += `<span>置信度：${confidence}%</span>`;
  for (const d of directions) metaHtml += `<span>${escapeHtml(d)}</span>`;

  els.place.innerHTML = `
    <strong>${escapeHtml(country)}</strong>
    <div class="meta">${metaHtml}</div>
  `;
}

function renderResult(result) {
  lastResult = result;
  els.feedbackPanel.classList.add("is-visible");
  els.feedbackStatus.textContent = "";
  const guess = result.placeGuess || {};
  renderPlaceGuess(guess);

  const coverage = guess.coverage || {};
  const coverageLabel = coverage.playable === false ? "不在覆盖" : coverage.playable ? "可玩覆盖" : "";
  const generations = Array.isArray(coverage.generations) ? coverage.generations.join(" / ") : "";

  if (coverageLabel || generations) {
    const meta = els.place.querySelector(".meta");
    if (meta) {
      let extra = "";
      if (coverageLabel) extra += `<span class="${coverage.playable === false ? "warning" : ""}">覆盖：${escapeHtml(coverageLabel)}</span>`;
      if (generations) extra += `<span>代际：${escapeHtml(generations)}</span>`;
      meta.insertAdjacentHTML("afterbegin", extra);
    }
  }

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

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function renderHistory() {
  const items = readHistory();
  if (!items.length) {
    els.historyList.textContent = "暂无历史搜索。";
    els.historyList.className = "history-list muted";
    return;
  }

  els.historyList.className = "history-list";
  els.historyList.innerHTML = items
    .map((item, index) => {
      const guess = item.result?.placeGuess || {};
      const country = guess.countryZh || guess.country || "未识别";
      const confidence = Math.round((Number(guess.confidence) || 0) * 100);
      const tags = Array.isArray(item.result?.tags) ? item.result.tags.slice(0, 3).map((tag) => tag.tag).join(" / ") : "";
      const reason = guess.reason || tags || "没有更多说明";
      const thumbnail = item.thumbnail || "";
      return `
        <button class="history-item" type="button" data-history-index="${index}">
          ${thumbnail ? `<img src="${thumbnail}" alt="">` : "<span></span>"}
          <span>
            <span class="history-title">
              <span>${escapeHtml(country)}</span>
              <span>${confidence}%</span>
            </span>
            <span class="history-meta">${escapeHtml(formatTime(item.createdAt))} · ${escapeHtml(gameModeLabel(item.gameMode))} · ${escapeHtml(reasoningModeLabel(item.reasoningMode))} · ${escapeHtml(modeLabel(item.mode))} · ${item.frameCount || 1} 张</span>
            <span class="history-reason">${escapeHtml(reason.slice(0, 58))}</span>
          </span>
        </button>
      `;
    })
    .join("");
}

async function saveHistoryEntry(result, previewImage, mode, frameCount, gameMode, reasoningMode = "fast") {
  const guess = result?.placeGuess || {};
  if (!guess.country && !guess.countryZh && !guess.reason) return;

  const entry = {
    createdAt: Date.now(),
    mode,
    gameMode,
    reasoningMode,
    frameCount,
    thumbnail: await makeThumbnail(previewImage),
    result: {
      placeGuess: result.placeGuess,
      tags: Array.isArray(result.tags) ? result.tags.slice(0, 8) : []
    }
  };

  const items = readHistory();
  writeHistory([entry, ...items]);
  renderHistory();
}

function showHistoryEntry(index) {
  const item = readHistory()[index];
  if (!item) return;
  lastGameMode = item.gameMode || "world";
  lastReasoningMode = item.reasoningMode || "fast";
  if (item.thumbnail) {
    els.preview.src = item.thumbnail;
    els.preview.style.display = "block";
  }
  renderResult(item.result);
  setStatus(`历史：${formatTime(item.createdAt)}`);
}

function parseSSE(raw) {
  const events = [];
  const parts = raw.split("\n\n");
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split("\n");
    let event = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event: ")) event = line.slice(7);
      else if (line.startsWith("data: ")) data = line.slice(6);
      else if (line.startsWith("data:")) data = line.slice(5);
    }
    if (data) {
      try {
        events.push({ event, data: JSON.parse(data) });
      } catch (e) {
        // skip unparseable
      }
    }
  }
  return events;
}

async function analyzeImagesStream(images, notes, previewImage, gameMode, reasoningMode) {
  if (previewImage) {
    els.preview.src = previewImage;
    els.preview.style.display = "block";
  } else {
    els.preview.removeAttribute("src");
    els.preview.style.display = "none";
  }

  setStatus(reasoningMode === "accurate" ? "精准识图中…" : "快速识图中…");
  els.place.innerHTML = '<span class="muted">分析中…</span>';
  setText(els.details, "", true);
  els.feedbackPanel.classList.remove("is-visible");
  lastResult = null;

  const response = await fetch(`${apiBase}/api/analyze-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images, notes, gameMode, reasoningMode })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `请求失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reasonAcc = "";
  let currentPlace = {};
  let finalResult = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lastDouble = buffer.lastIndexOf("\n\n");
    if (lastDouble === -1) continue;

    const processable = buffer.slice(0, lastDouble + 2);
    buffer = buffer.slice(lastDouble + 2);

    const events = parseSSE(processable);
    for (const { event, data } of events) {
      switch (event) {
        case "status":
          setStatus(data.message || "处理中…");
          break;

        case "analysis": {
          if (data.tags && data.tags.length) {
            setText(els.details, "线索：" + data.tags.map((t) => t.tag).join(" / "));
          }
          break;
        }

        case "tags": {
          if (data.tags && data.tags.length) {
            els.details.textContent = "线索：" + data.tags.join(" / ") + "\n" + reasonAcc;
            els.details.className = "details";
          }
          break;
        }

        case "place": {
          currentPlace = { ...currentPlace, ...data };
          renderPlaceGuess(currentPlace);
          break;
        }

        case "reason": {
          reasonAcc += data.chunk;
          if (reasonAcc.startsWith("线索：")) {
            els.details.textContent = reasonAcc;
          } else {
            els.details.textContent = reasonAcc;
          }
          els.details.className = "details";
          break;
        }

        case "done": {
          if (data.placeGuess) {
            finalResult = { placeGuess: data.placeGuess, tags: data.tags };
            renderResult(finalResult);
          } else if (currentPlace.country || currentPlace.countryZh || currentPlace.reason) {
            finalResult = { placeGuess: { ...currentPlace, reason: reasonAcc }, tags: data.tags || [] };
            renderResult(finalResult);
          }
          setStatus("识图完成");
          break;
        }

        case "error": {
          setStatus("识图失败", "warning");
          setText(els.details, data.message || "出现错误。");
          break;
        }
      }
    }
  }

  return finalResult;
}

async function runAnalysis(modeOverride = "") {
  const mode = modeOverride || selectedMode();
  const gameMode = selectedGameMode();
  const reasoningMode = selectedReasoningMode();
  const frameCount = effectiveFrameCount(mode);
  lastGameMode = gameMode;
  lastReasoningMode = reasoningMode;
  els.captureBtn.disabled = true;
  els.burstBtn.disabled = true;
  setStatus(frameCount > 1 ? "正在多帧截图…" : "正在截图…");
  setText(els.details, frameCount > 1 ? `正在按 ${modeLabel(mode)} 抓取 ${frameCount} 张图。` : "正在抓取当前标签页的可见区域。", true);

  try {
    const images = await captureFrames(frameCount);
    const previewImage = images[0];
    const notes = `chrome extension ${gameModeLabel(gameMode)} ${modeLabel(mode)} ${reasoningModeLabel(reasoningMode)} capture; frames=${frameCount}`;
    const result = await analyzeImagesStream(images, notes, previewImage, gameMode, reasoningMode);
    if (result) await saveHistoryEntry(result, previewImage, mode, frameCount, gameMode, reasoningMode);
  } catch (error) {
    setStatus("识图失败", "warning");
    setText(els.details, error.message || "出现了一个错误。");
    els.place.innerHTML = `<span class="muted">没有结果。</span>`;
  } finally {
    els.captureBtn.disabled = false;
    els.burstBtn.disabled = false;
  }
}

async function analyzeCurrentTab() {
  await runAnalysis();
}

async function analyzeBurst() {
  await runAnalysis("burst");
}

async function loadConfig() {
  try {
    const config = await fetchJson(`${apiBase}/api/config`);
    activeConfig = config;
    const label = config.vision ? `${config.provider}/${config.model}` : config.message || "视觉不可用";
    setStatus(label);
    setText(els.details, `本地服务已连接。${config.vision ? "点击按钮即可抓图识图。" : config.message || ""}`, true);
  } catch (error) {
    activeConfig = null;
    setStatus("本地服务未连接", "warning");
    setText(els.details, `无法连接到 ${apiBase}。先启动本地助手，再回到这里点击识图。`, true);
  } finally {
    updateModeHint();
  }
}

async function loadSavedServerUrl() {
  apiBase = normalizeBaseUrl(await readStoredServerUrl());
  els.serverUrl.value = apiBase;
  els.aiMode.value = readStoredMode();
  els.gameMode.value = readStoredGameMode();
  els.reasoningMode.value = readStoredReasoningMode();
  updateModeHint();
  updateGameModeHint();
  updateReasoningModeHint();
}

async function saveServerUrl() {
  apiBase = normalizeBaseUrl(els.serverUrl.value);
  els.serverUrl.value = apiBase;
  await writeStoredServerUrl(apiBase);
  setStatus("地址已保存");
  await loadConfig();
}

async function submitFeedback(accurate) {
  if (!lastResult) return;
  els.markAccurate.disabled = true;
  els.markWrong.disabled = true;
  els.feedbackStatus.textContent = accurate ? "正在生成记忆…" : "已标记";
  try {
    const data = await fetchJson(`${apiBase}/api/memory/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accurate,
        gameMode: lastGameMode,
        reasoningMode: lastReasoningMode,
        result: lastResult
      })
    });
    els.feedbackStatus.textContent = accurate && data.remembered ? "已记录知识点" : "已收到反馈";
  } catch (error) {
    els.feedbackStatus.textContent = error.message || "反馈失败";
  } finally {
    els.markAccurate.disabled = false;
    els.markWrong.disabled = false;
  }
}

els.captureBtn.addEventListener("click", analyzeCurrentTab);
els.burstBtn.addEventListener("click", analyzeBurst);
els.saveServerUrl.addEventListener("click", saveServerUrl);
els.aiMode.addEventListener("change", () => {
  writeStoredMode(selectedMode());
  updateModeHint();
});
els.gameMode.addEventListener("change", () => {
  writeStoredGameMode(selectedGameMode());
  updateGameModeHint();
});
els.reasoningMode.addEventListener("change", () => {
  writeStoredReasoningMode(selectedReasoningMode());
  updateReasoningModeHint();
});
els.clearHistory.addEventListener("click", () => {
  writeHistory([]);
  renderHistory();
});
els.markAccurate.addEventListener("click", () => submitFeedback(true));
els.markWrong.addEventListener("click", () => submitFeedback(false));
els.historyList.addEventListener("click", (event) => {
  const item = event.target.closest("[data-history-index]");
  if (!item) return;
  showHistoryEntry(Number(item.dataset.historyIndex));
});
els.serverUrl.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    saveServerUrl();
  }
});

(async () => {
  await loadSavedServerUrl();
  await loadConfig();
  renderHistory();
})();
