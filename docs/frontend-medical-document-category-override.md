# Instructivo frontend: categoria final independiente de la extraccion

## Objetivo

Esta guia debe entregarse a la persona o IA que implemente el flujo de
documentos medicos en el frontend de AnimalRecord.

El usuario puede archivar un documento bajo cualquier categoria valida, aunque
la IA haya detectado y estructurado otra. Cambiar la categoria final no vuelve a
ejecutar la IA, no convierte campos y no elimina la informacion revisada.

Ejemplo soportado:

```text
IA detecta y extrae: CLINICAL_HISTORY
Usuario archiva como: VACCINATION_CARD
```

El archivo se consulta y almacena como `VACCINATION_CARD`, mientras sus datos
siguen teniendo el contrato `CLINICAL_HISTORY`.

## Instruccion de ejecucion para la IA del frontend

Antes de modificar codigo:

1. Inspeccionar el cliente HTTP, modelos, serializacion, estado de revision,
   selector de categoria, formularios, vistas de documentos aceptados y
   pruebas existentes.
2. Identificar cualquier lugar que asuma que `finalCategory`,
   `primaryDetectedCategory` y `validatedExtraction.documentType` siempre son
   iguales.
3. Reutilizar la arquitectura, gestion de estado y componentes actuales.
4. Implementar toda la secuencia descrita aqui; no limitarse a cambiar un
   modelo o retirar una validacion local.
5. No modificar el flujo de carga o polling, ni agregar una llamada para volver
   a analizar el archivo.

## Tres conceptos independientes

### Deteccion de IA

```text
primaryDetectedCategory
detectedCategories
classificationOutcome
```

Son resultados inmutables del analisis. Nunca se modifican cuando el usuario
cambia la categoria final.

### Categoria final de archivo

```text
finalCategory
```

Es la decision del usuario. Controla:

- Seccion de la aplicacion donde aparece el documento.
- Filtro utilizado para consultarlo.
- Carpeta final en S3.
- Codigo consecutivo, cuando la categoria lo soporta.
- Etiqueta principal de la tarjeta o detalle.

### Categoria estructural del contenido

```text
validatedExtraction.documentType
```

Describe el contrato de los datos aprobados. Controla:

- Campos permitidos dentro de la extraccion.
- Formulario utilizado para revisarla.
- Catalogo de etiquetas utilizado para presentarla.
- Secciones, tablas y columnas visibles.

Puede ser diferente de `finalCategory`.

## Estado recomendado

Adaptar los nombres al patron de estado existente. Como minimo se necesitan dos
selecciones independientes:

```dart
class MedicalDocumentReviewState {
  final MedicalDocumentResponse remoteDocument;

  // Decide donde se guarda y aparece el documento.
  final MedicalDocumentCategory selectedFinalCategory;

  // Decide que extraccion se esta revisando.
  final MedicalDocumentCategory selectedExtractionCategory;

  // Copia editable de una extraccion recibida del backend.
  final Map<String, dynamic> draftExtraction;
}
```

No derivar una propiedad de la otra y no implementar un setter que cambie las
dos simultaneamente.

## Inicializacion de la revision

Elegir la categoria estructural inicial en este orden:

1. `primaryDetectedCategory`, si tiene una entrada en
   `extractionsByCategory`.
2. La primera categoria de `detectedCategories` que tenga extraccion.
3. `OTHER`, si existe.
4. La primera clave disponible de `extractionsByCategory`.

Crear `draftExtraction` mediante una copia profunda de:

```text
extractionsByCategory[selectedExtractionCategory]
```

Inicializar `selectedFinalCategory` con la sugerencia visual vigente de la
aplicacion. Normalmente sera `primaryDetectedCategory`, pero el usuario siempre
puede cambiarla.

## Cambio de categoria final

Cuando el usuario cambia `selectedFinalCategory`:

- No modificar `primaryDetectedCategory`.
- No modificar `detectedCategories`.
- No modificar `classificationOutcome`.
- No cambiar `draftExtraction.documentType`.
- No eliminar campos del borrador.
- No mapear `clinicalHistory` a `vaccinations`, `medications` u otra seccion.
- No volver a subir el archivo.
- No iniciar un nuevo analisis.

Si existe `extractionsByCategory[selectedFinalCategory]`, se puede ofrecer una
accion separada como "Usar los datos extraidos para esta categoria". Solo al
confirmarla se reemplazan `selectedExtractionCategory` y `draftExtraction` con
una copia profunda de esa extraccion. Cambiar la categoria de archivo por si
solo nunca cambia el contenido.

## Solicitud de aceptacion

Se usa el endpoint existente:

```http
PUT /medical-documents/{documentId}/review
Content-Type: application/json
Authorization: Bearer <token>
```

Ejemplo: la IA produjo una historia clinica y el usuario la archiva como carnet
de vacunacion:

```json
{
  "decision": "ACCEPT",
  "documentVersion": 1,
  "finalCategory": "VACCINATION_CARD",
  "validatedExtraction": {
    "documentType": "CLINICAL_HISTORY",
    "summary": "Historia clinica veterinaria",
    "patient": {
      "name": "Luna"
    },
    "patientHints": [],
    "diagnoses": [
      {
        "id": "diagnosis-1",
        "name": "Diagnostico escrito en el documento"
      }
    ],
    "medications": [],
    "vaccinations": [],
    "medicalOrders": [],
    "clinicalHistory": {
      "reasonForConsultation": "Control general"
    },
    "additionalFields": {},
    "warnings": []
  },
  "assignments": [
    {
      "animalId": "UUID-DEL-ANIMAL",
      "extractedItemIds": ["diagnosis-1"]
    }
  ]
}
```

No reemplazar `validatedExtraction.documentType` por `VACCINATION_CARD`. La
extraccion sigue siendo una historia y debe conservar esa estructura.

## Validaciones antes de enviar

- `documentVersion` debe ser la ultima version recibida.
- `finalCategory` debe contener `selectedFinalCategory`.
- `validatedExtraction` debe ser el borrador actual completo, no un patch.
- Sus secciones deben corresponder a
  `validatedExtraction.documentType`.
- Debe existir exactamente una asignacion por cada animal original.
- Una asignacion sin items se envia con `extractedItemIds: []`.
- Cada ID asignado debe existir dentro de la extraccion enviada.
- Los IDs deben ser unicos entre todas las colecciones de items.
- Las claves JSON permanecen en ingles; las etiquetas en espanol pertenecen
  solo a la presentacion.

El backend ya no debe responder `400` solamente porque `finalCategory` y
`validatedExtraction.documentType` sean diferentes. Todavia responde `400` si
la extraccion es internamente invalida, mezcla contratos o contiene
asignaciones incorrectas.

## Respuesta aceptada y consultas

Para listar una seccion se filtra siempre por la categoria elegida por el
usuario:

```http
GET /animals/{animalId}/medical-documents?category=VACCINATION_CARD
```

El backend filtra por `finalCategory`. No descargar todos los documentos para
filtrarlos localmente.

En tarjetas y encabezados:

```text
Usar finalCategory
```

En el detalle de los datos:

```text
Usar validatedExtraction.documentType
```

Para solicitar etiquetas en espanol:

```http
GET /medical-documents/field-catalog?category={validatedExtraction.documentType}&locale=es-CO
```

No solicitar el catalogo con `finalCategory` cuando ambas categorias sean
diferentes, porque ocultaria los campos reales de la extraccion.

Ejemplo visual recomendado:

```text
Carne de vacunacion
Categoria elegida por el usuario

Contenido extraido como: Historia clinica
```

El segundo texto es importante para que la decision de archivo no se presente
como una nueva deteccion de IA.

## Consecuencias que el frontend no debe inferir

Un documento archivado como `VACCINATION_CARD` no necesariamente contiene
`vaccinations[]`. Del mismo modo:

- No crear vacunas o recordatorios si el contenido estructural es otra
  categoria.
- No crear medicamentos porque `finalCategory` sea `PRESCRIPTION`.
- No crear resultados porque se archive como `LABORATORY_RESULT`.
- No interpretar pixeles porque se archive como `DIAGNOSTIC_IMAGE`.
- No cambiar el contenido para que coincida visualmente con la carpeta.

Las funcionalidades clinicas futuras deben revisar los datos realmente
presentes y su contrato, no deducirlos solamente de `finalCategory`.

## Compatibilidad

Los documentos aceptados antes de este cambio normalmente tienen:

```text
finalCategory == validatedExtraction.documentType
```

Siguen funcionando sin migracion. El frontend debe soportar tanto coincidencias
como diferencias.

No cambia:

- El endpoint de carga.
- El polling.
- El formato de `ReviewMedicalDocumentDto`.
- El endpoint de consulta por animal.
- El endpoint del catalogo.

Solo cambia la suposicion de igualdad entre las dos categorias.

## Pruebas obligatorias del frontend

1. IA detecta `CLINICAL_HISTORY`; el usuario no cambia la categoria; ambas
   categorias quedan iguales.
2. IA detecta `CLINICAL_HISTORY`; el usuario elige `VACCINATION_CARD`; el
   payload conserva `documentType: CLINICAL_HISTORY`.
3. El cambio de categoria final no modifica el borrador.
4. El cambio de categoria final no inicia otra carga ni otro polling.
5. Si existe una extraccion para la nueva categoria, cambiar el contenido exige
   una accion separada y explicita.
6. El documento anterior aparece al consultar
   `category=VACCINATION_CARD`.
7. La tarjeta muestra la etiqueta de `finalCategory`.
8. El detalle usa el catalogo de `validatedExtraction.documentType` y muestra
   los campos de historia clinica.
9. Los IDs y asignaciones sobreviven al cambio de categoria final.
10. Una extraccion internamente mezclada sigue bloqueando el envio o muestra el
    error `400` del backend.
11. Un registro historico donde ambas categorias coinciden se comporta igual
    que antes.
12. Ningun valor medico, diagnostico o resultado se genera por la decision de
    archivo.

## Criterio de finalizacion

La implementacion queda completa cuando el usuario puede archivar cualquier
extraccion bajo cualquier categoria valida sin perder datos, sin volver a
ejecutar IA y sin recibir un `400` por la diferencia entre `finalCategory` y
`validatedExtraction.documentType`; la interfaz mantiene visibles y separadas
la deteccion, la categoria elegida y la estructura del contenido.
