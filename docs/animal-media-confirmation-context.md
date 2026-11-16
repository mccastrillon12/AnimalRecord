# Identidad interna de confirmaciones ordinarias

Actualización subbloque 36: [dispatcher aislado](./animal-media-promotion-dispatcher.md)
implementado y probado con dobles; NO recibe llamadas de los servicios HTTP de
este documento. Contexto y opt-in no habilitan implícitamente dispatch o sellado.

Actualización subbloque 35: [ensayos SDK sin red](./animal-media-promotion-transport.md)
completados con handler/peticiones nativas falsos. Contexto/callers no modificados;
los probes no son permisos reales. Sigue pendiente wrapper interno y su integración.

Subbloque 34, base `5500a68`, 2026-10-27. Contrato registrado antes del código;
enlace implementado y validado en este bloque.
Objetivo funcional aprobado intacto; este bloque prepara correlación interna,
sin dispatch autorizado por efecto ni garantías nuevas de cierre remoto.

El coordinador acepta opt-in explícito del backend para PROFILE_CONFIRM o
ATTACHMENT_CONFIRM, un animal y sin URL emitida. Declara MEDIA_PROMOTION_ROWS_V1
en create NOT_STARTED; jamás añade la marca a un journal anterior. Después de
adquisición y permiso reconocidos entrega un contexto congelado de operación,
instancia, animal, dueño, versión adquirida y kind. Los demás callbacks mantienen
su invocación sin argumentos. Error/ack incierto previo impide entregar contexto.

Foto y adjuntos del diario propagan el contexto hasta AnimalMediaUploads.confirm,
incluida reconfirmación idéntica. Cada consumidor valida scope/tipo y toma una copia
inmutable antes de esperar I/O. No se recibe del DTO ni se devuelve por HTTP.
Direct callers anteriores sin contexto conservan compatibilidad; todavía no se
declara cobertura completa o ausencia de rutas antiguas.

La marca solo declara elegibilidad del journal para el puerto de persistencia;
NO declara que existan puerta, efecto, permiso o evidencia de transporte. El
contexto NO es capacidad de envío, fence actual, liveness ni autenticación del
caller. La futura persistencia debe releer/cercar journal/control por transacción.
Un contexto retenido tras cerrar no autoriza nada. No se guarda en el ticket:
una nueva confirmación HTTP es otra operación sobre un upload posiblemente igual.

El backend conoce el tipo HTTP antes de leer el ticket, por lo que un journal
marcado puede terminar en fallback sin ticket, ticket legacy o ya sellado. Ninguna
de esas rutas crea/adopta efectos nuevos en este bloque. LegacyAnimalMediaCopier
queda separado y conserva reserva/trabajo; no se le atribuye el journal HTTP.

No se importa el módulo de persistencia ni se llama open/apply/revoke. No se
modifica promote, el SDK, retries o sellado. Falta verificar cada envío físico
con transporte falso antes de instrumentar/conectar dispatch; también quedan
ticket/sellado concurrente, otros writers, cobertura/retención/corte y commit.
Transferencia completa deshabilitada; recuperación previa, guarda inicial/V1,
nameHistory (nombres) y decisiones pendientes conservados.

Compatibilidad: mismos HTTP/DTO/cuerpos/éxitos/errores actuales, incluido PUT
animal primitivo. Nuevos rechazos internos si un caller conecta mal el contexto;
sin consultas nuevas ni índices/migraciones. Latencia/coste limitados a validación
local; no afirmar que una marca de journal demuestra cobertura remota.
Impacto central en [la guía frontend](./frontend-animal-transfer-foundations.md).

## Validación y límites del bloque

- Build y compilación de todos los arneses: correctos; sin ejecución Mongo.
- ESLint de los nueve TypeScript nuevos/modificados: correcto. Prettier aplicado
  solo a esos archivos; sin cambios de dependencias ni módulos de arranque.
- Cinco suites focalizadas: 103 pruebas aprobadas, 6.371 s. Pruebas con dobles:
  opt-in inicial/permiso reconocido, fallos antes de contexto (incluido permiso
  durable con respuesta perdida), multi-animal/tipo/URL incompatibles, scope/IDs/
  versión/payload inválidos, contexto congelado y copiado antes de I/O, identidad
  distinta por operación, captura de opciones, foto/diario/reconfirmación y fallback.
- Regresión seleccionada: **93 suites/1423 pruebas aprobadas**, 37.618 s. Nueva
  suite de 23 casos y dos casos HTTP frente a 92/1398. Verifica contratos exitosos
  y rechazo de contexto recibido por DTO. No es suite global; ocho suites heredadas
  fallidas siguen como deuda separada. Aviso Node20/AWS SDK heredado no bloqueante.
- Primera build detectó inferencia de spread opcional en el diario, corregida sin
  cambiar contrato. Primera focalizada: nueva suite sin ejecutar por tipo literal
  ampliado y una expectativa HTTP incorrecta por undefined omitido de JSON;
  corregidos los tests. ESLint detectó tipos de mocks/referencias y formato,
  corregidos antes de las pasadas finales citadas. Sin relajar guardas.
- git diff --check correcto; 224 enlaces locales en diez documentos afectados,
  cero rotos y sin espacios finales, incluidos los tres archivos nuevos.

No se atribuyen a este bloque los 26 escenarios Mongo del 33 ni nueva autorización
de infraestructura. No hubo operaciones reales Mongo/S3/AWS/Docker, instalación de
índices, migraciones, despliegues, commits o push. El módulo de persistencia sigue
fuera del grafo; contexto y marca por sí solos no autorizan una promoción.

Siguiente bloque concreto: ensayos del cliente S3 instalado con request handler
falso, por debajo del retry middleware, para observar cada envío físico, retry,
redirect y error; definir cobertura y ubicación de instrumentación antes de
conectar permisos por intento. Luego integrar persistencia/dispatch y cubrir
ticket/sellado concurrente, legacy/otros writers, aislamiento/retención y corte.
