const MODELS_URL =
  "https://openrouter.ai/api/v1/models?input_modalities=image&output_modalities=text&supported_parameters=structured_outputs";
const DEFAULT_VISION_MODEL = "openrouter/auto";
const MODEL_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

const input = document.getElementById("apiKey");
const modelSearch = document.getElementById("modelSearch");
const modelSelect = document.getElementById("visionModel");
const modelStatus = document.getElementById("modelStatus");
const refreshButton = document.getElementById("refreshModels");
const status = document.getElementById("status");

let savedModel = DEFAULT_VISION_MODEL;
let availableModels = [];

initialize();

async function initialize() {
  try {
    const settings = await chrome.storage.sync.get([
      "openRouterApiKey",
      "visionModel",
      "visionModelSupportsStructuredOutputs",
    ]);
    if (settings.openRouterApiKey) input.value = settings.openRouterApiKey;
    savedModel = settings.visionModelSupportsStructuredOutputs
      ? settings.visionModel || DEFAULT_VISION_MODEL
      : DEFAULT_VISION_MODEL;
  } catch (error) {
    show(`Could not read settings: ${errorMessage(error)}`, false);
  }

  await loadModels();
}

refreshButton.addEventListener("click", loadModels);
modelSearch.addEventListener("input", () => {
  const matchCount = renderModels();
  if (availableModels.length) updateModelStatus(matchCount);
});

document.getElementById("save").addEventListener("click", async () => {
  const openRouterApiKey = input.value.trim();
  const visionModel = modelSelect.value || DEFAULT_VISION_MODEL;

  if (!openRouterApiKey) {
    show("Please enter an OpenRouter API key.", false);
    return;
  }

  try {
    await chrome.storage.sync.set({
      openRouterApiKey,
      visionModel,
      visionModelSupportsStructuredOutputs: true,
    });
    savedModel = visionModel;
    show("OpenRouter settings saved.", true);
  } catch (error) {
    show(`Could not save settings: ${errorMessage(error)}`, false);
  }
});

async function loadModels() {
  refreshButton.disabled = true;
  modelSelect.disabled = true;
  modelStatus.textContent = "Loading structured-output vision models…";

  try {
    const response = await fetch(MODELS_URL);
    if (!response.ok) throw new Error(`OpenRouter returned HTTP ${response.status}`);

    const json = await response.json();
    availableModels = (Array.isArray(json.data) ? json.data : [])
      .filter(isVisionModel)
      .filter((model) => !isExpired(model))
      .sort(compareModels);

    const matchCount = renderModels();
    updateModelStatus(matchCount);
  } catch (error) {
    availableModels = [];
    renderModels();
    modelStatus.textContent = `Could not refresh models; using the saved/default selection. ${errorMessage(error)}`;
  } finally {
    modelSelect.disabled = false;
    refreshButton.disabled = false;
  }
}

function renderModels() {
  const currentSelection = modelSelect.value || savedModel;
  const query = modelSearch.value.trim().toLocaleLowerCase();
  const models = query
    ? availableModels.filter((model) => matchesSearch(model, query))
    : availableModels;

  modelSelect.textContent = "";
  const autoMatches = !query || "openrouter auto openrouter/auto".includes(query);
  if (autoMatches) {
    modelSelect.append(new Option("OpenRouter Auto — recommended", DEFAULT_VISION_MODEL));
  }

  const seen = new Set(autoMatches ? [DEFAULT_VISION_MODEL] : []);
  const group = document.createElement("optgroup");
  group.label = "Structured-output vision models — alphabetical";

  for (const model of models) {
    if (!model?.id || seen.has(model.id)) continue;
    seen.add(model.id);
    group.append(new Option(modelLabel(model), model.id));
  }

  if (group.children.length) modelSelect.append(group);

  if (!query && !seen.has(savedModel)) {
    modelSelect.append(new Option(`${savedModel} — saved selection`, savedModel));
    seen.add(savedModel);
  }

  if (!seen.size) {
    const emptyOption = new Option("No matching vision models", "");
    emptyOption.disabled = true;
    modelSelect.append(emptyOption);
  }

  if (seen.has(currentSelection)) {
    modelSelect.value = currentSelection;
  } else if (seen.has(savedModel)) {
    modelSelect.value = savedModel;
  } else {
    modelSelect.value = seen.values().next().value || "";
  }

  return models.length;
}

function compareModels(a, b) {
  const byName = MODEL_COLLATOR.compare(a.name || a.id, b.name || b.id);
  return byName || MODEL_COLLATOR.compare(a.id, b.id);
}

function matchesSearch(model, query) {
  return `${model.name || ""} ${model.id || ""}`.toLocaleLowerCase().includes(query);
}

function updateModelStatus(matchCount) {
  if (modelSearch.value.trim()) {
    modelStatus.textContent = `${matchCount} of ${availableModels.length} compatible vision models match`;
  } else {
    modelStatus.textContent = `${availableModels.length} structured-output vision models — alphabetical`;
  }
}

function isVisionModel(model) {
  const inputModalities = model?.architecture?.input_modalities;
  const outputModalities = model?.architecture?.output_modalities;
  const supportedParameters = model?.supported_parameters;
  return Array.isArray(inputModalities) &&
    inputModalities.includes("image") &&
    (!Array.isArray(outputModalities) || outputModalities.includes("text")) &&
    Array.isArray(supportedParameters) &&
    supportedParameters.includes("structured_outputs");
}

function isExpired(model) {
  if (!model?.expiration_date) return false;
  const expiration = Date.parse(model.expiration_date);
  return Number.isFinite(expiration) && expiration <= Date.now();
}

function modelLabel(model) {
  const name = model.name || model.id;
  const price = pricingLabel(model.pricing);
  return price ? `${name} — ${model.id} — ${price}` : `${name} — ${model.id}`;
}

function pricingLabel(pricing) {
  const inputPerMillion = perMillion(pricing?.prompt);
  const outputPerMillion = perMillion(pricing?.completion);

  if (inputPerMillion === 0 && outputPerMillion === 0) return "free";
  if (inputPerMillion === null && outputPerMillion === null) return "";

  const inputPrice = inputPerMillion === null ? "?" : formatPrice(inputPerMillion);
  const outputPrice = outputPerMillion === null ? "?" : formatPrice(outputPerMillion);
  return `$${inputPrice}/M input · $${outputPrice}/M output`;
}

function perMillion(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number * 1_000_000 : null;
}

function formatPrice(value) {
  if (value === 0) return "0";
  if (value < 0.01) return value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  if (value < 1) return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return value.toFixed(2).replace(/\.00$/, "");
}

function show(message, ok) {
  status.textContent = message;
  status.className = `status ${ok ? "ok" : "err"}`;
  setTimeout(() => {
    status.textContent = "";
    status.className = "status";
  }, 4000);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
