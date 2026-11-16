# Arnés opt-in de verificación y sellado

## Ensayo 42 cerrado — 2026-10-28 America/Bogota / 2026-10-29 UTC

**72/72 casos aprobados en primera pasada; 72 namespaces ausentes y contenedor
retirado.** Base `9f56736`, rama esperada y referencia origin local coincidentes,
sin fetch; cambios documentales previos preservados. Sin cambios de código/tests,
arreglos, repetición de suites o relajación de guardas.

Autorizados expresamente inspección Docker local, 23+28+21 casos y limpieza
exclusiva. Docker Desktop estaba cerrado; su inicio en segundo plano recibió
autorización adicional. Quedó iniciado después de retirar solo el contenedor
propio. Sin descargas, Atlas, Mongo existente de 27017, S3/AWS reales o despliegue.

Entorno comprobado: desktop-linux, endpoint local
npipe:////./pipe/dockerDesktopLinuxEngine, sin overrides DOCKER_HOST/DOCKER_CONTEXT.
Docker Desktop 4.44.3, cliente/Engine 28.3.2, API 1.51, Linux amd64/WSL2.
Mongo 8.0.34/FCV 8.0, un miembro animalrecord_seal_test, primary, sesiones 30 min;
miembro anunciado 127.0.0.1:27017 dentro del contenedor y conexión host exclusiva
127.0.0.1:27018 con directConnection=true. Imagen en caché, --pull never, digest/ID
sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907.

Contenedor animalrecord-seal-mongo-test-17fe684, ID
5581c4853239541559c40999411a9b8142e7ee765ad1b2f7102e6106835ac26f.
Labels animalrecord.test.owner=codex-media-promotion-seal, base=17fe684,
revision=9f56736; nombre/imagen/labels revalidados antes de retirarlo.
AutoRemove=true, tmpfs /data/db=1 GiB y /data/configdb=32 MiB, sin binds ni
volúmenes existentes (Mounts vacío). RAM 1 GiB, 1 CPU, oplog 64 MiB,
WiredTiger 0.25 GiB. Nombre ausente y puerto libre antes de crearlo.

| Componente | Versión comprobada |
| --- | --- |
| Node / npm | 20.18.0 / 11.0.0 |
| Mongoose / driver mongodb efectivo | 8.21.0 / 6.20.0 |
| Jest / ts-jest / TypeScript | 29.7.0 / 29.4.6 / 5.9.3 |
| AWS S3 SDK / NodeHttpHandler / protocol-http | 3.1003.0 / 4.9.7 / 5.3.11 |

| Comando npm run | Primera pasada | Tiempo Jest | Inicio UTC |
| --- | --- | --- | --- |
| test:integration:media-promotion-seal | 1 suite, 23/23 | 11.617 s | 2026-10-29T00:26:35.197Z |
| test:integration:media-promotion | 1 suite, 28/28 | 13.103 s | 2026-10-29T00:29:04.492Z |
| test:integration:media-promotion-dispatch | 1 suite, 21/21 | 10.377 s | 2026-10-29T00:30:23.558Z |

Cada opt-in/URI se activó solo alrededor de su comando y se restauró en finally.
Reportes JSON y logs en node_modules/.cache/seal42-{seal,persistence,dispatch}.{json,log},
ignorados por Git. Compilación de todos los arneses correcta antes de conectar.
Build/lint/regresión del 41 no repetidos por cambios solo documentales; sus
100 suites/1725 casos siguen siendo regresión seleccionada, no suite global verde.
Ocho suites globales heredadas conservan su deuda.

Los 23 casos validaron MATCH+sello/fences atómicos, rollback, ambas carreras,
invalidación durante I/O y fallos/retries de lectura. Los 49 anteriores validaron
persistencia/dispatcher. Mongo, SDK y NodeHttpHandler reales; transporte S3,
revisiones, pins y bytes sintéticos. Respuesta perdida tras commit reconocido
no reproduce fallo de red o UnknownTransactionCommitResult. Un nodo/dos clientes
no prueba multinodo/failover, autenticidad S3, fin remoto, retención o corte estable.

