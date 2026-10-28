# Validación local autorizada de persistencia y dispatcher

Subbloque 39, inicio 2026-10-27 (America/Bogota), base `5245ce7`, rama
`codex/animal-transfer-planning`. Git inicialmente limpio, HEAD/referencia origin
coincidentes y cinco commits revisados; sin fetch/descarte. Registro iniciado
antes de crear entorno. Cierre 2026-10-28: **49/49 casos aprobados en la primera
pasada, 49 bases verificadas ausentes y contenedor retirado**. No hubo cambios
de código/tests, reintentos de la suite o relajación de guardas.

El usuario autorizó expresamente inspección Docker local, un contenedor nuevo
Mongo 8.0.34 de caché por digest, replica set de un miembro en 127.0.0.1:27018,
tmpfs, ejecutar los 49 casos (28+21), verificar/borrar exclusivamente sus namespaces
y retirar ese contenedor. No Atlas, servidor existente de 27017, S3/AWS o despliegue.
Alcance concreto: [propuesta del bloque 38](./animal-media-promotion-dispatch-mongo-integration.md).

Preflight comprobado: contexto desktop-linux, endpoint local
npipe:////./pipe/dockerDesktopLinuxEngine, sin overrides DOCKER_HOST/DOCKER_CONTEXT.
Docker Desktop 4.44.3, cliente/Engine 28.3.2, API 1.51, Linux amd64/WSL2.
Imagen Mongo 8.0.34 presente en caché por digest/ID
sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907.
Nombre animalrecord-dispatch-mongo-test-13a2146 ausente y puerto 27018 libre.
Servidor ajeno en 127.0.0.1:27017, PID 6252, queda excluido.
Primeras consultas Docker/CIM denegadas por sandbox; repetidas con escalación,
sin modificar servicios. No se descargó imagen ni se inició Docker Desktop.

## Entorno y resultados reales

Contenedor creado: animalrecord-dispatch-mongo-test-13a2146, ID
93252bbc53d1961dcb91a20f5267eb1c5ed982dd0303c4b2f827bf44e774f16b.
Labels: owner=codex-media-promotion-dispatch, base=13a2146, revision=5245ce7
(prefijo animalrecord.test.). Base identifica la propuesta, revision el código
real probado. AutoRemove=true, 1 GiB RAM, 1 CPU, tmpfs /data/db=1 GiB y
/data/configdb=32 MiB, sin binds/volúmenes; Mounts vacío y HostConfig.Tmpfs
comprobado. Oplog 64 MiB y WiredTiger 0.25 GiB. Publicación exclusiva
127.0.0.1:27018→27017; replica set animalrecord_dispatch_test, único miembro
127.0.0.1:27017 anunciado dentro del contenedor. Primary, sesiones 30 min,
Mongo 8.0.34 y FCV 8.0 comprobados por hello/buildInfo/getParameter/rs.conf.
Conexión de pruebas con directConnection=true, sin credenciales/base en URI.

| Componente local | Versión comprobada |
| --- | --- |
| Node / npm | 20.18.0 / 11.0.0 |
| Mongoose / driver mongodb | 8.21.0 / 6.20.0 |
| Jest / ts-jest / TypeScript | 29.7.0 / 29.4.6 / 5.9.3 |
| AWS S3 SDK / middleware-retry | 3.1003.0 / 4.4.39 |
| NodeHttpHandler / protocol-http | 4.9.7 / 5.3.11 |

| Comando | Resultado de primera pasada | Tiempo Jest | Inicio UTC |
| --- | --- | --- | --- |
| npm run test:integration:media-promotion | 1 suite, 28/28, npm exit 0 | 15.29 s | 2026-10-28T04:53:29.465Z |
| npm run test:integration:media-promotion-dispatch | 1 suite, 21/21, npm exit 0 | 14.38 s | 2026-10-28T05:00:29.004Z |

Variables opt-in/URI activadas solo alrededor de SU comando y restauradas en
finally. Los dos reportes JSON y logs npm quedaron en node_modules/.cache,
ignorados por Git; los resultados/nombres relevantes se conservan aquí. El
proceso de versiones intentó primero una ruta anidada de mongodb no existente;
se resolvió desde Mongoose con createRequire y se comprobó el driver efectivo.
No fue fallo de integración ni requirió instalar paquetes.

