# Listing Finder

Drop in a photo of an item and find **the same item** listed on:

- **eBay Australia: for sale now** (eBay's own image search API)
- **eBay Australia: sold / ended** (Google Lens results on ebay.com.au that aren't live listings)
- **Facebook & Facebook Marketplace** (Google Lens results on facebook.com)

Every result's photo is compared with yours and labelled **Same photo / Very similar / Similar**,
closest first. There are also one-click **eBay AU sold**, **eBay AU for sale** and
**Facebook Marketplace** searches, pre-filled with the best match's name. You can edit the name.

Runs on Windows with nothing to install: a small PowerShell server plus a web page.

## Setup (once)

1. **eBay API keys** (free):
   - Sign up at <https://developer.ebay.com/>, then go to *Application Keys* and create a **Production** keyset.
   - Copy the **App ID (Client ID)** and **Cert ID (Client Secret)**.
2. **Google Lens keys** (needed for sold listings and Facebook):
   - **SerpApi** (<https://serpapi.com/>): the free plan includes 250 searches/month. Copy your API key.
     Each photo you search uses 2 SerpApi searches.
   - **imgbb** (<https://api.imgbb.com/>): free. Google Lens needs a public image link, so your
     photo is uploaded to imgbb and **automatically deleted after 10 minutes**.
3. Copy `config.example.json` to `config.json` and paste in your keys.
   `config.json` is git-ignored, so your keys are never committed.

You can skip either set of keys. The app will search with whatever is configured.

## Run

Double-click **`start.bat`**, or run:

```
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Then open <http://localhost:8765>. Choose an image, drag one in, or paste one with Ctrl+V.

## Limitations

- **eBay sold listings:** eBay has no public API for sold items, and it blocks automated
  requests to its sold-search page. Sold results come from pages Google has indexed. The
  **eBay AU sold** button opens eBay's real sold search for the item name.
- **Facebook Marketplace:** Marketplace needs a login and has no public API, so only
  listings Google has indexed appear (often few). The **Facebook Marketplace** button opens a
  Marketplace search in your browser, where you're already logged in.
- The photo match score is a quick visual fingerprint. It's very good at "same photo,
  resized" but weaker for different photos of the same item. Use Google's
  "exact match" badge and your eye for those.

## Files

| File | What it does |
| --- | --- |
| `serve.ps1` | Local server: serves the page and calls eBay / imgbb / SerpApi with your keys |
| `index.html`, `style.css`, `app.js` | The web page: upload, sort results, compare photos |
| `config.example.json` | Template for `config.json` (your keys) |
| `start.bat` | Starts the server and opens the page |
