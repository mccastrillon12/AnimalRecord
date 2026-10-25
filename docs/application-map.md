# Mapa de la aplicación y puntos de impacto

Última revisión: 2026-10-25. Alcance: código local del backend; no representa una
auditoría de Flutter, configuración real de AWS o datos productivos. Consultar
`final-delivery-plan.md` antes de continuar y actualizar este mapa si cambian
responsabilidades o dependencias.

## Módulos y reutilización

| Módulo                  | Responsabilidad y dependencias                                                                                                                                                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuthModule`            | Login, refresh, verificación, social, PIN y recuperación. Importa UserModule mediante referencia circular existente.                                                                                                                          |
| `UserModule`            | Persistencia de perfiles, disponibilidad, transporte correo/SMS y fotos. Exporta repositorio, `UserCodeSender` y `SearchTransferRecipients`.                                                                                                  |
| `AnimalModule`          | Animal actual, código consecutivo, nombres, ficha, filtros y foto. Exporta repositorio, `AnimalAccessPolicy`, `AnimalWriteCoordinator` y persistencia de periodos/control de propiedad.                                                       |
| `DiaryModule`           | Entradas y adjuntos por animal. Importa AnimalModule. `DiaryAccessGuard` verifica propietario y correspondencia entryId/animalId antes del handler.                                                                                           |
| `AnimalMediaModule`     | Emisión persistida de cargas temporales de foto/diario y promoción condicional/verificada a final. Importado por AnimalModule, DiaryModule y OwnershipArchiveModule; no afecta fotos de usuario ni BDA.                                       |
| `MedicalDocumentModule` | Análisis BDA, revisión, aceptación por animal, descargas, reemplazo 48 h, eliminación y catálogo de campos. Importa AnimalModule; `MedicalDocumentAnimalAccess` reutiliza la política compartida.                                             |
| `CatalogsModule`        | Catálogos Mongo y seed en arranque. Incluye motivos de transferencia con upsert insert-only por código.                                                                                                                                       |
| `LocationModule`        | Países/departamentos/ciudades y su seeder. Reutilizar IDs existentes de ubicación.                                                                                                                                                            |
| `MobileModule`          | Asociación de enlaces móviles; no es proveedor de push.                                                                                                                                                                                       |
| `AnimalTransferModule`  | Búsqueda autenticada, preparación y captura paginada interna del periodo inicial con preflight médico. Periodos/control/lock mediante AnimalModule; decisiones, OTP, corte S3 completo, antecedentes, activación y notificaciones pendientes. |

Persistencia: Mongoose/MongoDB con puertos de repositorio por dominio. HTTP:
controllers/DTO en `src/app`, validación global con whitelist y rechazo de campos
no permitidos, y `HttpExceptionFilter` para errores de dominio. Swagger está en
`/docs`; no hay frontend Flutter dentro del repositorio.

## Propiedad y permisos actuales

- `Animal.ownerId` representa el dueño actual. `nameHistory` solo guarda nombres;
  el usuario confirmó que no era un historial de propietarios.
- El listado y los filtros HTTP de animales se limitan al usuario autenticado;
  consultar otro ownerId o un detalle ajeno devuelve 403.
- Actualizaciones generales, foto, diario y adjuntos se autorizan por animal.
  En diario se valida además que la entrada pertenezca a la ruta consultada.
- Un ownerId recibido por compatibilidad en PUT de animal solo puede ser igual
  al dueño actual. El servicio preserva identidad, código y fechas de creación.
- `findTransferableAnimal` centraliza propiedad + animal activo. No confundirla
  con aceptación: existen periodo inicial, lock y preparación interna de archivos;
  corte S3 completo, antecedentes retenidos, activación de referencias y permisos
  históricos aún no están implementados. Coordinación HTTP y captura Mongo del
  periodo inicial con cursor/preflight ya están integradas internamente.
- `animal_ownership_periods` mantiene la propiedad separada de `nameHistory`.
  `animal_ownership_controls` mantiene versión y lock interno sin ampliar el
  payload HTTP del animal. El backfill es insert-only, idempotente y recorre
  lotes de 200 con proyección mínima. La política repara/verifica el estado antes
  de escribir y rechaza inconsistencias. Si solo falla inicializar propiedad
  después de crear el animal, conserva el éxito y deja la reparación pendiente.
- `findWritableAnimal(s)` rechaza con conflicto mientras existe lock. Ficha,
  foto, diario/adjuntos y mutaciones médicas lo usan; las lecturas actuales no.
- `AnimalWriteCoordinator` añade tokens persistidos por operación HTTP. Adquirir
  reserva exige cero escritores y ventanas de carga vencidas, atómicamente en
  el mismo control. No serializa CRUD entre sí. Medicina coordina también REJECT,
  polling ANALYZING y normalización legacy; GET puros siguen disponibles.
  Callers internos nuevos deben envolver toda su operación. Detalles/límites en
  [animal-write-coordination.md](./animal-write-coordination.md).
- Tokens sin TTL: un crash puede dejar recuperación pendiente y bloquear
  transferencias. La espera de URLs no prueba fin de PUT ya iniciados. No
  habilitar aceptación sin recuperación operativa, protocolo en todas las
  réplicas, tratamiento S3 tardío, captura/IA pendiente y pruebas reales.
- El acceso histórico futuro requiere registros y rutas explícitas. Relajar la
  comprobación de ownerId por sí solo expondría el estado presente al dueño viejo.
- El usuario confirmó que hoy no hay privilegios sobre animales ajenos para
  veterinarios/otros perfiles. Añadir futuros permisos como política explícita.

## Archivos y documentos

El flujo vigente usa `AwsS3StorageService` para fotos/diario mediante URLs y
`AwsMedicalDocumentStorage` para documentos mediante claves/descargas firmadas.
`IStorageService.getFileKey` valida origen y ruta de URLs finales del bucket.
Confirmar foto/adjunto exige la ruta específica de su propietario y animal.

`AnimalMediaUploads` registra las emisiones nuevas en `animal_media_uploads`
antes de firmar, carga en `upload-intake` y confirma mediante copia condicional
sin sobrescribir final, con ETag/VersionId y SHA-256 fijados por CAS. Se guarda
referencia solo después de sellar/verificar. La copia incierta se reconcilia al
reintentar; PUT tardío solo afecta temporal, no final. No hay TTL/reciclaje ni
limpieza automática. Requiere índices únicos y mayoría antes de emitir URLs.
El JSON público se conserva, pero finalUrl ahora está disponible DESPUÉS de
confirmar: revisar preview local, errores 409/502 y latencia en Flutter.
Detalle: [animal-media-upload-isolation.md](./animal-media-upload-isolation.md).

El subbloque 6 añade `LegacyAnimalMediaMigration`, exportado por AnimalMediaModule,
sin controllers ni arranque automático. Trabajos `animal_media_migrations` reservan
el animal atómicamente con el mismo filtro drenado (namespace media-migration,
no una transferencia). Copian a claves nuevas con tickets/procedencia verificables;
por páginas actualizan solo URLs con CAS/checkpoint y un fence escrito en el
control, todo en transacción corta. Completar libera solo su reserva en esa
transacción. Fallar conserva trabajo/reserva; no borra originales ni limpia TTL.
Cambian URLs después de ejecutarlo: IDs/metadatos/fechas se conservan; adjuntos
pueden usar subruta sealed y confirmaciones retiradas dan 409 para refrescar.
No se ha ejecutado migración real. El subbloque 7 añade stopForRecovery explícito:
revisión/fase, auditoría e incremento del fence/liberación de su reserva en una
transacción; STOPPED no permite reanudar el mismo ID ni activa copias atrasadas.
La confirmación pública de una copia de migración exige que ya sea la referencia
actual leída por el caso de uso. Conserva compatibilidad de tickets anteriores
sin backfill, y bloquea activación indirecta de huérfanos preparados.
`AnimalWriteRecoveryInventory` se exporta desde AnimalMediaModule con lecturas
paginadas primario/mayoría de controles y trabajos asociados, sin escritura,
criterio de edad ni prueba de muerte de operaciones. No hay endpoint/job automático.
Retirar tokens generales y recuperar reservas de captura sigue pendiente.
Detalle: [animal-media-migration-recovery.md](./animal-media-migration-recovery.md).
Contrato y uso: [animal-media-legacy-migration.md](./animal-media-legacy-migration.md).

Las fotos se persisten antes de limpiar la anterior. Los borrados de archivos
actuales siguen activos: todavía no hay retención histórica implementada. Debe
adaptarse esto ANTES de habilitar transferencias para conservar la copia anterior.
No realizar movimientos masivos de prefijos ni asumir que la ruta concede acceso.

`OwnershipArchiveModule` añade `OwnershipArchivePreparer`, persistencia de
cabeceras/entradas/manifiesto y `AwsOwnershipArchiveStorage`. Prepara registros
inmutables por animal, diario y documento aceptado individual; copia a histórico
y staging del destinatario sin escribir el destino activo. Verifica bytes por
SHA-256 y fija revisiones S3; lotes/leases permiten reanudar. No tiene endpoints
ni se ejecuta al arrancar. `OwnershipArchiveCapture` y `MongoOwnershipArchiveSource`
añaden preflight de IA/legacy bajo reserva y captura por ID en páginas de 100,
con cursor persistido y checkpoint por revisión. Solo periodo inicial sin CLOSED;
no omiten antecedentes no implementados. Denegación previa a crear cabecera
libera solo su reserva; después conserva bloqueo y reintento. El subbloque 5
también recorre el diario en preflight y exige fotos/adjuntos registrados y
sellados; legacy se deniega sin migrarlo automáticamente. Verifica medio/hash
al construir manifiesto. El corte S3 completo sigue bloqueado por transición
legacy, efectos remotos no cubiertos e integración real. READY no publica archivo.
La limpieza de preparaciones y la incorporación de antecedentes retenidos siguen
pendientes. Detalle en [ownership-archive-preparation.md](./ownership-archive-preparation.md).
Captura, alcance y límites en [ownership-archive-capture.md](./ownership-archive-capture.md).

Leer `medical-document-strategy.md` y después `medical-document-ai.md`. Invariantes:

- Categoría de archivo (`finalCategory`) independiente del contenido aprobado
  (`validatedExtraction.documentType`) y de la detección de AWS.
- Una carga puede analizarse para varios animales; aceptación separa registros
  y archivos por animal, relacionados únicamente por `documentGroupId`.
- Reemplazar conserva `acceptedAt` y el límite de 48 h. Una transferencia tampoco
  reiniciará ese límite ni generará código nuevo para documentos heredados.
- Revisiones, borrados, consultas por ID/grupo y descargas requieren revisar sus
  permisos cuando cambie la propiedad; no basta cambiar Animal.ownerId.
- La IA pendiente impedirá aceptar el traspaso hasta terminar o descartar el
  proceso. Una solicitud de transferencia pendiente permitirá escrituras.
- Mongo y S3 no comparten transacción. Conservar compensación y reintentos.

## Usuarios, OTP y notificaciones

- Reutilizar `UserCodeSender`, Nodemailer y SNS del registro para entrega OTP;
  la autorización de transferencia debe tener propósito/consumo separado.
- El verificador de registro modifica estado de cuenta y genera tokens de login:
  no llamarlo como autorización de transferencia.
- El código visible de UserCodeSender solo ramifica EMAIL/PHONE; verificar su
  integración con las variantes efectivas de cuenta antes de habilitar OTP de
  transferencia. No inventar envíos ni registrar códigos.
- `toPrimitives()` de User incluye secretos para persistencia. UserController
  ahora usa `toUserResponse` con allowlist y conserva alias públicos de ubicación.
  La búsqueda de destinatarios tiene proyección Mongo y DTO propios.
- Seguimiento adicional al integrar auth: SocialCheck/SocialRegister todavía
  devuelven primitivas de usuario; revisar esa serialización sin alterar tokens
  ni contratos de login a ciegas. UserCodeSender también tiene un log heredado
  con el código SMS que debe retirarse al trabajar ese bloque.
- Firebase, tokens de dispositivo, campanita, outbox y worker aún no existen.
  El usuario confirmó que Flutter tampoco tiene push preparado.

## Infraestructura y pruebas

Docker instala con npm y ejecuta `dist/main`. El workflow publica imagen ante
push a main; no hay despliegue local/productivo realizado por este checkpoint.
No instalar dependencias con pnpm en este proyecto npm.

Los reemplazos médicos ya usan transacciones: producción y pruebas de integración
de transferencias necesitan Mongo con replica set/Atlas. Las nuevas pruebas HTTP
usan repositorios simulados y no demuestran escrituras/copias reales en AWS.

El barrido global encontró ocho suites heredadas fallando por imports, fixtures
y mocks antiguos de auth/user/animal. Mantener ese resultado separado de la
regresión médica y de los tests nuevos; detalles y comandos en el plan de entrega.

## Retomar el desarrollo

1. Leer plan y estrategia, comprobar rama/diff y respetar cambios existentes.
2. Consultar los callers y permisos del módulo afectado, no solo su controller.
3. Completar un bloque verificable y registrar qué sigue sin implementar.
4. Actualizar Swagger, contrato Flutter y pruebas de éxito/denegación relevantes.
5. Siguiente bloque: identidad/journal persistido de operaciones e instancias
   para claims de escritura, como base de recuperación verificable de tokens
   generales. No retirar tokens por edad ni asumir que el inventario prueba fin
   de callbacks/efectos remotos. Detención técnica de migración ya implementada,
   sin ejecución real; integración/autorización operativa pendientes de rollout.
   Incorporar antecedentes retenidos con procedencia explícita;
   luego activación, permisos y conservación
   histórica/limpieza. No habilitar aceptación hasta contar con esas garantías.
