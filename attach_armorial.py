import argparse
import hashlib
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import quote

DIST = Path(__file__).parent / "dist"
ALIASES = {
    "AU": ["australia"], "BI": ["burundi"], "BN": ["brunei"], "CD": ["democratic republic of the congo"],
    "CG": ["republic of the congo"], "CI": ["ivory coast", "cote d'ivoire"], "CV": ["cape verde", "cabo verde"],
    "CZ": ["czech republic", "czechia"], "GB": ["united kingdom"], "GE": ["georgia (country)", "georgia"],
    "GM": ["the gambia", "gambia"], "GW": ["guinea-bissau"], "IR": ["iran"], "KR": ["south korea"],
    "KP": ["north korea"], "MK": ["north macedonia"], "MM": ["myanmar", "burma"],
    "PS": ["palestine", "state of palestine"], "SZ": ["eswatini", "swaziland"],
    "TL": ["east timor", "timor-leste"], "TR": ["turkey", "türkiye"], "TW": ["taiwan", "republic of china"],
    "US": ["united states"], "VA": ["vatican city", "holy see"], "VN": ["vietnam"], "XK": ["kosovo"],
}


FILES = {
    "JP": "Imperial Seal of Japan.svg",
    "LB": "Coat of arms of Lebanon.svg",
    "LY": "Seal of the Government of National Unity (Libya).svg",
    "TR": "Emblem of Turkey.svg",
    "SE": "Great coat of arms of Sweden.svg",
    "TW": "National Emblem of the Republic of China.svg",
    "YE": "Emblem of Yemen (2).svg",
}


def key(text):
    text = unicodedata.normalize("NFKD", text).lower()
    return "".join(char for char in text if char.isascii() and char.isalnum())


def commons_urls(filename):
    filename = filename.strip().replace(" ", "_")
    encoded = quote(filename)
    digest = hashlib.md5(filename.encode()).hexdigest()
    base = "https://upload.wikimedia.org/wikipedia/commons/"
    path = f"{digest[0]}/{digest[:2]}/{encoded}"
    extension = Path(filename).suffix.lower()
    suffix = ".png" if extension == ".svg" else ""
    return base + "thumb/" + path + "/120px-" + encoded + suffix, base + path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("armorial", type=Path)
    parser.add_argument("countries", type=Path)
    args = parser.parse_args()
    atlas = DIST / "world.js"
    world = json.loads(atlas.read_text(encoding="utf-8").removeprefix("const WORLD = ").rstrip(";\n"))
    records = {row["cca2"]: row for row in json.loads(args.countries.read_text(encoding="utf-8-sig"))}
    entries = {}
    for line in args.armorial.read_text(encoding="utf-8-sig").splitlines():
        match = re.match(r"\s*\|(?:File|Image):([^|]+)\|.*?\[\[([^\]|]+)", line, re.I)
        if not match:
            continue
        filename, caption = match.groups()
        caption = re.sub(r"^(?:(?:great |royal |national |state |presidential |government )?(?:coat of arms|emblem|seal|arms|heraldic badge))\s+of\s+(?:the\s+)?", "", caption, count=1, flags=re.I)
        entries.setdefault(key(caption), filename)
    missing = []
    for row in world["countries"]:
        code = row["id"]
        record = records[code]
        names = ALIASES.get(code, []) + list(record["name"].values())[:2]
        filename = FILES.get(code) or next((entries[key(name)] for name in names if key(name) in entries), None)
        mainfacts = f"https://mainfacts.com/media/images/coats_of_arms/{code.lower()}.svg"
        if filename:
            row["armsSources"] = [*commons_urls(filename), mainfacts]
        else:
            row["armsSources"] = [mainfacts]
            missing.append((code, record["name"]["common"]))
    atlas.write_text("const WORLD = " + json.dumps(world, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"{len(entries)} armorial entries; missing preferred images: {missing}")


if __name__ == "__main__":
    main()



