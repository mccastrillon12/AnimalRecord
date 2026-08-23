# Estrategia diferida: carpetas de ayudas diagnosticas

## Condicion de este documento

Este documento registra un posible nuevo feature para organizar documentos de
categoria `OTHER` dentro de la interfaz "Ayudas diagnosticas".

Estado: **borrador funcional para discusion**.

Este documento no autoriza todavia cambios de codigo, contratos HTTP, MongoDB o
S3. La implementacion se analizara despues de terminar, publicar y validar el
trabajo pendiente de blueprints de documentos medicos.

Antes de implementar se deben resolver las decisiones pendientes incluidas al
final y actualizar este documento con el comportamiento definitivo.

La fuente de verdad general del flujo sigue siendo
[`medical-document-strategy.md`](./medical-document-strategy.md).

## Decision funcional confirmada

Durante la primera version del feature:

- Todo documento cuya `finalCategory` sea `OTHER` se muestra en la seccion
  "Ayudas diagnosticas" del frontend.
- Esta agrupacion es una decision temporal de producto.
- Puede incluir informes diagnosticos aislados y tambien otros documentos no
  clasificados, aunque algunos no sean ayudas diagnosticas en sentido medico.
- Hasta recibir una nueva instruccion de negocio, no se introduce una categoria
  canonica nueva para ayudas o resultados diagnosticos.
- Las carpetas organizan documentos; no cambian la categoria detectada, la
  categoria final, la extraccion validada ni la auditoria de IA.

La interfaz no debe presentar un documento `OTHER` como si la IA hubiera
detectado una categoria medica. "Ayudas diagnosticas" es el nombre de la seccion
de organizacion, no una nueva deteccion de IA.

## Objetivo futuro

Permitir que el usuario organice los documentos `OTHER` asociados a un animal
dentro de una raiz permanente llamada "Ayudas diagnosticas".

El usuario podra:

- Consultar los documentos ubicados en la raiz.
- Crear carpetas personalizadas.
- Cambiar el nombre de una carpeta.
- Eliminar una carpeta.
- Consultar los documentos de una carpeta.
- Mover documentos desde la raiz a una carpeta.
- Mover documentos entre carpetas.
- Devolver documentos desde una carpeta a la raiz.

La estructura logica debe tener correspondencia con la organizacion fisica de
los objetos en S3, sin convertir a S3 en la fuente de verdad funcional.

## Alcance inicial recomendado

Para controlar complejidad y riesgo, la primera version deberia cumplir estas
restricciones:

- Solo aplica a documentos `ACCEPTED` con `finalCategory = OTHER`.
- Las carpetas pertenecen a un animal.
- Existe un solo nivel de carpetas; no hay subcarpetas.
- La raiz "Ayudas diagnosticas" siempre existe.
- La raiz no puede renombrarse ni eliminarse.
- El nombre del archivo original no cambia al moverlo.
- Mover un documento no ejecuta un nuevo analisis de IA.
- Mover un documento no cambia `requestedCategory`, detecciones,
  `classificationOutcome`, `finalCategory` ni `validatedExtraction`.
- El frontend nunca consulta ni modifica S3 directamente.

Estas restricciones son propuestas y deben confirmarse antes de implementar.

## Separacion de conceptos

No deben mezclarse estos conceptos:

### Categoria documental

Continua siendo `OTHER`. Describe la decision final del documento dentro del
flujo medico.

### Seccion de interfaz

"Ayudas diagnosticas" es el lugar donde el frontend muestra temporalmente todos
los documentos `OTHER`.

### Carpeta logica

Es una entidad creada por el usuario para organizar documentos de un animal. Su
nombre es editable y no debe utilizarse como identificador permanente.

### Colocacion del documento

Indica en que carpeta se encuentra la copia de un documento para un animal
concreto. La colocacion raiz se representa sin carpeta personalizada.

### Ubicacion fisica

Es la clave S3 concreta de la copia del archivo para ese animal. Es un detalle
de infraestructura derivado de la colocacion logica.

## Regla para documentos asociados a varios animales

