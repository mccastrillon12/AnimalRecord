# Preparación interna de archivos de propiedad

Auditoría subbloque 28: `AwsOwnershipArchiveStorage.copyAndVerify` fija el ORIGEN
y comprueba digest, pero sus copias a histórico y staging NO tienen condición de
DESTINO. El lease técnico y los checkpoints cercados no detienen una copia AWS
ya enviada; otro worker puede reclamar después del lease. Inmutabilidad lógica de
cabecera/manifiesto no significa inmutabilidad física de estos objetos. Contrato
de cierre/retención propuesto, sin cambio de ejecución o copia nueva:
[animal-transfer-stable-s3-cut.md](./animal-transfer-stable-s3-cut.md).

Checkpoint inicial sobre `991eeb8`, 2026-10-25. El preparador recibe registros
de otro caso de uso; no concreta una transferencia. El seguimiento está en
[final-delivery-plan.md](./final-delivery-plan.md).

Actualización subbloque 3: los handlers de escritura ya registran operaciones
activas; adquirir reserva exige su fin y ventanas de URL vencidas. Ver
[animal-write-coordination.md](./animal-write-coordination.md). Este preparador
ya tiene un llamador interno de preflight/captura paginada del periodo inicial
en el subbloque 4: [ownership-archive-capture.md](./ownership-archive-capture.md).
Sigue pendiente el corte S3/PUT tardíos y antecedentes retenidos. No invocarlo
como aceptación productiva.

Actualización subbloque 12: importador interno explícito de antecedentes para
preparaciones manuales. Conserva raíces/procedencia y usa solo copias históricas
verificadas del predecesor efectivo; añade RETAINED_RECORD, history/retained
opcionales y namespace retained-history. El sellado manual de versión >1 exige
importación completa y conteos reales. No cambia los índices ni se ejecuta
migración. La captura automática inicial, activación, retención/permisos y cierre
de períodos no se amplían. Contrato exacto en
[ownership-archive-history.md](./ownership-archive-history.md).

Actualización subbloque 13: un plan interno persistido puede describir los
bindings históricos y destinatarios de un READY. No copia destinos finales ni
activa referencias y no altera el significado de READY o el protocolo de copia.
Detalle en [ownership-archive-reference-plan.md](./ownership-archive-reference-plan.md).

Actualización subbloque 14: el servicio separado
[OwnershipArchiveMaterializer](./ownership-archive-materialization.md) sí puede
copiar del staging verificado al final bajo intención persistida y condición de
destino vacío. No cambia este copyBatch histórico/staging ni activa referencias.
Una colisión se deniega sin sobrescribir; READY mantiene su significado previo.

Actualización subbloque 5: la carga nueva de medios está aislada y se sella antes
de referenciarla. El preparador rechaza temporal como fuente activa y exige
registro sellado de foto/diario antes de inspeccionar/copiar. En esos medios
inspeccionar verifica además hash/procedencia, no un HEAD de un archivo legacy.
La transición legacy no se ejecuta automáticamente; continúa bloqueando salida
integral. Ver [animal-media-upload-isolation.md](./animal-media-upload-isolation.md).

## Componentes disponibles

`OwnershipArchiveModule` registra `OwnershipArchivePreparer`, el repositorio
Mongo y el adaptador S3. Se importa desde AnimalTransferModule. No tiene
controllers, cron, workers automáticos ni escrituras S3 al arrancar.

Colecciones nuevas:

| Colección                          | Contenido y garantías                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `animal_ownership_archives`        | Cabecera por periodo/transferencia, dueño anterior, destinatario, versión esperada, hash de definición, estado y conteos esperados.                                                                       |
| `animal_ownership_archive_entries` | Una ficha, entrada de diario o documento médico por registro, con copia JSON, hash estable y vínculos a los archivos del manifiesto. Índices únicos por ID y por archivo/tipo/recurso; paginación por ID. |
| `animal_ownership_archive_files`   | Una referencia por objeto de origen: revisión S3, claves de histórico/preparación/destino final, estado, lease técnico y evidencia de verificación.                                                       |

