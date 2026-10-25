# Última entrega: plan y seguimiento

Inicio: 2026-10-25. Este documento organiza planificación, decisiones y ejecución.
Una tarea propuesta no representa funcionalidad implementada.

## Features registrados

| ID  | Feature                                               | Estado                                                        | Estrategia                                                   |
| --- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| F01 | Transferencia de uno o varios animales entre usuarios | Desarrollo iniciado por bloques; flujo completo no habilitado | [animal-transfer-strategy.md](./animal-transfer-strategy.md) |

## Forma de trabajo

1. Registrar requerimiento y reglas en la estrategia del feature.
2. Separar decisiones confirmadas, propuestas y pendientes.
3. Cerrar contratos backend/frontend y matriz de permisos.
4. Implementar por bloques revisables en ramas `codex/`, evitando trabajo directo
   sobre `main`. Cada bloque registra pruebas, migraciones e impacto móvil.
5. Validar con datos de prueba y escenarios de fallo; desplegar por etapas.
6. Actualizar este tablero y entregar instructivo específico para Flutter.

## F01: secuencia de ejecución propuesta

| Bloque | Trabajo                                                          | Dependencia | Criterio de cierre                                                                                                 | Estado                                                                                                                                                  |
| ------ | ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0      | Barrido del backend y decisiones de negocio                      | Ninguna     | Historial, OTP, parciales y vencimiento acordados                                                                  | Historial/OTP/parciales confirmados; vencimiento y cancelación pendientes                                                                               |
| 1      | Política de acceso y protección de cambios de propietario        | 0           | Lecturas/escrituras por actor autorizadas; CRUD general no transfiere                                              | Completado: propiedad actual; histórico y bloqueos corresponden al bloque 2                                                                             |
| 2      | Modelo de periodos/archivos históricos y retención S3            | 0, 1        | Antiguo dueño conserva todo el corte; nuevo dueño recibe copia completa con jerarquía existente; migración probada | En progreso: periodos/lock, copias, coordinación HTTP y captura paginada del periodo inicial; corte S3, antecedentes, activación y consultas pendientes |
| 3      | Motivos, seeder y buscador de destinatarios                      | 0, 1        | Catálogo idempotente y búsqueda mínima paginada; preparada para identificación                                     | Completado en backend; sin despliegue ni integración Flutter                                                                                            |
| 4      | OTP de transferencia y confirmación idempotente                  | 0, 1, 3     | Prueba de autorización temporal, limitada y consumida una vez                                                      | Pendiente                                                                                                                                               |
| 5      | Configuración push nueva, bandeja, dispositivos, outbox y worker | 0, 1        | Backend y Flutter integrados; avisos persistidos aun con push fallido; entrega recuperable                         | Pendiente                                                                                                                                               |
| 6      | Solicitudes y aceptación/rechazo por animal                      | 2, 4, 5     | Cambio consistente por animal; copia S3 recuperable; estados parciales                                             | Pendiente                                                                                                                                               |
| 7      | Historial/consultas y contrato final Flutter                     | 6           | Actual, histórico y destinatario pendiente separados; campanita/card coherentes                                    | Pendiente                                                                                                                                               |
| 8      | Integración y despliegue controlado                              | 7           | Pruebas funcionales, concurrencia, reinicios y regresiones aprobadas                                               | Pendiente                                                                                                                                               |

No comenzar por un cambio directo de `ownerId`: los bloques de acceso e histórico
son dependencias del comportamiento pedido. No se fija duración hasta cerrar
reglas de histórico, infraestructura móvil y comportamiento de parciales.

## Registro de decisiones

| Fecha      | Registro                                                                                                               | Estado                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 2026-10-25 | El propietario selecciona uno o varios animales, destinatario y motivo; OTP antes de finalizar                         | Requerimiento recibido                                                       |
| 2026-10-25 | El destinatario puede aceptar todos, algunos o ninguno; los no seleccionados se rechazan al finalizar su respuesta     | Confirmado por el usuario                                                    |
| 2026-10-25 | Antiguo dueño conserva toda la información exacta hasta el traspaso; incluye diario, fotos, audio y perfil             | Confirmado por el usuario                                                    |
| 2026-10-25 | Nuevo dueño recibe copia completa en su carpeta S3 respetando la jerarquía existente                                   | Confirmado por el usuario                                                    |
| 2026-10-25 | Campanita, card inicial y push; no existe configuración previa de Firebase/push en frontend                            | Confirmado por el usuario; implementación nueva                              |
| 2026-10-25 | No se encontró historial de propietarios ni módulo push/campanita en este backend                                      | Hallazgo del barrido                                                         |
| 2026-10-25 | OTP al correo o SMS según el registro actual; confirma identidad e intención; backend valida propiedad de cada animal  | Confirmado por el usuario; caso de uso separado del registro                 |
| 2026-10-25 | Envío de datos de negocio al Finalizar; no exigir antes un hash del contenido vinculado al OTP                         | Contrato de planificación acorde al propósito de OTP aclarado por el usuario |
| 2026-10-25 | Solicitud pendiente permite modificaciones; bloqueo comienza al confirmar aceptación y durante aplicación del traspaso | Confirmado por el usuario                                                    |
| 2026-10-25 | Plazo de respuesta y cancelación                                                                                       | Pendientes expresos; no implementar un valor por defecto sin aclaración      |
| 2026-10-25 | Estrategia médica actualizada con conservación histórica y copia por transferencia                                     | Regla documentada; código pendiente                                          |
| 2026-10-25 | Permisos compartidos, desafío OTP separado y outbox recuperable                                                        | Diseño técnico propuesto                                                     |
| 2026-10-25 | Reutilizar correo/OTP del registro existente; no redefinir canal de envío                                              | Ratificado por el usuario                                                    |
| 2026-10-25 | Esperar que el propietario termine o descarte análisis/revisiones IA antes de aceptar el traspaso                      | Confirmado por el usuario                                                    |
| 2026-10-25 | Solo animales activos; los inactivos no se transfieren                                                                 | Confirmado por el usuario                                                    |
| 2026-10-25 | Devolver información principal e identificación del destinatario para el contraste de cédula en Flutter                | Confirmado por el usuario; respuesta sin credenciales/códigos                |
| 2026-10-25 | Hoy no hay accesos especiales para otros perfiles; veterinarios se contemplarán a futuro                               | Confirmado por el usuario                                                    |
| 2026-10-25 | Otro no requiere descripción ni un campo adicional                                                                     | Confirmado por el usuario                                                    |
| 2026-10-25 | Usuario indica campo básico de propietarios previos; segunda revisión local no lo encuentra en modelo/schema/DTO/mapeo | Reconciliar dato legacy antes de migrar, conservándolo si existe             |
| 2026-10-25 | Usuario aclara que recordaba `nameHistory`; conservar nombres y crear propiedad separada                               | Aclaración cerrada                                                           |
| 2026-10-25 | Usuario autoriza comenzar desarrollo y registrar tareas/pruebas/contexto en cada bloque                                | En ejecución                                                                 |

