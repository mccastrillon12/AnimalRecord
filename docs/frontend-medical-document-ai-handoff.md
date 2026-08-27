# Traspaso para IA frontend: documentos medicos

## Proposito

Este documento es una guia de ejecucion para la persona o IA que implementara
el flujo de documentos medicos en el frontend de AnimalRecord.

La especificacion HTTP completa esta en
[`frontend-medical-document-integration.md`](./frontend-medical-document-integration.md).
Este traspaso no la reemplaza: resume los cambios prioritarios, las reglas que
no deben reinterpretarse y los casos que deben quedar probados.

Estado del backend al 2026-08-08:

- El analisis usa AWS Bedrock Data Automation de forma asincrona.
- El proyecto BDA tiene cinco blueprints LIVE en version `v2`.
- `CLINICAL_HISTORY` fue probado con una historia simple y una multiseccion.
- `requestedCategory` es solo contexto de navegacion y no fuerza la deteccion.

## Instruccion inicial para la IA del frontend

Antes de modificar codigo:

1. Inspeccionar la arquitectura existente del frontend.
2. Localizar el cliente HTTP, manejo de autenticacion, estado global o local,
   navegacion, formularios medicos y pruebas.
3. Identificar que partes del flujo descrito aqui ya existen.
4. Presentar un resumen breve de los archivos que se modificaran.
5. Conservar los componentes, estilos y convenciones existentes siempre que
   cumplan este contrato.

No inventar endpoints, estados, categorias ni persistencia paralela. Si el
frontend actual contradice esta guia, ajustar el frontend al contrato del
backend.

## Objetivo de implementacion

El frontend debe permitir:

1. Elegir uno o varios animales y un archivo PDF, JPEG, PNG o TIFF.
2. Iniciar el analisis desde una categoria o desde una carga general.
3. Esperar el resultado asincrono mediante polling.
4. Separar visualmente categoria solicitada, categorias detectadas y categoria
   final elegida por el usuario.
5. Revisar y corregir una sola extraccion categorica.
6. Aceptar o rechazar el documento.
7. Consultar posteriormente la informacion validada sin descargar el archivo.

## Regla principal: no forzar la deteccion

Existen tres conceptos distintos:

- `requestedCategory`: contexto de la pantalla desde la que se carga el archivo.
- `primaryDetectedCategory` y `detectedCategories`: resultado inmutable de IA.
- `finalCategory`: decision final del usuario.

El frontend nunca debe:

- Copiar `requestedCategory` dentro de `detectedCategories`.
- Usar `requestedCategory` como fallback de `primaryDetectedCategory`.
- Mostrar la categoria solicitada con una etiqueta de "detectada".
- Recalcular `classificationOutcome` localmente.
- Cambiar la deteccion cuando el usuario cambia `finalCategory`.
- Usar una expresion como
  `primaryDetectedCategory ?? requestedCategory`.

Debe existir estado separado, por ejemplo:

```ts
type MedicalDocumentFlowState = {
  documentId?: string;
  remoteDocument?: MedicalDocumentResponse;
  requestedCategory?: MedicalDocumentCategory;
  selectedFinalCategory?: MedicalDocumentCategory;
  draftExtraction?: MedicalDocumentExtraction;
};
```

## Caso critico: menu cargado desde una categoria

Un menu de restaurante enviado desde la pantalla de formulas puede llevar:

```json
{
  "requestedCategory": "PRESCRIPTION"
}
```

Cuando AWS no detecta una categoria medica, la respuesta esperada es:

```json
{
  "requestedCategory": "PRESCRIPTION",
  "detectedCategories": [],
  "classificationOutcome": "UNCLASSIFIED",
  "extractionsByCategory": {
    "OTHER": {
      "documentType": "OTHER"
    }
  }
}
```

`primaryDetectedCategory` se omite. El frontend debe mostrar:

- Categoria de origen: Formula.
- Resultado: no hubo una categoria medica confiable.
- Informacion generica extraida, si existe.
- Selector para que el usuario elija manualmente una categoria final.

No debe mostrar "Formula detectada" ni convertir el resultado `OTHER` en una
prescripcion. `OTHER` es una extraccion de respaldo, no una categoria medica
detectada.

