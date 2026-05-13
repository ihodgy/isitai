const input = document.getElementById("apiKey");
const status = document.getElementById("status");

chrome.storage.sync.get("apiKey", ({ apiKey }) => {
  if (apiKey) input.value = apiKey;
});

document.getElementById("save").addEventListener("click", () => {
  const key = input.value.trim();
  if (!key) {
    show("Please enter an API key.", false);
    return;
  }
  chrome.storage.sync.set({ apiKey: key }, () => {
    show("Saved!", true);
  });
});

function show(msg, ok) {
  status.textContent = msg;
  status.className = "status " + (ok ? "ok" : "err");
  setTimeout(() => { status.textContent = ""; status.className = "status"; }, 3000);
}
