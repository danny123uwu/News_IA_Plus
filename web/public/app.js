const AUTH = 'http://localhost:3001';
const FEEDS = 'http://localhost:3002';
const AGENT = 'http://localhost:3003';

let token = localStorage.getItem('token') || '';
let yo = null;
let fuentes = [];
let modoRegistro = false;

const $ = (id) => document.getElementById(id);

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
    div.addEventListener('click', () => {
      document.querySelector('[data-vista="fuentes"]').click();
    });
    caja.appendChild(div);
  });
}

// ---------- FUENTES ----------
async function cargarFuentes() {
  try {
    const d = await api(FEEDS, '/feeds');
    fuentes = d.fuentes;
    pintarBurbujas();
    pintarFuentes();
  } catch (err) { toast(err.message); }
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
      <label class="prio-txt">Prioridad</label>
      <input type="range" min="1" max="5" value="${f.prioridad}" />
      <span class="prio-txt">${f.prioridad}/5</span>
      <button class="btn-peq" data-act="toggle">${f.activo ? '⏸ Pausar' : '▶ Activar'}</button>
      <button class="btn-peq" data-act="del">🗑</button>`;
    div.querySelector('input').addEventListener('change', async (e) => {
      try {
        await api(FEEDS, '/feeds/' + f.id, { method: 'PUT', body: JSON.stringify({ prioridad: Number(e.target.value) }) });
        toast('Prioridad actualizada');
        cargarFuentes();
      } catch (err) { toast(err.message); }
    });
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

async function agregarFuente(nombre, url) {
  const msg = $('fuenteMsg');
  msg.className = 'msg';
  msg.textContent = 'Probando y agregando…';
  try {
    const d = await api(FEEDS, '/feeds', { method: 'POST', body: JSON.stringify({ nombre, url }) });
    msg.className = 'msg ok';
    msg.textContent = '✓ "' + (d.titulo || nombre) + '" agregado';
    $('fuenteNombre').value = '';
    $('fuenteUrl').value = '';
    await cargarFuentes();
    await cargarFeed();
  } catch (err) {
    msg.className = 'msg';
    msg.style.color = '#f4212e';
    msg.textContent = err.message;
  }
}

$('btnAgregarFuente').addEventListener('click', () => agregarFuente($('fuenteNombre').value, $('fuenteUrl').value));
document.querySelectorAll('.preset').forEach((b) => b.addEventListener('click', () => agregarFuente(b.dataset.n, b.dataset.u)));

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

function cardNoticia(a) {
  const div = document.createElement('div');
  div.className = 'card-noticia';
  const fecha = a.fecha ? new Date(a.fecha).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const tags = JSON.parse(a.etiquetas || '[]');
  const titulo = a.titulo_es || a.titulo;
  const extracto = a.resumen_es || a.contenido;
  const traducido = a.titulo_es && a.titulo_es !== a.titulo;
  div.innerHTML = `
    ${a.imagen ? `<div class="media"><img src="${esc(a.imagen)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'">${a.video ? '<span class="play">▶ video</span>' : ''}</div>` : ''}
    <div class="cabecera">
      <span class="pastilla ${a.prioridad >= 4 ? 'prio' : ''}">📡 ${esc(a.fuente)}</span>
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
      <a href="${esc(a.link)}" target="_blank" rel="noopener">Ver original ↗</a>
    </div>`;
  div.querySelector('[data-a="abrir"]').addEventListener('click', () => abrirArticulo(a));
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

$('buscar').addEventListener('input', () => cargarFeed());
$('filtroHoras').addEventListener('change', () => cargarFeed());

// ---------- MODAL ----------
function abrirArticulo(a) {
  const tags = JSON.parse(a.etiquetas || '[]');
  const titulo = a.titulo_es || a.titulo;
  const resumen = a.resumen_es || a.contenido;
  const traducido = a.titulo_es && a.titulo_es !== a.titulo;
  $('modalCuerpo').innerHTML = `
    ${a.imagen ? `<div class="media modal-media"><img src="${esc(a.imagen)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.style.display='none'"></div>` : ''}
    ${a.video ? `<div class="video-marco"><iframe src="${esc(a.video)}" title="video" frameborder="0" allowfullscreen loading="lazy"></iframe></div>` : ''}
    <span class="pastilla ${a.prioridad >= 4 ? 'prio' : ''}">📡 ${esc(a.fuente)}</span>
    <h2>${esc(titulo)}</h2>
    ${traducido ? `<div class="titulo-original">Título original: ${esc(a.titulo)}</div>` : ''}
    <div class="meta">${esc(a.autor || 'Sin autor')} · ${a.fecha ? new Date(a.fecha).toLocaleString('es-MX') : ''} · ${tags.map((t) => '#' + esc(t)).join(' ')}</div>
    <div class="cuerpo" id="cuerpoArt">${esc(resumen)}</div>
    <details class="contenido-original"><summary>📄 Ver contenido original del medio</summary><div>${esc(a.contenido)}</div></details>
    <div id="resultadoIA"></div>
    <div class="acciones">
      <button id="mResumir">🤖 Resumir con IA</button>
      <button id="mPreguntar">💬 Preguntarle a la IA</button>
      ${traducido ? '<button id="mTraducir">🌐 Traducir contenido completo</button>' : ''}
      <button id="mRecorte">✂️ Guardar recorte</button>
      <button id="mLeido">✓ Marcar leído</button>
      <a href="${esc(a.link)}" target="_blank" rel="noopener">Ver original ↗</a>
    </div>`;
  $('modal').classList.remove('oculto');
  api(FEEDS, '/articles/' + a.id, { method: 'PATCH', body: JSON.stringify({ leido: true }) }).then(() => cargarFeed()).catch(() => {});

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
      $('modal').classList.add('oculto');
      cargarFeed();
    } catch (e) { toast(e.message); }
  });
}

$('modalCerrar').addEventListener('click', () => $('modal').classList.add('oculto'));
$('modal').addEventListener('click', (e) => { if (e.target === $('modal')) $('modal').classList.add('oculto'); });

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
        <a href="${esc(a.link)}" target="_blank" rel="noopener">Original ↗</a></div>`;
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
        <a href="${esc(c.link)}" target="_blank" rel="noopener">Original ↗</a></div>`;
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