La misma regla aplica a cualquier pantalla categorica. Por ejemplo, si el mismo
menu se carga desde "Historias clinicas", la solicitud puede incluir
`requestedCategory: CLINICAL_HISTORY`, pero la respuesta correcta sigue siendo:

```json
{
  "requestedCategory": "CLINICAL_HISTORY",
  "detectedCategories": [],
  "classificationOutcome": "UNCLASSIFIED",
  "extractionsByCategory": {
    "OTHER": {
      "documentType": "OTHER"
    }
  }
}
```

La UI puede informar "Cargado desde Historias clinicas", pero no puede mostrar
"Historia clinica detectada". `primaryDetectedCategory` debe permanecer ausente.

Esta regla debe probarse al menos con `PRESCRIPTION` y `CLINICAL_HISTORY`. La
solucion no consiste en dejar de enviar `requestedCategory`: el backend necesita
ese contexto para informar coincidencias y diferencias. La solucion es mantener
la solicitud separada de la deteccion en el estado y en los componentes de UI.

## Categorias y resultados

```ts
type MedicalDocumentCategory =
  | 'PRESCRIPTION'
  | 'MEDICAL_ORDER'
  | 'REFERRAL'
  | 'VACCINATION_CARD'
  | 'CLINICAL_HISTORY'
  | 'OTHER';

type ClassificationOutcome =
  | 'MATCH'
  | 'MISMATCH'
  | 'MATCH_WITH_ADDITIONAL'
  | 'MULTIPLE'
  | 'DETECTED'
  | 'UNCLASSIFIED';
```

Tratamiento de UI recomendado:

| Resultado               | Comportamiento                                                        |
| ----------------------- | --------------------------------------------------------------------- |
| `MATCH`                 | Preseleccionar la categoria solicitada.                               |
| `MISMATCH`              | Advertir la diferencia y mostrar la categoria detectada.              |
| `MATCH_WITH_ADDITIONAL` | Preseleccionar la solicitada y mostrar las adicionales.               |
| `DETECTED`              | Preseleccionar la unica categoria detectada.                          |
| `MULTIPLE`              | Mostrar todas y exigir confirmacion de una sola categoria final.      |
| `UNCLASSIFIED`          | Permitir seleccion y captura manual; no declarar invalido el archivo. |

La seleccion inicial es una sugerencia de UI. El usuario siempre puede elegir
cualquier categoria valida antes de aceptar.

## Informes diagnosticos y no interpretacion

Un informe aislado de laboratorio, hemograma, quimica sanguinea, urianalisis,
citologia, patologia o imagenologia se presenta como `OTHER` mientras no exista
una categoria propia. No debe mostrarse como `CLINICAL_HISTORY` solo porque
incluya datos del paciente, un numero o la etiqueta "Historia Clinica".

La interfaz no debe comparar resultados con valores de referencia ni generar
etiquetas como alto, bajo, normal, anormal, elevado o disminuido. Tampoco debe
crear diagnosticos, riesgos o recomendaciones a partir de los valores.

Durante `REVIEW_PENDING`, `diagnosticResults[].interpretation` no debe contener
una opinion generada por IA. Si una version antigua del backend aun envia ese
campo sin evidencia de texto profesional, el frontend debe tratarlo como dato no
confiable y no presentarlo como conclusion clinica. En documentos aceptados solo
puede mostrarse como comentario validado cuando proviene expresamente del emisor
y fue confirmado por el usuario.

Caso obligatorio: `ALBONDIGA PRE QX PARTICULAR 09-06-2018.pdf` debe quedar sin
categorias detectadas, con `classificationOutcome: UNCLASSIFIED` y una extraccion
`OTHER`. La UI puede mostrar que contiene resultados y referencias, pero no puede
afirmar neutrofilia, creatinina elevada, ALT normal ni otra conclusion calculada.

## Inicio del analisis

Endpoint:

```http
POST /medical-documents/analyze
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

Campos:

- `file`: obligatorio.
- `animalIds`: arreglo con uno o mas UUID.
- `requestedCategory`: opcional. Omitir completamente en carga general.

Forma recomendada:

```ts
const formData = new FormData();
formData.append('file', selectedFile as never);
formData.append('animalIds', JSON.stringify(animalIds));

