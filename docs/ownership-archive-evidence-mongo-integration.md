# Arnés Mongo opt-in para consumo de evidencia

Subbloque 22, 2026-10-26, sobre `043d467`. **Preparado y compilado; NO ejecutado
contra Mongo.** No habilita transferencia ni constituye evidencia real de
atomicidad, rollback o concurrencia. La ejecución anterior de once pruebas del
journal es otro arnés y no valida este protocolo.

## Separación y guardas

- Comando nuevo: `npm run test:integration:archive-evidence`, configuración
  `test/jest-archive-evidence-mongo.json`. Solo descubre
  `archive-evidence-consumption.mongo.integration.ts`. `npm test` y el comando
  anterior del journal no lo ejecutan.
- Requiere AMBAS variables propias: `ARCHIVE_EVIDENCE_MONGO_TESTS=1` y
  `ARCHIVE_EVIDENCE_MONGO_TEST_URI`. No carga `.env`, AppModule, servicios AWS,
  backfills, migraciones ni configuración de aplicación. La autorización opt-in
  del journal no autoriza este arnés. Global setup rechaza antes de conectar.
- Reutiliza el parser estricto anterior: un host loopback, puerto explícito
  1024–65535, `mongodb://`, replicaSet obligatorio y solo `directConnection=true`
  opcional. Sin credenciales, SRV, database en URI ni opciones adicionales. Hello
  exige primary del replica set indicado y sesiones, no mongos. Esto comprueba
  el endpoint/topología, no que el servidor sea exclusivo de pruebas: debe
  seleccionarse un entorno local desechable autorizado, sin túneles externos.
- Namespace NUEVO por caso: `animalrecord_evidence_test_<UUID sin guiones>`.
  No acepta database elegida por entorno/argumentos, no lista/busca/borrar bases
  por prefijo. Dos conexiones/clientes independientes comparten solo esa base.
- Antes de poblar exige base vacía y escribe marcador de dueño con majority.
  Crea explícitamente colecciones/índices de los schemas reales. Solo se permiten
  marcador `_animalrecord_write_test_owner`, controles, períodos, cabeceras,
  entradas, archivos, registros transferidos, corridas de revalidación y
  `_synthetic_joint_writes`. Lista exacta en `EVIDENCE_TEST_COLLECTIONS`.
- Limpieza: primero libera barreras y espera operaciones registradas; después
  verifica namespace generado exacto, marcador/UUID y lista cerrada de colecciones
  antes de dropDatabase con majority. Ante desajuste rechaza borrar y cierra las
  conexiones. Nunca limpia por prefijo o por una URI de aplicación. Un fallo
  antes de confirmar la escritura del marcador puede dejar un residuo: auditar
  manualmente el nombre exacto informado, sin borrado automático ampliado.
- Reutiliza conexión/monitorización/drenaje/limpieza del arnés del journal mediante
  hooks protegidos. La allowlist y el prefijo del journal NO se amplían. Pruebas
  sin conexión verifican perfiles incompatibles y dispatch real de la limpieza
  compartida con dobles (rechazo/borrado permitido y cierre de conexión).

## Quince casos preparados, pendientes de ejecución real

1. Consumo con archivos y escritura conjunta sintética, visibilidad externa solo
   tras commit, recibos iguales y un único incremento. Observación de comandos
   comprueba misma transacción para control/cabecera/corrida/insert, snapshot y
   majority en commit; reserva/estado READY se conservan. Reconsumo y nueva
   corrida sobre cabecera consumida fallan.
2. Mismo caso sin archivos, sin fabricar trabajo remoto.
3. Fallo posterior del llamador: rollback de guardas e insert sintético y reintento
   explícito después de comprobar estado anterior.
4. CAS final de corrida sin coincidencias: un hook cambia el filtro de ESA consulta
   a un ObjectId nuevo; el resultado cero viene de Mongo. Aunque se capture el
   error, la sesión queda abortada y no confirma control/cabecera parcialmente.
5. Dos clientes leen el mismo snapshot y se pausan antes de escribir control;
   al liberar primero uno, solo ese confirma el consumo y la escritura conjunta.
