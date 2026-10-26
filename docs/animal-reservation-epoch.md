# Identidad monotónica de reservas e invalidación de observaciones

Subbloque 19, 2026-10-26, sobre `f09632c`. Implementado internamente y probado
con dobles. No habilita transferencias, recuperación general, consumo de evidencia
o commit de propiedad. No se ejecutaron operaciones reales Mongo/S3.

## Problema y alcance

Comparar transferId/lockedAt no distingue una reserva que se liberó y readquirió
con los mismos valores (ABA). archiveMaterializationRevision solo observaba
mutadores del pipeline. Se añade reservationEpoch opcional al control: contador
monotónico persistido, independiente de reloj, ownershipVersion y contadores de
página/pipeline. Se incrementa en la MISMA escritura que adquiere o libera una
reserva. No se decrementa, resetea, borra ni deriva de fechas.

Ausente identifica controles previos al protocolo; NO equivale a cero persistido.
El primer límite exitoso sobre un campo ausente lo incrementa a 1. Se exigen
enteros seguros no negativos; una identidad reservada exige valor positivo.
Un incremento que excedería Number.MAX_SAFE_INTEGER se deniega sin modificar el
control. No se satura ni recicla: requiere otro protocolo operativo si se agota.
No hay default, backfill, índice, colección, TTL o limpieza nuevos.

## Mutadores auditados

| Camino actual | Comparación e incremento |
| --- | --- |
| MongoAnimalOwnershipRepository.acquireTransferLock | Conserva dueño/versión, ausencia de lock/escritores y ventana Mongo. Añade CAS del epoch esperado e incremento atómico. |
| MongoAnimalOwnershipRepository.releaseTransferLock | Exige animal/transferId y epoch esperado exacto, libera e incrementa juntos. Una llamada atrasada no libera la siguiente reserva. |
| Inicio de MongoLegacyMediaMigrationRepository | Lee control dentro de su transacción, compara epoch observado, adquiere/incrementa y guarda el nuevo valor en el trabajo junto con su creación. |
| Página COMPLETED de migración | Trabajo y control comparan epoch persistido; URLs/checkpoint/liberación e incremento final comparten transacción. |
| stopForRecovery de migración | Usa el epoch del trabajo leído, no uno suministrado por un cliente; auditoría/terminal/liberación e incremento van juntos. |

La búsqueda de escritores de transferLock en src no encontró otros mutadores.
Inicialización de propiedad es insert-only y no resetea este campo. beginWrite
(con journal o legacy) exige ausencia de reserva; endWrite, recordUploadWindow y
recuperación previa a MAY_RUN no adquieren/liberan reservas ni retiran este campo.
No se amplía su recuperación o idempotencia. El inventario sigue siendo una
proyección de observaciones/IDs, NO un validador del epoch o permiso operativo.

## Contrato interno de captura y compatibilidad legacy

acquireTransferLock conserva boolean y recibe expectedReservationEpoch opcional.
Omitirlo compara estrictamente campo AUSENTE; no lee/adopta el epoch actual por
cuenta del llamador. true acredita la transición al valor esperado + 1 (ausente
→ 1), solo tras acknowledgement de mayoría. false no modifica el contador.
Una excepción mantiene resultado incierto: no repetir como si fuera éxito ni
limpiar/refijar automáticamente. Repetir tras un commit ya confirmado no adopta
la reserva existente. La identidad no es autorización del actor.

releaseTransferLock(animalId,transferId,expectedReservationEpoch?) mantiene
boolean. Omitir el epoch solo puede liberar una reserva legacy cuyo control
todavía carece de ese campo, incrementándolo a 1. No libera una reserva nueva.
Para las nuevas, el llamador debe conservar el valor obtenido por su propia
adquisición; nunca consultar el actual solo para hacer coincidir una liberación
antigua. Esto NO autoriza liberar reservas de archivos iniciados o inciertos.

OwnershipArchiveCapture observa control/dueño/versión antes de adquirir y pasa
ese epoch al CAS. Durante su preflight nuevo compara el valor adquirido; ante
denegación previa a intentar cabecera, libera SOLO ese epoch y conserva el error
original si la liberación falla. Readquisición idéntica o respuesta incierta no
permiten desbloquear. La guarda del período inicial/IA/legacy sigue intacta.
Este valor todavía NO está persistido en la cabecera de captura: no afirmar
atomicidad entre último check de preflight y preparer.begin, ni que reanudar una
cabecera ya existente haya ganado protección epoch completa. Es el siguiente bloque.

