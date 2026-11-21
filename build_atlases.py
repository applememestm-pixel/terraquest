import argparse
import json
import re
import zlib
from pathlib import Path

from build_data import DIST, read_json, ring_area, simplify

JAPAN = (
    "Хоккайдо|Аомори|Иватэ|Мияги|Акита|Ямагата|Фукусима|Ибараки|Тотиги|Гумма|Сайтама|Тиба|Токио|"
    "Канагава|Ниигата|Тояма|Исикава|Фукуи|Яманаси|Нагано|Гифу|Сидзуока|Айти|Миэ|Сига|Киото|"
    "Осака|Хёго|Нара|Вакаяма|Тоттори|Симанэ|Окаяма|Хиросима|Ямагути|Токусима|Кагава|Эхимэ|Коти|"
    "Фукуока|Сага|Нагасаки|Кумамото|Оита|Миядзаки|Кагосима|Окинава"
).split("|")
USA = dict(line.split("|") for line in """AL|Алабама
AK|Аляска
AZ|Аризона
AR|Арканзас
CA|Калифорния
CO|Колорадо
CT|Коннектикут
DE|Делавэр
FL|Флорида
GA|Джорджия
HI|Гавайи
ID|Айдахо
IL|Иллинойс
IN|Индиана
IA|Айова
KS|Канзас
KY|Кентукки
LA|Луизиана
ME|Мэн
MD|Мэриленд
MA|Массачусетс
MI|Мичиган
MN|Миннесота
MS|Миссисипи
MO|Миссури
MT|Монтана
NE|Небраска
NV|Невада
NH|Нью-Гэмпшир
NJ|Нью-Джерси
NM|Нью-Мексико
NY|Нью-Йорк
NC|Северная Каролина
ND|Северная Дакота
OH|Огайо
OK|Оклахома
OR|Орегон
PA|Пенсильвания
RI|Род-Айленд
SC|Южная Каролина
SD|Южная Дакота
TN|Теннесси
TX|Техас
UT|Юта
VT|Вермонт
VA|Виргиния
WA|Вашингтон
WV|Западная Виргиния
WI|Висконсин
WY|Вайоминг""".splitlines())
RUSSIA = dict(line.split("|") for line in """Altai Krai|Алтайский край
Republic of Mordovia|Республика Мордовия
Tula Oblast|Тульская область
Kurgan Oblast|Курганская область
Ingushetia|Республика Ингушетия
Khanty-Mansiysk Autonomous Okrug – Ugra|Ханты-Мансийский автономный округ — Югра
Kirov Oblast|Кировская область
Komi Republic|Республика Коми
Kostroma Oblast|Костромская область
Krasnoyarsk Krai|Красноярский край
Zabaykalsky Krai|Забайкальский край
Sverdlovsk Oblast|Свердловская область
Volgograd Oblast|Волгоградская область
Irkutsk Oblast|Иркутская область
Perm Krai|Пермский край
Pskov Oblast|Псковская область
Rostov Oblast|Ростовская область
Ryazan Oblast|Рязанская область
Adygea|Республика Адыгея
Samara Oblast|Самарская область
Khakassia|Республика Хакасия
Tambov Oblast|Тамбовская область
Tatarstan|Республика Татарстан
Tomsk Oblast|Томская область
Nizhny Novgorod Oblast|Нижегородская область
Republic of Karelia|Республика Карелия
Arkhangelsk Oblast|Архангельская область
Astrakhan Oblast|Астраханская область
Belgorod Oblast|Белгородская область
Bryansk Oblast|Брянская область
Buryatia|Республика Бурятия
Chechnya|Чеченская Республика
Chelyabinsk Oblast|Челябинская область
Chuvashia|Чувашская Республика
Tyumen Oblast|Тюменская область
North Ossetia–Alania|Республика Северная Осетия — Алания
Penza Oblast|Пензенская область
Amur Oblast|Амурская область
Kabardino-Balkaria|Кабардино-Балкарская Республика
Krasnodar Krai|Краснодарский край
Kursk Oblast|Курская область
Leningrad oblast|Ленинградская область
Mari El|Республика Марий Эл
Moscow|Москва
Moscow Oblast|Московская область
Murmansk Oblast|Мурманская область
Nenets Autonomous Okrug|Ненецкий автономный округ
Novgorod Oblast|Новгородская область
Novosibirsk Oblast|Новосибирская область
Omsk Oblast|Омская область
Oryol Oblast|Орловская область
Saint Petersburg|Санкт-Петербург
Sakhalin Oblast|Сахалинская область
Sakha Republic|Республика Саха (Якутия)
Saratov Oblast|Саратовская область
Smolensk Oblast|Смоленская область
Stavropol Krai|Ставропольский край
Tuva|Республика Тыва
Tver Oblast|Тверская область
Udmurtia|Удмуртская Республика
Kaluga Oblast|Калужская область
Lipetsk Oblast|Липецкая область
Magadan Oblast|Магаданская область
Ulyanovsk Oblast|Ульяновская область
Vladimir Oblast|Владимирская область
Vologda Oblast|Вологодская область
Yaroslavl Oblast|Ярославская область
Voronezh Oblast|Воронежская область
Yamalo-Nenets Autonomous Okrug|Ямало-Ненецкий автономный округ
Altai Republic|Республика Алтай
Ivanovo Oblast|Ивановская область
Jewish Autonomous Oblast|Еврейская автономная область
Kalmykia|Республика Калмыкия
Kamchatka Krai|Камчатский край
Karachay-Cherkessia|Карачаево-Черкесская Республика
Kemerovo Oblast|Кемеровская область — Кузбасс
Khabarovsk Krai|Хабаровский край
Chukotka Autonomous Okrug|Чукотский автономный округ
Dagestan|Республика Дагестан
Kaliningrad|Калининградская область
Orenburg Oblast|Оренбургская область
Primorsky Krai|Приморский край
Bashkortostan|Республика Башкортостан""".splitlines())
CLAIMS = {
    "UA-43": "Крым", "UA-40": "Севастополь", "UA-14": "Донецкая область",
    "UA-09": "Луганская область", "UA-23": "Запорожская область", "UA-65": "Херсонская область",
}
HISTORICAL_NAMES = dict(line.split("|") for line in """Germany|Германия
Germany (Prussia)|Германия
German Reich|Германский рейх
Nazi Germany|Нацистская Германия
United States|США
United States of America|США
USSR|СССР
Soviet Union|СССР
Russia (Soviet Union)|СССР
Union of Soviet Socialist Republics|СССР
Poland|Польша
France|Франция
United Kingdom|Великобритания
Great Britain|Великобритания
Empire of Japan|Японская империя
Japan|Япония
Japan (USA)|Япония (оккупация союзников)
Germany (Soviet)|Германия (зона СССР)
Germany (UK)|Германия (зона Великобритании)
Germany (USA)|Германия (зона США)
Germany (France)|Германия (зона Франции)
Manchukuo|Маньчжоу-го
Mengjiang|Мэнцзян
China|Китай
Republic of China|Китайская Республика
Italy|Италия
Kingdom of Italy|Королевство Италия
Austria|Австрия
Czechoslovakia|Чехословакия
Slovakia|Словакия
Hungary|Венгрия
Romania|Румыния
Bulgaria|Болгария
Yugoslavia|Югославия
Albania|Албания
Greece|Греция
Turkey|Турция
Finland|Финляндия
Sweden|Швеция
Norway|Норвегия
Denmark|Дания
Spain|Испания
Portugal|Португалия
Netherlands|Нидерланды
Belgium|Бельгия
Switzerland|Швейцария
Luxembourg|Люксембург
Lithuania|Литва
Latvia|Латвия
Estonia|Эстония
Ireland|Ирландия
Iceland|Исландия
Canada|Канада
Australia|Австралия
New Zealand|Новая Зеландия
Mexico|Мексика
Brazil|Бразилия
Argentina|Аргентина
Bolivia|Боливия
Chile|Чили
Colombia|Колумбия
Ecuador|Эквадор
Peru|Перу
Venezuela|Венесуэла
Paraguay|Парагвай
Uruguay|Уругвай
Afghanistan|Афганистан
Iran|Иран
Iraq|Ирак
Egypt|Египет
Ethiopia|Эфиопия
Italian East Africa|Итальянская Восточная Африка
Belgian Congo|Бельгийское Конго
South Africa|Южно-Африканский Союз
British India|Британская Индия
India|Индия
Burma|Бирма
Ceylon|Цейлон
French Indochina|Французский Индокитай
Dutch East Indies|Нидерландская Ост-Индия
Netherlands East Indies|Нидерландская Ост-Индия
Thailand|Таиланд
Siam|Сиам
Philippines|Филиппины
Korea|Корея
Korea (USA)|Корея (зона США)
Korea (USSR)|Корея (зона СССР)
Mongolia|Монголия
Tibet|Тибет
Nepal|Непал
Bhutan|Бутан
Saudi Arabia|Саудовская Аравия
Yemen|Йемен
Oman|Оман
Syria|Сирия
Lebanon|Ливан
Palestine|Палестина
Transjordan|Трансиордания
Liberia|Либерия
Jamaica|Ямайка
Cuba|Куба
Haiti|Гаити
Dominican Republic|Доминиканская Республика
Panama|Панама
Costa Rica|Коста-Рика
Nicaragua|Никарагуа
Honduras|Гондурас
Guatemala|Гватемала
El Salvador|Сальвадор
Hong Kong|Гонконг
Taiwan|Тайвань
Antarctica|Антарктида""".splitlines())
PALETTE = ["#bcbf9b", "#a5b4cf", "#c5ada0", "#9abdb6", "#c6b493", "#acb8a2", "#b8aac2", "#c6a6ab"]