Limpieza: afterEach/marker/allowlist/drop majority completados en los 72 casos.
Consulta independiente listDatabases comparó los 72 nombres exactos siguientes
a las 2026-10-29T00:33:06.245Z: ninguno presente; solo admin/config/local.
Sin drops manuales o por prefijo. Contenedor eliminado por su ID con --rm y ausencia
confirmada a las 2026-10-29T00:33:30.978Z. Sin listener 27018; 127.0.0.1:27017
conserva PID 6068 y no se conectó a él. Autorización usada y cerrada.

Compatibilidad: sin src/test/package/dependencias/HTTP nuevos, incluido PUT animal
primitivo; no requiere ajustes frontend. Transferencia deshabilitada y
INCOMPLETE/NOT_ASSESSED conservados. MATCH/sello/HEAD/error/token ausente no cierran
permisos previos ni autorizan reenvío o recuperación. Siguiente: contrato y ciclo
completo/configuración/mapeo HTTP antes de callers, sin ampliar esta autorización.

## Preparación histórica del bloque 41

Subbloque 41, 2026-10-28, base `17fe684`. Contrato registrado antes del código.
Preparar/compilar, sin ejecución Mongo ni infraestructura real en este bloque.
Git inicialmente limpio; rama esperada, referencia origin local ahead 1, sin fetch.
Estado: **23 escenarios preparados/compilados, NO ejecutados contra Mongo**.
50 pruebas nuevas sin conexión aprobadas. Producción/callers sin cambios.

Comando test:integration:media-promotion-seal y check propio. Opt-in exclusivamente
MEDIA_PROMOTION_SEAL_MONGO_TESTS=1 y MEDIA_PROMOTION_SEAL_MONGO_TEST_URI. Parser local
estricto existente, sin .env/AppModule o credenciales/URI de aplicación. Namespace
animalrecord_seal_test_<UUID sin guiones> propio por caso, dos clientes y allowlist
cerrada de marker, controles, journals, tickets y filas de promoción. No ampliar
allowlists/configs/transportes anteriores. Crear/eliminar únicamente esas bases
cuando se autorice específicamente su entorno; los permisos del 39 no se reutilizan.

Siembra opt-in desde create NOT_STARTED, adquisición/permiso ordinarios. Pin con
SHA de bytes sintéticos desde su primera escritura, sin retag de MAY_RUN, cambio
de pin existente, períodos CLOSED ficticios o conversiones V1. Los permisos
persistidos son fixtures, no prueba de envío CopyObject real.

SDK S3 y NodeHttpHandler reales, credenciales sintéticas/región fijas. Interceptar
http/https nativos antes de abrir Mongo: HTTP plano denegado, HTTPS solo HEAD/GET
del bucket/key ligado al ticket de prueba, GET con If-Match y query acotada.
Respuestas/streams sintéticos; Socket.connect únicamente a loopback/puerto Mongo
seleccionado. Sin mock de client.send/verificador/tx. No permitir PUT/Copy/Delete.
No guardar Authorization, firmas, credenciales o cuerpos en el registro nativo.

Preparar casos de MATCH+sello juntos y transacción/fences, lecturas SDK/retries,
datos/revisión/bytes que cambian, snapshot/contador viejo, rollback, colisión de
evidencia, permisos/sello y sellado vigente en ambos órdenes, revocación/cierre/
token durante I/O, y pérdida de respuesta después de commit reconocido. Pausas
acotadas antes de la primera escritura para evitar mantener locks mientras espera
al competidor. Drenar promesas y destruir SDK antes de limpiar/cerrar Mongo;
restaurar guardas después. No convertir observación en cierre remoto/rollback.

