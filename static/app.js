// Interfaz del Diario de Trading. JavaScript simple, sin frameworks.
const $ = (s) => document.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dinero = (v) => (v === null || v === undefined) ? "—" : Number(v).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v) => (v === null || v === undefined) ? "—" : (v * 100).toFixed(1) + "%";
const filtro = () => ({ tipo: $("#f-tipo").value, moneda: $("#f-moneda").value });
let graficas = {};

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

// ---------- Pestañas
document.querySelectorAll("#pestanas button").forEach((b) => b.addEventListener("click", () => abrir(b.dataset.p)));
function abrir(p) {
  document.querySelectorAll("#pestanas button").forEach((b) => b.classList.toggle("activa", b.dataset.p === p));
  document.querySelectorAll(".pestana").forEach((s) => s.classList.toggle("activa", s.id === "p-" + p));
  try { localStorage.setItem("pestana", p); } catch (e) {}
  refrescar(p);
}
function refrescar(p) {
  if (p === "diario") cargarDiario();
  if (p === "panel") cargarPanel();
  if (p === "conducta") cargarPatrones();
  if (p === "noticias") cargarGlosario();
  if (p === "ajustes") cargarAjustes();
  cargarPausa();
}
["#f-tipo", "#f-moneda"].forEach((s) => $(s).addEventListener("change", () => {
  try { localStorage.setItem("filtro", JSON.stringify(filtro())); } catch (e) {}
  refrescar(document.querySelector("#pestanas .activa").dataset.p);
}));

// ---------- Registrar / editar (RF1, RF2)
const form = $("#form-op");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(form));
  const id = d.id; delete d.id;
  for (const k of ["cantidad", "comision", "entrada_precio", "salida_precio", "stop_inicial", "stop_final", "objetivo"]) d[k] = d[k] === "" ? null : Number(d[k]);
  for (const k of ["salida_fecha", "emocion", "motivo_entrada"]) if (d[k] === "") d[k] = null;
  if (d.comision === null) d.comision = 0;
  try {
    if (id) await api(`/api/operaciones/${id}`, { method: "PUT", body: JSON.stringify(d) });
    else await api("/api/operaciones", { method: "POST", body: JSON.stringify(d) });
    mensaje($("#msg-form"), id ? "Operación actualizada." : "Operación guardada.", "ok");
    limpiarForm(d);
  } catch (err) { mensaje($("#msg-form"), err.message, "error"); }
});
function limpiarForm(previo) {
  form.reset(); form.id.value = "";
  if (previo) { form.tipo.value = previo.tipo; form.moneda.value = previo.moneda; }
  $("#titulo-form").textContent = "Nueva operación"; $("#cancelar-edicion").hidden = true;
}
$("#cancelar-edicion").addEventListener("click", () => limpiarForm());
function editar(op) {
  abrir("registrar");
  for (const [k, v] of Object.entries(op)) if (form[k] && !k.startsWith("_")) form[k].value = v === null ? "" : (k.endsWith("_fecha") ? v.replace(" ", "T") : v);
  form.id.value = op.id;
  $("#titulo-form").textContent = `Editar operación #${op.id}`; $("#cancelar-edicion").hidden = false;
}

