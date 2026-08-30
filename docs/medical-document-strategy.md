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

Ultima actualizacion funcional: 2026-08-30.

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
- `DIAGNOSTIC_IMAGE`: imagen o estudio veterinario de radiografia,
  ecografia, tomografia, resonancia u otra modalidad de imagen diagnostica.
- `LABORATORY_RESULT`: informe veterinario de resultados de laboratorio,
  incluyendo hematologia, quimica sanguinea, parasitologia, microbiologia,
  inmunologia, serologia, hormonas, citologia o pruebas moleculares.
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

### La IA no realiza interpretacion clinica autonoma

La IA puede clasificar documentos, transcribir datos visibles, organizar campos
y resumir de forma descriptiva. No puede ejercer juicio clinico ni producir
conclusiones nuevas a partir de resultados diagnosticos.

En particular, la IA no debe:

- Comparar un resultado con su intervalo de referencia para declararlo alto,
  bajo, normal, anormal, elevado o disminuido.
- Inferir diagnosticos, pronosticos, riesgos o recomendaciones terapeuticas.
- Convertir porcentajes, valores absolutos, imagenes o hallazgos de laboratorio
  en una interpretacion clinica propia.
- Presentar una conclusion generada por el modelo como si hubiera sido escrita
  por el laboratorio o por un profesional veterinario.

Solo pueden conservarse como comentarios o conclusiones los textos que aparezcan
expresamente en el documento y sean atribuibles al laboratorio o al profesional.
Deben presentarse como contenido transcrito del emisor, nunca como
"interpretacion de IA". Si no existe un comentario profesional escrito, el campo
de interpretacion queda vacio.

Los resumenes generados por IA deben limitarse a describir el tipo de documento
y los datos que contiene. Por ejemplo, "Informe de hemograma y quimica sanguinea
con resultados y valores de referencia", sin afirmar si esos resultados son
normales o patologicos.

### Informes diagnosticos aislados

Un informe aislado de laboratorio, imagenologia, citologia, patologia u otra
prueba diagnostica no es por si solo una historia clinica. La presencia de datos
del paciente, el texto "Historia Clinica", un numero de historia o valores de
referencia tampoco lo convierte en `CLINICAL_HISTORY`.

Las imagenes y estudios de imagenologia independientes se clasifican como
`DIAGNOSTIC_IMAGE`. Los informes aislados con resultados de laboratorio se
clasifican como `LABORATORY_RESULT`. Ninguno se transforma en historia clinica
por contener datos del paciente, un numero de historia o comentarios del
emisor. En ambos casos el backend conserva el archivo y los campos comunes
utiles, pero no estructura una historia clinica ni expone interpretaciones
generadas por IA.

Para `DIAGNOSTIC_IMAGE`, la IA solo puede transcribir metadatos tecnicos y texto
visible: paciente, propietario, institucion, modalidad, fecha y hora, nombre o
descripcion del estudio, region, proyeccion, lateralidad, marcador, numeros de
serie, imagen o acceso y estado de calibracion. Un valor se omite cuando no esta
escrito o no es legible. La IA no puede observar los pixeles para completar
estos campos ni producir hallazgos, impresion radiologica, diagnostico,
pronostico o recomendacion. El resumen debe ser fijo y neutral, dejando claro
que no se genero interpretacion clinica. Si el archivo ya contiene un
diagnostico escrito y claramente rotulado, puede transcribirse literalmente en
`reportedDiagnosis`; este dato permanece dentro del registro de la imagen y no
se convierte en un diagnostico general del animal.

Para `LABORATORY_RESULT`, la IA puede transcribir los datos de la muestra, los
metodos y equipos escritos, y cada resultado con su panel, nombre, valor o texto,
unidad, intervalo de referencia y marcador explicito. Debe conservar los
separadores decimales, simbolos, signos y expresiones originales como "No se
observa", "Negativa", "Trazas", `*`, `H` o `L`. Un marcador solo se guarda si
esta impreso; nunca se calcula comparando el resultado con el intervalo. Cuando
el marcador se separa en `flag`, no se repite dentro de `result`; el valor y el
marcador permanecen disponibles como datos independientes.