Solo soporte de pruebas/scripts. HTTP/éxitos/PUT primitivo, módulos/schemas/índices
de aplicación, dependencias y reglas intactos. Sin callers ni habilitación de
transferencia; INCOMPLETE/NOT_ASSESSED. Impacto central en
[guía frontend](./frontend-animal-transfer-foundations.md).

## Archivos y protocolo de prueba

- [Config Jest](../test/jest-media-promotion-seal-mongo.json),
  [globalSetup](../test/animal-transfer/integration/support/require-media-promotion-seal-mongo.ts)
  y [guarda](../test/animal-transfer/integration/support/media-promotion-seal-mongo-safety.ts)
  propios. `npm test` excluye integración. El comando :check compila todos los arneses.
- [Fixture](../test/animal-transfer/integration/support/media-promotion-seal-mongo-fixture.ts)
  hereda apertura/monitor/índices/limpieza de MediaPromotionMongoFixture, con
  namespace y comprobación de propiedad propios. Recorre create NOT_STARTED,
  INTENT, adquisición, permiso MAY_RUN y marca inicial MEDIA_PROMOTION_ROWS_V1.
  Digest de los 32 bytes sintéticos se fija en el primer pin; no cambia un pin
  existente. Casos de token/contador retirados son fallos deliberados del fixture
  dentro de SU namespace, no recuperación o reglas de intervención de aplicación.
- [Transporte nativo readonly](../test/animal-transfer/integration/support/promotion-seal-transport.ts)
  rechaza todo HTTPS hasta bind único del destino ordinario. Solo host S3 regional
  sintético/puerto 443/HEAD y GET, key exacta, query acotada y GET If-Match. PUT,
  DELETE, POST, HTTP plano y sockets ajenos al Mongo loopback elegido se deniegan.
  Reutiliza únicamente el validador puro de sockets del arnés anterior, sin
  instanciar/modificar su transporte PUT. Registra método/path/IfMatch/VersionId,
  no headers de firma o cuerpo. Cliente SDK con credenciales/región fijas,
  NodeHttpHandler real y retries estándar; send/reader/verificador no se sustituyen.
- Releases/destrucción de SDK después de sends observados y antes de limpiar
  Mongo; guardas de red se restauran al terminar close, también con setup parcial.
  El nombre generado impreso en la prueba de setup fallido no acredita creación:
  createConnection está sustituido por una excepción y no conecta.

## Veintitrés casos (preparados en el 41, aprobados en el 42)

[Suite](../test/animal-transfer/integration/media-promotion-seal.mongo.integration.ts):

1–2. Foto/diario con SDK/Node handler/verificador reales y HTTP falso, MATCH+sello
  y journal/control/ticket/filas en una misma transacción snapshot/majority.
3–4. SDK retry de HEAD 503 o GET reset; mantiene IfMatch/VersionId, solo lecturas,
  sin nuevas autorizaciones ni respuestas que acrediten CopyObject.
5. GET 412 produce conflicto sin copiar ni sellar.
6–7. Digest o número de bytes incorrectos impiden MATCH/sello.
8. Revisión actual diferente después de GET no se sella con bytes de la anterior.
9. HEAD 404 no acredita verificación o permiso.
10. Contador de ticket alterado durante I/O invalida sujeto aunque puerta no cambió.
11–12. CAS final de puerta cero o colisión de ID de evidencia con permiso anterior:
  rollback conjunto de MATCH/sello/fences. No sobrescribe autorización existente.
13–14. Carrera real de permiso/sello en ambos órdenes; pausa antes de primera
  escritura del journal para no retener locks del competidor. Snapshot perdedor
  reintenta/fracasa con guardas reales; si permiso ganó permanece incierto.
15–16. Sello ordinario frente a verificado, ambos órdenes; no adopta sello previo
  como una observación nueva. Si verificado gana, reconfirmación ordinaria idéntica
  conserva su comportamiento; si ordinario gana, no hay MATCH/fences parciales.
17–19. Revocación, cierre local o retirada deliberada de token con GET pausado:
  seal falla y autorización previa permanece. No es recuperación de MAY_RUN.
