/* Pulso Global · Grown IA × Ágilex */
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  const ISO_NUM = { CO: 170, MX: 484, EC: 218, US: 840, CA: 124, PE: 604, CL: 152, AR: 32, ES: 724, PT: 620, GB: 826, FR: 250, IT: 380, DE: 276, NL: 528 };
  const REGIONES = { "América Latina": ["CO", "MX", "EC", "PE", "CL", "AR"], "Norteamérica": ["US", "CA"], "Europa": ["ES", "PT", "GB", "FR", "IT", "DE", "NL"] };

  const S = { cat: null, pulso: null, sectores: null, festivos: null, dicc: null, insights: {}, pestana: "pulso",
    f: { pais: "EC", ciudad: "", audiencia: "general", sector: "", red: "TikTok", periodo: "ahora", buscar: "" }, comp: ["EC", "CO"] };

  const cargar = (url) => fetch(url + (url.includes("?") ? "&" : "?") + "v=" + Math.floor(Date.now() / 300000)).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const pais = (id) => S.cat.paises.find((p) => p.id === id);
  const bandera = (id) => pais(id)?.bandera || "";
  const hace = (iso) => {
    if (!iso) return "";
    const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `hace ${h} h`;
    return `hace ${Math.round(h / 24)} días`;
  };
  const toast = (t) => { const el = $("#toast"); el.textContent = t; el.classList.add("ver"); setTimeout(() => el.classList.remove("ver"), 2200); };
  const copiar = (t, msg) => navigator.clipboard?.writeText(t).then(() => toast(msg || "Copiado"));
  const vacio = (titulo, texto) => `<div class="vacio"><b>${esc(titulo)}</b>${esc(texto)}</div>`;
  const coincide = (texto) => !S.f.buscar || norm(texto).includes(norm(S.f.buscar));

  // ------------------------------------------------------------------ estado en la URL
  function leerHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const k of Object.keys(S.f)) if (p.has(k)) S.f[k] = p.get(k);
    if (p.has("tab")) S.pestana = p.get("tab");
    if (p.has("comp")) S.comp = p.get("comp").split(",").slice(0, 2);
  }
  function escribirHash() {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(S.f)) if (v) p.set(k, v);
    p.set("tab", S.pestana);
    if (S.pestana === "comparador") p.set("comp", S.comp.join(","));
    history.replaceState(null, "", "#" + p.toString());
  }

  // ------------------------------------------------------------------ arranque
  async function iniciar() {
    leerHash();
    const [cat, pulso, sectores, festivos, dicc] = await Promise.all([
      cargar("config/catalogo.json"), cargar("data/pulso.json"), cargar("data/sectores.json"), cargar("data/festivos.json"), cargar("data/insights/diccionario.json"),
    ]);
    Object.assign(S, { cat, pulso, sectores, festivos, dicc });
    await Promise.all(cat.paises.map(async (p) => { S.insights[p.id] = await cargar(`data/insights/${p.id}.json`); }));
    if (!pais(S.f.pais)) S.f.pais = "EC";
    llenarFiltros();
    pintarCabecera();
    pintarTicker();
    pintarRegiones();
    pintarMapa();
    enlazar();
    activarPestana(S.pestana, false);
    setInterval(async () => { const p = await cargar("data/pulso.json"); if (p && p.actualizado !== S.pulso?.actualizado) { S.pulso = p; pintarCabecera(); pintarTicker(); pintar(); toast("Nuevas tendencias recibidas"); } }, 5 * 60000);
    setInterval(pintarCabecera, 60000);
    window.addEventListener("hashchange", () => { leerHash(); if (!pais(S.f.pais)) S.f.pais = "EC"; llenarFiltros(); pintarEtiquetasMapa(); marcarRegion(); activarPestana(S.pestana, false); });
  }

  function pintarCabecera() {
    const act = S.pulso?.actualizado;
    $("#estado-vivo").textContent = act ? `En vivo · actualizado ${hace(act)}` : "Sin datos todavía";
    const min = act ? Math.round((Date.now() - new Date(act)) / 60000) : null;
    $("#cifra-hace").textContent = min == null ? "—" : min < 60 ? `${min} min` : `${Math.round(min / 60)} h`;
    const total = Object.values(S.pulso?.paises || {}).reduce((a, p) => a + (p.semana?.length || 0), 0);
    $("#cifra-trends").textContent = total || "—";
  }

  function pintarTicker() {
    const items = [];
    for (const [id, p] of Object.entries(S.pulso?.paises || {})) for (const t of (p.trends || []).slice(0, 4)) items.push({ id, t });
    items.sort((a, b) => (b.t.nuevo - a.t.nuevo) || (b.t.trafico_num - a.t.trafico_num));
    const html = items.slice(0, 40).map(({ id, t }) => `<span class="ticker-item" data-pais="${id}">${bandera(id)} <b>${esc(t.termino)}</b> ${esc(t.trafico || "")} ${t.nuevo ? '<span class="nuevo">NUEVO</span>' : ""}</span>`).join("");
    $("#ticker").innerHTML = html + html;
  }

  // ------------------------------------------------------------------ mapa
  async function pintarMapa() {
    const caja = $("#mapa");
    if (!window.d3 || !window.topojson) { caja.innerHTML = ""; return; }
    let mundo;
    try { mundo = await d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"); } catch { return; }
    const ancho = 1000, alto = 520;
    const svg = d3.select(caja).append("svg").attr("viewBox", `0 0 ${ancho} ${alto}`).attr("role", "img").attr("aria-label", "Mapa de países monitoreados");
    const defs = svg.append("defs");
    const f = defs.append("filter").attr("id", "brillo").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
    f.append("feGaussianBlur").attr("stdDeviation", 1.4).attr("result", "b");
    const m = f.append("feMerge"); m.append("feMergeNode").attr("in", "b"); m.append("feMergeNode").attr("in", "SourceGraphic");
    const g = defs.append("linearGradient").attr("id", "gradAmarillo");
    g.append("stop").attr("offset", "0").attr("stop-color", "#f9b916"); g.append("stop").attr("offset", "1").attr("stop-color", "#fde08a");
    const paises = topojson.feature(mundo, mundo.objects.countries).features.filter((d) => d.id !== "010");
    const proy = d3.geoNaturalEarth1().fitExtent([[10, 10], [ancho - 10, alto - 10]], { type: "FeatureCollection", features: paises });
    const ruta = d3.geoPath(proy);
    const porNum = Object.fromEntries(Object.entries(ISO_NUM).map(([k, v]) => [v, k]));
    svg.append("g").selectAll("path").data(paises).join("path")
      .attr("d", ruta)
      .attr("class", (d) => (porNum[+d.id] ? "pais-activo" : "pais-base"))
      .attr("data-pais", (d) => porNum[+d.id] || null)
      .on("click", (e, d) => { const id = porNum[+d.id]; if (id) seleccionarPais(id, true); })
      .on("mousemove", (e, d) => { const id = porNum[+d.id]; if (id) tip(e, `${bandera(id)} <b>${esc(pais(id).nombre)}</b><br>${esc(topTrend(id))}`); })
      .on("mouseleave", ocultarTip);
    const etiquetas = svg.append("g").attr("id", "etiquetas");
    S._mapa = { proy, ruta, paises, porNum, etiquetas };
    pintarEtiquetasMapa();
  }
  function topTrend(id) { const t = S.pulso?.paises?.[id]?.trends?.[0]; return t ? `Sube: ${t.termino}` : "Toca para explorar"; }
  function pintarEtiquetasMapa() {
    if (!S._mapa) return;
    const { ruta, paises, porNum, etiquetas } = S._mapa;
    $$(".pais-activo").forEach((el) => el.classList.toggle("pais-sel", el.dataset.pais === S.f.pais));
    const mostrar = [S.f.pais, ...Object.keys(ISO_NUM).filter((k) => k !== S.f.pais && ["US", "ES", "MX", "CO", "AR", "DE"].includes(k))];
    const datos = mostrar.map((id) => {
      const feat = paises.find((d) => +d.id === ISO_NUM[id]);
      if (!feat) return null;
      let [x, y] = ruta.centroid(feat);
      if (id === "US") { x += 25; y += 15; } if (id === "CA") { y += 40; }
      if (id === "FR") { x -= 10; } if (id === "NL") { y -= 8; }
      return { id, x, y };
    }).filter(Boolean);
    etiquetas.selectAll("g").remove();
    const gg = etiquetas.selectAll("g").data(datos).join("g").attr("class", "etiqueta-mapa").attr("transform", (d) => `translate(${d.x},${d.y})`)
      .on("click", (e, d) => seleccionarPais(d.id, true));
    gg.append("circle").attr("r", 3.5);
    gg.each(function (d) {
      const txt = (d.id === S.f.pais ? "● " : "") + pais(d.id).nombre;
      const w = txt.length * 6.6 + 18;
      d3.select(this).append("rect").attr("x", 8).attr("y", -11).attr("rx", 11).attr("width", w).attr("height", 22).attr("opacity", d.id === S.f.pais ? 1 : 0.85);
      d3.select(this).append("text").attr("x", 17).attr("y", 4).text(txt);
    });
  }
  function pintarRegiones() {
    const caja = $("#regiones");
    caja.innerHTML = Object.keys(REGIONES).map((r) => `<button class="chip" data-region="${esc(r)}">${esc(r)}</button>`).join("");
    marcarRegion();
  }
  function marcarRegion() { $$("#regiones .chip").forEach((c) => c.classList.toggle("activo", REGIONES[c.dataset.region].includes(S.f.pais))); }
  function tip(e, html) { const t = $("#tooltip"); t.innerHTML = html; t.style.opacity = 1; t.style.left = Math.min(e.clientX + 14, innerWidth - 270) + "px"; t.style.top = e.clientY + 14 + "px"; }
  function ocultarTip() { $("#tooltip").style.opacity = 0; }

  // ------------------------------------------------------------------ filtros
  function llenarFiltros() {
    $("#f-pais").innerHTML = S.cat.paises.map((p) => `<option value="${p.id}">${p.bandera} ${esc(p.nombre)}</option>`).join("");
    const seg = S.cat.segmentos;
    $("#f-audiencia").innerHTML = `<option value="general">Consumidor general</option>` +
      `<optgroup label="B2B">${seg.b2b.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("")}</optgroup>` +
      `<optgroup label="B2C · Generación">${seg.generaciones.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("")}</optgroup>` +
      `<optgroup label="B2C · Perfil psicográfico">${seg.psicograficos.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("")}</optgroup>`;
    $("#f-sector").innerHTML = `<option value="">Todos los sectores</option>` + S.cat.sectores.map((s) => `<option value="${s.id}">${esc(s.nombre)}</option>`).join("");
    $("#f-red").innerHTML = S.cat.redes.map((r) => `<option>${r}</option>`).join("");
    llenarCiudades();
    for (const k of ["pais", "audiencia", "sector", "red", "periodo"]) $(`#f-${k}`).value = S.f[k];
    $("#f-buscar").value = S.f.buscar;
  }
  function llenarCiudades() {
    const c = pais(S.f.pais).ciudades || [];
    $("#f-ciudad").innerHTML = `<option value="">Todo el país</option>` + c.map((x) => `<option value="${x.id}">${esc(x.nombre)}</option>`).join("");
    if (!c.some((x) => x.id === S.f.ciudad)) S.f.ciudad = "";
    $("#f-ciudad").value = S.f.ciudad;
  }
  function seleccionarPais(id, desplazar) {
    S.f.pais = id; S.f.ciudad = "";
    $("#f-pais").value = id; llenarCiudades(); pintarEtiquetasMapa(); marcarRegion(); pintar();
    if (desplazar) $("#radar").scrollIntoView({ behavior: "smooth" });
  }
  function enlazar() {
    $("#f-pais").addEventListener("change", (e) => seleccionarPais(e.target.value));
    for (const k of ["ciudad", "audiencia", "sector", "red", "periodo"]) $(`#f-${k}`).addEventListener("change", (e) => { S.f[k] = e.target.value; pintar(); });
    let t; $("#f-buscar").addEventListener("input", (e) => { clearTimeout(t); t = setTimeout(() => { S.f.buscar = e.target.value.trim(); pintar(); }, 200); });
    $$("#pestanas .pestana").forEach((b) => b.addEventListener("click", () => activarPestana(b.dataset.p)));
    $$("[data-ir]").forEach((a) => a.addEventListener("click", () => activarPestana(a.dataset.ir)));
    $("#regiones").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (b) seleccionarPais(REGIONES[b.dataset.region][0]); });
    $("#ticker").addEventListener("click", (e) => { const it = e.target.closest(".ticker-item"); if (it) { seleccionarPais(it.dataset.pais, true); activarPestana("pulso"); } });
    $("#btn-compartir").addEventListener("click", () => { escribirHash(); copiar(location.href, "Enlace copiado: compártelo"); });
    document.addEventListener("click", (e) => {
      const h = e.target.closest("[data-copiar]"); if (h) copiar(h.dataset.copiar, `Copiado: ${h.dataset.copiar}`);
      const d = e.target.closest("[data-descargar]"); if (d) descargarImagen(d.dataset.descargar);
    });
  }
  function activarPestana(p, desplazar = true) {
    S.pestana = p;
    $$("#pestanas .pestana").forEach((b) => b.classList.toggle("activa", b.dataset.p === p));
    $$(".panel").forEach((x) => x.classList.toggle("activo", x.id === "p-" + p));
    pintar();
    if (desplazar && p) $("#radar").scrollIntoView({ behavior: "smooth" });
  }
  function pintar() {
    escribirHash();
    const fn = { pulso: pPulso, audiencias: pAudiencias, jerga: pJerga, sectores: pSectores, creadores: pCreadores, calendario: pCalendario, oportunidades: pOportunidades, anuncios: pAnuncios, comparador: pComparador }[S.pestana];
    if (fn) $("#p-" + S.pestana).innerHTML = fn();
    if (S.pestana === "comparador") enlazarComparador();
    $$(".barra-fila").forEach((f) => { f.addEventListener("mousemove", (e) => tip(e, f.dataset.tip)); f.addEventListener("mouseleave", ocultarTip); });
  }
  const ins = () => S.insights[S.f.pais];
  const sinFicha = () => vacio(`Ficha de ${pais(S.f.pais).nombre} en preparación`, " La inteligencia artificial publica las fichas de este país en las próximas actualizaciones. Mientras tanto, el pulso en vivo, los sectores y el calendario ya funcionan.");

  // ------------------------------------------------------------------ PULSO
  function tarjetaTrend(t) {
    const sem = (ins()?.semaforo || []).find((s) => norm(s.termino) === norm(t.termino));
    const img = t.imagen ? `style="background-image:url('${esc(t.imagen)}')"` : "";
    const not = t.noticias?.[0] || t.noticia;
    return `<article class="tarjeta trend">
      <div class="trend-img" ${img}><div class="trend-insignias"><span class="insignia ${t.nuevo ? "nuevo" : ""}">${t.nuevo ? "NUEVO" : esc(hace(t.primera_vez))}</span><span class="insignia">${esc(t.trafico || "")} búsquedas</span></div></div>
      <div class="trend-cuerpo">
        <h3>${esc(t.termino)}</h3>
        <div class="trend-meta">${t.horas_en_tendencia || t.veces ? `${t.horas_en_tendencia || t.veces} h en tendencia` : ""}${t.inicio ? ` · empezó ${esc(hace(t.inicio))}` : ""}</div>
        ${not ? `<a class="trend-noticia" href="${esc(not.url)}" target="_blank" rel="noopener">${esc(not.titulo)}${not.fuente ? ` · <i>${esc(not.fuente)}</i>` : ""}</a>` : ""}
        ${sem ? `<div class="semaforo"><span class="luz ${sem.color}"></span><div><b>${{ verde: "Úsalo", amarillo: "Adáptalo con cuidado", rojo: "Evítalo" }[sem.color]}.</b> ${esc(sem.idea)}</div></div>` : ""}
      </div></article>`;
  }
  function barras(lista, campo, etiqueta) {
    const max = Math.max(...lista.map((x) => x[campo] || 0), 1);
    return `<div class="barras">${lista.map((x) => `<div class="barra-fila" data-tip="<b>${esc(x.termino)}</b><br>${esc(x.trafico || x[campo])} búsquedas · visto ${esc(x.veces || 1)} h · desde ${esc(hace(x.primera_vez))}">
      <span class="n">${esc(x.termino)}</span><div class="barra-pista"><div class="barra-relleno" style="width:${(100 * (x[campo] || 0)) / max}%"></div></div><span class="v">${esc(x.trafico || "")}</span></div>`).join("")}</div>
      <p class="aviso">${esc(etiqueta)}</p>`;
  }
  function listaTitulares(lista) {
    lista = (lista || []).filter((h) => coincide(h.titulo));
    if (!lista.length) return vacio("Sin titulares", " No hay titulares que coincidan con tu búsqueda.");
    return `<div class="titulares">${lista.map((h) => `<a class="titular" href="${esc(h.url)}" target="_blank" rel="noopener"><span class="f">${esc(h.fuente || "")}<br>${esc(hace(h.fecha))}</span><span class="t">${esc(h.titulo)}</span></a>`).join("")}</div>`;
  }
  function pPulso() {
    const p = pais(S.f.pais), d = S.pulso?.paises?.[S.f.pais];
    if (!d) return vacio("Aún no hay datos", " La primera recolección está en curso.");
    const ciudad = S.f.ciudad ? d.ciudades?.[S.f.ciudad] : null;
    let trends = ciudad?.trends || d.trends || [];
    if (S.f.periodo !== "ahora") {
      const limite = S.f.periodo === "hoy" ? Date.now() - 864e5 : 0;
      trends = (d.semana || []).filter((t) => new Date(t.ultima_vez) >= limite).map((t) => ({ ...t, trafico_num: t.max_trafico }));
      if (ciudad) trends = ciudad.trends || [];
    }
    trends = [...trends].sort((x, y) => (y.trafico_num || 0) - (x.trafico_num || 0)).filter((t) => coincide(t.termino + " " + (t.noticias?.[0]?.titulo || t.noticia?.titulo || "")));
    const lect = ins()?.lectura;
    const titulo = ciudad ? `${ciudad.nombre}` : `${p.bandera} ${p.nombre}`;
    const nivel = ciudad ? (ciudad.trends ? `Tendencias de la región (${ciudad.nombre} y alrededores)` : "Google no publica tendencias por ciudad aquí: abajo verás los titulares locales") : "";
    const semana = (d.semana || []).slice(0, 12);
    return `
      ${lect && !ciudad ? `<div class="lectura"><div class="ico">✦</div><div><small>Lectura del momento · IA</small><p>${esc(lect)}</p></div></div>` : ""}
      <h2 class="titulo-sec" style="font-size:32px">${esc(titulo)}: <b>lo que está subiendo</b></h2>
      <p class="sub-sec">${nivel || "Búsquedas en Google que más crecen ahora mismo, con la noticia que las explica y, cuando aplica, el semáforo para marcas."}</p>
      ${trends.length ? `<div class="rejilla r3">${trends.slice(0, 12).map(tarjetaTrend).join("")}</div>` : vacio("Sin tendencias para esta vista", " Prueba otro periodo, otra ciudad o borra la búsqueda.")}
      <div class="rejilla r2" style="margin-top:28px">
        <div class="tarjeta"><h3>Lo más fuerte de la semana</h3>${semana.length ? barras(semana, "max_trafico", "Búsquedas aproximadas según Google (valor mínimo publicado). Pasa el cursor para ver detalle.") : vacio("Juntando historial", " Las gráficas se llenan con cada hora de recolección.")}</div>
        <div class="tarjeta"><h3>${ciudad ? `Titulares de ${esc(ciudad.nombre)}` : "Titulares del país"}</h3>${listaTitulares((ciudad?.titulares || d.titulares || []).slice(0, 10))}</div>
      </div>
      ${d.titulares_hispanos && !ciudad ? `<div class="tarjeta" style="margin-top:18px"><h3>Lo que lee la comunidad hispana</h3>${listaTitulares(d.titulares_hispanos.slice(0, 8))}</div>` : ""}`;
  }

  // ------------------------------------------------------------------ AUDIENCIAS
  function ficha(f, idDescarga) {
    const l = (titulo, arr) => (arr?.length ? `<h4>${titulo}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
    return `<div class="tarjeta" id="${idDescarga}">
      <h3 style="font-size:24px;font-weight:500">${bandera(S.f.pais)} ${esc(f.titulo)}</h3>
      <p style="color:var(--texto-2);margin-bottom:6px">${esc(f.resumen)}</p>
      <h4>Cómo habla</h4><p style="color:var(--texto-2)">${esc(f.como_habla)}</p>
      <div class="rejilla r2" style="gap:0 30px">
        <div>${l("Lo que le duele", f.dolores)}${l("Lo que lo mueve", f.motivaciones)}</div>
        <div>${l("Lo que lo frena", f.frenos)}${l("Qué evitar", f.evitar)}</div>
      </div>
      <h4>Tono que funciona</h4><p style="color:var(--texto-2)">${esc(f.tono)}</p>
      ${l("Dónde está", f.canales)}${l("Mensajes que conectan", f.mensajes)}
      <div class="pie-tarjeta"><button class="btn btn-borde" data-descargar="${idDescarga}">Descargar como imagen</button></div>
    </div>`;
  }
  function pAudiencias() {
    const i = ins(); if (!i) return sinFicha();
    const a = S.f.audiencia, psi = i.psicograficos?.[a];
    const nombrePsi = S.cat.segmentos.psicograficos.find((s) => s.id === a)?.nombre;
    if (psi) {
      return `<div class="rejilla r2">
        <div class="tarjeta" id="ficha-psi"><h3 style="font-size:24px;font-weight:500">${bandera(S.f.pais)} ${esc(nombrePsi)}</h3>
          <h4>Cómo llegarle</h4><p style="color:var(--texto-2)">${esc(psi.como_llegarle)}</p>
          <h4>Mensaje que conecta</h4><p style="font-size:20px;font-weight:300">${esc(psi.mensaje)}</p>
          <h4>Qué evitar</h4><p style="color:var(--texto-2)">${esc(psi.evitar)}</p>
          <div class="pie-tarjeta"><button class="btn btn-borde" data-descargar="ficha-psi">Descargar como imagen</button></div></div>
        ${ficha(i.audiencias.general, "ficha-gen")}</div>`;
    }
    const f = i.audiencias?.[a] || i.audiencias?.general;
    const otras = Object.entries(i.psicograficos || {}).slice(0, 9);
    return `${ficha(f, "ficha-aud")}
      <h2 class="titulo-sec" style="font-size:28px;margin-top:40px">Perfiles <b>psicográficos</b></h2>
      <div class="rejilla r3">${otras.map(([id, x]) => `<div class="tarjeta"><h3>${esc(S.cat.segmentos.psicograficos.find((s) => s.id === id)?.nombre || id)}</h3><p style="color:var(--texto-2);font-size:14px">${esc(x.como_llegarle)}</p><p style="margin-top:10px;font-weight:500">${esc(x.mensaje)}</p></div>`).join("")}</div>
      <p class="aviso">${esc(i.metodo || "")}</p>`;
  }

  // ------------------------------------------------------------------ JERGA
  function pJerga() {
    const i = ins(); if (!i?.jerga) return sinFicha();
    const lista = i.jerga.filter((j) => coincide(`${j.expresion} ${j.significado} ${j.uso} ${Object.values(j.equivalentes || {}).join(" ")}`));
    const tag = { si: ["si", "Apta para anuncios"], "con cuidado": ["cuidado", "Úsala con cuidado"], no: ["no", "No usar en marca"] };
    return `<h2 class="titulo-sec" style="font-size:32px">${bandera(S.f.pais)} Así habla <b>${esc(pais(S.f.pais).nombre)}</b></h2>
      <p class="sub-sec">${lista.length} expresiones con significado, contexto, si sirven para un anuncio y cómo se dice lo mismo en otros países. Usa el buscador para encontrar una palabra.</p>
      ${lista.length ? `<div class="jerga">${lista.map((j) => `<div class="tarjeta palabra">
        <div class="exp">${esc(j.expresion)}</div><div class="sig">${esc(j.significado)}</div>
        <div class="etiquetas"><span class="etq">${esc(j.registro)}</span><span class="etq ${tag[j.apto_anuncio]?.[0] || ""}">${tag[j.apto_anuncio]?.[1] || ""}</span><span class="etq">${esc(j.uso)}</span></div>
        ${j.ejemplo && j.ejemplo !== "—" ? `<div class="ej">“${esc(j.ejemplo)}”</div>` : ""}
        <div class="equivalentes">${Object.entries(j.equivalentes || {}).map(([k, v]) => `<span>${bandera(k)} ${k}</span><b>${esc(v)}</b>`).join("")}</div></div>`).join("")}</div>` : vacio("Sin resultados", " Ninguna expresión coincide con tu búsqueda.")}`;
  }

  // ------------------------------------------------------------------ SECTORES
  function pSectores() {
    const data = S.sectores?.paises?.[S.f.pais];
    if (!data) return vacio("Recolectando sectores", " Los titulares por sector se actualizan cada 6 horas.");
    const sectores = S.f.sector ? S.cat.sectores.filter((s) => s.id === S.f.sector) : S.cat.sectores;
    const ops = Object.values(S.insights).flatMap((i) => i?.oportunidades || []).filter((o) => (!S.f.sector || o.sector === S.f.sector) && (o.desde === S.f.pais || o.hacia === S.f.pais));
    const cuerpo = S.f.sector
      ? `<div class="tarjeta"><h3>${esc(sectores[0].nombre)} en ${esc(pais(S.f.pais).nombre)} · últimas 24 h</h3>${listaTitulares(data[S.f.sector] || [])}</div>`
      : `<div class="rejilla r3">${sectores.map((s) => { const it = (data[s.id] || []).filter((h) => coincide(h.titulo)); return `<div class="tarjeta"><h3>${esc(s.nombre)}</h3>${it.length ? `<div class="titulares">${it.slice(0, 3).map((h) => `<a class="titular" href="${esc(h.url)}" target="_blank" rel="noopener"><span class="t" style="font-size:13.5px">${esc(h.titulo)}</span></a>`).join("")}</div>` : '<p class="aviso">Sin titulares recientes.</p>'}</div>`; }).join("")}</div>`;
    return `<h2 class="titulo-sec" style="font-size:32px">${bandera(S.f.pais)} Sectores <b>en movimiento</b></h2>
      <p class="sub-sec">Titulares de las últimas 24 horas por sector, actualizados cada 6 horas (${esc(hace(S.sectores.actualizado))}). Elige un sector en los filtros para ver el detalle.</p>
      ${cuerpo}
      ${ops.length ? `<h2 class="titulo-sec" style="font-size:26px;margin-top:36px">Oportunidades <b>relacionadas</b></h2><div class="rejilla r3">${ops.map(tarjetaOportunidad).join("")}</div>` : ""}`;
  }

  // ------------------------------------------------------------------ CREADORES
  function pCreadores() {
    const i = ins(); if (!i?.creadores) return sinFicha();
    const r = i.creadores.por_red?.[S.f.red] || {};
    const verdes = (i.semaforo || []).filter((s) => s.color === "verde");
    const tags = [...new Set([...(r.hashtags || []), ...(i.creadores.hashtags_base || [])])];
    const l = (titulo, arr) => (arr?.length ? `<h4>${titulo}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
    return `<h2 class="titulo-sec" style="font-size:32px">${bandera(S.f.pais)} Kit para <b>${esc(S.f.red)}</b></h2>
      <p class="sub-sec">Formatos, ganchos para los primeros 3 segundos, horarios y hashtags sugeridos para ${esc(pais(S.f.pais).nombre)}. Cambia la red en los filtros.</p>
      <div class="rejilla r2">
        <div class="tarjeta">${l("Formatos que funcionan", r.formatos)}${l("Ganchos para arrancar", r.ganchos)}<h4>Mejor horario</h4><p style="color:var(--texto-2)">${esc(r.horario || "—")}</p></div>
        <div class="tarjeta"><h4 style="margin-top:0">Hashtags sugeridos · toca para copiar</h4><div class="hashtags">${tags.map((h) => `<button class="hashtag" data-copiar="${esc(h)}">${esc(h)}</button>`).join("")}</div>
          <div class="pie-tarjeta"><button class="btn btn-borde" data-copiar="${esc(tags.join(" "))}">Copiar todos</button></div>
          <p class="aviso">Sugerencias basadas en el mercado y las tendencias; no son volúmenes medidos.</p></div>
      </div>
      ${verdes.length ? `<h2 class="titulo-sec" style="font-size:26px;margin-top:36px">Trends con <b>luz verde</b> para crear hoy</h2><div class="rejilla r3">${verdes.map((s) => `<div class="tarjeta"><div class="semaforo" style="margin:0 0 10px"><span class="luz verde"></span><div><b style="text-transform:capitalize">${esc(s.termino)}</b></div></div><p style="color:var(--texto-2);font-size:14px">${esc(s.por_que)}</p><h4>Idea</h4><p>${esc(s.idea)}</p></div>`).join("")}</div>` : ""}`;
  }

  // ------------------------------------------------------------------ CALENDARIO
  const nth = (a, m, dow, n) => { const d = new Date(a, m, 1); const off = (dow - d.getDay() + 7) % 7; return new Date(a, m, 1 + off + 7 * (n - 1)); };
  const ultimo = (a, m, dow) => { const d = new Date(a, m + 1, 0); return new Date(a, m, d.getDate() - ((d.getDay() - dow + 7) % 7)); };
  const pascua = (a) => { const f = Math.floor, G = a % 19, C = f(a / 100), H = (C - f(C / 4) - f((8 * C + 13) / 25) + 19 * G + 15) % 30, I = H - f(H / 28) * (1 - f(29 / (H + 1)) * f((21 - G) / 11)), J = (a + f(a / 4) + I + 2 - C + f(C / 4)) % 7, L = I - J, m = 3 + f((L + 40) / 44), d = L + 28 - 31 * f(m / 4); return new Date(a, m - 1, d); };
  const mas = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  function fechasComerciales(id, a) {
    const ev = [];
    const add = (fecha, nombre, nota) => ev.push({ fecha, nombre, nota });
    const madre2 = ["CO", "EC", "US", "CA", "PE", "CL", "IT", "DE", "NL"];
    const padre3 = ["CO", "MX", "EC", "US", "CA", "PE", "CL", "AR", "FR", "GB", "NL"];
    const bf = mas(nth(a, 10, 4, 4), 1);
    add(new Date(a, 1, 14), "San Valentín", id === "CO" ? "En Colombia pesa más Amor y Amistad (septiembre)" : "Regalos y experiencias en pareja");
    if (madre2.includes(id)) add(nth(a, 4, 0, 2), "Día de la Madre", "Una de las fechas de mayor venta del año");
    if (id === "MX") add(new Date(a, 4, 10), "Día de las Madres", "Siempre el 10 de mayo");
    if (["ES", "PT"].includes(id)) add(nth(a, 4, 0, 1), "Día de la Madre", "Primer domingo de mayo");
    if (id === "AR") add(nth(a, 9, 0, 3), "Día de la Madre", "Tercer domingo de octubre");
    if (id === "FR") add(ultimo(a, 4, 0), "Fête des Mères", "Último domingo de mayo (salvo coincidencia con Pentecostés)");
    if (id === "GB") add(mas(pascua(a), -21), "Mothering Sunday", "Tres semanas antes de Pascua");
    if (padre3.includes(id)) add(nth(a, 5, 0, 3), "Día del Padre", "Tercer domingo de junio");
    if (["ES", "PT", "IT"].includes(id)) add(new Date(a, 2, 19), "Día del Padre", "19 de marzo, San José");
    if (id === "DE") add(mas(pascua(a), 39), "Vatertag", "Día de la Ascensión");
    if (id === "CO") add(nth(a, 8, 6, 3), "Amor y Amistad", "Tercer sábado de septiembre");
    add(new Date(a, 9, 31), "Halloween", "Disfraces, decoración y dulces");
    if (id === "MX") add(new Date(a, 10, 2), "Día de Muertos", "1 y 2 de noviembre");
    add(new Date(a, 10, 11), "11.11 · Día del Soltero", "Fecha de descuentos de origen asiático, creciendo en e-commerce");
    if (id === "US") add(nth(a, 10, 4, 4), "Thanksgiving", "Cuarto jueves de noviembre");
    if (id === "CA") add(nth(a, 9, 1, 2), "Thanksgiving (Canadá)", "Segundo lunes de octubre");
    add(bf, "Black Friday", "Día del año con más compras en línea en muchos mercados");
    add(mas(bf, 3), id === "CO" ? "Cyber Monday / Cyber Lunes" : "Cyber Monday", "Descuentos en línea tras Black Friday");
    add(new Date(a, 11, 24), "Nochebuena y Navidad", "Pico de regalos; atención a fechas límite de envío");
    if (["GB", "CA"].includes(id)) add(new Date(a, 11, 26), "Boxing Day", "Gran día de rebajas");
    if (["ES", "MX", "AR"].includes(id)) add(new Date(a, 0, 6), "Día de Reyes", "Regalos para niños");
    if (["CO", "EC", "PE", "AR", "IT", "DE", "ES", "PT"].includes(id)) add(mas(pascua(a), -48), "Carnaval", "Fechas según la Pascua; varía por ciudad");
    return ev;
  }
  function pCalendario() {
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const a = hoy.getFullYear();
    let ev = [...fechasComerciales(S.f.pais, a), ...fechasComerciales(S.f.pais, a + 1)].map((e) => ({ ...e, tipo: "comercial" }));
    for (const f of S.festivos?.paises?.[S.f.pais] || []) { const [y, m, d] = f.fecha.split("-").map(Number); ev.push({ fecha: new Date(y, m - 1, d), nombre: f.nombre, nota: "Festivo oficial", tipo: "festivo" }); }
    ev = ev.filter((e) => e.fecha >= hoy && e.fecha <= mas(hoy, 200) && coincide(e.nombre + " " + e.nota)).sort((x, y) => x.fecha - y.fecha);
    ev = ev.filter((e, i) => !ev.some((o, j) => j < i && Math.abs(o.fecha - e.fecha) <= 2 * 864e5 && (norm(o.nombre).includes(norm(e.nombre).split(' ')[0]) || norm(e.nombre).includes(norm(o.nombre).split(' ')[0]))));
    const meses = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    return `<h2 class="titulo-sec" style="font-size:32px">${bandera(S.f.pais)} Calendario de <b>oportunidades</b></h2>
      <p class="sub-sec">Fechas comerciales (en amarillo) y festivos oficiales (en azul) de los próximos meses en ${esc(pais(S.f.pais).nombre)}, con cuenta regresiva para planear tu contenido.</p>
      ${ev.length ? `<div class="rejilla r2">${ev.slice(0, 24).map((e) => { const dias = Math.round((e.fecha - hoy) / 864e5); return `<div class="tarjeta evento ${e.tipo}"><div class="dia"><div><b>${e.fecha.getDate()}</b><small>${meses[e.fecha.getMonth()]} ${String(e.fecha.getFullYear()).slice(2)}</small></div></div><div class="info"><h3>${esc(e.nombre)}</h3><p>${esc(e.nota)}</p></div><div class="cuenta"><b>${dias === 0 ? "Hoy" : dias}</b><small>${dias === 0 ? "" : dias === 1 ? "día" : "días"}</small></div></div>`; }).join("")}</div>` : vacio("Sin fechas", " No hay fechas que coincidan.")}
      <p class="aviso">Fechas como Hot Sale, Buen Fin o Cyber Lunes cambian cada año según sus organizadores; la IA las agrega cuando se anuncian.</p>`;
  }

  // ------------------------------------------------------------------ OPORTUNIDADES
  function tarjetaOportunidad(o) {
    return `<div class="tarjeta"><div class="ruta"><span title="${esc(pais(o.desde)?.nombre)}">${bandera(o.desde)}</span><span class="flecha"></span><span title="${esc(pais(o.hacia)?.nombre)}">${bandera(o.hacia)}</span></div>
      <h3>${esc(o.titulo)}</h3><p style="color:var(--texto-2);font-size:14px">${esc(o.senal)}</p><h4>Cómo aprovecharla</h4><p style="font-size:14.5px">${esc(o.accion)}</p>
      <div class="etiquetas" style="margin-top:12px"><span class="etq">${esc(S.cat.sectores.find((s) => s.id === o.sector)?.nombre || o.sector)}</span></div></div>`;
  }
  function pOportunidades() {
    let ops = Object.values(S.insights).flatMap((i) => i?.oportunidades || []);
    if (S.f.sector) ops = ops.filter((o) => o.sector === S.f.sector);
    ops = ops.filter((o) => coincide(`${o.titulo} ${o.senal} ${o.accion}`));
    const propias = ops.filter((o) => o.desde === S.f.pais || o.hacia === S.f.pais), resto = ops.filter((o) => !propias.includes(o));
    return `<h2 class="titulo-sec" style="font-size:32px">Radar de oportunidades <b>cross-border</b></h2>
      <p class="sub-sec">Productos y temas que crecen en un mercado y podrían venderse desde otro. Son señales para investigar, no garantías.</p>
      ${propias.length ? `<h4 style="color:var(--lila);text-transform:uppercase;letter-spacing:1px;font-size:12px;margin-bottom:12px">Con ${esc(pais(S.f.pais).nombre)}</h4><div class="rejilla r3">${propias.map(tarjetaOportunidad).join("")}</div>` : ""}
      ${resto.length ? `<h4 style="color:var(--lila);text-transform:uppercase;letter-spacing:1px;font-size:12px;margin:30px 0 12px">Otros mercados</h4><div class="rejilla r3">${resto.map(tarjetaOportunidad).join("")}</div>` : ""}
      ${!ops.length ? vacio("Sin oportunidades para este filtro", " Prueba con otro sector.") : ""}
      <div class="lectura" style="margin-top:36px"><div class="ico">↗</div><div><small>¿Quieres llevar tu producto a otro país?</small><p>En Ágilex te asesoramos según tu producto y tu mercado. Escríbenos en <a href="https://agilex.com.co" target="_blank" rel="noopener">agilex.com.co</a> o a la línea comercial <a href="https://wa.me/573105714150" target="_blank" rel="noopener">+57 310 5714150</a>.</p></div></div>`;
  }

  // ------------------------------------------------------------------ ANUNCIOS
  function pAnuncios() {
    const a = ins()?.anuncios || [];
    return `<h2 class="titulo-sec" style="font-size:32px">${bandera(S.f.pais)} Qué se está <b>anunciando</b></h2>
      <p class="sub-sec">Lectura de anuncios activos en Facebook e Instagram según la Biblioteca de Anuncios de Meta (información pública).</p>
      ${a.length ? `<div class="rejilla r2">${a.filter((x) => coincide(`${x.busqueda} ${x.patron} ${x.anunciantes.map((y) => y.nombre).join(" ")}`)).map((x) => `<div class="tarjeta">
        <h4 style="margin-top:0">Búsqueda: “${esc(x.busqueda)}”</h4><p style="font-size:34px;font-weight:300;line-height:1">${Number(x.total).toLocaleString("es")}<span style="font-size:14px;color:var(--texto-2)"> anuncios activos</span></p>
        <h4>Patrón observado</h4><p style="color:var(--texto-2)">${esc(x.patron)}</p>
        <h4>Anunciantes destacados</h4><div class="hashtags">${x.anunciantes.map((y) => `<a class="hashtag" style="text-decoration:none" href="${esc(y.url)}" target="_blank" rel="noopener">${esc(y.nombre)} ↗</a>`).join("")}</div></div>`).join("")}</div>`
        : vacio("Lectura de anuncios en preparación", " La IA revisa la Biblioteca de Anuncios de Meta en cada actualización.")}`;
  }

  // ------------------------------------------------------------------ COMPARADOR
  function pComparador() {
    const [a, b] = S.comp;
    const op = (sel) => S.cat.paises.map((p) => `<option value="${p.id}" ${p.id === sel ? "selected" : ""}>${p.bandera} ${esc(p.nombre)}</option>`).join("");
    const ia = S.insights[a]?.audiencias?.general, ib = S.insights[b]?.audiencias?.general;
    const fila = (t, fa, fb) => `<tr><td>${t}</td><td>${fa}</td><td>${fb}</td></tr>`;
    const lista = (x) => (x?.length ? x.slice(0, 4).map(esc).join("<br>") : "—");
    const top = (id) => (S.pulso?.paises?.[id]?.trends || []).slice(0, 5).map((t) => esc(t.termino)).join("<br>") || "—";
    const dpaises = S.dicc?.paises || [];
    const conceptos = (S.dicc?.conceptos || []).filter((c) => coincide(Object.values(c).join(" ")));
    const tienen = (id) => dpaises.includes(id);
    return `<h2 class="titulo-sec" style="font-size:32px">Comparador <b>de mercados</b></h2>
      <div class="comp-cab"><div class="campo"><label>Mercado A</label><select id="comp-a">${op(a)}</select></div><span style="font-size:22px;color:var(--lila)">vs.</span><div class="campo"><label>Mercado B</label><select id="comp-b">${op(b)}</select></div></div>
      <div class="tabla-scroll"><table class="tabla"><thead><tr><th></th><th>${bandera(a)} ${esc(pais(a).nombre)}</th><th>${bandera(b)} ${esc(pais(b).nombre)}</th></tr></thead><tbody>
        ${fila("Perfil", esc(ia?.resumen || "Ficha en preparación"), esc(ib?.resumen || "Ficha en preparación"))}
        ${fila("Cómo habla", esc(ia?.como_habla || "—"), esc(ib?.como_habla || "—"))}
        ${fila("Le duele", lista(ia?.dolores), lista(ib?.dolores))}
        ${fila("Lo mueve", lista(ia?.motivaciones), lista(ib?.motivaciones))}
        ${fila("Tono", esc(ia?.tono || "—"), esc(ib?.tono || "—"))}
        ${fila("Canales", lista(ia?.canales), lista(ib?.canales))}
        ${fila("Sube ahora", top(a), top(b))}
      </tbody></table></div>
      <h2 class="titulo-sec" style="font-size:26px;margin-top:40px">Cómo se dice <b>en cada país</b></h2>
      <p class="sub-sec">${esc(S.dicc?.nota || "")}</p>
      <div class="tabla-scroll"><table class="tabla"><thead><tr><th>Concepto</th>${dpaises.map((p) => `<th style="${p === a || p === b ? "color:var(--amarillo)" : ""}">${bandera(p)} ${p}</th>`).join("")}</tr></thead>
        <tbody>${conceptos.map((c) => `<tr><td>${esc(c.concepto)}</td>${dpaises.map((p) => `<td style="${p === a || p === b ? "color:#fff" : ""}">${esc(c[p] || "—")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
      ${!tienen(a) || !tienen(b) ? '<p class="aviso">El diccionario cruzado cubre por ahora los mercados hispanohablantes y EE. UU.</p>' : ""}`;
  }
  function enlazarComparador() {
    $("#comp-a")?.addEventListener("change", (e) => { S.comp[0] = e.target.value; pintar(); });
    $("#comp-b")?.addEventListener("change", (e) => { S.comp[1] = e.target.value; pintar(); });
  }

  // ------------------------------------------------------------------ descarga como imagen
  async function descargarImagen(id) {
    const el = document.getElementById(id); if (!el || !window.html2canvas) return;
    const btns = $$(".pie-tarjeta", el); btns.forEach((b) => (b.style.display = "none"));
    const marca = document.createElement("div");
    marca.style.cssText = "margin-top:18px;font-size:12px;color:#a9a6ff;display:flex;justify-content:space-between";
    marca.innerHTML = "<span>Pulso Global · Grown IA × Ágilex</span><span>agilex.com.co · +57 310 5714150</span>";
    el.appendChild(marca);
    try {
      const c = await html2canvas(el, { backgroundColor: "#14113d", scale: 2, useCORS: true });
      const a = document.createElement("a"); a.download = `pulso-${S.f.pais}-${id}.png`; a.href = c.toDataURL("image/png"); a.click();
    } finally { marca.remove(); btns.forEach((b) => (b.style.display = "")); }
  }

  iniciar();
})();
