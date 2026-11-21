import concurrent.futures
import html
import json
import math
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DIST = Path(__file__).parent / "dist"
USER_AGENT = "TerraAtlas/1.0 (educational atlas; https://terraquest-atlas.sunshinyterrapin8.chatgpt.site)"
REPLACEMENTS = {
    "BO": "Sucre", "BR": "Brasília", "CG": "Brazzaville", "CH": "Bern", "CZ": "Prague",
    "DM": "Roseau", "DO": "Santo Domingo", "EC": "Quito", "GE": "Tbilisi", "GQ": "Ciudad de la Paz",
    "IL": "Tel Aviv", "KI": "South Tarawa", "LU": "Luxembourg City", "MC": "Monaco",
    "NR": "Yaren District", "PA": "Panama City", "PS": "Ramallah", "PW": "Ngerulmud",
    "SM": "City of San Marino", "US": "Washington, D.C.", "VA": "Vatican City",
    "ZA": "Cape Town", "TW": "Taipei", "UA": "Kyiv", "TZ": "Dodoma", "ID": "Jakarta",
    "ZW": "Harare", "KR": "Seoul", "IN": "New Delhi", "SG": "Singapore",
}
ALTERNATIVES = {
    "AG": "English Harbour", "BB": "Bathsheba, Barbados", "BI": "Bujumbura", "BN": "Omar Ali Saifuddien Mosque",
    "BT": "Paro, Bhutan", "CV": "Mindelo", "FM": "Pohnpei", "GD": "St. George's, Grenada", "GQ": "Malabo",
    "GW": "Bissau", "KI": "Tarawa", "KM": "Moroni, Comoros", "KN": "Basseterre",
    "LC": "Soufrière, Saint Lucia", "LI": "Vaduz Castle", "MH": "Majuro", "MV": "Malé",
    "NR": "Anibare Bay", "PG": "Port Moresby", "PW": "Koror", "SB": "Gizo, Solomon Islands",
    "SC": "Mahé, Seychelles", "ST": "São Tomé", "TO": "Nukuʻalofa", "TV": "Funafuti",
    "VC": "Kingstown", "VU": "Port Vila", "WS": "Apia",
}
EXTRAS = {
    "AZ": [("Icherisheher", "Ичери-шехер, старый город Баку"), ("Heydar Aliyev Center", "Центр Гейдара Алиева")],
    "AU": [("Sydney", "Сидней"), ("Uluru", "Улуру")],
    "BR": [("Rio de Janeiro", "Рио-де-Жанейро"), ("Iguazu Falls", "Водопады Игуасу")],
    "CA": [("Vancouver", "Ванкувер"), ("Banff National Park", "Национальный парк Банф")],
    "CN": [("Shanghai", "Шанхай"), ("Great Wall of China", "Великая Китайская стена")],
    "EG": [("Giza pyramid complex", "Пирамиды Гизы"), ("Luxor", "Луксор")],
    "FR": [("Mont-Saint-Michel", "Мон-Сен-Мишель"), ("Lyon", "Лион")],
    "GB": [("Edinburgh", "Эдинбург"), ("Lake District", "Озёрный край")],
    "GR": [("Santorini", "Санторини"), ("Meteora", "Метеоры")],
    "IN": [("Jaipur", "Джайпур"), ("Taj Mahal", "Тадж-Махал")],
    "IT": [("Venice", "Венеция"), ("Florence", "Флоренция")],
    "JP": [("Kyoto", "Киото"), ("Mount Fuji", "Гора Фудзи")],
    "KE": [("Mombasa", "Момбаса"), ("Maasai Mara", "Масаи-Мара")],
    "KR": [("Busan", "Пусан"), ("Jeju Island", "Остров Чеджу")],
    "MA": [("Marrakesh", "Марракеш"), ("Chefchaouen", "Шефшауэн")],
    "MX": [("Oaxaca City", "Оахака"), ("Chichen Itza", "Чичен-Ица")],
    "NO": [("Bergen", "Берген"), ("Geirangerfjord", "Гейрангер-фьорд")],
    "NZ": [("Queenstown, New Zealand", "Куинстаун"), ("Milford Sound", "Милфорд-Саунд")],
    "PE": [("Cusco", "Куско"), ("Machu Picchu", "Мачу-Пикчу")],
    "RU": [("Saint Petersburg", "Санкт-Петербург"), ("Lake Baikal", "Озеро Байкал")],
    "TH": [("Chiang Mai", "Чиангмай"), ("Ayutthaya Historical Park", "Парк Аюттхая")],
    "TR": [("Istanbul", "Стамбул"), ("Göreme", "Гёреме, Каппадокия")],
    "UA": [("Lviv", "Львов"), ("Odesa", "Одесса")],
    "US": [("New York City", "Нью-Йорк"), ("Grand Canyon National Park", "Гранд-Каньон")],
    "VN": [("Hội An", "Хойан"), ("Hạ Long Bay", "Бухта Халонг")],
    "ZA": [("Johannesburg", "Йоханнесбург"), ("Blyde River Canyon", "Каньон реки Блайд")],
    "AD": [("Casa de la Vall", "Каса-де-ла-Валь"), ("Ordino", "Ордино")],
    "BS": [("Nassau, Bahamas", "Нассау"), ("Atlantis Paradise Island", "Остров Парадайс")],
    "BZ": [("Belize City", "Белиз"), ("Caracol", "Караколь")],
    "CF": [("Notre-Dame of Bangui Cathedral", "Собор в Банги"), ("Dzanga-Sangha Special Reserve", "Заповедник Дзанга-Санга")],
    "CR": [("National Theatre of Costa Rica", "Национальный театр в Сан-Хосе"), ("Arenal Volcano", "Вулкан Ареналь")],
    "CU": [("Old Havana", "Старая Гавана"), ("Santiago de Cuba", "Сантьяго-де-Куба")],
    "DJ": [("Djibouti (city)", "Джибути"), ("Lake Assal (Djibouti)", "Озеро Ассаль")],
    "ER": [("Fiat Tagliero Building", "Здание «Фиат Тальеро» в Асмэре"), ("Massawa", "Массауа")],
    "FI": [("Senate Square, Helsinki", "Сенатская площадь Хельсинки"), ("Porvoo", "Порвоо"), ("Helsinki Central Library Oodi", "Библиотека Ооди в Хельсинки")],
    "FJ": [("Nadi", "Нанди"), ("Sigatoka Sand Dunes", "Дюны Сигатоки")],
    "GA": [("Lopé National Park", "Национальный парк Лопе"), ("Libreville", "Либревиль")],
    "GH": [("Kakum National Park", "Национальный парк Какум"), ("Elmina Castle", "Замок Эльмина"), ("Kumasi", "Кумаси")],
    "GM": [("Kunta Kinteh Island", "Остров Кунта-Кинте"), ("Banjul", "Банжул")],
    "GW": [("Bolama", "Болама"), ("Cacheu", "Кашеу")],
    "GY": [("Kaieteur Falls", "Водопад Кайетур"), ("Georgetown, Guyana", "Джорджтаун")],
    "JM": [("Kingston, Jamaica", "Кингстон"), ("Dunn's River Falls", "Водопад Даннс-Ривер")],
    "JO": [("Petra", "Петра"), ("Wadi Rum", "Вади-Рам")],
    "KW": [("Grand Mosque of Kuwait", "Большая мечеть Кувейта"), ("Kuwait City", "Эль-Кувейт")],
    "LA": [("Luang Prabang", "Луангпхабанг"), ("Pha That Luang", "Пха Тхат Луанг")],
    "LB": [("Byblos", "Библ"), ("Baalbek", "Баальбек")],
    "LC": [("Castries", "Кастри"), ("Pitons (Saint Lucia)", "Питоны")],
    "LK": [("Colombo", "Коломбо"), ("Sigiriya", "Сигирия")],
    "LY": [("Tripoli, Libya", "Триполи"), ("Leptis Magna", "Лептис-Магна")],
    "MC": [("Monaco-Ville", "Монако-Вилль"), ("Monte Carlo", "Монте-Карло")],
    "MT": [("Mdina", "Мдина"), ("St. John's Co-Cathedral", "Собор Святого Иоанна в Валлетте")],
    "NL": [("Rijksmuseum", "Рейксмюсеум в Амстердаме"), ("Rotterdam", "Роттердам")],
    "PS": [("Bethlehem", "Вифлеем"), ("Jericho", "Иерихон")],
    "SG": [("Marina Bay Sands", "Марина-Бэй-Сэндс"), ("Singapore Botanic Gardens", "Сингапурский ботанический сад")],
    "SO": [("Mogadishu", "Могадишо"), ("Bosaso", "Босасо")],
    "SR": [("Fort Zeelandia (Paramaribo)", "Форт Зеландия в Парамарибо"), ("Central Suriname Nature Reserve", "Заповедник Центрального Суринама")],
    "ST": [("São Tomé", "Сан-Томе"), ("Pico Cão Grande", "Пику-Кан-Гранде")],
    "UY": [("Punta del Este", "Пунта-дель-Эсте"), ("Palacio Salvo", "Паласио Сальво в Монтевидео")],
    "UZ": [("Samarkand", "Самарканд"), ("Registan", "Регистан")],
    "VA": [("St. Peter's Square", "Площадь Святого Петра"), ("Vatican Museums", "Музеи Ватикана")],
    "WS": [("Saleaula", "Северное побережье острова Савайи")],
    "ZW": [("Great Zimbabwe", "Большой Зимбабве"), ("Matobo National Park", "Национальный парк Матобо")],
}
MOTIFS = re.compile(r"(?:^flag of |^coat of arms|locator|location map|blank map|election|route map|logo|emblem|\.svg$|\.gif$|\.png$)", re.I)
TAG = re.compile(r"<[^>]*>")