20. Respuesta de aplicación perdida DESPUÉS de commit reconocido de sello:
  ambas escrituras consultables por ID original; no se reenvía ni repite solo por leerlas.
21. Sello confirmado deniega un permiso SDK_RETRY posterior sin borrar el anterior.
22. Puerta previamente revocada permite verificar/sellar con claim aún actual.
23. Final existente sin intentos se verifica sin fabricar causalidad/ACK.

Recuento AST de tablas literales: 23; no carga ni ejecuta la suite. Las respuestas
S3/bytes/revisiones son sintéticas. En casos de carrera se prueba el adaptador
directamente con MATCH de confianza; no afirma lectura remota autenticada.

## Validación sin infraestructura

- [50 pruebas nuevas](../test/animal-transfer/infrastructure/media-promotion-seal-mongo-safety.spec.ts):
  opt-in/URI, namespace/limpieza/allowlists, rechazo antes de conectar y restauración
  de setup fallido, seis configuraciones de suites, transporte readonly/bind único,
  bloqueo de escrituras/query/host/puertos y ciclo SDK real + store simulado:
  éxito, retries de HEAD/GET, pausa y bytes distintos. **1 suite/50 aprobadas,
  18.582 s**. Ninguna conecta Mongo o un endpoint S3.
- `npm run build`, `npm run test:integration:media-promotion-seal:check` y ESLint
  de seis TypeScript nuevos correctos. Primera compilación detectó nombre seed
  incompatible con el helper base y unión de promesas de carrera: corregidos en
  soporte de pruebas (seedSeal y observe<unknown>), sin modificar arneses anteriores.
  Prettier solo en esos seis archivos; sin instalación/cambios de dependencias.
- Regresión seleccionada: **100 suites/1725 pruebas aprobadas, 41.502 s**, frente
  a 99/1675; incluye los 50 nuevos, no los 23 casos Mongo. Ocho suites globales
  heredadas siguen como deuda separada; no se afirma suite global verde. Aviso
  Node20/AWS SDK heredado. Jest fuera del sandbox por EPERM de caché conocido.
- Nuevo `--listTests`: exactamente media-promotion-seal.mongo.integration.ts.
  Matriz de seis configs comprobada en unit tests, sin solapamiento ni descubrimiento
  por npm test. Cinco comandos anteriores intactos. Nuevo comando con opt-in
  forzado a 0: rechazo esperado en globalSetup antes de conectar, npm exit 1,
  wrapper de comprobación exit 0; variable restaurada en finally.
- git diff --check correcto; 299 enlaces locales en doce documentos afectados,
  cero rotos/sin espacios finales. Ocho archivos nuevos comprobados por separado.

## Propuesta histórica del 41 (autorizada y ejecutada en el 42)

En el bloque 41 no se inspeccionó Docker, imagen o puerto. Propuesta basada en
el [ensayo 39](./animal-media-promotion-dispatch-mongo-validation.md), sin reutilizar
su permiso ni asumir disponibilidad actual:

| Parámetro | Propuesta a aprobar |
| --- | --- |
| Motor / imagen | Docker Desktop Linux local, Mongo 8.0.34 por digest `sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907`, solo caché, --pull never |
| Contenedor nuevo | animalrecord-seal-mongo-test-17fe684, labels owner=codex-media-promotion-seal y base=17fe684 |
| Replica set / puerto | Un miembro animalrecord_seal_test; solo 127.0.0.1:27018→27017, directConnection=true |
| Datos / recursos | tmpfs /data/db 1 GiB y /data/configdb 32 MiB, sin binds/volúmenes existentes; --rm, RAM 1 GiB, 1 CPU, oplog 64 MiB, WiredTiger 0.25 GiB |
| Casos / limpieza | 23 nuevos y 49 de regresión (28+21), tres comandos separados; índices/filas solo en namespaces propios y retirada verificada de SU contenedor |

