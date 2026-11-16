# Auditoría de escritores y evidencia para un corte estable S3

Subbloque 41: [23 casos de sellado preparados](./animal-media-promotion-seal-mongo-integration.md),
sin ejecución Mongo o instrumentación de writers. Transporte HEAD/GET falso y 50
guardas sin conexión aprobados; no prueban autenticidad/retención/cierre remoto.
INCOMPLETE/NOT_ASSESSED intactos. Ejecución del entorno propuesto requiere autorización.

Subbloque 40: [verificación + MATCH/seal atómicos aislados](./animal-media-promotion-verification.md).
HEAD/GET condicionado/HEAD comprueba bytes/revisión observados; no protege cambios
posteriores, delete/recreate o permisos anteriores. Sin instrumentar writers de
esta matriz ni integrar callers; INCOMPLETE/NOT_ASSESSED y retención/corte pendientes.
Nuevo método solo con dobles, no cubierto por los 49 casos reales del 39.

Subbloque 39: [49/49 casos en Mongo local autorizado](./animal-media-promotion-dispatch-mongo-validation.md),
28 de persistencia y 21 del dispatcher con HTTP falso. No instrumenta los escritores
de esta matriz ni demuestra AWS, fin remoto, retención o corte. INCOMPLETE/
NOT_ASSESSED conservados. Sin cambios de código/tests; 49 bases ausentes y contenedor
retirado. Falta verificación/sellado antes de callers y cobertura global posterior.

Subbloque 38: [arnés Mongo + dispatcher con transporte falso](./animal-media-promotion-dispatch-mongo-integration.md)
preparado/compilado, sin ejecución Mongo o instrumentación de esta matriz. El
guion HTTP no prueba copia, retención o cierre remoto; INCOMPLETE/NOT_ASSESSED
conservados. 21 escenarios nuevos preparados y 57 guardas sin conexión aprobadas.
Ejecutar el ensayo local propuesto requiere autorización específica.

Subbloque 37: [ticket/pin/sello cercados](./animal-media-promotion-ticket-fence.md)
en transacciones de declaración/intención/autorización. Sin integrar W01/W03 o
otros escritores de esta matriz: INCOMPLETE/NOT_ASSESSED. Un permiso concedido antes
de sello conserva incertidumbre/envío tardío, sin garantía frente a delete/recreate.
Guardas probadas con dobles; carreras Mongo ampliadas/compiladas, no ejecutadas.
No equivale a retención, drenaje remoto o autorización de corte estable.

Subbloque 36: [dispatcher interno de un efecto](./animal-media-promotion-dispatcher.md)
valida request/definición y obtiene permiso por delegación con handler controlado,
pero sigue fuera de los writers de esta matriz. UNKNOWN no prueba fin remoto;
faltan integración, ticket/sellado, cobertura/retención y autorizador de corte.

Subbloque 35: [SDK de promoción ensayado sin sockets](./animal-media-promotion-transport.md),
con requests/handlers falsos. La intercepción debe quedar debajo de retries y
redirects, con handler subyacente controlado. No instrumenta escritores de la
matriz ni demuestra efectos/retención/corte. maxAttempts/metadata no son cobertura.

Subbloque 34: [identidad enlazada a confirmaciones foto/diario](./animal-media-confirmation-context.md)
desde journal opt-in inicial hasta AnimalMediaUploads. No se conecta puerta/
autorización/SDK ni se cubre un envío físico adicional. W01/W03 siguen sin ledger
remoto de transporte; la marca no modifica INCOMPLETE/NOT_ASSESSED o el corte.

Actualización subbloque 33: [26 escenarios de persistencia de promociones](./animal-media-promotion-mongo-validation.md)
aprobados en Mongo local de un miembro; 52 bases de dos intentos y contenedor
eliminados. No conecta escritores de esta matriz ni demuestra transporte AWS,
retención, cierre remoto o autorización de corte. El resto conserva su alcance.

Subbloque 28, revisión estática sobre `2a4be2e`, rama
`codex/animal-transfer-planning`, árbol inicialmente limpio. Sin cambios de runtime,
endpoints, schemas, índices o reglas de negocio; sin operaciones Mongo/S3/AWS/Docker.
Se consultó documentación pública de AWS, no configuración ni datos de una cuenta.

## Estado y alcance

Actualización subbloque 31: ya existe [persistencia transaccional interna de efectos de promoción](./animal-media-promotion-persistence.md),
con filas/CAS/fences y revocación durable antes de abrir. Módulo fuera del grafo
actual, sin dispatch o índice real creado. Ningún escritor AWS de la matriz se ha
conectado: cobertura remota, corte estable, retención y ensayos S3 siguen pendientes.

Subbloque 32: [arnés Mongo de promociones](./animal-media-promotion-mongo-integration.md)
preparado/compilado, sin ejecución real. Pins y recibos sintéticos, sin modificar
escritores de esta matriz, SDK, retención o autorización de corte.

**Implementado:** coordinación de handlers HTTP, journal y claims, recuperación
transaccional anterior a MAY_RUN, aislamiento de nuevas cargas, reserva con epoch,
captura/preparación, planes, materialización generacional, registro PREPARED,
observaciones y lector/consumo transaccionales. Ninguno acredita por sí solo el
fin de todos los efectos remotos. No existe un autorizador de corte estable.

Actualización subbloque 30: modelo puro de intención/autorización para promociones
ordinarias foto/diario, separado del runtime y del journal. Prueba revisión/CAS,
revocación frente a permisos, retries modelados y respuestas perdidas; conserva
riesgo de TODOS los permisos previos, incluso sin envío registrado. No implementa
persistencia, instrumentación SDK o dispatch, cierre remoto o cobertura global.
Contrato durable propuesto y límites:
[animal-media-promotion-effects.md](./animal-media-promotion-effects.md).

**Objetivo funcional aprobado:** conservar el expediente exacto del antiguo dueño
y entregar una copia completa al destinatario. El propietario debe terminar o
descartar análisis/revisiones pendientes antes de aceptar. Descartar funcionalmente
no acredita cancelación de un trabajo del proveedor. La transferencia sigue
deshabilitada; vencimiento y cancelación continúan pendientes.

**Propuesta técnica de este documento:** contrato de evidencia y pruebas necesarias.
No hay nuevos estados persistidos, recuperación, permisos o políticas AWS instaladas.
La matriz cubre los escritores encontrados en el código actual; no demuestra
cobertura de despliegues anteriores, herramientas administrativas, IAM o lifecycle.

## Matriz de escritores y efectos

Las rutas siguientes son fuentes auditadas. «Pendiente» describe evidencia o
protecciones necesarias, no una capacidad implementada. Un callback que retorna
solo informa sobre las promesas locales esperadas por ese intento.

| ID / funcionalidad y fuente | Alcance y garantía actual | Brecha para el corte / prueba necesaria |
| --- | --- | --- |
| W01 Coordinación: [AnimalWriteCoordinator](../src/context/animal-transfer/application/animal-write-coordinator.ts), [journal Mongo](../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal.ts) | Los controllers de ficha, foto, diario y medicina adquieren claims y autorizan MAY_RUN antes del callback; resultado y liberación se registran aparte. | No enumera cada envío AWS, hijo, retry o compensación. LOCALLY_FINISHED no acredita fin remoto. Callers internos/directos y versiones antiguas requieren cobertura explícita. |
| W02 Emisión/PUT de foto y diario: [AnimalMediaUploads](../src/context/animal-media/application/animal-media-uploads.ts), [firmador compartido](../src/context/shared/infrastructure/storage/aws-s3-storage.service.ts) | Ticket durable; PUT nuevo solo a `upload-intake`; destino canónico separado. Control conserva ventana de validez de URL emitida. | Capacidad reutilizable, sin recibo por cada PUT ni vínculo ticket/operationId. Expiración y claim liberado no demuestran drenaje. Probar aislamiento efectivo respecto de todo artefacto autoritativo. |
| W03 Promoción/sellado: [AWS media](../src/context/animal-media/infrastructure/aws-animal-media-upload-storage.ts) | Fija revisión/digest, copia con condición de origen y destino `IfNoneMatch: '*'`; verifica identidad, tamaño y bytes. Ticket sellado no reconstruye un final borrado en una nueva confirmación. | Otro intento ya enviado puede terminar tarde. Borrar destino permite que una copia pendiente vuelva a crearlo. Probar retención/no reutilización o selección de versión preservada; reconciliar un intento no cierra todos los demás. |
| W04 Cargas legacy: [AnimalMediaUploads](../src/context/animal-media/application/animal-media-uploads.ts) | Confirmación sin ticket conserva compatibilidad; captura exige medio registrado/sellado. | No hay inventario completo de URLs directas emitidas por versiones previas. Ausencia de ticket no significa ausencia de escritor; no recuperar por antigüedad. |
| W05 Borrados ordinarios: [foto](../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase.ts), [diario](../src/context/diary/application/diary-entry-deleter.ts), [adjuntos](../src/context/diary/application/diary-attachment-manager.ts), [S3 compartido](../src/context/shared/infrastructure/storage/aws-s3-storage.service.ts) | Ficha persiste foto nueva antes de borrar anterior; controllers coordinados. | DeleteObject sin VersionId; adaptador compartido captura errores y retorna. RETURNED no prueba borrado, ni preservación histórica. Falta protección de retención y evidencia por efecto. |
| W06 Ingreso médico: [runner](../src/context/medical-document/application/medical-document-analysis-runner.ts), [almacenamiento](../src/context/medical-document/infrastructure/storage/aws-medical-document-storage.ts) | Documento persistido antes de subir originales/auxiliares a `medical-document-intake/{documentId}`. | PUT incondicional, devuelve URI sin revisión. Error puede dejar objeto o intento incierto. Separar originales que se conservarán de temporales demostrablemente irrelevantes. |
| W07 Trabajo asíncrono BDA: [analizador](../src/context/medical-document/infrastructure/ai/aws-bedrock-medical-document-analyzer.ts), runner | Invoca con clientToken, persiste ARN después de respuesta y consulta estado. El proveedor escribe outputs fuera del callback HTTP. | Ventana inicio aceptado/ARN no persistido. FAILED/REJECTED locales y limpieza no cancelan el trabajo. Evidenciar cada intento o demostrar aislamiento de sus salidas; no inferirlo del estado clínico. |
| W08 Fallback y rescate: [refresher](../src/context/medical-document/application/medical-document-analysis-refresher.ts) | Puede lanzar análisis alternativos y trabajos por página; espera cargas locales hermanas con allSettled. | Token de invocación y ARN registrado no son ledger completo de hijos desconocidos. Incluir cargas, trabajos y reintentos sin cambiar reglas de extracción/revisión. |
| W09 Aceptación/reemplazo: [reviewer](../src/context/medical-document/application/medical-document-reviewer.ts), [replacement](../src/context/medical-document/application/medical-document-replacement-service.ts) | Copias por animal; reemplazo usa destinos bajo revisión propia y actualización de metadatos coordinada. Rollback intenta borrar copias reconocidas. | CopyObject médico no fija revisión de origen ni condiciona destino. Respuesta perdida deja copia fuera de la lista reconocida. CAS de metadatos no impide copia/borrado AWS tardío. |
| W10 Eliminación/compensación médica: [association remover](../src/context/medical-document/application/medical-document-association-remover.ts), almacenamiento médico | Lee respaldo, borra objeto y cambia metadatos; ante fallo intenta restaurar bytes en la MISMA clave. Limpieza también usa DeleteObject/DeleteObjects por prefijo. | Restauración PUT incondicional puede terminar tarde. DeleteObjects Quiet no inspecciona Errors por clave; promesa cumplida no prueba limpieza total. Listado actual no enumera versiones ni cierra trabajos asíncronos. |
| W11 Migración legacy: [copier](../src/context/animal-media/application/legacy-animal-media-copier.ts) | Ticket determinista, pin/promoción/sello; checkpoints cercados. STOPPED técnico impide posteriores activaciones Mongo del worker detenido. | No aborta una copia ya enviada: puede quedar huérfana. STOPPED no es cancelación funcional ni prueba de fin remoto. Ensayar stop mientras copia está en vuelo. |
| W12 Histórico/staging: [preparer](../src/context/animal-transfer/application/ownership-archive-preparer.ts), [AWS archivo](../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-storage.ts) | Claim técnico de archivo, origen fijado y digest comprobado; reserva/checkpoint se revalidan después del I/O. Copia a `ownership-archives` y `transfer-preparations`. | CopyObject condiciona ORIGEN, no DESTINO. Lease de cinco minutos puede permitir otro worker mientras la copia anterior continúa. Fence Mongo no impide sobrescritura remota del histórico/staging. |
| W13 Final generacional: [materializer](../src/context/animal-transfer/application/ownership-archive-materializer.ts), [AWS materialización](../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-materialization-storage.ts) | Intención fija, generación separada, condición de origen y destino, identidad/digest verificados; no adopta colisión ajena. | No cubre delete/recreate, escritores externos ni conservación futura. Lease/reconciliación y registro PREPARED no cierran todos los intentos remotos. |
| W14 Observación/consumo: [observador S3](../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-s3-observation-storage.ts), [validación Mongo](./ownership-archive-projection-mongo-validation.md) | HEAD/GET fijado/HEAD y digest observados; lectura snapshot y consumo cercado probados en Mongo local. | Lectores no son escritores ni bloqueo S3. Snapshot antiguo puede devolver candidato; consumo protege Mongo, no futuras mutaciones de bytes. Recibos S3 del arnés son sintéticos. |

