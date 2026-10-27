# Arquitectura y decisiones de diseño

![Diagrama de arquitectura](diagramas/arquitectura.png)

## Vista de componentes

Tres microservicios de negocio (Auth, Feeds, Agente) y un servidor Web
independiente. Comparten lenguaje y utilidades, pero se comunican por HTTP y
pueden iniciarse como procesos separados o contenedores separados. Compartir
imagen Docker no significa compartir proceso. Nginx no implementa negocio.

- **Auth:** Express + SQLite + scrypt + OAuth 2.0 (`@node-oauth/oauth2-server`).
  Authorization Code con PKCE S256 emite un access token JWT HS256 de 8 horas.
- **Feeds:** Express + SQLite + rss-parser. Administra sus datos; no consulta auth.db.
- **Agente:** Express, clientes fetch y configuración JSON por usuario. No abre feeds.db.
- **Web:** Express estático y JavaScript del navegador. No accede a archivos de base.
- **Biblioteca shared:** helpers de entorno, HTTP, clasificación, concurrencia y URLs seguras.

## Flujo de extremo a extremo

1. Registro/login crea una sesión HttpOnly; el navegador completa `/authorize`
   → redirección con código → `/token` con PKCE y comprobación de `state`.
2. OAuth entrega el access token JWT. Los servicios validan firma, caducidad,
   emisor, destinatario y los permisos del recurso solicitado.
3. Usuario añade URL de portal; Feeds detecta RSS/Atom o feed WordPress cuando existe.
4. Feeds descarga con controles de URL, tamaño y tiempo; convierte y guarda noticias.
5. Clasifica primero por reglas; encola refinamiento por IA y traducción.
6. La llamada de servicio al Agente incluye JWT con rol `servicio` y `userId` del propietario.
7. Agente selecciona la configuración del propietario y el motor local/API permitido.
8. Feed devuelve tarjetas sin HTML pesado. Al abrir una noticia pide su detalle.
9. Resumir/preguntar solicita generación y la muestra en un panel fijo lateral;
   cerrar el panel cancela la solicitud y la inferencia cuando el motor lo admite.

## Dos despliegues y tres caminos de IA

- **Docker:** navegador → Nginx :80 → servicios internos. Solo se publica 80.
- **Nativo:** navegador → Web :8090 y llamadas directas a localhost:3001–3003.
- **IA local en Docker:** agente → `ollama:11434`, CPU o NVIDIA según sobrecapa.
- **IA local en host:** agente Docker → URL accesible del host; Ollama no se inicia en Docker.
- **IA externa:** agente → proveedor; se utiliza Ollama únicamente si se habilita respaldo local.

El modo nativo actual está pensado para `localhost`: el frontend construye
literalmente esos hosts para los tres puertos. Para exposición remota habría
que configurar URLs, CORS, TLS y controles adicionales; no basta cambiar la IP.

## Persistencia y concurrencia

Ver [modelo relacional](modelo-relacional.md). Bases separadas por responsabilidad,
pero montadas físicamente bajo `data/` en este despliegue. El volumen Docker
`ollama_modelos` es independiente. `init-datos` resuelve permisos UID/GID 1000.

No hay RabbitMQ, Kafka, Redis ni un scheduler externo. Los temporizadores,
colas, cachés y rate limits viven en memoria de cada proceso. Refresco inicial
y cada 15 minutos; clasificación en lotes; repaso de traducciones pendientes de
15 artículos recientes cada 10 minutos, concurrencia 1. La importación de
noticias nuevas también encola traducciones: no es un límite global de 15.
Si el proceso reinicia, se pierde la cola en memoria.

## Decisiones y límites

SQLite facilita una entrega reproducible sin servidor de base externo, con WAL
e índices. No se demuestra alta disponibilidad ni escalado horizontal. JWT
compartido simplifica autenticación entre servicios, pero requiere proteger el
secreto; cerrar la sesión OAuth no revoca inmediatamente un JWT ya emitido. La IA tiene respaldo por reglas en
clasificación/resumen, no garantiza veracidad ni una latencia fija.

Las mejoras de seguridad observadas son prácticas técnicas, no una certificación
ISO 25010/25000. Ver [revisión técnica y pendientes](revision-tecnica.md).
