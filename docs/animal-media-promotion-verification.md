# Verificación y sellado internos de una promoción

## Ensayo 48 cerrado — 2026-10-28 America/Bogota / 2026-10-29 UTC

**102/102 aprobados en primera pasada; 102 namespaces ausentes y contenedor retirado.**
Autorización específica para entorno, alteraciones deliberadas de índices/una
colección SOLO en fixtures propios y limpieza exclusiva; utilizada y cerrada.
Rama esperada, HEAD/referencia origin local `74a6d00`, sin fetch. Los ocho cambios
del 47 seguían sin commit: probados y preservados. No se corrigió código/tests,
repitió suite o relajó guarda en el 48.

Huella del árbol probado SHA-256:
a788dd9a6d3d827e45ba3df8ce44d2284ae12960edf345b89054f6ed104d1625.
Manifiesto ordenado de cinco archivos: domain/media-promotion-mongo-requirements.ts,
infrastructure/mongo-media-promotion-readiness.ts (ambos bajo src/context/animal-media/),
test/animal-transfer/infrastructure/media-promotion-mongo-readiness.spec.ts,
test/animal-transfer/integration/media-promotion-confirm.mongo.integration.ts y
su support/media-promotion-confirm-mongo-fixture.ts. SHA-256 de bytes por archivo;
hash agregado de líneas path:sha256 separadas por LF en ese orden. Revalidada al
cerrar; resto de código/configuración corresponde al HEAD indicado.

Docker Desktop 4.44.3.202357 ya iniciado, cliente/Engine 28.3.2, API 1.51,
Linux amd64/WSL2 kernel 6.6.87.2. Contexto desktop-linux con endpoint local
npipe:////./pipe/dockerDesktopLinuxEngine y sin overrides DOCKER_HOST/DOCKER_CONTEXT.
Nombre ausente y 27018 libre antes de crear. Mongo ajeno de 27017, PID 6068, excluido.
Imagen de caché, --pull never, Mongo 8.0.34 por digest/ID
sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907.

Contenedor animalrecord-readiness-mongo-test-74a6d00, ID
2f237107a2292f411347ed1f8c9c0d4f9bcb7ee4ee44de9165a0f4acc8d0b929.
Labels animalrecord.test.owner=codex-media-promotion-readiness, base/revision=74a6d00,
worktree=block47, manifest=huella anterior. AutoRemove=true, sin binds/volúmenes
existentes, Mounts vacío, tmpfs /data/db 1 GiB y /data/configdb 32 MiB, RAM 1 GiB,
1 CPU, oplog 64 MiB/WiredTiger 0.25 GiB. Publicación exclusiva 127.0.0.1:27018→27017.
Replica set animalrecord_readiness_test, un miembro 127.0.0.1:27017 anunciado dentro
del contenedor, primary/sesiones 30 min, Mongo 8.0.34/FCV 8.0 comprobados. URI host
directConnection=true, sin credenciales/base de aplicación.

| Componente | Versión comprobada |
| --- | --- |
| Node / npm | 20.18.0 / 11.0.0 |
| Mongoose / driver mongodb efectivo | 8.21.0 / 6.20.0 |
| Jest / ts-jest / TypeScript | 29.7.0 / 29.4.6 / 5.9.3 |
| AWS S3 SDK / NodeHttpHandler / protocol-http | 3.1003.0 / 4.9.7 / 5.3.11 |

| Comando npm run | Primera pasada | Tiempo Jest | Inicio UTC |
| --- | --- | --- | --- |
| test:integration:media-promotion-confirm | 1 suite, 30/30, npm exit 0 | 17.573 s | 2026-10-29T02:35:26.632Z |
| test:integration:media-promotion-seal | 1 suite, 23/23, npm exit 0 | 9.764 s | 2026-10-29T02:37:24.436Z |
| test:integration:media-promotion | 1 suite, 28/28, npm exit 0 | 11.746 s | 2026-10-29T02:38:13.353Z |
| test:integration:media-promotion-dispatch | 1 suite, 21/21, npm exit 0 | 10.441 s | 2026-10-29T02:40:07.504Z |

Cada opt-in/URI solo se activó alrededor de su comando y se restauró en finally.
Logs/reportes ignorados por Git: node_modules/.cache/readiness48-{confirm,seal,promotion,dispatch}.{log,json}.
Los ocho casos nuevos comprobaron catálogo correcto, índice faltante/sparse,
TTL, filtro parcial incompatible, colección ausente, unique adicional y destino
incorrecto. El monitor confirmó que el inspector solo consulta metadatos y no
inicia transacción/escribe. Los cambios deliberados de catálogo los hace el fixture,
no el inspector. Los 22 casos de ciclo y 72 de regresión conservan grants/MATCH/
fences y sus guardas. Metadata sigue siendo una observación antigua potencial:
SATISFIED no prueba transacciones/datos ni concede activación o commit.

Mongo, SDK y NodeHttpHandler reales; S3/bytes/pins/revisiones sintéticos.
No prueba autenticidad S3, multinodo/failover, red rota Mongo o
UnknownTransactionCommitResult. La respuesta perdida sigue siendo de aplicación
DESPUÉS de commit reconocido. Permisos anteriores conservan incertidumbre;
HEAD/MATCH/sello no prueban cierre remoto, retención o corte estable.

Limpieza: afterEach con marker/allowlist y drop majority terminó sin error en los
102 casos. Consulta independiente verificó primero los 30 nombres nuevos; al final
comparó los 102 exactos a las 2026-10-29T02:41:13.881Z: ninguno presente,
solo admin/config/local. No drops manuales ni por prefijo. Antes de stop por ID se
revalidaron nombre/owner/imagen/manifiesto/aislamiento. Contenedor eliminado por
--rm y ausencia confirmada a las 2026-10-29T02:41:39.192Z.
Sin listener 27018; 27017 conserva PID 6068, sin conectarse a él. Desktop/caché y
otros servicios intactos; sin descargas, Atlas, migración de aplicación o despliegue.

Solo documentación cambia en el 48. Build/lint/check y 104 suites/1893 pruebas
seleccionadas del 47 mantienen su fecha/alcance, sin repetirse por rutina. Los 102
Mongo son evidencia separada; ocho suites globales heredadas siguen pendientes.
Éxitos HTTP/PUT primitivo y callers actuales intactos; frontend sin ajustes por
este ensayo. Transferencia deshabilitada e INCOMPLETE/NOT_ASSESSED. Siguiente:
proceso operativo versionado de índices/remediación, sin ejecutarlo automáticamente,
y conexión conjunta foto/diario; Atlas/Lightsail aún no quedan preparados por esto.