`COLLECTING → COPYING → READY` son estados de preparación. **READY no publica
el archivo, no cierra el periodo ni cambia `Animal.ownerId`.** No existe una
transición de publicación en este módulo. La fecha efectiva de propiedad debe
establecerse posteriormente en el commit de transferencia, no desde `createdAt`
del archivo.

## Uso interno previsto

### Enlace por ítem después de CAPTURE_SEALED (bloque 72)

**Implementado:** `TransferItemCapture.inspectCopyPreparation(selector)` reutiliza
las seis fuentes y la tx snapshot/primary/majority de la consulta por ítem. Autoriza
al destinatario antes de leer asociados y exige decisión/versión/ítem PROCESSING,
claim, cabecera y reserva originales, período inicial ACTIVE y ningún CLOSED.
No escribe fences, reclama archivos, llama almacenamiento o ejecuta `copyBatch`.
Permanece en el módulo interno fuera del grafo HTTP, sin provider/worker nuevo.

El selector es el mismo de captura; aquí la revisión debe ser EXACTA, no antigua.
La cabecera debe estar COPYING/READY con cursor COMPLETE sin afterId, conteo de
entradas positivo e igual al capturado, y conteo de archivos entero no negativo.
Ausencia/corrupción causa conflicto; no rellena ni adopta cabeceras anteriores.
La salida `ITEM_COPY_PREPARATION_OBSERVATION_V1` es solo un contrato de lectura,
no un protocolo persistido: `observedSeal` liga hash de decisión, archivo/definición,
binding/epoch de reserva, revisión y conteos sellados. `observedSealHash` compara
esa identidad; no firma una capacidad ni calcula un digest del manifiesto.
No incluye payloads, rutas S3, URLs o tokens de lease.

Siempre devuelve `BLOCKED`, `copyDispatch/businessCommit: NOT_AUTHORIZED`,
reserva `OBSERVED_ONLY` y corte `NOT_ASSESSED`, incluso READY o cero archivos.
`missingRequirements` enumera STABLE_CUT_EVIDENCE, COPY_EFFECT_PROTOCOL y
ARTIFACT_RETENTION: son dependencias sin soporte en este enlace, no un inventario
remoto ni una validación de evidencia aportada. Campos desconocidos no las satisfacen.
Una lectura puede quedar obsoleta al retornar; no es admisión ni lease exclusivo.

**Requisitos pendientes antes de conceder envíos:** no pasar este hash o
CAPTURE_SEALED directamente a `copyBatch`. Reutilizar manifiesto/preparador/reserva
y los mecanismos existentes de CAS/intención, con estos requisitos persistidos:

| Requisito | Disponible | Falta antes de conceder envío por ítem |
| --- | --- | --- |
| Identidad original | Decisión/claim, binding de cabecera y epoch | Revalidar y escribir fences sobre solicitud/ítem/claim/control en la tx que concede cada permiso; no adoptar otra reserva. |
| Selección completa | Cursor COMPLETE y conteos; entradas/manifiesto con hashes individuales | Recorrido paginado hasta vacío, digest de entradas/manifiesto y definición inmutable del corte ligados a esa identidad. Los conteos observados no lo sustituyen. |
| Fuentes y cobertura | Revisiones por archivo, sello foto/diario, journal/inventarios locales | Evidencia durable de fuentes efectivamente preservadas y de todos los escritores/efectos relevantes: terminados suficientemente o aislados de esas fuentes. Cobertura desconocida bloquea; MAY_RUN/HEAD/terminal local no la cierran. |
| Histórico/staging | Definiciones del 73 e intención histórica persistida del 74 | Procedencia verificable del digest, origen efectivamente preservado, observación histórica/staging, permiso por envío físico/retry y evidencia de todos los intentos. W12 actual no condiciona destino ni enumera envíos. |
| Conservación | ETag/tamaño/VersionId opcional y SHA-256 tras copia | Garantía versionada comprobable de lectura/retención para fuentes, histórico y staging; proteger delete/recreate y permisos previos. No hay política AWS instalada/aprobada por este bloque. |
| Commit posterior | Planes/materialización generacional, observación/consumo transaccionales | Ligar corte, manifiesto, garantías y efectos a esa evidencia y consumirla con TODAS las escrituras de negocio en la misma tx; los recibos actuales por sí solos no lo autorizan. |

