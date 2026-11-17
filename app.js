'use strict';

const CURSOS = [
  'Back-End Java 1',
  'Back-End Java 2',
  'Bases de Datos SQL',
  'Desarrollo Web Front-End I',
  'Desarrollo Web Front-End II',
  'Introducción a la Programación',
  'Lógica de Programación',
  'Nuevas Tecnologías',

];

let sb = null;

// Respaldo SOLO para desarrollo local.
function loadLocalConfig() {
  const h = location.hostname;
  const esLocal = location.protocol === 'file:' || h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  if (!esLocal) return Promise.resolve(null);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'config.local.js';
    s.onload = () => resolve(window.LOCAL_SUPABASE_CONFIG || null);
    s.onerror = () => resolve(null);
    document.head.appendChild(s);
  });
}

async function initSupabase() {
  let cfg = null;
  let motivo = '';
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    cfg = await res.json();
  } catch (err) {
    motivo = err.message;
    cfg = await loadLocalConfig();   
  }
  if (cfg && cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && !/TU_SUPABASE/.test(cfg.SUPABASE_URL + cfg.SUPABASE_ANON_KEY)) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return true;
  }
  setMsg($('s-msg'), 'No se pudo cargar la configuración de la plataforma. Faltan las variables de entorno SUPABASE_URL y SUPABASE_ANON_KEY en Vercel. En local, crea el archivo config.local.js (copia config.local.example.js) o usa "vercel dev". Detalle: ' + (motivo || 'sin configuración'), 'err');
  $('form-student').querySelectorAll('input,select,button').forEach((el) => { el.disabled = true; });
  return false;
}

/* =====================================================================
   UTILIDADES
   ===================================================================== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function b64decode(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const hhmmss = () => new Date().toTimeString().slice(0, 8);
function setMsg(el, text, type = '') {
  el.hidden = !text;
  el.className = 'msg ' + type;
  el.textContent = text || '';
}
function openModal(title, html) {
  $('mg-title').textContent = title;
  $('mg-body').innerHTML = html;
  $('modal-generic').hidden = false;
}
const POLITICA_HTML = `
<p>En cumplimiento de lo dispuesto en la Ley 1581 de 2012 y el Decreto 1377 de 2013 sobre Protección de Datos Personales en Colombia, informamos a los estudiantes las condiciones bajo las cuales se recolectan y tratan sus datos en esta plataforma de evaluación.</p>
<h4>1. Datos recolectados</h4>
<p>La plataforma solicita únicamente el nombre completo y el número de documento de identidad, además de registrar las respuestas, calificaciones e indicadores técnicos de integridad durante la presentación de la prueba.</p>
<h4>2. Finalidad exclusiva</h4>
<p>Los datos personales suministrados serán utilizados única y exclusivamente para fines académicos, específicamente para:</p>
<ul><li>Identificar al estudiante durante la presentación de la evaluación.</li><li>Controlar el número de intentos permitidos y calcular las calificaciones obtenidas.</li><li>Consolidar el registro interno de notas del curso por parte del docente responsable.</li></ul>
<h4>3. Confidencialidad y no divulgación</h4>
<p>Los datos almacenados tienen carácter estrictamente confidencial. No serán vendidos, cedidos, transferidos ni compartidos con terceros, empresas externas ni otros estudiantes, y se encuentran protegidos mediante controles de acceso restringido en base de datos.</p>
<h4>4. Derechos del titular</h4>
<p>Como titular de los datos, el estudiante tiene derecho a conocer, actualizar, rectificar o solicitar la supresión de su información una vez finalizado el proceso de calificación del módulo, dirigiéndose directamente al docente encargado de la asignatura.</p>`;
document.querySelectorAll('[data-privacy]').forEach((b) => {
  b.onclick = () => openModal('Política de tratamiento y protección de datos personales', POLITICA_HTML);
});
$('mg-close').onclick = () => { $('modal-generic').hidden = true; };
const fmtNota = (n) => (n === null || n === undefined ? '—' : Number(n).toFixed(1));
function fillSelect(sel, options, firstLabel) {
  sel.innerHTML = (firstLabel ? `<option value="">${esc(firstLabel)}</option>` : '') +
    options.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
}

/* =====================================================================
   NAVEGACIÓN ESTUDIANTE / DOCENTE
   ===================================================================== */
let isAdmin = false;

