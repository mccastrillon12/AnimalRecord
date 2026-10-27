# Journal de operaciones de escritura

Auditoría subbloque 28: el journal identifica operación/claims, no cada petición
AWS, retry, hijo BDA, copia o compensación. MAY_RUN no prueba inicio y
LOCALLY_FINISHED no prueba fin remoto; tampoco lo hacen resultado o token ausente.
No ampliar recuperación previa al callback a estos casos. Siguiente bloque:
lectura interna paginada por animal, incluidos journals terminales sin activeWrites;
no declara cobertura completa ni recuperación/cierre S3. Evidencia por efecto
todavía PROPUESTA en [animal-transfer-stable-s3-cut.md](./animal-transfer-stable-s3-cut.md).

Subbloque 8 confirmado en `549ec89` sobre `cdc32b2`; subbloque 9 sobre `549ec89`.
Pruebas unitarias con repositorios/servicios externos simulados; primera validación
Mongo real en el subbloque 11, documentada al final. La recuperación
disponible se limita al protocolo transaccional previo al permiso del callback;
siguen pendientes recuperación general, ensayos multinodo/red/S3 y transferencias completas.

## Compatibilidad frontend (registro central en la guía de transferencias)

Se conservan rutas, DTO, cuerpos, éxitos, URLs, límites y reglas clínicas.
Ficha/foto, diario/adjuntos y mutaciones médicas ya coordinadas preparan ahora
un journal duradero antes de ejecutar su callback. GET puros no participan.

Un fallo de persistencia antes de habilitar el callback impide ejecutarlo y puede
devolver el error interno 500 vigente; un conflicto del journal añade 409 con
mensaje propio, que NO significa transferencia. Conservar formulario/archivo,
refrescar y no repetir automáticamente una mutación ante un error genérico.
No enviar IDs de operación/instancia, kind, claims o estados de journal desde
Flutter. No son claves idempotentes del cliente ni prueba de rollback.

Un fallo de registrar el resultado o de liberar después del callback NO convierte
un éxito de negocio en error ni oculta el error original. Se registra advertencia
técnica y puede quedar recuperación pendiente. La firma conserva su ventana de
300 s; registrar ventana antes de devolver sigue siendo obligatorio. Medicina
mantiene selección de animales, ACCEPT/REJECT, polling, versiones, categorías,
extracciones y plazo de 48 h. No se conservan archivos, datos clínicos, payloads,
errores crudos, OTP, credenciales o URLs firmadas en el journal.

## Protocolo del subbloque 8 (base histórica)

Un UUID por operación (también su token), identidad UUID aleatoria del proceso
actual y fecha de arranque. Se persisten actor, tipo técnico permitido, animales
ordenados/sin duplicar, si emite URL, fechas y fases. Cada animal conserva estado
de adquisición/liberación y versión esperada. Identidad NO equivale a liveness.

1. Autorizar previamente todo el conjunto, conservando denegaciones de permisos
   antes de preparar el journal. Crear journal con mayoría antes de intentar
   claims; adquirir sigue comparando dueño/versión/lock actuales atómicamente.
   Persistir INTENT y versión
   antes de cada beginWrite. Nuevos claims enlazan operationId/instanceId; tokens
   legacy sin esos campos permanecen intactos, sin backfill ni atribución inventada.
2. Solo un resultado cierto de beginWrite se trata como ACQUIRED/NOT_ACQUIRED;
   una excepción conserva ACQUIRE_UNKNOWN (o INTENT si registrar falla). No liberar
   el claim incierto: nunca se ejecuta callback sin todas las adquisiciones conocidas.
3. Persistir MAY_RUN por comparación de estado y todas las adquisiciones antes
   de invocar callback. MAY_RUN significa permiso/posibilidad de ejecución, no
   prueba de que empezó. Registrar RETURNED/THREW al resolverse o NOT_INVOKED si
   no se invocó; no guardar su contenido ni su error. THREW NO implica rollback.
4. Liberar únicamente claims adquiridos con certeza, después de todo trabajo
   esperado. Registrar RELEASED solo tras acknowledgement; ante error conservar
   RELEASE_UNKNOWN. Nunca borrar arrays ni tokens de otra operación.
