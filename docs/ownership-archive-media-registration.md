# Registro de medios transferidos: evidencia preparada, no publicación

Subbloque 16 sobre `5bcc64d`. Servicio interno implementado, no ejecutado contra
datos reales. Continúa la materialización generacional del subbloque 15 sin
cambiar planes, manifiestos o intenciones previos.

## Alcance y uso

`OwnershipArchiveModule` exporta `OwnershipArchiveMediaRegistrar` con una única
operación explícita:

```text
registerFile(archiveId: UUID, fileId: hash canónico de 64 caracteres)
```

El llamador aporta solo identidades. Clave, destinatario, revisión, digest y
procedencia se derivan del expediente persistido, no de datos enviados por un
cliente. No hay endpoint, worker, barrido de bucket, script operativo o tarea de
arranque. El futuro orquestador debe validar actor/OTP/solicitud/decisión; este
servicio interno no sustituye esa autorización.

Registra cualquier archivo del manifiesto (foto, diario, documento o antecedente
retenido), no un registro por URL/binding: un documento con storageKey y
documentLocations apuntando al mismo archivo sigue teniendo una sola constancia.
Un archivo sin objetos no necesita registros. La operación está acotada a UN
archivo; el futuro orquestador recorrerá el manifiesto y podrá repetir cada
identidad después de un fallo. No hay cursor/fase global nueva ni afirmación de
que registrar uno signifique registrar el expediente completo.

## Precondiciones y transacción

Cada llamada (también una repetida) usa snapshot/primary/majority y exige:

1. Expediente READY y referencePlan PLANNED coherentes, materialización
   `ARCHIVE_MATERIALIZATION_GENERATIONAL_V1` en MATERIALIZED. V1 anterior se
   rechaza, no se convierte ni adquiere nuevas garantías por un registro.
2. Período ACTIVE del mismo animal/remitente/versión y reserva transferId
   coincidente, sin activeWrites, incluidos legacy. Incrementa el MISMO
   `archiveMaterializationRevision` del control como fence, sin retirar tokens,
   ventanas o reserva. Registro y un futuro commit/recovery deben competir por
   ese control. Un cambio de propiedad/reserva impide continuar registrando.
3. Archivo VERIFIED, intención final reconstruida idéntica, resultado final
   VERIFIED con tamaño/revisión coherentes y sin lease residual. Obtiene un plan
   persistido que referencia ese archivo, ligado al contentHash de su entrada;
   no lee ni duplica el payload clínico en el registro. Usa el resolvedor del
   destino EFECTIVO, no recipientFinalKey/plannedFinalKey directamente.
4. Procedencia LIVE_RESOURCE o RETAINED_READ_ONLY consistente. Antecedentes
   conservan identidad raíz e inmediata/digest y vínculo con history del archivo.
   No se convierten en recursos activos ni se atribuye su autoría al remitente.

La inserción del registro y el fence se confirman juntos. No hay S3 ni callbacks
de negocio dentro de la transacción. Error de validación/índice no autoriza
reescribir evidencia, cambiar una ruta o liberar el lock. El servicio no hace
compensaciones/borrados ni interpreta errores como rollback del negocio remoto.

## Persistencia e identidad

Colección separada `animal_transferred_media`, protocolo
`ARCHIVE_MEDIA_REGISTRATION_V1`, estado único y explícito **PREPARED**. No es
`animal_media_uploads`, un ticket sellado ordinario, publicación o permiso.

Cada constancia guarda id determinista por protocolo/archiveId/fileId, hashes
de definición del expediente, materialización, manifiesto e intención; animal,
remitente, destinatario, período/versión fuente y transferencia; key efectiva,
ETag/tamaño/VersionId cuando existe, SHA-256, modo y procedencia retenida cuando
corresponde. fromOwnerId identifica al custodio/remitente inmediato, NO al autor
original del contenido clínico. No inventa VersionId ni fecha efectiva de traspaso.

Se proyectan campos técnicos permitidos; no se copian propiedades adicionales de
metadata Mixed de verificación. No hay payload clínico duplicado, errores crudos,
credenciales, URLs firmadas, flags de capacidades ni instrucciones de activación.
Las keys son rutas técnicas internas y deben tratarse como datos sensibles;
no registrar el objeto completo en logs ni devolverlo desde endpoints existentes.

Índices únicos declarados para id, key y (archiveId,fileId), sin TTL/defaults ni
reciclaje. Verificar realmente índices/permisos antes de usar el servicio. El
nuevo modelo se registra en Mongoose; según la configuración de autoCreate/
autoIndex del despliegue puede exigir creación de colección/índices al iniciar.
Declararlos/compilar no demuestra su creación real. No se arrancó AppModule,
ejecutó migración o creó una colección real durante este desarrollo.

