# Estrategia de documentos medicos veterinarios

## Condicion de este documento

Este documento es la fuente de verdad funcional y tecnica para el flujo de
documentos medicos con inteligencia artificial.

Debe leerse antes de:

- Cambiar el dominio `medical-document`.
- Crear o modificar blueprints de Amazon Bedrock Data Automation.
- Cambiar contratos HTTP, DTO o Swagger relacionados con documentos.
- Cambiar las rutas de almacenamiento en S3.
- Implementar la aplicacion de informacion medica a los animales.

Si una decision posterior del negocio contradice este documento, primero se
actualiza este documento y despues se modifica codigo, infraestructura y
documentacion tecnica.

Ultima actualizacion funcional: 2026-08-07.

## Objetivo

Permitir que uno o varios animales reciban un archivo veterinario en PDF, JPG,
PNG o TIFF, analizar su contenido con IA, informar las categorias encontradas,
permitir revision humana y guardar el archivo y la informacion validada bajo
una unica categoria final elegida por el usuario.

La IA recomienda y extrae. El usuario siempre toma la decision final.

## Categorias soportadas

Los identificadores canonicos son:

- `PRESCRIPTION`: formula o prescripcion medica.
- `MEDICAL_ORDER`: orden de examen, procedimiento, control o valoracion.
- `REFERRAL`: remision veterinaria.
- `VACCINATION_CARD`: carne, certificado o historial de vacunacion.
- `CLINICAL_HISTORY`: historia, ficha, resumen o expediente clinico.
- `OTHER`: documento que no corresponde de forma confiable a las anteriores.

`OTHER` es una categoria de respaldo. No debe aparecer como categoria detectada
junto a una categoria medica reconocida.

## Reglas no negociables

### Una sola categoria final

Un archivo puede contener cero, una o varias categorias detectadas, pero debe
tener exactamente una categoria final.

La categoria final es elegida por el usuario. Puede ser:

- La categoria seleccionada inicialmente.
- La categoria principal recomendada por la IA.
- Una categoria adicional detectada.
- Cualquier categoria valida elegida manualmente, incluso si la IA no la
  detecto.

### Los animales se conocen desde el inicio

El frontend siempre envia el animal o los animales asociados al documento. El
backend debe validar que todos pertenecen al usuario antes de iniciar el
analisis.

La aceptacion final debe conservar una asignacion para cada animal asociado.

### La categoria final controla archivo e informacion

Esta regla aplica a todas las categorias, sin excepcion.

Solo se guarda y relaciona con los animales la informacion correspondiente a
la categoria final seleccionada por el usuario.

Ejemplos:

- Un archivo contiene formula y remision. Si la categoria final es `REFERRAL`,
  solo se guarda la informacion de remision.
- Un archivo contiene orden y formula. Si la categoria final es
  `PRESCRIPTION`, solo se guarda la informacion de formula.
- Una historia contiene vacunas y una formula. Si la categoria final es
  `CLINICAL_HISTORY`, solo se guarda la informacion propia de historia clinica.
- Si la categoria final es `VACCINATION_CARD`, solo se guardan las vacunas
  validadas, aunque el archivo tambien contenga antecedentes o medicamentos.

El archivo original completo siempre se conserva. La restriccion aplica a los
datos estructurados que se guardan y relacionan, no a las paginas del archivo.

### La IA no puede imponer la categoria

Una diferencia entre la seleccion inicial y lo detectado genera una advertencia,
no un rechazo automatico.

Si la IA no detecta ninguna categoria, el usuario puede elegir cualquiera. El
backend debe intentar devolver al menos informacion generica util del documento
para que pueda revisarse.

### No se transforma informacion entre categorias

Si la IA detecta una remision y el usuario fuerza `PRESCRIPTION`, el sistema no
debe convertir campos de remision en una formula.

El usuario puede completar o corregir manualmente campos de la categoria final.
Solo esos campos validados se guardan.

## Conceptos del dominio

No deben volver a mezclarse estos conceptos:

### `requestedCategory`

Categoria elegida en el frontend antes de analizar. Es opcional porque una
carga general no tiene categoria inicial.

### `detectedCategories`

Categorias encontradas por la IA. Es una lista y no puede ser modificada por la
decision posterior del usuario.

Cada deteccion debe poder incluir:

- Categoria.
- Confianza.
- Pagina inicial y final cuando existan.
- Resumen breve de la seccion.
- Evidencia util durante la revision.

### `primaryDetectedCategory`

