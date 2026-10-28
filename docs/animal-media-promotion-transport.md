# Ensayos de transporte S3 de promociones sin red

Subbloque 35, 2026-10-27, base `d6a184e`. Contrato registrado antes del código;
ensayos implementados/ejecutados sin infraestructura real.
Alcance: cliente S3/serialización/firma/middleware/retry/deserialización instalados,
con request handler falso y pruebas acotadas del NodeHttpHandler con https.request
falso. Sin SDK.send simulado, sockets, AWS/Mongo/Docker, .env o AppModule.

El conteo se distingue por capa: client.send, invocación del request handler y
petición nativa simulada. Ninguno prueba por sí solo un efecto remoto completado.
Se ensayan respuestas 503/errores transitorios, error XML dentro de HTTP 200,
límites de intentos, errores terminales, redirección regional y middleware que
reenvía. maxAttempts=1 no constituye garantía universal de un solo envío.

Los probes de permisos son callbacks sintéticos SOLO de test: verificar denegación
antes del sink, nueva invocación por retry/redirección y revocación después de un
permiso. No usar una autorización encontrada como permiso de envío ni inferir
rollback de un error. Un permiso ya concedido puede producir envío tras revocar.

La posición candidata es envolver el request handler por debajo de middleware y
retry, solo con un handler subyacente fijado/verificado que no reenvíe internamente.
Un handler arbitrario puede duplicar envíos dentro de una sola invocación; se
incluye un contraejemplo. La cobertura es de escenarios finitos/versiones locales,
no prueba de todos los entornos, red, proxies o futuras versiones.

Se mantiene producción intacta. No se conecta el puerto de persistencia ni se
autoriza dispatch por efecto. Contexto/opt-in del 34 no son capacidad de envío.
Callers legacy, ticket/sellado concurrente, otros writers, cobertura/retención,
corte estable y commit conjunto siguen pendientes. Transferencia deshabilitada,
guarda inicial/V1 y decisiones funcionales conservadas. Impacto central en
[la guía frontend](./frontend-animal-transfer-foundations.md).

## Implementación y versiones comprobadas

[Fixture](../test/animal-transfer/fixtures/s3-promotion-transport.fixture.ts) y
[suite](../test/animal-transfer/infrastructure/s3-promotion-transport.spec.ts)
usan el cliente instalado y respuestas XML/streams sintéticos; no reemplazan
client.send. El request handler falso no tiene fallback de red. Una guarda de
net.Socket.prototype.connect falla ante cualquier conexión y exige cero llamadas
en cada caso; se restaura con los demás mocks en finally. No hay servidor local.

| Componente resuelto desde client-s3 | Versión observada |
| --- | --- |
| @aws-sdk/client-s3 | 3.1003.0 |
| @aws-sdk/middleware-sdk-s3 | 3.972.18, copia anidada dentro de client-s3/node_modules |
| @smithy/middleware-retry | 4.4.39 |
| @smithy/node-http-handler | 4.9.7 |
| @smithy/util-retry | 4.2.11 |

Se resolvieron los paquetes desde client-s3 con createRequire, sin suponer que la
copia raíz de middleware-sdk-s3 fuera la ejecutada. Inspección de retryMiddleware,
regionRedirectMiddleware/throw200ExceptionsMiddleware, resolveMiddleware y
NodeHttpHandler.handle en los paquetes locales. No se consultó/actualizó el registry.
Estos resultados deben revalidarse al actualizar dependencias/runtime/configuración.

Clientes de test: credenciales sintéticas, región explícita, defaultsMode/retryMode
standard y maxAttempts 1 o 3 según caso. ConfiguredRetryStrategy conserva su
clasificación/cuota/bucle y fija backoff cero para rapidez; no mide demoras reales.
Región, FIPS/dualstack, checksums y otros providers usados por el fixture se fijan
explícitamente. Producción no usa esa configuración nueva. En los tres ensayos
del adaptador se sustituye su campo client SOLO en el test por un S3Client real
con handler falso; sus métodos/send no se stubbean. El cliente construido por
el constructor se destruye sin enviar. No se inspeccionan ni loguean credenciales
reales; eventos guardan solo método/host/path/condiciones/header de ordinal sintéticos.

## Veintiocho resultados observados

