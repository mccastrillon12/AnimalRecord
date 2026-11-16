# Destinos generacionales internos

Subbloque 15 sobre `7dafada`. Implementado para preparaciones que todavía no
emitieron materialización. No es aceptación, publicación ni recuperación de una
transferencia. No se ejecutó sobre Mongo/S3 reales.

## Selección y carreras

`OwnershipArchiveMaterializer.startGenerational(archiveId)` elige explícitamente
`ARCHIVE_MATERIALIZATION_GENERATIONAL_V1`. El inicio anterior `start(archiveId)`
conserva `ARCHIVE_MATERIALIZATION_V1` y sus hashes/destinos. Repetir requiere el
mismo protocolo; ni siquiera una cabecera sin claims puede cambiarse de modo.
`copyBatch` continúa el protocolo ya persistido sin elegir otro al detectar S3.

La cabecera se inserta bajo la transacción/fence del control, con período ACTIVE,
reserva/versión coincidentes y cero activeWrites. Dos inicios incompatibles
compiten por ese control y por cabecera ausente; un reintento debe releer y
rechazar el protocolo perdedor. Cada claim reconstruye la intención y compara
íntegramente una intención previa antes de adquirir el lease. Confirmación,
liberación técnica y cierre conservan los fences y exigen la identidad elegida.
No hay transacción abierta durante S3 ni campos/índices nuevos.

Una operación V1 ya emitida que encuentra su destino ocupado sigue detenida.
NO se convierte a generacional, aunque esté PENDING, haya fallado o parezca
antigua: una copia anterior puede terminar tarde. Resolver preparaciones V1
atascadas requiere otro protocolo de evidencia/recuperación; no borrar/recrear
cabeceras ni fabricar otra preparación sobre la misma reserva para eludirlo.

## Mapeo inmutable

La generación se deriva de la identidad del expediente y del archivo. Se usa
para TODOS sus archivos, sin sondear si la ruta original está ocupada ni escoger
sufijos aleatorios después de un error. `referencePlan`, `recipientFinalKey`,
payloads, contentHash y los hashes originales del manifiesto no se modifican.
La intención materializada guarda el destino efectivo y su hash incluye el
protocolo. Una intención no puede retargetearse ni cambiar staging/revisión.

- Documentos, diario y antecedentes: insertar
  `transfer-generations/{archiveId}/{fileId}/` inmediatamente antes del nombre
  del archivo. Se conservan todos sus directorios anteriores, categoría,
  documento, revisión, identidad de adjunto y nombre/extensión.
- Foto en raíz: `profile_000{decimalSHA256Con78Digitos}.{jpeg|png|webp}`; el
  SHA-256 se deriva de `['ARCHIVE_GENERATION_V1', archiveId, fileId]`. No es una
  fecha. El formato sigue siendo numérico, pero ese patrón exacto queda reservado.
- Solo se admiten foto canónica y raíces diary/medical-documents/retained-history;
  rutas desconocidas, traversal, segmentos vacíos y destinos de más de 1024 bytes
  UTF-8 se rechazan. No hay truncado o aplanado silencioso: generaciones ya
  presentes en el padre se conservan y pueden alcanzar ese límite. Evaluar una
  canonicalización versionada antes de soportar cadenas largas.

Ejemplo bajo `users/{recipient}/animals/{animal}/`:

```text
plan:   medical-documents/prescriptions/{doc}/revisions/{rev}/source.pdf
final:  medical-documents/prescriptions/{doc}/revisions/{rev}/transfer-generations/{archive}/{file}/source.pdf
```

Esto permite materializar junto a un objeto antiguo de retorno sin tocarlo.
No garantiza que el destino generacional esté libre: un objeto ajeno allí sigue
siendo conflicto, aun con bytes iguales. No se adopta ni se busca otra ruta.
Las condiciones IfNoneMatch, revisión de staging, identidad/metadata y SHA-256
por stream del adaptador anterior siguen siendo obligatorias. Una respuesta
perdida o copia tardía se reconcilia únicamente con la misma intención.

`verifiedArchiveMaterializationDestination(archive, file, entryPlan)` resuelve
key/revisión/digest efectivos solo con cabecera MATERIALIZED y evidencia VERIFIED
coherente. Es un resolvedor de evidencia, NO autorización ni revalidación S3.
El futuro commit debe usar ese mapeo, no `plannedFinalKey` directamente; aplicar
la evidencia también exige revalidación final y el protocolo conjunto pendiente.

## Guardas de medios existentes

La confirmación sin ticket conserva una excepción legacy. Sin una reserva
identificable, una foto generacional podría aprovecharla. Por eso se bloquean
el patrón reservado de foto y el segmento `transfer-generations` en emisión,
confirmación (incluso si se presenta como URL actual), inspección/captura sellada
y migración legacy. Ni una URL conocida ni un ticket ordinario habilitan estas
rutas. Diario conserva además su validación específica de adjuntos.

No se registra ni activa ningún medio transferido. Integrar un registro explícito,
procedencia y publicación cercada es el siguiente bloque; no levantar estas
guardas para avanzar. URLs legacy ordinarias y cargas nuevas conservan su
comportamiento. Un legacy excepcional que ya usara ese namespace reservado
será denegado y requiere revisión operativa, no reintento automático.

Actualización subbloque 16: [registro por archivo](./ownership-archive-media-registration.md)
ya disponible internamente en una colección separada, con estado PREPARED.
No añade publicación ni excepciones a estas guardas y no es ticket sellado
ordinario. Se mantienen pendientes revalidación completa, commit conjunto y
captura posterior. El texto anterior describe el alcance original del bloque 15.

Impacto, contratos y errores centralizados en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
Desplegar lectores/guardas compatibles antes de emitir el protocolo generacional;
un binario anterior no conoce este protocolo ni esas reservas. No se autoriza
rollout con este bloque.

## Límites y validación

No activa referencias, registra tickets transferidos, cambia dueño, cierra/abre
períodos, libera reservas o concede acceso histórico. No modifica IA, clínica,
categorías, códigos, acceptedAt/48 h o nameHistory (nombres). La captura automática
sigue limitada al período inicial. Cancelación/vencimiento siguen sin confirmar.
No hay TTL, limpieza, cancelación de copias remotas o recuperación automática.

Los tests usan SDK/modelos/sesiones simulados: no prueban exclusión distribuida,
rollback/majority reales, IAM, lifecycle o privacidad del bucket. La evidencia
real anterior del journal no se extiende a estas copias. Resultados/comandos
definitivos se registran en el plan de entrega.

Regresión seleccionada final: **65 suites/708 pruebas** (antes 64/641), build,
ESLint de todos los TypeScript nuevos/modificados, compilación del arnés y
`git diff --check` aprobados. Se ejecutaron las pruebas existentes de Mongo/S3
de materialización con ambos protocolos, además de rutas/retornos sintéticos,
evidencia incompleta, límites y bloqueo de activación/migración legacy. Ocho
suites globales heredadas siguen como deuda separada; no se declara verde toda
la suite global. No se realizaron commits/push, despliegues, migraciones o borrados.
