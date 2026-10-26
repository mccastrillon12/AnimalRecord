# Migración interna de medios legacy

Subbloque 6 sobre `92322a3`. Contrato registrado antes de implementar; servicio
implementado y validado localmente con Mongo/S3 simulados. No hay
ejecución al arrancar, endpoint ni comando productivo automático. Implementar
el servicio no autoriza ejecutarlo sobre datos reales.

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

No copia medicina ni histórico retenido; no habilita aceptación. Solo migra rutas
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