def unwrap(points):
    result = []
    for x, y in points:
        if result:
            x = result[-1][0] + ((x - result[-1][0] + 180) % 360 - 180)
        result.append([x, y])
    return result


def geometry(entry, precision):
    geom = entry["geometry"]
    if not geom or geom["type"] not in {"Polygon", "MultiPolygon"}:
        return None
    polygons = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    result = []
    for polygon in polygons:
        kept = []
        for index, ring in enumerate(polygon):
            if len(ring) < 4:
                continue
            crosses = any(abs(a[0] - b[0]) > 180 for a, b in zip(ring, ring[1:]))
            compact = [[round(x, 5), round(y, 5)] for x, y, *_ in ring]
            if not crosses:
                compact = simplify(compact, precision)
            area = ring_area(unwrap(compact) if crosses else compact)
            if not area:
                continue
            if (index == 0) == (area > 0):
                compact.reverse()
            kept.append(compact)
        if kept:
            result.append(kept)
    return result


def point_on_shape(polygons):
    outer = [unwrap(polygon[0]) for polygon in polygons]
    ring = max(outer, key=lambda item: abs(ring_area(item)))
    low = min(y for x, y in ring)
    high = max(y for x, y in ring)
    best = (0, *ring[0])
    for fraction in (.28, .4, .5, .6, .72):
        latitude = low + fraction * (high - low)
        hits = sorted(a + (b - a) * (latitude - y) / (z - y)
                      for (a, y), (b, z) in zip(ring, ring[1:]) if y <= latitude < z or z <= latitude < y)
        for left, right in zip(hits[::2], hits[1::2]):
            best = max(best, (right - left, (left + right) / 2, latitude))
    return [round((best[1] + 180) % 360 - 180, 5), round(best[2], 5)]