### Definiciones puras por archivo (bloque 73)

`buildItemHistoricalCopyIntent` y `buildItemStagingCopyIntent`, en
`domain/transfer-item-copy-intent.ts`, describen dos efectos sin leer/escribir Mongo
o almacenamiento. Reutilizan la inspección pura del 72 y el manifiesto existente:
validan snapshot/selector, hash/ID del archivo y rutas derivadas del dueño/animal.
Solo período inicial, sin fuentes retained/temporales/históricas como origen vivo.
La validación de período ACTIVE/ausencia de CLOSED y pertenencia real del archivo
al manifiesto requiere el futuro repositorio transaccional: el builder no lee esas
fuentes ni autentica el snapshot aportado.

`ITEM_ARCHIVE_COPY_INTENT_V1` fija bucket explícito de backend, binding de decisión/
reserva/sello observado, archivo/hash, clave/revisión de origen, SHA-256/tamaño y
destino con `ifNoneMatch: '*'`. Histórico usa la fuente original; staging exige
una observación explícita con intención/hash, bucket/clave histórica, revisión,
tamaño y digest coincidentes. Liga el hash de esa observación y del predecesor;
`file.state = VERIFIED` o el recibo legacy no la sustituyen. El builder comprueba
coherencia local de la observación, no que un proveedor leyó/verificó esos bytes.

Los resultados quedan congelados y separados de objetos del caller. El ID lógico
por sello/archivo/etapa no cambia por bucket/digest/lease; cambiar la definición
produce otro hash que el futuro store deberá rechazar para ese ID. Ese store debe
conservar una única intención por archivo/etapa; otro sello/ID no autoriza sustituirla.
Las revisiones fijadas y VersionId opcional no certifican conservación. Siempre declaran
corte/retención NOT_ASSESSED y copyDispatch/businessCommit NOT_AUTHORIZED.
El sello observado aún no es digest del manifiesto ni evidencia de corte estable.

El 73 no conectó callers, persistencia o permisos. El 74 añade solamente la
persistencia histórica descrita abajo; staging, intentos físicos y envíos siguen pendientes.

### Persistencia histórica por archivo (bloque 74)

`TransferItemCapture.prepareHistoricalCopy` reutiliza la tx snapshot/primary/majority
del ítem, ahora con el modelo de archivos del manifiesto en la misma conexión.
Recibe selector original, fileId, hashes esperados de archivo y sello observado,
bucket explícito y sourceSha256 declarativo del backend. No recibe un intent armado
ni permite reemplazar destino/definición. Congela la entrada antes de esperar.

La tx relee y valida decisión/ítem PROCESSING/claim/cabecera/control, período inicial
ACTIVE y ausencia de CLOSED; resuelve el archivo en ese manifiesto. Exige cabecera
COPYING, revisión exacta, archivo PENDING y ausencia de lease/recibos/materialización,
además de los pins esperados. Reutiliza los fences captureStepRevision de solicitud,
ítem/claim y archivePreparationRevision del control; no avanza el cursor ni cambia
versiones de negocio. El CAS persiste `historicalCopyIntent` una sola vez junto a
esos fences, con el modelo puro del 73. Una definición existente debe coincidir
completamente; otro hash/bucket/digest/sello, null o corrupción se deniegan sin reparar.
Replay exacto vuelve a validar/escribir fences, conservando el archivo y la intención.

