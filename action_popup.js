document.getElementById("optionsLink").href = chrome.runtime.getURL("options.html");
document.getElementById("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.storage.sync.get(
  ["openRouterApiKey", "visionModel", "visionModelSupportsStructuredOutputs"],
  ({ openRouterApiKey, visionModel, visionModelSupportsStructuredOutputs }) => {
  const el = document.getElementById("keyStatus");
  if (openRouterApiKey) {
    const activeModel = visionModelSupportsStructuredOutputs && visionModel
      ? visionModel
      : "openrouter/auto";
    el.textContent = `✓ OpenRouter configured\n${activeModel}`;
    el.className = "status ok";
  } else {
    el.textContent = "No OpenRouter key — click Settings to add one";
    el.className = "status";
  }
  }
);
