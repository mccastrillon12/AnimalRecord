# Instructivo frontend: etiquetas medicas en espanol

## Objetivo

Esta guia esta dirigida a la persona o IA que implemente en el frontend la
presentacion de las extracciones de documentos medicos.

El backend conserva las claves tecnicas en ingles y entrega un catalogo
versionado con etiquetas en espanol. El frontend debe usar ese catalogo para
renderizar y editar el JSON sin renombrar sus propiedades.

Esta implementacion aplica tanto a la revision en `REVIEW_PENDING` como a la
consulta posterior de `validatedExtraction` en documentos `ACCEPTED`.

## Instruccion de ejecucion para la IA del frontend

Antes de escribir codigo, inspeccionar el proyecto frontend y localizar el
cliente HTTP autenticado, los modelos de documentos medicos, el estado del
formulario de revision, los componentes que muestran pares clave-valor y sus
pruebas. Implementar este contrato reutilizando la arquitectura, gestion de
estado, componentes y estilos existentes.

La tarea no termina al crear los modelos del catalogo: se deben reemplazar los
titulos generados desde claves inglesas en todas las pantallas de revision y
consulta, conservar el payload canonico al editar, agregar cache y cubrir los
casos de prueba de esta guia. No modificar el flujo de carga, polling,
clasificacion ni aceptacion salvo lo necesario para integrar la presentacion.

## Regla principal

Separar siempre estos dos conceptos:

- **Dato:** el JSON canonico devuelto por el backend, por ejemplo
  `laboratoryResults[].referenceRange`.
- **Presentacion:** la etiqueta obtenida del catalogo, por ejemplo
  `Rango de referencia`.

El frontend no debe crear una copia del JSON con claves traducidas. Al aceptar
un documento, `validatedExtraction` debe conservar exactamente las claves
canonicas recibidas.

## Endpoint

```http
GET /medical-documents/field-catalog?category=LABORATORY_RESULT&locale=es-CO
Authorization: Bearer <access-token>
```

Tambien se acepta `locale=es`; la respuesta se normaliza a `es-CO`. Una
categoria invalida, un locale no soportado o la ausencia de `category` produce
`400` cuando la validacion global del backend esta activa.

Ejemplo abreviado:

```json
{
  "catalogVersion": "1.0.0",
  "locale": "es-CO",
  "category": "LABORATORY_RESULT",
  "categoryLabel": "Resultado de laboratorio",
  "sections": [
    { "key": "general", "label": "Información general", "order": 10 },
    {
      "key": "laboratoryResults",
      "label": "Resultados de laboratorio",
      "order": 60
    }
  ],
  "fields": [
    {
      "path": "documentDate",
      "label": "Fecha del documento",
      "sectionKey": "general",
      "order": 40,
      "kind": "DATE",
      "editable": true,
      "hideWhenEmpty": true
    },
    {
      "path": "laboratoryResults",
      "label": "Resultados de laboratorio",
      "sectionKey": "laboratoryResults",
      "order": 10,
      "kind": "TABLE",
      "editable": true,
      "hideWhenEmpty": true,
      "columns": [
        {
          "key": "name",
          "label": "Prueba o analito",
          "kind": "TEXT",
          "order": 10,
          "editable": true,
          "hideWhenEmpty": true
        },
        {
          "key": "referenceRange",
          "label": "Rango de referencia",
          "kind": "TEXT",
          "order": 50,
          "editable": true,
          "hideWhenEmpty": true
        }
      ]
    }
  ],
  "hiddenTechnicalKeys": ["id", "confidence", "source"]
}
```

La respuesta real contiene todas las secciones y campos permitidos para la
categoria.

## Modelos sugeridos

Adaptar los nombres a las convenciones del frontend actual. En Dart pueden
representarse asi:

```dart
enum MedicalFieldKind {
  text,
  longText,
  date,
  list,
  table,
  dynamicObject,
}

class MedicalFieldCatalog {
  final String catalogVersion;
  final String locale;
  final String category;
  final String categoryLabel;
  final List<MedicalFieldSection> sections;
  final List<MedicalFieldDefinition> fields;
  final Set<String> hiddenTechnicalKeys;
}

class MedicalFieldSection {
  final String key;
  final String label;
  final int order;
}

class MedicalFieldDefinition {
  final String path;
  final String label;
  final String sectionKey;
  final int order;
  final MedicalFieldKind kind;
  final bool editable;
  final bool hideWhenEmpty;
  final List<MedicalTableColumn> columns;
  final String? fallbackLabel;
}

class MedicalTableColumn {
  final String key;
  final String label;
  final int order;
  final MedicalFieldKind kind;
  final bool editable;
  final bool hideWhenEmpty;
}
```

No convertir los valores medicos a tipos numericos. Fechas, resultados,
unidades y rangos se extraen como texto porque se debe conservar el formato
visible del documento.

## Secuencia de implementacion

1. Cuando exista una extraccion para revisar o consultar, obtener el catalogo
   con `validatedExtraction.documentType` o con el `documentType` del borrador
   y `locale=es-CO`. No usar `finalCategory` si es diferente.
2. Almacenar el catalogo en cache usando como clave `category + locale` y
   conservar `catalogVersion` junto al valor.
3. Mantener la extraccion original en el estado del formulario como
   `Map<String, dynamic>` o en modelos que serialicen las mismas claves.
4. Ordenar `sections` por `order`.
5. Para cada seccion, seleccionar los `fields` cuyo `sectionKey` coincide y
   ordenarlos por `order`.
6. Resolver el valor de cada campo leyendo `field.path` sobre la extraccion.
   Los puntos representan objetos anidados; por ejemplo `patient.name`.
7. Si `hideWhenEmpty` es `true`, ocultar solo valores ausentes, `null`, texto
   vacio, listas vacias u objetos vacios. El numero `0` y el booleano `false`
   no son valores vacios.
8. Elegir el control visual con `kind` y respetar `editable`.
9. Al editar, escribir el valor en la misma ruta canonica. Nunca usar `label`
   como clave del mapa.
10. Al aceptar, serializar el borrador canonico como `validatedExtraction` sin
    agregar al payload el catalogo, las etiquetas ni estado visual.

## Renderizado por tipo

| `kind`           | Comportamiento recomendado                                      |
| ---------------- | --------------------------------------------------------------- |
| `TEXT`           | Campo de texto de una linea                                     |
| `LONG_TEXT`      | Campo de texto multilínea                                       |
| `DATE`           | Texto editable con ayuda de fecha; preservar el valor original  |
| `LIST`           | Lista de textos editable; no concatenarla para guardar          |
| `TABLE`          | Tabla o tarjetas repetibles usando `columns`                    |
| `DYNAMIC_OBJECT` | Bloque especial para pares desconocidos de `additionalFields`   |

En pantallas estrechas, `TABLE` puede renderizarse como una lista de tarjetas.
La semantica no cambia: cada tarjeta sigue siendo un objeto de la lista y sus
claves son las descritas en `columns`.

## Tablas y metadatos tecnicos

Para un campo `TABLE`:

- Leer la lista ubicada en `field.path`.
- Ordenar `columns` por `order`.
- Usar `column.key` para leer y actualizar cada celda.
- Usar `column.label` solo como texto visible.
- Ocultar una columna vacia en todas las filas si `hideWhenEmpty` es `true`.
- Conservar en cada fila las claves tecnicas indicadas en
  `hiddenTechnicalKeys`, aunque no tengan una columna visible.

Por ejemplo, al editar `medications[0].dose`, el frontend debe preservar
`medications[0].id`, `medications[0].confidence` y
`medications[0].source`. Reconstruir una fila solamente a partir de las
columnas visibles perderia esos datos y puede romper las asignaciones por
animal.

## Campos adicionales

`additionalFields` es un objeto dinamico. Sus claves no pueden conocerse al
publicar el catalogo.

Reglas:

- Conservar cada clave y cada valor originales.
- Agruparlos bajo la seccion cuyo `sectionKey` es `additional`.
- Usar `fallbackLabel` como etiqueta visible. Si hay varios valores, agregar
  un consecutivo local, por ejemplo `Campo adicional 1` y
  `Campo adicional 2`.
