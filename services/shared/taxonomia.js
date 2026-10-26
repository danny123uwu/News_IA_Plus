'use strict';
// Taxonomía y clasificador por reglas compartido por feeds y agente.
// Evita tener dos listas de etiquetas que se desincronicen.

const TAXONOMIA = [
  'Inteligencia Artificial', 'Ciberseguridad', 'Sistemas Operativos',
  'Desarrollo Web', 'Programación', 'Bases de Datos', 'Móviles',
  'Nube (Cloud)', 'DevOps', 'Redes', 'Hardware', 'Software',
  'Lanzamientos', 'Actualizaciones', 'Herramientas', 'Open Source',
  'Ciencia de Datos', 'Robótica', 'Espacio', 'Ciencias',
  'Videojuegos', 'eSports', 'Economía', 'Empresas', 'Educación',
  'Deportes', 'Cine y Series', 'Música', 'Política', 'General'
];

const REGLAS = [
  ['Inteligencia Artificial', /(^|[^a-zá])ia([^a-zá]|$)|inteligi|llm|gpt|openai|deepseek|gemini|copilot|machine learning|modelo de lenguaje|chatbot|neural/],
  ['Ciberseguridad', /vulnerab|cve-|ransomware|malware|phishing|hack|brecha|cifrado|exploit|zero.?day|insegur/],
  ['Sistemas Operativos', /linux|kernel|ubuntu|debian|fedora|arch linux|windows 1[012]|macos|distro|gnome|kde|wayland/],
  ['Desarrollo Web', /react|angular|vue|svelte|next\.?js|nuxt|django|laravel|rails|frontend|backend|javascript|typescript|web ?dev|wordpress/],
  ['Programación', /programad|código|codigo|python|rust|golang|c\+\+|compilador|algoritmo|scripting/],
  ['Bases de Datos', /base de datos|sql|postgres|mysql|mongodb|redis|sqlite|oracle/],
  ['Móviles', /android|iphone|ios\b|smartphone|aplicación móvil|app móvil|pixel|galaxy|play store|app store/],
  ['Nube (Cloud)', /cloud|nube |aws|azure|google cloud|servidor|hosting|kubernetes|contenedor/],
  ['DevOps', /devops|ci\/cd|pipeline|docker|jenkins|terraform|ansible|despliegue|deploy/],
  ['Redes', /wifi|5g|internet|isp|banda ancha|router|fibra óptica|starlink/],
  ['Hardware', /gpu|cpu|nvidia|amd |intel |ryzen|radeon|tarjeta gráfica|monitor|ssd|portátil|laptop|procesador|memoria ram/],
  ['Software', /software|aplicación|navegador|chrome|firefox|edge|vs ?code/],
  ['Lanzamientos', /lanz|estrena|disponible|nueva versión|release|anuncia|presentó|debut/],
  ['Actualizaciones', /actualiz|update|parche|patch|hotfix|corrig/],
  ['Herramientas', /herramienta|terminal|editor|plugin|extensión|librería|sdk/],
  ['Open Source', /open source|código abierto|opensource|comunidad de código/],
  ['Ciencia de Datos', /data s|analytics|estadíst|big data|visualización de datos/],
  ['Robótica', /robot|robót|dron/],
  ['Espacio', /nasa|espacio|astronáut|cohete|satélite|marte|spacex|orbital/],
  ['Ciencias', /cienc|física|biolog|investigac|científic/],
  ['Videojuegos', /juego|gaming|steam|playstation|xbox|nintendo|consola|gameplay|trailer|epic games/],
  ['eSports', /esport|torneo|competic|campeonato|liga de/],
  ['Economía', /econom|mercado|inflaci|cripto|bitcoin|dólar|bolsa|inversión|financ/],
  ['Empresas', /empresa|google|microsoft|apple|meta|amazon|tesla|startup|ceo|despid|adquisi/],
  ['Educación', /educac|beca|universidad|escuela|curso|certific|academ/],
  ['Deportes', /fútbol|futbol|nba|nfl|tenis|olímpic|gol |liga /],
  ['Cine y Series', /película|pelicula|serie |netflix|hbo|disney\+|actor|tráiler/],
  ['Música', /música|musica|álbum|album|artista|gira|concierto|spotify/],
  ['Política', /polític|gobierno|elecc|senado|president|congreso/]
];

function clasificarPorReglas(titulo, texto) {
  const t = ((titulo || '') + ' ' + (texto || '')).toLowerCase();
  const tags = REGLAS.filter(([, re]) => re.test(t)).map(([x]) => x);
  return tags.length ? tags.slice(0, 4) : ['General'];
}

module.exports = { TAXONOMIA, REGLAS, clasificarPorReglas };
