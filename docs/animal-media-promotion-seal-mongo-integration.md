# Arnés opt-in de verificación y sellado

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

## Veintitrés casos preparados, sin resultados Mongo

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

## Entorno propuesto, pendiente de autorización específica

No se inspeccionó Docker, imagen o puerto en este bloque. Propuesta basada en
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
