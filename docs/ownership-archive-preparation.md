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
| Selección completa | Cursor COMPLETE/conteos, hashes individuales, acumulador/lector del 81–82 y digest persistido del 83; ensayo Mongo del 88/91 | Consumo transaccional futuro. El recorrido local no acredita cobertura remota o conservación. |
| Fuentes y cobertura | Revisiones por archivo, sello foto/diario, journal/inventarios locales | Evidencia durable de fuentes efectivamente preservadas y de todos los escritores/efectos relevantes: terminados suficientemente o aislados de esas fuentes. Cobertura desconocida bloquea; MAY_RUN/HEAD/terminal local no la cierran. |
| Histórico/staging | Intención histórica, observación histórica/intención de staging y observación de origen persistidas; observación de staging cercada del 89, validada en Mongo por el 91 | Enlazar/consumir el conjunto completo de evidencia. Origen efectivamente preservado, permiso por envío físico/retry y evidencia de todos los intentos pendientes. W12 actual no condiciona destino ni enumera envíos. |
| Conservación | ETag/tamaño/VersionId opcional y SHA-256 tras copia | Garantía versionada comprobable de lectura/retención para fuentes, histórico y staging; proteger delete/recreate y permisos previos. No hay política AWS instalada/aprobada por este bloque. |
| Commit posterior | Planes/materialización generacional, observación/consumo transaccionales | Ligar corte, manifiesto, garantías y efectos a esa evidencia y consumirla con TODAS las escrituras de negocio en la misma tx; los recibos actuales por sí solos no lo autorizan. |

### Contrato de intento físico de copia (bloque 92)

**Auditoría y reutilización:**

| Componente actual | Uso para este contrato / límite |
| --- | --- |
| Intenciones y observaciones por ítem | Son las definiciones lógicas existentes de histórico/staging. Reutilizar builders, binding/epoch, hashes y pareja histórica; no crear otra definición de rutas ni adoptar V1. |
| Efectos/persistencia de promociones | Reutilizar el patrón puerta/CAS/intento/autorización/respuesta y filas acotadas, no el scope HTTP: exige journal ordinario y ticket de carga, incompatibles con la reserva de transferencia. No fabricar esos registros ni cambiar el protocolo de medios. |
| Dispatcher de promociones | Referencia para interceptar cada delegación física por debajo de retries/redirecciones y no reenviar tras error local. El actual depende de selección/contexto HTTP; no conectarlo directamente al archivo. |
| Materialización generacional | Reutilizar conservación de definición/intención y condición de destino donde corresponda. Sus leases/checkpoints no enumeran envíos físicos; no convertir V1 o cambiar generación ante conflicto. |
| W12 `copyAndVerify` | Emite histórico y staging mediante `client.send`; su CopyObject solo fija origen. No usarlo como una delegación física única ni como transporte del nuevo contrato. |

**Implementado, solo definición pura:** `buildItemCopyAttemptIntent`, en
`domain/transfer-item-copy-attempt.ts`, recibe contexto original, etapa explícita
HISTORICAL/RECIPIENT_STAGING y UUIDs canónicos del intento e instancia de dispatcher.
Reconstruye/compara la intención histórica existente; staging exige también la
pareja histórica/intención persistidas exactas. No copia bucket/rutas/revisión/SHA
de otro payload: los liga por el ID/hash de la intención lógica y su binding
original de ítem/decisión/archivo/sello/reserva. No crea una preparación ausente.

`ITEM_COPY_ATTEMPT_INTENT_V1` fija ID, instancia, etapa, origen INITIAL/
APPLICATION_RETRY/SDK_RETRY, ordinal técnico y definitionHash. INITIAL tiene
ordinal 1 sin predecesor; retries usan identidad nueva y ordinal anterior + 1,
con referencia plana a intento/hash/authorizationId anterior. Comprueba forma,
hash completo, mismo scope/definición y alias inmediatos, sin arrays crecientes.
No recicla el contador al agotar enteros seguros. Definición y binding separados/
congelados; repetir el cálculo produce los mismos datos, nunca permiso de envío.

**Límite de confianza:** el contexto y la referencia de autorización son datos
aportados, no prueba de persistencia, de un grant real ni de que ese sea el último
intento. El builder no detecta todos los UUIDs usados antes ni si ya existía un
INITIAL; el store del 93 comprueba las declaraciones iniciales. El helper siempre
devuelve reserva OBSERVED_ONLY, corte/retención NOT_ASSESSED y envío/negocio
NOT_AUTHORIZED. Por sí solo no persiste ni autoriza o conecta SDK/HTTP.

**Contrato objetivo del permiso, aún sin implementar:**

- Puerta técnica de la decisión/ítem y reserva originales, común a sus archivos/
  etapas; su identidad no debe cambiar por bucket/digest para eludir una revocación.
  CAS de puerta e intención/intento en filas acotadas; no guardar arrays crecientes
  en el archivo. La intención lógica existente ya representa el efecto.
- Declarar metadata puede preceder garantías remotas, pero conceder permiso exige
  relectura/autenticación interna de intención, manifiesto, evidencia de fuentes/
  cobertura y garantías efectivas de conservación. Los protocolos de estas últimas
  siguen pendientes: observaciones/HEAD/digest no los sustituyen y bloquean el grant.
- La tx que autoriza debe escribir la misma puerta y los cuatro fences de solicitud/
  ítem/claim/control originales, conservar período inicial ACTIVE sin CLOSED y
  comparar revisión/epoch exactos. Validar unicidad de intento/ordinal/authorizationId
  y el último intento realmente autorizado para cada retry; no confiar en la referencia
  JSON del builder. Sin TTL, reetiquetado, recuperación por edad o liberación por error.