<details>
<summary>Auditoría: 102 namespaces exactos verificados ausentes</summary>

Concatenar el prefijo de cada grupo y cada sufijo sin separador. Inventario de los
cuatro logs, sin duplicados, mismo orden de impresión de cada suite. Cada nombre
fue comprobado ausente en la consulta final indicada arriba.

### media-promotion-confirm: 30/30 ausentes

Prefijo exacto: `animalrecord_confirm_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
bd4dcdf06be940a28f5806c1fb06c448
1637d94644554d7b91eceb84cc66569d
8546fc61d7714095bb40fc40b795790f
4b49198b33e84cc3900f7d04a5837f85
da38aebf899a4594adf64cb75ce48410
29cacdd28b32423d8beea5189b789724
163aad19e96c495d9521715bee993aac
f47903312f0a4ff3966d2d1bfbc5fbf1
19d8415d198b4cb49f60d5c8602be8fb
8cbd9dfd0bfd4b21b647e0fa6b570d25
4b4ce80a622446178c11c9f68dca7f7e
f4ff707720df437abf3a1a43e955c3f3
a9bf4a818c144078b0dc3d6ea3307f74
249a244c35f44613817202764a3896d5
8c528eeccf104877aae2ca855fe42984
a5e51b2a46a74c73b99531591bf5399f
6650a6034b8e424d85285e2945500465
e668b1b41db14844866af196eb1d7c82
c3e9085a59aa483b8c68c945def86353
1fa17c823747417784e65d2ac63c726d
0fb338b5d8f347c89f46c35f451779ea
487aee5c73964276a023bb4d4f1b6dfc
f32f14218dfe4d06af78f77fad420fb5
1a3f20523dd44006999a80b9f9adea21
b18981aa8a75442e9fd48e01e9c8fb1e
51f39976064a4bf7bcc19009afa86803
28743ecad4ea411f99912fb807108896
5529fe3771524731a24e39d52634caed
d534ba3ee8e6409d9768a679d7e02618
33ac7256cd7b4b5ca72064b5af8fe1cb
```

### media-promotion-seal: 23/23 ausentes

Prefijo exacto: `animalrecord_seal_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
f9e5e7fc5e634e359375e4b06a055613
c1735ea641a94bf583137ee31287f68b
8d93069ee74348d1bdddc0b42279d2b4
1c0da58a71ec40cdb6d11cf4a7b9fcdb
f85274ef4a814faa83ab4d207e1bbc0b
ffd92b31a65e4d1180b4eccdd4986015
fc5d36e50b154c98ae01cf3daef07a5f
82d362ebdd874782ba218878896a1265
838dcaecf1bc4b59bfec261e0c1b597e
c69bdb91fd69425190b5525efdfd1b10
63326a0a98be46b882055effe8c53c58
6eab524c43ee48cdb8988418bc4981a4
9d14e6f9226d41be960f3d429e826409
6f399302c2974da29e17ca8f37976a65
e4eced064860435e9d2075dbe99491f9
5b97a2144f0749309f519b1bf010c425
1faf22679b9f40609c25daf2f35721d4
21d471255b984f6d9d0631e9e3d05ffa
ef7451a63c9e48beb813cb496f232cfb
96dc65c44f7d4f579c1f0084c29b1774
2ffd07c14ece413da95dc2648eb9500e
47836f544acc4d1898450d7ae688ca05
5740862f066f44fa8784ddc7ecc33c82
```

### media-promotion: 28/28 ausentes

Prefijo exacto: `animalrecord_promotion_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
1b3ae0b4a71243a19600ef544ef211ce
e8f93f06d55045e4a6b0fe55ef51c8e3
3c939d45514a428da534c9596279a8f3
a7884014330a4c589c3c287cd4e7be5f
a21b446b0af4488ab023254d9f7447fc
8321c33b1ef1450c8178e8e172bd7529
d81b76d2c8674e3893ec08995b562d2e
ac41b9d6374e4a97b05c9a4fa0910b2d
e4d7bb042ae54ac78ec4a47405f79c23
9d242bf0ca5d41cb92cc177ae54263bd
0dc41eb61f7b4169bab1287b184e3cf5
1f1b0545b28844609d1b458e4101a5c0
8b8d0cdb390d4e6cbaadf6365eb8b72b
bc4feff84dfa4f328bddd495481acde6
8fb99e0d97b34561a1b432028e769e60
0bacbe4affb140b3863054e8f2b1ea73
b8c92784047c4017a0eb03149c055ea0
7ff45970c0d0429ca9adeb248ce15081
3ae4541ec3c0406aa3bc56ca4cefa7a5
9fc12a6967314eebbb080484c8d261d8
1aa973005fe04bea86ced293960c4f18
1aec2b118fdb4ff0a13805dd0f353ab4
1228922435ba45a8a63971320c01c44c
f798c36e350b4445ba13335af186c74d
45cb7d97309e4697ac5608b4bf7e28c6
c269b71a4d1842399c3740bee65dd93f
79924e7e79f14afc807c7fa20df26310
402c9d7fe7a6437da0e7c56b3c096ced
```

### media-promotion-dispatch: 21/21 ausentes

Prefijo exacto: `animalrecord_dispatch_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
98440dbb454b4b678f0735db90bc43e0
492bbceb9a674115859004c39691a643
aa660c4d590b434b9b0382949ca4af5a
8f958d1cb99d4654aa1ec6ea999e5cf6
1c4d1f722a31489c8afb98280c5d749f
d7dc9d510ee34649909c69b1152cf41e
7d9cf42f0d914eba90cf204131e8358b
8a604e2b23e044f48c23b64c98fc456a
66cbeff52bfb47ef88ece274afcd1bd5
21c7ddb8c7c24f2d82d806ca44e7a0af
780c6b80263746aca7b2f04112508f83
5fbe2017821e4ae681dbc0c35517b744
6f0a6899199f42dba7d784e1d38c3103
c74e37dd2a6d4987a547fc5a3d72dfdb
0c0958beccf0495aae2fbaba6a206f65
36c7071b28f64ff397c307b4fcef9b37
35fad1570e6143d4a2dbea70a4784963
f6d10f648f1e4ac9aa69cfbda4979856
eac26ffcd1684336bd71d37a0732001f
f9608438e55a4e09969dfa8a52cf1316
19f2361c5f694341b8011d3c192f3427
```

