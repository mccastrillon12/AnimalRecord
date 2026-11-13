# Antecedentes retenidos: importador interno

Subbloque 12 sobre `0c2a1ea`, 2026-10-25. Implementación interna y pruebas
sintéticas; no ejecución sobre Mongo/S3, cierre de períodos, publicación,
activación de referencias ni transferencia de negocio. Complementa
[captura](./ownership-archive-capture.md) y
[preparación](./ownership-archive-preparation.md).

## Disponible y objetivo todavía pendiente

### Lectura interna del período publicado (bloque 180)

`readPublishedOwnershipHistory` autoriza por actor y período cerrado.
En un snapshot coteja el vínculo al archivo, el ítem aceptado, el recibo
de propiedad, el marcador de publicación, la acreditación y el manifiesto
consumidos. Lee páginas del expediente archivado y reconstruye cada entrada
leída con el mismo criterio de captura. El cursor liga el hash de publicación
al último ID. La ficha, el diario y los documentos omiten las referencias
activas de almacenamiento y devuelven identificadores internos de archivo.
El contenido del expediente permanece disponible después de la ventana
original de corte.

`readPublishedHistoryFileVersion` exige el mismo período y publicación y
comprueba que el archivo esté ligado a la entrada solicitada. Reutiliza la
reconciliación del PUT histórico y coteja el sello, manifiesto, puerta,
predecesor y versión exactos. El selector privado incluye bucket, propietario,
clave, revisión y digest. Se exige generación activa y evidencia de
conservación que cubra el horizonte pedido; la expiración deniega la resolución.
El lector queda fuera del grafo HTTP y el importador manual conserva su protocolo.

### Descarga privada de una versión histórica (bloque 181)

`PublishedOwnershipHistoryDownloader` calcula un horizonte con el presupuesto
de tiempo del backend y resuelve la versión para el actor y período. El adaptador
S3 usa el bucket y propietario configurados, `VersionId` e `IfMatch`, y exige la
respuesta completa con la revisión y longitud acreditadas. El GET empieza
después del snapshot Mongo. [GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html)

La descarga fluye por el backend como adjunto privado sin caché. Se corta al
vencer el presupuesto o desconectarse el consumidor, y se cierra la lectura
ante fallo. El verificador compartido comprueba tamaño y SHA-256. Retiene el
último byte hasta verificar el cuerpo completo. El horizonte acota la entrega
en curso y no cambia la retención del archivo ni concede otra descarga.
La composición es explícita y queda fuera de HTTP.

### Renovación de conservación por versión publicada (bloque 182)

El lector interno reconstruye el alcance de renovación desde el período,
el recibo y la observación original. Incluye el archivo y su definición,
el propietario del bucket, la clave, la revisión y el SHA-256. La consulta
del alcance sigue disponible cuando vence la ventana original.

El registro obtiene el reporte de un productor interno mediante una consulta
local síncrona y coteja su hash y alcance. Usa la fila
`PUBLISHED_HISTORY_CONSERVATION` en `animal_transfer_copy_records`, una por
publicación y archivo. Cerca la generación activa del nuevo reporte y
compara el hash previo para reemplazar la renovación solo si extiende la
ventana. Una repetición exacta vigente conserva la fecha registrada.
Se preservan el recibo, la acreditación del corte y la observación original.

La descarga comprueba la generación y la ventana de la renovación cuando
existe, y usa la evidencia original cuando la fila está ausente. Una
renovación vencida, alterada o invalidada deniega la descarga. El productor
operativo, la extensión real de conservación y los antecedentes de períodos
posteriores siguen pendientes.

### Vínculo del predecesor publicado (bloque 183)

`startFromPublished` admite una preparación manual bajo la reserva
del período activo y exige el hash exacto del recibo publicado del
predecesor inmediato. Con el lector compuesto explícitamente, la
transacción de inicio coteja período cerrado, recibo, manifiesto
del expediente y apertura del período destino, y fija en `history`
el hash de publicación, la definición y los conteos. La relectura
repite el cotejo con el mismo origen.

El expediente publicado puede seguir en `COPYING`, pues su publicación
queda acreditada por el recibo. La importación por páginas y el copiador
anteriores se deniegan para este vínculo. Falta preparar las páginas con
versiones conservadas y el protocolo de copia correspondiente. La captura
automática conserva la guarda del período inicial.

### Preparación paginada desde el predecesor publicado (bloque 184)