def add_item(tiles, item_id, label, polygons, **extra):
    if not polygons:
        return
    tiles["features"].append({"type": "Feature", "id": item_id,
                              "geometry": {"type": "MultiPolygon", "coordinates": polygons}})
    tiles["countries"].append({"id": item_id, "name": label, "point": point_on_shape(polygons), **extra})


def subdivisions(raw, code):
    atlas = {"features": [], "countries": []}
    entries = read_json(raw / f"terra-boundaries-{code}.json")["features"]
    if code == "RUS":
        entries += [entry for entry in read_json(raw / "terra-boundaries-UKR.json")["features"]
                    if entry["properties"]["shapeISO"] in CLAIMS]
        atlas["notice"] = ("Пунктиром показаны шесть территорий Украины, на которые претендует Россия. "
                           "Пунктир проходит по административным границам Украины.")
        atlas["noticeSource"] = "https://docs.un.org/A/RES/ES-11/4"
    for entry in entries:
        info = entry["properties"]
        key = info["shapeISO"]
        claimed = key in CLAIMS
        if claimed:
            name = CLAIMS[key]
        elif code == "RUS":
            name = RUSSIA[info["shapeName"]]
        elif code == "JPN":
            name = JAPAN[int(key.split("-")[-1]) - 1]
        else:
            name = USA.get(key.split("-")[-1])
            if not name:
                continue
        add_item(atlas, key or info["shapeID"], name, geometry(entry, .016 if code == "JPN" else .035), claimed=claimed)
    expected = {"RUS": 89, "JPN": 47, "USA": 50}[code]
    actual = len({item["id"] for item in atlas["countries"]})
    if actual != expected or actual != len(atlas["countries"]):
        raise ValueError(f"{code}: expected {expected} unique subdivisions, got {actual}")
    return atlas