El recibo mínimo contiene IDs/hashes/replayed y reserva FENCED_AT_PREPARATION,
no claves, bytes o credenciales. Siempre NOT_AUTHORIZED para envío/negocio y
NOT_ASSESSED para corte/retención. Un resultado incierto conserva reserva/intención;
repetir exactamente los pins reconcilia sin enviar. No libera, readquiere, limpia,
convierte V1 o incorpora trabajo con lease/recibos anteriores.

Compatibilidad interna: ItemCaptureStore añade el método y el adaptador requiere
un séptimo modelo; el módulo explícito lo registra sin autoCreate/autoIndex. Campo
opcional Mixed, sin default/backfill/índices nuevos. Solo esta preparación exige
preflight de la colección existente y sus unicidades id y archiveId/sourceKey,
sin instalar requisitos. Observe/avance/inspección conservan sus seis fuentes.

El claimant base de copias excluye cualquier archivo que tenga historicalCopyIntent,
incluidos null/malformados: el nuevo pin no habilita el copyBatch anterior.
Los demás archivos conservan ese protocolo. Esto protege solo el código actualizado;
no drena réplicas antiguas o copias ya autorizadas/iniciadas. PENDING sin lease ni
recibo tampoco prueba que nunca hubo I/O remoto: la definición no adopta ni cierra
esa incertidumbre. El hash suministrado no certifica lectura de bytes o retención.

No se conecta el módulo al grafo HTTP, worker o SDK; aceptación pública y cambio de
dueño siguen bloqueados. El **75 prepara/compila 22 casos nuevos, 85 totales** en el
arnés opt-in existente, sin ejecución Mongo. Incluye tx/rollback/replay, concurrencia,
respuesta de aplicación perdida tras commit reconocido, invalidación y ambas
carreras con el claimant base. La ficha/manifiesto/pins se siembran sintéticamente
bajo la decisión/reserva originales: no prueba captura con archivos ni bytes S3.
El **76 ejecutó 85/85 en primera pasada, 44.794 s**, en Mongo 8.0.34 local de un
miembro/dos clientes, sin fixes. 85 namespaces ausentes, contenedor retirado/27018
libre; autorización utilizada/cerrada. Almacenamiento prohibido, sin copyBatch;
no cambia este contrato, su ejecución o la ausencia de permiso de negocio.
[Evidencia por caso/namespace/hash](./validation/transfer-historical-intent-mongo-76.json).
El digest declarativo persistido aún no demuestra lectura o conservación. El 77
añade el lector/verificador aislado descrito abajo, sin persistir esa observación.

### Observación histórica por bytes (bloque 77)

**Implementado:** `MongoTransferItemCapture.readHistoricalCopy` reutiliza la tx de
lectura y las siete fuentes del 74. Exige intención persistida idéntica, pins de
archivo/sello/bucket/digest y decisión/claim/reserva/período inicial originales;
no crea intención, adquiere fence o cambia estado. No devuelve el sujeto interno
si falla cerrar la sesión. Un snapshot puede quedar antiguo;
esta lectura no concede una reserva vigente durante el I/O posterior.

`ItemHistoricalCopyObserver` se construye explícitamente con ese puerto y un lector.
Revalida la definición persistida con el builder del 73 y separa/congela sus pins
antes de leer. Solo observa el histórico: HEAD actual → lectura con revisión fijada
→ HEAD actual. Compara bucket/clave, ETag/VersionId opcional/tamaño en las respuestas
y SHA-256 calculado por streaming; rechaza exceso/defecto de bytes, chunks inválidos,
cambios, ausencia o fallos. Cierra el stream incluso tras error y conserva el error
primario si también falla cerrar. No reintenta, repara o prueba otra fuente.

