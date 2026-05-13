# Is It AI?

A Chrome extension that uses Google Gemini to detect whether an image was AI-generated. Right-click any image on any page and get an instant verdict.

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
5. Click the extension icon and go to **Settings** to add your API key

## API key setup

Is It AI? uses the [Google Gemini API](https://ai.google.dev/). The free tier is sufficient for personal use — no credit card required.

1. Get a free key at [Google AI Studio](https://aistudio.google.com/apikey)
2. Click the **Is It AI?** toolbar icon → **Settings / API Key**
3. Paste your key and click **Save**

## Permissions

| Permission | Reason |
|---|---|
| `contextMenus` | Adds the right-click menu item on images |
| `storage` | Saves your API key locally |
| `activeTab` | Reads the clicked image URL |
| `scripting` | Injects the result overlay into the page |
| `host_permissions: <all_urls>` | Fetches images from any domain to send to Gemini |

## Privacy

- Your API key is stored locally in Chrome sync storage and never sent anywhere except Google's Gemini API
- Images are sent directly from your browser to the Gemini API for analysis
- No data is collected or stored by this extension

## Tech stack

- Chrome Extension Manifest V3
- Google Gemini API (`gemini-3-flash-preview`) via the Generative Language REST API
- Vanilla JS, no build step required

## License

MIT