## Pendientes que requieren definición

- Vencimiento de solicitudes y posibilidad/alcance de cancelación.
- Límite configurable de animales por solicitud, sin cifra aprobada.
- Ubicación del histórico y agrupación de cards en la interfaz.

Reutilizar el OTP de registro es una decisión cerrada. Revisar las variantes de
cuenta del flujo efectivo durante la integración, sin pedir nuevamente definir
canal ni desarrollar un transporte de correo/SMS paralelo.

No volver a preguntar decisiones ya confirmadas ni dar por aprobadas las
propuestas técnicas solo por estar documentadas.

## Entregables de esta planificación

- Estrategia con evidencia del código, riesgos concretos, contratos preliminares
  y matriz de pruebas.
- Tablero de fases y decisiones en este documento.
- Checkpoint de implementación descrito a continuación; sin migración, cambios
  de infraestructura ni escrituras en datos productivos.

## Checkpoint de implementación: 2026-10-25

Rama: `codex/animal-transfer-planning`. Primer checkpoint en `e7cccad`; periodos y
lock en `991eeb8`; preparación de archivos en `e7db2b2`, presentes en el historial
local al retomar. Coordinación de escritores en `0678850` (usuario confirmó la
subida). Preflight/captura interna en `93ed9b9` y aislamiento de medios en
`92322a3`, y migración interna legacy en `d6e2b53`, presentes al retomar y con
subida confirmada por el usuario. Recuperación técnica/inventario en `cdc32b2`,
presente al retomar con árbol limpio. La etapa actual de journal de operaciones
permanece sin commit, push ni despliegue realizados por el agente. El feature
sigue en desarrollo.

### Bloque 1: completado para propiedad actual

- [x] `AnimalAccessPolicy` compartida y exportada por AnimalModule.
- [x] Listado/búsqueda/detalle de animales limitados al usuario autenticado.
- [x] Creación para otro ownerId y cambios de propiedad por PUT rechazados.
- [x] Compatibilidad: PUT acepta ownerId idéntico y mantiene UUID/código.
- [x] Foto y diario autorizados; entryId debe corresponder al animal de la ruta.
- [x] Confirmaciones de fotos/adjuntos validan bucket y ruta del recurso.
- [x] Foto nueva se persiste antes de borrar la anterior; fallo de persistencia
      conserva el archivo previo. Adjuntos repetidos idénticos no se duplican.
- [x] Acceso a animales en documentos médicos reutiliza la política común.
- [x] UserController serializa campos públicos explícitos; modificación de perfil
      ajeno rechazada y consulta por identificación requiere JWT.
- [x] Comprobación de reserva antes de nuevas escrituras: primer subbloque 2.
- [x] Coordinación de escrituras HTTP ya iniciadas: tercer subbloque del bloque 2.
- [ ] Acceso histórico: bloques 2/7.
- [ ] Adaptación de búsquedas por ID/grupo de documentos a periodos de propiedad:
      bloques 2/7; el dueño actual sigue siendo el único autorizado hoy.

### Bloque 3: completado en backend

- [x] Cinco motivos con código estable y UUID determinista, activos y ordenados.
- [x] Seeder insert-only por código; reintentar no sobrescribe personalizaciones.
- [x] `GET /catalogs/animal-transfer-reasons`, con Otro sin comentario.
- [x] `GET /animal-transfers/recipients`, JWT, información principal e identificación.
- [x] Normalización/escape de nombre, 2-100 caracteres, tolerancia de acentos,
      exclusión del remitente y paginación por cursor (20 por defecto, máximo 50).