// ---------- Diario
let ultimasOps = [];
async function cargarDiario(resaltar = []) {
  const { tipo, moneda } = filtro();
  ultimasOps = await api(`/api/operaciones?tipo=${tipo}&moneda=${moneda}`);
  const filas = ultimasOps.map((op) => {
    const res = op._resultado;
    const clase = res > 0 ? "gana" : res < 0 ? "pierde" : "";
    return `<tr id="op-${op.id}" class="${resaltar.includes(op.id) ? "resaltada" : ""}">
      <td>${op.id}</td><td>${esc(op.entrada_fecha)}</td><td>${esc(op.ticker)}</td><td>${op.direccion === "compra" ? "Compra" : "Corto"}</td>
      <td class="num">${op.cantidad}</td><td class="num ${clase}">${res === null ? "abierta" : dinero(res)}</td>
      <td class="num">${op._r === null ? (op.stop_inicial === null ? "sin stop" : "—") : op._r.toFixed(2)}</td>
      <td>${esc(op.emocion || "")}</td>
      <td><button data-a="editar" data-id="${op.id}">Editar</button> <button data-a="notas" data-id="${op.id}">Notas</button> <button data-a="borrar" data-id="${op.id}">✕</button></td></tr>`;
  });
  $("#tabla-ops tbody").innerHTML = filas.join("") || `<tr><td colspan="9">Aún no hay operaciones ${tipo === "real" ? "reales" : "simuladas"} en ${moneda}.</td></tr>`;
  if (resaltar.length) document.getElementById("op-" + resaltar[0])?.scrollIntoView({ block: "center" });
}
$("#tabla-ops").addEventListener("click", async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const op = ultimasOps.find((o) => o.id == b.dataset.id);
  if (b.dataset.a === "editar") editar(op);
  if (b.dataset.a === "borrar" && confirm(`¿Borrar la operación #${op.id}?`)) { await api(`/api/operaciones/${op.id}`, { method: "DELETE" }); cargarDiario(); }
  if (b.dataset.a === "notas") abrirNotas(op);
});
let notaOp = null;
async function abrirNotas(op) {
  notaOp = op;
  $("#notas-titulo").textContent = `Notas · #${op.id} ${op.ticker}`;
  const notas = await api(`/api/operaciones/${op.id}/notas`);
  $("#lista-notas").innerHTML = notas.map((n) => `<li><small>${esc(n.fecha)}</small> ${esc(n.texto)}</li>`).join("") || "<li>Sin notas.</li>";
  $("#dlg-notas").showModal();
}
$("#guardar-nota").addEventListener("click", async () => {
  const texto = $("#nota-texto").value.trim(); if (!texto) return;
  await api(`/api/operaciones/${notaOp.id}/notas`, { method: "POST", body: JSON.stringify({ texto }) });
  $("#nota-texto").value = ""; abrirNotas(notaOp);
});
$("#cerrar-notas").addEventListener("click", () => $("#dlg-notas").close());

// ---------- Panel (RF3)
async function cargarPanel() {
  const { tipo, moneda } = filtro();
  const { estadisticas: e } = await api(`/api/estadisticas?tipo=${tipo}&moneda=${moneda}`);
  const fb = typeof e.factor_beneficio === "string" ? e.factor_beneficio : (e.factor_beneficio === null ? "—" : e.factor_beneficio.toFixed(2));
  const kpis = [
    ["Operaciones cerradas", `${e.cerradas}${e.abiertas ? ` (+${e.abiertas} abiertas)` : ""}`],
    ["Tasa de acierto", pct(e.tasa_acierto) + (e.neutras ? ` · ${e.neutras} neutras` : "")],
    ["Ganancia promedio", dinero(e.ganancia_promedio)],
    ["Pérdida promedio", dinero(e.perdida_promedio)],
    ["Factor de beneficio", fb],
    ["Caída máxima", e.caida_maxima === null ? "—" : dinero(e.caida_maxima)],
    ["Resultado total", dinero(e.resultado_total)],
    ["R promedio", e.r_promedio === null ? "—" : e.r_promedio.toFixed(2)],
    ["Sin stop", e.sin_stop],
  ];
  $("#kpis").innerHTML = kpis.map(([t, v]) => `<div class="kpi"><div class="t">${t}</div><div class="v">${esc(v)}</div></div>`).join("");
  if (!window.Chart) { $(".graficas").innerHTML = "<p class='nota'>No se pudo cargar Chart.js (¿sin internet?). Las cifras de arriba siguen siendo correctas.</p>"; return; }
  const color = getComputedStyle(document.documentElement);
  const gana = color.getPropertyValue("--gana").trim(), pierde = color.getPropertyValue("--pierde").trim(), prim = color.getPropertyValue("--primario").trim();
  const barras = (obj) => ({ labels: Object.keys(obj), datasets: [{ data: Object.values(obj), backgroundColor: Object.values(obj).map((v) => v >= 0 ? gana : pierde) }] });
  const opc = { plugins: { legend: { display: false } }, responsive: true };
  dibujar("g-curva", "line", { labels: e.curva.map((p) => p.fecha.slice(0, 10)), datasets: [{ data: e.curva.map((p) => p.capital), borderColor: prim, pointRadius: 0, tension: 0.1 }] }, opc);
  dibujar("g-activo", "bar", barras(e.por_activo), opc);
  dibujar("g-dia", "bar", barras(e.por_dia), opc);
}
function dibujar(id, tipo, data, options) {
  graficas[id]?.destroy();
  graficas[id] = new Chart(document.getElementById(id), { type: tipo, data, options });
}

