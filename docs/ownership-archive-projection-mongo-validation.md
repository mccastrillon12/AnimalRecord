# Primera validación Mongo de lectura y consumo conjuntos

Subbloque 27, 2026-10-26 (America/Bogota), sobre `e72ec8e`.
Rama `codex/animal-transfer-planning`, HEAD/origin coincidentes y árbol limpio
al retomar. Se autorizó crear el entorno temporal, ejecutar los veinte escenarios
y eliminar exclusivamente sus bases/contenedor sintéticos. **Sin cambios de
código fuente, fixtures, schemas o pruebas para hacerlos pasar.**

## Resultado observado

```text
npm run test:integration:archive-projection
Test Suites: 1 passed, 1 total
Tests:       20 passed, 20 total
Time:        13.96 s
```

Primera ejecución: veinte aprobadas, ningún caso fallido ni reparación necesaria.
Escenarios del [arnés](./ownership-archive-projection-mongo-integration.md) con
modelos, queries, índices, snapshots, commits y abortos Mongo REALES; dos clientes
Mongoose independientes del MISMO proceso Jest. No fueron dos backends desplegados.

Se comprobó lectura sin escrituras seguida de consumo/insert técnico atómicos en
la misma sesión/transacción para archivos/diario, sin archivos, antecedentes y
devolución a A; metadatos de comandos con una única identidad de transacción en
todas las queries/writes monitorizadas, snapshot y commit majority; reserva y
READY conservados; rollback posterior y error del lector que aborta escrituras
previas; rechazo de sesión ajena/options incorrectas; divergencia de payload/plan
frente a observación; y conjunto de 101 entradas/archivos/registros (1.808 s el
caso completo, incluida siembra; no es un benchmark de producción).

Las carreras verificaron expresamente DOS resultados:

- Un snapshot fijado mediante consulta ANTES del competidor puede seguir devolviendo
  el candidato antiguo y confirmar una transacción de SOLO LECTURAS. No adquiere
  un lock ni capacidad para modificar propiedad.
- Si intenta consumir después de ganar otro consumidor o avanzar reserva/fences,
  esa transacción obsoleta no confirma su insert. Releer dentro de la MISMA sesión
  no actualiza el snapshot. Solo queda el ganador; una sesión nueva rechaza la
  evidencia consumida/obsoleta.

También pasaron dos lectores compitiendo por un solo consumo y error de aplicación
DESPUÉS del commit reconocido, sin reconsumir. Este último no es pérdida de paquetes,
UnknownTransactionCommitResult o fallo de red del driver.

## Entorno comprobado

| Componente | Valor observado |
| --- | --- |
| Host / contenedor | Windows, Docker Desktop / Linux amd64 |
| Docker Engine | 28.3.2 |
| MongoDB / FCV | 8.0.34 / 8.0 |
| Replica set | `animalrecord_projection_test`, UN miembro, primary |
| Miembro anunciado | `127.0.0.1:27017` dentro del contenedor |
| Acceso desde Jest | `127.0.0.1:27018`, directConnection=true |
| Sesiones | logicalSessionTimeoutMinutes=30 |
| Node / npm | v20.18.0 / 11.0.0 |
| Mongoose / driver | 8.21.0 / 6.20.0 |

Imagen YA local, fijada por digest y con --pull never, sin descarga:

```text
mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907
```

Docker Desktop estaba abierto al iniciar y quedó abierto. El sandbox denegó
lectura del named pipe; Docker/Jest se ejecutaron fuera con autorización. Había
un PostgreSQL de otro proyecto funcionando: no se intervino ni detuvo/eliminó.
No había Mongo de pruebas activo.

Servidor propio con --rm, etiquetas owner=codex-archive-projection/base=e72ec8e,
puerto SOLO loopback, tmpfs de 1 GiB en /data/db y 32 MiB en /data/configdb, memoria
1 GiB/una CPU, oplog de 64 MiB y caché WiredTiger 0.25 GiB. Se comprobaron
Binds=null y Mounts=[], sin montar archivos/directorios/volúmenes existentes.
No se leyó .env ni se arrancó AppModule. No hubo datos de aplicación, S3/AWS reales,
migraciones, despliegues, commits o push.

## Reproducción explícita del entorno

Estos comandos describen lo ejecutado, no un nuevo arranque automático o una
migración. Para otro ensayo, autorizarlo y comprobar nombre/puerto libres:

```powershell
docker run --detach --rm --pull never --name animalrecord-projection-mongo-test-20261026-e72ec8e --label animalrecord.test.owner=codex-archive-projection --label animalrecord.test.base=e72ec8e --publish 127.0.0.1:27018:27017 --tmpfs /data/db:rw,size=1g --tmpfs /data/configdb:rw,size=32m --memory 1g --cpus 1 mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907 mongod --replSet animalrecord_projection_test --bind_ip_all --port 27017 --oplogSize 64 --wiredTigerCacheSizeGB 0.25
docker exec animalrecord-projection-mongo-test-20261026-e72ec8e mongosh --quiet --eval 'rs.initiate({_id:"animalrecord_projection_test",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Antes de conectar se comprobaron hello/primary/sesiones/versión/FCV. Variables
propias fijadas SOLO durante la llamada y restauradas en finally:

```powershell
$env:ARCHIVE_PROJECTION_MONGO_TESTS = '1'
$env:ARCHIVE_PROJECTION_MONGO_TEST_URI = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_projection_test&directConnection=true'
npm run test:integration:archive-projection
```

## Limpieza comprobada

AfterEach verificó namespace/UUID del marker/lista cerrada y eliminó cada base.
Consulta posterior listDatabases con filtro por sus VEINTE nombres EXACTOS:

```json
{"checkedExactNames":20,"remaining":[]}
```

Inventario exacto de nombres observados:

```text
animalrecord_evidence_test_9da4518e362b471f8ed83f53596d4044
animalrecord_evidence_test_e358006030de44c0adbdc1ad6d2f9145
animalrecord_evidence_test_ed37d4dad9524ff4a32b591bc7bb692a
animalrecord_evidence_test_bbcb29d3eeed49a49ed7a7777e949c97
animalrecord_evidence_test_da4b5235b67f45d89b92d2c07317cb64
animalrecord_evidence_test_e92448a38e5b4f26a19c4b7d9c188f98
animalrecord_evidence_test_509a4d2d05bc4d9fa06f993c620a0357
animalrecord_evidence_test_339507f2ae5343049f64e1ec28e77a8b
animalrecord_evidence_test_0a2dfdf80d3347c197c92b9479f29e57
animalrecord_evidence_test_f2a477fbab034af7ba89dc59e8d29461
animalrecord_evidence_test_78634ea35ff2445eb52250b6588d9f0d
animalrecord_evidence_test_62cf7508a91e415ba01ca030dbe64a9f
animalrecord_evidence_test_313d7af0d0184931b06841e5e970781a
animalrecord_evidence_test_1c442dd55ccd4289b0a431729f513a5c
animalrecord_evidence_test_fd2e7589714f4469b224a23ddd181594
animalrecord_evidence_test_ee4e7642a70e40d489e56ecf52ce2c17
animalrecord_evidence_test_ca40c27983a745868128cc426a5ff0e5
animalrecord_evidence_test_638b236072d446d0b2cda3570fbfb74e
animalrecord_evidence_test_cf3e1890d8d04808aac65bebc15403ae
animalrecord_evidence_test_6ba7f54d362f4051a1fcd57c8838300f
```

Contenedor `animalrecord-projection-mongo-test-20261026-e72ec8e`, ID:

```text
80eca6b5ec44a0e06152cc366fa361311aa1bf291a8901f1dbf3c40505e952b9
```

Se revalidaron ID/etiquetas/--rm/aislamiento antes de stop por ese ID exacto;
Docker eliminó el contenedor/almacenamiento temporal. Consulta posterior por ID:
sin resultados. PostgreSQL existente siguió healthy. La imagen queda en caché;
no quedan bases o contenedor Mongo de este ensayo.

## Otras verificaciones y compatibilidad

- npm run build, npm run test:integration:animal-writes:check y git diff --check:
  aprobados en este bloque. Sin TypeScript nuevo/modificado: ESLint no aplica.
- Regresión seleccionada de la BASE: 85 suites/1191 pruebas aprobadas en el
  subbloque 26. No se repitió al cambiar solo documentación; no se presenta ese
  número como nueva ejecución. Los veinte casos Mongo anteriores son un resultado
  separado, recién ejecutado. Ocho suites globales heredadas con fallos siguen
  aparte; no se declara verde la suite global.
- Sin cambios de contrato runtime/HTTP/DTO/éxitos/errores/URLs, PUT animal primitivo,
  schemas/índices de aplicación/dependencias, clínica/IA/BDA/códigos/categorías/
  extracción/acceptedAt/48 h/nameHistory (nombres). Flutter no requiere ajustes.
- Recibos S3 e insert {_id, projectionHash} son SINTÉTICOS; no se persistió un
  candidato/payload clínico o recibo durable de negocio. No acredita aplicación
  de referencias/propiedad/períodos/eventos ni idempotencia de una transferencia.

## Límites y siguiente bloque

Mayoría de un miembro NO demuestra replicación/durabilidad multinodo, elecciones,
failover, particiones, rollout mixto, respuestas Mongo inciertas o muerte/reinicio
de procesos. Inyección epoch +2 no es cancelación/release-reacquire funcional.
El caso de 101 elementos no representa tamaño/duración de todos los expedientes.

No prueba fin remoto, estabilidad futura de bytes S3, IAM/lifecycle/retención,
permisos históricos o captura completa entre períodos. Error no implica rollback
de efectos remotos; MAY_RUN sigue significando que el callback pudo ejecutarse.
No recuperar legacy/MAY_RUN/efectos inciertos por edad o error.

Siguiente bloque concreto: auditar TODOS los escritores/efectos remotos del
expediente (journal, activeWrites, tickets/PUT emitidos, promociones/copias e IA)
y documentar el contrato de evidencia para un CORTE ESTABLE S3 antes del futuro
commit de negocio. Separar garantías demostradas, protocolos faltantes y pruebas
reales necesarias; no convertir ausencia de tokens, error, tiempo vencido o un
HEAD observado en prueba de fin remoto. Es revisión/protocolo interno, no
autorización de AWS, limpieza, recuperación o publicación. Después implementar
las garantías pendientes y el commit conjunto con autorización/idempotencia,
permisos/retención/captura posterior/OTP/solicitudes/notificaciones. Transferencia
completa deshabilitada; vencimiento/cancelación siguen sin decidir.

Compatibilidad central:
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