No se encontraron operaciones multipart explícitas en los adaptadores auditados.
Foto de usuario usa otro namespace; correo/SMS/feedback y contadores no escriben
bytes del expediente. Esta exclusión depende de que no se incorporen como fuentes
del archivo; añadir un writer o referencia exige revisar cobertura.

## Carreras que impiden afirmar cierre hoy

1. Claim liberado y URL vencida mientras queda una petición remota incierta.
   El aislamiento del temporal ayuda, pero debe cubrir todas las referencias y
   promociones pendientes; un reloj no constituye recibo de finalización.
2. Worker A envía copia a histórico, pierde respuesta y vence su lease. B reintenta
   y completa checkpoint; A termina después sobre el mismo destino incondicional.
3. Final observado, luego borrado; copia condicional ya enviada vuelve a crearlo.
   No convertir observación pasada en garantía de conservación o no reutilización.
4. BDA acepta inicio, respuesta/ARN no queda persistido; se marca FAILED y limpia,
   pero el proveedor vuelve a escribir outputs. Estado local no prueba cancelación.
5. Borrado médico seguido de conflicto Mongo inicia restauración; fallo o timeout
   de restauración deja un PUT incierto, aunque termine la petición HTTP.
6. DeleteObjects devuelve respuesta satisfactoria con errores individuales; el
   código no los verifica. «Limpieza completada» local no prueba ausencia remota.

Son trazas posibles según el código y contratos del proveedor, no fallos reales
reproducidos en este bloque. No autorizan retirar tokens ni repetir negocio.

## Contrato técnico propuesto, todavía sin implementar

Un corte deberá enlazar evidencia suficiente con artefactos que realmente se
conservarán/leerán. No exige esperar efectos demostrablemente aislados de ellos,
pero la irrelevancia deberá estar protegida y comprobada, no asumida por un prefijo.
La regla funcional de terminar/descartar pendientes médicos se mantiene aparte.

1. **Cobertura:** declarar versión de protocolo, escritores/despliegues cubiertos,
   fuentes, referencias y exclusiones justificadas. Datos previos, permisos o
   herramientas desconocidos son cobertura incierta, nunca conjunto vacío cerrado.
2. **Intención antes del envío:** identificar durablemente cada efecto, hijo,
   retry (incluidos los del SDK), limpieza y compensación; enlazarlo a operación/instancia, animal/versión
   y referencias de artefacto. Autorización de envío deberá competir con revocación
   e impedir envíos tardíos. No basta escribir «pendiente» y borrar un token.
   Revocar no elimina autorizaciones ya concedidas: un intento autorizado sin
   desenlace suficiente conserva incertidumbre aunque no haya constancia de envío.
   El journal actual no tiene este protocolo por efecto; no agregarle payloads,
   contenido clínico, URLs ni errores completos para simularlo.
3. **Evidencia diferenciada:** no enviado solo si existe fence que impide envío
   posterior; respuesta reconocida acredita ese intento; aislamiento acredita
   irrelevancia respecto de los artefactos seleccionados. Desconocido bloquea si
   no se prueba irrelevancia. Son conceptos propuestos, no nuevos enums públicos.
4. **Bytes y retención:** revisión/digest y selector efectivo preservados; usar
   versión recuperable con retención adecuada o generación de creación condicional
   con no borrado/no reutilización demostrables. VersionId hoy es opcional; no se
   afirma versionado/IAM/lifecycle configurado ni se elige una política productiva.
   Incluir también histórico y fuentes necesarias, no solo final destinatario.
5. **Cierre:** cada efecto relevante terminado con evidencia suficiente o aislado;
   todos los intentos autorizados cubiertos. Un HEAD, terminal local, edad, error,
   clientToken, ausencia de claim o progreso del lease no sustituyen esa evidencia.
6. **Vínculo al commit:** ligar futura evidencia a reserva original/epoch,
   manifiesto, pins de preparación/planes, corrida, selección/proyección y versión
   de garantías de conservación. Validar/consumir junto con TODAS las escrituras
   de negocio en la transacción del llamador. Esto no crea transacción Mongo/S3;
   la estabilidad remota depende de las protecciones y cobertura anteriores.

No hay protocolo nuevo para recuperar legacy/MAY_RUN o incertidumbre remota.
No adoptar preparaciones antiguas, refijar hashes ni inventar cancelación/TTL para
sortear evidencia faltante. Mantener guarda de captura del periodo inicial.

### Producción de evidencia para el corte posterior (bloque 235)

`LaterPeriodStableCutEvidenceProducer` usa las copias conservadas del
histórico y las copias de medios vigentes fijadas por la selección del
ítem. Coteja ambos conjuntos con sus digests, exige un informe independiente
de escritores y efectos, y vuelve a comprobar SHA-256 y retención
`COMPLIANCE` por versión. La fecha límite del informe es la menor entre
la cobertura y las retenciones observadas, siempre posterior al horizonte.

`produceAndRegisterLaterPeriodStableCut` obtiene la selección en una
transacción y realiza las lecturas de almacenamiento después de cerrarla.
En una segunda transacción reconstruye el mismo alcance, cerca la reserva
y las generaciones activas y registra mediante el mecanismo existente.
Si la selección cambia, rechaza el informe. El registro conserva
`NOT_AUTHORIZED`. El consumo y las escrituras de cierre siguen juntos en la
transacción del llamador.

El proveedor operativo de cobertura debe acreditar rutas antiguas y
externas bajo los controles vigentes. La retención y el cotejo de bytes
aportan evidencia por versión. El cableado de infraestructura y la
composición para el período inicial quedan pendientes.

### Lectura de cobertura firmada para el corte posterior (bloque 236)

`AwsSignedLaterPeriodStableCutCoverage` lee el objeto versionado
`stable-cut-writer-coverage/v1/<scopeHash>.json` del bucket y titular
configurados. El sobre contiene `protocol`, `report` y `signature`.
La firma Ed25519 en Base64 cubre los 32 bytes de
`archiveHash({ protocol, report })`, con protocolo
`LATER_PERIOD_STABLE_CUT_WRITER_COVERAGE_SIGNATURE_V1`.
Se configuran la clave pública, el emisor y la generación de controles.
[Verificación de firmas en Node.js](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback).