</details>

## Requisitos Mongo e inspección de solo lectura implementados, bloque 47

Base `74a6d00`, árbol limpio. Manifiesto versionado explícito de las cuatro
colecciones y sus 14 índices declarados (6 promociones, 3 tickets, 2 journals,
3 controles). Comprobar orden de claves, unique, partialFilterExpression, sparse,
collation y visibilidad/construcción; aceptar nombres de índice distintos. Denegar
TTL y restricciones unique adicionales sin revisar. Colecciones normales con
collation simple, sin capped/timeseries/expiración; no examinar ni reparar datos.
Prueba contra schemas exige revisar el manifiesto si cambian sus declaraciones.

Inspector recibe un Db ya configurado y nombre de base esperado explícito. Solo
hello/listCollections/listIndexes con preferencia primary y maxTimeMS acotado;
sin abrir conexiones, iniciar sesiones/tx, crear modelos/colecciones/índices,
syncIndexes, collMod o migraciones. Fallos de permisos/red no se convierten en
catálogo vacío: error fijo sanitizado, sin URI/causa/documentos. Sin provider,
endpoint, job o invocación en el arranque/callers actuales.

Informe de requisitos SATISFIED/BLOCKED ligado a versión y hora de observación.
Topología validada en este contrato: primary de replica set con sesiones; standalone
se bloquea y mongos queda sin validar. No imponer una versión nueva de Mongo o
regla de negocio para resolver esa diferencia. Lecturas metadata no son snapshot
conjunto/fence y pueden quedar antiguas: transactions NOT_PROBED, data NOT_ASSESSED,
activation DISABLED. SATISFIED no autoriza commit, permisos S3, borrados o aceptación.
No prueba Atlas/Lightsail preparado o todas las capacidades operativas del usuario.

Solo pruebas sin conexión en el 47. La autorización del 46 está cerrada. Validación
real del inspector, proceso versionado de instalación/remediación de índices y
conexión conjunta foto/diario siguen pendientes. Éxitos/errores HTTP actuales y
guarda inicial/V1 intactos; INCOMPLETE/NOT_ASSESSED y transferencia deshabilitada.

Código: [manifiesto/evaluador](../src/context/animal-media/domain/media-promotion-mongo-requirements.ts)
y [inspector](../src/context/animal-media/infrastructure/mongo-media-promotion-readiness.ts).
Los [tests sin conexión](../test/animal-transfer/infrastructure/media-promotion-mongo-readiness.spec.ts)
contrastan el manifiesto con los schemas, rechazos de metadata/opciones y uso
exclusivo de APIs de catálogo en dobles sin capacidades DDL/DML/sesión/conexión.
Opciones o catálogo ilegibles nunca se tratan como estado normal; collation
simple explícita y booleans false equivalen a sus defaults, no se normalizan
filtros parciales equivalentes a ciegas. maxTimeMS limita el comando en servidor,
no el total de red ni prueba cancelación. No hay informe parcial ante fallo.

Ocho casos nuevos preparados en la suite opt-in existente: catálogo correcto,
índice identityIds ausente/sparse, TTL, filtro parcial distinto, colección ausente,
unicidad extra y base destino incorrecta. Los cambios de índices/colección son
fixtures deliberados SOLO dentro de su namespace desechable; el inspector no los
realiza. La suite pasa de 22 a **30 casos compilados, NO ejecutados con esta versión**.
Monitor ampliado solo con hello/listCollections/listIndexes, sin guardar respuesta,
queries o documentos; allowlists de colecciones, parser y transporte intactos.
Los 94 resultados del 46 son históricos anteriores a esta ampliación.

### Próximo ensayo propuesto, requiere autorización específica nueva

Sin inspeccionar Docker/imagen/puertos en el 47. Propuesta: Docker Desktop Linux
local/desktop-linux (inicio en segundo plano si hace falta), Mongo 8.0.34 solo
de caché por digest sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907,
--pull never; contenedor nuevo animalrecord-readiness-mongo-test-74a6d00, owner
codex-media-promotion-readiness y base 74a6d00 en labels animalrecord.test.*.
Replica set de un miembro animalrecord_readiness_test, 127.0.0.1:27018→27017,
directConnection=true, --rm, tmpfs /data/db 1 GiB y /data/configdb 32 MiB, sin binds/
volúmenes existentes; RAM 1 GiB/1 CPU, oplog 64 MiB/WiredTiger 0.25 GiB.

Alcance a aprobar: inspección/inicio local si procede, crear/inicializar solo ese
replica set, consultar versiones/topología, **102 casos (30+23+28+21)** mediante
cuatro comandos separados, incluidas creaciones/eliminaciones de índices y una
colección únicamente en SUS namespaces/fixtures. Validar markers/allowlists,
registrar resultados y ausencia de cada nombre exacto, retirar SU contenedor.
Sin Atlas/27017 existente/S3/AWS reales, descargas, migración de aplicación o
despliegue. Si faltan imagen/puerto/nombre o cambia aislamiento, detener y presentar
la diferencia. El resultado será diagnóstico de requisitos, no permiso de corte
o transferencia ni autorización para intervenir índices de producción.

## Ensayo 46 cerrado — 2026-10-28 America/Bogota / 2026-10-29 UTC

**94/94 aprobados en primera pasada; 94 namespaces ausentes y contenedor retirado.**
Autorización expresa del entorno y limpieza exclusivos; consumida y cerrada.
Git `9de88d2`, rama esperada/referencia origin local coincidentes, sin fetch.
Los diez cambios del 45 seguían sin commit: se probaron y conservaron, sin arreglos
de código/tests, repetición de suites o relajación de guardas.

Huella del árbol probado: SHA-256
1fbef04e6693cd4dd57053c46d53a95c359f3f1c9c9e60ca15ea00c8c92d0024.
Manifiesto de ocho archivos del 45: package.json, config Jest nueva, suite,
fixture, safety, transporte, globalSetup y guardas; hash de cada archivo sobre
bytes, hash agregado de líneas path:sha256 en ese orden, separadas por LF.
Producción corresponde al HEAD indicado. Huella revalidada al cerrar.

Entorno comprobado: Docker Desktop 4.44.3.202357 ya iniciado, cliente/Engine
28.3.2, API 1.51, Linux amd64/WSL2 kernel 6.6.87.2. Contexto desktop-linux y endpoint
npipe:////./pipe/dockerDesktopLinuxEngine, sin overrides DOCKER_HOST/DOCKER_CONTEXT.
Imagen de caché, --pull never, Mongo 8.0.34 por digest/ID
sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907.
Nombre ausente y 27018 libre antes de crear; Mongo ajeno en 27017, PID 6068, excluido.

