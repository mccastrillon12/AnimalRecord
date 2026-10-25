# Aislamiento de cargas de fotos y adjuntos

Subbloque 5 sobre `93ed9b9`. Contrato de implementación definido antes de tocar
las rutas vigentes. Estado: implementado y probado localmente con Mongo/S3 simulados; resultados
en `final-delivery-plan.md`. No cambia reglas de vencimiento/cancelación de transferencias.

## Contrato anterior y nuevo

| Área                        | Anterior                                                                    | Nuevo e integración                                                                                                                                                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| URL de foto/diario          | PUT directo a la clave final; devolvía uploadUrl/finalUrl (+ attachmentId). | Mismos campos y 300 s, sin headers nuevos. PUT a uploadUrl temporal, finalUrl es la ubicación canónica separada. Usar ambas como valores opacos, sin reconstruir rutas.                                                                                                                            |
| Disponibilidad del medio    | finalUrl podía existir después del PUT, antes de confirmar.                 | Para cargas nuevas solo está listo tras confirmación del backend. Previsualizar archivo local; no usar finalUrl como prueba del PUT ni mostrar guardado antes de la confirmación.                                                                                                                  |
| Confirmación                | Validaba ruta/metadatos declarados y guardaba referencia.                   | Para cargas nuevas verifica emisión, MIME/tamaño reales, fija revisión/hash y crea una copia final sin sobrescribir. Conserva cuerpos y respuestas exitosas. Puede devolver 400/409/502 sin guardar referencia; conservar archivo local y reintentar la misma confirmación ante error transitorio. |
| Reintento                   | Foto/adjunto idéntico idempotente al persistir.                             | También reconcilia una copia cuya respuesta S3 se perdió. No copia encima de un final existente; si lee el ticket ya sellado, no reconstruye un final borrado. Si cambió el temporal fijado y no hay versión recuperable, pedir una URL nueva y volver a cargar.                                   |
| Compatibilidad legacy       | URLs ya emitidas apuntan al destino final.                                  | Confirmaciones sin registro del nuevo protocolo conservan comportamiento anterior. NO se consideran protegidas para una transferencia; falta migración explícita antes de habilitarla.                                                                                                             |
| Foto del usuario y medicina | Flujos independientes.                                                      | Sin cambio: no se aplican staging ni contratos nuevos a esos endpoints en esta etapa.                                                                                                                                                                                                              |

La confirmación puede tardar más por copia/verificación. El 409 de archivo no
demuestra transferencia en curso: conservar el manejo por mensaje/contexto.
No hay transferencia pública ni nuevos campos en DTO del animal o diario.

## Protocolo técnico implementado

- Registro duradero por clave final única ANTES de devolver URL. Temporal
  separado y exclusivo por emisión; ninguna URL nueva firma PUT sobre el final.
- Primera confirmación fija revisión ETag/VersionId y SHA-256 con comparación
  atómica. Confirmaciones concurrentes usan la revisión ganadora, no dos contenidos.
- CopyObject con condición de origen y `IfNoneMatch: '*'` sobre el destino;
  verifica bytes/metadatos del final y marca el registro sellado ANTES de guardar
  referencia en animal/diario. Resultados inciertos se reconcilian por ese registro.
- PUT tardío/repetido solo cambia temporal; no el medio confirmado ni sus copias.
  No se reciclan claves/registros ni se borran por TTL. Limpieza segura pendiente.
- La captura solo admite fotos/adjuntos registrados y sellados. Legacy no se
  migra automáticamente ni adquiere garantías por esperar tiempo. Se deniega
  preflight antes de crear archivo, liberando su reserva; adjuntos se validan por páginas.
- No afecta identidad/código/nameHistory. Tampoco resuelve por sí solo resultados
  inciertos de operaciones médicas server-side, recuperación de escritores,
  antecedentes retenidos, activación, retención o privacidad del bucket.

`AnimalMediaModule` se importa desde animales, diario y archivo. Persiste en
`animal_media_uploads`, con índices únicos de id/clave final/clave temporal,
sin TTL, y mayoría en emisión/fijación/sellado. No tiene controllers nuevos ni
jobs. `AnimalMediaUploads` es un servicio interno; las políticas de actor y
tokens de escritura siguen envolviendo el handler completo. No usarlo desde un
worker que omita esa coordinación.