Persistencia valida índices/ausencia TTL, unicidad, rollback de filas y fences,
snapshot obsoleto, tombstones/revocación/cierre/token, respuesta de aplicación
perdida tras commit reconocido y ambos órdenes permiso/sellado del bloque 37.
El combinado verifica concesión visible por segundo cliente antes de petición
nativa falsa, misma transacción para journal/control/ticket/filas, retries/redirect
SDK, dos dispatchers, permisos previos que aún delegan tras sello/revocación y
fallos/conflictos de evidencia que detienen envíos posteriores.

S3Client/NodeHttpHandler/serialización/deserialización/retries son reales; http/
https son falsos o denegados y Socket.connect solo admite loopback/puerto Mongo
seleccionado. Las 21 pruebas pasaron sin contactar AWS. Pins, ETags, hashes,
contenido/recibos y sellos usados son sintéticos; UNKNOWN no pasó a ACK/MATCH
por un HTTP 200. El arnés de persistencia incluye ACK/MATCH sintéticos explícitos,
que tampoco descargan autorizaciones previas. Respuesta perdida después de commit
reconocido no reproduce red rota o UnknownTransactionCommitResult.

Validación adicional: npm run test:integration:media-promotion-dispatch:check
correcto antes de conexión, compila todos los arneses. Solo documentación cambia
en este bloque: build, ESLint y regresión de negocio no se repitieron. Las
97 suites/1590 pruebas del bloque 38 conservan su fecha/alcance; ocho suites
globales heredadas siguen como deuda separada. No se afirma suite global verde.
git diff --check correcto; 276 enlaces locales en trece documentos afectados,
cero rotos/sin espacios finales, incluido este archivo nuevo. Los 49 nombres
documentados coinciden automáticamente con ambos logs, sin diferencias.

## Compatibilidad, límites y siguiente paso

Sin cambios en src/test/package.json, dependencias, módulos/schemas/índices de
aplicación, HTTP/DTO/URLs/éxitos/errores (incluido PUT animal primitivo). Se crearon
y borraron índices/filas solo de las bases propias del ensayo autorizado.
Sin migración de aplicación, Atlas, operaciones S3/AWS, despliegue, commit o push.
La autorización usada no se extiende a un nuevo entorno, reanudación o limpieza
general. Una futura ejecución necesita aprobación específica.

La evidencia valida el protocolo Mongo en UN miembro y un proceso con dos clientes;
no multinodo/failover, red real S3, autenticidad del proveedor, cobertura de todos
los escritores, fin remoto, delete/recreate, retención o corte estable. Modelo,
INCOMPLETE/NOT_ASSESSED y transferencia completa deshabilitada conservados. MAY_RUN
no demuestra inicio; error/estado local/sello/HEAD/edad/token ausente no prueban
rollback ni permiten recuperar legacy o permisos previos. Guarda inicial/V1 y
objetivo de histórico exacto/copia independiente intactos; nameHistory guarda nombres.

Siguiente bloque: contrato/colaborador aislado de verificación del resultado y
sellado ligado a definición/ticket/observación, con pruebas de bytes/revisión,
cambios concurrentes y fallos de evidencia; registrar mapeo de errores antes de
conectar callers. No convertir observación de un final en cierre de todos los
intentos o autorización de transferencia. Retención/cobertura/corte y commit de
negocio, OTP, solicitudes, notificaciones e histórico final siguen pendientes.
Impacto central en [guía frontend](./frontend-animal-transfer-foundations.md),
seguimiento en [plan de entrega](./final-delivery-plan.md).

## Namespaces y limpieza por caso

Cada nombre de las listas siguientes corresponde al orden de casos del reporte
Jest de su comando. Los afterEach finalizaron sin error, con marker/allowlist y
dropDatabase majority propios. Consulta independiente de listDatabases dentro
del contenedor comparó los 28 nombres exactos antes del segundo arnés y los 49
al final: ninguno presente; solo admin/config/local. No se borraron por prefijo
ni se hicieron drops manuales o sobre servidores ajenos.

Persistencia, 28/28; todos verificados ausentes:

```text
animalrecord_promotion_test_31bfc98242d34ddb8e698ff25411cfa6
animalrecord_promotion_test_5c5ea9ba79f54b2d9707681945799059
animalrecord_promotion_test_db7c7c5d88f74e9bbfbd4220a057a348
animalrecord_promotion_test_eaad2da502d14414b5b5fb9a8d2651d6
animalrecord_promotion_test_87b34e8a554b4e4fa61928b7e600cdc1
animalrecord_promotion_test_9601e8a3007c40a58dc27029986d3f04
animalrecord_promotion_test_56a02614bf214807a036bb103c4ecbc5
animalrecord_promotion_test_7e564f5f21924d95a60c257105027384
animalrecord_promotion_test_9eeee264189a47148b80046d0428e9f9
animalrecord_promotion_test_17273e6cfc7842b2b294bb48e02cc92d
animalrecord_promotion_test_b3248d5f59664f8c9ea8f292b3848497
animalrecord_promotion_test_c7b9af18cc7f427b8f250be16434a7cb
animalrecord_promotion_test_1728283b55b443e78cf2ba16194bbc87
animalrecord_promotion_test_51e8222ac8e641659deef38260fab0ec
animalrecord_promotion_test_2d99a82b2ab54cc5a2bc1704545b6b33
animalrecord_promotion_test_1ad49f8190c64fa68ddb23f6f545781d
animalrecord_promotion_test_97bdabe778b64858b09ce03cbcfa0f1a
animalrecord_promotion_test_6243c824c96c4d75a1bfbbf6f8544016
animalrecord_promotion_test_cd531999a6134cb68e72f5cb257a9386
animalrecord_promotion_test_ed446e6c64a448dbbc67d97affa10872
animalrecord_promotion_test_557c06bdec7646c99bad9d99ccae2a2c
animalrecord_promotion_test_c2e1eb76e73544bb82471aa578a7f0e0
animalrecord_promotion_test_90b4e69b7b884e9bb2d874d729668d25
animalrecord_promotion_test_1bf81be257e74ecfa265cfef3f8ac18d
animalrecord_promotion_test_4274594158d14a4bae12e9783ec54a9b
animalrecord_promotion_test_1590539cdc6a4fa1896f67cec480ae31
animalrecord_promotion_test_9b85f7b8cfdc48778b2f51c7f93ed659
animalrecord_promotion_test_f6f69416e3cf4c5090772d637af2825d
```

Dispatcher, 21/21; todos verificados ausentes:

```text
animalrecord_dispatch_test_d07614e7302b45e993f119df1b8b2cb7
animalrecord_dispatch_test_cfd74ece73624e248fd4219350a9dc33
animalrecord_dispatch_test_5136ca45d44b4ab096c1c91182e23a8f
animalrecord_dispatch_test_6155943302b24ff2895b0d73e3fe5214
animalrecord_dispatch_test_2c1d3bc742554108b362a699789d74bc
animalrecord_dispatch_test_3fef5682508a4b038c8076239f4fd9fd
animalrecord_dispatch_test_6315a7e8ae4c4cb7ae30de9e258524bf
animalrecord_dispatch_test_7427a79204f8433c9e4a6a1f9a93d47f
animalrecord_dispatch_test_2e808f29bd64472c8069e6ee076696d5
animalrecord_dispatch_test_2e983f6f05144ca182a932104a2d6739
animalrecord_dispatch_test_1e00441284984680809d3be6410ac217
animalrecord_dispatch_test_4c85118615c4471681ef3a87bd90490c
animalrecord_dispatch_test_3c4a3f33a0f44539ab353d65f776ec43
animalrecord_dispatch_test_58f792c69ff5419e868d80e4fe71431e
animalrecord_dispatch_test_f37f7071a49c46d6a90725068fc205a9
animalrecord_dispatch_test_9a601c20bef1466dad22a136f7bb58c1
animalrecord_dispatch_test_731aabc3be224ef0bb3258e5158a9a6b
animalrecord_dispatch_test_29454670f4a4451692db5b7ce1818c14
animalrecord_dispatch_test_b4914d84eb804719b902379ee2f7a684
animalrecord_dispatch_test_2c120ffd6e2049bb9f15d722a55641de
animalrecord_dispatch_test_356d95702df54784aa04556b57e02819
```

Consulta final de los 49: 2026-10-28T05:01:53.727Z, remaining=[],
actual=[admin,config,local]. Se volvió a verificar ID/nombre/imagen/labels/tmpfs
antes de detener exclusivamente el contenedor propio por ID completo; AutoRemove
lo retiró. Ausencia del ID y puerto 27018 libre comprobados el
2026-10-28T00:03:32.3566049-05:00. El listener 27017 sigue en PID 6252.
Se conservaron Docker Desktop, imagen en caché y servicios preexistentes.

