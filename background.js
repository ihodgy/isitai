const MENU_ITEM_ID = "isitai-check";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_VISION_MODEL = "openrouter/auto";
const RETRYABLE_STATUSES = new Set([429, 503]);
const MAX_REQUEST_ATTEMPTS = 2;
const MAX_AUTO_RETRY_DELAY_MS = 2_000;
const OPENROUTER_TIMEOUT_MS = 25_000;
const IMAGE_DOWNLOAD_TIMEOUT_MS = 10_000;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DETECTION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "image_authenticity_assessment",
    strict: true,
    schema: {
      type: "object",
      properties: {
        verdict: {
          type: "string",
          enum: ["ai", "human"],
          description: "Whether the image is more likely AI-generated or human-created.",
        },
        confidence: {
          type: "number",
          minimum: 0,
          maximum: 1,
          description: "Confidence in the verdict from 0 to 1.",
        },
        reasoning: {
          type: "string",
          description: "A concise description of the specific visual evidence.",
        },
      },
      required: ["verdict", "confidence", "reasoning"],
      additionalProperties: false,
    },
  },
};

const DETECTION_PROMPT = `You are a careful image-forensics analyst. Estimate whether this image is more likely AI-generated or human-created. Modern generators often produce clean images without classic finger or text defects, so the absence of a single obvious mistake is not evidence that an image is human-made.

Evaluate the whole image and combine independent signals, including:
- inconsistent anatomy, object geometry, perspective, scale, shadows, reflections, lighting, or occlusion
- boundaries where hair, jewelry, clothing, hands, or objects merge, disappear, or change structure
- locally repeated micro-patterns, texture/detail collapse, implausible fine detail, or inconsistent depth of field
- malformed typography, symbols, architecture, background objects, or semantic relationships
- generation-like visual regularities across faces, skin, catchlights, foliage, fabric, and background detail
- visible generator labels, watermarks, or Content Credentials that explicitly identify AI generation

Do not treat beauty, smooth skin, vivid color, dramatic lighting, photorealism, digital art, 3D rendering, retouching, or an unusual style as proof by themselves. Conversely, do not require an anatomical impossibility or visible watermark before choosing "ai". Weigh multiple moderate signals when no single decisive artifact exists.

Choose the more likely source even when uncertain, and express uncertainty through confidence:
- 0.50–0.59: essentially uncertain
- 0.60–0.74: tentative, with limited or mixed evidence
- 0.75–0.89: multiple consistent signals or one strong signal
- 0.90–1.00: decisive visual or provenance evidence

Respond ONLY with a JSON object — no markdown, no extra text:
{"verdict":"ai","confidence":0.82,"reasoning":"Briefly cite the strongest specific signals and any important counterevidence."}
verdict must be exactly "ai" or "human". confidence is 0.0–1.0.`;

const GENERATOR_METADATA_MARKERS = [
  ["Adobe Firefly", ["adobe firefly"]],
  ["Automatic1111", ["automatic1111", "stable-diffusion-webui"]],
  ["ComfyUI", ["comfyui"]],
  ["DALL-E", ["dall-e", "dall·e"]],
  ["Fooocus", ["fooocus"]],
  ["Ideogram", ["ideogram ai", "ideogram.ai"]],
  ["InvokeAI", ["invokeai"]],
  ["Leonardo AI", ["leonardo.ai", "leonardo ai"]],
  ["Midjourney", ["midjourney"]],
  ["NovelAI", ["novelai"]],
  ["OpenAI image generation", ["openai image generation", "gpt-image-1"]],
  ["Recraft", ["recraft.ai"]],
  ["Stable Diffusion", ["stable diffusion", "stablediffusion"]],
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ITEM_ID,
      title: "Check if AI-generated",
      contexts: ["image"],
    });
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.action === "openOptions") chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ITEM_ID) return;

  const imageUrl = info.srcUrl;
  const tabId = tab?.id;
  if (!imageUrl || !Number.isInteger(tabId)) return;

  // Covers tabs that were open before the extension was installed or reloaded.
  // A tab can disappear or navigate between any two awaited calls, so treat script
  // injection failure as an expected race instead of recording an extension error.
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["overlay.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch (_error) {
    return;
  }

  if (!(await executeInTab(tabId, showLoadingOverlay, [imageUrl]))) return;

  let openRouterApiKey;
  let visionModel;
  let visionModelSupportsStructuredOutputs;
  try {
    ({ openRouterApiKey, visionModel, visionModelSupportsStructuredOutputs } = await chrome.storage.sync.get([
      "openRouterApiKey",
      "visionModel",
      "visionModelSupportsStructuredOutputs",
    ]));
  } catch (error) {
    await executeInTab(tabId, showResultOverlay, [
      imageUrl,
      null,
      `Could not read settings: ${errorMessage(error)}`,
    ]);
    return;
  }

  if (!openRouterApiKey) {
    await executeInTab(tabId, showResultOverlay, [imageUrl, null, "no-key"]);
    return;
  }

  let result = null;
  let errorMsg = null;
  const selectedVisionModel = visionModelSupportsStructuredOutputs && visionModel
    ? visionModel
    : DEFAULT_VISION_MODEL;
  try {
    result = await checkImage(
      imageUrl,
      openRouterApiKey,
      selectedVisionModel
    );
  } catch (error) {
    errorMsg = errorMessage(error);
  }

  // If the tab navigated while OpenRouter was working, there is nowhere to show the
  // result. This is normal and should not create a Chrome "Extension Error".
  await executeInTab(tabId, showResultOverlay, [imageUrl, result, errorMsg]);
});

