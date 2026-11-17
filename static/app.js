// Interfaz del Diario de Trading. JavaScript simple, sin frameworks.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dinero = (v) => (v === null || v === undefined) ? "—" : Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conSigno = (v) => (v > 0 ? "+" : "") + dinero(v);
const pct = (v) => (v === null || v === undefined) ? "—" : (v * 100).toFixed(1) + "%";
const icono = (id) => `<svg class="ic"><use href="#i-${id}"/></svg>`;
const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };

let tipoActual = "simulada";
const filtro = () => ({ tipo: tipoActual, moneda: $("#f-moneda").value });
let graficas = {};
let ultimoResumen = null;

async function api(url, opciones = {}) {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...opciones });
  const datos = await r.json().catch(() => ({}));
  if (!r.ok) {
    const det = Array.isArray(datos.detail) ? datos.detail.map((d) => d.msg.replace("Value error, ", "")).join("; ") : (datos.detail || r.statusText);
    throw new Error(det);
  }
  return datos;
}
function mensaje(el, texto, tipo = "") { el.textContent = texto; el.className = "msg " + tipo; }

// ---------- Avisos flotantes
function toast(texto, tipo = "") {
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.innerHTML = `<span class="punto"></span><div>${esc(texto)}</div>`;
  $("#toasts").appendChild(t);
  setTimeout(() => { t.classList.add("sale"); setTimeout(() => t.remove(), 320); }, 3600);
}

// ---------- Números que cuentan hacia arriba
function contar(el, final, formato) {
  if (sinMovimiento || typeof final !== "number" || !isFinite(final)) { el.textContent = formato(final); return; }
  const inicio = performance.now(), dur = 700;
  const paso = (t) => {
    const p = Math.min(1, (t - inicio) / dur), e = 1 - Math.pow(1 - p, 3);
    el.textContent = formato(final * e);
    if (p < 1) requestAnimationFrame(paso); else el.textContent = formato(final);
  };
  requestAnimationFrame(paso);
}

// ---------- Controles segmentados (pastilla que se desliza)
function moverPastilla(seg) {
  const activo = seg.querySelector('button[aria-pressed="true"]'), p = seg.querySelector(".pastilla");
  if (!activo || !p) return;
  p.style.width = activo.offsetWidth + "px";
  p.style.transform = `translateX(${activo.offsetLeft - 3}px)`;
}
function elegir(seg, valor) {
  seg.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === valor)));
  moverPastilla(seg);
}

// ---------- Tema claro / oscuro / sistema
const consultaOscuro = matchMedia("(prefers-color-scheme: dark)");
function aplicarTema(valor) {
  if (valor === "light" || valor === "dark") document.documentElement.dataset.theme = valor;
  else delete document.documentElement.dataset.theme;
  guardar("tema", valor);
  elegir($("#seg-tema"), valor);
  setTimeout(redibujarGraficas, 60); // las gráficas leen los colores del tema
}
$("#seg-tema").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) aplicarTema(b.dataset.v); });
consultaOscuro.addEventListener("change", () => { if (!document.documentElement.dataset.theme) redibujarGraficas(); });

// ---------- Filtros
$("#seg-tipo").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.dataset.v === tipoActual) return;
  tipoActual = b.dataset.v; elegir($("#seg-tipo"), tipoActual); alCambiarFiltro();
});
$("#f-moneda").addEventListener("change", alCambiarFiltro);
function alCambiarFiltro() {
  guardar("filtro", JSON.stringify(filtro()));
  refrescar(pestanaActual());
}

