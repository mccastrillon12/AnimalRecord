# Revalidación paginada de metadatos del archivo preparado

Subbloque 17 sobre `d731350`. Implementado internamente, sin operación real
Mongo/S3, endpoints, publicación o transferencia completa. Este bloque es SOLO
la parte Mongo de la revalidación final: **METADATA_OBSERVED no significa S3
verificado, corte estable, permiso de commit o transferencia aceptada**.

## Inicio explícito y recorrido

OwnershipArchiveModule exporta OwnershipArchiveMetadataRevalidator:

```text
start(runId: UUID, archiveId: UUID)
nextPage(runId: UUID, limit = 20) // 1–100
```

Usar una identidad explícita para la corrida; no generarla automáticamente ante
errores. Repetir el mismo inicio conserva su definición/progreso; reutilizarlo
para otro expediente se rechaza. Antes de iniciarlo deben estar registrados todos
los archivos: un registro posterior avanza el fence e invalida la corrida.
No hay worker, cron, barrido S3 o tarea de arranque. Actor/OTP/solicitud/decisión
de negocio deben ser autorizados por el futuro orquestador, no por conocer IDs.

Se persiste un recorrido ENTRIES → FILES → METADATA_OBSERVED:

- ENTRIES: página por id, reconstrucción del snapshot/hash y del plan permitido
  mediante el dominio existente; compara TODO el plan guardado con el reconstruido.
  Carga sus manifiestos y comprueba evidencia generacional/VERIFIED/procedencia
  para cada uso. También revisa entradas sin archivos y usos múltiples del mismo
  archivo, no solo el primer binding que coincida.
- FILES: página por id de TODO el manifiesto; exige al menos una entrada que lo
  referencie y un plan ligado a su contentHash. Reconstruye el registro esperado
  del destino efectivo y exige exactamente una constancia PREPARED idéntica por
  archivo. No confunde plannedFinalKey con la generación realmente materializada.
- Cierre: conteos exactos de entradas, archivos y registros; una ficha vigente;
  conteos retenidos completos cuando hay history. Una referencia sin manifiesto
  falla en ENTRIES; un archivo no referenciado falla en FILES; registros extra o
  ausentes/duplicados impiden el cierre. Manifiesto vacío válido no inventa objetos.

Cada fase necesita una página adicional vacía si la anterior llenó el límite.
Se puede variar el límite al reanudar. Cursor, conteos, revisión y digests rodantes
se guardan junto al fence en la transacción de página. Digests deterministas
dependen del orden y de identidades/hashes observados, no del tamaño de página.
No se duplican payloads clínicos, URLs o errores en la corrida. Su lectura durante
la reconstrucción es interna y no ejecuta IA/polling/diagnósticos.

## Fences y concurrencia

Subbloque 20: el epoch actual debe ser también el de reservation inmutable de
cabecera. La definición de NUEVAS corridas liga ese vínculo. Iniciar otra corrida
ya NO permite revisar/adoptar una cabecera de un epoch anterior, aunque la nueva
reserva tenga el mismo transferId/hora. No retroadaptar cabeceras o corridas viejas.
Originales de snapshot/manifiesto/plan conservados; observación no es consumo.
Detalle: [ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).

Subbloque 19 endurece la identidad: nuevas corridas requieren reservationEpoch
positivo en el control, lo guardan y lo incluyen en reservationHash. Replays,
páginas, extensión S3 y CAS del control lo comparan; liberar/readquirir invalida
aun con mismo transferId/lockedAt y contador de pipeline. Corridas anteriores
sin epoch se conservan pero no se reanudan ni retroadaptan. El límite ABA del
texto original queda cubierto para los mutadores de reserva actualizados, NO
para escrituras administrativas, réplicas viejas o todos los workers preparados.
No es epoch universal ni permiso de consumo. Detalle:
[animal-reservation-epoch.md](./animal-reservation-epoch.md).

Inicio/página requieren READY/PLANNED, materialización GENERATIONAL_V1
MATERIALIZED, período ACTIVE, mismo dueño/versión/transferId y cero activeWrites,
incluidos legacy. V1 anterior no se convierte. La definición fija hashes del
expediente/plan/materialización/history y conteos, además del runId.

El inicio nuevo incrementa archiveMaterializationRevision y conserva su valor en
controlRevision. También fija hash de transferId/lockedAt de la reserva observada.
Cada página compara ambos y hace CAS/incremento sobre ese MISMO control, además
de CAS de revisión/fase/definición del recorrido, en snapshot/primary/majority.
No hay transacción abierta durante S3; este bloque NO hace ninguna llamada S3.
Solo reutiliza el parser local de URLs del adaptador existente.

Una materialización, registro (aunque sea repetido) u otra corrida nueva que
avance archiveMaterializationRevision invalida la anterior: una llamada posterior
devuelve conflicto, incluso si estaba METADATA_OBSERVED. No refija la revisión,
reinicia cursores o declara automáticamente una corrida nueva. Una nueva corrida
debe ser explícita y deja las anteriores conservadas; no es cancelación de negocio.
Se mantienen límites de entero seguro y compatibilidad del contador ausente.

