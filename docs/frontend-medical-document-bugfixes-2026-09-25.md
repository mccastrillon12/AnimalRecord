# Instrucciones para frontend: correcciones de documentos medicos

Fecha del contrato: 2026-09-25. Ultima actualizacion: 2026-09-26.

Este documento esta escrito para la IA o desarrollador responsable del frontend
Flutter de AnimalRecord. Implementar todos los puntos descritos aqui y adaptar
los nombres de clases a la arquitectura existente del cliente. No cambiar el
contrato del backend ni crear conversiones clinicas en el dispositivo.

## Objetivo

El backend corrigio dos problemas relacionados con la revision de documentos:

1. Las recomendaciones, indicaciones, instrucciones, observaciones y resumenes
   realmente escritos en el archivo no se conservaban correctamente, en
   especial cuando sus encabezados estaban en ingles, mientras se mostraban
   resumenes generados por IA que no pertenecian al documento.
2. Cuando un PDF era clasificado como `DIAGNOSTIC_IMAGE`, el frontend solo
   recibia o mostraba metadatos tecnicos y perdia el informe narrativo escrito
   por el profesional: tecnica, hallazgos, conclusion y diagnostico.

El frontend debe soportar el nuevo contrato sin traducir ni reinterpretar el
contenido medico.

## Reglas que no se pueden cambiar

### Categoria de archivo y categoria de la extraccion

`finalCategory` y `validatedExtraction.documentType` representan conceptos
distintos:

- `finalCategory` es la carpeta o categoria final elegida por el usuario.
- `validatedExtraction.documentType` es la estructura real de los datos que el
  usuario reviso.

Pueden ser diferentes. Cambiar `finalCategory`:

- No vuelve a ejecutar la IA.
- No modifica `validatedExtraction.documentType`.
- No convierte campos entre categorias.
- No elimina ni reinicia el borrador de la extraccion.
- No cambia el catalogo utilizado para mostrar la extraccion.

Ejemplo valido:

```json
{
  "finalCategory": "LABORATORY_RESULT",
  "validatedExtraction": {
    "documentType": "DIAGNOSTIC_IMAGE"
  }
}
```

El documento se archiva como resultado de laboratorio, pero su detalle se
continua mostrando y editando con el contrato de imagen diagnostica. No se deben
crear filas de laboratorio a partir de los hallazgos ecograficos.

### Fuente del catalogo visual

Para mostrar una extraccion siempre solicitar:

```http
GET /medical-documents/field-catalog?category={extraction.documentType}&locale=es-CO
```

No utilizar `finalCategory` ni `primaryDetectedCategory` para escoger el
catalogo de los datos estructurados.

El catalogo vigente es `1.2.0`. Invalidar los catalogos `1.0.0` y `1.1.0`
almacenados. La
cache debe estar identificada al menos por categoria, locale y version.

## Cambios del contrato comun

El modelo comun de una extraccion ahora puede contener:

```dart
String? reportedSummary;
String? reportedRecommendations;
String? reportedObservations;
```

Significado:

- `reportedSummary`: resumen que ya estaba escrito y rotulado en el archivo.
- `reportedRecommendations`: recomendaciones, indicaciones, instrucciones,
  cuidados o consejos escritos por el profesional, aunque el encabezado este
  en ingles (`Recommendations`, `Indications`, `Instructions`, `Directions`,
  `Advice`, `Home care` o `Discharge instructions`).
- `reportedObservations`: observaciones, notas o comentarios escritos por el
  profesional.

Reglas de interfaz:

- Mostrar estos campos como texto multilínea solamente cuando no esten vacios.
- Conservar el texto recibido sin traducirlo, resumirlo ni corregirlo.
- No crear campos alternos para indicaciones o instrucciones; el backend los
  normaliza en `reportedRecommendations`.
- Permitir su revision cuando el formulario actual permita editar la
  extraccion.
- Incluirlos sin modificaciones en `validatedExtraction` al aceptar.

El campo antiguo `summary` queda exclusivamente para compatibilidad historica:

```dart
@Deprecated('No mostrar ni completar en analisis nuevos')
String? summary;
```

No mostrar `summary`, no copiarlo a `reportedSummary` y no enviarlo como si
fuera texto escrito por el profesional.