`importBatchFromPublished` reutiliza el importador manual y exige el
lector de versiones compuesto explícitamente. Por cada vínculo coteja la
entrada y el archivo del recibo original y resuelve la versión histórica con
conservación vigente para el horizonte solicitado. Persiste antecedentes
de solo lectura y archivos destino `PENDING` con publicación de origen,
bucket, propietario esperado, revisión y digest. Los archivos compartidos
mantienen una identidad por versión, incluso al repetir la página.

El checkpoint acumula el digest de entradas del manifiesto. Al completar
revalida el predecesor y coteja ambos digests y los conteos persistidos.
La importación solo prepara metadatos. El copiador anterior sigue bloqueado
para estos destinos y falta el protocolo de copia versionada y su enlace a
la captura de períodos posteriores.

### Admisión local de copia versionada (bloque 185)

`preparePublishedCopy` exige un destino manual sellado, antecedentes
completos, el epoch de la reserva original y el hash exacto del archivo.
En la misma transacción coteja el predecesor, la entrada que vincula
el archivo y la revisión publicada. Cerca la reserva y la generación
de conservación que cubre el horizonte pedido, incluida una renovación.

La intención `PUBLISHED_HISTORY_COPY_INTENT_V1` fija publicación, bucket,
propietario esperado, clave, revisión, SHA-256 y clave histórica de destino.
Un replay exacto vuelve a comprobar el horizonte y conserva la intención
original. El resultado es `NOT_AUTHORIZED`. El archivo sigue `PENDING`
y el copiador anterior queda excluido. Faltan la protección de destino,
el permiso por intento y la reconciliación del efecto versionado.

### Declaración del intento histórico versionado (bloque 186)

`previewPublishedCopyAttempt` reconstruye el primer intento desde la intención
persistida bajo la reserva y la conservación del origen. El intento fija el
GET con versión, ETag, tamaño y SHA-256 y un PUT al destino histórico del mismo
bucket con `If-None-Match: *`, checksum y caché privada. Conserva la
representación acreditada del original.

`declarePublishedCopyAttempt` exige una acreditación independiente para ese
request, con creación condicional, protección contra borrado y recreación,
cobertura de escritores y continuidad. Cerca la generación de destino y
comprueba su ventana en la misma transacción de la reserva y la conservación.
Persiste un solo `INTENDED` por archivo. La repetición exacta revalida las
guardas y conserva la declaración. El resultado sigue `NOT_AUTHORIZED`.
Quedan pendientes la custodia de bytes, el permiso por intento, el envío y
la reconciliación.

### Custodia del intento histórico versionado (bloque 187)

`PublishedHistoryPutArtifacts` reutiliza el lector versionado, el
verificador de tamaño y SHA-256 y la custodia acotada en memoria.
La relectura exige los hashes exactos de intención, intento, acreditación,
protección y controles. Reconstruye el intento y comprueba reserva,
conservación y ventana de destino antes y después de sellar o abrir.
El GET queda fuera de las transacciones Mongo.

El sello liga la generación privada de custodia, el selector del GET,
la observación original de versión y la protección del intento.
Abrir la generación exacta reutiliza los bytes sellados. Un fallo
previo al sellado descarta el borrador y un fallo de apertura cierra
el lector. El sello conserva `NOT_AUTHORIZED`. Sigue pendiente
consumirlo al registrar `MAY_RUN` con el lector abierto.

### Permiso único del intento histórico versionado (bloque 188)

`recordInitialPublishedCopyPermission` relee la declaración exacta y
cerca la reserva y las generaciones vigentes de conservación y protección.
Exige un colaborador local síncrono que confirme el lector abierto y el
request de transporte preparado. Reconstruye el sello y comprueba el
instante de admisión contra el horizonte de origen y la ventana de destino.

El CAS del archivo guarda una sola marca `MAY_RUN` con el sello, el hash
de transporte y las referencias de evidencia. Solo un nuevo registro
confirmado devuelve `recorded: true`. La observación verifica la marca
por la misma selección y devuelve `NOT_AUTHORIZED`, incluso sin reserva
vigente o custodia abierta. Hallar la marca o perder la respuesta mantiene
incierto el efecto. El dispatcher y la reconciliación siguen pendientes.

### Delegación única y retorno local del PUT histórico (bloque 189)