`AwsItemHistoricalObjectReader` recibe un cliente SDK explícito, cuyo ciclo de vida
conserva el backend; solo HEAD/GET, sin crear clientes, credenciales o leer entorno.
Los HEAD consultan el objeto actual; GET usa IfMatch y VersionId cuando existe.
404 de HEAD significa ausencia; otros errores no se convierten en vacío. GET
404/412 implica conflicto, los demás fallos externos se sanitizan. Solo stream Node.
No se fabrica materialización final ni ticket/journal HTTP para reutilizar lectores
de otros protocolos; sí se reutilizan revisión/hash, definición y builder de staging.

La salida `ITEM_HISTORICAL_BYTE_OBSERVATION_V1` conserva binding original, observación
compatible con el builder del 73 (intención/hash, bucket/clave, revisión y digest) y
observationHash. `bytes: MATCH` compara bytes leídos con el digest DECLARADO de la
intención; no demuestra que ese digest describa el origen correcto. Procedencia,
corte y retención siguen NOT_ASSESSED; reserva OBSERVED_ONLY y envío/negocio
NOT_AUTHORIZED. El objeto puede cambiar después del HEAD final. Los puertos son
colaboradores de confianza, no autenticación de una prueba JSON aportada por cliente.

Sin provider/import en el grafo, worker, endpoint, nuevo schema/índice o escritura
de evidencia. ItemCaptureStore añade el método de lectura; preparaciones/consultas
previas y HTTP conservan sus contratos. El 77 solo se ensayó con transacciones,
streams y cliente SDK simulados, sin sockets; los 85 Mongo del 76 son anteriores.

**Próximo contrato de persistencia, pendiente:** recibir el resultado del observador
interno, releer intención/manifiesto/decisión/claim/control/período originales y
comparar todos los pins. Con CAS/fence en una misma tx técnica, conservar la
observación y la intención de staging calculada por el builder existente; replay
exacto sin sustituir revisión/digest o adoptar otro sello/epoch. No aceptar un DTO
con MATCH, refijar hashes o tratar la lectura antigua como permiso. Esa persistencia
seguirá sin enviar: cobertura de efectos, procedencia del origen, versión recuperable
y garantías verificables de conservación siguen pendientes antes de autorizar copia.

El ledger de promociones ordinarias sirve de referencia para permiso/retry,
pero exige journal/ticket HTTP: no fabricar esos IDs para archivos de transferencia
ni reutilizar permisos leídos.
La política efectiva de retención/infraestructura y su acreditación siguen abiertas;
sin ellas no habrá autorización de copia. Error, edad, lease vencido o revocación
no cierran permisos anteriores ni permiten liberar la reserva. No convertir V1,
levantar la guarda inicial, fabricar CLOSED o ampliar recuperación.

Cada archivo necesita dos efectos dependientes: fuente preservada → histórico,
y revisión/digest verificados de ese histórico → staging. No conceder el segundo
por progreso local del primero ni recuperar otro envío con su permiso anterior.
Intenciones, autorizaciones y respuestas deben conservarse aunque cambie el lease;
los recibos finales actuales no enumeran los intentos inciertos. Retención requiere
un mecanismo verificable y alcance explícito, no un booleano aportado por el caller.

La validación de cada bloque se registra en el plan de entrega. El ensayo Mongo
76 cubre la persistencia local del 74, no el lector nuevo del 77, retención, envíos
o efectos remotos. El 71 sigue como evidencia anterior, solo de captura sin archivos.

### Protocolo de bajo nivel existente

Actualización subbloque 20: NUEVAS cabeceras guardan reservation inmutable
ARCHIVE_RESERVATION_V1. begin exige explícitamente el epoch adquirido como tercer
argumento; creación, append/checkpoint/sellado y claim/confirmación/release/cierre
compiten por la reserva original dentro de transacciones snapshot/primary/majority.
No se reanudan cabeceras anteriores sin vínculo ni se refijan sus hashes. Hashes
de definición/snapshots/manifiestos y rutas S3 originales permanecen iguales.
Las firmas/guardas del texto original se actualizan según
[ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).

