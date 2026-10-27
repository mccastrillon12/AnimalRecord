# Arnés Mongo opt-in de lectura y consumo conjuntos

Subbloque 26, 2026-10-26, base `1590c68`. **Preparado/compilado, NO ejecutado
contra Mongo.** Veinte escenarios con modelos/driver reales pendientes de ensayo.
La ejecución anterior de quince casos de consumo no valida esta nueva suite ni
la integración del lector. No habilita transferencia o commit de negocio.

## Alcance y activación separada

- Comando `npm run test:integration:archive-projection`, configuración
  `test/jest-archive-projection-mongo.json`, archivo
  `archive-projection-read.mongo.integration.ts`. Solo descubre esa suite.
  Los comandos de journal/evidencia conservan sus suites; npm test no la ejecuta.
- Requiere AMBAS variables nuevas: `ARCHIVE_PROJECTION_MONGO_TESTS=1` y
  `ARCHIVE_PROJECTION_MONGO_TEST_URI`. Opt-in/URI de aplicación, journal o evidencia
  NO se reutilizan ni habilitan esta suite. GlobalSetup rechaza antes de conectar.
- Mismo parser estricto local: mongodb://, un loopback, puerto explícito
  1024–65535 y replicaSet; solo directConnection=true opcional. No credenciales,
  SRV, base en URI, hosts remotos/múltiples u opciones ambiguas. Hello exige
  primary del replica set indicado y sesiones. Loopback no certifica que el
  servidor sea dedicado: elegir y autorizar un entorno desechable sin túneles.
- Reutiliza ArchiveEvidenceMongoFixture, DOS clientes independientes y namespace
  aleatorio por caso `animalrecord_evidence_test_<UUID sin guiones>`. Reutilizar
  el prefijo no reutiliza una base: el UUID/marker exactos establecen propiedad.
  Lista cerrada de colecciones, marker, comprobaciones, límites, drenaje y
  limpieza sin cambios respecto al [arnés de evidencia](./ownership-archive-evidence-mongo-integration.md).
  No agrega colecciones, no lista/borra bases por prefijo y no usa .env/AppModule.
- La limpieza rechaza namespace/marker/lista extra y cierra conexiones. Puede
  quedar residuo ante fallo de proceso o confirmación incierta del marker: auditar
  el nombre exacto impreso; no ampliar limpieza automáticamente. El arnés no
  instala/inicia/detiene Docker o Mongo ni descarga imágenes.

## Veinte escenarios preparados, NO aprobados contra Mongo todavía

1–4. Lectura sin escrituras seguida de consumo/insert en la MISMA sesión para
expediente con archivos/diario, sin archivos, con antecedentes y devolución a A.
Antes del consumo se comprueba ausencia de writes y visibilidad externa previa.
Se exige una sola identidad de transacción para TODAS las queries monitorizadas,
control/cabecera/corrida/insert, snapshot y commit majority. Antecedentes mantienen
dueño/modo de solo lectura; reserva/READY se conservan. Otro lector nuevo rechaza
el archivo ya consumido.

5. Fallo posterior del llamador revierte guardas e insert sintético; reintento
explícito solo después de comprobar estado anterior.

6–7. Selección inválida o codec de URL incorrecto durante la lectura aborta una
escritura previa del llamador. Aun capturando el error no se puede confirmar la
transacción abortada.

8. Una consulta real fija el snapshot ANTES del competidor. Tras su consumo, el
lector antiguo todavía calcula candidato y puede confirmar una transacción de
SOLO LECTURA. Se exige que no emita updates/inserts: esto demuestra el límite
del snapshot, no un permiso. Una sesión nueva ya rechaza el consumo anterior.

9. Después de leer, otro cliente consume; releer dentro de la misma sesión
conserva el candidato antiguo. El consumo posterior del lector debe fallar y
su insert no confirmarse. Solo quedan marcador e insert del ganador.

10. Dos lectores completos llegan a la barrera CONTROL antes del consumo. Al
liberar primero uno, solo su transacción conjunta confirma. Las barreras pausan
queries reales, no sustituyen resultados o transacciones.