- Solo acknowledgement fresco de un grant nuevo permite UNA delegación física;
  replay/lectura de AUTHORIZED nunca devuelve otra capacidad. Resultado de grant
  incierto conserva incertidumbre, sin envío o reenvío. Cada retry/redirección del
  SDK requiere otro intento/permiso antes de delegar, con request serializado fijado
  y validado contra la intención; no envolver solamente `client.send`/`copyBatch`.
- Revocar impide grants futuros, no cancela permisos concedidos o copias pausadas;
  no equivale a cancelación funcional de transferencia. Guardar respuesta/evidencia
  también después de revocar, sin borrar permisos, reenviar o reparar destinos.
  Adoptar la cautela del dispatcher actual: HTTP 200/handler resuelto no prueba
  CopyObject exitoso ni cierre; registrar UNKNOWN mientras falte evidencia suficiente.
- Cierre exige evidencia/aislamiento suficiente de TODOS los intentos concedidos y
  conservación de artefactos; un MATCH no descarga otros permisos. Futuro consumo
  con TODAS las escrituras de negocio en la misma tx. Recuperación sigue limitada
  al protocolo previo al permiso; este contrato no amplía legacy/MAY_RUN.

La persistencia inicial del 93 implementa puerta y declaraciones; los requisitos
de permiso, retries y transporte anteriores siguen pendientes. No integrar
automáticamente el dispatcher actual ni habilitar aceptación pública o propiedad.

