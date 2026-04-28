const DEFAULT_API_BASE = "http://localhost:4173";
const BURST_COUNT = 3;
const BURST_DELAY_MS = 450;
const CENTER_DRAG_COUNT = 5;
const CENTER_DRAG_PIXELS = 220;
const CENTER_DRAG_STEP_DELAY_MS = 12;
const CENTER_DRAG_DELAY_MS = 35;

const els = {
  status: document.querySelector("#status"),
  captureBtn: document.querySelector("#captureBtn"),
  burstBtn: document.querySelector("#burstBtn"),
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
  const confidence = Math.round((Number(guess.confidence) || 0) * 100);
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

async function analyzeImagesStream(images, notes, previewImage) {
  if (previewImage) {
    els.preview.src = previewImage;
    els.preview.style.display = "block";
  } else {
    els.preview.removeAttribute("src");
    els.preview.style.display = "none";
  }

  setStatus("正在识图…");
  els.place.innerHTML = '<span class="muted">分析中…</span>';
  setText(els.details, "", true);

  const response = await fetch(`${apiBase}/api/analyze-stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images, notes })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `请求失败：${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reasonAcc = "";

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
          if (data.candidateCities && data.candidateCities.length > 0) {
            const top = data.candidateCities[0];
            renderPlaceGuess({
              country: top.country,
              countryZh: top.city,
              confidence: top.confidence,
              location: top.country || ""
            });
          }
          if (data.tags && data.tags.length) {
            setText(els.details, "线索：" + data.tags.map((t) => t.tag).join(" / "));
          }
          break;
        }

        case "guide":
          break;

        case "place": {
          renderPlaceGuess(data);
          break;
        }

        case "reason": {
          reasonAcc += data.chunk;
          els.details.textContent = reasonAcc;
          els.details.className = "details";
          break;
        }

        case "done": {
          if (data.placeGuess) {
            const fullResult = { placeGuess: data.placeGuess };
            const analysis = data.analysis;
            if (analysis) fullResult.tags = analysis.tags;
            renderResult(fullResult);
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
}

async function analyzeCurrentTab() {
  els.captureBtn.disabled = true;
  els.burstBtn.disabled = true;
  setStatus("正在截图…");
  setText(els.details, "正在抓取当前标签页的可见区域。", true);

  try {
    const [image] = await captureFrames(1);
    await analyzeImagesStream([image], "chrome extension capture", image);
  } catch (error) {
    setStatus("识图失败", "warning");
    setText(els.details, error.message || "出现了一个错误。");
    els.place.innerHTML = `<span class="muted">没有结果。</span>`;
  } finally {
    els.captureBtn.disabled = false;
    els.burstBtn.disabled = false;
  }
}

async function analyzeBurst() {
  els.captureBtn.disabled = true;
  els.burstBtn.disabled = true;
  setStatus("正在三连拍…");
  setText(els.details, "正在连续抓取三张图。", true);

  try {
    const images = await captureFrames(BURST_COUNT);
    const previewImage = images[0];
    await analyzeImagesStream(images, "chrome extension burst capture", previewImage);
  } catch (error) {
    setStatus("识图失败", "warning");
    setText(els.details, error.message || "出现了一个错误。");
    els.place.innerHTML = `<span class="muted">没有结果。</span>`;
  } finally {
    els.captureBtn.disabled = false;
    els.burstBtn.disabled = false;
  }
}

async function loadConfig() {
  try {
    const config = await fetchJson(`${apiBase}/api/config`);
    const label = config.vision ? `${config.provider}/${config.model}` : config.message || "视觉不可用";
    setStatus(label);
    setText(els.details, `本地服务已连接。${config.vision ? "点击按钮即可抓图识图。" : config.message || ""}`, true);
  } catch (error) {
    setStatus("本地服务未连接", "warning");
    setText(els.details, `无法连接到 ${apiBase}。先启动本地助手，再回到这里点击识图。`, true);
  }
}

async function loadSavedServerUrl() {
  apiBase = normalizeBaseUrl(await readStoredServerUrl());
  els.serverUrl.value = apiBase;
}

async function saveServerUrl() {
  apiBase = normalizeBaseUrl(els.serverUrl.value);
  els.serverUrl.value = apiBase;
  await writeStoredServerUrl(apiBase);
  setStatus("地址已保存");
  await loadConfig();
}

els.captureBtn.addEventListener("click", analyzeCurrentTab);
els.burstBtn.addEventListener("click", analyzeBurst);
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