URI propuesta: `mongodb://127.0.0.1:27018/?replicaSet=animalrecord_seal_test&directConnection=true`.
La aprobación deberá cubrir inspección Docker local/contexto/imagen/puerto,
crear/inicializar solo ese replica set, consultar topología/versiones, ejecutar
los 72 casos y comprobar cada nombre exacto de base/marker/allowlist antes de
limpiar y retirar el contenedor propio. Sin Atlas, Mongo existente 27017, S3/AWS,
descargas, migraciones de aplicación o despliegue. Si cambia aislamiento, falta
imagen o nombre/puerto están ocupados, detener y presentar diferencia.

Después: registrar resultados reales/repeticiones/arreglos y limpieza, sin
trasladar estos preparados a evidencia ejecutada. Luego cerrar ciclo completo,
wiring/configuración/mapeo HTTP antes de callers. Sello/MATCH/HEAD no prueban fin
remoto, retención o corte; permisos anteriores siguen inciertos. Objetivo exacto/
independiente, nameHistory (nombres), guarda inicial/V1 y recuperación previa
conservados; vencimiento/cancelación/límites/histórico UI pendientes intactos.

<details>
<summary>Auditoría de limpieza: 72 namespaces exactos del ensayo 42</summary>

## Limpieza por namespace del ensayo 42

Inventario de los tres logs, sin duplicados (23+28+21=72). Todos comprobados
individualmente ausentes en la consulta final indicada arriba. El orden es el
de impresión del fixture en cada suite; no implica causalidad remota.

### media-promotion-seal: 23 namespaces ausentes

```text
animalrecord_seal_test_72b0f90a82dc45acadc4a2f90c28b68a
animalrecord_seal_test_3e15c2e2aea64adc9dc7a060fed39598
animalrecord_seal_test_d901a79aaf944e4282bb6e849b0c55c2
animalrecord_seal_test_818c0f38920641439430df4d59f01f8d
animalrecord_seal_test_8112f72bec634df7b5e4fa7f6dd6dac4
animalrecord_seal_test_34ca1d6065a74aeb8a68e7bc4f33ce3d
animalrecord_seal_test_5e502e41e672403ca8cab3c711862b5f
animalrecord_seal_test_808ba7486cbc4628b17dcf762e174951
animalrecord_seal_test_f6b0447e194a45d399530787aeb347bf
animalrecord_seal_test_12d7b070faa6459786d2fb32f0e46336
animalrecord_seal_test_14958f0be22a46e7b360da5cab88230d
animalrecord_seal_test_489b90bd03f24de18799daf3fc645879
animalrecord_seal_test_b2a264dd0e7e4c77871624c93a720c2e
animalrecord_seal_test_172b146339c64c1b88b247f7597833aa
animalrecord_seal_test_fc1ff7085eb94f4e87d7e1a804eb96aa
animalrecord_seal_test_31f4650c5c62465ca9636729ab0b6097
animalrecord_seal_test_fd62779a7d9c4e71977a5af95e36a3ac
animalrecord_seal_test_1aa2a0579e714e0f97239ed43458f8be
animalrecord_seal_test_b765b49b34b648c3afa723c82976f6fc
animalrecord_seal_test_4f877aea401d492d906c0bc0da10466b
animalrecord_seal_test_3f671403497946afad5be00b003c6c09
animalrecord_seal_test_4421a5ece23540b089fc8da8f6ebb4f8
animalrecord_seal_test_98e2499ff0be463d98ff36b60ae7809a
```

### media-promotion: 28 namespaces ausentes