`PublishedHistoryPutDispatcher` abre la custodia exacta y prepara el
transporte fuera de Mongo. Solo ofrece evidencia al registrador para esa
selección mientras sostiene el lector. Comprueba el recibo nuevo, los
hashes de intento, sello, transporte y generaciones, y las ventanas
antes de delegar el cuerpo una vez. Cierra el lector al terminar.

`recordPublishedCopyTransportObservation` registra `RETURNED` o `THREW`
por CAS con mayoría bajo el permiso exacto. La repetición idéntica
devuelve el mismo registro y la consulta del permiso lo incluye.
Ambos retornos conservan `UNKNOWN`. Una respuesta de commit perdida
deja `MAY_RUN` para reconciliación, con el reenvío bloqueado.
Quedan pendientes la composición operativa del transporte y la
reconciliación de la versión escrita.

### Reconciliación de la versión histórica escrita (bloque 190)

`PublishedHistoryPutReconciler` reconstruye el destino exacto desde el
intento y `MAY_RUN`. Un productor independiente debe acreditar que la
revisión procede de ese permiso y que su conservación cubre el horizonte.
El reconciliador lee el `VersionId` acreditado y verifica tamaño y SHA-256
fuera de Mongo. Puede avanzar aunque falte el retorno local del transporte.

El registro cerca los controles de conservación y guarda una única
constancia versionada en el archivo mediante CAS sobre el permiso.
La repetición con el mismo informe y horizonte devuelve la primera
constancia. El archivo sigue `PENDING` y el permiso conserva `MAY_RUN`.
Falta usar esta revisión como origen protegido de staging.

### Preparación de staging desde el histórico reconciliado (bloque 191)

`preparePublishedCopyStaging` coteja la intención histórica, el permiso
y el hash de observación de la versión escrita. Bajo la reserva original
del expediente sellado, cerca los controles de conservación de esa
versión y comprueba el horizonte solicitado.

La intención `PUBLISHED_HISTORY_STAGING_INTENT_V1` fija el selector
histórico con `VersionId`, ETag, tamaño y SHA-256, y el destino de
staging con creación condicional. La repetición exacta revalida la
conservación y mantiene la intención. El archivo sigue `PENDING` y
el resultado conserva `NOT_AUTHORIZED`. Falta declarar y proteger
el intento físico de staging.

### Declaración del PUT de staging de antecedentes (bloque 192)

`previewPublishedStagingAttempt` reconstruye el primer intento desde
la intención persistida. Fija la lectura de la versión histórica exacta
y el PUT a la clave de staging con `If-None-Match: *`, longitud, checksum,
representación histórica y caché privada. Cada tramo tiene su instancia.

`declarePublishedStagingAttempt` exige la acreditación independiente
del request de staging. Reutiliza el cotejo de creación condicional,
borrado, cobertura de escritores y continuidad. La reserva, la
conservación del origen y la protección de destino se cercan en la
misma transacción. Se comprueban ambas ventanas y se guarda un único
`INTENDED` por archivo. La repetición exacta conserva la declaración
y devuelve `NOT_AUTHORIZED`. Quedan pendientes la custodia, el permiso,
el envío y la reconciliación de staging.

### Custodia y permiso único de staging de antecedentes (bloque 193)

`PublishedHistoryStagingPutArtifacts` reutiliza la custodia acotada en
memoria y verifica tamaño y SHA-256 mediante el GET versionado fuera de
Mongo. El sello liga la generación, el intento de staging, la observación
histórica y la protección del destino. Sellar o abrir exige la declaración
vigente antes y después de cada operación.

`recordInitialPublishedStagingPermission` cerca la reserva original
y los controles vigentes de origen y destino. Exige confirmación local
del lector abierto y del transporte exacto, y registra una única marca
`MAY_RUN` por CAS. La consulta reconstruye el permiso bajo su selección
original, incluso tras vencer la ventana, y devuelve `NOT_AUTHORIZED`.
Quedan pendientes el dispatcher y la reconciliación de staging.

### Envío y reconciliación de staging de antecedentes (bloque 194)

`PublishedHistoryStagingPutDispatcher` abre la custodia exacta y delega el
cuerpo una vez tras reconocer un permiso nuevo y comprobar las ventanas.
El registro por mayoría liga el retorno local `RETURNED` o `THREW` al permiso
exacto y conserva `UNKNOWN`. La consulta y el replay permiten recuperar el
registro para reconciliar. Una marca existente bloquea otro envío.

