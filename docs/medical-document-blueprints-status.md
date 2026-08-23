# Traspaso: documentos medicos con AWS Bedrock Data Automation

## Proposito

Este documento permite retomar el desarrollo del flujo de documentos medicos en
otra tarea sin depender del historial completo de la conversacion.

Debe leerse despues de:

1. `AGENTS.md`.
2. `docs/medical-document-strategy.md`, fuente de verdad funcional.
3. `docs/medical-document-ai.md`, estado tecnico del backend.

La estrategia describe el comportamiento objetivo. Este documento registra el
estado operativo observado durante las pruebas de los blueprints y los asuntos
pendientes. La configuracion de la consola de AWS no se administra ni se
sincroniza automaticamente desde este repositorio.

## Reglas de negocio confirmadas

### Formas de carga

El frontend admite dos entradas:

1. **Carga desde una categoria:** el usuario entra, por ejemplo, a formulas,
   remisiones o historias clinicas. El frontend envia esa categoria como la
   intencion del usuario.
2. **Carga general:** no se envia una categoria inicial. El sistema debe detectar
   todas las categorias presentes.

La categoria solicitada por el usuario es contexto, no es la verdad de
clasificacion. La deteccion debe provenir del contenido y de la salida de AWS.

### Revision y decision humana

- La IA puede detectar una o varias categorias en un mismo archivo.
- El frontend muestra la categoria solicitada, las categorias detectadas y la
  informacion extraida.
- El usuario selecciona una unica categoria final.
- Se aplica la opcion de negocio B: al aceptar, solo se persiste la informacion
  que corresponde a la categoria final elegida.
- Esta regla aplica a todos los documentos, no solamente a historias clinicas.
- El documento puede asociarse a uno o varios animales enviados por el frontend.
- Si no coincide con ninguna categoria medica conocida, debe clasificarse como
  `OTHER` y devolver la informacion general util que se haya podido extraer.

### Aceptacion y rechazo

- **Aceptado:** se guarda el archivo original bajo cada animal y la categoria
  final; tambien se persiste en base de datos la informacion estructurada de esa
  categoria para que el frontend pueda consultarla sin descargar el archivo.
- **Rechazado:** no debe quedar informacion medica permanente. Deben eliminarse
  los objetos temporales de entrada y salida de AWS/S3 conforme al flujo de
  limpieza implementado.

## Flujo tecnico actual

El procesamiento funciona de forma asincrona:

1. `POST /medical-documents/analyze` crea el documento e inicia el trabajo.
2. `GET /medical-documents/:documentId` consulta el estado. Mientras esta en
   `ANALYZING`, el backend tambien actualiza el trabajo de AWS.
3. Al llegar a `REVIEW_PENDING`, el frontend presenta el resultado al usuario.
4. `PUT /medical-documents/:documentId/review` acepta o rechaza el documento.
5. Los documentos aceptados se consultan mediante
   `GET /animals/:animalId/medical-documents`.
6. `GET /medical-documents/:documentId/download-url` genera la descarga del
   original cuando se necesita.

Los contratos exactos de entrada y salida deben consultarse en Swagger y en los
DTO del repositorio. No deben inferirse solamente a partir de este resumen.

## Configuracion AWS observada

La siguiente configuracion fue creada y probada manualmente por el usuario en la
consola de AWS:

- Region: `us-east-1`.
- Bucket S3: `animal-record-profile-pictures`.
- Proyecto BDA: `animal-record-medical-documents`.
- ARN del proyecto:
  `arn:aws:bedrock:us-east-1:590184143435:data-automation-project/55d040f23bb1`.
- `Document splitter`: habilitado.
- El proyecto contiene cinco blueprints de modalidad `DOCUMENT`.

Blueprint IDs observados:

| Categoria | Blueprint ID |
| --- | --- |
| `PRESCRIPTION` | `d0de3e9c83ac` |
| `MEDICAL_ORDER` | `ce4e5dabcd60` |
| `REFERRAL` | `3c10186a8e41` |
| `VACCINATION_CARD` | `97a5a391b4bf` |
| `CLINICAL_HISTORY` | `edf9b4d06901` |

