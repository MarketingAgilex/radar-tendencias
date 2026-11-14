#!/usr/bin/env python3
"""Recolector del Radar de Tendencias.

Modos:
  pulso     (cada hora)    Google Trends "Trending now" + titulares por país, ciudades y público hispano de EE. UU.
  sectores  (cada 6 horas) Titulares de las últimas 24 h por país y sector.
  diario    (una vez al día) Lo más leído en Wikipedia por país y festivos oficiales.

Solo usa la biblioteca estándar de Python: no requiere instalar nada.
"""
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
DATA = RAIZ / "data"
CATALOGO = json.loads((RAIZ / "config" / "catalogo.json").read_text(encoding="utf-8"))
AHORA = datetime.now(timezone.utc)
import unicodedata
_FILTROS = json.loads((RAIZ / "config" / "filtros.json").read_text(encoding="utf-8"))
_TERMINOS = sorted({t for c in _FILTROS["categorias"].values() for t in c["terminos"]} | set(_FILTROS.get("extra", [])), key=len, reverse=True)
_PATRON = re.compile(r"\b(" + "|".join(re.escape(t) for t in _TERMINOS) + r")\b") if _TERMINOS else None


def _normal(texto):
    t = unicodedata.normalize("NFD", str(texto or "").lower())
    return "".join(c for c in t if unicodedata.category(c) != "Mn")


def sensible(*textos):
    """True si algún texto toca un tema excluido (config/filtros.json)."""
    return bool(_PATRON and any(_PATRON.search(_normal(x)) for x in textos if x))
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
ERRORES = []