Contenedor animalrecord-confirm-mongo-test-9de88d2, ID
fb8b31e9a252803f0b1cfcd3fa3f0a033fa2420a296ef427edb5fd43f270016e.
Labels animalrecord.test.owner=codex-media-promotion-confirm, base/revision=9de88d2,
worktree=block45 y manifest=huella anterior. AutoRemove=true, sin binds/volúmenes
existentes, Mounts vacío, tmpfs /data/db 1 GiB y /data/configdb 32 MiB; RAM 1 GiB,
1 CPU, oplog 64 MiB/WiredTiger 0.25 GiB. Publicación exclusiva 127.0.0.1:27018→27017.
Replica set animalrecord_confirm_test, un miembro 127.0.0.1:27017 anunciado dentro
del contenedor, primary/sesiones 30 min, Mongo 8.0.34/FCV 8.0 comprobados.
URI host con directConnection=true, sin credenciales/base de aplicación.

| Componente | Versión comprobada |
| --- | --- |
| Node / npm | 20.18.0 / 11.0.0 |
| Mongoose / driver mongodb efectivo | 8.21.0 / 6.20.0 |
| Jest / ts-jest / TypeScript | 29.7.0 / 29.4.6 / 5.9.3 |
| AWS S3 SDK / NodeHttpHandler / protocol-http | 3.1003.0 / 4.9.7 / 5.3.11 |

| Comando npm run | Primera pasada | Tiempo Jest | Inicio UTC |
| --- | --- | --- | --- |
| test:integration:media-promotion-confirm | 1 suite, 22/22, npm exit 0 | 12.058 s | 2026-10-29T01:58:24.170Z |
| test:integration:media-promotion-seal | 1 suite, 23/23, npm exit 0 | 8.04 s | 2026-10-29T02:01:28.215Z |
| test:integration:media-promotion | 1 suite, 28/28, npm exit 0 | 8.261 s | 2026-10-29T02:02:07.556Z |
| test:integration:media-promotion-dispatch | 1 suite, 21/21, npm exit 0 | 10.411 s | 2026-10-29T02:02:38.305Z |

Cada opt-in/URI se activó solo alrededor de su comando y se restauró en finally.
Logs/reportes ignorados por Git en node_modules/.cache/confirm46-{confirm,seal,promotion,dispatch}.{log,json}.
Los 22 nuevos validan el recorrido real de la factoría, grants visibles desde el
segundo cliente antes de PUT, retries y MATCH+sello/fences transaccionales, además
de revocación/token/cierre, rollback y cinco respuestas perdidas después de commit
reconocido. Los 72 restantes cubren regresión del protocolo. SDK/Node handler y Mongo
reales; HTTP/bytes/pins/revisiones S3 sintéticos. Sin S3/AWS reales o prueba de
autenticidad, red rota Mongo, UnknownTransactionCommitResult, multinodo/failover,
fin remoto, retención o corte estable. Permisos anteriores conservan incertidumbre.

Limpieza: afterEach/marker/allowlist/drop majority finalizaron sin error en todos
los casos. Consulta independiente verificó los 22 nombres nuevos al terminar su
suite; otra comparó los 94 nombres exactos a las 2026-10-29T02:04:14.199Z:
ninguno presente, solo admin/config/local. Sin drops manuales o por prefijo.
Identidad/imagen/owner/manifiesto revalidados antes de stop por ID. AutoRemove
confirmado a las 2026-10-29T02:04:37.042Z; 27018 sin listener y 27017 conserva PID
6068, sin conectarse a él. Desktop y caché quedaron como estaban, sin intervenir
otros contenedores/servicios. No descarga, Atlas, migración de aplicación o despliegue.

Solo documentación cambia en el 46. Build/lint/compilación/regresión del 45 conservan
su fecha/alcance; no se repitieron sin cambios de código. Sus 103/1849 seleccionadas
y los 94 Mongo son resultados separados; ocho suites globales heredadas pendientes.
HTTP/éxitos/PUT primitivo intactos, sin ajustes frontend o habilitación de callers.
Transferencia deshabilitada e INCOMPLETE/NOT_ASSESSED. Siguiente: readiness/índices
operativos sin crearlos automáticamente y conexión conjunta foto/diario; faltan
otros escritores, retención/corte, commit de negocio y flujo funcional de transferencia.

<details>
<summary>Auditoría: 94 namespaces exactos verificados ausentes</summary>

Concatenar el prefijo de cada grupo con cada sufijo, sin separador. Inventario
extraído de los cuatro logs, sin duplicados; mismo orden de impresión de cada suite.
Todos comprobados individualmente ausentes en la consulta final indicada arriba.

### media-promotion-confirm: 22/22 ausentes

Prefijo exacto: `animalrecord_confirm_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
561314d0b88a403ebc7418a67d647be3
1ce282c8bef74b959f7af2868f0a9cb4
826bfda565994f1d88242e2025aefd5f
dcad3af9f46347f28f060d86608ba11c
55f044b3bb6841679f074a273ef1c5dd
0583c0fbd205479eb74c7f799529f326
be944c6cea8641cbb29ea0ff29dc1398
a834ace4f9c34492b7783ffffc767b8c
87143d749b654a8397314ae4b1e81031
20789c23f28146099bd045efdb2ecf19
6ec6aaa6ccc64c808ede0e71e9c50ddc
1ffb05e122314c72af1423c366e07863
c1181d1fe43745a3b53b1eb7d0e2b154
c4598d8558bd4567adf5ed3eaf93c5fc
d0146f0e03634bcf96c5b82cff917a1e
44950936d571490b9978c03d380769fd
793d1fb5871d41b7ab215b68c0287d4f
042695405a754cca9168709407e66497
4e31c65fc8244285bbb23471faeefa72
5db9781f171040d8b2cbce7744b8243c
91d63db9e07647e193eb3534b44e6e98
ad1f8745588d4cf3a1608e8c246e9b3b
```

### media-promotion-seal: 23/23 ausentes

