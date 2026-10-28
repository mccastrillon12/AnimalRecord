# Arnés Mongo opt-in de persistencia de promociones

Actualización subbloque 37: **28 casos preparados y compilados; ninguno ejecutado
con esta versión**. Dos escenarios nuevos de permiso frente a seal, en ambos
órdenes, con pausas independientes UPLOAD_FENCE/UPLOAD_SEAL y repositorio de ticket
real. El snapshot de rollback incluye tickets; el monitor exige update del ticket
en la misma transacción que journal/control/puerta. Sin ampliar allowlists, activar
opt-in o conectar Mongo. Los 26 aprobados del 33 son evidencia histórica anterior
al nuevo [fence](./animal-media-promotion-ticket-fence.md), no validación de este.
Falta completar arnés Mongo + dispatcher/transporte falso; ejecución requiere
autorización específica del entorno y nueva evidencia de versiones/limpieza.
Las secciones del 32/33 conservan los resultados/alcance de esas revisiones.

Actualización subbloque 33, 2026-10-27: **26 escenarios ejecutados y aprobados**
en MongoDB 8.0.34, replica set local de un miembro, tras autorización específica.
Primera pasada 25/26; corregida una expectativa de error del test, sin cambio
de producción. Dos intentos/52 bases eliminadas y contenedor retirado.
Resultados y límites en [la validación real](./animal-media-promotion-mongo-validation.md).
El texto del subbloque 32 siguiente conserva su alcance histórico de preparación.

Subbloque 32, 2026-10-26, base `ede7627`, rama `codex/animal-transfer-planning`
y árbol inicialmente limpio. **Preparado y compilado, NO ejecutado contra Mongo.**
La persistencia del [subbloque 31](./animal-media-promotion-persistence.md) sigue
fuera del grafo de arranque y sin dispatch. Este bloque añade soporte de pruebas,
no comportamiento de negocio ni un ledger remoto completo.

Revisión posterior sobre `9ca8456`: [procedimiento concreto de ejecución local](./animal-media-promotion-mongo-runbook.md)
preparado y comprobado sin conexión. Propone un contenedor exclusivo en 27018;
se observó un mongod existente en 27017, fuera del alcance. **Autorización y
ejecución real siguen pendientes**; no se trasladan permisos de ensayos anteriores.

## Activación y aislamiento

- Comando nuevo `npm run test:integration:media-promotion`, configuración
  [Jest dedicada](../test/jest-media-promotion-mongo.json), una sola
  [suite de integración](../test/animal-transfer/integration/media-promotion-persistence.mongo.integration.ts).
  `npm test` no la descubre; los tres comandos de integración anteriores mantienen
  sus suites. `npm run test:integration:media-promotion:check` compila TODOS los
  arneses mediante el tsconfig existente, sin conexión ni ejecución de casos.
- Requiere `MEDIA_PROMOTION_MONGO_TESTS=1` y `MEDIA_PROMOTION_MONGO_TEST_URI`.
  GlobalSetup rechaza antes de conectar si falta el opt-in o la URI propia.
  Variables de aplicación/journal/evidencia/proyección no habilitan esta suite.
  No carga `.env`, AppModule, backfill, contenedores o clientes AWS.
- Reutiliza el parser estricto: mongodb://, un host loopback, puerto explícito
  1024–65535 y replicaSet. Única opción extra permitida: directConnection=true.
  Sin credenciales, base en URI, SRV, hosts remotos/múltiples u opciones ambiguas.
  `hello` exige primary del replica set esperado y sesiones. Loopback no demuestra
  que el servidor sea desechable: la elección del entorno y ausencia de túneles
  requieren autorización específica antes de activar el comando.
- [Fixture propio](../test/animal-transfer/integration/support/media-promotion-mongo-fixture.ts),
  DOS clientes independientes y base aleatoria POR CASO:
  `animalrecord_promotion_test_<UUID sin guiones>`. Reutiliza conexión, monitor,
  seguimiento de operaciones, pérdida de respuesta y limpieza de WriteMongoFixture.
  El helper de respuesta perdida ahora acepta únicamente el requisito que usa,
  `{connection}`; no cambia su implementación o las pruebas anteriores.
