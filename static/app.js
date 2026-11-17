// Interfaz del Diario de Trading. JavaScript simple, sin frameworks.
// Ninguna cifra se calcula aquí: todos los números vienen del servidor (salvo la vista previa del formulario).
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dinero = (v) => (v === null || v === undefined) ? "—" : Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const conSigno = (v) => (v === null || v === undefined) ? "—" : (v > 0 ? "+" : "") + dinero(v);
const pct = (v) => (v === null || v === undefined) ? "—" : (v * 100).toFixed(1) + "%";
const icono = (id) => `<svg class="ic"><use href="#i-${id}"/></svg>`;
const sinMovimiento = matchMedia("(prefers-reduced-motion: reduce)").matches;
const guardar = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const leer = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const suave = () => (sinMovimiento ? "auto" : "smooth");
const ahoraLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const claseRes = (v) => v > 0 ? "gana" : v < 0 ? "pierde" : "";

let tipoActual = "simulada";
const filtro = () => ({ tipo: tipoActual, moneda: $("#f-moneda").value });
const qs = () => `tipo=${filtro().tipo}&moneda=${filtro().moneda}`;
let graficas = {};
let ultimoResumen = null;
let monedas = [{ codigo: "MXN", nombre: "Peso mexicano" }];
let emociones = [];
const EMOJI_EMOCION = { "calma": "😌", "miedo": "😰", "euforia": "🤩", "recuperar pérdida": "😤", "duda": "🤔", "aburrimiento": "🥱" };

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

// Llena todos los selectores de moneda y los campos de riesgo máximo con la lista del servidor.
function pintarMonedas() {
  const opciones = (corto) => monedas.map((m) => `<option value="${esc(m.codigo)}" title="${esc(m.nombre)}">${esc(m.codigo)}${corto ? "" : " · " + esc(m.nombre)}</option>`).join("");
  $$(".sel-moneda").forEach((sel) => { const v = sel.value; sel.innerHTML = opciones(sel.classList.contains("mini")); if (v) sel.value = v; });
  $("#riesgos-moneda").innerHTML = monedas.map((m) => `<label>Riesgo máx. por operación (${esc(m.codigo)})` +
    `<input name="riesgo_max_${esc(m.codigo.toLowerCase())}" type="number" step="any" min="0" inputmode="decimal"></label>`).join("");
}

// ---------- Avisos flotantes (con acción opcional, p. ej. "Deshacer")
function toast(texto, tipo = "", accion = null) {
  const t = document.createElement("div");
  t.className = "toast " + tipo;
  t.innerHTML = `<span class="punto"></span><div>${esc(texto)}</div>`;
  let cerrar;
  if (accion) {
    const b = document.createElement("button"); b.className = "accion"; b.textContent = accion.texto;
    b.onclick = () => { accion.fn(); cerrar(); };
    t.appendChild(b);
  }
  $("#toasts").appendChild(t);
  cerrar = () => { if (!t.isConnected) return; t.classList.add("sale"); setTimeout(() => t.remove(), 320); };
  setTimeout(cerrar, accion ? 7000 : 3600);
}

// ---------- Confirmación con diseño propio (en lugar de confirm())
function confirmar({ titulo, texto, boton = "Continuar", peligro = false, emoji = "❓" }) {
  const d = $("#dlg-confirmar");
  $("#confirmar-titulo").textContent = titulo; $("#confirmar-texto").textContent = texto;
  $("#confirmar-si").textContent = boton; $("#confirmar-ic").textContent = emoji;
  d.classList.toggle("peligro-dlg", peligro);
  d.showModal(); $("#confirmar-no").focus();
  return new Promise((ok) => {
    const fin = (v) => { d.close(); $("#confirmar-si").onclick = $("#confirmar-no").onclick = null; d.onclose = null; ok(v); };
    $("#confirmar-si").onclick = () => fin(true);
    $("#confirmar-no").onclick = () => fin(false);
    d.onclose = () => ok(false);
  });
}

// ---------- Tooltips para cualquier elemento con data-tip
const tip = $("#tooltip");
function mostrarTip(el) {
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect();
  let x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 8);
  let y = r.top - t.height - 8; if (y < 8) y = r.bottom + 8;
  tip.style.left = x + "px"; tip.style.top = y + "px";
}
document.addEventListener("mouseover", (e) => { const el = e.target.closest("[data-tip]"); if (el) mostrarTip(el); });
document.addEventListener("mouseout", (e) => { if (e.target.closest("[data-tip]")) tip.hidden = true; });
document.addEventListener("focusin", (e) => { const el = e.target.closest("[data-tip]"); if (el) mostrarTip(el); });
document.addEventListener("focusout", () => { tip.hidden = true; });
addEventListener("scroll", () => { tip.hidden = true; }, { passive: true });

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
const temaEfectivo = () => document.documentElement.dataset.theme || (consultaOscuro.matches ? "dark" : "light");
$("#seg-tema").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) aplicarTema(b.dataset.v); });
consultaOscuro.addEventListener("change", () => { if (!document.documentElement.dataset.theme) redibujarGraficas(); });

// ---------- Filtros globales
$("#seg-tipo").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b || b.dataset.v === tipoActual) return;
  ponerFiltro(b.dataset.v, $("#f-moneda").value);
});
$("#f-moneda").addEventListener("change", () => ponerFiltro(tipoActual, $("#f-moneda").value));
function ponerFiltro(tipo, moneda) {
  tipoActual = tipo; elegir($("#seg-tipo"), tipo); $("#f-moneda").value = moneda;
  guardar("filtro", JSON.stringify(filtro()));
  estadoDiario.dia = null;
  refrescar(pestanaActual());
}