- No mostrar la clave inglesa desconocida como titulo principal.
- Si la pantalla necesita trazabilidad, la clave original puede mostrarse
  como texto tecnico secundario, nunca sustituir la etiqueta espanola.
- No llamar una IA, AWS ni un traductor desde el frontend para generar la
  etiqueta.

El consecutivo es solo presentacion; no se envia al backend.

## Campos que no esten en el catalogo

No renderizar automaticamente propiedades desconocidas de la extraccion. Se
deben preservar al clonar o serializar el borrador, pero no exponer como campos
editables hasta que el backend publique una definicion. La unica excepcion es
el contenido de `additionalFields`, que usa la regla anterior.

Esto evita que un nuevo metadato interno aparezca en produccion con una etiqueta
inglesa o que el usuario pueda modificarlo por accidente.

## Reglas medicas obligatorias

- No traducir resultados, nombres de pruebas, medicamentos, unidades, rangos,
  banderas, observaciones ni texto del documento.
- No calcular si un resultado de laboratorio es alto, bajo o normal.
- No agregar colores o alertas comparando `result` con `referenceRange`.
- Mostrar `flag` solo cuando el documento lo trae impreso.
- En imagen diagnostica, `reportedDiagnosis` significa un diagnostico escrito
  literalmente en el archivo. No analizar los pixeles ni generar hallazgos.
- Las etiquetas `Interpretacion reportada`, `Hallazgos clinicos reportados` y
  `Pronostico reportado` no autorizan al frontend a producir ese contenido.
- No cambiar la categoria detectada usando el catalogo.

## Cache y errores

- El endpoint responde con `Cache-Control: private, max-age=3600`.
- Mantener como maximo una solicitud en curso por combinacion de categoria y
  locale.
- No solicitar el catalogo en cada ciclo de polling.
- Si la categoria cambia durante la revision, cargar el catalogo de la nueva
  categoria antes de construir el formulario correspondiente.
- Si falla la carga y no existe cache, mostrar un estado reintentable. No volver
  al mapa ingles ni generar etiquetas a partir de `snake_case` o `camelCase`.
- Un catalogo de otra categoria no puede usarse como fallback.

## Pruebas minimas del frontend

1. `patient.name` se muestra como `Nombre del paciente` y al editarlo se envia
   nuevamente como `patient.name`.
2. `laboratoryResults[].referenceRange` se muestra como
   `Rango de referencia` y conserva valores como `5,5 - 8,5` sin parsearlos.
3. `laboratoryResults[].flag` no se calcula ni se infiere.
4. Una tabla conserva `id`, `confidence` y `source` despues de editar una celda.
5. `diagnosticImages[].reportedDiagnosis` solo muestra el texto recibido.
6. Una imagen diagnostica sin `reportedDiagnosis` no crea ese campo ni muestra
   un diagnostico inferido.
7. Dos claves de `additionalFields` se presentan con etiquetas genericas, pero
   se devuelven con sus claves originales.
8. Un campo desconocido fuera de `additionalFields` se preserva y no se
   renderiza.
9. La misma categoria reutiliza el catalogo cacheado durante el polling.
10. Cambiar la categoria estructural de la extraccion cambia secciones y campos
    sin mezclar catalogos; cambiar solo `finalCategory` no cambia el catalogo.
11. La aceptacion no incluye `catalogVersion`, `label`, `sectionKey` ni
    `categoryLabel` dentro de `validatedExtraction`.
12. Si el endpoint del catalogo falla, la interfaz permite reintentar y no
    muestra claves inglesas al usuario.

## Criterio de finalizacion

La implementacion queda terminada cuando todas las pantallas de revision y
consulta de documentos medicos:

- usan el catalogo del backend como unica fuente de etiquetas;
- mantienen separado el JSON medico de su presentacion;
- preservan claves y metadatos tecnicos al editar;
- soportan campos ausentes y tablas variables;
- muestran etiquetas espanolas sin traducir valores medicos;
- manejan cache, cambio de categoria y error de catalogo;
- pasan las pruebas anteriores.
