# Captura interna paginada del expediente actual

Subbloque 4 sobre `0678850`, 2026-10-25. Se integra en `OwnershipArchiveModule`
sin controller, cron ni worker automático. No acepta transferencias, no publica
históricos, no activa referencias del destinatario y no cambia `Animal.ownerId`.
Complementa [preparación de archivos](./ownership-archive-preparation.md) y
[coordinación de escrituras](./animal-write-coordination.md).

Actualización subbloque 12: existe un importador explícito de antecedentes para
preparaciones manuales, con procedencia y copia desde históricos verificados.
NO está conectado todavía a esta captura automática y no se retira la guarda
del período inicial. Cierre/apertura y activación de referencias siguen pendientes;
READY no basta para seleccionar una fuente efectiva. Detalle y pruebas sintéticas
en [ownership-archive-history.md](./ownership-archive-history.md).

Subbloque 13: plan persistido de referencias posterior a READY, sin activación
ni cierre/apertura de períodos. No cambia fases ni preflight de esta captura y
no levanta su guarda inicial. Véase
[ownership-archive-reference-plan.md](./ownership-archive-reference-plan.md).

Actualización subbloque 5: aislamiento de emisiones nuevas de foto/diario y
preflight del diario completo. Fotos/adjuntos deben tener registro sellado;
medios legacy se deniegan antes de comenzar, sin migración automática. Detalle
y contrato frontend en [animal-media-upload-isolation.md](./animal-media-upload-isolation.md).

## Alcance disponible

`OwnershipArchiveCapture` conecta ficha, diario completo y documentos médicos
aceptados al preparador existente. `MongoOwnershipArchiveSource` solo lee:
utiliza el mismo mapeo de dominio que las consultas vigentes, sin IA ni códigos
nuevos, y elimina metadatos de Mongo de los payloads. Conserva nombres,
identidad/código, fechas, asignaciones y datos médicos validados. `nameHistory`
sigue siendo historial de nombres, nunca de propietarios.

La paginación es por `id`, no por fecha clínica/creación ni `skip`. No limita el
expediente a documentos recientes ni omite registros por dueño/categoría/grupo:
una asociación inconsistente debe causar conflicto, no desaparecer del archivo.
Las lecturas de la fuente son de primario con `readConcern: majority`.

Es una captura del expediente **actual del periodo inicial**: exige el periodo
ACTIVE indicado, dueño/versión coincidentes, `ownershipVersion = 1` y ningún
periodo CLOSED previo. Aún no importa antecedentes retenidos. Rechaza versiones
posteriores o periodos anteriores para no prometer una copia completa que los
omita; esta restricción técnica debe retirarse solo al implementar esa importación.

## Inicio y denegación antes de crear el archivo

`start(definition)` usa los IDs internos del archivo/animal/periodo/transferencia,
dueño, destinatario y versión de propiedad. La identidad y autorización del
actor, destinatario elegible, OTP y decisiones de negocio corresponden al futuro
orquestador autenticado; este servicio no sustituye esos pasos.

1. Valida la definición y el animal propio/activo; intenta adquirir la reserva
   existente con comparación atómica de dueño/versión, cero escritores y ventana
   de URLs vencida. Si no puede, devuelve conflicto sin esperar ni liberar nada.
2. Bajo la reserva relee animal/periodo y busca trabajo médico pendiente por
   `animalIds`. Bloquea PENDING_UPLOAD, ANALYZING, REVIEW_PENDING, candidatos de
   reemplazo y estados desconocidos/ausentes. Solo ACCEPTED, REJECTED y FAILED
   no se consideran pendientes. No cancela IA ni descarta lecturas.
3. Valida ficha, recorre TODO el diario y TODOS los documentos aceptados en páginas de hasta
   100, usando las invariantes del preparador: documento individual del dueño,
   extracción/categoría y referencias coherentes, sin fuentes ajenas o de staging.
   Así un legacy multi-animal o medio sin sellar no deja al dueño bloqueado
   cuando debe normalizarlo/migrarlo. Comprueba sellados de medios en Mongo.
   Es un preflight sin S3: memoria acotada por página, pero su duración total
   depende del expediente; todavía no tiene cursor persistido propio.
4. Si falla antes de intentar crear la cabecera, libera SOLO la reserva que
   adquirió esta llamada, por animal/transferId. El dueño puede terminar/descartar
   IA por las rutas existentes o normalizar legacy antes de reintentar.
   Si la liberación falla conserva el error original y registra recuperación.
5. Una vez intentado `preparer.begin(definition, true)`, no libera por error:
   la cabecera pudo persistirse aunque se perdiera el acknowledgement. Reintentar
   la misma definición encuentra ese archivo; no empieza otro corte ni lo sobrescribe.

Un lock coincidente SIN cabecera no permite incorporarse al preflight de otra
instancia: podría seguir ejecutándose o liberarse por denegación. La llamada
concurrente falla sin desbloquear. Una caída antes de crear cabecera o un resultado
incierto al adquirir reserva requieren la recuperación operativa aún pendiente;
no se recuperan por antigüedad ni mediante esta API. No borrar datos para reintentar.

