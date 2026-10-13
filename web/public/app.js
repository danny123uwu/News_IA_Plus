const AUTH = 'http://localhost:3001';
const FEEDS = 'http://localhost:3002';
const AGENT = 'http://localhost:3003';

let token = localStorage.getItem('token') || '';
let yo = null;
let fuentes = [];
let modoRegistro = false;
let filtroFuente = null; // {id, nombre} — portada de una fuente

const $ = (id) => document.getElementById(id);

function tagsDe(a) {
  if (Array.isArray(a.etiquetas)) return a.etiquetas;
  try { return JSON.parse(a.etiquetas || '[]'); } catch { return []; }
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('oculto');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.add('oculto'), 2600);
}

async function api(base, path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (token) headers.Authorization = 'Bearer ' + token;
  let r;
  try {
    r = await fetch(base + path, Object.assign({}, options, { headers }));
  } catch (e) {
    throw new Error('No se pudo conectar con el servidor. Intenta otra vez.');
  }
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { salir(); throw new Error('Sesión expirada, entra otra vez'); }
  if (!r.ok) throw new Error(data.error || 'Error ' + r.status);
  return data;
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- LOGIN ----------
$('tabLogin').addEventListener('click', () => cambiarModo(false));
$('tabRegister').addEventListener('click', () => cambiarModo(true));
function cambiarModo(reg) {
  modoRegistro = reg;
  $('tabLogin').classList.toggle('active', !reg);
  $('tabRegister').classList.toggle('active', reg);
  $('nombre').classList.toggle('oculto', !reg);
  $('btnAuth').textContent = reg ? 'Crear cuenta' : 'Entrar';
  $('authError').textContent = '';
}

$('formAuth').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const body = { email: $('email').value, password: $('password').value };
    if (modoRegistro) body.nombre = $('nombre').value;
    const d = await api(AUTH, modoRegistro ? '/register' : '/login', { method: 'POST', body: JSON.stringify(body) });
    token = d.token;
    localStorage.setItem('token', token);
    entrar();
  } catch (err) {
    $('authError').textContent = err.message;
  }
});

function mostrarLogin() {
  $('vistaApp').classList.add('oculto');
  $('vistaLogin').classList.remove('oculto');
}
function salir() {
  token = '';
  yo = null;
  localStorage.removeItem('token');
  mostrarLogin();
}
$('btnSalir').addEventListener('click', salir);

// ---------- ENTRAR ----------
async function entrar(datos) {
  try {
    yo = datos || await api(AUTH, '/me');
    $('vistaLogin').classList.add('oculto');
    $('vistaApp').classList.remove('oculto');
    $('nombreTop').textContent = yo.nombre;
    if (yo.foto) {
      $('fotoTop').src = AUTH + '/uploads/' + yo.foto;
      $('fotoTop').style.display = '';
      $('fotoPerfil').src = AUTH + '/uploads/' + yo.foto;
    }
    $('perfilNombre').value = yo.nombre;
    await Promise.all([cargarFuentes(), cargarTaxonomia(), cargarFeed(), cargarPanel()]);
    cargarIA().catch(() => {});
  } catch (err) {
    toast(err.message);
  }
}

// ---------- NAV ----------
document.querySelectorAll('.nav .tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav .tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.vista').forEach((v) => v.classList.add('oculto'));
    $('v-' + btn.dataset.vista).classList.remove('oculto');
    if (btn.dataset.vista === 'archivados') cargarArchivados();
    if (btn.dataset.vista === 'fuentes') cargarFuentes();
    if (btn.dataset.vista === 'panel') cargarPanel();
    if (btn.dataset.vista === 'ia') cargarIA();
  });
});

// ---------- BURBUJAS ----------
function pintarBurbujas() {
  const caja = $('burbujas');
  caja.innerHTML = '';
  if (!fuentes.length) {
    caja.innerHTML = '<small style="color:#8b98a5">Agrega tus portales favoritos en "Mis fuentes"</small>';
    return;
  }
  fuentes.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'burbuja' + (f.activo ? '' : ' pausada');
    div.title = f.nombre + ' — prioridad ' + f.prioridad + '/5';
    div.innerHTML = `<div class="anillo"><span>${esc((f.nombre || '?')[0].toUpperCase())}</span></div><small>${esc(f.nombre)}</small>`;
    div.addEventListener('click', () => abrirPortada(f));
    caja.appendChild(div);
  });
}

function abrirPortada(f) {
  filtroFuente = { id: f.id, nombre: f.nombre };
  document.querySelector('[data-vista="feed"]').click();
  cargarFeed();
}

function cerrarPortada() {
  filtroFuente = null;
  cargarFeed();
}

// ---------- FUENTES ----------
async function cargarFuentes() {
  try {
    const d = await api(FEEDS, '/feeds');
    fuentes = d.fuentes;
    pintarBurbujas();
    pintarFuentes();
    pintarPrioridades();
  } catch (err) { toast(err.message); }
}

