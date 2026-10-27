# Catálogo de rutas HTTP

Rutas verificadas contra los `app.get/post/put/patch/delete` del código.
En Docker, anteponer el prefijo de Nginx. En nativo usar el puerto del servicio
sin prefijo. Salvo health, registro, login y estáticos públicos, se requiere
`Authorization: Bearer <JWT>`. No pegar JWT reales en informes públicos.

## Auth — :3001 / prefijo `/auth`

| Método | Ruta del servicio | Función |
|---|---|---|
| GET | /health | Estado de proceso |
| POST | /register | Crear cuenta y sesión HttpOnly: email, password y nombre |
| POST | /login | Crear sesión de autorización: email y password |
| GET | /authorize | OAuth 2.0 Authorization Code con PKCE S256 |
| POST | /token | Canjear código/verificador por access_token JWT |
| POST | /logout | Cerrar sesión de autorización |
| GET | /me | Perfil público del usuario autenticado |
| PUT | /me | Actualizar nombre, intereses, idioma y preferencias visuales |
| POST | /me/foto | Subir imagen base64 validada |
| GET | /uploads/:archivo | Imagen de perfil estática; acceso público al archivo |

## Feeds — :3002 / prefijo `/feeds`

| Método | Ruta del servicio | Función |
|---|---|---|
| GET | /health | Estado de proceso |
| GET | /taxonomy | Categorías disponibles |
| POST | /feeds/test | Detectar/probar RSS de una URL sin agregar fuente |
| GET | /feeds | Fuentes del usuario |
| POST | /feeds | Agregar fuente e importar noticias |
| PUT | /feeds/:id | Nombre, activo y prioridad |
| DELETE | /feeds/:id | Eliminar fuente y sus artículos |
| POST | /feeds/refresh | Refrescar fuentes activas del usuario |
| GET | /articles | Lista: estado, fuente, tag, q, archivado, limit y offset |
| GET | /articles/:id | Detalle con HTML RSS |
| GET | /feed | Para Ti: horas, intereses y q |
| PATCH | /articles/:id | leido, favorito, archivado y saltado |
| POST | /articles/:id/clip | Guardar fragmento y nota |
| GET | /clips | Recortes del usuario |
| DELETE | /clips/:id | Borrar recorte propio |
| GET | /stats | Estadísticas por usuario |

Ejemplo importante: la lista de fuentes en Docker es **`/feeds/feeds`**, y el
refresco es **`/feeds/feeds/refresh`**. El primer `feeds` es prefijo del proxy.
No confundirlo con el servicio ni con el feed personalizado `/feeds/feed`.

## Agente — :3003 / prefijo `/agente`

| Método | Ruta del servicio | Función |
|---|---|---|
| GET | /health | Disponibilidad local observada y modelos automáticos |
| GET | /config | Preferencias sin exponer clave completa, proveedores y modelos |
| PUT | /config | Guardar preferencias del usuario |
| POST | /config/test | Probar motor con respuesta breve sin guardar |
| POST | /config/models | Consultar modelos del proveedor con clave |
| POST | /model/pull | Descargar modelo Ollama |
| POST | /classify | Etiquetas por IA o reglas |
| POST | /classify-batch | Clasificar lote de noticias |
| POST | /summarize | Resumen de titulo y texto |
| POST | /digest | Resumen de la lista articulos recibida |
| POST | /ask | Responder pregunta con contexto de noticia |
| POST | /spanish | Traducir titulo/texto |
| POST | /spanish/bloques | Traducir fragmentos con servicios gratuitos |

## Web y proxy

Web :8090 expone `/health` y los archivos de `web/public/`. Nginx :80 expone
`/proxy-health`; es solo un indicador del proxy, no una prueba de las dependencias.

## Ejemplo de demostración sin secretos publicados

En Postman, crear `baseUrl=http://localhost`; completar [el flujo OAuth](oauth.md#probar-con-postman)
y guardar `access_token` únicamente en una variable privada de Postman.
Configurar Bearer Token. Luego:

```text
GET  {{baseUrl}}/auth/me
GET  {{baseUrl}}/feeds/feeds
GET  {{baseUrl}}/feeds/feed
GET  {{baseUrl}}/feeds/stats
POST {{baseUrl}}/agente/summarize
Body JSON: {"titulo":"Noticia de prueba","texto":"Un servicio procesa noticias RSS y guarda los artículos. La interfaz permite consultarlos."}
```

Sin IA disponible, las rutas con respaldo pueden devolver `motor: "reglas"`
y aviso: HTTP 200 no significa que haya respondido un proveedor de modelos.