| Casos | Comprobación |
| --- | --- |
| 1 | CopyObject serializa PUT y mantiene origen/versionId/IfMatch e IfNoneMatch `*`. |
| 2–5 | HTTP 503 SlowDown, XML Error dentro de 200, reset y TimeoutError producen dos llamadas al handler, ordinales 1/2 y mismas condiciones. |
| 6 | HTTP 200 vacío se rechaza como InternalError; en ESTA versión/configuración no se reintenta, metadata.attempts=1. No implica rollback remoto. |
| 7–10 | 412/403 no reintentados; límite efectivo 1/3 comprobado para un bucle de retry agotado. |
| 11–12 | Redirección deshabilitada: un envío; habilitada con maxAttempts=1: dos llamadas al handler, destino regional nuevo, región del cliente restaurada y metadata.attempts=1. |
| 13–15 | Middleware sintético que llama next dos veces, dos sends de aplicación con mismo comando y handler que duplica internamente. Son contraejemplos de cobertura por contador único. |
| 16–17 | Probe denegado o permiso sintético registrado cuya respuesta se pierde: cero delegaciones al sink. No se reconcilia ni reutiliza ese permiso. |
| 18–19 | Retry/redirección vuelven al probe y pueden ser denegados tras el primer permiso; solo el primer envío sintético alcanza el sink. |
| 20 | Pausa DESPUÉS de permiso sintético, revocación y liberación: todavía alcanza el sink. No se afirma que revocar retraiga permisos anteriores. Barrera acotada, sin sleeps de ordenación. |
| 21–23 | Adaptador promote real: HEAD/PUT/PUT/HEAD/GET al reintentar; destino existente solo HEAD/HEAD/GET; tres copias fallidas conservan ticket/pin y error de incertidumbre. No se sella ni escribe Mongo. |
| 24–25 | SDK→NodeHttpHandler→https.request falso, reset o 200 con Error: dos llamadas al handler y dos peticiones nativas simuladas, ningún socket. |
| 26–28 | NodeHttpHandler aislado, éxito/reset/301: una petición nativa por handle; no sigue redirección ni reintenta internamente en estos escenarios. |

Los probes representan únicamente el punto de intercepción; NO usan el puerto
MediaPromotionPersistence, sus IDs/fences, sesiones Mongo o autorizaciones reales.
No acreditan persistencia durable, autenticación, manejo completo de commit incierto
o correspondencia entre request firmado y definición/hash del efecto.

## Conclusión técnica y siguiente bloque

El punto candidato elegido para desarrollo posterior es un wrapper del request
handler, no un wrapper de client.send ni un middleware por encima de retry/redirect.
Cada delegación mutadora necesitará intención/permiso nuevo reconocido, definición
fijada validada contra el request y un handler subyacente controlado sin reenvíos
internos. El contraejemplo de duplicación interna impide admitir handlers arbitrarios.
Los errores de permiso/persistencia no se deben confundir con errores S3 reintentables.
Leer un permiso anterior nunca autoriza delegar de nuevo. Falta implementar/probar
esas guardas, clasificación de retries y evidencia tardía con el puerto real/dobles.

Los tests no prueban sockets/TLS/DNS/proxies, custom agents, HTTP2/browser handlers,
redes/retransmisiones, comportamiento de AWS o retención. Una petición nativa
simulada tampoco prueba que el proveedor recibió/terminó un efecto. Deshabilitar
followRegionRedirects en producción no se hizo aquí; el caso habilitado es una
configuración deliberada del test, no un hallazgo de que producción la habilite.

Siguiente bloque concreto: wrapper interno de handler para UN efecto ordinario
con scope/definición inmutables, intento/dispatcher/permiso separados por cada
delegación; probar denegación, autorización perdida, retry/redirect, pausa después
de permiso y error al registrar respuesta, con transporte falso y persistencia
simulada. Mantener fuera de callers/SDK actuales hasta cubrir ticket/sellado
concurrente y vínculo exacto de requests. No habilitar dispatch real por este ensayo.

## Validación

- Suite nueva: **28 pruebas aprobadas**, 5.648 s, con guarda de cero sockets.
- Primera versión de 25 casos aprobada, 5.814 s. Lint pidió quitar parámetro sin
  uso e imports require; al cambiar imports a default se detectó incompatibilidad
  CommonJS del tsconfig en beforeEach (28 fallos de setup, sin solicitudes).
  Corregidos a namespace imports. Siguiente pasada 27/28: expectativa incorrecta
  de retry ante HTTP 200 vacío. Se fijó la expectativa al comportamiento observado,
  sin modificar SDK o producción; pasada final 28/28 citada arriba.
- ESLint de los dos TypeScript nuevos: correcto en estado final. Prettier aplicado
  solo a esos archivos. Build y compilación de arneses: correctos, sin conexión.
- Regresión seleccionada: **94 suites/1451 pruebas aprobadas**, **50.224 s**,
  frente a 93/1423 de la base; incluye las 28 nuevas, no sumarlas aparte. Se
  comprobó restauración de mocks junto al resto. No suite global: ocho suites
  heredadas siguen como deuda separada. Aviso Node20/AWS SDK heredado no bloqueante.
- Sin src/runtime/HTTP/DTO/URLs/éxitos/errores (PUT animal primitivo incluido),
  dependencias, schemas/índices, migraciones, despliegues, commits o push modificados.
  Los 26 escenarios Mongo del bloque 33 no se repitieron ni se incluyen aquí.
- git diff --check correcto; 208 enlaces locales en nueve documentos afectados,
  cero rotos y sin espacios finales, incluidos los tres archivos nuevos.
