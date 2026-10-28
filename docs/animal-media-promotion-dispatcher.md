# Dispatcher interno de una promoción, sin integración operativa

Actualización subbloque 37: [fence de ticket/pin/sello](./animal-media-promotion-ticket-fence.md)
implementado en el adaptador de persistencia, sin modificar este dispatcher.
Cuatro pruebas añadidas a su suite (43 en total): denegación antes de permiso/
retry y envío tardío reconocido después de sello. Adaptador y transporte simulados;
regresión final 96 suites/1533 pruebas, 42.68 s. Dos carreras Mongo preparadas y
compiladas, no ejecutadas. El siguiente bloque del 36 descrito abajo es histórico;
ahora falta completar arnés Mongo + dispatcher/transporte falso y verificación/
sellado antes de callers. Ejecutar Mongo requiere autorización específica nueva.

Subbloque 36, 2026-10-27, base `29c7ff9`. Contrato registrado antes del código;
dispatcher aislado implementado y probado con persistencia/transporte simulados.
Un efecto ordinario ya declarado y sin intentos previos; una invocación send por
instancia. No abre/declara puertas ni adopta permisos existentes o reanuda un
dispatcher después de error. Los retries dentro de esa invocación se identifican
como SDK_RETRY, con IDs/ordinal/dispatcher/autorización propios. Reintento de
aplicación sobre un efecto con intentos anteriores queda fuera de este bloque.

La factoría copia selección/scope/configuración antes de I/O y decodifica/copia
el efecto/hash leído antes de usarlo. Cada handle relee puerta/efecto, comprueba scope/hash/contador
esperados, persiste intención y obtiene autorización NUEVA por CAS. Una lectura
snapshot no es permiso: solo el resultado reconocido de apply(AUTHORIZE_ATTEMPT)
permite delegar una vez. Un error/ack perdido detiene la instancia, sin reenvío,
adopción ni recuperación de MAY_RUN. No hay CAS retry automático del dispatcher.

S3Client y NodeHttpHandler son propiedad privada de la instancia: no se admite
handler/middleware arbitrario que duplique envíos por debajo del permiso. Entradas
de configuración backend acotadas: credenciales explícitas, regiones estándar
comerciales permitidas, maxAttempts y seguimiento regional. No endpoint/agent
custom, HTTP2/browser o plugin externos. No se instala en ningún módulo/caller.

El CopyObject se construye desde la definición. Antes del permiso se copia el
request ya firmado y se valida PUT/HTTPS/host/path/query/cuerpo vacío, fuente y
versionId/ETag, destino IfNoneMatch, MIME y metadata de upload/digest. Se rechazan
headers de mutación extra, scopes o regiones ajenas. Firma/headers de transporte
no se guardan ni loguean. Las dependencias Smithy ya instaladas se declaran como
dependencias directas al usarlas en src, sin cambiar sus versiones.

Cada resultado del handler se registra conservadoramente como UNKNOWN: ni HTTP
200 ni resolver handle demuestra un CopyObject exitoso o fin remoto. HTTP 200
puede contener Error; la deserialización posterior sigue en el SDK. Error del
transporte se propaga solo después de registrar UNKNOWN; el SDK puede intentar
otra vez, solicitando permiso propio. Fallar registro/autorización es error local
terminal sin error crudo/cause/status del proveedor, y evita retry por esa causa.
Permisos anteriores y evidencia durable conservan su incertidumbre. Un permiso
ya reconocido todavía puede enviar después de revocar. No se promete rollback.

Sin transacción Mongo abierta durante S3. Evidencia posterior puede competir con
revocación; si CAS falla, no se reenvía ni se borra el permiso. Cierre de stream
ante error local posterior y limpieza de cliente/handler al terminar. No seal,
activación de referencia, propagación HTTP, operación real o corte estable.
Objetivo aprobado, guarda inicial/V1, nameHistory (nombres), recuperación previa
y decisiones pendientes intactos. Transferencia completa deshabilitada.
Impacto central: [guía frontend](./frontend-animal-transfer-foundations.md).

## Implementación, compatibilidad y límites

[MediaPromotionCopyDispatcher](../src/context/animal-media/infrastructure/media-promotion-copy-dispatcher.ts)
es una clase con factoría async create y send de un solo uso. No provider,
exportación Nest, caller HTTP, job o variable de activación. La factoría no recibe
comandos/URLs del usuario; exige selección/scope/dispatcher UUID, regiones backend,
credenciales explícitas y efecto persistido completo con contador cero. Regiones
estándar comerciales y endpoints regionales virtual-host/path-style; otros
endpoints/particiones/agents están fuera de este contrato y se rechazan.

Cada handle valida/copia el request antes de await, relee evidencia y compite por
CAS en intención/autorización usando el puerto existente. Read no adquiere fence;
apply del adaptador conserva sus fences de journal/control y transacción común.
No comparte transacción con I/O remoto. Rechaza avance ajeno del contador/último
intento y definiciones/scopes distintos; no persigue revisiones nuevas para avanzar.
No se reabre puerta ni se devuelve un handler recuperable después de error.

