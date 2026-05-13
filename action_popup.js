document.getElementById("optionsLink").href = chrome.runtime.getURL("options.html");
document.getElementById("optionsLink").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

chrome.storage.sync.get("apiKey", ({ apiKey }) => {
  const el = document.getElementById("keyStatus");
  if (apiKey) {
    el.textContent = "✓ API key configured";
    el.className = "status ok";
  } else {
    el.textContent = "No API key — click Settings to add one";
    el.className = "status";
  }
});