- Lista cerrada nueva: marker `_animalrecord_write_test_owner`,
  animal_ownership_controls, animal_write_journals, animal_media_uploads y
  animal_media_promotion_records. No amplía allowlists de arneses anteriores.
  Modelos de animal/período son dependencias del constructor: no crea sus colecciones.
  autoCreate/autoIndex desactivados en la conexión. Solo una futura ejecución
  autorizada creará explícitamente las cuatro colecciones y sus índices declarados
  dentro de esa base temporal; este bloque no los creó.
- [Guarda de limpieza](../test/animal-transfer/integration/support/media-promotion-mongo-safety.ts):
  namespace generado válido, nombre exacto, UUID/marker coincidentes y ninguna
  colección fuera de la allowlist antes de dropDatabase. Acepta setup parcial
  propio si el marker existe. No enumera ni borra bases por prefijo. Cierra también
  conexiones parciales y propaga errores de limpieza. Un fallo de proceso o
  confirmación incierta del marker puede dejar residuos: auditar el nombre exacto
  impreso, sin ampliar automáticamente el alcance de limpieza.

## Veintiséis escenarios preparados, todavía sin resultados reales

1. Comparación de TODOS los índices instalados de promoción con el schema,
   incluidos índices parciales y multikey, sin TTL; dos clientes distintos.
2–3. Foto y diario: creación, intención, autorización, UNKNOWN, revocación,
   cierre local/retirada del token y ACK/MATCH tardíos. Exige una sola transacción
   para fences/fila/puerta, snapshot y commit majority. Conserva el permiso anterior
   y salida INCOMPLETE/NOT_ASSESSED. Pins/recibos S3 son sintéticos.
4–8. Colisiones de ID de fila, identityIds contra permiso previo, upload por
   operación, destino por operación y ordinal por efecto. Son inserciones directas
   deliberadas de fixtures para comprobar cada índice, no transiciones autorizadas.
9–11. Cero matches en el CAS final de puerta tras writes tentativos de declaración,
   intención o autorización: rollback de filas, puntero/contador y fences. Se relee
   todo el estado antes de un nuevo intento explícito.
12–13. Apertura contra tombstone sin puerta, ambos órdenes. El perdedor con
   snapshot anterior falla; revocar después de una apertura exige releer revisión.
14–15. Autorización contra revocación, ambos órdenes. Si permiso gana, revocar
   después conserva su identidad y riesgo; si revocación gana, no queda permiso.
16–17. Autorización contra settleCallback del adaptador real de journal, ambos
   órdenes; error local posterior no elimina un permiso previo.
18. Retirada del token después del snapshot del autorizador: revierte también
   el fence tentativo del journal y no confirma autorización parcial.
19. Sesión de SOLO LECTURA conserva puerta antigua tras revocación y confirma
   sin escribir. Intentar autorizar con la revisión anterior en sesión nueva falla:
   la lectura snapshot no es fence ni permiso.
20–23. Respuesta de aplicación ocultada DESPUÉS de commit reconocido de apertura,
   tombstone, permiso o respuesta UNKNOWN. Consulta durable con los mismos IDs;
   repetir el comando/revisión falla, sin convertir la lectura en nuevo envío.
24. Tombstone antes del permiso del callback; un MAY_RUN posterior no abre puerta
   ni elimina el token. No es recuperación o cancelación funcional.
25. Journal MAY_RUN sin marca de opt-in inicial: apertura y tombstone rechazados,
   sin agregar marca/fence o adoptar la operación anterior.
26. Intenciones separadas de APPLICATION_RETRY y SDK_RETRY, ordinal/padre/instancia/
   autorización propios; conserva permisos previos. No ejecuta middleware SDK.

La siembra crea journals NOT_STARTED con la marca durable desde `create`, pasa por
INTENT, adquisición transaccional del claim y permiso del callback. Nunca añade
la marca retroactivamente a MAY_RUN. Usa el repositorio ordinario de tickets para
crear y fijar un pin sintético; no emite URL ni verifica bytes remotos.