// ---------- Pestañas
const HERO = {
  inicio: { et: "Inicio", ic: "casa", t: "¿Cómo voy?", p: "Tu disciplina, tu semana y tus últimas operaciones de un vistazo." },
  registrar: { et: "Registrar", ic: "pluma", t: "Registra en menos de 30 segundos", p: "Anota tu emoción al entrar: después del resultado se recuerda distinto." },
  diario: { et: "Diario", ic: "libro", t: "Tu historial de operaciones", p: "Ordena, filtra, cierra las abiertas y agrega reflexiones a cada operación." },
  panel: { et: "Panel", ic: "barras", t: "Tus números, calculados con código", p: "Ninguna cifra viene de la IA: todo se calcula con fórmulas fijas a partir de tus datos." },
  conducta: { et: "Mi conducta", ic: "cerebro", t: "Lo que tus operaciones dicen de ti", p: "Disciplina, emociones y riesgo: los hábitos que más pesan en el resultado." },
  noticias: { et: "Noticias", ic: "periodico", t: "Noticias sin jerga", p: "Pega un titular y recibe un resumen simple con los términos explicados. Sin predicciones." },
  ajustes: { et: "Ajustes", ic: "ajustes", t: "Tu plan, tus reglas", p: "Define tu riesgo máximo: la app te avisará cuando lo rompas." },
};
const ORDEN_PESTANAS = Object.keys(HERO);
const pestanaActual = () => $("#pestanas .activa").dataset.p;
$$("#pestanas button").forEach((b) => b.addEventListener("click", () => abrir(b.dataset.p)));
document.addEventListener("click", (e) => { const b = e.target.closest("[data-ir]"); if (b) abrir(b.dataset.ir); });
function moverIndicador() {
  const a = $("#pestanas .activa"), i = $("#pestanas .indicador");
  if (!a || !a.offsetWidth) return;
  i.style.width = a.offsetWidth + "px"; i.style.transform = `translateX(${a.offsetLeft}px)`;
  if (innerWidth > 700) a.scrollIntoView({ block: "nearest", inline: "nearest", behavior: suave() });
}
function abrir(p, { recargar = true } = {}) {
  $$("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.p === p));
  $$(".pestana").forEach((s) => s.classList.toggle("activa", s.id === "p-" + p));
  document.body.classList.toggle("en-registrar", p === "registrar");
  moverIndicador();
  pintarHero(p);
  $("#banner-tip").classList.toggle("oculto-aqui", p === "conducta" || p === "inicio");
  guardar("pestana", p);
  if (recargar) refrescar(p);
}
function pintarHero(p) {
  const h = HERO[p], hero = $("#hero");
  $("#hero-etiqueta").innerHTML = icono(h.ic) + esc(h.et);
  $("#hero-titulo").textContent = h.t;
  $("#hero-texto").textContent = h.p;
  hero.classList.remove("cambia"); void hero.offsetWidth; hero.classList.add("cambia");
}
function refrescar(p) {
  if (p === "inicio") cargarInicio();
  if (p === "registrar") {
    cargarTickers();
    // formulario nuevo y vacío: que siga el filtro activo (tipo y moneda)
    if (!form.id.value && !form.ticker.value) { form.tipo.value = tipoActual; form.moneda.value = filtro().moneda; }
  }
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
  try {
    const { estadisticas: e, pausa } = await api(`/api/estadisticas?${qs()}`);
    ultimoResumen = e;
    const chips = [
      ["Operaciones", e.cerradas, (v) => Math.round(v).toString()],
      ["Resultado " + filtro().moneda, e.resultado_total, conSigno],
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

// ======================================================================= INICIO
async function cargarInicio() {
  $("#semana").innerHTML = `<div class="esqueleto" style="height:24px;width:70%"></div><div class="esqueleto" style="height:16px;width:45%;margin-top:12px"></div>`;
  $("#ultimas").innerHTML = [0, 1, 2].map(() => `<div class="esqueleto" style="height:60px;border-radius:12px"></div>`).join("");
  const d = await api(`/api/inicio?${qs()}`);
  const { moneda, tipo } = filtro();
  pintarMedidor(d.disciplina);

  // Semana en una frase
  const s = d.semana;
  let frase;
  if (s.operaciones === 0) frase = `Sin operaciones ${tipo === "real" ? "reales" : "simuladas"} en ${esc(moneda)} en los últimos 7 días.`;
  else if (s.cerradas === 0) frase = `Esta semana: <em>${s.operaciones} ${s.operaciones === 1 ? "operación abierta" : "operaciones abiertas"}</em>, ninguna cerrada aún.`;
  else frase = `Esta semana: <em>${s.cerradas} ${s.cerradas === 1 ? "operación" : "operaciones"}</em>, seguiste tu plan en <em>${s.siguieron_plan}</em>.`;
  const racha = d.disciplina.racha_dias;
  $("#semana").innerHTML = `<div class="cab-tarjeta"><h3>Tu semana</h3><span class="nota" style="font-size:12px">últimos 7 días</span></div>
    <p class="frase-semana">${frase}</p>
    <div class="mini-stats">
      ${s.cerradas ? `<span class="pill-dato">Resultado <b class="${claseRes(s.resultado)}">${conSigno(s.resultado)} ${esc(moneda)}</b></span>` : ""}
      ${racha ? `<span class="racha" data-tip="Días seguidos (desde el último con operaciones cerradas) en que todas tus operaciones cumplieron tu plan.">🔥 ${racha} ${racha === 1 ? "día" : "días"} siguiendo tu plan</span>` : ""}
      <button class="enlace" data-ir="registrar">${icono("mas")} Registrar operación</button>
    </div>`;
  celebrarRacha(racha);

  // Últimas 3 operaciones
  $("#ultimas").innerHTML = d.ultimas.length ? d.ultimas.map((o) => `
    <div class="op-mini" data-ver="${o.id}" tabindex="0" role="button" aria-label="Ver operación ${o.id}">
      <div class="avatar">${esc(o.ticker.slice(0, 4))}</div>
      <div><b>${esc(o.ticker)}</b> <span class="etiqueta ${o.direccion}">${o.direccion === "compra" ? "▲" : "▼"}</span>
        ${o._cumple === true ? `<span class="sello si">${icono("check")}plan</span>` : o._cumple === false ? `<span class="sello no">fuera del plan</span>` : ""}
        <div class="sub">${esc(o.entrada_fecha)} ${o.emocion ? "· " + (EMOJI_EMOCION[o.emocion] || "") + " " + esc(o.emocion) : ""}</div></div>
      <div class="res ${claseRes(o._resultado)}">${o._resultado === null ? `<span class="etiqueta marca">abierta</span>` : conSigno(o._resultado)}</div>
    </div>`).join("")
    : `<div class="vacio"><span class="emoji">📒</span><b>Aún no hay operaciones aquí</b><button class="primario" data-ir="registrar" style="margin-top:10px">${icono("mas")}Registrar la primera</button></div>`;

  // Hallazgo más reciente o patrón principal
  const h = d.ultimo_hallazgo?.hallazgos?.[0], p = d.patron_principal;
  let html = `<div class="cab-tarjeta"><h3>Lo más importante a revisar</h3><button class="enlace" data-ir="conducta">Mi conducta ${icono("flecha")}</button></div>`;
  if (p) {
    html += `<p style="margin:0 0 6px"><b>${esc(p.nombre)}</b>: ocurrió ${p.veces} de ${p.oportunidades} veces posibles (${pct(p.proporcion)}).</p>
      <div class="costo"><div>Esas operaciones sumaron<b class="${claseRes(p.costo)}">${conSigno(p.costo)} ${esc(moneda)}</b></div>
      <div>Promedio con el patrón vs. sin él<b>${conSigno(p.promedio_patron)} / ${conSigno(p.promedio_resto)}</b></div></div>`;
  } else if (d.disciplina.operaciones) {
    html += `<p class="nota">No hay patrones con los umbrales actuales (se necesitan al menos 20 operaciones cerradas). Sigue registrando.</p>`;
  } else html += `<p class="nota">Cuando tengas operaciones cerradas, aquí aparecerá el hábito que más conviene revisar.</p>`;
  if (h) html += `<div class="patron hallazgo" style="margin-top:12px;padding:12px"><span class="chispa">${icono("chispa")} Último análisis con IA · ${esc(d.ultimo_hallazgo.fecha)}</span><p style="margin:6px 0 0">${esc(h.explicacion)}</p></div>`;
  $("#inicio-hallazgo").innerHTML = html;

  if (d.total_operaciones === 0 && !leer("bienvenida")) abrirBienvenida();
}
function pintarMedidor(disc) {
  const arco = $("#medidor-arco"), circ = 314.16;
  const v = disc.puntaje;
  arco.style.strokeDashoffset = circ;
  requestAnimationFrame(() => requestAnimationFrame(() => { arco.style.strokeDashoffset = v === null ? circ : circ * (1 - v / 100); }));
  if (v === null) { $("#medidor-num").textContent = "—"; $("#medidor-txt").textContent = "sin operaciones cerradas"; }
  else {
    contar($("#medidor-num"), v, (x) => Math.round(x).toString());
    $("#medidor-txt").textContent = v >= 85 ? "¡excelente!" : v >= 65 ? "vas bien" : "por mejorar";
  }
  $("#revisiones").innerHTML = disc.revisiones.map((r) => `
    <div class="revision"><div class="fila"><span>${esc(r.nombre)}</span><b>${r.cumplidas}/${r.total}</b></div>
    <div class="barra"><i data-w="${(r.cumplidas / r.total * 100).toFixed(0)}%"></i></div></div>`).join("")
    + (disc.operaciones ? `<p class="nota" style="font-size:12px;margin-top:4px">Basado en tus últimas ${disc.operaciones} operaciones cerradas.${disc.revisiones.some((r) => r.clave === "riesgo_ok") ? "" : " Define tu riesgo máximo en Ajustes para medirlo también."}</p>` : "");
  animarBarras();
}
document.addEventListener("click", (e) => { const o = e.target.closest("[data-ver]"); if (o) verOperacion(Number(o.dataset.ver)); });
document.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.matches("[data-ver]")) verOperacion(Number(e.target.dataset.ver)); });
function verOperacion(id) { estadoDiario.f = "todas"; estadoDiario.dia = null; abrir("diario", { recargar: false }); cargarDiario([id]); }

// Celebración discreta: 3 o más días seguidos cumpliendo el plan (premia disciplina, no ganancia)
function celebrarRacha(racha) {
  const clave = "racha-" + qs(), previa = Number(leer(clave) || 0);
  if (racha >= 3 && racha > previa) {
    guardar(clave, racha);
    if (previa < 3) { confeti(); toast(`🔥 ${racha} días seguidos siguiendo tu plan. ¡Eso es disciplina!`, "ok"); }
  } else if (racha < previa) guardar(clave, racha);
}

// ======================================================================= REGISTRAR
const form = $("#form-op");
function pintarEmociones() {
  $("#emociones").innerHTML = emociones.map((e) => `<button type="button" class="emocion" role="radio" aria-checked="false" data-e="${esc(e)}"><span class="e">${EMOJI_EMOCION[e] || "•"}</span>${esc(e)}</button>`).join("");
}
$("#emociones").addEventListener("click", (e) => {
  const b = e.target.closest(".emocion"); if (!b) return;
  const ya = b.getAttribute("aria-checked") === "true";
  $$("#emociones .emocion").forEach((x) => x.setAttribute("aria-checked", "false"));
  if (!ya) b.setAttribute("aria-checked", "true");
  form.emocion.value = ya ? "" : b.dataset.e;
});
function marcarEmocion(v) { $$("#emociones .emocion").forEach((x) => x.setAttribute("aria-checked", String(x.dataset.e === v))); form.emocion.value = v || ""; }
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-ahora]"); if (!b) return;
  form[b.dataset.ahora].value = ahoraLocal(); form[b.dataset.ahora].dispatchEvent(new Event("input", { bubbles: true }));
});
async function cargarTickers() {
  try { $("#lista-tickers").innerHTML = (await api("/api/tickers")).map((t) => `<option value="${esc(t)}">`).join(""); } catch (e) {}
}
form.ticker.addEventListener("input", () => { const p = form.ticker.selectionStart; form.ticker.value = form.ticker.value.toUpperCase(); form.ticker.setSelectionRange(p, p); });
form.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); form.requestSubmit(); } });
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
    toast(id ? "Operación actualizada." : `Operación de ${d.ticker.toUpperCase()} guardada.`, "ok", { texto: "Ver", fn: () => abrir("diario") });
    limpiarForm(d); cargarResumen(); cargarTickers();
  } catch (err) { mensaje($("#msg-form"), err.message, "error"); toast("Revisa los datos: " + err.message, "error"); }
  finally { btn.classList.remove("cargando"); }
});
function limpiarForm(previo) {
  form.reset(); form.id.value = "";
  form.tipo.value = previo?.tipo || tipoActual; form.moneda.value = previo?.moneda || filtro().moneda;
  form.entrada_fecha.value = ahoraLocal(); marcarEmocion("");
  $("#grupo-salida").open = false;
  $("#txt-guardar").textContent = "Guardar operación"; $("#cancelar-edicion").hidden = true; vistaPrevia();
}
$("#cancelar-edicion").addEventListener("click", () => limpiarForm());
function editar(op) {
  abrir("registrar");
  for (const [k, v] of Object.entries(op)) if (form[k] && !k.startsWith("_") && k !== "emocion") form[k].value = v === null ? "" : (k.endsWith("_fecha") ? v.replace(" ", "T") : v);
  marcarEmocion(op.emocion);
  form.id.value = op.id; $("#grupo-salida").open = !!op.salida_fecha;
  $("#txt-guardar").textContent = `Guardar cambios a #${op.id}`; $("#cancelar-edicion").hidden = false; vistaPrevia();
  scrollTo({ top: 0, behavior: suave() });
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
$("#fab").addEventListener("click", () => { abrir("registrar"); setTimeout(() => form.ticker.focus(), 250); });

// ======================================================================= DIARIO
let ultimasOps = [];
const estadoDiario = { f: "todas", dia: null, col: "entrada_fecha", dir: -1 };
async function cargarDiario(resaltar = []) {
  const { tipo, moneda } = filtro();
  if (!ultimasOps.length) $("#tabla-ops tbody").innerHTML = Array(6).fill(`<tr class="fila-esq"><td colspan="9"><div class="esqueleto" style="height:18px"></div></td></tr>`).join("");
  ultimasOps = await api(`/api/operaciones?${qs()}`);
  const abiertas = ultimasOps.filter((o) => o._resultado === null).length;
  $("#resumen-diario").textContent = `${ultimasOps.length} operaciones ${tipo === "real" ? "reales" : "simuladas"} en ${moneda}` + (abiertas ? ` · ${abiertas} abiertas` : "");
  pintarFiltros(); pintarTabla(resaltar);
}
const FILTROS = {
  todas: () => true, ganadoras: (o) => o._resultado > 0, perdedoras: (o) => o._resultado < 0,
  abiertas: (o) => o._resultado === null, sin_stop: (o) => o.stop_inicial === null, fuera_plan: (o) => o._cumple === false,
};
function pintarFiltros() {
  $$("#filtros-diario button[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === estadoDiario.f)));
  const chip = $("#filtro-dia");
  chip.hidden = !estadoDiario.dia;
  if (estadoDiario.dia) chip.innerHTML = `${icono("calendario")} Cerradas el ${esc(estadoDiario.dia)} <button aria-label="Quitar filtro de día">${icono("cerrar")}</button>`;
  $$("#tabla-ops th[data-orden]").forEach((th) => th.setAttribute("aria-sort", th.dataset.orden === estadoDiario.col ? (estadoDiario.dir > 0 ? "ascending" : "descending") : "none"));
}
$("#filtros-diario").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.f) estadoDiario.f = b.dataset.f; else estadoDiario.dia = null;
  pintarFiltros(); pintarTabla();
});
$("#tabla-ops thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-orden]"); if (!th) return;
  estadoDiario.dir = estadoDiario.col === th.dataset.orden ? -estadoDiario.dir : (["ticker", "direccion", "emocion"].includes(th.dataset.orden) ? 1 : -1);
  estadoDiario.col = th.dataset.orden; pintarFiltros(); pintarTabla();
});
function pintarTabla(resaltar = []) {
  const q = $("#buscar-op").value.trim().toLowerCase();
  const { col, dir } = estadoDiario;
  let ops = ultimasOps.filter(FILTROS[estadoDiario.f]);
  if (estadoDiario.dia) ops = ops.filter((o) => o.salida_fecha?.startsWith(estadoDiario.dia));
  if (q) ops = ops.filter((o) => (o.ticker + " " + (o.emocion || "")).toLowerCase().includes(q));
  ops = [...ops].sort((a, b) => {
    const x = a[col], y = b[col];
    if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y), "es")) * dir;
  });
  const filas = ops.map((op) => {
    const res = op._resultado;
    const r = op._r === null ? (op.stop_inicial === null ? `<span class="etiqueta venta">sin stop</span>` : "—") : op._r.toFixed(2);
    return `<tr id="op-${op.id}" class="${resaltar.includes(op.id) ? "resaltada" : ""} ${op._cumple === false ? "fuera-plan" : ""}">
      <td data-c="id">${op.id}</td><td data-c="fecha">${esc(op.entrada_fecha)}</td><td data-c="ticker"><b>${esc(op.ticker)}</b>${op._cumple === false ? ` <span class="sello no" data-tip="No cumplió alguna regla de tu plan">fuera del plan</span>` : ""}</td>
      <td data-c="direccion"><span class="etiqueta ${op.direccion}">${op.direccion === "compra" ? "▲ Compra" : "▼ Corto"}</span></td>
      <td data-c="cantidad" class="num">${op.cantidad}</td><td data-c="resultado" class="num ${claseRes(res)}">${res === null ? `<span class="etiqueta marca">abierta</span>` : conSigno(res)}</td>
      <td data-c="r" class="num">${r}</td>
      <td data-c="emocion">${op.emocion ? `<span class="etiqueta neutral">${EMOJI_EMOCION[op.emocion] || ""} ${esc(op.emocion)}</span>` : ""}</td>
      <td data-c="acciones"><div class="acciones-fila">
        ${res === null ? `<button class="btn-icono" title="Cerrar operación" data-a="cerrar" data-id="${op.id}">${icono("candado")}<span class="solo-movil">Cerrar</span></button>` : ""}
        <button class="btn-icono" title="Editar" data-a="editar" data-id="${op.id}">${icono("editar")}</button>
        <button class="btn-icono" title="Notas" data-a="notas" data-id="${op.id}">${icono("nota")}</button>
        <button class="btn-icono peligro" title="Borrar" data-a="borrar" data-id="${op.id}">${icono("basura")}</button></div></td></tr>`;
  });
  const vacio = ultimasOps.length
    ? `<div class="vacio"><span class="emoji">🔍</span><b>Nada coincide con el filtro</b>Prueba con otro filtro o búsqueda.</div>`
    : `<div class="vacio"><span class="emoji">📒</span><b>Aún no hay operaciones aquí</b>Registra tu primera operación o carga los ejemplos en Ajustes y datos.</div>`;
  $("#tabla-ops tbody").innerHTML = filas.join("") || `<tr><td colspan="9">${vacio}</td></tr>`;
  if (resaltar.length) document.getElementById("op-" + resaltar[0])?.scrollIntoView({ block: "center", behavior: suave() });
}
$("#buscar-op").addEventListener("input", () => pintarTabla());
$("#tabla-ops").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-a]"); if (!b) return;
  const op = ultimasOps.find((o) => o.id == b.dataset.id);
  if (b.dataset.a === "editar") editar(op);
  if (b.dataset.a === "notas") abrirNotas(op);
  if (b.dataset.a === "cerrar") abrirCerrar(op);
  if (b.dataset.a === "borrar") {
    const fila = b.closest("tr"); fila.style.transition = "opacity .25s, transform .25s"; fila.style.opacity = "0"; fila.style.transform = "translateX(20px)";
    const borrado = await api(`/api/operaciones/${op.id}`, { method: "DELETE" });
    toast(`Operación #${op.id} (${op.ticker}) borrada.`, "", { texto: "Deshacer", fn: async () => {
      await api("/api/operaciones/restaurar", { method: "POST", body: JSON.stringify({ operacion: borrado.operacion, notas: borrado.notas }) });
      toast("Operación restaurada.", "ok"); cargarDiario([op.id]); cargarResumen();
    } });
    setTimeout(() => { cargarDiario(); cargarResumen(); }, 250);
  }
});
// Notas
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
// Cerrar una operación abierta
let opCerrar = null;
const fc = $("#form-cerrar");
function abrirCerrar(op) {
  opCerrar = op; fc.reset();
  $("#cerrar-titulo").textContent = `Cerrar #${op.id} · ${op.ticker}`;
  $("#cerrar-sub").textContent = `${op.direccion === "compra" ? "Compra" : "Venta en corto"} de ${op.cantidad} a ${dinero(op.entrada_precio)} ${op.moneda} · stop ${op.stop_inicial ?? "—"} · objetivo ${op.objetivo ?? "—"}`;
  fc.salida_fecha.value = ahoraLocal(); mensaje($("#msg-cerrar"), "", "error"); $("#cerrar-preview").innerHTML = "";
  $("#dlg-cerrar").showModal(); fc.salida_precio.focus();
}
fc.addEventListener("input", () => {
  const p = Number(fc.salida_precio.value); if (!p || !opCerrar) { $("#cerrar-preview").innerHTML = ""; return; }
  const s = opCerrar.direccion === "compra" ? 1 : -1, bruto = s * (p - opCerrar.entrada_precio) * opCerrar.cantidad - (opCerrar.comision || 0);
  $("#cerrar-preview").innerHTML = `<span class="pill-dato">${icono("objetivo")}Resultado aprox. <b class="${claseRes(bruto)}">${conSigno(bruto)} ${esc(opCerrar.moneda)}</b></span>`;
});
$("[data-ahora-cerrar]").addEventListener("click", () => { fc.salida_fecha.value = ahoraLocal(); });
$("#cancelar-cerrar").addEventListener("click", () => $("#dlg-cerrar").close());
fc.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api(`/api/operaciones/${opCerrar.id}/cerrar`, { method: "POST", body: JSON.stringify({
      salida_fecha: fc.salida_fecha.value, salida_precio: Number(fc.salida_precio.value),
      stop_final: fc.stop_final.value === "" ? null : Number(fc.stop_final.value) }) });
    $("#dlg-cerrar").close(); toast(`Operación #${opCerrar.id} cerrada.`, "ok"); cargarDiario([opCerrar.id]); cargarResumen();
  } catch (err) { mensaje($("#msg-cerrar"), err.message, "error"); }
});

