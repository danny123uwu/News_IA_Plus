---
title: "Portal IA News"
subtitle: "Proyecto final — Presentación y recorrido de la aplicación"
author: "danny123uwu — Proyecto individual"
date: "26 de octubre de 2026"
lang: es
---

# Resumen de la entrega

**Repositorio público:** <https://github.com/danny123uwu/News_IA_Plus>

**Fecha límite informada en el aula:** lunes 26 de octubre de 2026 a las 23:59.
Debe confirmarse la zona horaria que muestre la plataforma.

Portal IA News es un agregador de noticias RSS con autenticación, fuentes
personalizadas y asistencia de inteligencia artificial. Se compone de tres
microservicios de negocio (Auth, Feeds y Agente), un frontend independiente y
un proxy inverso para su despliegue con Docker. Puede ejecutarse también sin
contenedores, y la IA puede ser local o de un proveedor externo.

**Autor:** danny123uwu. **Modalidad:** proyecto individual.

Este documento presenta la aplicación, cómo se utiliza y cómo están repartidas
sus responsabilidades. Al final incluye las capturas de su funcionamiento,
en el mismo orden de un recorrido de demostración.

## Lista de comprobación de la consigna

1. **Código fuente:** `services/auth/`, `services/feeds/`, `services/agent/`, `web/`.
2. **Modelo relacional:** diagrama, diccionario de datos y SQL vacío de ambas bases en `docs/`.
3. **README:** descripción y funciones de cada servicio, arquitectura y formas de ejecución actualizadas.
4. **Historial Git:** evolución del proyecto y commits del autor.
5. **Acceso:** el repositorio es público; no requiere invitación del docente mientras conserve esa visibilidad.

El archivo principal de evaluación es el **README de GitHub**, acompañado por
el código, los diagramas, los esquemas y las evidencias; no solo este documento.

---

# Objetivo, alcance y funcionalidades

## Problema que resuelve

Concentrar fuentes de noticias elegidas por el usuario, ordenar su lectura y
facilitar la comprensión mediante etiquetas, resúmenes y preguntas con contexto.
El usuario conserva control sobre sus fuentes y sobre el motor de IA.

## Funcionalidades implementadas

- Registro, inicio/cierre de sesión y perfil con preferencias persistentes.
- Catálogo de 152 entradas agrupadas en 16 categorías; búsqueda de portales.
- Alta, consulta, edición, pausa y eliminación de fuentes; detección automática del RSS.
- Importación de noticias, tolerancia a ciertos XML defectuosos y actualización periódica.
- Feed personalizado por prioridad de fuente, antigüedad e intereses.
- Búsqueda, portadas por medio, lectura de texto/multimedia del RSS y acceso al original.
- Leídos, favoritos, archivados, recortes y estadísticas.
- Resúmenes, clasificación, preguntas, digest y traducción con mecanismos de respaldo.
- Modelos locales por tarea, o Gemini, Claude, OpenAI, Groq, DeepSeek, OpenRouter y API compatible personalizada.
- Temas, tipografía, tamaño de lectura, color, iconos, idioma y aros de estado.
- Panel lateral de IA que no desplaza el artículo; espera visible y cancelación.

---

# Arquitectura de la solución

![Arquitectura real del despliegue](diagramas/arquitectura.png){width=95%}

**Auth (:3001):** registro/login, hash scrypt y JWT HS256 de 8 horas; perfil,
foto, idioma e intereses. Persiste en `auth.db`.

**Feeds (:3002):** administra fuentes, importa RSS y artículos, genera el feed,
gestiona estados y recortes y devuelve estadísticas. Persiste en `feeds.db`.

**Agente (:3003):** configura y selecciona el motor, llama al modelo local o
externo, clasifica, resume, responde y traduce. Guarda preferencias en `ia.json`.

**Web (:8090):** frontend HTML/CSS/JavaScript servido con Express. En Docker,
Nginx (:80) enruta las llamadas a cada microservicio. Las comunicaciones son
HTTP; las colas están en memoria y no existe un broker externo.

El despliegue permite seis servicios persistentes en el modo Docker habitual
y un inicializador que termina al preparar permisos. Ollama es opcional.

**Papel de Nginx:** es la entrada del navegador. Dirige las solicitudes al
servicio correspondiente para usar una sola dirección. Feeds y Agente se
comunican directamente dentro de Docker, sin volver a pasar por el proxy.