Para decisiones de varios animales sigue siendo necesario comprobar el conjunto
completo ANTES de registrar la respuesta del destinatario. Este servicio por
animal no implementa ni autoriza decisiones parciales/rechazos de los demás
cuando falla el preflight. Esa orquestación de negocio aún no existe.

## Lotes y recuperación después de iniciar

La cabecera añade `capture` opcional con `revision`, `phase`, `afterId` y
`entryCount`. No amplía los DTO públicos. Los archivos creados antes o montados
manualmente por el preparador no tienen este cursor y no se adoptan
automáticamente: el preparador de bajo nivel conserva su contrato anterior.

`captureBatch(archiveId)` realiza UNA fase/página, hasta 100 registros:

1. ANIMAL: añade una ficha, avanza a DIARY con conteo 1.
2. DIARY: añade la página. Página llena guarda último ID y continúa; página
   corta/vacía pasa a MEDICAL con cursor nuevo.
3. MEDICAL: añade documentos aceptados. Igual paginación; al terminar pasa a COMPLETE.
4. COMPLETE: sella con el conteo persistido y pasa a COPYING. El sellado exige
   cursor COMPLETE, conteo coincidente, conteo real exacto y una única ficha.

No hay transacción larga durante la lectura del expediente ni llamadas S3. Cada
registro/manifiesto conserva sus transacciones cortas. Las consultas S3 se hacen
al añadir referencias, no durante el preflight; para medios sellados también
verifica procedencia/hash y revisión del final, no basta HEAD de un legacy. Un lote
acota registros, no número de adjuntos por entrada ni duración de S3.

El checkpoint usa comparación de revisión/estado COLLECTING y acknowledgement de
mayoría. Primero persiste los registros y después el cursor: si cae entre ambos,
reanuda la página. IDs/hashes inmutables evitan duplicados y nuevas inspecciones
S3 de registros ya capturados. Dos instancias pueden repetir una página, pero
solo una avanza su revisión; una atrasada no regresa el cursor ni aumenta dos
veces el conteo. Se rechazan fuentes desordenadas, IDs repetidos y páginas mayores
al límite en vez de entrar en un bucle o sellar un corte incompleto.

Cada lote valida la reserva sin escritores; durante COLLECTING comprueba de nuevo
animal activo, periodo inicial e IA pendiente. Una anomalía DESPUÉS de iniciar
no libera la reserva ni permite corregir en vivo un archivo parcial: requiere
investigación/reintento compatible o recuperación controlada. Esto incluye
archivos faltantes, referencias de diario inválidas o cambios fuera del protocolo.

Al terminar, la copia de objetos sigue siendo `OwnershipArchivePreparer.copyBatch`.
COPYING y READY solo expresan preparación; no cambian accesos ni propiedad.

## Límites que siguen bloqueando producción

- Los lectores por páginas son consistentes solo si TODOS los escritores usan
  el protocolo y nadie libera/reutiliza una reserva de un archivo iniciado.
  Importadores/jobs futuros también deben coordinarse; las escrituras manuales
  de base no quedan protegidas automáticamente.
- El vencimiento de URL no demuestra fin de PUT legacy. Emisiones nuevas aisladas
  no escriben el final, pero falta migrar medios anteriores, verificar rollout
  e integrar/pruebar efectos S3 inciertos de todos los escritores.
- Faltan antecedentes retenidos A→B→C/devoluciones, activación/publicación,
  commit de propiedad/periodos, permisos históricos, retención y limpieza segura.
- Faltan recuperación de tokens/reservas huérfanos, migración/rollout de TODAS las
  réplicas y prueba Mongo replica set/S3. Revisar planes de índices/rendimiento
  de estas nuevas lecturas por ID antes de operar expedientes grandes.
- Los tests simulan persistencia/S3. No prueban transacciones, mayoría ni carreras
  distribuidas reales. No hubo despliegue, IAM, bucket ni datos productivos.

Ninguna duración técnica define vencimiento/cancelación de transferencias: esas
reglas siguen pendientes. No ejecutar esta captura desde producción hasta cerrar
las dependencias; importarla en Nest no la ejecuta.

## Compatibilidad frontend

En el subbloque 4, contrato anterior/nuevo idéntico para ficha/foto, diario/adjuntos, análisis,
polling, revisión, reemplazo, eliminación médica, catálogos y destinatarios:
sin cambios de rutas, DTO, estados, éxitos, errores o URLs. No requiere ajustes
Flutter en este subbloque. Mantener el manejo de 409 del bloque anterior.
No enviar cursores/IDs/estados internos de captura a rutas existentes ni crear
UI contra endpoints futuros. El conflicto de IA anterior describe una operación
interna, NO un nuevo contrato HTTP de aceptación. El subbloque 5 sí cambia
disponibilidad de medios tras confirmar y documenta errores/preview en la guía
frontend; no confundir compatibilidad JSON con ausencia de cambios funcionales.