// ======================================================================= PANEL (RF3)
const AYUDA_KPI = {
  "Tasa de acierto": GLOSARIO_BASE["Tasa de acierto"], "Resultado total": "Suma de los resultados de tus operaciones cerradas, ya con comisiones.",
  "Ganancia promedio": "Lo que ganaste en promedio en cada operación ganadora.", "Pérdida promedio": "Lo que perdiste en promedio en cada operación perdedora.",
  "Factor de beneficio": GLOSARIO_BASE["Factor de beneficio"], "Caída máxima": GLOSARIO_BASE["Caída máxima (drawdown)"],
  "R promedio": GLOSARIO_BASE["Múltiplo R"], "Sin stop": "Operaciones donde no definiste un stop: no se puede medir cuánto arriesgaste.",
};
async function cargarPanel() {
  $("#kpis").innerHTML = Array(8).fill(`<div class="esqueleto kpi-esq"></div>`).join("");
  const { estadisticas: e } = await api(`/api/estadisticas?${qs()}`);
  ultimoResumen = e;
  const num = (v, f) => (v === null || v === undefined) ? null : f(v);
  const kpis = [
    ["Tasa de acierto", "objetivo", e.tasa_acierto, pct, `${e.ganadoras} ganadoras · ${e.perdedoras} perdedoras` + (e.neutras ? ` · ${e.neutras} neutras` : ""), ""],
    ["Resultado total", e.resultado_total >= 0 ? "sube" : "baja", e.resultado_total, conSigno, `${e.cerradas} cerradas` + (e.abiertas ? ` · ${e.abiertas} abiertas` : ""), claseRes(e.resultado_total)],
    ["Ganancia promedio", "sube", e.ganancia_promedio, dinero, "por operación ganadora", "gana"],
    ["Pérdida promedio", "baja", e.perdida_promedio, dinero, "por operación perdedora", "pierde"],
    ["Factor de beneficio", "balanza", e.factor_beneficio, (v) => typeof v === "number" ? v.toFixed(2) : (v ?? "—"), "ganancias ÷ pérdidas", ""],
    ["Caída máxima", "caida", e.caida_maxima, dinero, "mayor baja desde un pico", ""],
    ["R promedio", "objetivo", e.r_promedio, (v) => v === null ? "—" : v.toFixed(2) + "R", "resultado ÷ riesgo inicial", ""],
    ["Sin stop", "escudo", e.sin_stop, (v) => Math.round(v).toString(), "operaciones sin stop inicial", e.sin_stop ? "pierde" : ""],
  ];
  $("#kpis").innerHTML = kpis.map(([t, ic, , , s, cl], i) => `
    <div class="kpi escalon ${cl}" style="--i:${i}"><div class="cab"><span class="ic-caja">${icono(ic)}</span>${t}
      <span class="ayuda" tabindex="0" data-tip="${esc(AYUDA_KPI[t])}" style="margin-left:auto">?</span></div>
    <div class="v">—</div><div class="s">${esc(s)}</div></div>`).join("");
  $$("#kpis .v").forEach((el, i) => contar(el, kpis[i][2], (v) => num(v, kpis[i][3]) ?? "—"));
  dibujarGraficas(e);
  pintarCalendario(e.por_fecha);
}