[Barreras de un uso](../test/animal-transfer/integration/support/promotion-race-gate.ts)
pausan queries antes de enviarlas; no reemplazan resultados ni transacciones Mongo.
El CAS cero se induce cambiando el filtro a un _id inexistente en la base temporal.
La pérdida de respuesta es un error de aplicación tras withTransaction exitoso,
no fallo de paquetes/red ni UnknownTransactionCommitResult reproducido.
Se usa withTransaction del adaptador real, con sus reintentos de callback: ninguna
transacción hace dispatch remoto. No hay sleeps usados para ordenar las carreras.

Límites heredados: selección/conexión 3 s, socket 10 s, timeoutMS de cliente 15 s,
pool 4; caso Jest 30 s y barreras 8 s. Las duraciones/reintentos reales aún deben
medirse. Monitor retiene solo metadatos de comandos/transacciones, nunca filtros,
documentos, payloads, URI o credenciales. Drenaje libera barreras y espera promesas
observadas antes de limpieza. No inicia/detiene Mongo/Docker ni descarga imágenes.

## Validación sin infraestructura de este bloque

- `npm run build`: correcto.
- `npm run test:integration:media-promotion:check`: correcto; compila arnés nuevo
  y anteriores. Primer intento detectó tipos del fixture Mongoose, UUID inferido
  y unión de promesas; corregidos en soporte/pruebas, sin tocar producción.
- ESLint de siete TypeScript nuevos/modificados: correcto.
- [36 pruebas nuevas sin conexión](../test/animal-transfer/infrastructure/media-promotion-mongo-safety.spec.ts):
  opt-in/URI, namespace/limpieza/allowlists, aislamiento Jest, barreras y rechazo
  de configuración directa antes de createConnection. Todas aprobadas.
- `--listTests` en los CUATRO comandos: una suite distinta por comando.
- Comando nuevo con opt-in forzado a 0: rechazo esperado en globalSetup,
  **npm exit 1**, sin casos de integración ejecutados; variable restaurada en
  finally. El wrapper de comprobación termina 0 al verificar ese rechazo.
- Regresión seleccionada: **92 suites/1398 pruebas aprobadas**, 30.928 s, frente
  a 91/1362 de la base. No incluye los 26 escenarios Mongo preparados. Persisten
  ocho suites globales heredadas como deuda separada, no reevaluadas aquí.
- Primer intento focalizado dentro del sandbox: EPERM de caché Jest, cero casos.
  Repetición y regresión fuera del sandbox con autorización: correctas. Aviso
  Node20/AWS SDK heredado no bloqueante; sin actualizar runtime/dependencias.
- `git diff --check` correcto; ocho archivos nuevos sin espacios finales y
  192 enlaces locales comprobados en nueve documentos, cero rotos.

## Compatibilidad, límites y siguiente paso

Sin modificaciones de src, HTTP/DTO/URLs/éxitos/errores, incluido PUT animal
primitivo, ni cambios en schemas de producción, módulos o dependencias. Sí se
añaden comandos de desarrollo y soporte opt-in capaz de crear/borrar SU base
desechable cuando se autorice ejecutarlo. Impacto centralizado en la
[guía frontend](./frontend-animal-transfer-foundations.md).

Objetivo funcional aprobado intacto: histórico exacto y copia independiente.
Transferencia completa deshabilitada; guarda inicial/V1 y decisiones pendientes
conservadas. La preparación no acredita índices/transacciones/mayoría/failover,
cierre remoto, estabilidad/retención S3 o commit de negocio. No hubo conexiones
Mongo/S3/AWS/Docker, migraciones, índices/borrados reales, despliegues, commit o push.

Siguiente bloque concreto: **ejecutar estos 26 escenarios solo después de autorizar
un replica set local desechable específico**, confirmar puerto/topología/versiones
y registrar resultado exacto y limpieza de cada namespace. No activar el opt-in ni
arrancar infraestructura automáticamente. Después enlazar identidad a callers y
verificar cada envío físico/retry antes de dispatch; cobertura global, ticket/
sellado concurrente, retención/aislamiento y corte estable siguen pendientes.