## Nuevos campos de imagen diagnostica

Actualizar el modelo que representa cada elemento de `diagnosticImages`:

```dart
class ExtractedDiagnosticImage {
  final String id;
  final String name;
  final String? modality;
  final String? studyDate;
  final String? studyTime;
  final String? studyDescription;
  final String? bodyRegion;
  final String? projection;
  final String? laterality;
  final String? marker;
  final String? seriesNumber;
  final String? imageNumber;
  final String? accessionNumber;
  final String? calibrationStatus;

  final String? reportedTechnique;
  final String? reportedFindings;
  final String? reportedConclusion;
  final String? reportedDiagnosis;

  final double? confidence;
  final ExtractionSource? source;
}
```

Los cuatro campos `reported*` significan:

- `reportedTechnique`: tecnica, protocolo, equipo o preparacion escritos.
- `reportedFindings`: cuerpo de hallazgos o descripcion radiologica,
  ecografica o imagenologica escrita por el profesional.
- `reportedConclusion`: conclusion, impresion u opinion imagenologica escrita
  en el informe.
- `reportedDiagnosis`: diagnostico expresamente escrito y rotulado.

No son conclusiones creadas por la aplicacion. El frontend no debe analizar la
imagen, completar texto ni mover `reportedDiagnosis` a la lista general
`diagnoses`.

### Presentacion recomendada en movil

`diagnosticImages` puede seguir siendo una tabla segun el catalogo, pero en
pantallas estrechas conviene mostrar cada registro como tarjeta expandible:

1. Nombre, modalidad y fecha como encabezado.
2. Metadatos tecnicos breves en una cuadricula o lista.
3. Tecnica, hallazgos, conclusion y diagnostico como bloques multilínea.

No truncar permanentemente los campos narrativos. Si se usa una vista previa,
debe existir una accion para expandir y leer el texto completo.

## Ejemplo de respuesta esperada

```json
{
  "documentType": "DIAGNOSTIC_IMAGE",
  "reportedRecommendations": "Se recomienda correlacionar con otros signos clinicos y paraclinicos.",
  "reportedObservations": "El estudio ecografico es dinamico y los hallazgos pueden variar.",
  "diagnosticImages": [
    {
      "id": "diagnostic-image-1",
      "name": "Reporte ecografico abdominal",
      "modality": "Ecografia",
      "studyDate": "22/05/2026",
      "bodyRegion": "Abdominal",
      "reportedTechnique": "Estudio ultrasonografico con sonda microconvexa a 9 MHz",
      "reportedFindings": "Hallazgos escritos por organo en el informe...",
      "reportedConclusion": "Imagenes ecograficas sugerentes de los hallazgos consignados..."
    }
  ],
  "patientHints": [],
  "diagnoses": [],
  "medications": [],
  "vaccinations": [],
  "medicalOrders": [],
  "additionalFields": {},
  "warnings": []
}
```

Los puntos suspensivos del ejemplo son ilustrativos. El frontend debe mostrar el
valor completo recibido por la API.

## Estado y seleccion durante la revision

Mantener dos estados independientes:

```dart
MedicalDocumentCategory selectedFinalCategory;
MedicalDocumentExtraction editableExtraction;
```

Al cambiar el selector de categoria final, actualizar solamente
`selectedFinalCategory`.

Solo reemplazar `editableExtraction` cuando el usuario elija expresamente otra
extraccion existente dentro de `extractionsByCategory`. Esa accion debe ser
distinta del cambio de carpeta final.

Si no existe `extractionsByCategory[seleccion]`, esto no es un error y no se
debe crear una extraccion vacia. El usuario puede archivar la extraccion actual
bajo cualquier categoria valida.

## Serializacion obligatoria

Revisar todas las implementaciones de:

- `fromJson`.
- `toJson`.
- `copyWith`.
- Comparacion de estado o `props`.
- Persistencia temporal del formulario.
- Clonado del borrador editable.

Deben conservar:

- Los tres campos comunes `reported*`.
- Los cuatro campos `reported*` de cada imagen diagnostica.
- `id`, `confidence` y `source` de cada elemento.
- Claves desconocidas que el modelo actual ya preserve.

