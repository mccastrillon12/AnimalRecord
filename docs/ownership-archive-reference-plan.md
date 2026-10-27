# Plan interno de referencias del expediente

Subbloque 13 sobre `ebf6fe1`. Alcance acotado previo a activación/cierre de
períodos. No es una transferencia, una autorización de lectura ni evidencia
de existencia de objetos finales en S3.

## Contrato del bloque

Subbloque 20: inicio/página comparan también el epoch de la reservation inmutable
de cabecera en el MISMO control que escriben. No adoptan cabeceras previas ni
continúan tras ABA. Planes/hash/bindings originales no cambian; PLANNED sigue
sin autorización de publicación. Detalle y compatibilidad:
[ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).

`OwnershipArchiveReferencePlanner` prepara un plan persistido, reanudable y
paginado sobre un archivo READY bajo la misma reserva drenada. Las entradas
guardan únicamente instrucciones de referencia/procedencia y un posible cambio
de ownerId para recursos vigentes; no duplican el payload clínico. Los
antecedentes conservan el dueño de origen y no se convierten en registros activos.

Cada vínculo distingue tipo URL/KEY, clave y revisión histórica verificada,
staging/revisión del destinatario, SHA-256 y destino final **planificado**.
No genera URLs firmadas ni trata una clave de staging como clave activa.
Reconstruye las rutas permitidas de ficha/diario/documento médico para rechazar
vínculos desconocidos, repetidos, faltantes o modificados; no aplica JSON pointers
arbitrarios a los objetos. Conserva identidad, códigos, categorías, extracción,
fechas y primera aceptación/48 h.

Inicio y checkpoint de página escriben el control coincidente como fence dentro
de transacciones cortas snapshot/primary/majority. Planes de página y cursor se
confirman juntos. Revisión/protocolo/hash y contenido fuente se comparan; una
instancia atrasada no modifica el plan ni avanza dos veces. No hay operaciones
S3 en estas transacciones. El checkpoint final exige conteos reales de entradas,
planes, archivos y archivos referenciados, además de una ficha vigente.

Se reutilizan las colecciones actuales con campos opcionales sin default,
backfill, TTL o índices nuevos. Errores conservan reserva/progreso; repetir la
misma operación y releer después de respuesta incierta. No limpiar por edad ni
interpretar un error como rollback.

## Uso interno y persistencia

- `start(archiveId)` exige UUID, archivo completo READY, período ACTIVE y
  control coincidentes. Crea `referencePlan` con protocolo REFERENCE_PLAN_V1,
  hash de definición, revisión 0, fase PLANNING y conteo 0. Repetir conserva el
  plan existente compatible, no lo reinicia ni lo adopta desde otro protocolo.
- `planBatch(archiveId)` lee hasta 100 entradas y sus manifiestos desde primario
  con mayoría. Primero valida la página completa, sin S3; luego guarda planes y
  checkpoint en una transacción. La página llena exige otra llamada, incluso
  si la última es vacía. Cada entrada conserva sourceContentHash y planHash.
- Inicio y páginas escriben `archiveReferencePlanRevision` en el control, sin
  liberar el lock. Un futuro commit/recovery debe competir por ese mismo control
  y revalidar propietario/versión/reserva; esta metadata no autoriza recuperar
  una reserva ni sustituye el protocolo aún pendiente de efectos remotos.
- La verificación final cuenta también antecedentes y archivos retenidos cuando
  existe `history`. Los conteos/unión de archivos recorren el corte dentro de
  esa transacción final: las escrituras están acotadas por página, no se promete
  tiempo/BSON/memoria constante para todo expediente. Medir antes de producción.

## Límites obligatorios

PLANNED solo significa plan construido. No copia finales, modifica colecciones
activas, publica archivos, cierra/abre períodos, cambia propietario, desbloquea,
crea eventos/outbox o concede acceso. READY mantiene su significado previo.
No hay controller/job/arranque automático; la autorización del futuro llamador
y la comprobación de destinatario/OTP/decisión siguen siendo responsabilidad del
orquestador aún pendiente. No usar este servicio para saltarse esos pasos.

La captura automática conserva su guarda del período inicial. Antes de retirarla
faltan activación verificada y recuperable de destinos finales (incluyendo
colisiones al volver a un propietario), registro de medios transferidos, commit
de referencias/owner/períodos/auditoría/notificaciones, retención y permisos.
Una revisión del manifiesto no demuestra ausencia de efectos S3 tardíos.

Compatibilidad central de frontend en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
Los contratos públicos existentes no cambian ni requieren ajustes Flutter
nuevos. Las verificaciones de este bloque no sustituyen pruebas reales Mongo/S3.

## Validación registrada

Build, ESLint de TypeScript modificado/nuevo, compilación del arnés existente
y `git diff --check`: aprobados. Regresión seleccionada: **60 suites/593 pruebas**,
incluidas tres suites nuevas con 52 casos. Cubren bindings/payloads, procedencia
y devolución sintética, cursores/reinicio/competidores/respuesta incierta en
doble de aplicación, filtros/fence/majority, conteos/manifiesto y campos opcionales.
Los adaptadores Mongo usan modelos/sesiones simulados; no se probaron rollback,
índices, mayoría o exclusión distribuida reales del nuevo protocolo. No hubo
llamadas S3/AWS/Mongo reales, migraciones ni intervención operativa. La evidencia
del arnés de journal anterior no se atribuye a este plan. Las ocho suites globales
heredadas siguen separadas; no se declara verde toda la suite global.

Paso posterior disponible: [materialización interna](./ownership-archive-materialization.md)
del subbloque 14. Usa los destinos fijos de este plan y no lo modifica. Solo
reconcilia su propia identidad/digest; ante colisión detiene sin sobrescribir ni
adoptar. No activa referencias ni cambia el significado de PLANNED.

El subbloque 15 permite elegir materialización generacional ANTES de iniciarla.
No cambia estos planes: plannedFinalKey deja de ser necesariamente el destino
efectivo. El futuro aplicador debe resolver la intención/evidencia final verificada
con el protocolo correspondiente, no aplicar directamente el plan original.
V1 ya emitido no se convierte. Detalle:
[ownership-archive-generations.md](./ownership-archive-generations.md).

El subbloque 17 [reconstruye estos planes](./ownership-archive-metadata-revalidation.md)
por páginas contra los snapshots y manifiestos, y valida registros PREPARED de
todo el conjunto. METADATA_OBSERVED sigue sin verificar bytes S3 o autorizar
activación/cambio de propietario. Los planes originales permanecen inmutables.
