# Primera validación real del protocolo de escrituras

Subbloque 11, 2026-10-25 (America/Bogota), sobre `8ffe44c`.
Rama `codex/animal-transfer-planning`; HEAD y origin coincidían y el árbol estaba
limpio al retomar. Se ejecutó el arnés sin modificar código fuente ni pruebas.

## Resultado observado

```text
npm run test:integration:animal-writes
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
Time:        5.194 s
```

Los once escenarios del [arnés](./animal-write-mongo-integration.md) pasaron con
adaptadores y transacciones Mongo reales. Dos conexiones Mongoose independientes
desde un mismo proceso Jest; no fueron dos procesos del backend ni un despliegue.

Se verificaron índices únicos reales/sin TTL; token y autorización del journal
en una misma transacción snapshot con commit de mayoría reconocido; abortar la
inserción al denegar autorización; ambas carreras con adquisición y MAY_RUN;
reintento de snapshot obsoleto; rollback de retiradas multi-animal ante identidad
legacy inconsistente; recuperación/repetición auditada después de ocultar al
llamador el resultado de un commit real; reserva posterior preservada; y
exclusiones de NOT_INVOKED con permiso previo/journals sin protocolo nuevo.

No hubo fallos de los escenarios ni necesidad de corregir el arnés/protocolo.
El caso de snapshot obsoleto exigió observar el token confirmado por la adquisición
ganadora y más de un intento de recuperación; no bastó con un retorno exitoso.

## Entorno comprobado

| Componente | Valor observado |
| --- | --- |
| Host de pruebas | Windows, Docker Desktop/WSL 2; contenedor Linux x86_64 |
| Docker Engine | 28.3.2 |
| MongoDB | 8.0.34, FCV 8.0 |
| Replica set | `animalrecord_test`, un miembro, primario escribible |
| Miembro anunciado dentro del contenedor | `127.0.0.1:27017` |
| Acceso desde el arnés | `127.0.0.1:27018`, directConnection=true |
| Sesiones | logicalSessionTimeoutMinutes=30 |
| Node / npm | v20.18.0 / 11.0.0 |
| Mongoose / driver MongoDB | 8.21.0 / 6.20.0 |
| Imagen oficial resuelta | `mongo:8.0` |

Digest exacto descargado y ejecutado:

```text
mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907
```

Docker Desktop estaba apagado al comenzar y se inició con autorización. No había
Mongo local ni imagen Mongo instalada; se descargó la imagen anterior. El servidor
de pruebas se creó con identidad/etiquetas propias, puerto solo loopback, --rm,
tmpfs de 1 GiB en /data/db y 32 MiB en /data/configdb, límite de memoria 1 GiB/una
CPU, oplog de 64 MiB y caché WiredTiger de 0.25 GiB. No se montaron archivos,
directorios o volúmenes existentes. No se leyó `.env` ni se arrancó la aplicación.

## Reproducción del entorno usado

Revisar primero puerto libre y nombre no existente. Estos comandos son una receta
explícita de prueba, no un nuevo arranque automático del arnés o del backend:

```powershell
docker run --detach --rm --name animalrecord-write-mongo-test-20261025-8ffe44c --label animalrecord.test.owner=codex-write-journal --label animalrecord.test.base=8ffe44c --publish 127.0.0.1:27018:27017 --tmpfs /data/db:rw,size=1g --tmpfs /data/configdb:rw,size=32m --memory 1g --cpus 1 mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907 mongod --replSet animalrecord_test --bind_ip_all --port 27017 --oplogSize 64 --wiredTigerCacheSizeGB 0.25
docker exec animalrecord-write-mongo-test-20261025-8ffe44c mongosh --quiet --eval 'rs.initiate({_id:"animalrecord_test",members:[{_id:0,host:"127.0.0.1:27017"}]})'
```

Esperar/verificar primario con db.hello() antes de ejecutar. Las variables se
fijaron solo en el proceso de la terminal, sin editar configuración persistente:

```powershell
$env:ANIMAL_WRITE_MONGO_TESTS = '1'
$env:ANIMAL_WRITE_MONGO_TEST_URI = 'mongodb://127.0.0.1:27018/?replicaSet=animalrecord_test&directConnection=true'
npm run test:integration:animal-writes
```

## Limpieza observada

- Base aleatoria creada por el arnés:
  `animalrecord_write_test_17ddb7fa1953400faeb2218f762cd6e8`.
- afterAll verificó nombre/marcador/colecciones y eliminó esa base. Una consulta
  posterior listDatabases filtrada por el nombre EXACTO devolvió cero resultados.
- Contenedor: `animalrecord-write-mongo-test-20261025-8ffe44c`, ID
  `5e3b3583ac7ec89affdfa6f181f985730ae9ec73c9f4c51aecc6a4b004091609`.
  Se verificaron ID, nombre, etiquetas, --rm y aislamiento antes de detenerlo
  por su ID exacto; Docker eliminó el contenedor y su almacenamiento temporal.
- Solo se borraron datos sintéticos de esta ejecución; el contenedor/base no son
  recuperables ni contienen un expediente que conservar. La imagen queda en
  caché para reutilizarla. No se detuvieron ni eliminaron otros contenedores.

## Límites y siguiente paso

Mayoría en este replica set de un miembro significa mayoría de UN miembro; no
prueba replicación/durabilidad multinodo, elecciones, failover o particiones.
La pérdida de respuesta se inyectó en aplicación después del acknowledgement del
driver; no prueba pérdida de paquetes ni UnknownTransactionCommitResult del servidor.
No hubo muerte/reinicio de procesos, S3/AWS, llamadas de negocio contra datos de
aplicación, migración legacy ni intervención operativa sobre tokens existentes.

MAY_RUN continúa expresando posibilidad, error no implica rollback y cierre local
no demuestra fin de efectos remotos. No se ampliaron permisos ni recuperación,
no se habilitó aceptación y no se definieron vencimiento/cancelación.

El siguiente bloque de implementación es incorporar antecedentes retenidos a la
captura con procedencia/referencias explícitas y pruebas A→B→C/devolución. Mantener
la guarda del periodo inicial hasta que esa importación garantice un expediente
completo. Recuperación general/legacy/callbacks posibles, autorización del llamador
operativo, ensayos multinodo/fallos de red, S3 tardío y activación/retención siguen
pendientes separados antes del release. Contrato frontend sin cambios en esta
validación; registro central en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