async function executeInTab(tabId, func, args) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func, args });
    return true;
  } catch (_error) {
    return false;
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function checkImage(imageUrl, apiKey, visionModel) {
  // Fetch the image and convert it to a data URL accepted by OpenRouter vision models.
  let base64, mimeType, imageBytes;

  if (imageUrl.startsWith("data:")) {
    // Already a data URL — decode it once so we can inspect embedded provenance.
    const separator = imageUrl.indexOf(",");
    if (separator < 0) throw new Error("Invalid image data URL");
    const header = imageUrl.slice(0, separator);
    const data = imageUrl.slice(separator + 1);
    mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
    if (/;base64(?:;|$)/i.test(header)) {
      base64 = data.replace(/\s/g, "");
      imageBytes = base64ToBytes(base64);
    } else {
      imageBytes = new TextEncoder().encode(decodeURIComponent(data));
      base64 = arrayBufferToBase64(imageBytes);
    }
    if (imageBytes.byteLength > MAX_IMAGE_BYTES) throw imageTooLargeError();
  } else {
    const blob = await fetchImageBlob(imageUrl);
    if (blob.size > MAX_IMAGE_BYTES) throw imageTooLargeError();
    mimeType = blob.type || "image/jpeg";

    const buffer = await blob.arrayBuffer();
    imageBytes = new Uint8Array(buffer);
    base64 = arrayBufferToBase64(buffer);
  }

  const metadata = inspectEmbeddedMetadata(imageBytes);
  if (metadata.generators.length > 0) {
    const generatorList = metadata.generators.join(", ");
    const c2paNote = metadata.hasC2paMarker ? " A C2PA/Content Credentials marker is also present." : "";
    return {
      verdict: "ai",
      confidence: 0.98,
      reasoning: `Embedded generator metadata identifies ${generatorList}.${c2paNote} This is strong file-level provenance, though the extension has not cryptographically validated it.`,
    };
  }

  const imageDataUrl = `data:${mimeType};base64,${base64}`;

  const request = {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "X-OpenRouter-Metadata": "enabled",
      "X-OpenRouter-Title": "Is It AI?",
    },
    body: JSON.stringify({
      model: visionModel,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: DETECTION_PROMPT },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      }],
      response_format: DETECTION_RESPONSE_FORMAT,
      provider: {
        allow_fallbacks: true,
        require_parameters: true,
      },
    }),
  };

  const res = await fetchWithRetry(OPENROUTER_URL, request);

  if (!res.ok) {
    const detail = await responseError(res, visionModel);
    throw new Error(`OpenRouter API error ${res.status}: ${detail}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content;
  const raw = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text || "").join("")
      : "";
  if (!raw) throw new Error("Empty response from OpenRouter");

  const parsed = parseDetectionResult(raw);

  if (!parsed.verdict || !["ai", "human"].includes(parsed.verdict)) {
    throw new Error("Unexpected response shape from the selected vision model");
  }
  return parsed;
}

function parseDetectionResult(raw) {
  // Models may wrap the object in markdown or add a short preamble despite the prompt.
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (_error) {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw new Error("The selected vision model did not return JSON");
  }
}

async function fetchWithRetry(url, request) {
  let lastResponse;
  let lastError;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPENROUTER_TIMEOUT_MS);

  try {
    for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
      try {
        lastResponse = await fetch(url, { ...request, signal: controller.signal });
        if (!RETRYABLE_STATUSES.has(lastResponse.status)) return lastResponse;
        if (attempt === MAX_REQUEST_ATTEMPTS - 1) return lastResponse;

        const delayMs = retryDelayMs(lastResponse, attempt);
        if (delayMs > MAX_AUTO_RETRY_DELAY_MS) return lastResponse;
        await wait(delayMs);
      } catch (error) {
        if (controller.signal.aborted) {
          throw new Error("OpenRouter request timed out after 25 seconds");
        }
        lastError = error;
        if (attempt === MAX_REQUEST_ATTEMPTS - 1) throw error;
        await wait(1_000);
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  if (lastResponse) return lastResponse;
  throw lastError || new Error("OpenRouter request failed");
}

async function fetchImageBlob(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), IMAGE_DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Could not fetch image (HTTP ${response.status})`);
    return await response.blob();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Image download timed out after 10 seconds");
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const chunks = [];
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(chunks.join(""));
}