function pintarPrioridades() {
  const caja = $('prioridadesLista');
  if (!caja) return;
  if (!fuentes.length) { caja.innerHTML = '<p class="vacio">Agrega fuentes para priorizarlas aquí.</p>'; return; }
  caja.innerHTML = '';
  fuentes.forEach((f) => {
    const fila = document.createElement('div');
    fila.className = 'prio-fila';
    fila.innerHTML = `
      <span class="prio-nombre">${esc(f.nombre)}</span>
      <input type="range" min="1" max="5" value="${f.prioridad}" />
      <span class="prio-valor">${f.prioridad}/5</span>`;
    const rango = fila.querySelector('input');
    rango.addEventListener('input', () => { fila.querySelector('.prio-valor').textContent = rango.value + '/5'; });
    rango.addEventListener('change', async () => {
      try {
        await api(FEEDS, '/feeds/' + f.id, { method: 'PUT', body: JSON.stringify({ prioridad: Number(rango.value) }) });
        f.prioridad = Number(rango.value);
        toast('Prioridad de ' + f.nombre + ': ' + rango.value + '/5');
        pintarBurbujas();
        cargarFeed();
      } catch (e) { toast(e.message); }
    });
    caja.appendChild(fila);
  });
}

function pintarFuentes() {
  const caja = $('fuentesLista');
  if (!fuentes.length) { caja.innerHTML = '<p class="vacio">Todavía no sigues ningún portal. Agrega uno o usa los presets.</p>'; return; }
  caja.innerHTML = '';
  fuentes.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'fuente-item';
    div.innerHTML = `
      <div class="info">
        <strong>${esc(f.nombre)}</strong>
        <small>${esc(f.url)}</small>
        ${f.ultimo_error ? `<div class="error-fuente">${esc(f.ultimo_error)}</div>` : ''}
      </div>
      <span class="pill ${f.activo ? 'activo' : 'pausado'}">${f.activo ? 'Activo' : 'Pausado'}</span>
      <button class="btn-peq" data-act="toggle">${f.activo ? '⏸ Pausar' : '▶ Activar'}</button>
      <button class="btn-peq" data-act="del">🗑</button>`;
    div.querySelector('[data-act="toggle"]').addEventListener('click', async () => {
      try {
        await api(FEEDS, '/feeds/' + f.id, { method: 'PUT', body: JSON.stringify({ activo: !f.activo }) });
        cargarFuentes();
      } catch (err) { toast(err.message); }
    });
    div.querySelector('[data-act="del"]').addEventListener('click', async () => {
      if (!confirm('¿Eliminar "' + f.nombre + '" y sus noticias?')) return;
      try {
        await api(FEEDS, '/feeds/' + f.id, { method: 'DELETE' });
        toast('Fuente eliminada');
        cargarFuentes();
        cargarFeed();
      } catch (err) { toast(err.message); }
    });
    caja.appendChild(div);
  });
}

async function agregarFuente(nombre, url, btn) {
  const msg = $('fuenteMsg');
  const textoOriginal = btn ? btn.textContent : '';
  msg.className = 'msg';
  msg.textContent = 'Probando y agregando…';
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Agregando…'; }
  try {
    const d = await api(FEEDS, '/feeds', { method: 'POST', body: JSON.stringify({ nombre, url }) });
    msg.className = 'msg ok';
    msg.textContent = '✓ "' + (d.titulo || nombre) + '" agregado';
    if (btn) { btn.textContent = '✓ Agregado'; btn.classList.add('cat-ok'); btn.title = 'Agregado a tus fuentes'; }
    $('fuenteNombre').value = '';
    $('fuenteUrl').value = '';
    await cargarFuentes();
    await cargarFeed();
  } catch (err) {
    msg.className = 'msg';
    msg.style.color = '#f4212e';
    msg.textContent = err.message;
    if (btn) {
      btn.textContent = '❌ ' + err.message.slice(0, 42);
      btn.title = err.message;
      btn.classList.add('cat-err');
      btn.disabled = false;
      setTimeout(() => { btn.textContent = textoOriginal; btn.classList.remove('cat-err'); }, 5000);
    }
  }
}

$('btnAgregarFuente').addEventListener('click', () => agregarFuente($('fuenteNombre').value, $('fuenteUrl').value, $('btnAgregarFuente')));
document.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => agregarFuente(b.dataset.n, b.dataset.u, b)));

// ---------- CATÁLOGO DE PORTALES ----------
function pintarCatalogo() {
  const caja = $('catalogoCaja');
  if (!caja || !window.CATALOGO) return;
  caja.innerHTML = '';
  window.CATALOGO.forEach((grupo) => {
    const det = document.createElement('details');
    det.className = 'cat-detalle';
    det.dataset.cat = grupo.cat.toLowerCase();
    const suma = document.createElement('summary');
    suma.innerHTML = `<span class="flecha">▸</span> ${esc(grupo.cat)} <small class="cat-cont">${grupo.items.length} portales</small>`;
    det.appendChild(suma);
    const lista = document.createElement('div');
    lista.className = 'cat-items';
    grupo.items.forEach((it) => {
      const fila = document.createElement('div');
      fila.className = 'cat-item';
      fila.dataset.busca = (it.n + ' ' + it.u + ' ' + grupo.cat).toLowerCase();
      fila.innerHTML = `
        <span class="cat-nombre"><b>${esc(it.n)}</b><small>${esc(it.u.replace(/^https?:\/\//, '').split('/')[0])}</small></span>
        <button class="btn-peq cat-add">+ Agregar</button>`;
      fila.querySelector('.cat-add').addEventListener('click', () => agregarFuente(it.n, it.u, fila.querySelector('.cat-add')));
      lista.appendChild(fila);
    });
    det.appendChild(lista);
    det.addEventListener('toggle', () => suma.querySelector('.flecha').textContent = det.open ? '▾' : '▸');
    caja.appendChild(det);
  });
}