Los comentarios, observaciones, interpretaciones o conclusiones del laboratorio
solo pueden conservarse en `reportedComments` cuando ya esten escritos en el
archivo y sean atribuibles al emisor. No se convierten en diagnosticos generales
del animal. El resumen es fijo y neutral. La IA nunca determina que un resultado
es alto, bajo, normal, anormal, positivo o negativo por su cuenta, ni produce
diagnosticos, pronosticos, riesgos o recomendaciones.

Una historia clinica real puede contener resultados diagnosticos como parte de
una consulta, hospitalizacion o evolucion. Para conservar
`CLINICAL_HISTORY` debe existir contexto clinico coherente, por ejemplo motivo de
consulta, anamnesis, examen fisico, evaluacion, diagnostico, evolucion o plan; no
basta con una tabla o informe de resultados.

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

Es exclusivamente contexto de navegacion y comparacion. No se envia a BDA, no
se usa para elegir o forzar un blueprint y nunca puede poblar
`primaryDetectedCategory`, `detectedCategories` o una clave de
`extractionsByCategory`. El mismo archivo debe producir la misma deteccion de
IA con o sin `requestedCategory`; solo puede cambiar `classificationOutcome`.

Ejemplo: si un menu de restaurante se carga desde la seccion de formulas,
`requestedCategory` sera `PRESCRIPTION`, pero si BDA no encuentra una categoria
medica la respuesta debe conservar `detectedCategories: []`, no devolver
`primaryDetectedCategory` y usar `classificationOutcome: UNCLASSIFIED` con una
extraccion `OTHER`.

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

Los datos del paciente y del propietario se entregan con claves explicitas. El
contrato comun puede incluir:

```json
{
  "patient": {
    "name": "BENJI",
    "identifier": "PAC-001",
    "species": "Felino",
    "breed": "Persa",
    "sex": "Macho",
    "color": "Blanco y negro",
    "size": "Pequeno",
    "reproductiveStatus": "No esterilizado",
    "age": "0 anos, 7 meses y 11 dias",
    "birthDate": "2025-04-02",
    "weight": "3.4 kg",
    "microchip": "985141000245781"
  },
  "owner": {
    "name": "Maria Clara Pino Romero",
    "identification": "1037644692",
    "phone": "+57 300 000 0000",
    "email": "maclapiro@example.com",
    "address": "Direccion visible en el documento"
  }
}
```

Cada propiedad es opcional y se omite cuando el documento no la contiene o no
es legible. La IA no debe inventar valores ni deducir automaticamente el animal
asociado a partir de estos datos.

`patientHints` se conserva solo como compatibilidad con extracciones anteriores
y para fragmentos identificadores que no puedan clasificarse con seguridad. El
frontend debe preferir `patient` y no debe depender del orden de
`patientHints`. Los nuevos blueprints deben extraer `patient` y `owner` como
objetos estructurados en todas las categorias.

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

### `DIAGNOSTIC_IMAGE`

- Datos comunes de paciente, propietario e institucion visibles en la imagen.
- Un registro por imagen con etiqueta, modalidad, fecha, hora y descripcion del
  estudio expresamente visibles.
- Region, proyeccion, lateralidad y marcador solo cuando esten escritos o
  impresos en el archivo.
- Numeros de serie, imagen y acceso, y estado de calibracion visibles.
- `reportedDiagnosis` solo puede transcribir literalmente un diagnostico que ya
  este escrito y claramente identificado como tal en el archivo. Su ausencia se
  conserva vacia; nunca se completa observando la anatomia o los pixeles.
- Nunca hallazgos, conclusiones, diagnosticos ni recomendaciones generados al
  observar la imagen.

### `LABORATORY_RESULT`

- Datos comunes de paciente, propietario, institucion y profesionales visibles.
- Metadatos del informe: numero de reporte u orden, tipo y estado de muestra,
  fechas de toma, ingreso, analisis y reporte, metodos, equipos, analistas y
  revisores expresamente escritos.
- Un registro por analito, examen, agente, control u observacion estructurada con
  panel, nombre, resultado textual o numerico, unidad, intervalo de referencia,
  marcador impreso, metodo y detalle tecnico cuando apliquen.
- Los resultados se conservan como texto para no alterar separadores decimales,
  signos, unidades, limites ni expresiones cualitativas del laboratorio.
- `reportedComments` solo transcribe comentarios, observaciones,
  interpretaciones o conclusiones ya escritas por el laboratorio o profesional.
- Nunca estados, comparaciones, interpretaciones, diagnosticos, pronosticos o
  recomendaciones calculados o generados por la IA.