1. El caso de uso de aceptación deberá validar propiedad/animal activo,
   análisis/revisiones pendientes y establecer un corte consistente después de
   resolver escrituras ya iniciadas. El protocolo HTTP ya existe; faltan
   drenaje de cargas antiguas y cierre de efectos S3 tardíos. Preflight/captura
   del periodo inicial están disponibles internamente en el subbloque 4.
2. `begin(definition, false, reservationEpoch)` requiere IDs válidos, destinatario distinto y la reserva
   de transferencia con dueño/versión/transferId coincidentes. Mongo comprueba
   también que `periodId` sea el periodo activo correspondiente. Reintentar la
   misma definición devuelve la cabecera existente; cambiarla causa conflicto.
3. `append(archiveId, record)` recibe registros del corte. Admite ficha, diario
   con fotos/audio y documentos aceptados individuales. Copia el JSON para que
   una mutación posterior del objeto en memoria no altere la instantánea.
   Conserva UUID, código, `nameHistory`, categoría, extracción, procedencia y
   fechas médicas sin ejecutar IA ni generar nuevos códigos.
4. Cada objeto se vincula mediante un ID determinista y una ruta JSON del
   payload. Las referencias médicas duplicadas a un mismo objeto comparten una
   entrada del manifiesto. Al añadir un registro se obtiene ETag, tamaño y
   VersionId cuando S3 lo devuelve. Los reintentos idénticos no vuelven a leer
   ese objeto; un contenido diferente no puede sobrescribir el corte.
5. Mongo persiste registro y manifiesto en una transacción corta. La escritura
   de la cabecera serializa añadir registros frente a sellar el archivo.
   `seal(archiveId, expectedEntryCount)` exige el conteo exacto y una única ficha;
   desde entonces no se añaden recursos nuevos.
6. `copyBatch(archiveId, limit)` procesa hasta 10 objetos por defecto, de 1 a 50
   por llamada. Reclama cada archivo con token/lease técnico de cinco minutos y
   vuelve a verificar la reserva antes y después de S3. El vencimiento del
   lease solo recupera trabajo técnico; no define el vencimiento de solicitudes
   de transferencia.
7. Una copia verificada queda registrada y los siguientes lotes la omiten. Un
   fallo deja el archivo reintentable; si el proceso muere o falla también Mongo,
   otro worker puede reclamarlo al vencer el lease. Solo el token vigente puede
   confirmar o liberar ese trabajo. No se mantiene una transacción Mongo
   abierta durante S3.

No invocar esta secuencia desde HTTP ni desde un job de producción hasta
implementar el corte estable y sus revalidaciones. La presencia de un lock por
sí sola no demuestra que las escrituras que empezaron antes hayan terminado.
El llamador también deberá demostrar que enumeró todos los recursos; el conteo
que recibe `seal` no sustituye esa enumeración.

## Jerarquía y verificación S3

Para un objeto de origen:

```text
users/{oldOwner}/animals/{animalId}/{relativeKey}
```

Se preparan:

```text
histórico: users/{oldOwner}/animals/{animalId}/ownership-archives/{archiveId}/{relativeKey}
receptor: users/{newOwner}/animals/{animalId}/transfer-preparations/{archiveId}/{relativeKey}
destino final registrado: users/{newOwner}/animals/{animalId}/{relativeKey}
```

`relativeKey` conserva categorías, documentos, revisiones y subdirectorios de
diario. El destino final **no se escribe** en esta etapa: evita sobrescribir
una copia activa anterior al preparar una devolución a un antiguo dueño.
La materialización posterior puede elegir explícitamente un destino generacional
antes de emitir intenciones. No modifica este manifiesto; el futuro commit debe
usar el mapeo final verificado, no recipientFinalKey directamente. Ver
[ownership-archive-generations.md](./ownership-archive-generations.md).
La instantánea conserva los datos originales y sus `fileBindings` describen qué
referencias deberán resolverse hacia las copias; no devolver su JSON crudo como
una respuesta pública ni tratar las URLs originales como descargas históricas.