El bloque 96 precisa los vínculos entre manifiesto, reserva, fuente y evidencia
que deberá releer el autorizador. La admisión del primer envío y el corte para
el commit tienen alcances distintos. [Contrato de evidencia por ítem](./animal-transfer-stable-s3-cut.md#evidencia-por-ítem-antes-de-autorizar-una-copia-bloque-96).

### Puerta e intentos INTENDED persistidos (bloque 93)

**Implementado:** `MongoTransferItemCapture` implementa también el puerto interno
`ItemCopyRecordStore`: read/open/revoke de puerta y declare de intento INITIAL.
Reutiliza la tx snapshot/primary/majority de 15 s y las guardas de destinatario,
decisión/versión/ítem PROCESSING, claim, cabecera/sello y reserva/epoch originales;
período inicial ACTIVE y ausencia de CLOSED. Las mutaciones escriben los cuatro
fences de solicitud/ítem/claim/control y la puerta en la misma tx. Leer no adquiere
fences. No libera la reserva ni cambia archivos, estado de negocio o propietario.

`animal_transfer_copy_records` contiene filas acotadas `ITEM_COPY_RECORDS_V1`:

- GATE: identidad por decisión/ítem/reserva, binding/hash originales, revisión
  exacta y OPEN/REVOKED. Su ID no depende de archivo, etapa, bucket o digest;
  cambiar esos datos no evade la revocación. `identityIds` contiene el ID y, solo
  si se revoca, un UUID de revocación con referencia opaca de auditoría.
- ATTEMPT: definición pura del 92 completa, ID/instancia, gateId, intención lógica,
  ordinal 1, estado INTENDED e `identityIds` de un elemento. No duplica la
  definición de rutas ni guarda arrays crecientes en archivo o puerta.

Abrir exige cabecera COPYING; replay conserva identidad y avanza revisión técnica.
Declarar exige puerta OPEN/revisión exacta, archivo PENDING sin lease/recibos,
intención histórica persistida exacta y, para staging, su pareja histórica completa.
Revalida también observaciones presentes; no acepta corrupción/huérfanos. CAS de
puerta, fences e inserción de intento son atómicos. Un INITIAL distinto para la
misma intención se deniega; replay exige misma fila/hash y revisión de puerta
recién leída, sin reemplazar el intento. Si se pierde la respuesta tras commit,
releer/repetir solo reconcilia metadatos: ningún resultado concede envío.

Revocar puede crear una puerta REVOKED antes de abrir; si existe exige revisión
exacta. Nunca reabre ni sustituye la primera auditoría. Replay de la misma revocación
es solo metadatos y avanza revisión. Conserva intentos/reserva, no cancela la
transferencia ni resolvería permisos previos. Requiere aún la reserva original;
no introduce recuperación operativa tras perderla.

Cuatro índices declarados: únicos por id, identityIds y (copyIntentId, ordinal)
parcial ATTEMPT; además (gateId, row, id). El preflight exige colección/índices y
conexión compartida, sin DDL/TTL/backfill, autoCreate o autoIndex. El modelo noveno
solo se exige para estos métodos: siete fuentes para puerta, ocho para declarar;
los caminos previos de seis/siete/ocho fuentes mantienen sus requisitos.
`TransferItemCaptureModule.register`, fuera del grafo HTTP, registra el modelo y
exporta `ItemCopyRecordStore` mediante useExisting del repositorio de captura.

**Pendiente:** no hay estado/operación de autorización, respuesta, lease de envío,
dispatcher, worker o SDK. El store rechaza SDK_RETRY/APPLICATION_RETRY y referencias
JSON de permisos: todavía no existen predecesores autorizados durables que releer.
Cobertura/corte/conservación siguen NOT_ASSESSED y envío/negocio NOT_AUTHORIZED.
Los 233 casos del 91 son anteriores a este protocolo. El instalador operativo
del 61 todavía excluye esta colección.

### Arnés de puerta e intentos (bloque 94)

El arnés opt-in de aceptación añade 31 casos, para un total de 264. La colección
de registros de copia se prepara con sus cuatro índices dentro del namespace
desechable de cada caso. Las pruebas comparan la transacción de cuatro fences y
las filas de puerta/intento, rollback en seis puntos de declaración y en la
inserción de puerta, replay tras respuesta de aplicación perdida, revocación
anterior a abrir y carreras entre dos clientes. También fuerzan conflictos
de unicidad directamente en Mongo y comprueban el rechazo ante colección o
índices ausentes.

Las barreras reutilizan el arnés existente y actúan antes de las operaciones del
driver. Las lecturas de objetos para preparar staging usan datos sintéticos.
El bloque 95 validó **264/264 escenarios en 154.043 s** sobre Mongo 8.0.34 local
de un miembro con dos clientes. La pérdida de respuesta se inyectó en la
aplicación después de un commit reconocido por Mongo. Se comprobó la eliminación
de las 264 bases desechables y del contenedor. La cobertura del ensayo termina
en persistencia de metadatos y conserva pendientes el envío, el cierre remoto
y la retención. [Evidencia por caso, namespace y huella](./validation/transfer-copy-records-mongo-95.json).

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

El 73 no conectó callers, persistencia o permisos. El 74 añade persistencia
histórica y el 78 observación histórica/intención de staging, descritas abajo;
intentos físicos, envíos y observación de staging siguen pendientes.

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
antes de leer. Su método `observe` observa el histórico: HEAD actual → lectura
con revisión fijada → HEAD actual. Compara bucket/clave, ETag/VersionId opcional/tamaño en las respuestas
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

### Observación de bytes del origen original (bloque 85)

**Implementado:** `ItemHistoricalCopyObserver.observeSource` reutiliza el mismo
puerto `readHistoricalCopy`, builder y lector explícito del 77. Exige la intención
histórica original ya persistida y los mismos pins de decisión/claim/reserva/archivo;
no deriva un SHA antes de declarar esa intención. Cierra la tx de lectura antes
del I/O. Reutiliza la secuencia HEAD actual → GET condicional/stream → HEAD actual,
ahora sobre `intent.source.key`. La primera revisión debe coincidir exactamente
con ETag/tamaño/VersionId opcional del manifiesto original; no adopta un HEAD nuevo
ni busca una versión antigua cuando cambió el objeto actual. GET usa IfMatch y,
si estaba fijado, VersionId. Compara revisión, cantidad de bytes y SHA-256 declarado;
cierra el stream y conserva el error primario si falla también el cierre.

`ITEM_SOURCE_BYTE_OBSERVATION_V1` separa este resultado del histórico. Incluye
binding, intención/hash, bucket/clave/revisión y hash de observación congelados.
No puede consumirse como observación histórica ni como predecesor de staging.
MATCH solo acredita la comparación del stream observado con el digest declarado
bajo esos pins y colaboradores de confianza. No autentica JSON, persiste evidencia,
escribe fences o acredita conservación/cobertura de escritores remotos. La reserva
puede cambiar durante el I/O y el objeto después del HEAD final: OBSERVED_ONLY,
procedencia/corte/retención NOT_ASSESSED y envío/negocio NOT_AUTHORIZED.

Sin modelo/schema/provider/worker/HTTP nuevo; `observe` y el preparador de staging
mantienen sus contratos. Validado con sesiones, streams y SDK simulados, sin sockets.
El 86 añade persistencia bajo la reserva original; consumo y conservación siguen
pendientes. Los 148 casos originales del 84 son anteriores a estos métodos;
el 87 amplía el arnés y el 88 ejecuta ese alcance con streams sintéticos, sin S3.

### Persistencia de la observación de origen (bloque 86)

**Implementado:** `ItemSourceObservationPreparer` compone el observador del 85 y
`resumeSourceObservation`/`confirmSourceObservation` del mismo store de siete
fuentes. Recibe los pins originales de preparación histórica; no acepta MATCH o
evidencia en la entrada. Sin dato persistido, la consulta devuelve null sin fences.
El I/O del origen termina antes de abrir la transacción de confirmación.

La confirmación captura/congela forma y hashes antes de esperar; reconstruye la
intención desde el archivo/sello actual y exige binding, intención/hash, bucket,
clave, revisión original y SHA declarado exactos. No autentica JSON como prueba:
el puerto es exclusivo del colector interno de confianza. La tx snapshot/primary/
majority de 15 s revalida decisión/ítem PROCESSING/claim, período inicial ACTIVE sin
CLOSED y reserva/epoch originales; exige archivo PENDING sin lease/recibo o
materialización e intención histórica idéntica ya persistida. Los cuatro fences
originales y el CAS de `sourceByteObservation` comparten esa transacción.

Campo opcional Mixed en el manifiesto existente, sin default/índice/backfill.
Queda fuera del hash de definición y del digest del manifiesto; no cambia cursor,
estado, versiones de negocio, intención histórica u observación/intención de staging.
Ambas preparaciones pueden coexistir en cualquier orden; origen no sustituye la
lectura histórica ni habilita staging por inferencia. Replay revalida/escribe fences
y reconstruye el recibo desde lo persistido sin otro I/O de objetos ni reemplazo.
Dato corrupto/null, huérfano sin intención o identidad diferente bloquean, sin reparar.
El claimant base excluye este cuarto campo incluso huérfano; no protege réplicas
antiguas o efectos ya autorizados.

La observación conserva OBSERVED_ONLY; el recibo mínimo usa FENCED_AT_PREPARATION
e IDs/hashes/replayed, sin claves o credenciales. Procedencia/corte/retención siguen
NOT_ASSESSED y envío/negocio NOT_AUTHORIZED. Persistir una lectura pasada no prueba
preservación remota. Sin nuevo modelo/provider/HTTP/worker, copyBatch o cambio de dueño.
Validado con transacciones/streams simulados; ni los 115 Mongo del 80 ni los 148
preparados del 84 cubren el 85–86. El **87 añade/compila 39 casos, 187 totales**,
en el mismo arnés: persistencia/replay/carreras de origen y convivencia con
histórico/staging; sin SDK/almacenamiento real. Tres barreras de un uso, lector
sintético compartido y seis guardas nuevas sin conexión. No ejecutados en el 87.
El **88 ejecutó 187/187 en primera pasada, 91.924 s**, sin fixes, en Mongo 8.0.34
local de un miembro/dos clientes. 187 namespaces ausentes, contenedor retirado y
27018 libre; autorización utilizada/cerrada. [Evidencia](./validation/transfer-source-observation-mongo-88.json).
Comprueba persistencia/carreras locales con streams sintéticos, no preservación remota.
Consumo conjunto, cobertura remota, conservación y permisos físicos de copia siguen pendientes.

### Anclaje local de la fuente histórica (bloque 97)

`ItemManifestObserver.anchorHistoricalSource` recibe los pins de la preparación
histórica y el `expectedManifestHash`. Reutiliza el recorrido completo con
keyset de hasta 100 filas por página, terminal vacío en ambas fases y lectura
`COMPLETE`. Durante el recorrido comprueba que aparece el archivo con el ID y
hash de definición esperados. Exige la coincidencia del digest completo, incluso
si las diferencias están en otros archivos.

`readHistoricalSourceForAnchor` relee el digest persistido, la intención
histórica y `sourceByteObservation` del archivo en una transacción final
snapshot/primary/majority de 15 s. Reutiliza los validadores de manifiesto,
intención y bytes, junto con las guardas de decisión, claim, cabecera, reserva
original y período inicial ACTIVE sin CLOSED. Exige cabecera COPYING y archivo
PENDING sin lease, recibo ni materialización. Si falta o cambió alguno de los
datos, el anclaje falla. Las páginas usan ocho fuentes y la lectura final usa siete.

El resultado inmutable `ITEM_HISTORICAL_SOURCE_ANCHOR_V1` liga el binding de
ítem/reserva y archivo con el digest y los hashes de intención y observación.
`anchorHash` permite comparar ese resultado. Cada página y la lectura final
observan su propio snapshot. El anclaje conserva `OBSERVED_ONLY` y depende de
la inmutabilidad de las filas selladas durante el recorrido.

El flujo usa lecturas de Mongo sin escribir fences y devuelve referencias y
hashes. El observador usa el mismo store para el recorrido y el nuevo puerto.
Cobertura, corte y retención quedan `NOT_ASSESSED` y los permisos
`NOT_AUTHORIZED`.

### Arnés del anclaje histórico (bloque 98)

El arnés existente añade 23 casos, para un total de 287. Prepara el manifiesto,
la intención y la observación de origen con los mismos servicios y datos
sintéticos. Los casos ejercitan páginas posteriores y `firstBatch` cortos,
pertenencia, digest del conjunto completo y los datos exigidos en la transacción
final. La barrera antes de esa transacción permite invalidar la evidencia desde
el segundo cliente. La barrera existente antes de leer el archivo cubre el caso
en que un snapshot anterior aún puede devolver una observación y una lectura
nueva rechaza el cambio.

El bloque 99 validó **287/287 casos en 148.938 s** con Mongo 8.0.34 local,
un miembro y dos clientes. La primera corrida completó 252 casos y 35 se
detuvieron durante la creación de índices por espacio insuficiente. Ampliar
el volumen temporal de 1 a 2 GiB resolvió el bloqueo con el mismo código.
El resultado de un snapshot anterior conserva `OBSERVED_ONLY` y una lectura
nueva detecta la invalidación. Ambas corridas verificaron sus 287 namespaces
ausentes. [Evidencia y limpieza](./validation/transfer-source-anchor-mongo-99.json).

### Observación de retención de la fuente histórica (bloque 100)

`observeHistoricalSourceRetention` reutiliza el recorrido y el anclaje del 97.
El lector y el reloj se suministran por composición interna. El puerto del store
entrega al observador el selector exacto de la intención original. La salida
de `anchorHistoricalSource` conserva sus referencias y hashes.

`AwsItemHistoricalObjectReader` consulta `GetObjectRetention` con el bucket,
clave y `VersionId` originales y el `ExpectedBucketOwner` de la configuración
explícita del backend. Exige versión presente y distinta de `null`, bucket
coincidente, respuesta 200, modo COMPLIANCE y fecha válida. Los errores de
proveedor se propagan con un mensaje técnico acotado.
[API de consulta](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObjectRetention.html).

La consulta ocurre fuera de las transacciones locales. Tras la respuesta, el store
relee la reserva, el manifiesto, la intención y la observación de origen en un
snapshot nuevo. El observador compara las identidades y comprueba que la fecha
reportada siga en el futuro al terminar. El resultado inmutable liga el
`anchorHash` a un hash del selector con su cuenta esperada, el modo, la fecha
reportada y la hora de observación. La lectura no escribe fences ni persiste el
resultado. Conserva `OBSERVED_ONLY`, las garantías `NOT_ASSESSED` y los permisos
`NOT_AUTHORIZED`.

Esta primera lectura registra metadatos de la versión. El SDK fijado (3.1003.0)
expone modo y fecha, pero omite el estado de la retención por evento. S3 puede
informar una fecha calculada para un evento activo. Sigue pendiente determinar
un horizonte utilizable y acreditar legibilidad, incluidos acceso, cifrado y
clase de almacenamiento. La observación no define una política de retención
ni un plazo de la transferencia.
[Consideraciones de Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).

### Persistencia del reporte de retención de origen (bloque 101)

`ItemManifestPreparer.prepareHistoricalSourceRetention` recibe los selectores
del anclaje. El propietario esperado del bucket se configura en el backend.
Primero intenta releer el reporte local. Si falta y los predecesores siguen
vigentes, obtiene el reporte mediante el observador del 100 y lo confirma.

`MongoTransferItemCapture` valida el digest persistido, la intención histórica,
la observación de bytes y la reserva original en el mismo snapshot. Recalcula
el hash del anclaje y el del selector exacto con el propietario configurado.
La primera confirmación escribe los cuatro fences y el reporte en una sola
transacción. El archivo debe seguir `PENDING` y el campo
`sourceRetentionObservation` debe estar ausente. El campo es opcional y queda
fuera del digest y de las definiciones. El reclamador legado excluye incluso
un campo huérfano, y la intención y la observación de bytes no pueden
reinstalarse alrededor de ese campo.

La relectura y la confirmación idéntica devuelven el primer reporte sin escribir
ni llamar al proveedor. Los datos incompatibles o malformados se rechazan.
El reporte puede releerse después de su fecha si las guardas originales siguen
vigentes. Conserva `OBSERVED_ONLY`, `NOT_ASSESSED` y `NOT_AUTHORIZED`.
La primera consulta requiere recorrer el manifiesto como en el 100. La
relectura usa su digest persistido y la inmutabilidad de las filas selladas.
El horizonte de protección utilizable y las demás evidencias del corte siguen
pendientes.

### Arnés del reporte de retención de origen (bloque 102)

El arnés opt-in suma 17 casos (304 totales). Reutiliza las dos conexiones,
el manifiesto sellado y las barreras existentes con un lector sintético de
retención. Comprueba la escritura conjunta de reporte y fences, la relectura
posterior a la fecha reportada y el rollback en cada escritura. Hace competir
dos transacciones de confirmación con reportes iguales o distintos.
También cubre invalidación antes y durante la confirmación, reporte nulo o
propietario distinto, exclusión del reclamador legado y respuesta perdida
después de un commit reconocido. Pendiente de ejecutar en Mongo desechable
con autorización nueva.

### Observación e intención de staging persistidas (bloque 78)

**Implementado:** `ItemStagingCopyPreparer`, de construcción explícita, recibe solo
los pins de preparación histórica del 74. Primero consulta `resumeStagingCopy`:
sin pareja persistida valida las siete fuentes originales y retorna null sin
escribir fences. Entonces usa el observador del 77, con todo el I/O de objetos
fuera de transacción, y llama `confirmHistoricalObservation`. El store captura y
congela los valores del resultado antes de esperar, valida forma/hash/binding y
recalcula ambas intenciones desde el contexto persistido actual. No acepta una
intención de staging aportada ni un DTO MATCH en la entrada del preparador.
El puerto de confirmación es para el colector interno de confianza: su validación
no autentica que un JSON provenga de una lectura real.

La confirmación relee decisión/ítem PROCESSING/claim/cabecera/control/período inicial
ACTIVE sin CLOSED, archivo PENDING sin lease/recibos/materialización, intención
histórica idéntica y pins exactos de archivo/sello/bucket/digest. Escribe los cuatro
fences originales y, en un único CAS del archivo y la misma tx snapshot/primary/
majority, guarda juntos `historicalByteObservation` y `stagingCopyIntent`. No cambia
el hash de definición del manifiesto, cursor, estado o versión de negocio. Reutiliza
builder/reserva/manifiesto, sin colección, índice, default, backfill o provider nuevo;
los dos campos opcionales son Mixed. ItemCaptureStore añade ambos puertos internos.

Una pareja existente debe coincidir completamente con la reconstrucción actual.
Replay exacto revalida/escribe los cuatro fences y reconstruye el recibo desde
lo persistido sin reemplazar campos ni leer objetos otra vez; reconcilia una respuesta
de aplicación perdida tras commit reconocido. Una nueva observación de otra revisión,
pareja parcial/corrupta o invalidación original causa conflicto, sin reparar/adoptar.
Un resultado incierto conserva la reserva y la definición; no habilita otro envío.
El claimant anterior excluye cualquiera de los tres campos de preparación, incluso
null o huérfanos sin intención histórica. Esa guarda solo protege código actualizado,
no réplicas antiguas ni I/O ya autorizado.

Recibo mínimo con IDs/hashes/replayed y reserva FENCED_AT_PREPARATION, sin claves
o credenciales. La observación conserva OBSERVED_ONLY: persistirla no demuestra
vigencia remota después del HEAD. MATCH sigue relativo al digest declarado;
procedencia/corte/retención NOT_ASSESSED y envío/negocio NOT_AUTHORIZED.
Fuera del grafo HTTP, sin worker, copyBatch, copias, aceptación o cambio de dueño.
Pruebas del 78 con transacciones/streams simulados; el ensayo Mongo del 76 no lo cubre.

El **79 prepara/compila 30 escenarios nuevos, 115 totales**, en el arnés opt-in
existente: pareja/fences, rollback, replay sin nueva lectura, confirmaciones
concurrentes, invalidación y errores de aplicación posteriores al commit/cierre.
Incluye negativos de lectura/digest/revisión, corrupción, unicidades y claimant.
Usa manifiesto y streams sintéticos, sin SDK/almacenamiento; las guardas y el AST
se prueban sin conexión. **Los 115 no se ejecutaron en el 79.**
[Propuesta del 79, ejecutada/cerrada en el 80](./final-delivery-plan.md#subbloque-79-arnés-de-observaciónstaging-preparado-sin-mongo).

El **80 ejecutó 115/115 en primera pasada, 71.699 s**, en Mongo 8.0.34 local de
un miembro/dos clientes, sin fixes de runtime/arnés. 115 namespaces ausentes,
contenedor retirado/27018 libre; autorización utilizada/cerrada.
[Evidencia por caso/namespace/hash](./validation/transfer-staging-intent-mongo-80.json).
Comprueba la persistencia local con streams sintéticos, no SDK/S3, procedencia,
retención o cierre remoto; no modifica contratos o concede permisos.

### Observación y persistencia de bytes de staging (bloque 89)

**Implementado:** `ItemHistoricalCopyObserver.observeStaging` reutiliza el colector
y lector explícito HEAD/GET condicional/stream/HEAD. `readStagingCopy` usa las mismas
siete fuentes, tx snapshot/primary/majority y guardas de decisión/claim/archivo/sello,
reserva original y período inicial ACTIVE sin CLOSED. Reconstruye la intención
histórica y la pareja observación histórica/intención de staging; exige igualdad
completa con lo persistido, incluido el hash del predecesor. Ausencia/corrupción
bloquea antes de I/O; no crea una intención faltante. La lectura no escribe fences
y cierra su sesión antes del I/O. Los pins se separan/congelan antes de esperar.

Lee solo `stagingIntent.destination.key`; su revisión se fija desde el HEAD actual,
sin reutilizar la revisión histórica como si identificara staging. GET usa IfMatch
y VersionId cuando existe. Compara revisión, tamaño y SHA declarado por streaming
y revalida HEAD actual al terminar. Reutiliza validación de revisión de los builders;
errores/ausencias/cambios bloquean, cierre de stream obligatorio y error primario
conservado si también falla cerrar. No hay retry ni lectura alternativa de origen.

Salida `ITEM_STAGING_BYTE_OBSERVATION_V1`: binding original, intención de staging/
definitionHash (que liga el predecesor), bucket/clave/revisión/SHA y observationHash.
No sustituye protocolos de origen/histórico ni es predecesor histórico de staging.
Los colaboradores internos son de confianza: forma/hashes no autentican un JSON
como prueba de que se leyeron bytes. La revisión observada puede quedar antigua.

`ItemStagingCopyPreparer.prepareObservation` añade el enlace completo al mismo
preparador, sin otra capa: consulta `resumeStagingObservation`, observa solo si
falta el dato y llama `confirmStagingObservation` fuera del I/O. La consulta vacía
exige pareja válida y retorna null sin fences; no llama automáticamente `prepare`
para fabricarla. Confirmación captura/congela antes de esperar, relee los pins y
predecesores, escribe los cuatro fences originales y un CAS de
`stagingByteObservation` en el archivo existente, en una sola tx de 15 s.

Campo opcional Mixed, sin default/índice/backfill, fuera de definición/digest del
manifiesto. Replay exacto escribe fences y devuelve IDs/hashes/replayed sin otra
lectura de objetos ni reemplazo. Otra revisión, dato corrupto/null o huérfano
bloquean; no alteran origen, histórico, intenciones, cursor, estado o versión de
negocio. El claimant base excluye también este quinto campo incluso huérfano;
no protege réplicas antiguas o efectos ya autorizados. `prepare` conserva su
recibo histórico/intención de staging; `prepareObservation` devuelve el hash de
la observación del destino staging, ligado al mismo intentId de staging.

La observación conserva OBSERVED_ONLY; recibo FENCED_AT_PREPARATION. Procedencia,
corte y retención NOT_ASSESSED, envío/negocio NOT_AUTHORIZED. Cambio posterior al
HEAD final no acredita conservación. Sin modelo/provider/worker/HTTP nuevo, copias
o aceptación. Métodos históricos/de origen conservan comportamiento válido; sus
constructores internos usan ahora los puertos nuevos del mismo adaptador/observador.
Pruebas con sesiones/streams/SDK simulados, sin sockets. Los 187 Mongo del 88 son
anteriores: no cubren el 89. El **90 prepara/compila 46 nuevos/233 totales** en el
mismo arnés: CAS/fences, rollback/replay, confirmaciones concurrentes iguales y
distintas, invalidación, predecesores, corrupción y convivencia de evidencias/digest.
Tres barreras de un uso, modo STAGING del lector sintético y seis guardas nuevas
sin conexión; no cambia el contrato implementado. No se ejecutaron en el 90.
El **91 ejecutó 233/233 en primera pasada, 119.087 s**, sin fixes adicionales de
runtime/arnés, en Mongo 8.0.34 local de un miembro/dos clientes. 233 namespaces
ausentes, contenedor retirado/27018 libre; autorización utilizada/cerrada.
[Evidencia](./validation/transfer-staging-bytes-mongo-91.json). Valida persistencia y
carreras locales con streams sintéticos, sin probar retención/corte o copia remota.
Siguiente: contrato de permiso por intento físico de histórico/staging bajo la
intención/reserva originales; reutilizar efectos existentes sin fabricar journal/ticket HTTP.

### Contrato puro de recorrido y digest local (bloque 81)

**Implementado:** `ItemManifestDigest` recibe selector original, expectedSealHash,
snapshot y resolver puro de URLs del backend. Reutiliza la inspección del 72,
`buildArchiveEntry` y la proyección/validación inmutable de archivo extraída de las
intenciones del 73 (`captureItemArchiveFileDefinition`). Esa extracción conserva
IDs/hashes/pins y resultados válidos de las intenciones históricas/staging.
Sin lector, store, schema, índice, provider, worker o contrato HTTP nuevo.

Fases ENTRIES → FILES → COMPLETE, con cursor por ID y páginas de hasta 100.
Una página corta no termina una fase: exige otra lectura hasta página vacía,
también para cero archivos. Cada página y finish revalidan el snapshot aportado
contra el sello original; no adoptan otra época/revisión o conteos. Cada fase
exige IDs hash en orden estricto, sin repetidos dentro/entre páginas ni reordenación.
Una página inválida no avanza cursor, digest o referencias. Una vez completo no
acepta más páginas; finish repetido revalida identidad antes de devolver el resultado.

Reconstruye cada entrada inicial para comparar ID/recurso/hash/bindings/payload;
exige exactamente una ficha ANIMAL y conteos sellados exactos. La unión de archivos
referidos debe coincidir con el conteo de manifiesto; archivos compartidos cuentan
una vez. Cada archivo debe estar referido y coincidir con sus rutas/definición,
revisión y hash originales; faltantes, huérfanos, retained o corrupción se deniegan.
Payloads y pins se separan del caller; solo conserva hashes y el mapa de referencias.
Memoria O(archivos únicos), más la fila/página de entrada: no promete espacio
constante o límites de negocio. El estado es local, sin importación/reanudación
desde un JSON de progreso ni checkpoint durable; reiniciar exige repetir el recorrido.

`ITEM_MANIFEST_DIGEST_V1` define dos cadenas SHA-256 mediante `archiveHash`:
raíz `archiveHash([protocolo, 'ENTRIES'|'FILES'])`; cada fila encadena
`{previous,id,contentHash}` o `{previous,id,definitionHash}` respectivamente.
Los límites de página no entran en el digest. Excluye metadatos operativos
(leases, planes, estados de trabajo, intenciones y observaciones de bytes) y no
refija hashes existentes. `manifestHash` liga el resultado sin ese campo: protocolo,
binding de ítem/decisión/sello, conteos, ambas cadenas y sus indicadores de alcance.
Cambios válidos de payload o revisión inmutable cambian su digest correspondiente.

Resultado congelado sin payloads/rutas: integrity DECLARED_COUNTS_AND_BINDINGS_MATCH,
reserva OBSERVED_ONLY, procedencia/corte/retención NOT_ASSESSED y envío/negocio
NOT_AUTHORIZED. **Es validación pura de datos aportados**, no autenticación de
snapshots, páginas vacías o colectores; no demuestra cobertura del expediente
vivo ni procedencia del SHA declarado en una intención. Los 115 Mongo del 80 son
anteriores y no cubren este acumulador.

### Lectura interna del manifiesto por ítem (bloque 82)

**Implementado:** `MongoTransferItemCapture.readManifestPage` reutiliza la misma
transacción del ítem con sus seis fuentes de identidad más archivos y entradas
existentes. Autoriza al destinatario antes de asociados y relee decisión/ítem
PROCESSING/claim/cabecera/control, reserva original y período inicial ACTIVE sin
CLOSED. Exige el mismo expectedSealHash antes de consultar filas; no adquiere
fences, cambia progreso o persiste un digest. Snapshot/primary/majority, límite
de tx 15 s, commit 5 s y consulta de filas 5 s. Una lectura puede quedar antigua
al retornar; no mantiene una reserva exclusiva durante todo el recorrido.

Cursor interno ENTRIES/FILES/COMPLETE con afterId hash y límite fijo 100, separado
y congelado antes de esperar. Consulta solo el archiveId resuelto desde la decisión,
con ID > afterId, orden ascendente/collation simple y singleBatch; no usa skip,
getMore, atajo por página corta o máximo de negocio. Comprueba tamaño, identidad
y orden de la página antes de devolverla. Filas se leen en la misma sesión que
la identidad; sus proyecciones contienen solo payload/bindings/definiciones
necesarios, sin leases/intenciones/observaciones de copia. Un fallo al cerrar
sesión impide devolver página; conserva un error de dominio previo si lo hay.

Solo este enlace requiere las ocho colecciones/modelos en la misma conexión y
sus requisitos existentes: archivos id/archiveId-sourceKey; entradas id,
archiveId-kind-resourceId y recorrido archiveId-id, además del preflight previo.
Los requisitos de entradas/archivos no admiten índices parciales o de collation
incompatible; TTL se deniega en las ocho fuentes. No instala/repara DDL.
El constructor del adaptador y el módulo explícito añaden el modelo
de entradas, sin schema/índice nuevo ni autoCreate/autoIndex. Consultas/avance
previos mantienen seis fuentes e histórico/staging siete: no dependen de readiness
de entradas. Los callers internos de construcción se actualizaron, incluido el arnés.

`ItemManifestObserver` se compone explícitamente con el puerto y resolver puro de
URLs; no está registrado como provider/worker/HTTP. Su entrada acepta solo selector
y sello, nunca cursor, resultado o JSON de progreso. Consume páginas mediante el
acumulador del 81 hasta vacío real de ambas fases, incluidas cero filas de archivos.
Después abre otra lectura COMPLETE para revalidar antes de finish. COMPLETE es
solo una petición de snapshot final, no una prueba aportada de recorrido completado.
Ante error descarta estado local; no reintenta otra revisión o adopta otro sello.
Payloads quedan dentro del recorrido; devuelve solo el digest congelado del 81.

El resultado sigue OBSERVED_ONLY/NOT_ASSESSED/NOT_AUTHORIZED. Consistencia entre
páginas depende de la inmutabilidad de filas selladas bajo el protocolo existente;
no es un snapshot global ni detecta administración directa/restauración fuera de él.
No autentica datos de un puerto reemplazado por otro colector ni demuestra bytes S3,
procedencia del SHA declarado, retención o cierre remoto. Pruebas con sesiones/
modelos simulados; los 115 Mongo del 80 son anteriores y no cubren este enlace.

### Persistencia del digest observado (bloque 83)

**Implementado:** `ItemManifestPreparer`, de composición explícita, recibe solo
selector y sello. Primero usa `resumeManifestDigest`: si no hay dato persistido,
valida la identidad original y retorna null sin fences/lectura de filas. Entonces
recorre el manifiesto mediante el observador del 82 y llama `confirmManifestDigest`
en una transacción nueva, fuera de todas las páginas. No acepta JSON de resultado
en la entrada del preparador, reanuda un cursor externo o activa un worker/HTTP.

El puerto de confirmación es solo para el colector interno de confianza. Captura,
separa y congela el resultado antes de esperar; comprueba allowlists, protocolo,
indicadores de alcance, conteos, raíces vacías y coherencia de hashes del resultado
y sello. Esa validación **no autentica que un JSON haya recorrido las filas** ni
recalcula las cadenas dentro de la transacción de escritura. Confía en el lector/
acumulador interno y en la inmutabilidad protocolaria de las filas selladas.

La tx reutiliza preflight de ocho fuentes, guardas de decisión/ítem PROCESSING/
claim/período inicial ACTIVE sin CLOSED y reserva/sello/conteos originales. Exige
que el binding observado coincida completamente con el actual y escribe los cuatro
fences de solicitud/ítem/claim/control del mismo protocolo. Un único CAS de cabecera
persiste `manifestDigest` si estaba ausente, ligado a definición, estado observado,
reserva/epoch, revisión COMPLETE y ambos conteos. Todo en la misma tx snapshot/
primary/majority de 15 s. Rollback no deja el campo ni fences parciales; no escribe
filas del manifiesto, cambia hash de definición/cursor/estado o versiones de negocio.

`OwnershipArchive.manifestDigest` es Mixed opcional, sin default/backfill/índice,
fuera del hash de definición y de la reserva originales. No hay colecciones/modelos
o providers nuevos; ItemCaptureStore añade dos puertos internos. Consultas/avances
anteriores mantienen sus dependencias, y el observador del 82 sigue solo leyendo.
La preparación histórica/staging anterior conserva sus contratos e intenciones.

Un digest persistido debe pasar de nuevo forma/hash/binding contra la identidad
original. Replay exacto escribe solo los cuatro fences y reconstruye el recibo,
sin releer payloads/archivos, reemplazar la cabecera o volver a observar. Permite
reconciliar respuesta de aplicación perdida tras commit reconocido o error de
aplicación posterior al cierre de sesión. Null/corrupción o un resultado distinto
causan conflicto, sin reparación, refijación o adopción de otra reserva. Un fallo
de lectura/confirmación conserva el bloqueo original; no concede otro envío.

El campo conserva reserva OBSERVED_ONLY. Recibo mínimo con IDs/hash/conteos/replayed
y FENCED_AT_PREPARATION: esa transacción no es lease ni permiso de copia/negocio.
Procedencia/corte/retención permanecen NOT_ASSESSED y envío/negocio NOT_AUTHORIZED.
No detecta administración/restauración fuera del protocolo ni prueba bytes remotos.
No hay consumo/commit de propiedad: la evidencia deberá consumirse junto con TODAS
las escrituras de negocio en su transacción futura.

El **84 amplía/compila el arnés opt-in existente: 33 nuevos/148 totales**, sin
ejecutar Mongo. Incluye recorrido >100, caso de payload grande para provocar un
firstBatch corto, vacío final, cero archivos, confirmación/fences atómicos, rollback,
replay entre clientes, carreras de digest, invalidación y errores de aplicación
tras commit/cierre. Sus barreras no sustituyen resultados del driver. Metadatos
de commandStarted comprueban limit/singleBatch/orden/collation/sesión sin retener
queries o payloads; normalizan el Map de ordenación del driver instalado.
Datos/manifiesto sintéticos, sin captura con archivos, bytes remotos o SDK.
**Ninguno de los 148 se ejecutó en el 84.** Los 115 del 80 son anteriores al 81–83.
Validación local del 83/84 en el plan, con modelos/sesiones simulados.
[Propuesta del 84, sustituida por el 87](./final-delivery-plan.md#subbloque-84-arnés-del-recorridodigest-preparado-sin-mongo).

El 88 ejecuta **187/187, 91.924 s**, incluido este recorrido/digest, sin fixes;
[resultados/limpieza](./validation/transfer-source-observation-mongo-88.json).
El 89 añade observación/persistencia de bytes de staging, descrita arriba y
ensayada por el 91. Sin inferir permisos de copia/negocio del digest observado.
Antes de autorizar copias siguen pendientes cobertura de efectos, procedencia del
origen, versión recuperable, conservación verificable y permiso por envío físico.

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

La validación de cada bloque se registra en el plan de entrega. El 80 cubre el
enlace local del 77/78 con streams sintéticos; no el lector SDK o bytes remotos.
El 76 cubre persistencia histórica del 74 y el 71 captura sin archivos; ninguno
demuestra retención, envíos o cierre remoto.

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
