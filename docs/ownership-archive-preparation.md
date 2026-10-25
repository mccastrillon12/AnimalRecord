# Preparación interna de archivos de propiedad

Checkpoint sobre `991eeb8`, 2026-10-25. Esta implementación prepara un corte
proporcionado por otro caso de uso; todavía no captura el expediente en vivo ni
concreta una transferencia. El seguimiento está en
[final-delivery-plan.md](./final-delivery-plan.md).

## Componentes disponibles

`OwnershipArchiveModule` registra `OwnershipArchivePreparer`, el repositorio
Mongo y el adaptador S3. Se importa desde AnimalTransferModule. No tiene
controllers, cron, workers automáticos ni escrituras S3 al arrancar.

Colecciones nuevas:

| Colección                          | Contenido y garantías                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `animal_ownership_archives`        | Cabecera por periodo/transferencia, dueño anterior, destinatario, versión esperada, hash de definición, estado y conteos esperados.                                                                       |
| `animal_ownership_archive_entries` | Una ficha, entrada de diario o documento médico por registro, con copia JSON, hash estable y vínculos a los archivos del manifiesto. Índices únicos por ID y por archivo/tipo/recurso; paginación por ID. |
| `animal_ownership_archive_files`   | Una referencia por objeto de origen: revisión S3, claves de histórico/preparación/destino final, estado, lease técnico y evidencia de verificación.                                                       |

`COLLECTING → COPYING → READY` son estados de preparación. **READY no publica
el archivo, no cierra el periodo ni cambia `Animal.ownerId`.** No existe una
transición de publicación en este módulo. La fecha efectiva de propiedad debe
establecerse posteriormente en el commit de transferencia, no desde `createdAt`
del archivo.

## Uso interno previsto

1. El caso de uso de aceptación deberá validar propiedad/animal activo,
   análisis/revisiones pendientes y establecer un corte consistente después de
   resolver escrituras ya iniciadas. Esa coordinación aún está pendiente.
2. `begin(definition)` requiere IDs válidos, destinatario distinto y la reserva
   de transferencia con dueño/versión/transferId coincidentes. Mongo comprueba
   también que `periodId` sea el periodo activo correspondiente. Reintentar la
   misma definición devuelve la cabecera existente; cambiarla causa conflicto.
3. `append(archiveId, record)` recibe registros del corte. Admite ficha, diario
   con fotos/audio y documentos aceptados individuales. Copia el JSON para que
   una mutación posterior del objeto en memoria no altere la instantánea.
   Conserva UUID, código, `nameHistory`, categoría, extracción, procedencia y
   fechas médicas sin ejecutar IA ni generar nuevos códigos.
4. Cada objeto se vincula mediante un ID determinista y una ruta JSON del
   payload. Las referencias médicas duplicadas a un mismo objeto comparten una
   entrada del manifiesto. Al añadir un registro se obtiene ETag, tamaño y
   VersionId cuando S3 lo devuelve. Los reintentos idénticos no vuelven a leer
   ese objeto; un contenido diferente no puede sobrescribir el corte.
5. Mongo persiste registro y manifiesto en una transacción corta. La escritura
   de la cabecera serializa añadir registros frente a sellar el archivo.
   `seal(archiveId, expectedEntryCount)` exige el conteo exacto y una única ficha;
   desde entonces no se añaden recursos nuevos.
6. `copyBatch(archiveId, limit)` procesa hasta 10 objetos por defecto, de 1 a 50
   por llamada. Reclama cada archivo con token/lease técnico de cinco minutos y
   vuelve a verificar la reserva antes y después de S3. El vencimiento del
   lease solo recupera trabajo técnico; no define el vencimiento de solicitudes
   de transferencia.
7. Una copia verificada queda registrada y los siguientes lotes la omiten. Un
   fallo deja el archivo reintentable; si el proceso muere o falla también Mongo,
   otro worker puede reclamarlo al vencer el lease. Solo el token vigente puede
   confirmar o liberar ese trabajo. No se mantiene una transacción Mongo
   abierta durante S3.

