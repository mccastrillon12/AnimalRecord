# Mapa de la aplicación y puntos de impacto

Última revisión: 2026-10-29. Alcance: código local del backend; no representa una
auditoría de Flutter, configuración real de AWS o datos productivos. Consultar
`final-delivery-plan.md` antes de continuar y actualizar este mapa si cambian
responsabilidades o dependencias.

## Módulos y reutilización

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
| `AnimalTransferModule`     | Búsqueda, OTP y solicitudes pendientes autenticadas con creación idempotente, lista/detalle; consumo OTP/notificaciones/outbox locales transaccionales. Preparación/captura interna mediante OwnershipArchiveModule; decisiones, traspaso, corte S3, históricos y push pendientes. |

Persistencia: Mongoose/MongoDB con puertos de repositorio por dominio. HTTP:
controllers/DTO en `src/app`, validación global con whitelist y rechazo de campos
no permitidos, y `HttpExceptionFilter` para errores de dominio. Swagger está en
`/docs`; no hay frontend Flutter dentro del repositorio.

## Propiedad y permisos actuales

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

El flujo vigente usa `AwsS3StorageService` para fotos/diario mediante URLs y
`AwsMedicalDocumentStorage` para documentos mediante claves/descargas firmadas.
`IStorageService.getFileKey` valida origen y ruta de URLs finales del bucket.
Confirmar foto/adjunto exige la ruta específica de su propietario y animal.

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
- El código visible de UserCodeSender solo ramifica EMAIL/PHONE; verificar su
  integración con las variantes efectivas de cuenta antes de habilitar OTP de
  transferencia. No inventar envíos ni registrar códigos.
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

Bloque 54: TransferRequestsModule exporta servicio a AnimalTransferController,
importa TransferOtpModule y modelos Mongoose de solicitudes/ítems/exclusividad,
notificaciones/outbox/eventos y fuentes usuario/motivo/animal/control. _id string
respalda identidades deterministas y exclusividad por animal. Sin TTL/autoCreate/
autoIndex; seis colecciones ordinarias deben prepararse fuera de HTTP antes de usar
POST. Preflight metadata/topología no instala ni demuestra integridad/transacciones.
OTP y negocio comparten sesión/tx snapshot/primary/majority; validaciones escriben
fence transferRequestRevision opcional sin default en fuentes, comprueban escrituras
efectivas y no usan transferLock/activeWrites como exclusividad de solicitud.
Proyecciones HTTP no exponen contadores, autorización/hash o expediente. POST
idempotente devuelve 201/200; GET lista/detalle paginados solo para participantes.
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
EMAIL/PHONE disponibles; social sin canal OTP de registro, devuelve conflicto explícito.
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