if (requestedCategory) {
  formData.append('requestedCategory', requestedCategory);
}
```

La respuesta exitosa es HTTP `202` y normalmente contiene
`status: 'ANALYZING'`. Todavia no contiene la extraccion final.

## Polling obligatorio

Consultar:

```http
GET /medical-documents/{documentId}
Authorization: Bearer <token>
```

Reglas:

- Conservar el `documentId` recibido en el `202`.
- Consultar mientras el estado sea `ANALYZING`.
- Usar intervalos aproximados de 2, 3 y luego 5 segundos.
- No ejecutar dos consultas simultaneas para el mismo documento.
- Pausar al enviar la aplicacion a segundo plano.
- Reanudar con el mismo ID al volver.
- Detener en `REVIEW_PENDING`, `FAILED`, `ACCEPTED` o `REJECTED`.
- Un error de red no significa que el documento haya fallado y no debe provocar
  una segunda carga del archivo.

Solo mostrar controles de revision cuando el backend responda
`REVIEW_PENDING`.

## Pantalla de clasificacion y revision

Mostrar por separado:

- Categoria solicitada, si existe.
- Categoria principal sugerida por la IA, si existe.
- Todas las categorias detectadas.
- Paginas, resumen y evidencia de cada deteccion cuando existan.
- `classificationOutcome` con un mensaje comprensible.
- Selector independiente de categoria final.

Para iniciar el formulario usar una copia profunda de:

```ts
document.extractionsByCategory[selectedFinalCategory];
```

No modificar directamente la respuesta del servidor.

Si el usuario elige una categoria que no tiene extraccion, crear un contrato
vacio cuyo `documentType` sea esa categoria. No transformar campos de otra
categoria para llenarlo.

Los objetos `patient` y `owner` se leen por nombre de propiedad. No deducir su
significado por la posicion de `patientHints` y no cambiar automaticamente los
animales asociados usando los datos extraidos.

## Aceptacion

Endpoint:

```http
PUT /medical-documents/{documentId}/review
Content-Type: application/json
Authorization: Bearer <token>
```

Contrato minimo:

```json
{
  "decision": "ACCEPT",
  "documentVersion": 1,
  "finalCategory": "PRESCRIPTION",
  "validatedExtraction": {
    "documentType": "PRESCRIPTION"
  },
  "assignments": [
    {
      "animalId": "UUID",
      "extractedItemIds": []
    }
  ]
}
```

Invariantes:

- Usar la ultima `version` recibida del servidor.
- `finalCategory` es obligatoria.
- `validatedExtraction.documentType` debe ser igual a `finalCategory`.
- Enviar exactamente una asignacion por cada animal original.
- Una asignacion puede tener `extractedItemIds: []`.
- Todos los IDs asignados deben existir en la extraccion validada.
- Si se elimina un item, eliminar tambien su ID de todas las asignaciones.
- No mezclar secciones estructuradas de dos categorias.

Secciones especificas permitidas:

| Categoria final    | Secciones especificas                                       |
| ------------------ | ----------------------------------------------------------- |
| `PRESCRIPTION`     | `diagnoses`, `medications`                                  |
| `MEDICAL_ORDER`    | `diagnoses`, `medicalOrders`                                |
| `REFERRAL`         | `diagnoses`, `medications`, `diagnosticResults`, `referral` |
| `VACCINATION_CARD` | `vaccinations`                                              |
| `CLINICAL_HISTORY` | `diagnoses`, `clinicalHistory`, `diagnosticResults`         |
| `OTHER`            | Solo campos comunes y `additionalFields`                    |

Los campos comunes incluyen `summary`, `documentDate`, `issuer`, `patient`,
`owner`, `patientHints`, `additionalFields` y `warnings`.

## Rechazo

Obtener las opciones del dropdown desde:

```http
GET /medical-documents/rejection-reasons
```

Cada opcion contiene `code`, `label` y `requiresComment`.

```json
{
  "decision": "REJECT",
  "documentVersion": 1,
  "rejectionReason": "INCORRECT_INFORMATION"
}
```

Los codigos son `INCORRECT_INFORMATION`, `WRONG_ANIMAL` y `OTHER`. Para `OTHER`
tambien se envia `rejectionComment`, obligatorio y con maximo 500 caracteres.
No enviar `finalCategory`, `validatedExtraction` ni `assignments`. Cerrar la
pantalla no equivale a rechazar: la decision debe enviarse expresamente.

## Like o dislike del proceso

Despues de cada aceptacion, mostrar ambas manos y enviar una sola seleccion:

```http
POST /medical-documents/ai-feedback
```

```json
{ "value": "LIKE" }
```

Tambien se acepta `DISLIKE`. Al recibir `{ "registered": true }`, deshabilitar
ambas opciones y no permitir cambios. La siguiente carga aceptada comienza con
controles nuevos. Esta metrica es global y no esta asociada al usuario ni al
documento, por lo que no se debe reintentar automaticamente una solicitud cuyo
resultado sea incierto.

## Consulta despues de aceptar

```http
GET /animals/{animalId}/medical-documents
GET /animals/{animalId}/medical-documents?category=PRESCRIPTION
```

Para tarjetas y detalles usar:

```ts
document.finalCategory;
document.validatedExtraction;
```

No usar `extractionsByCategory` como fuente de verdad despues de aceptar y no
descargar el archivo para reconstruir los datos estructurados.

## Pruebas obligatorias del frontend

1. El mismo menu sin `requestedCategory` termina en `UNCLASSIFIED` con
   extraccion `OTHER`.
2. El menu con `requestedCategory: PRESCRIPTION` conserva exactamente la misma
   deteccion y no aparece como formula detectada.
3. El menu con `requestedCategory: CLINICAL_HISTORY` conserva exactamente la
   misma deteccion y no aparece como historia clinica detectada.
4. Una formula solicitada como `PRESCRIPTION` muestra `MATCH`.
5. Una remision solicitada como `PRESCRIPTION` muestra `MISMATCH` y sugiere
   `REFERRAL`.
6. Una historia multiseccion muestra `CLINICAL_HISTORY`, `VACCINATION_CARD` y
   `PRESCRIPTION` sin mezclarlas en una sola extraccion.
7. El informe de laboratorio Albondiga queda en `OTHER` y no muestra
   interpretaciones generadas.
8. Una carga general con una categoria y otra con varias categorias.
9. Seleccion manual de una categoria sin extraccion previa.
10. Aceptacion con uno y con varios animales.
11. Asignacion vacia para un animal.
12. Eliminacion de un item y limpieza de sus asignaciones.
13. Dropdown de rechazo consumido desde el backend.
14. Rechazo con cada motivo y comentario obligatorio para `OTHER`.
15. Like y dislike globales, deshabilitados despues de la respuesta exitosa.
16. Pausa y reanudacion del polling.
17. Error temporal de red sin duplicar la carga.
18. Conflicto `409` al revisar una version anterior.
19. Consulta de aceptados general y filtrada por categoria.

Prueba comparativa clave:

```text
Menu sin categoria       -> requestedCategory omitida
Menu desde formulas      -> requestedCategory = PRESCRIPTION

En ambos:
primaryDetectedCategory  -> ausente
detectedCategories       -> []
classificationOutcome    -> UNCLASSIFIED
extractionsByCategory    -> contiene OTHER
```

Si la interfaz muestra detecciones distintas aunque las respuestas HTTP sean
iguales salvo por `requestedCategory`, el error esta en la derivacion de estado
del frontend.

## Criterio de finalizacion

La implementacion queda completa cuando:

- Soporta carga categorizada y general.
- Conserva y reanuda correctamente el analisis asincrono.
- Distingue categoria solicitada, detectada y final en estado y UI.
- Maneja `UNCLASSIFIED` sin convertir la solicitud en una deteccion.
- Permite editar solamente una extraccion categorica a la vez.
- Envia una asignacion por animal y un contrato valido de aceptacion.
- Renderiza documentos aceptados desde `validatedExtraction`.
- Supera la matriz de pruebas anterior.

Antes de cerrar, la IA debe informar los archivos modificados, las pruebas
ejecutadas y cualquier diferencia encontrada entre el frontend existente y
este contrato.
