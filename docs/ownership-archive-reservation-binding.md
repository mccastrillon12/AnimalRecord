# Preparaciones ligadas a su reserva original

Subbloque 20, 2026-10-26, sobre `e54fba9`. Implementado internamente y probado
con dobles. No hay transferencia completa, publicación, recuperación general o
consumo de evidencia habilitados; no se ejecutaron operaciones reales Mongo/S3.

## Identidad e inicio

Las NUEVAS cabeceras incorporan reservation opcional en schema, obligatorio para
los mutadores nuevos: protocolo ARCHIVE_RESERVATION_V1, epoch adquirido positivo
y bindingHash que liga protocolo/epoch/definitionHash. El validador reconstruye
la definición mediante allowlist de sus siete campos originales y compara el hash
original, protocolo y binding completo; metadata extra o identidad incoherente
se rechazan. No se mezcla el contador con ownershipVersion o lockedAt.

reservation queda fuera de definitionHash, hashes de entradas/manifiestos,
planes, intenciones y destinos S3 existentes: no se reescriben ni convierten.
La corrida de metadatos nueva sí incluye reservation en SU definición técnica,
y conserva su pin/hash de reserva del bloque 19. Es un contrato de observación
nuevo sobre cabeceras compatibles, no una refijación de hashes persistidos.

Contrato de OwnershipArchivePreparer:

```text
begin(definition, captureLiveDossier = false, reservationEpoch)
```

El tercer argumento conserva tipo opcional en la firma TypeScript, pero
OMITIRLO al ejecutar falla cerrado. El llamador debe pasar el epoch
que adquirió, no leer el actual para reetiquetar trabajo viejo. El preparador
normaliza los campos de definición y añade el vínculo. No acepta metadatos de
cabecera como parte oculta de la definición ni recibe este dato desde Flutter.
El actor/autorización/OTP/solicitud siguen a cargo del futuro orquestador.

OwnershipArchiveCapture pasa su epoch de preflight a begin. Crear cabecera y
escribir el fence del MISMO control son una transacción snapshot/primary/majority.
Una liberación entre el último check del preflight y la creación impide el commit,
incluso con readquisición del mismo ID/hora. Si crea primero, liberar después
vuelve obsoleta esa cabecera. Una vez intentado begin se conserva la política
previa: no liberar una reserva por inferir que una cabecera no se persistió.

Repetir la creación compara definición y vínculo persistidos, sin sustituirlos,
resetear cursores o retroadaptar cabeceras. Respuesta de commit perdida se
reconcilia con la misma identidad; una definición/vínculo distintos o colisión
de índice se detienen, no se adoptan. No hay retry automático de negocio.

## Mutadores cubiertos

- Repositorio base: create, append (también replay), checkpointCapture, seal
  (también replay), claimFile, completeFile, releaseFile y markReadyIfComplete.
  Cada escritura relee cabecera, exige vínculo original/epoch, mismo dueño/versión/
  transferId, período ACTIVE y cero activeWrites, incluidos legacy. Un token de
  archivo se resuelve a SU archiveId en Mongo; no se toma el scope del llamador.
- Creación, páginas/copia y cierre base usan transacciones cortas con fence
  archivePreparationRevision del mismo control. Campo opcional, sin default;
  comparación de revisión exacta y límite de entero seguro, sin saturar/reciclar.
  Aun un replay puede escribir el fence. Se añade coste/transacciones, no permiso.
- Antecedentes: inicio y checkpoint del DESTINO comparten ese fence y período
  activo. El predecesor efectivo CLOSED sigue siendo fuente de solo lectura bajo
  sus validaciones previas; no se le atribuye una reserva activa actual.
- Planes, materialización (inicio/claim/confirmación/release/cierre) y registro
  PREPARED conservan sus transacciones/contadores, añadiendo el epoch del vínculo
  inmutable a su actualización del mismo control. No se convierte V1 ni se elige
  otra generación ante un conflicto.
- Metadatos y extensión S3 exigen ahora que el epoch de control sea el de la
  CABECERA, no solo el que observó una corrida nueva. Iniciar otra corrida NO
  permite revisar/adoptar un archivo de una reserva anterior como si fuera actual.
  Los checkpoints/replays conservan además los fences del recorrido del bloque 19.

Todos estos mutadores compiten con liberar/readquirir mediante escrituras sobre
el mismo documento de control. Un snapshot que pierde debe abortar/reintentarse
y volver a validar; no confirma solo porque leyó el lock antes. El fence técnico
no serializa todo el CRUD ordinario ni declara actualidad del expediente activo.

Las lecturas find/listEntries/findFile/source y los builders puros no publican
ni mutan cabeceras: conservar legibilidad no autoriza reanudación. La lectura de
antecedentes efectivos no modifica al antiguo propietario ni habilita consultas
históricas HTTP nuevas.