function mostrarPanelDocente() {
  isAdmin = true;
  $('modal-login').hidden = true;
  $('view-student').hidden = true;
  $('view-admin').hidden = false;
  $('btn-admin').textContent = 'Cerrar sesión';
  initAdmin();
}
function ocultarPanelDocente() {
  isAdmin = false;
  $('view-admin').hidden = true;
  $('view-student').hidden = false;
  $('btn-admin').textContent = 'Acceso Docente';
  loadActiveEvaluations();
}

// Inicia sesión con Supabase Auth; desde aquí el cliente envía el JWT y Postgres te reconoce como 'authenticated'
async function loginDocente(email, password) {
  if (!sb) { setMsg($('login-msg'), 'La configuración de Supabase no está cargada.', 'err'); return false; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    setMsg($('login-msg'), 'Credenciales incorrectas: ' + error.message, 'err');
    return false;
  }
  mostrarPanelDocente();
  return true;
}
async function logoutDocente() {
  await sb.auth.signOut();
  ocultarPanelDocente();
}

$('btn-admin').onclick = () => {
  if (isAdmin) { logoutDocente(); return; }
  $('form-login-docente').reset();
  setMsg($('login-msg'), '');
  $('modal-login').hidden = false;
  $('docente-email').focus();
};
$('login-cancel').onclick = () => { $('modal-login').hidden = true; };
$('form-login-docente').onsubmit = async (e) => {
  e.preventDefault();
  const btn = $('login-submit');
  btn.disabled = true;
  const ok = await loginDocente($('docente-email').value.trim(), $('docente-password').value);
  btn.disabled = false;
  if (!ok) $('docente-password').value = '';
};

/* =====================================================================
   ADMIN
   ===================================================================== */
const genCodigo = () => 'EVAL-' + (Math.floor(Math.random() * 9000) + 1000);

function initAdmin() {
  $('a-codigo').value = genCodigo();
  fillSelect($('a-curso'), [...CURSOS, 'Otro…']);
  $('a-curso').onchange = () => { $('a-otro-wrap').hidden = $('a-curso').value !== 'Otro…'; };
  $('a-otro-wrap').hidden = true;
  showTab('t1');
}

document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });
function showTab(id) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tabpane').forEach((p) => { p.hidden = p.id !== id; });
  if (id === 't2') loadEvalTable();
  if (id === 't3') initReport();
}

/* ---- Pestaña 1: cargar evaluación ---- */
$('form-upload').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('a-msg');
  setMsg(msg, '');
  try {
    const file = $('a-file').files[0];
    if (!file) throw new Error('Selecciona un archivo .json.');
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.preguntas) || data.preguntas.length === 0) throw new Error('El JSON no contiene un arreglo "preguntas".');
    data.preguntas.forEach((q, i) => {
      if (!q.id || !q.modulo || !q.enunciado || !Array.isArray(q.opciones) || !q.respuestaCodificada) {
        throw new Error(`La pregunta #${i + 1} está incompleta (id, modulo, enunciado, opciones, respuestaCodificada).`);
      }
      try {
        if (!b64decode(q.respuestaCodificada).length) throw new Error('vacío');
      } catch (_) {
        throw new Error(`La pregunta ${q.id} (#${i + 1}) tiene "respuestaCodificada" con Base64 inválido.`);
      }
    });
    const codigo = $('a-codigo').value.trim().toUpperCase();
    let curso = $('a-curso').value;
    if (curso === 'Otro…') curso = $('a-otro').value.trim();
    if (!codigo || !curso) throw new Error('Completa el código y el curso.');

    const row = {
      codigo,
      titulo: data.tituloEvaluacion || codigo,
      curso,
      duracion_minutos: Number(data.duracionMinutos) || 30,
      preguntas_por_intento: Math.min(Number(data.preguntasPorIntento) || data.preguntas.length, data.preguntas.length),
      intentos_permitidos: Number(data.intentosPermitidos) || 2,
      activa: $('a-activa').checked,
      preguntas: data.preguntas
    };
    const { error } = await sb.from('evaluaciones').insert(row);
    if (error) throw new Error(error.code === '23505' ? 'Ya existe una evaluación con ese código.' : error.message);
    setMsg(msg, `Evaluación guardada. Código: ${codigo} (${row.activa ? 'activa' : 'inactiva'}, ${data.preguntas.length} preguntas).`, 'ok');
    $('a-codigo').value = genCodigo();
    $('a-file').value = '';
  } catch (err) {
    setMsg(msg, 'No se pudo guardar: ' + err.message, 'err');
  }
};

