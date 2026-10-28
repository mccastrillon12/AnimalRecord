# Ensayo local de promociones: procedimiento pendiente de autorización

Actualización 2026-10-27: procedimiento autorizado y ejecutado en el subbloque 33;
26/26 casos aprobados tras corregir una expectativa del test, 52 bases de dos
intentos eliminadas y contenedor retirado. [Registro de validación](./animal-media-promotion-mongo-validation.md).
Las secciones siguientes conservan la propuesta y observaciones previas; otra
ejecución requiere autorizar su entorno, sin trasladar este permiso.

2026-10-26 (America/Bogota). Base comprobada: `9ca8456`, rama
`codex/animal-transfer-planning`, árbol limpio antes de esta preparación.
**Documento preparado; entorno NO creado y 26 escenarios Mongo NO ejecutados.**
Complementa el [arnés del subbloque 32](./animal-media-promotion-mongo-integration.md).
La ejecución real del siguiente subbloque continúa pendiente.

Cierre de la preparación: 2026-10-27. Rama/HEAD revalidados sin cambios; se
conservaron los cinco documentos de esta preparación al retomar. Las observaciones
de puertos/procesos siguientes corresponden a la revisión previa del 2026-10-26,
no a una comprobación nueva de disponibilidad.

## Revisión previa y evidencia actual

Se revisaron la suite completa, fixture, parser/opt-in, barreras, monitor, drenaje,
limpieza, schema de promociones y adaptador transaccional. No se identificó un
cambio de código necesario antes del ensayo. Esto no demuestra que los casos
pasen en Mongo: índices, conflictos reales y duraciones deben comprobarse allí.

- Dos clientes independientes por caso; namespace aleatorio propio y marker UUID.
  La lista cerrada contiene únicamente `_animalrecord_write_test_owner`,
  `animal_ownership_controls`, `animal_write_journals`, `animal_media_uploads`
  y `animal_media_promotion_records`. Animal/período son modelos auxiliares;
  sus colecciones no se crean. No se carga `.env` ni AppModule.
- El fixture crea explícitamente cuatro colecciones y sus índices; cleanup exige
  nombre exacto, marker coincidente y ninguna colección fuera de la lista antes
  de `dropDatabase` con mayoría. Un marker no reconocido o proceso interrumpido
  puede dejar residuos; no permite limpiar por prefijo.
- Siembra journal desde NOT_STARTED con opt-in inicial; adquisición y permiso
  ordinarios. Las barreras son de un uso, compatibles con retry de transacción;
  liberación/drenaje anteceden a limpieza. No hay dispatch dentro del callback.
- Las respuestas perdidas se inyectan DESPUÉS del commit reconocido. No se simula
  fallo de red ni UnknownTransactionCommitResult; SDK_RETRY y pins S3 son datos
  sintéticos. Un permiso encontrado no autoriza reenviarlo.

Lectura del sistema operativo, sin conexión a servicios: `mongod` PID 6296 escucha
en `127.0.0.1:27017`; **ese servidor existente queda fuera del ensayo**. No había
listeners en 27018/27019 en esta observación. Docker Desktop y su backend estaban
en ejecución. No se contactó al daemon Docker ni se verificó su contexto, versión
o caché de imágenes. Revalidar disponibilidad antes de cualquier arranque.
La primera lectura de puertos fue denegada por el sandbox; la repetición autorizada
fuera de él solo consultó puertos/procesos del sistema operativo.

| Componente local | Comprobado ahora |
| --- | --- |
| Node / npm | v20.18.0 / 11.0.0 |
| Mongoose / driver Mongo | 8.21.0 / 6.20.0 |
| Jest / ts-jest / TypeScript | 29.7.0 / 29.4.6 / 5.9.3 |
| Mongo propuesto | 8.0.34, FCV 8.0; referencia del ensayo anterior, aún no verificado aquí |
| Docker Engine / imagen en caché | Pendientes de inspección autorizada |

Referencia de imagen/topología: [validación del subbloque 27](./ownership-archive-projection-mongo-validation.md).
No se traslada su autorización ni sus resultados a este ensayo.

## Entorno concreto propuesto

| Parámetro | Propuesta para aprobar |
| --- | --- |
| Motor | Docker Desktop Linux local; verificar endpoint local antes de mutar |
| Imagen | `mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907`, exclusivamente caché local, `--pull never` |
| Contenedor nuevo | `animalrecord-promotion-mongo-test-20261026-9ca8456` |
| Etiquetas | `animalrecord.test.owner=codex-media-promotion`, `animalrecord.test.base=9ca8456` |
| Replica set | `animalrecord_promotion_test`, UN miembro primary |
| Puerto publicado | Solo `127.0.0.1:27018` hacia 27017 del contenedor |
| Miembro anunciado | `127.0.0.1:27017` dentro del contenedor; Jest usa directConnection=true |
| Datos temporales | tmpfs `/data/db` 1 GiB y `/data/configdb` 32 MiB; sin directorios o volúmenes existentes |
| Recursos / ciclo de vida | 1 GiB RAM, 1 CPU, oplog 64 MiB, caché WiredTiger 0.25 GiB, `--rm` |

URI exclusiva propuesta:

```text
mongodb://127.0.0.1:27018/?replicaSet=animalrecord_promotion_test&directConnection=true
```

La autorización solicitada cubre inspección del Docker local/contexto/imagen,
creación de ESE contenedor, inicialización de SU replica set, consultas de
topología/versiones, ejecución de los 26 casos y eliminación verificada de SUS
bases/contenedor. No cubre Atlas, el mongod existente, otros contenedores, S3/AWS,
descargas de imágenes, migraciones de aplicación ni despliegue. Si falta la imagen,
el motor es remoto, el nombre/puerto está ocupado o cambia el aislamiento, detener
el procedimiento y presentar la diferencia antes de usar otro entorno.