`PublishedHistoryStagingPutReconciler` exige un informe independiente de
procedencia y conservación para la versión escrita bajo ese permiso. Lee
el `VersionId` exacto y verifica tamaño y SHA-256 fuera de Mongo. La constancia
se registra una vez bajo CAS con la generación activa de conservación y puede
recuperarse con el mismo informe y horizonte. El retorno local puede faltar.
El archivo sigue `PENDING`. Falta preparar el destino final desde esta versión.

### Intención y declaración del PUT final de antecedentes (bloque 195)

`preparePublishedCopyFinal` fija la versión exacta de staging, el permiso,
la observación y el horizonte de conservación. Reutiliza la clave generacional
del destinatario y cerca la reserva original y la generación de conservación.

`previewPublishedFinalAttempt` reconstruye el primer GET versionado y PUT
condicional con la representación de staging. `declarePublishedFinalAttempt`
exige una acreditación independiente del destino final ligada al request exacto.
Cerca los controles de origen y destino en la transacción, comprueba ambas
ventanas y guarda un solo `INTENDED`. La repetición exacta revalida los
controles y conserva la declaración. El archivo sigue `PENDING` y el resultado
conserva `NOT_AUTHORIZED`. Quedan pendientes custodia, permiso, envío y
reconciliación final.

### Custodia y permiso único del PUT final de antecedentes (bloque 196)

`PublishedHistoryFinalPutArtifacts` reutiliza la custodia en memoria.
Comprueba la declaración y las ventanas antes y después de sellar o abrir.
El GET versionado y la verificación de tamaño y SHA-256 ocurren fuera de
Mongo. El sello liga la generación de custodia, el intento final, la
observación de staging y la protección del destino.

`recordInitialPublishedFinalPermission` cerca la reserva original y las
generaciones de conservación y protección en la transacción. Exige evidencia
local del lector abierto y del transporte exacto y registra un único
`MAY_RUN` por CAS. `observePublishedFinalPermission` reconstruye la marca
bajo su selección y hora de admisión originales y devuelve `NOT_AUTHORIZED`.
El archivo sigue `PENDING`. Quedan pendientes el envío y la reconciliación final.

### Envío y reconciliación del PUT final de antecedentes (bloque 197)

`PublishedHistoryFinalPutDispatcher` delega una sola vez con la custodia abierta,
el transporte exacto y el permiso recién reconocido dentro de las ventanas.
El retorno local `RETURNED` o `THREW` se registra por mayoría bajo el permiso
exacto y conserva `UNKNOWN`. La consulta de una marca previa conserva
`NOT_AUTHORIZED`.

`PublishedHistoryFinalPutReconciler` exige evidencia independiente de procedencia
y conservación de la versión final. Verifica tamaño y SHA-256 mediante el
`VersionId` acreditado fuera de Mongo, incluso si falta el retorno local. La
constancia se registra por CAS con la generación activa de conservación y se
recupera con el mismo informe y horizonte. El archivo sigue `PENDING`.
Quedan pendientes la cobertura del conjunto y su consumo transaccional.

### Cobertura de versiones finales de antecedentes (bloque 198)

`PublishedHistoryFinalCoverageObserver` recorre los archivos retenidos
por ID del archivo predecesor. Cada snapshot de solo lectura coteja
la cabecera sellada, la reserva original, el recibo y el manifiesto
del predecesor inmediato. Reconstruye las selecciones desde permisos
persistidos, verifica la cadena hasta la versión final y comprueba
la generación de conservación y el horizonte pedidos.

La página vacía terminal comprueba los conteos sellados. El observador
exige orden estricto y coteja el conteo y el digest de definiciones
con el manifiesto publicado. Su constancia liga los hashes de cada
versión final, conserva `OBSERVED_ONLY` y `NOT_AUTHORIZED` y abarca
únicamente antecedentes. El consumo debe revalidar las versiones y
controles en la transacción que escriba las referencias.

### Registro de referencias finales de antecedentes (bloque 199)

`registerPublishedFinalMedia` recibe las identidades del expediente,
reserva, publicación, manifiesto y archivo, el hash de observación final
y el horizonte. En el mismo snapshot reconstruye la cadena de permisos
y versiones, coteja el archivo predecesor y cerca la reserva original y
la generación de conservación de la versión final.

