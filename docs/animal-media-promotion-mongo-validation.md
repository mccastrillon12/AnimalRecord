# Primera validación Mongo de persistencia de promociones

Subbloque 33, 2026-10-27 (America/Bogota), base `0e928fd`.
Rama `codex/animal-transfer-planning`, HEAD y referencia origin coincidentes,
árbol limpio al comenzar. Autorización expresa del usuario para inspeccionar,
crear, ejecutar y limpiar el entorno del [procedimiento](./animal-media-promotion-mongo-runbook.md).

## Resultado y corrección del test

- Primer intento: **25 aprobadas / 1 fallida**, 1 suite fallida, 22.851 s, npm exit 1.
- Segundo intento: **26 aprobadas / 26**, 1 suite aprobada, **9.077 s**, npm exit 0.
- Comando de ambos: `npm run test:integration:media-promotion`.

El caso «settlement commits first» esperaba ConflictError. El autorizador, pausado
antes del fence del journal, conserva un snapshot antiguo; después del cierre
ganador, su write entra en conflicto y el driver reintenta la transacción.
La nueva lectura ve callback THREW y promotionScope lo rechaza mediante
InvalidArgumentError con el mensaje existente
`A permitted ordinary media confirmation journal is required`.
Se corrigió exclusivamente esa expectativa del test y se añadió igualdad del
estado completo (filas/journal/control) respecto del cierre ganador. No se
relajaron guardas ni cambió producción o el contrato de errores existente.

Los 26 escenarios del [arnés](./animal-media-promotion-mongo-integration.md)
ejecutaron queries, índices, snapshots, commits y abortos Mongo reales con dos
clientes independientes del MISMO proceso Jest. Verificaron unicidad/sin TTL,
promoción foto/diario y evidencia tardía sin descargar permisos, rollback de
declaración/intención/autorización, apertura/tombstone, permiso/revocación/cierre,
token retirado, snapshot antiguo de solo lectura, cuatro respuestas de aplicación
ocultadas tras commit reconocido, opt-in inicial y retries modelados separados.
El cierre local y la revocación conservan los permisos previos y su incertidumbre.

## Entorno observado

| Componente | Valor |
| --- | --- |
| Host / motor | Windows / Docker Desktop 4.44.3, Engine 28.3.2, Linux amd64 |
| Contexto / endpoint | desktop-linux / npipe:////./pipe/dockerDesktopLinuxEngine; sin overrides DOCKER_HOST/CONTEXT/TLS/CERT observados |
| MongoDB / FCV | 8.0.34 / 8.0 |
| Replica set | animalrecord_promotion_test, UN miembro primary |
| Miembro / acceso Jest | 127.0.0.1:27017 dentro del contenedor / 127.0.0.1:27018 con directConnection=true |
| Sesiones | logicalSessionTimeoutMinutes=30 |
| Node / npm | v20.18.0 / 11.0.0, comprobados en la preparación previa |
| Mongoose / driver | 8.21.0 / 6.20.0, comprobados en la preparación previa |

Docker Linux estaba apagado: falló la inspección por ausencia del named pipe.
Se solicitó y concedió permiso para iniciar Docker Desktop; arranque oculto y
espera acotada, sin cambiar contexto ni descargar imagen. Al arrancar Desktop,
PostgreSQL de otro proyecto apareció activo por su configuración existente;
no se ejecutó start/stop/exec sobre él. Al finalizar seguía healthy.

Imagen YA local, digest e ID comprobados; se usó --pull never:

```text
mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907
```

Contenedor `animalrecord-promotion-mongo-test-20261026-9ca8456`, conservando
el nombre/etiquetas aprobados del procedimiento aunque la base actual era 0e928fd.
ID completo:

```text
001f5a0785c447a1d0586a960abf30f4f519d88081ef6509743f102aae506d05
```

Se verificaron imagen, owner=codex-media-promotion/base=9ca8456, AutoRemove=true,
Binds=null, Mounts=[], tmpfs /data/db 1 GiB y /data/configdb 32 MiB, 1 GiB RAM,
1 CPU, puerto exclusivamente loopback, oplog 64 MiB y WiredTiger 0.25 GiB.
Las variables propias de opt-in/URI se restauraron en finally en ambos intentos.
No se cargó .env/AppModule ni se conectó al mongod existente de 27017 del host.
No hubo S3/AWS/Atlas, migraciones de aplicación, despliegue, commit o push.

