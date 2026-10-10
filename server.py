"""Listing Finder local server: http://localhost:8765

    python server.py            start the app

Endpoints used by app.js:
    GET  /api/status
    POST /api/lens         {image: <base64 jpeg>}  Google Lens via SerpApi (country=au)
    GET  /api/ebay?q=      eBay AU current listings located in Australia, via SerpApi's eBay engine
    GET  /api/postcode?pc= Australian postcode -> place and coordinates (OpenStreetMap)
    GET  /api/img?url=     image proxy so the page can compare thumbnails
"""
import base64
import json
import re
from pathlib import Path

import requests
from flask import Flask, Response, jsonify, request, send_from_directory

ROOT = Path(__file__).parent
PORT = 8765
STATIC = {"index.html", "app.js", "style.css"}
app = Flask(__name__, static_folder=None)


def config():
    path = ROOT / "config.json"
    cfg = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    key = cfg.get("serpApiKey", "")
    return {"serpApiKey": "" if key.startswith("YOUR_") else key}


class ApiError(Exception):
    pass


@app.errorhandler(ApiError)
def api_error(e):
    print("Error:", e)
    return jsonify(error=str(e)), 502


def serpapi(params):
    key = config()["serpApiKey"]
    if not key:
        raise ApiError("SerpApi key not set in config.json")
    r = requests.get("https://serpapi.com/search.json", params={**params, "api_key": key}, timeout=60)
    data = r.json()
    error = data.get("error", "")
    if error and "returned any results" not in error:  # "no results" is not a failure
        raise ApiError(error)
    return data


@app.get("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.get("/<name>")
def static_file(name):
    if name not in STATIC:
        return "", 404
    return send_from_directory(ROOT, name, max_age=0)


@app.get("/api/status")
def status():
    return jsonify(serpapi=bool(config()["serpApiKey"]))


@app.post("/api/lens")
def lens():
    key = config()["serpApiKey"]
    if not key:
        raise ApiError("SerpApi key not set in config.json")
    image = base64.b64decode(request.json["image"])
    # Upload to SerpApi (kept for 10 minutes), then search Lens with the image_id
    up = requests.post("https://serpapi.com/image", data={"api_key": key},
                       files={"image": ("photo.jpg", image, "image/jpeg")}, timeout=60).json()
    if "image_id" not in up:
        raise ApiError(up.get("error", "Image upload to SerpApi failed"))
    base = {"engine": "google_lens", "image_id": up["image_id"], "country": "au", "hl": "en"}
    visual = serpapi({**base, "type": "all"})
    try:
        exact = serpapi({**base, "type": "exact_matches"}).get("exact_matches", [])
    except ApiError as e:
        print("Lens exact matches failed:", e)
        exact = []
    return jsonify(visual_matches=visual.get("visual_matches", []), exact_matches=exact)


@app.get("/api/ebay")
def ebay():
    q = request.args.get("q", "").strip()
    if not q:
        return jsonify(items=[])
    # LH_PrefLoc=1: only items located in Australia, not overseas sellers on ebay.com.au
    data = serpapi({"engine": "ebay", "ebay_domain": "ebay.com.au", "_nkw": q, "_ipg": 200, "LH_PrefLoc": "1"})
    items = []
    for r in data.get("organic_results", []):
        p = r.get("price") or {}
        price = p.get("raw") or (p.get("from", {}).get("raw", "") + (" to " + p["to"]["raw"] if p.get("to") else ""))
        items.append({
            "title": r.get("title"), "url": r.get("link"), "thumb": r.get("thumbnail"),
            "price": price, "meta": " · ".join(x for x in [r.get("condition"), r.get("location")] if x and "$" not in x),
        })
    return jsonify(items=items)


_postcodes = {}


@app.get("/api/postcode")
def postcode():
    """Australian postcode -> place name and coordinates, via OpenStreetMap (Nominatim)."""
    pc = request.args.get("pc", "").strip()
    if not re.fullmatch(r"\d{4}", pc):
        return jsonify(error="Enter a 4-digit postcode"), 400
    if pc not in _postcodes:
        try:
            r = requests.get("https://nominatim.openstreetmap.org/search", timeout=20, params={
                "postalcode": pc, "country": "Australia", "format": "json", "addressdetails": 1, "limit": 1,
            }, headers={"User-Agent": "ListingFinder/1.0 (personal use)"})
            found = r.json()
        except (requests.RequestException, ValueError):
            raise ApiError("Postcode lookup failed, try again")
        if not found:
            return jsonify(error=f"Postcode {pc} not found"), 404
        a = found[0].get("address", {})
        place = a.get("suburb") or a.get("town") or a.get("city") or a.get("village") or a.get("municipality") or ""
        _postcodes[pc] = {"postcode": pc, "place": place, "state": a.get("state", ""),
                          "lat": float(found[0]["lat"]), "lon": float(found[0]["lon"])}
    return jsonify(_postcodes[pc])


@app.get("/api/img")
def img():
    url = request.args.get("url", "")
    if not url.startswith("https://"):
        return "", 400
    try:
        r = requests.get(url, timeout=20, headers={"User-Agent": "Mozilla/5.0 ListingFinder"})
    except requests.RequestException:
        return "", 502
    ctype = r.headers.get("Content-Type", "")
    if not ctype.startswith("image/"):
        return "", 415
    return Response(r.content, content_type=ctype, headers={"Cache-Control": "max-age=3600"})


if __name__ == "__main__":
    if not config()["serpApiKey"]:
        print("No SerpApi key yet: copy config.example.json to config.json and add it.")
    print(f"Listing Finder running at http://localhost:{PORT}  (Ctrl+C to stop)")
    app.run(host="127.0.0.1", port=PORT, threaded=True)