Nuevos trabajos de migración guardan reservationEpoch opcional sin default.
Sus páginas/control comparan el valor y el checkpoint también lo compara contra
el trabajo persistido. Trabajos anteriores sin campo solo operan bajo control
también sin campo; no se les asigna el epoch de una reserva posterior. Su primera
liberación nueva incrementa el control. STOPPED/COMPLETED repetidos conservan el
replay previo sin tocar una reserva posterior. No se reinician ni convierten.

## Observaciones Mongo/S3

Nuevas corridas de metadatos requieren reserva con epoch positivo soportado y
lo fijan en reservationEpoch; reservationHash liga también ese valor. Cada
página, inicio repetido y replay terminal compara epoch, hash y revisión del
pipeline. El CAS escrito sobre control incluye el epoch, de modo que liberación
y checkpoint compiten por el MISMO documento. Si checkpoint gana, una liberación
posterior vuelve obsoleta la evidencia; si libera primero, la transacción de
checkpoint falla/reintenta y no avanza sobre la nueva reserva.

La observación S3 hereda esos checks y su metadataHash liga epoch/reservationHash
cuando están presentes. GET sigue fuera de las transacciones: puede terminar
después de una liberación, pero no confirmar bajo otra identidad. No se cambia
la fase de corridas antiguas u obsoletas para simular vigencia.

Corridas persistidas sin epoch se conservan legibles como datos históricos,
pero los servicios de inicio/reanudación/terminal las rechazan; no se retroadapta
su definición/hash ni el subdocumento S3. Una corrida nueva debe ser explícita y
recorrer todo otra vez bajo una reserva válida, no parchear el registro anterior.
Una reserva legacy sin identidad tampoco permite iniciar una corrida nueva.
NO liberar/readquirir esa reserva solo para hacer pasar la validación: recuperación
de archivos y autorización operativa requieren protocolo de evidencia distinto.

## Límites y siguiente paso

Este contador versiona transiciones de reserva, NO cada escritura ni contenido
activo. No es prueba de muerte de instancia, rollback, liveness, fin de PUT/copias
tardíos, inmutabilidad S3 o corte estable. Desplegar TODOS los mutadores actualizados
y drenar los anteriores antes de usar la garantía: una réplica antigua puede
ignorar los CAS. Escrituras administrativas, borrado/recreación del control,
restauración de backups o modificación directa del contador quedan fuera del
protocolo. Sin ejecución real/rollout ni autorización implícita para intervenir.

Preparación, copias, antecedentes, planes, materialización y registro siguen
teniendo sus guardas anteriores; NO todos están ligados a un epoch persistido
en cabecera. Sus efectos/avances tardíos aún requieren tratamiento. Una nueva
corrida válida revisa el archivo preparado, no prueba que corresponda todavía
al expediente activo tras intervenir o liberar. METADATA_OBSERVED/S3_OBSERVED
siguen sin permiso de consumo/publicación/aceptación.

Siguiente paso concreto: fijar identidad de reserva en NUEVAS cabeceras de
preparación/captura y exigirla en todos sus mutadores/checkpoints, cubriendo
trabajo atrasado tras ABA. No adoptar cabeceras previas automáticamente ni
alterar hashes originales en silencio; diseñar compatibilidad primero. Luego
consumo/commit conjunto y evidencia de efectos remotos, retención/acceso histórico
y captura posterior. Sin cambio de vencimiento/cancelación ni de nameHistory.

## Validación e impacto frontend

Tests con doble optimista de modelos/snapshots, no integración Mongo: ABA con
mismo ID/hora, ambas ordenaciones de checkpoint/liberación, replay terminal,
liberación atrasada, adquisiciones concurrentes, ausencia/cero/datos corruptos/
agotamiento, exclusión de evidencia antigua, preflight que no libera otra reserva
y filtros/creación/liberación de migraciones. No demuestran rollback/mayoría/
índices/exclusión distribuida reales o cierre remoto. Comandos/resultados en el
plan; ocho suites globales heredadas siguen separadas.

No cambia runtime HTTP, DTO/cuerpos/éxitos/errores públicos ni PUT animal primitivo.
No cambia clínica/IA/BDA/códigos/categorías/acceptedAt/48 h. El impacto operativo
de controles/corridas previos y las instrucciones de integración están
centralizados en [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