```text
animalrecord_promotion_test_a8d9096dbe624c3abcfa906491618f56
animalrecord_promotion_test_d04d21426c04492a9adbdb3ccc44ce73
animalrecord_promotion_test_fb2811d6da0e43ce980a0ad484b9eedc
animalrecord_promotion_test_a7798ab085354872a996cf53e207507d
animalrecord_promotion_test_3c1008dd06d54e37a8ecbdcd1a7c2951
animalrecord_promotion_test_7673a182759141f699cded63d090e4e1
animalrecord_promotion_test_8152578e30304b059ad1fa4b9618899d
animalrecord_promotion_test_dbc4404b9618426c94cfac9e1fce07ad
animalrecord_promotion_test_d1c24e14f8a74b458f9a8d660ee4962b
animalrecord_promotion_test_eb5cd0c7910a44f6bd7946c2b9532716
animalrecord_promotion_test_43ca6b3b60ce4a35a0ab10597ed0c2a6
animalrecord_promotion_test_e5412ee9fa2f410e89862bfe1f3e3275
animalrecord_promotion_test_d1c1a4d6a3264ad7b15614daa3cc7179
animalrecord_promotion_test_71ba58d1f8e94dd1874b3e8cd55fd17e
animalrecord_promotion_test_bfa8479675d4445c9bc2d9b7fc9811cb
animalrecord_promotion_test_23916b513cf54f9fb5e73c5cf08b1d64
animalrecord_promotion_test_62a34e165ce24f828efcc3712da9c845
animalrecord_promotion_test_404f82b5494c4230ba47f78b59fa78c4
animalrecord_promotion_test_39c5c01125dd473f9c7c8f64c7ce3950
animalrecord_promotion_test_d60b03e1b5ec41619957b3ccfedf9ce5
animalrecord_promotion_test_49cf23aba52d4111b8d32a8e01b2cbbb
animalrecord_promotion_test_13833009103b46c1810ce254c2d69b90
animalrecord_promotion_test_a302e1441188429c8a61b163120e2424
animalrecord_promotion_test_b919226ee8a54445a0d527c61731d981
animalrecord_promotion_test_6056635965074222bc6d6baa00b12878
animalrecord_promotion_test_2237d1b4ccc343b0af154a5ea7e53da5
animalrecord_promotion_test_16e4ee085e8243e892c2372977e240fc
animalrecord_promotion_test_4734359418cd40f3a6778aed5c568f91
```

### media-promotion-dispatch: 21 namespaces ausentes

```text
animalrecord_dispatch_test_3e4423e53b1347619a6d5409b7287e58
animalrecord_dispatch_test_e79371b57f024d3e95147925f860e985
animalrecord_dispatch_test_2b1831915e414cfeb3dc1e23f604558d
animalrecord_dispatch_test_55f5154af4c748fc9b05f9d97c336fc2
animalrecord_dispatch_test_a02ad1d864c74c10be263a549a2ae3db
animalrecord_dispatch_test_f0adb79a62ba4eecbd21cd9d94a2ff4a
animalrecord_dispatch_test_08b824596bc649c580cd1d82038562a4
animalrecord_dispatch_test_02c24654b8bd47309a62bfb95077eeb1
animalrecord_dispatch_test_029bbecd6d4542439d6b408f849345de
animalrecord_dispatch_test_17617fcd28834f9e8a5cd210df6a4af1
animalrecord_dispatch_test_6a16d19948be4d3bbd6962f19b84c1bf
animalrecord_dispatch_test_f35edaff201144ccbe5decb4554ed5bd
animalrecord_dispatch_test_ca7c23e349ca479ca63ffc15e26e980c
animalrecord_dispatch_test_cae48df8c77e46f89918a8fddec5a4c5
animalrecord_dispatch_test_b31e6aca94c24d44a7ae232f195273b2
animalrecord_dispatch_test_33572098f8fd439dbededa332ac6bfc4
animalrecord_dispatch_test_e51ef5a9c1a04bcfbb521fa82ed39fce
animalrecord_dispatch_test_35b1018ad5a0465795942471753d045a
animalrecord_dispatch_test_8e9252e6c3fb4003a30f42b536e8b954
animalrecord_dispatch_test_5529dc8ff3a54178aa16462b05af1719
animalrecord_dispatch_test_e2b6603a74fb4fb9842292e8a4b9dc12
```

</details>