def text(value):
    return " ".join(html.unescape(TAG.sub(" ", value)).split())


def load_api(domain, params):
    url = f"https://{domain}/w/api.php?" + urllib.parse.urlencode({"format": "json", "formatversion": 2, **params})
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=23) as response:
                result = json.load(response)
            if "error" in result:
                raise ValueError(result["error"])
            return result.get("query", {})
        except (OSError, ValueError) as error:
            if attempt == 2:
                print(domain, str(error), flush=True)
                return {}
            time.sleep(attempt + 1)


def chunks(values, size):
    return [values[i:i + size] for i in range(0, len(values), size)]


def page_data(titles):
    params = {
        "action": "query", "redirects": 1, "titles": "|".join(titles),
        "prop": "pageimages|coordinates|pageprops", "ppprop": "disambiguation",
        "piprop": "name", "pilicense": "free", "pilimit": 50, "colimit": 50,
    }
    result = load_api("en.wikipedia.org", params)
    redirects = {r["from"]: r["to"] for r in result.get("normalized", []) + result.get("redirects", [])}
    pages = {page["title"]: page for page in result.get("pages", [])}
    out = {}
    for title in titles:
        name = title
        while name in redirects and redirects[name] != name:
            name = redirects[name]
        page = pages.get(name) or {}
        coords = page.get("coordinates", [])
        filename = page.get("pageimage")
        if coords and filename and "disambiguation" not in page.get("pageprops", {}) and not MOTIFS.search(filename):
            out[title] = (filename, coords[0]["lon"], coords[0]["lat"])
    return out