La referencia `PREPARED` y `RETAINED_READ_ONLY` se guarda en
`animal_transferred_media` con la clave generacional, la revisión exacta,
la procedencia y los hashes de evidencia. La repetición vuelve a revalidar
y conserva el registro idéntico. Una identidad ocupada por otro registro
produce conflicto. El alcance es un archivo por transacción y queda fuera
de HTTP. La cobertura de registros y la proyección siguen pendientes.

### Cobertura de referencias y entradas retenidas (bloque 200)

`observePrepared` reutiliza la cobertura de versiones finales y reconstruye
cada registro `PREPARED` para compararlo íntegramente en el snapshot de su
página. La página terminal coteja también el conteo de referencias retenidas,
incluidos sobrantes y expedientes sin archivos.

Un segundo recorrido coteja cada entrada retenida con el contenido y la
procedencia del predecesor inmediato. Comprueba que cada ruta conserve su
vínculo al archivo retenido correspondiente. El conteo y el digest de entradas
de origen deben coincidir con el manifiesto sellado. La constancia liga los
digests de versiones, registros y entradas, con `OBSERVED_ONLY` y
`NOT_AUTHORIZED`. Los snapshots son por página. La proyección y el consumo
transaccional siguen pendientes.

### Proyección interna de antecedentes (bloque 201)

`PublishedHistoryRecipientProjectionReader` coteja el hash esperado de
cobertura y reconstruye el candidato en memoria con los registros
`PREPARED` y las entradas verificadas en sus snapshots por página.
Reutiliza los codecs y rutas permitidas de la proyección destinataria
para fijar las claves generacionales. Conserva los datos de origen y el
modo `RETAINED_READ_ONLY`. Rechaza referencias faltantes o sobrantes.

El hash de proyección liga el expediente, la reserva, el predecesor
publicado, la cobertura y el resultado. Conserva `OBSERVED_ONLY` y
`NOT_AUTHORIZED`. Queda pendiente reconstruir y revalidar el candidato
en la transacción que consuma su evidencia. La guarda de captura inicial
sigue vigente.

### Revalidación transaccional de la proyección de antecedentes (bloque 202)

`prepareSelection` fija los hashes de cobertura y proyección. El adaptador
Mongo reconstruye ambas en la transacción snapshot/primary/majority del
llamador. Reutiliza los recorridos de archivos y entradas en esa sesión y
cerca la reserva original y las generaciones activas de conservación de las
versiones finales. Verifica la vigencia antes de devolver el candidato.

Un fallo aborta la transacción original si sigue activa. El llamador
conserva el commit. El resultado conserva `NOT_AUTHORIZED`. Quedan pendientes
la acreditación de corte que incluya antecedentes y su consumo con las
escrituras de negocio.

### Alcance local del corte de antecedentes (bloque 203)

`fencePublishedStableCutScopeWithinTransaction` reconstruye la proyección
seleccionada en la sesión del llamador. Por archivo coteja las versiones
histórica y final y verifica sus horizontes. Liga las revisiones exactas,
las generaciones y los permisos `MAY_RUN` de los tramos histórico, staging
y final mediante digests en el orden del manifiesto predecesor.

El alcance liga la reserva, la publicación, el manifiesto, la cobertura
y la proyección. La transacción cerca las generaciones de ambas versiones.
Conserva `NOT_ASSESSED` y `NOT_AUTHORIZED`. Quedan pendientes la acreditación
independiente del alcance, el corte conjunto y el consumo con las escrituras
de negocio.

### Cotejo de la acreditación del corte de antecedentes (bloque 204)

El observador obtiene un informe de un productor independiente fuera de Mongo.
El cotejo exige el protocolo de antecedentes, el hash exacto del alcance y del
informe, cobertura de escritores y efectos de copia, conservación de versiones
cuando hay archivos y vigencia para todo el horizonte solicitado.

`matchPublishedStableCutAccreditationWithinTransaction` reconstruye el alcance
en la sesión del llamador y coteja el informe obtenido previamente. Cerca su
generación de controles junto con la reserva y la conservación de versiones.
Comprueba la vigencia al retorno y conserva `NOT_ASSESSED` y `NOT_AUTHORIZED`.
Quedan pendientes el registro durable del informe, el productor operativo y
el consumo con las escrituras de negocio.

### Registro durable de la acreditación de antecedentes (bloque 205)

El registro persiste una fila inmutable en `animal_transfer_copy_records`
con identidad por alcance e informe. Usa los índices existentes. El alta
obtiene el informe de un colaborador explícito. La repetición conserva la
fila y la fecha originales y la relectura exige que exista la fila.

