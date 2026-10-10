# Listing Finder

Upload a photo someone has taken and posted somewhere, and find **the listings that use that exact photo**
on eBay Australia and Facebook (plus any other site Google has seen it on).

How it works:

1. **Google Lens** (through SerpApi, set to Australia) finds pages showing images like yours, including
   eBay listings and Facebook / Marketplace posts.
2. The item's name is worked out from those matches and used to pull up to 200 current **eBay AU listings**
   (items located in Australia, via SerpApi's eBay search).
3. Every result's photo is checked against yours with a strict **identical-photo** test: same picture,
   background and framing, allowing for resizing, recompression, slight cropping (up to ~8% per edge) and
   square thumbnails. Matches appear at the top as soon as they're found.
4. Everything else is hidden by default. Tick **Show similar items too** to see listings of the same item.

Google's own "exact match" label isn't used: in testing it flagged hundreds of pages showing the same
card, not the same photo. eBay listings Google finds on other eBay sites (e.g. ebay.com) link to the same
listing on ebay.com.au, and photos found on non-Australian sites are only shown when they're the exact photo.

One-click buttons open **eBay AU sold**, **eBay AU for sale** and **Facebook Marketplace** searches for the
item name in your own browser (eBay set to items in Australia, Marketplace set to the city you pick).
Edit the name if it's off.

For Marketplace you can also type a **postcode**. Facebook's links can't take a postcode, so it's looked up
(OpenStreetMap) and the nearest Marketplace city is used: capitals plus Gold Coast, Newcastle, Wollongong,
Geelong, Townsville, Cairns, Toowoomba, Ballarat, Bendigo and Launceston. The page shows which city it picked.

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
- The identical-photo check: tested on 25 eBay photos, resized copies, copies cropped up to 8% per edge
  and squared-off copies all matched; 1 of 300 pairs of *different* photos also matched (the same seller
  photographing two near-identical cards the same way). Heavier crops or screenshots with extra borders
  may be missed, so upload the original photo where you can.
- Only photos Google has indexed, or eBay AU listings found by the item's name, can be checked. A listing
  under a very different name, or a Facebook post Google hasn't seen, won't be found.
- Privacy: your photo is uploaded to SerpApi, which deletes it after 10 minutes. A postcode you enter is
  looked up with OpenStreetMap.

## Files

| File | What it does |
| --- | --- |
| `server.py` | Local web server: Google Lens and eBay searches through SerpApi, image proxy |
| `index.html`, `style.css`, `app.js` | The web page: upload, group results, compare photos |
| `install.bat` / `start.bat` | One-time install / start the app |
| `config.example.json` | Template for `config.json` (your SerpApi key) |