// ---------- Pestañas
const HERO = {
  registrar: { et: "Registrar", ic: "pluma", t: "Registra en menos de 30 segundos", p: "Anota tu emoción al entrar: después del resultado se recuerda distinto." },
  diario: { et: "Diario", ic: "libro", t: "Tu historial de operaciones", p: "Edita, borra o agrega reflexiones a cada operación después de cerrarla." },
  panel: { et: "Panel", ic: "barras", t: "Tus números, calculados con código", p: "Ninguna cifra viene de la IA: todo se calcula con fórmulas fijas a partir de tus datos." },
  conducta: { et: "Mi conducta", ic: "cerebro", t: "Lo que tus operaciones dicen de ti", p: "Disciplina, emociones y riesgo: los hábitos que más pesan en el resultado." },
  noticias: { et: "Noticias", ic: "periodico", t: "Noticias sin jerga", p: "Pega un titular y recibe un resumen simple con los términos explicados. Sin predicciones." },
  ajustes: { et: "Ajustes", ic: "ajustes", t: "Tu plan, tus reglas", p: "Define tu riesgo máximo: la app te avisará cuando lo rompas." },
};
const pestanaActual = () => $("#pestanas .activa").dataset.p;
$$("#pestanas button").forEach((b) => b.addEventListener("click", () => abrir(b.dataset.p)));
function moverIndicador() {
  const a = $("#pestanas .activa"), i = $("#pestanas .indicador");
  i.style.width = a.offsetWidth + "px"; i.style.transform = `translateX(${a.offsetLeft}px)`;
  a.scrollIntoView({ block: "nearest", inline: "nearest", behavior: sinMovimiento ? "auto" : "smooth" });
}
function abrir(p) {
  $$("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.p === p));
  $$(".pestana").forEach((s) => s.classList.toggle("activa", s.id === "p-" + p));
  moverIndicador();
  pintarHero(p);
  $("#banner-tip").classList.toggle("oculto-aqui", p === "conducta");
  guardar("pestana", p);
  refrescar(p);
}
function pintarHero(p) {
  const h = HERO[p], hero = $("#hero");
  $("#hero-etiqueta").innerHTML = icono(h.ic) + esc(h.et);
  $("#hero-titulo").textContent = h.t;
  $("#hero-texto").textContent = h.p;
  hero.classList.remove("cambia"); void hero.offsetWidth; hero.classList.add("cambia");
}
function refrescar(p) {
  if (p === "diario") cargarDiario();
  if (p === "panel") cargarPanel();
  if (p === "conducta") cargarPatrones();
  if (p === "noticias") cargarGlosario();
  if (p === "ajustes") cargarAjustes();
  cargarResumen();
}
addEventListener("resize", () => { moverIndicador(); moverPastilla($("#seg-tipo")); moverPastilla($("#seg-tema")); });

// ---------- Resumen del banner + sugerencia de pausa
async function cargarResumen() {
  const { tipo, moneda } = filtro();
  try {
    const { estadisticas: e, pausa } = await api(`/api/estadisticas?tipo=${tipo}&moneda=${moneda}`);
    ultimoResumen = e;
    const chips = [
      ["Operaciones", e.cerradas, (v) => Math.round(v).toString()],
      ["Resultado " + moneda, e.resultado_total, conSigno],
      ["Acierto", e.tasa_acierto, pct],
    ];
    $("#hero-chips").innerHTML = chips.map(([t]) => `<div class="chip-hero"><div class="t">${esc(t)}</div><div class="v">—</div></div>`).join("");
    $$("#hero-chips .v").forEach((el, i) => contar(el, chips[i][1], chips[i][2]));
    const caja = $("#pausa");
    if (pausa && caja.hidden) { caja.classList.remove("entra"); void caja.offsetWidth; caja.classList.add("entra"); }
    caja.hidden = !pausa; $("#pausa-texto").textContent = pausa || "";
  } catch (err) {}
}

// ---------- Consejos que rotan
const CONSEJOS = [
  ["Define tu stop antes de entrar", "Si no sabes dónde sales cuando te equivocas, no sabes cuánto arriesgas."],
  ["Una pérdida no se recupera con prisa", "Operar justo después de perder suele llevar a decisiones por revancha."],
  ["Mide en R, no solo en pesos", "Ganar 2R significa ganar el doble de lo que arriesgaste. Así comparas operaciones de distinto tamaño."],
  ["Practica primero en simulado", "Las operaciones simuladas y las reales se muestran por separado para que compares sin mezclar."],
  ["Tu emoción también es un dato", "Anotar si entraste con calma, miedo o euforia te ayuda a ver patrones que los números no muestran."],
  ["El tamaño importa más que el acierto", "Puedes acertar 6 de 10 y aun así perder si tus pérdidas son más grandes que tus ganancias."],
];
let iConsejo = Math.floor(Math.random() * CONSEJOS.length);
function mostrarConsejo() {
  const caja = $("#tip");
  caja.classList.add("sale");
  setTimeout(() => {
    const [t, p] = CONSEJOS[iConsejo % CONSEJOS.length]; iConsejo++;
    caja.querySelector("b").textContent = "Consejo · " + t; caja.querySelector("p").textContent = p;
    caja.classList.remove("sale");
  }, sinMovimiento ? 0 : 300);
}
$("#cerrar-tip").addEventListener("click", () => { $("#banner-tip").hidden = true; guardar("sin-consejos", "1"); });

// ---------- Registrar / editar (RF1, RF2)
const form = $("#form-op");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  const id = d.id; delete d.id;
  for (const k of ["cantidad", "comision", "entrada_precio", "salida_precio", "stop_inicial", "stop_final", "objetivo"]) d[k] = d[k] === "" ? null : Number(d[k]);
  for (const k of ["salida_fecha", "emocion", "motivo_entrada"]) if (d[k] === "") d[k] = null;
  if (d.comision === null) d.comision = 0;
  const btn = $("#btn-guardar"); btn.classList.add("cargando");
  try {
    if (id) await api(`/api/operaciones/${id}`, { method: "PUT", body: JSON.stringify(d) });
    else await api("/api/operaciones", { method: "POST", body: JSON.stringify(d) });
    mensaje($("#msg-form"), "");
    toast(id ? "Operación actualizada." : `Operación de ${d.ticker.toUpperCase()} guardada.`, "ok");
    limpiarForm(d); cargarResumen();
  } catch (err) { mensaje($("#msg-form"), err.message, "error"); toast("Revisa los datos: " + err.message, "error"); }
  finally { btn.classList.remove("cargando"); }
});
function limpiarForm(previo) {
  form.reset(); form.id.value = "";
  if (previo) { form.tipo.value = previo.tipo; form.moneda.value = previo.moneda; }
  $("#txt-guardar").textContent = "Guardar operación"; $("#cancelar-edicion").hidden = true; vistaPrevia();
}
$("#cancelar-edicion").addEventListener("click", () => limpiarForm());
function editar(op) {
  abrir("registrar");
  for (const [k, v] of Object.entries(op)) if (form[k] && !k.startsWith("_")) form[k].value = v === null ? "" : (k.endsWith("_fecha") ? v.replace(" ", "T") : v);
  form.id.value = op.id;
  $("#txt-guardar").textContent = `Guardar cambios a #${op.id}`; $("#cancelar-edicion").hidden = false; vistaPrevia();
  scrollTo({ top: 0, behavior: sinMovimiento ? "auto" : "smooth" });
}
// Vista previa de riesgo mientras escribes (el servidor vuelve a calcular todo al guardar)
function vistaPrevia() {
  const n = (k) => form[k].value === "" ? null : Number(form[k].value);
  const ent = n("entrada_precio"), cant = n("cantidad"), stop = n("stop_inicial"), obj = n("objetivo");
  const piezas = [];
  if (ent && cant && stop !== null) {
    const riesgo = Math.abs(ent - stop) * cant;
    piezas.push(`Riesgo <b>${dinero(riesgo)} ${esc(form.moneda.value)}</b>`);
    if (obj !== null && ent !== stop) piezas.push(`Objetivo a <b>${(Math.abs(obj - ent) / Math.abs(ent - stop)).toFixed(1)}R</b>`);
  } else if (ent && cant) piezas.push(`<b>Sin stop</b>: no se puede medir tu riesgo`);
  $("#vista-previa").innerHTML = piezas.map((p) => `<span class="pill-dato">${icono("objetivo")}${p}</span>`).join("");
}
form.addEventListener("input", vistaPrevia);