AWS crea versiones inmutables, por ejemplo nombres con sufijo `_v1` o `_v2`.
Antes de nuevas pruebas se debe verificar en la consola que el proyecto contiene
la version publicada mas reciente de cada blueprint y no su version anterior.

Verificacion del 2026-08-08: el proyecto contiene exactamente estas cinco
versiones publicadas:

- `animal-record-prescription_v2`.
- `animal-record-medical-order_v2`.
- `animal-record-referral_v2`.
- `animal-record-vaccination-card_v2`.
- `animal-record-clinical-history_v2`.

Las salidas observadas de BDA quedan bajo rutas similares a:

```text
.../<invocation-id>/0/custom_output/0/result.json
.../<invocation-id>/0/standard_output/0/result.json
.../<invocation-id>/job_metadata.json
```

El backend ya fue ajustado para leer esta estructura anidada; antes de ese ajuste
el endpoint de consulta respondia `502` aunque AWS hubiera terminado con exito.

## Contrato comun de los blueprints

Todos los blueprints medicos deben devolver datos estructurados y conservar los
mismos nombres para facilitar el mapeo del frontend.

### Propietario

Objeto `owner`:

- `name`
- `identification`
- `phone`
- `email`
- `address`

Los campos ausentes quedan vacios; no se inventan datos.

### Paciente

Objeto `patient`:

- `name`
- `identifier`
- `species`
- `breed`
- `sex`
- `reproductive_status`
- `age`
- `birth_date`
- `weight`
- `color`
- `size`
- `microchip`

`patient_hints` queda solamente como respaldo para fragmentos no estructurables.
No debe ser la fuente principal del frontend porque un arreglo de textos no
permite saber de forma confiable cual valor es nombre, edad, raza u otro dato.

### Secciones y clasificacion

Tabla `document_sections`:

- `category`
- `page_start`
- `page_end`
- `summary`
- `evidence`

Categorias conocidas:

- `PRESCRIPTION`
- `MEDICAL_ORDER`
- `REFERRAL`
- `VACCINATION_CARD`
- `CLINICAL_HISTORY`
- `OTHER`, cuando no hay evidencia de una categoria medica conocida.

### Restricciones del editor de BDA encontradas

- Para paginas se debe usar `number`; BDA rechazo `integer`.
- Una propiedad con `$ref` no puede tener ademas `type`, `inferenceType`, `enum`
  o `items`.
- La raiz de una definicion referenciada no debe declarar `inferenceType`.
- Las definiciones usadas como tablas, como `DOCUMENT_SECTION` o una tabla de
  vacunas, no deben llevar `inferenceType` en la raiz de la definicion.
- Al modificar un blueprint se debe pegar el JSON completo. Evitar aplicar
  fragmentos aislados porque fue una fuente recurrente de errores en la consola.
- La inferencia no es determinista: una segunda ejecucion puede recuperar campos
  que faltaron en la primera. Esto no sustituye las pruebas con varias muestras.

## Estado de cada blueprint

### `REFERRAL`

Estado: estructura nueva probada con la remision `OkVet remision BENJI (1).pdf`.

Resultado confirmado:

- Detecto `REFERRAL`.
- Extrajo el propietario como objeto estructurado.
- Extrajo el paciente como objeto estructurado.
- Extrajo motivo, destino, resumen clinico y datos adicionales de la remision.

Confirmado: `animal-record-referral_v2` esta publicada y asociada al proyecto
BDA.

### `PRESCRIPTION`

Estado: probado con `Formula 3.pdf` y `Formula 1.jpg`.

Resultado confirmado:

- `owner` y `patient` estructurados.
- Medicamentos en tabla.
- `document_sections.category = PRESCRIPTION`.
- La formula 3 tuvo una ejecucion sin datos estructurados del paciente, pero al
  repetirla los extrajo correctamente. Debe conservarse esta muestra en las
  pruebas de regresion.

Confirmado: `animal-record-prescription_v2` esta publicada y asociada al
proyecto BDA.

### `MEDICAL_ORDER`

Estado: probado con `orden 2` y `orden 1`.

Resultado confirmado:

- `owner` y `patient` estructurados.
- Ordenes medicas en tabla.
- `document_sections.category = MEDICAL_ORDER`.

Confirmado: `animal-record-medical-order_v2` esta publicada y asociada al
proyecto BDA.

### `VACCINATION_CARD`

Estado: probado con certificados PDF y fotografias, incluyendo `vacuna.pdf` y
`vacuna 2.jpg`.

Resultado confirmado:

- `owner` y `patient` estructurados.
- Vacunas en tabla.
- `document_sections.category = VACCINATION_CARD`.

Observacion: el OCR puede producir errores menores en manuscritos, por ejemplo
`Macho` interpretado como `Malho`. El usuario debe poder corregirlos durante la
revision.

Confirmado: `animal-record-vaccination-card_v2` esta publicada y asociada al
proyecto BDA.

### `CLINICAL_HISTORY`

Estado: extraccion y clasificacion interna funcionales en
`animal-record-clinical-history_v2`.

La prueba con `historia clinica 2.png` extrajo correctamente:

- Propietaria Andrea Restrepo.
- Paciente Luna y sus datos estructurados.
- Anamnesis, examen fisico, diagnosticos y plan.
- Resultados diagnosticos.
- Medicamentos y orden de control.

Problema resuelto:

- La historia simple producia una fila de `document_sections` con paginas y
  resumen, pero dejaba `category` vacio.
- Se sustituyo la instruccion especializada de `DOCUMENT_SECTION.category` por
  el contrato comun ya probado en los otros cuatro blueprints.
- La historia simple ahora devuelve `category = CLINICAL_HISTORY` y conserva la
  extraccion clinica esperada.

Comportamiento multiseccion que ya se observo correctamente en una historia
clinica de varias paginas:

- `CLINICAL_HISTORY`, paginas 1 a 10.
- `VACCINATION_CARD`, paginas 6 a 7.
- `PRESCRIPTION`, pagina 7.

Ese comportamiento se conservo despues del ajuste. La nueva version fue
publicada y asociada al proyecto BDA el 2026-08-08.

Nuevo hallazgo de cumplimiento con
`ALBONDIGA PRE QX PARTICULAR 09-06-2018.pdf`:

- El archivo es un informe aislado de laboratorio con hemograma y quimica
  sanguinea; no contiene consulta, anamnesis, examen fisico, diagnostico,
  evolucion ni plan.
- `animal-record-clinical-history_v2` hizo un falso match como
  `CLINICAL_HISTORY` con confianza `0.6725593`.
- BDA genero conclusiones no escritas en el documento, incluyendo neutrofilia
  relativa, creatinina elevada y ALT normal.
- El documento solo contiene de forma expresa los valores, referencias y dos
  comentarios morfologicos del laboratorio.

Correccion local:

- La estrategia clasifica informes diagnosticos aislados como `OTHER` mientras
  no exista una categoria propia.
- El esquema de historia exige contexto real de consulta o evolucion, excluye
  informes aislados y prohibe comparar o interpretar resultados.
- El mapper degrada a `OTHER` un falso match diagnostico sin anclas clinicas,
  elimina secciones clinicas generadas y no acepta `interpretation` desde IA.

Pendiente: publicar el esquema corregido como una version posterior a
`animal-record-clinical-history_v2`, asociarla al proyecto y repetir tanto
Albóndiga como las historias simple y multiseccion.

## Validacion pendiente de clasificacion en el despliegue

La revision del backend local confirma que
`requestedCategory` no se envia a BDA ni al mapper y solo participa en el calculo
de `classificationOutcome`.

Caso observado:

- Un menu de restaurante cargado sin categoria se clasifica correctamente como
  `OTHER`.
- El mismo menu, enviado con `requestedCategory = PRESCRIPTION`, termina tratado
  como `PRESCRIPTION` aunque el contenido no sea una formula.

Regla que debe conservarse:

- `requestedCategory` nunca debe agregarse a las categorias detectadas.
- Las categorias detectadas deben salir exclusivamente de la evidencia de AWS:
  clase del blueprint, salida personalizada y `document_sections`.
- Si AWS no devuelve evidencia de una categoria conocida, el resultado debe ser
  `OTHER`.