Un send puede recibir redirects/retries del SDK: cada delegación obtiene intento
y autorización UUID nuevos, con instancia de dispatcher constante e independiente
de instanceId del journal. La definición no incorpora endpoint/firma/credenciales:
su selección se restringe por el backend y se comprueba antes de autorizar.
Signature validation del proveedor no se reproduce localmente. La allowlist de
headers debe revalidarse al actualizar SDK; no se elimina un header desconocido
para hacer avanzar el envío. No se loguean headers/errores crudos ni URLs firmadas.

UNKNOWN registra solo evidencia local del intento, con referencia opaca generada;
no incluye requestId/recibo autenticado del proveedor ni acredita un resultado
completo. Fallar registrarlo conserva el permiso y detiene el dispatcher, incluso
si la escritura del registro pudo confirmarse. Las respuestas/callbacks de Mongo
no ejecutan red. No se añade ACKNOWLEDGED automático desde HTTP 200. El resultado
final deserializado de send tampoco autoriza sellado/traspaso en este bloque.

MediaPromotionDispatchError expone solo etapa SETUP/LIFECYCLE/REQUEST/PERMISSION/
RESPONSE con mensaje fijo. No conserva cause, error raw, status o marcas retryables
de persistencia. El SDK puede añadir sus metadatos locales de intentos; los tests
comprueban que no repite por un TimeoutError/503 de autorización/registro.
Errores originales de transporte solo vuelven al SDK tras persistir UNKNOWN.
HTTP/DTO/cuerpos/URLs/éxitos/errores de la aplicación existente intactos, incluido
PUT animal primitivo. La futura integración debe decidir el mapeo de estas etapas
y documentarlo antes de publicar un contrato HTTP nuevo.

Dependencies directas añadidas: @smithy/node-http-handler=4.9.7 y
@smithy/protocol-http=5.3.11. Ya existían transitivamente con esas versiones;
npm ls --depth=0 confirmó ambas, sin instalar/descargar ni cambiar código de SDK.
No hay lockfile versionado en este repositorio; el lockfile local ignorado no se
actualizó. Los futuros installs deben resolver estas dependencias declaradas.

No se ha demostrado cobertura de procesos/despliegues anteriores, HTTP2/browser,
custom agents/proxies/TLS, actualización de SDK, I/O real, failover Mongo o corte
estable. El constructor privado/handler propio delimita el código backend de
confianza; no es un sandbox contra edición maliciosa del proceso/monkey-patching.
No hay retención/no borrado/no reutilización S3 garantizados.

Siguiente bloque: auditar y cerrar el contrato ticket/pin/sellado ante
confirmaciones concurrentes, cambios entre declaración y envío, legacy/sellados
y fallos de persistencia. Implementar/probar las guardas con dobles antes de
conectar este dispatcher a AnimalMediaUploads/callers. Preparar después un arnés
Mongo + transporte falso; su ejecución real requiere autorización específica.
No inferir de este bloque que el commit conjunto o la transferencia estén listos.

## Validación del bloque

- [Suite nueva](../test/animal-transfer/infrastructure/media-promotion-copy-dispatcher.spec.ts):
  **39 casos aprobados**, 7.805 s. Primera pasada de 28 casos aprobada, 8.417 s;
  ampliada con más retargets, versión de origen, lectura fallida, petición copiada
  durante pausa, conflicto de evidencia tardía y ciclo de vida. ESLint detectó
  un import de test sin uso; retirado. Pasada final de regresión posterior a la
  guarda de effectCount también completamente aprobada.
- Modelos/sesiones Mongo del adaptador real sobre store optimista SIMULADO;
  SDK/NodeHttpHandler reales con https.request falso y guarda de cero sockets.
  No mock de send/handle ni inyección de handler en producción. El acceso al
  client privado para retargets es exclusivo de pruebas negativas.
- `npm run build`, `npm run test:integration:media-promotion:check` y ESLint de
  ambos TypeScript nuevos: correctos. Prettier solo en esos archivos. npm ls de
  dependencias directas Smithy correcto. Sin instalación/actualización/descarga.
- Regresión seleccionada: **95 suites/1490 pruebas aprobadas**, **47.751 s**,
  frente a 94/1451; los 39 casos nuevos están incluidos. No incluye los 26 casos
  Mongo reales previos. Ocho suites globales heredadas siguen como deuda separada;
  no se afirma suite global verde. Aviso heredado Node20/AWS SDK no bloqueante.
- Sin conexiones Mongo/S3/AWS/Docker reales, migraciones/índices ejecutados,
  cambios de IAM, despliegues, commits o push. Pruebas fuera del sandbox para
  evitar el EPERM de caché Jest conocido. No representa autorización de otro entorno.
- git diff --check correcto; 220 enlaces locales en diez documentos afectados,
  cero rotos y sin espacios finales, incluidos los tres archivos nuevos.
