import concurrent.futures
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
WEB = ROOT / "dist"
ASSETS = ROOT / "offline-assets"
MAX_BYTES = 7_500_000


def read_script(name, prefix):
    return json.loads((WEB / name).read_text(encoding="utf-8").removeprefix(prefix).rstrip(";\n"))


def identify(data):
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    # The atlas treats third-party SVG as an img, which disables scripting in the SVG.
    if re.search(rb"<svg(?:\s|>)", data[:3000], re.I) and not re.search(rb"<script|<!ENTITY|\bon\w+\s*=|<foreignObject", data, re.I):
        return "svg"
    return None


def modern_thumb(url, width):
    url = url.replace("upload.wikimedia.org/wikipedia/commons/thumb/", "thumb.wikimedia.org/wikipedia/commons/thumb/")
    return re.sub(r"/\d+px-", f"/{width}px-", url)


def original_photo(url):
    match = re.search(r"/wikipedia/commons/thumb/([\da-f]/[\da-f]{2}/[^/]+)/[^/]+$", url)
    return "https://upload.wikimedia.org/wikipedia/commons/" + match.group(1) if match else url


def fetch_asset(job):
    key, urls = job
    existing = list((ASSETS / key).parent.glob((ASSETS / key).name + ".*"))
    if existing:
        return key, existing[0].relative_to(ASSETS).as_posix()
    for attempt in range(2):
        for url in urls:
            if not url:
                continue
            try:
                request = urllib.request.Request(url, headers={"User-Agent":"Mozilla/5.0"})
                with urllib.request.urlopen(request, timeout=16) as response:
                    if int(response.headers.get("Content-Length") or 0) > MAX_BYTES:
                        continue
                    data = response.read(MAX_BYTES + 1)
                extension = identify(data) if len(data) <= MAX_BYTES else None
                if extension:
                    filename = ASSETS / (key + "." + extension)
                    filename.write_bytes(data)
                    return key, filename.relative_to(ASSETS).as_posix()
            except (OSError, ValueError):
                continue
        time.sleep(1 + attempt)
    return key, None


def main():
    countries = read_script("world.js", "const WORLD = ")["countries"]
    photos = read_script("country-photos.js", "const COUNTRY_PHOTOS = ")
    arms = []
    pictures = []
    for country in countries:
        code = country["id"]
        urls = country["armsSources"]
        sized = modern_thumb(urls[0], 250)
        extra = f"https://mainfacts.com/media/images/coats_of_arms/{code.lower()}.png"
        arms.append((f"arms/{code.lower()}", list(dict.fromkeys([sized, modern_thumb(urls[0], 330), *urls, extra]))))
        for index, photo in enumerate(photos[code], start=1):
            src = photo["src"]
            variants = [modern_thumb(src, 960), src, photo.get("preview"), original_photo(src), photo.get("fallback")]
            variants += [link.replace("thumb.wikimedia.org", "upload.wikimedia.org", 1) for link in variants if link]
            pictures.append((f"photos/{code.lower()}-{index}", list(dict.fromkeys(variants))))
    for subdir in ("arms", "photos"):
        (ASSETS / subdir).mkdir(parents=True, exist_ok=True)
    jobs = [job for pair in zip(arms, pictures) for job in pair] + pictures[len(arms):]
    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
        files = dict(pool.map(fetch_asset, jobs))
    found = {key: file for key, file in files.items() if file}
    missing = sorted(set(files) - set(found))
    (ASSETS / "manifest.json").write_text(json.dumps(found, indent=2) + "\n", encoding="utf-8")
    print(f"Downloaded or cached: {len(found)} of {len(jobs)} images", flush=True)
    if missing:
        print("Missing: " + ", ".join(missing), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
