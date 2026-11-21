import argparse
import csv
import html
import json
import re
import zipfile
from pathlib import Path

from build_data import DIST, read_json

ROOT = Path(__file__).parent
YEAR = 2024
FEDERATIONS = set("AE AR AT AU BA BE BR CA CH DE ET FM IN IQ KM KN MX MY NG NP PK RU SO US VE".split())
DEVOLVED = set("ES GB ID IT KE PG PH TZ UA ZA".split())
STRUCTURE = {
    "SD": "Федеративное устройство (переходный период)",
    "SS": "Децентрализованное устройство",
}
GOVERNMENT = {
    "AE": "Федерация монархий", "AF": "Исламский эмират (де-факто)", "BH": "Конституционная монархия",
    "BN": "Абсолютная монархия", "BT": "Парламентская монархия",
    "CN": "Социалистическая республика", "CU": "Социалистическая республика",
    "IR": "Исламская республика с теократическими институтами",
    "KP": "Социалистическая республика", "LA": "Социалистическая республика",
    "LY": "Переходные институты, разделённая власть",
    "MM": "Военное правление", "NE": "Военное переходное правление",
    "OM": "Абсолютная монархия", "PS": "Республика с ограниченным самоуправлением",
    "QA": "Наследственная монархия", "RS": "Парламентская республика", "ER": "Президентская республика", "SD": "Переходное правление, разделённая власть",
    "SY": "Переходное правление", "TW": "Полупрезидентская республика",
    "VA": "Выборная абсолютная монархия, теократия",
    "VN": "Социалистическая республика", "YE": "Переходные институты, разделённая власть",
    "XK": "Парламентская республика",
}
REGIMES = (
    "Закрытая автократия", "Электоральная автократия", "Электоральная демократия", "Либеральная демократия"
)
ORGANIZATIONS = {
    "eu": ("ЕС", "https://european-union.europa.eu/principles-countries-history/eu-countries_en",
           "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE"),
    "nato": ("НАТО", "https://www.nato.int/cps/en/natohq/topics_52044.htm",
             "AL BE BG CA HR CZ DK EE FI FR DE GR HU IS IT LV LT LU ME NL MK NO PL PT RO SK SI ES SE TR GB US"),
    "asean": ("АСЕАН", "https://asean.org/member-states/", "BN KH ID LA MY MM PH SG TH TL VN"),
    "au": ("Африканский союз", "https://au.int/en/member_states/countryprofiles",
           "DZ AO BJ BW BF BI CV CM CF TD KM CG CD DJ EG GQ ER SZ ET GA GM GH GN GW CI KE LS LR LY MG MW ML MR MU MA MZ NA NE NG RW ST SN SC SL SO ZA SS SD TZ TG TN UG ZM ZW"),
    "eaeu": ("ЕАЭС", "https://eaeunion.org/", "AM BY KZ KG RU"),
    "csto": ("ОДКБ", "https://odkb-csto.org/countries/", "AM BY KZ KG RU TJ"),
    "mercosur": ("МЕРКОСУР", "https://www.mercosur.int/quienes-somos/paises-del-mercosur/", "AR BO BR PY UY"),
    "commonwealth": ("Содружество наций", "https://thecommonwealth.org/our-member-countries",
                     "AG AU BS BD BB BZ BW BN CM CA CY DM SZ FJ GA GM GH GD GY IN JM KE KI LS MW MY MV MT MU MZ NA NR NZ NG PK PG RW KN LC VC WS SC SL SG SB ZA LK TZ TG TO TT TV UG GB VU ZM"),
    "arab": ("Лига арабских государств", "https://www.lasportal.org/",
             "DZ BH KM DJ EG IQ JO KW LB LY MR MA OM PS QA SA SO SD SY TN AE YE"),
    "gcc": ("ССАГПЗ", "https://www.gcc-sg.org/en-us/AboutGCC/MemberStates/Pages/Home.aspx", "BH KW OM QA SA AE"),
    "apec": ("АТЭС", "https://www.apec.org/about-us/about-apec/member-economies",
             "AU BN CA CL CN ID JP KR MY MX NZ PG PE PH RU SG TW TH US VN"),
    "caricom": ("КАРИКОМ", "https://caricom.org/member-and-associate-states/",
                "AG BS BB BZ DM GD GY HT JM KN LC VC SR TT"),
    "sco": ("ШОС", "https://eng.sectsco.org/", "BY CN IN IR KZ KG PK RU TJ UZ"),
    "brics": ("БРИКС", "https://brics.br/en/about-the-brics", "BR CN EG ET IN ID IR RU ZA AE"),
    "union-state": ("Союзное государство", "https://soyuz.by/", "BY RU"),
    "efta": ("ЕАСТ", "https://www.efta.int/about-efta/member-states", "IS LI NO CH"),
    "pacific": ("Форум тихоокеанских островов", "https://forumsec.org/who-we-arepacific-islands-forum",
                "AU FM FJ KI MH NR NZ PW PG WS SB TO TV VU"),
}
SOURCES = {
    "Население, Всемирный банк": "https://data.worldbank.org/indicator/SP.POP.TOTL",
    "Номинальный ВВП, Всемирный банк": "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD",
    "ВВП по ППС, Всемирный банк": "https://data.worldbank.org/indicator/NY.GDP.MKTP.PP.CD",
    "Форма правления, World Factbook 2025": "https://thefactbook.org/fields/government-type",
    "Политический режим, V-Dem, таблица 1 (CC BY-SA 4.0)": "https://v-dem.net/documents/75/V-Dem_Institute_Democracy_Report_2026_lowres.pdf#page=16",
}


