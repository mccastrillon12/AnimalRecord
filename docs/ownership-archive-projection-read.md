# Lectura coherente de proyección bajo sesión del llamador

Subbloque 25, 2026-10-26, base `33aa3dd`. Colaborador interno exportado como
`OwnershipArchiveProjectionRead`, alias de la MISMA instancia Mongo del repositorio
de revalidación/consumo. Sin controller, endpoint, worker o ejecución automática.
**Leer un snapshot NO concede permiso, adquiere un fence de escritura, consume
evidencia ni demuestra vigencia posterior o fin remoto.**

Primera validación real del lector + consumo en el subbloque 27: veinte casos
aprobados sin cambios de código sobre `e72ec8e`, MongoDB 8.0.34/replica set de un
miembro. S3 e insert de negocio sintéticos. Alcance/limpieza y límites:
[ownership-archive-projection-mongo-validation.md](./ownership-archive-projection-mongo-validation.md).

## Contrato

```text
readRecipientProjectionWithinTransaction(selection, session, urlForKey)
selection: runId, archiveId, expectedRunRevision, expectedEvidenceHash
-> { protocol: ARCHIVE_PROJECTION_READ_V1, evidence: selection releída, projection }
```

No pide/genera ID de consumo. Selección con UUIDs, revisión entera segura no
negativa y digest estricto de 64 hexadecimales. Validador de selección compartido
con el consumo, cuyo ID/rechazos previos se conservan. El método de consumo no
cambia su cuerpo de recibo, adquisiciones, abortos o reglas de negocio.

Antes de consultar valida sesión activa/no terminada, transacción efectiva
snapshot/primary/majority y mismo MongoClient para TODOS los modelos. Reutiliza
la misma guarda del consumo, incluida la dependencia localizada de client y
transaction.options del driver instalado. Sesión ajena/inactiva/options incorrectas
se rechazan ANTES de queries y no se aborta una sesión no validada.

No llama startSession/startTransaction/withTransaction/commit/endSession ni
reintenta. Todas las queries usan la sesión recibida. El llamador debe poseer
la sesión, autenticación/autorización y futura transacción de negocio. Los codecs
de URLs son puros/de confianza del backend; urlForKey es síncrono, sin firma,
S3 o I/O. keyFromUrl procede del adapter existente. No se reciben de Flutter.

## Lectura y comparación

1. Relee corrida/cabecera/período/control en la sesión: READY/PLANNED/generación
   materializada, reserva original con epoch/hash, dueño/versión/transferId/hora,
   período ACTIVE, cero activeWrites incluidos legacy y revisiones fijadas de
   preparación/planes/materialización. No acepta consumo previo o cabeceras sin
   vínculo original. La selección debe coincidir con corrida y hash/revisión.
2. Exige observaciones METADATA_OBSERVED y S3_OBSERVED terminales, compatibles,
   no consumidas, con pipelineFence/epoch explícitos. A diferencia del proyector
   puro, esta lectura SÍ exige esa evidencia terminal, sin rellenar corridas viejas.
3. Comprueba conteos Mongo y lee entradas, archivos y registros PREPARED mediante
   cursores id ascendentes, consultas secuenciales de hasta 100 filas cada una
   y la MISMA sesión. Lee como máximo una fila extra antes de rechazar un exceso;
   rechaza páginas/cursor/conteos inconsistentes y conjuntos incompletos. No
   paraleliza operaciones en una transacción. Cero archivos sigue consultando
   explícitamente ausencia de archivos/registros.
4. Invoca el [proyector puro](./ownership-archive-recipient-projection.md), que
   reconstruye planes/registros y valida cobertura/procedencia antes de clonar
   payloads y resolver destinos generacionales. No aplica JSON pointers arbitrarios
   ni convierte antecedentes en registros activos.
5. Reconstruye folds de digests: entradas (ID/contentHash/planHash), manifiesto
   (fileId/definición/registro) y observaciones (fileId/intención/revisión/SHA-256).
   Contrasta conteos, cursores terminales y los tres digests contra la corrida.
   Esto detecta un payload con nuevo plan válido pero distinto del observado;
   no basta con contar filas o aceptar el hash ofrecido por el llamador. No
   relee bytes S3: compara constancias persistidas con el conjunto local.

