# Journal de operaciones de escritura

Subbloque 8 sobre `cdc32b2`. Contrato registrado antes de implementar; implementado
y validado localmente con repositorios/servicios externos simulados. No habilita
retirada de tokens, detección automática de procesos muertos ni transferencias.

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

## Protocolo implementado

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
El registro y el control no comparten transacción: intent precede al claim y la
incertidumbre se representa explícitamente, no se declara atomicidad inexistente.
Escritores HTTP continúan sin serializar CRUD entre sí.

## Operación y límites

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
recuperación, despliegue o llamada AWS/Mongo real en este bloque.