// ---------- Diario
let ultimasOps = [];
async function cargarDiario(resaltar = []) {
  const { tipo, moneda } = filtro();
  ultimasOps = await api(`/api/operaciones?tipo=${tipo}&moneda=${moneda}`);
  const abiertas = ultimasOps.filter((o) => o._resultado === null).length;
  $("#resumen-diario").textContent = `${ultimasOps.length} operaciones ${tipo === "real" ? "reales" : "simuladas"} en ${moneda}` + (abiertas ? ` · ${abiertas} abiertas` : "");
  pintarTabla(resaltar);
}
function pintarTabla(resaltar = []) {
  const q = $("#buscar-op").value.trim().toLowerCase();
  const ops = q ? ultimasOps.filter((o) => (o.ticker + " " + (o.emocion || "")).toLowerCase().includes(q)) : ultimasOps;
  const filas = ops.map((op) => {
    const res = op._resultado;
    const clase = res > 0 ? "gana" : res < 0 ? "pierde" : "";
    const r = op._r === null ? (op.stop_inicial === null ? `<span class="etiqueta venta">sin stop</span>` : "—") : op._r.toFixed(2);
    return `<tr id="op-${op.id}" class="${resaltar.includes(op.id) ? "resaltada" : ""}">
      <td>${op.id}</td><td>${esc(op.entrada_fecha)}</td><td><b>${esc(op.ticker)}</b></td>
      <td><span class="etiqueta ${op.direccion}">${op.direccion === "compra" ? "▲ Compra" : "▼ Corto"}</span></td>
      <td class="num">${op.cantidad}</td><td class="num ${clase}">${res === null ? `<span class="etiqueta marca">abierta</span>` : conSigno(res)}</td>
      <td class="num">${r}</td>
      <td>${op.emocion ? `<span class="etiqueta neutral">${esc(op.emocion)}</span>` : ""}</td>
      <td><div class="acciones-fila">
        <button class="btn-icono" title="Editar" data-a="editar" data-id="${op.id}">${icono("editar")}</button>
        <button class="btn-icono" title="Notas" data-a="notas" data-id="${op.id}">${icono("nota")}</button>
        <button class="btn-icono peligro" title="Borrar" data-a="borrar" data-id="${op.id}">${icono("basura")}</button></div></td></tr>`;
  });
  $("#tabla-ops tbody").innerHTML = filas.join("") || `<tr><td colspan="9"><div class="vacio"><span class="emoji">📒</span><b>Aún no hay operaciones aquí</b>Registra tu primera operación o carga las de prueba en Ajustes y datos.</div></td></tr>`;
  if (resaltar.length) document.getElementById("op-" + resaltar[0])?.scrollIntoView({ block: "center", behavior: sinMovimiento ? "auto" : "smooth" });
}
$("#buscar-op").addEventListener("input", () => pintarTabla());
$("#tabla-ops").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const op = ultimasOps.find((o) => o.id == b.dataset.id);
  if (b.dataset.a === "editar") editar(op);
  if (b.dataset.a === "borrar" && confirm(`¿Borrar la operación #${op.id} (${op.ticker})?`)) {
    await api(`/api/operaciones/${op.id}`, { method: "DELETE" }); toast(`Operación #${op.id} borrada.`); cargarDiario(); cargarResumen();
  }
  if (b.dataset.a === "notas") abrirNotas(op);
});
let notaOp = null;
async function abrirNotas(op) {
  notaOp = op;
  $("#notas-titulo").textContent = `Notas · #${op.id} ${op.ticker}`;
  const notas = await api(`/api/operaciones/${op.id}/notas`);
  $("#lista-notas").innerHTML = notas.map((n) => `<li><small>${esc(n.fecha)}</small><br>${esc(n.texto)}</li>`).join("") || "<li>Sin notas todavía.</li>";
  if (!$("#dlg-notas").open) $("#dlg-notas").showModal();
}
$("#guardar-nota").addEventListener("click", async () => {
  const texto = $("#nota-texto").value.trim(); if (!texto) return;
  await api(`/api/operaciones/${notaOp.id}/notas`, { method: "POST", body: JSON.stringify({ texto }) });
  $("#nota-texto").value = ""; toast("Nota guardada.", "ok"); abrirNotas(notaOp);
});
$("#cerrar-notas").addEventListener("click", () => $("#dlg-notas").close());

