# Transferencias: contrato disponible del primer bloque

Estado: permisos, catálogo, buscador, periodos/lock y preparación interna de
instantáneas/copias implementados. Todavía no se crean ni aceptan transferencias
y no hay OTP específico, histórico consultable/copias activadas o push.

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