## Secuencia para después de autorizar

1. Releer Git y comprobar que suite/guardas no cambiaron desde la revisión.
   Comprobar endpoint efectivo de Docker local (incluidas variables de selección),
   versión del engine, digest/ID de imagen, ausencia del nombre exacto y puerto
   27018 libre. No reutilizar un contenedor o base existente por coincidencia.
   Si Docker Desktop ya no está abierto, pedir autorización para iniciarlo.
2. Crear el contenedor siguiente SOLO tras esas comprobaciones. Registrar el ID
   devuelto y contrastar imagen, etiquetas, puerto loopback, AutoRemove, límites
   y mounts/tmpfs; no admitir binds ni volúmenes persistentes/ajenos.

```powershell
docker run --detach --rm --pull never --name animalrecord-promotion-mongo-test-20261026-9ca8456 --label animalrecord.test.owner=codex-media-promotion --label animalrecord.test.base=9ca8456 --publish 127.0.0.1:27018:27017 --tmpfs /data/db:rw,size=1g --tmpfs /data/configdb:rw,size=32m --memory 1g --cpus 1 mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907 mongod --replSet animalrecord_promotion_test --bind_ip_all --port 27017 --oplogSize 64 --wiredTigerCacheSizeGB 0.25
docker exec animalrecord-promotion-mongo-test-20261026-9ca8456 mongosh --quiet --eval 'rs.initiate({_id:"animalrecord_promotion_test",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

3. En el contenedor creado, comprobar `hello`, `buildInfo`, FCV y configuración
   del replica set: nombre exacto, un miembro, primary y sesiones. Espera acotada
   de disponibilidad; ante fallo detener el ensayo, sin conectar a 27017 del host.
4. Activar las DOS variables propias solo alrededor del comando. Capturar salida,
   código npm, nombres exactos de las bases impresas, número de casos y duración.
   Este ejemplo restaura el entorno incluso si falla; no se ha ejecutado:

```powershell
$promotionPreviousOptIn = $env:MEDIA_PROMOTION_MONGO_TESTS
$promotionPreviousUri = $env:MEDIA_PROMOTION_MONGO_TEST_URI
try {
  $env:MEDIA_PROMOTION_MONGO_TESTS = '1'
  $env:MEDIA_PROMOTION_MONGO_TEST_URI = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_promotion_test&directConnection=true'
  npm run test:integration:media-promotion
  $promotionTestExit = $LASTEXITCODE
  if ($promotionTestExit -ne 0) { throw "Media promotion integration failed: exit $promotionTestExit" }
} finally {
  $env:MEDIA_PROMOTION_MONGO_TESTS = $promotionPreviousOptIn
  $env:MEDIA_PROMOTION_MONGO_TEST_URI = $promotionPreviousUri
}
```

5. Verificar limpieza aunque falle Jest. El afterEach drena y elimina cada base
   propia después de verificar marker/lista. Consultar en ESE servidor
   `listDatabases` filtrado por los nombres EXACTOS capturados (no por prefijo),
   y registrar cuáles permanecen. Para una pasada completa se esperan 26 nombres
   distintos; si hay fallos de setup o reejecuciones, registrar el total observado
   y cada intento por separado. No afirmar limpieza por un exit 0 de Jest solo.
6. Ante residuos, registrar nombre y causa; no saltar las guardas ni hacer barrido
   de bases. Si se perdió identidad/aislamiento, conservar y pedir revisión. Con
   identidad del contenedor propio verificada, su retirada elimina únicamente su
   almacenamiento temporal; distinguir ese resultado de un dropDatabase confirmado.
7. Antes de detenerlo, revalidar ID completo, etiquetas, imagen y aislamiento del
   contenedor CREADO. `docker stop` solo de ese ID; `--rm` retira el contenedor y
   tmpfs. Comprobar ausencia por ID y puerto liberado. Conservar Docker Desktop,
   imagen en caché, mongod de 27017 y demás servicios existentes.
8. Documentar resultados reales, errores/arreglos/repeticiones y limpieza exacta
   en un registro de validación y en el plan. Una corrección de código requiere
   comprobaciones focalizadas; no ampliar la autorización a otros entornos.

## Validación realizada sin infraestructura

- `npm run test:integration:media-promotion:check`: aprobado; compilación de todos
  los arneses, sin casos Mongo ejecutados.
- Cuatro suites de guardas (promoción, parser local, evidencia y proyección):
  **4 suites / 95 pruebas aprobadas**, 3.399 s. Primer intento: EPERM de caché Jest,
  cuatro suites sin ejecutar, cero casos. Repetición autorizada fuera del sandbox.
- `npm run test:integration:media-promotion -- --listTests`: una sola suite,
  `media-promotion-persistence.mongo.integration.ts`, sin ejecutar globalSetup/casos.
- Solo documentación modificada; build, ESLint y regresión de negocio no repetidos.
  Las 92 suites/1398 pruebas del bloque 32 conservan su fecha y alcance; ocho
  suites globales heredadas siguen como deuda, sin afirmar suite global verde.
- Cierre documental del 2026-10-27: `git diff --check` correcto; cinco documentos,
  115 enlaces locales comprobados, cero rotos y sin espacios finales (incluido
  este archivo nuevo). Sin cambios en src, test, package.json o package-lock.json.

Transferencias completas siguen deshabilitadas. El ensayo propuesto solo valida
persistencia Mongo en un nodo; no prueba failover, transporte/retries AWS, corte
estable, retención o commit conjunto de negocio. Objetivo funcional aprobado y
decisiones pendientes intactos. Impacto centralizado en la
[guía frontend](./frontend-animal-transfer-foundations.md).
