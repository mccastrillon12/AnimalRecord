# Intención y autorización de promociones de foto/diario

Actualización 40: [verificación y seal técnicos aislados](./animal-media-promotion-verification.md)
ligan bytes/revisión y MATCH+sello en la misma transacción, sin modificar el modelo
puro o descargar permisos. Puede verificar un final existente sin atribución a un
intento; puerta previamente revocada no cancela evidencia/sellado con claim actual.
Guardas con dobles, sin callers o acreditación de cierre remoto/retención/corte.

Actualización 39: [49 casos aprobados en ensayo local autorizado](./animal-media-promotion-dispatch-mongo-validation.md),
28 de persistencia y 21 de dispatcher con HTTP falso, sin cambiar modelo/tests.
Primera pasada, 49 bases ausentes y contenedor retirado. Permisos previos conservan
incertidumbre; no se demuestra fin remoto, retención o corte estable. Modelo y
callers sin integración nueva; siguiente verificación/sellado aislados.

Actualización 38: [21 casos Mongo + dispatcher preparados](./animal-media-promotion-dispatch-mongo-integration.md)
con transporte nativo falso, permisos separados por retry y evidencia UNKNOWN.
Compilados sin ejecutar Mongo; modelo puro y callers sin cambios. El arnés y sus
57 guardas no acreditan copia remota, fin de permisos previos o cobertura global.

Actualización subbloque 37: [CAS sobre ticket ordinario](./animal-media-promotion-ticket-fence.md)
al declarar/intentar/autorizar, con definición/hash revalidados en la transacción.
Un sello ganador impide permisos nuevos; permisos anteriores conservan posibilidad
de envío tardío. Modelo puro sin cambios, sin adopción o prueba de cierre remoto.
Pruebas con dobles; carrera Mongo preparada/compilada, sin ejecutarla aquí.

Actualización subbloque 36: [dispatcher de un efecto](./animal-media-promotion-dispatcher.md)
ya implementado de forma aislada; sin caller operativo. INITIAL/SDK_RETRY obtienen
intención/permiso propios por envío; no adopta intentos anteriores/APPLICATION_RETRY.
UNKNOWN por resultado del handler, sin descargar permisos. No corte estable.

Actualización subbloque 35: [28 ensayos de transporte SDK sin red](./animal-media-promotion-transport.md)
observan retries/redirecciones debajo de send y muestran límites de maxAttempts/
metadata; wrapper del request handler elegido como punto candidato, con handler
subyacente controlado. Probes sintéticos sin puerto durable/dispatch conectado.

Actualización subbloque 34: [contexto interno de confirmación](./animal-media-confirmation-context.md)
ya enlaza coordinador/callers/AnimalMediaUploads, con opt-in inicial y validación
local. No conecta persistencia/dispatch ni acredita cobertura de envíos actuales.
Las descripciones siguientes conservan el estado histórico de sus bloques.

Actualización subbloque 33: persistencia validada en Mongo real, con 26 casos
aprobados en un replica set local de un miembro; [resultados y limpieza](./animal-media-promotion-mongo-validation.md).
Modelo, callers y SDK sin cambios. No acredita cobertura de envíos físicos o
cierre remoto; el texto histórico siguiente conserva el alcance de cada bloque.

Subbloque 30 sobre `4909732`, 2026-10-26. Contrato registrado antes del código.
Alcance inmediato: modelo puro y pruebas de protocolo. Persistencia, dispatch y
ledger remoto completo NO implementados. No modifica reglas funcionales aprobadas.

Actualización subbloque 31: ya existe [persistencia interna separada](./animal-media-promotion-persistence.md)
con CAS/fences y tombstone antes de apertura, probada con dobles. El módulo sigue
fuera del grafo de arranque; sin dispatch, ledger completo o validación Mongo real.
El texto de modelo/propuestas del subbloque 30 conserva su alcance histórico.