def photo_metadata(files):
    result = load_api("commons.wikimedia.org", {
        "action": "query", "titles": "|".join("File:" + file.replace("|", "") for file in files),
        "redirects": 1, "prop": "imageinfo", "iilimit": 1, "iiurlwidth": 1280,
        "iiprop": "url|extmetadata|size|mime",
        "iiextmetadatafilter": "Artist|LicenseShortName|LicenseUrl|Credit",
    })
    pages = {p["title"]: p for p in result.get("pages", [])}
    aliases = {r["from"]: r["to"] for r in result.get("normalized", []) + result.get("redirects", [])}
    photos = {}
    for file in files:
        title = "File:" + file.replace("_", " ")
        info = pages.get(aliases.get(title, title), {}).get("imageinfo", [])
        if not info:
            continue
        img = info[0]
        if img.get("thumbwidth", 0) < 180 or img.get("mime") not in {"image/jpeg", "image/webp"}:
            continue
        meta = {key: value["value"] for key, value in img.get("extmetadata", {}).items()}
        license_name = text(meta.get("LicenseShortName", ""))
        if not re.match(r"^(?:CC BY(?:-SA)?\s|CC0|Public domain|PDM|PD)", license_name):
            continue
        author = text(meta.get("Artist", "")) or text(meta.get("Credit", ""))
        src = img["thumburl"].split("?", 1)[0].replace("http://", "https://", 1)
        photo = {"src": src, "width": img["thumbwidth"], "url": img["descriptionurl"], "license": license_name, "author": author}
        if img["thumbwidth"] > 500 and re.search(r"/\d+px-", src):
            photo["preview"] = re.sub(r"/\d+px-", "/500px-", src)
        if meta.get("LicenseUrl", "").startswith(("http://creativecommons.org/", "https://creativecommons.org/")):
            photo["licenseUrl"] = meta["LicenseUrl"].replace("http:", "https:", 1)
        if img.get("size", 0) < 1300000:
            photo["fallback"] = img.get("url", "").split("?", 1)[0]
        photos[file] = photo
    return photos


