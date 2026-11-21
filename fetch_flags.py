import concurrent.futures
import json
import urllib.request
from pathlib import Path

dist = Path(__file__).parent / "dist"
countries = json.loads((dist / "world.js").read_text(encoding="utf-8").removeprefix("const WORLD = ").rstrip(";\n"))["countries"]
jobs = []
for row in countries:
    code = row["id"].lower()
    jobs.append((row["flag"], f"https://flagcdn.com/{code}.svg"))



def download(job):
    file, url = job
    path = dist / file
    path.parent.mkdir(exist_ok=True)
    if path.exists() and path.stat().st_size:
        return file, True
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=9) as response:
                data = response.read()
            if file.endswith(".png") and not data.startswith(b"\x89PNG\r\n\x1a\n"):
                return file, False
            if file.endswith(".svg") and b"<svg" not in data[:2048]:
                return file, False
            path.write_bytes(data)
            return file, True
        except urllib.error.HTTPError as error:
            if error.code in (403, 404):
                return file, False
        except OSError:
            pass
    return file, False


with concurrent.futures.ThreadPoolExecutor(max_workers=18) as executor:
    failures = [file for file, success in executor.map(download, jobs) if not success]
print("Missing assets:", ", ".join(failures) if failures else "none")

