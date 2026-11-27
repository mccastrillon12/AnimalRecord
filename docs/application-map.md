# Mapa de la aplicación y puntos de impacto

Última revisión: 2026-11-08. Alcance: código local del backend; no representa una
auditoría de Flutter, configuración real de AWS o datos productivos. Consultar
`final-delivery-plan.md` antes de continuar y actualizar este mapa si cambian
responsabilidades o dependencias.

## Módulos y reutilización

Bloque 338: `AnimalModule` proyecta `ownerHistory` desde periodos, nombres
guardados en solicitudes y la proyección mínima de usuarios. Mantiene
`nameHistory` y el enlace `ownershipHistory` separados. `MedicalDocumentModule`
lee el nombre del usuario al crear el archivo y persiste `uploadedBy` para
la agrupación en Flutter; el traspaso conserva esta procedencia. `CatalogsModule`
siembra también `animal_transfer_rejection_reasons` y sirve sus opciones.
El buscador de `UserModule` habilita la identificación parcial con el puerto
existente. No añade conexiones, servicios AWS ni nuevos permisos de animales.

| Módulo                     | Responsabilidad y dependencias                                                                                                                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthModule`               | Login, refresh, verificación, social, PIN y recuperación. Importa UserModule mediante referencia circular existente.                                                                                                                          |
| `UserModule`               | Persistencia de perfiles, disponibilidad, transporte correo/SMS y fotos. Exporta repositorio, `UserCodeSender` y `SearchTransferRecipients`.                                                                                                  |
| `AnimalModule`             | Animal actual, código consecutivo, nombres, ficha, filtros y foto. Exporta repositorio, `AnimalAccessPolicy`, `AnimalWriteCoordinator` y persistencia de periodos/control de propiedad.                                                       |
| `AnimalWriteJournalModule` | Journal técnico por operación, identidad del proceso y transiciones condicionadas con mayoría. Importado/reexportado por AnimalModule; sin endpoints ni recuperación automática.                                                              |
| `DiaryModule`              | Entradas y adjuntos por animal. Importa AnimalModule. `DiaryAccessGuard` verifica propietario y correspondencia entryId/animalId antes del handler.                                                                                           |
| `AnimalMediaModule`        | Emisión persistida de cargas temporales de foto/diario y promoción condicional/verificada a final. Importado por AnimalModule, DiaryModule y OwnershipArchiveModule; no afecta fotos de usuario ni BDA.                                       |
| `MedicalDocumentModule`    | Análisis BDA, revisión, aceptación por animal, descargas, reemplazo 48 h, eliminación y catálogo de campos. Importa AnimalModule; `MedicalDocumentAnimalAccess` reutiliza la política compartida.                                             |
| `CatalogsModule`           | Catálogos Mongo y seed en arranque. Incluye motivos de transferencia con upsert insert-only por código.                                                                                                                                       |
| `LocationModule`           | Países/departamentos/ciudades y su seeder. Reutilizar IDs existentes de ubicación.                                                                                                                                                            |
| `MobileModule`             | Asociación de enlaces móviles; no es proveedor de push.                                                                                                                                                                                       |
| `NotificationModule`       | Bandeja/contador/leído y registro/baja/consulta de dispositivos autenticados. Mismo modelo notifications que usa la creación de solicitudes, dos modelos nuevos para instalaciones/tokens. Importado por AnimalTransferModule; sin worker/push. |
| `NotificationPushPersistenceModule` | Persistencia interna de fan-out, entregas por generación, permisos/intentos/respuestas y baja condicional. Reutiliza outbox/avisos/dispositivos/claims; dos modelos nuevos de entregas/intentos. Fuera del grafo, sin scheduler/proveedor/envío. |
| `AnimalTransferModule`     | Búsqueda, OTP, creación/lista/detalle y rechazo total del destinatario con versión/idempotencia. Consumo OTP o liberación exacta de claims, avisos/outbox/auditoría transaccionales según operación. Preparación/captura interna mediante OwnershipArchiveModule; aceptación, traspaso, corte S3, históricos y push real pendientes. |

Persistencia: Mongoose/MongoDB con puertos de repositorio por dominio. HTTP:
controllers/DTO en `src/app`, validación global con whitelist y rechazo de campos
no permitidos, y `HttpExceptionFilter` para errores de dominio. Swagger está en
`/docs`; no hay frontend Flutter dentro del repositorio.

Bloque 57: `NotificationPushProcessor` se construye explícitamente con puerto de
proveedor y política técnica de retry, no está registrado/activado. Outbox marcado
desde creación (`DEVICE_REVISION_V1`); no adopta filas anteriores. Fan-out por páginas
con cursor/CAS y entregas deterministas por outbox/instalación; no snapshot global de
todos los dispositivos ni backfill posterior. Grant nuevo requiere escritura fence
en dispositivo vigente + intento MAY_SEND en la misma tx, luego una invocación del
puerto fuera de tx. SDK/transporte futuro debe acreditar un solo envío físico por
intento. Rechazo explícito persistido habilita otro intento; incertidumbre no se
recupera por edad/lease/error. Invalidación responde sobre revisión/hash/cuenta y
retira claim en la tx de respuesta, sin cancelar permisos previos. Dos colecciones
nuevas sin autoCreate/autoIndex/TTL; índices declarados, sin instalar. Pruebas con
dobles inicialmente; el 60 validó 39 casos en Mongo local de un miembro con
proveedores simulados, sin FCM real o cambios de HTTP/propiedad.

## Propiedad y permisos actuales

Bloque 105. `ItemManifestObserver` reutiliza el verificador de bytes de
`ItemHistoricalCopyObserver` y el adaptador `AwsItemHistoricalObjectReader`
para observar bytes y fecha fija de la versión original en el mismo GET.
La revalidación usa el store de anclaje existente. Composición explícita de
solo lectura y sin persistencia.
[Contrato](./ownership-archive-preparation.md#lectura-de-la-versión-original-y-fecha-fija-bloque-105).

Bloque 107. El mismo lector y observador capturan y clasifican cifrado,
clase y restauración del GET original. El resultado separado se liga al
hash V1 de la lectura fija y conserva su alcance observacional.
[Contrato](./ownership-archive-preparation.md#clasificación-de-almacenamiento-de-la-fuente-original-bloque-107).

Bloque 108. `ItemManifestObserver` admite un lector explícito de la revisión
actual del perfil. Enlaza las dos observaciones con esa revisión tras releer
el perfil y la reserva original. El puerto queda fuera del grafo HTTP y
el enlace se devuelve en memoria.
[Contrato](./ownership-archive-preparation.md#enlace-de-la-observación-con-la-revisión-del-perfil-bloque-108).

Bloque 109. `MongoItemSourceProfileState` implementa el lector de perfiles
y la invalidación condicionada de la revisión o generación de controles.
Usa una BD suministrada explícitamente y una colección técnica independiente
del ítem. Composición fuera de HTTP, con provisión de filas pendiente.
[Contrato](./ownership-archive-preparation.md#estado-e-invalidación-del-perfil-de-origen-bloque-109).

Bloque 120. El mismo adaptador instala y relee la acreditación de una revisión
existente. El evaluador local de ventana comparte su validación de identidad
y fechas. El emisor real sigue pendiente y la composición queda fuera de HTTP.
[Contrato](./ownership-archive-preparation.md#provisión-local-de-acreditación-del-perfil-bloque-120).

Bloque 123. `MongoTransferItemCapture` compone la relectura de acreditación
en su sesión y el evaluador de ventana. Usa un colaborador local explícito
para la cota del intento y queda fuera de HTTP.
[Contrato](./ownership-archive-preparation.md#evaluación-del-intento-histórico-en-un-snapshot-bloque-123).
El 131 añade la evaluación con la cota del intento persistido cuando
se fija su hash. Ese camino prescinde del colaborador de cotas.
[Contrato](./ownership-archive-preparation.md#evaluación-con-la-cota-registrada-bloque-131).

Bloque 136. `ItemManifestObserver` reutiliza el lector versionado, verificador
y guardas de anclaje para sellar y abrir un artefacto mediante puertos de
custodia explícitos. El 137 añade `InMemoryItemSourceArtifactCustody`,
composición local con cuotas. Los lectores abiertos impiden liberar su
generación. El consumo transaccional sigue pendiente.
[Contrato](./ownership-archive-preparation.md#custodia-acotada-en-memoria-bloque-137).

Bloque 139. `MongoTransferItemCapture` declara el PUT histórico en la puerta
y colección de intentos existentes y usa la guarda del perfil en esa sesión.
El adaptador de custodia queda fuera de la transacción de declaración.
[Contrato](./ownership-archive-preparation.md#declaración-del-put-bajo-la-puerta-original-bloque-139).

Bloque 148. El registro de protección del PUT V2 reutiliza la misma
colección de intentos y verifica la generación de destino en el registro
de controles que usa el perfil de origen, con la misma sesión Mongo.
[Contrato](./animal-transfer-stable-s3-cut.md#registro-interno-de-la-protección-del-destino-bloque-148).

Bloque 149. `ItemHistoricalPutDestinationPreparer` compone el puerto de
registros y un lector de acreditaciones de confianza explícito. La
consulta ocurre fuera de la transacción y la composición es interna.
[Contrato](./animal-transfer-stable-s3-cut.md#contrato-del-productor-de-protección-del-destino-bloque-149).

Bloque 301. El módulo de captura exporta este preparador cuando recibe
el lector de acreditaciones del destino y el lector del perfil activo.
Comparte el store de intentos y el reloj de la composición interna.

Bloque 153. El adaptador de captura reutiliza la colección de intentos,
la sesión y las guardas del perfil para registrar `MAY_RUN`. Requiere un
colaborador local explícito que confirme el artefacto abierto y el
request preparado. La consulta histórica prescinde de ese colaborador.
[Contrato](./ownership-archive-preparation.md#registro-interno-del-primer-permiso-histórico-put-v2-bloque-153).

Bloque 154. `ItemHistoricalPutDispatcher` compone los puertos de registro,
custodia, acreditación y transporte. Reutiliza la apertura del observador.
Solo delega tras un registro confirmado. La primera composición fue
explícita, fuera de Nest y HTTP.
[Contrato](./ownership-archive-preparation.md#delegación-única-del-put-histórico-v2-bloque-154).

Bloque 302. El módulo interno de captura exporta una fábrica de instancias
de un solo uso cuando se configura el lector de acreditaciones. El
llamador aporta custodia y transporte. El dispatcher pasa al mismo store
su comprobación síncrona del artefacto abierto para esa transacción.

Bloque 231. `AwsItemPutTransport` implementa el puerto compartido desde
infraestructura y reutiliza el SDK de S3 y el manejador HTTPS de Smithy.
El dispatcher mantiene la guarda de permiso. La composición es explícita
y queda fuera de Nest y HTTP.
[Contrato](./ownership-archive-preparation.md#transporte-s3-de-un-solo-envío-bloque-231).

Bloque 156. `ItemHistoricalPutReconciler` reutiliza la consulta del permiso
y el verificador de bytes. El productor de evidencia y el lector versionado
son puertos explícitos fuera de la transacción y de HTTP.
[Contrato](./ownership-archive-preparation.md#observación-de-la-versión-exacta-del-put-histórico-v2-bloque-156).

Bloque 157. El reconciliador usa el puerto existente de registros para
guardar la observación y su reporte. El adaptador cerca la generación
de conservación en la misma sesión.
[Contrato](./ownership-archive-preparation.md#registro-de-la-versión-observada-del-put-histórico-v2-bloque-157).

Bloque 158. La preparación de staging enlaza el archivo con el permiso
PUT V2 y su versión reconciliada en la misma sesión que cerca la
reserva y la conservación.
[Contrato](./ownership-archive-preparation.md#preparación-de-staging-desde-la-versión-histórica-v2-bloque-158).

Bloque 160. El adaptador de captura guarda el PUT de staging y su
acreditación en la colección de intentos. Reutiliza el registro de
generaciones para conservación y protección en la misma sesión.
[Contrato](./ownership-archive-preparation.md#declaración-persistida-del-put-de-staging-bloque-160).

Bloque 161. `ItemStagingPutArtifacts` combina la lectura del intento,
el puerto versionado y el verificador de bytes. La custodia en memoria
comparte cuotas y gestión de lectores con el histórico.
[Contrato](./ownership-archive-preparation.md#lectura-y-custodia-de-los-bytes-de-staging-bloque-161).

Bloque 304. El módulo de captura expone la preparación del intento
temporal mediante `ItemCopyRecordStore`. Con clientes de evidencia
explícitos exporta también `ItemStagingPutArtifacts`, que comparte
el cliente y el alcance de lectura versionada del reconciliador.

Bloque 163. El adaptador reutiliza la escritura condicionada de permisos
para staging. La admisión usa las guardas de ambas generaciones y un
colaborador local que verifica el lector y el request preparados.
[Contrato](./ownership-archive-preparation.md#registro-del-primer-permiso-put-de-staging-bloque-163).

Bloque 164. `ItemStagingPutDispatcher` combina el registro y la custodia
de staging con la preparación de transporte compartida con el histórico.
La primera composición fue explícita, fuera de Nest y HTTP.
[Contrato](./ownership-archive-preparation.md#delegación-única-del-put-de-staging-bloque-164).

Bloque 305. Con los clientes de evidencia, el módulo exporta una fábrica
de dispatchers de staging. Cada instancia usa la custodia y el transporte
aportados por el llamador y el mismo store que usa la reconciliación.

Bloque 166. El reconciliador de staging combina el permiso persistido
con el lector versionado y un productor de evidencia de staging.
El adaptador guarda la observación bajo la generación de conservación.
[Contrato](./ownership-archive-preparation.md#reconciliación-de-la-versión-exacta-de-staging-bloque-166).

Bloque 167. El adaptador de captura consume la versión reconciliada de
staging y reutiliza el mapeo generacional de materialización para guardar
una intención final por archivo, bajo los fences originales y el de
conservación.
[Contrato](./ownership-archive-preparation.md#intención-final-desde-la-versión-de-staging-bloque-167).

Bloque 168. El adaptador de captura compone el intento PUT final con la
versión reconciliada de staging y la acreditación del destino generacional.
Reutiliza la colección de intentos, los índices de identidad y ordinal y
las guardas de generaciones.
[Contrato](./ownership-archive-preparation.md#declaración-del-put-final-generacional-bloque-168).

Bloque 169. La custodia y reconciliación del PUT final comparten la
lectura versionada y la verificación de bytes de staging. El dispatcher
usa el transporte de una sola delegación y el adaptador de captura
reutiliza el registro de permiso, retorno y versión en la fila de intento.
[Contrato](./ownership-archive-preparation.md#custodia-permiso-y-reconciliación-del-put-final-bloque-169).

Bloque 306. El módulo de captura exporta la custodia de lectura y la
fábrica del dispatcher final cuando se configuran los clientes de
evidencia. La definición candidata se prepara en el mismo store. El
envío y la reconciliación usan sus operaciones explícitas.

Bloque 170. El observador de cobertura usa el lector paginado de
archivos del adaptador de captura, los registros del PUT final y el
digest del manifiesto sellado. La lectura verifica la generación de
conservación por página.
[Contrato](./ownership-archive-preparation.md#cobertura-de-versiones-finales-por-ítem-bloque-170).

Bloque 171. El adaptador de captura usa la misma validación de versiones
finales para registrar un archivo y comparte la colección y persistencia
por identidad del registro de medios. El módulo interno incorpora ese
modelo para el registro explícito.
[Contrato](./ownership-archive-media-registration.md#registro-por-ítem-desde-la-versión-final-bloque-171).

Bloque 172. El observador de cobertura puede cotejar los registros
`PREPARED` con las versiones reconciliadas dentro de cada snapshot.
El recorrido preparado consulta el modelo del registro de medios.
[Contrato](./ownership-archive-media-registration.md#cobertura-de-registros-preparados-bloque-172).

Bloque 173. El lector de proyección combina las páginas de entradas
selladas con la cobertura preparada y reutiliza el renderizador de
referencias de ficha, diario y documentos.
[Contrato](./ownership-archive-recipient-projection.md#proyección-desde-el-manifiesto-sellado-por-ítem-bloque-173).

Bloque 307. Con los codecs de URLs explícitos, el módulo de captura
exporta el lector de proyección. Reutiliza el observador de cobertura
y el registro por archivo del mismo adaptador.

Bloque 174. El adaptador de captura compone el lector de proyección
con páginas ligadas a la sesión del llamador y comparte la guarda de
sesión del lector de evidencia anterior.
[Contrato](./ownership-archive-projection-read.md#selección-y-relectura-transaccional-por-ítem-bloque-174).

Bloque 175. El lector transaccional enlaza la selección con la
conservación de histórico y final y con el inventario local de la
puerta. El cotejo de acreditación usa un puerto independiente de la
lectura Mongo.
[Contrato](./animal-transfer-stable-s3-cut.md#alcance-del-corte-para-la-proyección-seleccionada-bloque-175).

Bloque 176. El adaptador registra la acreditación en la colección
técnica de copias y reutiliza las guardas de la reserva, las
generaciones compartidas y la sesión del llamador.
[Contrato](./animal-transfer-stable-s3-cut.md#registro-y-relectura-de-la-acreditación-por-alcance-bloque-176).

Bloque 177. El adaptador enlaza la acreditación con el marcador
de consumo de la cabecera y entrega la proyección a las escrituras
del llamador bajo la misma sesión.
[Contrato](./animal-transfer-stable-s3-cut.md#consumo-único-en-la-transacción-del-ítem-bloque-177).

Bloque 178. El consumo usa explícitamente el lector Mongo de fuentes
de captura en la sesión original. Coteja ficha, diario y documentos
vivos y entrega cambios acotados al futuro escritor de propiedad.
[Contrato](./animal-transfer-stable-s3-cut.md#cotejo-del-expediente-vivo-antes-de-escribir-bloque-178).

Bloque 179. El adaptador de captura compone el escritor Mongo de recursos
con control, períodos, archivo, ítem, solicitud y modelos de usuario,
auditoría, avisos y outbox de la misma conexión. La composición es explícita,
fuera del grafo HTTP y sin proveedor operativo.
[Contrato](./animal-transfer-stable-s3-cut.md#commit-interno-de-propiedad-por-ítem-bloque-179).

Bloque 180. El lector interno cruza períodos cerrados con el recibo de
propiedad y el archivo sellado. Reutiliza la reconstrucción del manifiesto
y las constancias de copia para resolver versiones históricas privadas.
[Contrato](./ownership-archive-history.md#lectura-interna-del-período-publicado-bloque-180).

Bloque 181. El descargador interno compone el lector histórico con el
puerto de lectura versionada y el adaptador S3 existente. La entrega usa
el verificador de bytes compartido y conserva la autorización por período.
[Contrato](./ownership-archive-history.md#descarga-privada-de-una-versión-histórica-bloque-181).

Bloque 182. La resolución histórica admite evidencia renovada de un productor
interno y reutiliza la colección de copias y los controles compartidos.
[Contrato](./ownership-archive-history.md#renovación-de-conservación-por-versión-publicada-bloque-182).

Bloque 183. El repositorio de antecedentes admite un lector opcional
del predecesor publicado y lo consulta en la transacción del destino.
[Contrato](./ownership-archive-history.md#vínculo-del-predecesor-publicado-bloque-183).

Bloque 184. El importador usa el lector de versiones publicadas para preparar
antecedentes y comparte los digests de captura para comprobar el manifiesto.
[Contrato](./ownership-archive-history.md#preparación-paginada-desde-el-predecesor-publicado-bloque-184).

Bloque 185. El repositorio de antecedentes compone la revalidación de
la versión publicada con la reserva destino y persiste una intención
por archivo en el manifiesto existente.
[Contrato](./ownership-archive-history.md#admisión-local-de-copia-versionada-bloque-185).

Bloque 186. El repositorio de antecedentes reutiliza la validación de
protección de destino para declarar el primer PUT desde una versión publicada.
[Contrato](./ownership-archive-history.md#declaración-del-intento-histórico-versionado-bloque-186).

Bloque 187. La preparación del PUT histórico publicado reutiliza el lector
versionado y la custodia de staging/final con un sello de protocolo propio.
[Contrato](./ownership-archive-history.md#custodia-del-intento-histórico-versionado-bloque-187).

Bloque 188. El repositorio liga la declaración y la custodia a un único
permiso persistido por archivo y permite su observación para reconciliar.
[Contrato](./ownership-archive-history.md#permiso-único-del-intento-histórico-versionado-bloque-188).

Bloque 189. El dispatcher de antecedentes compone custodia, transporte
y registro de permiso. El repositorio guarda el retorno local bajo el
mismo permiso, con resultado incierto.
[Contrato](./ownership-archive-history.md#delegación-única-y-retorno-local-del-put-histórico-bloque-189).

Bloque 190. El reconciliador de antecedentes reutiliza la lectura versionada
y el cotejo de bytes. Registra la evidencia de procedencia y conservación
bajo el permiso original.
[Contrato](./ownership-archive-history.md#reconciliación-de-la-versión-histórica-escrita-bloque-190).

Bloque 191. El repositorio prepara staging de antecedentes con la
versión histórica reconciliada y reutiliza la guarda de la reserva.
[Contrato](./ownership-archive-history.md#preparación-de-staging-desde-el-histórico-reconciliado-bloque-191).

Bloque 192. El repositorio declara el PUT de staging de antecedentes
con la validación compartida de requests versionados y protección de destino.
[Contrato](./ownership-archive-history.md#declaración-del-put-de-staging-de-antecedentes-bloque-192).

Bloque 193. La custodia compartida sella el PUT de staging de antecedentes.
El repositorio registra el permiso bajo la reserva y los controles existentes.
[Contrato](./ownership-archive-history.md#custodia-y-permiso-único-de-staging-de-antecedentes-bloque-193).

Bloque 194. El dispatcher de staging de antecedentes reutiliza la custodia y
el transporte. El reconciliador comparte la verificación de versiones y
registra la constancia bajo el permiso original.
[Contrato](./ownership-archive-history.md#envío-y-reconciliación-de-staging-de-antecedentes-bloque-194).

Bloque 195. El repositorio prepara y declara el destino final de antecedentes
con el mapeo generacional y la validación compartida de protección de destino.
[Contrato](./ownership-archive-history.md#intención-y-declaración-del-put-final-de-antecedentes-bloque-195).

Bloque 196. La custodia compartida sella el PUT final de antecedentes.
El repositorio registra el permiso bajo la reserva y los controles existentes.
[Contrato](./ownership-archive-history.md#custodia-y-permiso-único-del-put-final-de-antecedentes-bloque-196).

Bloque 197. El dispatcher final de antecedentes usa la custodia y el
transporte compartidos. El reconciliador registra la versión exacta bajo
el permiso original y la generación activa de conservación.
[Contrato](./ownership-archive-history.md#envío-y-reconciliación-del-put-final-de-antecedentes-bloque-197).

Bloque 198. El observador de cobertura usa el lector paginado de
antecedentes y el cotejo de conservación en solo lectura por snapshot.
[Contrato](./ownership-archive-history.md#cobertura-de-versiones-finales-de-antecedentes-bloque-198).

Bloque 199. El repositorio de antecedentes reutiliza el cotejo de versiones
y la persistencia transaccional de `animal_transferred_media`.
[Contrato](./ownership-archive-history.md#registro-de-referencias-finales-de-antecedentes-bloque-199).

Bloque 200. El observador coteja registros de `animal_transferred_media`
y vínculos de entradas retenidas con el manifiesto del predecesor.
[Contrato](./ownership-archive-history.md#cobertura-de-referencias-y-entradas-retenidas-bloque-200).

Bloque 201. El lector de proyección de antecedentes usa el recorrido de
cobertura preparada y los codecs de referencias del destinatario.
[Contrato](./ownership-archive-history.md#proyección-interna-de-antecedentes-bloque-201).

Bloque 202. El repositorio de antecedentes reconstruye la proyección con
los lectores existentes en la sesión del llamador y cerca reserva y
conservación antes de devolver el candidato.
[Contrato](./ownership-archive-history.md#revalidación-transaccional-de-la-proyección-de-antecedentes-bloque-202).

Bloque 203. El repositorio compone el alcance local del corte de
antecedentes en la misma sesión que reconstruye la proyección.
[Contrato](./ownership-archive-history.md#alcance-local-del-corte-de-antecedentes-bloque-203).

Bloque 204. El observador de antecedentes comparte el cotejo de acreditaciones
de corte. El repositorio revalida el informe y cerca sus controles en la sesión
del llamador.
[Contrato](./ownership-archive-history.md#cotejo-de-la-acreditación-del-corte-de-antecedentes-bloque-204).

Bloque 205. El repositorio de antecedentes reutiliza la colección de
registros de copia para persistir y releer la acreditación de corte.
[Contrato](./ownership-archive-history.md#registro-durable-de-la-acreditación-de-antecedentes-bloque-205).

Bloque 206. El consumidor de corte de antecedentes usa la guarda compartida
de cabecera y entrega la proyección al escritor en la sesión original.
[Contrato](./ownership-archive-history.md#consumo-transaccional-de-la-acreditación-de-antecedentes-bloque-206).

Bloque 207. El repositorio de antecedentes guarda sus vínculos en las
entradas retenidas y el recibo en la cabecera junto con el consumo.
[Contrato](./ownership-archive-history.md#guardado-de-referencias-y-recibo-de-antecedentes-bloque-207).

Bloque 208. El repositorio compone el guardado de antecedentes y el
escritor de propiedad en la sesión original y liga sus resultados.
[Contrato](./ownership-archive-history.md#vínculo-del-recibo-de-antecedentes-con-la-publicación-bloque-208).

Bloque 209. El cierre inicial reutiliza la escritura de períodos y
control. El repositorio de antecedentes relee el vínculo de publicación
en la cabecera.
[Contrato](./ownership-archive-history.md#relectura-del-vínculo-de-publicación-y-escritura-de-períodos-bloque-209).

Bloque 210. El adaptador de ítems coteja una decisión registrada con el
expediente posterior usando el lector de recursos vigentes y el alcance
de antecedentes en la misma sesión.
[Contrato](./ownership-archive-history.md#cotejo-del-expediente-completo-en-un-período-posterior-bloque-210).

Bloque 211. El adaptador de ítems liga la proyección vigente y las
versiones cotejadas con el alcance de antecedentes en la misma sesión.
[Contrato](./ownership-archive-history.md#alcance-conjunto-de-recursos-vigentes-y-antecedentes-bloque-211).

Bloque 212. El adaptador de ítems comparte el cotejo de acreditaciones y
usa la colección de registros de copia para guardar el informe conjunto.
[Contrato](./ownership-archive-history.md#acreditación-del-expediente-conjunto-bloque-212).

Bloque 213. El adaptador de ítems compone el escritor de antecedentes y
el escritor existente de recursos vigentes en la sesión del llamador.
[Contrato](./ownership-archive-history.md#consumo-del-informe-conjunto-bloque-213).

Bloque 214. El adaptador de ítems reutiliza el cierre transaccional para
registrar y releer el comprobante de propiedad posterior.
[Contrato](./ownership-archive-history.md#cierre-interno-de-propiedad-posterior-bloque-214).

Bloque 215. `TransferAcceptanceStartModule` permite componer explícitamente el
inicio posterior con el adaptador de antecedentes y el lector de publicación de
ítems, en la misma conexión Mongo. El módulo sigue fuera del grafo HTTP.
[Contrato](./ownership-archive-history.md#inicio-interno-con-antecedentes-publicados-bloque-215).

Bloque 216. El adaptador de ítems coordina el preparador, el importador y el
repositorio existentes para la preparación posterior. La lectura de medios
heredados usa el mismo registro que el inicio. El sellado vuelve a leer los
recursos vigentes en la transacción que guarda los conteos.
[Contrato](./ownership-archive-history.md#preparación-del-expediente-posterior-bloque-216).

Bloque 217. `LaterPeriodLiveMediaReconciler` se compone explícitamente con el
adaptador de ítems, un productor independiente y el lector versionado. El corte
conjunto usa los registros de copia bajo la reserva original.
[Contrato](./ownership-archive-history.md#acreditación-de-archivos-vigentes-posteriores-bloque-217).

Bloque 218. El adaptador de ítems declara y registra permisos de copia de
archivos vigentes. El dispatcher reutiliza lectura versionada, custodia y
transporte condicional explícitos. La reconciliación vuelve a leer ambos permisos.
[Contrato](./ownership-archive-history.md#envío-interno-de-copias-vigentes-posteriores-bloque-218).

Bloque 219. El reconciliador de archivos vigentes puede componer el lector de
permisos Mongo con una fuente independiente de auditoría y el lector existente
de retención por versión. La composición sigue fuera del grafo HTTP.
[Contrato](./ownership-archive-history.md#evidencia-de-copias-vigentes-con-respuesta-incierta-bloque-219).

Bloque 232. El lector de auditoría S3 implementa el puerto del productor con
notificaciones independientes y `HeadObject` por versión. El dispatcher
pide al transporte la marca firmada y conserva su hash en el permiso.
La fuente autenticada se inyecta explícitamente y queda fuera de HTTP.
[Contrato](./ownership-archive-history.md#correlación-del-permiso-con-la-versión-notificada-bloque-232).

Bloque 233. `AwsS3CreatedPutNotifications` lee el archivo del colector con
el SDK de S3 y satisface el puerto de notificaciones. Se compone
explícitamente con el lector del bloque 232.
[Contrato](./ownership-archive-history.md#lectura-del-archivo-independiente-de-notificaciones-bloque-233).

Bloque 234. El colector comparte el lector del archivo versionado y agrega
notificaciones con escrituras condicionales sobre el bucket de auditoría.
Su entrada está prevista para una Lambda dedicada fuera del grafo HTTP.
[Contrato](./ownership-archive-history.md#archivo-concurrente-de-notificaciones-s3-bloque-234).

Bloque 235. El productor de corte posterior combina una fuente independiente
de cobertura con los lectores de bytes y retención por versión. Captura y
el adaptador de histórico fijan la selección. El registro vuelve a cercar
la reserva y las generaciones después de las lecturas de almacenamiento.
[Contrato](./animal-transfer-stable-s3-cut.md#producción-de-evidencia-para-el-corte-posterior-bloque-235).

Bloque 236. El lector de cobertura del corte posterior usa el SDK S3 y
verifica la firma con la clave pública configurada. Comparte la lectura de
JSON versionado con el archivo de notificaciones y se compone con el
productor interno del corte.
[Contrato](./animal-transfer-stable-s3-cut.md#lectura-de-cobertura-firmada-para-el-corte-posterior-bloque-236).

Bloque 250. `StableCutWriterCoverageIssuer` comparte con los lectores el
formato firmado, el selector de alcance y la clave del objeto. Su composición
requiere una fuente independiente y una clave privada explícita. Queda fuera
del grafo HTTP y la publicación en S3 se mantiene pendiente.
[Contrato](./animal-transfer-stable-s3-cut.md#emisión-independiente-de-cobertura-firmada-bloque-250).

Bloque 251. El emisor puede usar `StableCutInventoryEvidenceReader` en
aplicación. Este coteja el inventario y los hallazgos del puerto operativo
independiente. Su adaptador del entorno queda pendiente.
[Contrato](./animal-transfer-stable-s3-cut.md#cotejo-del-inventario-de-escritores-y-efectos-bloque-251).

Bloque 252. `AwsStableCutOperationalEvidenceSource` conecta ese puerto con
el archivo versionado del colector mediante el lector JSON acotado existente.
Se compone explícitamente fuera del grafo HTTP.
[Contrato](./animal-transfer-stable-s3-cut.md#lectura-del-archivo-operativo-de-evidencia-bloque-252).

Bloque 253. `AwsStableCutWriterCoveragePublisher` se compone con el emisor
independiente y el cliente S3. Reutiliza el lector JSON para comprobar una
versión publicada ante colisión o respuesta incierta, fuera del grafo HTTP.
[Contrato](./animal-transfer-stable-s3-cut.md#publicación-versionada-de-cobertura-firmada-bloque-253).

Bloque 254. `ops:stable-cut-coverage` compone el lector del colector, el
emisor y el publicador con un cliente S3. Carga una clave Ed25519 desde el
montaje configurado y valida su huella pública antes de acceder a S3.
[Configuración](./animal-transfer-stable-s3-cut.md#entrada-operativa-y-clave-del-emisor-bloque-254).

Bloque 255. Captura puede exportar las identidades de intentos del período
inicial en el snapshot del alcance. El lector del colector coteja el digest
existente y exige cobertura individual de los permisos registrados.
[Contrato](./animal-transfer-stable-s3-cut.md#permisos-de-copia-del-período-inicial-en-el-inventario-bloque-255).

Bloque 256. La lectura del alcance posterior incluye evidencia de las
copias retenidas y vigentes para el colector. El emisor usa los digests
existentes para exigir un hallazgo por permiso seleccionado.
[Contrato](./animal-transfer-stable-s3-cut.md#permisos-y-versiones-del-período-posterior-en-el-inventario-bloque-256).

Bloque 257. `AwsStableCutOperationalEvidenceArchive` comparte el cotejo del
emisor y la escritura condicional del publicador. Archiva los hallazgos antes
del inventario. La composición del proveedor sigue fuera del grafo HTTP.
[Contrato](./animal-transfer-stable-s3-cut.md#archivo-del-inventario-y-los-hallazgos-del-colector-bloque-257).

Bloque 258. `LaterPeriodLivePutCutEvidenceSource` combina las fuentes de
inventario y hallazgos restantes con la auditoría y retención de los PUT
vigentes seleccionados. Reutiliza las lecturas de captura y el productor de
auditoría; se puede componer con el archivo del colector fuera de HTTP.
[Contrato](./animal-transfer-stable-s3-cut.md#auditoría-de-put-vigentes-para-el-colector-bloque-258).

Bloque 259. `AwsPutVersionEvidenceReader` conecta los reconciliadores de
copias iniciales y retenidas con el archivo versionado de informes del
productor independiente. Reutiliza la lectura JSON y el cotejo de dominio.
[Contrato](./animal-transfer-stable-s3-cut.md#informes-independientes-de-versión-por-permiso-bloque-259).

Bloque 260. El colector posterior puede combinar la auditoría vigente con
`PublishedHistoryCutPutFindings`. Este relee los informes de los tres PUT
retenidos y verifica sus versiones a partir de la selección de Mongo.
[Contrato](./animal-transfer-stable-s3-cut.md#hallazgos-de-put-de-antecedentes-retenidos-bloque-260).

Bloque 261. `ItemStableCutPutEvidenceSource` combina los informes de permisos
iniciales verificados con la autoridad del inventario. Captura exporta las
observaciones del snapshot y la relectura usa el cotejo común con antecedentes.
[Contrato](./animal-transfer-stable-s3-cut.md#hallazgos-de-put-del-primer-traspaso-bloque-261).

Bloque 262. `PutVersionEvidenceProducer` combina un lector independiente
de procedencia con verificación de bytes y retención. El publicador en S3
usa las claves del lector existente para los seis protocolos de permiso.
[Contrato](./animal-transfer-stable-s3-cut.md#producción-y-publicación-de-informes-de-versión-bloque-262).

Bloque 263. Las admisiones Mongo iniciales y retenidas fijan el hash del
marcador firmado que prepara `AwsItemPutTransport`. Las relecturas conservan
la identidad de los permisos previos y reconstruyen los nuevos con su marcador.
[Contrato](./animal-transfer-stable-s3-cut.md#marcador-de-auditoría-en-permisos-iniciales-y-retenidos-bloque-263).

Bloque 264. `PutVersionAuditSelectionReader` reutiliza las lecturas de
reconciliación de captura e histórico. `AwsPutVersionProvenanceReader`
comparte el lector de auditoría S3 de los PUT vigentes y alimenta al
productor de informes fuera de las transacciones del expediente.
[Contrato](./animal-transfer-stable-s3-cut.md#correlación-de-eventos-con-permisos-iniciales-y-retenidos-bloque-264).

Bloque 265. `AwsPutVersionEvidencePublication` compone explícitamente la
selección del permiso, los lectores de notificaciones y versiones y el
publicador del informe. Queda fuera de HTTP.
[Contrato](./animal-transfer-stable-s3-cut.md#publicación-interna-desde-el-permiso-original-bloque-265).

Bloque 266. `AwsPutVersionEvidenceReconciliation` conecta el hash del recibo
con los seis reconciliadores existentes, con clientes de lectura explícitos.
Conserva las operaciones transaccionales de captura e histórico.
[Contrato](./animal-transfer-stable-s3-cut.md#reconciliación-desde-el-recibo-del-informe-bloque-266).

Bloque 303. El módulo interno exporta las operaciones de publicar y
reconciliar si el llamador aporta los clientes de notificaciones, versiones
e informes. Ambas usan el store de captura. Los protocolos retenidos
requieren además su store histórico.

Bloque 270. El archivo operativo del colector exige una fuente independiente
de completitud para cotejar los grupos de despliegues y capacidades previas.
El emisor sigue leyendo el par versionado existente.
[Contrato](./animal-transfer-stable-s3-cut.md#cotejo-independiente-del-censo-antes-de-archivar-bloque-270).

Bloque 271. El lector S3 de constancias firmadas satisface el puerto de
completitud del colector. Reutiliza la lectura versionada y la verificación
Ed25519 del corte estable.
[Contrato](./animal-transfer-stable-s3-cut.md#lectura-de-constancias-firmadas-de-completitud-bloque-271).

Bloque 272. El emisor de completitud consulta la fuente del censo y el
publicador usa la escritura condicional versionada para el lector del
colector. La composición queda fuera de HTTP.
[Contrato](./animal-transfer-stable-s3-cut.md#emisión-y-publicación-de-constancias-de-completitud-bloque-272).

Bloque 273. `StableCutWriterCensusCompleteness` proyecta los censos de la
autoridad al puerto que ya usa el emisor. Liga las referencias verificadas
al alcance y a los grupos de despliegues y capacidades previas.
[Contrato](./animal-transfer-stable-s3-cut.md#respaldo-del-censo-de-escritores-bloque-273).

Bloque 274. El comando de emisión de completitud compone el lector S3
del censo fijado, el emisor y el publicador del archivo de constancias.
[Contrato](./animal-transfer-stable-s3-cut.md#lectura-operativa-del-censo-fijado-bloque-274).

Bloque 276. `collect` compone los lectores del par de entrada y de la
constancia firmada con el archivo que consume el emisor final.
[Contrato](./animal-transfer-stable-s3-cut.md#entrada-operativa-del-colector-bloque-276).

Bloque 277. `verify` compone el lector S3 de cobertura firmada inicial o
posterior con la clave pública fijada. Opera fuera de HTTP y Mongo.
[Contrato](./animal-transfer-stable-s3-cut.md#verificación-operativa-del-informe-firmado-bloque-277).

Bloque 278. `preflight` alimenta los validadores de censo y cobertura
con archivos locales. Comparte el formato de entrada de los lectores S3.
[Contrato](./animal-transfer-stable-s3-cut.md#revisión-local-del-paquete-de-la-autoridad-bloque-278).

Bloque 237. El productor de corte inicial comparte las verificaciones de
versiones y cobertura firmada con el productor posterior. Captura entrega
las observaciones del snapshot y las registra en otra transacción bajo
la selección original.
[Contrato](./animal-transfer-stable-s3-cut.md#producción-de-evidencia-para-el-corte-inicial-bloque-237).

Bloque 308. El módulo de captura conecta el productor explícito del corte
inicial con el adaptador de registro. Comparte el codec de URLs con el
lector de proyección y conserva el alcance fijado por el llamador.

Bloque 309. El módulo de captura compone el cierre inicial y la consulta
del comprobante con el adaptador de recursos y los modelos existentes de
usuario, auditoría y avisos. Desde el 342, el cierre escribe el evento por
ítem y los avisos de resultado al terminar la decisión completa.
[Contrato](./animal-transfer-stable-s3-cut.md#confirmación-del-cierre-del-período-inicial-bloque-229).

Bloque 311. El servicio de captura recupera el selector inicial con el
mismo adaptador y la misma lectura transaccional. La decisión guardada
fija la versión y la cabecera original aporta la revisión de captura.
[Contrato](./ownership-archive-capture.md#alcance-disponible).

Bloque 312. El store de copia reutiliza el snapshot de captura, el
validador del manifiesto y los lectores de reconciliación de los tres
PUT iniciales para recuperar el intento exacto y su evidencia guardada.
[Contrato](./ownership-archive-preparation.md#reanudación-de-una-copia-por-ítem-bloque-312).

Bloque 313. El proveedor de cierre recupera la acreditación registrada
o el comprobante ya persistido con los lectores del adaptador de captura.
[Contrato](./animal-transfer-stable-s3-cut.md#confirmación-del-cierre-del-período-inicial-bloque-229).

Bloque 220. El lector por período usa el comprobante posterior y coteja el
expediente publicado. El descargador existente admite una composición explícita
con el validador de versiones retenidas.
[Contrato](./ownership-archive-history.md#lectura-y-descarga-del-segundo-período-publicado-bloque-220).

Bloque 222. El renovador de conservación compone el lector de publicaciones,
el lector de retención y bytes versionados y el registro de copia existente.
[Contrato](./ownership-archive-history.md#verificación-de-la-conservación-renovada-bloque-222).

Bloque 223. El lector de históricos por dueño usa el adaptador de ítems para
listar períodos publicados y abrir el expediente por la misma publicación.
[Contrato](./ownership-archive-history.md#consulta-de-períodos-históricos-por-dueño-bloque-223).

Desde el bloque 319, el arranque de AnimalRecord acepta una composición
explícita de transferencias. `AppModule.withTransferAcceptance` registra
las mismas dependencias del backend y monta `AnimalTransferController` y
`OwnershipHistoryController`. El módulo que se le pasa exporta el inicio,
el continuador por ítem y el lector y descargador del histórico. El POST
invoca el continuador después de confirmar el inicio en Mongo. El arranque
normal conserva el grafo público. El arnés sustituye las dependencias
externas y reutiliza las operaciones de captura, copia y cierre.
Desde el bloque 320, `TransferItemCaptureModule` puede exportar ese
continuador para el período inicial cuando recibe el proveedor de copias,
el productor de corte y el adaptador de cierre. El continuador recarga la
captura, prepara el manifiesto y usa la proyección y acreditación vigentes
para cerrar. Un recibo y publicación ya aplicados terminan la reanudación.
El bloque 321 añade `InitialTransferAcceptanceModule.register(options)`
para usar con `bootstrap(runtime)`. Reúne el inicio del período inicial,
el proveedor de copias y el histórico. El proveedor copia por archivo
en tres etapas, valida su manifiesto y reusa permisos y evidencias.
Las acreditaciones de origen y destino, el transporte, los lectores de
eventos, versiones e informes, y el productor de corte se configuran
explícitamente. El proveedor conserva el horizonte acreditado al retomar
las mismas versiones. La evidencia de un entorno de prueba queda
restringida a ese entorno.
[Requisitos operativos](./animal-transfer-stable-s3-cut.md#revisión-local-del-paquete-de-la-autoridad-bloque-278).
[Contrato local](./frontend-animal-transfer-foundations.md#contrato-http-del-histórico-para-el-ensayo-local).
Desde el bloque 322, el punto de entrada de Docker puede montar esta
composición usando la misma conexión Mongo, el capturador y el adaptador
de recursos del backend.

Bloque 142. `AwsItemHistoricalObjectReader` entrega los encabezados de
representación del GET versionado. `ItemManifestObserver` puede ligarlos al
sello del artefacto como evidencia interna separada.
[Contrato](./ownership-archive-preparation.md#metadatos-de-representación-del-artefacto-histórico-bloque-142).

Bloque 143. La definición pura del intento PUT V2 coteja esa evidencia
contra el sello y proyecta los encabezados del histórico privado. El 144
registra la evidencia en la misma fila de intento V2 bajo la puerta
existente. Los caminos V1 conservan su formato de fila.
[Contrato](./ownership-archive-preparation.md#declaración-y-evidencia-del-put-v2-bloque-144).

Bloque 300. `ItemManifestPreparer` usa el observador del módulo de captura
para preparar el sello y metadatos V2. El mismo módulo suministra al
store de declaración el propietario esperado del bucket y la guarda
del perfil. La custodia se aporta en cada preparación.

Bloque 146. La relectura PUT V2 comparte el snapshot de captura con la
consulta del perfil y los controles y coteja la fila sin abrir custodia.
[Contrato](./ownership-archive-preparation.md#relectura-interna-del-put-v2-bloque-146).

Bloque 116. `ItemManifestPreparer` usa `ItemManifestObserver` para confirmar
el conjunto de origen. `MongoTransferItemCapture` requiere la guarda del
perfil y un reloj configurados explícitamente para la primera escritura.
La composición permanece fuera del grafo HTTP.
[Contrato](./ownership-archive-preparation.md#persistencia-del-conjunto-de-origen-bloque-116).

Bloque 299. El módulo de captura conecta los lectores de retención y
versión fija con el observador. Usa el mismo adaptador de perfil y reloj
para observar y cercar el perfil durante la confirmación. El propietario
esperado del bucket se configura en la composición interna.

Bloque 101. `ItemManifestPreparer` compone el observador y
`MongoTransferItemCapture` para guardar el primer reporte de retención de
origen en `ArchiveFile`, con propietario esperado configurado. El store
reutiliza las guardas y cuatro fences de la reserva original. La relectura es
local y el reporte conserva su alcance observacional.
[Contrato](./ownership-archive-preparation.md#persistencia-del-reporte-de-retención-de-origen-bloque-101).

Bloque 100. `ItemManifestObserver` admite un lector y un reloj de composición
explícita para observar retención de la fuente. `AwsItemHistoricalObjectReader`
reutiliza el cliente S3 con bucket y propietario esperados. El observador relee
el anclaje local después de `GetObjectRetention`. El resultado conserva su
alcance observacional. [Contrato](./ownership-archive-preparation.md#observación-de-retención-de-la-fuente-histórica-bloque-100).

Bloque 97. `ItemManifestObserver.anchorHistoricalSource` combina el recorrido
de ocho fuentes y `readHistoricalSourceForAnchor` del mismo store. La lectura
final de siete fuentes compara el digest persistido, intención y observación
originales en el mismo snapshot. El resultado liga hashes del archivo y
manifiesto a la reserva original. La composición sigue siendo interna y de
solo lectura. [Contrato](./ownership-archive-preparation.md#anclaje-local-de-la-fuente-histórica-bloque-97).

Bloque 93: `MongoTransferItemCapture` reutiliza su tx/guardas y cuatro fences para
puerta OPEN/REVOKED y declaraciones INITIAL/INTENDED con CAS en filas acotadas de
`animal_transfer_copy_records`. Modelo noveno opcional para caminos anteriores;
solo métodos nuevos requieren colección/cuatro índices, sin DDL/TTL/autoCreate/
autoIndex. Puerta común por ítem/reserva, revocación anterior a abrir, unicidad de
ordinal/identidad y replay solo de metadatos. El módulo explícito fuera del grafo
registra el modelo y exporta `ItemCopyRecordStore` con useExisting del store actual;
sin otro repositorio, worker o HTTP. No hay grant/dispatch; retries rechazados sin
predecesor durable. Arneses/instalador previos no incluyen la colección nueva.
[Contrato y límites](./ownership-archive-preparation.md#puerta-e-intentos-intended-persistidos-bloque-93).

Bloque 92: `buildItemCopyAttemptIntent` define identidad pura por envío/retry,
reutilizando intenciones históricas/staging y su binding original. Referencias
planas/hash/ordinal, sin otra máquina de ejecución, store/schema/provider/HTTP.
La autorización anterior aportada no es prueba; siempre NOT_AUTHORIZED. El
protocolo de promociones sigue ligado a HTTP y no se adopta para transferencias.
[Auditoría y contrato pendiente](./ownership-archive-preparation.md#contrato-de-intento-físico-de-copia-bloque-92).

Bloque 89: `observeStaging` y `ItemStagingCopyPreparer.prepareObservation` amplían
los componentes existentes, sin otra capa/modelo/provider/HTTP. Tres puertos del
mismo store de siete fuentes validan la intención de staging y su pareja histórica;
I/O fuera de tx, `stagingByteObservation` opcional Mixed con CAS/cuatro fences y
replay exacto sin otra lectura. Fuera de definición/digest, sin default/índice;
claimant base excluye el quinto campo incluso huérfano. La observación no concede
envío/retención/corte o negocio. [Contrato](./ownership-archive-preparation.md#observación-y-persistencia-de-bytes-de-staging-bloque-89).

Bloque 86: `ItemSourceObservationPreparer` compone observador y dos puertos del
mismo store de siete fuentes. `sourceByteObservation` opcional Mixed en manifiesto,
CAS y cuatro fences originales en una tx; replay sin otro I/O y corrupción bloqueada.
Campo fuera de definición/digest, sin default/índice, modelo/provider/HTTP nuevo;
claimant base excluye también ese campo huérfano. Histórico/staging compatibles,
sin permisos de copia/negocio. [Contrato](./ownership-archive-preparation.md#persistencia-de-la-observación-de-origen-bloque-86).

Bloque 85: `ItemHistoricalCopyObserver.observeSource` reutiliza readHistoricalCopy
y el lector explícito del 77 para comprobar por streaming el SHA declarado contra
la revisión original del origen. HEAD actual/GET condicional/HEAD actual, sin
adoptar otra revisión. Resultado separado del histórico y del predecesor de staging;
solo observacional, sin persistencia/fences, modelo/provider/HTTP o permiso nuevo.
El método histórico conserva su contrato. [Detalle](./ownership-archive-preparation.md#observación-de-bytes-del-origen-original-bloque-85).

Bloque 83: `ItemManifestPreparer` compone observador y resumeManifestDigest/
confirmManifestDigest del mismo adaptador. Guarda el digest observado en cabecera
con CAS y cuatro fences originales; replay exacto sin recorrer filas. Campo Mixed
opcional sin default/índices, fuera de definición/reserva; ocho fuentes, sin modelo,
provider/worker/HTTP nuevo o permisos de copia/negocio. Contrato para colector
interno, sin autenticar JSON como prueba. [Detalle](./ownership-archive-preparation.md#persistencia-del-digest-observado-bloque-83).

Bloque 297. `TransferItemCaptureModule.register` exporta opcionalmente
`ItemManifestPreparer` cuando recibe un resolutor de claves explícito.
Captura y manifiesto comparten el mismo adaptador de ítems. El módulo
permanece fuera del grafo HTTP.

Bloque 298. Con un lector de objetos explícito, el mismo módulo exporta
`ItemSourceObservationPreparer`. Comparte el observador del manifiesto
y el adaptador de captura y usa el lector de bytes histórico para el origen.

Bloque 82: el adaptador/módulo explícito de captura añade el modelo existente de
entradas (ocho fuentes para manifiesto), sin schema/DDL/autoCreate/autoIndex.
Reutiliza guards/snapshot del ítem y keyset singleBatch para el manifiesto.
`ItemManifestObserver`, de construcción explícita y fuera del grafo/providers/HTTP,
enlaza esas páginas al acumulador del 81 y revalida al final. No adquiere fences o
persiste digests; métodos anteriores conservan seis/siete fuentes. Integridad local
sin corte remoto, retención o permiso. [Contrato](./ownership-archive-preparation.md#lectura-interna-del-manifiesto-por-ítem-bloque-82).

Bloque 81: `ItemManifestDigest` define recorrido/digest puro por ítem con el
inspector existente, buildArchiveEntry y la validación inmutable de archivo
compartida con intenciones de copia. Requiere orden, páginas vacías finales,
conteos y bindings exactos; sin lector/store/schema/provider/HTTP nuevo. No persiste
o acredita lectura real, procedencia, retención o corte remoto por sí solo. El 82
añade el lector descrito arriba. [Contrato](./ownership-archive-preparation.md#contrato-puro-de-recorrido-y-digest-local-bloque-81).

Bloque 78: `ItemStagingCopyPreparer` compone explícitamente el observador del 77
con resumeStagingCopy/confirmHistoricalObservation del mismo store de siete modelos.
Persiste observación histórica e intención de staging juntas en el manifiesto,
con CAS y los fences originales; replay exacto sin nuevo I/O de objetos. Dos campos
opcionales sin default/índices; claimant anterior excluye los tres campos de preparación,
incluso huérfanos. Sin provider/import/HTTP, dispatch o permisos; MATCH no certifica
procedencia, corte o retención. [Contrato](./ownership-archive-preparation.md#observación-e-intención-de-staging-persistidas-bloque-78).

Bloque 77: `ItemHistoricalCopyObserver` usa readHistoricalCopy del mismo adaptador
por ítem (siete modelos, solo snapshot sin fences) y un lector de objetos histórico.
`AwsItemHistoricalObjectReader` recibe cliente explícito y solo emite HEAD/GET.
Ambos fuera del grafo/providers, sin entorno o clientes automáticos. Reutilizan
pins/hash/builders existentes; devuelven observación sin persistencia, permisos de
copia/negocio, procedencia, retención o corte estable. Compatibilidad interna y
contrato en [preparación](./ownership-archive-preparation.md#observación-histórica-por-bytes-bloque-77).

Bloque 74: el módulo explícito de captura por ítem añade el modelo de archivos
del manifiesto para prepareHistoricalCopy, en la misma conexión/tx. Reutiliza
decisión/claim/reserva/período y fences existentes; añade historicalCopyIntent
opcional sin default/índices nuevos. El claimant base excluye archivos con ese
campo, incluso corrupto: no habilita copias por guardar la intención. Recibo sin
permiso de envío/negocio o garantía de corte/retención; módulo aún fuera del grafo.
Contrato y límites en [preparación](./ownership-archive-preparation.md#persistencia-histórica-por-archivo-bloque-74).

Bloque 69: `TransferItemCaptureModule.register` también queda fuera del grafo.
Reutiliza solicitud/ítem/claim/cabecera/control/período; resuelve identidad desde la
decisión y escribe fences de admisión antes de llamar una página de captura fuera
de tx. Requiere proveedor explícito, sin importar SDK o activar worker. observe solo
lee progreso; captureBatch admite expectativa opcional de hash/época/revisión.
Sin lease exclusivo, copias, commit o HTTP; contadores internos sin default/DDL.

Bloques 65/66: `TransferAcceptancePreparationModule` observa siete fuentes y devuelve
un candidato sin permiso. `TransferAcceptanceStartModule.register` requiere un
resolver puro de URLs, añade diario/medios/cabeceras/eventos/users y escribe inicio
PROCESSING con reservas, cabeceras, ítems/claims y evento en la misma tx, tras validar
todo el conjunto. Ambos fuera del grafo HTTP; el segundo reutiliza la infraestructura
de snapshot, mapeos y fence original de captura, sin SDK ni llamar capture.start.
Doce colecciones existentes, unicidades verificadas, sin DDL/autoCreate/autoIndex.
El manifiesto del 61 no prepara/certifica esas fuentes adicionales. Conservan guarda
inicial y reglas médicas; no copian, cambian propiedad o habilitan aceptación pública.

Bloque 63: `src/operations/transfer-flow-indexes.cli.ts` y `ops:transfer-flow` son
entrada de proceso independiente compilada en dist/operations, fuera de módulos,
HTTP, arranque y seeders. URI dedicada, target explícito/review con endpoints sin
credenciales y ejecución opt-in; conexión driver nativa cerrada por invocación,
metadatos/DDL solo mediante operador 61. No configura Atlas ni habilita negocio.
El 64 validó 47 casos en Mongo local, incluidos runner/cliente nativo, con puerto de
archivo simulado; no subprocess CLI conectado ni preparación productiva/Atlas.

Bloque 61: manifiesto/inspector y operador interno prepare/apply de requisitos del
flujo (15 colecciones/38 índices), fuera del grafo/arranque/HTTP. Recibe Db y target
explícitos; inspección solo de metadatos. Adiciones limitadas a 11 colecciones propias;
faltantes/conflictos en cuatro fuentes compartidas bloquean, sin reparación. No es
permiso de negocio/activación ni instalador automático para Atlas. El 62 validó los
44 casos en Mongo local (incluidos cinco del operador), sin cambios de código o
preparación de una BD de aplicación; producción/proveedores reales siguen pendientes.

Bloque 58: decisiones vacías rechazan el conjunto completo con CAS de solicitud,
ítems/claims/evento/avisos/outbox en la misma tx; selecciones no vacías bloqueadas.
No depende de AWS/estado clínico/animal activo ni escribe controles o propiedad.
Reutiliza las seis colecciones y módulos actuales; agrega tipo de aviso y un índice
de claims por transferId declarado, sin instalar. GET detalle pasa a snapshot por
página (requiere preflight/replica set), cursores ligados a versión; listado admite
status PENDING/REJECTED. Leer ese snapshot no concede permisos de negocio.

El ensayo HTTP de aceptación compone `TransferRequests` con
`TransferAcceptanceStart` mediante un proveedor explícito. Devuelve el
resumen persistido después del inicio o de su repetición. La composición
pública carece de ese proveedor y conserva el rechazo de selecciones no
vacías. [Contrato local](./frontend-animal-transfer-foundations.md#contrato-http-de-aceptación-para-el-ensayo-local).

- `Animal.ownerId` representa el dueño actual. `nameHistory` solo guarda nombres;
  el usuario confirmó que no era un historial de propietarios.
- El listado y los filtros HTTP de animales se limitan al usuario autenticado;
  consultar otro ownerId o un detalle ajeno devuelve 403.
- Actualizaciones generales, foto, diario y adjuntos se autorizan por animal.
  En diario se valida además que la entrada pertenezca a la ruta consultada.
- Un ownerId recibido por compatibilidad en PUT de animal solo puede ser igual
  al dueño actual. El servicio preserva identidad, código y fechas de creación.
- `findTransferableAnimal` centraliza propiedad + animal activo. No confundirla
  con aceptación: existen periodo inicial, lock y preparación interna de archivos;
  corte S3 completo, antecedentes retenidos, activación de referencias y permisos
  históricos aún no están implementados. Coordinación HTTP y captura Mongo del
  periodo inicial con cursor/preflight ya están integradas internamente.
- `animal_ownership_periods` mantiene la propiedad separada de `nameHistory`.
  `animal_ownership_controls` mantiene versión y lock interno sin ampliar el
  payload HTTP del animal. El backfill es insert-only, idempotente y recorre
  lotes de 200 con proyección mínima. La política repara/verifica el estado antes
  de escribir y rechaza inconsistencias. Si solo falla inicializar propiedad
  después de crear el animal, conserva el éxito y deja la reparación pendiente.
  Bloque 339: al arrancar, un `ConflictError` de un animal se registra como
  `animal-ownership-initialization-conflict` con su UUID y se continúa el
  recorrido. El resumen `animal-ownership-initialization-completed` informa
  revisados/conflictos; los errores de infraestructura siguen abortando.
  Los metadatos coherentes de periodos posteriores se leen sin upserts.
  No se inicializa V1 si ya existe un periodo, falta el control de un periodo
  existente, la versión es posterior, o quedan señales de reserva/escrituras
  o ventana de carga sin periodo activo. No se reparan discrepancias ni se
  habilitan mutaciones de animales inconsistentes.
- `findWritableAnimal(s)` rechaza con conflicto mientras existe lock. Ficha,
  foto, diario/adjuntos y mutaciones médicas lo usan; las lecturas actuales no.
- `AnimalWriteCoordinator` añade tokens persistidos por operación HTTP. Adquirir
  reserva exige cero escritores y ventanas de carga vencidas, atómicamente en
  el mismo control. No serializa CRUD entre sí. Medicina coordina también REJECT,
  polling ANALYZING y normalización legacy; GET puros siguen disponibles.
  Callers internos nuevos deben envolver toda su operación. Detalles/límites en
  [animal-write-coordination.md](./animal-write-coordination.md).
- Subbloque 8: nuevas operaciones HTTP coordinadas persisten journal e INTENT
  antes de claims y permiso MAY_RUN antes del callback. Identifica instancia,
  actor/tipo técnico, animales/versión y resultados locales/claims inciertos,
  sin payload clínico o credenciales. Claims nuevos enlazan operationId/instanceId;
  legacy queda sin atribución inventada. Errores antes de ejecutar fallan cerrado;
  fallos de evidencia posterior no cambian éxito/error original. LOCALLY_FINISHED
  no prueba fin de AWS ni rollback; no se retiran tokens ni se reejecutan callbacks.
  Registro/control no eran transaccionales en el subbloque 8: incertidumbre explícita.
  Contrato y fases: [animal-write-journal.md](./animal-write-journal.md).
- Subbloque 9: nuevas operaciones marcan TRANSACTIONAL_CLAIMS_V1; beginWrite
  enlazado inserta token y autoriza ACQUIRED en una transacción corta
  snapshot/primary/majority, condicionada al journal/actor/versión y permiso aún
  ausente. AnimalModule exporta AnimalWriteRecovery, interno sin endpoint/job.
  Recuperación auditada del protocolo nuevo únicamente antes de MAY_RUN, con
  fence terminal y retirada exacta en la misma transacción. Impide adquisiciones
  tardías y compite con permiso del callback. NOT_INVOKED con permiso previo
  también se excluye. No recupera journals anteriores/legacy, efectos remotos ni
  reservas generales, ni añade TTL o reejecución de callbacks. Las escrituras
  HTTP coordinadas requieren ahora transacciones Mongo; contrato central Flutter
  actualizado con 500/409 previos/latencia, manteniendo éxitos y PUT primitivo.
- Tokens sin TTL: un crash puede dejar recuperación pendiente y bloquear
  transferencias. La espera de URLs no prueba fin de PUT ya iniciados. No
  habilitar aceptación sin recuperación operativa, protocolo en todas las
  réplicas, tratamiento S3 tardío, captura/IA pendiente y pruebas reales.
- Subbloque 11: arnés ejecutado con adaptadores Mongo reales, 1 suite/11 pruebas
  aprobadas en MongoDB 8.0.34, replica set local de un nodo y dos conexiones del
  mismo proceso. Se verificaron índices, transacciones, carreras, rollback y
  reintento auditado, junto con limpieza de la base/contenedor de pruebas.
  No cambió código de ejecución; no demuestra multinodo/failover/red/S3 ni habilita
  intervención productiva. Evidencia: [animal-write-mongo-validation.md](./animal-write-mongo-validation.md).
- El acceso histórico futuro requiere registros y rutas explícitas. Relajar la
  comprobación de ownerId por sí solo expondría el estado presente al dueño viejo.
- El usuario confirmó que hoy no hay privilegios sobre animales ajenos para
  veterinarios/otros perfiles. Añadir futuros permisos como política explícita.

## Archivos y documentos

### Despliegue y almacenamiento

La captura de la consola de Lightsail muestra la instancia Ubuntu
`animal-record-server` en ejecución, en Virginia, zona A. El responsable
del proyecto administra AWS. La salida de Docker en la instancia muestra
tres contenedores activos.

| Contenedor | Imagen | Componente |
| --- | --- | --- |
| `ubuntu_app_1` | `ghcr.io/mccastrillon12/animalrecord:latest` | Backend AnimalRecord |
| `ubuntu_nginx-proxy-manager_1` | `jc21/nginx-proxy-manager:latest` | Nginx Proxy Manager |
| `ubuntu_watchtower_1` | `containrrr/watchtower` | Watchtower |

El [workflow de GitHub](../.github/workflows/deploy.yml) construye y
publica la imagen en GHCR al recibir cambios en `main`. Publica
`latest` para el despliegue y `sha-…` para identificar la revisión.
El 16 de noviembre, la inspección de `ubuntu_app_1` confirmó el commit
`dca8945df6c3e08d6c23d07b3e192cb16c481f59`. Corresponde al merge del PR #52.
La comparación en GitHub muestra el mismo árbol que `e3b3903`, la base de
la entrega de integración. Flutter apuntaba a `animalrecord.app` al
reportar un 503 en la creación de una solicitud.
[Commit desplegado](https://github.com/mccastrillon12/AnimalRecord/commit/dca8945df6c3e08d6c23d07b3e192cb16c481f59).

La inspección posterior del 16 de noviembre confirmó `0244baa`, merge
del PR #53, en ejecución desde las 16:05 de Colombia. El diagnóstico de
esa versión ubicó el 503 de creación en la consulta de colecciones.
[Revisión del PR #53](https://github.com/mccastrillon12/AnimalRecord/commit/0244baa27e82ea7d20d0af641b935c886b9bc96c).

La inspección anterior registró la imagen del merge del PR #51 (`98e434a`).

- Digest en GHCR
  `sha256:e390eb80045e94be5a7d2c4ce6d8d24c78c9dea11fc53f5461a50b75766618fc`.
- Identificador local de la imagen
  `sha256:83e19368c519d3396bb7ae68dc45e966bb81efbb6cc2539f6c70aded93b91531`.

La inspección del Watchtower activo confirmó `--interval=300` (cinco
minutos) y `--cleanup` (retira la imagen anterior después de actualizar).
El backend aparece sin etiquetas de exclusión, solo monitoreo o ámbito.
Según la selección predeterminada, puede recibir la actualización al
publicar otra imagen `latest`. El alcance completo de la selección y
el resultado de un ciclo de actualización quedan por verificar.
[Ajustes de Watchtower](https://containrrr.dev/watchtower/arguments/)
· [Selección de contenedores](https://containrrr.dev/watchtower/container-selection/).

La etiqueta `latest` puede apuntar a distintas revisiones con el tiempo.
Para identificar el commit desplegado, consultar la imagen del contenedor
en ejecución usando su identificador y la etiqueta de revisión de la
imagen. Los comandos solo muestran el identificador y la revisión.

```bash
image_id=$(sudo docker inspect --type container --format '{{.Image}}' ubuntu_app_1)
sudo docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id"
```

Las capturas de la consola de S3 confirman el bucket
`animal-record-profile-pictures`, la región `us-east-1`, el prefijo
`users/` y que el control de versiones y Object Lock están deshabilitados.
El nombre y la región coinciden con la configuración local. El backend
lee el nombre de `AWS_S3_BUCKET_NAME`.

La política visible `PublicReadGetObject` concede `s3:GetObject` a
`Principal: "*"` para todos los objetos del bucket. Esa regla concede
lectura pública y carece de permisos de carga, reemplazo o borrado. El
bloqueo de acceso público tiene las cuatro opciones desactivadas en el
bucket y en la cuenta, según las capturas. La regla puede permitir
descargas anónimas de fotos, adjuntos, documentos médicos y resultados
del análisis que estén en el bucket, sujeto a otros controles aplicables.
La revisión se basó en las capturas y el código, sin descargar objetos.
[Bloqueo de acceso público](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
· [Evaluación de permisos IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_evaluation-logic.html).

La captura de IAM muestra un usuario con `AdministratorAccess` y
`AmazonSNSFullAccess` adjuntas directamente, sin límite de permisos
definido. `AdministratorAccess` permite cargar, reemplazar, borrar y
administrar objetos y buckets S3, salvo restricciones aplicables.
`AmazonSNSFullAccess` cubre SNS y operaciones SMS a través de SNS. El
usuario tiene una clave activa y acceso a la consola sin MFA. El
administrador confirmó que el sufijo de esa clave coincide con el que
muestra `ubuntu_app_1` en Lightsail. El código desplegado usa la
configuración `AWS_ACCESS_KEY_ID` para S3 y Bedrock. El backend queda
identificado como escritor con permisos administrativos. Queda por
identificar qué otros usuarios, roles y servicios pueden escribir.
[AdministratorAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AdministratorAccess.html)
· [AmazonSNSFullAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AmazonSNSFullAccess.html).

El código del commit desplegado usa URLs directas para foto y diario y
comparte la configuración del bucket con documentos médicos. Antes de
modificar el acceso público, preparar y verificar la entrega autorizada
de fotos y adjuntos y la protección de documentos y resultados de
análisis. Preparar para el backend permisos acordes a las operaciones
que necesita. El ensayo de corte estable requiere destinos con
versionado activo.

Las rutas de S3 se forman al guardar cada objeto. La consola agrupa los
objetos por los prefijos de sus claves.

| Contenido | Ruta base |
| --- | --- |
| Foto de perfil del animal | `users/{ownerId}/animals/{animalId}/profile_…` |
| Adjuntos del diario | `users/{ownerId}/animals/{animalId}/diary/{entryId}/…` |
| Cargas temporales de foto y diario en la rama de desarrollo | `users/{ownerId}/animals/{animalId}/upload-intake/{uploadId}/source` |
| Documentos médicos aceptados | `users/{ownerId}/animals/{animalId}/medical-documents/{categorySlug}/{documentId}/…`, con `revisions/{replacementId}/` en reemplazos |
| Ingreso médico y resultados de Bedrock | `users/{ownerId}/medical-document-intake/{documentId}/`, con resultados bajo `analysis-output/` |

El código local apunta las salidas de Bedrock al bucket configurado para
los documentos. Los flujos con capacidad de modificar objetos que se
deben cotejar en AWS incluyen el backend, las cargas con URL firmada y
los trabajos de Bedrock. La política del bucket, los permisos IAM aplicables
y la configuración activa permiten confirmar sus identidades y destinos.

#### Activación del primer traspaso en Lightsail

El piloto usa el backend desplegado en Lightsail, Mongo y el bucket
`animal-record-profile-pictures` en `us-east-1`. El backend verifica cada
copia directamente. La configuración se hace una vez por ambiente.

El bloque 337 amplía este modo a los periodos sucesivos con predecesor
directo publicado, incluido el regreso al dueño inicial. Reutiliza el
bucket, las variables y el proceso de despliegue. La configuración
operativa y los estados HTTP conservan su contrato.

Recuperación operativa del 2026-11-19: un contenedor en `Restarting` puede
quedar fuera de Watchtower, que por defecto no incluye ese estado
(`--include-restarting=false`). En este caso se actualizó solo `app`
mediante `docker compose --compatibility pull app` y
`docker compose --compatibility up -d --no-deps app`, verificando antes la
revisión de imagen publicada. No se alteró el proxy ni la configuración
de Watchtower. El resultado de esta recuperación se registra en el plan.
[Argumento oficial](https://containrrr.dev/watchtower/arguments/#include-restarting).

1. En **S3 → Buckets → animal-record-profile-pictures → Propiedades**,
   habilitar **Control de versiones de buckets**. AWS indica esperar
   15 minutos antes de realizar PUT o DELETE tras la primera
   habilitación. En **Bloqueo de objetos**, habilitar **Object Lock**
   y dejar desactivada la **retención predeterminada**. Object Lock es
   irreversible e impide suspender el versionado. El backend aplica
   `COMPLIANCE` únicamente a las versiones copiadas para el traspaso.
   Elegir una fecha acordada que cubra el piloto. En modo `COMPLIANCE`
   las versiones retenidas tampoco se pueden eliminar durante una
   limpieza de datos antes de esa fecha.
   [Versionado](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html)
   · [Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html).

2. En **Permisos → Política de bucket**, guardar una copia de la política
   vigente y agregar este objeto al array `Statement`. Limita la lectura
   anónima solo en el histórico y las copias médicas del traspaso. Los
   enlaces firmados de la aplicación usan la identidad de AWS del backend.
   El prefijo histórico admite escrituras únicamente de la operación
   interna de transferencia y de la administración autorizada. Verificar
   que reglas de ciclo de vida, trabajos externos y otros escritores
   excluyan `ownership-archives` y las claves generadas del traspaso.

   ```json
   {
     "Sid": "DenyAnonymousTransferHistoryAndMedicalCopies",
     "Effect": "Deny",
     "Principal": "*",
     "Action": ["s3:GetObject", "s3:GetObjectVersion"],
     "Resource": [
       "arn:aws:s3:::animal-record-profile-pictures/users/*/animals/*/ownership-archives/*",
       "arn:aws:s3:::animal-record-profile-pictures/users/*/animals/*/medical-documents/*/transfer-generations/*"
     ],
     "Condition": { "StringEquals": { "aws:PrincipalAccount": "anonymous" } }
   }
   ```

   La identidad que ya usa el backend necesita `s3:GetObject`,
   `s3:GetObjectVersion`, `s3:PutObject`, `s3:PutObjectRetention` y
   `s3:GetObjectRetention` sobre los objetos aplicables. `s3:ListBucket`
   permite distinguir una clave ausente de una denegación en `HEAD`.
   Si hay SSE-KMS, conservar además los permisos de la clave que usa S3.
   El modo presupone que la aplicación controla las cargas y que el
   administrador excluye otros escritores de los destinos. La condición
   de la copia se envía desde el SDK. No agregar una regla de bucket que
   exija el encabezado de escritura condicional para esos prefijos,
   porque AWS documenta restricciones de esa regla sobre `CopyObject`.
   [Política IAM](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_condition-keys.html#condition-keys-principalaccount)
   · [Condiciones de escritura](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes-enforce.html).

3. Publicar la revisión mediante el workflow de imágenes de GitHub.
   Watchtower revisa la etiqueta cada 300 segundos según la inspección
   aportada. La primera activación requiere además agregar estas variables
   al bloque `environment` del servicio de la aplicación en el Compose de
   Lightsail. Sustituir los valores de ejemplo con los datos aprobados.
   Conservar las variables de AWS y Atlas vigentes y dejar ausente
   `TRANSFER_ACCEPTANCE_CONFIG_MODULE`.

   ```yaml
   TRANSFER_ACCEPTANCE_MODE: direct-s3
   TRANSFER_S3_BUCKET_OWNER: "<ID de 12 dígitos de la cuenta titular>"
   TRANSFER_S3_RETENTION_UNTIL: "<fecha UTC aprobada en formato YYYY-MM-DDTHH:mm:ss.000Z>"
   ```

4. Recrear solo la aplicación para aplicar el entorno. Desde el
   directorio del Compose activo, con la nueva imagen ya publicada
   y disponible, ejecutar estos comandos.

   ```bash
   service=$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' ubuntu_app_1)
   sudo docker compose pull "$service"
   sudo docker compose up -d --no-deps "$service"
   sudo docker compose logs --since 5m "$service" 2>&1 | grep -E 'transfer-acceptance-(mounted|disabled)|transfer-request-storage-(prepared|preparation-failed)'
   image_id=$(sudo docker inspect --format '{{.Image}}' ubuntu_app_1)
   sudo docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id"
   ```

   Si la instalación usa Compose V1, usar `sudo docker-compose` en
   lugar de `sudo docker compose`. Verificar la revisión publicada y
   `transfer-acceptance-mounted` antes de avisar a Flutter.

5. Flutter crea un animal que esté en su primer periodo, sube y confirma
   sus archivos y termina cualquier revisión médica antes de solicitar el
   traspaso. El destinatario acepta y espera `ACCEPTED`. Verificar que
   el destinatario pueda descargar y añadir documentos y que el dueño
   anterior conserve acceso de lectura al histórico a través de la API.
   Ante `PROCESSING` o 503 tras una decisión registrada, consultar el
   detalle y conservar la misma `Idempotency-Key` y el cuerpo original.
   Si el 503 indica que el inicio de la aceptación no pudo confirmarse,
   buscar `transfer-acceptance-start-unconfirmed` cerca de la hora del
   POST. El evento registra la fase y, cuando están disponibles, la
   colección y el código Mongo.
   El evento `transfer-s3-copy-response-unconfirmed` registra el estado
   de S3 cuando está disponible, con los identificadores de objetos y los
   datos de la solicitud excluidos.
   Una copia sin resultado verificable conserva la reserva. La ausencia
   de un objeto no justifica repetir el permiso emitido ni borrar claves.
   Las versiones antiguas con ID `null` quedan para el preparador
   existente. El modo directo admite el primer traspaso y sus sucesivos
   periodos con predecesor directo publicado.

#### Composición alternativa con acreditaciones externas

Este procedimiento corresponde a los bloques 323–330 y queda fuera del
piloto directo.

El arranque de Docker conserva `node dist/main`. El módulo
[`transfer-acceptance.cjs`](../scripts/transfer-acceptance.cjs) monta los
adaptadores de S3 y reutiliza la región, el bucket y las credenciales de
medios del backend, además de la conexión Mongo. La carga y descarga
actual opera sobre los archivos del dueño. El traspaso conserva una
versión exacta para el histórico y verifica las copias antes de cambiar
de dueño.

1. **Habilitar versionado y Object Lock.** El administrador autorizó
   ambos cambios en `animal-record-profile-pictures` (`us-east-1`).
   En **S3 → Buckets → animal-record-profile-pictures → Propiedades**,
   editar **Control de versiones de buckets**, elegir **Habilitar** y
   guardar. Reservar 15 minutos sin PUT ni DELETE después de la primera
   activación, según AWS. En la misma pestaña, editar **Bloqueo de
   objetos**, elegir **Habilitar**, aceptar la confirmación de permanencia
   y guardar. Dejar desactivada la retención predeterminada del bucket.
   Object Lock es irreversible e impide suspender el versionado.
   Verificar ambos estados en **Propiedades** o desde AWS CLI de solo
   lectura con el nombre y el titular confirmados.

   ```bash
   read -r -p 'Bucket autorizado: ' MEDIA_BUCKET
   read -r -p 'Región del bucket: ' MEDIA_REGION
   read -r -p 'ID de cuenta titular del bucket: ' MEDIA_BUCKET_OWNER
   aws s3api get-bucket-versioning --bucket "$MEDIA_BUCKET" --region "$MEDIA_REGION" --expected-bucket-owner "$MEDIA_BUCKET_OWNER"
   aws s3api get-object-lock-configuration --bucket "$MEDIA_BUCKET" --region "$MEDIA_REGION" --expected-bucket-owner "$MEDIA_BUCKET_OWNER"
   ```

   Las capturas previas a la autorización muestran ambas opciones
   deshabilitadas. Las versiones antiguas con ID `null` conservan ese
   ID y requieren preparación específica. La composición de S3 exige
   `media.complianceRetainUntil` con la fecha UTC aprobada. Cada copia
   nueva comprueba que esa fecha exceda el horizonte acreditado antes de
   declarar el intento. La identidad del backend requiere
   `s3:PutObjectRetention` para esos destinos.
   La composición aplica retención al origen con VersionId explícito
   después de verificar el manifiesto y antes del primer intento de copia.
   La identidad del backend requiere también `s3:GetObjectRetention` y
   `s3:PutObjectRetention` sobre las versiones de origen que se transfieren.
   Aplicar el [aislamiento y recolector](#aislamiento-y-eventos-de-s3)
   antes de activar la aceptación. Mantener los accesos usados por
   Flutter en los prefijos ordinarios.
   [Versionado](https://docs.aws.amazon.com/AmazonS3/latest/userguide/versioning-workflows.html)
   · [Configuración de Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock-configure.html).

   Para preparar fotos y adjuntos antiguos, mantener las reglas actuales
   de lectura y carga de Flutter en las rutas activas. Revisar los
   permisos de la identidad AWS del backend para los animales seleccionados,
   bajo `users/{ownerId}/animals/{animalId}/profile_*` y
   `users/{ownerId}/animals/{animalId}/diary/*`. El migrador usa
   `s3:GetObject`, `s3:GetObjectVersion`, `s3:PutObject`,
   `s3:PutObjectRetention` y `s3:GetObjectRetention`. Puede requerir
   permisos adicionales si hay SSE-KMS o etiquetas. Mantener desactivada la
   retención predeterminada. El trabajo fija la retención por copia.
   [Operación de copia S3](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html)
   · [Preparación de medios antiguos](./animal-media-legacy-migration.md#preparación-con-retención-para-transferencias).
2. **Reunir los archivos del módulo.** Colocar los archivos en
   `/opt/animalrecord/transfer` en Lightsail con permisos de lectura para
   el usuario del contenedor. Usar los valores del entorno validado.

   | Archivo | Contenido |
   | --- | --- |
   | `transfer-acceptance.cjs` | Copia del archivo versionado en `scripts/`. |
   | `settings.json` | `media` con `bucket`, `region`, `expectedBucketOwner`, `timeoutMs`, `complianceRetainUntil`; `notificationArchive` con `auditBucket`, `auditBucketOwner`, `region`, `notificationConfigurationId`, `maxBytes`; `evidenceArchive` con `bucket`, `bucketOwner`, `region`, `issuerId`, `maxBytes`; `coverage` con los campos de `evidenceArchive` más `controlsHash`; `custody` con `maxArtifactBytes`, `maxTotalBytes`, `maxArtifacts`, `maxOpenReaders`; y `historyDownloadTimeoutMs`. Las credenciales se leen del entorno del contenedor. |
   | `coverage-public.pem` | Clave pública Ed25519 del emisor autorizado del informe de corte. |
   | Autoridad | En `settings.json`, `authorityEndpoint: { url, timeoutMs, maxBytes }` conecta un emisor HTTPS de confianza. Configurar el secreto `TRANSFER_AUTHORITY_TOKEN` en el entorno del contenedor. La composición existente también admite `authority.cjs` cuando se usa un proveedor local. |

   El conector HTTPS envía un POST autenticado con
   `{ protocol: "INITIAL_TRANSFER_AUTHORITY_V1", operation, input }`.
   `input` contiene los argumentos posicionales del puerto. Las
   operaciones son `requiredThrough`, `source`, `historicalDestination`,
   `stagingDestination`, `finalDestination` y `readDestinationAccreditation`.
   El emisor responde `200 application/json` con `{ "result": ... }`
   o `204` si la evidencia aún no existe. Los reportes deben cubrir la
   versión y el intento concretos. El conector entrega las respuestas
   al protocolo de verificación existente; el emisor debe suministrar
   también perfiles activos y el informe de corte firmado en el
   archivo configurado. Conservar la clave privada en el emisor.
   El paquete real de la autoridad sigue pendiente de verificarse.
   [Requisitos del ensayo](./animal-transfer-stable-s3-cut.md#revisión-local-del-paquete-de-la-autoridad-bloque-278).

   Con el directorio ya montado y una imagen que incluya el bloque 325,
   se puede confirmar el bucket usando la identidad del backend.
   Requiere `s3:GetBucketVersioning` y
   `s3:GetBucketObjectLockConfiguration`. Solo lee propiedades del bucket
   y puede ejecutarse antes de activar el módulo u obtener los informes.

   ```bash
   sudo docker exec ubuntu_app_1 node /run/animalrecord/transfer-acceptance.cjs --check-media
   ```

   El resultado esperado es `versioningEnabled: true`,
   `objectLockEnabled: true` y `defaultRetentionConfigured: false`.
   Con los archivos del proveedor instalados, verificar también la
   composición antes de activar la variable. Este paso comprueba la carga
   local de la configuración.

   ```bash
   sudo docker exec ubuntu_app_1 node /run/animalrecord/transfer-acceptance.cjs --check-config
   ```

   El resultado esperado es `configurationLoaded: true`. Los informes
   operativos todavía se verifican durante cada traspaso.
3. **Montar y aplicar cuando estén validados.** Desde el directorio
   del proyecto Compose, aplicar el siguiente montaje al servicio del backend.

   ```yaml
   environment:
     TRANSFER_ACCEPTANCE_CONFIG_MODULE: /run/animalrecord/transfer-acceptance.cjs
   volumes:
     - /opt/animalrecord/transfer:/run/animalrecord:ro
   ```

   Una vez publicada en GHCR la imagen del merge a `main`, aplicar la
   configuración una vez. Verificar el nombre del servicio con la
   etiqueta del contenedor. Los siguientes despliegues pueden continuar
   mediante Watchtower.

   ```bash
   service=$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' ubuntu_app_1)
   test -n "$service" && sudo docker compose config --quiet &&
     sudo docker compose pull "$service" &&
     sudo docker compose up -d --no-deps --force-recreate "$service"
   sudo docker compose logs --since 5m "$service" 2>&1 | grep -E 'transfer-acceptance-(mounted|disabled)'
   ```

4. **Comprobar la transferencia.** Confirmar el commit activo. El evento
   `transfer-acceptance-mounted` confirma el montaje. Una solicitud nueva
   en el ensayo autorizado debe llegar a `ACCEPTED`, cambiar de dueño y
   conservar el histórico. La composición S3 vuelve a consultar los
   ítems iniciales en `PROCESSING` y avanza cuando llegan sus informes.
   El piloto con archivos nuevos se ejecuta desde Flutter sin el comando
   de migración por animal. Sin la variable, el backend registra
   `transfer-acceptance-disabled` y aceptar conserva el 409.

#### Aislamiento y eventos de S3

1. En **S3 → animal-record-profile-pictures → Permisos → Política de
   bucket → Editar**, agregar el siguiente objeto al arreglo
   `Statement` existente. Sustituir el marcador por el ARN IAM de la
   identidad que firma las descargas del backend. Conservar las reglas
   vigentes de las rutas ordinarias. La denegación prevalece sobre la
   lectura pública anterior para estos objetos y sus versiones.

   ```json
   {
     "Sid": "DenyDirectReadOfTransferObjects",
     "Effect": "Deny",
     "Principal": "*",
     "Action": ["s3:GetObject", "s3:GetObjectVersion"],
     "Resource": [
       "arn:aws:s3:::animal-record-profile-pictures/users/*/animals/*/ownership-archives/*",
       "arn:aws:s3:::animal-record-profile-pictures/users/*/animals/*/transfer-preparations/*",
       "arn:aws:s3:::animal-record-profile-pictures/users/*/animals/*/*/transfer-generations/*",
       "arn:aws:s3:::animal-record-profile-pictures/users/*/animals/*/profile_000*"
     ],
     "Condition": {
       "ArnNotEquals": { "aws:PrincipalArn": "ARN_IAM_BACKEND" }
     }
   }
   ```

   El ARN del rol es el de IAM, aunque la sesión se muestre como
   `assumed-role`. Antes de ampliar el piloto a foto o diario, verificar
   el acceso del destinatario por la descarga autorizada del backend.
   Una URL S3 directa de una generación queda bloqueada por esta regla.
   Comprobar con un archivo ficticio de cada ruta que el GET anónimo
   falla, incluido un GET por versión, y que el backend autorizado
   puede descargarlo. Consultar un objeto que exista y su ID de
   versión confirmado. Los dos comandos deben recibir 403.

   ```bash
   aws s3api head-object --bucket "$MEDIA_BUCKET" --key "$PROTECTED_KEY" --region "$MEDIA_REGION" --no-sign-request
   aws s3api head-object --bucket "$MEDIA_BUCKET" --key "$PROTECTED_KEY" --version-id "$PROTECTED_VERSION" --region "$MEDIA_REGION" --no-sign-request
   ```

   [Políticas con `aws:PrincipalArn`](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies_elements_principal.html).
2. Elegir el bucket privado y versionado **existente** para el archivo
   de notificaciones. El protocolo requiere que sea distinto al
   bucket de medios. La identidad de la Lambda necesita `s3:ListBucket`
   en ese bucket y `s3:GetObject` y `s3:PutObject` sobre
   `put-notifications/v1/*`. El backend necesita `s3:ListBucket` y
   lectura de ese prefijo, con escritura denegada. Conservar las
   identidades separadas en las políticas efectivas y mantener los
   informes del corte en un prefijo privado escrito por su emisor.
   En **Permisos → Política de bucket** del archivo privado, agregar
   la siguiente declaración al arreglo `Statement` existente y
   sustituir el nombre del bucket y el ARN del rol de la Lambda.

   ```json
   {
     "Sid": "OnlyTransferCollectorCanModifyNotificationArchive",
     "Effect": "Deny",
     "Principal": "*",
     "Action": ["s3:PutObject", "s3:DeleteObject", "s3:DeleteObjectVersion"],
     "Resource": "arn:aws:s3:::BUCKET_AUDITORIA/put-notifications/v1/*",
     "Condition": {
       "ArnNotEquals": { "aws:PrincipalArn": "ARN_IAM_ROL_LAMBDA" }
     }
   }
   ```

   La lectura del archivo requiere distinguir claves faltantes de
   accesos denegados. Si no hay un bucket existente autorizado, la
   instalación queda pendiente de esa decisión. [Permisos de lectura S3](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).
3. Generar el paquete desde el repositorio en PowerShell.

   ```powershell
   npm run build
   npm run build:transfer-put-collector
   Compress-Archive -Path dist/aws-lambda/transfer-put-collector/* -DestinationPath dist/transfer-put-collector.zip -Force
   ```

   En **Lambda**, crear una función dedicada en la región del bucket
   de medios y usar **Node.js 22.x** y el handler `index.handler`.
   En **Code → Upload from → .zip file** subir ese paquete. Asociar
   el rol autorizado del punto 2. En **Configuration → Environment
   variables**, configurar las siguientes entradas.

   | Variable | Valor |
   | --- | --- |
   | `SOURCE_BUCKET`, `SOURCE_BUCKET_OWNER`, `SOURCE_BUCKET_REGION` | Bucket de medios, cuenta titular y región. |
   | `AUDIT_BUCKET`, `AUDIT_BUCKET_OWNER`, `AUDIT_BUCKET_REGION` | Archivo privado de notificaciones, su titular y región. |
   | `AUDIT_MAX_BYTES` | Mismo valor que `notificationArchive.maxBytes`. |
   | `NOTIFICATION_CONFIGURATION_ID` | ID efectivo de la notificación del punto 4. |

4. En **Lambda → Add trigger → S3**, elegir el bucket de medios, el
   evento **PUT** (`s3:ObjectCreated:Put`) y el prefijo `users/`.
   Verificar la política de invocación de la función con
   `Principal: s3.amazonaws.com`, el ARN exacto del bucket como
   `SourceArn` y la cuenta titular como `SourceAccount`. Revisar
   también que identidades ordinarias y el backend estén excluidos de
   `lambda:InvokeFunction` sobre la función recolectora. Si hay
   una configuración de eventos solapada, revisar el enrutamiento
   existente antes de modificarlo. El handler archiva solo claves de
   transferencia. Obtener el ID desde CloudShell y copiarlo también
   a `notificationArchive.notificationConfigurationId`.

   ```bash
   aws s3api get-bucket-notification-configuration \
     --bucket "$MEDIA_BUCKET" --region "$MEDIA_REGION" \
     --expected-bucket-owner "$MEDIA_BUCKET_OWNER" \
     --query 'LambdaFunctionConfigurations[].{Id:Id,Function:LambdaFunctionArn,Events:Events}'
   ```

   Verificar una entrega de ensayo autorizada en la Lambda y la
   existencia de un objeto versionado bajo `put-notifications/v1/`
   del archivo. Un evento aislado no acredita un permiso de copia o
   el corte. Una vez verificados el aislamiento, la entrega y el emisor,
   montar el módulo y revisar `transfer-acceptance-mounted` como se
   describe arriba. [S3 y Lambda](https://docs.aws.amazon.com/lambda/latest/dg/with-s3.html) ·
   [Filtros de notificaciones](https://docs.aws.amazon.com/AmazonS3/latest/userguide/notification-how-to-filtering.html).

#### Compatibilidad con el backend desplegado

Comparación histórica de la versión anterior `98e434a` con la rama
de transferencias, desplegada después en el merge del PR #52.

| Flujo | Versión anterior `98e434a` | Código del PR #52 |
| --- | --- | --- |
| Avatar de usuario | `GET /users/me/profile-picture/upload-url` entrega un PUT firmado a S3. El `PATCH` de confirmación guarda la URL directa. | Conserva ese flujo y devuelve `profilePictureUrl`. Un cambio de acceso a todo el bucket también afecta a los avatares. |
| Foto del animal y adjuntos de diario | La app carga a S3 con un PUT firmado a la clave final. Confirma la foto con `PATCH` y el adjunto con `POST`. La ficha y el diario devuelven las referencias directas. | Mantiene los contratos de carga. La nueva carga va primero a `upload-intake/` y la confirmación comprueba y copia el archivo al destino final. El archivo final queda disponible después de confirmar. Las nuevas rutas de lectura autorizada son aditivas. |
| Documentos médicos | `POST /medical-documents/analyze` recibe el archivo por multipart. El backend escribe el original en S3 e inicia Bedrock. Tras aceptar la revisión se guarda una copia por animal. La descarga de documentos aceptados valida dueño y devuelve un GET firmado de cinco minutos. | Conserva el adaptador S3, el analizador Bedrock, las claves médicas y el generador de descargas. Las mutaciones médicas usan coordinación de escrituras. |

La revisión respalda el contrato que debe recibir el equipo de Flutter.
Para cambiar la política del bucket de producción quedan por comprobar
los avatares, fotos y adjuntos de la app y el comportamiento de las
cargas y descargas en un bucket privado de prueba. Las políticas que
protejan documentos aceptados y resultados de Bedrock deben conservar
el acceso requerido por el backend y Bedrock.

### Comportamiento de almacenamiento en la rama de desarrollo

El flujo vigente usa `AwsS3StorageService` para fotos/diario mediante URLs y
`AwsMedicalDocumentStorage` para documentos mediante claves/descargas firmadas.
`IStorageService.getFileKey` valida origen y ruta de URLs finales del bucket.
Confirmar foto/adjunto exige la ruta específica de su propietario y animal.

Bloque 285. Las rutas de descarga de foto y adjuntos reutilizan
`AnimalAccessPolicy` y firman la referencia guardada con
`AwsS3StorageService`. Diario comprueba además la entrada y el ID del
adjunto. El firmante usa un GET S3 temporal con caché privada y conserva
las referencias de las respuestas vigentes.
[Contrato Flutter](./frontend-animal-transfer-foundations.md#lectura-autorizada-de-fotos-y-adjuntos-bloque-285).

`AnimalMediaUploads` registra las emisiones nuevas en `animal_media_uploads`
antes de firmar, carga en `upload-intake` y confirma mediante copia condicional
sin sobrescribir final, con ETag/VersionId y SHA-256 fijados por CAS. Se guarda
referencia solo después de sellar/verificar. La copia incierta se reconcilia al
reintentar; PUT tardío solo afecta temporal, no final. No hay TTL/reciclaje ni
limpieza automática. Requiere índices únicos y mayoría antes de emitir URLs.
El JSON público se conserva, pero finalUrl ahora está disponible DESPUÉS de
confirmar: revisar preview local, errores 409/502 y latencia en Flutter.
Detalle: [animal-media-upload-isolation.md](./animal-media-upload-isolation.md).

El subbloque 6 añade `LegacyAnimalMediaMigration`, exportado por AnimalMediaModule,
sin controllers ni arranque automático. Trabajos `animal_media_migrations` reservan
el animal atómicamente con el mismo filtro drenado (namespace media-migration,
no una transferencia). Copian a claves nuevas con tickets/procedencia verificables;
por páginas actualizan solo URLs con CAS/checkpoint y un fence escrito en el
control, todo en transacción corta. Completar libera solo su reserva en esa
transacción. Fallar conserva trabajo/reserva; no borra originales ni limpia TTL.
Cambian URLs después de ejecutarlo: IDs/metadatos/fechas se conservan; adjuntos
pueden usar subruta sealed y confirmaciones retiradas dan 409 para refrescar.
No se ha ejecutado migración real. El subbloque 7 añade stopForRecovery explícito:
revisión/fase, auditoría e incremento del fence/liberación de su reserva en una
transacción; STOPPED no permite reanudar el mismo ID ni activa copias atrasadas.
La confirmación pública de una copia de migración exige que ya sea la referencia
actual leída por el caso de uso. Conserva compatibilidad de tickets anteriores
sin backfill, y bloquea activación indirecta de huérfanos preparados.
`AnimalWriteRecoveryInventory` se exporta desde AnimalMediaModule con lecturas
paginadas primario/mayoría de controles y trabajos asociados, sin escritura,
criterio de edad ni prueba de muerte de operaciones. No hay endpoint/job automático.
Retirar tokens generales y recuperar reservas de captura sigue pendiente.
Detalle: [animal-media-migration-recovery.md](./animal-media-migration-recovery.md).
Contrato y uso: [animal-media-legacy-migration.md](./animal-media-legacy-migration.md).

Bloque 327. `AnimalMediaModule` registra el mismo modelo
`medical_documents` para el alcance interno de preparación médica.
Reutiliza la reserva, tickets y promoción de la migración de medios.
El acceso de lectura sigue en el descargador médico vigente.
Detalle en [preparación médica](./animal-media-legacy-migration.md#documentos-médicos-aceptados).

Bloque 328. El comando de
[Lightsail](./animal-media-legacy-migration.md#ejecución-explícita-en-lightsail)
abre un contexto Nest independiente con `AnimalMediaModule` y la base
del contenedor. Usa los índices existentes y procesa una página por
ejecución. El servidor HTTP y sus seeders quedan fuera de ese contexto.

Las fotos se persisten antes de limpiar la anterior. Los borrados de archivos
actuales siguen activos: todavía no hay retención histórica implementada. Debe
adaptarse esto ANTES de habilitar transferencias para conservar la copia anterior.
No realizar movimientos masivos de prefijos ni asumir que la ruta concede acceso.

`OwnershipArchiveModule` añade `OwnershipArchivePreparer`, persistencia de
cabeceras/entradas/manifiesto y `AwsOwnershipArchiveStorage`. Prepara registros
inmutables por animal, diario y documento aceptado individual; copia a histórico
y staging del destinatario sin escribir el destino activo. Verifica bytes por
SHA-256 y fija revisiones S3; lotes/leases permiten reanudar. No tiene endpoints
ni se ejecuta al arrancar. `OwnershipArchiveCapture` y `MongoOwnershipArchiveSource`
añaden preflight de IA/legacy bajo reserva y captura por ID en páginas de 100,
con cursor persistido y checkpoint por revisión. Solo periodo inicial sin CLOSED;
no omiten antecedentes no implementados. Denegación previa a crear cabecera
libera solo su reserva; después conserva bloqueo y reintento. El subbloque 5
también recorre el diario en preflight y exige fotos/adjuntos registrados y
sellados; legacy se deniega sin migrarlo automáticamente. Verifica medio/hash
al construir manifiesto. El corte S3 completo sigue bloqueado por transición
legacy, efectos remotos no cubiertos e integración real. READY no publica archivo.
La limpieza de preparaciones y la incorporación de antecedentes retenidos siguen
pendientes. Detalle en [ownership-archive-preparation.md](./ownership-archive-preparation.md).
Captura, alcance y límites en [ownership-archive-capture.md](./ownership-archive-capture.md).

Leer `medical-document-strategy.md` y después `medical-document-ai.md`. Invariantes:

- Categoría de archivo (`finalCategory`) independiente del contenido aprobado
  (`validatedExtraction.documentType`) y de la detección de AWS.
- Una carga puede analizarse para varios animales; aceptación separa registros
  y archivos por animal, relacionados únicamente por `documentGroupId`.
- Reemplazar conserva `acceptedAt` y el límite de 48 h. Una transferencia tampoco
  reiniciará ese límite ni generará código nuevo para documentos heredados.
- Revisiones, borrados, consultas por ID/grupo y descargas requieren revisar sus
  permisos cuando cambie la propiedad; no basta cambiar Animal.ownerId.
- La IA pendiente impedirá aceptar el traspaso hasta terminar o descartar el
  proceso. Una solicitud de transferencia pendiente permitirá escrituras.
- Mongo y S3 no comparten transacción. Conservar compensación y reintentos.

## Usuarios, OTP y notificaciones

- Reutilizar `UserCodeSender`, Nodemailer y SNS del registro para entrega OTP;
  la autorización de transferencia debe tener propósito/consumo separado.
- El verificador de registro modifica estado de cuenta y genera tokens de login:
  no llamarlo como autorización de transferencia.
- Bloque 340: `TransferOtp` y `UserCodeSender` comparten la selección del contacto
  de transferencia: PHONE prefiere celular; EMAIL/GOOGLE/APPLE/MICROSOFT, correo;
  si falta, el otro contacto registrado. Sin ambos devuelve 409 antes de enviar.
  El contexto de transferencia usa SMTP/SNS existentes; registro/reset conservan
  su selección previa. No cambia métodos de login ni registra códigos.
- `toPrimitives()` de User incluye secretos para persistencia. UserController
  ahora usa `toUserResponse` con allowlist y conserva alias públicos de ubicación.
  La búsqueda de destinatarios tiene proyección Mongo y DTO propios.
- Seguimiento adicional al integrar auth: SocialCheck/SocialRegister todavía
  devuelven primitivas de usuario; revisar esa serialización sin alterar tokens
  ni contratos de login a ciegas. UserCodeSender también tiene un log heredado
  con el código SMS que debe retirarse al trabajar ese bloque.
- Firebase, tokens de dispositivo, campanita, outbox y worker aún no existen.
  El usuario confirmó que Flutter tampoco tiene push preparado.

## Infraestructura y pruebas

Docker instala con npm y ejecuta `dist/main`. El workflow publica imagen ante
push a main; no hay despliegue local/productivo realizado por este checkpoint.
No instalar dependencias con pnpm en este proyecto npm.

Los reemplazos médicos ya usan transacciones: producción y pruebas de integración
de transferencias necesitan Mongo con replica set/Atlas. Las nuevas pruebas HTTP
usan repositorios simulados y no demuestran escrituras/copias reales en AWS.

El barrido global encontró ocho suites heredadas fallando por imports, fixtures
y mocks antiguos de auth/user/animal. Mantener ese resultado separado de la
regresión médica y de los tests nuevos; detalles y comandos en el plan de entrega.

## Retomar el desarrollo

Bloque 56: NotificationModule registra controller/servicio/puerto de dispositivos.
GET/PUT/DELETE /notification-devices/{installationId}; Bearer + credencial local
de instalación, revisiones/operación idempotente para mutaciones. Modelo
notification_devices (_id=UUID) y notification_device_tokens (_id=hash de token)
en tx snapshot/primary/majority; rotación/cambio de cuenta/baja sin asignaciones
duplicadas o apropiación mediante UUID. Baja conserva tombstone/revisión pero
elimina token activo; no revoca login o envíos concedidos. Requiere dos colecciones
ordinarias existentes; no DDL/arranque o autoCreate/autoIndex/TTL. Índice de cuenta/
estado declarado, no instalado. Token select:false por defecto y respuesta con
allowlist sin secretos/cuenta ajena. Sin módulo FCM, SDK nuevo, worker, invalidación
real de token o envío. Auth no tiene logout HTTP; frontend debe invocar baja antes
de descartar Bearer. Contrato/riesgos de conciliación en guía frontend.

Bloque 55: NotificationModule aporta GET /notifications, GET /notifications/unread-count
y PATCH /notifications/{id}/read. Puerto/service en context/notification, adaptador
Mongo usa modelo/schema existente de avisos; alias TransferNotice conserva contrato
del escritor del 54. Filtro userId/tipos conocidos en cada query/update, primary/
majority y proyección explícita. Lectura atómica solo si readAt null/ausente;
si ya leído, devuelve la fecha sin reescribirla. Error incierto no se convierte en
éxito mediante consulta automática. Notificación ajena/inexistente: mismo 404.
Índice userId/readAt declarado, sin instalar/TTL/autoCreate/autoIndex o nuevas
colecciones. No guarda estados de solicitud, claims, OTP o outbox, ni envía push.
Contrato centralizado en guía frontend; evidencia actual en el plan.

Bloque 342. `NotificationModule` añade `GET /notifications/{id}` con la misma
proyección y alcance por usuario. Solicitudes y cierre de propiedad comparten
la composición de avisos por resultado. Solo la creación encola un envío y
solo para su receptor. La persistencia de push filtra por el protocolo
`TRANSFER_RECEIVED_V1` y vuelve a comprobar el evento al conceder envío.
El adaptador FCM, el corte de activación y el ejecutor siguen pendientes.

Bloque 54: TransferRequestsModule exporta servicio a AnimalTransferController,
importa TransferOtpModule y modelos Mongoose de solicitudes/ítems/exclusividad,
notificaciones/outbox/eventos y fuentes usuario/motivo/animal/control. _id string
respalda identidades deterministas y exclusividad por animal. Sin TTL/autoCreate/
autoIndex en los esquemas. Desde el bloque 317, MongoTransferRequests prepara
las seis colecciones ordinarias y sus siete índices secundarios al arrancar
el módulo, en la conexión de la aplicación. Reutiliza índices compatibles
y registra fallos de preparación sin impedir el arranque. El preflight de
metadatos y topología de POST sigue siendo de lectura.
OTP y negocio comparten sesión/tx snapshot/primary/majority; validaciones escriben
fence transferRequestRevision opcional sin default en fuentes, comprueban escrituras
efectivas y no usan transferLock/activeWrites como exclusividad de solicitud.
Proyecciones HTTP no exponen contadores, autorización/hash o expediente. POST
idempotente devuelve 201/200; GET lista/detalle paginados solo para participantes.
El detalle lee las fotos de los ítems visibles desde AnimalEntity y reutiliza
AwsS3StorageService para firmar las vistas previas después de cerrar la sesión.
La composición de aceptación publica su lector histórico como proveedor global.
AnimalController lo consume de forma opcional para añadir fichas transferidas
verificadas en `GET /animals` y `GET /animals/owner/{id}`. Cada ficha enlaza
el periodo publicado del dueño anterior. El estado saliente de los animales
actuales se obtiene con una consulta a los claims. La búsqueda para seleccionar
animales conserva su filtro por propietario.
No worker push/bandeja/decisiones, liberación de claims, propiedad/períodos o corte.
Contrato central en guía frontend; ensayo Mongo del flujo aún pendiente.

Bloque 53: AnimalTransferModule importa TransferOtpModule, con tres POST autenticados
de emisión/reenvío/verificación y servicio exportado para futuro consumo transaccional.
Depende de UserModule (repositorio + UserCodeSender), AuthModule, configuración,
hasher bcrypt y modelo animal_transfer_otp. Una fila por usuario mediante _id;
CAS/revisión, mayoría, cuotas/fechas y prueba opaca hasheada. Sin TTL/índices nuevos
declarados ni autoCreate/autoIndex; el primer CRUD puede crear la colección ordinaria.
No inicializador/backfill/arranque escritor nuevo. Consume exige sesión activa del
mismo cliente; solicitud y consumo conjunto aún sin caller operativo. Transporte
reutilizado con contexto opcional, mensajes previos conservados y sin logs de OTP.
Desde el bloque 340, todos los métodos de registro usan el contacto guardado para
el OTP de transferencia; la prueba sigue ligada al canal/contacto seleccionado.
Contratos frontend centralizados; estado/pruebas/límites en el plan de entrega.

Bloque 51: helper de provider con selección explícita CURRENT/PROMOTION_ROWS_V1,
fuera del grafo activo. El ensamblado usa cuatro modelos/conexión aportados,
comprueba binding/handles nativos e inspecciona requisitos antes de entregar puerto; no abre/init
modelos, instala índices o usa el aplicador. Falla sin cambiar de modo y revalida
binding antes de confirmar. Inspección no es fence/capacidad; configuración AWS
no crea clientes hasta una confirmación explícita. Contrato en
[verificación](./animal-media-promotion-verification.md); activación/ensayo pendientes.

Bloque 50: `AnimalMediaUploads` admite el puerto opcional
`AnimalMediaPromotionConfirmation`, implementado por `AwsMediaPromotionConfirmation`.
Contexto capturado antes de await, IDs backend por llamada, error con correlación
privada y sin fallback a promote/seal anteriores. Ticket ordinario no sellado usa
el ciclo solo si se aporta el puerto; migración/legacy/sellados conservan sus guardas.
No hay provider en AnimalMediaModule/AppModule ni activación/configuración ambiental:
el grafo activo sigue con la confirmación anterior. Pruebas de callers/Nest aislado,
SDK y persistencia simulada; requisitos operativos y ensayo del aplicador pendientes.
Contrato en [verificación](./animal-media-promotion-verification.md).

Bloque 49: operador explícito prepare/apply para adiciones de índices/colecciones
del manifiesto, con digest revisable, relectura entre pasos y errores inciertos
sin retry/rollback/remediación destructiva. Adaptador Mongo DDL fuera de providers,
HTTP y arranque; Db/entorno aprobados se aportan aparte. No se ejecuta desde el
inspector, factory o callers actuales. Proceso de despliegue/auditoría operativa
durable aún pendiente. Contrato/uso en [verificación](./animal-media-promotion-verification.md).

Bloque 47: manifiesto Mongo versionado (cuatro colecciones/14 índices) e inspector
explícito sobre un Db ya seleccionado: solo hello/listCollections/listIndexes,
sin provider/arranque/conexiones/DDL o consulta de datos. Informe SATISFIED/BLOCKED
de requisitos observados, sin snapshot/fence, transacciones probadas o activación.
No lo consumen la factoría o callers actuales. Ocho casos Mongo preparados (suite
confirmación ahora 30, sin ejecutar esta versión); alcance operativo y contrato en
[verificación](./animal-media-promotion-verification.md), resultados en el plan.

Bloque 44: `AwsMediaPromotionConfirmation` ensambla el ciclo con cliente lector
propio por operación y el dispatcher controlado. Configuración explícita,
una región, sin provider/import Nest. `HttpExceptionFilter` usa un mapper de
errores sanitizados del ciclo; los demás errores y éxitos conservan su contrato.
Los callers actuales no producen ese error ni usan la factoría. Requisitos de
índices y validación Mongo del ciclo siguen pendientes antes de conectarlos.

Bloque 43: `MediaPromotionConfirmation` compone los puertos de persistencia,
dispatcher y verificación/sellado para una confirmación ordinaria nueva. Abre y
declara desde ticket persistido, inspecciona destino y exige MATCH+sello aunque
send resuelva. El puerto/factoría de dispatch y su error terminal residen en
dominio; el dispatcher conserva la exportación anterior del mismo error.
Clase aislada, sin provider/import Nest o cambio en AnimalMediaUploads/callers:
configuración controlada, mapeo HTTP y conexión conjunta siguen pendientes.
Contrato/alcance en [verificación](./animal-media-promotion-verification.md);
estado y pruebas actuales únicamente en [plan](./final-delivery-plan.md).

Checkpoint 41: [arnés opt-in de sellado](./animal-media-promotion-seal-mongo-integration.md)
preparado y compilado, 23 escenarios NO ejecutados contra Mongo. Config/opt-in/
namespace propios, dos clientes y transporte HEAD/GET falso con SDK/lector/verificador
reales. Sin ampliar allowlists/transportes anteriores o modificar src. 50 guardas
sin conexión y regresión seleccionada 100/1725 aprobadas; los 49 resultados del 39
no se trasladan. Git inicial limpio, 17fe684 con referencia origin local ahead 1.
Siguiente: revisión/autorización del entorno concreto para 23+49 casos, luego
resultados/limpieza y ciclo completo/wiring/configuración/mapeo HTTP antes de callers.

Checkpoint 40: [MediaPromotionVerifier aislado](./animal-media-promotion-verification.md),
HEAD/GET condicionado/HEAD, stream/hash/metadata/revisión y puerto separado de
sellado. readForSeal observa snapshot; sealVerified cerca journal/control/puerta/
ticket capturado y escribe MATCH+sealed en la misma transacción, sin red dentro.
No provider/caller HTTP o cambios al flujo actual; permisos previos siguen inciertos.
85 casos nuevos con dobles, regresión 99/1675 aprobada. Sin Mongo/S3/AWS/Docker
reales; los 49 resultados del 39 son anteriores al método nuevo.
Siguiente: preparar extensión opt-in de Mongo y lector SDK/transporte falso con
guardas propias; ejecutar solo tras autorización específica nueva. Después ciclo
completo/wiring/mapeo HTTP antes de habilitar callers. No retención/corte/negocio.

Checkpoint 39, 2026-10-27/28: [ensayo local autorizado](./animal-media-promotion-dispatch-mongo-validation.md)
completado en Mongo 8.0.34, FCV 8.0, un miembro y dos clientes. 28/28 persistencia
(15.29 s) + 21/21 dispatcher con HTTP falso (14.38 s), primera pasada, sin cambios
de código/tests. 49 bases verificadas ausentes, contenedor retirado y 27018 libre;
Mongo preexistente de 27017 excluido. Solo documentación modificada. No autoriza
otro ensayo ni acredita AWS, fin remoto, retención o corte estable.
Siguiente: contrato/colaborador aislado de verificación del resultado y sellado,
con definición/ticket/observación y fallos concurrentes; mapeo de errores antes
de conectar callers. Transferencia deshabilitada e INCOMPLETE/NOT_ASSESSED.

Checkpoint 38: [arnés combinado](./animal-media-promotion-dispatch-mongo-integration.md)
preparado/compilado, 21 escenarios Mongo + dispatcher/SDK/Node handler reales y
transporte HTTP falso. Comando/opt-in/namespace propios; sockets solo al puerto
Mongo loopback elegido, sin ampliar allowlists. 57 pruebas nuevas sin conexión,
regresión seleccionada 97/1590 aprobada. No ejecutado contra Mongo; los 28 casos
de persistencia conservados. Sin cambios en src/callers/HTTP o dependencias.
Siguiente: revisar/autorizar el entorno concreto propuesto antes de ejecutar ambos
arneses y registrar versiones/resultados/limpieza. Verificación/sellado y mapeo de
errores antes de callers; no se infiere ACK/cierre remoto/corte o retención.

Checkpoint 37: [fence del ticket](./animal-media-promotion-ticket-fence.md) en
DECLARE_EFFECT/INTEND_ATTEMPT/AUTHORIZE_ATTEMPT, misma transacción que journal/
control/puerta/filas. Contador opcional sin default/backfill/índice y definición/hash
revalidados. Compite con seal vigente; permisos anteriores conservan incertidumbre
y evidencia tardía. Sin modificar callers/pin/seal o integrar el dispatcher.
39 pruebas nuevas y cuatro adicionales de dispatcher, regresión 96/1533 aprobada.
Arnés Mongo ampliado a 28 casos compilados, sin ejecutar esta revisión.
Siguiente: completar arnés Mongo + dispatcher/transporte falso y protocolo de
verificación/sellado antes de integrar callers. Ejecución real con autorización
específica; retención/cobertura/corte/commit de negocio siguen pendientes.
Los checkpoints siguientes conservan su alcance histórico.

Checkpoint 36: MediaPromotionCopyDispatcher aislado, sin provider/import Nest o
caller actual. Crea S3Client/NodeHttpHandler propios; una invocación por efecto
declarado sin intentos previos, validación request/definición y permiso nuevo por
delegación con puerto existente. UNKNOWN por resultado del handler; fallo local
terminal impide retry del SDK por persistencia. Probado sin sockets con adaptador
Mongo sobre store optimista simulado. No cambia el protocolo operativo actual.
Dos paquetes Smithy ya instalados se declaran directos, sin cambio de versión.
Siguiente: contrato/guardas de ticket/pin/sellado concurrente antes de integrar
callers. Detalle: [animal-media-promotion-dispatcher.md](./animal-media-promotion-dispatcher.md).

Checkpoint 35: 28 casos de transporte con SDK S3 real y handlers/peticiones
nativas falsos, cero sockets; retries, redirects, errores HTTP 200 y límites de
contadores comprobados. Probes de permisos/revocación solo sintéticos. Sin cambios
de src/runtime/dependencias o SDK actual. Wrapper del request handler candidato
para el siguiente bloque, con handler subyacente controlado, fuera de callers
hasta probar vínculo de efecto y ticket/sellado. Detalle:
[animal-media-promotion-transport.md](./animal-media-promotion-transport.md).

Checkpoint 34: coordinador admite opt-in explícito para confirmar foto/adjunto de
un animal; create declara MEDIA_PROMOTION_ROWS_V1, sin adopción de journals previos.
Entrega contexto inmutable tras adquisición/permiso reconocidos. Controllers lo
pasan por casos de uso/manager hasta AnimalMediaUploads.confirm, con validación
local de scope/tipo. Direct callers sin contexto siguen compatibles. Sin nuevo
provider/consulta/dispatch o integración de MediaPromotionPersistenceModule.
La marca no acredita cobertura de las rutas legacy/selladas ni envíos actuales.
Siguiente: verificar transporte por debajo de retries con handler falso antes de
instrumentación/dispatch. Contrato: [animal-media-confirmation-context.md](./animal-media-confirmation-context.md).

Checkpoint 33, 2026-10-27: validación autorizada de persistencia de promociones,
26/26 escenarios aprobados en MongoDB 8.0.34/replica set local de un miembro.
Primera pasada 25/26 por expectativa ConflictError frente a InvalidArgumentError
de la guarda al reintentar tras cierre; corregido solo el test y reforzado con
igualdad de estado. Sin cambios de producción/grafo. 52 bases de dos intentos y
contenedor eliminados. Siguiente: identidad a callers ordinarios y verificación
de cada envío físico/retry con transporte falso antes de dispatch. Detalle:
[animal-media-promotion-mongo-validation.md](./animal-media-promotion-mongo-validation.md).
Los checkpoints siguientes conservan su estado histórico.

Preparación posterior al checkpoint 32, base `9ca8456`: arnés revisado y
[procedimiento local](./animal-media-promotion-mongo-runbook.md) listo para autorizar.
Propone Docker temporal en 27018; mongod existente en 27017 queda excluido.
Compilación y 4 suites/95 guardas sin conexión aprobadas. Ningún caso Mongo de
promociones ejecutado; responsabilidades y grafo de módulos conservados.

Checkpoint 32: arnés dedicado de persistencia de promociones preparado sin conexión,
26 escenarios y dos clientes; opt-in/URI/configuración/namespace/allowlist propios.
Reutiliza soporte de aislamiento/drenaje/limpieza sin ampliar arneses anteriores.
Siembra journal opt-in desde create inicial y progresa por claim/permiso; nunca
retromarca MAY_RUN. Crea índices solo al ejecutar en su base temporal autorizada.
Sin cambios en src/runtime/HTTP/schemas de producción. Build, compilación, ESLint,
36 guardas nuevas y descubrimiento/rechazo sin opt-in correctos; regresión 92/1398.
Los 26 casos Mongo NO ejecutados; no acreditan cierre remoto o transferencia.
Siguiente: ejecución solo con autorización específica del replica set desechable,
registrando entorno/resultados/limpieza. Detalle:
[animal-media-promotion-mongo-integration.md](./animal-media-promotion-mongo-integration.md).

Checkpoint 31: MediaPromotionPersistenceModule explícito, fuera del grafo actual
de AppModule/AnimalMediaModule. Importa modelos de journal/control/tickets y exporta
puerto MediaPromotionPersistence con MongoMediaPromotionPersistence. Colección
de filas separadas GATE/EFFECT/ATTEMPT/RESPONSE/OBSERVATION, protocolo ROWS_V1,
hidratación estricta, registro único global de identidades e índices parciales
de recursos/ordinales. autoCreate/autoIndex false, sin índices/colección reales.
Apertura/intención/autorización compiten con cierre/token/reserva mediante fences
escritos en journal/control y CAS de puerta en la misma transacción. Revocación
previa a apertura crea tombstone; registros/evidencia posteriores no reabren.
Campos mediaPromotionRevision opcionales sin default; lectores previos conservan
sus proyecciones y recuperación. Callers/S3 actuales todavía no consultan la puerta.
Journal exige mediaPromotionProtocol=ROWS_V1 desde creación inicial; sin retrofit
de operaciones anteriores/MAY_RUN. Coordinador actual aún no emite la marca.
Sin dispatch ni nueva actividad al arrancar. Contrato y límites:
[animal-media-promotion-persistence.md](./animal-media-promotion-persistence.md).
Siguiente: preparar arnés Mongo opt-in aislado; guardas/compilación sin conexión,
ejecución real solo con autorización posterior. Luego enlace/instrumentación de
TODOS los envíos/retries y cobertura/retención antes del corte/commit conjunto.

Checkpoint 30: modelo puro MEDIA_PROMOTION_EFFECT_MODEL_V1 en animal-media/domain,
sin provider ni caller runtime. Scope de journal HTTP ordinario permitido;
identidades de efecto/intento/autorización y definición inmutable de bucket,
origen/revisión/digest/destino. Puerta OPEN→REVOKED con revisión CAS; respuestas y
observaciones append-only no eliminan riesgo de autorizaciones previas. Retries
de aplicación/SDK se modelan como intentos propios; no se instrumenta SDK/S3.
Persistencia/fence transaccional contra cierre del journal y enlace de identidad
coordinador→casos de uso→AnimalMediaUploads pendientes. No incluye el caller
LegacyAnimalMediaCopier que comparte adaptador, ni PUT/borrados/medicina/archivos.
Sin cambios de módulos, HTTP, schemas/índices o recuperación. Contrato y límites:
[animal-media-promotion-effects.md](./animal-media-promotion-effects.md).
Siguiente: persistir puerta/efectos/intentos/evidencia por separado y verificar
transacciones/CAS/acks inciertos sin dispatch; luego cubrir cada envío/retry real.

Checkpoint 29: lector AnimalWriteJournalInventory con puerto separado y adaptador
Mongo, exportado desde AnimalWriteJournalModule y reexportado por AnimalModule.
Lee journals por claims.animalId, abiertos/terminales de todas las versiones,
sin consultar controles o AWS. UUID/cursor por id, páginas 20/50 + lookahead,
primary/majority/collation simple/maxTimeMS 5000 y salida mínima solo del animal.
coverage INCOMPLETE/remoteEffects NOT_ASSESSED siempre; no permiso ni recuperación.
Sin consultas automáticas, schema/índices nuevos o cambio HTTP/CRUD/médico.
Build/lint correctos, regresión seleccionada 87 suites/1224 pruebas con mocks;
índice compuesto recomendado sin crear, planes/coste reales pendientes. Detalle:
[animal-write-journal-inventory.md](./animal-write-journal-inventory.md).
Siguiente: contrato y máquina de estados de intención/autorización por efecto de
promoción foto/diario; carreras de autorización/revocación/retries/respuesta perdida,
antes de integrar dispatch real. Corte/retención/commit operativo siguen pendientes.

Checkpoint 28: auditoría estática de escritores/efectos remotos, sin cambios de
runtime ni operaciones de infraestructura. Copias de histórico/staging condicionan
origen pero no destino; medicina tiene PUT/copias incondicionales, ventana de ARN
BDA y limpieza sin comprobar errores por objeto. Journal/lease/epoch/checkpoint
solo acreditan su alcance local; no detienen I/O ya enviado. Contrato de evidencia
por efecto/aislamiento/retención PROPUESTO, todavía sin implementar:
[animal-transfer-stable-s3-cut.md](./animal-transfer-stable-s3-cut.md).
Siguiente: lector interno paginado de journals por animal, incluidos terminales
sin tokens, sin permiso de recuperación/corte/commit. El inventario actual solo
parte de controles con claim/lock y enlaza migraciones; no cubre todos los efectos.

Checkpoint 27: primera ejecución autorizada del arnés lector + consumo sobre
e72ec8e, veinte casos REALES aprobados en MongoDB 8.0.34/replica set de un miembro,
sin cambios de código/pruebas. Confirmó que snapshot antiguo puede devolver
candidato/confirmar solo lecturas, pero consumo competidor/fences impiden commit
conjunto obsoleto. S3 e insert siguen sintéticos; sin propiedad/períodos/eventos.
Veinte bases y contenedor temporal eliminados/comprobados. Build/compilación del
arnés/diff aprobados; regresión ordinaria previa 85/1191 no repetida (solo docs).
Siguiente: auditar TODOS los escritores/efectos remotos y documentar evidencia
para corte estable S3 antes del commit de negocio; sin inferir fin por tiempo,
error, ausencia de tokens o HEAD observado. Detalle:
[ownership-archive-projection-mongo-validation.md](./ownership-archive-projection-mongo-validation.md).

Checkpoint 26: arnés Mongo del lector + consumo preparado, veinte escenarios,
comando test:integration:archive-projection y opt-in/URI propios. Reutiliza fixture/
prefijo/marker/lista cerrada de evidencia sin ampliar colecciones o suites viejas;
siembra común con datos de proyección y paginación. Compilación/guardas/descubrimiento
y rechazo sin opt-in aprobados; regresión 85 suites/1191 pruebas (19 guardas nuevas).
En ese bloque NO hubo ejecución real; primera ejecución posterior en el 27.
Sin permisos de traspaso/infraestructura automática. Detalle:
[ownership-archive-projection-mongo-integration.md](./ownership-archive-projection-mongo-integration.md).

Checkpoint 25: OwnershipArchiveProjectionRead es alias de la MISMA instancia
Mongo de revalidación/consumo. readRecipientProjectionWithinTransaction valida
sesión snapshot/primary/majority/mismo cliente, reserva/período/fences y selección
de observaciones terminales; lee el conjunto paginado y reconstruye digests para
compararlo con la corrida. Sin escrituras propias, consumo, S3 o llamador operativo.
En fallo intenta abortar la transacción validada completa sin sustituir la causa.
Un snapshot antiguo puede no ver competidores ya confirmados; el futuro consumo
CAS debe ir en la MISMA transacción antes de todas las escrituras de negocio.
Regresión 84 suites/1172 pruebas, 42 casos nuevos con dobles; sin Mongo/S3 real.
Arnés posterior preparado en checkpoint 26, primera ejecución autorizada en el 27.
Detalle:
[ownership-archive-projection-read.md](./ownership-archive-projection-read.md).

Checkpoint 24: función pura buildArchiveRecipientProjection, sin llamador/provider/
endpoint o I/O. Reconstruye planes y registros generacionales, verifica conjunto/
conteos/procedencia y clona payloads con referencias destinatarias. Antecedentes
conservan dueño/modo de solo lectura; código/clínica/acceptedAt/nameHistory intactos.
Hash local determinista, sin vigencia de control/período/S3 ni canCommit. No activa
o consume. Regresión 83 suites/1130 pruebas, 57 casos sintéticos nuevos; build,
lint y compilación del arnés aprobados. Sin infraestructura real en este bloque.
Lectura posterior implementada en el checkpoint 25, sin escrituras de negocio.
Detalle:
[ownership-archive-recipient-projection.md](./ownership-archive-recipient-projection.md).

Checkpoint 23: primera ejecución real autorizada del arnés de consumo: quince
pruebas aprobadas en MongoDB 8.0.34/replica set de un miembro. Primer intento
detectó objetos vacíos podados al persistir snapshots: schema de entradas ahora
usa minimize=false, conserva payload/contentHash sin relajar guardas. No repara
datos antiguos ni cambia schemas/HTTP médicos activos. Dos pruebas nuevas sin
conexión; regresión 82 suites/1073. Treinta bases sintéticas y contenedor temporal
eliminados/comprobados. No S3 real, transferencia o commit de negocio.
La proyección pura posterior está implementada en el checkpoint 24; todavía sin
lectura integrada, escrituras activas o publicación.
Detalle: [ownership-archive-evidence-mongo-validation.md](./ownership-archive-evidence-mongo-validation.md).

Checkpoint 22: arnés de consumo Mongo OPT-IN preparado y compilado, con quince
casos y dos clientes, escritura conjunta sintética/carreras/rollback. Comando,
opt-in/URI, prefijo/allowlist propios; no amplía el alcance del arnés del journal.
Build, guardas sin conexión, descubrimiento y rechazo sin opt-in aprobados;
regresión 81 suites/1071 pruebas. En el checkpoint 22 NO hubo ejecución Mongo;
primera ejecución posterior registrada en el checkpoint 23. No aceptación habilitada.
Detalle: [ownership-archive-evidence-mongo-integration.md](./ownership-archive-evidence-mongo-integration.md).

Checkpoint 21: OwnershipArchiveEvidenceConsumption es alias del repositorio de
metadatos; consumeWithinTransaction usa sesión YA activa del futuro llamador con
snapshot/primary/majority y mismo cliente, sin transacción propia o callbacks/S3.
Nuevas corridas fijan pins de preparación/planes. Consumo compite por control y
marca cabecera/corrida juntos, cerrando mutadores/replays de ese archivo. Recibo
provisional, no canCommit/traspaso; confirmación/replay de negocio siguen fuera
del bloque. Error de guarda intenta abortar; commit perdido no permite reconsumir.
Campos opcionales sin defaults/backfill/índices/TTL. Corridas previas sin pin no
se consumen. Sin runtime HTTP/médico cambiado, endpoints o infraestructura real.
Arnés preparado en checkpoint 22, ejecución autorizada limitada registrada en el 23.
Propiedad/publicación/corte S3 pendientes.
Detalle: [ownership-archive-evidence-consumption.md](./ownership-archive-evidence-consumption.md).

Checkpoint 20: reservation ARCHIVE_RESERVATION_V1 inmutable en NUEVAS cabeceras,
ligada al epoch adquirido y al hash original mediante allowlist de definición.
begin exige el tercer argumento al ejecutar; Capture pasa el adquirido en preflight.
Crear cabecera/fence son transaccionales; todos los mutadores de preparación/
captura/copia/antecedentes/planes/materialización/registro/observación exigen la
reserva ORIGINAL bajo transacciones cortas y el mismo control. Contador opcional
archivePreparationRevision sin default/backfill/índice/TTL nuevo. Cabeceras previas
sin vínculo no se reanudan/adoptan; hashes/manifiestos/rutas originales intactos.
Sin S3 dentro de transacciones, activación o garantía de fin remoto. Mismos HTTP
y guardas iniciales. Consumo único añadido en el checkpoint 21 dentro de futura
transacción conjunta, sin convertir evidencia observada en permiso de publicación.
Detalle: [ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).

Checkpoint 19 (2026-10-26): reservationEpoch opcional incrementado atómicamente
en los cinco mutadores actuales de reserva: adquirir/liberar propiedad e inicio/
finalización/detención de migración. CAS del epoch observado/adquirido y registro
en nuevos trabajos/corridas; metadatos/S3 lo ligan y rechazan ABA aun con mismo
ID/hora. Legacy sin campo no se confunde con cero ni se retroadapta. Corridas
anteriores sin epoch no se reanudan. Sin default/backfill/índice/TTL nuevos,
HTTP/médico sin cambios. No es epoch universal de escritores, fin S3 o permiso.
El checkpoint 20 añade identidad persistida en NUEVAS cabeceras y sus mutadores,
sin adoptar cabeceras previas o refijar hashes. Guarda inicial/transferencia
deshabilitada intactas. Sin ejecución real. Detalle:
[animal-reservation-epoch.md](./animal-reservation-epoch.md).

Checkpoint 18: OwnershipArchiveS3Observer inicia s3Observation opcional en una
corrida METADATA_OBSERVED vigente. Páginas ordenadas HEAD actual/GET fijado/HEAD
actual comprueban revisión, identidad, tamaño y SHA-256 sin escribir S3. Checkpoint
relee página/registros y compite por corrida/control en otra transacción corta;
no hay transacción abierta durante lecturas remotas. S3_OBSERVED no es corte
estable, actualidad futura, autorización o publicación. Sin endpoints/autostart,
colecciones/índices/TTL nuevos o ejecución real. Guardas intactas. Identidad
monotónica/invalidez ABA añadida en el checkpoint 19, antes del consumo/commit;
no inferir fin remoto desde ese epoch.
Detalle: [ownership-archive-s3-observation.md](./ownership-archive-s3-observation.md).

Checkpoint 17: OwnershipArchiveMetadataRevalidator inicia corridas explícitas
ARCHIVE_METADATA_REVALIDATION_V1 y recorre ENTRIES/FILES por páginas. Reconstruye
snapshots/planes, verifica manifiesto/registros PREPARED y cobertura/conteos, con
digests, cursor y fence en transacciones cortas. Nueva colección
animal_archive_metadata_revalidations, id único e índice (archiveId,id), sin TTL.
Incrementa/fija archiveMaterializationRevision del control: operaciones posteriores
de materialización/registro/otra corrida invalidan la anterior; no se refija.
METADATA_OBSERVED solo describe metadatos del archivo preparado, no S3/expediente
activo actual, corte estable o permiso de commit. No epoch universal de escritores
ni consumo/publicación. Guarda inicial y guardas de medios permanecen intactas.
Modelo/índices declarados, sin ejecución real; contrato central frontend actualizado.
La extensión S3 de solo lectura se implementa en el checkpoint 18, sin recrear/copiar.
Detalle: [ownership-archive-metadata-revalidation.md](./ownership-archive-metadata-revalidation.md).

Checkpoint 16: OwnershipArchiveMediaRegistrar.registerFile registra evidencia
inmutable por archivo generacional MATERIALIZED/VERIFIED en la colección separada
animal_transferred_media. PREPARED no es ticket ordinario, publicación o permiso;
las guardas de generación siguen denegando confirmación/migración/captura incluso
con registro. MongoOwnershipArchiveMediaRegistration inserta bajo snapshot/
primary/majority y el MISMO archiveMaterializationRevision del control, validando
período ACTIVE/reserva/versión/sin escritores. Reintento compara toda la constancia,
sin reemplazar ni reciclar identidades; no lee S3 ni certifica el manifiesto entero.
Índices únicos id/key/(archiveId,fileId) declarados, sin TTL ni ejecución real.
El modelo Mongoose puede exigir crear colección/índices según autoCreate/autoIndex.
Sin cambios del runtime HTTP/médico ni activación/cierre de períodos. Siguiente:
revalidación final paginada ligada al manifiesto y al futuro commit, aún sin publicar.
Detalle: [ownership-archive-media-registration.md](./ownership-archive-media-registration.md).

Checkpoint 15: modo interno explícito ARCHIVE_MATERIALIZATION_GENERATIONAL_V1
elegido antes de emitir materialización. Preserva planes/intenciones V1 y falla
si se intenta convertirlos; copia junto al destino antiguo mediante un mapeo
determinista, sin sondear/sobrescribir ni adoptar otros objetos. El resolvedor
de evidencia devuelve el destino efectivo verificado, no plannedFinalKey.
AnimalMediaUploads y LegacyAnimalMediaCopier reservan/bloquean estas rutas en
emisión, confirmación, inspección/captura y migración: no aprovechar fallback
legacy para activar copias. Sin registro transferido/publicación todavía.
Foto conserva sintaxis numérica; documentos/diario conservan jerarquía/nombre.
Contrato y 409/compatibilidad centralizados en frontend-animal-transfer-foundations.
No campos/índices nuevos; pruebas simuladas, sin activación ni operación real.
Detalle: [ownership-archive-generations.md](./ownership-archive-generations.md).

Checkpoint 14: OwnershipArchiveMaterializer/MongoOwnershipArchiveMaterialization
y AwsOwnershipArchiveMaterializationStorage materializan finales desde staging,
con intenciones fijas, leases técnicos, fence transaccional y copias condicionales
sin sobrescritura. Reconciliación solo de identidad/digest propios; colisiones
de retorno se rechazan, no se resuelven adoptando objetos ni eligiendo otra ruta.
Metadata opcional en cabecera/manifiesto/control sin índices nuevos. MATERIALIZED
no activa ni publica/cambia dueño/cierra períodos. Sin ejecución real; pruebas
con dobles. Selección generacional para nuevas materializaciones añadida en
checkpoint 15; las intenciones V1 existentes no se convierten. Luego registro
de medios y commit conjunto/captura posterior.
[ownership-archive-materialization.md](./ownership-archive-materialization.md).

Checkpoint 13: OwnershipArchiveReferencePlanner y su adaptador Mongo preparan
planes por entrada, separados del payload y del hash original. Metadata opcional
referencePlan en cabecera/entradas; fence opcional archiveReferencePlanRevision
en control. Página y cursor transaccionales con mayoría, validación de bindings,
revisiones/procedencia y conteos/cobertura final. Sin S3 ni writes de negocio,
cierre de períodos o permisos. PLANNED no significa activado/publicado. Siguiente
dependencia: materializar finales sin sobrescritura/reconciliar incertidumbre,
luego commit conjunto y captura posterior. Detalle en
[ownership-archive-reference-plan.md](./ownership-archive-reference-plan.md).

Checkpoint 12: `OwnershipArchiveModule` exporta `OwnershipArchiveHistoryImporter`
y registra `MongoOwnershipArchiveHistory`. Importación explícita paginada a una
preparación manual desde predecesor READY vinculado a período CLOSED y al ACTIVE
destino; READY solo no autoriza. Procedencia raíz/inmediata, RETAINED_RECORD y
referencias históricas verificadas; checkpoint transaccional y sellado con conteos.
Copias retenidas comprueban digest anterior y no escriben destinos finales.
Sin endpoints, activación, cierre de períodos o ejecución real. Campos opcionales
sin backfill/índices nuevos. Sigue la guarda inicial de captura automática; falta
integrar captura posterior y referencias activadas antes de levantarla. Pruebas
sintéticas A→B→C/devolución, no transferencia integral. Detalle:
[ownership-archive-history.md](./ownership-archive-history.md).

1. Leer plan y estrategia, comprobar rama/diff y respetar cambios existentes.
2. Consultar los callers y permisos del módulo afectado, no solo su controller.
3. Completar un bloque verificable y registrar qué sigue sin implementar.
4. Actualizar Swagger, contrato Flutter y pruebas de éxito/denegación relevantes.
5. Siguiente bloque: revisar/autorizar entorno del arnés 41, ya preparado/compilado,
   para ejecutar 23 nuevos + 49 de regresión y registrar resultados/limpieza.
   Sin trasladar permisos anteriores; luego ciclo completo/wiring/mapeo de errores
   antes de conectar callers.
   Los 28+21 casos del arnés combinado anterior ya se ejecutaron
   con autorización en el 39; otro ensayo real requiere permiso específico nuevo.
   Fence de ticket (37), dispatcher aislado (36) y ensayos SDK
   (35) probados con dobles, no dispatch desplegado. Reintentos de aplicación,
   legacy/sellados y fallos inciertos requieren tratamiento explícito, sin adopción.
   Enlace de identidad del 34 no es permiso de envío.
   Validación Mongo autorizada cerrada en el 33; futuras ejecuciones reales
   requieren autorización específica. Modelo puro (30), puerta/CAS,
   filas/índices declarados y fence con journal/control (31) ya existen.
   El lector interno por animal ya existe (29), con terminales sin tokens y errores
   sin falso vacío; no acredita cierre remoto o cobertura completa del expediente.
   Auditoría/matriz de escritores y contrato propuesto de corte S3 ya documentados
   en subbloque 28; falta implementar evidencia por efecto/aislamiento/retención.
   No inferir fin remoto por tiempo/error/token ausente/HEAD. Sin operaciones AWS,
   limpieza, recuperación o publicación autorizadas por este inventario.
   No activar/escribir negocio real ni tratar una lectura como fence adquirido.
   Guarda/arnés y primera validación local de consumo ya existen; no el commit
   conjunto completo ni corte estable S3. Nuevos ensayos reales requieren autorización.
   No adoptar cabeceras anteriores ni refijar hashes: el vínculo original y las
   guardas contra ABA ya existen para cabeceras nuevas/mutadores actualizados.
   No tomar METADATA_OBSERVED/S3_OBSERVED como permiso de commit: no son corte
   estable ni epoch universal de escritores o prueba de fin remoto. La observación
   S3 de solo lectura ya está implementada; no usar materialize para verificar,
   adoptar otra revisión, reparar o activar.
   No convertir preparaciones V1 atascadas ni aflojar guardas para avanzar.
   Después integrar commit conjunto/referencias/períodos/eventos/captura
   posterior. Mantener la guarda inicial hasta garantizar expediente completo;
   no confundir las cadenas sintéticas del importador con aceptación habilitada.
   Validaciones locales de journal y consumo registradas por separado (11/23),
   ambas limitadas a un nodo y protocolos concretos. Ensayos multinodo,
   failover/red y S3 siguen pendientes. Arnés y límites en
   [animal-write-mongo-integration.md](./animal-write-mongo-integration.md).
   El fence y la
   recuperación previa al permiso ya están implementados con pruebas simuladas;
   autorización del llamador operativo e integración real siguen pendientes.
   No retirar tokens legacy o de
   callbacks posibles (MAY_RUN) sin otro protocolo de evidencia/efectos remotos.
   Identidad/journal ya implementado, sin TTL ni prueba de muerte por antigüedad.
   Detención técnica de migración ya implementada,
   sin ejecución real; integración/autorización operativa pendientes de rollout.
   Incorporar antecedentes retenidos con procedencia explícita;
   luego activación, permisos y conservación
   histórica/limpieza. No habilitar aceptación hasta contar con esas garantías.