Temporal: `users/{ownerId}/animals/{animalId}/upload-intake/{uploadId}/source`.
Final: conserva `profile_{valorNumerico}.ext` o `diary/{entryId}/{attachmentId}.ext`.
Los nuevos valores numéricos de foto añaden aleatoriedad para evitar colisiones
de milisegundo; NO son timestamps que el cliente deba interpretar ni enteros
que deba convertir. Confirmaciones siguen validando propietario/animal/entrada.

Al confirmar se comprueba MIME y tamaño de S3 contra la emisión (y contra el
body en diario); no es inspección clínica ni validación de los píxeles. La
primera lectura SHA-256 fija revisión por CAS. Si gana otra confirmación usa
la fijación ganadora. El resultado final verifica procedencia por uploadId,
digest, MIME, tamaño y revisión mediante lectura condicional/stream, antes de
sellar. Un reintento sellado no lee el temporal. Si el guardado de referencia
en Mongo falla, la copia queda para el mismo reintento; no se borra a ciegas.
La confirmación de diario ahora devuelve 409 si su repositorio no guardó el
adjunto, en vez de devolver un éxito sin persistencia.

Con versionado puede recuperarse la revisión temporal fijada aunque llegue
otro PUT. Sin versionado, si cambia antes de la copia, se deniega sin sustituir
la fijación. Una copia de resultado incierto puede terminar después del error:
solo crea esa clave final exclusiva con contenido fijado, nunca cambia otras
referencias ni sobrescribe un final. Las carreras con borrado pueden dejar un
objeto huérfano si una copia ya estaba en curso; no se promete su cancelación
ni limpieza inmediata. No se recicla su clave/ticket. La serialización general
entre operaciones CRUD concurrentes sigue siendo la previa, no un mutex nuevo.

La copia simple se limita técnicamente a 5 GiB; para objetos mayores falta
promoción multipart. No se amplía el límite vigente de foto (2 MB) ni el resto
de tipos admitidos. La confirmación añade lecturas/copia/hash y puede tener
mayor latencia/coste, también al revalidar un medio sellado para el archivo.
Los errores de inspección/permisos no convierten una carga nueva en legacy.

## Captura y transición legacy

El preflight recorre ahora ficha y TODO el diario por páginas antes de crear
cabecera. Comprueba registros de sellado sin descargar archivos. Si un medio
no está registrado/sellado, deniega y libera únicamente su reserva nueva. La
construcción del manifiesto verifica el archivo sellado y su revisión/hash;
la copia por lotes vuelve a exigir registro protegido. Un temporal no se admite
como fuente activa, tampoco si alguien lo introdujo en datos inconsistentes.

Las fotos/adjuntos legacy siguen consultables/editables por sus rutas actuales;
no se transforman en protegidos por una confirmación repetida ni por esperar
300 s. Requieren migración aislada con actualización explícita de referencias.
El subbloque 6 implementa ese servicio interno, sin ejecución real ni automática:
ver [animal-media-legacy-migration.md](./animal-media-legacy-migration.md).
No ejecutar transferencias de expedientes aún no migrados ni
presentar este bloque como cierre del corte S3 integral. Los archivos capturados
antes de este checkpoint requieren revisión antes de una futura activación.

## Evidencia técnica y salida a producción

Una URL prefirmada permite reemplazar el objeto de su clave, según
[AWS: presigned uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/PresignedUrlUploadObject.html).
La copia condicional exige que el destino no exista, además de fijar origen;
ver [AWS: conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html)
y [CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html).
El SDK instalado ya modela esa condición de destino. No se presume soporte
equivalente en emuladores/S3 compatibles ni se cambia bucket/IAM desde esta tarea.

Antes de desplegar: pruebas reales de CopyObject condicional, SHA/versionado,
concurrencia y respuestas inciertas; permisos para temporal/final; coste/latencia;
clientes que esperan disponibilidad después de confirmar; réplicas sin emisores
antiguos. La compatibilidad JSON no sustituye esa verificación. No habilitar aún
aceptación integral ni eliminar temporales/originales automáticamente.

Verificar la creación de índices únicos de la colección ANTES de emitir URLs.
Revisar IAM `GetObject`, `PutObject`, y `GetObjectVersion` si hay versionado,
incluida copia condicional de destino; no asumir que un emulador la implementa.
No se ha desplegado ni probado contra AWS/Mongo reales. La protección es del
protocolo de aplicación, no S3 Object Lock ni defensa ante credenciales con
permisos arbitrarios o reglas lifecycle que borren los archivos.