$('buscadorCatalogo').addEventListener('input', () => {
  const q = $('buscadorCatalogo').value.trim().toLowerCase();
  document.querySelectorAll('.cat-detalle').forEach((det) => {
    let visibles = 0;
    det.querySelectorAll('.cat-item').forEach((fila) => {
      const ok = !q || fila.dataset.busca.includes(q);
      fila.classList.toggle('oculto', !ok);
      if (ok) visibles++;
    });
    det.classList.toggle('oculto', q && !visibles);
    if (q && visibles) { det.open = true; det.querySelector('.flecha').textContent = '▾'; }
    if (!q) { det.open = false; det.querySelector('.flecha').textContent = '▸'; }
  });
});

pintarCatalogo();

$('btnRefrescar').addEventListener('click', async () => {
  toast('Actualizando noticias…');
  try {
    const d = await api(FEEDS, '/feeds/refresh', { method: 'POST', body: '{}' });
    toast(d.nuevos ? d.nuevos + ' noticias nuevas' : 'Todo al día');
    await cargarFeed();
    cargarFuentes();
  } catch (err) { toast(err.message); }
});

// ---------- FEED ----------
function pintarInfo(d) {
  const caja = $('feedInfo');
  if (!caja) return;
  const rangoTxt = d.rango === 24 ? '24 h' : d.rango === 72 ? '3 días' : d.rango === 168 ? 'semana' : 'mes';
  const partes = [`<b>${d.total}</b> noticias en tu ${rangoTxt}`];
  if (d.intereses) {
    partes.push(d.conInteres
      ? `<b>${d.conInteres}</b> por tus intereses`
      : `<span class="aviso">0 por tus intereses</span>`);
  }
  if (d.relleno) partes.push('relleno con noticias anteriores');
  caja.innerHTML = '📊 ' + partes.join(' · ');
}

async function cargarFeed() {
  const caja = $('feedLista');
  try {
    if (filtroFuente) {
      const d = await api(FEEDS, '/articles?fuente=' + encodeURIComponent(filtroFuente.id));
      const arts = d.articulos || [];
      const info = $('feedInfo');
      info.innerHTML = '';
      const aviso = document.createElement('div');
      aviso.className = 'portada-aviso';
      aviso.innerHTML = `<span>🗞 Portada de <b>${esc(filtroFuente.nombre)}</b> · ${arts.length} noticias</span>`;
      const btnSalir = document.createElement('button');
      btnSalir.id = 'btnCerrarPortada';
      btnSalir.textContent = '✕ Ver todas las fuentes';
      btnSalir.addEventListener('click', cerrarPortada);
      aviso.appendChild(btnSalir);
      info.appendChild(aviso);
      if (!arts.length) {
        caja.innerHTML = '<p class="vacio">Esta fuente no tiene noticias recientes. Pulsa 🔄 Actualizar.</p>';
        return;
      }
      caja.innerHTML = '';
      arts.forEach((a, i) => caja.appendChild(cardNoticia(a, i === 0)));
      return;
    }
    const intereses = (yo && yo.intereses ? yo.intereses : []).join(',');
    const horas = $('filtroHoras').value;
    const q = $('buscar').value.trim();
    const d = await api(FEEDS, `/feed?horas=${horas}&intereses=${encodeURIComponent(intereses)}&q=${encodeURIComponent(q)}`);
    pintarInfo(d);
    if (!d.articulos.length) {
      caja.innerHTML = '<p class="vacio">No hay noticias en ese rango. Cambia el rango de fechas o actualiza el feed.</p>';
      return;
    }
    caja.innerHTML = '';
    d.articulos.forEach((a) => caja.appendChild(cardNoticia(a)));
  } catch (err) { caja.innerHTML = '<p class="vacio">' + esc(err.message) + '</p>'; }
}