// ---------- Panel (RF3)
async function cargarPanel() {
  const { tipo, moneda } = filtro();
  const { estadisticas: e } = await api(`/api/estadisticas?tipo=${tipo}&moneda=${moneda}`);
  ultimoResumen = e;
  const num = (v, f) => (v === null || v === undefined) ? null : f(v);
  const kpis = [
    ["Tasa de acierto", "objetivo", e.tasa_acierto, pct, `${e.ganadoras} ganadoras · ${e.perdedoras} perdedoras` + (e.neutras ? ` · ${e.neutras} neutras` : ""), ""],
    ["Resultado total", e.resultado_total >= 0 ? "sube" : "baja", e.resultado_total, conSigno, `${e.cerradas} cerradas` + (e.abiertas ? ` · ${e.abiertas} abiertas` : ""), e.resultado_total > 0 ? "gana" : e.resultado_total < 0 ? "pierde" : ""],
    ["Ganancia promedio", "sube", e.ganancia_promedio, dinero, "por operación ganadora", "gana"],
    ["Pérdida promedio", "baja", e.perdida_promedio, dinero, "por operación perdedora", "pierde"],
    ["Factor de beneficio", "balanza", typeof e.factor_beneficio === "number" ? e.factor_beneficio : e.factor_beneficio, (v) => typeof v === "number" ? v.toFixed(2) : (v ?? "—"), "ganancias ÷ pérdidas", ""],
    ["Caída máxima", "caida", e.caida_maxima, dinero, "mayor baja desde un pico", ""],
    ["R promedio", "objetivo", e.r_promedio, (v) => v === null ? "—" : v.toFixed(2) + "R", "resultado ÷ riesgo inicial", ""],
    ["Sin stop", "escudo", e.sin_stop, (v) => Math.round(v).toString(), "operaciones sin stop inicial", e.sin_stop ? "pierde" : ""],
  ];
  $("#kpis").innerHTML = kpis.map(([t, ic, , , s, cl], i) => `
    <div class="kpi escalon ${cl}" style="--i:${i}"><div class="cab"><span class="ic-caja">${icono(ic)}</span>${t}</div>
    <div class="v">—</div><div class="s">${esc(s)}</div></div>`).join("");
  $$("#kpis .v").forEach((el, i) => contar(el, kpis[i][2], (v) => num(v, kpis[i][3]) ?? "—"));
  dibujarGraficas(e);
}

