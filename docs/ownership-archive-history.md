# Antecedentes retenidos: importador interno

Subbloque 12 sobre `0c2a1ea`, 2026-10-25. Implementación interna y pruebas
sintéticas; no ejecución sobre Mongo/S3, cierre de períodos, publicación,
activación de referencias ni transferencia de negocio. Complementa
[captura](./ownership-archive-capture.md) y
[preparación](./ownership-archive-preparation.md).

## Disponible y objetivo todavía pendiente

Subbloque 20: inicio/checkpoint del DESTINO se ligan a la reservation inmutable
de su nueva cabecera y escriben fence del control en su transacción. Un worker
de otra reserva no importa ni cierra antecedentes, aun con mismo transferId/hora.
Cabeceras destino anteriores sin vínculo no se retroadaptan. El predecesor
efectivo CLOSED conserva su uso de fuente de solo lectura, sin atribuirle una
reserva vigente o cambiar hashes/procedencia/retención. Detalle:
[ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).

`OwnershipArchiveModule` exporta `OwnershipArchiveHistoryImporter`. Permite
importar a una preparación manual los registros y archivos del **predecesor
efectivo inmediato**, incluidos los antecedentes que ese archivo ya retenía.
No busca el último READY ni acepta una lista arbitraria de archivos históricos.

La captura automática `OwnershipArchiveCapture` conserva íntegramente la guarda
de período inicial/sin CLOSED. El importador no la elude ni incorpora una
modalidad automática alternativa: falta conectar cierre/apertura de períodos,
activación y referencias heredadas con una captura posterior completa. Hoy no
hay un flujo de aplicación que produzca los períodos cerrados necesarios para
esta importación. Las cadenas A→B→C/devolución se prueban con archivos sintéticos,
no con transferencias reales. No crear períodos cerrados manualmente para usarlo
en producción ni interpretar READY como publicación.

## Fuente autorizable por estructura, no por su prefijo

El futuro llamador autenticado debe validar actor/destinatario/OTP/decisiones y
mantener la reserva drenada durante toda la preparación. Este servicio no
otorga permisos operativos ni expone controllers, cron o worker automático.

`start(archiveId, sourceArchiveId)` requiere:

- UUID explícitos, preparación destino COLLECTING manual (sin cursor `capture`)
  y control con propietario/versión/transferId coincidentes, sin activeWrites.
- Período ACTIVE destino coincidente. Exactamente un período de la versión
  inmediatamente anterior; debe ser CLOSED, tener endedAt y archiveId que
  vincule la cabecera fuente del mismo animal/dueño/período/versión.
- El destinatario de la fuente debe ser el dueño del destino y
  `sourceTransferId` del período activo debe coincidir con la transferencia
  fuente. Esto impide importar la vista equivocada cuando un dueño vuelve.
- Fuente READY con conteos sellados válidos, una ficha vigente, conteos reales
  de entradas/archivos coincidentes y ningún archivo sin verificar. Si es un
  período posterior, su propia importación debe estar COMPLETE y sus conteos
  de registros/archivos retenidos también deben coincidir.

La selección y fijación de fuente/conteos/hash en `history` van en una transacción
corta snapshot/primary/majority. El mismo origen se puede reintentar mientras
el destino siga COLLECTING; otro se rechaza. No se adopta una captura automática
ni una preparación sellada. Las transacciones no incluyen operaciones S3.

## Representación y conservación

Se reutilizan las tres colecciones de archivo, sin colección nueva, TTL,
backfill o cambio de índices únicos. Los campos opcionales `history` y
`retained` no tienen default: archivos anteriores mantienen su representación.

Cada antecedente usa `kind=RETAINED_RECORD`, payload original independiente y
procedencia explícita: archivo/entrada raíz, tipo/ID de recurso originales,
dueño/período/versión de origen y archivo/entrada/hash de la fuente inmediata.
La identidad técnica del registro retenido deriva de su raíz. No sustituye el
registro vigente del mismo UUID ni convierte una ficha vieja en la ficha actual.
El índice único existente archivo/tipo/recurso sigue siendo válido: el recurso
técnico retenido es la identidad de la raíz, no el ID del documento vigente.

Se conservan códigos, nombres/nameHistory, categorías, extracción, fechas
clínicas y primera aceptación. No se ejecuta IA, no se generan códigos y no se
reinician las 48 h médicas. `nameHistory` no se usa como historial de propiedad.
Se incluyen registros retenidos aunque ya no existan en las colecciones activas,
sin filtrar por fecha clínica ni fusionar revisiones de un mismo documento.
No se reconstruyen borrados anteriores que nunca fueron retenidos.