5. Registrar resultado local del coordinador y cerrar LOCALLY_FINISHED solo con
   callback resuelto/no invocado y todos los claims conocidos liberados/no tomados.
   Un resultado incierto conserva OPEN. Aun LOCALLY_FINISHED NO demuestra ausencia
   de efectos remotos tardíos ni sirve por sí solo para habilitar recuperación.

Fases y permisos del journal se condicionan a id/instanceId y al estado esperado;
no se reciclan IDs ni se retrocede una transición. Lecturas primario/mayoría.
Sin TTL, leases, heartbeat, reejecución de callbacks ni limpieza automática.
En esa base el registro y el control no compartían transacción: intent precedía
al claim. El subbloque 9 descrito abajo cambia únicamente las nuevas adquisiciones.
Escritores HTTP continúan sin serializar CRUD entre sí.

## Operación y límites conservados

Tipos técnicos se asignan en los callers backend, no desde el request. Callers
internos sin etiqueta se registran UNSPECIFIED y no ganan permiso de recuperación.
Las lecturas internas por operationId permiten correlacionar la observación de
un claim con su journal. No se añade endpoint público ni nueva política de
retención, limpieza o vencimiento/cancelación de transferencias.

Antes de rollout: comprobar índices, mayoría, BSON/coste/latencia, todas las
réplicas y escenarios de reinicio reales. Un proceso puede morir antes/después
de cualquier escritura y una copia S3 puede terminar tras un timeout; la futura
recuperación deberá reconciliar control/journal y efectos remotos por tipo de
operación, sin tomar la antigüedad o un código de error como prueba suficiente.

## Persistencia e integración

AnimalWriteJournalModule exporta AnimalWriteInstance y el puerto AnimalWriteJournal;
AnimalModule lo importa/reexporta. Colección `animal_write_journals`, id único e
índice instanceId/lifecycle, sin TTL. Creación solo admite conjunto inicial no
vacío/sin duplicados y estados iniciales; no adopta una operación ya existente.
Nuevos activeWrites incorporan operationId (igual a token) e instanceId opcionales
en el schema por compatibilidad. El inventario conserva esos enlaces cuando
existen, sin inventarlos para registros legacy; el repositorio del journal ofrece
lectura interna por ID para correlación, no una API de administración.

Callers HTTP se etiquetan explícitamente: ficha/foto, diario/adjuntos, análisis,
polling, revisiones ACCEPT/REJECT, reemplazo, eliminación y normalización legacy.
Creación inicial de animal, lecturas puras, login, foto de usuario, catálogos y
feedback global anónimo siguen fuera del coordinador. No se relacionan votos
de feedback con usuario/animal ni se agregan datos clínicos a este registro.

Estados de callback y de coordinador son distintos: un callback puede RETURNED
y luego fallar el registro obligatorio de ventana (coordinador THREW). Un journal
puede cerrar localmente tras un análisis que dejó AWS trabajando de forma
asíncrona; el preflight médico sigue bloqueando IA pendiente. No usar estos
estados como sustituto del estado del documento ni del manifiesto de efectos S3.

Las escrituras extra pueden aumentar latencia antes/después del callback.
Mantener la petición única pendiente y conservar datos locales. El journal no
aporta idempotencia de negocio: un nuevo intento HTTP crea una operación distinta.
Fallos posteriores de evidencia se advierten solo con IDs técnicos, sin guardar
el error crudo ni convertir éxito en error. No se ha ejecutado migración,
recuperación, despliegue o llamada AWS/Mongo real en estos bloques.

## Subbloque 9: autorización transaccional de adquisiciones

Las nuevas operaciones creadas por `AnimalWriteCoordinator` incluyen
`protocol=TRANSACTIONAL_CLAIMS_V1`. El schema mantiene el campo opcional y SIN
default para leer journals anteriores; no se backfillea ni se infiere su garantía.
Crear un journal con el adaptador nuevo exige esta marca. La identidad del proceso
sigue siendo correlación, nunca prueba de liveness.

