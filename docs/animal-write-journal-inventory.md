# Inventario interno de journals por animal

Subbloque 29 implementado sobre `96e05eb`. Contrato definido antes de implementar.
Alcance: lectura de evidencia local,
incluidos journals terminales sin tokens; no recuperación, autorización o corte S3.

Subbloque 31 añade [persistencia separada de efectos de promoción](./animal-media-promotion-persistence.md),
sin conectarla a este lector ni sumar consultas. El nuevo contador opcional
mediaPromotionRevision del journal NO se expone en su allowlist; tampoco se unen
puertas/filas o control como si fueran un snapshot global. El índice recomendado
del inventario sigue sin crearse. Coverage/remoteEffects conservan sus valores.

## Consulta y contrato

`AnimalWriteJournalInventory.list({ animalId, afterOperationId?, limit? })`:
animal y cursor UUID, límite entero 1–50, por defecto 20. Orden lexicográfico por
ID de operación persistido, no por fecha; cursor exclusivo sobre el último item
entregado. Consulta un registro extra para decidir `nextOperationId`.

Filtro Mongo: `claims.animalId == animalId` y, si hay cursor, `id > cursor`.
Sin filtros por lifecycle, callback, versión de propiedad, fecha o activeWrites.
Lee primary/majority, collation simple, proyección explícita y máximo 51 registros.
`maxTimeMS: 5000` limita ejecución del servidor, no la duración total de red.
Errores de consulta/timeout se propagan, nunca se convierten en página vacía.

Índice recomendado para futura revisión operativa: compuesto no único
`{ 'claims.animalId': 1, id: 1 }`, con collation simple. NO se declara en el schema
ni se crea en este bloque, para no añadir construcción automática al arranque.
Se conserva el índice único de id existente; selección de plan/coste requiere
`explain` y validación con datos representativos antes de integrar un caller real.
Límite de resultados no limita todos los documentos examinados. No se fuerza hint
a un índice inexistente ni se ejecuta migración para probar el lector.

Salida: `{ animalId, coverage: 'INCOMPLETE', remoteEffects: 'NOT_ASSESSED', items,
nextOperationId? }`. Cada item contiene operationId/instanceId, inicio de instancia,
kind, issuesUploadUrl, fechas, lifecycle/callback, resultado/fechas locales opcionales,
protocol opcional y SOLO el claim del animal (estado, fecha, ownershipVersion opcional).
No incluye actor, otros claims, auditoría de recuperación, referencias de evidencia,
payload, URLs, datos clínicos o errores. El adaptador proyecta y reconstruye la salida
con lista permitida; claims ausentes/duplicados del animal se rechazan.

`protocol` o ownershipVersion ausentes en journals antiguos siguen ausentes;
UNSPECIFIED, MAY_RUN, ACQUIRE_UNKNOWN, RELEASE_UNKNOWN y terminales se conservan.
No se atribuyen garantías nuevas a registros legacy. Cursor/límite inválidos fallan
antes de consultar; una página excesiva, desordenada, repetida o de otro scope falla.
No se comprueba existencia/propiedad del animal para conceder acceso: NO es una API
pública. Un futuro caller debe autenticar/autorizar expresamente al operador.

## Semántica y concurrencia

- coverage es INCOMPLETE aun con página vacía o sin cursor siguiente. Solo se
  enumeran journals existentes: no todos los writers históricos ni tickets/BDA.
- Cada página es una observación distinta, sin snapshot global ni unión con el
  control actual. Un journal puede avanzar mientras se recorre y un UUID nuevo
  anterior al cursor puede no verse en ese recorrido. Reiniciar tampoco prueba cierre.
- MAY_RUN solo indica posibilidad de callback; LOCALLY_FINISHED indica cierre
  local. Ningún estado, timestamp o ausencia de claim prueba fin remoto/rollback.
- No clasifica operaciones como recuperables, muertas o seguras. No modifica
  journals/controles, reserva, retira tokens, adquiere fence, consume observaciones
  ni incorpora `canCommit`. Recuperación previa al callback conserva su protocolo.

## Integración y límites de validación

Se exporta el servicio desde AnimalWriteJournalModule, reexportado por AnimalModule.
El puerto de lectura es independiente del puerto de escritura del journal; no añade
consultas al CRUD, al arranque o al coordinador. Sin controller/job/script operativo.

Pruebas con modelos simulados: paginación/lookahead y scope, terminales y legacy,
redacción, errores y wiring DI. No demuestran índices/planes reales, majority en
failover, snapshot global, fin remoto o estabilidad S3. Sin llamadas reales Mongo/AWS.
Resultados exactos en [final-delivery-plan.md](./final-delivery-plan.md).

Subbloque 30 ya define contrato durable PROPUESTO y máquina pura de intención/
autorización por efecto de promoción ordinaria foto/diario, con carreras simuladas,
identidad de operación/efecto/intento y retries SDK modelados como intentos nuevos:
[animal-media-promotion-effects.md](./animal-media-promotion-effects.md).
La persistencia ya existe en el 31, con pruebas simuladas de CAS/transacciones/
acks inciertos. El 32 añade [arnés Mongo opt-in aislado](./animal-media-promotion-mongo-integration.md)
preparado/compilado sin conexión. Siguiente: autorizar su entorno desechable antes
de ejecutar y documentar resultados/limpieza. Luego instrumentar/verificar cada envío
real, incluidos retries internos; el inventario sigue siendo evidencia auxiliar,
sin cobertura completa de tickets/BDA, retención o permiso de corte.

Compatibilidad central en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md);
matriz de writers y propuesta de corte en
[animal-transfer-stable-s3-cut.md](./animal-transfer-stable-s3-cut.md).
