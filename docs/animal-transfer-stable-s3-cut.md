# Auditoría de escritores y evidencia para un corte estable S3

Subbloque 28, revisión estática sobre `2a4be2e`, rama
`codex/animal-transfer-planning`, árbol inicialmente limpio. Sin cambios de runtime,
endpoints, schemas, índices o reglas de negocio; sin operaciones Mongo/S3/AWS/Docker.
Se consultó documentación pública de AWS, no configuración ni datos de una cuenta.

## Estado y alcance

**Implementado:** coordinación de handlers HTTP, journal y claims, recuperación
transaccional anterior a MAY_RUN, aislamiento de nuevas cargas, reserva con epoch,
captura/preparación, planes, materialización generacional, registro PREPARED,
observaciones y lector/consumo transaccionales. Ninguno acredita por sí solo el
fin de todos los efectos remotos. No existe un autorizador de corte estable.

**Objetivo funcional aprobado:** conservar el expediente exacto del antiguo dueño
y entregar una copia completa al destinatario. El propietario debe terminar o
descartar análisis/revisiones pendientes antes de aceptar. Descartar funcionalmente
no acredita cancelación de un trabajo del proveedor. La transferencia sigue
deshabilitada; vencimiento y cancelación continúan pendientes.

**Propuesta técnica de este documento:** contrato de evidencia y pruebas necesarias.
No hay nuevos estados persistidos, recuperación, permisos o políticas AWS instaladas.
La matriz cubre los escritores encontrados en el código actual; no demuestra
cobertura de despliegues anteriores, herramientas administrativas, IAM o lifecycle.

## Matriz de escritores y efectos

Las rutas siguientes son fuentes auditadas. «Pendiente» describe evidencia o
protecciones necesarias, no una capacidad implementada. Un callback que retorna
solo informa sobre las promesas locales esperadas por ese intento.