Prefijo exacto: `animalrecord_seal_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
328aa7c5b3984026aaf2f449ba93799c
9b2823e0826047259cf21aacec0d0430
3e8303dcd1374607902b0564312f3b10
ad1a5b96a3f8499c84a9d5b40c1d3876
53510acf16b94378b0382f01ae7cd5e7
add559f3d37e4ae38b004f610a5e1dff
33bb2ee6d4254d0a92f102074ffcf2f1
791d74319be147319449ce6223ff1c55
242f824ff9e94debb4f37e445051006d
1bfc1612468f41d5b5d6761d21f47353
9da081326bf24fcd988f71af36261793
3e1650d0a69643e09ef9b1bbd2ff5cac
610710a897254c5fbdbdf9a0dc55e530
43a8e3d76f7740d5b9e436bf9f7800e1
aa04ec956a1945c1acccdbd50128bc06
48f807275ea94662a32804dc232a6ca4
2e45f633c368476091726ce645bdd554
b9e545f04a204fadb5ed28d649094223
89aad788ddc64d56a5496a7d79f541af
498d6c2405174071b47b15f6aefe5f78
68a5331de02b4277b2a7ed7376c3ea84
2bdfb5064427486eb5816eda588777d3
9eec4dbf903e4d3aa8492d4a33c09395
```

### media-promotion: 28/28 ausentes

Prefijo exacto: `animalrecord_promotion_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
e797478b44b14fd5a0930cc8b897a8db
168e9e0b338f405da4bea22c16c758f4
406a26ec127c4cf3b699d12de34a3223
060d70fb9ebc4c328d481f311f40b8db
3335927926f540698fbedfe03c439c79
839179a8360f4c5f8e47c7b84923707b
6cae4d515eaa4534b1ac0cdb60c0faaa
0c5ff6c2af7f4a97baf527dab17811a5
228260c6d46042f9911de78129a9fa81
94ffabc3cd6047b3a99b703f41b54ea2
82ca7764e4fb40b592a7a51f8d91a5d1
7c2899fa998f46fd983ae086a5df6ac8
d0a7bfa45f07418b98e30a9516f72aeb
e367804a0bc34d4280749e95a6ce30c4
368c3ead35c54835851c1ce8027219a9
d10591a025e4442fba39c11f64d81835
187a529601d74b6290a08e897f91a231
6fce5edda26d4f0bb315a67a20f17a80
7189d3cd34e94a9ea3fa832931567436
d34a29d2044e4e6cbda3848606ed3009
c371dbf21d8c45d894ebeeb4e8151a38
3aee605165ac4fbdbe65ad3a7220e301
723f598465b046cda9849fe4d354838f
638513acaacd4e96bdff513ae79b62bd
c0812f5461324680b5de5d94682b65cb
81f46d1f08654c6086e78cc6675115eb
35fd83e8d4fd4b929d2bbe65701595cb
160082cf9ae548b0977230150d1aa7b8
```

### media-promotion-dispatch: 21/21 ausentes

Prefijo exacto: `animalrecord_dispatch_test_`. Cada línea siguiente es el sufijo completo de un nombre.

```text
fda484604c25452097b27175821c7046
bab51a4ac994461bbeb4c558c10e0f69
827f5e5ecc144519aeef5065283562f0
f561f642dcf646c9b068a120caa17558
9634dd5763354f009008b55a36bf178e
30668f7bd6f04f7095bbdddc3331ed5b
0d0693837e394946a3b7ba14f82b7b3b
1816c6143ed649edaf0b9dede6e3b4a3
f7c9375819004a33bfdab2fa1a7473ec
d218f226f7f74e969aa0234555a6ede2
97c56cb44a6a4afe8b5a1c062eaa4028
2b7013bee85b4f81bf6f9655087978de
f77244bce7cd45308f958f2e2108f3f2
37bc0c215e5f4401a75f2b6d1d33460e
28852c5527e8482b92d529d26b75f082
7925791e6fc14de6a8753e9cc6386084
2a3a29f8217a4524a2c24d4938a93223
4e564593c40c48b3b6beb0ca00d197da
cd0dd87d31ae4b10b596272f2a590c2c
83e4b5e4900946359cf69ebf247ab0fc
28cfa79f22f743aab413c3c9a54b1662
```

</details>

## Arnés del ciclo completo preparado, bloque 45

Base `9de88d2`, árbol limpio. Preparar una suite opt-in independiente, comando
test:integration:media-promotion-confirm y :check (compila TODOS los arneses).
Exigir MEDIA_PROMOTION_CONFIRM_MONGO_TESTS=1 y MEDIA_PROMOTION_CONFIRM_MONGO_TEST_URI;
sin .env/AppModule, fallback a URI de aplicación, inicio de infraestructura o red S3.
Namespace animalrecord_confirm_test_<UUID sin guiones> por caso, dos clientes,
marker/allowlist propios de cinco colecciones, parser/monitor/cleanup locales
existentes. No ampliar allowlists/configs/transportes anteriores.

Siembra desde create NOT_STARTED con marca inicial, adquisición/permiso ordinarios
y primer pin sintético correcto; sin abrir puerta/declarar efecto/sembrar grants:
eso corresponde a AwsMediaPromotionConfirmation real. Transporte propio debajo
de SDK/Node handler, ligado a UN destino/fuente y revisiones fijas; PUT condicional
y HEAD/GET, sin DELETE/POST u otros hosts/keys. Socket solo a loopback/puerto Mongo
autorizado. Segundo cliente debe ver un permiso nuevo antes de cada PUT falso.
No guardar firmas/Authorization/credenciales/cuerpos en monitor o logs.

Preparar éxito foto/diario, final existente, retries físicos/lecturas, 409/412,
errores inciertos, bytes inválidos, carreras de revocación/claim/cierre, rollback
final, respuesta de aplicación perdida tras commit reconocido en cada fase y
rechazo de replay/legacy sin marca. Pausas antes de primera escritura o en I/O,
promesas observadas/drenadas y recursos SDK cerrados antes de limpiar namespaces.
No simula red rota Mongo/UnknownTransactionCommitResult ni autenticidad S3.

Solo preparar/compilar y validar guardas sin conexión. No trasladar las 72 pruebas
del 42 a resultados del ciclo nuevo. Ejecución Mongo requiere autorización nueva
del entorno concreto. Sin callers/HTTP/reglas/índices de aplicación nuevos;
INCOMPLETE/NOT_ASSESSED y transferencia deshabilitada conservados.