INTENT/versión siguen persistidos antes de adquirir. Para cada animal, beginWrite
con journal abre una transacción corta snapshot/primary/majority que:

1. Inserta el token en el control solo con dueño/versión/ausencia de lock actuales,
   y sin otro token idéntico. Si no puede adquirir, devuelve false sin avanzar el
   journal. No adopta un token anterior como éxito de una adquisición repetida.
2. Actualiza el MISMO journal por id/instanceId/actorId/protocolo/OPEN,
   callback NOT_STARTED, ausencia de callbackPermittedAt y claim INTENT/versión
   coincidente. Pasa ese claim a ACQUIRED en la misma transacción.
3. Si la autorización falla, lanza conflicto y aborta la inserción. Solo después
   del commit reconocido devuelve true. Si su respuesta es incierta no ejecuta
   callback ni libera ese token por inferencia.

El registro posterior ACQUIRED del coordinador confirma solo un ACQUIRED ya
persistido: `claim(ACQUIRED)` ya no convierte INTENT en permiso fuera de una
transacción. Intentos de INTENT requieren NOT_STARTED. `permitCallback` exige
protocolo nuevo, todos los claims ACQUIRED, OPEN/NOT_STARTED y ausencia de
callbackPermittedAt; escribe MAY_RUN y su fecha en una sola actualización con
mayoría. No se necesita una transacción larga ni se incluye trabajo de negocio/S3
en estas transacciones. Los animales siguen adquiriéndose de uno en uno antes de
invocar el callback completo; los CRUD no se serializan entre sí.

Si el commit ocurrió pero se perdió su respuesta, el journal puede conservar
ACQUIRED aunque la adquisición sea desconocida para el proceso; un intento de
guardar ACQUIRE_UNKNOWN solo desde INTENT no lo degrada. El coordinador no invoca
callback y mantiene la incertidumbre local. Una respuesta de MAY_RUN perdida puede
terminar en NOT_INVOKED; callbackPermittedAt se conserva y excluye recuperación.
Errores no demuestran rollback de negocio ni ausencia de efectos remotos.

## Recuperación explícita disponible y sus carreras

`AnimalModule` exporta `AnimalWriteRecovery.recoverBeforeCallback(input)`.
Es un servicio interno, sin endpoint, job, script productivo ni ejecución al
arrancar. El futuro llamador debe autenticar y autorizar al operador; el UUID de
operatorId es auditoría y no otorga permisos. No llamar automáticamente al observar
un error, un timeout o una fecha antigua.

Entrada explícita: operationId, instanceId, requestId y operatorId UUID; motivo
`INSTANCE_TERMINATION_CONFIRMED` u `OPERATOR_INTERVENTION`; evidenceRef opaca de
1–200 caracteres ASCII, comenzando con letra/número y continuando solo con
letras/números, punto, guion, guion bajo o dos puntos. Se rechazan URLs, rutas,
espacios y parámetros de firma. Guardar solo una
referencia al incidente/evidencia, nunca logs crudos, datos clínicos, credenciales
o URLs firmadas. El motivo no comprueba muerte de instancia automáticamente.

Solo admite un journal OPEN, con protocolo nuevo, tipo backend conocido distinto
de UNSPECIFIED, conjunto no vacío/sin duplicados, callback NOT_STARTED o
NOT_INVOKED y **sin callbackPermittedAt**. Esta ausencia es parte de la evidencia
duradera: la intervención revoca un permiso que todavía no se otorgó, incluso
si el proceso sigue vivo. No depende de declarar muerto al escritor.

En una única transacción snapshot/primary/majority lee todos los controles del
scope, rechaza duplicados/identidades inconsistentes y retira solo tokens cuyo
token==operationId, operationId e instanceId coinciden exactamente. Los demás
tokens, ventanas de cargas y reservas permanecen intactos. Un token ausente se
registra como ausente, sin inventar adquisición o liberación previa. La misma
transacción cambia el journal a RECOVERED_BEFORE_CALLBACK terminal, callback
NOT_INVOKED y claims RECOVERED, con fecha, solicitud, operador, motivo, evidencia
y estado anterior/tokenRemoved por animal. No fabrica un resultado de callback
o coordinador; conserva los que ya existían.