## Limpieza por namespace e identidad

Cada caso imprimió su base y afterEach drenó/verificó marker/allowlist antes de
dropDatabase. Consulta posterior listDatabases con filtro por los 26 nombres
EXACTOS del primer intento: remaining=[]. Después del segundo se consultaron los
52 nombres EXACTOS combinados, nuevamente remaining=[]:

```json
{"checkedExactNames":52,"remaining":[]}
```

Inventario ordenado por ejecución: primeras 26 filas del intento 1, siguientes
26 del intento 2. Todas eliminadas; sin barrido por prefijo.

```text
animalrecord_promotion_test_8047155b6ae54491acbba630f96c0f56
animalrecord_promotion_test_493422f372a840eebc6fadd5f2978ca2
animalrecord_promotion_test_4c146e69697841dd902a317d1f6e4dc0
animalrecord_promotion_test_19e08a49b9aa4a76b8069e0c453630f0
animalrecord_promotion_test_3b41830b291c479eb2443678bc1fe45f
animalrecord_promotion_test_4b39c853e54f4bf18558268eb91584cd
animalrecord_promotion_test_6358dd3c99134d34a9467afbb1a4f8eb
animalrecord_promotion_test_de4b1a5ff030442e9353b99a0997a3bf
animalrecord_promotion_test_fa0170f495fd4ee294e36c305bde3f96
animalrecord_promotion_test_949863259fd7485abc41f33eade0daa4
animalrecord_promotion_test_f6c7a951e75149a69d59a022f3e0009d
animalrecord_promotion_test_6c09d7d1d97b4b609bbdd71e6a66f04d
animalrecord_promotion_test_77e81ce64b4644d3bc7332b4f6adbe20
animalrecord_promotion_test_f184cbff8b87456c8a42df7695f01f07
animalrecord_promotion_test_b4153dce493a4993b9159794cd2a2238
animalrecord_promotion_test_bee06dd09a194f64a876cbbb203df4ba
animalrecord_promotion_test_42929aa0b4414cad86a967bde34e40f9
animalrecord_promotion_test_bf6003eff006493988db0ccea2db921b
animalrecord_promotion_test_8ccbb53a713e4303992d8fb0250cd8f7
animalrecord_promotion_test_86013b2f8ca5476aa814ab3f4ea0e707
animalrecord_promotion_test_4a69d7513d1e4098bc680b8605d1050d
animalrecord_promotion_test_fe362d28b5c04832ab5fe9a27827093e
animalrecord_promotion_test_aff6ec4237c249b9ab4f72592161af36
animalrecord_promotion_test_603882849f444ee89fcb92abaf222575
animalrecord_promotion_test_44fe5e8871914231a5e66624a1cdcf9c
animalrecord_promotion_test_e628bcd5523b4a3b81bd83aa0ae9c38f
animalrecord_promotion_test_d30b011ac46e42ab929a79d45a735838
animalrecord_promotion_test_c5e0cea2b6f94901a40766cf3bbafc5f
animalrecord_promotion_test_a8d8264706544f94b4330c21e1b1bbab
animalrecord_promotion_test_864927373ad64f64a4fb20e5ecb600bc
animalrecord_promotion_test_d4b2297c22174f48ba3f60bbd0cfa000
animalrecord_promotion_test_b753317672ad433891e7a4e75525ad43
animalrecord_promotion_test_42ecede96e0e49bd9ae02094f55db47b
animalrecord_promotion_test_59e06fcc86964ee7bb72ba415d243027
animalrecord_promotion_test_460d68877a40481d8effc54996643727
animalrecord_promotion_test_ebb8125a6c554e6298f6a9518675a7b3
animalrecord_promotion_test_6559cf728392484795cd42ef878f30a3
animalrecord_promotion_test_ad6e96518f814573ad1504fcca25335b
animalrecord_promotion_test_7a8fd4c0433b4995be590653d7c8a891
animalrecord_promotion_test_1a5399e411ac42e4858a2930e7f50848
animalrecord_promotion_test_ebf9ce0a2d4b4a7cae3375cfa3ac05f1
animalrecord_promotion_test_7bec00b48ff149179f53140cd6baaea6
animalrecord_promotion_test_f08ef6688e3d49f2a3bdc2b6a20f0a3a
animalrecord_promotion_test_b721b56e49824a8ea021d82e5c4e4b8c
animalrecord_promotion_test_de987e85471a45e1986a0a4c21b3c05c
animalrecord_promotion_test_3e4d6550ddfc41f589e2710db8ed67bb
animalrecord_promotion_test_5cc0b0bb6bf94169afbc0fd170896ec8
animalrecord_promotion_test_ac9d23c0aaca48d2a70ff30de6debaf9
animalrecord_promotion_test_092141ca6db248c3bee6249533739922
animalrecord_promotion_test_751e7ace47c841b68ede5ea970efabd3
animalrecord_promotion_test_dae2fcf4e6894f2097efc39247903322
animalrecord_promotion_test_85c24c1a37494f2e8cecc968f7fb7ad8
```

