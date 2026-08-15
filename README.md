# Is It AI?

A Chrome extension that uses a selectable OpenRouter vision model to assess whether an image was AI-generated. Right-click any image on any page and get an instant verdict.

![Manifest Version](https://img.shields.io/badge/Manifest-V3-blue)

## How it works

1. Right-click any image on a web page
2. Select **"Check if AI-generated"**
3. A card appears over the image with a verdict, confidence score, and reasoning

Results are one of three states:

| Result | Meaning |
|---|---|
| 🤖 Likely AI-generated | High confidence the image was created by AI |
| 👤 Likely human-made | High confidence the image is a real photo or human art |
| 🤔 Uncertain | Not enough evidence to call it either way |

## Installation

This extension is not yet on the Chrome Web Store. Load it manually:

1. Clone or download this repo
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the repo folder
5. Click the extension icon and go to **OpenRouter Settings** to add your API key and select a vision model

## API key setup

Is It AI? uses the [OpenRouter API](https://openrouter.ai/) so you can choose from currently available image-capable models through one API key.

1. Create a key in [OpenRouter settings](https://openrouter.ai/settings/keys)
2. Click the **Is It AI?** toolbar icon → **OpenRouter Settings**
3. Paste your key, choose a vision model, and click **Save OpenRouter settings**

The searchable model dropdown refreshes from OpenRouter's live catalog, alphabetizes results by display name, and only includes models that accept image input, return text, and advertise structured-output support. **OpenRouter Auto** is the default and lets OpenRouter route each request to an appropriate model.

Every analysis requires a strict JSON schema for `verdict`, `confidence`, and `reasoning`. Provider routing uses `require_parameters: true`, preventing providers that cannot enforce the schema from silently ignoring it.

Before sending an image to OpenRouter, the extension also checks embedded PNG/JPEG metadata for explicit generator names and Stable Diffusion generation parameters. A match produces a local high-confidence AI result. C2PA/Content Credentials markers are recognized but do not count as AI evidence by themselves, and the extension does not claim to cryptographically validate a C2PA manifest.

For images without generator metadata, the vision prompt combines multiple forensic signals and no longer defaults uncertain images to human-made merely because classic hand or text defects are absent. Pixel-only detection remains probabilistic, especially after a site strips metadata or an invisible model-specific watermark cannot be read by the selected vision model.

Transient OpenRouter `429` and `503` responses receive one bounded retry. The entire OpenRouter operation times out after 25 seconds, image downloads time out after 10 seconds, and images larger than 15 MB are rejected with a visible message instead of leaving the loading overlay indefinitely.

## Permissions

| Permission | Reason |
|---|---|
| `contextMenus` | Adds the right-click menu item on images |
| `storage` | Saves your OpenRouter API key and selected model in Chrome sync storage |
| `activeTab` | Reads the clicked image URL |
| `scripting` | Injects the result overlay into the page |
| `host_permissions: <all_urls>` | Fetches images from any domain and accesses OpenRouter's API/model catalog |

## Privacy

- Your OpenRouter API key is stored in Chrome sync storage and sent only to OpenRouter for authenticated requests
- Images are sent directly from your browser to OpenRouter and the selected model provider for analysis
- OpenRouter/model-provider pricing and data policies depend on the selected model and endpoint
- No data is collected or stored by this extension

## Tech stack

- Chrome Extension Manifest V3
- OpenRouter Chat Completions API with live image-capable model discovery
- Vanilla JS, no build step required

## License

MIT