Reintento bajo reserva válida compara todos los campos de la constancia, no solo
su hash almacenado. Ignora únicamente _id/__v de Mongo; otra evidencia, estado,
revisión o propiedades adicionales falla cerrado. No hay upsert que reemplace
una fila: una colisión única concurrente aborta y requiere releer/repetir la misma
identidad. Tras respuesta de commit perdida, el registro puede existir; repetir
reconcilia esa constancia. Si la reserva ya cambió, se rechaza aun si el registro
existe: no es un lector histórico o mecanismo para saltarse el fence.

## Separación de publicación

No modifica Animal.ownerId, períodos, referencias del diario/documento, planes,
manifiestos, cabecera, reservas o accesos históricos. Solo inserta la constancia
y escribe el fence técnico del control. No crea outbox/notificaciones ni marca
aceptación. No registra un estado PUBLISHED o método de activación.

Las guardas del subbloque 15 se conservan SIN excepciones por registro: emisión,
confirmación ordinaria (incluso URL actual o ticket ordinario), migración legacy
e inspección/captura siguen denegando destinos generacionales. Registrar no
permite usar esos flujos para publicar ni volver a capturar una generación.
La captura automática mantiene su guarda del período inicial/sin CLOSED.

El registro reutiliza evidencia persistida, no vuelve a leer S3. Un archivo puede
haber desaparecido o cambiado después de la materialización; PREPARED no afirma
que siga disponible ni que hayan terminado efectos remotos tardíos. Antes de
publicar faltan revalidación del manifiesto COMPLETO y del S3/corte estable,
registro de la fecha efectiva y commit conjunto recuperable de referencias,
propiedad, períodos, auditoría/eventos/notificaciones. No aflojar guardas para
avanzar. Sigue pendiente retención, permisos/descargas históricas y recuperación.

## Compatibilidad y siguiente paso

Contrato completo centralizado en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
No nuevos HTTP/DTO/éxitos/errores públicos, incluido PUT animal primitivo. No
cambia el runtime médico/BDA, categorías, códigos, acceptedAt/48 h o nameHistory
(nombres). Cancelación/vencimiento siguen sin confirmar. Sin backfill sobre
registros existentes ni conversión de materializaciones V1 atascadas.

Siguiente bloque concreto: preparar la revalidación final paginada y ligada al
manifiesto completo, planes, destinos efectivos y registros PREPARED, sin activar
referencias todavía. Definir cómo compite con los escritores/copias en vuelo y
el futuro commit antes de emitir una evidencia global. No confundir esta
revalidación con el corte S3 estable o la aceptación completa.

Actualización subbloque 17: disponible el
[recorrido paginado de metadatos](./ownership-archive-metadata-revalidation.md),
con reconstrucción del plan y verificación de cobertura/registros del conjunto.
No lee S3 ni da permiso de commit. Su revisión compartida queda obsoleta si se
registra/materializa después (incluso un registro repetido): completar el registro
antes de iniciar la corrida. El texto anterior describe el siguiente paso al
cierre original de este bloque; observación S3/commit siguen pendientes.

Actualización subbloque 18: disponible la
[observación S3 de solo lectura](./ownership-archive-s3-observation.md), ligada
al recorrido de metadatos y a estos registros. No cambia PREPARED, da permisos,
repara o activa medios. S3_OBSERVED no equivale a corte estable o permiso de
commit; publicación/consumo y acceso histórico continúan pendientes.

## Validación

Pruebas nuevas de dominio, aplicación y adaptador con dobles de sesiones/modelos:
proveniencia, identidad y privacidad, repetición, snapshot obsoleto/competidores,
respuesta de commit perdida, pérdida de reserva, índices declarados y separación
de los protocolos ordinarios. Las pruebas de transacción usan un doble optimista
con reintento, NO prueban rollback/majority/exclusión distribuida o índices Mongo
reales. No hay consultas S3 ni evidencia del bucket. Los resultados definitivos
se registran en el plan de entrega; ocho suites globales heredadas siguen como
deuda separada.

Resultados finales: **68 suites/764 pruebas** en la regresión seleccionada
(antes 65/708), build, ESLint de TypeScript nuevo/modificado, compilación del
arnés existente y `git diff --check` aprobados. Tres suites nuevas/56 casos.
No ejecución real Mongo/S3/AWS, arranque de AppModule, migraciones, borrados,
despliegues, commits o push. No se declara verde toda la suite global.