### `OTHER`

- Campos comunes.
- Resumen generico.
- Campos adicionales validados manualmente.
- Informes aislados de laboratorio, citologia, patologia u otras pruebas que aun
  no tienen categoria canonica, sin interpretacion clinica generada por IA.

## Codigo consecutivo del documento

Los documentos aceptados de determinadas categorias reciben un codigo de
negocio legible adicional al UUID tecnico. El UUID continua siendo la identidad
interna utilizada por rutas, relaciones y almacenamiento; el codigo no lo
reemplaza.

Formato inicial:

```text
{prefijo}-{pais}-{consecutivo}
```

Ejemplos: `F-57-01`, `O-57-01` y `H-57-01`. El texto visual `N°` no forma
parte del valor persistido; el frontend puede presentarlo como
`N° F-57-01`.

Reglas confirmadas:

- El codigo de pais es fijo `57` durante esta etapa.
- El consecutivo es global entre usuarios e independiente por tipo de
  documento. Una formula aceptada por otro usuario consume el siguiente valor
  de formulas, pero no modifica el contador de ordenes u otras categorias.
- El consecutivo tiene un minimo de dos digitos con ceros a la izquierda. No se
  trunca al superar `99`: el siguiente valor es `100`.
- El codigo se asigna una sola vez durante la aceptacion, cuando
  `finalCategory` ya fue confirmada por el usuario.
- Consultar o reintentar un documento ya aceptado devuelve el mismo codigo.
- Los codigos asignados no se reutilizan aunque posteriormente el documento
  deje de mostrarse.
- La generacion debe utilizar un incremento atomico en persistencia. No se
  permite calcular el siguiente valor consultando el ultimo documento.
- Los registros historicos sin codigo siguen siendo validos. Esta primera etapa
  no realiza una numeracion retroactiva.

Mapeo vigente:

| Categoria           | Prefijo | Recibe codigo |
| ------------------- | ------- | ------------- |
| `PRESCRIPTION`      | `F`     | Si            |
| `MEDICAL_ORDER`     | `O`     | Si            |
| `REFERRAL`          | `R`     | Si            |
| `CLINICAL_HISTORY`  | `H`     | Si            |
| `DIAGNOSTIC_IMAGE`  | `I`     | Si            |
| `LABORATORY_RESULT` | `L`     | Si            |
| `VACCINATION_CARD`  | -       | No            |
| `OTHER`             | -       | No            |

Un documento no reconocido continua como `OTHER` y no recibe codigo.

## Rechazo y retroalimentacion del proceso

### Motivo de rechazo

Cuando el usuario decide no conservar la informacion extraida, el rechazo debe
registrar uno de estos codigos estables:

| Codigo                  | Etiqueta visible                              |
| ----------------------- | --------------------------------------------- |
| `INCORRECT_INFORMATION` | Informacion incorrecta                        |
| `WRONG_ANIMAL`          | El archivo no es el correspondiente al animal |
| `OTHER`                 | Otros                                         |

El backend expone las opciones mediante un endpoint para popular el dropdown;
el frontend no debe mantener una lista independiente. El codigo, no la etiqueta
traducida, se persiste en `medical_documents`.

Reglas:

- `rejectionReason` es obligatorio cuando `decision = REJECT`.
- `rejectionComment` es obligatorio para `OTHER`, opcional para las demas
  razones y tiene un maximo de 500 caracteres.
- El rechazo conserva motivo, comentario y fecha para auditoria.
- El comportamiento existente de eliminar los objetos temporales se mantiene.
- Un motivo de rechazo no se convierte automaticamente en un dislike. Por
  ejemplo, `WRONG_ANIMAL` no representa necesariamente un error de IA.

### Like y dislike globales

Despues de cada proceso aceptado, el frontend muestra una encuesta simple con
like y dislike. En esta etapa es una metrica global y anonima sobre la
experiencia del proceso:

- No se relaciona con usuario, documento, animal, categoria ni blueprint.
- Cada solicitud valida incrementa atomicamente `likes` o `dislikes`.
- El usuario no puede modificar ni retirar la seleccion desde la interfaz.
- En la siguiente carga el frontend vuelve a mostrar ambas opciones.
- El backend mantiene y puede devolver `likes`, `dislikes`, `total` y el
  porcentaje de aprobacion global.