Implementación: [suite](../test/animal-transfer/integration/media-promotion-confirm.mongo.integration.ts),
[fixture](../test/animal-transfer/integration/support/media-promotion-confirm-mongo-fixture.ts),
[guarda](../test/animal-transfer/integration/support/media-promotion-confirm-mongo-safety.ts)
y [transporte](../test/animal-transfer/integration/support/promotion-confirm-transport.ts)
propios. **22 casos compilados, NO ejecutados en Mongo**. Seis casos de éxito/
retries y guardas usan la factoría/SDK reales sobre store simulado: incluidos
en las 52 pruebas sin conexión. Resultado de regresión y límites en el plan.
El log de namespace de setup fallido no acredita creación: createConnection
se sustituye por una excepción en esa prueba, antes de conectar.

El drenaje conserva también promesas subyacentes de observación de permiso y
respuestas falsas, aun cuando una espera bounded vence; no equivale a cancelarlas.
El fixture espera las operaciones de la factoría y sus finally de SDK antes de
eliminar su base; restaura guardas solo después de cerrar conexiones Mongo.
Pérdida de respuesta se inyecta DESPUÉS del commit reconocido, sin falsear resultado
de negocio o fabricar rollback. Ningún permiso encontrado habilita otro PUT.

### Entorno propuesto para el siguiente ensayo, todavía sin autorización

No se inspeccionó Docker, imagen o puertos en el 45. Propuesta basada en el 42;
su disponibilidad debe comprobarse y su permiso anterior no se reutiliza.

| Parámetro | Propuesta concreta |
| --- | --- |
| Entorno | Docker Desktop Linux LOCAL, desktop-linux; inicio en segundo plano si está cerrado, solo tras aprobación específica |
| Imagen | Mongo 8.0.34 por digest sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907, solo caché y --pull never |
| Contenedor nuevo | animalrecord-confirm-mongo-test-9de88d2, labels animalrecord.test.owner=codex-media-promotion-confirm y base=9de88d2 |
| Topología / red | Un miembro animalrecord_confirm_test; 127.0.0.1:27018→27017, directConnection=true |
| Aislamiento | --rm, tmpfs /data/db 1 GiB y /data/configdb 32 MiB, sin binds/volúmenes existentes, RAM 1 GiB/1 CPU, oplog 64 MiB/WiredTiger 0.25 GiB |
| Ejecución | 94 casos: 22 ciclo nuevo + 23 sellado + 28 persistencia + 21 dispatcher, cuatro comandos/opt-ins separados |
| Limpieza | Validar marker/allowlist de cada namespace exacto, comprobar ausencia de los 94 y retirar exclusivamente SU contenedor |

URI propuesta: mongodb://127.0.0.1:27018/?replicaSet=animalrecord_confirm_test&directConnection=true.
La aprobación debe cubrir inspección local/inicio de Desktop si procede, creación/
inicialización de ese replica set, versiones/topología, pruebas y limpieza exclusiva.
No Atlas, Mongo existente 27017, S3/AWS reales, descargas, migraciones o despliegues.
Si falta la imagen, nombre/puerto están ocupados o cambia contexto/aislamiento,
detener y presentar la diferencia. Registrar versiones/resultados por intento y
limpieza de cada nombre antes de retirar el contenedor. Después readiness/índices
y conexión conjunta de callers; no atribuir corte estable o cierre remoto al ensayo.

## Configuración y errores HTTP implementados, bloque 44

Base `913c52c`, árbol limpio. Factoría AWS aislada con bucket, UNA región comercial,
credenciales explícitas (objeto copiado o provider backend) y maxAttempts positivo
por defecto 3. No acepta endpoint/agent/handler/plugins o redirects configurables.
Captura configuración al construir; un lector/cliente propio por confirmación,
destruido después del ciclo incluso ante error. Cada copia usa exclusivamente
MediaPromotionCopyDispatcher con la misma región/credenciales/retries y sin redirects.
IDs de operación/efecto/dispatcher/observación siguen siendo responsabilidad backend;
no los devuelve HTTP ni los sustituye al fallar. Sin provider o conexión a callers.

El lector fija endpoint HTTPS regional derivado, evitando overrides de endpoint
por entorno/perfil; la copia conserva su validador de requests y falla cerrado
antes de permiso/delegación si el SDK resuelve un endpoint ajeno. No interpreta
configuración como autorización de entorno, instalación de índices o cobertura.

Mapeo en el filtro existente, solo para MediaPromotionConfirmationError: CONFLICT
409; UNCERTAIN 500; UNAVAILABLE en INSPECT/VERIFY 502, en las demás etapas 500.
Mensajes fijos sin causa/headers/URLs ni IDs internos. Conservar envoltura vigente
statusCode/message/path/timestamp y los demás errores/éxitos, incluido PUT primitivo.
Esto prepara un contrato de error; callers vigentes aún no producen este error.
Un 500 incierto no demuestra rollback y nunca recomienda reenviar automáticamente.
Índices operativos, arnés Mongo del ciclo y conexión conjunta foto/diario pendientes.

Implementación: [factoría AWS](../src/context/animal-media/infrastructure/aws-media-promotion-confirmation.ts)
y [mapper HTTP](../src/app/animal-media/media-promotion-http-error.ts), usado por el
filtro existente. El SDK anota objetos de credenciales: el snapshot estático se
conserva congelado y se entrega una copia mutable por cliente; el provider backend
capturado también devuelve copias, sin mutar objetos de su dueño. La factoría
no lee .env ni usa cadena de credenciales implícita. No loguear configuración.

Revisión operativa: no hay verificación de readiness o instalación de índices
implementada. Antes de activación, comprobar soporte snapshot/majority y todos
los índices declarados por la persistencia, en particular los seis de
[MediaPromotionRecordSchema](../src/context/animal-media/infrastructure/media-promotion-record.schema.ts)
(identidad/id, recurso por operación, ordinal y lectura). autoCreate/autoIndex
siguen desactivados para esa colección; importarla no prepara Atlas/Lightsail.
Preparar un proceso operativo versionado sigue siendo un trabajo independiente.

## Ciclo aislado implementado, bloque 43

Base `ff29a94`, árbol limpio. El [ensayo 42](./animal-media-promotion-seal-mongo-integration.md)
cerró 23+28+21 casos y su limpieza; los estados del 40/41 siguientes son históricos.
Este bloque une componentes sin activar callers/Nest o publicar errores HTTP.

- Una instancia/una confirmación, contexto backend e IDs separados capturados
  antes de I/O. Abrir puerta nueva y declarar un efecto desde el ticket persistido
  ordinario, fijado y no sellado; comprobar scope y respuestas reconocidas. No
  adoptar puertas, efectos, permisos o MATCH existentes después de un error.