Ambas operaciones reconstruyen el alcance y el registro en la sesión
snapshot/primary/majority del llamador. Cotejan hashes, vigencia y
generaciones activas, con fences de reserva, conservación y acreditación.
Conservan `NOT_AUTHORIZED`. Quedan pendientes el productor operativo y el
consumo único con las escrituras de negocio.

### Consumo transaccional de la acreditación de antecedentes (bloque 206)

`consumePublishedStableCutWithinTransaction` exige el informe persistido y
reconstruye la proyección y el alcance con los fences originales. El CAS de
cabecera registra `PUBLISHED_HISTORY_STABLE_CUT_CONSUMPTION_V1` en
`evidenceConsumption`, que comparte la exclusión por expediente con los
otros protocolos de consumo.

El escritor interno recibe la proyección, el marcador provisional y la misma
sesión. Al retorno se cotejan la transacción, los hashes y la vigencia. Si falla
el escritor o una comprobación, se aborta la transacción original activa.
El llamador conserva el commit. Quedan pendientes el escritor concreto,
su resultado durable y la integración con el commit de propiedad.

### Guardado de referencias y recibo de antecedentes (bloque 207)

`writePublishedRetainedReferencesWithinTransaction` guarda en cada entrada
retenida las rutas y los registros exactos de sus archivos finales. Conserva
el contenido original y liga los vínculos al consumo de la acreditación.
Las actualizaciones comparan la identidad, el contenido y la procedencia
de cada entrada. Un conflicto aborta los vínculos, el marcador y el recibo.

El recibo en la cabecera fija el conteo y el digest de vínculos. Se puede
consultar desde primario con mayoría por la selección exacta después de
una respuesta incierta. Una lectura vacía deja el resultado sin confirmar.
Quedan pendientes el cambio de propietario y la publicación del expediente.

### Vínculo del recibo de antecedentes con la publicación (bloque 208)

`writePublishedRetainedReferencesWithOwnershipWithinTransaction` escribe
los vínculos y el recibo y llama al escritor de propiedad en la misma sesión.
Exige que su resultado coincida con el hash de commit de la cabecera,
el período anterior cerrado, el nuevo período activo y el control bajo
el dueño y versión nuevos. Coteja la fecha efectiva con el horizonte.

La cabecera liga el recibo y el consumo al hash del commit y al nuevo
período. Una discrepancia aborta el conjunto. Quedan pendientes el escritor
concreto del período posterior y la lectura publicada de esos antecedentes.

### Relectura del vínculo de publicación y escritura de períodos (bloque 209)

`readPublishedRetainedReferencesPublication` consulta la cabecera desde
primario con mayoría. Exige la selección original, el consumo, el recibo
y el hash exacto del cambio de dueño. Comprueba los hashes y que la fecha
efectiva esté en la ventana de la evidencia original. Una lectura vacía
deja el resultado sin confirmar.

La rotación de períodos y la liberación de la reserva exacta se comparten
en `writeOwnershipPeriodsAndControl`, utilizada por el cierre inicial.
La admisión de aceptación y la captura siguen exigiendo el período inicial.
Para conectar el cierre posterior falta acreditar la decisión y el
expediente completo, incluidos los recursos vigentes del remitente.

### Cotejo del expediente completo en un período posterior (bloque 210)

`admitLaterPeriodDossierWithinTransaction` exige una decisión registrada,
el ítem `PROCESSING`, su claim y su reserva original. Trabaja sobre una
cabecera manual sellada con antecedentes completos. En la misma sesión
cerca la decisión y la reserva y reconstruye el alcance de antecedentes.

Relee ficha, diario y documentos aceptados con el lector de recursos
vigentes. Coteja el contenido, las referencias y las definiciones de
archivos y exige que ambos conjuntos cubran los conteos sellados.
Devuelve los digests vigentes y el vínculo con el alcance de antecedentes
con `NOT_AUTHORIZED`. Falta acreditar las copias vigentes, componer el
corte conjunto y conectar el inicio interno y el escritor posterior.
La guarda del período inicial sigue vigente.

### Alcance conjunto de recursos vigentes y antecedentes (bloque 211)

