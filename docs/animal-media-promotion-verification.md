# Verificación y sellado internos de una promoción

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