- `classificationOutcome` se calcula comparando la categoria solicitada con las
  categorias realmente detectadas.

Cobertura local confirmada:

1. Menu sin categoria: extraccion `OTHER`, sin categorias detectadas y resultado
   `UNCLASSIFIED`.
2. Menu solicitado como `PRESCRIPTION`: extraccion `OTHER`,
   `primaryDetectedCategory` ausente, `detectedCategories: []` y resultado
   `UNCLASSIFIED`.
3. Formula solicitada como `PRESCRIPTION`: coincidencia.
4. Remision solicitada como `PRESCRIPTION`: detectar `REFERRAL` y no coincidencia.
5. Historia clinica multiseccion: devolver todas las categorias detectadas.

Las pruebas unitarias del dominio, el refresco asincrono, el mapper y el adaptador
de AWS pasan con estos casos. Como el comportamiento observado del menu no puede
producirse por el recorrido local actual, falta repetirlo contra la version
desplegada y conservar las salidas `custom_output` y `standard_output` de AWS para
distinguir entre un despliegue anterior, una coincidencia falsa del blueprint o
un problema de presentacion en el cliente.

## Prueba integral ya realizada

Documento de ejemplo:

- ID: `6332e182-3347-4728-b15f-5d1529f73092`.
- Archivo: `Formula 3.pdf`.
- Animal asociado: `bd4023d6-c745-4d29-9a61-4da558744b5f`.
- Flujo: `ANALYZING` a `REVIEW_PENDING`.
- Categoria solicitada y detectada: `PRESCRIPTION`.
- Resultado: `MATCH`.
- La descarga del original fue probada.
- La informacion aceptada debe poder consultarse desde base de datos sin
  descargar el archivo.

## Despliegue observado

- Lightsail ejecuta `ghcr.io/mccastrillon12/animalrecord:latest` con Docker.
- Watchtower consulta cada 300 segundos y usa `--cleanup`.
- Variables necesarias para BDA:
  - `AWS_BDA_REGION`
  - `AWS_BDA_PROFILE_ARN`
  - `AWS_BDA_PROJECT_ARN`
- Se indico que `.env.example` fue actualizado; debe verificarse en el siguiente
  ciclo antes de cerrar el desarrollo.
- El endurecimiento de IAM y la rotacion de credenciales se aplazaron por decision
  del usuario hasta la etapa previa a la entrega.

## Orden exacto para continuar

1. Publicar una nueva version de `CLINICAL_HISTORY` con la exclusion de informes
   diagnosticos aislados y asociarla al proyecto BDA.
2. Repetir `ALBONDIGA PRE QX PARTICULAR 09-06-2018.pdf`; debe devolver
   `detectedCategories: []`, `UNCLASSIFIED` y extraccion `OTHER` sin
   interpretacion clinica.
3. Repetir una historia simple y una multiseccion para descartar regresiones.
4. Repetir contra el despliegue el caso del menu enviado con y sin
   `requestedCategory` y conservar las salidas reales de AWS si difieren.
5. Ejecutar el flujo integral: analizar, consultar hasta `REVIEW_PENDING`, aceptar,
   consultar desde BD, descargar, rechazar y confirmar limpieza temporal.
6. Actualizar Swagger si cambia algun contrato HTTP.

## Texto listo para iniciar una nueva tarea

```text
Continua el desarrollo del flujo de documentos medicos con AWS Bedrock Data
Automation en este repositorio. Antes de actuar, lee en este orden:

1. AGENTS.md
2. docs/medical-document-strategy.md
3. docs/medical-document-ai.md
4. docs/medical-document-blueprints-status.md

La tarea inmediata es resolver por que el blueprint CLINICAL_HISTORY extrae una
fila de document_sections pero deja category vacio para una historia clinica
simple. Debe conservar la deteccion multiseccion de historias clinicas largas.
Luego se publicara la nueva version en AWS y se corregira el bug del backend que
usa requestedCategory como si fuera una categoria detectada.

No asumas acceso directo a la consola de AWS. Las acciones de consola las ejecuta
el usuario y comparte capturas o resultados. No modifiques codigo hasta revisar la
arquitectura y los documentos indicados.
```