---

# Modelo relacional y persistencia

![Tablas reales y relaciones lógicas](diagramas/modelo-relacional.png){width=95%}

- `auth.db`: tabla `users` (identidad, hash, perfil y preferencias).
- `feeds.db`: `sources` (fuentes), `articles` (noticias y estados), `clips` (recortes).
- `ia.json`: preferencias de IA por usuario; no es una tabla SQL.
- `uploads/`: archivos de fotos; la tabla guarda el nombre, no el binario.

Las cuatro tablas tienen clave primaria entera autoincremental. Hay unicidad
de `users.email` y del par `articles(source_id,link)`.

**Importante:** los IDs que relacionan tablas son referencias lógicas. No hay
FK físicas declaradas en Feeds ni claves foráneas entre los archivos SQLite.
La aplicación realiza controles de propiedad mediante JWT y consultas. Al
eliminar una fuente se borran sus artículos, pero los recortes conservan una
instantánea y pueden mantener una referencia huérfana al artículo.

El diccionario completo y los scripts de estructura, sin filas de usuarios ni
noticias, están en `docs/modelo-relacional.md` y `docs/database/`.
Se verificaron columnas, tipos, valores iniciales e índices contra las bases reales.

---

# Cómo ejecutar y demostrar

La guía completa y vigente para Linux, Windows/WSL y macOS es el README.
Primero clonar el repositorio y preparar `.env` con un `JWT_SECRET` propio;
nunca copiar claves reales al informe o a GitHub.

## Linux: abrir el menú

```bash
./portal.sh
```

Elegir **Iniciar / actualizar** y abrir `http://localhost`. El mismo menú
permite apagar conservando datos, ver el estado y descargar modelos de IA.

## Windows: abrir el lanzador

Doble clic en **portal.bat**. Elegir ejecución con Node (sin Docker, puerto 8090)
o con Docker Desktop (puerto 80). La configuración inicial se prepara si no existe.
Sin Docker se requiere Node.js 24 LTS. Con Docker, el motor debe estar encendido.

## Compose manual y GPU

```bash
docker compose -f docker-compose.yml build web
docker compose -f docker-compose.yml up -d
```

Con NVIDIA configurada: añadir `-f docker-compose.gpu.yml` en ambos comandos.
El instalador `./portal.sh gpu` pide sudo y reinicia Docker; puede afectar otros proyectos.

## Modelos fuera de Docker

`./portal.sh motor host` seguido de `./portal.sh iniciar`. Configurar
`OLLAMA_HOST_URL` y una escucha del host accesible desde la red Docker, protegida
por firewall. Un servidor enlazado solo a `127.0.0.1` no es accesible desde bridge.
El lanzador valida la conexión antes de detener el contenedor de modelos.

## Sin Docker

```bash
npm ci
npm start
```

Abrir `http://localhost:8090`. Es modo de desarrollo. Para usar `.env` y secreto
propio: `node --env-file=.env start.js`; configurar `OLLAMA_URL` a localhost,
no al hostname de Docker. También pueden iniciarse los cuatro servicios por separado.

## Solo API externa

La API se configura en la pantalla IA, con listado y prueba de modelos antes
de guardar. Sin respaldo local no se llama a Ollama. Con Compose manual y la
sobrecapa `docker-compose.host.yml` se puede omitir su contenedor incluso sin
Ollama del host; el lanzador de modo host sí requiere un Ollama externo accesible.

---

# Pruebas de funcionamiento

## Resultados obtenidos

- **47 pruebas automatizadas aprobadas**, sin fallos.
- Prueba RSS real: Laboratorio Linux, The Verge, Xataka, Google Blog y Ars Technica correctos; también XML roto y sitio sin feed.
- Arranque nativo en copia aislada: cuatro healthchecks, registro, login, perfil, feed vacío y respaldo por reglas correctos.
- SQL de documentación: estructura e índices coinciden con las tablas reales, sin exportar datos.
- Docker: proxy y healthchecks de servicios responden HTTP 200. Los cuatro servicios Node tienen healthcheck; Nginx y Ollama no declaran uno en Compose.
- Navegador: cuenta demo, importación de dos fuentes y 42 noticias, lectura, resumen real por `llama3.2:3b`, archivo, recorte y panel de estadísticas.
- Se comprobó que abrir el panel de IA conserva posición, ancho y scroll del artículo.

