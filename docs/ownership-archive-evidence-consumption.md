# Consumo único de observaciones dentro de una transacción ajena

Subbloque 21, 2026-10-26, sobre `0bf5d9c`. Implementación interna de persistencia,
sin llamador de negocio, endpoint, worker o ejecución real. **Consumir observaciones
NO demuestra corte estable S3, traspaso realizado, autorización o publicación.**

## Contrato e integración prevista

OwnershipArchiveModule exporta el token interno OwnershipArchiveEvidenceConsumption,
alias de la MISMA instancia MongoOwnershipArchiveMetadataRevalidation:

```text
consumeWithinTransaction(request, session) -> recibo PROVISIONAL
request: id, runId, archiveId, expectedRunRevision, expectedEvidenceHash
```

IDs UUID explícitos; revisión entera segura no negativa y hash canónico de 64
hexadecimales. El futuro llamador debe autenticar/autorizar actor y solicitud,
resolver el conjunto de animales y la idempotencia de negocio. Ninguno de esos
datos se obtiene de un hash/ID técnico. No se acepta payload clínico, URL, key,
error crudo o evidencia S3 enviada desde Flutter.

La sesión debe estar activa, no terminada, en transacción snapshot/primary/majority
y pertenecer al mismo MongoClient que TODOS los modelos involucrados. No basta
pasar una sesión sin transacción o de otra conexión/cliente. Se contrastan las
opciones efectivas de la transacción y el cliente; no se degradan silenciosamente.
Esto usa transaction.options y client del driver mongodb 6 instalado (client
existe en runtime pero su declaración @internal se elimina del tipo público).
Dependencia localizada en la guarda: revisar este contrato al actualizar driver/
Mongoose y validarlo con Mongo real antes de integración. No se cambiaron versiones.

La guarda NO llama startSession/startTransaction/withTransaction/commit/endSession,
no crea una transacción independiente, no ejecuta callbacks de negocio ni S3.
El dueño de la sesión debe invocarla dentro de la MISMA transacción que escribirá
propiedad/referencias/períodos/auditoría/eventos. Recibo devuelto antes del commit
es provisional; no cachearlo o devolverlo como capacidad canCommit.

Consumir y hacer commit sin las escrituras conjuntas sería un uso INCORRECTO del
colaborador: podría dejar evidencia cerrada sin transferencia. El método no
puede demostrar por sí solo que un llamador interno escribió todo el negocio.
Por eso no se añade llamador autónomo y no se habilita aceptación/publicación.
La integración futura debe probar esa atomicidad, autorización y resultado durable.

## Evidencia y fences

Nuevas corridas fijan pipelineFence ARCHIVE_PIPELINE_FENCE_V1 con las revisiones
observadas de preparación y planes. Ausencia de cada contador se distingue de
cero, sin crear defaults. Cada continuación/replay Mongo/S3 compara esos pins,
además del epoch original de cabecera, hash de reserva y revisión compartida de
materialización. Las escrituras del control comparan también ambos contadores:
preparación, plan, registro/materialización, otra corrida y liberación/readquisición
compiten con el consumo sobre el MISMO documento. No se adopta un contador nuevo.

archiveEvidenceHash calcula una comparación explícita de identidad/definición,
revisiones, reserva, pipelineFence, conteos/digests Mongo y observación S3 terminal.
Excluye _id/__v y no es firma, frescura o autorización. La guarda relee datos desde
Mongo usando la sesión recibida: requiere METADATA_OBSERVED y S3_OBSERVED completos,
cabecera READY/PLANNED/GENERATIONAL_V1 MATERIALIZED ligada a su reserva original,
período ACTIVE, mismo dueño/versión/transferId y cero escritores, incluidos legacy.
Verifica identidad/definición/progreso, pins y hash/revisión ofrecidos, y vuelve a
comprobar conteos Mongo. No relee todos los payloads/archivos/bytes al consumir;
presupone inmutabilidad de los protocolos y sus mutadores actualizados.

En esa misma transacción avanza archiveMaterializationRevision, hace CAS de la
cabecera sin evidenceConsumption y CAS de corrida sin consumption, incrementando
su revisión/controlRevision. Ambas conservan el MISMO recibo inmutable:
ARCHIVE_EVIDENCE_CONSUMPTION_V1, id, runId/archiveId, definición de corrida,
evidenceHash, epoch, revisiones anterior/siguiente, timestamp técnico y hash.
No duplica información clínica, URLs, keys, payloads o errores. El ID no tiene
índice global nuevo: unicidad de uso es por corrida y CABECERA, no idempotencia
de solicitudes HTTP ni una promesa de ID único entre expedientes distintos.

El marcador en cabecera cierra TODOS sus mutadores de preparación/captura/copias/
antecedentes/planes/materialización/registro y observaciones, incluidos replays
terminales y otra corrida nueva. Una marca presente, aun malformada, no se borra
o ignora. find/lecturas de datos siguen posibles, sin permiso de escribir ni de
acceso histórico público. No cambia READY a un supuesto estado de negocio.

## Errores, competencia y respuesta perdida

- Dos consumidores de la misma evidencia, incluso con el mismo id, no pueden
  confirmar ambos: escriben control/cabecera/corrida. Reintento de snapshot
  obsoleto debe releer y fallar si otro ganó o cambió un fence.
