# Revisión técnica para la entrega

Fecha: 26 de octubre de 2026. Revisión del código fuente propio versionado,
configuración de despliegue, pruebas e interfaz; no de las implementaciones
internas de `node_modules`, el entorno Python local ni modelos descargados.
Es una revisión de ingeniería y evidencia de ejecución, **no una certificación**
ni una promesa de que no existan defectos.

## Matriz frente a la consigna recibida

| Exigencia del aula | Evidencia publicada | Observación |
|---|---|---|
| Código de todos los microservicios | `services/auth`, `services/feeds`, `services/agent`, `web` | Negocio separado de clientes IA y utilidades compartidas |
| Estructura de BD / modelo relacional | `docs/modelo-relacional.md`, imagen y SQL vacío de ambas bases | Se explican relaciones lógicas sin fingir FK físicas |
| README con descripción y funcionalidades de cada microservicio | Tabla del README y `docs/api.md` | Incluye puertos, responsabilidades y rutas |
| Diagrama de arquitectura | README, `docs/arquitectura.md`, `docs/diagramas/` | Incluye proxy, bases, IA local/externa y RSS |
| Commits de integrantes | Historial Git | El usuario confirmó que es individual; solo se atribuye al autor real |
| Estructura de commits vista en clase | Nuevos commits `tipo(ámbito): descripción` | No se recibió esa norma de clase; cotejo exacto pendiente del estudiante |
| Enlace de repositorio | README e informe | El repositorio es público; no requiere invitación de acceso |

La consigna no entrega una rúbrica técnica más detallada ni los requisitos de
una propuesta inicial. No se puede afirmar cumplimiento de requisitos no
proporcionados. Los puntos de la lista siguiente son valor adicional, no
obligaciones inventadas del curso. La calificación corresponde al docente.

## Módulos revisados y responsabilidad

