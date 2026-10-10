# Listing Finder

Drop in a photo of an item and find **the same item** on eBay Australia and Facebook. Everything is
limited to Australia: Google Lens runs as Australia, eBay results are only items located in Australia,
and other sites are only Australian (.au) ones.

How it works:

1. **Google Lens** (through SerpApi, set to Australia) finds pages showing the same image, including
   eBay AU listings and Facebook / Marketplace posts.
2. The item's name is worked out from those matches and used to search **eBay AU's current listings**
   (SerpApi's eBay search).
3. Every result's photo is compared with yours and labelled **Same photo / Very similar / Similar**,
   closest first. Google's own **exact match** results are marked too.

Results are grouped into **eBay AU: for sale now**, **eBay AU: sold or ended** (eBay pages showing
your image that aren't live any more), **Facebook & Marketplace**, and **Other Australian sites**.

One-click buttons open **eBay AU sold**, **eBay AU for sale** and **Facebook Marketplace** searches for
the item name in your own browser (eBay set to items in Australia, Marketplace set to the city you pick).
Edit the name if it's off.

## Setup (once)

1. **Install Python** from <https://www.python.org/downloads/> and tick **"Add python.exe to PATH"**.
2. **Get a SerpApi key** (free, no credit card): sign up at <https://serpapi.com/> and copy your API key.
   The free plan includes 250 searches/month. Each photo uses 3 (about 80 photos/month), and
   re-searching eBay by name uses 1.
3. Double-click **`install.bat`**. It installs the two Python packages and creates `config.json`.
4. Open `config.json` and paste in your key: `"serpApiKey": "abc123..."`.
   `config.json` is git-ignored, so your key is never committed.

## Run

Double-click **`start.bat`** (or run `python server.py`), then use <http://localhost:8765>.
Choose an image, drag one in, or paste one with Ctrl+V.

## Limits

- **eBay sold:** eBay has no public API for sold items, and its sold search needs a login and blocks
  automated browsers. So the app only shows sold/ended eBay pages that Google Lens finds. The
  **eBay AU sold** button opens the full sold search in your browser.
- **Facebook Marketplace:** it needs a login and has no public API, so only posts Google has indexed
  appear, and Facebook doesn't show where a post is from, so these can include overseas posts. The
  **Facebook Marketplace** button opens a live search in your chosen Australian city.
- The photo match score is a quick visual fingerprint. It's very good at "same photo, resized"
  but weaker for different photos of the same item.
- Privacy: your photo is uploaded to SerpApi, which deletes it after 10 minutes.

## Files

| File | What it does |
| --- | --- |
| `server.py` | Local web server: Google Lens and eBay searches through SerpApi, image proxy |
| `index.html`, `style.css`, `app.js` | The web page: upload, group results, compare photos |
| `install.bat` / `start.bat` | One-time install / start the app |
| `config.example.json` | Template for `config.json` (your SerpApi key) |
