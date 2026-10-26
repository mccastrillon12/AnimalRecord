# Materialización interna de destinos finales

Subbloque 14 sobre `789e4ac`. Alcance: copiar desde staging verificado al destino
final planificado, sin activar referencias, publicar, cambiar dueño o cerrar
períodos. No ejecutar en producción hasta integrar sus dependencias.

## Protocolo del bloque

Inicio explícito sobre un READY con referencePlan PLANNED completo y la misma
reserva drenada/período ACTIVE. Intención por archivo persistida antes de S3:
protocolo, identidad/hash, archivo/manifiesto/plan, staging/revisión, digest y
destino inmutables. Claims, confirmación y cierre usan transacciones cortas
snapshot/primary/majority y escriben el control como fence. Los leases solo
recuperan trabajo de copia; no vencen tokens ni transferencias.

S3 solo copia a un destino actualmente ausente mediante IfNoneMatch: '*', con
ETag/VersionId del staging y metadata de identidad de la intención. Se verifica
SHA-256 por stream, tamaño y procedencia, no solo ETag/metadata. No hay fallback
al archivo activo ni se vuelve a fijar otra revisión tras un error.

Reintentar reconcilia primero un final existente de ESTA intención. Otro objeto,
aun con bytes iguales, provoca conflicto sin copiar/borrar/adoptarlo. Una copia
de respuesta incierta puede finalizar después; repetir la misma intención permite
reconciliarla. El token de lease condiciona el registro en Mongo, no cancela
efectos S3 tardíos. Fallos posteriores conservan trabajo/reserva y no prueban rollback.

## Colisiones y límites

Se respeta el destino fijo del plan. Una devolución puede encontrar un objeto
anterior: se detiene sin sobrescribirlo y no elige un sufijo/ruta alternativa en
silencio. Resolver esas colisiones con un protocolo de destinos generacionales
o evidencia explícita sigue pendiente antes de habilitar devoluciones/aceptación.
Este bloque aporta detección/protección, no declara resuelto todo retorno.
El subbloque 15 agrega [selección generacional explícita](./ownership-archive-generations.md)
para materializaciones todavía no iniciadas. V1 sigue fijo: no se convierte una
intención existente ni se cambia de ruta después de un fallo/copia incierta.

MATERIALIZED solo refleja evidencia registrada por archivo. No concede acceso,
activa referencias o registra medios transferidos; tampoco prueba ausencia de
mutaciones/copias remotas posteriores. Faltan revalidación antes de commit,
permisos/retención, recuperación, commit conjunto y captura posterior. Se conserva
la guarda del período inicial. No TTL, borrados, cancelación o vencimiento nuevo.

Contrato central Flutter:
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
Sin ajustes públicos nuevos ni ejecución automática. Pruebas con dobles no
demuestran comportamiento real de bucket, versionado, IAM o Mongo distribuido.

## Uso interno y persistencia

- `OwnershipArchiveMaterializer.start(archiveId)` crea `materialization` solo
  si el archivo/plan están completos. Repetir conserva el mismo protocolo/hash;
  no reinicia ni migra preparaciones incompatibles. Sin endpoints ni workers
  automáticos. El futuro llamador debe validar actor/OTP/destinatario/decisión.
- `copyBatch(archiveId, limit=5)` procesa de 1 a 20 archivos. Reclama cada archivo
  por ID con intención reconocida antes de S3 y lease técnico de cinco minutos.
  Reclamar exige el control/período/versión/reserva y cero activeWrites, incluidos
  legacy: no retira ningún token ni ventana. Una adquisición incierta no ejecuta S3.
- Se reutilizan cabeceras/manifiesto; materialization y
  archiveMaterializationRevision son opcionales sin default/backfill. No se
  cambia contentHash, definitionHash previo o referencePlan. No hay colección,
  índice ni TTL nuevo. Confirmación, liberación técnica y cierre escriben el
  mismo control como fence; un worker obsoleto no confirma con otro token.
- Las intenciones PENDING conservan la posibilidad de efectos S3: no significan
  objeto ausente/rollback. Si Mongo confirma pero pierde su respuesta, reanudar
  omite lo ya verificado. Fallar liberación conserva el error original. Un
  resultado VERIFIED no se restablece automáticamente a PENDING por ausencia S3.
- Reconciliar exige identidad de intención/archivo/archivo histórico y SHA-256
  real. Metadata no es una firma criptográfica ni reemplaza IAM/aislamiento de
  todos los escritores. Se verifica la revisión fijada, no se compara ETag con
  SHA-256. Un HEAD denegado no se interpreta como ausencia.
- Se preservan MIME y cabeceras técnicas observadas del staging fijado; ausencia
  de MIME impide copiar. La metadata final solo lleva identidad técnica; no se
  heredan tags de staging que pudieran pertenecer a limpieza temporal. Esto no
  verifica reglas reales de lifecycle, cifrado o permisos del bucket.
- Cierre compara conteo exacto del manifiesto y todos sus resultados/identidades
  verificados. MATERIALIZED es evidencia persistida, no una relectura S3 de todos
  los archivos ni prueba de estabilidad futura. Un expediente sin archivos puede
  completar sin S3. Lotes acotan archivos, no bytes/tiempo; límite técnico de copia
  simple 5 GiB, sin multipart. Evaluar consultas/scans, costes y leases antes de operar.

No se borran temporales, originales, finales fallidos o preparaciones. Tampoco
se libera la reserva del animal. La recuperación general de reservas y efectos
remotos necesita otro protocolo. S3 no obedece el fence Mongo: una copia atrasada
puede terminar aunque el worker haya perdido su lease. La condición de destino
evita reemplazar el objeto presente, pero no equivale a cancelación remota ni
autoriza un commit o limpieza posterior. Validar privacidad y todos los escritores
antes de usarlo; la ruta por sí sola no concede/revoca acceso.

## Verificación de este subbloque

- Build, ESLint de TypeScript nuevo/modificado y `git diff --check`: aprobados.
- Regresión seleccionada: **64 suites/641 pruebas**, cuatro suites nuevas y
  48 casos frente a 60/593 de `789e4ac`. Incluye revisión/hash/procedencia,
  versionado/sin versión, destino ajeno de retorno aun con bytes iguales,
  carrera de copias condicionales, corrupción del mismo tamaño, fuentes cambiadas/
  ausentes, MIME ausente, respuesta perdida/copia tardía, lease/reserva/período,
  resultado Mongo incierto, manifiesto incompleto/vacío y campos opcionales.
- `npm run test:integration:animal-writes:check`: compilación aprobada; no es una
  ejecución real de este protocolo. Los tests Mongo/S3 usan modelos/sesiones/SDK
  simulados. No hubo operaciones reales, despliegues, migraciones, IAM o borrados.
- Ocho suites globales heredadas siguen como deuda separada; no se declara toda
  la suite global verde. El arnés real del journal anterior no prueba esta copia.

## Referencias contrastadas

Se contrastó el SDK instalado y la documentación primaria de
[CopyObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_CopyObject.html):
condición de destino If-None-Match, condición/revisión de fuente, metadata y
respuesta de copia. La configuración real del bucket sigue sin verificarse.