Actualización subbloque 32: [arnés Mongo aislado](./animal-media-promotion-mongo-integration.md)
preparado/compilado, con guardas verificadas sin conexión; 26 escenarios todavía
NO ejecutados. Sin dispatch ni garantías nuevas para callers actuales.

## Callers actuales revisados

- AnimalController envuelve PATCH foto con PROFILE_CONFIRM; el caso de uso llama
  AnimalMediaUploads.confirm antes de actualizar la referencia y borrar la anterior.
- DiaryController envuelve POST adjunto con ATTACHMENT_CONFIRM; el manager confirma
  antes de guardar, incluida la reconfirmación idéntica de un adjunto actual.
- AnimalWriteCoordinator no entrega su handle al callback. AnimalMediaUploads no
  recibe operationId/instanceId/ownershipVersion ni enlaza el ticket al journal.
- AwsAnimalMediaUploadStorage.promote puede reconciliar un final existente o hacer
  CopyObject con origen fijado, destino ausente y metadata uploadId/digest. Después
  verifica final por HEAD/GET; sellar no es la respuesta de un intento de transporte.
- LegacyAnimalMediaCopier también llama promote. Queda EXCLUIDO del modelo nuevo:
  tiene reserva/trabajo, no el journal HTTP de confirmación. No fabricar ese vínculo.
- El cliente S3 actual no fija maxAttempts/retryStrategy. SDK instalado: client-s3
  3.1003.0, @smithy/middleware-retry 4.4.39. Su retryMiddleware vuelve a llamar next
  dentro de un bucle; una sola client.send NO identifica una sola petición física.
  No se cambia esa configuración en este bloque.

## Identidades y contrato del modelo puro

Código: [definición y vínculo](../src/context/animal-media/domain/media-promotion-effect.ts)
y [máquina/transiciones/resumen](../src/context/animal-media/domain/media-promotion-machine.ts).
createMediaPromotionModel recibe journal/animal; advanceMediaPromotion recibe
modelo, expectedRevision y comando; summarizeMediaPromotion solo observa. No se
exportan desde módulos Nest ni se usan por callers de aplicación.

El modelo representa UNA operación HTTP ordinaria con scope inmutable: operationId
del journal, instanceId original, animalId, ownerId, ownershipVersion y kind.
Solo se inicia desde TRANSACTIONAL_CLAIMS_V1/OPEN/MAY_RUN con permiso fechado,
un único claim ACQUIRED con versión positiva y PROFILE_CONFIRM/ATTACHMENT_CONFIRM.
Esto valida una entrada local; NO relee ni adquiere un fence del journal/control.

Cada efecto tiene UUID propio, uploadId y definición inmutable/hash que liga scope,
bucket explícito (seleccionado por backend, no por cliente), origen fijado
(key/ETag/VersionId opcional/SHA-256/tamaño), MIME, destino y condición
IfNoneMatch `*`. Solo tickets ordinarios nuevos, fijados y todavía no sellados;
sin legacy, generaciones, fuentes arbitrarias o refijación tras error. Una nueva
confirmación HTTP es otra operación/efecto, aunque use el mismo uploadId/destino.
El hash compara identidad técnica: no es firma, permiso o idempotencia de negocio.
El bucket queda dentro del hash; no se infiere posteriormente de otra configuración.
El modelo valida su forma básica, no existencia/permisos/configuración de una cuenta.

Cada envío físico debe tener attemptId UUID exclusivo, ordinal, instancia de
dispatcher y origen INITIAL/APPLICATION_RETRY/SDK_RETRY. Los retries enlazan el
intento anterior autorizado; nunca reutilizan su permiso. authorizationId UUID
es independiente e inmutable. UUIDs nuevos canónicos en minúsculas; sin timestamps
de vencimiento, TTL o recuperación por antigüedad.

## Máquina de estados y carreras

La puerta de operación empieza OPEN y solo pasa a REVOKED, con requestId y
evidenceRef técnica opaca. Declaración, intención de intento y autorización
compiten con revocación usando la MISMA revisión de operación. La función pura
exige expectedRevision exacta y devuelve otra revisión, sin mutar la anterior.
Un CAS perdido exige releer/recalcular; no actualizar la revisión a ciegas.