// Calendario de resultados (cada día por su resultado; intensidad según el tamaño relativo)
function pintarCalendario(porFecha) {
  const dias = Object.keys(porFecha);
  const cont = $("#calendario");
  if (!dias.length) { cont.innerHTML = `<p class="nota">Aún no hay operaciones cerradas para mostrar.</p>`; return; }
  const maximo = Math.max(...dias.map((d) => Math.abs(porFecha[d].resultado))) || 1;
  const ultimo = new Date(dias[dias.length - 1] + "T12:00"), primero = new Date(dias[0] + "T12:00");
  const meses = [];
  let m = new Date(ultimo.getFullYear(), ultimo.getMonth(), 1);
  while (meses.length < 6 && m >= new Date(primero.getFullYear(), primero.getMonth(), 1)) { meses.unshift(new Date(m)); m.setMonth(m.getMonth() - 1); }
  const moneda = filtro().moneda;
  cont.innerHTML = meses.map((ini) => {
    const nombre = ini.toLocaleDateString("es-MX", { month: "long", year: "numeric" });
    const hueco = (ini.getDay() + 6) % 7; // lunes primero
    const total = new Date(ini.getFullYear(), ini.getMonth() + 1, 0).getDate();
    let celdas = ["L", "M", "M", "J", "V", "S", "D"].map((d) => `<span class="cab">${d}</span>`).join("");
    celdas += Array(hueco).fill(`<span class="dia vacio-mes"></span>`).join("");
    for (let n = 1; n <= total; n++) {
      const clave = `${ini.getFullYear()}-${String(ini.getMonth() + 1).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
      const d = porFecha[clave];
      if (!d) { celdas += `<span class="dia" aria-hidden="true"></span>`; continue; }
      const rel = Math.abs(d.resultado) / maximo, a = rel > .66 ? 92 : rel > .33 ? 62 : 34;
      const color = d.resultado >= 0 ? "var(--gana-marca)" : "var(--pierde-marca)";
      const texto = `${clave} · ${d.operaciones} ${d.operaciones === 1 ? "operación" : "operaciones"} · ${conSigno(d.resultado)} ${moneda}`;
      celdas += `<button class="dia con" style="--c:${color};--a:${a}%" data-dia="${clave}" data-tip="${esc(texto)}" aria-label="${esc(texto)}"></button>`;
    }
    return `<div class="mes"><h4>${esc(nombre)}</h4><div class="mes-dias">${celdas}</div></div>`;
  }).join("");
  cont.scrollLeft = cont.scrollWidth;
}
$("#calendario").addEventListener("click", (e) => {
  const d = e.target.closest("[data-dia]"); if (!d) return;
  tip.hidden = true; estadoDiario.dia = d.dataset.dia; estadoDiario.f = "todas";
  abrir("diario");
});

// ---------- Gráficas (colores tomados del tema activo)
const token = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
function redibujarGraficas() {
  if (pestanaActual() === "panel" && ultimoResumen) dibujarGraficas(ultimoResumen);
  if (pestanaActual() === "conducta" && ultimaDeteccion) dibujarLinea(ultimaDeteccion);
}
function baseGraficas() {
  const moneda = filtro().moneda, borde = token("--borde"), sup = token("--superficie");
  Chart.defaults.color = token("--suave");
  Chart.defaults.font.family = "Inter, system-ui, sans-serif";
  const tooltip = {
    backgroundColor: sup, titleColor: token("--texto"), bodyColor: token("--texto"), borderColor: borde, borderWidth: 1,
    padding: 10, cornerRadius: 10, displayColors: false, callbacks: { label: (c) => `${conSigno(c.parsed.y)} ${moneda}` },
  };
  const escalas = {
    x: { grid: { display: false }, border: { color: borde }, ticks: { maxRotation: 0, autoSkipPadding: 14 } },
    y: { grid: { color: borde }, border: { display: false }, ticks: { callback: (v) => Number(v).toLocaleString("es-MX") } },
  };
  return { responsive: true, maintainAspectRatio: true, interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip }, scales: escalas, animation: sinMovimiento ? false : { duration: 900, easing: "easeOutQuart" } };
}
function sinChart(cont) {
  cont.innerHTML = `<div class="banner alerta" style="grid-column:1/-1"><div class="ic-caja">${icono("info")}</div><div><b>Gráficas no disponibles</b><p>No se pudo cargar Chart.js (¿sin internet?). Las cifras siguen siendo correctas.</p></div></div>`;
}
function dibujarGraficas(e) {
  if (!window.Chart) { sinChart($(".graficas")); return; }
  const base = baseGraficas(), marca = token("--marca"), sup = token("--superficie");
  const gana = token("--gana-marca"), pierde = token("--pierde-marca");
  dibujar("g-curva", "line", {
    labels: e.curva.map((p) => p.fecha.slice(0, 10)),
    datasets: [{ data: e.curva.map((p) => p.capital), borderColor: marca, borderWidth: 2, pointRadius: 0, pointHoverRadius: 5,
      pointHoverBackgroundColor: marca, pointHoverBorderColor: sup, pointHoverBorderWidth: 2, tension: 0.25, fill: true,
      backgroundColor: (ctx) => {
        const { chart } = ctx; if (!chart.chartArea) return "transparent";
        const g = chart.ctx.createLinearGradient(0, chart.chartArea.top, 0, chart.chartArea.bottom);
        g.addColorStop(0, marca + "55"); g.addColorStop(1, marca + "00"); return g;
      } }],
  }, { ...base, aspectRatio: innerWidth < 700 ? 1.6 : 2.6 });
  const barras = (obj, etiquetas) => ({ labels: etiquetas || Object.keys(obj), datasets: [{
    data: Object.values(obj), backgroundColor: Object.values(obj).map((v) => v >= 0 ? gana : pierde),
    hoverBackgroundColor: Object.values(obj).map((v) => (v >= 0 ? gana : pierde) + "cc"),
    borderRadius: 4, borderSkipped: false, maxBarThickness: 34, categoryPercentage: 0.7 }] });
  const opBarras = { ...base, interaction: { mode: "nearest", intersect: false }, aspectRatio: 1.6 };
  dibujar("g-activo", "bar", barras(e.por_activo), opBarras);
  dibujar("g-dia", "bar", barras(e.por_dia), opBarras);
  dibujar("g-emocion", "bar", barras(e.por_emocion, Object.keys(e.por_emocion).map((k) => `${EMOJI_EMOCION[k] || ""} ${k}`)), { ...opBarras, aspectRatio: innerWidth < 700 ? 1.6 : 3.2 });
}
function dibujar(id, tipo, data, options) {
  graficas[id]?.destroy();
  graficas[id] = new Chart(document.getElementById(id), { type: tipo, data, options });
}

// ======================================================================= CONDUCTA (RF4)
const EMOJI = { revancha: "😤", stop_en_contra: "🎯", tamano_tras_perder: "📈", cortar_ganancias: "✂️", romper_riesgo: "⚠️", sin_stop: "🛑" };
// Paleta categórica validada (claro / oscuro) + una forma distinta por patrón, para no depender solo del color.
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#9085e9"],
};
const ORDEN_PATRONES = ["revancha", "stop_en_contra", "tamano_tras_perder", "cortar_ganancias", "romper_riesgo", "sin_stop"];
// Formas rellenas y distinguibles (la estrella se dibuja con contorno grueso del mismo color).
const FORMAS = [["circle", 0], ["triangle", 0], ["rect", 0], ["rectRot", 0], ["triangle", 180], ["star", 0]];
let ultimaDeteccion = null;
function citas(ids) {
  return `<div class="citas">Basado en: ${ids.map((i) => `<a href="#" data-op="${i}">#${i}</a>`).join("")}</div>`;
}
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-op]"); if (!a) return;
  e.preventDefault(); verOperacion(Number(a.dataset.op));
});
async function cargarPatrones() {
  $("#patrones").innerHTML = [0, 1, 2].map(() => `<div class="esqueleto" style="height:170px;border-radius:var(--radio)"></div>`).join("");
  const d = await api(`/api/patrones?${qs()}`);
  $("#hallazgos").innerHTML = ""; mensaje($("#msg-ia"), "");
  if (!d.suficientes) {
    $("#tarjeta-linea").hidden = true;
    $("#patrones").innerHTML = `<div class="patron vacio" style="grid-column:1/-1"><span class="emoji">🌱</span><b>Aún faltan datos</b>
      Se necesitan al menos ${d.minimo} operaciones cerradas para buscar patrones. Llevas ${d.cerradas}.
      <div class="barra" style="max-width:320px;margin:12px auto 0"><i style="width:0" data-w="${Math.min(100, d.cerradas / d.minimo * 100)}%"></i></div></div>`;
    $("#btn-ia").disabled = true; animarBarras(); return;
  }
  $("#btn-ia").disabled = d.patrones.length === 0;
  const moneda = filtro().moneda;
  $("#patrones").innerHTML = d.patrones.length ? d.patrones.map((p, i) => `
    <div class="patron escalon" style="--i:${i}">
      <div class="cab"><span class="ic-caja">${EMOJI[p.clave] || "•"}</span><div><h3>${esc(p.nombre)}</h3>
      <div class="meta">${p.veces} de ${p.oportunidades} veces posibles</div></div>
      <span class="etiqueta marca" style="margin-left:auto">${pct(p.proporcion)}</span></div>
      <div class="barra"><i data-w="${Math.min(100, p.proporcion * 100)}%"></i></div>
      <div class="meta">Ejemplo: ${esc(p.casos[0].detalle)}</div>
      <div class="costo">
        <div>Esas ${p.ids_patron.length} operaciones sumaron<b class="${claseRes(p.costo)}">${conSigno(p.costo)} ${esc(moneda)}</b></div>
        <div>Promedio con el patrón / sin él<b><span class="${claseRes(p.promedio_patron)}">${conSigno(p.promedio_patron)}</span> / <span class="${claseRes(p.promedio_resto)}">${conSigno(p.promedio_resto)}</span></b></div>
      </div>
      ${citas(p.ids.slice(0, 12))}${p.ids.length > 12 ? `<small style="color:var(--tenue)">…y ${p.ids.length - 12} más</small>` : ""}</div>`).join("")
    : `<div class="patron vacio" style="grid-column:1/-1"><span class="emoji">🏆</span><b>Sin patrones detectados</b>Con los umbrales actuales vas siguiendo tu plan. ¡Sigue así!</div>`;
  animarBarras();
  $("#tarjeta-linea").hidden = !d.patrones.length;
  ultimaDeteccion = d;
  if (d.patrones.length) dibujarLinea(d);
}
async function dibujarLinea(d) {
  if (!window.Chart) { sinChart($("#tarjeta-linea")); return; }
  const { estadisticas: e } = await api(`/api/estadisticas?${qs()}`);
  const indice = Object.fromEntries(e.curva.map((p, i) => [p.id, i]));
  const colores = SERIES[temaEfectivo()];
  const base = baseGraficas();
  const conjuntos = d.patrones.map((p) => {
    const k = ORDEN_PATRONES.indexOf(p.clave), datos = Array(e.curva.length).fill(null), ops = Array(e.curva.length).fill(null);
    p.ids_patron.forEach((id) => { if (id in indice) { datos[indice[id]] = e.curva[indice[id]].capital; ops[indice[id]] = id; } });
    const [forma, giro] = FORMAS[k], estrella = forma === "star";
    return { label: p.nombre, data: datos, _ops: ops, showLine: false, pointStyle: forma, pointRotation: giro,
      pointRadius: estrella ? 8 : 6, pointHoverRadius: estrella ? 11 : 9,
      backgroundColor: colores[k], borderColor: estrella ? colores[k] : token("--superficie"), borderWidth: estrella ? 2.5 : 1.5 };
  });
  dibujar("g-linea", "line", {
    labels: e.curva.map((p) => p.fecha.slice(0, 10)),
    datasets: [{ label: "Curva de capital", data: e.curva.map((p) => p.capital), borderColor: token("--tenue"), borderWidth: 2, pointRadius: 0, tension: 0.25 }, ...conjuntos],
  }, { ...base, aspectRatio: innerWidth < 700 ? 1.3 : 2.8, interaction: { mode: "point", intersect: true },
    onClick: (ev, el) => { const x = el[0]; if (x && x.datasetIndex > 0) verOperacion(conjuntos[x.datasetIndex - 1]._ops[x.index]); },
    plugins: { ...base.plugins,
      legend: { display: true, position: "bottom", labels: { usePointStyle: true, boxHeight: 8, padding: 14, filter: (it) => it.datasetIndex > 0 } },
      tooltip: { ...base.plugins.tooltip, displayColors: true, callbacks: {
        label: (c) => c.datasetIndex === 0 ? `Capital: ${conSigno(c.parsed.y)}` : `${c.dataset.label} · operación #${c.dataset._ops[c.dataIndex]} (clic para verla)` } } } });
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
    $("#hallazgos").scrollIntoView({ behavior: suave(), block: "start" });
  } catch (e) { mensaje($("#msg-ia"), e.message, "error"); }
  finally { btn.classList.remove("cargando"); }
});

// ======================================================================= NOTICIAS (RF5) y glosario
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

// ======================================================================= AJUSTES Y DATOS (RF6)
async function cargarAjustes() {
  const a = await api("/api/ajustes"); const f = $("#form-ajustes");
  f.moneda.value = a.moneda;
  monedas.forEach((m) => { const k = "riesgo_max_" + m.codigo.toLowerCase(); if (f[k]) f[k].value = a[k] ?? ""; });
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
    const datos = { moneda: f.moneda.value, reglas_plan: f.reglas_plan.value, enviar_motivos_a_ia: f.enviar_motivos_a_ia.checked };
    monedas.forEach((m) => { const k = "riesgo_max_" + m.codigo.toLowerCase(); datos[k] = num(f[k].value); });
    await api("/api/ajustes", { method: "PUT", body: JSON.stringify(datos) });
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
async function cargarEjemplos() {
  const r = await api("/api/ejemplos", { method: "POST" });
  ponerFiltro("simulada", "MXN");
  toast(r.importadas ? `Cargadas ${r.importadas} operaciones de ejemplo (fabricadas).` : "Los ejemplos ya estaban cargados.", "ok");
  return r;
}
$("#btn-ejemplos").addEventListener("click", async () => {
  if (!await confirmar({ titulo: "¿Cargar las operaciones de ejemplo?", texto: "Se agregarán 128 operaciones fabricadas (simuladas en MXN, reales en MXN y USD) para explorar la app. Si ya estaban, no se duplican.", boton: "Cargar ejemplos", emoji: "📦" })) return;
  await cargarEjemplos(); cargarAjustes();
});
$("#btn-demo").addEventListener("click", async () => {
  if (!await confirmar({ titulo: "¿Cargar 200 operaciones sintéticas?", texto: "Son operaciones SIMULADAS en MXN con sesgos plantados, pensadas para probar el detector. Cada vez que las cargas se agregan otras 200.", boton: "Cargar", emoji: "🧪" })) return;
  const btn = $("#btn-demo"); btn.classList.add("cargando");
  try {
    const r = await api("/api/demo", { method: "POST" });
    ponerFiltro("simulada", "MXN");
    toast(`Cargadas ${r.cargadas} operaciones simuladas. Revisa el Panel y Mi conducta.`, "ok"); cargarAjustes();
  } finally { btn.classList.remove("cargando"); }
});
$("#btn-borrar").addEventListener("click", async () => {
  if (!await confirmar({ titulo: "¿Borrar todos tus datos?", texto: "Se borran TODAS tus operaciones, notas e historial de IA. Exporta un CSV antes si quieres conservarlas. Esto no se puede deshacer.", boton: "Borrar todo", peligro: true, emoji: "🗑️" })) return;
  await api("/api/todo", { method: "DELETE" }); toast("Datos borrados."); ultimasOps = []; cargarResumen();
});
$("#btn-atajos").addEventListener("click", () => $("#dlg-atajos").showModal());
$("#btn-recorrido").addEventListener("click", () => abrirBienvenida());

// Instalar como app (PWA)
let promptInstalar = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalar = e; $("#btn-instalar").hidden = false; });
$("#btn-instalar").addEventListener("click", async () => { if (!promptInstalar) return; promptInstalar.prompt(); await promptInstalar.userChoice; promptInstalar = null; $("#btn-instalar").hidden = true; });
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

