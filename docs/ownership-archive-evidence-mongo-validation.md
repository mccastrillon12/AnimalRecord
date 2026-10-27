# Primera validación Mongo del consumo de evidencia

Subbloque 23, 2026-10-26 (America/Bogota), base `9cbf17d`.
Rama `codex/animal-transfer-planning`, HEAD/origin coincidentes y árbol limpio
al comenzar. Ejecución sobre entorno temporal expresamente autorizado.

## Resultado y corrección necesaria

Primer intento: **14 pruebas fallidas y 1 aprobada**, 8.466 s. El caso sin archivos
pasó; los demás fallaron al reconstruir el plan durante seedObserved, ANTES
del consumo. La prueba real descubrió un defecto de serialización del snapshot:
Mongoose minimizaba objetos vacíos del payload, incluidos extracciones por
categoría y campos adicionales vacíos, mientras contentHash conservaba el
contenido original. No era un permiso denegado ni motivo para relajar integridad.

Se reprodujo SIN conexión con documentos Mongoose y snapshots nuevos/retenidos:
dos casos fallidos antes del arreglo. OwnershipArchiveEntrySchema ahora usa
`minimize: false`, conservando los objetos vacíos incluidos en el hash. No se
cambia canonicalJson, la definición de contentHash ni las guardas. La siembra
del arnés usa `entries.create`, la misma serialización documental que append del
repositorio real, en vez de insertMany. Dos casos de regresión sin conexión
pasan después del arreglo. No cambia el documento médico activo o el flujo IA.

Segundo intento, DESPUÉS de la corrección:

```text
npm run test:integration:archive-evidence
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
Time:        9.09 s
```

Los quince escenarios del [arnés](./ownership-archive-evidence-mongo-integration.md)
pasaron usando modelos, índices, sesiones, snapshots, commits y abortos Mongo
reales. Dos clientes/conexiones Mongoose de un proceso Jest, no dos procesos
de backend. Se observó una transacción compartida para control/cabecera/corrida
e insert sintético; snapshot y commit majority; visibilidad externa solo tras
commit; rollback por fallo posterior y por CAS final cero aun capturando error;
consumo único ante snapshots competidores; ambos órdenes de escritura del control;
rechazo de deriva de reserva/pipeline; sesiones ajenas/options inválidas;
duplicados/índices únicos sin TTL; y resultado durable tras ocultar en aplicación
una respuesta DESPUÉS del commit reconocido.

## Entorno observado

| Componente | Valor |
| --- | --- |
| Host / contenedor | Windows, Docker Desktop / Linux amd64 |
| Docker Engine | 28.3.2 |
| MongoDB / FCV | 8.0.34 / 8.0 |
| Replica set | `animalrecord_evidence_test`, un miembro, primary |
| Miembro anunciado | `127.0.0.1:27017` dentro del contenedor |
| Acceso desde Jest | `127.0.0.1:27018`, directConnection=true |
| Sesiones | logicalSessionTimeoutMinutes=30 |
| Node / npm | v20.18.0 / 11.0.0 |
| Mongoose / driver | 8.21.0 / 6.20.0 |

Imagen local fijada, sin descarga:

```text
mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907
```

Docker Desktop estaba apagado y se inició con autorización para este ensayo.
El sandbox denegó acceso al named pipe; las operaciones Docker y Jest se
ejecutaron fuera de él con autorización. No se cambió configuración persistente.
Un contenedor PostgreSQL existente se reactivó al iniciar Docker Desktop; no se
intervino, detuvo o eliminó.

Servidor con --rm, etiquetas owner=codex-archive-evidence/base=9cbf17d, puerto
publicado SOLO en loopback, tmpfs de 1 GiB en /data/db y 32 MiB en /data/configdb,
1 GiB de RAM/una CPU, oplog 64 MiB y caché WiredTiger 0.25 GiB. Binds=null y
Mounts=[] comprobados; sin montar datos o volúmenes existentes. No se leyó .env,
no se arrancó AppModule ni se ejecutaron migraciones/despliegues.

## Receta explícita del ensayo

Solo después de autorizar un nuevo ensayo, comprobar nombre/puerto libres;
no es un arranque automático ni una instrucción de migración:

```powershell
docker run --detach --rm --pull never --name animalrecord-evidence-mongo-test-20261026-9cbf17d --label animalrecord.test.owner=codex-archive-evidence --label animalrecord.test.base=9cbf17d --publish 127.0.0.1:27018:27017 --tmpfs /data/db:rw,size=1g --tmpfs /data/configdb:rw,size=32m --memory 1g --cpus 1 mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907 mongod --replSet animalrecord_evidence_test --bind_ip_all --port 27017 --oplogSize 64 --wiredTigerCacheSizeGB 0.25
docker exec animalrecord-evidence-mongo-test-20261026-9cbf17d mongosh --quiet --eval 'rs.initiate({_id:"animalrecord_evidence_test",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Comprobar hello/primary y versiones antes del comando. Variables propias fijadas
solo durante la llamada y restauradas en finally:

```powershell
$env:ARCHIVE_EVIDENCE_MONGO_TESTS = '1'
$env:ARCHIVE_EVIDENCE_MONGO_TEST_URI = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_evidence_test&directConnection=true'
npm run test:integration:archive-evidence
```

## Limpieza comprobada

AfterEach verificó namespace/marcador/lista cerrada y eliminó cada base generada,
también las de los casos que fallaron antes del consumo. Consulta posterior a
listDatabases con filtro por los TREINTA nombres EXACTOS devolvió:

```json
{"checkedExactNames":30,"remaining":[]}
```

Nombres observados del primer intento:

```text
animalrecord_evidence_test_23d7329008a0420e902bac004084800f
animalrecord_evidence_test_797641dc36f543fdad753c3352942aa1
animalrecord_evidence_test_3719817f6e6e41299164f7485ed81529
animalrecord_evidence_test_375ffd0640384103a319900680cfb1ff
animalrecord_evidence_test_3178b445405e40f88ebb9dda497a5173
animalrecord_evidence_test_8b1d65e482d7410993a03dbac7eb209c
animalrecord_evidence_test_3405c63e774249fba9f34cdd1a87f19c
animalrecord_evidence_test_4562a7a8857b48b09597df6e06a1e918
animalrecord_evidence_test_0711dd398053482c9f6ca456b41c19a0
animalrecord_evidence_test_7c19d409a8eb4293a3a0131de36bf45b
animalrecord_evidence_test_514b04372bfb40ecadee1841feb79294
animalrecord_evidence_test_a04385823650457b87a2b5813abf58e2
animalrecord_evidence_test_6e01cf61a05547a9bd535856bf66f651
animalrecord_evidence_test_db14e7dd1f144cee9f726762fc71786a
animalrecord_evidence_test_364c6403bea84c96ad7959948e322d84
```

Nombres observados del segundo intento:

```text
animalrecord_evidence_test_1e08698dc9464e2593ed2ab27356c052
animalrecord_evidence_test_1c00f956a7ec47f98049d938ed33ebde
animalrecord_evidence_test_c7c087171e374ce6a0dddd374dba9cd9
animalrecord_evidence_test_ce626134c29b4eb5953b40571d66940d
animalrecord_evidence_test_5940179cc5cb4149aa6c08e3e6fb7350
animalrecord_evidence_test_daa663db60174cc5bc9378918387d6b9
animalrecord_evidence_test_2897e1cbe7334449a714a0a2cd0f4013
animalrecord_evidence_test_f101a86db97549249c5788de458eec24
animalrecord_evidence_test_8402c4def00c47a187f13e6949fc39d1
animalrecord_evidence_test_92f0224f73d54fe88fd983cbd8bcd01c
animalrecord_evidence_test_a2a603b902ac40c6a98a39248736b026
animalrecord_evidence_test_29eced28716f4fc5ae6a29ab819a33cc
animalrecord_evidence_test_78c191a30f8c452fb4372b8139952198
animalrecord_evidence_test_128c226798a347bbb1320a1534c2bc69
animalrecord_evidence_test_ce4e49b8ff274a8ab053986de53a64f3
```

Contenedor `animalrecord-evidence-mongo-test-20261026-9cbf17d`, ID:

```text
24beeb7289a86a9932f99b32fe35e9864917fa99185681c58124b1217391d8fa
```

Se revalidaron ID/etiquetas/--rm/aislamiento antes de stop por ese ID exacto.
Docker eliminó el contenedor y su almacenamiento temporal; consulta posterior
por ID no devolvió contenedores. PostgreSQL existente permaneció funcionando.
La imagen queda en caché y Docker Desktop sigue abierto. No quedan recursos
Mongo de este ensayo.

## Regresión, compatibilidad y límites

- Regresión seleccionada: **82 suites/1073 pruebas** aprobadas, frente a 81/1071.
  Nueva suite con dos casos de serialización sin conexión; los quince Mongo se
  ejecutan por separado. No se suman como pruebas ordinarias.
- Build, compilación de todos los arneses, ESLint de TypeScript nuevo/modificado
  y git diff --check aprobados. Sin cambios de dependencias, índices de aplicación,
  DTO/cuerpos/errores públicos, PUT animal primitivo, clínica/IA/BDA/códigos/
  categorías/acceptedAt/48 h o nameHistory (nombres).
- Entradas ya persistidas con contenido podado no se reparan, rellenan o rehashéan.
  Seguirán fallando integridad. No se prueba su existencia en ninguna base de
  aplicación; cualquier tratamiento requerirá inventario y protocolo separado.
  Todas las instancias escritoras deben usar el schema corregido.
- Mayoría de un nodo NO prueba replicación/durabilidad multinodo, failover,
  particiones ni respuestas Mongo inciertas. Error tras commit es de aplicación,
  no pérdida de paquetes o UnknownTransactionCommitResult.
- Recibos S3 e insert conjunto son SINTÉTICOS. No hubo S3/AWS reales, muerte de
  procesos ni cambios de propietario/períodos/referencias/eventos de negocio.
  No prueba captura completa entre períodos o fin de operaciones remotas.
- Ocho suites globales heredadas con fallos siguen separadas. No se ejecutó ni se
  declara verde la suite global. Sin commits o push.

Siguiente bloque: proyección pura de referencias destinatarias desde snapshots,
planes e intenciones/registros generacionales verificados, con validación de
conjunto/procedencia y pruebas de no mutación; sin escribir colecciones activas
o publicar. Es preparación del futuro commit conjunto, no autorización para
ejecutarlo. Corte estable S3, permisos/retención, autorización/idempotencia,
captura posterior, integración de commit y OTP/decisiones/notificaciones siguen
pendientes. No inventar cancelación/vencimiento ni recuperar legacy/MAY_RUN
por edad/error. Transferencia completa deshabilitada.

Compatibilidad central:
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
