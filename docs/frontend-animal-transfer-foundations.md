# Transferencias: contrato disponible del primer bloque

Estado: permisos, catálogo, buscador, OTP específico EMAIL/PHONE, periodos/lock y
preparación interna de instantáneas/copias y creación/consulta de solicitudes
pendientes y bandeja/contador/leído implementados. Todavía no se aceptan ni aplican
traspasos; faltan histórico consultable/copias activadas y push. Integración productiva sujeta a
preparación de colecciones y validación real; ver requisitos abajo.

## Procesamiento interno de push preparado (bloque 57)

No hay nuevas rutas ni push real habilitado. Procesador interno con proveedor
simulado en pruebas; módulo fuera del grafo, sin scheduler/SDK/Firebase/APNs.
El contrato HTTP de bandeja, solicitudes y dispositivos se conserva.

Payload previsto del puerto: datos `{ notificationId, transferId, recipientId }`,
sin título/texto clínico, animales, credenciales o expediente. Comprobar sesión y
recipientId antes de mostrar/abrir, y consultar backend autorizado para recuperar
el estado vigente. Push aceptado por proveedor no acredita entrega al teléfono ni
lectura. La bandeja persiste aunque no haya dispositivos, falle el proveedor o no
llegue el push; no prometer exactamente una vez.

Las entregas se ligan a cuenta/instalación/revisión/token al recorrer dispositivos
activos por páginas. Se revalidan con escritura al conceder permiso. Rotación/baja/
cambio de cuenta anterior al permiso descarta esa entrega; no la redirige al token
nuevo. Posterior al permiso no cancela el envío ya autorizado. Registros nuevos
después del recorrido no reciben backfill automático de avisos anteriores.

Cuando se conecte un proveedor validado, un rechazo explícito de token inválido
podrá pasar SOLO esa revisión vigente a DISABLED, incrementar revisión y retirar
token/claim. Una respuesta antigua no afecta la generación nueva. GET de instalación
permite conciliar; la repetición exacta del último PUT devuelve el estado vigente
(puede ser DISABLED), sin reactivarlo. Para registrar token nuevo, nueva intención,
UUID de operación y revisión obtenida con GET. Timeout/error no invalida el token.

Reintentos técnicos solo tras rechazo explícito persistido, con presupuesto/espera
configurados. Un permiso MAY_SEND no demuestra inicio; error, ausencia de respuesta,
edad o reinicio no autorizan reenvío. UNKNOWN/permiso incierto no se recuperan solos.
No hay cambio de éxito/error HTTP existente. El outbox nuevo declara protocolo desde
creación; anteriores sin marca no se procesan por esta ruta ni se migran automáticamente.
Antes de activar: preparar además `notification_push_deliveries` y
`notification_push_attempts` e índices declarados, validar Mongo real/rollback y el
contrato de envío físico sin retries ocultos. Nada de ello se ejecuta al arrancar.

## Dispositivos preparados para push (bloque 56)

Registro/baja implementados, **sin configurar Firebase/APNs ni enviar push**.
FCM es por ahora un proveedor declarado; el backend no comprueba el token contra
Firebase ni acredita posesión del teléfono/proyecto. No usar SMS/SNS como fallback.

Una instalación mantiene UUID aleatorio y credencial de 32 bytes criptográficos
en base64url canónico (43 caracteres), en almacenamiento privado/seguro. No usar
UUID, correo, ID de usuario o el token push como credencial. Mantenerla independiente
del login para poder cambiar de cuenta; no exponerla en logs, URLs o telemetría.
Headers de todas las rutas: Bearer actual y `X-Installation-Key` con esa credencial.

| Operación | Entrada adicional | Éxito 200 |
| --- | --- | --- |
| PUT /notification-devices/{installationId} | `If-Match: "0"` en primera alta; luego revisión actual entre comillas. `Idempotency-Key` UUID nuevo por operación. Body `{ "provider": "FCM", "platform": "ANDROID" o "IOS", "token": "token opaco" }` | Estado del registro |
| GET /notification-devices/{installationId} | Sin body. Resuelve estado/revisión cuando se perdió una respuesta | Estado del registro |
| DELETE /notification-devices/{installationId} | `If-Match` revisión actual entre comillas y `Idempotency-Key` UUID. Body vacío o `{}` | Estado DISABLED |

Estado: `{ installationId, revision, state: "ACTIVE" o "DISABLED",
registeredToCurrentUser, provider: "FCM", platform, updatedAt }`. Respuesta no-store;
sin token, hashes, credencial o ID/nombre de la cuenta asociada. GET con credencial
de instalación válida puede devolver registeredToCurrentUser=false tras cambiar de
cuenta; permite obtener revisión para un nuevo registro explícito. No hay listado
global de tokens o dispositivos de otra persona.

Guardar revisión y UUID de operación antes de mutar. Repetir exactamente la última
operación (headers/body) devuelve el mismo estado sin nueva escritura. Cambiar el
contenido con esa misma clave devuelve 409. Una operación anterior a una rotación,
baja o cambio de cuenta no se adopta: 409, o 404 al intentar retirar cuenta ajena.
Solo se conserva el recibo de la última operación; no es ledger de replays antiguos.
Consultar GET y decidir nueva intención explícita; no actualizar If-Match y reenviar
automáticamente una petición vieja. La revisión no vence ni se recicla por edad.

Rotación de token: PUT nueva operación/revisión; libera la asignación previa y
registra la nueva en una transacción. Varios teléfonos por cuenta usan instalaciones
distintas. Un mismo token solo puede estar asignado a una instalación: 409 ante
duplicado, sin transferirlo silenciosamente. Si se pierde la credencial/reinstala,
crear UUID/credencial nuevos y obtener un token nuevo; no apropiarse del registro
anterior conociendo solo su UUID/token. Token opaco no vacío, sin espacios/control,
máximo técnico 4096 bytes; no truncar/modificarlo o tratar este control como validación FCM.

Logout: **DELETE antes de descartar el Bearer**. El backend existente no tiene
endpoint de logout al que conectar esta baja automáticamente. Tras éxito conserva
tombstone/revisión y quita token/claim activo, no la credencial; un PUT atrasado no
reactiva el registro. Al iniciar otra cuenta, usar credencial y revisión actuales
para PUT explícito de esa cuenta. Una baja tardía de la anterior no desasocia la nueva.
Esto no revoca JWT/refreshToken ni invalida sesiones de login. Logout offline/baja
incierta no demuestra desasociación: queda pendiente conciliar; tampoco cancela
envíos remotos ya autorizados. El procesador interno revalida cuenta/revisión y
limita el payload a IDs; cuando se active, el cliente debe comprobar sesión antes de mostrar/abrirlo.

Errores con envoltura vigente: 400 headers/UUID/body/formato; 401 sesión; 404
instalación ausente, credencial errónea o baja de otra cuenta; 409 revisión/código
de operación/token en conflicto; 503 preparación/resultado incierto. Ante error
de red/503 repetir explícitamente la misma operación o GET para conciliar; no
asumir rollback, crear otro token/registro automáticamente o borrar revisión local.
Una baja conocida puede repetirse con los mismos headers sin reactivar nada.

Operación: dos colecciones ordinarias previas `notification_devices` y
`notification_device_tokens`, replica set primario con sesiones; sin ellas PUT/DELETE
falla 503 antes de tx. _id de instalación y hash del token proporcionan unicidad.
Índice `{ userId: 1, state: 1 }` declarado, sin instalar; autoCreate/autoIndex false,
sin TTL/limpieza/migraciones automáticas. Token almacenado solo en fila ACTIVE,
oculto por defecto en consultas genéricas; acceso a DB/respaldos requiere sus
controles operativos. Procesador/invalidación condicional internos en el 57;
activación, proveedor Firebase/APNs y prueba Mongo/FCM reales siguen pendientes. No hay cambio en bandeja, OTP,
solicitudes o propiedad por registrar un dispositivo.

## Campanita y avisos leídos disponibles (bloque 55)

Bearer actual y `Cache-Control: private, no-store`. La bandeja sale de las
notificaciones locales creadas junto con la solicitud; no depende de recibir push.
Cada usuario solo consulta o marca SUS avisos, tanto enviados como recibidos.

| Operación | Entrada | Éxito 200 |
| --- | --- | --- |
| GET /notifications | limit 1–50 (default 20), cursor opcional | `{ items: [aviso], nextCursor? }` |
| GET /notifications/unread-count | Sin parámetros necesarios | `{ count: número }` |
| PATCH /notifications/{id}/read | Body vacío o `{}` | Aviso con `readAt` guardado; repetir conserva la primera fecha |

Aviso: `{ id, transferId, type, itemIds, title, text, createdAt, readAt? }`.
Tipos actuales: TRANSFER_REQUEST_SENT y TRANSFER_REQUEST_RECEIVED. `itemIds`
identifica ítems de negocio del detalle de solicitud, no IDs de animal/archivo.
Renderizar title/text como texto. No hay expediente, destinatario técnico, outbox,
credenciales ni payload de transporte en la respuesta. `readAt` ausente significa
no leído; el backend también trata null persistido como no leído, sin devolverlo.
No enviar userId/readAt/decisiones en el body ni query de listado.

Paginación por createdAt descendente e ID como desempate, con cursor opaco ligado
al usuario. Pasarlo sin editar; no es snapshot global. Una inserción nueva puede
aparecer al refrescar desde el inicio. Lista/contador son lecturas independientes:
no sumar/restar suponiendo una vista atómica entre dispositivos. Tras marcar leído,
refrescar contador y conservar el aviso en la lista; no quitar la card de una
solicitud PENDING ni anunciar aceptación. El cambio solo escribe readAt del aviso.

Errores: 400 entrada/cursor inválido o campos no admitidos; 401 sesión; 404 aviso
inexistente o ajeno (misma respuesta); 503 persistencia/datos no verificables.
Envoltura vigente `statusCode/message/path/timestamp`. Un fallo NO equivale a
contador cero/bandeja vacía. Si falla PATCH o se pierde su respuesta, repetir
explícitamente el mismo id o refrescar: puede haberse guardado readAt. No reenviar
la solicitud, consumir otro OTP o cambiar el estado de transferencia por ese fallo.

No hay marcar todo leído, marcar no leído, eliminar avisos o filtrar tipos/status
todavía. Dispositivos disponibles en el 56; worker/FCM/APNs siguen pendientes.
Al abrir un aviso, consultar
GET /animal-transfers/{transferId}; el aviso no acredita estado vigente, acceso al
expediente o propiedad. No habilitar acciones de aceptar/rechazar/cancelar.

Compatibilidad/operación: misma colección `notifications`, modelo/identidades y
escrituras de creación del 54; sin nuevas colecciones o inicializadores. Se declara
índice no único `{ userId: 1, readAt: 1 }` para revisar/instalar explícitamente en
el entorno; autoCreate/autoIndex siguen false y no se instaló. Consultas limitadas
a tipos actuales, primary/majority y maxTimeMS 5000; límites no prueban cancelación
remota ni garantizan rendimiento sin índices. Mongo real/concurrencia/duración de
consultas aún pendientes de validar. No se ejecutaron envíos o infraestructura.

## Solicitudes pendientes disponibles (bloque 54)

Bearer actual y Cache-Control privado/no-store. Finalizar usa **POST /animal-transfers**
con header `Idempotency-Key` UUID nuevo por intención y body:

```json
{
  "recipientId": "123e4567-e89b-42d3-a456-426614174002",
  "reasonCode": "OTHER",
  "animalIds": ["123e4567-e89b-42d3-a456-426614174003"],
  "authorization": { "challengeId": "123e4567-e89b-42d3-a456-426614174004", "proof": "<proof devuelto por verify>" }
}
```

No enviar senderId, dueño/versiones, nombre del motivo, OTP en claro, comentarios
para OTHER, fechas de vencimiento o estados. No hay máximo de animales aprobado:
se exige selección no vacía/sin duplicados; límites técnicos de HTTP/BSON/transacción
siguen aplicando y no equivalen a una regla de negocio.

Éxito **201** (creada) o **200** (replay):
`{ id, senderId, senderName, recipientId, recipientName, reasonCode, reasonName,
status: "PENDING", version: 1, createdAt, animalCount }`. Ambos son éxito de la misma
acción. Conservar clave y contenido de negocio mientras se resuelve una respuesta
perdida; el orden de animalIds no cambia la intención. Misma clave/contenido devuelve
la solicitud guardada aunque la prueba original haya vencido o sido consumida.
Otra selección/destinatario/motivo con la misma clave devuelve 409. El formato de
authorization sigue siendo obligatorio para POST; si ya no se conserva, consultar
salientes/detalle en lugar de fabricar una prueba. No registrar proof ni usarlo como Bearer.

Errores: 400 body/prueba inválidos o motivo no disponible; 401 sesión; 403 animal
ajeno; 404 participante/animal inexistente; 409 animal inactivo, control inconsistente,
otra solicitud activa o colisión de intención; 503 preparación/persistencia/resultado
incierto. Ante fallo de red/503, repetir explícitamente **la misma** clave y body:
no crear otra intención ni solicitar OTP automáticamente. Una transacción abortada
conserva la prueba; un error incierto no demuestra aborto. Si el commit ocurrió,
el replay devuelve el recibo de negocio y no consume de nuevo. Persistencia de
notificación/outbox/evento comparte transacción; no hay confirmación de entrega push.

| Consulta | Parámetros | Éxito 200 |
| --- | --- | --- |
| GET /animal-transfers | direction=INCOMING (default) u OUTGOING, limit 1–50 (default 20), cursor opcional | `{ items: [resumen], nextCursor? }` |
| GET /animal-transfers/{id} | limit/cursor para los ítems | `{ request: resumen, items: [{ id, animalId, animalName, animalCode, status: "PENDING" }], nextCursor? }` |

Lista por fecha de creación descendente e ID como desempate; detalle por animalId
ascendente. Pasar cursores opacos sin alterarlos; están ligados al usuario y
dirección o solicitud. No son snapshot global ni orden de UUID por fecha.
Lista solo contiene solicitudes propias; detalle ajeno devuelve 403, inexistente
404. No se admiten filtros status todavía. Nombre/código del animal y etiqueta
del motivo se conservan al solicitar: son metadatos identificativos, no el archivo
histórico del expediente ni acceso anticipado a ficha/diario/documentos del animal.

PENDING permite editar y subir archivos al propietario actual. Una solicitud
activa impide otra sobre el mismo animal; no expira ni se cancela automáticamente.
No mostrar Aceptar/Rechazar/Cancelar como acciones disponibles: esos endpoints,
la liberación de exclusividad y la aplicación segura están pendientes. Entrantes
puede consultarse sin esperar push; bandeja/contador/leído ya disponibles en el 55,
sin convertir lectura en decisión. Cambios de nombre o clínica posteriores no
convierten estos metadatos en el corte del expediente al aceptar.