No construir el JSON de aceptacion solamente con los controles visibles. Partir
del borrador completo y reemplazar unicamente los valores realmente editados,
para no eliminar metadatos ocultos.

## Payload de aceptacion

Ejemplo cuando el usuario archiva un informe de imagen bajo resultados de
laboratorio:

```json
{
  "decision": "ACCEPT",
  "documentVersion": 2,
  "finalCategory": "LABORATORY_RESULT",
  "validatedExtraction": {
    "documentType": "DIAGNOSTIC_IMAGE",
    "reportedRecommendations": "Texto recibido del backend",
    "reportedObservations": "Texto recibido del backend",
    "diagnosticImages": [
      {
        "id": "diagnostic-image-1",
        "name": "Reporte ecografico abdominal",
        "reportedTechnique": "Texto recibido del backend",
        "reportedFindings": "Texto recibido del backend",
        "reportedConclusion": "Texto recibido del backend"
      }
    ],
    "patientHints": [],
    "diagnoses": [],
    "medications": [],
    "vaccinations": [],
    "medicalOrders": [],
    "additionalFields": {},
    "warnings": []
  },
  "assignments": [
    {
      "animalId": "UUID",
      "extractedItemIds": ["diagnostic-image-1"]
    }
  ]
}
```

No reemplazar `validatedExtraction.documentType` por `LABORATORY_RESULT`.

## Cambios que no se deben implementar

- No volver a enviar el archivo a la IA cuando cambia `finalCategory`.
- No transformar hallazgos de imagen en resultados de laboratorio.
- No generar recomendaciones, resumenes, conclusiones o diagnosticos.
- No traducir valores medicos, nombres propios, unidades ni texto narrativo.
- No inferir estados normales o anormales.
- No mostrar `summary` como contenido del archivo.
- No escoger el catalogo usando `finalCategory`.
- No eliminar campos vacios obligatorios como las colecciones base o
  `additionalFields` al serializar la aceptacion.

## Pruebas obligatorias

Agregar o actualizar pruebas para comprobar:

1. `fromJson -> toJson` conserva los siete campos nuevos.
2. Los campos narrativos se muestran completos y como texto multilínea.
3. Los campos vacios se ocultan de acuerdo con el catalogo.
4. `summary` no se muestra ni se copia a un campo nuevo.
5. Cambiar `finalCategory` no modifica `editableExtraction.documentType`.
6. Cambiar `finalCategory` no borra `diagnosticImages` ni los campos
   `reported*`.
7. Un documento `DIAGNOSTIC_IMAGE` archivado como `LABORATORY_RESULT` utiliza
   el catalogo de `DIAGNOSTIC_IMAGE` en la pantalla de detalle.
8. La aceptacion envia la extraccion completa con sus IDs y metadatos.
9. No se crean `laboratoryResults` cuando el contenido estructural sigue siendo
   `DIAGNOSTIC_IMAGE`.
10. El cache anterior del catalogo se invalida al recibir la version `1.1.0`.
11. Los documentos historicos que no tienen los campos nuevos siguen abriendo
    sin errores.

## Archivos de referencia del backend

Para resolver dudas del contrato consultar, en este orden:

1. `docs/medical-document-strategy.md`.
2. `docs/frontend-medical-document-integration.md`.
3. `docs/frontend-medical-document-field-catalog.md`.
4. `docs/frontend-medical-document-category-override.md`.
5. Swagger del ambiente desplegado.

## Dependencias de despliegue

El frontend puede implementar el soporte antes del despliegue, pero los nuevos
valores solo apareceran cuando:

1. El backend actualizado este desplegado.
2. La nueva version LIVE del blueprint DOCUMENT de imagen diagnostica este
   asociada al proyecto de Amazon Bedrock.
3. El frontend consulte o refresque el catalogo `1.1.0`.

Esta correccion no requiere cambiar el endpoint de carga, el polling, el formato
multipart ni el blueprint raster `IMAGE`.

## Criterio de finalizacion

La implementacion queda completa cuando el informe narrativo de una imagen
diagnostica permanece visible, editable y serializable; las recomendaciones y
observaciones escritas se conservan; los resumenes generados por IA no se
muestran; y cambiar la categoria final del archivo no elimina ni transforma la
extraccion validada.