// ---------- Gráficas (colores tomados del tema activo)
const token = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function redibujarGraficas() { if (pestanaActual() === "panel" && ultimoResumen) dibujarGraficas(ultimoResumen); }
function dibujarGraficas(e) {
  const cont = $(".graficas");
  if (!window.Chart) { cont.innerHTML = `<div class="banner alerta" style="grid-column:1/-1"><div class="ic-caja">${icono("info")}</div><div><b>Gráficas no disponibles</b><p>No se pudo cargar Chart.js (¿sin internet?). Las cifras de arriba siguen siendo correctas.</p></div></div>`; return; }
  const moneda = filtro().moneda;
  const texto = token("--suave"), borde = token("--borde"), marca = token("--marca"), sup = token("--superficie");
  const gana = token("--gana-marca"), pierde = token("--pierde-marca");
  Chart.defaults.color = texto;
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  const tooltip = {
    backgroundColor: sup, titleColor: token("--texto"), bodyColor: token("--texto"), borderColor: borde, borderWidth: 1,
    padding: 10, cornerRadius: 10, displayColors: false,
    callbacks: { label: (c) => `${conSigno(c.parsed.y)} ${moneda}` },
  };
  const escalas = {
    x: { grid: { display: false }, border: { color: borde }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
    y: { grid: { color: borde }, border: { display: false }, ticks: { callback: (v) => Number(v).toLocaleString("es-MX") } },
  };
  const base = { responsive: true, maintainAspectRatio: true, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip }, scales: escalas, animation: sinMovimiento ? false : { duration: 900, easing: "easeOutQuart" } };

  dibujar("g-curva", "line", {
    labels: e.curva.map((p) => p.fecha.slice(0, 10)),
    datasets: [{ data: e.curva.map((p) => p.capital), borderColor: marca, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
      pointHoverBackgroundColor: marca, pointHoverBorderColor: sup, pointHoverBorderWidth: 2, tension: 0.25, fill: true,
      backgroundColor: (ctx) => {
        const { chart } = ctx; if (!chart.chartArea) return "transparent";
        const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
        g.addColorStop(0, marca + "55"); g.addColorStop(1, marca + "00"); return g;
      } }],
  }, { ...base, aspectRatio: 2.6 });

  const barras = (obj) => ({ labels: Object.keys(obj), datasets: [{
    data: Object.values(obj), backgroundColor: Object.values(obj).map((v) => v >= 0 ? gana : pierde),
    hoverBackgroundColor: Object.values(obj).map((v) => (v >= 0 ? gana : pierde) + "cc"),
    borderRadius: 4, borderSkipped: false, maxBarThickness: 34, categoryPercentage: 0.7 }] });
  const opBarras = { ...base, interaction: { mode: "nearest", intersect: false }, aspectRatio: 1.6 };
  dibujar("g-activo", "bar", barras(e.por_activo), opBarras);
  dibujar("g-dia", "bar", barras(e.por_dia), opBarras);
}
function dibujar(id, tipo, data, options) {
  graficas[id]?.destroy();
  graficas[id] = new Chart(document.getElementById(id), { type: tipo, data, options });
}