| Componente | Archivos / áreas | Hallazgos principales |
|---|---|---|
| Arranque/despliegue | start.js, portal.sh, Dockerfile y tres Compose | Nativo y contenedores; selector de host; GPU por sobrecapa; imagen compartida |
| Auth | index.js, password.js, validacion.js | scrypt, JWT HS256, controles de entrada, imágenes por firma, perfil y preferencias |
| Feeds | index.js, rss.js | Aislamiento por usuario, SQL parametrizado, índices, parser tolerante y descubrimiento |
| IA | index.js, config.js, ai/*.js | Configuración individual, cola local, proveedores nativos/compatibles y respaldos |
| Shared | env.js, http.js, url-segura.js, async.js, taxonomia.js | Entorno, límites, lectura acotada, SSRF y concurrencia |
| Frontend | index.html, app.js, style.css, catalogo.js, imágenes | SPA sin framework, flujo RSS, personalización, modal, panel IA fijo y diseño adaptable |
| Operación | scripts/*.sh, scripts/probar-feeds.js, Nginx | Instalador NVIDIA específico de Arch; diagnóstico y pruebas de terceros |
| Pruebas | tests/*.test.js | Auth, reglas, RSS, SSRF y contratos de proveedores con fetch simulado |

## Lo que sí está implementado

- Registro/login y perfil propio con foto, temas, idioma e intereses.
- Fuentes RSS con CRUD, catálogo y descubrimiento; importación inicial y periódica.
- Feed con preferencias de fuente, tiempo y etiquetas, búsqueda y portadas.
- Lectura con multimedia disponible en el RSS; no scraping completo del original.
- Favoritos, leídos, archivo, recortes y estadísticas con barras CSS.
- Clasificación por reglas/IA, resumen, preguntas y digest.
- Traducción por Google/MyMemory y motor configurado según la ruta.
- Selección de modelos por tarea y siete opciones de proveedor externo.
- Contratos de API externos verificados con respuestas simuladas; Claude nativo.
- Panel IA sin reflujo del artículo, cancelación y avisos de respaldo.
- Separación de servicios y despliegue reproducible, SQL vacío y diagramas.

## Límites que deben explicarse en la defensa

1. **OAuth 2.0 + JWT.** Auth implementa Authorization Code con PKCE S256 mediante
   `@node-oauth/oauth2-server`. El token solo se emite tras `/authorize` y
   `/token`. No se emiten refresh tokens; salir cierra la sesión OAuth y borra
   el token del navegador, sin revocar de inmediato los JWT ya emitidos.
2. **Integridad referencial parcial.** No hay FK físicas entre tablas de Feeds;
   los recortes conservan instantáneas y pueden quedar con `article_id` huérfano.
3. **API externa no equivale a cuenta validada.** No hay claves reales en esta
   revisión; el usuario debe probar permisos, cuota y modelo en su proveedor.
4. **IA no verifica veracidad.** Puede inventar o repetir. La detección de bucles
   es heurística; un respaldo extractivo no es una respuesta generativa real.
5. **Rendimiento local variable.** GPU no quita toda la CPU. Cambiar de modelo,
   cargarlo y generar tokens introduce latencia; no se publica un SLA.
6. **Traducción no contractual.** Algunos endpoints gratuitos pueden cambiar,
   bloquear IPs o tener límites; la heurística de idioma no es un detector robusto.
   `/spanish/bloques` usa servicios gratuitos, no el motor de IA elegido.
7. **Persistencia local.** SQLite síncrono puede bloquear el proceso bajo carga;
   los rate limits, colas y cachés son locales y se pierden al reiniciar.
8. **Retención ilimitada por edad.** No hay purga automática ni cuota de almacenamiento.
   El filtro de tiempo limita visualización, no el almacenamiento.
9. **Nativo pensado para localhost.** Usa URLs locales fijas para APIs; requiere
   adaptación para operar remotamente y no lee `.env` con `npm start` a secas.
10. **Seguridad no completa.** HTTP sin TLS por defecto, token en sessionStorage y
    clave externa en JSON privado sin cifrado de aplicación. Los permisos 600
    no protegen contra un proceso comprometido con acceso al mismo usuario.

## Mejoras priorizadas (no se presentan como realizadas)

| Prioridad | Mejora | Justificación / ubicación |
|---|---|---|
| Alta | Escapar/sanear de forma robusta el Markdown de IA antes de innerHTML | `mdAHtml` formatea cadenas sin escapar primero HTML; datos del modelo no son confiables |
| Alta | Endurecer conexiones de API contra DNS rebinding en la conexión real | providers.js valida DNS previamente, pero fetch no usa `lookupSeguro`; RSS sí lo usa |
| Alta | TLS, gestión segura de sesión y secretos, validación reforzada del secreto de ejemplo | No se debe exponer públicamente tal cual; resolverSecreto no detecta todos los textos de plantilla |
| Media | Pruebas E2E automáticas versionadas y pruebas de integración de APIs con cuentas de prueba | Las capturas manuales no sustituyen cobertura automatizada ni prueban saldo |
| Media | Corregir botón Agregar fuente tras un alta exitosa | Puede conservar disabled hasta recargar; el catálogo ofrece botones independientes |
| Media | Invalidar estadísticas también al importar/eliminar fuentes | Caché actual de 20 segundos puede mostrar valores anteriores |
| Media | Alinear el destino exacto de Nginx para refrescos largos | La ruta real pública es `/feeds/feeds/refresh`; la excepción `/feeds/refresh` no la cubre |
| Media | FKs dentro de Feeds y política explícita para recortes; migración con pruebas | Evitar inconsistencias sin introducir relaciones SQL entre servicios |
| Media | Colas persistentes, observabilidad y configuración de puertos/hosts | Recuperación después de reinicio y facilidad de despliegue |
| Baja | CSV/OPML, admin, alertas, verificación y accesibilidad auditada | Ampliaciones futuras, no funciones actuales |

Las mejoras altas no se deben ocultar para aparentar una auditoría aprobada.
La versión se entrega como aplicación académica local, con estos límites
documentados y sin subir usuarios, bases, claves o contraseñas reales.

## Historial y autoría

La revisión inicial contó 15 commits, todos bajo `danny123uwu`. El usuario
confirmó modalidad individual. Hay mensajes de varias épocas, incluido uno
`IA: ...` que no sigue Conventional Commits y otro `doc: ...`.
No se hizo amend/rebase ni se atribuyeron commits ficticios. Los commits nuevos
de documentación conservan el formato `docs(entrega): descripción`.

Para verificar:

```bash
git shortlog -sn HEAD
git log --format="%h %ad %an %s" --date=short
git log origin/main..HEAD --oneline
```

La modalidad individual y los aportes reales permiten explicar el requisito
de integrantes; la aceptación y el formato exacto de clase dependen del docente.
