# Coordinación de escrituras antes de transferir

Subbloque 3 sobre `e7db2b2`, 2026-10-25. Implementación interna, sin endpoints
de solicitud/aceptación ni cambio de propietario. Complementa
[ownership-archive-preparation.md](./ownership-archive-preparation.md).

## Protocolo disponible

`AnimalModule` exporta `AnimalWriteCoordinator`. Los handlers HTTP que modifican
una ficha, foto, diario/adjunto o documento médico adquieren primero un token
persistido en `animal_ownership_controls.activeWrites`. Se incorpora con una
actualización atómica condicionada al dueño/versión y a la ausencia de reserva.
Una comprobación de permisos anterior no sustituye esa adquisición.

Adquisición/liberación de tokens y reserva, y registro de ventanas usan
`writeConcern: majority`: el callback no empieza con un token reconocido solo
por un primario que pueda perderlo en failover. Si el acknowledgement es
incierto, no se muta ni se adivina que el token no existe; se requiere recuperación.
Verificar soporte y disponibilidad de mayoría del replica set antes de desplegar.

La reserva exige, en la misma actualización atómica, dueño/versión esperados,
ninguna otra reserva, cero escritores y ventana de URLs ausente o vencida.
Mongo compara la ventana con `$$NOW`, no con el timestamp recibido en `lockedAt`.
Si gana una escritura, adquirir reserva devuelve `false`: el futuro orquestador
debe esperar/reintentar, no cancelar esa escritura. Si gana la reserva, el
callback de escritura no se ejecuta y HTTP devuelve 409. PENDING no reserva nada.
No hay espera activa ni cola HTTP en este subbloque.

Todos los animales se deduplican/ordenan y adquieren antes del callback. Si uno
falla, se liberan solo los tokens propios anteriores sin mutación parcial.
Los tokens no serializan CRUD entre sí: conservan versiones/compensaciones
existentes. Duran hasta resolver/rechazar el callback completo, incluidas
limpiezas S3 esperadas, y se liberan exclusivamente por animal/token.
El rescate PDF usa `allSettled` para que un fallo no permita finalizar el polling
mientras una carga hermana sigue viva; conserva el mismo fallback clínico.

## Medicina y lecturas con efectos

`MedicalDocumentWriteCoordinator` resuelve documentos autorizados, adquiere sus
animales y vuelve a leer asociaciones antes de mutar. Una expansión fuera del
conjunto reservado causa conflicto sin ejecutar el callback.

- Análisis inicial: todos los animales del multipart.
- Revisión inicial (ACCEPT/REJECT), polling ANALYZING y revisión de reemplazo:
  todos los animales del documento/candidato que se modifica.
- Reemplazo: seleccionados más animales de registros legacy que debe separar
  la normalización previa del grupo; no los siblings ya individuales no elegidos.
- DELETE: todos los animales del registro actual; para legacy compartido es
  deliberadamente conservador porque se modifica un registro común.
- GET relacionado: tokens solo si debe normalizar registros legacy. Un grupo
  individual sigue siendo lectura disponible durante una reserva.
- GET por ID no ANALYZING: lectura pura sin refrescar AWS ni tokens. Polling
  que sí escribe vuelve a obtener el documento dentro de los tokens.

Se mantienen las políticas/versiones existentes. La coordinación se aplica en
las entradas HTTP: cualquier futuro worker, importador o caller interno debe
usar el coordinador para TODA su operación. Llamar directamente un repositorio
o servicio no participa en el protocolo. Los flujos actuales no amplían las
asociaciones tras crear un documento; un futuro flujo que lo haga debe reservar
la unión antes de mutar.

## URLs, aislamiento nuevo y transición S3 pendiente

Las URLs de foto/diario conservan sus 300 s, rutas y respuestas. Firmante y
coordinador comparten `ANIMAL_UPLOAD_URL_EXPIRATION_SECONDS`. Después de firmar,
antes de devolver la URL y sin liberar el token, se registra `uploadsValidUntil`
con `$max`: otra carga no acorta la espera. Si no se persiste, no se entrega URL.
No se trackean descargas ni fotos de usuario como cargas de animales.

Actualización subbloque 5: las emisiones nuevas registran temporal y final
separados; una confirmación verificada copia con condición de destino vacío y
fija bytes/revisión antes de guardar referencia. El handler conserva sus tokens
durante toda esa operación. Un PUT tardío de esas URLs no alcanza al final.
El JSON no cambia pero la disponibilidad final pasa a DESPUÉS de confirmar.
Véase [animal-media-upload-isolation.md](./animal-media-upload-isolation.md).

Esto impide reservar mientras una URL nueva permite iniciar cargas. **No prueba
que haya terminado un PUT que empezó antes de vencer**, ni revoca URLs ni
resuelve efectos S3 remotos inciertos tras un timeout. ETag/VersionId y hashes
del preparador protegen copias, pero no establecen por sí solos el corte de
aceptación. Antes de activarla: cerrar tratamiento de PUT tardíos, revisar
versionado/inmutabilidad o aislamiento de claves y probarlo con S3 real.
Los medios legacy siguen sin esa garantía y la captura los rechaza hasta una
migración explícita; tampoco se resuelven aquí todos los efectos remotos de
otros módulos. No se afirma un corte S3 integral ni se habilita aceptación.

## Reinicios, recuperación y despliegue

Los tokens NO vencen por tiempo: un proceso vivo podría tardar más que un lease
y un TTL permitiría reservar mientras escribe. Crash o adquisición de resultado
incierto pueden dejar tokens huérfanos. Bloquean transferencias de ese animal,
no todo su CRUD. Si falla liberar después de guardar, se conserva el éxito y
se registra advertencia con animal/token, sin obligar al cliente a duplicar.

La recuperación automática/administrativa no está implementada. Antes de retirar
un token se debe demostrar fin de instancia/operación y resolver efectos remotos
inciertos; nunca limpiar por antigüedad ni borrar el array completo. Falta un
procedimiento operativo verificable antes del release.

Controles antiguos sin los campos nuevos son compatibles, sin backfill
destructivo. Antes de habilitar reservas, desplegar el protocolo en TODAS las
réplicas, drenar peticiones antiguas y tratar URLs previas no registradas y PUT
ya iniciados. Mantener relojes sincronizados con AWS/Mongo; una sola réplica
actualizada en rolling deployment no basta. No hubo migración, despliegue ni
cambio de IAM/bucket/datos productivos.

## Pendiente y validación

El subbloque 4 ya aporta preflight de IA pendiente bajo reserva y captura paginada
del expediente actual del periodo inicial, aún sin HTTP/ejecución automática.
Detalle en [ownership-archive-capture.md](./ownership-archive-capture.md).
Faltan corte S3/PUT tardíos, recuperación operativa, antecedentes retenidos,
activación/commit de propiedad, retención/permisos y limpieza.
Los tokens técnicos/300 s no son reglas de vencimiento o cancelación
de transferencias: esas decisiones siguen abiertas.

Las pruebas unitarias/HTTP con repositorios simulados cubren tokens, fallos,
operaciones multi-animal, callbacks diferidos, consultas Mongo y contratos.
No demuestran atomicidad/índices reales ni exclusión distribuida en replica set;
esa prueba y PUT tardíos en S3 siguen siendo obligatorios. Comandos/resultados
en [final-delivery-plan.md](./final-delivery-plan.md).
