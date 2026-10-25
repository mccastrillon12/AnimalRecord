# Transferencias: contrato disponible del primer bloque

Estado: permisos, catálogo, buscador y base interna de periodos/lock
implementados. Todavía no se crean ni aceptan transferencias y no hay OTP
específico, archivo histórico/copia S3 o push implementado.

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

La secuencia completa y las tareas pendientes están en
`animal-transfer-strategy.md` y `final-delivery-plan.md`.