Antes de stop se revalidaron ID completo, imagen, etiquetas y aislamiento.
Se detuvo solo ese ID; --rm retiró contenedor/tmpfs. Consulta posterior por ID:
sin resultados; 27018 sin listener, 27017 existente conservado. Docker Desktop
y la imagen permanecen disponibles. No quedan bases o contenedor de este ensayo.
Los logs crudos locales quedaron en tmp/media-promotion-validation-20261027,
ignorado por Git; el inventario y resultados necesarios están en este documento.

## Otras verificaciones, compatibilidad y límites

- `npm run build` y `npm run test:integration:media-promotion:check`: correctos.
- ESLint de la única suite TypeScript modificada: correcto después de ajustar
  un salto de línea requerido por Prettier; sin cambio semántico tras el ensayo.
- Suite focalizada ordinaria mongo-media-promotion-persistence.spec.ts:
  **1 suite/66 pruebas aprobadas**, 3.373 s, con dobles/sin conexión. Resultado
  separado de los 26 casos Mongo, sin sumarlos como una misma ejecución.
- git diff --check correcto; 213 enlaces locales en once documentos afectados,
  cero rotos y sin espacios finales, incluido este archivo nuevo. Diff de src,
  package.json y package-lock.json vacío.
- Regresión amplia 92 suites/1398 del bloque 32 es PREVIA, no repetida aquí:
  solo se modificó una expectativa de integración y documentación. Ocho suites
  globales heredadas siguen aparte; no se afirma suite global verde.

Contrato runtime/HTTP/DTO/URLs/cuerpos exitosos/errores, PUT animal primitivo,
schemas/índices de aplicación y dependencias conservados. Los índices reales se
crearon SOLO en las bases desechables. Módulo de promociones fuera del grafo,
sin dispatch/caller nuevo. Impacto central en la
[guía frontend](./frontend-animal-transfer-foundations.md).

Un nodo no demuestra replicación/failover, particiones o commit de red incierto.
Los pins/recibos S3 y SDK_RETRY siguen sintéticos; respuesta perdida es una
excepción de aplicación DESPUÉS del commit reconocido, sin reproducir
UnknownTransactionCommitResult. No demuestra transporte SDK, cierre/retención S3
o aplicación conjunta de propietario/referencias/períodos/eventos.

Transferencia completa deshabilitada; objetivo aprobado de histórico exacto y
copia independiente intacto. nameHistory guarda nombres; guarda inicial/V1 y
recuperación previa al permiso conservadas. Vencimiento, cancelación, máximo
por solicitud y ubicación/agrupación del histórico siguen pendientes.

Siguiente bloque concreto: definir y enlazar identidad operación/instancia a los
callers ordinarios foto/diario, manteniendo opt-in desde create inicial y exclusión
legacy; verificar cada envío físico/retry/middleware/handler con transporte falso
antes de integrar dispatch. No habilitar dispatch por esta validación Mongo.
Ticket/sellado concurrente, otros escritores, cobertura/aislamiento/retención,
autorizador de corte estable y commit de negocio siguen pendientes.