// ======================================================================= BIENVENIDA (3 pasos)
let pasoBv = 0;
function abrirBienvenida() {
  const d = $("#dlg-bienvenida"); if (d.open) return;
  pasoBv = 0; $("#bv-moneda").value = filtro().moneda; mostrarPaso(); d.showModal();
}
function mostrarPaso() {
  $$("#dlg-bienvenida .paso").forEach((p) => { p.hidden = Number(p.dataset.paso) !== pasoBv; });
  $$("#pasos-puntos i").forEach((i, n) => i.classList.toggle("hecho", n <= pasoBv));
  $("#bv-atras").hidden = pasoBv === 0;
  $("#bv-sig").textContent = pasoBv === 2 ? "Ir a Inicio" : "Siguiente";
}
function terminarBienvenida() { guardar("bienvenida", "1"); $("#dlg-bienvenida").close(); }
$("#bv-saltar").addEventListener("click", terminarBienvenida);
$("#bv-atras").addEventListener("click", () => { pasoBv = Math.max(0, pasoBv - 1); mostrarPaso(); });
$("#bv-sig").addEventListener("click", async () => {
  if (pasoBv === 0 && $("#bv-riesgo").value !== "") {
    const a = await api("/api/ajustes"); delete a.id;
    a["riesgo_max_" + $("#bv-moneda").value.toLowerCase()] = Number($("#bv-riesgo").value);
    await api("/api/ajustes", { method: "PUT", body: JSON.stringify(a) });
    toast(`Riesgo máximo guardado: ${dinero(Number($("#bv-riesgo").value))} ${$("#bv-moneda").value}.`, "ok");
  }
  if (pasoBv === 2) { terminarBienvenida(); abrir("inicio"); return; }
  pasoBv++; mostrarPaso();
});
$("#dlg-bienvenida").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-bv]"); if (!b) return;
  if (b.dataset.bv === "registrar") { terminarBienvenida(); abrir("registrar"); setTimeout(() => form.ticker.focus(), 250); }
  if (b.dataset.bv === "ejemplos") { b.classList.add("cargando"); await cargarEjemplos(); b.classList.remove("cargando"); pasoBv = 2; mostrarPaso(); }
});