Las pruebas de API externas son **simuladas**, no una validación de cuentas:
no hubo claves externas reales configuradas. El modo host no se presenta como
validado de extremo a extremo en este equipo. Véase `docs/verificacion.md`.

## Protección de los datos

Scrypt con sal, validación JWT, sentencias parametrizadas, filtros por
propietario, validación de imágenes, límites de peticiones y controles SSRF
para RSS. Los archivos privados se excluyen de Git.

Una respuesta de IA no es una comprobación de hechos. Las imágenes y noticias
de las capturas pertenecen a sus medios y se usan como evidencia académica.

---

# Historial, autoría y comprobación final

El historial de Git muestra la evolución del proyecto individual de
`danny123uwu`: incorporación de Docker y Nginx, mejoras de lectura, fuentes RSS,
personalización, integración de IA y documentación de la entrega.

## Antes de pulsar Presentar tarea

1. Abrir el repositorio de GitHub sin sesión y confirmar que es público.
2. Comprobar que aparecen el último README, `docs/`, el diagrama de arquitectura y el modelo relacional.
3. Abrir los archivos SQL y verificar que contienen estructura, no información privada.
4. Consultar la pestaña Commits y reconocer el historial de autoría individual.
5. Consultar el historial de cambios del proyecto.
6. Pegar el enlace del repositorio en el espacio de entrega del aula.
7. Presentar antes de las 23:59 según la hora de la plataforma y guardar el comprobante.

## Texto sugerido para el espacio de entrega

> Proyecto final individual: Portal IA News. Repositorio público:
> https://github.com/danny123uwu/News_IA_Plus
>
> El repositorio incluye el código de los microservicios, README con instrucciones
> de ejecución y arquitectura, modelo relacional con SQL de estructura, historial
> de commits y documentación de pruebas con capturas ordenadas de la aplicación.

El informe y las capturas no realizan por sí solos el envío en el aula virtual.

---

# Recorrido visual ordenado

Capturas reales de Firefox sobre la aplicación local el 26 de octubre de 2026.
Cuenta visible: **Demo Proyecto Final**, creada para estas evidencias. No se
muestran contraseñas, tokens, claves ni el perfil personal del autor. Al
terminar se pausaron sus fuentes para evitar importaciones de fondo adicionales.

## 01. Inicio de sesión

Punto de entrada. Auth valida credenciales y entrega un JWT para las operaciones protegidas.

![01 - Inicio de sesión](evidencias/01-inicio-sesion.png){width=95%}

---

## 02. Registro de usuario

Formulario de cuenta nueva. El backend valida nombre, correo y longitud de contraseña; guarda un hash scrypt, no la contraseña en texto plano.

![02 - Registro](evidencias/02-registro.png){width=95%}

---

## 03. Mis fuentes y catálogo

Pantalla para agregar URL de portal o RSS. El catálogo tiene búsqueda y categorías; los datos pertenecen al usuario autenticado.

![03 - Fuentes y catálogo](evidencias/03-fuentes-catalogo.png){width=95%}

---

## 04. Búsqueda del catálogo

Filtro por Linux. La interfaz permite encontrar portales sin memorizar sus direcciones de RSS.

![04 - Búsqueda de portales](evidencias/04-catalogo-buscador.png){width=95%}

---

## 05. Fuentes agregadas

3DJuegos y HardZone se importaron mediante la aplicación, con 27 y 15 noticias respectivamente. Las cifras son una instantánea de la prueba.

![05 - Fuentes registradas](evidencias/05-fuentes-agregadas.png){width=95%}

La etiqueta superior de Gemini en esta fase corresponde a una configuración
temporal sin clave para evitar generar trabajo local durante la importación;
no es evidencia de una llamada exitosa a esa API.

---

## 06. Feed personalizado

Noticias reales con medio, fecha, autor, etiquetas y acciones. El feed muestra las 42 noticias importadas de la cuenta demo.

![06 - Para Ti](evidencias/06-feed-personalizado.png){width=95%}

---

## 07. Prioridades de fuentes

Los controles ajustan la prioridad de cada portal entre 1 y 5; la prioridad influye en el orden del feed.

![07 - Prioridades](evidencias/07-prioridades.png){width=95%}

---

## 08. Portada por medio

Al pulsar una burbuja se presenta la portada de esa fuente. No se pierde la posibilidad de volver a todas las fuentes.