/* ---- Pestaña 2: gestión ---- */
async function loadEvalTable() {
  const tb = $('tb-evals');
  tb.innerHTML = '<tr><td colspan="7">Cargando…</td></tr>';
  const { data, error } = await sb.from('evaluaciones').select('*').order('created_at', { ascending: false });
  if (error) { tb.innerHTML = `<tr><td colspan="7">${esc(error.message)}</td></tr>`; return; }
  if (!data.length) { tb.innerHTML = '<tr><td colspan="7">Aún no hay evaluaciones. Carga la primera en la pestaña anterior.</td></tr>'; return; }
  tb.innerHTML = data.map((ev) => `
    <tr>
      <td>${esc(ev.codigo)}</td><td>${esc(ev.titulo)}</td><td>${esc(ev.curso)}</td>
      <td>${Array.isArray(ev.preguntas) ? ev.preguntas.length : 0}</td>
      <td><span class="badge ${ev.activa ? 'on' : 'off'}">${ev.activa ? 'Activa' : 'Inactiva'}</span></td>
      <td><label class="switch"><input type="checkbox" data-id="${esc(ev.id)}" ${ev.activa ? 'checked' : ''} aria-label="Activar ${esc(ev.codigo)}"><span class="slider"></span></label></td>
      <td><button class="btn danger sm" data-del="${esc(ev.id)}" data-code="${esc(ev.codigo)}" type="button">Eliminar</button></td>
    </tr>`).join('');
}
$('tb-evals').onchange = async (e) => {
  const input = e.target.closest('input[data-id]');
  if (!input) return;
  const nuevo = input.checked;
  const { error } = await sb.from('evaluaciones').update({ activa: nuevo }).eq('id', input.dataset.id);
  if (error) { input.checked = !nuevo; alert('No se pudo actualizar: ' + error.message); return; }
  const badge = input.closest('tr').querySelector('.badge');
  badge.className = 'badge ' + (nuevo ? 'on' : 'off');
  badge.textContent = nuevo ? 'Activa' : 'Inactiva';
};
$('tb-evals').onclick = async (e) => {
  const btn = e.target.closest('button[data-del]');
  if (!btn) return;
  if (!confirm(`¿Eliminar la evaluación ${btn.dataset.code}? Esta acción no se puede deshacer.`)) return;
  const { error } = await sb.from('evaluaciones').delete().eq('id', btn.dataset.del);
  if (error) { alert('No se pudo eliminar: ' + error.message); return; }
  loadEvalTable();
};

/* ---- Pestaña 3: reporte ---- */
let reportRows = [];

async function initReport() {
  const { data } = await sb.from('resultados').select('curso,evaluacion_codigo');
  const cursos = [...new Set((data || []).map((r) => r.curso).filter(Boolean))].sort();
  const codigos = [...new Set((data || []).map((r) => r.evaluacion_codigo).filter(Boolean))].sort();
  fillSelect($('r-curso'), cursos, 'Todos los cursos');
  fillSelect($('r-codigo'), codigos, 'Todos los códigos');
  loadReport();
}
$('r-curso').onchange = loadReport;
$('r-codigo').onchange = loadReport;
$('btn-refresh').onclick = initReport;