Dos páginas compiten por run/control. Si una gana, la otra debe reintentar la
transacción con el progreso actual, sin contar de nuevo la misma entrada. Si
otra operación de pipeline gana, el reintento observa el fence cambiado y falla.
Un fallo de checkpoint aborta también su incremento de control. Después de una
respuesta de commit perdida, repetir el inicio con el mismo ID relee el progreso;
nextPage continúa lo persistido, no rehace/recuenta una página confirmada.

La consulta repetida del inicio/terminal observa la revisión, pero no la reserva
para uso posterior. Los datos devueltos pueden quedar obsoletos al responder.
La corrida persistida puede conservar su fase aun cuando sea obsoleta: la fase
sola NO es un veredicto de vigencia. Un futuro commit debe releer y competir por
el mismo control/run y validar definición/estado, no aceptar el DTO o hash enviado
por un cliente como permiso. No se implementa consumo/commit en este bloque.

## Qué NO demuestra

El recorrido presupone la inmutabilidad de snapshots/planes/manifiestos preparados
en sus protocolos existentes y que sus mutadores respetan los fences. Las páginas
usan snapshots cortos distintos, no un único snapshot Mongo para todo el recorrido.
Los digests no son una firma ni detectan por sí solos escrituras administrativas
fuera del protocolo. Al cierre no se vuelve a leer todo lo ya recorrido.

Este contador NO es un epoch universal de TODOS los escritores ni resuelve por sí
solo liberación/readquisición ABA de reservas idénticas. lockedAt se liga como
identidad observada, nunca como prueba de liveness o vencimiento. No demuestra
que el archivo preparado corresponda todavía al expediente activo actual tras
una intervención, que un proceso murió o que acabaron copias/PUT tardíos.
No libera tokens, ventanas o reservas ni amplía recuperación legacy/MAY_RUN.

No comprueba existencia/bytes/metadata/revisión actual del objeto S3, privacidad,
IAM, lifecycle o retención. Que las referencias y registros concuerden en Mongo
no prueba que el archivo siga descargable o que no cambie después. No habilitar
aceptación ni aflojar las guardas generacionales por completar esta fase.

## Persistencia y compatibilidad

Nueva colección animal_archive_metadata_revalidations: id único, índice
(archiveId,id), protocolo, definición, fase/revisión, contador y hash de reserva,
cursores/conteos, digests y tiempos de inicio/observación del servidor. Fechas son
observaciones técnicas, no fechas efectivas de traspaso ni plazos de negocio.
Sin TTL, defaults, backfill o reciclaje de IDs. No modifica cabecera, snapshots,
manifiestos, planes, registros PREPARED, referencias activas, propietario/períodos,
auditoría de negocio o notificaciones. Solo recorrido y fence técnico del control.

El modelo se registra con Mongoose; según autoCreate/autoIndex puede requerir
creación de colección/índices/permisos al iniciar. Declaración/compilación no es
verificación real. No se arrancó AppModule ni crearon índices/colecciones reales.
Los lectores previos no conocen esta corrida y no deben usarla como autorización.

Páginas acotan entradas/archivos, no bytes o adjuntos dentro de una entrada. La
reconstrucción y consulta de planes/contadores tienen coste; medir tamaño de
documentos/planes, scans, duración de transacciones y memoria antes de operar.
No añade índices nuevos a las colecciones de origen sin evaluar su necesidad.

Impacto e instrucciones completos centralizados en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
Mismos HTTP/DTO/éxitos/errores y PUT animal primitivo; sin cambios de clínica,
BDA/códigos/categorías/acceptedAt/48 h o nameHistory (nombres). No habilita captura
posterior ni modifica cancelación/vencimiento pendientes.

## Siguiente bloque y validación

Extensión implementada posteriormente en el subbloque 18:
[ownership-archive-s3-observation.md](./ownership-archive-s3-observation.md).
Campo s3Observation opcional sobre esta misma corrida, sin redefinir sus digests.
Inicio/checkpoints S3 avanzan su revisión y el mismo fence del control; la fase
padre sigue METADATA_OBSERVED. No interpretar ninguna fase como permiso de commit.
El siguiente párrafo conserva el siguiente paso del cierre original del bloque 17.

Siguiente bloque concreto: verificación de solo lectura de objetos finales S3,
ligada a una corrida vigente y a sus registros/manifiesto. No usar materialize
como verificador, pues puede copiar/recrear; no adoptar otra revisión o reparar
un destino ausente. Separar observación S3 de permiso de publicación y definir
su checkpoint/fence frente a copias tardías antes de implementar el commit conjunto.
Siguen pendientes corte estable, consumo/commit, permisos/retención/históricos,
captura posterior, recuperación operativa y pruebas reales.

Tests nuevos usan modelos/sesiones y un doble optimista con snapshot/reintento;
no prueban transacciones/rollback/mayoría/índices/exclusión Mongo reales. No hay
S3 real. Resultados finales en el plan; ocho suites globales heredadas continúan
como deuda separada y no se declara verde toda la suite global.

Resultados finales: **71 suites/820 pruebas** en la regresión seleccionada
(antes 68/764), tres suites nuevas/56 casos; build, ESLint de TypeScript nuevo/
modificado, compilación del arnés existente y `git diff --check` aprobados.
No ejecución real de Mongo/S3, migraciones, despliegues, commits o push.