Esta decision simplifica intencionalmente el alcance: el backend no puede
comprobar que exista exactamente un voto por documento ni distinguir un doble
envio del cliente. El frontend debe deshabilitar las opciones despues de una
respuesta exitosa. Si posteriormente se requiere deduplicacion, auditoria o
segmentacion, se agregaran eventos asociados sin reinterpretar los contadores
historicos.

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

Las extracciones por categoria comparten los objetos opcionales `patient` y
`owner`. Estos objetos tambien forman parte de `validatedExtraction` cuando el
usuario acepta el documento y confirma sus valores.

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
- `diagnostic-images`
- `laboratory-results`
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

### Consulta estructurada para el frontend

`medical_documents.validatedExtraction` es la fuente de verdad de los datos
aprobados por el usuario. El frontend debe poder consultar documentos aceptados
por animal y, opcionalmente, por `finalCategory`, sin descargar ni interpretar
el archivo original.

Contrato de lectura:

```text
GET /animals/{animalId}/medical-documents
GET /animals/{animalId}/medical-documents?category=PRESCRIPTION
```

La respuesta conserva el documento como agregado y expone
`validatedExtraction` con el contrato propio de su categoria. La aplicacion
movil debe renderizar ese campo; `extractionsByCategory` pertenece al proceso de
analisis y auditoria, no reemplaza la decision validada por el usuario.

Para mostrar identidad y contacto, la aplicacion movil debe leer `patient` y
`owner` por nombre de propiedad. No debe inferir el significado de un valor por
su posicion dentro de `patientHints`.

No se duplicaran medicamentos, vacunas, ordenes, remisiones o historias en
colecciones especializadas solo para construir estas vistas. Se crearan modelos
clinicos adicionales cuando exista comportamiento transversal propio, como
recordatorios de proximas dosis, seguimiento de ordenes o consultas agregadas
independientes del documento. Los diagnosticos mantienen por ahora su
aplicacion al agregado `Animal` por compatibilidad con el dominio existente.

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
contrato comun de clasificacion y revisar los blueprints existentes. La sexta
categoria, `DIAGNOSTIC_IMAGE`, se define con un blueprint de transcripcion y una
prohibicion expresa de interpretar el contenido visual. La septima categoria,
`LABORATORY_RESULT`, se define con un blueprint de transcripcion que conserva
resultados y referencias escritos sin compararlos ni interpretarlos.

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
- Contrato comun `document_sections` en los cinco esquemas publicados y en los
  nuevos esquemas locales de imagen diagnostica y resultados de laboratorio.
- Recuperacion de un inicio interrumpido mediante el mismo token idempotente.
- Eliminacion de la salida temporal de BDA despues de aceptar o rechazar, para
  no conservar payloads clinicos de categorias descartadas.

Todavia:

- La aceptacion aplica automaticamente solo diagnosticos al animal.

La configuracion de AWS se completo el 2026-08-07 y se verifico de nuevo el
2026-08-08: las versiones `v2` de los cinco esquemas estan publicadas como LIVE
y asociadas al proyecto `animal-record-medical-documents`, con el document
splitter habilitado y sin blueprint de fallback. Los documentos sin coincidencia
reciben salida estandar y la aplicacion los clasifica como `OTHER`.

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
- Definir los comportamientos transversales que justificaran futuros modelos
  clinicos especializados, sin duplicar la fuente validada del documento.

## Feature diferido: carpetas de ayudas diagnosticas

Se registro un feature futuro para organizar los documentos cuya categoria final
sea `OTHER` dentro de la seccion de frontend "Ayudas diagnosticas". Los
documentos `DIAGNOSTIC_IMAGE` tambien se presentan en esa seccion, conservando
su categoria propia y su codigo de negocio.

Decision temporal confirmada: hasta recibir una nueva orden de negocio, todos los
documentos `OTHER` se muestran en esa seccion, aunque algunos no sean ayudas
diagnosticas en sentido medico. La agrupacion de interfaz no crea una categoria
nueva ni modifica la clasificacion de IA.

El feature permitira crear, renombrar y eliminar carpetas, asi como mover por
animal documentos desde la raiz y entre carpetas. Su implementacion queda
diferida hasta terminar y validar los blueprints actuales.

La estrategia detallada, restricciones propuestas y decisiones que deben
discutirse antes de programar estan en
[`diagnostic-aid-folders-strategy.md`](./diagnostic-aid-folders-strategy.md).