| Transición | Guarda / significado |
| --- | --- |
| Declarar efecto | OPEN; UUID/definición únicos; no cambia destino ni fuente de un efecto existente. |
| Intención de intento | OPEN; primero INITIAL; después retry nuevo ligado al último autorizado. |
| INTENDED → AUTHORIZED | OPEN; autorización única. Posibilidad de envío, NO constancia de que empezó. |
| OPEN → REVOKED | Cierra creación/autorizaciones futuras, incluidos retries SDK e intentos ya INTENDED. No elimina efectos ni permisos concedidos. |
| Registrar respuesta | Solo intento autorizado. ACKNOWLEDGED o UNKNOWN con referencia de evidencia; no error crudo ni inferencia de rollback. |
| Registrar observación | MATCH/ABSENT/CONFLICT del destino; MATCH liga uploadId/digest/revisión. No autoriza otra copia, repara o descarga intentos anteriores. |

Si revocación gana, el autorizador obsoleto falla antes de recibir permiso y el
dispatcher conforme no envía. Si autorización gana, incluso con respuesta de
persistencia perdida y sin registro de envío, el intento permanece potencialmente
ejecutable. Un proceso pausado DESPUÉS de recibir permiso puede enviar después
de la revocación: Mongo no cerca AWS. El protocolo no afirma impedir ese caso;
lo conserva como riesgo autorizado. No puede declararse cierre seguro en presencia
de permisos previos sin evidencia/aislamiento suficientes de TODOS ellos.

El futuro dispatcher solo podrá usar el resultado reconocido de una autorización
NUEVA para un único envío físico. Leer/repetir una autorización durable no concede
otro envío; después de crash/acknowledgement incierto no reutilizar ese permiso.
Crear otro intento requiere puerta todavía OPEN. No implementar un chequeo Mongo
seguido de un envío como si ese intervalo fuera atómico frente a revocación.

Las respuestas y observaciones son evidencia local append-only, admitida también
después de revocar para reconciliar. MATCH no cierra el conjunto; ABSENT no prueba
que una copia autorizada no pueda llegar después. Una respuesta ACK de un intento
no cubre otro ni garantiza retención. El resumen solo enumera autorizados,
respuestas/observaciones y tentativas cuyo envío queda impedido por revocación
sin autorización previa. No devuelve canCommit, remoteClosed o recuperable.

## Persistencia requerida: siguiente bloque, todavía propuesta

El agregado en memoria es modelo de referencia, NO un único documento BSON con
arrays crecientes. Persistir por separado puerta de operación, efectos, intentos,
respuestas y observaciones; identidad única sin TTL/reciclaje y definición completa
comparada al reintentar. Elegir índices/colecciones/tamaños/retención en ese bloque;
no se declaran schemas que puedan crear infraestructura al arrancar ahora.

Cada creación/intención/autorización y revocación debe escribir por CAS la MISMA
puerta de operación y sus filas en una transacción corta snapshot/primary/majority.
Puerta ausente es denegación, no upsert tardío OPEN; revocación deja un tombstone
durable y no permite reabrir. Inicio de puerta debe competir por journal/control
con finalización/recuperación: verificar identidad, permiso y claim/versión actuales
en la MISMA transacción, sin ampliar recuperación previa al callback. Diseñar el
cierre de registro de efectos antes de declarar cobertura; no basta revocar las
filas que un inventario alcanzó a leer. No backfill o adopción de operaciones previas.

Ante commit reconocido de modo incierto: conservar IDs y consultar evidencia
primary/majority. Una autorización encontrada sigue siendo incierta, no permiso
de reenviar. Reconciliar respuesta/observación por IDs y contenido completo; un
fallo de query no se transforma en ausencia. Ninguna llamada AWS dentro de la
transacción o de su callback reintentable. Autenticación/autorización operativa,
decodificador de datos persistidos y pruebas Mongo reales quedan pendientes.

