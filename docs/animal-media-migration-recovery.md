# Recuperación operativa de migraciones de medios

Subbloque 7 sobre `d6e2b53`. Contrato registrado antes de implementar; servicio
implementado y probado localmente con Mongo/S3/sesiones simulados. Alcance:
servicios internos explícitos, sin endpoint, cron, ejecución real ni limpieza.
STOPPED es un estado técnico de migración, NO cancelación de una transferencia.
Vencimiento y cancelación de transferencias siguen sin definición.

## Contrato anterior/nuevo e integración frontend

- Antes: una migración interrumpida solo podía reanudarse con el mismo ID;
  una fuente fijada irrecuperable podía dejar la reserva bloqueando escrituras.
  Nuevo: un operador autorizado por el futuro llamador interno puede detener
  ese trabajo por ID/revisión observados, solicitud idempotente, actor, motivo
  técnico y referencia de evidencia. No se dispara por edad ni por fallar S3.
- La detención conserva TODAS las URLs/metadatos/fechas actuales, incluidas
  páginas ya migradas; no revierte a fuentes mutables, no borra originales,
  tickets, objetos ni tokens. Tras confirmar transacción libera SOLO su reserva
  y las escrituras vuelven a pasar por sus permisos/validaciones habituales.
  Flutter refresca antes de reintentar y no interpreta esto como transferencia
  aceptada, rechazada o cancelada. No se añade botón/estado de recuperación móvil.
- Foto/diario conservan DTO, bodies y éxitos. Endurecimiento explícito: una URL
  de copia de migración solo se reconfirma si ya es la referencia actual del
  recurso. Copias preparadas pero no activadas o fotos migradas desplazadas dan
  409 para refrescar; no se activan desde PATCH/POST por conocer su URL. Adjuntos
  sealed que no existen siguen rechazándose por la validación vigente de ruta.
  Confirmaciones canónicas actuales siguen idempotentes. Cargas nuevas normales
  no migradas mantienen su confirmación después del PUT.
- Ningún contrato clínico, de catálogo/buscador, foto de usuario o nombre/propiedad
  cambia. Las mismas rutas coordinadas pueden estar bloqueadas hasta la detención;
  GET puros siguen disponibles. No implica que archivos ausentes reaparezcan ni
  que todos los medios de un trabajo detenido sean transferibles.

## Garantías y requisitos del protocolo

Subbloque 19: stopForRecovery exige además el epoch persistido en nuevos trabajos,
y lo incrementa junto a liberar en la transacción. Un trabajo legacy sin campo
solo coincide con control sin campo; no se rellena desde la reserva actual.
Repetir STOPPED sigue sin tocar reservas posteriores. Sin ampliar autorización,
recuperación o reglas de cancelación. El inventario conserva su significado
observacional, no valida este epoch. Detalle:
[animal-reservation-epoch.md](./animal-reservation-epoch.md).

`stopForRecovery`: relee trabajo, comprueba fase PROFILE/DIARY, revisión exacta,
dueño/versión/periodo ACTIVE y su reserva namespaced sin escritores. Cambiar a
STOPPED, incrementar revisión, persistir auditoría y liberar su reserva con fence
escrito ocurre en una transacción corta snapshot/primary/majority. Si el cursor
avanzó, hay otra reserva o datos inconsistentes, falla cerrado sin liberar.
Un reintento tras respuesta perdida usa el mismo requestId y payload y devuelve
la misma detención, sin tocar una reserva posterior. El mismo ID no se reinicia.

Una página concurrente y la detención compiten por la misma revisión escrita;
solo una gana. Una página obsoleta no cambia referencias ni libera la nueva
reserva. Las copias S3 ya iniciadas pueden acabar dejando huérfanos bajo sus
claves exclusivas, con bytes fijados: no escriben URLs Mongo y nunca sobrescriben
originales/finales. No se promete cancelar peticiones remotas ni limpiarlas.
No refijar una fuente cambiada ni reciclar ticket/clave para resolver el fallo.