- HEAD previo solo elige la ruta: final presente pasa por verificación completa
  y sello transaccional, sin copiar. Final ausente permite crear el dispatcher
  controlado para UN send; cada retry físico conserva permisos propios. Mantener
  el límite de 5 GiB del modelo de efectos vigente, validado al declarar;
  tickets mayores quedan fuera del ciclo, también si existe un final.
- Send resuelto no basta: verificar bytes/revisión y persistir MATCH+sello juntos.
  Solo errores SDK 409/412 permiten inspección/verificación posterior, como el
  flujo ordinario vigente; no autorizan otra copia. Errores locales de permisos/
  evidencia siempre detienen el ciclo, aunque aparenten 409/412. Otros errores
  de envío conservan incertidumbre y no disparan reconciliación o replay automático.
- IDs de efecto/dispatcher/observación proceden del backend y deben conservarse
  ante error. Sanitizar etapa/motivo sin raw cause/URLs/headers. Un commit incierto
  no se convierte en éxito consultando MATCH. Liberar dispatcher también al fallar.

Pruebas sin infraestructura: adaptador Mongo sobre store simulado y SDK/transporte
nativo falso; incluir ciclo completo, retries, final existente, errores de permiso/
evidencia/commit, concurrencia y mutación de entradas. Wiring/configuración real,
mapeo HTTP y sustitución conjunta de callers quedan para el siguiente bloque.
Sin cambios de negocio, schemas/índices, retención/corte, recuperación o activación
de transferencia; INCOMPLETE/NOT_ASSESSED. El puerto/factoría es una dependencia
backend de confianza: su mera implementación no autentica ni controla un transporte.

Implementación en
[MediaPromotionConfirmation](../src/context/animal-media/application/media-promotion-confirmation.ts)
y [puerto de dispatch](../src/context/animal-media/domain/media-promotion-dispatch.ts).
El error terminal se reexporta desde su ruta anterior, conservando identidad y
comportamiento del dispatcher. El cliente lector pertenece al backend/factoría;
el ciclo solo destruye su dispatcher. No crea clientes, lee .env ni decide
credenciales/regiones/índices, y no se registra en módulos de arranque.

[37 pruebas nuevas](../test/animal-transfer/application/media-promotion-confirmation.spec.ts)
usan SDK/Node handler/verificador y adaptador de persistencia reales sobre store
simulado, sin sockets. Regresión seleccionada 101/1762 aprobada, build/lint/check
correctos; resultados exactos e incidencias centralizados en el
[bloque 43 del plan](./final-delivery-plan.md). No es ejecución Mongo del ciclo
completo ni prueba de fin remoto/retención. Mapeo HTTP sigue propuesto, sin cambios
al filtro actual o a errores públicos; frontend no necesita ajustes por este bloque.

Actualización 41: [arnés opt-in de sellado](./animal-media-promotion-seal-mongo-integration.md)
preparado/compilado, 23 escenarios NO ejecutados contra Mongo. SDK/Node handler/
lector/verificador reales y transporte HEAD/GET falso; 50 guardas sin conexión
aprobadas. Métodos de producción intactos. Entorno concreto pendiente de autorización
nueva; 49 casos reales del 39 no validan este método ni el arnés nuevo.

Subbloque 40, 2026-10-28, base `bcac363`. Contrato registrado antes del código.
Alcance: colaborador aislado, sin Nest/callers/HTTP y sin infraestructura real.
Objetivo aprobado de histórico exacto/copia independiente intacto; no transferencia.
Estado: implementado y probado con modelos/SDK simulados, **85 pruebas nuevas**;
sin validación Mongo/S3 real del nuevo método. Los 49 casos del 39 son históricos
de la versión anterior y no prueban este sellado atómico.

1. Leer sujeto de verificación en snapshot: puerta/efecto/definición/hash y contador
   actual del ticket ordinario fijado y NO sellado. Comparar scope con el contexto
   backend esperado. Es observación, no fence o autorización de commit/envío.
2. Verificar únicamente destino del efecto: HEAD, GET condicionado por ETag y
   VersionId observado (si existe), tamaño exacto y SHA-256 por stream, segundo
   HEAD actual. Ambos HEAD y GET deben coincidir en revisión/tamaño; HEAD debe
   tener MIME, uploadId y digest fijados. Copiar entradas antes de await; cerrar
   stream también ante fallo/exceso. No leer staging ni copiar/borrar/reintentar
   envíos. Un HTTP 200 o una respuesta del dispatcher no sustituyen esta lectura.
3. Persistir MATCH y seal juntos en una transacción corta del adaptador existente:
   CAS de puerta/contador de ticket capturados, definición/hash completos y ticket
   aún no sellado, fences escritos del journal/control actuales. No S3 en tx.
   Las escrituras comparten atomicidad; CAS perdidos/abortos comprobados no dejan
   parciales. Un error no demuestra rollback: pueden haberse confirmado ambas
   escrituras y perderse la respuesta del commit.
   No confirmar por snapshot, adoptar otro sello o actualizar revisiones a ciegas.

El caller backend aporta observationId UUID antes de I/O y lo conserva también
ante error. El colaborador no cambia/reintenta ese ID; tras commit incierto puede
consultarse con el puerto de lectura existente. Encontrar MATCH no autoriza otro
envío, confirma retención o sustituye los fences de un futuro commit de negocio.

La puerta puede estar REVOKED: revocar impide permisos nuevos, no observaciones
ni sellado técnico bajo journal/claim todavía actuales. Si revocación/cualquier
avance gana durante la verificación, su CAS invalida ese sujeto. Se requiere una
nueva lectura/verificación explícita, sin retry automático del colaborador.
Un efecto sin intentos puede verificar un final ya creado por otra confirmación;
MATCH no atribuye causalidad a un intento. Permisos anteriores no se borran ni
se convierten en ACK, rollback o cierre remoto. El sello sigue sin proteger
delete/recreate/retención o cambios posteriores al último HEAD.

Puerto de sellado separado del puerto de dispatch, implementado por el mismo
adaptador Mongo para compartir sesión/fences. Observaciones tardías existentes
siguen disponibles aunque el nuevo sellado no pueda cercar journal/control.
No consumir una fila MATCH previa como permiso por encontrarla. Sin cambios de
schema/índices/TTL/backfill, no retag de journals MAY_RUN o conversión V1.