- [x] Modo IDENTIFICATION reservado, devuelve 400 hasta habilitarlo.
- [x] DTO/Swagger y contrato de Flutter en
      [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
- [ ] Prueba de seed contra Mongo real y uso desde Flutter: integración futura.

### Bloque 2: primer subbloque completado

- [x] Colección `animal_ownership_periods` separada de `nameHistory`, con un
      único periodo ACTIVE por animal, versión de propiedad y procedencia de la
      fecha inicial.
- [x] Colección interna `animal_ownership_controls`, con `ownershipVersion` y
      reserva atómica por `transferId`; adquirir exige dueño/versión esperados y
      liberar exige el mismo transferId.
- [x] Backfill idempotente al iniciar, por cursor de ID y lotes de 200: usa `Animal.createdAt` cuando existe y lo
      marca como inferido; si no existe conserva fecha desconocida sin inventarla.
- [x] Los animales nuevos inicializan su control y periodo con procedencia
      CREATED. Si falla esa persistencia auxiliar después de guardar el animal,
      se conserva la respuesta exitosa de creación y se registra reparación
      pendiente; el arranque o la siguiente escritura reintentan inicializar.
      Esa reparación usa procedencia inferida. `nameHistory` solo guarda nombres.
- [x] Escrituras de ficha/foto, diario/adjuntos y creación, aceptación,
      reemplazo o eliminación médica consultan el lock. Un lock PROCESSING
      devuelve 409; las lecturas actuales siguen disponibles.
- [x] La política de escritura verifica también existencia y coincidencia del
      control; el inicializador verifica dueño/versión del periodo activo.
      Un error de índice duplicado solo se tolera si existe el estado esperado;
      otro conflicto o fallo de persistencia se propaga.
- [x] Swagger registra el conflicto en ficha, foto, diario/adjuntos y análisis.
      La lectura de grupos médicos ya normalizados sigue disponible con lock;
      la normalización de un registro legacy multi-animal requiere permiso de
      escritura para cada animal afectado.
- [x] Coordinación de escrituras HTTP frente a adquirir reserva: tercer subbloque.
      Sigue pendiente cerrar cargas S3 tardías, captura e integración real antes
      de habilitar aceptación.
- [x] Preparación persistida de instantáneas paginables, manifiesto y copias
      históricas/de preparación: segundo subbloque descrito a continuación.
- [ ] Faltan corte estable, antecedentes retenidos, copia/referencias activas y
      commit de cierre/apertura de periodos.
- [ ] El backfill se probó con repositorios simulados; falta ejecutarlo contra
      Mongo real/replica set antes de despliegue.

### Compatibilidad frontend del subbloque 2

- Contrato anterior: las mutaciones autorizadas podían responder 200/201/204 o
  sus errores existentes; no había estado de bloqueo por transferencia.
- Contrato nuevo: sin cambiar payloads exitosos, una mutación puede responder
  `409` con `The animal is temporarily locked while its transfer is processed`.
  Solo ocurrirá cuando el futuro flujo de aceptación haya adquirido la reserva;
  una solicitud PENDING no bloquea.
- Integración: Flutter debe conservar el formulario local, informar que el
  traspaso está procesándose, refrescar animal/transferencia y no reconstruir ni
  confirmar de nuevo URLs de carga antiguas. Las lecturas no cambian.
- No se agregaron campos a `AnimalResponseDto`, no cambió `ownerId`, UUID,
  código, `nameHistory`, rutas exitosas ni contratos de catálogo/buscador.
- Creación: el body de éxito y el HTTP 201 se conservan aun cuando falle solo
  la inicialización auxiliar posterior; no solicitar recrear el animal.
- Los conflictos de estado inconsistente tienen mensaje propio y no significan
  transferencia en curso. El contrato e instrucciones por ruta constan en
  [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).

### Verificación ejecutada

- `npm run build`: aprobado.
- `npm run build` después del subbloque de periodos/locks: aprobado.
- ESLint de todos los TypeScript modificados: aprobado.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  30 suites, 206 pruebas aprobadas. Incluye 26 suites médicas/179 pruebas y
  4 suites nuevas/27 pruebas de permisos, almacenamiento, buscador/catálogo y
  serialización pública.
- Regresión amplia después del subbloque 2:
  `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  34 suites y 220 pruebas aprobadas. Incluye upserts idempotentes, comparación
  owner/versión/transferId, backfill sin usar `nameHistory`, HTTP 409 con lectura
  disponible, creación recuperable, fallos de estado inconsistente, backfill por
  lotes y toda la regresión médica seleccionada.
- La regresión emitió un aviso no bloqueante: el runtime/Docker actual usa Node
  20 y el AWS SDK anuncia que versiones publicadas después de la primera semana
  de enero de 2027 requerirán Node 22. No se cambió runtime en este subbloque.
- Suite global exploratoria: 28 suites aprobadas y 8 suites heredadas fallidas
  antes de añadir las nuevas pruebas. Fallos de imports/fixtures/mocks antiguos
  en auth, usuario, animal y generador JWT; no se declara la suite global verde.
- Primer intento en sandbox falló por EPERM al escribir caché de Jest. Las
  verificaciones citadas se ejecutaron fuera del sandbox, sin llamadas a AWS.

### Bloque 2: segundo subbloque, preparación interna de archivos

- [x] `OwnershipArchiveModule` integrado sin controllers ni ejecución automática.
      Colecciones de cabeceras, registros paginables y manifiesto por objeto.
- [x] Ficha, diario/fotos/audio y documentos médicos aceptados individuales:
      copia JSON independiente, hash estable y referencias de archivos.
      Conserva UUID/código/nombres/categorías/extracción/fechas sin IA ni nueva
      numeración; rechaza mezcla de animales, dueños o referencias legacy sin
      normalizar.
- [x] Definición y recursos idempotentes e inmutables. La preparación exige
      reserva y periodo de propiedad coincidentes. Añadir registro/manifiesto y
      sellar se coordinan con transacciones Mongo cortas; exige una ficha y
      conteo exacto antes de copiar.
- [x] Claves deterministas conservando la jerarquía de categorías, documentos,
      revisiones y diario. Histórico separado del origen y preparación separada
      del destinatario; el destino activo se registra pero todavía no se escribe.
- [x] ETag/VersionId fijados; copias con condición de origen y verificación SHA-256
      por streaming del original y de ambas copias, además del tamaño.
- [x] Lotes acotados, leases técnicos por archivo y confirmación por token vigente;
      reanuda después de un fallo/reinicio sin repetir objetos verificados.
      Un lease vencido recupera trabajo; no define vencimiento de transferencias.
- [x] `READY` significa preparación completa, sin publicación/cambio de dueño.
      Una pérdida de reserva, copia corrupta, cuenta inconsistente o worker
      obsoleto no confirma ese trabajo.
- [x] Contrato frontend revisado: ningún endpoint, DTO, URL de carga, respuesta
      exitosa o código HTTP existente cambia. Flutter no requiere ajustes en
      esta etapa. No consumir estados internos ni rutas históricas propuestas.
- [ ] Capturar todo el expediente en vivo bajo coordinación de escrituras en
      curso, comprobar IA pendiente e incorporar antecedentes históricos retenidos.
      El subbloque 4 ya captura el expediente actual del periodo inicial y
      comprueba IA; siguen pendientes corte S3 y antecedentes de otros periodos.
- [ ] Activar referencias y publicar el archivo en el commit de propiedad, con
      permisos de consulta/descarga y retención ante reemplazos/borrados.
- [ ] Recolector de preparaciones abandonadas: esta etapa no borra originales ni
      copias fallidas; quedan para reintento. Requiere ciclo terminal, exclusión
      de workers y revisión de referencias antes de implementar limpieza.
- [ ] Probar transacciones/índices con Mongo replica set y operaciones/versionado
      con S3 real. Verificar IAM, privacidad/lifecycle y límites técnicos antes
      del despliegue. No se cambiaron credenciales, bucket ni datos productivos.

Detalle técnico, requisitos del llamador y limitaciones:
[ownership-archive-preparation.md](./ownership-archive-preparation.md).

Validación de esta etapa:

- `npm run build`: aprobado.
- ESLint de todos los TypeScript modificados/nuevos: aprobado.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  38 suites, 248 pruebas aprobadas; 4 suites nuevas y 28 casos adicionales frente
  a las 34 suites/220 pruebas del checkpoint `991eeb8`.
- Casos nuevos: independencia del JSON/nombres/códigos/fechas, preservación de
  rutas, deduplicación médica, rechazo de fuentes ajenas/legacy, copia parcial y
  reinicio, idempotencia, control de reserva/lease, integridad de bytes incluso
  con corrupción del mismo tamaño, fuente modificada, cierre incompleto,
  concurrencia de sellado/finalización y animales sin archivos.
- Mongo y S3 se simulan: estas pruebas no demuestran transacciones reales,
  permisos del bucket ni un traspaso integral. Se conserva separada la deuda de
  las ocho suites globales heredadas indicada arriba.

### Bloque 2: tercer subbloque, coordinación de escritores HTTP

Base `e7db2b2`; registrado después en `0678850` por el usuario. Se cierra este subbloque de
coordinación, no el corte completo ni la transferencia.

- [x] `AnimalWriteCoordinator` registra tokens persistidos por animal/operación
      con dueño/versión y ausencia de lock en la actualización atómica. Ficha,
      foto, diario y adjuntos lo usan durante toda la operación esperada.
      Tokens/reserva/ventanas requieren acknowledgement de mayoría; un resultado
      incierto de adquisición no ejecuta el callback ni borra claims a ciegas.
- [x] Adquirir reserva exige cero tokens y ventanas de carga vencidas, en el
      mismo control. Mongo compara con `$$NOW`; no confía en `lockedAt` para
      vencer URLs. Si gana una escritura no se reserva, si gana la reserva
      no se ejecuta el callback de escritura.
- [x] Adquisición multi-animal ordenada/deduplicada antes de mutar; libera solo
      tokens propios al fallar otro animal. No serializa escrituras ordinarias
      ni sustituye versiones/compensaciones existentes.
- [x] `MedicalDocumentWriteCoordinator`: análisis, revisión ACCEPT/REJECT,
      reemplazo y su limpieza, DELETE (todos los animales si legacy compartido),
      polling ANALYZING y normalización legacy de grupos. Relee asociaciones
      bajo tokens; una expansión no reservada aborta antes de mutar.
- [x] GET puros y grupos ya individuales siguen disponibles. Siblings individuales
      no elegidos no requieren token para normalización. Polling vuelve a
      obtener el documento antes de refrescarlo dentro de la operación.
- [x] Rescate PDF espera todas las cargas de páginas con `allSettled` antes
      de devolver fallback si una falla. Conserva categorías, extracción,
      advertencias y reglas clínicas; evita liberar tokens con cargas hermanas vivas.
- [x] URLs conservan 300 s y contrato. Se registra ventana monotónica antes de
      entregarlas, sin liberar el token; la duración se comparte con el firmante.
- [x] Sin TTL de tokens: crash/liberación fallida deja bloqueo conservador de
      transferencias, no de todo CRUD. Fallo de liberar no convierte un guardado
      exitoso en error ni oculta la causa original de una operación fallida.
- [x] Documentados contratos anterior/nuevo e instrucciones de Flutter por ruta
      en [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
      Cambios: 409 también en polling ANALYZING/REJECT y alcance conservador
      multi-animal legacy; latencia de fallback PDF puede aumentar. Éxitos intactos.
- [ ] Recuperación verificable de tokens huérfanos; no limpiar por antigüedad.
- [ ] Cerrar PUT iniciados antes del vencimiento/efectos S3 inciertos. La ventana
      de URL NO demuestra fin de cargas ya iniciadas ni un corte estable S3.
- [ ] Integración real Mongo replica set/S3 y despliegue de TODOS los escritores,
      con drenaje de peticiones/URLs previas no registradas. No activar reservas
      en un rolling deployment mixto ni declarar transferencia lista.

Detalle de protocolo, límites y recuperación pendiente:
[animal-write-coordination.md](./animal-write-coordination.md).
No cambia `ownerId`, UUID/códigos, `nameHistory`, reglas de IA ni plazo médico de
48 h. No se crean endpoints de transferencia, decisiones, TTL de solicitudes,
reglas de cancelación, migraciones ni modificaciones de infraestructura.

Validación de esta etapa:

- `npm run build`: aprobado.
- `npx eslint` sobre todos los TypeScript modificados/nuevos: aprobado tras
  corregir tipado/estilo de mocks de las pruebas nuevas.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **41 suites, 276 pruebas aprobadas**; 3 suites nuevas y 28 casos adicionales
  frente a las 38 suites/248 pruebas de `e7db2b2`.
- Casos añadidos: operaciones diferidas y dos instancias sin liberar tokens
  ajenos, carrera de adquisición, versión/dueño, rollback de claims multi-animal,
  fallo de operación/liberación, ventana previa a respuesta y monotonicidad,
  asociaciones que cambian, grupos legacy/individuales, HTTP médico y firma
  intacta, polling con 409/lectura disponible y cargas hermanas PDF tras un fallo.
- `git diff --check`: aprobado. Sin AWS/Mongo reales ni despliegue. Las pruebas
  de filtros/repositorios simulados no prueban exclusión distribuida real.
  Sigue separada la deuda de ocho suites heredadas del barrido global previo;
  no se declara suite global verde. Se conserva el aviso del SDK/Node descrito arriba.

### Bloque 2: cuarto subbloque, preflight y captura paginada interna

Base `0678850`, árbol limpio al retomar. Implementación sin controller,
ejecución automática, commit de propiedad ni cambios de datos productivos.

- [x] `OwnershipArchiveSource` y adaptador Mongo de solo lectura. Reutiliza mapeos
      de dominio y lee primario con mayoría; ficha/diario y documentos ACCEPTED
      sin recortar por fechas clínicas, categorías, grupos ni dueño que pudieran
      ocultar asociaciones inconsistentes. Conserva UUID/código/fechas/nombres.
- [x] `OwnershipArchiveCapture.start` adquiere reserva atómica del protocolo
      existente; relee animal activo/dueño/periodo y exige ausencia de escritores.
      No toma como propia una reserva previa sin cabecera, aunque coincida transferId.
- [x] Preflight médico bajo reserva: PENDING_UPLOAD, ANALYZING, REVIEW_PENDING,
      candidatos de reemplazo y estados desconocidos/ausentes bloquean; no
      cancela procesos ni descarta lecturas. REJECTED/FAILED no se archivan ni
      se consideran pendientes.
- [x] Validación paginada de todos los documentos aceptados antes de crear
      cabecera: rechaza legacy multi-animal, dueño ajeno, referencias/extracción
      inconsistentes sin IA ni normalización automática. Si se deniega antes
      de intentar crear archivo, libera solo su reserva para que el dueño resuelva.
- [x] Tras intentar crear archivo, incluso con acknowledgement incierto, conserva
      reserva y permite reintentar la misma definición. No limpia ni permite
      editar un corte parcial por un error técnico. Un fallo de liberación
      previa conserva el error original y registra recuperación pendiente.
- [x] Captura del expediente actual del periodo inicial, con fases ANIMAL→DIARY→
      MEDICAL→COMPLETE, cursor ID/revisión/conteo persistidos. Hasta 100 registros
      por llamada; preflight médico usa páginas pero recorre todo antes de iniciar.
      No se mantiene una transacción larga ni descarga el expediente a memoria.
- [x] Checkpoint por comparación de revisión/COLLECTING y mayoría. Página parcial
      o fallo del checkpoint se reejecuta con IDs/hashes inmutables, sin duplicar
      registros/manifiestos ni inspeccionar S3 otra vez para entradas existentes.
      Instancias concurrentes no regresan cursor ni duplican conteo.
- [x] Sellado exige COMPLETE/conteo persistido, conteo real exacto y una ficha;
      pasa a COPYING. Continúan los lotes de copia ya implementados. Ni COPYING
      ni READY publican histórico, conceden permisos o cambian propietario.
- [x] Versiones de propiedad posteriores a 1 o cualquier periodo CLOSED se
      rechazan hasta importar antecedentes retenidos. No se presentan como
      copia completa incompleta. `nameHistory` sigue conteniendo solo nombres.
- [x] Compatibilidad frontend revisada/documentada: sin cambios de HTTP, DTO,
      URLs, éxito/error o IA en rutas existentes; Flutter no requiere ajustes
      en este subbloque. Modo manual del preparador conserva su contrato; una
      cabecera antigua sin cursor no se adopta ni migra automáticamente.
- [ ] Sigue pendiente el corte S3 ante PUT tardíos/efectos remotos inciertos;
      lo capturado aún NO garantiza un traspaso productivo estable e integral.
- [ ] Sigue pendiente recuperación de tokens/reservas, incluida caída durante
      preflight o adquisición incierta sin cabecera; no se recupera por TTL.
- [ ] La futura decisión multi-animal debe validar el conjunto ANTES de persistir
      decisiones. Este servicio por animal no autoriza rechazos parciales de
      otros animales cuando falla IA ni sustituye OTP/actor/destinatario/estados.

Detalle de uso, paginación, reservas y límites:
[ownership-archive-capture.md](./ownership-archive-capture.md).

Validación de esta etapa:

- `npm run build`: aprobado.
- `npx eslint` sobre todos los TypeScript modificados/nuevos: aprobado.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **43 suites, 316 pruebas aprobadas**, 2 suites nuevas y 40 casos adicionales
  frente a las 41 suites/276 pruebas de `0678850`.
- Casos nuevos: más de una página por colección y límites exactos/vacíos;
  datos/códigos/nombres/fechas conservados; consulta de todos los estados médicos;
  preflight denegado que libera, legacy normalizable, asociación ajena;
  escritores/URLs/versión/otra reserva; periodo inicial/CLOSED; pérdida de reserva,
  acknowledgement incierto, fallo mid-page/checkpoint y reinicio/concurrencia;
  rechazo de cursores repetidos y archivos manuales; instantánea inmutable y
  guardas de sellado/revisión y lectura primaria/mayoría en los filtros Mongo.
- `git diff --check`: aprobado.
- Mongo y S3 simulados: falta probar replica set, índices, mayoría, transacciones,
  carreras distribuidas, rendimiento y PUT tardíos reales. No se ejecutó
  migración, copia AWS ni despliegue. Sigue pendiente la deuda de ocho suites
  heredadas del barrido global previo; no se declara suite global verde.
- Un intento en sandbox falló por EPERM al renombrar caché de Jest; se repitió
  con permisos y los resultados citados son de ejecuciones completas aprobadas.
  Continúa el aviso no bloqueante SDK/Node ya registrado, sin cambiar runtime.

### Bloque 2: quinto subbloque, aislamiento de cargas nuevas de medios

Base `93ed9b9`, árbol limpio al retomar. Este bloque SÍ modifica comportamiento
de cargas existentes aunque conserve sus JSON. El contrato anterior/nuevo se
escribió antes de implementar y está en
[animal-media-upload-isolation.md](./animal-media-upload-isolation.md).

- [x] `AnimalMediaModule` / `AnimalMediaUploads`: emisión persistida en
      `animal_media_uploads`, claves final/temporal/id únicas, sin TTL ni reciclaje.
      Se reconoce con mayoría antes de entregar la URL. Lecturas primarias con
      mayoría y fijación/sellado condicionados; índices reales pendientes de verificar.
- [x] Nuevas URLs de foto/diario firman PUT solo a `upload-intake/{uploadId}/source`,
      nunca al final. finalUrl conserva jerarquía de foto/diario y los campos
      uploadUrl/finalUrl (+ attachmentId). Firma sigue en 300 s, sin headers nuevos.
      Foto numérica con aleatoriedad para evitar colisiones del mismo milisegundo;
      su valor es opaco, no fecha ni entero de longitud fija para Flutter.
- [x] Confirmación bajo tokens de escritura verifica emisión, scope, MIME/tamaño
      real, ETag/VersionId y SHA-256 por stream. Primera fijación de origen por CAS;
      un competidor recibe la revisión ganadora, no la suya.
- [x] Promoción con CopyObject: condición de origen y destino `IfNoneMatch: '*'`.
      Valida procedencia/uploadId, digest y revisión del final ANTES de sellar y
      persistir referencia. Una copia no confirmada no significa medio guardado.
- [x] PUT tardío/repetido de emisiones nuevas solo altera temporal. Con versionado
      puede copiar revisión fijada; sin versión, un origen cambiado falla sin
      sustituir la fijación ni sobrescribir final.
- [x] Reintento tras timeout/copia remota tardía o error al sellar reconcilia el
      final existente; no copia encima ni borra originales/temporales para adivinar
      resultado. Un ticket leído como sellado solo se verifica, también después
      de CAS si otro request lo selló; no reconstruye su final ausente.
- [x] Foto/diario usan promoción antes del guardado. Idempotencia se mantiene para
      misma confirmación válida. Diario ahora da 409 si el repositorio no guardó
      el adjunto, en lugar de reportar éxito sin persistirlo.
- [x] Confirmación legacy sin registro nuevo conserva comportamiento anterior;
      no gana garantías por repetir confirmación o esperar 300 s. Captura exige
      foto/diario registrados y sellados: preflight de ficha y TODO el diario por
      páginas deniega antes de crear cabecera y libera solo su reserva nueva.
      Inspección del manifiesto verifica final sellado/hash, no solo HEAD.
- [x] Temporales `upload-intake` no pueden usarse como fuentes activas. La copia
      por lotes vuelve a exigir registro protegido. No se activan archivos antiguos
      preparados sin revisar su procedencia; READY sigue sin publicar ni transferir.
- [x] Swagger y guía Flutter registran cambios: finalUrl disponible DESPUÉS de
      confirmar; preview local si antes se consultaba tras PUT; errores 400/409/502
      adicionales; reintentar misma confirmación ante incertidumbre, pedir nueva URL
      si temporal cambió sin versión recuperable. No inferir transferencia por 409.
      No cambia body/éxito/DTO del animal o diario, pero no se declara cambio inocuo
      para todos los clientes: Flutter no está en este repositorio.
- [x] Foto del usuario, BDA/medicina, catálogos y buscador no cambian. No se cambia
      ownerId, UUID/códigos, nameHistory, reglas médicas ni decisiones abiertas.
- [x] Servicio de migración aislada, explícita, paginada/reanudable de medios
      legacy: sexto subbloque. Sin ejecución real/automática ni borrado de originales.
- [ ] Rollout de TODOS los emisores, verificación de índices/privacidad/IAM,
      S3 real y costes/latencia. No requiere ni presupone una política nueva de
      vencimiento de transferencia. No se hicieron llamadas AWS/Mongo productivas.
- [ ] Siguen pendientes: recuperación de tokens/reservas, antecedentes retenidos,
      efectos remotos no cubiertos de otros escritores, permisos/retención,
      limpieza segura, activación y orquestación integral. Una promoción ya en curso
      puede dejar huérfano si compite con borrado; no se promete cancelarla o
      limpiar por TTL. No habilitar aceptación todavía.

Fundamento contrastado con documentación primaria AWS: una URL puede reescribir
su clave; CopyObject admite condición del destino. Referencias en el documento
técnico. El SDK instalado modela esa condición; falta validarla en el bucket real
y no se presupone que todo emulador la implemente.

Validación de esta etapa:

- `npm run build`: aprobado.
- ESLint de todos los TypeScript modificados/nuevos: aprobado.
- `git diff --check`: aprobado.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **45 suites, 343 pruebas aprobadas**, 2 suites nuevas y 27 casos adicionales
  frente a las 43 suites/316 pruebas de `93ed9b9`.
- Nuevos casos: emisión antes de firma; temporal/final separados; firma/cuerpos y
  jerarquía conservados; PUT tardío; copy timeout completado o pendiente; fallo al
  sellar; competidores; borrado después de sellar y durante fijación; versionado
  y sin versionado; MIME/tamaño/URLs ajenos; corrupción del mismo tamaño;
  no sobrescritura ni reciclaje; confirmación legacy sin marcar protegido;
  mayoría/CAS/proyección de repositorio; preflight legacy que libera; errores
  de persistencia de adjunto y guardas de temporal; Swagger de integración.
- Mongo/S3 simulados: no demuestra mayoría/transacciones ni exclusión distribuida
  real. Se conservan las ocho suites heredadas del barrido global previo como
  deuda separada, sin declarar suite global verde. Sin migración/despliegue/IAM.
  Continúa el aviso no bloqueante Node/AWS SDK del checkpoint anterior.

### Bloque 2: sexto subbloque, migración interna de medios legacy

Base `92322a3`, árbol limpio al retomar. Contrato anterior/nuevo registrado ANTES
de implementar en [animal-media-legacy-migration.md](./animal-media-legacy-migration.md).
Servicio implementado, no migración ejecutada ni feature de transferencia completo.

- [x] `LegacyAnimalMediaMigration` exportado por AnimalMediaModule, sin endpoint,
      worker de arranque ni script productivo. ID/dueño/animal UUID y versión
      positiva; misma definición idempotente, reutilización de ID incompatible denegada.
- [x] `animal_media_migrations` persistido por trabajo con fase/revisión/cursor,
      ID único y sin TTL. Crear trabajo/adquirir reserva es una transacción corta
      snapshot/primary/majority. Exige animal/dueño/periodo ACTIVE coincidentes.
      El ID de reserva usa namespace `media-migration:{id}`, no solicitud de negocio.
- [x] Filtro drenado compartido con reserva de transferencia: cero escritores,
      ausencia de otra reserva y ventanas comparadas con reloj Mongo. No toma
      una reserva sin trabajo ni considera la espera prueba de fin de PUT.
- [x] Fases PROFILE→DIARY→COMPLETED; hasta 20 entradas por llamada, cursor estable
      y proyección de referencias. Rechaza IDs duplicados, cursor regresivo,
      páginas excesivas y cambios no seleccionados. Una entrada puede tener varios
      adjuntos; coste/latencia y cursor por archivo más fino pendientes de evaluar.
- [x] `LegacyAnimalMediaCopier`: ticket determinista por trabajo/fuente, fuente
      única y procedencia de URL/recurso. No emite PUT para migración. Reutiliza
      fijación CAS y copia/sellado verificados; conserva revisión elegida ante
      competidores/reintentos y reconcilia respuesta de copia perdida.
- [x] Fuentes limitadas al mismo dueño/animal/entrada/adjunto; MIME/tamaño/extensión
      se comprueban sin cambiar datos. Medios nuevos no confirmados no se bendicen
      como legacy. Objetos sellados actuales se verifican sin migrarlos otra vez.
- [x] Página confirma SOLO URLs con CAS y ticket sellado/procedencia, cursor y
      revisión en transacción, con fence escrito `mediaMigrationRevision` en
      control. Nunca guarda ficha/entrada completa ni modifica fechas/metadatos.
      La última página libera solo su reserva en la misma transacción.
- [x] Worker obsoleto no modifica referencias tras otro checkpoint/completado.
      Copias ya en curso pueden quedar huérfanas, nunca sobrescribir otro final;
      no se borran originales/copias por adivinar el resultado. Fallos dejan cursor
      y reserva para el mismo ID; no refijan contenido ni desbloquean por edad.
- [x] Compatibilidad frontend documentada en guía/Swagger: migración explícita
      cambia URLs, no IDs. Diario admite subruta sealed para un adjunto existente;
      confirmación canónica idéntica idempotente. URL retirada/cambiada da 409 para
      refrescar, no restaura referencias antiguas. Mismos DTO/cuerpos/éxitos.
      Reserva de mantenimiento también puede dar el 409 existente sin transferencia.
- [x] Sin cambios de ownerId, código/UUID, nameHistory (nombres), medicina,
      catálogos/buscador, foto de usuario ni decisiones de vencimiento/cancelación.
- [x] Detención técnica explícita de migración cuando no es posible recuperar
      revisión legacy: séptimo subbloque. No repara bytes ni declara COMPLETED.
- [ ] Recuperación de tokens huérfanos generales y autorización/integración real
      de recuperación de migración antes de rollout productivo.
- [ ] Rollout Flutter/cachés y TODAS las réplicas; pruebas Mongo replica set de
      rollback/índices/mayoría y S3 reales, privacidad/IAM/costes. Sin ejecución
      productiva, borrado de datos, despliegue ni nuevas dependencias.

Validación de esta etapa:

- `npm run build`: aprobado.
- ESLint de todos los TypeScript modificados/nuevos: aprobado.
- `git diff --check`: aprobado.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **47 suites y 376 pruebas aprobadas**, 2 suites nuevas y 33 casos adicionales
  frente a las 45 suites/343 pruebas de `92322a3`.
- Casos: definición/ID, reserva drenada y transacciones con mayoría; páginas,
  cursores, duplicados y límites; reanudación/concurrencia; respuesta de inicio,
  copia o checkpoint perdida; PUT legacy tardío con/sin versionado; preservación
  del original y de identidad/metadatos; rechazo de fuente ajena/ausente,
  MIME/tamaño inválidos y carga nueva sin confirmar; procedencia/sellado antes
  de activar; CAS de URL, fence/reserva perdida, worker obsoleto y finalización;
  URL retirada sin restauración, subruta canónica idempotente y sin recreación.
- Mongo/S3/sesiones simulados: las pruebas verifican el protocolo solicitado,
  no rollback real, majority/índices reales ni exclusión distribuida. La deuda
  separada de ocho suites globales heredadas sigue abierta; no se declara suite
  global verde. Aviso SDK/Node no bloqueante, sin cambiar runtime. Sin migración
  real, cambios IAM, despliegue, commit/push ni borrado de datos por el agente.

### Bloque 2: séptimo subbloque, recuperación técnica de migraciones e inventario

Base `d6e2b53`, árbol limpio al retomar. Contrato anterior/nuevo registrado antes
de implementar en [animal-media-migration-recovery.md](./animal-media-migration-recovery.md).
Servicios internos sin controller, cron, ejecución real ni nueva dependencia.

- [x] `stopForRecovery` explícito en LegacyAnimalMediaMigration: ID y solicitud
      UUID, operador, revisión observada, motivo técnico y referencia de evidencia.
      Valida todos los datos antes de delegar. No se dispara por error S3/edad.
- [x] STOPPED terminal técnico separado de COMPLETED y de estados de negocio.
      No acepta detener una migración completada ni reiniciar la misma detenida.
      La revisión obsoleta exige refrescar, no se actualiza silenciosamente.
- [x] Relee animal/dueño/periodo ACTIVE; fase/revisión, auditoría/stoppedAt y
      liberación de SOLO su reserva namespaced con fence escrito van en la misma
      transacción snapshot/primary/majority. Exige ausencia de escritores; no
      retira activeWrites, ventanas, reservas ajenas ni datos del animal/diario.
- [x] Request idempotente por ID de trabajo y payload completo. Repetir tras
      respuesta perdida verifica la misma auditoría sin tocar una reserva posterior.
      RequestId/operador/revisión/motivo/evidencia distintos se rechazan.
- [x] Página y detención compiten por revisión escrita. Una página obsoleta no
      activa referencias ni libera reservas. Copias remotas ya iniciadas pueden
      acabar huérfanas en sus claves exclusivas; no se promete cancelarlas/borrarlas.
      No refija origen, recicla tickets ni revierte páginas ya confirmadas.
- [x] Guarda de confirmación: una copia legacy de migración solo se reconfirma
      si ya es la referencia actual leída por el caso de uso, nunca enviada por
      Flutter como campo nuevo. Evita activar huérfanos preparados o desplazar una
      foto posterior mediante PATCH. Confirmación actual idempotente sin backfill.
      Cargas nuevas no migradas conservan promoción y reintentos anteriores.
- [x] `AnimalWriteRecoveryInventory` exportado desde AnimalMediaModule. Lista
      controles con tokens/reserva por animalId, 20/50 + lookahead, proyección
      mínima y lecturas primario/mayoría; una consulta acotada asocia migraciones
      por ID/dueño/versión y conserva observaciones MISSING/MISMATCH/terminales.
      Sin filtros de edad ni clasificación de huérfanos, sin capacidad de escritura.
- [x] Contrato Flutter/Swagger actualizado: mismos DTO/cuerpos/éxitos; 409 en
      confirmación de copias migradas no actuales exige refrescar, no reactivar.
      Recuperación interna no implica transferencia cancelada/aceptada ni medio
      reparado. No enviar currentUrl/STOPPED/IDs operativos ni crear botones nuevos.
- [x] Sin cambiar ownerId/UUID/código/nameHistory, clínica/categorías/límites,
      foto de usuario, catálogo/buscador ni vencimiento/cancelación de transferencia.
- [ ] No se implementa retirada de tokens generales ni recuperación de reservas
      de captura/archivo/transferencia: sus efectos remotos requieren otro protocolo.
      Inventario no prueba muerte de un proceso ni autoriza force-unlock.
- [ ] Autenticación/autorización del futuro llamador operativo, evidencia real,
      despliegue de guardas en TODAS las réplicas, Mongo replica set/S3 reales,
      costes/privacidad/IAM e integración antes de ejecutar intervención productiva.

Validación de esta etapa:

- `npm run build`: aprobado.
- ESLint de todos los TypeScript modificados/nuevos y `git diff --check`: aprobados.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **49 suites y 404 pruebas aprobadas**, 2 suites nuevas y 28 casos adicionales
  frente a las 47 suites/376 pruebas de `d6e2b53`.
- Casos: payload/evidencia explícitos, STOPPED sin trabajo posterior; auditoría,
  scope de reserva/cero escritores y misma transacción; fase/revisión/dueño/periodo
  inconsistentes, respuesta de detención perdida, payload de reintento cambiado,
  página obsoleta; copia tardía sin activación por PATCH, foto actual idempotente
  sin desplazar una posterior; inventario/cursor/límites, proyección/mayoría,
  antigüedad sin limpieza, asociaciones perdidas/ajenas y errores de lectura.
- Mongo/S3/sesiones simulados: verifican protocolo y filtros solicitados, no
  rollback real ni exclusión distribuida. Sigue separada la deuda de ocho suites
  globales heredadas; no se declara suite global verde. Aviso no bloqueante del
  SDK/Node sin cambiar runtime. Sin migración/intervención real, borrado de datos,
  AWS productivo, despliegue, commit/push ni cambios IAM por el agente.

### Bloque 2: octavo subbloque, journal e identidad de operaciones

Base `cdc32b2`. Contrato registrado antes de implementar en
[animal-write-journal.md](./animal-write-journal.md); impacto completo en la guía
central [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).

- [x] AnimalWriteJournalModule importado/reexportado por AnimalModule. Colección
      animal_write_journals con id único e índice instanceId/lifecycle, sin TTL,
      controllers, heartbeat ni ejecución automática de recuperación.
- [x] Identidad aleatoria UUID por arranque del proceso y por operación/token;
      actor, tipo permitido asignado en backend, conjunto ordenado/deduplicado,
      timestamps y estados/versión por claim. No guarda payload, extracción,
      error crudo, archivos, OTP, credenciales o URLs firmadas.
- [x] Autorización previa del conjunto conserva denegaciones antes de journal;
      adquisición sigue comparando dueño/versión/lock actuales. Creación con
      mayoría e INTENT/versión reconocidos antes de intentar claims. Nuevos claims
      enlazan operationId==token e instanceId; no reinterpreta ni elimina legacy.
- [x] ACQUIRE_UNKNOWN explícito ante excepción; si falla registrar, INTENT es
      conservador. No libera el claim incierto ni invoca callback sin todas las
      adquisiciones conocidas y permiso MAY_RUN persistido/condicionado.
- [x] MAY_RUN es posibilidad, no prueba de ejecución. RETURNED/THREW o NOT_INVOKED
      reflejan solo callback local; error no significa rollback. Callback y
      coordinador tienen resultados separados (p. ej. falla ventana tras firmar).
- [x] Liberación solo de claims ciertos; RELEASED requiere acknowledgement,
      RELEASE_UNKNOWN/INTENT inciertos conservan OPEN. Fallos de evidencia/liberación
      posteriores no cambian éxito/error original. LOCALLY_FINISHED requiere
      callback resuelto/no invocado y claims liberados/no tomados; no demuestra
      ausencia de efectos remotos tardíos ni finalización de IA asíncrona.
- [x] Callers de ficha/foto, diario/adjuntos y medicina etiquetados sin alterar
      datos/reglas. GET puros/grupos normalizados, creación inicial de animal,
      foto usuario, auth, catálogos y feedback anónimo siguen sin journal.
- [x] Swagger/guía Flutter: mismos DTO/cuerpos/éxitos, incluido PUT animal
      primitivo. Nuevos fallos de preparación 500/conflicto 409 propio exigen
      conservar/refrescar, sin generar IDs técnicos, reiniciar análisis o duplicar
      por latencia. No aporta idempotencia de negocio ni campos públicos nuevos.
- [x] Lecturas internas primario/mayoría para correlación por operación. Updates
      condicionados por id/instanceId/lifecycle/estado; no recicla IDs, no adopta
      journals previos ni permite scope inicial vacío/duplicado/precompletado.
- [ ] Journal/control no comparten transacción aquí; se conserva incertidumbre,
      no se finge atomicidad. Fencing transaccional de adquisición y recuperación
      pre-callback quedan para el siguiente subbloque. No hay retirada administrativa
      de tokens generales, recuperación de reservas de archivo ni limpieza por edad.
- [ ] Verificación real de índices/mayoría, Mongo replica set/S3, latencia/BSON,
      rollout en TODAS las réplicas y políticas de retención antes de producción.

Validación de esta etapa:

- `npm run build`: aprobado.
- ESLint de todos los TypeScript modificados/nuevos y `git diff --check`: aprobados.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **50 suites y 436 pruebas aprobadas**, 1 suite nueva y 32 casos adicionales
  frente a las 49 suites/404 pruebas de `cdc32b2`.
- Casos: orden journal/intención/claim/permiso, identidad/actor/tipo y scope,
  creación/intent/permiso de acknowledgement incierto sin invocar callback,
  adquisición incierta multi-animal sin liberar token desconocido, liberación
  incierta, callback fallido sin inferir rollback ni guardar su error/payload,
  éxito conservado si falla evidencia, ventana tras callback, identidad de proceso,
  guardas Mongo de transición/mayoría/lectura/índices sin TTL, scope inicial,
  metadata nueva y compatibilidad legacy; HTTP 500/409 previo sin mutar negocio,
  PUT/GET y multipart/202 médicos conservados, tipos de polling/rechazo/delete.
- La primera pasada detectó una expectativa nueva incorrecta del test para la
  respuesta primitiva de PUT animal; se corrigió la prueba, NO la serialización
  vigente. La ejecución completa final citada está aprobada.
- Mongo/S3/sesiones simulados: no prueban failover, índices/mayoría reales,
  exclusión distribuida o reconciliación de efectos remotos. Siguen separadas las
  ocho suites globales heredadas; no se declara suite global verde. Aviso SDK/Node
  no bloqueante sin cambiar runtime. Sin migración, recuperación real, AWS
  productivo, borrado de datos, despliegue, commit/push ni cambios IAM por el agente.

### Contexto persistente y siguiente paso

- [x] Mapa de módulos, invariantes y riesgos en
      [application-map.md](./application-map.md).
- [x] AGENTS.md indica leer mapa/plan/estrategia y registrar avances al retomar.
- [x] Preflight médico y captura paginada/reanudable del periodo inicial:
      cuarto subbloque. Aún no habilita aceptación.
- [x] Aislar PUT de emisiones nuevas y reconciliar promoción incierta: quinto
      subbloque. No cubre automáticamente medios legacy ni todos los escritores.
- [x] Migración interna explícita de foto/adjuntos legacy: sexto subbloque;
      contrato registrado y pruebas simuladas, sin ejecución real/autorización de rollout.
- [x] Recuperación inicial de migración por detención técnica e inventario de
      claims/reservas sin inferir huérfanos: séptimo subbloque, sin ejecución real.
- [x] Journal/identidad persistida de operaciones e instancias para nuevos claims:
      octavo subbloque. Incertidumbre explícita y compatibilidad legacy, sin retirar tokens.
- [ ] Siguiente subbloque concreto: ligar transaccionalmente nuevas adquisiciones
      a la autorización del journal y añadir recuperación explícita/auditada solo
      antes de que el callback pueda ejecutarse, impidiendo adquisiciones tardías.
      No recuperar tokens legacy ni MAY_RUN/efectos remotos inciertos por tiempo
      o por ver un error; esos casos requieren otro protocolo de evidencia.
      Registrar impacto frontend en el archivo central antes de cambiar contratos.
- [ ] Incorporar antecedentes retenidos con procedencia/referencias explícitas
      y pruebas A→B→C/devolución, sin perder documentos reemplazados/borrados.
      Retirar el guard del periodo inicial solo al completar esa importación.
- [ ] Recuperación verificable de tokens/reservas, pruebas reales, activación
      de referencias y conservación/permisos históricos/limpieza segura antes
      de habilitar aceptación.
- [ ] Siguen pendientes: autorización OTP específica (reutilizando transporte),
      solicitudes/decisiones, notificaciones/outbox/push, migración y prueba integral.

Los endpoints de descubrimiento ya existen; POST de transferencia y aceptación
todavía no existen. No crear solicitudes simuladas en Flutter ni confundir este
checkpoint con el cierre del feature.