## S3, fallos e incertidumbre

No hay llamadas S3 dentro de una transacción Mongo. Solo se copia después de
reconocer el claim; respuesta incierta de claim no inicia S3 ni libera ese token
por inferencia. Una copia puede empezar/terminar después de perder la reserva:
no se promete cancelarla. Lo que se deniega es confirmar, liberar su lease o
avanzar ese archivo bajo otra reserva, aunque coincidan transferId/lockedAt.

La liberación técnica de un lease también exige la reserva original. Si falla
después de fallar S3 o perder la reserva, se conserva el error original y el
trabajo puede permanecer registrado; no se limpia por edad ni se reetiqueta.
Los leases conservan su función de trabajo técnico, no vencimiento de negocio,
prueba de fin remoto o protocolo de recuperación de callbacks MAY_RUN.

## Compatibilidad y límites

Cabeceras anteriores SIN reservation se conservan, pero NO se crean/reanudan/
modifican/copían/materializan/registran/revalidan por este protocolo. No rellenar
reservation desde el control actual, no liberar/readquirir para sortear guardas,
no cambiar hashes o IDs para convertir una preparación atascada. Una intervención
requiere otro protocolo de evidencia y autorización operativa. Importar un módulo
no ejecuta intervención ni migración.

Campos reservation y archivePreparationRevision opcionales sin default/backfill,
índices/colecciones/TTL nuevos. Todos los callers de begin deben actualizarse;
todas las réplicas/mutadores deben desplegarse y las anteriores drenarse antes de
usar la garantía. Un proceso viejo puede ignorar el vínculo. No se protege contra
administración directa, eliminación/recreación de controles/cabeceras o restaurar
un backup como si fuera continuación de la identidad actual.

Una reserva continua no prueba fin de efectos remotos ni exactitud/frescura del
expediente activo fuera del protocolo. READY/PLANNED/MATERIALIZED/PREPARED/
METADATA_OBSERVED/S3_OBSERVED siguen sin permiso de consumo/publicación/aceptación.
Faltan evidencia de efectos S3, privacidad/IAM/lifecycle/retención y ensayos reales.
No se cambia Animal/diario/documentos activos, propietario/períodos, reservas,
tokens/ventanas, auditoría de negocio, notificaciones o reglas clínicas. La guarda
del período inicial continúa; nameHistory son nombres, no propietarios.

## Validación y siguiente paso

Actualización subbloque 21: disponible consumo único de observaciones dentro
de transacción del llamador. Marcador evidenceConsumption en cabecera cierra
TODOS los mutadores que usan su vínculo original, incluidos replays/otra corrida.
No se limpia/adopta una marca presente, aunque sea malformada. Nueva metadata
liga revisiones de preparación/planes; no cambia hashes originales. No significa
traspaso, publicación o permiso: falta el commit de negocio y evidencia remota.
Detalle: [ownership-archive-evidence-consumption.md](./ownership-archive-evidence-consumption.md).

Dos suites nuevas: dominio del vínculo y matriz de 19 mutadores ante ABA/ausencia
de vínculo; ciclo nuevo sin archivos, rollback simulado de creación/fence,
respuesta de creación/claim perdida, no retrofit, creación/checkpoint contra
liberación, copia S3 tardía sin confirmación/liberación, agotamiento y schemas
opcionales. Los tests anteriores conservan cobertura de fases/cursor/conteos/
leases y contratos HTTP. Modelos/sesiones/snapshots/S3 simulados: no prueban
transacciones, majority, índices, concurrencia Mongo o fin remoto reales.
Resultados y comandos finales en el plan; ocho suites globales heredadas siguen
como deuda separada.

Resultados finales: **78 suites/978 pruebas** en la regresión seleccionada
(antes 76/915), dos suites nuevas/63 casos; build, ESLint de TypeScript nuevo/
modificado, compilación del arnés existente y `git diff --check` aprobados.
Solo dobles, sin operaciones reales Mongo/S3/AWS, migraciones, despliegues,
commits o push. No se declara verde toda la suite global.

Siguiente paso concreto: preparar una guardia transaccional de consumo único de
la corrida vigente para ejecutarse DENTRO de la misma transacción del futuro
commit, nunca como una autorización independiente o un DTO cacheado. Cubrir
consumidores competidores, cambios de reserva/definición/fences, rollback y
respuesta perdida. No habilitar propiedad/publicación mientras falten corte S3,
permisos/retención y commit conjunto de referencias/períodos/auditoría/eventos.
Vencimiento y cancelación siguen sin reglas nuevas.

Impacto centralizado en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md):
sin cambios HTTP/DTO/éxitos/errores públicos, incluido PUT animal primitivo.
