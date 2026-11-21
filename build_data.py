import argparse
import json
import math
from pathlib import Path

DIST = Path(__file__).parent / "dist"
REGIONS = {"Africa", "Europe", "Asia", "North America", "South America", "Oceania"}
EXTRA_CAPITALS = {
    "AE": ["Абу-Даби"], "AR": ["Буэнос-Айрес"], "AU": ["Канберра"], "BR": ["Бразилиа", "Бразилия"],
    "CA": ["Оттава"], "CH": ["Берн"], "CN": ["Пекин", "Бэйцзин", "Beijing"],
    "DE": ["Берлин"], "EG": ["Каир"], "ES": ["Мадрид"], "FR": ["Париж"],
    "BI": ["Гитега"], "GQ": ["Сьюдад-де-ла-Пас"], "MN": ["Улан-Батор", "Ulaanbaatar"], "NR": ["Ярен"], "PW": ["Нгерулмуд"], "SM": ["Сан-Марино"], "MV": ["Мале"], "MU": ["Порт-Луи"], "SC": ["Виктория"], "GB": ["Лондон"], "GE": ["Тбилиси"], "GH": ["Аккра"], "ID": ["Джакарта"], "IL": ["Иерусалим"],
    "IN": ["Нью-Дели"], "IT": ["Рим"], "JP": ["Токио"], "KE": ["Найроби"], "KR": ["Сеул"],
    "KZ": ["Астана"], "MX": ["Мехико"], "NG": ["Абуджа"], "NL": ["Амстердам"],
    "NO": ["Осло"], "NZ": ["Веллингтон"], "RU": ["Москва"], "SA": ["Эр-Рияд"],
    "SE": ["Стокгольм"], "TH": ["Бангкок"], "TR": ["Анкара"], "UA": ["Киев", "Київ", "Kiev"],
    "US": ["Вашингтон", "Washington"], "ZA": ["Претория", "Кейптаун", "Блумфонтейн"],
}
TERRAIN = {
    "DZ": "#d5bf83", "EG": "#dbc183", "LY": "#d7be88", "MR": "#ceae76", "ML": "#ceb484",
    "NE": "#dbc288", "SA": "#d7b47f", "OM": "#d5b788", "AE": "#d1b386", "AU": "#cfaf7e",
    "SD": "#c9b581", "TD": "#c9ad76", "YE": "#d1b78b", "MN": "#bcb88d", "IS": "#acb9bf",
    "BR": "#68a076", "CO": "#78a877", "CD": "#69a47d", "ID": "#6c9f73", "GA": "#71a27b",
}
EXTRA_CODES = {"KOS": "XK", "PSX": "PS", "SOL": "SO", "CYN": "CY"}
MERGED_CODES = {"SOL", "CYN"}
REGION_OVERRIDES = {"MV": "Asia", "MU": "Africa", "SC": "Africa"}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def simplify(points, tolerance=0.037):
    if len(points) <= 4:
        return points
    keep = {0, len(points) - 1}
    segments = [(0, len(points) - 1)]
    while segments:
        start, end = segments.pop()
        ax, ay = points[start]
        bx, by = points[end]
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        furthest = tolerance ** 2
        pivot = None
        for index in range(start + 1, end):
            px, py = points[index]
            t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length)) if length else 0
            distance = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if distance > furthest:
                furthest = distance
                pivot = index
        if pivot is not None:
            keep.add(pivot)
            segments.extend(((start, pivot), (pivot, end)))
    return [points[index] for index in sorted(keep)] if len(keep) >= 4 else points


def ring_area(points):
    return sum(ax * by - bx * ay for (ax, ay), (bx, by) in zip(points, points[1:]))


def compact_ring(points, exterior):
    points = simplify(points)
    compact = [[round(x, 4), round(y, 4)] for x, y in points]
    if exterior == (ring_area(compact) > 0):
        compact.reverse()
    return compact


def normalized(text):
    return "".join(char.casefold() for char in text if char.isalnum())


def capital_lookup(places):
    names = {}
    for place in places:
        props = {key.lower(): value for key, value in place["properties"].items()}
        russian = props.get("name_ru")
        if not russian:
            continue
        for variant in ("name", "nameascii", "name_en"):
            if props.get(variant):
                names.setdefault(normalized(props[variant]), russian)
    return names


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("boundaries", type=Path)
    parser.add_argument("countries", type=Path)
    parser.add_argument("--places", type=Path)
    args = parser.parse_args()
    records = {row["cca2"]: row for row in read_json(args.countries)}
    places = capital_lookup(read_json(args.places)["features"]) if args.places else {}
    features = {}
    countries = {}
    for entry in read_json(args.boundaries)["features"]:
        props = entry["properties"]
        natural_earth_code = props["ADM0_A3"]
        iso = EXTRA_CODES.get(natural_earth_code, props["ISO_A2_EH"])
        iso = iso if iso != "-99" else props["ISO_A2"]
        iso = iso if iso in records else natural_earth_code
        shape = entry["geometry"]
        if shape is None:
            continue
        polygons = shape["coordinates"] if shape["type"] == "MultiPolygon" else [shape["coordinates"]]
        coordinates = [
            [compact_ring(ring, index == 0) for index, ring in enumerate(polygon)]
            for polygon in polygons
        ]
        if iso in features:
            features[iso]["geometry"]["coordinates"].extend(coordinates)
        else:
            features[iso] = {"type": "Feature", "id": iso, "geometry": {"type": "MultiPolygon", "coordinates": coordinates}}
        record = records.get(iso)
        region = REGION_OVERRIDES.get(iso, props["CONTINENT"])
        if not record or natural_earth_code in MERGED_CODES or region not in REGIONS:
            continue
        if not (record.get("independent") or iso in {"VA", "PS", "TW", "XK"}):
            continue
        english = record.get("capital", [])
        russian = [places[normalized(name)] for name in english if normalized(name) in places]
        capitals = list(dict.fromkeys(EXTRA_CAPITALS.get(iso, []) + russian + english))
        if not capitals:
            continue
        country = {
            "id": iso, "region": region, "name": props["NAME_RU"] or record["name"]["common"],
            "point": [round(props["LABEL_X"], 4), round(props["LABEL_Y"], 4)],
            "capitals": capitals,
            "flag": "flags/" + iso.lower() + ".svg",
            "arms": "arms/" + iso.lower() + ".png",
        }
        if iso in TERRAIN:
            country["terrain"] = TERRAIN[iso]
        countries[iso] = country
    data = {"features": list(features.values()), "countries": list(countries.values())}
    (DIST / "world.js").write_text("const WORLD = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"{len(features)} map features, {len(countries)} quiz countries, "
          f"{sum(any(any('А' <= c <= 'я' for c in s) for s in row['capitals']) for row in countries.values())} with Russian capitals")


if __name__ == "__main__":
    main()