Se rechazan objetos ajenos, rutas con segmentos vacíos/traversal y prefijos de
histórico/preparación usados como si fueran objetos activos. Los registros
médicos legacy multi-animal o con referencias inconsistentes deben normalizarse
antes. Importar el histórico retenido de periodos previos requiere un flujo
explícito adicional; no se enumera ni copia el bucket recursivamente.

El adaptador fija ETag y VersionId cuando existe, lee el origen como stream y
calcula SHA-256; copia al histórico y compara el SHA-256 de esa copia. Después
copia desde ese histórico verificado a la preparación del destinatario y
vuelve a comparar el contenido. Comprueba también la cantidad de bytes. No
utiliza ETag como si fuera siempre un hash de contenido.

S3 permite condicionar una copia al ETag de origen y seleccionar una versión
con `versionId`; el adaptador usa ambas condiciones cuando están disponibles.
La lectura también usa `IfMatch` y la versión fijada.
[CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html),
[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

Se usa copia simple para objetos de hasta 5 GiB. Un objeto superior se rechaza
como limitación técnica de este preparador; antes de admitirlo deberá existir
una implementación multipart y una revisión de la duración/renovación del lease.
No cambia los límites de carga existentes del frontend.

No se modifica IAM ni configuración del bucket. Validar acceso a los nuevos
prefijos y, si hay versionado, `s3:GetObjectVersion`, antes de integrar. Verificar
privacidad y reglas de lifecycle del bucket antes de prometer retención e
aislamiento de archivos históricos.

## Persistencia exacta del snapshot

Subbloque 23: la primera ejecución real del arnés de consumo detectó que Mongoose
eliminaba objetos vacíos del payload al crear entradas. Esto dejaba el contenido
guardado distinto de su contentHash y la planificación/revalidación lo rechazaba.
OwnershipArchiveEntrySchema usa ahora minimize=false: conserva {} tal como
participó en el hash, sin cambiar la canonicalización o relajar integridad.
Aplica a snapshots nuevos y retenidos, no al documento médico/diario/animal activo.
No añade campos, índices o migraciones; entradas antiguas dañadas no se rellenan
ni se rehashéan/adoptan. Todos los escritores deben usar el schema corregido.
Dos pruebas sin conexión preservan payload/bindings/hash; quince escenarios de
consumo Mongo pasan con la corrección, sin S3 real o prueba de captura integral.
Detalle: [ownership-archive-evidence-mongo-validation.md](./ownership-archive-evidence-mongo-validation.md).

## Conservación y trabajo pendiente

Este módulo no elimina objetos, ni originales ni preparaciones fallidas. Las
copias quedan referenciadas para reintento. No agrega borrados recursivos ni TTL
al histórico. El recolector de preparaciones abandonadas requiere un estado
terminal persistido, exclusión de workers y comprobación de referencias; sigue
pendiente, igual que la política de limpieza de esas preparaciones.

Faltan: cierre del corte S3/efectos tardíos y captura entre periodos;
incorporación de antecedentes retenidos; conectar preflight al futuro endpoint
de decisión sobre el conjunto de animales antes de persistir decisiones;
activación de las referencias finales y conservación en borrados/reemplazos;
commit de propiedad/periodos con auditoría/notificaciones; consultas históricas
autorizadas y descarga firmada; limpieza segura; pruebas con replica set y S3
reales. Las reglas de cancelación/vencimiento de transferencias siguen abiertas.

## Compatibilidad frontend

No se añade ningún endpoint, campo DTO, código HTTP, URL de carga ni cambio de
respuesta en este subbloque. Flutter no requiere ajustes. El contrato de éxito
anterior y el nuevo son iguales en animales, diario, documentos, catálogos y
buscador. No consumir los estados internos ni llamar las rutas de histórico
propuestas hasta que se publiquen sus contratos.
