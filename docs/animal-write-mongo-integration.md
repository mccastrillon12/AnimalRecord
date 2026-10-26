# Integración opt-in del protocolo de escrituras en Mongo

Subbloque 10 sobre `e3be10f`, confirmado en `8ffe44c`. Primera ejecución real en
el subbloque 11, 2026-10-25: **1 suite y 11 pruebas aprobadas** sobre MongoDB 8.0.34,
replica set local de un nodo. Entorno, digest y límites registrados en
[animal-write-mongo-validation.md](./animal-write-mongo-validation.md). No habilita transferencias
ni amplía la recuperación más allá del permiso de callback del subbloque 9.

## Alcance y separación de ejecución

`npm run test:integration:animal-writes` usa una configuración Jest independiente
y el archivo `test/animal-transfer/integration/animal-write-protocol.mongo.integration.ts`.
El nombre no coincide con `.spec.ts`: `npm test`, la regresión seleccionada y el
arranque de la aplicación no ejecutan esta suite. Un globalSetup exige activación
explícita antes de cargar los escenarios. No importa AppModule, dotenv, servicios
AWS, inicializadores, seeders ni backfills de la aplicación.

El arnés abre dos conexiones Mongoose independientes a una sola base desechable
generada por ejecución. Usa los schemas y adaptadores Mongo reales de control y
journal, y el servicio de recuperación interno real. Ficha/periodos solo aportan
dependencias del constructor: sus colecciones no se crean ni se siembran.
Las barreras son middleware de los modelos de prueba clonados: demoran consultas,
sin simular sus resultados ni la atomicidad/reintentos de Mongo. No se modifican
los schemas originales ni el código de ejecución del backend.

## Configuración explícita y aislamiento

Antes de ejecutar, disponer de un replica set **local dedicado a pruebas**, ya
inicializado y con primario disponible. El arnés no instala, inicia, configura,
reinicia o detiene Mongo/Docker, ni configura failpoints del servidor.

Variables exclusivas del arnés:

- `ANIMAL_WRITE_MONGO_TESTS=1`: consentimiento explícito de ejecución. Sin él,
  el comando falla antes de crear conexiones; no omite silenciosamente la suite.
- `ANIMAL_WRITE_MONGO_TEST_URI`: obligatorio, sin fallback a ninguna URI de la
  aplicación ni lectura de `.env`. Solo `mongodb://` a un único `127.0.0.1`,
  `localhost` o `[::1]`, puerto explícito entre 1024 y 65535 y parámetro replicaSet.
  Rechaza credenciales, SRV, hosts remotos/múltiples, base en la ruta, fragmentos,
  parámetros desconocidos/duplicados y directConnection distinto de true.

La conexión fuerza directConnection=true y primario. Antes de crear colecciones
comprueba con hello el nombre del replica set, primario escribible y sesiones;
rechaza standalone/mongos. La URI no elige el nombre de la base: se genera
`animalrecord_write_test_` seguido de 32 dígitos hexadecimales aleatorios de UUID.
El namespace es inmutable y debe estar vacío. Se imprime su nombre técnico al
iniciar para identificar exactamente recursos de prueba si se interrumpe el
proceso; no se imprime la URI. No usar un puerto reenviado a un
entorno remoto o compartido; loopback por sí solo no comprueba cómo fue provisionado
el servidor. La base de la aplicación nunca se selecciona por configuración.

La suite crea únicamente un marcador privado de ejecución y las colecciones
animal_ownership_controls/animal_write_journals, con sus índices reales.
Guarda metadatos de comandos en memoria con allowlist: cliente, comando/colección,
identidad técnica de sesión/transacción, petición de snapshot y mayoría. No
retiene filtros, documentos, URI o payloads clínicos en esa evidencia.

Al terminar libera las barreras, espera operaciones observadas y cierra conexiones.
La limpieza solo borra la base generada después de releer/verificar nombre exacto,
UUID del marcador y lista cerrada de colecciones. Ante marcador ajeno/ausente,
nombre cambiado o colección inesperada se rechaza el borrado. No borra por prefijo,
no recorre otras bases ni limpia datos de aplicación. Si falla el arranque antes
de reconocer el marcador o se pierde el proceso, pueden quedar recursos de esta
base de prueba: investigar su identidad antes de cualquier limpieza manual.

## Comandos preparados (PowerShell)

Comprobaciones que no abren Mongo:

```powershell
npm run test:integration:animal-writes:check
npm run test:integration:animal-writes -- --listTests
```