La evidencia/actor se conservan para auditoría, no son prueba de muerte de una
instancia ni autorizan limpiar tokens generales. El llamador operativo futuro
deberá autenticar/autorizar al operador; hoy no existe ruta pública. Nunca usar
este método sobre reservas de archivo/transferencia o controles sin su trabajo.

## Inventario de solo lectura y pendientes

Inventario interno paginado por animalId de controles con activeWrites o reserva,
proyección mínima, primario/mayoría y consulta acotada de trabajos asociados.
No usa una fecha límite ni etiqueta automáticamente tokens como huérfanos.
Son observaciones, no una instantánea transaccional ni permiso para desbloquear:
la acción siempre relee y exige revisión/reserva actuales.

La recuperación de tokens de otros escritores y de reservas de captura/archivo
sigue pendiente: requiere identificar operación/instancia y demostrar fin de
escrituras/efectos remotos inciertos. No se añade borrado de arrays ni force-unlock.
Una fuente irrecuperable no se repara automáticamente al detener; el propietario
podrá corregir su medio con los flujos autorizados y una futura migración deberá
volver a validar procedencia. Un ticket antiguo no se reasigna a otro trabajo.

Antes de ejecutar recuperación real: todas las réplicas con guardas actualizadas,
autorización operativa explícita, pruebas Mongo replica set y S3 reales de carreras,
rollback y respuestas perdidas. Los mocks no demuestran esas garantías reales.
No habilita aceptación integral, históricos, limpieza ni notificaciones.

## Uso interno y trazabilidad

`LegacyAnimalMediaMigration.stopForRecovery({ id, expectedRevision, requestId,
operatorId, reason, evidenceRef })`: UUIDs de trabajo/solicitud/operador, revisión
entera no negativa, reason SOURCE_REVISION_UNAVAILABLE u OPERATOR_INTERVENTION,
evidenceRef no vacía (máximo 200 caracteres, sin saltos ni espacios exteriores).
La evidencia debe referenciar un incidente/revisión, nunca contener credenciales,
URLs firmadas o expediente clínico. El requestId es idempotente dentro del ID del
trabajo y todos los campos deben coincidir al repetir. Se persiste la auditoría
en `recovery` junto con stoppedAt; no se acepta completar/detener dos veces con
otra definición. La recuperación no se ejecutó sobre datos reales.

`AnimalWriteRecoveryInventory.list({ afterAnimalId?, limit? })` devuelve items
y nextAnimalId si existe otra página. Límite 20 por defecto, máximo 50, más una
fila de lookahead. Solo modelos/columnas de coordinación, sin ficha clínica ni
credenciales. La asociación con migración distingue NOT_MIGRATION, MATCHED,
MISSING y MISMATCH; MATCHED solo significa que coinciden IDs/dueño/versión, no
que una reserva sea válida o recuperable. Una migración STOPPED que aún figure
reservada se muestra como inconsistencia observable, no se corrige automáticamente.
Los servicios se exportan desde AnimalMediaModule; no son APIs para Flutter.

`AnimalMediaUploads.confirm` recibe internamente currentUrl de la lectura del
recurso hecha por el caso de uso, NUNCA del body del cliente. Solo se exige para
copias legacy de migración; la transacción de página es su única vía de primera
activación. No exige backfill de tickets migrados previamente: una referencia ya
actual mantiene su idempotencia. Toda réplica que pueda confirmar debe tener esta
guarda antes de habilitar stopForRecovery.

La seguridad de detener no depende de declarar muerto al worker: sus mutaciones
Mongo quedan excluidas por fase/revisión y sus efectos remotos conocidos escriben
solo claves de copia aisladas. Esto NO se extrapola a tokens HTTP generales,
cuyos callbacks y efectos remotos todavía requieren otro protocolo de recuperación.