| Carrera | Garantía del protocolo |
| --- | --- |
| Recuperación gana frente a adquisición atrasada | La adquisición también debe escribir el journal OPEN/NOT_STARTED: falla o entra en conflicto y aborta su inserción de token. No basta con haber borrado el token. |
| Adquisición gana mientras recuperación observa un snapshot anterior | Ambas escriben el journal: la transacción de recuperación debe reintentarse y observar el token comprometido antes de retirarlo. |
| MAY_RUN gana | Recuperación falla/reintenta y se rechaza; las retiradas tentativas se abortan junto con su transacción. |
| Recuperación gana frente a MAY_RUN | El journal terminal impide autorizar el callback; el coordinador conserva el conflicto previo al negocio. |
| Segunda intervención o respuesta de commit perdida | Repetir exactamente la misma solicitud verifica auditoría y retorna el terminal sin tocar controles/reservas posteriores. Otro payload se rechaza. |

El adaptador termina releyendo el journal primario/mayoría. Un error de confirmación
puede ocurrir después de commit; conservar IDs/payload y repetir exactamente la
misma intervención. Los reintentos técnicos de transacciones Mongo no reejecutan
el callback de negocio. Un callback que no obtuvo permiso no se reejecuta después
de recuperarlo; un eventual nuevo intento HTTP es una operación nueva.

## Exclusiones, compatibilidad y siguiente paso

- Excluye journals previos sin marca, tokens legacy, operaciones UNSPECIFIED,
  MAY_RUN/RETURNED/THREW, cualquier callbackPermittedAt (también con NOT_INVOKED),
  cierre local y reservas de captura/archivo/transferencia. No recupera por edad,
  errores o un supuesto rollback. Esos casos necesitan otro protocolo de evidencia.
- La llamada legacy sin journal a beginWrite conserva su comportamiento anterior;
  no gana garantía de recuperación. Callers internos nuevos deben usar el
  coordinador durante TODA su operación. No mezclar réplicas para habilitar
  intervenciones: desplegar el protocolo completo y drenar las antiguas antes.
- Las escrituras HTTP coordinadas ahora requieren Mongo con transacciones. Sus
  errores previos al callback pueden dar 500/409; los cuerpos exitosos, incluido
  PUT animal primitivo, se conservan. Compatibilidad e instrucciones completas en
  [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
- Pruebas locales de filtros/transacciones con modelos simulados y carreras con
  un doble de snapshots optimistas/rollback/reintento. No prueban locking,
  failover, majority o transacciones Mongo reales. No se ha ejecutado recuperación
  real ni se han llamado Mongo/S3/AWS para validar estas garantías.

El subbloque 10 ya prepara un arnés de integración opt-in con Mongo replica set
aislado para las dos carreras, rollback multi-animal, respuesta oculta al llamador
y verificación de índices/mayoría. La primera ejecución real del subbloque 11
aprobó los once escenarios en MongoDB 8.0.34, replica set de un miembro y dos
conexiones desde el mismo proceso. No se modificó el protocolo para hacerla pasar.
Contrato operativo y límites en
[animal-write-mongo-integration.md](./animal-write-mongo-integration.md).
Evidencia exacta de entorno/limpieza y límites en
[animal-write-mongo-validation.md](./animal-write-mongo-validation.md).
El subbloque 12 ya incorpora un importador interno explícito de antecedentes y
pruebas sintéticas A→B→C/devolución, no su integración con captura posterior.
Detalle en [ownership-archive-history.md](./ownership-archive-history.md).
Siguiente bloque: integrar referencias activadas/cierre-apertura de períodos y
captura posterior, manteniendo la guarda inicial hasta garantizar expediente
completo. Definir el llamador operativo
autorizado antes de ejecutar intervenciones reales. Mantener pendientes el
protocolo de evidencia para operaciones con callback posible/legacy, recuperación
de reservas, efectos remotos y antecedentes retenidos; no habilitar aceptación.
