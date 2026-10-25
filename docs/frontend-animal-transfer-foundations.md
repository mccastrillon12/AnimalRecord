# Transferencias: contrato disponible del primer bloque

Estado: permisos, catálogo y buscador implementados. Todavía no se crean ni
aceptan transferencias y no hay OTP específico, histórico o push implementado.

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

La secuencia completa y las tareas pendientes están en
`animal-transfer-strategy.md` y `final-delivery-plan.md`.