// ---------- Pausa sugerida
async function cargarPausa() {
  const { tipo, moneda } = filtro();
  try {
    const { pausa } = await api(`/api/estadisticas?tipo=${tipo}&moneda=${moneda}`);
    $("#pausa").hidden = !pausa; $("#pausa").textContent = pausa ? "🌿 " + pausa : "";
  } catch (e) {}
}

// ---------- Conducta (RF4)
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
  $("#hallazgos").innerHTML = "";
  if (!d.suficientes) {
    $("#patrones").innerHTML = `<div class="patron">Datos insuficientes: se necesitan al menos ${d.minimo} operaciones cerradas para buscar patrones (tienes ${d.cerradas}).</div>`;
    $("#btn-ia").disabled = true; return;
  }
  $("#btn-ia").disabled = d.patrones.length === 0;
  $("#patrones").innerHTML = d.patrones.length ? d.patrones.map((p) => `
    <div class="patron"><h3>${esc(p.nombre)}</h3>
      <div class="meta">${p.veces} veces de ${p.oportunidades} posibles (${pct(p.proporcion)}) · ej.: ${esc(p.casos[0].detalle)}</div>
      ${citas(p.ids.slice(0, 15))}${p.ids.length > 15 ? `<small>…y ${p.ids.length - 15} más</small>` : ""}</div>`).join("")
    : `<div class="patron">No se detectaron patrones con los umbrales actuales. ¡Vas siguiendo tu plan!</div>`;
}
$("#btn-ia").addEventListener("click", async () => {
  mensaje($("#msg-ia"), "Analizando…");
  try {
    const r = await api("/api/patrones/explicar", { method: "POST", body: JSON.stringify(filtro()) });
    if (!r.disponible) { mensaje($("#msg-ia"), r.mensaje, "error"); return; }
    mensaje($("#msg-ia"), r.de_cache ? "Respuesta guardada (no se volvió a llamar a la IA)." : (r.mensaje || ""), "ok");
    $("#hallazgos").innerHTML = r.hallazgos.map((h) => `
      <div class="patron"><h3>🤖 ${esc(h.nombre)}</h3><p>${esc(h.explicacion)}</p>
      <p class="pregunta">${esc(h.pregunta_reflexion)}</p>${citas(h.operaciones_citadas)}</div>`).join("");
  } catch (e) { mensaje($("#msg-ia"), e.message, "error"); }
});