Operación: se registró el módulo de solicitudes en el backend, pero exige replica
set primario con sesiones y **seis colecciones ordinarias previamente preparadas**:
animal_transfers, animal_transfer_items, animal_transfer_active_items,
notifications, notification_outbox y animal_transfer_events. Sin ellas POST devuelve
503 antes de consumir OTP; no las instala al arrancar ni ejecuta migraciones.
_id proporciona unicidad de solicitud/ítem/exclusividad/evento; índices de consulta
están declarados sin instalación automática. Revisar privilegios, opciones/índices,
carga y transacciones del entorno antes de habilitar en Flutter. Todavía no se ha
validado este flujo con Mongo real. Los 120 casos de medios pendientes no lo cubren.

Compatibilidad: rutas OTP, motivos y /recipients conservadas; cuerpos de éxito
previos, incluido PUT animal primitivo, intactos. La creación añade escrituras
de fence internas en usuario/motivo/animal/control; puede competir transitoriamente
con otras escrituras pero no instala un bloqueo duradero sobre el animal.

## OTP de transferencias disponible (bloque 53)

Todos requieren el Bearer de login actual, con Cache-Control privado/no-store.
El actor y destino se obtienen del perfil, nunca de un email/teléfono/userId del body.

| Operación | Body | Éxito |
| --- | --- | --- |
| POST /animal-transfers/otp-challenges | vacío o `{}` | 201: `{ challengeId, channel, maskedDestination, expiresAt, resendAvailableAt }` |
| POST /animal-transfers/otp-challenges/{id}/resend | vacío o `{}` | 200: misma forma; conserva challengeId, reemplaza código e invalida prueba anterior |
| POST /animal-transfers/otp-challenges/{id}/verify | `{ "code": "123456" }` | 200: `{ challengeId, purpose: "ANIMAL_TRANSFER", proof, expiresAt }` |

Usar un campo de **seis dígitos como string**. No modificar el OTP de registro.
Canales disponibles: EMAIL al correo registrado y PHONE al celular registrado;
el mensaje identifica la transferencia. GOOGLE/APPLE/MICROSOFT devuelven 409 por
integración pendiente: su registro no usa UserCodeSender. No pedir un destino
alternativo, convertir el canal automáticamente ni simular éxito.

Mostrar destino enmascarado y cuenta atrás con fechas del servidor. Valores técnicos
por defecto: código 15 min (configuración de registro), prueba 10 min, cinco intentos,
reenvío desde 60 s y tres preparaciones de envío por usuario/ventana de 15 min.
Son configurables; no fijarlos en Flutter ni confundirlos con vencimiento de solicitudes.
Un reenvío tardío anterior puede llegar, pero no reactiva su generación reemplazada.
La cuota limita operaciones lógicas, no acredita cuántos SMS físicos/retries hubo.

Errores: 400 código/desafío inválido, vencido, usado o contacto cambiado; 401 sesión;
409 concurrencia/canal no disponible; 429 con **Retry-After**; 502 envío no reconocido;
500 persistencia/resultado incierto. Conservar la envoltura vigente
`statusCode/message/path/timestamp`. No reintentar envíos automáticamente: un error
no prueba ausencia de entrega o rollback. Una respuesta de activación perdida puede
dejar el código utilizable. Si se pierde la respuesta de verify, no se recupera proof
repitiendo el código: iniciar un desafío nuevo explícitamente tras el enfriamiento.

proof es opaco, de un solo uso y separado de accessToken/refreshToken. Mantenerlo
solo para el POST de Finalizar; no usarlo como Bearer, loguearlo ni enviarlo
al destinatario. Verificar OTP no crea solicitudes, cambia dueño, bloquea animales
o verifica la cuenta. El POST de solicitudes del bloque 54 lo consume y crea la
solicitud en la misma transacción, revalidando propiedad/animales/motivo/destinatario
e idempotencia; aceptación y traspaso efectivo siguen pendientes.

Compatibilidad: endpoints previos y éxitos (incluido PUT animal primitivo) intactos;
registro/reset conservan mensajes y contratos. UserCodeSender añade contexto interno
opcional para intención/TTL; se retiraron logs de OTP y errores crudos de SNS. Las
pruebas usan persistencia/transportes simulados; no hay validación Mongo/SMTP/SNS real.
Detalle técnico/operativo actual en el [plan](./final-delivery-plan.md).

## Preparación de confirmación y errores (bloques 44 y 50)

El filtro traduce el error del ciclo nuevo. AnimalMediaUploads ahora admite un
puerto backend opcional compartido por foto/diario, **sin registrar en el arranque**:
las rutas activas conservan su comportamiento. Mismos DTO/éxitos, incluido PUT animal primitivo,
y misma envoltura de error `statusCode/message/path/timestamp`, sin IDs técnicos.

Cuando se conecte el ciclo: conflicto 409; destino S3 no verificable 502;
fallo de persistencia/configuración interna o resultado incierto 500. Un 500
incierto no confirma rollback ni permite reenviar automáticamente; un 409 pide
refrescar, sin asumir fin de permisos anteriores. El frontend aún no requiere
ajustes mientras siga ausente el puerto; revisar su política de retries antes de activarlo.
Si se selecciona: ticket ordinario no sellado exige contexto interno del journal
(nunca del cliente), pin y verificación/sello cercados antes de guardar referencias.
Un fallo detiene la escritura sin volver a la copia anterior; puede haber efectos
remotos aunque no se haya guardado la referencia. Hay más accesos/latencia; mantener
preview y estado pendiente hasta éxito. Sin ticket, migrado/legacy y ya sellado
conservan sus guardas/compatibilidad: no implica cobertura remota global.
La correlación de errores es privada del backend, sin nuevos IDs públicos ni permiso
de replay. La pauta anterior de repetir una confirmación ante 502
no se debe extender al ciclo seleccionado; revisar el resultado antes de otra acción.
Transferencias completas deshabilitadas. Detalle técnico en
[verificación](./animal-media-promotion-verification.md).

## Motivos

```http
GET /catalogs/animal-transfer-reasons
```

Respuesta: lista de `{ id, code, name, sortOrder, requiresComment }`. Mostrar
`name`, conservar `code` para el contrato futuro de creación. Hay cinco motivos:
PURCHASE_SALE, ADOPTION, GIFT_DONATION, PRIMARY_ACCOUNT_CHANGE y OTHER.
`requiresComment` es false en todos, incluido Otro. No mantener una lista móvil
independiente. Los datos se siembran al arrancar el backend sin sobrescribir
opciones ya existentes.

## Buscar destinatario

```http
GET /animal-transfers/recipients?searchBy=NAME&q=Ana&limit=20
Authorization: Bearer <accessToken>
```

```json
{
  "items": [
    {
      "id": "UUID-DESTINATARIO",
      "name": "Ana María",
      "identificationType": "CC",
      "identificationNumber": "1234567890",
      "cityId": "UUID-CIUDAD"
    }
  ],
  "nextCursor": "CURSOR-OPACO"
}
```

`profilePictureUrl`, `countryId`, `departmentId` y `cityId` son opcionales.
El frontend solicita la cédula y la compara con el dato recibido antes de
confirmar selección. No mostrarla como sugerencia de lo que debe escribir.
La identificación se trata como string, conservando ceros iniciales.

Reglas:

- Búsqueda autenticada por nombre, de 2 a 100 caracteres, tolerante a acentos y
  mayúsculas. El remitente queda excluido.
- `limit`: 1 a 50, por defecto 20. Debounce recomendado en Flutter.
- Para continuar enviar `cursor=nextCursor`, conservando búsqueda y límite.
  Limpiar cursor al cambiar el texto. Ausencia de nextCursor significa fin.
- IDENTIFICATION es un modo reservado: devuelve 400 hasta la entrega futura.
- Una búsqueda inválida/cursor inválido devuelve 400; sin sesión, 401.
- La consulta no envía invitaciones ni inicia OTP. No implementar aún el envío
  final contra una ruta supuesta.

## Compatibilidad con animales y diario

- `GET /animals` y `/animals/search` devuelven solo animales del usuario.
- Para selección usar `/animals/search?isActive=true`. La validación definitiva
  de elegibilidad se hará también en el flujo de transferencia.
- Pedir otro ownerId, detalle o modificación de animal ajeno devuelve 403.
- PUT de animal acepta ownerId idéntico por compatibilidad; cambiarlo devuelve 400. El cambio de dueño se hará mediante la transferencia futura.
- Las rutas de diario validan dueño y asociación entryId/animalId. Una entrada
  anidada bajo otro animal devuelve 404.
- En confirmaciones de fotos/adjuntos devolver exactamente el finalUrl obtenido
  en la carga; no reconstruir ni reutilizar rutas de otro animal/propietario.
- Las respuestas de UserController conservan datos públicos y alias de ubicación;
  credenciales, hashes, OTP y tokens de recuperación ya no se devuelven allí.

### Impacto frontend: conflictos durante PROCESSING

Contrato anterior: una escritura autorizada no tenía un error específico de
transferencia. Contrato nuevo: ficha/foto, diario/adjuntos y mutaciones de
documentos médicos pueden responder HTTP 409 con el mensaje
`The animal is temporarily locked while its transfer is processed` cuando el
backend haya reservado el animal para aplicar una aceptación.

No cambia ningún body exitoso ni se agregan campos a la respuesta del animal.
Una solicitud de transferencia PENDING no activa el bloqueo. Al recibir 409,
Flutter debe conservar cambios locales, mostrar que la transferencia está en
proceso y refrescar el animal/solicitud antes de reintentar. No debe confirmar
una URL prefirmada antigua ni asumir que el 409 equivale a rechazo del traspaso.

Este comportamiento queda preparado pero todavía no puede activarse desde HTTP,
porque los endpoints de solicitud y aceptación siguen sin existir.