// ---------- Conducta (RF4)
const EMOJI = { revancha: "😤", stop_en_contra: "🎯", tamano_tras_perder: "📈", cortar_ganancias: "✂️", romper_riesgo: "⚠️", sin_stop: "🛑" };
function citas(ids) {
  return `<div class="citas">Basado en: ${ids.map((i) => `<a href="#" data-op="${i}">#${i}</a>`).join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-op]"); if (!a) return;
  e.preventDefault(); abrir("diario"); cargarDiario([Number(a.dataset.op)]);
});
async function cargarPatrones() {
  const { tipo, moneda } = filtro();
  const d = await api(`/api/patrones?tipo=${tipo}&moneda=${moneda}`);
  $("#hallazgos").innerHTML = ""; mensaje($("#msg-ia"), "");
  if (!d.suficientes) {
    $("#patrones").innerHTML = `<div class="patron vacio" style="grid-column:1/-1"><span class="emoji">🌱</span><b>Aún faltan datos</b>
      Se necesitan al menos ${d.minimo} operaciones cerradas para buscar patrones. Llevas ${d.cerradas}.
      <div class="barra" style="max-width:320px;margin:12px auto 0"><i style="width:0" data-w="${Math.min(100, d.cerradas / d.minimo * 100)}%"></i></div></div>`;
    $("#btn-ia").disabled = true; animarBarras(); return;
  }
  $("#btn-ia").disabled = d.patrones.length === 0;
  $("#patrones").innerHTML = d.patrones.length ? d.patrones.map((p, i) => `
    <div class="patron escalon" style="--i:${i}">
      <div class="cab"><span class="ic-caja">${EMOJI[p.clave] || "•"}</span><div><h3>${esc(p.nombre)}</h3>
      <div class="meta">${p.veces} de ${p.oportunidades} veces posibles</div></div>
      <span class="etiqueta marca" style="margin-left:auto">${pct(p.proporcion)}</span></div>
      <div class="barra"><i data-w="${Math.min(100, p.proporcion * 100)}%"></i></div>
      <div class="meta">Ejemplo: ${esc(p.casos[0].detalle)}</div>
      ${citas(p.ids.slice(0, 12))}${p.ids.length > 12 ? `<small style="color:var(--tenue)">…y ${p.ids.length - 12} más</small>` : ""}</div>`).join("")
    : `<div class="patron vacio" style="grid-column:1/-1"><span class="emoji">🏆</span><b>Sin patrones detectados</b>Con los umbrales actuales vas siguiendo tu plan. ¡Sigue así!</div>`;
  animarBarras();
}
function animarBarras() { requestAnimationFrame(() => requestAnimationFrame(() => $$(".barra > i[data-w]").forEach((b) => b.style.width = b.dataset.w))); }
$("#btn-ia").addEventListener("click", async () => {
  const btn = $("#btn-ia"); btn.classList.add("cargando"); mensaje($("#msg-ia"), "Analizando tus patrones…");
  try {
    const r = await api("/api/patrones/explicar", { method: "POST", body: JSON.stringify(filtro()) });
    if (!r.disponible) { mensaje($("#msg-ia"), r.mensaje, "error"); return; }
    mensaje($("#msg-ia"), r.de_cache ? "Respuesta guardada: no se volvió a llamar a la IA." : (r.mensaje || ""), "ok");
    $("#hallazgos").innerHTML = r.hallazgos.map((h, i) => `
      <div class="patron hallazgo escalon" style="--i:${i}"><span class="chispa">${icono("chispa")} Explicación con IA</span>
      <h3 style="margin-top:6px">${EMOJI[h.patron] || ""} ${esc(h.nombre)}</h3><p>${esc(h.explicacion)}</p>
      <p class="pregunta">${esc(h.pregunta_reflexion)}</p>${citas(h.operaciones_citadas)}</div>`).join("");
    $("#hallazgos").scrollIntoView({ behavior: sinMovimiento ? "auto" : "smooth", block: "start" });
  } catch (e) { mensaje($("#msg-ia"), e.message, "error"); }
  finally { btn.classList.remove("cargando"); }
});

