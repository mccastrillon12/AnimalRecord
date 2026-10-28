# Arnés Mongo + dispatcher con transporte S3 falso

Subbloque 38, base `13a2146`, 2026-10-27. Contrato registrado antes del código.
Estado: **preparado y compilado, 21 escenarios NO ejecutados contra Mongo**.
57 pruebas sin conexión aprobadas; producción y callers sin integración.
Alcance: pruebas opt-in del dispatcher aislado contra los adaptadores Mongo reales.
No se ejecutó Mongo en este bloque.

Comando y opt-in independientes de persistencia: test:integration:media-promotion-dispatch,
MEDIA_PROMOTION_DISPATCH_MONGO_TESTS=1 y MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI.
Reutiliza parser loopback estricto, dos clientes, monitor, índices declarados,
siembra desde create NOT_STARTED con marca inicial y protocolo de adquisición/
permiso. Namespace nuevo animalrecord_dispatch_test_<UUID sin guiones> por caso;
allowlist cerrada propia de las mismas cinco colecciones, sin ampliar anteriores.
No cargar .env/AppModule, arrancar infraestructura, usar Atlas o credenciales AWS.

El S3Client/NodeHttpHandler del dispatcher son reales, con credenciales sintéticas
y regiones explícitas. https.request se sustituye por streams/respuestas de guion;
http.request se deniega. Socket.connect solo permite loopback y el puerto Mongo
seleccionado, incluidas formas normalizadas de Node; el resto falla cerrado.
No simular send/handle ni inyectar handlers nuevos en producción. El doble conserva
solo método/path/source, no firmas, Authorization o credenciales. Es un arnés de
confianza, no aislamiento del proceso frente a edición maliciosa de las pruebas.

Escenarios: foto/diario con permiso durable observado por el otro cliente antes
de petición nativa falsa; retries/redirect con intentos/permisos separados;
sellado/revocación/cierre antes de permiso; permiso reconocido/reply pausado que
puede enviar después de sello/revocación; ack perdido tras commit real reconocido;
fallos/conflictos de evidencia y dos dispatchers. UNKNOWN conserva los permisos.
Ningún resultado sintético prueba ACK/MATCH, copia remota, seal verificado o corte.

Las pausas tienen límite y se liberan antes de drenar sends observados. Luego se
destruyen dispatchers, se comprueba y borra únicamente el namespace propio y se
cierran ambos clientes. Las guardas de transporte se mantienen durante limpieza
y se restauran al final, también ante fallo. Un fallo de proceso puede dejar
residuos; no autoriza barrer bases por prefijo ni ampliar el alcance de limpieza.

La ejecución futura requiere autorización específica de replica set desechable,
puerto/topología/versiones, ausencia de túneles y alcance de crear índices/borrar
namespaces propios. La autorización del 33 no se reutiliza. Fallos de aplicación
inyectados tras commit no reproducen UnknownTransactionCommitResult ni red rota.
No cambia producción/HTTP, reglas pendientes, guarda inicial/V1 o recuperación.
Objetivo exacto/independiente intacto; transferencia deshabilitada y cobertura
INCOMPLETE/NOT_ASSESSED. Impacto central en [guía frontend](./frontend-animal-transfer-foundations.md).

## Archivos y escenarios preparados

- [Configuración Jest](../test/jest-media-promotion-dispatch-mongo.json) y
  [globalSetup](../test/animal-transfer/integration/support/require-media-promotion-dispatch-mongo.ts)
  propios. `npm test` no descubre integración; los cuatro comandos anteriores
  conservan exactamente su suite. `npm run test:integration:media-promotion-dispatch:check`
  compila todos los arneses, sin conectar ni ejecutar casos.
- [Guarda](../test/animal-transfer/integration/support/media-promotion-dispatch-mongo-safety.ts),
  [fixture](../test/animal-transfer/integration/support/media-promotion-dispatch-mongo-fixture.ts)
  y [transporte falso](../test/animal-transfer/integration/support/promotion-dispatch-transport.ts).
  El fixture hereda el protocolo, monitor y limpieza existentes, con namespace/
  comprobación de propiedad nuevos. No expande allowlists de otros arneses.
- [Suite combinada](../test/animal-transfer/integration/media-promotion-dispatch.mongo.integration.ts):
  1–2 foto/diario, permiso visible en el segundo cliente antes de petición falsa
  y mismo ID de transacción para journal/control/ticket/filas con commit majority;
  3–5 retry por 503/reset/error en HTTP 200; 6 redirect regional; 7 agotamiento SDK;
  8 sello ganador frente a snapshot antiguo de intención; 9 sello entre intención
  y permiso; 10–11 sello/revocación después de commit de permiso con reply pausado;
  12–13 ack de intención/permiso perdido después de commit reconocido;
  14–15 fallo de respuesta antes de commit por CAS cero o ack perdido después;
  16–17 sello/revocación antes del retry; 18–19 revocación/cierre local entre intención
  y permiso; 20 dos dispatchers/clientes; 21 conflicto tardío de CAS de evidencia.
  Recuento AST de las tablas literales: 21, sin cargar/ejecutar la suite.