def historical_map(path, title, note, source, url):
    atlas = {"features": [], "countries": [], "title": title, "note": note, "source": source, "url": url}
    grouped = {}
    for entry in read_json(path)["features"]:
        props = entry["properties"]
        name = props.get("NAME") or props.get("country_name") or props.get("name")
        if not name or name == "Antarctica":
            continue
        parent = props.get("SUBJECTO") or props.get("owner") or name
        group = grouped.setdefault(name, {"shapes": [], "parent": parent})
        group["shapes"].extend(geometry(entry, .065) or [])
    for index, (name, group) in enumerate(grouped.items()):
        color = PALETTE[zlib.crc32(str(group["parent"]).encode()) % len(PALETTE)]
        add_item(atlas, f"H-{index}", HISTORICAL_NAMES.get(name, name), group["shapes"], terrain=color)
    if len(atlas["countries"]) < 40:
        raise ValueError(f"Only {len(atlas['countries'])} historical territories in {path}")
    return atlas


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("raw", type=Path)
    args = parser.parse_args()
    atlas = {label: subdivisions(args.raw, code) for label, code in [("japan", "JPN"), ("russia", "RUS"), ("usa", "USA")]}
    basemaps = "https://github.com/aourednik/historical-basemaps"
    atlas["history"] = {
        "1938": historical_map(args.raw / "terra-boundaries-1938.json", "1938 · Накануне войны",
                               "Границы государств, колоний и зависимых территорий накануне войны. Нажми на территорию, чтобы увидеть её название.",
                               "Historical Basemaps", basemaps),
        "1945": historical_map(args.raw / "terra-boundaries-1945.json", "1945 · Конец войны",
                               "Границы и зоны оккупации в историческом срезе 1945 года. Нажми на территорию, чтобы увидеть её название.",
                               "Historical Basemaps", basemaps),
    }
    wartime = args.raw / "terra-boundaries-1942.json"
    if wartime.exists():
        atlas["history"]["1942"] = historical_map(
            wartime, "1 января 1942 · Во время войны",
            "Исторические административные границы на 1 января 1942 года по набору CShapes. Выбери территорию, чтобы увидеть её название.",
            "CShapes 2.0", "https://icr.ethz.ch/data/cshapes/")
    (DIST / "atlases.js").write_text("const ATLAS_DATA = " + json.dumps(atlas, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    print({name: len(data.get("countries", data)) for name, data in atlas.items()})


if __name__ == "__main__":
    main()