No invocar esta secuencia desde HTTP ni desde un job de producción hasta
implementar el corte estable y sus revalidaciones. La presencia de un lock por
sí sola no demuestra que las escrituras que empezaron antes hayan terminado.
El llamador también deberá demostrar que enumeró todos los recursos; el conteo
que recibe `seal` no sustituye esa enumeración.

## Jerarquía y verificación S3

Para un objeto de origen:

```text
users/{oldOwner}/animals/{animalId}/{relativeKey}
```

Se preparan:

```text
histórico: users/{oldOwner}/animals/{animalId}/ownership-archives/{archiveId}/{relativeKey}
receptor: users/{newOwner}/animals/{animalId}/transfer-preparations/{archiveId}/{relativeKey}
destino final registrado: users/{newOwner}/animals/{animalId}/{relativeKey}
```

`relativeKey` conserva categorías, documentos, revisiones y subdirectorios de
diario. El destino final **no se escribe** en esta etapa: evita sobrescribir
una copia activa anterior al preparar una devolución a un antiguo dueño.
La instantánea conserva los datos originales y sus `fileBindings` describen qué
referencias deberán resolverse hacia las copias; no devolver su JSON crudo como
una respuesta pública ni tratar las URLs originales como descargas históricas.

Se rechazan objetos ajenos, rutas con segmentos vacíos/traversal y prefijos de
histórico/preparación usados como si fueran objetos activos. Los registros
médicos legacy multi-animal o con referencias inconsistentes deben normalizarse
antes. Importar el histórico retenido de periodos previos requiere un flujo
explícito adicional; no se enumera ni copia el bucket recursivamente.

El adaptador fija ETag y VersionId cuando existe, lee el origen como stream y
calcula SHA-256; copia al histórico y compara el SHA-256 de esa copia. Después
copia desde ese histórico verificado a la preparación del destinatario y
vuelve a comparar el contenido. Comprueba también la cantidad de bytes. No
utiliza ETag como si fuera siempre un hash de contenido.

S3 permite condicionar una copia al ETag de origen y seleccionar una versión
con `versionId`; el adaptador usa ambas condiciones cuando están disponibles.
La lectura también usa `IfMatch` y la versión fijada.
[CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html),
[GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

Se usa copia simple para objetos de hasta 5 GiB. Un objeto superior se rechaza
como limitación técnica de este preparador; antes de admitirlo deberá existir
una implementación multipart y una revisión de la duración/renovación del lease.
No cambia los límites de carga existentes del frontend.

No se modifica IAM ni configuración del bucket. Validar acceso a los nuevos
prefijos y, si hay versionado, `s3:GetObjectVersion`, antes de integrar. Verificar
privacidad y reglas de lifecycle del bucket antes de prometer retención e
aislamiento de archivos históricos.

## Conservación y trabajo pendiente

Este módulo no elimina objetos, ni originales ni preparaciones fallidas. Las
copias quedan referenciadas para reintento. No agrega borrados recursivos ni TTL
al histórico. El recolector de preparaciones abandonadas requiere un estado
terminal persistido, exclusión de workers y comprobación de referencias; sigue
pendiente, igual que la política de limpieza de esas preparaciones.

Faltan: captura paginada del expediente en vivo bajo un corte estable;
incorporación de antecedentes retenidos; rechazo de aceptación con IA pendiente;
activación de las referencias finales y conservación en borrados/reemplazos;
commit de propiedad/periodos con auditoría/notificaciones; consultas históricas
autorizadas y descarga firmada; limpieza segura; pruebas con replica set y S3
reales. Las reglas de cancelación/vencimiento de transferencias siguen abiertas.

## Compatibilidad frontend

No se añade ningún endpoint, campo DTO, código HTTP, URL de carga ni cambio de
respuesta en este subbloque. Flutter no requiere ajustes. El contrato de éxito
anterior y el nuevo son iguales en animales, diario, documentos, catálogos y
buscador. No consumir los estados internos ni llamar las rutas de histórico
propuestas hasta que se publiquen sus contratos.