function cardNoticia(a, destacada) {
  const div = document.createElement('div');
  div.className = 'card-noticia' + (destacada ? ' destacada' : '');
  div.dataset.id = a.id;
  const fecha = a.fecha ? new Date(a.fecha).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const tags = tagsDe(a);
  const titulo = a.titulo_es || a.titulo;
  const extracto = a.resumen_es || a.contenido;
  const traducido = a.titulo_es && a.titulo_es !== a.titulo;
  div.innerHTML = `
    ${a.imagen ? `<div class="media"><img src="${esc(a.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'">${a.video ? '<span class="play">▶ video</span>' : ''}</div>` : ''}
    <div class="cabecera">
      <span class="pastilla ${a.prioridad >= 4 ? 'prio' : ''}">📡 ${esc(a.fuente)}
        <button class="prio-btn" data-a="subir" title="Subir prioridad de ${esc(a.fuente)}">▲</button><button class="prio-btn" data-a="bajar" title="Bajar prioridad de ${esc(a.fuente)}">▼</button>
        <span class="prio-num">${a.prioridad}/5</span>
      </span>
      <span>🗓 ${fecha}</span>
      ${a.autor ? '<span>✍ ' + esc(a.autor) + '</span>' : ''}
      ${traducido ? '<span class="pastilla">🌐 ES</span>' : ''}
      ${a.leido ? '<span class="pastilla">✓ leído</span>' : ''}
    </div>
    <h4>${esc(titulo)}</h4>
    <div class="extracto">${esc(extracto)}</div>
    <div class="etiquetas">${tags.map((t) => `<span class="etiqueta">#${esc(t)}</span>`).join('')}</div>
    <div class="acciones">
      <button data-a="abrir">📖 Leer</button>
      <button data-a="fav" class="${a.favorito ? 'on' : ''}">${a.favorito ? '★ Guardado' : '☆ Favorito'}</button>
      <button data-a="archivar">📁 Archivar</button>
      <button data-a="saltar">✖ No me interesa</button>
      <a href="${esc(a.link)}" target="_blank" rel="noopener">Ver fuente ↗</a>
    </div>`;
  div.addEventListener('click', (e) => {
    if (e.target.closest('button, a')) return;
    abrirArticulo(a);
  });
  div.querySelector('[data-a="abrir"]').addEventListener('click', () => abrirArticulo(a));
  div.querySelector('[data-a="subir"]').addEventListener('click', (e) => { e.stopPropagation(); cambiarPrioridad(a, +1); });
  div.querySelector('[data-a="bajar"]').addEventListener('click', (e) => { e.stopPropagation(); cambiarPrioridad(a, -1); });
  div.querySelector('[data-a="fav"]').addEventListener('click', async () => {
    try {
      await api(FEEDS, '/articles/' + a.id, { method: 'PATCH', body: JSON.stringify({ favorito: !a.favorito }) });
      cargarFeed();
    } catch (e) { toast(e.message); }
  });
  div.querySelector('[data-a="archivar"]').addEventListener('click', async () => {
    try {
      await api(FEEDS, '/articles/' + a.id, { method: 'PATCH', body: JSON.stringify({ archivado: true, leido: true }) });
      toast('Archivado 📁');
      div.remove();
    } catch (e) { toast(e.message); }
  });
  div.querySelector('[data-a="saltar"]').addEventListener('click', async () => {
    try {
      await api(FEEDS, '/articles/' + a.id, { method: 'PATCH', body: JSON.stringify({ saltado: true }) });
      toast('Ya no verás noticias similares');
      div.remove();
    } catch (e) { toast(e.message); }
  });
  return div;
}

async function cambiarPrioridad(a, delta) {
  const nueva = Math.max(1, Math.min(5, (Number(a.prioridad) || 3) + delta));
  try {
    await api(FEEDS, '/feeds/' + a.source_id, { method: 'PUT', body: JSON.stringify({ prioridad: nueva }) });
    a.prioridad = nueva;
    toast('Prioridad de ' + a.fuente + ': ' + nueva + '/5');
    cargarFuentes();
    cargarFeed();
  } catch (e) { toast(e.message); }
}

let tBuscar;
$('buscar').addEventListener('input', () => { clearTimeout(tBuscar); tBuscar = setTimeout(() => cargarFeed(), 300); });
$('filtroHoras').addEventListener('change', () => cargarFeed());

// ---------- MODAL ----------
function sanearHTML(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  doc.querySelectorAll('script,style,iframe,object,embed,link,meta,noscript,form,input,button').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const n = attr.name.toLowerCase();
      const v = String(attr.value || '');
      if (el.tagName === 'IMG') {
        if (n === 'src' && !/^https?:\/\//i.test(v)) el.remove();
        else if (n !== 'src' && n !== 'alt') el.removeAttribute(attr.name);
      } else if (el.tagName === 'A') {
        if (n === 'href' && !/^https?:\/\//i.test(v)) el.removeAttribute(attr.name);
        else if (n !== 'href') el.removeAttribute(attr.name);
      } else {
        el.removeAttribute(attr.name);
      }
    });
    if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    if (el.tagName === 'IMG') { el.setAttribute('loading', 'lazy'); el.setAttribute('referrerpolicy', 'no-referrer'); }
  });
  return doc.body.innerHTML;
}

function abrirArticulo(a) {
  const tags = tagsDe(a);
  const titulo = a.titulo_es || a.titulo;
  const resumen = a.resumen_es || String(a.contenido || '').slice(0, 400);
  const traducido = a.titulo_es && a.titulo_es !== a.titulo;
  document.body.classList.add('modal-abierto');
  $('modalCuerpo').innerHTML = `
    ${a.imagen ? `<div class="media modal-media"><img src="${esc(a.imagen)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'"></div>` : ''}
    ${a.video ? `<div class="video-marco"><iframe src="${esc(a.video)}" title="video" frameborder="0" allowfullscreen loading="lazy"></iframe></div>` : ''}
    <span class="pastilla ${a.prioridad >= 4 ? 'prio' : ''}">📡 ${esc(a.fuente)}</span>
    <h2>${esc(titulo)}</h2>
    ${traducido ? `<div class="titulo-original">Título original: ${esc(a.titulo)}</div>` : ''}
    <div class="meta">${esc(a.autor || 'Sin autor')} · ${a.fecha ? new Date(a.fecha).toLocaleString('es-MX') : ''} · ${tags.map((t) => '#' + esc(t)).join(' ')}</div>
    <div class="cuerpo" id="cuerpoArt">${esc(resumen)}</div>
    <div class="cuerpo-original" id="cuerpoOriginal"><p class="cargando-original">⏳ Cargando contenido completo con imágenes…</p></div>
    <div id="resultadoIA"></div>
    <div class="acciones">
      <button id="mResumir">🤖 Resumir con IA</button>
      <button id="mPreguntar">💬 Preguntarle a la IA</button>
      ${traducido ? '<button id="mTraducir">🌐 Traducir contenido completo</button>' : ''}
      <button id="mRecorte">✂️ Guardar recorte</button>
      <button id="mLeido">✓ Marcar leído</button>
      <a href="${esc(a.link)}" target="_blank" rel="noopener">Ver fuente ↗</a>
    </div>`;
  $('modal').classList.remove('oculto');
  api(FEEDS, '/articles/' + a.id, { method: 'PATCH', body: JSON.stringify({ leido: true }) })
    .then(() => { a.leido = 1; marcarCardLeida(a.id); })
    .catch(() => {});
  cargarOriginalEnModal(a);

  const btnTrad = $('mTraducir');
  if (btnTrad) btnTrad.addEventListener('click', async () => {
    btnTrad.disabled = true;
    btnTrad.textContent = '🌐 Traduciendo…';
    try {
      const d = await api(AGENT, '/spanish', { method: 'POST', body: JSON.stringify({ titulo: a.titulo, texto: a.contenido, modo: 'completo' }) });
      $('cuerpoArt').textContent = d.texto || d.resumen || a.contenido;
      toast('Contenido traducido ✓ (' + (d.proveedor || '') + ')');
    } catch (e) { toast(e.message); }
    btnTrad.disabled = false;
    btnTrad.textContent = '🌐 Traducir contenido completo';
  });

  $('mResumir').addEventListener('click', async () => {
    $('resultadoIA').innerHTML = '<div class="resultado-ia">🤖 Generando con el motor configurado…</div>';
    try {
      const d = await api(AGENT, '/summarize', { method: 'POST', body: JSON.stringify({ titulo: a.titulo, texto: a.contenido }) });
      $('resultadoIA').innerHTML = '<div class="resultado-ia">🤖 Resumen (' + esc(d.motor) + '):\n\n' + esc(d.resumen) + '</div>';
    } catch (e) { $('resultadoIA').innerHTML = '<div class="resultado-ia">❌ ' + esc(e.message) + '</div>'; }
  });

  $('mPreguntar').addEventListener('click', async () => {
    const p = prompt('¿Qué quieres saber de esta noticia?');
    if (!p) return;
    $('resultadoIA').innerHTML = '<div class="resultado-ia">Pensando… 🤖</div>';
    try {
      const d = await api(AGENT, '/ask', { method: 'POST', body: JSON.stringify({ pregunta: p, titulo: a.titulo, texto: a.contenido }) });
      $('resultadoIA').innerHTML = '<div class="resultado-ia">🤖 ' + esc(d.respuesta) + '</div>';
    } catch (e) { $('resultadoIA').innerHTML = '<div class="resultado-ia">❌ ' + esc(e.message) + '</div>'; }
  });

  $('mRecorte').addEventListener('click', async () => {
    const sel = String(window.getSelection() || '').trim();
    const texto = sel || prompt('Pega o escribe el fragmento que quieres guardar:', String(a.contenido).slice(0, 300));
    if (!texto) return;
    try {
      await api(FEEDS, '/articles/' + a.id + '/clip', { method: 'POST', body: JSON.stringify({ texto, nota: '' }) });
      toast('Recorte guardado ✂️');
    } catch (e) { toast(e.message); }
  });

  $('mLeido').addEventListener('click', async () => {
    try {
      await api(FEEDS, '/articles/' + a.id, { method: 'PATCH', body: JSON.stringify({ leido: true }) });
      toast('Marcado como leído ✓');
      a.leido = 1;
      marcarCardLeida(a.id);
      cerrarModal();
    } catch (e) { toast(e.message); }
  });
}

function marcarCardLeida(id) {
  const el = document.querySelector('.card-noticia[data-id="' + id + '"]');
  if (el && !el.querySelector('.leido-ok')) {
    const cab = el.querySelector('.cabecera');
    if (cab) {
      const s = document.createElement('span');
      s.className = 'pastilla leido-ok';
      s.textContent = '✓ leído';
      cab.appendChild(s);
    }
  }
}

function cargarOriginalEnModal(a) {
  const c = $('cuerpoOriginal');
  if (!c) return;
  c.classList.remove('oculto');
  c.innerHTML = '<p class="cargando-original">⏳ Cargando contenido completo con imágenes…</p>';
  const prom = (a.contenido_html === undefined || a.contenido_html === null)
    ? api(FEEDS, '/articles/' + a.id).then((d) => {
        a.contenido_html = d.articulo.contenido_html;
        if (d.articulo.contenido) a.contenido = d.articulo.contenido;
      })
    : Promise.resolve();
  prom.then(() => {
    if ($('modal').classList.contains('oculto')) return;
    c.innerHTML = a.contenido_html
      ? sanearHTML(a.contenido_html)
      : '<p>' + esc(a.contenido || 'Sin contenido original disponible.') + '</p>';
  }).catch((e) => {
    if ($('modal').classList.contains('oculto')) return;
    c.innerHTML = '<p>❌ ' + esc(e.message) + '</p>';
  });
}

function cerrarModal() {
  $('modal').classList.add('oculto');
  document.body.classList.remove('modal-abierto');
}
$('modalCerrar').addEventListener('click', cerrarModal);
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) cerrarModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

// ---------- DIGEST ----------
$('btnDigest').addEventListener('click', async () => {
  const caja = $('cajaDigest');
  caja.classList.remove('oculto');
  caja.textContent = '☀️ Armando tu digest…';
  try {
    const d = await api(FEEDS, '/feed?horas=24&intereses=' + encodeURIComponent((yo.intereses || []).join(',')));
    const dg = await api(AGENT, '/digest', { method: 'POST', body: JSON.stringify({ articulos: d.articulos }) });
    caja.textContent = dg.digest;
  } catch (e) { caja.textContent = '❌ ' + e.message; }
});

// ---------- ARCHIVADOS ----------
async function cargarArchivados() {
  try {
    const [arts, clips] = await Promise.all([
      api(FEEDS, '/articles?archivado=1'),
      api(FEEDS, '/clips')
    ]);
    const ca = $('archivadosLista');
    ca.innerHTML = arts.articulos.length ? '' : '<p class="vacio">Sin noticias archivadas aún.</p>';
    arts.articulos.forEach((a) => {
      const div = document.createElement('div');
      div.className = 'card-noticia';
      div.innerHTML = `<div class="cabecera"><span class="pastilla">📡 ${esc(a.fuente)}</span></div>
        <h4>${esc(a.titulo)}</h4><div class="acciones">
        <button data-a="quitar">Sacar del archivo</button>
        <a href="${esc(a.link)}" target="_blank" rel="noopener">Fuente ↗</a></div>`;
      div.querySelector('[data-a="quitar"]').addEventListener('click', async () => {
        try {
          await api(FEEDS, '/articles/' + a.id, { method: 'PATCH', body: JSON.stringify({ archivado: false }) });
          cargarArchivados();
        } catch (e) { toast(e.message); }
      });
      ca.appendChild(div);
    });
    const cr = $('recortesLista');
    cr.innerHTML = clips.recortes.length ? '' : '<p class="vacio">Sin recortes. Abre una noticia y usa "Guardar recorte".</p>';
    clips.recortes.forEach((c) => {
      const div = document.createElement('div');
      div.className = 'card-noticia';
      div.innerHTML = `<div class="cabecera"><span class="pastilla">✂️ ${esc(c.medio || '')}</span></div>
        <h4>${esc(c.titulo)}</h4><div class="extracto">${esc(c.texto)}</div>
        <div class="acciones"><button data-a="borrar">🗑 Borrar</button>
        <a href="${esc(c.link)}" target="_blank" rel="noopener">Fuente ↗</a></div>`;
      div.querySelector('[data-a="borrar"]').addEventListener('click', async () => {
        try {
          await api(FEEDS, '/clips/' + c.id, { method: 'DELETE' });
          cargarArchivados();
        } catch (e) { toast(e.message); }
      });
      cr.appendChild(div);
    });
  } catch (e) { toast(e.message); }
}

// ---------- PERFIL ----------
async function cargarTaxonomia() {
  try {
    const d = await api(FEEDS, '/taxonomy');
    const caja = $('interesesCaja');
    caja.innerHTML = '';
    d.etiquetas.forEach((t) => {
      const chip = document.createElement('span');
      chip.className = 'chip' + ((yo.intereses || []).includes(t) ? ' on' : '');
      chip.textContent = t;
      chip.addEventListener('click', () => {
        chip.classList.toggle('on');
        const elegidas = [...caja.querySelectorAll('.chip.on')].map((c) => c.textContent);
        api(AUTH, '/me', { method: 'PUT', body: JSON.stringify({ intereses: elegidas }) })
          .then((u) => { yo = u; toast('Intereses actualizados ✓'); cargarFeed(); })
          .catch((e) => toast(e.message));
      });
      caja.appendChild(chip);
    });
  } catch (e) { toast(e.message); }
}

$('btnGuardarPerfil').addEventListener('click', async () => {
  try {
    await api(AUTH, '/me', { method: 'PUT', body: JSON.stringify({ nombre: $('perfilNombre').value }) });
    yo.nombre = $('perfilNombre').value;
    $('nombreTop').textContent = yo.nombre;
    toast('Perfil guardado ✓');
  } catch (e) { toast(e.message); }
});

$('perfilFoto').addEventListener('change', async () => {
  const file = $('perfilFoto').files[0];
  if (!file) return;
  try {
    const b64 = await new Promise((res) => {
      const fr = new FileReader();
      fr.onload = () => res(fr.result.split(',')[1]);
      fr.readAsDataURL(file);
    });
    const d = await api(AUTH, '/me/foto', { method: 'POST', body: JSON.stringify({ dataBase64: b64, ext: file.name.split('.').pop() }) });
    yo.foto = d.foto;
    $('fotoPerfil').src = AUTH + '/uploads/' + d.foto;
    $('fotoTop').src = AUTH + '/uploads/' + d.foto;
    $('fotoTop').style.display = '';
    toast('Foto actualizada ✓');
  } catch (e) { toast(e.message); }
});

// ---------- PANEL ----------
async function cargarPanel() {
  try {
    const d = await api(FEEDS, '/stats');
    $('statsCaja').innerHTML = `
      <div class="stat"><b>${d.total}</b><small>noticias</small></div>
      <div class="stat"><b>${d.leidos}</b><small>leídas</small></div>
      <div class="stat"><b>${d.favoritos}</b><small>favoritas</small></div>
      <div class="stat"><b>${d.archivados}</b><small>archivadas</small></div>
      <div class="stat"><b>${d.recortes}</b><small>recortes</small></div>`;
    const maxF = Math.max(1, ...d.porFuente.map((x) => x.n));
    $('barrasFuente').innerHTML = d.porFuente.length
      ? d.porFuente.map((x) => `<div class="barra-fila"><span>${esc(x.nombre)}</span><div class="barra"><i style="width:${(x.n / maxF) * 100}%"></i></div><b>${x.n}</b></div>`).join('')
      : '<p class="vacio">Aún no has leído noticias.</p>';
    const maxE = Math.max(1, ...d.topEtiquetas.map((x) => x.n));
    $('barrasEtiqueta').innerHTML = d.topEtiquetas.length
      ? d.topEtiquetas.map((x) => `<div class="barra-fila"><span>#${esc(x.nombre)}</span><div class="barra"><i style="width:${(x.n / maxE) * 100}%"></i></div><b>${x.n}</b></div>`).join('')
      : '<p class="vacio">Sin datos todavía.</p>';
  } catch (e) { toast(e.message); }
}