El primero compila los archivos de integración y sus imports con noEmit. El
segundo verifica descubrimiento de la suite; listar NO ejecuta globalSetup ni
demuestra que el servidor esté listo.

Ejemplo de ejecución, solo después de preparar y autorizar el entorno
local dedicado; ajustar el puerto y el nombre del replica set al entorno real:

```powershell
$env:ANIMAL_WRITE_MONGO_TESTS = '1'
$env:ANIMAL_WRITE_MONGO_TEST_URI = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test&directConnection=true'
npm run test:integration:animal-writes
```

La suite tiene límites técnicos de prueba: selección/conexión 3 s, socket 10 s,
presupuesto de cliente/transacciones 15 s, barreras 8 s y casos Jest 30 s.
Estos límites no son TTL de tokens, cancelación ni vencimiento de transferencias.
Un fallo no autoriza retirar tokens fuera de la base desechable.

## Escenarios implementados y ejecutados en el subbloque 11

1. Índices únicos reales de journal/control, rechazos de IDs reutilizados y
   ausencia de TTL.
2. Inserción de token y autorización del journal con la misma sesión/transacción;
   evidencia de snapshot y solicitud de mayoría en el commit reconocido.
3. Autorización del journal denegada que aborta una inserción tentativa de token.
4. Recuperación que gana frente a una adquisición cuyo control ya está escrito
   pero aún no confirmado: la adquisición tardía no puede dejar un token.
5. Adquisición que gana mientras recuperación sostiene un snapshot previo: Mongo
   debe reintentar la recuperación y la auditoría debe observar/retirar ese token.
6. MAY_RUN que gana después de retiradas tentativas: recuperación denegada y
   tokens preservados al abortar la transacción.
7. Recuperación que gana frente a una autorización MAY_RUN en vuelo: permiso
   denegado y terminal consistente.
8. Error de identidad legacy en un segundo animal: ninguna retirada parcial
   del primero ni auditoría terminal confirmada.
9. Adquisición con commit real cuyo resultado se oculta al llamador: evidencia
   ACQUIRED/token persistidos, NOT_INVOKED sin permiso y recuperación posterior.
10. Recuperación con commit real cuyo resultado se oculta al llamador: reintento
    idéntico conserva la auditoría y una reserva posterior; payload diferente falla.
11. NOT_INVOKED con permiso previo y journals sin marca del protocolo nuevo:
    recuperación denegada, compatibilidad conservadora y rollback de claim tardío.

Los casos 9/10 inyectan un error **en el límite de aplicación después de que el
driver confirmó un commit real**. No simulan una respuesta de Mongo, pero tampoco
prueban pérdida de paquetes, UnknownTransactionCommitResult, caídas de red o failover.
Las barreras no se insertan en los callbacks de negocio ni los reejecutan.

## Validación disponible y límites

Se comprobaron guardas sin conexión, compilación del arnés, descubrimiento de la
suite y rechazo del comando sin opt-in en el subbloque 10. El subbloque 11 ejecutó
los once casos con éxito y comprobó la limpieza real del entorno desechable;
resultados y topología en [animal-write-mongo-validation.md](./animal-write-mongo-validation.md)
y [final-delivery-plan.md](./final-delivery-plan.md). La regresión ordinaria sigue
usando mocks y no ejecuta estos once casos. La evidencia se limita al entorno
exacto registrado, no a un despliegue ni a otras topologías/versiones.

Incluso una ejecución aprobada en un replica set de un solo nodo verifica el
protocolo transaccional allí; no demuestra durabilidad entre varios nodos,
elecciones/failover, disponibilidad bajo particiones, efectos S3 tardíos,
rollout mixto, autorización del operador o idempotencia de negocio. Estos siguen
siendo requisitos separados antes de producción y de habilitar aceptación.

El contrato de ejecución del backend no cambia en este bloque. Revisión central
de compatibilidad en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
Protocolo que se probará: [animal-write-journal.md](./animal-write-journal.md).

Primera ejecución local completada; futuras topologías/versiones necesitan su
propia ejecución registrada. El siguiente bloque de implementación es incorporar
antecedentes retenidos con procedencia y pruebas A→B→C/devolución, sin retirar
la guarda del periodo inicial hasta garantizar captura completa. No ampliar
recuperación a legacy/MAY_RUN por inferencia.
Autorización del llamador operativo, antecedentes retenidos, recuperación general,
conservación/activación y reglas pendientes de negocio permanecen separadas.