function base64ToBytes(base64) {
  let binary;
  try {
    binary = atob(base64);
  } catch (_error) {
    throw new Error("Invalid base64 image data URL");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function inspectEmbeddedMetadata(bytes) {
  // PNG text chunks, JPEG XMP, and C2PA/JUMBF labels are stored as searchable
  // byte strings. Removing NUL bytes also makes common UTF-16 metadata searchable.
  const text = new TextDecoder("latin1").decode(bytes).replace(/\0/g, "").toLowerCase();
  const generators = [];

  for (const [name, markers] of GENERATOR_METADATA_MARKERS) {
    if (markers.some((marker) => text.includes(marker))) generators.push(name);
  }

  const hasDiffusionParameters = text.includes("steps:")
    && text.includes("sampler:")
    && (text.includes("cfg scale:") || text.includes("model hash:") || text.includes("denoising strength:"));
  if (hasDiffusionParameters && !generators.includes("Stable Diffusion")) {
    generators.push("Stable Diffusion generation parameters");
  }

  const hasC2paMarker = text.includes("c2pa") || text.includes("content credentials");
  return { generators, hasC2paMarker };
}

function imageTooLargeError() {
  return new Error("Image is larger than 15 MB; choose a smaller image");
}

function retryDelayMs(response, attempt) {
  return retryAfterHeaderMs(response) ?? 1_000 * (2 ** attempt);
}

function retryAfterHeaderMs(response) {
  const value = response.headers.get("Retry-After");
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function responseError(response, requestedModel) {
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    const error = json?.error || {};
    const metadata = error?.metadata || {};
    const routing = json?.openrouter_metadata || {};
    const selectedEndpoint = routing?.endpoints?.available?.find((endpoint) => endpoint?.selected);
    const provider = metadata.provider_name || json.provider || selectedEndpoint?.provider;
    const errorType = metadata.error_type;
    const providerCode = metadata.provider_code;
    const retryAfterMs = retryAfterHeaderMs(response);
    const details = [String(error.message || json?.message || text).slice(0, 500)];

    if (errorType) details.push(`Type: ${errorType}`);
    if (providerCode) details.push(`Provider code: ${providerCode}`);
    if (provider) details.push(`Provider: ${provider}`);
    details.push(`Model: ${routing.requested || requestedModel}`);

    if (response.status === 429) {
      if (retryAfterMs !== null && retryAfterMs > MAX_AUTO_RETRY_DELAY_MS) {
        details.push(`Retry after ${Math.ceil(retryAfterMs / 1_000)}s`);
      } else {
        details.push("Rate limited after an automatic retry; try again or choose OpenRouter Auto/another model");
      }
    }

    return details.join(" · ");
  } catch (_error) {
    return text.slice(0, 500) || response.statusText || "Unknown error";
  }
}

// These functions are serialized and injected into the page tab —
// they cannot close over background scope variables.

function showLoadingOverlay(imageUrl) {
  window.__isitai_showLoading?.(imageUrl);
}

function showResultOverlay(imageUrl, result, error) {
  window.__isitai_showResult?.(imageUrl, result, error);
}