def inside_ring(ring, x, y):
    inside = False
    for (a, b), (c, d) in zip(ring, ring[1:]):
        if (b > y) != (d > y) and x < (c - a) * (y - b) / (d - b) + a:
            inside = not inside
    return inside


def in_country(shape, x, y):
    for rings in shape["geometry"]["coordinates"]:
        exterior, *holes = rings
        if max(p[0] for p in exterior) - min(p[0] for p in exterior) > 180:
            continue
        if inside_ring(exterior, x, y) and all(not inside_ring(hole, x, y) for hole in holes):
            return True
        if any(near_segment(x, y, start, end) for start, end in zip(exterior, exterior[1:])):
            return True
    return False


def near_segment(x, y, start, end):
    ax, ay = start
    dx, dy = end[0] - ax, end[1] - ay
    length = dx * dx + dy * dy
    step = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / length)) if length else 0
    return math.hypot(x - ax - dx * step, y - ay - dy * step) < .07


def wikipedia_capital(country):
    for capital in country["capitals"]:
        if not re.search("[А-Яа-яЁё]", capital):
            return capital
    return country["capitals"][0]


def main():
    world = json.loads((DIST / "world.js").read_text(encoding="utf-8").removeprefix("const WORLD = ").rstrip(";\n"))
    shapes = {feature["id"]: feature for feature in world["features"]}
    candidates = {}
    for country in world["countries"]:
        code = country["id"]
        main_title = REPLACEMENTS.get(code) or wikipedia_capital(country)
        labels = {
            "BO": "Сукре", "IL": "Тель-Авив", "ZA": "Кейптаун", "ID": "Джакарта",
            "TZ": "Додома", "KI": "Южная Тарава", "NR": "Ярен", "PS": "Рамалла",
        }
        label = labels.get(code, country["capitals"][0])
        candidates[code] = [(main_title, label), *EXTRAS.get(code, [])]
        if code in ALTERNATIVES:
            title = ALTERNATIVES[code]
            candidates[code].append((title, ""))
    titles = list(dict.fromkeys(title for entries in candidates.values() for title, _ in entries))
    found = {}
    files = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        for partial in pool.map(page_data, chunks(titles, 22)):
            found.update(partial)
        filenames = list(dict.fromkeys(found[title][0] for title in titles if title in found))
        print("Geolocated photos", len(filenames), flush=True)
        for partial in pool.map(photo_metadata, chunks(filenames, 16)):
            files.update(partial)
    out = {}
    for code, items in candidates.items():
        gallery = []
        used = set()
        for title, label in items:
            if title not in found:
                continue
            file, lon, lat = found[title]
            if file not in used and file in files and in_country(shapes[code], lon, lat):
                gallery.append({**files[file], "label": label or title})
                used.add(file)
        if gallery:
            out[code] = gallery[:3]
    (DIST / "country-photos.js").write_text("const COUNTRY_PHOTOS = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print("Galleries", len(out), "photos", sum(map(len, out.values())), flush=True)
    print("Without photos:", " ".join(sorted(set(candidates) - set(out))), flush=True)


if __name__ == "__main__":
    main()