// ======================================================================= ATAJOS DE TECLADO
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) { if (e.key === "Escape") e.target.blur(); return; }
  const k = e.key;
  if (k === "n" || k === "N") { e.preventDefault(); abrir("registrar"); setTimeout(() => form.ticker.focus(), 200); }
  else if (k === "/") {
    e.preventDefault();
    if (pestanaActual() === "noticias") $("#buscar-glosario").focus();
    else { if (pestanaActual() !== "diario") abrir("diario"); setTimeout(() => $("#buscar-op").focus(), 200); }
  }
  else if (k >= "1" && k <= "7") abrir(ORDEN_PESTANAS[Number(k) - 1]);
  else if (k === "t" || k === "T") aplicarTema(temaEfectivo() === "dark" ? "light" : "dark");
  else if (k === "?") $("#dlg-atajos").showModal();
});

// ======================================================================= CONFETI (discreto)
function confeti() {
  if (sinMovimiento) return;
  const c = $("#confeti"), ctx = c.getContext("2d");
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio; ctx.scale(devicePixelRatio, devicePixelRatio);
  const colores = [token("--marca"), token("--marca-2"), token("--marca-3"), token("--gana-marca"), "#f59e0b"];
  const piezas = Array.from({ length: 90 }, () => ({
    x: innerWidth / 2 + (Math.random() - .5) * 200, y: innerHeight * .35, vx: (Math.random() - .5) * 9, vy: -Math.random() * 9 - 3,
    r: Math.random() * Math.PI, vr: (Math.random() - .5) * .3, w: 6 + Math.random() * 5, h: 3 + Math.random() * 4, c: colores[Math.floor(Math.random() * colores.length)],
  }));
  const inicio = performance.now();
  (function cuadro(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const vida = (t - inicio) / 1800;
    piezas.forEach((p) => { p.vy += .25; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - vida); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore(); });
    if (vida < 1) requestAnimationFrame(cuadro); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(inicio);
}

// ======================================================================= INICIO DE LA APP
(async function () {
  const tema = leer("tema"); elegir($("#seg-tema"), tema === "light" || tema === "dark" ? tema : "system");
  const s = await api("/api/estado");
  if (s.monedas?.length) monedas = s.monedas;
  emociones = s.emociones || [];
  pintarMonedas(); pintarEmociones();
  try { const f = JSON.parse(leer("filtro") || "null"); if (f) { tipoActual = f.tipo; $("#f-moneda").value = f.moneda; } } catch (e) {}
  if (!$("#f-moneda").value) $("#f-moneda").value = "MXN";
  elegir($("#seg-tipo"), tipoActual);
  if (leer("sin-consejos")) $("#banner-tip").hidden = true;
  mostrarConsejo(); setInterval(mostrarConsejo, 9000);
  limpiarForm();
  const guardada = leer("pestana");
  abrir(ORDEN_PESTANAS.includes(guardada) ? guardada : "inicio");
  document.fonts?.ready.then(() => { moverIndicador(); moverPastilla($("#seg-tipo")); moverPastilla($("#seg-tema")); });
})();