// ---------- IA (panel ⚙️) ----------
let iaData = null;

function etiquetaMotor(cfg) {
  if (!cfg) return '⚙️ …';
  if (cfg.motor === 'api') return '☁️ ' + (cfg.api.proveedor || 'API') + (cfg.api.modelo ? ' · ' + cfg.api.modelo : '');
  const rec = (iaData && iaData.recomendado && iaData.recomendado.resumir) || '';
  return '🖥️ ' + (cfg.modelos.resumir || rec || 'auto');
}

async function cargarIA() {
  try {
    iaData = await api(AGENT, '/config');
    pintarIA();
  } catch (e) {
    $('iaEstado').textContent = 'No se pudo cargar la configuración de IA: ' + e.message;
  }
}

function pintarIA() {
  const { config, modelos, recomendado, proveedores, ollama } = iaData;
  const clas = config.modelos.clasificar || recomendado.clasificar || 'auto';
  const resu = config.modelos.resumir || recomendado.resumir || 'auto';
  $('iaEstado').innerHTML =
    'Motor actual: <b>' + esc(config.motor === 'api' ? 'API externa' : ollama ? 'Ollama local' : 'sin Ollama') + '</b>' +
    ' · Clasificar: <b>' + esc(clas) + '</b>' +
    ' · Resumir: <b>' + esc(resu) + '</b>' +
    (config.motor === 'api' && config.api.keyGuardada ? ' · key: <b>' + esc(config.api.keyFinal) + '</b>' : '');

  document.querySelectorAll('input[name=motorIA]').forEach((r) => { r.checked = r.value === config.motor; });
  $('iaApiCaja').classList.toggle('oculto', config.motor !== 'api');

  $('iaProveedor').innerHTML = Object.keys(proveedores)
    .map((k) => '<option value="' + esc(k) + '">' + esc(proveedores[k].nombre) + '</option>').join('');
  $('iaProveedor').value = config.api.proveedor || 'gemini';
  $('iaBaseUrl').value = config.api.baseUrl || '';
  $('iaModelo').value = config.api.modelo || '';
  $('iaKey').value = '';
  $('iaKey').placeholder = config.api.keyGuardada
    ? 'Key guardada: ' + config.api.keyFinal + ' (vacío = no cambiar)'
    : 'API key';
  if (!$('iaBaseUrl').value) aplicarProveedor(false);

  const opciones = (id, valor, rec) => {
    const auto = '<option value="">Automático' + (rec ? ' — ' + esc(rec) : '') + '</option>';
    const lista = modelos.map((m) =>
      '<option value="' + esc(m.name) + '">' + esc(m.name) + ' — ' + m.gb + ' GB' +
      (m.name === rec ? ' ⭐ recomendado' : '') + (m.size > 5.5e9 ? ' ⚠️ pesado' : '') + '</option>'
    ).join('');
    const el = $(id);
    el.innerHTML = auto + lista;
    el.value = valor || '';
  };
  opciones('iaClasificar', config.modelos.clasificar, recomendado.clasificar);
  opciones('iaResumir', config.modelos.resumir, recomendado.resumir);

  $('iaModelosMsg').innerHTML = ollama
    ? ((recomendado.evitados || []).length
      ? 'Descartados por tamaño: ' + recomendado.evitados.map(esc).join(', ') + ' (no caben en 6 GB de VRAM).'
      : 'Un modelo a la vez: la cola de tareas es secuencial, no se cargan varios modelos juntos.')
    : '<b>No se detectó Ollama.</b> Encendé Ollama (systemctl start ollama) o usá la API externa.';

  document.querySelectorAll('input[name=tradMotor]').forEach((r) => { r.checked = r.value === config.traduccion; });
  $('iaTradMsg').textContent = config.traduccion === 'google'
    ? 'Google primero (gratis, 0.16 s). Si falla, respaldo automático con tu motor.'
    : 'Tu motor primero. Si falla, respaldo con Google y MyMemory: nunca queda sin traducir.';

  $('motorTop').textContent = etiquetaMotor(config);
  $('motorTop').title = 'Motor de IA: ' + etiquetaMotor(config) + ' — clic para configurar';
}

