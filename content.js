// Map from image src → overlay element, so we can update it in place
const overlays = new Map();

window.__isitai_showLoading = function (imageUrl) {
  const img = findImage(imageUrl);
  removeOverlay(imageUrl);

  const overlay = createOverlay();
  overlay.innerHTML = `
    <div class="isitai-card isitai-loading">
      <div class="isitai-spinner"></div>
      <span>Analyzing…</span>
    </div>
  `;
  attachOverlay(img, overlay, imageUrl);
};

window.__isitai_showResult = function (imageUrl, result, error) {
  const img = findImage(imageUrl);
  removeOverlay(imageUrl);

  const overlay = createOverlay();

  if (error === "no-key") {
    overlay.innerHTML = `
      <div class="isitai-card isitai-error">
        <div class="isitai-icon">🔑</div>
        <div class="isitai-message">No API key set.</div>
        <a class="isitai-link" href="${chrome.runtime.getURL("options.html")}" target="_blank">Open settings</a>
        <button class="isitai-close">✕</button>
      </div>
    `;
  } else if (error) {
    overlay.innerHTML = `
      <div class="isitai-card isitai-error">
        <div class="isitai-icon">⚠️</div>
        <div class="isitai-message">Error: ${escHtml(error)}</div>
        <button class="isitai-close">✕</button>
      </div>
    `;
  } else {
    // Gemini returns {verdict, confidence, reasoning}
    const verdict = result?.verdict ?? "unknown";
    const confidence = result?.confidence ?? 0;
    const reasoning = result?.reasoning ?? "";

    const isAI = verdict === "ai";
    const uncertain = confidence < 0.7;
    const pct = Math.round(confidence * 100);
    const label = uncertain
      ? "Uncertain"
      : isAI ? "Likely AI-generated" : "Likely human-made";
    const icon = uncertain ? "🤔" : isAI ? "🤖" : "👤";
    const cls = uncertain ? "isitai-uncertain" : isAI ? "isitai-ai" : "isitai-human";

    overlay.innerHTML = `
      <div class="isitai-card ${cls}">
        <div class="isitai-icon">${icon}</div>
        <div class="isitai-label">${label}</div>
        <div class="isitai-bar-wrap">
          <div class="isitai-bar" style="width:${pct}%"></div>
        </div>
        <div class="isitai-pct">${pct}% confidence</div>
        ${reasoning ? `<div class="isitai-reasoning">${escHtml(reasoning)}</div>` : ""}
        <button class="isitai-close">✕</button>
      </div>
    `;
  }

  overlay.querySelector(".isitai-close")?.addEventListener("click", () => {
    removeOverlay(imageUrl);
  });

  attachOverlay(img, overlay, imageUrl);
};

function findImage(imageUrl) {
  // Decode URL for comparison since attribute values may be decoded
  const decoded = decodeURIComponent(imageUrl);
  return (
    document.querySelector(`img[src="${CSS.escape(imageUrl)}"]`) ||
    document.querySelector(`img[src="${CSS.escape(decoded)}"]`) ||
    [...document.querySelectorAll("img")].find(
      (el) => el.src === imageUrl || el.src === decoded || el.currentSrc === imageUrl
    ) ||
    null
  );
}

function createOverlay() {
  const el = document.createElement("div");
  el.className = "isitai-overlay";
  return el;
}

function attachOverlay(img, overlay, imageUrl) {
  overlays.set(imageUrl, overlay);

  if (img) {
    const rect = img.getBoundingClientRect();
    overlay.style.position = "fixed";
    overlay.style.top = `${rect.top}px`;
    overlay.style.left = `${rect.left}px`;
    overlay.style.width = `${Math.max(rect.width, 200)}px`;
    overlay.style.zIndex = "2147483647";
    document.body.appendChild(overlay);
  } else {
    // Fallback: corner toast
    overlay.style.position = "fixed";
    overlay.style.bottom = "20px";
    overlay.style.right = "20px";
    overlay.style.zIndex = "2147483647";
    document.body.appendChild(overlay);
  }
}

function removeOverlay(imageUrl) {
  const existing = overlays.get(imageUrl);
  if (existing) {
    existing.remove();
    overlays.delete(imageUrl);
  }
}

function escHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