- Si la guarda falla DESPUÉS de validar la sesión, intenta abortTransaction y
  relanza el error original. Así el llamador no puede tragarse un fallo de CAS
  y confirmar las escrituras tentativas anteriores de la guarda. Una sesión
  extranjera/inválida se rechaza sin abortarla o realizar consultas. Un fallo
  de acknowledgement del aborto no reemplaza el error original; el dueño debe
  propagarlo y no intentar continuar/confirmar esa transacción.
- Si el trabajo posterior del llamador falla, DEBE abortar/propagar el error:
  consumo, cambios de negocio y fences se revierten juntos. Los reintentos
  técnicos del dueño requieren trabajo Mongo reejecutable en la misma unidad;
  nunca incluir S3, notificaciones, cobros o callbacks HTTP en esa transacción.
- Tras commit confirmado pero respuesta perdida, los marcadores quedan guardados.
  Repetir consume, aun con idéntico id, da conflicto y NO devuelve permiso de
  ejecutar negocio otra vez. La futura idempotencia debe consultar SU resultado
  de negocio durable en la misma transacción original y reconciliar el recibo.
  Este bloque no implementa esa consulta/endpoint ni infiere éxito del traspaso
  a partir de un recibo aislado. No desbloquea/reset/reintenta automáticamente.

Un error nunca prueba rollback de efectos previos/remotos. La guarda no libera
reservas/tokens/ventanas, no cambia propietario, referencias, períodos o eventos,
ni recupera legacy/MAY_RUN por edad/error. Los timestamps no son fechas efectivas
de traspaso, plazos o reglas de cancelación/vencimiento.

## Compatibilidad y límites

pipelineFence/consumption en corrida y evidenceConsumption en cabecera son
opcionales SIN default/backfill, índices/colecciones/TTL nuevos. Corridas previas
sin pipelineFence pueden conservar su recorrido bajo las guardas anteriores,
pero NO se consumen ni se rellenan a partir del control actual: requieren otra
corrida explícita completa sobre una cabecera/reserva todavía válidas del bloque
20. Cabeceras previas sin reservation siguen excluidas, sin conversión automática.

No hay garantía frente a administración directa, restauraciones o versiones
antiguas que ignoren los pins/marcadores. Desplegar TODOS los mutadores/lectores
compatibles y drenar versiones previas antes de operar; no se ejecutó rollout.
Las revisiones son fences del pipeline, NO epoch universal de contenido/escritores.
Una observación S3 sigue siendo pasada y los objetos pueden cambiar después del
último HEAD; consumirla no cierra PUT/copias tardíos o trabajo remoto incierto.
Continúan pendientes corte estable, privacidad/IAM/lifecycle/retención, captura
posterior/antecedentes integrados, acceso histórico y commit conjunto.

HTTP/DTO/éxitos/errores públicos y PUT animal primitivo intactos. Sin cambios de
clínica/IA/BDA/códigos/categorías/acceptedAt/48 h/nameHistory (nombres). Impacto
central en [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).

## Validación y siguiente bloque

Tests con modelos/sesiones/snapshots/S3 simulados: uso de sesión activa y cliente,
options, rollback junto con escritura sintética del llamador, consumidor ganador,
respuesta de commit perdida, CAS fallido con error tragado, aborto fallido sin
ocultar causa, reserva/pipeline/definición/conteos cambiados, corrida nueva y
marcadores parciales/malformados fail-closed. Matriz de 19 mutadores cerrados tras
consumo; no demuestra Mongo/majority/índices/concurrencia reales ni fallo de red.
Comandos/resultados definitivos en el plan; deuda de ocho suites globales separada.

Resultados finales: **80 suites/1050 pruebas** en la regresión seleccionada
(antes 78/978), dos suites nuevas/53 casos y 19 casos de cierre en suite existente;
build, ESLint nuevo/modificado, compilación del arnés existente y `git diff --check`
aprobados. No operaciones reales Mongo/S3/AWS, migraciones, despliegues, commits
o push; no se declara verde toda la suite global.

Subbloque 22: arnés OPT-IN preparado en comando/configuración propios, con quince
casos de consumo + escritura sintética conjunta, rollback, dos clientes y ambos
órdenes de competencia por control, deriva de reserva/fences, sesión/options
reales y respuesta ocultada después del commit. Compilación/guardas/descubrimiento
aprobados SIN ejecución Mongo; regresión ordinaria 81 suites/1071 pruebas.
Detalle y límites: [ownership-archive-evidence-mongo-integration.md](./ownership-archive-evidence-mongo-integration.md).

Subbloque 23: primera ejecución real autorizada, quince casos aprobados tras
corregir la serialización del snapshot (minimize=false conserva objetos vacíos
incluidos en contentHash). No se relajaron guardas ni rehashéaron datos antiguos.
Snapshot/commit/rollback/índices y carreras comprobados SOLO en replica set local
de un miembro, con S3 e insert de negocio sintéticos. Regresión ordinaria:
82 suites/1073 pruebas. Entorno/primer fallo/limpieza y límites en
[ownership-archive-evidence-mongo-validation.md](./ownership-archive-evidence-mongo-validation.md).

Siguiente: proyección pura de referencias destinatarias desde snapshots/planes/
destinos generacionales verificados, antes de integrar el commit de negocio.
No publica, escribe propietario/períodos/eventos ni acredita fin remoto. Corte
estable S3, autorización/idempotencia y retención siguen pendientes.
