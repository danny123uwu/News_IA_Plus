# Resultados de verificación de la entrega

Fecha de ejecución: 26 de octubre de 2026. Las pruebas se realizaron en el
equipo local del autor; no son una prueba de carga ni de disponibilidad futura.

| Verificación | Resultado | Evidencia |
|---|---|---|
| Suite automatizada | 64 pruebas, 64 aprobadas, 0 fallos | [Salida completa](evidencias/pruebas-automatizadas.txt) |
| RSS real | Cinco sitios respondieron con feed y noticias | [Salida de integración](evidencias/pruebas-rss-red.txt) |
| XML roto / sitio sin feed | Rescate y error comprensible, ambos correctos | Mismo archivo de integración RSS |
| SQL de documentación | Columnas, tipos, defaults e índices coinciden con las bases reales | [Comparación](evidencias/verificacion-esquema.txt) |
| Arranque nativo aislado | Cuatro healthchecks, registro, login, perfil y feed vacío correctos | [Prueba nativa](evidencias/prueba-nativa.txt) |
| Nativo sin IA | Respaldo por reglas correcto | Mismo archivo de prueba nativa |
| Despliegue Docker | Servicios Node sanos, proxy y healthchecks HTTP 200 | [Estado del despliegue](evidencias/despliegue-docker.txt) |
| Flujo web real | Login con cuenta demo, importar dos fuentes y 42 noticias, consultar feed, leer, resumir, recortar y archivar | [Capturas](entrega-final.md#recorrido-visual-ordenado) |
| Resumen real | `ollama:llama3.2:3b`, no respaldo simulado | Capturas 10–11; respuesta HTTP 200 observada |
| Panel sin desplazar artículo | Mismo rectángulo y scroll antes/después de abrir panel | [Manifiesto](evidencias/manifest.json) |
| APIs externas | Siete protocolos/opciones probados con fetch simulado | `tests/providers.test.js` y suite |
| API sin clave en portal real | Rechazo y mensajes, sin modificar configuración original | Prueba HTTP de las rutas de configuración durante la revisión |
| OAuth HTTP real | Registro/login y canje PKCE; token aceptado por los tres servicios; permisos insuficientes 403 | [Integración](evidencias/oauth-integracion.txt) |
| OAuth desde Firefox con Docker | Registro, redirección, canje, perfil, logout y nuevo login reales | [Navegador Docker](evidencias/oauth-navegador-docker.txt) |
| OAuth desde Firefox sin Docker | Mismo flujo real entre los puertos 8090 y 3001, con cookies/CORS | [Navegador nativo](evidencias/oauth-navegador-nativo.txt) |

## Alcance y límites de los resultados

- Las capturas son PNG de Firefox contra **http://localhost**, no maquetas.
  La automatización suministró entradas a la cuenta demo; no reemplazó las
  respuestas HTTP ni el texto generado por IA.
- El resumen real fue generado sobre una noticia importada del RSS de 3DJuegos.
  El contenido generado no se considera factual sin contrastarlo con el medio.
- Las noticias e imágenes de las capturas pertenecen a los medios indicados.
  Se muestran con finalidad de evidencia académica; no se distribuye una base
  de noticias ni se atribuye al proyecto la autoría de esos contenidos.
- Se usó una cuenta de demostración ficticia; no se capturaron contraseñas,
  API keys, JWT, el perfil personal del autor ni bases de datos.
- Al terminar, las dos fuentes de la cuenta demo se pausaron para no generar
  trabajo de fondo adicional. Las fuentes/cuenta original no se editaron.
- El arranque nativo se probó en una copia temporal con bases nuevas, sin usar
  los archivos originales ni detener el despliegue Docker.
- La validez de claves, el saldo y el acceso a modelos externos **no están
  verificados** porque no se proporcionaron credenciales reales.
- No se reinstaló el toolkit ni se cambió la escucha/firewall del Ollama del
  host para esta entrega. La ruta host se documenta, pero no se presenta como
  un extremo a extremo validado en este equipo (escucha local inaccesible desde bridge).
- La suite comprueba unidades y contratos específicos, no una cobertura del
  100 % de la aplicación. No se afirma certificación ISO ni ausencia de fallos.

## Repetición básica

```bash
npm ci
npm test
npm run test:feeds
./portal.sh estado
curl http://localhost/auth/health
curl http://localhost/feeds/health
curl http://localhost/agente/health
```

Las respuestas de sitios externos y sus cantidades de noticias cambian con el tiempo.

## Revisión de los lanzadores

El menú de Linux se comprobó con `bash -n portal.sh` y una ejecución de entrada/salida.
El nuevo `portal.bat` se comprobó en Wine con el intérprete `cmd`: muestra su
ayuda y menú y permite salir. Esto no sustituye una prueba de arranque completo
con Node o Docker Desktop en Windows real; ese escenario no se ejecutó en este equipo Linux.
