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