El sistema actual conserva una copia fisica del archivo por cada animal
asociado. Por esa razon, la carpeta no debe almacenarse como una unica propiedad
global del documento.

La colocacion debe formar parte de cada ubicacion por animal. Esto permite que el
mismo documento se encuentre, por ejemplo:

- En "Laboratorios" para el animal A.
- En la raiz de "Ayudas diagnosticas" para el animal B.

Propuesta de evolucion del contrato interno:

```ts
type MedicalDocumentLocation = {
  animalId: string;
  storageKey: string;
  diagnosticAidFolderId?: string;
};
```

La ausencia de `diagnosticAidFolderId` representa la raiz.

Una operacion iniciada desde la pantalla de un animal deberia mover solamente la
copia y colocacion de ese animal. Mover todas las copias requeriria una accion
global explicita; no debe ocurrir como efecto oculto.

## Modelo de carpeta propuesto

Entidad conceptual:

```ts
type DiagnosticAidFolder = {
  id: string;
  ownerId: string;
  animalId: string;
  name: string;
  normalizedName: string;
  status: 'ACTIVE' | 'DELETING';
  version: number;
  createdAt: string;
  updatedAt: string;
};
```

Reglas recomendadas:

- El `id` es un UUID estable.
- El nombre se recorta antes de validar y guardar.
- No se permiten nombres vacios, separadores de ruta ni caracteres de control.
- Se debe definir una longitud maxima.
- Los nombres deberian ser unicos por animal ignorando mayusculas, minusculas y
  espacios externos.
- Renombrar conserva el mismo `id`.
- Las operaciones mutables usan `version` para evitar sobrescrituras
  concurrentes.
- Una carpeta en estado `DELETING` no recibe nuevos documentos.

MongoDB debe ser la fuente de verdad para nombres, existencia, propiedad y
estado de las carpetas. El frontend no debe construir la jerarquia listando
objetos de S3.

## Estrategia S3 propuesta

La ruta actual de documentos `OTHER` puede mantenerse como raiz para conservar
compatibilidad:

```text
users/{ownerId}/animals/{animalId}/medical-documents/other/{documentId}/source.{extension}
```

Para una carpeta personalizada se propone:

```text
users/{ownerId}/animals/{animalId}/medical-documents/other/folders/{folderId}/{documentId}/source.{extension}
```

Para que una carpeta vacia tenga representacion fisica en S3 puede utilizarse un
objeto marcador o manifiesto:

```text
users/{ownerId}/animals/{animalId}/medical-documents/other/folders/{folderId}/_folder.json
```

El manifiesto puede incluir el nombre visible y la version de la carpeta, pero
no reemplaza el registro de MongoDB.

### Por que no usar el nombre como identidad fisica

S3 usa claves y prefijos, no directorios tradicionales. Si el nombre visible
forma parte de todas las claves, renombrar una carpeta obliga a copiar y eliminar
cada objeto que comparte ese prefijo.

La estrategia recomendada utiliza `folderId` estable en las claves. Renombrar
actualiza MongoDB y el marcador `_folder.json`, sin recopy de todos los archivos.

Queda pendiente confirmar si el negocio exige que el nombre humano sea visible
literalmente como prefijo en la consola de S3. Esa exigencia cambia el coste, la
duracion y el manejo de errores del renombrado.

## Creacion de carpeta

Flujo propuesto:

1. Validar que el animal pertenece al usuario.
2. Validar y normalizar el nombre.
3. Comprobar unicidad dentro del animal.
4. Crear la carpeta en MongoDB.
5. Crear el marcador `_folder.json` en S3.
6. Si falla S3, compensar o dejar la carpeta en un estado recuperable explicito.
7. Devolver la representacion creada al frontend.

La respuesta no debe exponer bucket, claves S3 ni credenciales.

## Renombrado de carpeta

Flujo propuesto con identificador estable:

1. Validar propiedad, estado y version.
2. Validar el nuevo nombre y su unicidad.
3. Actualizar MongoDB mediante control de version.
4. Actualizar el marcador S3.
5. Registrar o reintentar la sincronizacion del marcador si S3 falla.

Los documentos no cambian de clave porque permanecen bajo el mismo `folderId`.

