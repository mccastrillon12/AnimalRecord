# Observación S3 de solo lectura del expediente preparado

Subbloque 18 sobre `12d0390`. Implementado internamente y probado con dobles;
sin llamadas reales Mongo/S3. **S3_OBSERVED no es corte estable, autorización,
publicación o aceptación de una transferencia**.

## Contrato interno e identidad

OwnershipArchiveModule exporta OwnershipArchiveS3Observer:

```text
start(runId: UUID)
observeBatch(runId: UUID, limit = 5) // 1–20 archivos
```

El inicio exige una corrida METADATA_OBSERVED vigente del protocolo anterior,
READY/PLANNED y GENERATIONAL_V1 MATERIALIZED, período ACTIVE, dueño/versión/reserva
coincidentes y cero activeWrites, incluidos legacy. No crea otra corrida, cambia
definiciones, convierte V1 o repara una preparación incompleta. Sin endpoint,
worker, cron o ejecución automática. El futuro llamador debe estar autorizado;
conocer runId no concede permiso operativo o de negocio.

Se añade `s3Observation` opcional a animal_archive_metadata_revalidations, sin
default, backfill, colección, índice o TTL nuevos. ARCHIVE_S3_OBSERVATION_V1 guarda
hash de la identidad/definición/digests/conteos del recorrido Mongo, fase
OBSERVING/S3_OBSERVED, revisión, cursor, conteo, digests y fechas técnicas. No
duplica payloads clínicos, URLs, keys o errores en ese subdocumento. La identidad
del recorrido Mongo y sus digests no se reemplazan. Inicio y checkpoints avanzan
la revisión de la corrida y el MISMO archiveMaterializationRevision del control.

Repetir start conserva progreso. No hay reset o reanudación en otra reserva.
Una observación terminal repetida comprueba los fences Mongo pero NO vuelve a
leer S3: no es un escaneo fresco. Para repetir todo debe iniciarse explícitamente
otra corrida de metadatos y completar de nuevo ambos recorridos, sin borrar la
anterior. Iniciar otra corrida invalida conservadoramente la anterior.

## Página y lecturas remotas

1. Una transacción corta lee el progreso vigente, página ordenada de TODO el
   manifiesto y exactamente un registro PREPARED por archivo. Reconstruye su
   evidencia generacional y coteja plan, intención, revisión final y registro.
   Termina la transacción antes de devolver trabajo. Un resultado incierto de
   esa lectura impide comenzar llamadas S3.
2. Para cada archivo, secuencialmente: HEAD de la key final ACTUAL, GET con
   IfMatch del ETag registrado y VersionId cuando exista, SHA-256/tamaño en
   streaming y un segundo HEAD ACTUAL. HEAD no fija VersionId: no basta con que
   sobreviva una versión histórica cuando el objeto actual cambió/desapareció.
   GET también debe devolver revisión y metadata esperadas. Los tres resultados
   deben coincidir con revisión, tamaño e identidad de materialización, archivo,
   expediente y SHA-256 previstos. ETag no se interpreta como digest de contenido.
3. Solo después de TODAS las lecturas se abre otra transacción: relee corrida,
   control, período, manifiesto y registros; compara página/identidades; hace CAS
   del progreso y del control juntos. Un cambio invalida el checkpoint, aunque
   ya hayan terminado los GET. No se mantiene una transacción Mongo durante S3.

El adaptador solo utiliza HeadObject/GetObject. No copia, crea, lista, sobrescribe,
borra, adopta otra versión ni usa source/staging como fallback. No llama a
materialize para verificar. Ausencia observada/identidad o bytes distintos son
conflicto; fallos de permisos/red/lectura son errores externos genéricos sin
guardar errores completos. Un 403 no se interpreta como ausencia. No se cambian
IAM, bucket, lifecycle, privacidad ni retención; hay que verificarlos antes de
operar, incluidos permisos de lectura de versiones cuando correspondan.
Semántica contrastada con [AWS HeadObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadObject.html)
y [AWS GetObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html).

Cada página es todo-o-nada en Mongo; una falla intermedia no guarda sus recibos.
Reintentar relee los objetos de esa página sin compensaciones ni reparaciones.
Si el checkpoint se confirmó pero su respuesta se perdió, la siguiente llamada
continúa lo persistido; no suma la página otra vez. No hay reintento automático
de negocio o nueva identidad automática ante error.