![08 - Portada](evidencias/08-portada-fuente.png){width=95%}

---

## 09. Lectura de una noticia

El modal muestra el contenido del RSS y multimedia, y mantiene visibles las acciones. No se garantiza que el RSS incluya el artículo completo.

![09 - Lectura](evidencias/09-lectura-noticia.png){width=95%}

---

## 10. Espera de inteligencia artificial

Solicitud real en curso: el cronómetro informa la espera y el panel puede cerrarse para cancelar. El artículo conserva su posición.

![10 - Generación en curso](evidencias/10-ia-generando.png){width=95%}

---

## 11. Resumen generado por el modelo local

Respuesta real identificada como `ollama:llama3.2:3b`, con introducción y puntos clave. No se sustituyó por texto de demostración ni por una respuesta simulada.

![11 - Resumen real](evidencias/11-resumen-ia-real.png){width=95%}

Se debe contrastar su contenido con la noticia original; la generación no prueba veracidad.

---

## 12. Archivo y recortes

Noticia archivada y fragmento guardado desde la lectura. El recorte conserva su texto y el enlace al medio.

![12 - Archivados y recortes](evidencias/12-archivo-recortes.png){width=95%}

---

## 13. Panel de estadísticas

Totales y distribución por fuente/etiqueta, obtenidos de Feeds para la cuenta demo. Las barras son CSS, no un servicio analítico externo.

![13 - Estadísticas](evidencias/13-panel-estadisticas.png){width=95%}

---

## 14. Perfil y temas

Datos de demostración y selector de apariencia. Las preferencias pueden guardarse en la cuenta, no solo en el navegador.

![14 - Perfil y temas](evidencias/14-perfil-temas.png){width=95%}

---

## 15. Ajustes de lectura

Tipografía, tamaño y color del texto y tamaño de iconos. Son opciones de personalización; no se afirma cumplimiento de una auditoría WCAG.

![15 - Texto e iconos](evidencias/15-accesibilidad.png){width=95%}

---

## 16. Configuración de IA local

Selección del motor Ollama y modelos por tarea. El panel detecta los modelos instalados y permite descargar los recomendados.

![16 - Motor local](evidencias/16-ia-local.png){width=95%}

---

## 17. Configuración de API externa

Selección de proveedor, URL base, modelo, clave privada y botones de listado/prueba. Se muestra sin clave: no demuestra acceso a una cuenta externa.

![17 - API externa](evidencias/17-api-externa.png){width=95%}

---

## 18. Opción Claude / Anthropic

La selección carga sus datos de proveedor; el backend usa el protocolo nativo Messages. La compatibilidad se verificó con contratos simulados, no con saldo real.

![18 - Claude](evidencias/18-api-claude.png){width=95%}

---

## 19. Vista de ancho reducido

Firefox con ventana estrecha para observar el comportamiento adaptable: navegación desplazable, buscador y tarjetas. No representa pruebas exhaustivas en dispositivos físicos.

![19 - Vista estrecha](evidencias/19-vista-movil.png){height=15cm}

---

## 20. Pregunta contextual a la IA

Respuesta generada sobre una noticia importada. La automatización introdujo la pregunta en la interfaz; la respuesta procede del modelo local real.

![20 - Pregunta real](evidencias/20-pregunta-ia-real.png){width=95%}

---

## 21. Digest del día

El botón solicita al Agente un resumen de la lista de noticias enviada por el frontend. No es una verificación editorial ni una consulta a todas las noticias de Internet.

![21 - Digest](evidencias/21-digest-dia.png){width=95%}

---

## 22. Tema claro

La misma aplicación con una apariencia alternativa, elegida desde su selector real sin alterar los datos de noticias.

![22 - Tema claro](evidencias/22-tema-claro.png){width=95%}

---

## 23. Estado del servicio Agente

Respuesta real del endpoint público de diagnóstico. La disponibilidad local no acredita que una clave de API externa sea válida.

![23 - Health del agente](evidencias/23-health-agente.png){width=95%}

# Referencias de la entrega

Código y documentación: https://github.com/danny123uwu/News_IA_Plus

Noticias de las capturas: https://www.3djuegos.com/ y https://hardzone.es/.
Recursos técnicos: documentación oficial de Node.js, Docker, SQLite, Ollama y
los proveedores descritos. La consigna del aula fue proporcionada por el autor.