El lector comprueba alcance, horizonte, inventario, cobertura por grupo y
evidencia independiente de los efectos. Comparte con el archivo de
notificaciones la lectura acotada de JSON versionado. El productor revalida
las versiones y el registro vuelve a comprobar la reserva y los controles.
[Lectura de objetos S3](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

El emisor independiente debe comprobar y documentar el inventario real de
permisos y efectos, incluidos despliegues anteriores y sistemas externos,
antes de firmar. Quedan pendientes su configuración, la gestión operativa
de claves y la comprobación del entorno.

### Emisión independiente de cobertura firmada (bloque 250)

`StableCutWriterCoverageIssuer` recibe un alcance inicial o posterior y
solicita evidencia a una fuente independiente configurada. La fuente debe
cotejar la matriz de escritores y efectos del entorno, incluidas capacidades
anteriores y sistemas externos. Una cobertura incompleta se devuelve como
ausente. El emisor exige evidencia de inventario, de los seis grupos del
reporte y de los efectos de copia. Coteja alcance, generación y vigencia antes
de usar la clave privada Ed25519. Si vence el horizonte durante la consulta,
la emisión se rechaza.

La salida contiene la clave del objeto y el sobre compatible con ambos
lectores. Quedan por implementar la fuente operativa de evidencia, la
custodia de la clave y la publicación versionada. El informe firmado se usa
como entrada para verificar las versiones y registrar la acreditación bajo
la reserva. El cierre sigue requiriendo su consumo transaccional.

### Cotejo del inventario de escritores y efectos (bloque 251)

`StableCutInventoryEvidenceReader` conecta el emisor con el puerto
`StableCutOperationalEvidenceSource`. Exige una constancia de completitud
por cada uno de los seis grupos de escritores y por el conjunto de efectos
de copia. La constancia también es obligatoria si el conjunto está vacío.
El hash del inventario liga estas constancias y las identidades ordenadas
al alcance, la generación de controles y la vigencia.

El lector coteja un hallazgo por identidad del inventario exacto. Cualquier
omisión, duplicado, identidad ajena o efecto sin resolver bloquea la emisión.
Cada hallazgo acredita reconciliación remota con controles vigentes o
aislamiento efectivo. El reporte cubre la intersección de ambas vigencias,
que debe extenderse más allá del horizonte del traspaso. El emisor vuelve a
comprobar la vigencia al firmar. El formato firmado existente se conserva.

El puerto debe obtener las constancias y hallazgos de fuentes operativas
confiables. `MAY_RUN`, un resultado local o un listado vacío no constituyen
esa evidencia. Siguen pendientes el adaptador del entorno, la verificación
de la cobertura real, la custodia de clave y la publicación versionada.

### Lectura del archivo operativo de evidencia (bloque 252)

`AwsStableCutOperationalEvidenceSource` implementa el puerto con lectura
de JSON versionado y acotado en el bucket y titular configurados. El
prefijo `stable-cut-operational-evidence/v1/<scopeHash>/<controlsHash>/`
contiene `inventory.json` y `findings/<writerInventoryHash>.json`.
Ambos documentos incluyen `scopeHash`, `controlsHash`, `validFrom`,
`validUntil` y `groups` con los siete conjuntos. Los hallazgos incluyen
también `writerInventoryHash`. El colector puede obtener ese hash con
`stableCutWriterInventoryBinding`, que comparte el cálculo del emisor.
Si falta el inventario o los hallazgos de su hash exacto, no hay informe.
Un documento incompatible o un fallo de lectura impide la emisión.

El bucket de evidencia requiere escritura exclusiva del colector autorizado
y acceso de solo lectura para el emisor. El colector debe obtener constancias
completas y sostener los controles durante la vigencia declarada. La versión
identifica los bytes leídos. La cobertura del entorno, los permisos efectivos,
la custodia de clave y la publicación del informe siguen pendientes.

### Publicación versionada de cobertura firmada (bloque 253)

`AwsStableCutWriterCoveragePublisher` pide el sobre al emisor y lo publica
en la clave que ya usan ambos lectores. El PUT lleva titular esperado,
`If-None-Match: *` y SHA-256 de los bytes. Devuelve la clave y el `VersionId`
de un PUT confirmado o de una relectura versionada con el mismo sobre.
Una colisión con otro informe se rechaza. Si el PUT queda incierto y la
relectura no encuentra el mismo sobre, la publicación queda sin confirmar.
La llamada admite un solo PUT condicional en el adaptador.

S3 evalúa la condición contra la versión actual. El entorno debe mantener
versionado y bloquear borrados, marcadores y escrituras que eludan la
condición en el prefijo. Quedan por verificar esas políticas y la custodia
de clave. La publicación entrega evidencia para el productor de corte, que
todavía comprueba vigencia y controles antes de registrarla bajo la reserva.
[Escrituras condicionales S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

### Entrada operativa y clave del emisor (bloque 254)

`ops:stable-cut-coverage` compone el lector del colector, el emisor y el
publicador en un proceso separado del servidor. El modo `--help` es local.
`npm run --silent ops:stable-cut-coverage -- publish --scope-file FILE`
recibe el JSON del alcance inicial o posterior reconstruido bajo la reserva
original. Coteja su hash y horizonte antes de cargar la clave. El resultado
JSON contiene clave y versión (`PUBLISHED`, código 0), falta de evidencia
(`EVIDENCE_UNAVAILABLE`, código 2) o etapa de fallo (`ERROR`, código 1).

- `STABLE_CUT_PRIVATE_KEY_FILE` apunta al archivo local PEM montado de solo
  lectura para el emisor. `STABLE_CUT_PUBLIC_KEY_SHA256` fija la huella
  SHA-256 hexadecimal del SPKI DER de la clave pública usada por los lectores.
  El comando admite Ed25519 y limpia el buffer PEM tras importarlo. La clave
  privada permanece accesible al proceso de firma durante la ejecución.
- `STABLE_CUT_ISSUER_ID` y `STABLE_CUT_CONTROLS_HASH` identifican al emisor y
  la generación. `STABLE_CUT_REGION` configura el cliente S3 compartido.
  `STABLE_CUT_EVIDENCE_BUCKET` y `STABLE_CUT_EVIDENCE_BUCKET_OWNER` fijan
  la fuente. `STABLE_CUT_COVERAGE_BUCKET` y `STABLE_CUT_COVERAGE_BUCKET_OWNER`
  fijan el destino. `STABLE_CUT_EVIDENCE_MAX_BYTES` permite ajustar el límite
  de 1 MiB por documento del colector. El sobre tiene un límite de 4096 bytes.

Quedan pendientes la provisión del secreto y la comprobación de acceso al
montaje, identidad del proceso y políticas de los prefijos en el entorno.
[Importación de claves en Node.js](https://nodejs.org/api/crypto.html#cryptocreateprivatekeykey).

### Permisos de copia del período inicial en el inventario (bloque 255)

`readItemStableCutCopyAttemptsWithinTransaction` exporta el alcance inicial
y las identidades de los intentos desde el mismo snapshot. La consulta
respeta la selección y la reserva originales y reutiliza el digest ordenado
del alcance. Cada intento aporta ID y hash de definición. Si hubo permiso,
incluye ID y hash de autorización, también bajo una puerta revocada.

El `inventory.json` inicial lleva `initialCopyAttempts` cuando el alcance
contiene intentos. El emisor coteja orden, conteos y digest antes de buscar
hallazgos. Cada permiso añade `archiveHash(pin)` al grupo `copyEffects` y
requiere un hallazgo independiente para esa identidad. Un inventario local
vacío o un intento sin permiso conserva las obligaciones de cobertura de
escritores y efectos externos. El alcance y el informe firmado conservan su
formato. Quedan pendientes las fuentes operativas que acreditan los efectos
remotos y el enlace equivalente para períodos posteriores.

### Permisos y versiones del período posterior en el inventario (bloque 256)

La lectura del alcance posterior entrega `laterCopyEvidence` del mismo
snapshot. Incluye el vínculo del histórico retenido, sus archivos y las
acreditaciones de los archivos vigentes. El emisor reconstruye
`retainedScopeHash` y `liveMediaDigest` con esos datos. Así verifica las
versiones exactas y los permisos que ya fijaba la selección original.

El `inventory.json` posterior incluye `laterCopyEvidence` cuando el
alcance seleccionó copias. `copyEffects` identifica por `permissionHash`
los tres permisos de cada antecedente retenido y los dos PUT de cada
archivo vigente. Cada identidad requiere su hallazgo independiente.
Las copias seleccionadas delimitan este cotejo. El colector aún debe
acreditar la completitud de los demás efectos y escritores del entorno.
Se conservan el alcance y el sobre firmado existentes.

### Archivo del inventario y los hallazgos del colector (bloque 257)

`AwsStableCutOperationalEvidenceArchive` recibe un proveedor independiente y
usa el mismo cotejo que el emisor. Prepara los dos documentos con el alcance,
la generación y el hash del inventario. Comprueba sus tamaños antes del
primer PUT. El colector confirma primero `findings/<writerInventoryHash>.json`
y después crea `inventory.json`, que permite al emisor descubrir ese par.

Ambos documentos usan creación condicional con checksum y versión. Si se
pierde una respuesta, la relectura debe confirmar el mismo contenido. Si la
segunda escritura se interrumpe, repetir el mismo par conserva la versión
de los hallazgos. Un conflicto con otro inventario conserva el par anterior
y puede dejar hallazgos sin referencia. La publicación del informe firmado
reutiliza la misma escritura condicional. Siguen pendientes las fuentes
operativas y la comprobación de permisos en el entorno real.

### Auditoría de PUT vigentes para el colector (bloque 258)

`LaterPeriodLivePutCutEvidenceSource` fija la selección original y coteja
su evidencia de copias con el alcance posterior. Usa `observe` y
`readCopyEffects` para releer la acreditación y los dos permisos de cada
archivo vigente. El productor de auditoría existente identifica cada PUT
por evento y versión, y comprueba la retención de la versión exacta.

El cotejo exige las mismas versiones, procedencia y generaciones de
conservación. La constatación nueva debe cubrir la vigencia registrada.
Cada hallazgo queda ligado al permiso, al alcance, a los controles del
corte y al hash del inventario. Conservar la vigencia fijada permite repetir
el archivo si la retención se amplía. Una discrepancia bloquea el par.

La autoridad independiente sigue aportando la completitud de todos los
grupos y los hallazgos restantes, incluidos los efectos retenidos. La
composición admite el archivo existente y opera con lecturas de auditoría,
sin registrar acreditaciones ni enviar copias. Su cableado en el entorno y
la cobertura efectiva de las fuentes siguen pendientes.

### Informes independientes de versión por permiso (bloque 259)

`AwsPutVersionEvidenceReader` conecta los reconciliadores con el archivo
versionado del productor independiente. Cubre histórico, staging y final,
tanto del período inicial como de antecedentes retenidos. Busca el informe
en `put-version-evidence/v1/<protocol>/<scopeHash>/<expectedEvidenceHash>.json`.
Exige el titular configurado, un documento versionado y el emisor fijado.
El cotejo compartido valida el protocolo, el permiso y destino ligados al
alcance, la versión y el hash exacto del informe. El reconciliador sigue
comprobando vigencia y bytes antes de registrar su observación.

La autoridad que acredita procedencia y conservación debe publicar esos
informes en el archivo. Quedan pendientes esa fuente operativa y la
relectura de los informes al producir los hallazgos del colector.

### Hallazgos de PUT de antecedentes retenidos (bloque 260)

La lectura del alcance posterior puede exportar las tres observaciones
retenidas en la misma transacción. La observación de staging queda ligada
por el permiso final. El colector coteja los hashes de las observaciones
y los permisos, relee cada informe independiente y verifica bytes y
retención `COMPLIANCE` de las tres versiones exactas fuera de Mongo.
Cada hallazgo usa el permiso original y la vigencia del informe releído.

La composición conjunta admite esta fuente junto con la auditoría de PUT
vigentes. Si una versión de staging ya no está disponible o su retención
es insuficiente, esta fuente bloquea el par. La autoridad de cobertura puede
aportar evidencia independiente de aislamiento cuando corresponda. Los
permisos, alcance, sobre y consumo transaccional conservan su contrato.

### Hallazgos de PUT del primer traspaso (bloque 261)

`readItemStableCutCopyAttemptsWithinTransaction` exporta el alcance, los
intentos y las observaciones PUT reconciliadas en el mismo snapshot.
`ItemStableCutPutEvidenceSource` verifica los intentos contra el digest,
liga cada observación a su permiso original y relee el informe de versión
correspondiente. Usa la verificación de bytes y retención `COMPLIANCE`
compartida con los PUT retenidos. La retención debe cubrir toda la vigencia
del informe independiente.

El grupo `copyEffects` conserva `archiveHash(pin)` como identidad inicial.
La autoridad aporta la completitud del inventario y los hallazgos restantes,
incluidos permisos cuya observación falta. La ausencia de informe, una
versión distinta o una vigencia insuficiente bloquean este cotejo. Esta
composición hace lecturas fuera de la transacción del expediente.

### Producción y publicación de informes de versión (bloque 262)

`PutVersionEvidenceProducer` recibe un alcance reconstruido desde el permiso
original y consulta a una autoridad independiente que correlaciona ese
permiso con el PUT aplicado. Verifica titular, versión exacta, SHA-256 y
retención `COMPLIANCE` más allá del horizonte. La vigencia comienza al
terminar el cotejo y termina en el límite de retención observado. Una
correlación ausente impide publicar y conserva la incertidumbre del permiso.

`AwsPutVersionEvidencePublisher` usa la misma clave por protocolo, alcance y
hash que el lector. La creación condicional devuelve el hash y el `VersionId`.
Un informe idéntico conserva su versión. Una nueva observación puede generar
otro hash y los consumidores siguen usando el hash fijado en sus registros.
Quedan pendientes los adaptadores de procedencia que enlazan los permisos
iniciales y retenidos con eventos del entorno real, y las políticas de
escritura del archivo del productor.

### Marcador de auditoría en permisos iniciales y retenidos (bloque 263)

Los seis despachadores reutilizan el marcador aleatorio firmado del PUT
vigente. Mongo coteja su hash con el del transporte preparado y lo vincula
al `permissionHash` en el commit de `MAY_RUN`. El despacho exige el mismo
valor en el recibo fresco. Las lecturas y la selección de cobertura
retenida reconstruyen el permiso con el mismo hash. Los permisos previos
sin marcador conservan su formato y su identidad.

Sigue pendiente leer el evento independiente y cotejar el marcador de la
versión exacta para alimentar al productor. El marcador, la respuesta local
y el permiso por sí solos conservan la incertidumbre del efecto remoto.
Sin cambios de HTTP, índices ni esquema de Mongo.

### Correlación de eventos con permisos iniciales y retenidos (bloque 264)

`PutVersionAuditSelectionReader` usa los contextos de reconciliación para
reconstruir el alcance y exigir el hash del permiso original. El snapshot
termina antes de leer S3. Sin marcador devuelve ausencia de correlación.

`AwsPutVersionProvenanceReader` fija ese alcance y protocolo. Comparte con
los PUT vigentes el cotejo de `ObjectCreated:Put` con la versión, titular,
tamaño, ETag y marcador exactos. Exige un evento desde la admisión y una
sola coincidencia. El hash de procedencia liga permiso, evento y versión.
El productor sigue exigiendo bytes y retención antes de publicar.

Queda por componer la entrada operativa y verificar la autenticidad y
cobertura de fuentes y permisos en el entorno. Una lectura vacía conserva
la incertidumbre y la correlación positiva acredita solo ese PUT.

### Publicación interna desde el permiso original (bloque 265)

`AwsPutVersionEvidencePublication.publish` recibe el selector del permiso,
su hash esperado y el horizonte. Reutiliza el selector de reconciliación,
el archivo de notificaciones y la comprobación de versión, bytes y
retención. La configuración fija bucket y titular del origen auditado.
El llamador provee los clientes de notificaciones, versiones e informes.

Si falta el marcador o el evento, devuelve ausencia de informe. Con la
evidencia verificada, el publicador devuelve el hash y la versión del
informe. Solo escribe en el archivo de informes. El registro del efecto
y el consumo de negocio siguen en sus operaciones transaccionales.
Faltan el enlace al reconciliador y la comprobación de cobertura y
permisos en el entorno.

### Reconciliación desde el recibo del informe (bloque 266)

`AwsPutVersionEvidenceReconciliation.reconcileAndRecord` recibe el selector
original, el hash del permiso, el hash del informe publicado y el horizonte.
Elige el reconciliador de uno de los seis protocolos. Reconstruye el alcance
y la clave del informe con el permiso persistido. El archivo versionado
acredita el contenido por su hash y emisor configurado.

El reconciliador verifica la versión exacta y sus bytes fuera de Mongo y
usa el registro transaccional existente. Si el registro ya existe con el
mismo hash y horizonte, lo devuelve sin consultas S3 adicionales. Un hash
distinto produce conflicto. La operación queda fuera de HTTP, sin envío de
copias, publicación de informes ni cambios de esquema o propiedad.

### Ensayo Mongo de publicación y reconciliación (bloque 267)

El arnés de aceptación posterior prepara dos casos para el PUT final de
antecedentes. Ambos usan repositorios Mongo de dos clientes y respuestas S3
sintéticas. La preparación carga el permiso con marcador y deja pendiente
su observación.

- Una notificación tardía permite publicar el informe. El registro cerca
  la generación de conservación y guarda la versión en un commit de
  mayoría. El arnés simula perder esa respuesta y relee el mismo recibo
  desde el otro cliente, sin solicitudes S3 adicionales.
- Un selector con otro epoch bloquea la publicación y el uso de un recibo
  válido antes de consultar S3 o cambiar el expediente.

El bloque 268 ejecutó ambos casos en `d75ac67`. Pasó el caso del epoch.
La recuperación se detuvo antes del commit por el cotejo estricto del
informe tras `structuredClone`, que en Jest crea objetos con otro prototipo.
El adaptador retenido reutiliza ahora la copia estructural de las tres
rutas iniciales y conserva la validación de cada campo. Pasaron los dos
casos en la repetición autorizada con el arnés intacto. El segundo cliente
recuperó el registro con el mismo recibo sin volver a consultar S3.
[Evidencia y limpieza](./validation/transfer-retained-put-evidence-mongo-268.json).

### Brechas de cobertura para escritores antiguos y externos (bloque 269)

La revisión de `f2b2e51` cotejó la matriz con el grafo Nest, los adaptadores
S3 y el workflow de imágenes. El grafo registra el adaptador de promoción
directa y exporta la migración legacy y el preparador de archivos. El
workflow construye y publica imágenes. Falta saber qué
revisiones y procesos tienen autoridad en el entorno del corte.

| Grupo existente | Evidencia que falta para el colector |
| --- | --- |
| `applicationDeployments` | Censo por revisión desplegada e identidad de ejecución, incluidos workers y procesos retirados con efectos pendientes. Cotejar las rutas de promoción, borrado, migración y preparación que alcanzan las versiones seleccionadas. |
| `priorCapabilities` | Para las URL directas legacy y los permisos anteriores, desenlace independiente o aislamiento efectivo de cada destino alcanzable. Una confirmación sin ticket, una URL vencida y un journal terminal dejan abierta la posibilidad de un efecto previo. |
| `externalSystems` | Identidades y destinos efectivos de sistemas ajenos al backend. Incluir salidas asíncronas de BDA, exportaciones e integraciones en el censo o acreditar su aislamiento respecto del expediente. |
| `multipartUploads`, `replication`, `administrative` | Evidencia del entorno sobre cargas iniciadas, destinos de replicación, escritores administrativos y alcance de lifecycle y borrados. La búsqueda estática en adaptadores solo aporta la parte atribuible al repositorio. |
| `copyEffects` | Los permisos seleccionados de ambos períodos ya tienen identidades cotejables. La fuente independiente aún debe cubrir efectos restantes, incluidos intentos de preparadores previos y permisos sin marcador ni prueba de procedencia. |

`ops:stable-cut-coverage` firma el par archivado. Su lector coteja la
forma, el alcance, la generación, la vigencia y la correspondencia de
miembros con hallazgos. La fuente autorizada del colector debe aportar
el respaldo de cada `completenessEvidenceHash`, incluso para un grupo
vacío. Cada efecto identificado requiere reconciliación y control, o una
prueba de aislamiento.

El primer incremento pendiente es integrar las constancias de
`applicationDeployments` y `priorCapabilities` al colector existente,
con selección original y vigencia. Las políticas efectivas, los permisos
del entorno y la custodia de la clave requieren verificación separada.
La revisión mantiene el formato de inventario y del informe firmado.

### Cotejo independiente del censo antes de archivar (bloque 270)

El colector requiere `StableCutWriterCompletenessSource` para los despliegues
y las capacidades previas. La fuente devuelve el alcance, la generación de
controles, la ventana y, por grupo, el hash de la constancia y todas las
identidades cubiertas. La ventana debe cubrir la del inventario completo.
El cotejo exige el mismo hash de constancia y las mismas identidades, con
orden indiferente y sin duplicados. También exige constancia para un grupo
vacío. Si falta evidencia o hay discrepancia, el colector se detiene antes
de leer los hallazgos o publicar el par.

La fuente debe autenticar los censos y acreditar su completitud para el
alcance recibido. El cotejo conserva el hash del inventario y el formato
firmado. Faltan el adaptador de la autoridad y su verificación en el
entorno, además de la cobertura pendiente de los demás grupos.

### Lectura de constancias firmadas de completitud (bloque 271)

`AwsSignedStableCutWriterCompletenessSource` lee JSON versionado y acotado
en `stable-cut-writer-completeness/v1/<scopeHash>/<controlsHash>.json`
del bucket y titular configurados. El sobre usa
`STABLE_CUT_WRITER_COMPLETENESS_SIGNATURE_V1`, con `report` y `signature`.
Ed25519 firma los 32 bytes del SHA-256 canónico de `{ protocol, report }`.
El informe fija emisor, alcance, controles y vigencia, y contiene los dos
grupos con su hash de constancia y sus identidades. Se requiere una
constancia explícita aun cuando su lista esté vacía.

El lector fija la clave pública y exige vigencia desde la lectura hasta
más allá del horizonte. El colector coteja además la ventana completa
del inventario. El formato del par archivado y el informe final se conserva.
Quedan pendientes la emisión desde el censo, su cobertura efectiva y la
provisión de claves y accesos del entorno.

### Emisión y publicación de constancias de completitud (bloque 272)

`StableCutWriterCompletenessIssuer` consulta una fuente de censo
independiente y firma solo cuando alcance, controles y vigencia coinciden.
Exige respaldo de ambos grupos, incluidas las listas vacías. Ordena las
identidades para conservar la firma si cambia el orden de entrega.

`AwsStableCutWriterCompletenessPublisher` usa la ruta del lector y crea
una versión condicional. Si se pierde la respuesta, la relectura confirma
el mismo documento. Una constancia distinta en la misma clave produce
conflicto. Faltan la fuente operativa que produce el censo y la provisión
de claves y permisos. Los componentes quedan fuera del grafo HTTP.

### Respaldo del censo de escritores (bloque 273)

`StableCutWriterCensusCompleteness` recibe de la autoridad un censo del
alcance original y la generación exacta, con vigencia hasta después del
horizonte. Exige respaldo para cuatro conjuntos, incluso cuando están
vacíos. Cada miembro lleva una identidad y una referencia de evidencia.

- Despliegues activos y retirados. El respaldo operativo debe enumerar
  revisiones y procesos con capacidad de afectar los destinos, incluidos
  los efectos pendientes de procesos retirados.
- URL de carga antiguas y permisos de escritura previos. El respaldo
  operativo debe cubrir qué capacidades se emitieron y qué destinos
  podían alcanzar. La expiración o revocación conserva la incertidumbre
  de los efectos previos.

El adaptador proyecta esos conjuntos a los dos grupos del emisor existente.
La huella de cada grupo incluye alcance, controles, vigencia y referencias
del censo y de sus miembros. Rechaza duplicados dentro de cada grupo. La
autoridad debe verificar esas referencias antes de entregar el censo.
Los hallazgos por efecto y la conexión al entorno siguen pendientes.

### Lectura operativa del censo fijado (bloque 274)

`AwsStableCutWriterCensusReader` lee un JSON versionado del bucket y
titular configurados. La clave usa
`stable-cut-writer-census/v1/<scopeHash>/<controlsHash>/<censusHash>.json`.
La huella se calcula con `archiveHash` sobre el censo validado del bloque
273, con los miembros de cada conjunto ordenados por `identityHash`.
La autoridad fija esa huella por un canal confiable tras verificar las
referencias de evidencia y la cobertura. El lector comprueba integridad,
alcance y generación. Falta acreditar los censos del entorno.

`npm run --silent ops:stable-cut-coverage -- publish-completeness --scope-file FILE`
usa la configuración común de región, emisor, controles, clave y huella
pública. Lee el censo de `STABLE_CUT_EVIDENCE_BUCKET` y
`STABLE_CUT_EVIDENCE_BUCKET_OWNER` con `STABLE_CUT_CENSUS_SHA256`.
Publica en `STABLE_CUT_COMPLETENESS_BUCKET` y
`STABLE_CUT_COMPLETENESS_BUCKET_OWNER`. `STABLE_CUT_EVIDENCE_MAX_BYTES`
acota la entrada y la constancia. Un censo ausente devuelve
`EVIDENCE_UNAVAILABLE`. Un censo alterado bloquea la publicación.
El comando `publish` conserva su configuración y comportamiento.

### Ensayo de punta a punta del censo y la cobertura (bloque 275)

El ensayo sin conexión ejecuta `publish-completeness` sobre un censo
versionado sintético, lee la constancia con la clave pública correspondiente
y archiva el par inventario/hallazgos. Ejecuta después `publish` con otra
clave y verifica el informe con el lector del período posterior. Si falta
el hallazgo de un despliegue retirado presente en el censo, el colector
deja el archivo vacío y `publish` devuelve `EVIDENCE_UNAVAILABLE`.

Para un ensayo de entorno, la autoridad debe entregar un solo alcance
reconstruido bajo su reserva original, la generación y ventana, el censo
versionado con su huella por canal confiable, y el inventario y hallazgos
de los siete grupos. Conviene que el primer alcance incluya un despliegue
retirado y un conjunto vacío con respaldo explícito, como en el arnés.

El emisor de completitud necesita leer el censo y publicar su constancia.
El colector necesita leer esa constancia y publicar el par. El emisor
final necesita leer el par y publicar el informe. Fijar para cada paso
bucket, titular y prefijo, y cargar las claves de firma de sus respectivos
emisores. La validación registra las cuatro versiones publicadas
(constancia, inventario, hallazgos e informe) y coteja alcance, generación,
huella del inventario y vigencia con el comando `verify`. El ensayo
termina en la lectura del informe y queda pendiente de autorización para AWS.

### Entrada operativa del colector (bloque 276)

`npm run --silent ops:stable-cut-coverage -- collect --scope-file FILE`
lee el inventario y los hallazgos de
`STABLE_CUT_COLLECTOR_INPUT_BUCKET` y
`STABLE_CUT_COLLECTOR_INPUT_BUCKET_OWNER`. Usa las claves versionadas del
bloque 252. Coteja la constancia de `STABLE_CUT_COMPLETENESS_BUCKET` con
su titular, el emisor `STABLE_CUT_COMPLETENESS_ISSUER_ID` y la clave PEM de
`STABLE_CUT_COMPLETENESS_PUBLIC_KEY_FILE`, fijada por
`STABLE_CUT_COMPLETENESS_PUBLIC_KEY_SHA256` (SPKI DER). Comparte región,
generación y límite de bytes con los comandos de publicación.

Escribe primero los hallazgos y después el inventario en
`STABLE_CUT_EVIDENCE_BUCKET`, que debe ser distinto del bucket de entrada.
`ARCHIVED` devuelve la huella y las dos versiones que consume `publish`.
`EVIDENCE_UNAVAILABLE` indica que la evidencia está ausente o incompleta.
El colector opera con la clave pública de completitud y archivos de
evidencia preparados por la autoridad. Falta el paquete del entorno.

### Verificación operativa del informe firmado (bloque 277)

`npm run --silent ops:stable-cut-coverage -- verify --scope-file FILE`
lee el informe vigente para el alcance inicial o posterior con el mismo
lector que usa el backend. Comparte región, generación, emisor, bucket
de cobertura y titular con `publish`. Usa el archivo PEM público de
`STABLE_CUT_PUBLIC_KEY_FILE` y la huella SPKI DER de
`STABLE_CUT_PUBLIC_KEY_SHA256`. El rol verificador solo necesita lectura
del objeto de cobertura en el prefijo del ensayo.

`VERIFIED` (salida 0) devuelve `objectKey` y `versionId` de la
misma lectura que validó la firma (bloque 280), junto con las huellas de
alcance, controles e inventario y la vigencia firmada. Comparar clave y
versión con el recibo de `publish` y la huella de inventario con la
devuelta por `collect`. `EVIDENCE_UNAVAILABLE` (salida 2) indica
ausencia del informe. Un fallo de lectura o validación de la firma y del
contenido produce `ERROR` en `VERIFICATION` (salida 1). El comando
termina en la verificación del informe. La inscripción y el consumo
de evidencia siguen bajo el protocolo transaccional del cierre.

### Revisión local del paquete de la autoridad (bloque 278)

Cuando se reciba el paquete, revisar los cuatro JSON locales antes de
preparar los objetos del ensayo.

```text
npm run --silent ops:stable-cut-coverage -- preflight --scope-file alcance.json --census-file censo.json --inventory-file inventario.json --findings-file hallazgos.json
```

Configurar `STABLE_CUT_CONTROLS_HASH` para la generación y
`STABLE_CUT_CENSUS_SHA256` con la huella fijada por la autoridad por un
canal confiable. Se aplica `STABLE_CUT_EVIDENCE_MAX_BYTES` al censo,
inventario y hallazgos. La revisión reutiliza los lectores del formato
de entrada y coteja las poblaciones del censo con los grupos de
despliegues y capacidades previas, el inventario con los hallazgos,
los efectos de copia exigidos por el alcance y la ventana de vigencia.

`PACKAGE_CONSISTENT` (salida 0) devuelve las huellas y la ventana.
`EVIDENCE_UNAVAILABLE` (salida 2) indica que el paquete no establece
cobertura completa. `ERROR` (salida 1) identifica la etapa del fallo.
El resultado acredita coherencia local. La autoridad debe acreditar
la procedencia, el respaldo de los hallazgos y el estado efectivo de los
escritores. La ejecución solo lee archivos locales y termina sin firmar
ni publicar.

### Destinos y permisos del ensayo de cobertura (bloque 279)

Tras `PACKAGE_CONSISTENT`, tomar las cuatro huellas de esa ejecución
para completar las claves de un solo alcance.

| Bucket configurado | Claves del ensayo |
| --- | --- |
| `STABLE_CUT_EVIDENCE_BUCKET` | Censo en `stable-cut-writer-census/v1/<scopeHash>/<controlsHash>/<censusHash>.json` y par archivado en las dos claves del colector indicadas abajo. |
| `STABLE_CUT_COLLECTOR_INPUT_BUCKET` | `stable-cut-operational-evidence/v1/<scopeHash>/<controlsHash>/inventory.json` y `stable-cut-operational-evidence/v1/<scopeHash>/<controlsHash>/findings/<writerInventoryHash>.json`. |
| `STABLE_CUT_COMPLETENESS_BUCKET` | `stable-cut-writer-completeness/v1/<scopeHash>/<controlsHash>.json`. |
| `STABLE_CUT_COVERAGE_BUCKET` | `stable-cut-writer-coverage/v1/<scopeHash>.json`. |

Completar región, nombres de bucket, titulares de 12 dígitos
(`*_BUCKET_OWNER`) y la identidad que ejecutará cada paso. Los buckets de
entrada del colector y de evidencia deben ser distintos. Los objetos se
leen en buckets con versionado activo. Para los destinos de publicación,
confirmar los controles del bloque 253 y los accesos a la clave KMS si
aplica el cifrado SSE-KMS.

| Paso | Lectura `s3:GetObject` | Escritura `s3:PutObject` |
| --- | --- | --- |
| Cargar insumos de la autoridad | Según el mecanismo de carga acordado. | Censo y par de entrada, si la carga forma parte del ensayo. |
| `publish-completeness` | Censo y constancia. | Constancia. |
| `collect` | Par de entrada, constancia y par archivado. | Par archivado. |
| `publish` | Par archivado e informe final. | Informe final. |
| `verify` | Informe final. | Solo lectura. |

Acotar los permisos de objeto a las claves de la tabla. Las publicaciones
usan `If-None-Match: *` y releen el destino ante una respuesta incierta.
Las lecturas piden el objeto actual y comprueban que S3 devuelva un
`VersionId`. Un objeto ausente puede devolver 403 si la identidad carece
de `s3:ListBucket`. El comando trata ese 403 como `ERROR` y reserva
`EVIDENCE_UNAVAILABLE` para la ausencia reconocida o la evidencia
incompleta. [GetObject en S3](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)
· [Escrituras condicionales](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

El ensayo positivo termina con `PUBLISHED`, `ARCHIVED`, `PUBLISHED` y
`VERIFIED`, en ese orden. Guardar las versiones devueltas de constancia,
inventario, hallazgos e informe. Confirmar que `verify` leyó la clave y
la versión del recibo final de `publish`. Cotejar alcance, controles y
vigencia con la ventana aprobada y la huella de inventario con `preflight`
y `collect`. La cuenta, las identidades, las políticas efectivas, el
paquete verificado y la autorización específica siguen pendientes.

### Producción de evidencia para el corte inicial (bloque 237)

`produceAndRegisterItemStableCut` obtiene las observaciones de las
versiones histórica y final en el snapshot del expediente inicial.
`ItemStableCutEvidenceProducer` reconstruye el digest existente y vuelve a
comprobar los bytes, el titular y la retención `COMPLIANCE` de las versiones
exactas fuera de Mongo. El informe de cobertura firmado se exige también
si el expediente no tiene archivos.

El lector comparte el formato de sobre y la ruta del bloque 236, con
`ITEM_STABLE_CUT_WRITER_COVERAGE_SIGNATURE_V1` para el período inicial.
El registro reconstruye la selección y cerca la reserva y los controles
en una segunda transacción. El informe conserva el formato persistido y
su registro devuelve `NOT_AUTHORIZED`. El cierre consume la evidencia
junto con las escrituras de negocio.

Desde el bloque 308, `TransferItemCaptureModule` exporta
`ITEM_STABLE_CUT_REGISTRAR` cuando recibe el productor explícito y el codec
completo de URLs. El llamador entrega la selección de la proyección y el
hash del alcance auditado. El adaptador comprueba ese hash antes de leer
la cobertura y las versiones. Al registrar devuelve la selección y el
hash de acreditación que requiere el cierre. Desde el bloque 309 los
devuelve juntos en `commitSelection`, ligado al registro confirmado.

Quedan pendientes la configuración del emisor y de cobertura operativa,
y el ensayo conjunto en infraestructura con un expediente con archivos.

### Ensayo del corte inicial con una foto (bloque 238)

El escenario parte de una foto capturada y de las filas sintéticas de
histórico, staging y final generadas con los constructores del dominio.
El adaptador de captura rehidrata los permisos, registra el medio
preparado y reconstruye el corte. Un informe firmado con una clave de
prueba y las dos lecturas exactas permiten registrar la evidencia. El
cierre publica el histórico, cambia dueño y referencia de la foto,
y consume el informe en la misma transacción.

Los casos de fallo conservan la foto y la reserva originales si los bytes
finales difieren, y revierten el cierre, la publicación y el consumo si
falla el outbox. Las copias ya están reconciliadas en los datos sintéticos.
Quedan pendientes los ensayos de Mongo real, S3 y la cobertura operativa.

### Ensayo del corte inicial con un documento médico (bloque 281)

El arnés sin conexión parte de un PDF aceptado con su categoría,
extracción, código y revisión. Verifica las versiones exactas simuladas
de la copia histórica y de la copia independiente del destinatario. El
cierre cambia el dueño y ambas referencias de almacenamiento del documento
activo. La consulta histórica del dueño anterior conserva los datos
capturados y enlaza una sola copia histórica del PDF.

Si el corte ya está acreditado y la revisión final encuentra otro
análisis pendiente, el cierre se detiene. El arnés coteja que el
expediente, la reserva y el consumo de evidencia conserven su estado.
Se usan copias reconciliadas sintéticas, transacciones simuladas y una
clave de prueba. El escenario parte de un documento ya analizado.

El bloque 282 lleva ambos casos al arnés Mongo opt-in. El cierre comprueba
desde el segundo cliente las referencias activas, el recibo y el histórico
del dueño anterior. El caso de análisis pendiente inserta el registro
desde el segundo cliente después de acreditar el corte y comprueba que
se conserve la reserva y que el recibo esté ausente. La suite usa S3
simulado.

El bloque 283 ejecutó ambos casos con MongoDB 8.0.34 local. El análisis
pendiente bloqueó el cierre. El escenario exitoso se detuvo cuando el
cierre cotejó el documento leído de Mongo con la captura preparada antes
de leerlo de la base. El bloque 284 repitió ambos casos con el mismo
lector de Mongo para preparar la captura y cotejarla al cierre. Pasaron
los dos casos con S3 simulado y se verificó la limpieza.
[Resultados y limpieza](./validation/transfer-initial-medical-cut-mongo-283.json).

### Arnés Mongo del corte inicial con foto (bloque 239)

El arnés opt-in de transferencias incluye tres casos con dos clientes y
los índices existentes. Usa filas sintéticas de copias reconciliadas y
el lector de cobertura firmado con una clave efímera, un cliente S3
simulado y flujos locales para las versiones.

Los casos comprueban el cierre y su recibo desde el segundo cliente, el
rechazo de una generación invalidada entre la verificación y el registro,
y la reversión de la foto y el consumo ante un fallo de publicación.
En el bloque 240 pasaron los 437 casos de la suite principal. Los seis
casos de cierre se detuvieron durante la siembra. El primer período ahora
entrega solo los campos de la selección y ambas suites pasan al driver
copias mutables de las filas para que asigne `_id` sin cambiar las
proyecciones acreditadas.

El bloque 241 verificó los seis cierres en Mongo local, con medios sintéticos
y controles simulados donde lo indica el arnés. Cubre recibos, revocación,
rotación con el índice de período activo, concurrencia y reversión. Si una
operación interna aborta la transacción, el adaptador conserva su error y
mantiene los reintentos transitorios del driver. Quedan pendientes S3 y la
cobertura operativa de los escritores.
[Corrida original](./validation/transfer-ownership-cut-mongo-240.json).
[Repetición focalizada](./validation/transfer-ownership-cut-retest-mongo-241.json).

### Alcance del corte para la proyección seleccionada (bloque 175)

`readItemStableCutScopeWithinTransaction` reconstruye la proyección en
la sesión del llamador. Para cada archivo coteja las versiones histórica
y final exactas y valida sus generaciones de conservación y el horizonte
seleccionado. El alcance fija el digest de esas versiones y de todas las
declaraciones y permisos de la puerta original. Conserva los permisos
`MAY_RUN` de una puerta revocada.

`ItemStableCutAccreditationObserver` coteja el reporte del productor
interno por hash, alcance y vigencia. Exige cobertura para los grupos
de escritores del protocolo de destino, evidencia de los efectos de la
puerta y, si hay archivos, conservación de las versiones seleccionadas.
El inventario del productor debe abarcar las rutas de la matriz y las
capacidades previas o externas que puedan interferir. Las cuentas locales
de permisos e intentos sirven para fijar el alcance.

El cotejo conserva `NOT_ASSESSED` y `NOT_AUTHORIZED`. Quedan pendientes
el productor operativo, la persistencia de la acreditación y la guarda
transaccional de su generación para el consumo.

### Registro y relectura de la acreditación por alcance (bloque 176)

`registerItemStableCutAccreditationWithinTransaction` recibe los hashes
esperados de alcance y acreditación. Reconstruye la selección y obtiene
el reporte de un colaborador interno síncrono que lo obtuvo fuera de la
transacción. El registro usa una fila inmutable de
`animal_transfer_copy_records`, con identidad por alcance y hash del
reporte. Reutiliza los índices existentes y preserva la evidencia original
al repetir. Un reporte distinto tiene su propia identidad.

El primer registro y su repetición exacta escriben los fences de
solicitud, ítem, claim, reserva y de las generaciones activas de la
acreditación y de las versiones conservadas. La relectura reconstruye
el alcance en la sesión del llamador y verifica el registro, el horizonte
y las generaciones activas. Ambos caminos conservan `NOT_AUTHORIZED`.
Siguen pendientes el productor operativo y el consumo único con las
escrituras de negocio.

### Consumo único en la transacción del ítem (bloque 177)

`consumeItemStableCutWithinTransaction` exige la acreditación persistida
y la función interna de escritura del llamador. Reconstruye la proyección
y el alcance, revalida el reporte y cerca solicitud, ítem, claim,
reserva y generaciones activas de acreditación y conservación.

El CAS de cabecera guarda `ITEM_STABLE_CUT_CONSUMPTION_V1` en
`evidenceConsumption`, con identidad por ítem y expediente. Liga el sello,
manifiesto, cobertura, proyección, alcance y constancia exacta. La guarda
compartida rechaza otro consumo del mismo archivo incluso si cambia el
reporte. La acreditación conserva su fila original.

El adaptador pasa el candidato y el marcador provisional a la función de
escritura con la misma sesión. Coteja la identidad de la transacción,
la proyección y la vigencia al retorno. Ante fallo intenta abortar la
transacción del llamador. El llamador conserva el control del commit.
Quedan pendientes el productor operativo, la composición de las
escrituras de propiedad y su resultado durable.

### Cotejo del expediente vivo antes de escribir (bloque 178)

El consumo exige el lector Mongo del expediente y le pasa la misma
sesión y conexión de captura, después de cercar la reserva y antes
de llamar al escritor. Reutiliza la normalización de captura, coteja
la ficha y recorre por ID el diario y los documentos aceptados.
Comprueba trabajo médico pendiente, faltantes, altas y diferencias de
contenido. Reconstruye cada entrada y su proyección usando el mismo
codec y los medios preparados de esa entrada. Una discrepancia aborta
la transacción, incluido el marcador provisional.

El escritor recibe la lista de cambios acotados por recurso y el hash
de su contenido de origen. Puede aplicar el dueño y la foto de la ficha,
las URLs de los adjuntos del diario y el dueño y la clave en las dos
referencias del documento médico. Debe conservar los demás campos y
aplicar las escrituras bajo la misma sesión y reserva. El cotejo solo
prepara los cambios. El escritor efectivo, los períodos, la publicación,
la aceptación y el resultado durable siguen pendientes.

### Commit interno de propiedad por ítem (bloque 179)

`commitItemOwnershipWithinTransaction` consume la acreditación y aplica
las escrituras en la sesión del llamador. Revalida y cerca al destinatario,
actualiza ficha, URLs del diario y ambas referencias médicas, cierra el
período inicial y abre el siguiente con la misma fecha efectiva. Actualiza
dueño y versión del control, incrementa el epoch, libera la reserva exacta y
retira el claim de la decisión. El archivo conserva sus estados técnicos
de preparación y recibe el hash de publicación enlazado al período cerrado.

La transacción guarda el ítem `ACCEPTED`, el recibo inmutable, la auditoría,
los avisos a ambos participantes y el outbox. Cada ítem aplicado incrementa
la versión de detalle de la solicitud. La versión de inicio y los sellos
siguen identificando la decisión original para los demás ítems. La solicitud
queda `PROCESSING` hasta completar los seleccionados y termina
`ACCEPTED` o `PARTIALLY_ACCEPTED` según la decisión registrada.

El resultado del escritor es provisional hasta confirmar la transacción.
Ante respuesta incierta, una nueva sesión puede releer el recibo con la
selección original exacta. Coteja ítem, archivo, consumo y hash de publicación;
un replay exacto devuelve el resultado sin repetir escrituras o avisos.
Una lectura sin recibo deja el resultado sin confirmar. La composición
operativa debe acotar la confirmación al horizonte de acreditación.
El adaptador permanece sin llamador HTTP u operativo. Falta verificar en Mongo
la rotación bajo el índice único parcial, rollback, concurrencia entre ítems
y respuesta perdida, además de la integración operativa del corte, conservación
y acceso a históricos.

### Confirmación del cierre del período inicial (bloque 229)

`commitItemOwnership` ejecuta el cierre del primer traspaso en una
transacción propia con snapshot, primario y mayoría. Comparte con el
segundo traspaso el presupuesto máximo de 15 segundos, recortado al tiempo
restante de la acreditación. El cierre vencido conserva la decisión y
reserva. `readItemOwnershipCommit` consulta el recibo de la selección exacta
tras una respuesta incierta, incluso vencido el horizonte.

Con dobles se verificaron el cierre y la consulta de un expediente inicial
sin archivos, el rechazo cuando vence la ventana, la reversión ante un
fallo del outbox y la recuperación del recibo sin repetir escrituras.
El contrato es interno. Sigue pendiente comprobar el cierre con
infraestructura real y conectar el productor operativo de evidencia.

Desde el bloque 309, `TransferItemCaptureModule` exporta
`ITEM_OWNERSHIP_CLOSER` al recibir el adaptador de recursos y el codec
completo de URLs. `commit` consume la selección exacta del registro y
usa los modelos existentes en la conexión del módulo. `readReceipt`
permite comprobar el resultado con esa selección si se pierde la
respuesta. Repetir `commit` con el recibo ya persistido devuelve ese
mismo resultado. Ambos métodos son internos y reutilizan la transacción
y las comprobaciones del bloque 229.

### Evidencia por ítem antes de autorizar una copia (bloque 96)

**Contrato objetivo.** Para admitir un envío hay que comprobar la protección
de la fuente y el destino del efecto concreto. El corte para el commit de
propiedad abarca el expediente completo y los efectos de toda la preparación.
Separar ambos evita exigir resultados de la primera copia para poder enviarla.

| Evidencia que se debe releer | Vínculo requerido |
| --- | --- |
| Alcance del ítem | Decisión y versión de solicitud, sello de captura, cabecera y epoch/hash de la reserva original. Reusar el binding de `manifestDigest` y su `manifestHash` persistido, con conteos y raíces validados. |
| Fuente del efecto | Pertenencia efectiva del archivo al manifiesto cerrado, `fileId` y hash de definición, intención lógica y hash de observación correspondientes. La garantía cubre el bucket, clave, selector de lectura, revisión y SHA-256 exactos fijados por esa intención. |
| Cobertura de escritores | Perfil versionado con alcance de escritores y despliegues, capacidades previas, sistemas externos y efectos por destino. Cada grupo relevante requiere inventario cerrado de sus intentos y evidencia suficiente de su desenlace, o prueba verificable de que sus permisos y efectos están aislados del selector y destino protegidos. Alcance ausente o desconocido bloquea. |
| Conservación | Referencia verificable emitida por el productor interno autorizado, con identidad, revisión y hash de la garantía y de su alcance. Debe mantener legible el selector fijado durante el uso requerido y protegerlo de borrado, sustitución o reutilización. El artefacto y el destino del efecto requieren las protecciones que les correspondan. |

El digest actual liga las definiciones de entradas y archivos en orden, pero su
raíz encadenada no permite probar pertenencia a partir de una sola fila.
Ligar intenciones y observaciones por sus propios hashes y conservar el digest
del manifiesto.
La futura preparación debe verificar un recorrido completo contra la raíz de
archivos, con conteo, IDs y definiciones exactos, y certificar las filas de
evidencia del mismo alcance antes de cerrar su resumen. Mantener páginas por
clave hasta una página vacía, filas acotadas y cierre condicionado al mismo
sello. Cero archivos requiere un manifiesto completo explícito y deja cero
efectos de copia. La cobertura del corte de negocio se evalúa por separado.

Para **HISTORICAL**, exigir la observación de bytes del origen original
persistida, vinculada a la intención y a una garantía de conservación de esa
fuente. Rechazar cualquier selector distinto aunque coincidan los bytes. El
destino requiere protección de creación y evidencia de cobertura frente a
escritores o permisos capaces de afectarlo. Encontrar un objeto en el destino
deja pendiente reconciliar el intento exacto y sus garantías. Para
**RECIPIENT_STAGING**, la fuente es el histórico fijado en la pareja persistida
de observación/intención. Su evidencia debe enlazar el efecto histórico
autorizado, su resultado suficiente, su procedencia y su propia conservación.
Verificar los bytes del histórico aporta el pin observado. Sigue haciendo falta
comprobar cómo se obtuvo y cómo se mantiene.

La cobertura usa la matriz W01–W14 como punto de partida. Los journals y claims
aportan el contexto local de W01. Para W02–W11 deben cubrirse también URLs
legacy, efectos por intento, borrados, compensaciones y trabajos/hijos del
proveedor, o demostrar su aislamiento. Para W12–W13 incluir los permisos y
ejecuciones que puedan escribir sobre los destinos, incluidos los previos al
protocolo nuevo. W14 aporta observaciones. Los procesos, credenciales,
herramientas administrativas y políticas externas fuera de la matriz exigen
cobertura explícita o aislamiento comprobado. Una página vacía del inventario,
un estado local terminal o un `MATCH` dejan esas obligaciones pendientes.

El futuro grant recibe identidades esperadas y relee los registros del
productor por ID y revisión bajo la misma reserva. Debe rechazar afirmaciones
de cobertura o conservación aportadas como JSON por el llamador. Compara
manifiesto, intención, intento, puerta y evidencia, y debe
competir con su invalidación en la transacción que escribe los cuatro fences y
el permiso. La transacción cerca la revisión local. La protección remota debe
seguir vigente después del commit y durante la delegación. Si la protección
puede retirarse sin coordinación, queda pendiente demostrar una garantía
suficiente. Revocar impide permisos futuros y conserva la incertidumbre de los
previos. Los retries requieren releer el predecesor autorizado y resolver o
aislar los efectos que aún puedan interferir. El commit de propiedad deberá
consumir el conjunto completo junto con todas sus escrituras de negocio.

**Disponible hoy.** `manifestDigest`, observaciones de bytes y filas de
puerta/intento aportan anclas locales. El flujo `ARCHIVE_EVIDENCE_V1` aporta un
patrón de hash y consumo cercado sobre archivos READY, posterior a la primera
copia. Los bloques 100–101 observan y conservan el primer reporte de Object Lock
para la versión original. El reporte es `OBSERVED_ONLY` y se puede releer
después de su fecha. [Persistencia implementada](./ownership-archive-preparation.md#persistencia-del-reporte-de-retención-de-origen-bloque-101).

### Protección y legibilidad de la fuente original (bloque 104)

**Contrato objetivo.** Evaluar por separado la
protección de la versión contra borrado y la capacidad de leer sus bytes
durante el efecto histórico. Ambas deben corresponder al mismo anclaje,
intención, revisión, SHA-256, selector exacto y propietario de bucket
configurado. La observación del bloque 101 conserva su propio alcance e
identidad.

1. **Fecha fija de protección.** Exigir en una misma respuesta auténtica de
   S3 `COMPLIANCE`, estado de retención por evento explícitamente `OFF` y
   fecha válida en el futuro. `OFF` admite la fecha final de un evento ya
   liberado si está en modo `COMPLIANCE`. Un evento activo puede producir una
   fecha calculada. Ante estado ausente, desconocido, activo o contradictorio
   con los encabezados de duración, dejar pendiente la acreditación. La fecha
   de la observación anterior, la configuración por defecto del bucket y un
   legal hold por sí solo no satisfacen este criterio.
   [Modelo y límites de Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).
2. **Legibilidad observada.** Reusar el anclaje y la comprobación de bytes.
   Hacer un `GetObject` completo con el bucket, la clave y el `VersionId`
   originales, `ExpectedBucketOwner` explícito e `IfMatch` con el ETag
   fijado. Exigir HTTP 200 completo, sin marcador de borrado, rango o partes,
   e identidad, tamaño y SHA-256 exactos al terminar el stream. Tomar estado,
   modo y fecha de retención de esa respuesta. Rechazar versiones ausentes o
   `null`, errores, respuesta parcial y stream incompleto. Leer fuera de
   transacción. Al terminar, releer el anclaje bajo la reserva original y
   comprobar que la fecha fija siga vigente. El selector sigue fijado
   a la versión original aunque otra versión pase a ser la actual.
   [Contrato de GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).
3. **Legibilidad durante el uso.** El GET acredita acceso del lector en ese
   momento. Para un horizonte utilizable hace falta un perfil operativo
   verificable y versionado que cubra al principal de la copia, la lectura de
   esa versión, cifrado/llaves, clase y transiciones de almacenamiento, y los
   cambios administrativos que podrían retirar acceso o protección. Un objeto
   puede seguir protegido por Object Lock y perder legibilidad. El primer
   alcance propuesto exige lectura inmediata y excluye depender de una
   restauración temporal. Un perfil desconocido o que pueda invalidarse sin
   coordinación deja pendiente el horizonte. El futuro transporte debe
   preservar versión, propietario de origen y condición de revisión al copiar.
   [Object Lock y cifrado/lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html),
   [restauración](https://docs.aws.amazon.com/AmazonS3/latest/userguide/restoring-objects.html),
   [contrato de CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html).
4. **Vigencia y consumo.** El límite utilizable es el menor entre la fecha
   fija y la vigencia acreditada de acceso y protección. La ventana requerida
   debe salir del perfil interno del efecto, cubrir hasta su última lectura
   posible de origen y caber estrictamente antes del límite con margen
   técnico. Si esa lectura no puede acotarse o aislarse, el tiempo no permite
   autorizar ni reconciliar el efecto. Un futuro permiso releerá identidad,
   revisión, hash y vigencia de la evidencia y competirá con su invalidación
   en la misma transacción de la reserva. La observación aislada no concede
   permiso ni cubre escritores, destino o commit de propiedad.

**Transporte contrastado sin conexión.** En el SDK instalado 3.1003.0,
`GetObjectRetention` entrega el mismo modo y fecha con XML sintético
`EventHold=ON`, `OFF` y omitido. En un `GetObject` versionado, un middleware
acotado al comando pudo distinguir esos tres estados del encabezado de
respuesta y dejar intacto el stream. El bloque 105 implementa esa vía como
observación interna, validada con respuestas sintéticas. Sigue pendiente
acreditar qué respuestas emite un bucket real, incluido el caso de fecha
fija sin encabezado, y aprobar el perfil operativo y la ventana técnica.
La duración de negocio y la política de conservación del histórico son
decisiones aparte.
[Observación implementada](./ownership-archive-preparation.md#lectura-de-la-versión-original-y-fecha-fija-bloque-105).
[Encabezados de GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
[middleware del SDK](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-smithy-types/Interface/MiddlewareStack/).

### Perfil operativo de legibilidad e invalidación (bloque 106)

**Contrato objetivo para la fuente de `HISTORICAL`.** El bloque 105 observa
bytes y fecha fija. Para acreditar la lectura durante el efecto, un productor
interno de confianza deberá vincular esa observación a una revisión inmutable
de un perfil operativo verificado. La primera evaluación propuesta se limita
a un bucket S3 de propósito general por endpoint directo, clase `STANDARD`
y cifrado `SSE-S3`. Es un alcance de prueba pendiente de aprobación
operativa. `RECIPIENT_STAGING` requiere acreditar por separado su fuente
histórica y la procedencia de esa copia.

| Parte | Evidencia exigida |
| --- | --- |
| Versión observada | Anclaje, selector con propietario esperado, hash de observación y revisión/digest fijados. Tomar cifrado, clase y estado de restauración de la misma respuesta versionada. Para este alcance, exigir `ServerSideEncryption=AES256` sin señales de SSE-C o KMS. En S3 directo y autenticado, la omisión del encabezado de clase representa `STANDARD`. Señales de archivado/restauración, cifrado ausente o clases desconocidas quedan fuera del perfil. |
| Principal del efecto | Identidad del firmante y contexto efectivo de sesión, endpoint y despliegue. Acreditar `s3:GetObjectVersion` para el origen de `CopyObject` con ese contexto y esa versión. El lector del GET necesita además acceso al metadato de retención. Si lector y firmante son distintos, acreditar ambos y su alcance por separado. La identidad por STS y un GET exitoso aportan hechos distintos de la autorización efectiva de la copia. |
| Controles operativos | Revisiones verificadas de las políticas efectivas de rol, sesión, bucket, organización y endpoint que apliquen, incluido el estado de etiquetas o ACL si condicionan el acceso. Verificar lifecycle y trabajos pendientes sobre versiones actuales y no actuales, y los cambios de cuenta o configuración capaces de quitar acceso. Si alguna autoridad puede hacerlo fuera de la coordinación o de un control preventivo acreditado, el perfil queda incompleto. |

[Metadatos de GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
[permisos por operación S3](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-with-s3-policy-actions.html),
[identidad STS](https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html),
[evaluación IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html).

El perfil deberá identificar su emisor, ámbito, revisión, hash y vigencia
acreditada. La evidencia por versión referenciará esa identidad y la
observación, bajo la reserva original. Las políticas verificadas y la
protección de su vigencia son dos requisitos. Un hash de configuración,
un GET o una alerta de cambios aportan observaciones puntuales. El límite
utilizable sigue siendo el menor entre fecha fija y vigencia operativa. El
efecto necesita una cota acreditada para su última lectura y margen antes
de ese límite. El timeout local, la vigencia de la sesión y el fin de la
ventana de admisión por sí solos dejan esa cota sin acreditar.

**Invalidación y cambios.**

1. Antes de un cambio que afecte las garantías, bloquear permisos nuevos
   de esa revisión en el ámbito completo del perfil. El futuro grant debe
   competir con la invalidación mediante una escritura condicionada sobre
   el mismo estado de revisión, en la transacción que revalida el ítem y la
   reserva y escribe el permiso. Una lectura snapshot por sí sola permite
   que el grant y la invalidación confirmen sobre documentos distintos.
   El bloqueo del perfil debe alcanzar todos sus ítems aunque una reserva
   particular ya haya cambiado.
2. Mantener los controles externos para los permisos previos hasta contar
   con desenlace suficiente o aislamiento comprobado de sus efectos. Una
   revocación o ventana vencida conserva la incertidumbre de esos intentos.
   Un cambio fuera del protocolo deja las garantías afectadas en duda y
   bloquea nuevos permisos hasta revalidarlas. Detectarlo después sirve para
   responder al incidente, con la incertidumbre de los efectos ya admitidos.
3. Tras el cambio, verificar la propagación y el estado de trabajos previos
   antes de acreditar una revisión nueva. Los cambios de IAM pueden tardar
   en propagarse y las transiciones de lifecycle son asíncronas. Cambiar
   una regla o etiqueta requiere comprobar sus efectos pendientes, incluso
   sobre una versión protegida por Object Lock.
   [Propagación IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/troubleshoot.html),
   [transiciones de lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/lifecycle-transition-general-considerations.html),
   [Object Lock y lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).

**Validación del alcance.** En siete respuestas sintéticas, el SDK instalado
conservó cifrado, clase y restauración en sus campos tipados sin leer el
stream. Distinguió la ausencia de clase, `STANDARD` explícito, archivo
restaurado, KMS, SSE-C, clase desconocida y cifrado ausente. El bloque 107
clasifica esos hechos en una observación enlazada al hash del GET fijo.
La clase omitida queda condicionada a acreditar S3 directo.
Quedan pendientes el emisor operativo, la
duración acreditable del uso y las pruebas de carrera entre grant e
invalidación. La evidencia del destino y la cobertura de escritores se
evalúan por separado.
[Clasificación implementada](./ownership-archive-preparation.md#clasificación-de-almacenamiento-de-la-fuente-original-bloque-107).

El bloque 108 enlaza las observaciones con la revisión activa leída por un
colaborador interno. Comprueba selector, identidad y ventana registrada bajo
la reserva original. El resultado es de solo lectura. La competencia
transaccional con invalidación sigue como requisito para un permiso futuro.
[Enlace implementado](./ownership-archive-preparation.md#enlace-de-la-observación-con-la-revisión-del-perfil-bloque-108).

El bloque 109 añade invalidación local condicionada por perfil o por
generación de controles. La lectura aplica la invalidación compartida a
todos los perfiles que referencian esa generación. La cobertura de los
grupos operativos y la competencia con un futuro permiso quedan pendientes.
[Estado e invalidación](./ownership-archive-preparation.md#estado-e-invalidación-del-perfil-de-origen-bloque-109).

### Ventana local de lectura del origen (bloque 119)

`evaluateItemSourceReadWindow` es una comprobación pura para un intento
`HISTORICAL`. Revalida el conjunto observado contra el anclaje y el
propietario esperado del bucket. Exige la revisión activa exacta y
la identidad del intento, su intención y su reserva.

La acreditación interna referencia el hash de la definición activa y una
evidencia de vigencia para el acceso directo a S3. El hash de la definición
fija emisor, selector, firmante y generación de controles. La cota de última
lectura referencia la definición del intento, el contexto del firmante y
su propia evidencia. El productor de la cota deberá cubrir la última
lectura posible del efecto. Un timeout local o el fin de la sesión dejan
ese requisito pendiente. Los hashes permiten comparar identidades.
La acreditación debe provenir de productores internos de confianza.

El límite es la menor fecha entre la retención fija, el fin de la revisión y
el fin de la acreditación. El instante de evaluación debe estar dentro de
las ventanas activas y ser posterior o igual a la observación. La cota debe
ser futura y, sumado el margen positivo, quedar estrictamente antes del
límite. `WINDOW_FITS` conserva `OBSERVED_ONLY` y `NOT_AUTHORIZED`.
La composición futura deberá releer y cercar las evidencias con la reserva y
la puerta en la misma transacción del permiso. Quedan pendientes el emisor,
la prueba de la cota del transporte y su consumo operativo.

El bloque 134 precisa la evidencia que debe emitir el productor y documenta
el bloqueo de la copia directa cuando falta una garantía de última lectura.
[Contrato del productor](./ownership-archive-preparation.md#contrato-del-productor-de-la-cota-del-transporte-bloque-134).

### Evidencia de protección del destino histórico V2 (bloque 147)

El modelo puro `ITEM_HISTORICAL_PUT_DESTINATION_PROTECTION_V1` fija el hash
del intento V2 validado, el hash del request completo y la generación de
controles. Exige referencias independientes del productor interno para
creación condicional, protección contra borrado y recreación, cobertura de
escritores y continuidad de los controles. El cotejo reconstruye el valor
y exige el hash de protección esperado. Conserva `NOT_AUTHORIZED`.

**Contrato objetivo del productor y consumidor.** La evidencia debe cubrir
el bucket, propietario y clave exactos. Debe acreditar creación exclusiva
para las rutas que puedan escribir y protección frente a borrado de clave o
versión, marcadores de borrado y reglas lifecycle. Debe incluir escritores
anteriores, multipart, replicación y vías administrativas o demostrar su
aislamiento. `If-None-Match: *` puede aceptar una escritura sobre un marcador
vigente. Object Lock protege versiones y permite marcadores. Las reglas de
lifecycle requieren control propio.
[Escrituras condicionales](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html#conditional-write-behavior).
[Object Lock y marcadores](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-managing.html).
[Lifecycle](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html).

`validFrom` y `admitBefore` delimitan la admisión técnica. Los controles
deben mantenerse para intentos admitidos hasta reconciliar el efecto o
acreditar su aislamiento. Alcanzar `admitBefore` conserva la incertidumbre
de esos intentos. El futuro permiso debe releer la generación y competir
con su invalidación en la misma transacción. Una respuesta de escritura
deberá reconciliar la versión exacta y su conservación por separado.

### Registro interno de la protección del destino (bloque 148)

El puerto de registros guarda una sola evidencia en la fila `INTENDED` del
PUT V2. Exige los hashes esperados de evidencia y controles, y reconstruye
el intento bajo la puerta abierta, revisión, reserva, manifiesto y perfil
originales. El primer registro incrementa la revisión de la puerta y
escribe la evidencia con los fences de la reserva, el perfil y las
generaciones de controles en la misma transacción.

Se reutiliza el registro invalidable de controles. Una generación puede
cubrir origen y destino si el productor acredita ambos ámbitos. Una
generación separada requiere su propia fila activa y su propio fence.
La fila activa solo acredita vigencia del registro local. La cobertura del
destino debe venir de las referencias del productor.

La relectura y la repetición exacta usan la revisión vigente y controles
activos, sin escrituras. La relectura devuelve ausencia si faltan los
datos de protección y las demás guardas se cumplen. Una invalidación
impide su relectura como evidencia vigente. El lector general V2 conserva
su respuesta de declaración. El contrato sigue siendo interno.

El registro conserva `NOT_AUTHORIZED`. La evaluación observacional se
describe en el bloque 151. El consumo bajo los fences del permiso sigue
pendiente junto con el productor operativo.

### Contrato del productor de protección del destino (bloque 149)

`ItemHistoricalPutDestinationPreparer` relee el PUT V2 exacto y consulta
un lector de acreditaciones de confianza fuera de la transacción de
registro. El reporte versionado fija emisor, hash del intento, request,
bucket, propietario, clave, generación y ventana. Exige referencias
separadas para creación condicional, borrado de clave y versión,
marcadores y lifecycle. Fija el inventario de escritores y exige que cada
grupo esté reconciliado y controlado o tenga evidencia de aislamiento.
La continuidad debe cubrir los intentos admitidos hasta su reconciliación
o aislamiento, incluso después del límite de admisión.

El caso de uso coteja el hash esperado del reporte y proyecta la
acreditación al registro existente, que vuelve a comprobar la puerta,
reserva y controles. El nuevo registro conserva el hash del reporte para
su relectura posterior. Los registros previos sin ese campo conservan su
formato y hash, pero carecen de ese vínculo. El adaptador operativo aún
debe verificar y conservar el reporte por hash, junto con sus pruebas
subyacentes. La identidad declarada del emisor y los hashes por sí solos
no autentican el reporte.

### Validación local de la protección del destino (bloque 150)

Los casos sin conexión cubren relectura V2 tras liberar custodia,
revisiones y evidencia alteradas, registro con generación compartida o
separada, rollback simulado, respuesta perdida, invalidación y rechazo
de acreditaciones incompletas. Se corrigió el retorno anticipado del
anclaje durante el primer registro y se restauró el conflicto anterior
al intentar reemplazar una declaración V2. El arnés Mongo existente
queda compilado. Su ejecución sigue pendiente de autorización específica.

### Evaluación de admisión del destino histórico (bloque 151)

`assessAdmission` usa las referencias exactas del intento, el reporte,
la protección persistida y la generación. Reutiliza la consulta de
acreditación del preparador y vuelve a leer la protección después de esa
consulta, bajo la puerta, reserva y controles activos. La evaluación
coteja la proyección completa del reporte y usa el reloj interno con
inicio inclusivo y límite exclusivo. La evidencia previa sin vínculo de
acreditación sigue disponible para relectura y queda fuera de esta
evaluación.

`ADMISSION_WINDOW_FITS` conserva `OBSERVED_ONLY` y `NOT_AUTHORIZED`.
El permiso futuro deberá repetir las comprobaciones de tiempo y
generación en la transacción que adquiera los fences y consuma la
evidencia. El límite de admisión deja intactas las obligaciones de
continuidad y reconciliación de efectos admitidos.

## Siguiente bloque y validación pendiente

El siguiente paso del flujo por ítem se mantiene en el
[checkpoint de entrega](./final-delivery-plan.md#punto-de-reanudación-actual).

Subbloque 29: **lector interno paginado de evidencia local de journals por animal**
ya implementado, incluidos terminales y operaciones sin activeWrites. Contrato y
límites en [animal-write-journal-inventory.md](./animal-write-journal-inventory.md).
El inventario de recuperación previo sigue consultando solo controles con claim/lock
y migraciones; el nuevo lector separado amplía evidencia de journals, sin tickets
o trabajos médicos, recuperación o permiso de corte. Contrato que guió ese bloque:

- Incluir alcance animal/versión y semántica exacta MAY_RUN/LOCALLY_FINISHED;
  validar cursor/límite, lecturas primary/majority y salida mínima sin datos clínicos.
- Definir consulta/índice necesario antes de implementación; ausencia de journal
  no es prueba de cobertura, muerte de proceso ni ausencia de efecto remoto.
- Separar observaciones de distintas lecturas; no prometer snapshot global, permiso
  `canCommit`, recuperación, endpoint público o cierre S3. Tickets/BDA y ledger
  por efecto requieren bloques posteriores, no se simulan con este inventario.
- Probar paginación, selección de claims del animal, terminales sin tokens,
  compatibilidad de journals antiguos y errores de consulta sin devolver falso vacío.

El subbloque 30 completa contrato/modelo y el 31 la persistencia con CAS/fences,
solo probada con dobles. El 32 prepara el arnés Mongo opt-in sin conexión.
Siguiente: ejecución real solo con autorización específica del entorno desechable.
Todavía sin dispatch. Luego verificar/adaptar
transporte para TODOS los envíos/retries. Después, aislamiento/retención verificables;
corregir copias y limpieza según ese protocolo, antes de integrar commit operativo.
Ensayos S3/BDA reales requieren un entorno expresamente autorizado. Deben incluir
las seis carreras anteriores, respuestas perdidas, retries/hijos, delete/recreate,
errores parciales y efectos que sobreviven al callback/lease. Mocks y Mongo de un
nodo no demuestran esas propiedades del proveedor.

Validación de este bloque: revisión estática de fuentes y contratos AWS, enlaces
locales comprobados y `git diff --check`. Sin nuevos tests de runtime ni ejecución
de arneses; resultados previos conservan su alcance y fecha en el plan de entrega.

## Referencias del proveedor

- Las URLs prefirmadas son reutilizables; su vencimiento limita autorización y
  no es un recibo de cada petición. Inferimos que no permite acreditar drenaje:
  [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
- Condiciones de origen y destino son distintas; IfNoneMatch protege la creación
  frente a un destino presente: [CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html).
  Si no hay versión actual o existe delete marker, puede admitirse una creación:
  [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
- Quiet conserva errores individuales en la respuesta:
  [DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html).
- El análisis es asíncrono, escribe salidas S3 y se consulta por estado:
  [InvokeDataAutomationAsync](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_data-automation-runtime_InvokeDataAutomationAsync.html).

Impacto/integración centralizados en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
