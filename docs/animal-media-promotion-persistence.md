# Persistencia interna de efectos de promoción

Actualización 41: [23 escenarios de sealVerified preparados](./animal-media-promotion-seal-mongo-integration.md)
y compilados con config/opt-in/namespace propios, sin ejecutar Mongo. Mismo
adaptador, sin cambios en src. Rollback/carreras/commit perdido y SDK readonly
falso preparados; 50 guardas sin conexión aprobadas. Pendiente ejecución autorizada.

Actualización 40: [verificación/sellado aislados](./animal-media-promotion-verification.md).
Puerto separado readForSeal/sealVerified en este adaptador; lectura snapshot sin
fence y MATCH+ticket sealed+CAS puerta/fences journal/control en una transacción.
Compara contador capturado de ticket y definición/hash completos, sin I/O S3 en tx.
85 casos nuevos con dobles; sin Mongo real del método nuevo o integración Nest/HTTP.
Los resultados reales del 39 corresponden al código anterior a esta ampliación.

Actualización 39: [validación local autorizada de 28+21 casos](./animal-media-promotion-dispatch-mongo-validation.md)
completada, todos aprobados en primera pasada y sin cambios de código/tests.
Mongo 8.0.34, un miembro, dos clientes; CAS de ticket y delegaciones del dispatcher
con HTTP falso incluidos. 49 bases verificadas ausentes y contenedor retirado.
Sin integración de este módulo, AWS real, fin remoto o permiso de corte estable.

Actualización 38: [arnés Mongo + dispatcher/transporte falso](./animal-media-promotion-dispatch-mongo-integration.md)
preparado/compilado, 21 casos adicionales con comando/opt-in/namespace propios.
Sin ejecución Mongo ni cambios en este adaptador; los 28 casos del arnés anterior
se conservan. Guardas nuevas sin conexión y regresión 97/1590 aprobadas.
No habilita callers, ACK/MATCH, cierre remoto, retención o corte estable.

Actualización subbloque 37: [fence transaccional de ticket](./animal-media-promotion-ticket-fence.md)
en DECLARE_EFFECT/INTEND_ATTEMPT/AUTHORIZE_ATTEMPT, además de journal/control/puerta.
Revalida definición/hash del pin ordinario no sellado y escribe contador opcional
del mismo ticket; compite con el seal vigente. No borra permisos concedidos ni
restringe evidencia tardía. Sin caller operativo, migración o índices nuevos.
39 pruebas nuevas de persistencia y cuatro del dispatcher con dobles; dos carreras
Mongo añadidas (28 casos compilados), sin ejecución real de esta versión.

Actualización subbloque 36: [dispatcher aislado](./animal-media-promotion-dispatcher.md)
consume read/apply del puerto para un efecto declarado sin intentos previos.
Intención y autorización por cada delegación, con errores locales terminales.
Pruebas del adaptador sobre store simulado, sin Mongo real ni integración Nest.
No abre puertas automáticamente, recupera permisos o acredita cierre remoto.

Actualización subbloque 35: [ensayos SDK](./animal-media-promotion-transport.md)
sin red completados, sin conectar este puerto al handler. Sus probes de permiso
son sintéticos, no llaman open/apply/revoke ni acreditan persistencia/fin remoto.
El módulo sigue fuera del grafo y conserva INCOMPLETE/NOT_ASSESSED.

Actualización subbloque 34: el coordinador y handlers de confirmación ordinaria
ya emiten opt-in desde create y propagan [contexto interno](./animal-media-confirmation-context.md)
con scope/versión adquiridos. Este adaptador/módulo sigue fuera del grafo, sin
open/apply/revoke desde callers. Marca y contexto NO acreditan efectos/envíos
cubiertos; fuentes legacy/selladas mantienen sus exclusiones. No hay retrofit.

Actualización subbloque 33: [validación Mongo real](./animal-media-promotion-mongo-validation.md)
completada con autorización: 26 casos aprobados en un nodo MongoDB 8.0.34.
Una expectativa de error del arnés corregida; producción intacta. 52 bases de
dos intentos y contenedor eliminados. Sin dispatch, cierre remoto o corte estable.
Las referencias a validación pendiente siguientes describen los bloques previos.

Subbloque 31 sobre `ad5bd4a`, 2026-10-26. Contrato previo a implementación.
Complementa [el modelo puro](./animal-media-promotion-effects.md). Sin dispatch,
llamadores HTTP, operaciones Mongo/S3/AWS/Docker reales o cambio funcional.

**Implementado en este bloque:** puerto, hidratación, adaptador Mongo transaccional,
schema/índices declarados y módulo explícito sin integración al grafo actual.
**Aprobado funcionalmente:** conservar copia exacta histórica y entregar copia
independiente; este bloque no cambia ese objetivo ni habilita transferencias.
**Pendiente:** validación real, caller autorizado, dispatch por intento, cobertura
remota global, retención/aislamiento y commit de negocio.