11–14. Otro cliente modifica epoch/preparación/planes/materialización después de
leer. Una relectura conserva el snapshot, pero el posterior CAS/consumo pierde;
no quedan marcadores/inserts parciales. Nueva sesión también rechaza evidencia
obsoleta. Son inyecciones directas en la base sintética, no mutadores de negocio;
epoch +2 con mismo lock no ejecuta cancelación o release/reacquire funcional.

15. Cambio de payload con contentHash/plan local válidos pero distintos del
conjunto observado: el lector debe rechazarlo al reconstruir digests.

16–18. Sesión de cliente ajeno, readConcern local o writeConcern no majority:
rechazo antes de queries, sin abortar la sesión no validada.

19. Lectura y consumo de 101 entradas/archivos/registros para recorrer varias
páginas del lector. La siembra también recorre las observaciones sintéticas.

20. Error de aplicación DESPUÉS de un commit reconocido: consulta durable del
insert técnico y rechazo de reconsumo. No simula fallo de red, pérdida de paquetes
o UnknownTransactionCommitResult del driver.

## Soporte compartido y límites

Se extrae la siembra común del fixture sin cambiar valores por defecto de
seedObserved o ampliar la suite anterior. seedProjectionObserved añade datos
sintéticos de diario/archivos compartidos/antecedentes/devolución; un parámetro
opcional de cantidad permite el caso de paginación. Metadata y S3 se recorren
hasta terminal con presupuestos de páginas; los recibos S3 son SINTÉTICOS. No
se hacen HEAD/GET/PUT ni se firma una URL. Entradas usan create/minimize=false,
igual que el camino de serialización del repositorio.

El llamador de prueba posee transacción explícita snapshot/primary/majority,
sin withTransaction/replay automático. Primero lee, luego consume con selección
releída, y solo después inserta {_id, projectionHash} en _synthetic_joint_writes.
No almacena payload clínico, candidato entero, URL/key o un recibo de negocio.
Este hash en una colección de TEST no implementa idempotencia real ni prueba que
se aplicaron referencias/propiedad/períodos/eventos. No se añade llamador operativo.

Timeout por caso 30 s, límites previos de conexión/socket/operación/commit y
barreras de un uso de 8 s. Operaciones concurrentes registradas para drenarlas
al cerrar. Monitor conserva solo metadatos técnicos, nunca filtros/documentos/URI.
Compilar no verifica comportamiento o duración reales; medir al ejecutar.

## Verificado sin infraestructura

- Build, compilación de TODOS los arneses, ESLint de TypeScript nuevo/modificado
  y git diff --check aprobados. Prettier aplicado; sin nuevas dependencias.
- --listTests de los tres comandos: un archivo distinto por comando.
- Nuevo comando con ARCHIVE_PROJECTION_MONGO_TESTS=0: rechazo esperado en
  globalSetup, exit 1, antes de crear conexión. Variables restauradas en finally.
- Diecinueve casos nuevos sin conexión de opt-in, URI, aislamiento de configuración
  y exclusión del Jest ordinario. Tres suites de guardas: 59 pruebas aprobadas.
- Regresión seleccionada: **85 suites/1191 pruebas**, antes 84/1172. No incluye
  las veinte pruebas Mongo preparadas. Ocho suites globales heredadas con fallos
  siguen separadas; no se ejecutó ni se declara verde toda la suite global.
- Jest y rechazo sin opt-in fuera del sandbox con autorización por EPERM de caché
  conocido. Sin Mongo/S3/AWS/Docker reales, índices/borrados reales, migraciones,
  despliegues, commits o push. Runtime/backend/HTTP/schemas de aplicación intactos.

Siguiente paso: revisar y autorizar ejecución en replica set local dedicado y
desechable, confirmar puerto/topología/versiones y registrar resultados/fallos/
limpieza. No activar opt-in ni arrancar infraestructura automáticamente. Incluso
si pasa en un nodo, faltan multinodo/failover/red/S3 real, corte estable, permisos/
retención, captura posterior y commit conjunto/autorización/idempotencia de negocio.
Transferencia deshabilitada; sin nuevas reglas de cancelación/vencimiento o
recuperación de legacy/MAY_RUN por edad/error.

Contrato del lector: [ownership-archive-projection-read.md](./ownership-archive-projection-read.md).
Impacto central: [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