Las referencias `fileBindings` se remapean al manifiesto destino. La fuente
es exclusivamente `historicalKey` y la revisión `verified.historical` del
manifiesto anterior, nunca la URL activa guardada dentro del payload ni una
enumeración recursiva de S3. Se comprueban identidad/hash del registro y
manifiesto, ámbito del archivo, prefijo histórico exacto, revisión/tamaño,
digest previo y procedencia raíz. Referencia ausente/inconsistente falla cerrado.

Para conservar jerarquía y distinguir revisiones, se reserva:

```text
relativeKey = retained-history/{rootArchiveId}/{rootFileId}/{originalRelativeKey}
histórico = users/{owner}/animals/{animal}/ownership-archives/{archiveId}/{relativeKey}
staging   = users/{recipient}/animals/{animal}/transfer-preparations/{archiveId}/{relativeKey}
final planificado = users/{recipient}/animals/{animal}/{relativeKey}
```

La raíz permanece estable al encadenar períodos: no se anidan indefinidamente
subrutas retained-history. Dos cortes del mismo recurso permanecen separados.
En una devolución las claves no pisan la copia activa ni el archivo anterior.
El preparador de fuentes vigentes rechaza explícitamente retained-history,
igual que histórico/staging/intake: no se relaja su validación de propietario.

## Páginas, carreras, sellado y copias

`importBatch(archiveId)` procesa como máximo 100 entradas por ID. Verifica de
nuevo fuente/relación de períodos y reserva. Cada append usa la transacción
existente de entrada/manifiesto y su hash inmutable; una página parcialmente
persistida se reejecuta sin duplicar. No inspecciona S3 durante la importación.
Una entrada puede tener varios adjuntos: el límite no acota archivos/bytes por
entrada; costes/latencia requieren medición posterior.

Primero se guardan entradas y luego el checkpoint: revisión/cursor/conteo/fuente
se comparan completos en COLLECTING. Instancias concurrentes pueden repetir
trabajo, pero no sumar dos veces ni regresar el cursor. Una página llena exige
otra llamada, incluso si la última resulta vacía. Cursores repetidos/regresivos,
páginas excesivas o conteos distintos impiden completar.

El checkpoint COMPLETE escribe la cabecera para competir con append/sellado y
comprueba entradas y archivos retenidos reales en la misma transacción de
mayoría. El sellado vuelve a comprobar estos conteos y exige una ficha vigente.
Una preparación de versión >1 sin importación completa ya no puede sellarse
por el preparador manual. La captura inicial sin `history` conserva su contrato.

`OwnershipArchivePreparer.copyBatch` conserva leases/reintentos y realiza las
copias. Para archivos retenidos, el SHA-256 del origen fijado debe coincidir
con el digest verificado anterior ANTES de copiar; se verifican también las
dos copias destino. Si falta/cambió el objeto histórico no se usa como fallback
el archivo activo ni se elige una revisión nueva. No escribe el final
planificado, ni borra objetos, libera la reserva o publica información.

Un error puede ocurrir después de persistir: conservar IDs y reintentar la
misma operación/consultar progreso. No inferir rollback ni limpiar por edad.
Los fallos conservan reserva/progreso; la recuperación de esa reserva sigue
pendiente de otro protocolo, sin force-unlock o equivalencia con cancelación.

## Compatibilidad y límites

Contrato central de frontend:
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md),
subbloque 12. No cambia HTTP, DTO, éxitos/errores, cargas o permisos públicos;
no requiere ajustes Flutter nuevos. Sí cambia el contrato interno de sellado
manual posterior y de procedencia/copia descrito arriba.

Las pruebas verifican cadenas sintéticas, independencia de snapshots,
integridad y comandos/filtros Mongo/S3 con dobles. No demuestran rollback,
majority, índices, privacidad/IAM, concurrencia distribuida o retención reales
de este importador. La validación Mongo del subbloque 11 cubre otro protocolo
(journal/claims), no esta importación. Antes de producción faltan además corte
S3 completo, integración de referencias activas, permisos/descargas históricas,
conservación ante reemplazo/borrado, recuperación, rollout y limpieza segura.
La transferencia completa no está habilitada. Vencimiento y cancelación siguen
pendientes de confirmación.

Paso posterior disponible (subbloque 13):
[plan persistido de referencias](./ownership-archive-reference-plan.md) por
entrada sobre un archivo READY. No modifica payload/contentHash, no convierte
antecedentes en activos y mantiene compatible esta importación. PLANNED no
publica ni activa; la captura posterior/cierre/apertura sigue pendiente.
