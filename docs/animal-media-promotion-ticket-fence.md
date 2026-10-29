# Fence de ticket frente a sellado y permisos de promoción

Actualización 41: [arnés opt-in separado](./animal-media-promotion-seal-mongo-integration.md)
prepara rollback de MATCH/sello/fences y carreras contra permiso/sello ordinario,
sin ejecutar Mongo. 23 casos compilados, 50 guardas sin conexión aprobadas; mismos
fences de producción, sin ampliar allowlists o trasladar permisos del ensayo 39.

Actualización 40: [sealVerified aislado](./animal-media-promotion-verification.md)
usa el mismo CAS completo del ticket y exige su contador capturado antes de I/O.
MATCH y sealed se escriben juntos con puerta/journal/control; un snapshot no lo
autoriza. Se conserva el seal vigente, sin nuevos callers. Pruebas simuladas del
método nuevo; los 49 casos reales del 39 no lo validan. Permisos previos inciertos.

Actualización 39: [28+21 casos aprobados en Mongo local autorizado](./animal-media-promotion-dispatch-mongo-validation.md),
incluidos ambos órdenes permiso/sello y snapshot obsoleto. Sin cambio de código/
guardas. 49 bases verificadas ausentes y contenedor retirado. Valida el fence en
un nodo, no fin remoto o retención; falta verificación/sellado antes de callers.

Actualización 38: [arnés combinado Mongo + dispatcher](./animal-media-promotion-dispatch-mongo-integration.md)
preparado/compilado con 21 casos, sin ejecución real; las guardas y el transporte
se comprobaron sin conexión. El arnés de persistencia conserva sus 28 casos.
Siguiente: revisión/autorización del entorno desechable antes de ejecutar ambos;
verificación/sellado, callers, cobertura remota y retención siguen pendientes.

Subbloque 37, 2026-10-27, base `ffd7309`. Contrato registrado antes del código.
Implementado y probado con store optimista/transporte simulados; arnés real solo
ampliado y compilado. No demuestra todavía esta carrera en Mongo real.
Auditoría: pin y seal usan CAS sobre animal_media_uploads, con pin/sello insert-only.
La declaración de efecto lee ticket en snapshot; intención/autorización hasta el
36 cercaban journal/control/puerta pero no el ticket. Ese snapshot no compite por
sí mismo con un seal confirmado después. El dispatcher no corrige esta carrera
solo releyendo el efecto/puerta antes de solicitar permiso.

Se añade mediaPromotionRevision opcional al ticket, sin default, TTL, índice o
backfill. Declarar/intentar/autorizar releen ticket ordinario fijado y NO sellado,
reconstruyen definición/hash completos y escriben un CAS del mismo ticket en la
MISMA transacción que journal/control/puerta/filas. Ausencia de contador distinta
de cero; corrupción/agotamiento falla cerrado. No se refija el pin ni el hash.

El fence compite con escrituras al ticket, incluido seal actual: si seal gana,
un autorizador con snapshot antiguo aborta/reintenta y rechaza el ticket sellado.
Si autorización gana, seal posterior puede confirmar, sin borrar ese permiso ni
probar que no pueda enviarse después. No se prohíbe ni redefine el sellado actual.
La revocación y las respuestas/observaciones tardías no requieren ticket disponible
o no sellado: agregan evidencia y conservan permisos previos. No son un nuevo envío.

Tras sellado, el flujo vigente verifica el final sin copiar; al perder pin CAS
relee el ganador. Legacy, generaciones y fallback sin ticket no se adoptan como
efectos ordinarios. El dispatcher permanece sin callers HTTP. Tampoco se conectan
permisos a promociones actuales ni se declara cobertura de escritores legacy.

Dos confirmaciones/journals del mismo upload pueden declarar efectos distintos
mientras no esté sellado. Cada autorización debe tocar el ticket actual. Este
fence no serializa todo el callback, no reserva propiedad del ticket para una
operación ni promete una sola copia remota global. Copias condicionales pueden
competir; retención/delete-recreate y permisos concedidos antes del sello requieren
tratamiento posterior. No inventar lease/edad/rollback para resolverlos.

El campo técnico se conserva como dato interno; no afecta definición/hash, URLs,
DTO o éxitos públicos. El módulo de promociones sigue fuera del grafo. Las rutas
vigentes de pin/seal no añaden consultas/condiciones o errores por este bloque.
No se crea infraestructura real. Guarda inicial/V1, recuperación previa al permiso,
objetivo de copia exacta/independiente, nameHistory (nombres), decisiones pendientes
y transferencia deshabilitada conservados. Impacto central en
[la guía frontend](./frontend-animal-transfer-foundations.md).

## Implementación y validación

- [Ticket](../src/context/animal-media/domain/animal-media-upload.ts) y schema
  añaden únicamente el campo opcional. El [adaptador de promociones](../src/context/animal-media/infrastructure/mongo-media-promotion-persistence.ts)
  llama fenceUpload al declarar/intentar/autorizar, antes de guardar puerta/filas.
  Lee en la sesión, valida definición/hash y hace updateOne condicional + incremento
  del contador, junto con los fences journal/control. No hay I/O S3 en transacción.
  Una coincidencia cero o excepción revierte también los fences anteriores.
- [Suite nueva](../test/animal-transfer/infrastructure/media-promotion-ticket-fence.spec.ts):
  **39 casos aprobados** dentro de la regresión seleccionada. Tres comandos,
  rollback integral, cambios de identidad/pin/MIME/tamaño/legacy/sello, contadores
  inválidos/agotados, ausencia frente a cero, ambos órdenes permiso/sello y pin
  perdedor con métodos reales de repositorio sobre store optimista simulado.
- [Suite del dispatcher](../test/animal-transfer/infrastructure/media-promotion-copy-dispatcher.spec.ts):
  cuatro casos adicionales (43 en total), SDK/Node handler reales y https.request
  falso con guarda de cero sockets. Sello antes de intención, entre intención y
  autorización, después del commit del permiso con reply pausado y antes de un
  retry del SDK. El envío tardío reconocido conserva UNKNOWN y permiso.
- Primera focalizada de persistencia/dispatcher/fence: **3 suites/144 pruebas**,
  **5.75 s**, antes de añadir los cuatro casos del dispatcher. Regresión final:
  **96 suites/1533 pruebas**, **42.68 s** (43 nuevas frente a 95/1490).
  No es suite global; ocho suites heredadas siguen como deuda separada.
- Build, ESLint de ocho TypeScript y compilación de todos los arneses correctos.
  Jest fuera del sandbox por el EPERM de caché conocido; sin infraestructura real.
- [Arnés Mongo](./animal-media-promotion-mongo-integration.md): dos carreras añadidas,
  **28 casos preparados/compilados, ninguno ejecutado en este bloque**. Snapshot
  incluye tickets y monitor exige su escritura en la misma transacción. Dos
  clientes, namespaces y allowlists originales conservados. Los 26 resultados
  reales del bloque 33 corresponden al código anterior a este fence.

## Siguiente paso

Completar un arnés opt-in que combine Mongo y el dispatcher con transporte falso,
sin conexiones AWS, para permiso/sellado/retries y fallos de evidencia. La ejecución
Mongo requiere autorización específica de entorno; no se reactiva la del bloque 33.
Antes de integrar callers aún falta cerrar verificación del resultado/sellado y
mapeo de errores. Retención/no reutilización, otros escritores, cobertura remota,
autorizador de corte y commit conjunto siguen pendientes. Este fence protege
metadata local y permisos nuevos, no acredita una copia remota ni cierra previas.