6. Consumidor ya posee el lock de escritura del control; otro cliente envía una
   escritura competidora antes de liberarlo. Esta queda ordenada tras el commit.
   Es inyección de prueba, no un permiso de modificar un archivo consumido.
7–10. Otro cliente cambia preparación, planes, materialización o epoch después
   del snapshot y antes de la escritura del consumidor: no hay consumo parcial;
   una transacción nueva también rechaza la evidencia antigua. El caso epoch
   suma dos conservando idéntico transferLock: modela deriva ABA, no ejecuta
   cancelación ni una secuencia funcional release/reacquire.
11. Error de aplicación DESPUÉS de un commit reconocido: consulta durable muestra
    consumo/insert y otro intento falla sin repetir negocio. No es fallo de red,
    pérdida de paquetes ni UnknownTransactionCommitResult del driver.
12–14. Sesión de otro cliente, readConcern local y writeConcern no majority:
    rechazo antes de queries/escrituras sin abortar una sesión no validada.
15. Índices únicos reales de cabecera/corrida, duplicados y ausencia de TTL.

Barreras de un uso en middleware de schemas clonados, timeout de 8 segundos y
liberación al cerrar. No sustituyen resultados/sesiones Mongo. Transacciones del
llamador explícitas snapshot/primary/majority, sin reejecución automática del
callback; commit limitado a 5 segundos. Conexión/selección/socket/operación tienen
límites. Las operaciones concurrentes se registran para drenarlas aun si falla
una aserción. Solo se retienen nombre de comando/colección y metadatos técnicos
de sesión/transacción/readConcern/writeConcern; no queries, documentos o URI.

Datos completamente sintéticos. Se persisten fixtures del pipeline y se recorre
el repositorio real de metadatos; los recibos S3 son expresamente SINTÉTICOS.
No hay HEAD/GET/PUT ni prueba de contenido remoto. Los cambios competidores del
control se inyectan directamente en pruebas, no añaden mutadores de negocio.
El insert conjunto es una colección de prueba, no propiedad/períodos/eventos reales.

## Comprobado en este bloque

- Build y `npm run test:integration:animal-writes:check`: aprobados. Este último
  incluye TODOS los TypeScript de integración, también el nuevo arnés; no conecta.
- ESLint de todos los TypeScript nuevos/modificados y `git diff --check`: aprobados.
- Descubrimiento `--listTests` de ambos comandos: un archivo distinto por comando.
- Nuevo comando con `ARCHIVE_EVIDENCE_MONGO_TESTS=0`: rechazo esperado en globalSetup,
  sin conexión. Intento inicial bloqueado por EPERM de caché Jest; repetido fuera
  del sandbox con autorización, manteniendo opt-in desactivado.
- Regresión seleccionada: **81 suites/1071 pruebas** aprobadas, frente a 80/1050.
  Incluye 21 casos nuevos de guardas/barreras/limpieza simulada SIN conexión. Las
  quince pruebas Mongo preparadas NO forman parte de ese resultado.
- Sin Mongo/S3/AWS reales, Docker/infraestructura, índices/borrados reales,
  migraciones, despliegues, commits o push. Ocho suites globales heredadas con
  fallos siguen separadas; no se declara verde la suite global.

## Siguiente paso y límites

Revisar este arnés y obtener autorización explícita para ejecutarlo sobre un
replica set local desechable seleccionado. Confirmar puerto/topología/versiones
y variables propias antes de activar opt-in; registrar resultado, fallos y
limpieza en un documento de validación. No arrancar Docker/Mongo automáticamente.
El opt-in es una barrera técnica; no sustituye esa autorización.

Incluso si pasa en un nodo, seguirán pendientes mayoría distribuida, failover,
particiones, respuestas Mongo inciertas y fin remoto S3, además de autorización/
idempotencia de negocio y commit conjunto completo. El consumo es provisional
hasta commit y un marcador aislado no prueba traspaso. No recuperar legacy,
MAY_RUN o efectos remotos inciertos por edad/error. No cambiar vencimiento o
cancelación para avanzar. Transferencia completa permanece deshabilitada.

Contrato de persistencia: [ownership-archive-evidence-consumption.md](./ownership-archive-evidence-consumption.md).
Compatibilidad central: [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
