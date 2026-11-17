# Migración interna de medios legacy

Subbloque 6 sobre `92322a3`. Contrato registrado antes de implementar; servicio
implementado y validado localmente con Mongo/S3 simulados. No hay
ejecución al arrancar, endpoint ni comando productivo automático. Implementar
el servicio no autoriza ejecutarlo sobre datos reales.

## Preparación con retención para transferencias

Bloque 326. El operador interno puede fijar en la definición del trabajo
`retention: { expectedBucketOwner, retainUntil }`, con la cuenta dueña del
bucket y la fecha futura aprobada en UTC (ISO 8601 con milisegundos). El
mismo ID exige la misma definición al reanudar. Consultar el procedimiento
AWS de la [guía de Lightsail](./application-map.md#activación-del-primer-traspaso-en-lightsail).

El migrador de foto y diario copia a su clave canónica aislada y fija
primero la revisión y los bytes. Admite como origen un objeto con versión
`null` y un ticket anterior ya sellado. Antes de sellar el nuevo ticket
exige un VersionId real, el mismo SHA-256 y retención `COMPLIANCE` hasta
la fecha del trabajo, comprobada por versión y propietario en S3. La
activación usa el checkpoint transaccional existente y exige el ticket
de esa definición. El objeto original sigue en su clave. Las cargas nuevas
siguen por el protocolo ordinario. Las lecturas de Flutter usan la URL
vigente del backend, como en la migración original. Durante el trabajo,
las escrituras de ese animal están sujetas a su reserva.

### Documentos médicos aceptados

Bloque 327. Usar un trabajo separado con `scope: 'MEDICAL_DOCUMENTS'` y
la misma definición de retención. Rechaza trabajo médico pendiente y
documentos compartidos o con referencias inconsistentes. Reutiliza una
versión de origen con retención suficiente. Para los demás archivos,
promueve una copia condicional en `revisions/{id}/` dentro de la categoría
y documento vigentes. Un ticket persistido permite verificar el destino
en un reintento aunque se pierda la respuesta de S3. El archivo original
se conserva.

Dentro de la transacción del checkpoint se comprueban reserva, dueño,
versión del documento y sus dos referencias. Se cambian exclusivamente
`storageKey` y `documentLocations[0].storageKey`. La descarga conserva
el ID, el nombre de archivo y su URL firmada de cinco minutos. La
preparación conserva la aceptación original y su ventana de edición.

## Ejecución explícita en Lightsail

El piloto de integración usará animales nuevos y archivos ficticios
cargados desde Flutter. La meta aprobada es ejecutar cada prueba desde
la app, sin intervención por animal en Lightsail. El comando de esta
sección queda como herramienta manual para preparar archivos anteriores
al versionado. El ambiente actual contiene datos de prueba y está
previsto reiniciarlo en la entrega.

Al habilitar la composición del primer traspaso, el backend protege
automáticamente las versiones nuevas seleccionadas en el manifiesto.
La activación real requiere configurar el proveedor de acreditaciones y
el aislamiento de almacenamiento. Al acordar el horizonte del ensayo, tener en cuenta
que S3 conserva las versiones protegidas con `COMPLIANCE` hasta su
vencimiento, incluso si se elimina la referencia de la base de datos.
[Retención en S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).

Usar la imagen publicada que incluya el bloque 328 en todas las réplicas.
En el bucket efectivo confirmar **Control de versiones** y **Bloqueo de
objetos** habilitados, con retención predeterminada desactivada. Verificar
que las rutas médicas sean privadas y conservan la descarga firmada.
Mantener el acceso vigente de las fotos y los adjuntos de Flutter.
Permisos y configuración en la [guía de Lightsail](./application-map.md#activación-del-primer-traspaso-en-lightsail).
El comando consulta los índices de migraciones y tickets y, al iniciar,
consulta las dos propiedades de S3 con la identidad del backend. Usa los
índices existentes y requiere las colecciones ya preparadas.

### 1. Identificar el contenedor, el animal y la retención

En la sesión SSH de Lightsail, ejecutar con Bash. Confirmar el nombre
del contenedor en `docker ps` y usar el UUID interno del animal, el
UUID de su dueño actual y la versión de propiedad de
`animal_ownership_controls`. El código visible del animal y la
revisión de una solicitud tienen otros usos.

```bash
CONTAINER=ubuntu_app_1
BUCKET=animal-record-profile-pictures
DB=$(sudo docker exec "$CONTAINER" printenv MONGO_DB_NAME)
sudo docker exec "$CONTAINER" printenv AWS_S3_BUCKET_NAME
sudo docker exec -w /app "$CONTAINER" node dist/operations/retained-media-migration.cli.js --help

read -r -p 'UUID del animal: ' ANIMAL
read -r -p 'UUID del dueño actual: ' OWNER
read -r -p 'Versión de propiedad: ' OWNERSHIP_VERSION
read -r -p 'ID de cuenta titular del bucket (12 dígitos): ' BUCKET_OWNER
read -r -p 'Fecha aprobada de retención UTC (AAAA-MM-DDTHH:MM:SS.000Z): ' RETAIN_UNTIL

prepare_media() {
  local mode=$1
  shift
  sudo docker exec -w /app "$CONTAINER" node dist/operations/retained-media-migration.cli.js "$mode" "${DB:?}" "$BUCKET" "$@"
}
```

La fecha se aplica en modo `COMPLIANCE` a las copias nuevas. Conservar el
alcance validado y los IDs de trabajo para cualquier reanudación.

### 2. Preparar fotos y adjuntos del diario

```bash
MEDIA_JOB=$(cat /proc/sys/kernel/random/uuid)
printf 'Trabajo de foto y diario: %s\n' "$MEDIA_JOB"
prepare_media start "$MEDIA_JOB" "$ANIMAL" "$OWNER" "$OWNERSHIP_VERSION" media "$BUCKET_OWNER" "$RETAIN_UNTIL" --execute
prepare_media status "$MEDIA_JOB"
prepare_media advance "$MEDIA_JOB" --execute
```

Repetir `prepare_media advance "$MEDIA_JOB" --execute` hasta que
`phase` sea `COMPLETED`. Cada ejecución procesa una página. El trabajo
empieza en `PROFILE` y luego pasa a `DIARY`. Mientras haya reserva, las
escrituras del animal pueden recibir 409 y sus lecturas siguen disponibles.

### 3. Preparar los documentos médicos

Una vez completado el trabajo de foto y diario para el mismo animal,
usar un ID distinto para el trabajo médico.

```bash
MEDICAL_JOB=$(cat /proc/sys/kernel/random/uuid)
printf 'Trabajo médico: %s\n' "$MEDICAL_JOB"
prepare_media start "$MEDICAL_JOB" "$ANIMAL" "$OWNER" "$OWNERSHIP_VERSION" medical "$BUCKET_OWNER" "$RETAIN_UNTIL" --execute
prepare_media status "$MEDICAL_JOB"
prepare_media advance "$MEDICAL_JOB" --execute
```

Repetir el avance médico hasta `COMPLETED`. Si hay un análisis o
reemplazo pendiente, resolverlo por el flujo habitual antes de iniciar.
La descarga mantiene el mismo ID y nombre. `COMPLETED` corresponde a la
preparación de archivos y la aceptación pública aún requiere su
configuración operativa.

### 4. Reanudar o detener un trabajo

Si un comando falla o pierde su salida, consultar `status` con el mismo
ID. Si el inicio quedó incierto y el trabajo no aparece, repetir
`start` con todos los argumentos originales. Si existe y sigue activo,
corregir la causa indicada y repetir `advance` con el mismo ID.
Un reinicio de SSH requiere volver a definir la función y restaurar los
IDs guardados.

Para una detención técnica explícita, usar el trabajo afectado, su
`revision` actual, un UUID de solicitud nuevo, el UUID del operador,
un motivo y una referencia de incidente. Reusar la misma solicitud
si se pierde la respuesta de la detención.

```bash
read -r -p 'UUID del trabajo que se detendrá: ' JOB
prepare_media status "$JOB"
read -r -p 'Revision que devuelve status: ' REVISION
read -r -p 'UUID del operador: ' OPERATOR
read -r -p 'Referencia del incidente: ' EVIDENCE_REF
REQUEST=$(cat /proc/sys/kernel/random/uuid)
prepare_media stop "$JOB" "$REVISION" "$REQUEST" "$OPERATOR" OPERATOR_INTERVENTION "$EVIDENCE_REF" --execute
```

`STOPPED` libera la reserva de ese trabajo y conserva las páginas ya
aplicadas y sus archivos. Una copia previamente enviada a S3 aún puede
terminar. Seguir el [procedimiento de recuperación](./animal-media-migration-recovery.md).

## Contrato anterior/nuevo e integración

- Antes: foto y adjunto guardaban una URL directa que pudo recibir una URL PUT
  antigua. Después de una migración explícita: misma identidad del animal,
  entrada y adjunto, metadatos y fechas; solo cambia la URL del medio a una copia
  aislada/verificada. Nunca se borra el original. No cambia dueño ni nameHistory.
- Foto: mantiene `profile_{numeroOpaco}.ext`. Diario: admite además
  `diary/{entryId}/{attachmentId}/sealed_{id}.ext`. Flutter debe usar las URLs
  exactas recibidas, no reconstruirlas desde attachmentId ni parsear números.
- Una confirmación con URL antigua retirada devuelve 409 y exige refrescar;
  no restaura referencias antiguas ni devuelve un éxito con URL obsoleta. Una
  confirmación idéntica a la URL canónica actual conserva su idempotencia.
  Tras refrescar, comparar por attachmentId y conservar datos locales. No volver
  a subir un adjunto ya guardado solo porque su URL cambió.
- La reserva interna de migración reutiliza la exclusión persistida del animal:
  durante su ejecución las escrituras pueden devolver el 409 ya existente de
  reserva; las lecturas siguen disponibles y ven páginas ya confirmadas. Ese
  mensaje no debe usarse como prueba de una transferencia real.
- Éxitos HTTP, DTO y cuerpos de carga/confirmación se conservan; foto del usuario,
  medicina, motivos/buscador y reglas de transferencia no cambian, salvo que la
  reserva compartida también puede pausar las escrituras médicas ya coordinadas.
  La validación de URL cambiada ya puede dar 409; las URLs guardadas no se
  transforman hasta ejecutar migración. Su rollout exige revisar cachés,
  confirmaciones antiguas y consumidores que reconstruyan URLs.

## Protocolo implementado

Subbloque 19: nuevos trabajos fijan reservationEpoch en la transacción de creación/
reserva; páginas comparan ese valor contra trabajo y control. Finalización y
detención lo comparan e incrementan junto con liberar. Trabajos previos sin
campo solo operan bajo un control también sin campo, sin adoptar una reserva
posterior. Sin backfill/TTL o ejecución real. Es identidad de reserva, no fin
remoto ni nuevas reglas de negocio. Detalle y límites:
[animal-reservation-epoch.md](./animal-reservation-epoch.md).

Trabajo explícito por animal/dueño/versión e ID idempotente. Creación y reserva
son una transacción corta con mayoría: cero escritores, ninguna otra reserva y
ventanas de carga vencidas. Esperar ventanas NO demuestra fin de PUT antiguos;
el aislamiento lo proporciona la copia a una clave distinta, nunca reciclada.

Fases PROFILE → DIARY → COMPLETED, cursor por ID de entrada, hasta 20 entradas
por llamada (no es un límite de adjuntos de negocio; una entrada puede contener
varios y todavía requiere medir latencia/coste). Cada medio antiguo conserva procedencia en el ticket de carga:
migración, clave/URL original y recurso. No se emite URL PUT para ese ticket.
Revisión/hash de origen se fijan por CAS; se reutilizan promoción condicional,
verificación y sellado de AnimalMediaUploads. Un PUT tardío solo cambia el
original, no la copia activada. Si cambia antes de copiar sin versión recuperable,
se falla cerrado sin cambiar la fijación.

Los tickets preceden a fijación/copia S3; un HEAD inicial describe MIME/tamaño
sin copiar ni cambiar bytes. La página actualiza exclusivamente URLs con CAS sobre
referencias originales, checkpoint/revisión del trabajo y comprobación escrita
de reserva en una transacción Mongo; no reescribe fichas/entradas completas ni
fechas de usuario. Fallar revierte la página, no borra copias ni páginas previas.
Un reintento reconcilia copias de resultado incierto y usa la misma procedencia.
La última página completa el trabajo y libera solo su reserva en la misma
transacción. Un worker obsoleto no puede activar referencias tras completarse.

Fallos/crash conservan reserva y cursor para reanudar el mismo ID, sin TTL ni
desbloqueo por antigüedad. El subbloque 7 añade detención técnica explícita a
STOPPED con auditoría/revisión/reserva transaccionales, sin revertir páginas ni
borrar originales. Detalle en [animal-media-migration-recovery.md](./animal-media-migration-recovery.md).
No se incluye rollback automático a claves mutables. Todas las réplicas deben
usar el protocolo antes del rollout. No hay transacciones Mongo abiertas durante
copias/hash S3. Índices únicos, replica set, permisos/privacidad y pruebas reales
son requisitos de despliegue, no garantías demostradas por mocks.

## Límites

Desde el subbloque 15, los destinos generacionales reservados no pueden usarse
como fuente de migración legacy, aunque no tengan ticket y aunque su foto tenga
formato numérico. Se rechazan antes de inspeccionar/copiar para impedir activar
copias preparadas a través de este protocolo. No aflojar esa guarda para publicar
medios transferidos; su registro específico sigue pendiente. Detalle e impacto
central: [ownership-archive-generations.md](./ownership-archive-generations.md) y
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).

El registro PREPARED de medios transferidos del subbloque 16 tampoco autoriza
esta migración ni crea un ticket legacy; las rutas generacionales siguen denegadas.
Ver [ownership-archive-media-registration.md](./ownership-archive-media-registration.md).

El alcance original de foto y diario excluye medicina e histórico retenido.
La preparación médica explícita se describe arriba. Ambos alcances preservan
el 409 de aceptación mientras falte su activación. Solo migran rutas
actuales validadas del mismo dueño/animal/entrada/adjunto; datos inconsistentes,
medios ausentes, MIME/tamaño contradictorios o tickets nuevos sin confirmar
requieren intervención y no se etiquetan como legacy seguros. No limpieza de
originales/temporales ni cambios IAM/lifecycle. No define vencimiento/cancelación.

La revisión conservada es la primera fijada/verificada; no recupera bytes que
fueron sobrescritos antes de esa fijación. Un origen sin versión recuperable
que cambió después puede requerir recuperación operativa, no refijar contenido
silenciosamente. La detención técnica permite recuperar escrituras sin declarar
la migración completada ni reparar esos bytes. Antes de producción: autorización
operativa, guardas en todas las réplicas y validación de índices/operaciones reales.

## Uso interno y persistencia

`LegacyAnimalMediaMigration.start({ id, animalId, ownerId, ownershipVersion })`
abre un trabajo idempotente y reserva atómicamente; `migrateBatch(id)` procesa
una fase/página. Un trabajo COMPLETED o STOPPED se consulta sin volver a adquirir reserva.
Identidades UUID y versión positivas; actor/autorización deberán añadirse si
algún día se expone una operación administrativa. Hoy no es un endpoint.

Colección `animal_media_migrations`: id único, fase/revisión/cursor, sin TTL.
Tickets existentes incorporan procedencia `legacy`; stagingKey es la fuente
antigua única, nunca un destino PUT de este protocolo. La clave final se deriva
del ID del trabajo y de la fuente, no del reloj de un worker. El control usa
`mediaMigrationRevision` como fence escrito en cada transacción y una reserva
namespaced `media-migration:{id}`; no es una solicitud de transferencia.
El filtro drenado se comparte con el repositorio de propiedad, incluyendo reloj
Mongo para ventanas de carga. Se exige periodo ACTIVE coincidente; la migración
no decide elegibilidad para transferir y puede conservar medios de un inactivo.

Pruebas de sesiones/modelos comprueban que referencia, checkpoint y liberación
se solicitan en la misma transacción, y rechazan conflictos en lugar de anunciar
éxito parcial. No demuestran rollback real de Mongo ni exclusión distribuida;
esa integración sigue pendiente. Copias inciertas no activan referencias hasta
verificación/sellado. Fallos no liberan la reserva a ciegas ni borran fuentes.