// ---------- Noticias (RF5) y glosario
$("#noticia-texto").addEventListener("input", (e) => { $("#contador").textContent = `${e.target.value.length.toLocaleString("es-MX")} / 5,000`; });
$("#btn-noticia").addEventListener("click", async () => {
  const texto = $("#noticia-texto").value, btn = $("#btn-noticia");
  btn.classList.add("cargando"); mensaje($("#msg-noticia"), ""); $("#noticia-resultado").innerHTML = "";
  try {
    const r = await api("/api/noticias", { method: "POST", body: JSON.stringify({ texto }) });
    if (r.redirigido) {
      $("#noticia-resultado").innerHTML = `<div class="banner alerta entra"><div class="ic-caja">${icono("escudo")}</div><div><b>Aquí no damos recomendaciones</b><p>${esc(r.mensaje)}</p></div></div>`; return;
    }
    if (!r.disponible) { mensaje($("#msg-noticia"), r.mensaje, "error"); return; }
    mensaje($("#msg-noticia"), r.de_cache ? "Ya habías explicado este texto: respuesta guardada." : "", "ok");
    $("#noticia-resultado").innerHTML = `<div class="tarjeta hallazgo resultado-noticia escalon">
      <span class="chispa">${icono("chispa")} Explicación con IA</span>
      <h3 style="margin-top:8px">Resumen</h3><ul>${r.resumen.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <h3>Términos</h3><dl>${r.terminos.map((t) => `<dt>${esc(t.termino)}</dt><dd>${esc(t.explicacion)}</dd>`).join("")}</dl>
      <h3 style="margin-top:12px">Qué suelen observar los analistas</h3><p style="margin:0">${esc(r.que_observan_analistas)}</p></div>`;
    cargarGlosario();
  } catch (e) { mensaje($("#msg-noticia"), e.message, "error"); }
  finally { btn.classList.remove("cargando"); }
});
let glosario = { ...GLOSARIO_BASE };
async function cargarGlosario() {
  try {
    for (const n of await api("/api/noticias")) for (const t of JSON.parse(n.explicacion).terminos) glosario[t.termino] ??= t.explicacion;
  } catch (e) {}
  pintarGlosario();
}
function pintarGlosario() {
  const q = $("#buscar-glosario").value.toLowerCase();
  const claves = Object.keys(glosario).sort((a, b) => a.localeCompare(b, "es"))
    .filter((k) => !q || k.toLowerCase().includes(q) || glosario[k].toLowerCase().includes(q));
  $("#glosario").innerHTML = claves.map((k) => `<dt>${esc(k)}</dt><dd>${esc(glosario[k])}</dd>`).join("") || `<p class="nota">Sin resultados para “${esc(q)}”.</p>`;
}
$("#buscar-glosario").addEventListener("input", pintarGlosario);