# ---------------------------------------------------------------- utilidades
def iso(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if dt else None


UA_WIKI = "RadarTendencias/1.0 (https://github.com/MarketingAgilex/radar-tendencias; marketing Agilex)"


def descargar(url, intentos=3, pausa=1.0):
    for i in range(intentos):
        try:
            ua = UA_WIKI if "wikimedia.org" in url else UA
            req = urllib.request.Request(url, headers={"User-Agent": ua, "Accept-Language": "es,en;q=0.8"})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if i == intentos - 1:
                ERRORES.append({"url": url[:200], "error": str(e)[:200], "hora": iso(AHORA)})
                return None
            time.sleep(pausa * (i + 1) + random.random())
    return None


def leer_json(nombre, defecto):
    ruta = DATA / nombre
    if ruta.exists():
        try:
            return json.loads(ruta.read_text(encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return defecto


def guardar_json(nombre, datos):
    ruta = DATA / nombre
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")


def local(tag):
    return tag.split("}", 1)[-1]


def hijo(el, nombre):
    for c in el:
        if local(c.tag) == nombre:
            return (c.text or "").strip()
    return ""


def fecha_rss(texto):
    try:
        return parsedate_to_datetime(texto)
    except Exception:  # noqa: BLE001
        return None


def trafico_a_numero(texto):
    """'2K+' -> 2000, '1M+' -> 1000000, '200+' -> 200."""
    if not texto:
        return 0
    t = texto.replace(",", "").replace(".", "").replace("+", "").strip().upper()
    m = re.match(r"(\d+)\s*([KM]?)", t)
    if not m:
        return 0
    n = int(m.group(1))
    return n * {"K": 1_000, "M": 1_000_000}.get(m.group(2), 1)


# ---------------------------------------------------------------- fuentes
def google_trends(geo):
    raw = descargar(f"https://trends.google.com/trending/rss?geo={urllib.parse.quote(geo)}")
    if not raw:
        return None
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        ERRORES.append({"url": f"trends:{geo}", "error": f"XML: {e}", "hora": iso(AHORA)})
        return None
    salida = []
    for pos, item in enumerate(root.iter("item"), start=1):
        titulo = hijo(item, "title")
        if not titulo:
            continue
        noticias = []
        for c in item:
            if local(c.tag) == "news_item":
                noticias.append({
                    "titulo": hijo(c, "news_item_title"),
                    "url": hijo(c, "news_item_url"),
                    "fuente": hijo(c, "news_item_source"),
                })
        trafico = hijo(item, "approx_traffic")
        salida.append({
            "termino": titulo,
            "posicion": pos,
            "trafico": trafico,
            "trafico_num": trafico_a_numero(trafico),
            "inicio": iso(fecha_rss(hijo(item, "pubDate"))),
            "imagen": hijo(item, "picture"),
            "imagen_fuente": hijo(item, "picture_source"),
            "noticias": noticias[:3],
        })
    return [t for t in salida if not sensible(t["termino"], *(n["titulo"] for n in t["noticias"][:1]))]


def google_news(params, consulta=None, max_items=12):
    p = dict(params)
    sufijo = p.pop("sufijo", None)
    p.pop("respaldo", None)
    if consulta:
        q = consulta if not sufijo else f"({consulta}) {sufijo}"
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": q, **p})
    elif sufijo:
        url = "https://news.google.com/rss/search?" + urllib.parse.urlencode({"q": f"{sufijo} when:1d", **p})
    else:
        url = "https://news.google.com/rss?" + urllib.parse.urlencode(p)
    raw = descargar(url)
    if not raw:
        return None
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return None
    salida = []
    for item in root.iter("item"):
        titulo = hijo(item, "title")
        fuente = hijo(item, "source")
        if fuente and titulo.endswith(" - " + fuente):
            titulo = titulo[: -len(fuente) - 3]
        if sensible(titulo):
            continue
        salida.append({
            "titulo": titulo,
            "fuente": fuente,
            "url": hijo(item, "link"),
            "fecha": iso(fecha_rss(hijo(item, "pubDate"))),
        })
        if len(salida) >= max_items:
            break
    return salida


def noticias_pais(pais, consulta=None, max_items=12):
    res = google_news(pais["news"], consulta, max_items)
    if not res and pais["news"].get("respaldo"):
        res = google_news(pais["news"]["respaldo"], consulta, max_items)
    return res or []


def youtube_populares(region):
    clave = os.environ.get("YOUTUBE_API_KEY")
    if not clave:
        return None  # sin clave: se omite hasta que se configure el secreto en GitHub
    url = "https://www.googleapis.com/youtube/v3/videos?" + urllib.parse.urlencode(
        {"part": "snippet,statistics", "chart": "mostPopular", "regionCode": region, "maxResults": 12, "key": clave})
    raw = descargar(url, intentos=2)
    if not raw:
        return None
    try:
        items = json.loads(raw).get("items", [])
    except Exception:  # noqa: BLE001
        return None
    return [{
        "titulo": v["snippet"]["title"],
        "canal": v["snippet"].get("channelTitle", ""),
        "url": f"https://www.youtube.com/watch?v={v['id']}",
        "imagen": v["snippet"].get("thumbnails", {}).get("medium", {}).get("url", ""),
        "vistas": int(v.get("statistics", {}).get("viewCount", 0)),
        "publicado": v["snippet"].get("publishedAt"),
    } for v in items if not sensible(v["snippet"]["title"])]


# ---------------------------------------------------------------- modos
def modo_pulso():
    historial = leer_json("historial_trends.json", {})
    pulso = {"actualizado": iso(AHORA), "paises": {}}
    limite = AHORA - timedelta(days=7)

    def registrar(clave, trends):
        h = historial.setdefault(clave, {})
        for t in trends:
            k = t["termino"].lower()
            reg = h.get(k)
            if not reg:
                reg = {"termino": t["termino"], "primera_vez": iso(AHORA), "veces": 0, "max_trafico": 0, "imagen": ""}
                h[k] = reg
            reg["ultima_vez"] = iso(AHORA)
            reg["veces"] += 1
            reg["max_trafico"] = max(reg["max_trafico"], t["trafico_num"])
            reg["trafico"] = t["trafico"] if t["trafico_num"] >= reg["max_trafico"] else reg.get("trafico", t["trafico"])
            if t.get("imagen"):
                reg["imagen"] = t["imagen"]
            if t.get("noticias"):
                reg["noticia"] = t["noticias"][0]
            t["primera_vez"] = reg["primera_vez"]
            t["horas_en_tendencia"] = reg["veces"]
            t["nuevo"] = (AHORA - datetime.fromisoformat(reg["primera_vez"].replace("Z", "+00:00"))) <= timedelta(hours=2)
        # depurar entradas viejas
        for k in [k for k, v in h.items() if datetime.fromisoformat(v["ultima_vez"].replace("Z", "+00:00")) < limite]:
            del h[k]

    for pais in CATALOGO["paises"]:
        bloque = {"actualizado": iso(AHORA), "trends": [], "titulares": [], "ciudades": {}}
        trends = google_trends(pais["trends_geo"])
        if trends is not None:
            registrar(pais["id"], trends)
            bloque["trends"] = trends
        bloque["titulares"] = noticias_pais(pais, max_items=15)
        for clave in ("viral", "consumo"):
            q = CATALOGO["consultas"][clave].get(pais["lang"]) or CATALOGO["consultas"][clave]["en"]
            bloque[clave] = noticias_pais(pais, f"({q}) when:1d", 15)
        yt = youtube_populares(pais["id"])
        if yt:
            bloque["youtube"] = yt
        if pais.get("news_hispano"):
            bloque["titulares_hispanos"] = google_news(pais["news_hispano"], max_items=12) or []
        for ciudad in pais.get("ciudades", []):
            c = {"nombre": ciudad["nombre"], "titulares": noticias_pais(pais, f'"{ciudad["q"]}" when:1d', 8)}
            if ciudad.get("trends_geo"):
                ct = google_trends(ciudad["trends_geo"])
                if ct:
                    registrar(f'{pais["id"]}/{ciudad["id"]}', ct)
                    c["trends"] = ct
                    c["nivel_trends"] = "región"
            bloque["ciudades"][ciudad["id"]] = c
            time.sleep(0.4)
        # tendencias de la semana (para el filtro de periodo y gráficas)
        semana = sorted(historial.get(pais["id"], {}).values(), key=lambda r: (r["max_trafico"], r["veces"]), reverse=True)
        bloque["semana"] = semana[:40]
        pulso["paises"][pais["id"]] = bloque
        time.sleep(0.6)

    guardar_json("pulso.json", pulso)
    guardar_json("historial_trends.json", historial)


def modo_sectores():
    previo = leer_json("sectores.json", {"paises": {}})
    salida = {"actualizado": iso(AHORA), "paises": {}}
    for pais in CATALOGO["paises"]:
        salida["paises"][pais["id"]] = {}
        for sector in CATALOGO["sectores"]:
            consulta = sector["q"].get(pais["lang"]) or sector["q"]["en"]
            items = noticias_pais(pais, f"({consulta}) when:1d", 8)
            if not items:  # conservar lo anterior si la fuente falló
                items = previo.get("paises", {}).get(pais["id"], {}).get(sector["id"], [])
            salida["paises"][pais["id"]][sector["id"]] = items
            time.sleep(0.5 + random.random() * 0.5)
    guardar_json("sectores.json", salida)


def modo_diario():
    # Lo más leído en Wikipedia por país (ayer; si aún no está publicado, antier)
    excluir = re.compile(r"^(Special|Especial|Spécial|Spezial|Speciale|Speciaal|Main_Page|Wikipedia|Portal|Archivo|File|Datei|Fichier|Ficheiro|Bestand|Categoría|Category|Ayuda|Help|Usuario|User|Plantilla|Template|-)", re.I)
    portadas = {"Main_Page", "Wikipedia:Portada", "Página_principal", "Wikipédia:Accueil_principal", "Wikipedia:Hauptseite", "Pagina_principale", "Hoofdpagina", "Wikipédia:Página_principal"}
    wiki = {"actualizado": iso(AHORA), "paises": {}}
    for pais in CATALOGO["paises"]:
        articulos = []
        for dias in (1, 2, 3):
            d = AHORA - timedelta(days=dias)
            url = f"https://wikimedia.org/api/rest_v1/metrics/pageviews/top-per-country/{pais['id']}/all-access/{d:%Y}/{d:%m}/{d:%d}"
            raw = descargar(url, intentos=3, pausa=3.0)
            time.sleep(1.5)
            if not raw:
                continue
            try:
                datos = json.loads(raw)["items"][0]["articles"]
            except Exception:  # noqa: BLE001
                continue
            for a in datos:
                art = a.get("article", "")
                if art in portadas or excluir.match(art) or ":" in art:
                    continue
                articulos.append({
                    "articulo": art.replace("_", " "),
                    "proyecto": a.get("project", ""),
                    "vistas": a.get("views_ceil") or a.get("views", 0),
                    "url": f"https://{a.get('project', 'en.wikipedia')}.org/wiki/{urllib.parse.quote(art)}",
                })
                if len(articulos) >= 30:
                    break
            if articulos:
                wiki["paises"][pais["id"]] = {"fecha": f"{d:%Y-%m-%d}", "articulos": articulos}
                break
        if pais["id"] not in wiki["paises"]:  # conservar el dato anterior si hoy no hubo
            anterior = leer_json("wikipedia.json", {"paises": {}}).get("paises", {}).get(pais["id"])
            if anterior:
                wiki["paises"][pais["id"]] = anterior
    guardar_json("wikipedia.json", wiki)

    # Festivos oficiales (año actual y siguiente)
    festivos = {"actualizado": iso(AHORA), "paises": {}}
    for pais in CATALOGO["paises"]:
        lista = []
        for anio in (AHORA.year, AHORA.year + 1):
            raw = descargar(f"https://date.nager.at/api/v3/PublicHolidays/{anio}/{pais['id']}", intentos=2)
            if raw:
                try:
                    for f in json.loads(raw):
                        if f.get("global", True):
                            lista.append({"fecha": f["date"], "nombre": f.get("localName"), "nombre_en": f.get("name")})
                except Exception:  # noqa: BLE001
                    pass
        festivos["paises"][pais["id"]] = lista
        time.sleep(0.2)
    guardar_json("festivos.json", festivos)


def registrar_estado(modo, inicio):
    guardar_json(f"estado/{modo}.json", {
        "ultima_ejecucion": iso(AHORA),
        "duracion_seg": round(time.time() - inicio, 1),
        "errores": len(ERRORES),
        "muestra_errores": ERRORES[:10],
    })


if __name__ == "__main__":
    modo = sys.argv[1] if len(sys.argv) > 1 else "pulso"
    inicio = time.time()
    {"pulso": modo_pulso, "sectores": modo_sectores, "diario": modo_diario}[modo]()
    registrar_estado(modo, inicio)
    print(f"[{modo}] listo en {time.time() - inicio:.1f}s con {len(ERRORES)} errores")