| Funcionalidad / rutas existentes                                                                               | Contrato anterior y de éxito actual                                                    | Contrato adicional / ajuste de integración                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUT /animals/{id}`                                                                                            | Se conserva el boolean de éxito que ya devuelve el endpoint.                           | Puede devolver 409 durante la reserva. Conservar formulario y refrescar antes de reintentar.                                                                                  |
| Foto: `GET /animals/{id}/profile-picture/upload-url`, `PATCH /animals/{id}/profile-picture`                    | Se conservan URLs de carga y `{ success, profilePictureUrl }`.                         | Ambas etapas pueden devolver 409. Solicitar una URL nueva al reanudar y conservar el `finalUrl` recibido.                                                                     |
| Diario: creación, edición, eliminación, URL de carga, confirmación y eliminación de adjuntos                   | Se conservan los cuerpos de entrada y respuestas existentes.                           | Las operaciones de escritura pueden devolver 409. El GET normal del diario continúa disponible.                                                                               |
| Medicina: `analyze`, `replacement-analysis`, aceptación en `review` / `replacement-review` y DELETE por animal | Se conservan multipart, versiones, datos validados, estados, códigos y límite de 48 h. | Se agrega conflicto por reserva; distinguirlo de los otros 409 médicos existentes. No reiniciar un análisis automáticamente.                                                  |
| `GET /medical-documents/{id}/related-documents`                                                                | Conserva la lista de documentos por animal y la normalización legacy existente.        | Una lista ya normalizada sigue disponible; separar registros legacy multi-animal requiere permiso de escritura y puede devolver 409 por reserva.                              |
| `POST /animals`                                                                                                | Se conservan HTTP 201 y ficha creada.                                                  | Sin ajuste Flutter: si falla solo el periodo auxiliar después del guardado, el backend devuelve la creación exitosa y repara el estado al arrancar o antes de otra escritura. |

Además, HTTP 409 con `The animal ownership control is inconsistent` o
`The animal ownership period is inconsistent` indica un problema de consistencia,
no una aceptación de transferencia. Conservar cambios locales e informar el
conflicto; no mostrar un progreso de traspaso basándose solo en el código 409.
Las colecciones y versiones de propiedad son internas: no enviar estos campos
en los DTO existentes ni derivarlos de `nameHistory`.

### Subbloque de archivos: sin cambios de integración Flutter

Se incorpora un preparador interno de instantáneas y copias históricas/S3 del
destinatario. No tiene endpoints públicos y no publica el expediente preparado.

- Contrato anterior/nuevo de animales, diario, documentos, catálogos y buscador:
  idénticos cuerpos, respuestas, URLs y códigos HTTP. El 409 documentado arriba
  corresponde al subbloque anterior y sigue igual.
- Ajustes requeridos en Flutter: ninguno en esta etapa.
- Integración: conservar el uso de rutas existentes; no enviar IDs de archivo,
  leases, hashes ni estados de preparación en los DTO actuales. No llamar las
  rutas de histórico propuestas hasta que exista su contrato publicado.
- `READY` es un estado interno de preparación, no significa que la transferencia
  haya sido aceptada ni que el destinatario pueda consultar el expediente.

Los objetos del destinatario quedan en staging; las referencias activas y el
cambio de propietario se integrarán posteriormente con su contrato explícito.

### Subbloque 3: escrituras en curso y polling médico

Coordinación interna: sin nuevos DTO, rutas, campos del animal, URLs ni estados
públicos. Se conservan cuerpos, versiones y códigos exitosos. Las reglas de
cancelación/vencimiento siguen abiertas y no existe aún aceptación desde HTTP.

| Funcionalidad                                              | Contrato anterior                                                        | Contrato nuevo / ajuste de integración                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ficha/foto y diario/adjuntos                               | Comprobaban permiso/reserva antes de escribir, con carrera posterior.    | Mismos requests/éxitos; la comprobación atómica puede devolver el mismo 409 si la reserva gana. Conservar manejo de conflicto documentado, sin nuevos campos.                                                                                                                                                             |
| URLs foto/diario                                           | Firma de 300 s y `{ uploadUrl, finalUrl }` (más attachmentId en diario). | Misma duración/firma/respuesta; se registra espera interna antes de entregarla. Sin ajuste Flutter. Si la petición falla, no asumir URL emitida; pedir otra al reanudar, no construirla.                                                                                                                                  |
| `GET /medical-documents/{id}` ANALYZING                    | Refrescaba AWS/persistía sin coordinación de transferencia.              | Puede devolver 409 por reserva sin cambiar estado médico. Ajustar polling si solo contempla 200: pausar/reprogramar, conservar documentId/edición y refrescar al continuar; no subir otra vez ni marcar FAILED/REJECTED. Fuera de ANALYZING sigue siendo lectura disponible.                                              |
| `PUT .../review` y `.../replacement-review`, REJECT        | Podían limpiar archivos sin comprobar escritura como ACCEPT.             | Ambas decisiones participan en la reserva; REJECT también puede dar 409. Conservar decisión/versión y refrescar después; no asumir rechazo aplicado. ACCEPT conserva datos/versiones.                                                                                                                                     |
| Reemplazo y `GET .../related-documents` legacy             | Normalizaban un registro multi-animal antes de reemplazar.               | Se coordinan también animales legacy no seleccionados que se deben separar. Si alguno está reservado, 409 antes de normalizar/iniciar análisis. Refrescar grupo/versiones al reanudar, sin duplicar carga. Grupos individuales siguen legibles y siblings individuales no seleccionados no se bloquean por normalización. |
| `DELETE /animals/{animalId}/medical-documents/{id}` legacy | Solo comprobaba permiso de escritura del animal de la ruta.              | Un registro compartido legacy requiere todos sus animales escribibles; 409 si otro está reservado. No ocultar la fila antes del 204; refrescar grupo/versiones antes de reintentar. Los individuales conservan alcance por animal y 204.                                                                                  |
| Rescate PDF en polling                                     | Un fallo podía terminar GET mientras otras páginas seguían cargando.     | Espera todas antes del mismo fallback/advertencias; puede tardar más en ese caso. Sin cambios de IA/datos/categorías/límites. Mantener polling sin solicitudes superpuestas y no repetir carga por mayor latencia.                                                                                                        |

Un 409 no identifica por sí solo transferencia: versiones/estado médico y
consistencia conservan errores propios. Ante
`The medical document associations changed; refresh and retry`, refrescar IDs y
versiones sin mostrar progreso de traspaso por ese mensaje. La futura aceptación
deberá contemplar espera por operaciones/URLs, pero su contrato/tiempo máximo
todavía no están implementados. Los 300 s no son vencimiento de transferencias.

La validación DTO/multipart no cambia; las comprobaciones de propiedad/reserva
ahora anteceden a la validación de contenido del archivo en el análisis. Una
petición simultáneamente inválida y no autorizada/bloqueada puede recibir
403/404/409 antes que el 400 de firma/formato. No depender de la prioridad de
errores ni reintentar cargas automáticamente por ese orden.

La secuencia completa y las tareas pendientes están en
`animal-transfer-strategy.md` y `final-delivery-plan.md`.

### Subbloque 4: captura paginada interna, sin ajustes Flutter

Se conectan preflight médico y captura del periodo inicial al preparador interno.
No hay controller, worker automático ni aceptación de transferencia disponible.

- Contrato anterior/nuevo de ficha/foto, diario/adjuntos, análisis, polling,
  revisión ACCEPT/REJECT, reemplazo, eliminación médica, catálogos y buscador:
  idénticas rutas/DTO, errores y respuestas exitosas. También se conservan URLs,
  estados médicos, versiones, códigos y límite de reemplazo de 48 h.
- Ajustes requeridos: ninguno en esta etapa. El manejo de 409 ya registrado
  arriba sigue vigente; no se agregan errores públicos ni campos al animal.
- Integración: no enviar `capture`, `afterId`, revisiones o conteos internos a
  los endpoints existentes. No consumir COLLECTING/COMPLETE/COPYING/READY como
  estado de negocio ni dar acceso al destinatario por ellos.
- IA pendiente/legacy se detectan aquí como precondiciones internas. El futuro
  endpoint de decisión publicará su propio contrato; no asumir hoy un body o
  código HTTP para esa denegación, ni cancelar procesos médicos automáticamente.
- La captura rechaza otros periodos hasta incorporar antecedentes retenidos;
  esto no limita las lecturas/escrituras públicas actuales. La transferencia
  completa continúa sin habilitarse y vencimiento/cancelación siguen pendientes.

### Subbloque 5: cargas aisladas y confirmación de medios

IMPORTANTE: se conservan los JSON existentes, pero sí cambia cuándo el archivo
está disponible y qué verifica la confirmación. Detalle completo y requisitos
de despliegue en [animal-media-upload-isolation.md](./animal-media-upload-isolation.md).

| Funcionalidad                       | Contrato anterior                                                         | Nuevo / ajuste Flutter                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET upload-url de foto y de adjunto | uploadUrl apuntaba al objeto de finalUrl.                                 | Mismos campos uploadUrl/finalUrl y attachmentId en diario, firma 300 s, mismos parámetros y tipos. Ahora apuntan a claves distintas. No requiere headers nuevos. Enviar bytes SOLO a uploadUrl, sin derivar URL o nombre de destino.                                                   |
| Previsualización                    | Se podía intentar leer finalUrl tras PUT.                                 | Las cargas nuevas solo están disponibles allí después de confirmar. Si el cliente lo usaba antes, requiere ajuste: preview local y estado pendiente hasta la respuesta HTTP exitosa de confirmación.                                                                                   |
| PATCH foto                          | Body finalUrl, éxito `{ success, profilePictureUrl }`.                    | Idéntico body/éxito. La confirmación verifica el objeto y fija copia antes de persistir. Puede devolver 400 (ruta/metadatos), 409 (no disponible/cambió/conflicto/reserva) o 502 (S3). No reemplazar foto visible ni borrar preview antes del éxito.                                   |
| POST adjunto                        | Body attachmentId/finalUrl/fileName/mimeType/size; éxito 201 con entrada. | Body/éxito iguales; enviar MIME y bytes exactos declarados al pedir la URL. Se verifica tamaño/MIME reales. Añade 409 si el adjunto no pudo guardarse; no mostrar éxito ni ocultar pendiente por ese error.                                                                            |
| Reintentos                          | Podían repetir confirmación idéntica.                                     | Ante 502 o incertidumbre de red repetir MISMA confirmación, sin subir otra vez: puede existir ya una copia sellable. Ante mensaje de temporal cambiado o final borrado, pedir URL nueva y cargar archivo local otra vez. No modificar una URL antigua ni reutilizar otro attachmentId. |
| Rutas/nombres                       | profile\_ seguido de valor numérico y diario con UUIDs.                   | La jerarquía final se conserva, pero el valor numérico nuevo de foto NO es fecha ni entero de tamaño fijo. Tratar URL como string opaco y conservar finalUrl exacto.                                                                                                                   |
| Legacy y demás módulos              | Medios anteriores, foto usuario, medicina, catálogos y buscador.          | Legacy conserva confirmación anterior pero no es transferible hasta migrar. Sin cambio en los endpoints de foto usuario/medicina/catálogos/buscador; no aplicarles staging ni nuevos contratos por inferencia.                                                                         |

Un 409 ya no significa necesariamente bloqueo de transferencia: revisar mensaje
y contexto, conservar datos locales y no reintentar automáticamente en bucle.
Refrescar antes de decidir otra acción. La confirmación puede tardar más por
copias/hash; mantener una sola petición en curso, sin duplicar cargas por latencia.
No se agregan campos a animales/entradas ni capacidades o estados de transferencia.
No se habilita aceptación y siguen pendientes vencimiento/cancelación.

### Subbloque 6: migración explícita de URLs antiguas

Servicio interno implementado, sin endpoint, ejecución automática ni migración
real realizada. El ajuste móvil es requisito previo a ejecutar el rollout.
El conflicto por URL cambiada ya puede aparecer con esta versión; los valores
guardados solo se transforman al ejecutar la migración explícita.

| Área                         | Contrato anterior                                 | Nuevo / integración Flutter                                                                                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET ficha/diario             | URL actual guardada del medio.                    | Mismos DTO e identidades; una migración explícita cambia solo profilePictureUrl/attachment.url. Usar URLs opacas y refrescar caché por valor, no reconstruirlas desde IDs. Fotos conservan nombre numérico opaco; adjuntos pueden usar diary/entryId/attachmentId/sealed_id.ext. |
| Confirmación antigua         | Una URL legacy válida podía confirmarse otra vez. | Una URL retirada por migración da 409; refrescar animal/entrada. No restaurar la URL vieja ni asumir archivo perdido. Comparar adjuntos por attachmentId, que se conserva, y conservar formulario/archivo local.                                                                 |
| Confirmación canónica        | Repetición idéntica idempotente.                  | Igual para la URL canónica actual, incluida la subruta sealed de un adjunto ya existente. No usar una subruta sealed para crear otro adjunto. Cuerpos y respuestas exitosas no cambian.                                                                                          |
| Escrituras durante migración | Reserva preparada para transferencia.             | Una migración interna explícita también usa esa exclusión. Puede dar el 409 de reserva existente sin que exista una transferencia real. Conservar cambios locales, refrescar y no reintentar en bucle. Las lecturas siguen disponibles y pueden ver páginas ya migradas.         |

No se agregan campos de migración a DTO, rutas administrativas ni permisos
especiales. La reserva alcanza las mismas rutas ya coordinadas: ficha/foto,
diario/adjuntos y escrituras médicas (incluidos polling ANALYZING, REJECT y
normalización legacy). GET puros/grupos normalizados siguen disponibles. No
cambia carga nueva, foto del usuario, motivos/buscador, nameHistory ni reglas
médicas/transferencia. No implementar botones de migración
en Flutter. Plan operativo y límites en
[animal-media-legacy-migration.md](./animal-media-legacy-migration.md).

### Subbloque 7: recuperación técnica y copias no actuales

Recuperación/inventario internos, sin endpoints ni acciones nuevas de Flutter.
No es cancelación/vencimiento de transferencias y no amplía permisos del usuario.

| Área                         | Anterior                                                                                                       | Nuevo / instrucciones de integración                                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PATCH foto                   | Un ticket de migración podía verificarse/confirmarse por su URL aunque no estuviera activado como foto actual. | 409 si una copia de migración no es la referencia actual. No activar copias preparadas ni restaurar una foto migrada desplazada a través de PATCH. Refrescar y conservar cambios locales; si se quiere otra foto, solicitar una carga nueva normal. La foto canónica actual se reconfirma igual.                     |
| POST adjunto                 | Referencia canónica existente idempotente; subruta sealed nueva rechazada.                                     | Se conserva ese contrato y se exige también referencia actual en la verificación interna. Mismos cuerpos/201; no enviar currentUrl, STOPPED ni metadatos de recuperación desde Flutter.                                                                                                                              |
| Escrituras tras intervención | Una migración fallida podía conservar indefinidamente el 409 de reserva.                                       | Una detención técnica explícita puede liberar solo esa reserva, sin revertir páginas ya migradas ni borrar medios. Refrescar ficha/entrada y volver a validar permisos antes de reintentar; no suponer transferencia cancelada/aceptada ni que un archivo ausente ya existe. No reintentar automáticamente en bucle. |
| GET y restantes flujos       | Lecturas puras disponibles; contratos vigentes.                                                                | Idénticos DTO/URLs actuales/éxitos. No cambian cargas nuevas normales, foto usuario, medicina, catálogo/buscador ni nameHistory. Siguen vigentes los conflictos de reserva de todas las rutas ya coordinadas; no se agregan estados públicos o un API de inventario.                                                 |

Todas las réplicas deben usar la guarda de confirmación antes de habilitar la
intervención. Detalle operativo y pendientes en
[animal-media-migration-recovery.md](./animal-media-migration-recovery.md).

### Subbloque 8: journal técnico de escrituras

Este es el registro central de integración: no hay rutas ni campos nuevos para
Flutter. Se conservan los cuerpos y respuestas exitosas, incluida la respuesta
primitiva vigente de PUT animal; no convertirla a un DTO nuevo por este bloque.

| Funcionalidades existentes                                                              | Antes                                                                      | Nuevo / ajuste de integración                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PUT ficha, URL/confirmación de foto, CRUD diario y URL/confirmación/borrado de adjuntos | Coordinación por tokens y reserva.                                         | Ahora preparan evidencia persistida antes de invocar la escritura. Un fallo de preparación puede devolver el 500 interno vigente; un conflicto del journal añade 409 con mensaje propio. Conservar formulario/archivo, refrescar y no repetir una mutación automáticamente ante error genérico.                                                                    |
| Análisis/reemplazo, revisión ACCEPT/REJECT y eliminación médica                         | Mismos multipart, versiones, extracciones/categorías y éxitos 202/200/204. | Sin cambiar esos contratos, pasan por la misma preparación y sus fallos 500/409. Conservar IDs/versiones/edición y refrescar documento/grupo antes de decidir reintento; no comenzar otro análisis automáticamente. Ninguna regla clínica ni ventana de 48 h cambia.                                                                                               |
| GET por ID ANALYZING y relacionados legacy que normalizan                               | Ya podían escribir y dar 409 por reserva.                                  | También pueden dar 500/409 por preparación del journal. Mantener polling sin solapamientos, conservar documentId y refrescar/reprogramar; no marcar FAILED/REJECTED ni repetir la carga por ese error. Lecturas puras y grupos ya normalizados no crean journal.                                                                                                   |
| Resultado después del callback                                                          | La liberación fallida no convertía un guardado exitoso en error.           | Se conserva también si falla guardar evidencia posterior: el éxito sigue siendo éxito. Un error de callback conserva su error original, NO demuestra rollback. Tras timeout de red, consultar estado antes de repetir; el journal no deduplica solicitudes de negocio.                                                                                             |
| Campos, latencia y demás módulos                                                        | DTO, URLs y campos existentes.                                             | Sin campos nuevos. No enviar operationId, instanceId, kind, claims, MAY_RUN o LOCALLY_FINISHED ni mostrarlos como progreso de transferencia. Hay escrituras Mongo adicionales: mantener estado pendiente y datos locales, sin duplicar por latencia. Creación inicial de animal, GET puros, foto de usuario, auth, catálogos y feedback global anónimo no cambian. |

Los mensajes `The animal write journal changed; refresh before retrying` o
`The animal write journal ID has already been used` son conflictos internos,
no prueba de transferencia ni instrucciones para generar un ID en Flutter.
MAY_RUN solo expresa posibilidad local de ejecución; cierre local no garantiza
que AWS haya terminado. La aceptación de transferencia sigue sin habilitarse.
Detalles y límites en [animal-write-journal.md](./animal-write-journal.md).

### Subbloque 9: adquisición transaccional y recuperación previa al callback

Registro central del impacto: afecta las mismas escrituras coordinadas de ficha,
foto, diario/adjuntos, análisis/reemplazo/revisión/eliminación médica y los GET
con efectos (polling ANALYZING y normalización legacy). GET puros, creación
inicial de animal, foto de usuario, auth, catálogos y buscador conservan contrato.

- Anterior: journal INTENT y adquisición del token eran escrituras separadas.
  Nuevo: cada adquisición enlazada y su autorización ACQUIRED se confirman en
  una transacción Mongo snapshot/primary/majority antes de permitir el callback.
  DTO, rutas, cuerpos y éxitos se conservan, incluido PUT animal primitivo.
- Ajustes requeridos: conservar el manejo de 500/409 del subbloque 8. Ahora las
  escrituras coordinadas requieren transacciones disponibles; un fallo de
  transacción puede impedir su inicio. Mantener una sola petición pendiente y
  conservar formulario/archivo/IDs/versiones ante latencia o fallo.
- Una intervención técnica interna puede cerrar una operación que nunca recibió
  permiso de callback y retirar solo sus tokens enlazados. La petición en vuelo
  detenida puede recibir el 409 del journal; refrescar antes de decidir reintento.
  Ese conflicto no identifica el estado de una transferencia.
- Integración: no enviar protocolo, auditoría, operationId/instanceId/requestId
  ni estados RECOVERED desde Flutter. No hay endpoint ni botón de recuperación.
  Conservar polling sin solapamientos; no marcar análisis FAILED/REJECTED ni
  reiniciar la carga por un fallo del coordinador. Ante error/timeout consultar
  estado antes de repetir: el journal sigue sin idempotencia de negocio.
- Compatibilidad/riesgos: journals/tokens anteriores se leen sin atribución ni
  backfill y quedan excluidos de esta recuperación. Las nuevas transacciones
  añaden dependencia de replica set/Atlas y latencia a funcionalidades existentes.
  Un error no demuestra rollback del negocio ni fin de efectos remotos.
  La aceptación completa sigue sin habilitarse; las reglas de vencimiento y
  cancelación permanecen pendientes.

### Subbloque 10: arnés opt-in de integración Mongo

- Funcionalidades existentes afectadas: ninguna en ejecución. Este bloque añade
  pruebas separadas para el protocolo que ya usan ficha/foto, diario/adjuntos y
  escrituras médicas; no modifica código de esos flujos.
- Contrato anterior/nuevo: mismas rutas, DTO, cuerpos, URLs, respuestas exitosas
  (incluido PUT animal primitivo) y errores. Ajustes Flutter requeridos: ninguno.
- Integración/manejo de errores: mantener las instrucciones de los subbloques
  8/9; no enviar variables del arnés ni IDs técnicos desde Flutter. El comando
  de integración es exclusivo de desarrollo y queda fuera de `npm test` y del
  arranque del servidor. No agrega recuperación HTTP ni botones operativos.
- Compatibilidad/riesgos: no introduce dependencias ni habilita transferencias.
  Preparar/compilar el arnés no demuestra atomicidad, failover ni mayoría reales.
  La primera ejecución real se registró después en el subbloque 11 sobre un
  replica set local dedicado y una base desechable. Los 500/409,
  latencia y dependencia transaccional del subbloque 9 siguen vigentes.

### Subbloque 11: primera validación real en Mongo local

- Funcionalidades afectadas: ninguna modificación en ejecución. Se validó el
  protocolo existente que coordina ficha/foto, diario/adjuntos y escrituras
  médicas usando adaptadores Mongo reales en un entorno desechable.
- Contrato anterior/nuevo: mismos DTO, rutas, cuerpos, URLs, éxitos (incluido
  PUT animal primitivo), permisos y errores. Ajustes Flutter requeridos: ninguno.
- Integración/manejo de errores: continúan las instrucciones 8/9; la prueba
  aprobada no convierte errores de negocio en rollback ni habilita reintentos
  automáticos. No enviar IDs técnicos ni variables de pruebas desde Flutter.
- Compatibilidad/riesgos: once escenarios aprobados con dos conexiones en un
  mismo proceso y un replica set de UN nodo, MongoDB 8.0.34. No equivale a
  prueba de failover/multinodo, cierre de efectos S3 o autorización operativa.
  No activa aceptación, recuperación general, cancelación ni vencimiento.
  Evidencia y límites en [animal-write-mongo-validation.md](./animal-write-mongo-validation.md).

### Subbloque 12: importación interna de antecedentes retenidos

- Funcionalidad afectada: preparación interna de expedientes históricos y copias;
  no cambia el comportamiento HTTP existente de ficha/foto, diario/adjuntos,
  análisis, polling, ACCEPT/REJECT, reemplazo, eliminación, grupos/descargas
  médicas, auth, foto de usuario, catálogos o buscador de destinatarios.
- Contrato anterior: preparación manual de registros vigentes, sin importación
  de antecedentes. Nuevo: importador interno explícito de un predecesor efectivo,
  con procedencia, cursor y referencias a copias históricas verificadas.
  Sellar manualmente un período >1 exige importación completa; retained-history
  no se acepta como fuente vigente. Captura automática sigue limitada al período
  inicial. Estos son contratos internos, no rutas de transferencia disponibles.
- Ajustes requeridos en Flutter: ninguno nuevo. Se conservan rutas, DTO, campos,
  URLs públicas, cuerpos/éxitos (incluido PUT animal primitivo), errores y reglas
  médicas, categorías, códigos y ventana de 48 h. No cambia retención/borrado del
  runtime médico activo; su adaptación sigue pendiente antes de transferir.
- Integración/manejo de errores: mantener las instrucciones anteriores de
  409/500/502, conservar datos locales, refrescar y no duplicar por incertidumbre.
  No enviar history/retained, IDs raíz, hashes o cursores a endpoints existentes;
  no construir rutas retained-history ni mostrar payload histórico crudo. Su
  futura entrega exigirá resolver fileBindings y autorizar descargas en backend.
- Compatibilidad/riesgos: campos internos opcionales sin default/backfill ni
  migraciones ejecutadas. El nuevo tipo RETAINED_RECORD requiere desplegar
  lectores/preparadores compatibles antes de usarlo; versiones antiguas no deben
  procesar estos archivos. Las pruebas de este bloque usan dobles Mongo/S3 y
  cadenas sintéticas, no transferencias reales. READY no publica ni concede
  acceso, la captura posterior/activación/permisos/retención siguen pendientes.
  No habilita aceptación, cancelación o vencimiento ni agrega acciones Flutter.

Protocolo y límites: [ownership-archive-history.md](./ownership-archive-history.md).

### Subbloque 13: plan persistido de referencias, no activación

- Funcionalidades afectadas: preparación interna del expediente y sus
  referencias de ficha/foto, diario/adjuntos y documentos médicos vigentes o
  retenidos. No cambia la ejecución HTTP de estos flujos, análisis/polling,
  ACCEPT/REJECT, reemplazo/borrado/grupos/descargas, auth, foto de usuario,
  catálogos ni buscador.
- Contrato anterior: fileBindings y manifiesto verificados sin un plan de
  aplicación por entrada. Nuevo: plan interno por entrada con protocolo/hash,
  procedencia, formatos URL/KEY, revisión histórica y staging verificados,
  destino final planificado y cambio de ownerId solo propuesto para recursos
  vigentes. Los antecedentes siguen de solo lectura y no se vuelven activos.
- Ajustes Flutter requeridos: ninguno nuevo. Rutas/DTO/cuerpos, URLs públicas,
  éxitos (incluido PUT animal primitivo) y errores públicos se conservan.
  No cambia información clínica, códigos, acceptedAt ni plazo de 48 h.
- Integración/manejo de errores: mantener el manejo previo de conflictos,
  latencia e incertidumbre; conservar datos locales y consultar antes de
  repetir. No enviar referencePlan/planHash, ownerChange, fase o cursor desde
  Flutter. No construir URLs desde plannedFinalKey ni tratar staging como
  archivo activo. El plan no es una respuesta pública ni concede acceso.
- Compatibilidad/riesgos: campos internos opcionales sin default/backfill,
  sin colección/índice/TTL nuevo. PLANNED NO significa transferencia aceptada,
  archivo final existente o publicación. No hay endpoint/botón nuevo ni
  activación automática. Siguen pendientes materialización final, commit de
  referencias/propiedad/períodos/eventos, retención y permisos históricos.
  Captura automática aún limitada al período inicial; las pruebas usan
  dobles Mongo y cadenas sintéticas, no transferencia real.

Detalle: [ownership-archive-reference-plan.md](./ownership-archive-reference-plan.md).

### Subbloque 14: materialización interna sin activar referencias

- Funcionalidades afectadas: preparación interna de archivos finales de ficha/
  foto, diario/adjuntos y documentos médicos, incluidos antecedentes retenidos.
  No cambia el runtime HTTP de esos flujos, BDA, polling, ACCEPT/REJECT,
  reemplazo/borrado/grupos/descargas, auth, foto de usuario, catálogos o buscador.
- Contrato anterior: final solo planificado, sin copia ni evidencia final.
  Nuevo: servicio interno explícito materializa desde staging fijado, con
  intención persistida, identidad/digest y confirmación condicionada al lease.
  Un destino existente ajeno provoca conflicto interno, incluso con bytes iguales.
  No se sobrescribe, adopta o renombra automáticamente para resolver devoluciones.
- Ajustes Flutter requeridos: ninguno nuevo; mismos endpoints/DTO, cuerpos,
  URLs públicas, éxitos (incluido PUT animal primitivo) y errores existentes.
  No cambia códigos, categorías, extracción, nameHistory ni acceptedAt/48 h.
- Integración/manejo de errores: conservar las instrucciones previas de
  409/500/502, datos locales y consulta antes de repetir. No enviar intención,
  materialization, hashes o leases desde Flutter ni añadir botones de copia.
  No consumir MATERIALIZED como aceptación, permiso o referencia activa y no
  reconstruir final URLs desde los estados técnicos. No hay ruta pública nueva.
- Compatibilidad/riesgos: campos opcionales sin default/backfill ni índices/
  colecciones/TTL nuevos. READY y PLANNED mantienen su significado. Una copia
  final no registra un ticket de medio sellado ni modifica referencias activas:
  ese registro y el commit de propiedad/períodos/eventos siguen pendientes.
  Colisiones de retornos se protegen, pero su resolución aún falta. Captura
  automática sigue restringida al período inicial. Pruebas con dobles Mongo/S3,
  sin demostrar privacidad del bucket, retención o cierre de efectos tardíos.

Protocolo: [ownership-archive-materialization.md](./ownership-archive-materialization.md).

### Subbloque 15: generaciones explícitas y protección frente a activación legacy

- Funcionalidades afectadas: materialización interna de foto/diario/documentos
  y antecedentes; emisión y confirmación de medios de animal, migración legacy
  e inspección de medios para captura. No cambia auth, foto de usuario, catálogos,
  búsqueda, BDA/polling, ACCEPT/REJECT médico, reemplazo/borrado/grupos/descargas.
- Contrato anterior: destino efectivo igual a plannedFinalKey y confirmación
  sin ticket permitida por compatibilidad legacy. Nuevo: opt-in interno
  generacional ANTES de iniciar materialización; planes/manifiestos originales
  no cambian. Destino efectivo en intención verificada, nunca deducido por Flutter.
  Las URLs reservadas `profile_000` + 78 dígitos + extensión canónica y rutas con
  segmento `transfer-generations` NO pueden emitirse/confirmarse/migrarse como
  medios ordinarios ni pasar inspección de captura. Confirmación devuelve 409
  aun sin ticket o si se envía como URL actual; emisión interna rechaza destino
  inválido. Diario puede rechazar antes con su 400 de pertenencia/formato existente.
- Ajustes Flutter: ninguno para cargas/URLs ordinarias emitidas por el backend.
  No enviar rutas construidas manualmente, URLs de preparación o el nuevo
  namespace, ni inferir timestamps de nombres numéricos. Éxitos/DTO/JSON/rutas
  HTTP no cambian, incluido PUT animal primitivo; sí cambia la admisión de esas
  URLs reservadas. Un JSON idéntico no implica ausencia de impacto.
- Integración/errores: ante 409 conservar edición, refrescar referencia vigente
  y no repetir la misma URL ni re-subir automáticamente. Ante 400 revisar la
  referencia emitida/metadatos, no modificar la ruta para sortear validaciones.
  Mantener el manejo previo de 500/502 e incertidumbre. No consumir MATERIALIZED
  como aceptación ni presentar botones de generación. El futuro backend debe
  resolver el destino verificado; el plan original por sí solo ya no basta.
- Compatibilidad/riesgos: V1 conserva hashes/intenciones/destinos y sigue
  detenido ante colisión; NO hay conversión, ni siquiera por error/antigüedad.
  Nuevo protocolo requiere lectores/guardas compatibles antes de emitirlo;
  sin backfill, campos/índices/TTL nuevos o cambios clínicos/códigos/acceptedAt/48 h.
  Legacy ordinario sigue compatible, pero un objeto previo excepcional con el
  patrón/segmento reservado se deniega y necesita revisión operativa. No activar
  estas URLs manualmente: registro transferido/commit/publicación/retención siguen
  pendientes. Pruebas con dobles; transferencia completa y captura posterior
  continúan deshabilitadas. No nuevas reglas de vencimiento/cancelación.

Detalle: [ownership-archive-generations.md](./ownership-archive-generations.md).

### Subbloque 16: registro de evidencia de medios, sin publicación

- Funcionalidades afectadas: preparación interna de foto, diario/adjuntos,
  documentos y antecedentes retenidos. Nuevo registro explícito por archivo;
  no cambia ejecución HTTP de ficha/foto, diario, medicina/BDA/polling/revisión/
  reemplazo/borrado/grupos/descargas, auth, foto usuario, catálogos o buscador.
- Contrato anterior: evidencia final en manifiesto e intención, sin registro
  separado. Nuevo: constancia interna PREPARED de destino efectivo, revisión/
  digest y procedencia en animal_transferred_media. No es ticket de carga,
  publicación, capacidad de acceso, aceptación o expediente completo registrado.
  Guardas de URLs generacionales del subbloque 15 permanecen sin excepciones,
  incluso cuando el registro ya existe; confirmación/migración/captura no lo adoptan.
- Ajustes Flutter: ninguno nuevo. Mismos endpoints/DTO/URLs/cuerpos/éxitos y
  errores públicos, incluido PUT animal primitivo; no cambia clínica/categorías/
  códigos/acceptedAt/48 h/nameHistory. No enviar IDs de registro, hashes, keys o
  PREPARED ni agregar botones/acciones de registro o de transferencia supuesta.
- Integración/errores: conservar instrucciones previas de 400/409/500/502,
  datos locales y consulta antes de repetir. No deducir publicación/permiso desde
  un registro técnico ni probar su URL por confirmación ordinaria. El futuro
  orquestador repetirá la misma identidad tras resultado incierto, sin retarget ni
  duplicación de negocio; no trasladar ese mecanismo interno a Flutter.
- Compatibilidad/riesgos: colección/índices únicos NUEVOS declarados, sin TTL,
  defaults/backfill o migración ejecutada. El modelo Mongoose puede requerir
  creación/índices al arrancar según autoCreate/autoIndex y permisos/configuración;
  comprobar antes de rollout. El servicio requiere transacciones y la reserva
  existente pero no se ejecuta automáticamente. PREPARED no revalida S3 ni
  garantiza disponibilidad actual o fin de copias tardías. V1 anterior no se
  registra/convierte por este protocolo. Transferencia completa, commit conjunto,
  publicación, retención/permisos y captura posterior siguen pendientes.
  Pruebas con dobles no prueban esas garantías reales.

Detalle: [ownership-archive-media-registration.md](./ownership-archive-media-registration.md).

### Subbloque 17: recorrido de metadatos, no permiso de transferencia

- Funcionalidades afectadas: revisión interna de snapshots/planes, manifiesto y
  registros de foto/diario/documentos/antecedentes preparados. No modifica el
  runtime HTTP de ficha/foto, diario, medicina/BDA/polling/revisión/reemplazo/
  borrado/grupos/descargas, auth, foto usuario, catálogos ni buscador.
- Contrato anterior: registros PREPARED por archivo sin revisión del conjunto.
  Nuevo: corrida interna explícita con páginas ENTRIES/FILES, reconstrucción de
  planes, cobertura/conteos y digests persistidos. METADATA_OBSERVED solo registra
  el recorrido Mongo, NO prueba bytes/disponibilidad S3, corte estable, acceso,
  aceptación o permiso de commit. Las guardas generacionales siguen intactas.
- Ajustes Flutter: ninguno nuevo; mismos endpoints, DTO/cuerpos, URLs, éxitos y
  errores públicos, incluido PUT animal primitivo. No hay nuevas capacidades ni
  cambios clínicos/códigos/categorías/acceptedAt/48 h/nameHistory. No enviar runId,
  cursores, hashes o METADATA_OBSERVED desde Flutter ni mostrarlo como aceptación.
- Integración/errores: mantener manejo previo de 400/409/500/502 y datos locales,
  consulta antes de repetir. El conflicto interno de corrida obsoleta exige
  revisión del futuro orquestador, no reinicio/carga automática desde móvil.
  Un registro/corrida conocidos no permiten confirmar URLs generacionales ni
  retirar tokens/reservas. Un timeout no implica rollback o fin de efectos S3.
- Compatibilidad/riesgos: colección/índices nuevos declarados, sin TTL/defaults/
  backfill/migración ejecutada. Mongoose puede exigir crear colección/índices
  al arrancar según autoCreate/autoIndex/permisos; verificar antes de rollout.
  Páginas requieren transacciones y reserva existente. Otras operaciones del
  pipeline pueden invalidar conservadoramente la corrida, aun ya terminada.
  No es epoch universal de escritores, prueba de fin remoto, revalidación actual
  del expediente activo ni garantía contra cambios externos al protocolo.
  No hay API pública, job automático o habilitación de transferencia completa.
  Validaciones con dobles, no Mongo/S3 reales.

Detalle: [ownership-archive-metadata-revalidation.md](./ownership-archive-metadata-revalidation.md).

### Subbloque 18: observación final S3, sin publicación

- Funcionalidades afectadas: revisión interna de objetos finales preparados de
  foto/diario/documentos/antecedentes. No cambia el runtime HTTP de ficha/foto,
  diario, medicina/IA/BDA/polling/revisión/reemplazo/borrado/grupos/descargas,
  auth, foto usuario, catálogos o buscador.
- Contrato anterior: METADATA_OBSERVED solo cotejaba Mongo. Nuevo: inicio
  interno explícito y páginas de lecturas HEAD/GET/HEAD de destinos finales,
  revisión fijada, identidad/tamaño/SHA-256 y checkpoint transaccional ligado
  al mismo recorrido/control. S3_OBSERVED registra observaciones pasadas, NO
  corte estable, disponibilidad futura, aceptación, acceso o permiso de commit.
- Ajustes Flutter: ninguno nuevo; mismos endpoints/DTO/URLs/cuerpos/éxitos y
  errores públicos, incluido PUT animal primitivo. No enviar runId/recibos/
  hashes/keys ni consumir estas fases como estados de transferencia. No añadir
  botones para observar/reparar ni confirmar URLs generacionales por rutas legacy.
- Integración/errores: conservar manejo previo de 400/409/500/502 y edición local,
  consultando antes de repetir. No tratar timeout/error como rollback o ausencia
  de efectos remotos. Conflictos de observación interna requieren revisión del
  futuro orquestador, no re-subida, reparación, nueva corrida o reintento automático
  desde Flutter. Repetir una fase terminal no vuelve a verificar S3.
- Compatibilidad/riesgos: subdocumento s3Observation opcional sin default/backfill,
  colección, índice o TTL nuevos. Servicio exportado sin endpoint/job/arranque
  automático. Comparte fence: otra operación del pipeline puede invalidarlo.
  GET en streaming y páginas 1–20 acotan objetos, no bytes/latencia/coste;
  necesita permisos S3 de lectura/versiones, sin cambiarlos en este desarrollo.
  Mocks no verifican infraestructura real. No resuelve ABA ni fin de copias
  tardías; un objeto puede cambiar después del último HEAD. Guardas de medios,
  reserva/recuperación y captura inicial intactas. Sin cambios de clínica,
  códigos/categorías/acceptedAt/48 h/nameHistory ni reglas de cancelación/vencimiento.
  Transferencia completa, consumo/commit, publicación y acceso histórico pendientes.

Detalle: [ownership-archive-s3-observation.md](./ownership-archive-s3-observation.md).

### Subbloque 19: identidad de reserva y evidencia obsoleta

- Funcionalidades afectadas: reservas internas de captura y migración de medios,
  preflight que libera su reserva denegada, finalización/detención de migración
  y recorridos de metadatos/S3. Las mismas escrituras HTTP de ficha/foto, diario/
  adjuntos y medicina pueden seguir pausadas por una reserva; GET puros disponibles.
- Contrato anterior: reserva comparada por transferId/lockedAt y observaciones
  por revisión de pipeline; una liberación/readquisición idéntica no tenía
  identidad monotónica. Nuevo: reservationEpoch persistido e incrementado en cada
  transición, CAS de adquisición/liberación/migración y evidencia fijada al epoch.
  Liberación atrasada o checkpoint de otra reserva no se adopta silenciosamente.
- Ajustes Flutter: ninguno nuevo. Mismos endpoints/DTO/URLs/cuerpos/éxitos y errores
  públicos, incluido PUT animal primitivo. No cambia clínica/IA/BDA/códigos/
  categorías/acceptedAt/48 h/nameHistory. No enviar epoch ni IDs técnicos o crear
  acciones para recuperar/reservar/observar. No es un estado de transferencia.
- Integración/errores: conservar manejo de 400/409/500/502, edición/archivo local,
  consulta antes de repetir y polling sin solapamientos. No interpretar conflicto
  interno como transferencia aceptada/cancelada ni solicitar desbloqueo automático.
  Un error sigue sin demostrar rollback o fin de S3. El futuro llamador operativo
  debe conservar SU identidad adquirida, no consultar el epoch actual para hacer
  coincidir una acción vieja; esta instrucción es backend, no lógica Flutter.
- Compatibilidad/riesgos: campos internos opcionales sin default/backfill,
  colecciones/índices/TTL nuevos. Corridas antiguas sin epoch NO se reanudan ni
  consumen como evidencia válida; reservas legacy no ganan identidad por edad.
  Trabajos de migración previos solo actúan con control también sin epoch.
  Una intervención puede seguir requiriendo revisión, sin liberar/readquirir
  para sortear la guarda. Todas las réplicas/mutadores deben actualizarse/drenarse;
  no se ejecutó rollout ni intervención. No hay epoch universal de escritores,
  corte S3 estable o habilitación de transferencia. Falta ligar cabeceras y todos
  los workers del archivo a esta identidad antes de consumo/commit/publicación.

Detalle: [animal-reservation-epoch.md](./animal-reservation-epoch.md).

### Subbloque 20: preparaciones ligadas a su reserva original

- Funcionalidades afectadas: preparación/captura/copia interna, antecedentes,
  planes, materialización, registro PREPARED y observaciones Mongo/S3 de foto,
  diario y documentos. No modifica ejecución HTTP de ficha/foto, diario/adjuntos,
  medicina/IA/BDA/polling/revisión/reemplazo/borrado/grupos/descargas, auth, foto
  usuario, catálogo o buscador. Las guardas ordinarias de medios siguen intactas.
- Contrato anterior: la cabecera no fijaba epoch; checks de aplicación separados
  de algunas escrituras podían cruzar una liberación/readquisición. Nuevo:
  reservation inmutable en NUEVAS cabeceras, creación/checkpoints bajo transacción
  y fence del mismo control; todos los mutadores comparan el epoch original.
  begin manual debe recibir explícitamente el epoch adquirido como tercer argumento.
  Cabeceras previas sin vínculo se conservan, pero NO se reanudan ni retroadaptan.
- Ajustes Flutter: ninguno nuevo. Mismos endpoints/DTO/URLs/cuerpos/éxitos y
  errores públicos, incluido PUT animal primitivo. Sin cambios de clínica,
  categorías/códigos/acceptedAt/48 h/nameHistory. No enviar reservation/epoch,
  hashes o contadores técnicos ni construir UI para intervenir preparaciones.
- Integración/errores: mantener manejo previo de 400/409/500/502, datos/archivo
  local y consulta antes de repetir, sin polling superpuesto. No inferir rollback
  o fin S3 por error/timeout. Cabecera obsoleta exige revisión del futuro llamador
  operativo, no reset o adopción de la reserva actual desde móvil. Un lease que
  no pudo liberarse puede permanecer registrado, sin autorizar limpieza automática.
- Compatibilidad/riesgos: campos internos opcionales sin default/backfill,
  índices/colecciones/TTL nuevos. Más lecturas/escrituras/transacciones internas;
  medir latencia/coste. Actualizar TODOS los callers de begin y réplicas antes
  de usar la garantía; no hay endpoint/job/ejecución real o ajuste Flutter nuevo.
  Hashes originales, claves y protocolos de materialización conservados. Ni
  reserva continua ni fase terminal equivalen a corte estable/consumo/publicación.
  No cambia vencimiento/cancelación ni habilita transferencia completa.

Detalle: [ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).

### Subbloque 21: consumo único interno, sin aceptación habilitada

- Funcionalidades afectadas: preparación/observaciones internas de ficha/foto,
  diario, documentos y antecedentes. Todos los mutadores de una cabecera marcada
  como consumida quedan cerrados, incluidos replays/otra corrida. No cambia runtime
  HTTP de ficha/foto/diario/medicina/IA/BDA/polling/revisión/reemplazo/borrado/
  descargas/grupos, auth, foto usuario, catálogo o buscador.
- Anterior: observaciones terminadas sin mecanismo de consumo único y sin pin de
  contadores de preparación/planes. Nuevo: nuevas corridas fijan esos pins;
  colaborador de persistencia consume con CAS de control/cabecera/corrida DENTRO
  de una sesión/transacción del futuro commit. No inicia ni confirma una propia.
  Recibo provisional NO es canCommit, aceptación, acceso, corte estable o prueba
  de cambio de propietario. No hay llamador operativo/endpoint/worker nuevo.
- Ajustes Flutter: ninguno nuevo. Mismos endpoints/DTO/URLs/cuerpos/éxitos/errores
  públicos, incluido PUT animal primitivo; sin cambios clínicos/códigos/
  categorías/acceptedAt/48 h/nameHistory. No enviar ID de consumo, sesión, hashes,
  pins o marcadores ni crear botones para consumir/reabrir preparaciones.
- Integración/errores: mantener 400/409/500/502, datos/archivo local, polling sin
  solapamientos y consulta antes de repetir. Un error/timeout no implica rollback
  ni fin remoto. Repetir un consumo confirmado, aun con idéntico ID, es conflicto,
  nunca permiso para repetir negocio. La futura idempotencia debe consultar un
  resultado de negocio durable; no inferir transferencia desde un marcador técnico.
  El futuro llamador backend debe usar la MISMA transacción conjunta, propagar
  fallos y no hacer S3/avisos dentro de ella; no trasladar esto a lógica Flutter.
- Compatibilidad/riesgos: campos internos opcionales sin default/backfill,
  índices/colecciones/TTL nuevos. Corridas anteriores sin pipelineFence no se
  consumen ni refijan: solo nueva corrida completa explícita sobre cabecera/reserva
  válidas. Más conflictos conservadores si preparación/planes avanzan. Dependencia
  de sesión/options/cliente del driver instalado; verificar al actualizar y en
  Mongo real. Todas las réplicas deben respetar pins/marcadores. Tests con dobles,
  sin infraestructura real. No recupera tokens/reservas ni cambia cancelación/
  vencimiento. Transferencia completa y commit/retención/permisos siguen pendientes.

Detalle: [ownership-archive-evidence-consumption.md](./ownership-archive-evidence-consumption.md).

### Subbloque 22: arnés opt-in del consumo, preparado sin ejecución Mongo

- Funcionalidades afectadas: validación interna del consumo de evidencia y
  soporte compartido del arnés de escrituras. Ficha/foto, diario, documentos/IA/
  BDA/polling/revisión/reemplazo/borrado/descargas, auth/grupos/usuario, catálogo
  y buscador mantienen su comportamiento de ejecución actual.
- Ajustes frontend: ninguno. Contrato anterior y nuevo de endpoints/DTO/URLs,
  éxitos y errores es idéntico, incluido PUT animal primitivo. No se añaden
  estados o capacidades públicas; no enviar sesiones, hashes o IDs de consumo.
  `Animal.nameHistory` sigue conteniendo nombres, no propietarios.
- Contrato de desarrollo anterior: arnés Mongo opt-in del journal y pruebas de
  consumo con dobles. Nuevo: comando `test:integration:archive-evidence`, opt-in/
  URI y namespace temporales propios; prepara quince pruebas Mongo de consumo
  junto a escritura SINTÉTICA. El comando anterior mantiene su suite/lista cerrada
  de limpieza. La compilación de integración incluye ambos sin conectarse.
- Integración/errores: mantener gestión vigente de 400/409/500/502, datos/archivo
  local y polling sin solapamientos. Error/timeout no demuestra rollback o fin
  remoto. Una marca de consumo tampoco demuestra cambio de propietario; no
  habilitar aceptación, publicación o reejecución desde Flutter. Las pruebas
  preparadas no sustituyen un resultado durable/idempotencia de negocio.
- Compatibilidad/riesgos: sin cambios runtime, schemas, dependencias, migraciones
  o infraestructura de aplicación. Guardas/limpieza compartida comprobadas con
  dobles, build/compilación/regresión aprobados; NO ejecución Mongo de este arnés.
  Los recibos S3 y la escritura conjunta siguen siendo sintéticos incluso al
  ejecutarlo. Autorizar aparte un entorno local desechable y registrar resultados
  antes de afirmar validación real. No cambia recuperación, cancelación o
  vencimiento; propiedad/permisos históricos/retención/commit siguen pendientes.

Detalle: [ownership-archive-evidence-mongo-integration.md](./ownership-archive-evidence-mongo-integration.md).

### Subbloque 23: validación Mongo real y conservación exacta del snapshot

- Funcionalidades afectadas: persistencia interna de instantáneas de ficha,
  diario, documentos y antecedentes retenidos. No cambia el CRUD médico activo,
  IA/BDA/polling/revisión/reemplazo/borrado/descargas, auth/grupos/usuario,
  catálogo o buscador. La captura completa y la transferencia siguen pendientes.
- Contrato anterior: el schema de entradas podía eliminar objetos vacíos del
  payload al persistirlo, dejando su contenido distinto del contentHash calculado
  y bloqueando la planificación/revalidación con conflicto de integridad. Nuevo:
  minimize=false en OwnershipArchiveEntrySchema preserva esos objetos y el hash
  original. No se recalcula el hash ni se relaja validación o adopta contenido.
- Ajustes frontend: ninguno. Endpoints/DTO/URLs/cuerpos de éxito y errores públicos
  conservados, incluido PUT animal primitivo. El impacto es de integridad y
  compatibilidad del archivo interno, aunque el JSON HTTP no cambie. No introducir
  botones/estados de transferencia, sesiones, hashes o consumo en Flutter.
- Integración/errores: mantener gestión vigente de 400/409/500/502 y consulta
  durable antes de repetir una operación incierta; un error no prueba rollback
  ni fin remoto. Una entrada anterior que ya perdió contenido seguirá siendo
  rechazada: no rellenar {}, rehashéar, borrar o recrear desde Flutter. No se
  detectaron ni intervinieron datos de aplicación; un inventario/reparación
  requeriría otro protocolo y autorización. Instancias escritoras antiguas
  pueden seguir podando objetos: usar el schema corregido en todos los escritores.
- Compatibilidad/riesgos: cambio local de serialización, sin campos/índices/TTL/
  backfill/migraciones ni cambios clínicos/códigos/categorías/acceptedAt/48 h.
  nameHistory sigue siendo nombres. Dos regresiones sin conexión y quince pruebas
  Mongo reales aprobadas en replica set local de UN nodo; no prueba multinodo,
  failover/red, S3 real o commit de propiedad. Recibos S3 y escritura conjunta
  son sintéticos. No amplía recuperación ni define cancelación/vencimiento.
- Operación del ensayo: entorno temporal expresamente autorizado, treinta bases
  sintéticas de ambos intentos eliminadas y contenedor retirado; sin tocar datos
  de aplicación. La marca de consumo sigue sin ser prueba de transferencia.

Resultados y límites: [ownership-archive-evidence-mongo-validation.md](./ownership-archive-evidence-mongo-validation.md).

### Subbloque 24: candidato puro de referencias destinatarias

- Funcionalidades afectadas: cálculo interno del expediente candidato de ficha/
  foto, diario, documentos y antecedentes. No se conecta al CRUD, polling, IA/BDA,
  revisión/reemplazo/borrado/descargas, auth/grupos/usuario, catálogo o buscador.
- Contrato anterior: planes/intenciones/registros verificables, sin transformar
  snapshots en candidato destinatario. Nuevo: función pura valida el conjunto
  completo y clona payloads, aplicando referencias generacionales efectivas y
  ownerId del destinatario solo a recursos vigentes que ya lo tienen. Antecedentes
  mantienen dueño/procedencia/modo de solo lectura. No cambia datos persistidos.
- Ajustes frontend: ninguno. Endpoints/DTO/URLs/cuerpos de éxito y errores siguen
  iguales, incluido PUT animal primitivo. No enviar estos payloads a los CRUD ni
  usar ownerId del candidato como permiso o transferencia realizada. No enviar
  codecs, hashes, sesiones o IDs de registros técnicos desde Flutter.
- Integración/errores: siguen 400/409/500/502 y gestión vigente de polling sin
  solapamientos, datos/archivo local y consulta durable antes de repetir. Los
  conflictos de integridad/codecs de esta función no crean un contrato HTTP nuevo:
  no tiene llamador operativo. Un error no prueba rollback/fin remoto. Un hash
  de proyección o registro PREPARED no autoriza activar o publicar referencias.
- Compatibilidad/riesgos: sin cambios runtime existente, schemas/índices/TTL/
  backfill/dependencias; no interpreta clínica ni altera código/categoría/
  extracción/acceptedAt/48 h/nameHistory (nombres). El candidato contiene datos
  privados y URLs completas: no devolverlo como DTO, persistirlo en bitácora o
  loguearlo. No es un documento Mongo único para todo el expediente.
- La función comprueba datos locales, no control/período/sesión o vigencia S3.
  Codecs backend puros/de confianza; futuros llamadores deben leer/revalidar bajo
  protocolo transaccional y hacer commit conjunto. Tests sintéticos, sin Mongo/
  S3 real en este bloque; no atribuirle las quince pruebas anteriores del consumo.
  Transferencia, permisos/retención/corte estable y reglas pendientes siguen abiertos.

Detalle: [ownership-archive-recipient-projection.md](./ownership-archive-recipient-projection.md).

### Subbloque 25: lectura interna de proyección en snapshot del llamador

- Funcionalidades afectadas: lectura interna del conjunto preparado de ficha/
  foto, diario, documentos y antecedentes. No se conecta a CRUD, polling, IA/BDA,
  revisión/reemplazo/borrado/descargas, auth/grupos/usuario, catálogo o buscador.
- Anterior: proyección pura desde listas ofrecidas por un llamador. Nuevo:
  OwnershipArchiveProjectionRead lee datos en una sesión/transacción snapshot/
  primary/majority ajena, valida reserva/período/fences/evidencia terminal y
  reconstruye digests antes de devolver candidato y selección releída. No consume,
  incrementa revisiones o escribe negocio. El consumo anterior conserva su contrato.
- Ajustes Flutter: ninguno. Endpoints/DTO/URLs/cuerpos/éxitos/errores públicos
  conservados, incluido PUT animal primitivo. No enviar selección/hash/sesión,
  codecs o candidatos a los CRUD. No mostrar transferencia realizada desde un
  candidato, un hash o registros PREPARED.
- Integración/errores: mantener 400/409/500/502 y gestión vigente de polling,
  datos/archivo local y consulta durable antes de repetir. La nueva llamada no
  tiene endpoint ni contrato HTTP. Un fallo intenta abortar la transacción
  validada completa del llamador, sin ocultar su causa; no demuestra rollback o
  fin remoto. No reejecutar negocio por error/timeout o una respuesta incierta.
- Compatibilidad/riesgos: las lecturas son coherentes con SU snapshot; pueden
  no ver un competidor ya confirmado después de fijarlo. El futuro backend debe
  consumir evidencia y hacer todas las escrituras en la MISMA transacción para
  competir por el control; releer en el mismo snapshot no prueba estado último.
  No trasladar esas comprobaciones a Flutter ni cachear como permiso el candidato.
- Sin cambios de schemas/índices/TTL/backfill/dependencias, clínica/IA/BDA/códigos/
  categorías/extracción/acceptedAt/48 h/nameHistory. Payloads/URLs privados solo
  en memoria, sin log/journal/DTO. Páginas acotadas, conjunto completo en memoria.
  Tests con dobles; no Mongo/S3 reales en este bloque. Transferencia deshabilitada,
  corte estable/permisos/retención/commit y reglas pendientes siguen abiertos.

Detalle: [ownership-archive-projection-read.md](./ownership-archive-projection-read.md).

### Subbloque 26: arnés opt-in preparado para lectura y consumo conjuntos

- Funcionalidades afectadas: validación interna del lector/proyector/consumo y
  soporte compartido de tests. Ficha/foto, diario, documentos/IA/BDA/polling/
  revisión/reemplazo/borrado/descargas, auth/grupos/usuario, catálogo/buscador
  mantienen su comportamiento de ejecución actual.
- Anterior: lector con pruebas simuladas; arnés Mongo de consumo separado. Nuevo:
  comando test:integration:archive-projection, configuración y opt-in/URI propios,
  con veinte escenarios Mongo preparados de lectura + consumo/insert sintético.
  Los comandos anteriores conservan sus suites, prefijo/marker/allowlist. La
  siembra compartida amplía datos sintéticos/paginación, no el runtime de negocio.
- Ajustes Flutter: ninguno. Contrato anterior/nuevo de HTTP/DTO/URLs/cuerpos/
  éxitos/errores idéntico, incluido PUT animal primitivo. No añade campos públicos,
  estados, botones o permisos de transferencia ni un nuevo recibo de negocio.
- Integración/errores: mantener 400/409/500/502, datos/archivo local y polling sin
  solapamientos; consulta durable antes de repetir una operación incierta. Una
  lectura snapshot puede conservar datos antiguos y no concede un lock. Las
  pruebas preparadas no prueban transferencia realizada, rollback real de negocio
  o fin remoto; un error/timeout tampoco lo demuestra.
- Compatibilidad/riesgos: sin schemas/índices/TTL/backfill/dependencias o cambios
  clínicos/códigos/categorías/extracción/acceptedAt/48 h/nameHistory (nombres).
  Diecinueve guardas nuevas sin conexión y compilación aprobadas; veinte escenarios
  Mongo NO ejecutados. Datos, recibos S3 e insert de negocio sintéticos; no usar
  su projectionHash como contrato/idempotencia de aplicación. El futuro commit
  aún debe consumir/aplicar todo junto y garantizar permisos/retención/corte S3.
- Nuevo opt-in separado: autorizaciones/variables de los arneses previos no lo
  activan. Ejecución real requiere autorizar aparte el entorno desechable y
  registrar resultados/limpieza. Transferencia y decisiones pendientes intactas.

Detalle: [ownership-archive-projection-mongo-integration.md](./ownership-archive-projection-mongo-integration.md).

### Subbloque 27: validación real de lectura y consumo, sin habilitación pública

- Funcionalidades afectadas: evidencia de validación interna del lector/proyector/
  consumo. Sin código de aplicación, pruebas, schemas o fixtures modificados.
  Ficha/foto, diario, documentos/IA/BDA/polling/revisión/reemplazo/borrado/descargas,
  auth/grupos/usuario, catálogo/buscador mantienen comportamiento existente.
- Anterior: lector probado con dobles y veinte escenarios Mongo preparados.
  Nuevo: veinte casos reales aprobados en replica set local de UN miembro y dos
  clientes del mismo Jest; incluye lectura/consumo/insert sintético conjuntos,
  datos antiguos en snapshot, consumidores/fences competidores y rollback local.
  HTTP/DTO/URLs/cuerpos/éxitos/errores idénticos, incluido PUT animal primitivo.
- Ajustes Flutter: ninguno. No activar botones/rutas de transferencia ni usar
  candidato/hash/registro PREPARED como prueba de traspaso o permiso. La prueba
  real confirmó que un snapshot antiguo todavía puede devolver candidato y
  confirmar SOLO lecturas: no supone vigencia del estado último.
- Integración/errores: conservar 400/409/500/502, datos/archivo local, polling sin
  solapamientos y consulta durable antes de repetir ante incertidumbre. Consumo y
  TODAS las escrituras futuras deben compartir transacción para competir por el
  control; un error/timeout no prueba rollback o fin de efectos remotos.
- Compatibilidad/riesgos: sin cambios clínicos/IA/BDA/códigos/categorías/
  extracción/acceptedAt/48 h/nameHistory (nombres), dependencias o migraciones.
  S3 e insert {_id, projectionHash} siguen siendo sintéticos; no acreditan
  propiedad/períodos/eventos/referencias aplicados ni idempotencia de negocio.
  Un nodo no prueba multinodo/failover/red/IAM/retención/corte estable S3.
- Entorno temporal expresamente autorizado, veinte bases sintéticas eliminadas
  y contenedor retirado por identidad verificada. Sin datos de aplicación o S3/AWS
  reales. Transferencia completa y reglas de cancelación/vencimiento pendientes.

Resultados: [ownership-archive-projection-mongo-validation.md](./ownership-archive-projection-mongo-validation.md).

### Subbloque 28: auditoría de efectos remotos, sin cambio de ejecución

- Funcionalidades afectadas por los hallazgos: ficha/foto, diario/adjuntos,
  ingreso/IA/BDA/polling/revisión/reemplazo/eliminación médica, copias históricas,
  staging, finales generacionales, limpieza y soporte de recuperación interna.
- Ajustes Flutter: ninguno en este bloque documental. Contrato anterior y nuevo
  de HTTP/DTO/URLs/éxitos/errores idéntico, incluido PUT animal primitivo. Cambia
  la documentación de límites; no se publica un contrato de corte estable.
- Integración y errores: mantener 400/409/500/502, archivo/datos locales y polling
  sin solapamientos. Consultar estado durable antes de repetir ante incertidumbre;
  no añadir reintentos de negocio, botones de recuperación o permisos de traspaso
  basados en ausencia de token, MAY_RUN, LOCALLY_FINISHED, FAILED o URL vencida.
  Error no prueba rollback; descarte clínico no prueba cancelación BDA.
- Compatibilidad y riesgos: copias médico/histórico/staging no tienen todas las
  protecciones de la materialización generacional; limpieza puede ocultar errores
  individuales y existen ventanas entre inicio BDA y persistencia del ARN. Son
  hallazgos del comportamiento actual, no regresiones introducidas ni fallos reales
  reproducidos. El fence Mongo no detiene solicitudes AWS ya enviadas.
- La propuesta de intención/evidencia por efecto, aislamiento y retención está
  pendiente de implementar; no usar sus conceptos como estados públicos. Próximo
  lector de journals también será interno y no acreditará cierre S3. No cambian
  contenido clínico/códigos/48 h/nameHistory (nombres), auth, catálogo o buscador.
  Transferencia completa deshabilitada; vencimiento/cancelación sin definir.

Matriz, carreras y propuesta:
[animal-transfer-stable-s3-cut.md](./animal-transfer-stable-s3-cut.md).

### Subbloque 29: consulta interna de journals, sin integración pública

- Funcionalidades afectadas: soporte de observación de escrituras de ficha/foto,
  diario/adjuntos y documentos médicos ya coordinadas. Antes solo se consultaba
  journal por ID y controles con claims/lock; ahora existe lector interno paginado
  por animal, incluidos journals terminales sin tokens. No se invoca desde HTTP,
  CRUD, polling, coordinador o arranque; las escrituras existentes no cambian.
- Ajustes Flutter: ninguno. Contratos anterior/nuevo de endpoints/DTO/URLs/éxitos/
  errores idénticos, incluido PUT animal primitivo. No exponer operationId,
  instanceId, estados, coverage o cursor en la UI ni tratarlos como idempotencia
  del cliente, recuperación o prueba de transferencia realizada.
- Contrato interno nuevo: animal/cursor UUID, default 20 y máximo 50; solo claim
  del animal solicitado, sin actor/otros animales/auditoría/URLs/payload clínico.
  coverage INCOMPLETE y remoteEffects NOT_ASSESSED aun al terminar paginación.
  Protocolo/versión legacy ausentes se mantienen ausentes, sin atribuir garantía.
- Integración/errores: futuro caller debe autenticar/autorizar al operador. Entradas
  inválidas, páginas inconsistentes, timeout y fallo de consulta se rechazan;
  nunca sustituirlos por inventario vacío. No unir páginas/control como snapshot
  global ni inferir fin por ausencia de resultado, fechas, MAY_RUN o cierre local.
  Mantener manejo HTTP 400/409/500/502, datos locales y consulta durable previa a
  repetir operaciones inciertas; sin nuevos reintentos automáticos de negocio.
- Compatibilidad/riesgos: sin índices o migraciones ejecutados/declarados nuevos;
  índice recomendado pendiente de evaluación operativa. Consulta interna acotada
  por resultados y maxTimeMS de servidor, sin garantía de coste/red total o lectura
  completa bajo concurrencia. No modifica claims/reservas/journals ni añade fence.
  No cambia auth, catálogo/buscador, clínica/extracción/códigos/48 h/nameHistory
  (nombres), reglas de recuperación o permisos. Transferencia deshabilitada;
  decisiones de vencimiento/cancelación pendientes. No hubo Mongo/S3/AWS real.

Contrato y límites: [animal-write-journal-inventory.md](./animal-write-journal-inventory.md).

### Subbloque 30: modelo puro de intención/autorización de promociones

- Funcionalidades afectadas: especificación interna de promociones ordinarias de
  foto y adjuntos del diario. Se revisaron controllers, casos de uso, confirmación,
  adaptador S3 y su caller compartido de migración legacy. Ninguno se conecta al
  modelo nuevo; no cambia su ejecución, latencia, errores o recuperación actual.
- Contrato anterior: journal de callback y promoción condicional sin evidencia por
  intento físico. Nuevo en dominio: modelo puro separado, con operación/efecto/
  intento/autorización, bucket/origen/destino fijados, puerta OPEN→REVOKED y CAS
  por revisión. Respuestas UNKNOWN/ACKNOWLEDGED y observaciones MATCH/ABSENT/
  CONFLICT se agregan sin eliminar incertidumbre de otros intentos autorizados.
  No es persistencia, ledger remoto completo ni autorizador de corte estable.
- Ajustes Flutter: ninguno. Contratos anterior/nuevo de HTTP/DTO/URLs/cuerpos/
  éxitos/errores conservados, incluido PUT animal primitivo. No enviar bucket,
  IDs, revisiones, comandos, hashes o referencias técnicas desde el cliente, ni
  mostrar puerta/observaciones como aceptación o permiso de transferencia.
- Integración/manejo de errores: el futuro adaptador debe obtener un permiso
  durable nuevo por cada envío físico, incluidos retries SDK, en competencia con
  revocación. Un permiso encontrado tras respuesta perdida no autoriza reenviar.
  Si ganó antes de revocar, puede haber envío tardío: requiere evidencia/aislamiento
  posterior, nunca desbloqueo por edad/error/HEAD ausente. Esto es contrato backend
  pendiente de integrar; no añade nuevos reintentos de negocio en Flutter.
- Mantener manejo HTTP vigente de 400/409/500/502, datos locales, polling sin
  solapamientos y consulta antes de repetir ante incertidumbre. El modelo no
  modifica journal/MAY_RUN/LOCALLY_FINISHED, tokens, reservas, tickets/sellos o
  borrado de fotos/diario, ni activa recuperación de callbacks posibles.
- Compatibilidad/riesgos: sin providers, puertos/adaptadores de persistencia,
  schemas/índices/TTL/backfill/dependencias o dispatch nuevos. Migración legacy,
  emisión/PUT, borrados, histórico/staging, materialización y medicina/BDA quedan
  fuera de la cobertura de este modelo. Tests puros y store CAS simulado; no
  prueban persistencia, retries reales del SDK, IAM/lifecycle/retención o fin S3.
  Auth, catálogo/buscador, clínica/extracción/códigos/48 h y nameHistory (nombres)
  intactos. Guarda inicial/V1 conservadas; transferencia completa deshabilitada,
  vencimiento/cancelación y demás decisiones abiertas sin reglas nuevas.

Contrato, persistencia pendiente y carreras:
[animal-media-promotion-effects.md](./animal-media-promotion-effects.md).

### Subbloque 31: persistencia interna de permisos de promoción

- Funcionalidades afectadas: soporte interno de promociones ordinarias foto/diario
  y schema técnico de journals/controles. Se añade persistencia de puerta, efectos,
  intentos, respuestas y observaciones en filas separadas; no se conecta a handlers,
  AnimalMediaUploads, migración legacy, polling o adaptadores AWS existentes.
- Anterior: modelo puro sin persistencia. Nuevo: puerto y adaptador transaccional
  snapshot/primary/majority, CAS común de puerta y fences escritos en journal/control
  antes de nuevos permisos. Revocar sin puerta crea tombstone irreversible;
  revocar con puerta exige revisión. Ninguna acción retira tokens o altera reservas,
  resultados del callback o negocio. Un permiso previo conserva riesgo remoto.
- Ajustes Flutter: ninguno. Contratos anterior/nuevo de HTTP/DTO/cuerpos/URLs/
  éxitos/errores idénticos, incluido PUT animal primitivo. Sin estados, botones o
  autorización nueva de transferencia. No enviar revisiones, dispatcherInstanceId,
  IDs de efecto/intento/permiso/auditoría, bucket o evidencia desde la app.
- Integración/errores: el nuevo puerto es interno y exige futuro caller autorizado;
  IDs de operador son auditoría, no permisos. Fallos de query, datos corruptos,
  CAS obsoleto, cierre de callback/claim o índice único provocan error, sin falso
  vacío ni reapertura. Tras acknowledgement incierto se consultan los mismos IDs;
  encontrar una autorización no permite reenviarla. Sin dispatch en este bloque.
  Se mantienen 400/409/500/502, edición/archivo local, consulta antes de repetir y
  polling sin solapamientos en los flujos HTTP actuales; no cambian sus latencias.
- Compatibilidad/riesgos: nueva colección/índices DECLARADOS, no creados. El módulo
  opt-in está fuera del grafo actual y el schema desactiva autoCreate/autoIndex.
  Campos mediaPromotionRevision opcionales en schemas existentes, sin defaults,
  backfill o nuevos índices allí. No añade conexiones/consultas al arranque.
  El journal requiere también mediaPromotionProtocol opcional declarado AL CREARLO;
  el coordinador actual no lo emite. Un journal anterior sin marca se rechaza,
  aunque tenga MAY_RUN/claim, sin añadirle la marca o adoptar su operación.
  No enviar estos campos desde Flutter; no cambia creación HTTP de animales.
  Antes de integrarlo: validar infraestructura/índices y rollout completo; versiones
  antiguas/callers actuales no respetan esta puerta ni ganan sus garantías.
- Pruebas con store optimista/sesiones simulados y Mongoose desconectado: no
  acreditan Mongo/índices/majority/failover reales, retries SDK, retención o fin S3.
  No modifica medicina/IA/BDA/clínica/códigos/acceptedAt/48 h/nameHistory (nombres),
  permisos públicos, auth/catálogos/buscador, recuperación previa al callback,
  guarda inicial o V1. Transferencia completa deshabilitada; vencimiento/cancelación
  y demás decisiones funcionales abiertas permanecen pendientes.

Contrato, límites y validación:
[animal-media-promotion-persistence.md](./animal-media-promotion-persistence.md).

### Subbloque 32: arnés opt-in de persistencia de promociones

- Funcionalidad afectada: validación interna de promociones foto/diario y comandos
  de desarrollo. Antes: modelo/persistencia comprobados con dobles. Ahora: arnés
  aislado con 26 escenarios Mongo preparados, compilados y pendientes de ejecución;
  36 guardas nuevas sin conexión aprobadas. No se integra al runtime actual.
- Ajustes Flutter: ninguno. Contratos anterior/nuevo de HTTP, DTO, URLs, errores
  y cuerpos exitosos conservados, especialmente PUT animal primitivo. No agregar
  botones, estados, IDs técnicos, revisiones u opt-ins a la app. Foto/diario siguen
  sus flujos actuales y no obtienen una garantía nueva de cierre remoto.
- Integración/errores: nuevo comando exige opt-in/URI propios y entorno autorizado;
  rechaza antes de conectar al faltar configuración. Su futura ejecución usa dos
  clientes, índices explícitos y base aleatoria por caso. Limpieza verifica nombre,
  marker y lista cerrada; falla y reporta ante inconsistencias, sin ampliar alcance.
  No oculta fallos como vacío, recupera tokens, reabre puertas o reenvía permisos.
- Compatibilidad/riesgos: ningún src/schema/módulo/dependencia de producción
  modificado; sin consultas/latencias nuevas al arranque, CRUD o polling. npm test
  excluye integración Mongo y los comandos anteriores conservan su alcance.
  El soporte nuevo puede crear/borrar SU base desechable al ejecutarlo: esa capacidad
  requiere autorización específica y no se deduce de que el JSON siga igual.
  No hubo operaciones reales Mongo/S3/AWS/Docker. Compilar no valida índices,
  carreras Mongo, failover, SDK o S3; los recibos/pins siguen sintéticos.
- Objetivo aprobado de histórico exacto/copia independiente intacto. Sin cambios
  de medicina/IA, recuperación, nameHistory (nombres), guarda inicial/V1, reglas
  pendientes o transferencia habilitada. Siguiente: ejecución real autorizada
  y documentada, antes del enlace a callers y dispatch por intento.

Alcance y evidencia: [animal-media-promotion-mongo-integration.md](./animal-media-promotion-mongo-integration.md).

### Preparación del ensayo posterior al subbloque 32

- Funcionalidad afectada: documentación operativa de validación de promociones
  foto/diario. Antes: arnés preparado sin entorno elegido. Ahora: procedimiento
  concreto de Docker local desechable, ejecución y limpieza pendiente de aprobación;
  revisión estática y 4 suites/95 guardas sin conexión aprobadas.
- Contrato anterior/nuevo de runtime y HTTP idéntico, incluidos cuerpos exitosos
  y PUT animal primitivo. Ajustes Flutter: ninguno; no hay código de producción,
  consultas, latencias, errores, schemas o dependencias modificados.
- Integración/errores: mantener gestión HTTP y consulta durable ante incertidumbre.
  Las variables del ensayo son de desarrollo, no del cliente ni del despliegue.
  La propuesta no integra callers/dispatch ni convierte permisos en reenvíos.
- Compatibilidad/riesgos: ejecutar y limpiar exige autorización específica del
  contenedor/replica set propuestos. El mongod ya existente en 27017 está excluido;
  disponibilidad de imagen/motor/puerto debe revalidarse. Los 26 casos Mongo siguen
  sin ejecutar. Ni las guardas aprobadas ni el futuro ensayo de un nodo demuestran
  cierre S3, SDK instrumentado o transferencia completa. Objetivo aprobado,
  nameHistory (nombres), guarda inicial/V1 y decisiones pendientes conservados.

Procedimiento y límites: [animal-media-promotion-mongo-runbook.md](./animal-media-promotion-mongo-runbook.md).

### Subbloque 33: validación Mongo real de promociones

- Funcionalidad afectada: validación interna de persistencia de promociones
  foto/diario. Antes: arnés preparado; ahora: 26/26 escenarios aprobados en
  replica set local de un miembro, tras autorización. Producción sin cambios.
- Contrato anterior/nuevo de HTTP/DTO/URLs/cuerpos/éxitos/errores idéntico,
  incluido PUT animal primitivo. Ajustes Flutter: ninguno; sin nuevas consultas,
  latencias, endpoints, estados o permisos. El módulo continúa fuera del grafo.
- Integración/errores: corregida solo la clase de error esperada en un test
  después de que el driver reintente contra callback THREW; la guarda existente
  sigue denegando el permiso. Mantener gestión HTTP y consulta durable ante
  incertidumbre, sin reenvío por encontrar permisos ni nuevos retries móviles.
- Compatibilidad/riesgos: índices creados solo en bases sintéticas autorizadas;
  52 bases de dos intentos y contenedor eliminados. Sin migración de aplicación,
  cambios de schemas o dependencias. Ensayo no acredita failover, SDK instrumentado,
  cierre remoto, retención, corte estable o commit de negocio. Pins/recibos S3 y
  SDK_RETRY sintéticos; respuesta perdida posterior al commit reconocido.
- Objetivo de copia exacta/independiente, nameHistory (nombres), guarda inicial/V1,
  recuperación previa al permiso y reglas abiertas intactos. Transferencia completa
  deshabilitada; siguiente enlace a callers/verificación de transporte es backend.

Evidencia y límites: [animal-media-promotion-mongo-validation.md](./animal-media-promotion-mongo-validation.md).

### Subbloque 34: identidad interna en confirmaciones foto/diario

- Funcionalidades afectadas: PATCH foto y POST adjunto (también reconfirmación
  idéntica), su coordinador y servicios de confirmación. Antes el callback no
  recibía identidad. Ahora recibe operación/instancia/animal/dueño/versión/kind
  internos e inmutables tras adquisición/permiso reconocidos; el journal declara
  MEDIA_PROMOTION_ROWS_V1 desde create inicial. Los demás callbacks siguen sin
  argumentos y journals anteriores no se retromarcan ni adoptan.
- Contrato HTTP anterior/nuevo: mismos DTO, URLs y cuerpos exitosos, incluidos
  foto `{ success, profilePictureUrl }`, entrada del diario y PUT animal primitivo.
  Ajustes Flutter: ninguno. No enviar contexto, opt-in, versiones o IDs técnicos;
  whitelist sigue rechazando campos adicionales. No se exponen en respuestas.
- Integración/errores: un scope interno inválido falla antes de confirmar medios
  o persistir negocio, con InvalidArgumentError existente. Es una protección de
  wiring backend, no una autorización móvil o error de transferencia nuevo.
  Mantener manejo vigente de 400/409/500/502, datos locales, polling sin solapar y
  consulta durable antes de repetir ante incertidumbre. Fallos previos al permiso
  reconocido no invocan el callback; los éxitos posteriores conservan su contrato.
- Compatibilidad y riesgos: validaciones locales y campo opcional existente del
  journal, sin consultas, schemas/índices, migraciones o latencias remotas nuevas.
  Direct callers sin contexto siguen compatibles: no existe cobertura cerrada.
  La marca puede acompañar fallback sin ticket, legacy o ticket ya sellado porque
  se crea antes de leer el ticket; no implica efecto, autorización o envío cubierto.
  LegacyAnimalMediaCopier conserva su reserva/trabajo, sin atribución HTTP.
- No se conecta persistencia/dispatch ni se instrumenta SDK. Las promociones y
  borrados vigentes siguen su protocolo anterior; tickets/sellado concurrentes,
  todos los envíos/retries y cierre/retención S3 quedan pendientes. Contexto no
  concede permisos de envío ni demuestra fence actual/rollback. coverage/remoteEffects
  conservan INCOMPLETE/NOT_ASSESSED. Objetivo exacto/independiente, guarda inicial/V1,
  nameHistory (nombres), recuperación previa y reglas abiertas intactos.
  Transferencia completa deshabilitada.

Contrato y siguiente paso: [animal-media-confirmation-context.md](./animal-media-confirmation-context.md).

### Subbloque 35: ensayo del transporte SDK sin red

- Funcionalidad afectada: validación técnica de promociones foto/diario, cliente
  S3/middleware/retries. Antes se modelaban retries como filas; ahora 28 casos
  ejecutan el SDK instalado con handler/peticiones nativas falsos y cero sockets.
  No se modifica src, configuración del SDK actual o grafo de módulos.
- Contratos anterior/nuevo HTTP/DTO/URLs/cuerpos/éxitos/errores idénticos, incluido
  PUT animal primitivo. Ajustes Flutter: ninguno. No enviar probes, IDs de intento,
  marcas de SDK ni interpretarlos como capacidades o estados de transferencia.
- Integración/errores: metadata.attempts y maxAttempts no cubren por sí solos
  reenvíos por redirección/middleware/handler. HTTP 200 puede contener Error o estar
  vacío y no acreditar copia. Son límites del SDK observado, no nuevos errores
  públicos introducidos. Mantener manejo vigente 400/409/500/502, datos locales y
  consulta durable ante incertidumbre; ningún error prueba rollback remoto.
- Compatibilidad/riesgos: pruebas de versiones locales/configuración explícita
  sintética; no demuestran AWS, failover, retención o corte estable. Probes de
  permiso/revocación solo en tests, sin persistencia/dispatch integrado. Un permiso
  previo conserva posibilidad de envío después de revocar. La instrumentación
  propuesta debe interceptar cada delegación y controlar el handler subyacente.
- Objetivo de copia exacta/independiente y nameHistory (nombres), guarda inicial/V1,
  recuperación previa, reglas abiertas y transferencia deshabilitada intactos.
  Siguiente wrapper interno se probará antes de conectarlo a callers existentes.

Resultados y límites: [animal-media-promotion-transport.md](./animal-media-promotion-transport.md).

### Subbloque 36: dispatcher de promoción aislado

- Funcionalidad afectada: soporte interno de promociones foto/diario. Antes:
  modelo/persistencia y ensayos de transporte separados. Nuevo: dispatcher de
  una invocación por efecto ya declarado, con request/definición fijados y permiso
  nuevo por envío/retry/redirect, probado con dobles y peticiones nativas falsas.
  No se integra con AnimalMediaUploads, controllers o SDK actuales.
- Contrato anterior/nuevo HTTP/DTO/URLs/éxitos/errores idéntico, incluido PUT
  animal primitivo. Ajustes Flutter: ninguno; sin botones, IDs técnicos o estados
  nuevos. El nuevo error interno por etapa no es un contrato HTTP publicado.
- Integración/errores: autorización/registro inciertos detienen la instancia;
  no se reenvía al encontrar un permiso. UNKNOWN no demuestra fin remoto, rollback
  o copia exitosa, incluso si hubo HTTP 200. Un permiso concedido puede enviar
  después de revocar; requiere evidencia/aislamiento posterior. Mantener manejo
  HTTP vigente, datos locales y consulta durable antes de repetir ante incertidumbre.
- Compatibilidad/riesgos: dos dependencias Smithy existentes pasan a declararse
  directas con las mismas versiones; sin actualización/descarga, schemas/índices
  o migraciones. Módulo de persistencia/dispatcher fuera del grafo; sin consultas,
  latencia o cambios en la promoción/borrado actual. App retries sobre efectos
  anteriores quedan excluidos del dispatcher nuevo; no adopta/resume intentos.
- Falta cerrar ticket/pin/sellado/concurrencia antes de integrar callers y mapear
  errores HTTP. Pruebas con CAS optimista simulado y cero sockets no demuestran
  AWS/Mongo real, retención o corte estable. Objetivo de histórico exacto/copia
  independiente, nameHistory (nombres), guarda inicial/V1 y reglas pendientes
  intactos. Transferencia completa sigue deshabilitada.

Contrato y límites: [animal-media-promotion-dispatcher.md](./animal-media-promotion-dispatcher.md).

### Subbloque 37: permiso frente a ticket sellado, soporte interno

- Funcionalidad afectada: persistencia interna de promociones foto/diario. Antes:
  declaración leía ticket en snapshot e intención/autorización no lo cercaban.
  Nuevo: los tres pasos validan pin/definición/hash y escriben CAS del ticket en
  su transacción. Sello ganador impide permiso nuevo; un permiso anterior puede
  enviarse tarde y conserva incertidumbre. No se cambia el sellado operativo.
- Contrato anterior/nuevo: HTTP/DTO/URLs/éxitos/errores públicos conservados,
  incluido PUT animal primitivo. Ajustes Flutter: ninguno en este bloque; el
  contador técnico no se publica ni debe enviarlo el cliente. Los módulos nuevos
  siguen fuera del grafo y no añaden consultas a confirmaciones actuales.
- Integración/errores: conflictos por cambio/sello/hash detienen el dispatcher
  aislado antes de un permiso nuevo. Su mapeo HTTP sigue pendiente. No repetir
  al encontrar permisos, ni interpretar error/UNKNOWN/sello como rollback o fin
  remoto. Respuestas/observaciones tardías siguen agregando evidencia.
- Compatibilidad/riesgos: campo opcional sin default, backfill, TTL o índice;
  tickets anteriores admitidos solo con pin ordinario válido y no sellado. Sin
  adopción de legacy/generaciones, cambios al algoritmo actual de pin/seal o
  exclusividad global del ticket. No protege delete/recreate ni permisos previos.
  43 pruebas nuevas con dobles; arnés Mongo ampliado a 28 casos compilados, sin
  ejecutar esta versión. Falta arnés combinado/verificación/sellado antes de callers.
- Objetivo de histórico exacto/copia independiente, nameHistory (nombres), guarda
  inicial/V1, recuperación previa y reglas pendientes conservados. Transferencia
  completa deshabilitada; sin infraestructura, migración o despliegue en este bloque.

Contrato y evidencia: [animal-media-promotion-ticket-fence.md](./animal-media-promotion-ticket-fence.md).

### Subbloque 38: preparación del ensayo Mongo + dispatcher

- Funcionalidad afectada: validación interna de promociones foto/diario. Antes:
  dispatcher/ticket probados con store simulado y arnés Mongo de persistencia
  separado. Nuevo: 21 escenarios combinados preparados/compilados, sin ejecutar
  contra Mongo, con SDK/handler reales y HTTP falso. No se integra a confirmación.
- Contrato anterior/nuevo: HTTP/DTO/URLs/éxitos/errores idénticos, incluido PUT
  animal primitivo. Flutter no requiere ajustes, IDs técnicos, botones o estados
  nuevos por este bloque. No cambia disponibilidad del final ni manejo HTTP vigente.
- Integración/errores: arnés con comando/opt-in/namespace propios; rechazo previo
  a conectar sin opt-in y guardas contra S3 real. Fallos de respuesta inyectados
  después de commit reconocido prueban incertidumbre local, no fallo de red real.
  UNKNOWN, sello o permiso leído no autorizan reenvío ni demuestran rollback/fin remoto.
- Compatibilidad/riesgos: solo soporte de pruebas/scripts, sin src/dependencias,
  módulos/schemas/índices productivos, consultas o latencia nueva en HTTP. 57 casos
  sin conexión aprobados; no confundir con los 21 casos Mongo nuevos o los 28 del
  arnés anterior. Ninguno ejecutado en este bloque. No acreditan AWS, ACK/MATCH,
  verificación/sellado, retención, estabilidad de corte o commit conjunto.
- Objetivo de copia exacta histórica/independiente, nameHistory (nombres), guarda
  inicial/V1, recuperación previa y decisiones abiertas intactos. Transferencia
  deshabilitada. Falta autorización específica del entorno local propuesto,
  resultados/limpieza reales y cerrar verificación/sellado antes de callers.

Contrato y entorno pendiente: [animal-media-promotion-dispatch-mongo-integration.md](./animal-media-promotion-dispatch-mongo-integration.md).

### Subbloque 39: validación local de persistencia/dispatcher

- Funcionalidad afectada: evidencia de pruebas de promociones foto/diario. Antes:
  28+21 casos preparados sin ejecutar contra Mongo. Nuevo: **49/49 aprobados en
  primera pasada** en replica set local autorizado de un miembro; S3/HTTP falso.
  No hay cambios de código, tests o integración a confirmaciones actuales.
- Contrato anterior/nuevo: HTTP/DTO/URLs/éxitos/errores y PUT animal primitivo
  idénticos. Flutter no requiere ajustes ni estados/IDs técnicos nuevos. No se
  habilita flujo de transferencia, histórico final o autorización OTP específica.
- Integración/errores: índices, CAS/rollback, permiso visible antes de petición
  nativa falsa y retries separados comprobados. Un permiso previo puede enviar
  tarde tras sello/revocación; UNKNOWN/HEAD/error/token ausente no autorizan
  reenvío ni prueban rollback o cierre remoto. Errores internos aún sin mapeo HTTP nuevo.
- Compatibilidad/riesgos: 49 bases temporales verificadas ausentes y contenedor
  propio retirado. No Atlas/27017 existente, AWS, migración de aplicación o despliegue.
  Ensayo de un nodo sin failover; respuestas/recibos S3 sintéticos. No demuestra
  autenticidad/copia remota, verificación/sellado de producción, retención/corte
  o commit conjunto. INCOMPLETE/NOT_ASSESSED conservados.
- Objetivo histórico exacto y copia independiente, nameHistory (nombres), guarda
  inicial/V1, recuperación previa y reglas pendientes intactos. Siguiente: contrato/
  colaborador aislado de verificación/sellado y errores antes de callers. Otra
  ejecución real exige autorización específica de su entorno.

Resultados y limpieza: [animal-media-promotion-dispatch-mongo-validation.md](./animal-media-promotion-dispatch-mongo-validation.md).

### Subbloque 40: verificación y sellado ligados al efecto, aislados

- Funcionalidad afectada: soporte interno de promoción foto/diario. Antes:
  dispatcher conserva UNKNOWN y sellado vigente no enlaza MATCH del efecto en
  su transacción. Nuevo: colaborador separado HEAD/GET condicionado/HEAD, hash y
  revisión; MATCH+sello técnicos juntos con fences actuales. No se conecta al
  dispatcher o confirmaciones vigentes. No acredita cierre remoto/transferencia.
- Contrato anterior/nuevo: HTTP/DTO/URLs/cuerpos/éxitos/errores actuales idénticos,
  incluido PUT animal primitivo. Flutter no requiere ajustes o IDs técnicos nuevos.
  observationId lo genera/conserva backend, también ante commit incierto. No
  habilitar botones/estados de transferencia por este soporte sin callers.
- Integración/errores: etapas internas READ/VERIFY/SEAL y motivos CONFLICT/
  UNAVAILABLE/UNCERTAIN sanitizados. Mapeo HTTP solo propuesto, no publicado: 409
  conflicto, 500 lectura/commit Mongo, 502 indisponibilidad S3. No repetir al
  encontrar MATCH ni inferir rollback/fin remoto de error, sello, HEAD o token
  ausente. Encontrar permiso anterior tampoco autoriza envío. Mantener datos
  locales y manejo HTTP vigente; futura integración debe documentar errores/latencia.
- Compatibilidad/riesgos: módulo/persistencia nuevos siguen fuera del grafo,
  sin provider de sellado/callers o queries HTTP adicionales. Schemas/índices/TTL/
  dependencias intactos. Sello observado no protege delete/recreate ni cambios
  posteriores; permisos anteriores conservan incertidumbre. Lector SDK simulado
  en pruebas, sin ensayo S3/Mongo del método nuevo; 49 casos del 39 son históricos.
- Objetivo de copia histórica exacta/independiente, nameHistory (nombres), guarda
  inicial/V1, recuperación previa y reglas abiertas conservados. Transferencia
  deshabilitada. Siguiente: arnés específico y ciclo/wiring/mapeo HTTP antes de callers.

Contrato y validación: [animal-media-promotion-verification.md](./animal-media-promotion-verification.md).

### Subbloque 41: preparación del ensayo de verificación/sellado

- Funcionalidad afectada: soporte de pruebas de promociones foto/diario. Antes:
  verificador/sellado con store y cliente SDK simulados. Nuevo: 23 escenarios
  Mongo+SDK/Node handler reales con transporte HEAD/GET falso preparados y compilados,
  sin ejecución Mongo. 50 guardas nuevas sin conexión aprobadas. No conecta callers.
- Contrato anterior/nuevo: HTTP/DTO/URLs/cuerpos/éxitos/errores, incluido PUT animal
  primitivo, conservados. Flutter no requiere ajustes, IDs técnicos o estados
  nuevos. Mapeo HTTP del colaborador sigue propuesto, sin publicarlo por este arnés.
- Integración/errores: comando/opt-in/namespace propios, con rechazo antes de
  conectar sin opt-in. Guion readonly deniega copias/borrados y red real S3;
  errores/revisiones/bytes sintéticos no autorizan otra copia ni prueban rollback,
  retención o cierre remoto. Encontrar MATCH/permiso no concede reenvío/traspaso.
- Compatibilidad/riesgos: solo tests/scripts/documentación; sin src/dependencias,
  módulos/schemas/índices de aplicación, queries o latencia HTTP nueva. Allowlist
  propia sin ampliar anteriores; los casos Mongo preparados no se cuentan como
  aprobados. Ensayo real requiere autorización del entorno concreto y limpieza.
- Objetivo de histórico exacto/copia independiente, nameHistory (nombres), guarda
  inicial/V1, recuperación previa y decisiones abiertas intactos. Transferencia
  deshabilitada. Siguiente: validar ensayo y ciclo/wiring/mapeo HTTP antes de callers.

Contrato y entorno pendiente: [animal-media-promotion-seal-mongo-integration.md](./animal-media-promotion-seal-mongo-integration.md).