`readLaterPeriodStableCutScopeWithinTransaction` recompone el expediente
admitido y coteja, por archivo vigente, el informe independiente ligado a
su definición, revisión original y reserva. Exige versiones exactas de la
copia histórica y final, claves esperadas, mismo digest de bytes,
procedencia, evidencia de efectos y conservación para todo el horizonte.
Cerca las generaciones activas en la transacción original.

La proyección interna reutiliza las reglas de rutas vigentes. El alcance
liga sus hashes y los digests de archivos y entradas con la decisión y
el alcance de antecedentes. Conserva `NOT_ASSESSED` y `NOT_AUTHORIZED`.
El colaborador de evidencia es explícito. Quedan pendientes el productor
operativo, la acreditación del conjunto y el cambio de dueño posterior.

### Acreditación del expediente conjunto (bloque 212)

El cotejo del informe independiente exige el alcance exacto, cobertura de
escritores y efectos de copia y vigencia para el horizonte completo. Exige
evidencia de conservación de archivos vigentes y de antecedentes según los
conteos comprobados de cada conjunto.

`laterPeriodStableCutAccreditationWithinTransaction` reconstruye ambos
conjuntos, cerca los controles del informe y usa una fila inmutable de
`animal_transfer_copy_records`. Una repetición conserva la fila y su
fecha. La relectura exige esa fila y verifica su vigencia. El resultado
conserva `NOT_AUTHORIZED`. Falta consumir el informe junto con las
escrituras de negocio.

### Consumo del informe conjunto (bloque 213)

`consumeLaterPeriodStableCutWithinTransaction` reconstruye la acreditación
conjunta persistida y exige la acreditación de antecedentes del mismo alcance.
El consumo de antecedentes reclama la cabecera. Un marcador adicional liga
el informe conjunto, la proyección vigente y el recibo de antecedentes a ese
mismo consumo.

En la sesión del llamador se vuelven a comprobar los recursos vigentes y se
aplican los cambios de ficha, diario y documentos con el escritor existente.
La función interna de cierre debe usar la misma fecha efectiva y completar
el cambio de períodos y el vínculo de publicación. Los hashes, la vigencia
y la sesión se cotejan al retorno. Un fallo aborta el conjunto.
Quedan pendientes el escritor concreto de cierre, su recibo y la admisión
interna de la decisión posterior.

### Cierre interno de propiedad posterior (bloque 214)

`commitLaterPeriodItemOwnershipWithinTransaction` usa la decisión ya
registrada y las acreditaciones del expediente para guardar el cambio de
dueño junto con las referencias vigentes y de antecedentes. Comparte la
escritura de períodos, control, estado de la solicitud, claim, auditoría
y avisos con el cierre inicial. Guarda un comprobante propio ligado al
consumo conjunto y al recibo de antecedentes.

La relectura por selección exacta comprueba ambos consumos y el vínculo
de publicación. Devuelve el comprobante existente en una repetición.
Quedan pendientes el inicio interno posterior, los productores de
evidencia y el acceso publicado. Se conserva la guarda inicial y la
aceptación pública sigue deshabilitada.

### Inicio interno con antecedentes publicados (bloque 215)

`startWithPublishedHistory` registra la decisión, adquiere la reserva y crea
la cabecera manual en una sola transacción. El lector existente comprueba el
período cerrado inmediato, su comprobante publicado y su manifiesto. La cabecera
inicia `IMPORTING` y la decisión fija el archivo y el hash de publicación por
ítem. El cotejo y la relectura del cierre comprueban ese vínculo. Una repetición
exacta devuelve el comprobante original sin volver a reservar.

La entrada explícita admite el período abierto por el primer traspaso publicado.
Una decisión mixta también admite ítems iniciales con su captura habitual.
Las claves de medios heredadas requieren un registro persistido ligado al
expediente publicado del predecesor para comprobar su procedencia local. La entrada
original y sus comprobantes conservan su formato. Quedan pendientes la
preparación coordinada del expediente, los productores de evidencia operativa y
el acceso publicado posterior. La aceptación pública sigue deshabilitada.

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
activación y referencias heredadas con una captura posterior completa. El cierre
del bloque 179 puede producir el vínculo de período que comprueba el bloque 183.
Las cadenas A→B→C/devolución se prueban con archivos sintéticos,
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

Las referencias `fileBindings` se remapean al manifiesto destino. La importación
anterior usa `verified.historical` y la nueva resuelve la revisión por el recibo
publicado. Ambas leen el selector histórico, con independencia de la URL activa
guardada en el payload. Se comprueban identidad/hash del registro y
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