function aplicarProveedor(sobrescribir) {
  const k = $('iaProveedor').value;
  const p = (iaData && iaData.proveedores && iaData.proveedores[k]) || {};
  if (sobrescribir || !$('iaBaseUrl').value) $('iaBaseUrl').value = p.url || '';
  if (sobrescribir || !$('iaModelo').value) $('iaModelo').value = p.modelo || '';
}

function cuerpoConfigIA() {
  return {
    motor: (document.querySelector('input[name=motorIA]:checked') || {}).value || 'local',
    modelos: { clasificar: $('iaClasificar').value, resumir: $('iaResumir').value },
    traduccion: (document.querySelector('input[name=tradMotor]:checked') || {}).value || 'google',
    api: { proveedor: $('iaProveedor').value, baseUrl: $('iaBaseUrl').value, modelo: $('iaModelo').value, key: $('iaKey').value }
  };
}

document.querySelectorAll('input[name=motorIA]').forEach((r) => r.addEventListener('change', () => {
  $('iaApiCaja').classList.toggle('oculto', r.value !== 'api');
  if (r.value === 'api' && !$('iaBaseUrl').value) aplicarProveedor(true);
}));
$('iaProveedor').addEventListener('change', () => aplicarProveedor(true));

$('btnGuardarIA').addEventListener('click', async () => {
  try {
    iaData = await api(AGENT, '/config', { method: 'PUT', body: JSON.stringify(cuerpoConfigIA()) });
    pintarIA();
    toast('Configuración de IA guardada');
  } catch (e) { toast(e.message); }
});