## Movimiento de documento

Mover un documento entre carpetas implica cambiar su clave S3. Para buckets S3
generales, el movimiento se implementa como copia al destino seguida de
eliminacion del origen.

Flujo seguro propuesto:

1. Validar usuario, animal, documento y carpeta destino.
2. Confirmar que el documento esta `ACCEPTED` y su `finalCategory` es `OTHER`.
3. Confirmar que existe una ubicacion del documento para ese animal.
4. Confirmar que la carpeta destino pertenece al mismo animal y esta `ACTIVE`.
5. Calcular una clave destino solo con identificadores validados.
6. Copiar el objeto de origen a la clave destino.
7. Persistir la nueva colocacion y `storageKey` con control de version.
8. Eliminar el objeto anterior.

Compensacion esperada:

- Si falla la copia, no se modifica MongoDB.
- Si falla MongoDB despues de copiar, se elimina la copia nueva.
- Si MongoDB confirma el destino pero falla la eliminacion del origen, la nueva
  ubicacion permanece como oficial y el origen queda registrado para limpieza.
- Los reintentos deben ser idempotentes.
- La descarga siempre usa la ubicacion oficial persistida, no una busqueda por
  prefijo.

## Eliminacion de carpeta

Comportamiento recomendado para evitar perdida accidental:

- Eliminar una carpeta no elimina sus documentos.
- Sus documentos se mueven a la raiz de "Ayudas diagnosticas".
- La carpeta pasa primero a `DELETING` para bloquear nuevos movimientos.
- Se mueve cada ubicacion de forma segura.
- Cuando no quedan documentos, se elimina el marcador S3 y el registro logico.
- La raiz no se puede eliminar.

Si una carpeta puede contener muchos documentos, la eliminacion debe ejecutarse
como trabajo asincrono y exponer estado al frontend. No se debe mantener una
solicitud HTTP abierta mientras se copian cantidades no acotadas de objetos.

Eliminar carpeta y eliminar documentos deberian ser acciones distintas. La
eliminacion masiva de documentos no forma parte del alcance inicial.

## Contratos HTTP propuestos

Los nombres definitivos deben revisarse con las convenciones del backend.

```text
GET    /animals/{animalId}/diagnostic-aid-folders
POST   /animals/{animalId}/diagnostic-aid-folders
PATCH  /animals/{animalId}/diagnostic-aid-folders/{folderId}
DELETE /animals/{animalId}/diagnostic-aid-folders/{folderId}
```

Movimiento individual:

```text
PUT /animals/{animalId}/medical-documents/{documentId}/folder
```

Payload propuesto:

```json
{
  "targetFolderId": "UUID o null para raiz",
  "documentVersion": 2
}
```

Consultas propuestas:

```text
GET /animals/{animalId}/medical-documents?category=OTHER&folderId=root
GET /animals/{animalId}/medical-documents?category=OTHER&folderId={UUID}
```

La respuesta de documentos debera exponer la colocacion del animal solicitado,
pero no su clave S3 privada.

## Responsabilidades del frontend

El frontend debera:

- Mostrar todos los documentos `OTHER` dentro de "Ayudas diagnosticas" durante
  esta primera etapa.
- Tratar la raiz como una ubicacion permanente.
- Consumir carpetas desde la API, no inferirlas desde rutas.
- Permitir crear, renombrar y eliminar carpetas.
- Permitir mover uno o varios documentos cuando el backend ofrezca el contrato.
- Mostrar estados de movimiento o eliminacion asincrona cuando correspondan.
- Evitar acciones duplicadas mientras una operacion esta en curso.
- Actualizar su estado con la respuesta confirmada por el backend.
- No cambiar localmente `finalCategory` para representar una carpeta.
- No llamar directamente a S3.

## Seguridad y autorizacion

Toda operacion debe comprobar:

- Que el usuario autenticado es propietario del animal.
- Que la carpeta pertenece al mismo usuario y animal.
- Que el documento pertenece al usuario y esta asociado al animal indicado.
- Que existe una ubicacion fisica para ese animal.
- Que el documento cumple `status = ACCEPTED` y `finalCategory = OTHER`.
- Que el destino no permite escapar del prefijo autorizado.