Lectores concurrentes pueden duplicar GET: no necesitan lease porque son lecturas.
Solo un checkpoint gana para la misma revisión; el otro recibe conflicto y debe
consultar el progreso. Otro avance del pipeline puede invalidarlos a ambos.
Un GET en vuelo puede acabar después de esa invalidación; no se lo cancela ni
se acepta su checkpoint tardío. Error no significa rollback de efectos anteriores.

El digest del manifiesto usa la misma fórmula/orden que FILES y debe coincidir
exactamente con fileDigest y fileCount al cerrar. Otro digest liga las revisiones,
intenciones y SHA observados. El cierre vuelve a comprobar los conteos Mongo.
Página llena exige otra vacía para cerrar; manifiesto vacío cierra con cero
lecturas y no inventa evidencia remota. El límite acota objetos, no sus bytes,
duración de GET, coste de red o tamaño de un archivo; medir y presupuestar antes
de rollout. Streaming evita cargar todo el objeto en memoria.

## Límites de la evidencia y compatibilidad

Actualización subbloque 19: nuevas corridas fijan reservationEpoch y reservationHash;
metadataHash S3 los liga cuando existen. Sus checkpoints/replays exigen el epoch
actual exacto; una liberación/readquisición nueva invalida evidencia previa.
Corridas previas sin epoch NO ganan esa garantía ni se reanudan. La limitación ABA
del texto original se reduce para mutadores actualizados; siguen pendientes
cabeceras/workers del pipeline, mutadores fuera del protocolo y fin remoto.
Detalle: [animal-reservation-epoch.md](./animal-reservation-epoch.md).

Los objetos se observan en momentos diferentes. Un cambio después del último
HEAD puede ocurrir antes del checkpoint o de la respuesta, incluso con versionado.
Las pruebas incluyen ese caso: S3_OBSERVED solo registra observaciones realizadas,
no garantiza disponibilidad posterior, simultaneidad, inmutabilidad o fin de
PUT/copias tardíos. Ni el digest ni el contador son una firma, un bloqueo S3 o
prueba de muerte del escritor. No se vuelve a leer todo al final.

Se mantienen las hipótesis de inmutabilidad del archivo preparado y mutadores
que respetan el protocolo. No resuelve cambios administrativos directos, ABA de
reservas idénticas ni un epoch universal de todos los escritores. No revalida el
expediente activo completo. Fases persistidas pueden quedar obsoletas; no usar
una fase, DTO o hash cacheado como autorización de consumo/commit.

No modifica Animal, diario/documentos, referencias, registros PREPARED, períodos,
reservas, tokens, ventanas, auditoría de negocio o eventos. No recupera legacy,
MAY_RUN o efectos remotos por antigüedad/error. No crea cancelación/vencimiento,
fecha efectiva de traspaso, permisos históricos o captura posterior. Las guardas
de medios generacionales continúan sin excepciones. Mismos HTTP/DTO/éxitos y
errores públicos, incluido PUT animal primitivo; ningún cambio clínico/IA/BDA,
códigos/categorías/acceptedAt/48 h/nameHistory (nombres).
Impactos e integración centralizados en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).

## Siguiente bloque y validación

Siguiente paso concreto: auditar los mutadores de reserva/control y diseñar e
implementar identidad monotónica de reserva e invalidación de estas evidencias,
cubriendo liberación/readquisición ABA y carreras con checkpoints. Delimitar
qué escritores participan antes de diseñar el consumo transaccional del futuro
commit. Ese epoch tampoco probaría fin de efectos S3. Mantener deshabilitados
aceptación/publicación/captura posterior mientras falten corte estable, evidencia
de efectos remotos y commit conjunto de referencias/propiedad/períodos/eventos.

Cuatro suites nuevas cubren dominio, servicio, adaptador y repositorio con dobles
de sesiones/snapshots/reintento. No prueban rollback/mayoría/índices/exclusión
Mongo reales, bucket/IAM/versionado/lifecycle o fallos de red reales. Resultados
y comandos finales en el plan. Ocho suites globales heredadas siguen como deuda
separada. No operaciones reales, migraciones, despliegues, commits o push.

Resultados finales: **75 suites/889 pruebas** en la regresión seleccionada
(antes 71/820), cuatro suites nuevas/69 casos; build, ESLint de TypeScript
nuevo/modificado, compilación del arnés existente y `git diff --check` aprobados.