$('btnProbarApi').addEventListener('click', async () => {
  $('iaApiMsg').textContent = '⏳ Probando conexión…';
  try {
    const cuerpo = cuerpoConfigIA();
    cuerpo.motor = 'api';
    const d = await api(AGENT, '/config/test', { method: 'POST', body: JSON.stringify(cuerpo) });
    $('iaApiMsg').innerHTML = '✅ <b>' + esc(d.motor) + '</b> — ' + d.ms + ' ms — "' + esc(d.respuesta) + '"';
  } catch (e) { $('iaApiMsg').textContent = '❌ ' + e.message; }
});

$('btnProbarIA').addEventListener('click', async () => {
  $('iaMsg').textContent = '⏳ Generando…';
  try {
    const d = await api(AGENT, '/config/test', { method: 'POST', body: JSON.stringify({}) });
    $('iaMsg').innerHTML = '✅ <b>' + esc(d.motor) + '</b> — ' + d.ms + ' ms<br />"' + esc(d.respuesta) + '"';
  } catch (e) { $('iaMsg').textContent = '❌ ' + e.message; }
});

$('motorTop').addEventListener('click', () => {
  const t = document.querySelector('[data-vista="ia"]');
  if (t) t.click();
});

// ---------- INICIO ----------
async function obtenerYo(intentos = 3) {
  let ultimoError;
  for (let i = 0; i < intentos; i++) {
    if (!token) throw new Error('No hay sesión activa');
    try {
      return await api(AUTH, '/me');
    } catch (e) {
      ultimoError = e;
      if (!token) throw e;
      await new Promise((r) => setTimeout(r, 350 * (i + 1)));
    }
  }
  throw ultimoError;
}

(async function init() {
  if (!token) return mostrarLogin();
  try {
    const datos = await obtenerYo();
    entrar(datos);
  } catch (e) {
    toast(e.message);
    mostrarLogin();
  }
})();