## Retries y dispatch: requisito previo a conectar AWS

Contrato elegido para el futuro adaptador: un intento autorizado por CADA petición
mutadora de transporte. El retry interno del SDK debe volver a intención y
autorización; la puerta revocada lo deniega. No envolver solo client.send ni usar
$metadata.attempts, un requestId, clientToken o un contador final como cobertura.
También deben cubrirse redirects/reenvíos de middleware/handler y cualquier retry
de aplicación. No debe existir ruta de mutación que sortee el autorizador.

Antes de integrar, elegir y probar una de estas implementaciones técnicas:
interceptar TODAS las invocaciones del handler por debajo de retries/middleware,
o deshabilitar retries internos con configuración efectiva verificada y usar un
bucle explícito de un único envío por intento. La segunda opción no permite
afirmar cobertura sin demostrar ausencia de reenvíos en capas inferiores. No se
instala ninguna de las dos ahora ni se promete que maxAttempts por sí solo baste.
Los tests actuales modelan SDK_RETRY como otro intento; NO instrumentan el SDK.

Fundamento de retries: [configuración oficial de clientes JS v3](https://github.com/aws/aws-sdk-js-v3/blob/main/supplemental-docs/CLIENTS.md)
y [constructores oficiales](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/migrate-client-constructors.html).
La inspección local del bucle es evidencia de esta versión instalada, no una
garantía para una actualización futura.

## Límites funcionales y técnicos

Modelo sin provider, puerto de persistencia, controller, job, conexión, dispatch,
modificación de journals/tickets/tokens/reservas o S3. No registra borrados, emisión
de PUT, cargas legacy, migración, histórico/staging, materialización o BDA; no es
ledger completo. Cobertura desplegada, retención/no borrado/no reutilización,
aislamiento y autorizador de corte estable continúan pendientes.

Las observaciones/recibos ofrecidos al modelo son evidencia SIMULADA/de confianza;
la función no demuestra autenticidad del proveedor ni verifica bytes. No usar el
estado en memoria como capacidad de envío o input de un endpoint. El futuro
repositorio necesita validar la hidratación de sus filas, además del protocolo CAS.
MAY_RUN y LOCALLY_FINISHED conservan su semántica, error no es rollback, y este
modelo no amplía la recuperación del journal. Guarda inicial, preparaciones V1,
períodos y nameHistory (nombres) intactos. Transferencia deshabilitada; vencimiento,
cancelación, límite por solicitud y ubicación del histórico siguen pendientes.

Impacto central: [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
Resultados y siguiente paso: [final-delivery-plan.md](./final-delivery-plan.md).

## Validación del subbloque 30

- [Pruebas de definición/transición](../test/animal-transfer/domain/media-promotion-machine.spec.ts)
  y [pruebas de carreras](../test/animal-transfer/domain/media-promotion-races.spec.ts):
  68 casos nuevos incluidos en la regresión seleccionada (no sumarlos aparte).
  La segunda suite enumera 5040 permutaciones de siete acciones sobre dos efectos,
  retry SDK, revocación y evidencia tardía; es exploración FINITA del modelo,
  no demostración exhaustiva de todos los procesos/SDK/red/persistencia posibles.
- Seis intercalados de lectura/CAS autorización-revocación, dos autorizadores,
  respuestas de permiso/revocación perdidas, dispatcher pausado después del
  permiso y evidencia posterior sin descarga de permisos. También identidades,
  pin/bucket/hash, scope de journal/legacy, metadatos inválidos y no mutación.
- `npm run build` y ESLint de los cinco TypeScript nuevos: correctos.
- Regresión seleccionada: **89 suites y 1292 pruebas aprobadas**, sin conexiones
  reales. No acredita SDK instrumentado, CAS Mongo, quorum/failover o estabilidad
  S3. Persiste deuda de ocho suites globales heredadas; no se ejecutó suite global.