Categoria que mejor describe el proposito principal del archivo. Puede ser nula
si no hubo una clasificacion confiable.

### `finalCategory`

Unica categoria confirmada por el usuario durante la aceptacion. Controla la
carpeta final, la extraccion validada y la informacion relacionada con los
animales.

### `classificationOutcome`

Resultado de comparar el contexto de carga con lo detectado:

- `MATCH`: se detecto solamente la categoria solicitada.
- `MISMATCH`: se detecto otra categoria y no la solicitada.
- `MATCH_WITH_ADDITIONAL`: se detecto la solicitada y otras adicionales.
- `MULTIPLE`: carga general con varias categorias detectadas.
- `DETECTED`: carga general con una categoria detectada.
- `UNCLASSIFIED`: no se detecto ninguna categoria confiable.

## Flujos funcionales

### Carga desde una categoria del animal

1. El frontend envia archivo, `animalIds` y `requestedCategory`.
2. El backend valida archivo, usuario y animales.
3. La IA analiza todo el contenido sin confiar ciegamente en la categoria
   solicitada.
4. El backend compara solicitud y detecciones.
5. El frontend muestra coincidencias, diferencias y extracciones por categoria.
6. El usuario elige una categoria final y revisa solamente la extraccion que
   desea aceptar.
7. El backend guarda el archivo en la carpeta de la categoria final.
8. El backend guarda y relaciona solamente la extraccion validada de esa
   categoria.

### Carga general

1. El frontend envia archivo y `animalIds`, sin `requestedCategory`.
2. La IA devuelve cero, una o varias categorias.
3. El frontend presenta todas las categorias detectadas y sus extracciones.
4. El usuario elige exactamente una categoria final.
5. El flujo de validacion, almacenamiento y persistencia es el mismo que en la
   carga desde una categoria.

### Categoria no detectada o seleccion manual

1. La respuesta incluye `UNCLASSIFIED` o las categorias detectadas realmente.
2. Se devuelve una extraccion generica con la informacion que pueda leerse.
3. El usuario elige una categoria final.
4. El frontend permite completar los campos propios de esa categoria.
5. El backend valida y guarda solo ese contrato categorico.

## Documentos con varias categorias

La respuesta de analisis debe separar clasificacion y extraccion:

```json
{
  "requestedCategory": "CLINICAL_HISTORY",
  "primaryDetectedCategory": "CLINICAL_HISTORY",
  "detectedCategories": [
    {
      "category": "CLINICAL_HISTORY",
      "confidence": 0.96,
      "pageStart": 1,
      "pageEnd": 10
    },
    {
      "category": "PRESCRIPTION",
      "confidence": 0.89,
      "pageStart": 8,
      "pageEnd": 9
    }
  ],
  "classificationOutcome": "MATCH_WITH_ADDITIONAL",
  "extractionsByCategory": {
    "CLINICAL_HISTORY": {},
    "PRESCRIPTION": {}
  }
}
```

No debe inferirse una categoria adicional solo por la presencia de un campo
aislado. Por ejemplo, mencionar un medicamento dentro de antecedentes no basta
para afirmar que existe una formula. Debe identificarse una seccion documental
o conjunto de datos suficientemente claro para esa categoria.

## Limites de informacion por categoria

Los campos comunes que pueden acompañar cualquier categoria son:

- Fecha del documento.
- Emisor e institucion.
- Datos identificadores del paciente.
- Datos identificadores del propietario.
- Resumen.
- Advertencias y ambiguedades.

Los datos especificos se separan asi:

### `PRESCRIPTION`

- Diagnosticos escritos en la formula.
- Medicamentos prescritos.
- Dosis, via, frecuencia, duracion e instrucciones.
- Recomendaciones propias de la formula.

### `MEDICAL_ORDER`

- Motivo clinico de la orden.
- Diagnosticos escritos en la orden.
- Examenes, procedimientos, controles o valoraciones solicitadas.
- Prioridad, preparacion y estado de la orden.

### `REFERRAL`

- Motivo de remision.
- Destino y especialidad.
- Resumen clinico incluido en la remision.
- Estudios realizados y tratamiento actual cuando formen parte de la remision.

### `VACCINATION_CARD`

- Vacunas aplicadas.
- Enfermedades cubiertas.
- Marca, fabricante, tipo, lote y vencimiento.
- Fecha, via, sitio de aplicacion, placa y profesional.

### `CLINICAL_HISTORY`