Errores internos sanitizados por etapa READ/VERIFY/SEAL y motivo CONFLICT/
UNAVAILABLE/UNCERTAIN. No guardar URLs, cuerpos, credenciales, errores crudos o
contenido clínico. Mapeo HTTP propuesto para futura integración: conflicto 409,
lectura Mongo indisponible 500, verificación S3 indisponible 502 y commit incierto
500 con consulta durable; no se publica este mapeo en este bloque. Éxitos actuales,
en especial PUT animal primitivo, siguen intactos. No inventar reglas de negocio.

Pendientes separados: integrar el ciclo completo de confirmación y su error HTTP,
validación Mongo del nuevo método (solo con autorización nueva), ensayo S3 real,
otros escritores/legacy/BDA, retención/cobertura/corte y commit de negocio. Guarda
inicial/V1 y recuperación previa conservadas; INCOMPLETE/NOT_ASSESSED. Impacto
central en [guía frontend](./frontend-animal-transfer-foundations.md).

## Implementación y alcance de confianza

- [MediaPromotionVerifier](../src/context/animal-media/application/media-promotion-verifier.ts):
  verifyAndSeal recibe selección/scope, effectId y observationId del backend.
  Captura identidades antes de I/O y usa definición/revisión congeladas para
  HEAD/GET/HEAD. Comprueba bucket/key, MIME, uploadId, digest, tamaño y revisión
  actual; stream en chunks sin buffering completo y con cierre en finally.
- [Puertos/sujeto](../src/context/animal-media/domain/media-promotion-sealing.ts):
  lectura y escritura separadas de dispatch, sin campos nuevos persistidos.
  Sujeto decodificado/copiado de gate/effect con contador opcional del ticket;
  ausencia de contador no equivale a cero, corrupción/agotamiento falla cerrado.
  No es una capacidad autenticada ni un recibo del proveedor. El adaptador de
  sellado recibe evidencia del colaborador de confianza: JSON MATCH de otro
  caller interno no demuestra por sí mismo que se leyeron bytes.
- [Lector S3](../src/context/animal-media/infrastructure/aws-media-promotion-destination-reader.ts):
  solo HeadObject/GetObject, bucket/key del efecto, GET con IfMatch/VersionId.
  HEAD 404 es ausencia; otros errores no se convierten en vacío. GET 404/412 es
  conflicto, demás errores externos sanitizados. Solo cuerpos Node Readable;
  no crea cliente/credenciales/.env ni expone write/copy/delete. Cliente aportado
  por backend, que conserva su ciclo de vida; ninguna configuración operativa
  o provider Nest se añade aquí. Tests de cliente SDK simulado, sin sockets.
- [Persistencia](../src/context/animal-media/infrastructure/mongo-media-promotion-persistence.ts):
  readForSeal no escribe/adquiere fence. sealVerified relee filas/ticket, valida
  hash, revisiones y último intento, cerca journal/control y actualiza el ticket
  con CAS completo + sealed + incremento, inserta OBSERVATION/MATCH y avanza puerta
  juntos. Observación/permiso previos y tokens no se borran; sin referencias activas,
  propiedad, períodos o eventos de negocio. Tampoco consume una observación previa.
  El nuevo puerto no se exporta/registra como provider en el módulo actual.

El caller conserva su observationId ante error y puede consultar esa fila con
read(selection, observationId). Un commit reconocido devuelve void, sin canCommit,
fin remoto o autorización de repetir. Gate/ticket cambiados exigen nueva verificación
explícita, sin adoptar sello ajeno incluso idéntico. Si journal ya no está activo,
sellar falla, pero apply(OBSERVE_DESTINATION) existente conserva evidencia tardía.

## Validación exacta

- [Verificador y CAS simulado](../test/animal-transfer/infrastructure/media-promotion-verification.spec.ts):
  **69 casos**; foto/diario, metadata, HEAD/GET/HEAD y bytes incorrectos/stream
  fallido, cierre, identidad inmutable, contador, rollback, carrera contra seal
  vigente, revocación durante I/O o previa, cierre/token/owner/versión/lock,
  colisión de ID con permiso y commit perdido con consulta por ID conocido.
  Comprueba MATCH+sello juntos y conserva autorizaciones previas, incluido un
  final existente sin atribuirlo a un intento nuevo.
- [Lector S3 con cliente falso](../test/animal-transfer/infrastructure/aws-media-promotion-destination-reader.spec.ts):
  **16 casos**, comandos bucket/key/IfMatch/VersionId, redacción, errores y cuerpo
  Node/cierre. No usa un SDK transport real ni prueba retries físicos de lecturas.
- Primera focalizada: 69 aprobadas/7 fallidas de 76, 7.392 s. El callback nuevo de
  transacción no retornaba un valor explícito, y el helper rechazaba después del
  commit simulado. Corregido con resultado interno explícito, sin relajar la guarda;
  siguiente pasada **76/76, 8.259 s**. Añadidos nueve casos de contador/lectura/
  inserción fallida: **2 suites/85 pruebas aprobadas, 6.572 s**.
- Regresión seleccionada `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **99 suites/1675 pruebas aprobadas, 34.254 s**, frente a 97/1590. Incluye las 85
  nuevas, no los 49 casos Mongo del 39. Ocho suites globales heredadas siguen como
  deuda separada; no se afirma suite global verde. Aviso Node20/AWS SDK heredado.
- Build, compilación de todos los arneses y ESLint de seis TypeScript correctos.
  Primer lint señaló tipos any de mocks y formato/generator async; corregidos con
  mocks tipados/formato/stream async. Jest fuera del sandbox por EPERM de caché
  conocido. Sin instalación/actualización de paquetes, Mongo/S3/AWS/Docker reales,
  migraciones/índices ejecutados, despliegue, commit o push.
- git diff --check correcto; 293 enlaces locales en trece documentos afectados,
  cero rotos/sin espacios finales. Seis archivos nuevos comprobados por separado.

## Siguiente bloque concreto

Preparar extensión opt-in que pruebe sealVerified en Mongo y las lecturas del
SDK con transporte falso, con guardas propias sin ampliar allowlists anteriores.
Incluir rollback de MATCH/sello/fences, sujeto snapshot viejo, permisos/sello en
ambos órdenes, revocación/cierre y respuesta perdida; ejecución real solo con
autorización específica nueva. Después conectar el ciclo completo de confirmación
y su mapeo HTTP, previa revisión de wiring/configuración/compatibilidad. Mantener
el flujo vigente sin sustituciones parciales y no inferir cierre remoto de MATCH.