Devuelve candidato privado y selección explícita releída, sin referencias
mutables al request/datos persistidos. No guarda/loguea payloads, URLs, hashes de
acceso o información clínica. No es un nuevo documento persistido o DTO.
Las queries están acotadas por página, pero el conjunto y proyección completos
se acumulan en memoria; no promete memoria/BSON/tiempo constante para expedientes
grandes. Deben medirse antes de integrar el futuro commit.

En éxito NO escribe controles, cabecera, corrida, registros, propiedad/períodos
o eventos; tampoco incrementa revisiones o consume evidencia. En error, una vez
validada la sesión, intenta abortar TODA la transacción recibida (también posibles
escrituras previas del llamador). Error de aborto no sustituye la causa original.
Un llamador no debe capturar el error para continuar/confirmar otras escrituras.
Un error no demuestra que todos los efectos previos o remotos hayan revertido.

## Carreras e integración obligatoria

Las lecturas snapshot son coherentes con SU snapshot. Otra transacción puede
confirmar consumo, liberar/readquirir reserva o avanzar un fence después de ese
snapshot sin que esta lectura lo vea. Repetir un find dentro de la MISMA sesión
no consulta el estado último. Por eso esta lectura no escribe un supuesto fence,
no bloquea consumidores y no declara inválidos todos los competidores en vuelo.

El futuro commit deberá invocar consumeWithinTransaction con la selección releída
y un ID explícito dentro de la MISMA sesión/transacción, antes de confirmar TODAS
las escrituras de negocio. Ese consumo compite mediante CAS/escritura del control:
un snapshot que pierde no debe confirmar cambios parciales. Conservar candidato
o selección fuera de esa transacción NO autoriza aplicarlos después. La lectura
no prueba que un llamador haya consumido o escrito todo el negocio; tampoco liga
un projectionHash en un recibo durable de negocio, idempotencia que sigue pendiente.

Ejemplos cubiertos con dobles: consumidor ya confirmado invisible al snapshot
antiguo permite calcular candidato local, pero una nueva transacción lo rechaza;
competidor posterior a la lectura impide que el snapshot obsoleto termine su
consumo/escritura conjunta, mediante el doble de snapshot/reintento. No se presentan
estos tests como prueba del comportamiento real del driver bajo concurrencia.

## Validación y límites

Una suite nueva/42 casos simulados: conjunto completo/retención/sin archivos,
aislamiento de salida y ausencia de escrituras, todas las queries en la sesión,
páginas de más de 100 entradas/archivos/registros, selección/sesión/fences inválidos,
datos con planes válidos pero digests distintos, observaciones/cursor alterados,
páginas faltantes/excesivas, aborto de la transacción del llamador preservando
causa, snapshot antiguo y consumo competidor. Alias de módulo sin controllers.
También se repitieron las suites existentes del consumo y su validación compartida.

Regresión seleccionada: **84 suites/1172 pruebas** aprobadas (antes 83/1130).
Build, ESLint de TODOS los TypeScript nuevos/modificados, compilación de los arneses
y git diff --check aprobados. Primer Jest bloqueado por EPERM de caché; repetido
fuera del sandbox con autorización. Ajustados tipos de resultados Jest para lint.
Sin Mongo/S3/AWS real, Docker/infraestructura, migraciones, índices/borrados reales,
despliegues, commits o push. Las quince pruebas reales del bloque 23 no cubren
esta lectura integrada. Ocho suites globales heredadas con fallos siguen aparte;
no se declara verde toda la suite global.

Sin esquemas/índices/TTL/backfill/dependencias o HTTP/DTO/éxitos/errores públicos
nuevos. PUT animal primitivo, clínica/IA/BDA, códigos/categorías/extracción,
acceptedAt/48 h/nameHistory (nombres) intactos. Compatibilidad central en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).

Subbloque 26: [arnés OPT-IN separado preparado](./ownership-archive-projection-mongo-integration.md)
con veinte casos de lectura + consumo/insert sintético en misma sesión, snapshot
obsoleto y dos clientes. Compilación/guardas/descubrimiento/rechazo sin opt-in
verificados SIN Mongo real. Nueva suite requiere su propio opt-in/URI, no amplía
ejecución autorizada de los quince casos anteriores. La primera ejecución real
del nuevo arnés ya está registrada en el subbloque 27; no equivale a publicación.
Siguiente: auditoría de escritores/efectos remotos y contrato de corte estable S3.
No habilitar propiedad/publicación sin corte estable S3,
permisos/retención, captura posterior y commit conjunto/autorización/idempotencia.
No inventar vencimiento/cancelación ni recuperar legacy/MAY_RUN por edad/error.