| ID / funcionalidad y fuente | Alcance y garantía actual | Brecha para el corte / prueba necesaria |
| --- | --- | --- |
| W01 Coordinación: [AnimalWriteCoordinator](../src/context/animal-transfer/application/animal-write-coordinator.ts), [journal Mongo](../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-animal-write-journal.ts) | Los controllers de ficha, foto, diario y medicina adquieren claims y autorizan MAY_RUN antes del callback; resultado y liberación se registran aparte. | No enumera cada envío AWS, hijo, retry o compensación. LOCALLY_FINISHED no acredita fin remoto. Callers internos/directos y versiones antiguas requieren cobertura explícita. |
| W02 Emisión/PUT de foto y diario: [AnimalMediaUploads](../src/context/animal-media/application/animal-media-uploads.ts), [firmador compartido](../src/context/shared/infrastructure/storage/aws-s3-storage.service.ts) | Ticket durable; PUT nuevo solo a `upload-intake`; destino canónico separado. Control conserva ventana de validez de URL emitida. | Capacidad reutilizable, sin recibo por cada PUT ni vínculo ticket/operationId. Expiración y claim liberado no demuestran drenaje. Probar aislamiento efectivo respecto de todo artefacto autoritativo. |
| W03 Promoción/sellado: [AWS media](../src/context/animal-media/infrastructure/aws-animal-media-upload-storage.ts) | Fija revisión/digest, copia con condición de origen y destino `IfNoneMatch: '*'`; verifica identidad, tamaño y bytes. Ticket sellado no reconstruye un final borrado en una nueva confirmación. | Otro intento ya enviado puede terminar tarde. Borrar destino permite que una copia pendiente vuelva a crearlo. Probar retención/no reutilización o selección de versión preservada; reconciliar un intento no cierra todos los demás. |
| W04 Cargas legacy: [AnimalMediaUploads](../src/context/animal-media/application/animal-media-uploads.ts) | Confirmación sin ticket conserva compatibilidad; captura exige medio registrado/sellado. | No hay inventario completo de URLs directas emitidas por versiones previas. Ausencia de ticket no significa ausencia de escritor; no recuperar por antigüedad. |
| W05 Borrados ordinarios: [foto](../src/context/animal/application/profile-picture/update-animal-profile-picture.usecase.ts), [diario](../src/context/diary/application/diary-entry-deleter.ts), [adjuntos](../src/context/diary/application/diary-attachment-manager.ts), [S3 compartido](../src/context/shared/infrastructure/storage/aws-s3-storage.service.ts) | Ficha persiste foto nueva antes de borrar anterior; controllers coordinados. | DeleteObject sin VersionId; adaptador compartido captura errores y retorna. RETURNED no prueba borrado, ni preservación histórica. Falta protección de retención y evidencia por efecto. |
| W06 Ingreso médico: [runner](../src/context/medical-document/application/medical-document-analysis-runner.ts), [almacenamiento](../src/context/medical-document/infrastructure/storage/aws-medical-document-storage.ts) | Documento persistido antes de subir originales/auxiliares a `medical-document-intake/{documentId}`. | PUT incondicional, devuelve URI sin revisión. Error puede dejar objeto o intento incierto. Separar originales que se conservarán de temporales demostrablemente irrelevantes. |
| W07 Trabajo asíncrono BDA: [analizador](../src/context/medical-document/infrastructure/ai/aws-bedrock-medical-document-analyzer.ts), runner | Invoca con clientToken, persiste ARN después de respuesta y consulta estado. El proveedor escribe outputs fuera del callback HTTP. | Ventana inicio aceptado/ARN no persistido. FAILED/REJECTED locales y limpieza no cancelan el trabajo. Evidenciar cada intento o demostrar aislamiento de sus salidas; no inferirlo del estado clínico. |
| W08 Fallback y rescate: [refresher](../src/context/medical-document/application/medical-document-analysis-refresher.ts) | Puede lanzar análisis alternativos y trabajos por página; espera cargas locales hermanas con allSettled. | Token de invocación y ARN registrado no son ledger completo de hijos desconocidos. Incluir cargas, trabajos y reintentos sin cambiar reglas de extracción/revisión. |
| W09 Aceptación/reemplazo: [reviewer](../src/context/medical-document/application/medical-document-reviewer.ts), [replacement](../src/context/medical-document/application/medical-document-replacement-service.ts) | Copias por animal; reemplazo usa destinos bajo revisión propia y actualización de metadatos coordinada. Rollback intenta borrar copias reconocidas. | CopyObject médico no fija revisión de origen ni condiciona destino. Respuesta perdida deja copia fuera de la lista reconocida. CAS de metadatos no impide copia/borrado AWS tardío. |
| W10 Eliminación/compensación médica: [association remover](../src/context/medical-document/application/medical-document-association-remover.ts), almacenamiento médico | Lee respaldo, borra objeto y cambia metadatos; ante fallo intenta restaurar bytes en la MISMA clave. Limpieza también usa DeleteObject/DeleteObjects por prefijo. | Restauración PUT incondicional puede terminar tarde. DeleteObjects Quiet no inspecciona Errors por clave; promesa cumplida no prueba limpieza total. Listado actual no enumera versiones ni cierra trabajos asíncronos. |
| W11 Migración legacy: [copier](../src/context/animal-media/application/legacy-animal-media-copier.ts) | Ticket determinista, pin/promoción/sello; checkpoints cercados. STOPPED técnico impide posteriores activaciones Mongo del worker detenido. | No aborta una copia ya enviada: puede quedar huérfana. STOPPED no es cancelación funcional ni prueba de fin remoto. Ensayar stop mientras copia está en vuelo. |
| W12 Histórico/staging: [preparer](../src/context/animal-transfer/application/ownership-archive-preparer.ts), [AWS archivo](../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-storage.ts) | Claim técnico de archivo, origen fijado y digest comprobado; reserva/checkpoint se revalidan después del I/O. Copia a `ownership-archives` y `transfer-preparations`. | CopyObject condiciona ORIGEN, no DESTINO. Lease de cinco minutos puede permitir otro worker mientras la copia anterior continúa. Fence Mongo no impide sobrescritura remota del histórico/staging. |
| W13 Final generacional: [materializer](../src/context/animal-transfer/application/ownership-archive-materializer.ts), [AWS materialización](../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-materialization-storage.ts) | Intención fija, generación separada, condición de origen y destino, identidad/digest verificados; no adopta colisión ajena. | No cubre delete/recreate, escritores externos ni conservación futura. Lease/reconciliación y registro PREPARED no cierran todos los intentos remotos. |
| W14 Observación/consumo: [observador S3](../src/context/animal-transfer/infrastructure/storage/aws-ownership-archive-s3-observation-storage.ts), [validación Mongo](./ownership-archive-projection-mongo-validation.md) | HEAD/GET fijado/HEAD y digest observados; lectura snapshot y consumo cercado probados en Mongo local. | Lectores no son escritores ni bloqueo S3. Snapshot antiguo puede devolver candidato; consumo protege Mongo, no futuras mutaciones de bytes. Recibos S3 del arnés son sintéticos. |