## Validación sin infraestructura

- [Guardas y transporte](../test/animal-transfer/infrastructure/media-promotion-dispatch-mongo-safety.spec.ts):
  57 casos dentro de la regresión final. Opt-in/URI, namespaces/propiedad/allowlists,
  rechazo antes de createConnection, cinco configuraciones, formas de socket,
  bloqueo de HTTP/HTTPS inesperado, reenvío al método original con receptor intacto,
  limpieza de setup fallido y SDK real sobre store simulado (éxito/retry/pausa).
- Primera focalizada: 53/56, con tres fallos porque el doble esperaba hostname y
  NodeHttpHandler pasa host; pausa quedó esperando y señaló timeout/handle abierto.
  Corregido el destino y el drenaje/manejo inmediato de rechazos; 56/56, 9.145 s.
  Después se añadió el caso 57 del receptor/restauración de Socket.connect.
- Primera regresión: 94 suites aprobadas/3 fallidas; 1557 pruebas aprobadas/33
  fallidas, 51.376 s. El caso del delegado sintético dejaba un descriptor en el
  registro de Jest y restoreAllMocks lo reinstalaba en suites HTTP. Corregida
  limpieza y añadida aserción de restauración posterior. Focalizada posterior:
  4 suites/94 pruebas aprobadas, 7.756 s. Regresión FINAL: **97 suites/1590 pruebas
  aprobadas, 43.465 s**, frente a 96/1533. Ocho suites globales heredadas siguen
  como deuda separada; no es suite global ni ejecución Mongo.
- Build, ESLint de seis TypeScript nuevos y compilación de todos los arneses
  correctos. Primera compilación señaló tipos lean de Mongoose; explícitos en
  el fixture de lectura. Primer lint señaló capturas de método/matchers any;
  corregidos. Sin instalación/actualización de dependencias o código de src.
- Cinco `--listTests`: una suite distinta por comando. Opt-in nuevo forzado a 0:
  globalSetup rechaza antes de conectar, npm exit 1 esperado, cero casos ejecutados;
  variable restaurada. Jest fuera del sandbox por EPERM de caché conocido.
  El namespace impreso en el test de setup fallido es solo un nombre generado:
  createConnection está sustituido por una excepción; no se creó esa base.
- git diff --check correcto; 257 enlaces locales en once documentos afectados,
  cero rotos/sin espacios finales. Ocho archivos nuevos comprobados por separado.

## Entorno concreto propuesto, pendiente de autorización

No se inspeccionó Docker ni se comprobó disponibilidad actual de imagen/puerto.
Propuesta reutiliza el aislamiento del [procedimiento anterior](./animal-media-promotion-mongo-runbook.md),
con identidad propia; no traslada su autorización o evidencia.

| Parámetro | Propuesta para aprobar antes de ejecutar |
| --- | --- |
| Motor / imagen | Docker Desktop Linux local; Mongo 8.0.34 por digest `sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907`, solo caché y `--pull never` |
| Contenedor nuevo | `animalrecord-dispatch-mongo-test-13a2146`, labels owner `codex-media-promotion-dispatch` y base `13a2146` |
| Topología / puerto | Un miembro de `animalrecord_dispatch_test`; publicar solo `127.0.0.1:27018` hacia 27017 del contenedor, directConnection=true |
| Datos / recursos | tmpfs /data/db 1 GiB y /data/configdb 32 MiB, sin binds/volúmenes existentes; 1 GiB RAM, 1 CPU, oplog 64 MiB, WiredTiger 0.25 GiB, --rm |
| Ejecución / limpieza | 28 casos de persistencia y 21 combinados en comandos separados; índices/filas solo en SUS namespaces aleatorios; verificar los nombres exactos y retirar SU contenedor |

URI propuesta: `mongodb://127.0.0.1:27018/?replicaSet=animalrecord_dispatch_test&directConnection=true`.
La autorización deberá cubrir inspección Docker local/contexto/imagen/puerto,
crear ese contenedor, inicializar SU replica set, consultar versiones/topología,
ejecutar ambos comandos y verificar limpieza de cada namespace/contenedor propio.
No cubre descargas, Atlas, Mongo existente de 27017, S3/AWS, migración o despliegue.
Si falta imagen, endpoint es remoto o nombre/puerto está ocupado, detener y
presentar la diferencia antes de sustituir el entorno. Revalidar Git/guardas y
registrar versiones/puerto/topología/resultado/nombres/limpieza por intento.

Después del ensayo: cerrar contrato de verificación del resultado/sellado y
mapeo de errores antes de callers. Un HTTP 200 sintético no acredita el objetivo
funcional, retención, cierre remoto o commit de negocio. No recuperar MAY_RUN,
legacy o permisos por error, edad, lease, sello, token ausente o HEAD.