async function loadReport() {
  const tb = $('tb-results');
  tb.innerHTML = '<tr><td colspan="9">Cargando…</td></tr>';
  let q = sb.from('resultados').select('*').order('updated_at', { ascending: false });
  if ($('r-curso').value) q = q.eq('curso', $('r-curso').value);
  if ($('r-codigo').value) q = q.eq('evaluacion_codigo', $('r-codigo').value);
  const { data, error } = await q;
  if (error) { tb.innerHTML = `<tr><td colspan="9">${esc(error.message)}</td></tr>`; return; }
  reportRows = data;
  if (!data.length) { tb.innerHTML = '<tr><td colspan="9">No hay resultados con estos filtros.</td></tr>'; return; }
  tb.innerHTML = data.map((r, i) => `
    <tr>
      <td>${esc(r.curso)}</td><td>${esc(r.evaluacion_codigo)}</td><td>${esc(r.estudiante_documento)}</td><td>${esc(r.estudiante_nombre)}</td>
      <td>${r.intentos_realizados}</td><td>${fmtNota(r.ultimo_puntaje)}</td><td><strong>${fmtNota(r.mejor_puntaje)}</strong></td>
      <td><button class="btn sm alert-btn ${(r.infracciones_count || 0) > 0 ? 'has-alerts' : ''}" data-i="${i}" type="button" aria-label="Ver detalle de ${r.infracciones_count || 0} alertas" title="Ver detalle de alertas">${r.infracciones_count || 0}</button></td>
      <td><button class="btn danger sm" data-delres="${i}" type="button">Eliminar</button></td>
    </tr>`).join('');
}
$('tb-results').onclick = async (e) => {
  const del = e.target.closest('button[data-delres]');
  if (del) {
    const r = reportRows[Number(del.dataset.delres)];
    if (!r) return;
    if (!confirm(`¿Eliminar el resultado de ${r.estudiante_nombre} (documento ${r.estudiante_documento}) en ${r.evaluacion_codigo}?\n\nSe borrarán sus notas e infracciones y podrá presentar la evaluación desde cero. Esta acción no se puede deshacer.`)) return;
    del.disabled = true;
    const { data, error } = await sb.from('resultados').delete().eq('id', r.id).select();
    if (error) { alert('No se pudo eliminar: ' + error.message); del.disabled = false; return; }
    if (!data || !data.length) { alert('No se eliminó ninguna fila. Verifica que tu sesión docente esté activa y que exista la política de borrado para el rol authenticated.'); del.disabled = false; return; }
    loadReport();
    return;
  }
  const b = e.target.closest('button[data-i]');
  if (!b) return;
  const r = reportRows[Number(b.dataset.i)];
  const log = Array.isArray(r.log_infracciones) ? r.log_infracciones : [];
  openModal(`Alertas de seguridad — ${r.estudiante_nombre}`,
    log.length ? `<ul class="log-list">${log.map((l) => `<li>${l.intento ? `Intento ${esc(l.intento)} · ` : ''}${esc(l.hora)} — ${esc(l.tipo)}</li>`).join('')}</ul>`
      : '<p>Sin infracciones registradas.</p>');
};
$('btn-csv').onclick = () => {
  if (!reportRows.length) { alert('No hay datos para exportar.'); return; }
  const head = ['Curso', 'Código', 'Documento', 'Nombre', 'Intentos', 'Última nota', 'Mejor nota', 'Infracciones'];
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [head.map(cell).join(',')].concat(reportRows.map((r) =>
    [r.curso, r.evaluacion_codigo, r.estudiante_documento, r.estudiante_nombre, r.intentos_realizados,
    fmtNota(r.ultimo_puntaje), fmtNota(r.mejor_puntaje), r.infracciones_count || 0].map(cell).join(',')));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `calificaciones_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/* =====================================================================
   ESTUDIANTE — PASO A: selección y validación de intentos
   ===================================================================== */
let activeEvals = [];
const S = { ev: null, prev: null, nombre: '', doc: '', intento: 1, questions: [], active: false, submitting: false, log: [], timer: null, endAt: 0 };

async function loadActiveEvaluations() {
  const { data, error } = await sb.from('evaluaciones')
    .select('id,codigo,titulo,curso,duracion_minutos,preguntas_por_intento,intentos_permitidos')
    .eq('activa', true).order('created_at', { ascending: false });
  if (error) { setMsg($('s-msg'), 'No se pudieron cargar las evaluaciones: ' + error.message, 'err'); return; }
  activeEvals = data;
  const cursos = [...new Set(data.map((e) => e.curso))].sort();
  fillSelect($('s-curso'), cursos, 'Todos los cursos');
  refreshEvalSelect();
  if (!data.length) setMsg($('s-msg'), 'No hay evaluaciones activas en este momento.');
}
function refreshEvalSelect() {
  const c = $('s-curso').value;
  const list = activeEvals.filter((e) => !c || e.curso === c);
  $('s-eval').innerHTML = '<option value="">Selecciona una evaluación</option>' +
    list.map((e) => `<option value="${esc(e.codigo)}">${esc(e.titulo)} (${esc(e.codigo)})</option>`).join('');
}
$('s-curso').onchange = refreshEvalSelect;

$('form-student').onsubmit = async (e) => {
  e.preventDefault();
  const msg = $('s-msg');
  setMsg(msg, '');
  $('stepInfo').hidden = true;
  const nombre = $('s-nombre').value.trim();
  const doc = $('s-doc').value.trim();
  const codigo = ($('s-codigo').value.trim() || $('s-eval').value).toUpperCase();
  if (!codigo) { setMsg(msg, 'Selecciona una evaluación o digita su código.'); return; }
  if (!nombre || !doc) { setMsg(msg, 'Completa tu nombre y documento.'); return; }

  const { data: ev, error } = await sb.from('evaluaciones').select('*').eq('codigo', codigo).maybeSingle();
  if (error) { setMsg(msg, 'Error de conexión: ' + error.message, 'err'); return; }
  if (!ev) { setMsg(msg, 'No se encontró una evaluación con ese código.'); return; }
  if (ev.activa !== true) { setMsg(msg, 'Esta evaluación no se encuentra activa en este momento'); return; }

  const { data: prevRaw, error: e2 } = await sb.rpc('consultar_intentos', { p_codigo: codigo, p_documento: doc });
  if (e2) { setMsg(msg, 'Error consultando intentos: ' + e2.message, 'err'); return; }
  const prev = Array.isArray(prevRaw) ? (prevRaw[0] || null) : (prevRaw || null);

  Object.assign(S, { ev, prev, nombre, doc, intento: (prev?.intentos_realizados || 0) + 1 });
  const permitidos = ev.intentos_permitidos || 2;
  const hechos = prev?.intentos_realizados || 0;
  const box = $('stepInfo');
  let html = `<h2>${esc(ev.titulo)}</h2><p class="muted" style="margin:0 0 1rem">${esc(ev.curso)} · ${ev.duracion_minutos} min · ${Math.min(ev.preguntas_por_intento, ev.preguntas.length)} preguntas</p>`;

  if (hechos >= permitidos) {
    html += `<div class="msg err">Ya usaste todos tus intentos (${hechos}/${permitidos}). No puedes iniciar un nuevo examen.</div>
      <div class="score-row"><div class="score">Mejor puntaje registrado<b>${fmtNota(prev.mejor_puntaje)}</b></div>
      <div class="score">Último puntaje<b>${fmtNota(prev.ultimo_puntaje)}</b></div>
      <div class="score">Infracciones<b>${prev.infracciones_count || 0}</b></div></div>`;
    if (Array.isArray(prev.desglose_modulos) || prev.desglose_modulos) html += `<h3>Historial del intento</h3>${moduleBars(prev.desglose_modulos)}`;
  } else {
    if (hechos > 0) {
      html += `<div class="msg">Tu nota en el intento anterior fue <strong>${fmtNota(prev.ultimo_puntaje)}</strong>. Este es tu intento ${hechos + 1} de ${permitidos}${hechos + 1 === permitidos ? ' y el último' : ''}. Se conservará la mejor calificación.</div>`;
    } else {
      html += `<div class="msg">Intento 1 de ${permitidos}. Se conservará tu mejor calificación.</div>`;
    }
    html += `<p>La evaluación se realiza en <strong>pantalla completa</strong>. Cambiar de pestaña, salir de pantalla completa o usar atajos bloqueados quedará registrado.</p>
      <button class="btn primary" id="btn-start" type="button">Iniciar en pantalla completa</button>`;
  }
  box.innerHTML = html;
  box.hidden = false;
  const bs = $('btn-start');
  if (bs) bs.onclick = startExam;
};

/* =====================================================================
   PASO B: preparación segura en memoria
   ===================================================================== */
function pickBalanced(preguntas, n) {
  const groups = {};
  preguntas.forEach((q) => { (groups[q.modulo] = groups[q.modulo] || []).push(q); });
  const lists = shuffle(Object.keys(groups)).map((k) => shuffle(groups[k]));
  const out = [];
  while (out.length < n && lists.some((l) => l.length)) {
    for (const l of lists) { if (l.length && out.length < n) out.push(l.pop()); }
  }
  return shuffle(out);
}
async function prepareQuestions(ev) {
  const copy = JSON.parse(JSON.stringify(ev.preguntas));
  const chosen = pickBalanced(copy, Math.min(ev.preguntas_por_intento || copy.length, copy.length));
  for (const q of chosen) {
    q.tipo = q.tipo === 'ordenar' ? 'ordenar' : 'multiple';
    q.hash = await sha256(b64decode(q.respuestaCodificada));
    delete q.respuestaCodificada;
    if (q.tipo === 'multiple') q.opts = shuffle(q.opciones);
    else q.items = shuffle(q.opciones.map((t, i) => ({ t, i })));
  }
  return chosen;
}

/* =====================================================================
   PASO C: pantalla completa y auditoría
   ===================================================================== */
function logInf(tipo) {
  if (!S.active) return;
  const last = S.log[S.log.length - 1];
  if (last && last.tipo === tipo && Date.now() - last._t < 800) return;
  S.log.push({ hora: hhmmss(), tipo, intento: S.intento, _t: Date.now() });
}
document.addEventListener('visibilitychange', () => { if (document.hidden) logInf('Cambio de pestaña o ventana oculta'); });
let blurTimer = null;
window.addEventListener('blur', () => {
  if (!S.active || document.hidden) return;
  clearTimeout(blurTimer);
  // Periodo de gracia: en móviles el teclado o la barra de notificaciones disparan blur brevemente
  blurTimer = setTimeout(() => {
    blurTimer = null;
    if (S.active && !document.hasFocus()) logInf('Pérdida de foco de la ventana');
  }, 1500);
});
window.addEventListener('focus', () => { clearTimeout(blurTimer); blurTimer = null; });
document.addEventListener('fullscreenchange', () => {
  if (!S.active) return;
  if (!document.fullscreenElement) { logInf('Salida de pantalla completa'); $('modal-fs').hidden = false; }
  else $('modal-fs').hidden = true;
});
$('btn-refs').onclick = () => document.documentElement.requestFullscreen().catch(() => { });
document.addEventListener('contextmenu', (e) => { if (S.active) { e.preventDefault(); logInf('Intento de clic derecho'); } });
document.addEventListener('keydown', (e) => {
  if (!S.active) return;
  const k = e.key;
  let tipo = null;
  if (k === 'PrintScreen') tipo = 'Tecla PrintScreen';
  else if (e.metaKey && e.shiftKey && k.toLowerCase() === 's') tipo = 'Captura de pantalla (Meta+Shift+S)';
  else if (e.ctrlKey && !e.shiftKey && k.toLowerCase() === 'p') tipo = 'Intento de imprimir (Ctrl+P)';
  else if (k === 'F12') tipo = 'Herramientas de desarrollo (F12)';
  else if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'i') tipo = 'Herramientas de desarrollo (Ctrl+Shift+I)';
  if (tipo) { e.preventDefault(); logInf(tipo); }
});
document.addEventListener('keyup', (e) => {
  if (S.active && e.key === 'PrintScreen') { logInf('Tecla PrintScreen'); try { navigator.clipboard.writeText(''); } catch (_) { /* sin permiso */ } }
});

async function startExam() {
  const btn = $('btn-start');
  btn.disabled = true;
  const fsSupported = typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  if (fsSupported) {
    try {
      await document.documentElement.requestFullscreen();
    } catch (_) {
      btn.disabled = false;
      alert('Debes permitir la pantalla completa para iniciar la evaluación.');
      return;
    }
  }
  try {
    S.questions = await prepareQuestions(S.ev);
  } catch (err) {
    document.exitFullscreen().catch(() => { });
    btn.disabled = false;
    alert('Error preparando la evaluación: ' + err.message);
    return;
  }
  S.log = [];
  S.submitting = false;
  S.active = true;
  if (!fsSupported) logInf('Dispositivo sin soporte Fullscreen API (móvil)');
  $('btn-admin').hidden = true;
  $('stepA').hidden = true;
  $('stepInfo').hidden = true;
  $('report').hidden = true;
  $('exam').hidden = false;
  $('exam-title').textContent = S.ev.titulo;
  renderQuestions();
  window.scrollTo(0, 0);
  S.endAt = Date.now() + S.ev.duracion_minutos * 60000;
  clearInterval(S.timer);
  S.timer = setInterval(tick, 500);
  tick();
}
function tick() {
  const left = Math.max(0, Math.round((S.endAt - Date.now()) / 1000));
  const m = String(Math.floor(left / 60)).padStart(2, '0');
  const s = String(left % 60).padStart(2, '0');
  const t = $('timer');
  t.textContent = `${m}:${s}`;
  t.classList.toggle('low', left <= 60);
  if (left <= 0) submitExam(true);
}

/* =====================================================================
   PASO D: renderizado
   ===================================================================== */
function renderQuestions() {
  const cont = $('questions');
  cont.innerHTML = '';
  S.questions.forEach((q, idx) => {
    const card = document.createElement('div');
    card.className = 'q-card';
    card.innerHTML = `<div class="q-head">Pregunta ${idx + 1} de ${S.questions.length} · ${esc(q.modulo)}</div>
      <p class="q-text">${esc(q.enunciado)}</p>
      ${q.codigo ? `<pre class="code"><code class="language-jsx">${esc(q.codigo)}</code></pre>` : ''}
      <div class="q-body"></div>`;
    const body = card.querySelector('.q-body');
    if (q.tipo === 'multiple') {
      q.opts.forEach((o, i) => {
        const lab = document.createElement('label');
        lab.className = 'opt';
        lab.innerHTML = `<input type="radio" name="${esc(q.id)}" value="${i}"><span>${esc(o)}</span>`;
        lab.querySelector('input').onchange = () => { q.sel = o; updateProgress(); };
        body.appendChild(lab);
      });
    } else {
      const ul = document.createElement('ul');
      ul.className = 'order-list';
      body.appendChild(ul);
      drawOrder(q, ul);
    }
    cont.appendChild(card);
  });
  Prism.highlightAllUnder(cont);
  updateProgress();
}
function updateProgress() {
  const done = S.questions.filter((q) => q.tipo === 'ordenar' || q.sel !== undefined).length;
  $('exam-progress').textContent = `${done}/${S.questions.length} respondidas`;
}
function drawOrder(q, ul) {
  ul.innerHTML = '';
  let dragFrom = null;
  q.items.forEach((it, pos) => {
    const li = document.createElement('li');
    li.className = 'order-item';
    li.draggable = true;
    li.innerHTML = `<code>${esc(it.t)}</code>
      <button class="btn" type="button" aria-label="Subir">↑</button>
      <button class="btn" type="button" aria-label="Bajar">↓</button>`;
    const [up, down] = li.querySelectorAll('button');
    const move = (from, to) => {
      if (to < 0 || to >= q.items.length || from === to) return;
      const [x] = q.items.splice(from, 1);
      q.items.splice(to, 0, x);
      drawOrder(q, ul);
    };
    up.onclick = () => move(pos, pos - 1);
    down.onclick = () => move(pos, pos + 1);
    li.ondragstart = (e) => { dragFrom = pos; li.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(pos)); };
    li.ondragend = () => li.classList.remove('dragging');
    li.ondragover = (e) => { e.preventDefault(); li.classList.add('over'); };
    li.ondragleave = () => li.classList.remove('over');
    li.ondrop = (e) => { e.preventDefault(); if (dragFrom !== null) move(dragFrom, pos); };
    ul.appendChild(li);
  });
}

/* =====================================================================
   PASO E: calificación, guardado y reporte
   ===================================================================== */
$('btn-submit').onclick = () => {
  const sinResp = S.questions.filter((q) => q.tipo === 'multiple' && q.sel === undefined).length;
  const txt = sinResp ? `Tienes ${sinResp} pregunta(s) sin responder. ¿Enviar de todos modos?` : '¿Enviar la evaluación ahora?';
  if (confirm(txt)) submitExam(false);
};

function moduleBars(desglose) {
  if (!desglose) return '';
  return Object.entries(desglose).map(([mod, d]) => {
    const ok = d.porcentaje >= 70;
    return `<div class="mod"><div><strong>${esc(mod)}</strong> — ${d.correctas}/${d.total} (${Math.round(d.porcentaje)}%) · ${ok ? 'Tema dominado' : 'A reforzar'}</div>
      <div class="bar"><span class="${ok ? '' : 'low'}" style="width:${d.porcentaje}%"></span></div></div>`;
  }).join('');
}

async function submitExam(auto) {
  if (S.submitting) return;
  S.submitting = true;
  clearInterval(S.timer);
  S.active = false;                // detener auditoría antes de salir de pantalla completa
  $('modal-fs').hidden = true;
  if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch (_) { /* ignorar */ } }
  $('btn-submit').disabled = true;

  // Calificación por comparación de hashes
  const detalle = [];
  const desglose = {};
  for (const q of S.questions) {
    const given = q.tipo === 'ordenar' ? q.items.map((x) => x.i).join(',') : (q.sel ?? '');
    const ok = (await sha256(given)) === q.hash;
    const mostrado = q.tipo === 'ordenar' ? q.items.map((x) => x.t).join('\n') : (q.sel ?? '(sin responder)');
    detalle.push({ q, ok, mostrado });
    const d = (desglose[q.modulo] = desglose[q.modulo] || { correctas: 0, total: 0, porcentaje: 0 });
    d.total++;
    if (ok) d.correctas++;
  }
  Object.values(desglose).forEach((d) => { d.porcentaje = Math.round((d.correctas / d.total) * 1000) / 10; });
  const correctas = detalle.filter((d) => d.ok).length;
  const total = detalle.length;
  const porcentaje = Math.round((correctas / total) * 1000) / 10;
  const nota = Math.round((correctas / total) * 50) / 10;

  // Guardado en Supabase mediante RPC (el servidor acumula intentos, mejor nota e infracciones)
  let saveError = null, mejor = Math.max(Number(S.prev?.mejor_puntaje) || 0, nota), intentos = S.intento;
  const cleanLog = S.log.map(({ hora, tipo, intento }) => ({ hora, tipo, intento }));
  try {
    const { data: saved, error: saveErr } = await sb.rpc('registrar_resultado', {
      p_codigo: S.ev.codigo,
      p_curso: S.ev.curso,
      p_nombre: S.nombre,
      p_documento: S.doc,
      p_nota: nota,
      p_porcentaje: porcentaje,
      p_infracciones: cleanLog,
      p_desglose: desglose
    });
    if (saveErr) throw saveErr;
    const row = Array.isArray(saved) ? saved[0] : saved;
    if (row) { mejor = Number(row.mejor_puntaje); intentos = row.intentos_realizados; }
  } catch (err) {
    saveError = err.message || String(err);
  }

  renderReport({ nota, mejor, intentos, porcentaje, desglose, detalle, auto, saveError });
}

function renderReport({ nota, mejor, intentos, porcentaje, desglose, detalle, auto, saveError }) {
  const permitidos = S.ev.intentos_permitidos || 2;
  const restantes = Math.max(0, permitidos - intentos);
  $('exam').hidden = true;
  $('btn-admin').hidden = false;
  const rep = $('report');
  rep.hidden = false;
  rep.innerHTML = `
    <div class="card">
      <h2>Reporte final — ${esc(S.ev.titulo)}</h2>
      ${auto ? '<div class="msg">El tiempo terminó y la evaluación se envió automáticamente.</div>' : ''}
      ${saveError ? `<div class="msg err">No se pudo guardar tu resultado en el servidor: ${esc(saveError)}. Toma captura de este reporte y avisa a tu docente.</div>` : '<div class="msg ok">Resultado guardado correctamente.</div>'}
      <div class="score-row">
        <div class="score">Nota actual<b>${fmtNota(nota)}</b>${porcentaje}%</div>
        <div class="score">Mejor nota guardada<b>${fmtNota(mejor)}</b></div>
        <div class="score">Intentos restantes<b>${restantes}</b>${intentos}/${permitidos} usados</div>
      </div>
      <h3>Registro de seguridad (${S.log.length})</h3>
      ${S.log.length ? `<ul class="log-list">${S.log.map((l) => `<li>${esc(l.hora)} — ${esc(l.tipo)}</li>`).join('')}</ul>` : '<p>Sin infracciones registradas.</p>'}
      <h3>Diagnóstico por módulo</h3>
      ${moduleBars(desglose)}
      <h3>Revisión pregunta por pregunta</h3>
      ${detalle.map((d, i) => `
        <div class="review ${d.ok ? 'ok' : 'bad'}">
          <strong>${i + 1}. ${esc(d.q.enunciado)}</strong> — ${d.ok ? 'Correcta' : 'Incorrecta'}
          ${d.q.codigo ? `<pre class="code"><code class="language-jsx">${esc(d.q.codigo)}</code></pre>` : ''}
          <div><em>Tu respuesta:</em></div><pre style="white-space:pre-wrap;margin:.2rem 0">${esc(d.mostrado)}</pre>
          <div><em>Retroalimentación:</em> ${esc(d.q.retroalimentacion || '—')}</div>
        </div>`).join('')}
      <div class="row-end"><button class="btn primary" id="btn-again" type="button">Volver al inicio</button></div>
    </div>`;
  Prism.highlightAllUnder(rep);
  $('btn-again').onclick = () => {
    rep.hidden = true;
    $('stepA').hidden = false;
    $('stepInfo').hidden = true;
    setMsg($('s-msg'), '');
    $('form-student').reset();
    S.questions = [];
    loadActiveEvaluations();
    window.scrollTo(0, 0);
  };
  window.scrollTo(0, 0);
}

/* =====================================================================
   INICIO
   ===================================================================== */
(async () => {
  if (!(await initSupabase())) return;
  loadActiveEvaluations();
  // Si ya hay una sesión docente vigente, abre el panel directamente
  const { data } = await sb.auth.getSession();
  if (data.session) mostrarPanelDocente();
})();
