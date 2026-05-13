const MENU_ITEM_ID = "isitai-check";

// Update this string if Google releases a newer model ID
const GEMINI_MODEL = "gemini-3-flash-preview";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const DETECTION_PROMPT = `You are an expert forensic analyst specializing in AI-generated image detection. Analyze this image carefully.

IMPORTANT BIAS CORRECTION: You have a tendency to over-call images as AI-generated. Counteract this.
Professional photography, studio portraits, digital art, 3D renders, stock photos, and heavily edited
images are NOT AI-generated. Only call something AI if you find specific, hard evidence.

Hard evidence of AI generation (require at least one):
- Anatomical impossibilities: wrong number of fingers/teeth, merged or extra limbs, impossible joint angles
- Text artifacts: garbled, floating, nonsensical, or morphing letters within the image
- Physical impossibilities: objects that violate gravity or perspective in surreal ways
- Background incoherence: repeating patterns, objects that dissolve or merge into surroundings
- Known AI watermarks or signatures visible in the image
- Facial asymmetry combined with waxy or pore-less skin AND unnatural catchlights simultaneously

NOT sufficient evidence on its own (do not use these alone):
- Image looks "too perfect" or "too clean"
- Smooth skin (could be studio lighting, makeup, or retouching)
- Vivid or dramatic colors (could be editing or HDR)
- Surreal or artistic style (could be intentional art direction)
- Photorealistic quality (cameras and skilled photographers can achieve this)
- Subject is attractive or idealized

Default to "human" when uncertain. Only use "ai" when you have concrete, specific evidence from the hard evidence list above.
Set confidence below 0.7 if you have any doubt.

Respond ONLY with a JSON object — no markdown, no extra text:
{"verdict":"ai","confidence":0.95,"reasoning":"Cite the specific artifact you found, e.g. 'Left hand has 7 fingers and text in background is garbled.'"}
verdict must be exactly "ai" or "human". confidence is 0.0–1.0.`;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ITEM_ID,
    title: "Check if AI-generated",
    contexts: ["image"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ITEM_ID) return;

  const imageUrl = info.srcUrl;
  if (!imageUrl) return;

  // Tell the content script to show a loading overlay on the clicked image
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: showLoadingOverlay,
    args: [imageUrl],
  });

  const { apiKey } = await chrome.storage.sync.get("apiKey");

  if (!apiKey) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showResultOverlay,
      args: [imageUrl, null, "no-key"],
    });
    return;
  }

  try {
    const result = await checkImage(imageUrl, apiKey);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showResultOverlay,
      args: [imageUrl, result, null],
    });
  } catch (err) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: showResultOverlay,
      args: [imageUrl, null, err.message],
    });
  }
});

async function checkImage(imageUrl, apiKey) {
  // Fetch the image and convert to base64 for Gemini inline data
  let base64, mimeType;

  if (imageUrl.startsWith("data:")) {
    // Already a data URL — split it apart
    const [header, data] = imageUrl.split(",");
    mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
    base64 = data;
  } else {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) throw new Error(`Could not fetch image (HTTP ${imgRes.status})`);
    const blob = await imgRes.blob();
    mimeType = blob.type || "image/jpeg";

    // Safe base64 encoding that handles large buffers without stack overflow
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    base64 = btoa(binary);
  }

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64 } },
          { text: DETECTION_PROMPT },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  const raw = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty response from Gemini");

  // Gemini sometimes wraps JSON in markdown fences even with responseMimeType set
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned);

  if (!parsed.verdict || !["ai", "human"].includes(parsed.verdict)) {
    throw new Error("Unexpected response shape from Gemini");
  }
  return parsed;
}

// These functions are serialized and injected into the page tab —
// they cannot close over background scope variables.

function showLoadingOverlay(imageUrl) {
  window.__isitai_showLoading?.(imageUrl);
}

function showResultOverlay(imageUrl, result, error) {
  window.__isitai_showResult?.(imageUrl, result, error);
}