No se encontraron operaciones multipart explícitas en los adaptadores auditados.
Foto de usuario usa otro namespace; correo/SMS/feedback y contadores no escriben
bytes del expediente. Esta exclusión depende de que no se incorporen como fuentes
del archivo; añadir un writer o referencia exige revisar cobertura.

## Carreras que impiden afirmar cierre hoy

1. Claim liberado y URL vencida mientras queda una petición remota incierta.
   El aislamiento del temporal ayuda, pero debe cubrir todas las referencias y
   promociones pendientes; un reloj no constituye recibo de finalización.
2. Worker A envía copia a histórico, pierde respuesta y vence su lease. B reintenta
   y completa checkpoint; A termina después sobre el mismo destino incondicional.
3. Final observado, luego borrado; copia condicional ya enviada vuelve a crearlo.
   No convertir observación pasada en garantía de conservación o no reutilización.
4. BDA acepta inicio, respuesta/ARN no queda persistido; se marca FAILED y limpia,
   pero el proveedor vuelve a escribir outputs. Estado local no prueba cancelación.
5. Borrado médico seguido de conflicto Mongo inicia restauración; fallo o timeout
   de restauración deja un PUT incierto, aunque termine la petición HTTP.
6. DeleteObjects devuelve respuesta satisfactoria con errores individuales; el
   código no los verifica. «Limpieza completada» local no prueba ausencia remota.

Son trazas posibles según el código y contratos del proveedor, no fallos reales
reproducidos en este bloque. No autorizan retirar tokens ni repetir negocio.

## Contrato técnico propuesto, todavía sin implementar

Un corte deberá enlazar evidencia suficiente con artefactos que realmente se
conservarán/leerán. No exige esperar efectos demostrablemente aislados de ellos,
pero la irrelevancia deberá estar protegida y comprobada, no asumida por un prefijo.
La regla funcional de terminar/descartar pendientes médicos se mantiene aparte.

1. **Cobertura:** declarar versión de protocolo, escritores/despliegues cubiertos,
   fuentes, referencias y exclusiones justificadas. Datos previos, permisos o
   herramientas desconocidos son cobertura incierta, nunca conjunto vacío cerrado.
2. **Intención antes del envío:** identificar durablemente cada efecto, hijo,
   retry (incluidos los del SDK), limpieza y compensación; enlazarlo a operación/instancia, animal/versión
   y referencias de artefacto. Autorización de envío deberá competir con revocación
   e impedir envíos tardíos. No basta escribir «pendiente» y borrar un token.
   Revocar no elimina autorizaciones ya concedidas: un intento autorizado sin
   desenlace suficiente conserva incertidumbre aunque no haya constancia de envío.
   El journal actual no tiene este protocolo por efecto; no agregarle payloads,
   contenido clínico, URLs ni errores completos para simularlo.
3. **Evidencia diferenciada:** no enviado solo si existe fence que impide envío
   posterior; respuesta reconocida acredita ese intento; aislamiento acredita
   irrelevancia respecto de los artefactos seleccionados. Desconocido bloquea si
   no se prueba irrelevancia. Son conceptos propuestos, no nuevos enums públicos.