- Motivo de consulta y anamnesis.
- Examen fisico, signos vitales y hallazgos.
- Diagnosticos e impresiones clinicas.
- Evolucion y resumen de hospitalizacion.
- Plan terapeutico general, recomendaciones, seguimiento y pronostico.
- Resultados diagnosticos propios de la historia.

Una formula incluida dentro de la historia no se guarda como formula si la
categoria final es `CLINICAL_HISTORY`. Sus medicamentos pueden permanecer en el
texto del plan o evolucion cuando sean parte natural del resumen clinico, pero
no se crean registros estructurados de prescripcion.

### `OTHER`

- Campos comunes.
- Resumen generico.
- Campos adicionales validados manualmente.

## Contrato objetivo de analisis

Solicitud multipart:

```text
file: archivo
animalIds: UUID[]
requestedCategory: categoria opcional
```

Respuesta cuando el analisis termina:

```json
{
  "id": "UUID",
  "status": "REVIEW_PENDING",
  "requestedCategory": "PRESCRIPTION",
  "primaryDetectedCategory": "REFERRAL",
  "detectedCategories": [],
  "classificationOutcome": "MISMATCH",
  "extractionsByCategory": {},
  "version": 1
}
```

`extractionsByCategory` es informacion de trabajo para la revision. No significa
que todas sus secciones se guardaran al aceptar.

## Contrato objetivo de aceptacion

```json
{
  "decision": "ACCEPT",
  "documentVersion": 1,
  "finalCategory": "REFERRAL",
  "validatedExtraction": {},
  "assignments": [
    {
      "animalId": "UUID",
      "extractedItemIds": []
    }
  ]
}
```

Invariantes:

- `finalCategory` es obligatorio al aceptar.
- Existe una asignacion para cada animal asociado.
- `validatedExtraction` cumple el contrato de `finalCategory`.
- Los IDs asignados pertenecen solamente a la extraccion final validada.
- No se aceptan simultaneamente extracciones de dos categorias.
- La clasificacion original de la IA permanece inmutable.

## Retencion de extracciones descartadas

Mientras el documento esta en `REVIEW_PENDING`, el frontend necesita consultar
las extracciones de todas las categorias detectadas.

Al aceptar:

- Se conserva la categoria final y su extraccion validada.
- Se conservan como auditoria las categorias detectadas, confianza y rangos de
  pagina.
- No se relacionan con los animales los datos de categorias descartadas.
- No se deben conservar indefinidamente payloads clinicos completos de las
  categorias descartadas.

La politica tecnica exacta de eliminacion o minimizacion de esos payloads debe
implementarse de forma explicita; no puede quedar como efecto accidental del
mapper o de MongoDB.

## Estrategia de almacenamiento S3

La categoria final todavia no existe durante el analisis. El archivo debe
permanecer temporalmente en una ruta de ingreso y moverse o copiarse despues de
la aceptacion.

Ruta temporal propuesta:

```text
users/{ownerId}/medical-document-intake/{documentId}/source.{extension}
```

Ruta final:

```text
users/{ownerId}/animals/{animalId}/medical-documents/{categorySlug}/{documentId}/source.{extension}
```

Slugs propuestos:

- `prescriptions`
- `medical-orders`
- `referrals`
- `vaccination-cards`
- `clinical-histories`
- `other`

Para varios animales se crea una copia final por animal. Cuando todas las copias
y la persistencia terminan correctamente, se elimina el objeto temporal.

Un rechazo elimina el objeto temporal y no crea copias finales.

El dominio debe registrar todas las ubicaciones finales, no solamente la clave
del primer animal.

## Persistencia objetivo

El registro `medical_documents` debe poder representar como minimo:

```text
requestedCategory?
primaryDetectedCategory?
detectedCategories[]
classificationOutcome
extractionsByCategory       temporal durante revision
finalCategory?
validatedExtraction?       solo categoria final
assignments[]
temporaryStorageKey?
documentLocations[]
providerMetadata
status y version
createdAt, updatedAt, reviewedAt
```

Indice esperado para consultas del animal:

```text
animalIds + finalCategory + status + createdAt
```

## Estrategia AWS BDA

Se conservan blueprints especializados por categoria porque los formatos y las
instrucciones de extraccion son diferentes.

Todos los blueprints deben compartir un contrato de clasificacion de secciones,
por ejemplo `document_sections`, para informar categorias adicionales dentro de
un mismo archivo.

La categoria del blueprint que hizo match representa la categoria principal,
no garantiza que sea la unica categoria presente.

Para archivos con varios documentos logicos, historias extensas y mas de diez
paginas, se implementara BDA asincrono con document splitter. Esta direccion
tecnica fue aprobada el 2026-08-07. El frontend puede conservar un estado de
carga mientras consulta el estado del documento por su identificador.