Actualización subbloque 32: [arnés Mongo opt-in preparado](./animal-media-promotion-mongo-integration.md),
26 escenarios compilados y guardas sin conexión aprobadas. Ningún escenario
ejecutado en Mongo; no hay evidencia real de índices/transacciones de este protocolo.
Siguiente: ejecución únicamente con autorización específica del entorno desechable.

## Diseño del bloque

Una colección nueva declarada `animal_media_promotion_records`, con filas separadas
GATE/EFFECT/ATTEMPT/RESPONSE/OBSERVATION, protocolo durable propio. No se persiste
el agregado con arrays crecientes. ID UUID único global en la colección, incluida
la puerta cuyo ID es operationId. Índices únicos parciales por operación/upload,
operación/bucket/destino y efecto/ordinal; índice de lectura por
operación/tipo/id. Sin TTL, defaults de negocio, reciclaje, upsert o backfill.
Cada fila guarda identityIds, un array acotado de uno o dos UUIDs (ID de fila y,
cuando corresponde, authorizationId o requestId de revocación). Un índice multikey
único impide alias entre permisos, auditorías e IDs de CUALQUIER fila; el decoder
comprueba esa allowlist/orden/unicidad, incluidos duplicados dentro de la fila.

El módulo de persistencia es explícito y NO importado por AppModule/AnimalMediaModule.
Así, declarar schema/índices no los crea al arrancar la aplicación actual. Su futura
integración requiere validar índices/topología/permisos y autorizar la infraestructura.
Los campos de fence opcionales del journal/control no llevan default o migración.
El journal debe incluir mediaPromotionProtocol=MEDIA_PROMOTION_ROWS_V1 desde SU
creación inicial NOT_STARTED. El repositorio de journal solo acepta esa marca en
confirmaciones ordinarias de un animal sin emisión de URL, y rechaza un contador
de fence prellenado. La persistencia nueva nunca añade la marca al abrir/revocar:
un journal anterior sin ella se rechaza, incluso si conserva MAY_RUN/claim vigente.
El coordinador actual todavía no la emite; su integración será explícita después
de validar el protocolo. No hay adopción/backfill de operaciones previas.
El schema nuevo desactiva además autoCreate/autoIndex, conserva objetos vacíos y
rechaza campos de nivel superior desconocidos. No se ejecutó createCollection,
init/syncIndexes o migración. Los índices deben existir y verificarse antes de usar
el protocolo en un entorno autorizado; declararlos no demuestra su eficacia real.

Puerto interno: abrir puerta desde selección operationId/instanceId/animalId;
aplicar comando con revisión exacta; revocar con revisión y auditoría técnica;
leer puerta/registro por ID para reconciliación. Declarar efecto recibe uploadId,
no un ticket inventado: el adaptador relee el ticket en su sesión. No ofrece
inventario completo, permisos públicos, canCommit o recuperación de tokens.

Cada mutación abre transacción corta snapshot/primary/majority. Todas escriben por
CAS la MISMA puerta junto a la fila afectada. Declarar/intentar/autorizar además
validan y escriben fences del journal y control: journal transaccional OPEN/MAY_RUN,
permiso presente, claim ACQUIRED/versión y token enlazado exacto; dueño/versión y sin
reserva. El write de journal/control compite con settle/finish/endWrite/reservas;
una lectura snapshot antigua sola no autoriza. Ningún callback de transacción hace
I/O remoto. Reintentos del driver no reutilizan resultados de un intento abortado.

Código: [puerto/hidratación](../src/context/animal-media/domain/media-promotion-persistence.ts),
[adaptador](../src/context/animal-media/infrastructure/mongo-media-promotion-persistence.ts),
[schema](../src/context/animal-media/infrastructure/media-promotion-record.schema.ts) y
[módulo opt-in](../src/app/animal-media/media-promotion-persistence.module.ts).
Los comandos se clonan al entrar para impedir retarget mientras esperan I/O.
mediaPromotionRevision opcional se incrementa por CAS tanto en journal como en
control, sin tocar timestamps/resultados/claims/ventanas/reserva. Ausente se compara
como ausente, distinto de cero; corrupción o agotamiento falla sin overflow.

## Apertura tardía y cierre

Abrir exige ausencia de puerta y journal/control vigentes. Repetir apertura NO
adopta una puerta existente: consultar por ID tras respuesta perdida. Revocar una
puerta existente compara su revisión y conserva autorizaciones previas.