def countries():
    world = (DIST / "world.js").read_text(encoding="utf-8").removeprefix("const WORLD = ").rstrip(";\n")
    return json.loads(world)["countries"]


def indicator(*paths):
    result = {}
    for path in paths:
        if not path.exists():
            continue
        for row in read_json(path)[1] or []:
            key = row["country"]["id"]
            year = int(row["date"])
            if row["value"] is not None and year > result.get(key, {}).get("year", 0):
                result[key] = {"value": round(row["value"]), "year": year}
    return result


def factbook(raw):
    with (raw / "terra-extra-codes").open(encoding="utf-8-sig", newline="") as fp:
        codes = {row["ISO3166-1-Alpha-2"]: row["FIPS"] for row in csv.DictReader(fp)}
    codes.update({"XK": "KV"})
    with zipfile.ZipFile(raw / "terra-extra-facts-archive") as archive:
        filenames = {Path(name).stem.upper(): name for name in archive.namelist() if name.count("/") == 2 and name.endswith(".json")}
        return {iso: json.loads(archive.read(filenames[fips])) for iso, fips in codes.items() if fips in filenames}


def government(iso, info):
    value = info.get("Government", {}).get("Government type", {}).get("text", "")
    text = html.unescape(re.sub(r"<[^>]+>", " ", value)).lower()
    if iso in GOVERNMENT:
        return GOVERNMENT[iso], text
    if "monarchy" in text or "emirate" in text:
        if "absolute" in text:
            return "Абсолютная монархия", text
        if "parliamentary" in text:
            return "Парламентская монархия", text
        if "constitutional" in text:
            return "Конституционная монархия", text
        return "Монархия", text
    if "parliamentary" in text:
        return "Парламентская республика", text
    if "semi-presidential" in text or "semi presidential" in text:
        return "Полупрезидентская республика", text
    if "presidential" in text:
        return "Президентская республика", text
    if "republic" in text:
        return "Республика", text
    if "military" in text or "junta" in text:
        return "Военное правление", text
    if "transitional" in text or "provisional" in text:
        return "Переходное правление", text
    return None, text


def structure(iso, text):
    if iso in STRUCTURE:
        return STRUCTURE[iso]
    if iso in FEDERATIONS or "federal" in text:
        return "Федерация"
    if iso in DEVOLVED:
        return "Унитарное, децентрализованное"
    return "Унитарное государство"


def regime_rows():
    result = {}
    for line in (ROOT / "country-regimes.txt").read_text(encoding="utf-8-sig").splitlines():
        if not line.strip():
            continue
        category, codes = line.split("|", maxsplit=1)
        label = REGIMES[int(category[0])]
        if len(category) > 1:
            label += " (пограничная оценка)"
        for code in codes.split():
            result[code] = {"year": 2025, "label": label}
    result["PS"] = {"year": 2025, "label": "Западный берег — электоральная автократия, Газа — закрытая автократия"}
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("raw", type=Path)
    args = parser.parse_args()
    raw = args.raw
    facts = {row[0]: row[1:] for line in (ROOT / "country-history.txt").read_text(encoding="utf-8-sig").splitlines()
             if line.strip() for row in [line.split("|")]}

    pop = indicator(raw / "terra-population-wb.json")
    gdp = indicator(raw / "terra-extra-gdp", raw / "terra-extra-older-gdp")
    ppp = indicator(raw / "terra-extra-ppp", raw / "terra-extra-older-ppp")
    pop.update({"VA": {"value": 882, "year": YEAR}, "TW": {"value": 23400000, "year": YEAR}})
    gdp["TW"] = {"value": 801500000000, "year": YEAR}
    ppp["TW"] = {"value": 1884000000000, "year": YEAR}
    regimes = regime_rows()
    raw_factbook = factbook(raw)
    out = {}
    for country in countries():
        iso = country["id"]
        gov, desc = government(iso, raw_factbook.get(iso, {}))
        links = {}
        if iso == "VA":
            links["Население Ватикана"] = "https://www.vaticanstate.va/en/state-and-government/general-informations/population.html"
        if iso == "TW":
            links["Экономика и население Тайваня, МВФ"] = "https://assets.publishing.service.gov.uk/media/6ae9e81bc4e9914878121f24/taiwan-trade-and-investment-factsheet-2026-11-06.pdf"
        out[iso] = {
            "population": pop.get(iso), "gdp": gdp.get(iso), "ppp": ppp.get(iso), "government": gov,
            "structure": structure(iso, desc),
            "regime": regimes.get(iso),
            "unions": [key for key, (_, _, members) in ORGANIZATIONS.items() if iso in members.split()],
            "facts": facts[iso], "sources": links,
        }
    if len(regimes) < 150:
        raise ValueError(f"Only {len(regimes)} verified regime rows")
    data = {"profiles": out, "unions": {key: {"name": value[0], "url": value[1]} for key, value in ORGANIZATIONS.items()}, "sources": SOURCES}
    (DIST / "country-info.js").write_text("const COUNTRY_INFO = " + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n", encoding="utf-8")
    for key in ("population", "gdp", "ppp", "government", "regime"):
        missing = [k for k, v in out.items() if not v[key]]
        print(key, "available for", len(out) - len(missing), "missing", ", ".join(missing))


if __name__ == "__main__":
    main()