4. **Bytes y retención:** revisión/digest y selector efectivo preservados; usar
   versión recuperable con retención adecuada o generación de creación condicional
   con no borrado/no reutilización demostrables. VersionId hoy es opcional; no se
   afirma versionado/IAM/lifecycle configurado ni se elige una política productiva.
   Incluir también histórico y fuentes necesarias, no solo final destinatario.
5. **Cierre:** cada efecto relevante terminado con evidencia suficiente o aislado;
   todos los intentos autorizados cubiertos. Un HEAD, terminal local, edad, error,
   clientToken, ausencia de claim o progreso del lease no sustituyen esa evidencia.
6. **Vínculo al commit:** ligar futura evidencia a reserva original/epoch,
   manifiesto, pins de preparación/planes, corrida, selección/proyección y versión
   de garantías de conservación. Validar/consumir junto con TODAS las escrituras
   de negocio en la transacción del llamador. Esto no crea transacción Mongo/S3;
   la estabilidad remota depende de las protecciones y cobertura anteriores.

No hay protocolo nuevo para recuperar legacy/MAY_RUN o incertidumbre remota.
No adoptar preparaciones antiguas, refijar hashes ni inventar cancelación/TTL para
sortear evidencia faltante. Mantener guarda de captura del periodo inicial.

## Siguiente bloque y validación pendiente

Subbloque 29: **lector interno paginado de evidencia local de journals por animal**
ya implementado, incluidos terminales y operaciones sin activeWrites. Contrato y
límites en [animal-write-journal-inventory.md](./animal-write-journal-inventory.md).
El inventario de recuperación previo sigue consultando solo controles con claim/lock
y migraciones; el nuevo lector separado amplía evidencia de journals, sin tickets
o trabajos médicos, recuperación o permiso de corte. Contrato que guió ese bloque:

- Incluir alcance animal/versión y semántica exacta MAY_RUN/LOCALLY_FINISHED;
  validar cursor/límite, lecturas primary/majority y salida mínima sin datos clínicos.
- Definir consulta/índice necesario antes de implementación; ausencia de journal
  no es prueba de cobertura, muerte de proceso ni ausencia de efecto remoto.
- Separar observaciones de distintas lecturas; no prometer snapshot global, permiso
  `canCommit`, recuperación, endpoint público o cierre S3. Tickets/BDA y ledger
  por efecto requieren bloques posteriores, no se simulan con este inventario.
- Probar paginación, selección de claims del animal, terminales sin tokens,
  compatibilidad de journals antiguos y errores de consulta sin devolver falso vacío.

Siguiente: contrato durable y máquina de estados de intención/autorización por
efecto de promociones de foto/diario, con carreras de revocación/retries SDK y
respuesta perdida antes de integrar dispatch real. Después, aislamiento/retención verificables;
corregir copias y limpieza según ese protocolo, antes de integrar commit operativo.
Ensayos S3/BDA reales requieren un entorno expresamente autorizado. Deben incluir
las seis carreras anteriores, respuestas perdidas, retries/hijos, delete/recreate,
errores parciales y efectos que sobreviven al callback/lease. Mocks y Mongo de un
nodo no demuestran esas propiedades del proveedor.

Validación de este bloque: revisión estática de fuentes y contratos AWS, enlaces
locales comprobados y `git diff --check`. Sin nuevos tests de runtime ni ejecución
de arneses; resultados previos conservan su alcance y fecha en el plan de entrega.

## Referencias del proveedor

- Las URLs prefirmadas son reutilizables; su vencimiento limita autorización y
  no es un recibo de cada petición. Inferimos que no permite acreditar drenaje:
  [S3 presigned URLs](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).
- Condiciones de origen y destino son distintas; IfNoneMatch protege la creación
  frente a un destino presente: [CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html).
  Si no hay versión actual o existe delete marker, puede admitirse una creación:
  [conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).
- Quiet conserva errores individuales en la respuesta:
  [DeleteObjects](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html).
- El análisis es asíncrono, escribe salidas S3 y se consulta por estado:
  [InvokeDataAutomationAsync](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_data-automation-runtime_InvokeDataAutomationAsync.html).

Impacto/integración centralizados en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