// ---------- Noticias (RF5) y glosario
$("#btn-noticia").addEventListener("click", async () => {
  const texto = $("#noticia-texto").value;
  mensaje($("#msg-noticia"), "Explicando…"); $("#noticia-resultado").innerHTML = "";
  try {
    const r = await api("/api/noticias", { method: "POST", body: JSON.stringify({ texto }) });
    if (!r.disponible || r.redirigido) { mensaje($("#msg-noticia"), r.mensaje, r.redirigido ? "" : "error"); return; }
    mensaje($("#msg-noticia"), r.de_cache ? "Ya habías explicado este texto: respuesta guardada." : "", "ok");
    $("#noticia-resultado").innerHTML = `<div class="patron"><h3>Resumen</h3><ul>${r.resumen.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
      <h3>Términos</h3><dl>${r.terminos.map((t) => `<dt><b>${esc(t.termino)}</b></dt><dd>${esc(t.explicacion)}</dd>`).join("")}</dl>
      <h3>Qué suelen observar los analistas</h3><p>${esc(r.que_observan_analistas)}</p></div>`;
    cargarGlosario();
  } catch (e) { mensaje($("#msg-noticia"), e.message, "error"); }
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
  $("#glosario").innerHTML = Object.keys(glosario).sort((a, b) => a.localeCompare(b, "es"))
    .filter((k) => !q || k.toLowerCase().includes(q) || glosario[k].toLowerCase().includes(q))
    .map((k) => `<dt>${esc(k)}</dt><dd>${esc(glosario[k])}</dd>`).join("");
}
$("#buscar-glosario").addEventListener("input", pintarGlosario);

// ---------- Ajustes y datos (RF6)
async function cargarAjustes() {
  const a = await api("/api/ajustes"); const f = $("#form-ajustes");
  f.moneda.value = a.moneda; f.riesgo_max_mxn.value = a.riesgo_max_mxn ?? ""; f.riesgo_max_usd.value = a.riesgo_max_usd ?? "";
  f.reglas_plan.value = a.reglas_plan; f.enviar_motivos_a_ia.checked = a.enviar_motivos_a_ia;
  const s = await api("/api/estado");
  $("#estado-ia").textContent = s.ia_configurada
    ? `IA activa (${s.modelo}) · ${s.llamadas_hoy} de ${s.limite_diario} llamadas usadas hoy.`
    : "IA sin configurar: agrega ANTHROPIC_API_KEY en el archivo .env. El diario y el panel funcionan igual.";
}
$("#form-ajustes").addEventListener("submit", async (e) => {
  e.preventDefault(); const f = e.target;
  const num = (v) => v === "" ? null : Number(v);
  try {
    await api("/api/ajustes", { method: "PUT", body: JSON.stringify({ moneda: f.moneda.value, riesgo_max_mxn: num(f.riesgo_max_mxn.value),
      riesgo_max_usd: num(f.riesgo_max_usd.value), reglas_plan: f.reglas_plan.value, enviar_motivos_a_ia: f.enviar_motivos_a_ia.checked }) });
    mensaje($("#msg-ajustes"), "Plan guardado.", "ok");
  } catch (err) { mensaje($("#msg-ajustes"), err.message, "error"); }
});
$("#csv-archivo").addEventListener("change", async (e) => {
  const archivo = e.target.files[0]; if (!archivo) return;
  const r = await api("/api/csv/importar", { method: "POST", body: JSON.stringify({ contenido: await archivo.text() }) });
  mensaje($("#msg-datos"), `Importadas: ${r.importadas} · Duplicadas saltadas: ${r.duplicadas}` + (r.errores.length ? `\nErrores:\n${r.errores.join("\n")}` : ""), r.errores.length ? "error" : "ok");
  e.target.value = "";
});
$("#btn-demo").addEventListener("click", async () => {
  if (!confirm("Se agregarán 200 operaciones SIMULADAS en MXN con sesgos plantados. ¿Continuar?")) return;
  const r = await api("/api/demo", { method: "POST" });
  $("#f-tipo").value = "simulada"; $("#f-moneda").value = "MXN";
  mensaje($("#msg-datos"), `Cargadas ${r.cargadas} operaciones simuladas. Revisa el Panel y Mi conducta.`, "ok"); cargarAjustes();
});
$("#btn-borrar").addEventListener("click", async () => {
  if (!confirm("Esto borra TODAS tus operaciones, notas e historial de IA. Exporta un CSV antes si quieres conservarlas. ¿Borrar todo?")) return;
  await api("/api/todo", { method: "DELETE" }); mensaje($("#msg-datos"), "Datos borrados.", "ok");
});

// ---------- Inicio
(async function () {
  const s = await api("/api/estado");
  $("#sel-emocion").innerHTML += s.emociones.map((e) => `<option>${esc(e)}</option>`).join("");
  try {
    const f = JSON.parse(localStorage.getItem("filtro") || "null"); if (f) { $("#f-tipo").value = f.tipo; $("#f-moneda").value = f.moneda; }
    abrir(localStorage.getItem("pestana") || "registrar");
  } catch (e) { abrir("registrar"); }
})();