Los nombres suministrados por usuarios nunca se concatenan directamente a una
clave S3 sin normalizacion. La estrategia preferida evita ese riesgo usando UUID.

## Auditoria y recuperacion

Se recomienda registrar como minimo:

- Creacion, renombrado y eliminacion de carpeta.
- Usuario que realizo la accion.
- Movimiento de documento, animal, origen y destino logicos.
- Fecha, version y resultado de la operacion.
- Copias S3 pendientes de limpieza o compensacion.

MongoDB y S3 no comparten una transaccion atomica. Debe existir un mecanismo de
reintento o reconciliacion para operaciones que queden parcialmente completadas.

## Compatibilidad y migracion

Los documentos `OTHER` aceptados antes de este feature se consideran ubicados en
la raiz aunque sus registros no tengan `diagnosticAidFolderId`.

No se necesita moverlos para poder mostrarlos en la raiz. Solo cambian de clave
cuando el usuario los mueve a una carpeta personalizada o cuando se ejecute una
migracion explicita posterior.

El lector debe conservar compatibilidad con `documentLocations` anteriores que
solo contienen `animalId` y `storageKey`.

## Matriz minima de pruebas futura

- Listar la raiz con documentos `OTHER` existentes.
- Crear una carpeta vacia y verla en MongoDB y S3.
- Rechazar nombre vacio, duplicado o peligroso.
- Renombrar una carpeta sin mover sus documentos.
- Mover un documento desde raiz a carpeta.
- Mover un documento entre carpetas.
- Devolver un documento a raiz.
- Mover solo la copia del animal seleccionado en un documento multianimal.
- Impedir mover documentos de otra categoria.
- Impedir mover documentos no aceptados.
- Impedir usar una carpeta de otro animal o usuario.
- Resolver dos movimientos concurrentes mediante version.
- Compensar una copia S3 fallida.
- Compensar un fallo de MongoDB despues de copiar.
- Recuperar una eliminacion del objeto origen fallida.
- Eliminar carpeta vacia.
- Eliminar carpeta con documentos moviendolos a raiz.
- Bloquear nuevos movimientos durante `DELETING`.
- Descargar el documento desde su nueva ubicacion.
- Mantener compatibilidad con ubicaciones anteriores sin `folderId`.

## Decisiones pendientes antes de implementar

Las siguientes decisiones deben discutirse y quedar resueltas en este documento:

1. Confirmar que las carpetas pertenecen a cada animal y no globalmente al
   usuario.
2. Confirmar que la primera version no permite subcarpetas.
3. Confirmar que eliminar una carpeta mueve sus documentos a raiz.
4. Confirmar que un movimiento desde un animal afecta solo su copia.
5. Definir longitud maxima, nombres reservados y regla exacta de unicidad.
6. Definir si el nombre humano debe verse literalmente en la ruta S3 o si basta
   con `folderId` estable y un manifiesto.
7. Definir si el usuario puede elegir carpeta durante la aceptacion o solamente
   despues de aceptar en raiz.
8. Definir si se necesita movimiento masivo y su limite por operacion.
9. Definir si eliminar carpetas se procesa siempre de forma asincrona.
10. Definir la politica de auditoria y retencion de operaciones.
11. Definir si en una fase futura `OTHER` se separara en ayuda diagnostica y otro
    generico.

## Orden futuro de implementacion

Cuando el trabajo de blueprints haya terminado y el negocio apruebe las
decisiones pendientes:

1. Actualizar este documento y la estrategia principal con las decisiones
   definitivas.
2. Diseñar dominio, persistencia e indices.
3. Definir contratos HTTP y Swagger.
4. Implementar carpetas logicas y autorizacion.
5. Implementar colocacion por animal y movimientos S3 compensables.
6. Implementar eliminacion segura y reconciliacion.
7. Actualizar la integracion frontend.
8. Migrar o interpretar documentos `OTHER` anteriores como raiz.
9. Ejecutar pruebas unitarias, integrales, de concurrencia y fallos parciales.
10. Desplegar primero backend y despues habilitar la interfaz.