Revocar ANTES de abrir usa expectedRevision ausente de forma explícita y crea
directamente tombstone REVOKED. Relee vínculo válido del journal nuevo, incluso
si ya está localmente terminado, y escribe el journal en la misma transacción.
No requiere permiso MAY_RUN para impedir permisos FUTUROS ni retira claims.
No inventa que callback no corrió o que AWS terminó; tampoco amplía recuperación
previa al callback. Apertura y tombstone compiten por journal e ID único. Si gana
apertura, el revocador debe releer la revisión; si gana tombstone, abrir falla.
Una revocación con revisión ausente no adopta silenciosamente una puerta existente.

Revocación registra requestId/operatorId UUID y evidenceRef técnica opaca, sin
error/payload/URL. Estos IDs son auditoría, no autenticación. Las llamadas nuevas
todavía no tienen caller operativo autorizado. Gate REVOKED nunca se reabre;
respuestas y observaciones posteriores solo añaden evidencia y avanzan revisión.
También se deniegan nuevas autorizaciones si el journal se resuelve o pierde su
token aunque la puerta siga marcada OPEN. No hay cierre automático del callback.

## Hidratación, intentos y reconciliación

Validar tipo/protocolo/scope/UUID/revisión, ausencia distinta de cero, definición/
hash/pin/bucket, contadores seguros, padre/ordinal/instancia y consistencia de
autorización. Rechazar filas corruptas, versiones desconocidas, padres ausentes,
campos incompatibles y respuestas sin permiso; no normalizar estados para avanzar.
Lecturas por ID acotadas en una sesión; nunca cargar todos los intentos/expediente.

INITIAL solo con contador cero; retry nuevo enlaza el último intento autorizado,
incluido SDK_RETRY. Autorizar compara dispatcherInstanceId esperado, solo una vez,
y no cambia identidad o definición. Evidencia append-only por ID único y contenido
validado. Un ACK/MATCH no descarga ningún permiso previo ni cierra efectos hermanos.

El adaptador reconstruye una vista acotada del modelo puro con el efecto y solo el
intento relevante; no enumera ni sintetiza intentos ausentes. El ordinal persistido
sale del contador del efecto, comparado con su último intento real. Las guardas
puras verifican la transición local y los índices/CAS cubren unicidad/concurrencia
entre filas. Lectura de retry comprueba su padre inmediato autorizado; no reaudita
recursivamente toda la cadena. La integridad global depende de inmutabilidad del
protocolo, índices y no borrado/edición administrativa directa o restauración de
filas; tales intervenciones no están cubiertas ni autorizadas.

Ante error de commit puede haberse confirmado TODO. Consultar con los mismos IDs;
ni ausencia de respuesta ni encontrar authorizationId concede otro envío. Repetir
comandos/revisiones confirmadas provoca conflicto, no reejecución. Fallos de lectura
se propagan; no falso vacío, rollback supuesto o desbloqueo. Lecturas son evidencia
local INCOMPLETE/NOT_ASSESSED, sin autenticidad del proveedor demostrada.

## Límites y siguiente paso

Validación de este bloque con modelos/sesiones optimistas simulados: rollback,
dos instancias, CAS/snapshot obsoleto, cierre/token perdido, tombstone antes de
apertura y respuestas de commit ocultadas DESPUÉS de confirmar en el doble.
No acredita Mongo real, failover/mayoría/índices, SDK instrumentado o estabilidad S3.

El subbloque 32 ya prepara el arnés Mongo opt-in aislado para este protocolo;
autorizar su ejecución real por separado. Antes de dispatch: enlace identidad a callers, cobertura de
TODOS los envíos/retries/middleware/handler, ticket/sellado concurrente, retención/
aislamiento y rollout íntegro. El adaptador actual S3 no participa ni gana garantías.
Permisos previos pueden enviar después de revocar. Ledger completo/corte estable,
PUT/legacy/migración/borrados/BDA/histórico/staging y commit conjunto siguen pendientes.
Guarda inicial/V1, nameHistory (nombres) y decisiones funcionales permanecen intactos.

Impacto central en [guía frontend](./frontend-animal-transfer-foundations.md).
Evidencia exacta y próximo paso en [plan de entrega](./final-delivery-plan.md).

## Validación disponible

[Adaptador y carreras simuladas](../test/animal-transfer/infrastructure/mongo-media-promotion-persistence.spec.ts):
66 casos nuevos. [Módulo/schema/creación opt-in](../test/animal-transfer/infrastructure/media-promotion-persistence-module.spec.ts):
cuatro casos nuevos. Regresión seleccionada final **91 suites/1362 pruebas**,
incluidas las anteriores del modelo; no es suite global ni integración Mongo.
Build, ESLint de once TypeScript y compilación de los arneses existentes correctos.
Arnés preparado en el subbloque 32, todavía NO ejecutado. Persisten ocho suites
globales heredadas con fallos ajenos, no reevaluadas aquí. Próximos fixtures deben
declarar opt-in en create inicial y recorrer el protocolo, sin retag de MAY_RUN.