// ---------- Ajustes y datos (RF6)
async function cargarAjustes() {
  const a = await api("/api/ajustes"); const f = $("#form-ajustes");
  f.moneda.value = a.moneda; f.riesgo_max_mxn.value = a.riesgo_max_mxn ?? ""; f.riesgo_max_usd.value = a.riesgo_max_usd ?? "";
  f.reglas_plan.value = a.reglas_plan; f.enviar_motivos_a_ia.checked = a.enviar_motivos_a_ia;
  const s = await api("/api/estado");
  $("#estado-ia").textContent = s.ia_configurada
    ? `Activa con ${s.modelo} · ${s.llamadas_hoy} de ${s.limite_diario} llamadas usadas hoy.`
    : "Sin configurar: agrega ANTHROPIC_API_KEY en el archivo .env. El diario y el panel funcionan igual.";
  $("#banner-ia").className = "banner " + (s.ia_configurada ? "info" : "alerta");
}
$("#form-ajustes").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target;
  const num = (v) => v === "" ? null : Number(v);
  try {
    await api("/api/ajustes", { method: "PUT", body: JSON.stringify({ moneda: f.moneda.value, riesgo_max_mxn: num(f.riesgo_max_mxn.value),
      riesgo_max_usd: num(f.riesgo_max_usd.value), reglas_plan: f.reglas_plan.value, enviar_motivos_a_ia: f.enviar_motivos_a_ia.checked }) });
    mensaje($("#msg-ajustes"), ""); toast("Plan guardado.", "ok");
  } catch (err) { mensaje($("#msg-ajustes"), err.message, "error"); }
});
$("#csv-archivo").addEventListener("change", async (e) => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const r = await api("/api/csv/importar", { method: "POST", body: JSON.stringify({ contenido: await archivo.text() }) });
  mensaje($("#msg-datos"), r.errores.length ? `Errores:\n${r.errores.join("\n")}` : "", r.errores.length ? "error" : "ok");
  toast(`Importadas: ${r.importadas} · Duplicadas saltadas: ${r.duplicadas}` + (r.errores.length ? ` · ${r.errores.length} con error` : ""), r.errores.length ? "error" : "ok");
  e.target.value = ""; cargarResumen();
});
$("#btn-demo").addEventListener("click", async () => {
  if (!confirm("Se agregarán 200 operaciones SIMULADAS en MXN con sesgos plantados. ¿Continuar?")) return;
  const btn = $("#btn-demo"); btn.classList.add("cargando");
  try {
    const r = await api("/api/demo", { method: "POST" });
    tipoActual = "simulada"; elegir($("#seg-tipo"), "simulada"); $("#f-moneda").value = "MXN";
    toast(`Cargadas ${r.cargadas} operaciones simuladas. Revisa el Panel y Mi conducta.`, "ok"); cargarAjustes(); cargarResumen();
  } finally { btn.classList.remove("cargando"); }
});
$("#btn-borrar").addEventListener("click", async () => {
  if (!confirm("Esto borra TODAS tus operaciones, notas e historial de IA. Exporta un CSV antes si quieres conservarlas. ¿Borrar todo?")) return;
  await api("/api/todo", { method: "DELETE" }); toast("Datos borrados."); cargarResumen();
});

// ---------- Inicio
(async function () {
  const tema = leer("tema"); elegir($("#seg-tema"), tema === "light" || tema === "dark" ? tema : "system");
  try { const f = JSON.parse(leer("filtro") || "null"); if (f) { tipoActual = f.tipo; $("#f-moneda").value = f.moneda; } } catch (e) {}
  elegir($("#seg-tipo"), tipoActual);
  if (leer("sin-consejos")) $("#banner-tip").hidden = true;
  mostrarConsejo(); setInterval(mostrarConsejo, 9000);
  const s = await api("/api/estado");
  $("#sel-emocion").innerHTML += s.emociones.map((e) => `<option>${esc(e)}</option>`).join("");
  abrir(leer("pestana") || "registrar");
  vistaPrevia();
  document.fonts?.ready.then(() => { moverIndicador(); moverPastilla($("#seg-tipo")); moverPastilla($("#seg-tema")); });
})();