El blueprint definitivo de historia clinica se creo despues de actualizar el
contrato comun de clasificacion y revisar los blueprints existentes. Su version
publicada forma parte del proyecto BDA junto con las otras cuatro categorias.

## Estado actual de la implementacion

El codigo existente es una primera version y no representa por completo esta
estrategia.

El primer bloque de dominio y contrato HTTP ya incorpora:

- `requestedCategory` opcional en el analisis.
- Categorias detectadas, categoria principal y resultado de clasificacion.
- Extracciones separadas por categoria durante la revision.
- `finalCategory` obligatoria al aceptar.
- Validacion de que la extraccion final no mezcle secciones estructuradas de
  otras categorias.
- Lectura compatible de registros creados con la extraccion unica anterior.

El segundo bloque de almacenamiento ya incorpora:

- Una sola carga temporal por documento bajo `medical-document-intake`.
- Copias finales por animal bajo el slug de la categoria final.
- Registro de todas las ubicaciones finales en `documentLocations`.
- Eliminacion de la copia temporal despues de persistir la aceptacion.
- Compensacion de copias finales ante fallos parciales o conflictos de version.
- Reintento seguro de la limpieza temporal cuando S3 o MongoDB falla.
- Descarga desde una ubicacion final, con compatibilidad para registros antiguos.

El tercer bloque de analisis ya incorpora:

- Invocacion asincrona de BDA con token idempotente por documento.
- Persistencia interna del ARN de invocacion y de la salida de analisis.
- Respuesta HTTP `202` con estado `ANALYZING` y consulta posterior por ID.
- Lectura de todos los resultados de subdocumentos generados en S3.
- Consolidacion de segmentos sin mezclar extracciones de categorias distintas.
- Contrato comun `document_sections` en los cinco esquemas versionados.
- Recuperacion de un inicio interrumpido mediante el mismo token idempotente.
- Eliminacion de la salida temporal de BDA despues de aceptar o rechazar, para
  no conservar payloads clinicos de categorias descartadas.

Todavia:

- La aceptacion aplica automaticamente solo diagnosticos al animal.

La configuracion de AWS se completo el 2026-08-07: los cinco esquemas fueron
publicados como versiones LIVE y asociados al proyecto
`animal-record-medical-documents`, con el document splitter habilitado y sin
blueprint de fallback. Los documentos sin coincidencia reciben salida estandar
y la aplicacion los clasifica como `OTHER`.

Estas diferencias son deuda funcional conocida. No deben tomarse como
precedente para nuevas decisiones.

## Plan de evolucion

1. Actualizar dominio y persistencia para separar categoria solicitada,
   detecciones y categoria final.
2. Cambiar el contrato de analisis para devolver extracciones por categoria.
3. Definir `document_sections` y actualizar todos los blueprints.
4. Implementar la migracion aprobada a BDA asincrono con splitter.
5. Implementar almacenamiento temporal y finalizacion por categoria.
6. Validar la extraccion segun la categoria final.
7. Minimizar o eliminar payloads descartados al aceptar.
8. Aplicar solamente la informacion final validada a los animales.
9. Actualizar Swagger, documentacion de AWS y pruebas integrales.

## Matriz minima de pruebas

- Categoria solicitada coincide con una categoria detectada.
- Categoria solicitada no coincide con la detectada.
- Categoria solicitada aparece junto a categorias adicionales.
- Carga general con una categoria.
- Carga general con varias categorias.
- Ninguna categoria detectada y seleccion manual.
- Categoria final distinta a todas las detectadas.
- Historia clinica con formula y vacunas embebidas.
- Formula que menciona una remision sin contener una remision real.
- Documento asociado a varios animales.
- Aceptacion conserva solo la extraccion de la categoria final.
- Rechazo elimina el archivo temporal.
- Fallo al copiar a uno de varios animales no deja un estado aceptado parcial.
- Consulta por animal y categoria devuelve solamente documentos aceptados.
- Documento largo y documento con varios segmentos.

## Decisiones pendientes

- Definir el umbral de confianza para mostrar una categoria como detectada.
- Definir el tiempo maximo de permanencia de documentos en
  `REVIEW_PENDING` y su limpieza automatica.
- Confirmar los contratos finales de datos por categoria antes de modificar los
  blueprints.
- Definir si los datos validados se consultaran solo desde `medical_documents`
  o si existiran modelos clinicos especializados adicionales.
