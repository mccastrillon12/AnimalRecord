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
presente al retomar con árbol limpio. Journal de operaciones confirmado en
`549ec89`. Fence transaccional/recuperación previa al callback confirmado en
`e3be10f`. Arnés opt-in confirmado en `8ffe44c`; validación real local y
documentación confirmadas por el usuario en `0c2a1ea`; importador de antecedentes
confirmado en `ebf6fe1`; plan de referencias confirmado en `789e4ac`, HEAD y
origin/codex/animal-transfer-planning al retomar el subbloque 14, con árbol limpio.
Materialización confirmada por el usuario en `7dafada`; generaciones confirmadas
en `5bcc64d`; registro de medios confirmado en `d731350`, HEAD y referencia
origin coincidentes al retomar el subbloque 17, con árbol limpio.
Revalidación de metadatos confirmada en `12d0390`, HEAD y referencia origin
coincidentes al retomar el subbloque 18, con árbol limpio; no se hizo fetch.
Observación S3 confirmada en `f09632c`, HEAD y referencia origin coincidentes al
retomar el subbloque 19, con árbol limpio; sin fetch. Subbloque 19 cerrado el
2026-10-26; los registros anteriores conservan su fecha/evidencia original.
Identidad de reserva confirmada en `e54fba9`, HEAD y referencia origin coincidentes
al retomar el subbloque 20, con árbol limpio y sin fetch.
Vínculo de preparaciones confirmado en `0bf5d9c`, HEAD y referencia origin
coincidentes al retomar el subbloque 21; árbol limpio, sin fetch.
El agente no hace commits/push/despliegues. El feature sigue
en desarrollo.

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
- [x] Journal/control no compartían transacción en esa base; fencing de nuevas
      adquisiciones y recuperación previa al permiso implementados en subbloque 9.
- [ ] Sigue pendiente recuperación de tokens generales/legacy/con callback
      posible y reservas de archivo; no hay limpieza por edad.
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

### Bloque 2: noveno subbloque, adquisición transaccional y recuperación previa al permiso

Base `549ec89` comprobada en git junto con rama correcta y árbol limpio antes de
editar. El octavo bloque sí estaba confirmado. Servicio interno implementado sin
endpoint, arranque automático, ejecución sobre datos reales ni nuevas dependencias.

- [x] Nuevos journals marcan TRANSACTIONAL_CLAIMS_V1, sin default/backfill del
      campo opcional. Journals anteriores se leen sin atribución y quedan excluidos
      de la recuperación nueva; identidad sola no aporta la garantía transaccional.
- [x] Cada beginWrite enlazado inserta token y autoriza ACQUIRED en la misma
      transacción snapshot/primary/majority. Compara animal/dueño/versión/lock,
      evita token duplicado y exige id/instancia/actor/protocolo/OPEN/NOT_STARTED,
      INTENT/versión y ausencia de permiso previo en journal. Fallar autorización
      aborta el token. La confirmación posterior ACQUIRED no autoriza un INTENT.
- [x] MAY_RUN requiere protocolo nuevo y todas las adquisiciones conocidas;
      escribe permiso/fecha en el mismo journal que compiten adquisición y
      recuperación. No hay callback/S3 en la transacción ni idempotencia de negocio.
      Adquisiciones multi-animal siguen ordenadas antes del callback completo.
- [x] AnimalModule exporta AnimalWriteRecovery. Solicitud explícita UUID por
      operación/instancia/request/operador, motivo técnico y referencia de evidencia
      validada. Solo OPEN con tipo backend conocido, NOT_STARTED/NOT_INVOKED y
      SIN callbackPermittedAt. Una autorización MAY_RUN con respuesta perdida
      conserva esa fecha aun con NOT_INVOKED y nunca se recupera por este protocolo.
- [x] Recuperación terminal y retiro exacto de tokens van juntos en una transacción;
      auditoría por animal conserva estado anterior/tokenRemoved y evidencia.
      Si recuperación gana, adquisición atrasada aborta y MAY_RUN se deniega; si
      adquisición gana, recuperación reintenta/observa el token; si MAY_RUN gana,
      recuperación se rechaza y sus retiradas tentativas no se confirman.
- [x] Reintento idéntico de intervención después de respuesta perdida verifica la
      auditoría sin tocar controles posteriores; solicitud/operador/evidencia/motivo
      distintos se rechazan. No cambia ventanas ni reservas ni retira tokens ajenos;
      identidad legacy/duplicada inconsistente provoca fallo cerrado.
- [x] Compatibilidad central registrada en
      [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md):
      mismas rutas/DTO/cuerpos/éxitos, incluido PUT animal primitivo, con dependencia
      nueva de transacciones Mongo para TODAS las escrituras coordinadas y latencia.
      Conservar 500/409 previos al callback, datos locales, polling sin solapar y
      consulta de estado antes de repetir; no enviar IDs/protocolo/auditoría desde
      Flutter. Un error sigue sin demostrar rollback o ausencia de efectos remotos.
- [x] Sin alterar ownerId, UUID/códigos, nameHistory (nombres), reglas clínicas,
      límite médico de 48 h, foto usuario, auth, catálogo/buscador ni decisiones
      pendientes de cancelación/vencimiento. No habilita transferencia completa.
- [ ] Autorización/autenticación del futuro llamador operativo, rollout en TODAS
      las réplicas y drenaje de antiguas, índices/mayoría/transacciones reales,
      costes/latencia/BSON y políticas de retención antes de producción.
- [ ] Recuperación de journals previos/tokens legacy, UNSPECIFIED, callbacks
      posibles/efectos remotos inciertos y reservas de captura/archivo/transferencia
      requiere otro protocolo. No hay TTL, recuperación automática o reejecución
      del callback. No usar edad ni un error como criterio de retirada.

Detalle de protocolo, carreras y límites:
[animal-write-journal.md](./animal-write-journal.md).

Validación de esta etapa:

- `npm run build`: aprobado, incluido el ajuste final de validación de evidencia.
- ESLint mediante `npm exec -- eslint` de todos los TypeScript nuevos/modificados:
  aprobado; repetido en los dos archivos del ajuste final, aprobado.
- `git diff --check`: aprobado.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **53 suites y 471 pruebas aprobadas**, 3 suites nuevas y 35 casos adicionales
  frente a las 50 suites/436 pruebas de `549ec89`.
- Tras endurecer el rechazo de saltos de línea finales en evidenceRef, repetición
  focalizada de `test/animal-transfer/application/animal-write-recovery.spec.ts`:
  **1 suite y 13 pruebas aprobadas** (incluidas en el conjunto anterior, no sumar).
- Casos nuevos: adquisición/permiso en transacción común y fence perdido;
  recuperación frente a adquisición y MAY_RUN en ambos órdenes; snapshots
  obsoletos/rollback/reintento simulados; fallo multi-animal sin retirada parcial;
  commits reconocidos de forma incierta, auditoría/idempotencia y payload cambiado;
  journals previos y tokens legacy excluidos, token duplicado y reserva posterior;
  NOT_INVOKED con/sin permiso previo; no autorizar ACQUIRED desde solo journal;
  UUID/motivo/referencia técnica sin URL firmada/texto libre; exports/inyección
  del modelo de journal sin abrir conexiones. Los contratos HTTP previos pasan.
- La primera regresión detectó un operador `$nin` sin implementar en el nuevo
  simulador; se completó el doble y se repitió el conjunto con éxito. Corregidos
  estilo/tipado de expectativas de pruebas. No se alteraron cuerpos exitosos.
- El intento inicial en sandbox falló al renombrar caché Jest (EPERM); las
  ejecuciones citadas se completaron fuera del sandbox. Se mantiene el aviso
  no bloqueante SDK/Node del checkpoint anterior, sin cambiar runtime.
- Mongo/S3/sesiones simulados: no prueban transacciones/majority/índices/failover
  reales ni cierre de efectos remotos. Sigue separada la deuda conocida de ocho
  suites globales heredadas; no se volvió a ejecutar ni se declara verde la suite
  global. Sin migración/intervención real, llamadas productivas AWS/Mongo/S3,
  cambios IAM, borrado de datos, despliegue, commit o push por el agente.

### Bloque 2: décimo subbloque, arnés opt-in de integración Mongo

Base `e3be10f` confirmada con rama correcta y árbol limpio. Se prepara validación
de infraestructura, sin modificar código de ejecución del backend, reglas de
negocio ni las exclusiones de recuperación. En ese checkpoint la suite contra
Mongo aún no se había ejecutado; primera ejecución posterior en el subbloque 11.

- [x] Comandos npm para compilar sin emitir y ejecutar con configuración Jest
      separada. Archivo `.mongo.integration.ts` excluido del patrón `.spec.ts`
      ordinario; no se ejecuta con npm test ni al arrancar el servidor.
- [x] GlobalSetup exige opt-in exacto y URI exclusiva, sin dotenv ni fallback
      a configuración de aplicación. Solo loopback con puerto/replicaSet explícitos,
      sin credenciales/SRV/base seleccionada ni opciones ambiguas. Conexión directa
      a primario y comprobación de topología/sesiones antes de crear colecciones.
- [x] Namespace aleatorio e inmutable por ejecución; dos conexiones independientes,
      modelos/schemas/adaptadores Mongo reales y servicio interno de recuperación.
      No importa AppModule ni dispara seeders, backfills, AWS o migraciones.
- [x] Índices reales solo en la base desechable; marker/UUID/nombre y allowlist
      de colecciones verificados antes de borrarla. Libera barreras/espera operaciones
      observadas/cierra conexiones; rechaza limpieza con identidad inconsistente.
- [x] Once escenarios preparados: índices/sin TTL, adquisición/journal en una
      transacción snapshot/mayoría, rollback de token, carreras con adquisición y
      MAY_RUN en ambos órdenes, rollback multi-animal, exclusiones legacy/permiso
      previo y reintento después de respuesta oculta al llamador tras commit real.
      Esta última inyección no prueba pérdida de paquetes/UnknownTransactionCommitResult.
- [x] Evidencia de comandos limitada a metadatos técnicos, sin documentos/filtros
      o URI. Límites temporales exclusivos de pruebas, sin TTL de tokens ni
      reglas nuevas de cancelación/vencimiento de transferencia.
- [x] Contrato central Flutter actualizado: funcionalidades/rutas/DTO/éxitos/errores
      idénticos, sin ajustes nuevos para móvil y con las instrucciones 8/9 vigentes.
      Sin dependencias nuevas, endpoints de recuperación, privilegios operativos
      implícitos ni habilitación de transferencia completa.
- [x] Once escenarios ejecutados después en el subbloque 11, con entorno y
      resultados registrados. Verificación local de un nodo; no verifica quorum
      multinodo, failover o efectos remotos.
- [ ] Continúan pendientes autorización operativa, recuperación general/legacy/
      callbacks posibles/reservas, S3 tardío, antecedentes, retención y activación.

Contrato operativo y comandos:
[animal-write-mongo-integration.md](./animal-write-mongo-integration.md).

Validación de esta etapa (sin conexiones Mongo):

- `npm run build`: aprobado.
- `npm run test:integration:animal-writes:check`: aprobado. Incluye los archivos
  de la suite real y sus dependencias; no emite ni ejecuta consultas.
- ESLint de todos los TypeScript nuevos: aprobado. Se corrigió la propagación
  del error de limpieza para cerrar conexiones sin sustituir el fallo original.
- `npm run test:integration:animal-writes -- --listTests`: aprobado; descubre
  únicamente `animal-write-protocol.mongo.integration.ts`.
- Comando de integración con ANIMAL_WRITE_MONGO_TESTS=0: rechazo esperado con
  código 1 y mensaje de opt-in desde globalSetup, antes de crear conexiones.
  El primer intento falló por EPERM de caché Jest en sandbox; repetido fuera
  del sandbox se confirmó la guarda esperada. No se activó la suite real.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **54 suites y 490 pruebas aprobadas**, una suite nueva con 19 casos de guardas
  frente a las 53 suites/471 pruebas de `e3be10f`. No incluye los once escenarios
  Mongo pendientes; verifica además que el patrón ordinario no los ejecute.
- `git diff --check`: aprobado.
- Sin ejecución sobre Mongo/S3/AWS, creación/borrado de bases o contenedores,
  migraciones, recuperación operativa real, nuevas dependencias, cambios IAM,
  despliegues, commits ni push por el agente. Las ocho suites globales heredadas
  siguen como deuda separada; no se ejecutó ni se declara verde la suite global.
  El aviso no bloqueante del SDK/Node continúa, sin cambiar runtime.

### Bloque 2: undécimo subbloque, primera validación real Mongo

Base `8ffe44c` confirmada con rama correcta y árbol limpio. Sin modificaciones
de código fuente, pruebas, dependencias ni contratos. Se ejecuta la validación
que quedó preparada en el subbloque 10, sin usar datos/configuración de aplicación.

- [x] Docker Desktop/WSL 2 iniciado con autorización; contenedor exclusivo de
      pruebas, puerto solo 127.0.0.1:27018 y almacenamiento tmpfs, sin volúmenes
      o archivos de aplicación. Imagen oficial por digest exacto registrado.
- [x] MongoDB 8.0.34, FCV 8.0, replica set animalrecord_test con un miembro/primario
      y sesiones. Docker Engine 28.3.2, Linux x86_64; Node v20.18.0, npm 11.0.0,
      Mongoose 8.21.0 y driver MongoDB 6.20.0. Dos conexiones, mismo proceso Jest.
- [x] `npm run test:integration:animal-writes`: **1 suite y 11 pruebas aprobadas**,
      5.194 s. Índices únicos/sin TTL; adquisición y autorización transaccionales
      con snapshot/commit de mayoría; rollback de inserción y multi-animal;
      carreras adquisición/recuperación/MAY_RUN en ambos órdenes; reintento de
      snapshot obsoleto; respuesta de commit ocultada en aplicación, auditoría
      idempotente y reserva posterior preservada; exclusiones legacy/permiso previo.
- [x] No se detectaron fallos del arnés/protocolo ni se alteró código para hacer
      pasar las pruebas. Los once casos son adicionales a la regresión ordinaria,
      no se suman como si esa regresión hubiera ejecutado integración.
- [x] Base aleatoria `animalrecord_write_test_17ddb7fa1953400faeb2218f762cd6e8`
      limpiada por el arnés; consulta posterior por nombre exacto devolvió cero
      bases. Contenedor ID/etiquetas/aislamiento verificados antes de detenerlo
      por ID exacto con --rm. Solo datos sintéticos temporales retirados, sin tocar
      otros contenedores/datos. Imagen conservada en caché para reutilizar.
- [x] Evidencia reproducible, digest, entorno, escenario de respuesta oculta y
      límites en [animal-write-mongo-validation.md](./animal-write-mongo-validation.md).
      Guía frontend central actualizada: ningún contrato nuevo, sin ajuste Flutter.
- [ ] Un nodo no prueba durabilidad/quorum multinodo, elecciones/failover,
      particiones o pérdida real de respuesta de red/UnknownTransactionCommitResult.
      La inyección se hace después de acknowledgement del driver, no en el servidor.
- [ ] Siguen pendientes muerte/reinicio de procesos, autorización operativa,
      recuperación general/legacy/callbacks posibles/reservas, S3 tardío,
      antecedentes retenidos, retención y activación. No habilitar aceptación.

Verificación adicional: `git diff --check` aprobado. La regresión ordinaria
mantiene el último resultado registrado de **54 suites y 490 pruebas** (subbloque
10), sin volver a ejecutarla porque no cambió código/pruebas. No se declara verde
la suite global: las ocho suites heredadas siguen como deuda separada. No hubo
AWS/S3, migraciones ni intervención sobre datos de aplicación, cambios IAM,
despliegues, commits o push. No se definieron vencimiento/cancelación ni se
convirtió evidencia local en permiso para recuperación productiva.

### Bloque 2: duodécimo subbloque, importador interno de antecedentes retenidos

Base `0c2a1ea` comprobada, rama correcta y árbol limpio antes de editar. Bloque
acotado al importador interno y su protocolo; NO captura posterior automática,
activación, publicación o aceptación de negocio.

- [x] OwnershipArchiveModule exporta OwnershipArchiveHistoryImporter. Inicio
      explícito por archivo destino/fuente, sin endpoint/job/arranque automático.
      Reserva drenada y dueño/versión/transferId exigidos en cada lote; nunca
      retira tokens, libera reservas ni deduce cancelación por un fallo.
- [x] MongoOwnershipArchiveHistory fija el predecesor efectivo inmediato:
      archivo READY vinculado al período CLOSED, destinatario/dueño y
      sourceTransferId del ACTIVE destino coincidentes. Rechaza períodos
      duplicados, fuentes ajenas/incompletas/no efectivas y predecesores posteriores
      sin sus propios antecedentes completos. READY solo no autoriza importar.
- [x] history opcional persiste fuente/hash/conteos/revisión/cursor/fase.
      Inicio y checkpoints transaccionales snapshot/primary/majority; página de
      hasta 100 entradas por ID, replay tras fallo parcial, CAS contra instancias
      concurrentes y conteos reales de entradas/archivos antes de completar.
- [x] RETAINED_RECORD separa antecedentes de recursos vigentes, incluida la ficha
      histórica. Identidad raíz estable y procedencia inmediata; payload original
      independiente, sin reanalizar IA, regenerar códigos o reiniciar acceptedAt/
      48 h. nameHistory conserva solo nombres. Documentos retenidos siguen
      importándose aunque el activo haya sido reemplazado/eliminado.
- [x] Manifiesto desde historicalKey/revisión verificada, nunca desde URL activa
      ni listado recursivo de S3. Verifica hashes/identidades/ámbito/procedencia,
      remapea fileBindings y conserva digest previo. copyBatch exige ese digest
      antes de copiar y verifica ambos destinos. Sin fallback al activo perdido.
- [x] Namespace retained-history con raíz estable y jerarquía original debajo;
      distingue revisiones y evita colisiones en devoluciones. Solo histórico y
      staging se escriben al copiar; final queda planificado, no activado. La
      ruta retenida se rechaza como fuente vigente. No borra objetos.
- [x] Sellado manual de versión >1 exige importación completa, conteos reales
      retenidos y una ficha vigente. Campos history/retained opcionales sin
      defaults/backfill, sin cambios de índices únicos/colecciones/dependencias.
      Lectores/preparadores compatibles deben desplegarse antes de usar el tipo nuevo.
- [x] Compatibilidad central actualizada en
      [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md):
      funcionalidades, contratos anterior/nuevo, ajustes, integración/errores y
      riesgos. Sin cambio HTTP/DTO/éxitos/errores ni ajuste Flutter nuevo; incluido
      PUT animal primitivo. No cambia retención/borrado del runtime médico activo.
- [ ] Se MANTIENE la guarda inicial/sin CLOSED de OwnershipArchiveCapture.
      Falta conectar importación a captura posterior con protocolo de referencias
      activadas y cierre/apertura de períodos. Hoy no existe un flujo que produzca
      las fuentes efectivas: las pruebas usan cadenas sintéticas, no traspasos reales.
- [ ] Siguen pendientes validación real del importador Mongo/S3, privacidad/IAM,
      coste/latencia por adjuntos y conteos, rollout, corte S3 completo, recuperación,
      retención/permisos históricos y limpieza segura. No habilitar aceptación.

Detalle del contrato interno y sus límites:
[ownership-archive-history.md](./ownership-archive-history.md).

Validación de esta etapa:

- `npm run build`: aprobado, repetido tras los ajustes finales de fuente/procedencia.
- ESLint mediante `npm exec -- eslint` de todos los TypeScript modificados/nuevos:
  aprobado. Se corrigieron tipado de mocks y estilo de pruebas; no se alteraron
  contratos exitosos para hacerlas pasar.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **57 suites y 541 pruebas aprobadas**, tres suites nuevas y 51 casos adicionales
  frente a las 54 suites/490 pruebas anteriores. Ejecución final completa aprobada.
- Casos: procedencia/identidad/hash, cadenas sintéticas A→B→C/devolución,
  antecedentes eliminados/reemplazados junto con versión vigente, nombres y
  acceptedAt/códigos preservados, deduplicación médica/raíces estables,
  claves de devolución sin sobrescritura, paginación 100/101, reinicio/replay,
  checkpoint incierto/concurrente, reserva/versión/escritores, fuente efectiva
  frente a mero READY, manifiestos incompletos y sellado denegado, digest histórico
  alterado y copia desde histórico aun sin original activo.
- `npm run test:integration:animal-writes:check`: aprobado (solo compilación).
  No se ejecutó otra vez el arnés Mongo del journal ni se presenta como prueba
  real del importador nuevo.
- `git diff --check`: aprobado. Jest falló inicialmente por caché EPERM del
  sandbox; la regresión citada se ejecutó fuera con autorización. Aviso SDK/Node
  heredado no bloqueante, sin cambio de runtime.
- Dobles de Mongo/S3/sesiones: no prueban rollback/mayoría/índices reales,
  carreras distribuidas, IAM ni retención física. Sin operaciones reales
  Mongo/S3/AWS, migraciones, cambios IAM, borrado de datos, despliegue, commit
  o push por el agente. Las ocho suites globales heredadas siguen como deuda
  separada; no se ejecutó ni se declara verde toda la suite global.

### Bloque 2: decimotercer subbloque, plan persistido de referencias

Base `ebf6fe1` confirmada con rama correcta, origin coincidente y árbol limpio.
Se separa el primer paso del trabajo de activación/cierre: no implementar un
cambio de ownerId aislado sin referencias finales, períodos y eventos conjuntos.

- [x] OwnershipArchiveReferencePlanner exportado por OwnershipArchiveModule,
      sin endpoint/job/ejecución de arranque. Prepara instrucciones sobre archivos
      READY completos y bajo la misma reserva drenada; no activa ni publica.
- [x] Plan por entrada sin duplicar payloads clínicos: hash de fuente/definición,
      modo vigente o RETAINED_READ_ONLY, ownerChange solo propuesto para ficha/
      documento vigente, bindings URL/KEY, histórico/revisión, staging/revisión,
      SHA-256 y destino final planificado. Conserva UUID/códigos, categorías,
      extracción, fechas/nameHistory y acceptedAt/48 h. No genera URLs firmadas.
- [x] Reconstruye bindings permitidos desde el recurso original y procedencia
      raíz. Deniega rutas arbitrarias/prototype, vínculos repetidos/faltantes,
      fuentes/archivos ajenos, hashes alterados, destinos incoherentes, archivos
      no verificados o revisiones/tamaños inválidos. Antecedentes no pasan a activos.
- [x] Hasta 100 planes por página, cursor/revisión persistidos, reanudación y
      manejo de página vacía final. Planes/cursor se confirman en la misma
      transacción snapshot/primary/majority, con CAS del progreso y hash fuente.
      Workers atrasados no avanzan ni cuentan dos veces; reintento de commit
      incierto relee progreso sin inferir rollback.
- [x] Inicio/página verifican período ACTIVE y escriben un fence en el control
      del mismo dueño/versión/transferId, sin escritores. Campo opcional
      archiveReferencePlanRevision; no retira tokens/ventanas/reserva ni declara
      liveness. Finalización exige conteos reales de entradas/planes/archivos,
      unión de archivos referenciados, una ficha vigente y antecedentes completos.
- [x] Campos referencePlan opcionales en cabecera/entradas, sin default/backfill,
      colección/índice/TTL nuevo. Los hashes originales de snapshot/manifiesto no
      incorporan esta metadata posterior; el importador anterior sigue compatible.
- [x] Guía frontend central actualizada con funcionalidades, contratos anterior/
      nuevo, ajustes, integración/errores y compatibilidad/riesgos. Sin cambios
      HTTP/DTO/éxitos/errores, incluido PUT animal primitivo; sin ajuste Flutter nuevo.
- [ ] PLANNED solo es un plan: NO copia finales, modifica referencias activas,
      cambia dueño, publica, cierra/abre períodos, libera reserva o crea eventos.
      Captura automática conserva su guarda inicial/sin CLOSED. Transferencia
      completa sigue deshabilitada; vencimiento y cancelación siguen pendientes.
- [ ] Materialización final sin sobrescrituras y reconciliación de efectos S3
      tardíos; registro de medios transferidos; commit atómico de referencias/
      propiedad/períodos/auditoría/notificaciones y conexión con captura posterior.
      Retención/permisos/recuperación y validación real antes de habilitar aceptación.

Detalle: [ownership-archive-reference-plan.md](./ownership-archive-reference-plan.md).

Validación:

- `npm run build`: aprobado, repetido tras los ajustes finales del protocolo.
- ESLint mediante `npm exec -- eslint` de todos los TypeScript nuevos/modificados:
  aprobado. `git diff --check`: aprobado.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **60 suites y 593 pruebas aprobadas**, tres suites nuevas/52 pruebas adicionales
  frente a 57 suites/541 de `ebf6fe1`.
- Casos nuevos: conservación clínica/códigos/nombres/fechas, KEY/URL, cadena
  sintética A→B→C/devolución con antecedente read-only y sin colisión de destino,
  manifiesto/hash/revisión, rutas prototype/ajenas/incompletas, páginas 100/101,
  reinicio/competidores/commit de respuesta oculta en doble de aplicación,
  fence/estado/período, checkpoint obsoleto, error de una entrada sin commit
  simulado, conteos/archivos huérfanos/antecedentes ausentes, exports/campos
  opcionales/sin TTL y consultas primario/mayoría. No son pruebas reales de Mongo.
- `npm run test:integration:animal-writes:check`: aprobado, solo compilación;
  no se volvió a ejecutar el arnés de journal ni se atribuye al plan nuevo.
- Primer test detectó fixture de adjunto incompleto, corregido sin cambiar el
  contrato. Jest volvió a fallar por EPERM de caché en sandbox; ejecución final
  fuera del sandbox autorizada. Aviso SDK/Node heredado no bloqueante.
- Sin operaciones reales Mongo/S3/AWS, migraciones, cambios IAM, borrado de datos,
  despliegues, commits o push. Dobles no prueban rollback/mayoría/índices reales,
  exclusión distribuida o retención. Ocho suites globales heredadas como deuda
  separada; no se ejecutó ni se declara verde toda la suite global.

### Bloque 2: decimocuarto subbloque, materialización final protegida

Base `789e4ac` confirmada con origin/rama coincidentes y árbol limpio. Servicio
interno explícito, sin endpoint/arranque/worker automático ni ejecución real.

- [x] OwnershipArchiveMaterializer exportado; start exige READY/PLANNED completo,
      período ACTIVE y control de dueño/versión/transferId sin activeWrites.
      No adopta protocolos diferentes ni limpia tokens legacy/MAY_RUN por edad/error.
- [x] Intenciones durables por archivo antes de S3, con identidad/hash de
      preparación/manifiesto/plan, revisión y digest de staging y final fijos.
      No vuelve a fijar fuentes/cambia destinos al reintentar. Campos opcionales
      materialization y archiveMaterializationRevision sin default/backfill,
      colección/índice/TTL nuevo; snapshots/planes anteriores conservan hashes.
- [x] Lotes de cinco archivos por defecto, 1–20; leases técnicos de cinco minutos.
      Claim/confirmación/liberación/cierre en transacciones snapshot/primary/majority
      con fence del mismo control. Una adquisición incierta no ejecuta S3;
      confirmación solo con token vigente, sin dar por terminada una copia remota
      por perder su lease. No mantiene transacción abierta durante S3.
- [x] CopyObject con condición de destino ausente, ETag/VersionId de staging,
      metadata de intención y SHA-256/tamaño verificados por stream antes/después.
      Preserva MIME/cabeceras técnicas observadas; MIME ausente deniega. No hereda
      tags temporales. HEAD denegado no significa ausencia; ETag no es digest.
- [x] Reintentos reconcilian solo finales de la misma identidad/digest; no basta
      contenido igual. Respuesta perdida y finalización tardía no llevan a
      sobrescribir/borrar. Otro objeto, incluidas devoluciones, queda intacto con
      conflicto interno. No elige un nombre alternativo ni muta el plan en silencio.
- [x] Cierre con conteo exacto y resultados del mismo protocolo/preparación;
      expediente sin archivos completa sin S3. MATERIALIZED es evidencia registrada,
      NO ausencia de efectos posteriores, activación, publicación, cambio de
      propietario, cierre/apertura de períodos o permiso para liberar reservas.
- [x] Guía central frontend actualizada: funcionalidades, contratos anterior/nuevo,
      ajustes, integración/errores y compatibilidad/riesgos. Ningún HTTP/DTO/éxito/
      error cambia, incluido PUT animal primitivo; sin ajustes Flutter nuevos.
      No cambia clínica/códigos/categorías/acceptedAt/48 h/nameHistory (nombres).
- [ ] Resolución de colisiones de retorno pendiente: este bloque detecta/protege,
      pero no completa una devolución con final ocupado. No habilitar aceptación.
- [ ] Registro de medios transferidos, commit conjunto de referencias/propiedad/
      períodos/auditoría/notificaciones, revalidación final/corte S3 y captura posterior.
      Guarda inicial se conserva. También faltan recuperación, permisos/retención,
      costes/índices/leases, privacidad/IAM/lifecycle y verificación real.

Detalle: [ownership-archive-materialization.md](./ownership-archive-materialization.md).

Validación:

- `npm run build`: aprobado. ESLint de todos los TypeScript nuevos/modificados
  y `git diff --check`: aprobados.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **64 suites y 641 pruebas aprobadas**, cuatro suites nuevas/48 casos frente a
  60 suites/593 de `789e4ac`.
- Casos: intenciones/metadata/identidad/revisión, source/destino fijos, versionado
  y sin versión, retorno con objeto previo de mismos bytes, competidor entre HEAD
  y COPY, dos copias condicionales, digest corrupto del mismo tamaño, S3 403/fuente
  ausente/cambiada/MIME ausente, confirmación perdida/copia tardía, lease obsoleto,
  claim de resultado incierto sin S3, error original conservado, fence/período/
  plan/cierre, manifiesto incompleto/vacío y campos opcionales/sin TTL.
- `npm run test:integration:animal-writes:check`: aprobado, solo compilación del
  arnés existente. No se volvió a ejecutar integración Mongo del journal ni se
  atribuye esa evidencia al nuevo protocolo.
- Jest falló inicialmente por caché EPERM en sandbox y tipado de una expectativa;
  corregido el tipado y ejecutada la regresión final fuera con autorización.
  Aviso SDK/Node heredado no bloqueante, sin cambio de runtime.
- Dobles Mongo/S3/sesiones: no prueban rollback, majority, índices, concurrencia
  distribuida o garantías del bucket reales. Contraste documental/SDK no reemplaza
  validación S3/IAM/versionado reales. No hubo llamadas reales Mongo/S3/AWS,
  migraciones, borrados, cambios IAM, despliegues, commits o push. Ocho suites
  globales heredadas como deuda separada, no se ejecutó ni se declara verde toda
  la suite global. Vencimiento/cancelación siguen pendientes sin reglas nuevas.

### Bloque 2: decimoquinto subbloque, destinos generacionales explícitos

Base comprobada: `7dafada` (`feat(animal-transfers): add guarded archive final
materialization`), HEAD y referencia origin coincidentes en
`codex/animal-transfer-planning`; árbol limpio al comenzar. No se hizo fetch,
commit, push, despliegue, migración o intervención sobre datos reales.

- [x] `startGenerational` elige un protocolo interno distinto antes de emitir
      materialización. Inicio anterior conserva V1/hashes/destinos. Cabecera bajo
      fence transaccional/período ACTIVE/reserva drenada; reintento incompatible
      denegado incluso sin claims. No se transforma una intención PENDING tras
      error/antigüedad: puede tener copia remota tardía.
- [x] Destinos deterministas por archivo/preparación, elegidos para todos sus
      archivos sin sondear colisiones ni generar sufijos al fallar. Preserva plan,
      payload/manifiesto y hashes anteriores; intención fija guarda destino efectivo.
      Documentos/diario/antecedentes conservan jerarquía y nombre/extensión.
      Foto conserva formato numérico con patrón reservado; longitud UTF-8 acotada,
      sin aplanar/truncar silenciosamente generaciones heredadas.
- [x] Reutiliza copia condicional/metadata/revisión/SHA-256 y leases técnicos.
      Puede copiar junto a un final original ocupado sin tocarlo; otro objeto en
      la ruta generacional sigue siendo conflicto incluso con bytes iguales.
      Cierre exige protocolo elegido. Resolvedor interno devuelve evidencia
      final VERIFIED/MATERIALIZED coherente, no aplica plannedFinalKey a ciegas.
- [x] Protección de funcionalidad existente: emisión, confirmación sin/con ticket
      (incluso URL actual), inspección/captura y migración legacy rechazan namespace
      generacional. Evita que el fallback legacy active una foto preparada.
      PATCH denegado no actualiza referencia ni borra foto anterior. No registrar
      tickets ordinarios para sortearlo: falta registro transferido/publicación.
- [x] Contrato central frontend actualizado: funciones, ajustes, anterior/nuevo,
      integración/409/400/500/502 y riesgos de legacy excepcional/rollout mixto.
      Sin cambios de DTO/éxitos/rutas, incluido PUT animal primitivo; sí se deniegan
      las URLs reservadas. Sin cambios clínicos/categorías/códigos/acceptedAt/48 h
      ni nameHistory (nombres), reglas de vencimiento o cancelación.
- [ ] No recupera V1 ya iniciado con destino ocupado ni autoriza reemplazar
      cabeceras/reservas. Requiere protocolo de evidencia/recuperación separado.
- [ ] No registro transferido, activación, cambio de dueño, cierre/apertura de
      períodos, liberación de reserva, eventos/notificaciones o autorización de
      históricos. Captura automática conserva guarda inicial. Falta revalidación
      final/corte S3, retención/IAM/lifecycle/limpieza y ensayos reales. Las cadenas
      largas pueden alcanzar el límite de clave; canonicalización versionada pendiente.

Detalle: [ownership-archive-generations.md](./ownership-archive-generations.md).

Validación:

- `npm run build`: aprobado. ESLint de todos los TypeScript nuevos/modificados
  y `git diff --check`: aprobados.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **65 suites y 708 pruebas aprobadas**, una suite adicional y 67 casos respecto
  de las 64 suites/641 pruebas de `7dafada`. Pruebas Mongo/S3 previas de
  materialización ejecutadas con ambos protocolos.
- Casos: identidad/generación fija, formato de foto/guardas, jerarquía médica y
  de diario/antecedentes, retorno sintético/rutas sucesivas, límite UTF-8,
  retarget/protocolo incompatibles, resolución solo de evidencia coherente,
  destino original ocupado intacto, destino generacional ajeno, copias concurrentes,
  respuestas perdidas/tardías, lease/fence/confirmación/cierre y rechazo de
  activación/migración legacy sin ticket o con ticket ordinario. PATCH denegado
  conserva foto/referencia anteriores. Sin cambios a los éxitos HTTP previos.
- `npm run test:integration:animal-writes:check`: compilación aprobada, no una
  ejecución de integración. No se ejecutó de nuevo el arnés real del journal.
- Jest encontró EPERM de caché en sandbox; repetido fuera con autorización.
  ESLint señaló expectativas con métodos no ligados; corregidas y validación
  final aprobada. Aviso SDK/Node heredado no bloqueante, runtime sin cambio.
- Dobles de modelos/sesiones/SDK: no demuestran transacciones/índices/majority,
  exclusión distribuida, bucket/IAM/lifecycle o efectos tardíos reales. Sin Mongo,
  S3 o AWS reales, migraciones, borrados, despliegues, commits o push. Ocho suites
  globales heredadas continúan como deuda separada; no se ejecutó ni se afirma
  verde toda la suite global. Vencimiento/cancelación siguen sin reglas nuevas.

### Bloque 2: decimosexto subbloque, registro separado de medios transferidos

Base comprobada: `5bcc64d`, rama `codex/animal-transfer-planning`, referencia
origin coincidente y árbol limpio. Alcance por archivo, sin activación, cambio
de dueño, consulta histórica o ejecución sobre datos reales.

- [x] OwnershipArchiveModule exporta OwnershipArchiveMediaRegistrar.registerFile
      y registra MongoOwnershipArchiveMediaRegistration. Entrada únicamente UUID
      de expediente/hash canónico de archivo; sin aceptar keys/revisiones/owner
      desde el llamador. No endpoint, worker, cron o barrido al arrancar.
- [x] Exige READY/PLANNED y materialización GENERATIONAL_V1 MATERIALIZED;
      archivo/intención/resultados VERIFIED coherentes y sin lease residual.
      Reconstruye destino efectivo desde el plan/manifiesto; exige plan persistido
      ligado al contentHash. No confunde plannedFinalKey con el final copiado.
- [x] Colección NUEVA animal_transferred_media, protocolo/identidad y hashes
      inmutables por archivo; key, revisión/digest, animal/remitente/destinatario,
      período/versión/transferencia y procedencia retenida raíz/inmediata.
      PREPARED es el único estado, sin default, fecha efectiva inventada o TTL.
      Remitente identifica al custodio inmediato, no al autor clínico original.
      Proyección técnica permitida, sin duplicar payload clínico/URLs firmadas,
      tickets de carga, capacidades o errores crudos.
- [x] Insert/fence conjuntos en transacción snapshot/primary/majority. Reutiliza
      archiveMaterializationRevision del MISMO control: período ACTIVE y reserva
      del dueño/versión/transferId, sin activeWrites. No modifica ventanas/tokens/
      reserva, cabecera, manifiesto, planes, Animal/diario/documentos o períodos.
- [x] Repetir bajo reserva válida compara evidencia completa, no solo su hash.
      Respuesta de commit perdida se reconcilia con la misma identidad. Sin
      upsert/reemplazo/adopción: otra key/identidad/revisión/estado falla cerrado.
      Índices únicos id/key/(archiveId,fileId) declarados, sin reciclaje/backfill.
- [x] Separación verificada: registrar foto/adjunto NO habilita confirmación,
      emisión PUT, migración legacy o inspección/captura por protocolos ordinarios.
      Guardas del subbloque 15 intactas; no se insertan tickets en animal_media_uploads.
      V1 anterior no se registra/convierte; captura inicial/sin CLOSED se conserva.
- [x] Documentación central frontend actualizada: funciones afectadas, ajustes,
      contrato anterior/nuevo, integración/errores y compatibilidad/riesgos.
      Sin cambios HTTP/DTO/éxitos/errores públicos, incluido PUT animal primitivo.
      Nuevo modelo puede exigir colección/índices/permisos al iniciar Mongoose
      según autoCreate/autoIndex; declaración no equivale a verificación real.
      Sin cambios médicos/BDA/clínicos/códigos/acceptedAt/48 h/nameHistory.
- [ ] Registro solo por archivo, sin cursor ni fase global: NO comprueba por sí
      solo el manifiesto completo, revalida S3, prueba fin de efectos tardíos o
      autoriza publicar. Faltan revalidación completa/final y corte estable, commit
      conjunto, publicación/retención/permisos y captura posterior.
- [ ] Antes de usarlo: verificar índices/transacciones reales, presupuesto de
      consultas por archivo y búsqueda de plan/bindings, tamaños de planes,
      permisos/latencia/coste. Integrar llamador autorizado antes de intervenir.

Detalle: [ownership-archive-media-registration.md](./ownership-archive-media-registration.md).

Validación:

- `npm run build`: aprobado. ESLint de todos los TypeScript nuevos/modificados
  y `git diff --check`: aprobados.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **68 suites y 764 pruebas aprobadas**, tres suites nuevas/56 casos respecto
  de las 65 suites/708 pruebas de `5bcc64d`.
- Casos: foto/diario/medicina/retención, versión S3 presente/ausente/malformada,
  identidad/hashes/procedencia/metadata permitida, estados/leases/plan alterados,
  V1 excluido, scope/fence/período/queries, replay sin duplicados, snapshot
  obsoleto/competidor de control, respuesta de commit perdida, colisión/índice
  simulado, evidencia distinta no reemplazada e índices declarados/sin TTL.
  Registrar foto/adjunto conserva denegación de protocolos ordinarios y no invoca S3.
- `npm run test:integration:animal-writes:check`: compilación aprobada, NO nueva
  ejecución del arnés real de journal ni prueba de este registro contra Mongo.
- Primera pasada: tipado autorreferente del doble de query y caché EPERM de Jest;
  corregido el doble y repetido fuera del sandbox con autorización. Validación
  final aprobada. Aviso SDK/Node heredado no bloqueante, runtime sin cambio.
- Modelos/sesiones/doble optimista: no prueban rollback/majority/exclusión/índices
  Mongo reales, IAM/lifecycle/bucket o efectos remotos. No se arrancó AppModule
  ni realizaron operaciones reales Mongo/S3/AWS, migraciones, creación de índices
  reales, borrados, cambios IAM, despliegues, commits o push. Ocho suites globales
  heredadas continúan como deuda separada; no se ejecutó ni se afirma verde toda
  la suite global. Cancelación/vencimiento siguen pendientes sin reglas nuevas.

### Bloque 2: decimoséptimo subbloque, revalidación paginada de metadatos

Base comprobada: `d731350`, rama `codex/animal-transfer-planning`, referencia
origin coincidente y árbol limpio. Primer tramo de revalidación del conjunto:
solo metadatos Mongo; no verificación S3, commit o activación.

- [x] OwnershipArchiveMetadataRevalidator exportado con start(runId,archiveId)
      y nextPage(runId,limit=20), 1–100. Corrida explícita, sin endpoint, worker
      o ejecución automática. No inventa un run nuevo tras errores.
- [x] Colección animal_archive_metadata_revalidations: id único, índice
      (archiveId,id), protocolo/definición, fase/revisión, revisión del control y
      hash de reserva, cursores/conteos/digests/tiempos. Sin TTL/defaults/backfill.
      No duplica payloads clínicos/URLs/errores ni crea permisos de publicación.
- [x] ENTRIES reconstruye snapshots/hash y planes completos, con todos sus
      bindings/manifiestos/procedencia. FILES recorre TODO el manifiesto,
      comprueba referencias y exactamente un PREPARED idéntico por archivo con
      destino efectivo/revisión/digest. Cierre con conteos exactos, una ficha,
      cobertura de archivos y antecedentes completos. No omite entradas sin objetos.
- [x] Cursor, conteos/digests deterministas y fence se confirman en transacciones
      snapshot/primary/majority cortas. READY/PLANNED y GENERATIONAL_V1 MATERIALIZED,
      período ACTIVE, dueño/versión/transferId y cero escritores exigidos.
      No actualiza cabecera, snapshot/plan/manifiesto/registro PREPARED, Animal,
      diario/documento, períodos, reserva, ventanas, tokens o eventos.
- [x] Inicio fija archiveMaterializationRevision del MISMO control y hash de
      transferId/lockedAt; páginas hacen CAS de control y corrida. Otro registro,
      materialización u otra corrida que avance ese contador la vuelve obsoleta
      y una llamada posterior falla, incluso con METADATA_OBSERVED. No refija ni
      reinicia. Conteo no se duplica tras respuesta perdida/reintento concurrente.
- [x] Guardas de medios/captura inicial se conservan. V1 anterior no se convierte.
      Fechas solo técnicas; no vencimiento/cancelación, liveness o fecha efectiva.
      Contrato central frontend actualizado (funciones, ajustes, anterior/nuevo,
      errores y riesgos): mismos HTTP/DTO/cuerpos/URLs/éxitos/errores, incluido
      PUT animal primitivo; ningún cambio clínico/BDA/códigos/acceptedAt/48 h/nameHistory.
- [ ] METADATA_OBSERVED es observación del archivo preparado, NO bytes S3 actuales,
      corte estable o permiso de commit. No relee todo al cierre; presupone
      inmutabilidad y fences de sus protocolos. Cambios administrativos fuera
      del protocolo y ABA de reservas idénticas no quedan resueltos: contador no
      es epoch universal de TODOS los escritores. Tampoco revalida expediente
      activo actual. No consumir una fase/DTO cacheados como autorización.
- [ ] Faltan observación S3 de solo lectura ligada al recorrido y el protocolo
      de corte/consumo/commit conjunto frente a copias/escritores tardíos.
      Luego publicación, retención/permisos/históricos, captura posterior y
      recuperación. No liberar reservas ni habilitar aceptación por esta evidencia.
- [ ] Verificar creación real de colección/índices, autoCreate/autoIndex/permisos,
      transacciones/majority y coste de reconstrucción/scans/conteos. Páginas
      acotan recursos, no bytes/adjuntos de una entrada. No se arrancó AppModule.

Detalle: [ownership-archive-metadata-revalidation.md](./ownership-archive-metadata-revalidation.md).

Validación:

- `npm run build`: aprobado. ESLint de TODOS los TypeScript nuevos/modificados
  y `git diff --check`: aprobados.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **71 suites y 820 pruebas aprobadas**, tres suites nuevas/56 casos frente a
  las 68 suites/764 de `d731350`.
- Casos: definición/IDs/progreso/fases inválidas, reconstrucción/corrupción de
  payload/plan/manifiesto/evidencia, límites y cursores, páginas llenas/vacías,
  digests independientes del límite, manifiesto sin archivos, retención,
  referencia o registro ausente/duplicado/extra, pérdida de reserva/versión/
  período/escritores, revisión/reserva obsoletas, dos corridas/páginas concurrentes,
  fallo CAS sin incremento parcial, respuesta perdida de inicio/página, estado
  terminal obsoleto y contador anterior ausente, wiring/estados/índices/sin TTL.
- `npm run test:integration:animal-writes:check`: compilación aprobada; no se
  ejecutó de nuevo el arnés real del journal ni se atribuye su evidencia al bloque.
- Primer intento: caché Jest EPERM; repetido fuera con autorización. Corregidos
  tipado/estilo y enlace de sesión del doble de pruebas. Resultados finales
  completos aprobados. Aviso SDK/Node heredado no bloqueante, runtime sin cambio.
- Dobles de modelos/sesiones/snapshots: no prueban Mongo real, rollback/mayoría/
  índices o exclusión distribuida. Sin llamadas S3/AWS/Mongo reales, arranque de
  AppModule, creación de índices reales, migraciones, borrados, cambios IAM,
  despliegues, commits o push. Ocho suites globales heredadas siguen como deuda
  separada; no se ejecutó ni se declara verde toda la suite global. Reglas de
  vencimiento/cancelación siguen abiertas sin valores nuevos.

### Bloque 2: decimoctavo subbloque, observación S3 de solo lectura

Base comprobada: `12d0390`, rama codex/animal-transfer-planning, HEAD/referencia
origin coincidentes y árbol limpio. Sin commits/push del agente.

- [x] OwnershipArchiveS3Observer exportado: start(runId) y observeBatch(runId,
      limit=5), 1–20. Inicio explícito sobre METADATA_OBSERVED vigente; sin
      endpoint, worker, cron o arranque automático. No crea/reset otra corrida.
- [x] s3Observation opcional ARCHIVE_S3_OBSERVATION_V1 sobre la corrida existente:
      hash de metadatos, fase, revisión, cursor/conteo, digests y tiempos técnicos.
      Sin default/backfill, colección/índice/TTL nuevos, payload clínico/URLs/keys
      o errores duplicados. Identidad/digests Mongo anteriores se conservan.
- [x] Página de manifiesto/registro leída en transacción corta; después HEAD
      ACTUAL/GET con ETag/VersionId fijados/HEAD ACTUAL por archivo, verificando
      también headers GET, identidad, tamaño y SHA-256 en streaming. Adaptador
      solo HeadObject/GetObject: no copia/repara/crea/borra/lista/adopta revisiones
      ni usa source/staging como fallback. 403 no se considera ausencia.
- [x] Tras TODAS las lecturas: nueva transacción que relee página/registros,
      valida período/reserva/dueño/versión/sin escritores y hace CAS de corrida
      y MISMO archiveMaterializationRevision juntos. Sin transacción durante S3.
      Respuesta de página incierta impide GET; checkpoint tardío/competidor falla.
      Lecturas concurrentes pueden repetirse, no hay lease innecesario de lectura.
- [x] Digest/cantidad de manifiesto deben coincidir exactamente con FILES al
      cerrar, más conteos Mongo. Página llena requiere otra vacía; cero archivos
      no inventa lecturas. Falla parcial no registra página; respuesta perdida de
      checkpoint confirmado conserva avance sin duplicación. Terminal replay no
      reobserva S3. Nuevo escaneo requiere otra corrida explícita, no reset oculto.
- [x] Contrato central frontend actualizado: funciones, ajustes, anterior/nuevo,
      integración/errores y riesgos. Mismos HTTP/DTO/URLs/cuerpos/éxitos/errores,
      incluido PUT animal primitivo. Guardas generacionales/captura inicial y
      recuperación intactas; sin cambios clínicos/IA/BDA/códigos/acceptedAt/48 h,
      nameHistory (nombres) o reglas pendientes de cancelación/vencimiento.
- [ ] S3_OBSERVED NO es corte estable, simultaneidad, disponibilidad futura,
      fin de efectos remotos o permiso de consumo/commit/publicación. Cambios
      después del último HEAD son posibles y están incluidos en los tests.
      No revalida expediente activo ni resuelve ABA/escrituras administrativas.
- [ ] Falta auditar mutadores de reserva/control y ligar identidad monotónica e
      invalidación de evidencia a liberación/readquisición, antes del consumo/
      commit conjunto. Ese epoch tampoco probaría fin de efectos S3. Mantener
      aceptación/publicación/captura posterior y acceso histórico pendientes.
- [ ] Medir bytes/latencia/coste y validar permisos/versionado/lifecycle/privacidad
      y topología real. Páginas acotan objetos, no bytes/duración. No cambios IAM.

Detalle: [ownership-archive-s3-observation.md](./ownership-archive-s3-observation.md).

Validación:

- `npm run build`: aprobado. ESLint de TODOS los TypeScript nuevos/modificados
  y `git diff --check`: aprobados. Formato de TypeScript revisado con Prettier.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **75 suites y 889 pruebas aprobadas**, cuatro suites nuevas/69 casos frente a
  las 71 suites/820 pruebas de `12d0390`.
- Casos: páginas llenas/vacías/manifiesto vacío, digests/conteos/identidad/revisión
  y recibos alterados, límites/UUID, lectura fallida sin checkpoint parcial,
  ausencia/403/red/stream corrupto, objeto ajeno con mismos bytes, versión
  histórica superviviente pero actual distinta, cambios durante/después del GET
  y después del último HEAD, reintento sin reparar, lecturas concurrentes,
  corrida/control/reserva/dueño/versión/período/escritores obsoletos, competidor
  durante reintento transaccional, fallo CAS sin incremento parcial, respuesta
  perdida de inicio/checkpoint, terminal obsoleto y replay sin nuevo escaneo.
- `npm run test:integration:animal-writes:check`: compilación aprobada, NO nueva
  ejecución del arnés real del journal ni evidencia real de este bloque.
- Primera pasada: caché Jest EPERM; repetida fuera del sandbox con autorización.
  Corregido lint de generador del doble S3. Regresión final completa aprobada.
  Aviso SDK/Node heredado no bloqueante, runtime sin cambios.
- Dobles de modelos/sesiones/snapshots y cliente S3: no prueban rollback/mayoría/
  índices/exclusión Mongo reales, bucket/IAM/versionado/lifecycle o fallos de red
  reales. Sin operaciones reales Mongo/S3/AWS, arranque de AppModule, migraciones,
  índices reales, borrados, cambios IAM, despliegues, commits o push. Ocho suites
  globales heredadas siguen como deuda separada; no se ejecutó ni se declara
  verde toda la suite global. Cancelación/vencimiento continúan sin definir.

### Bloque 2: decimonoveno subbloque, identidad monotónica de reserva

Base `f09632c` comprobada, rama codex/animal-transfer-planning y árbol limpio.
No commits/push del agente. Implementación técnica, no transferencia habilitada.

- [x] Auditoría de todos los mutadores de transferLock en src: adquisición y
      liberación del repositorio de propiedad, inicio/finalización/detención de
      migración. Los cinco incrementan reservationEpoch en la MISMA escritura
      que cambia la reserva. Inicialización no lo resetea; tokens/journal/ventanas
      no cambian reservas y mantienen sus protocolos/exclusiones.
- [x] Campo opcional en control, corrida de metadatos y trabajo de migración,
      sin default/backfill, índice/colección/TTL nuevos. Ausente distinto de cero;
      primer incremento a 1, enteros seguros y agotamiento denegado sin overflow.
- [x] Adquisición exige epoch observado exacto; liberación exige identidad
      adquirida, no solo transferId. Omitir epoch solo compara campo AUSENTE.
      Boolean/mayoría conservados; adquisición incierta no se adopta al repetir.
      Preflight de captura nuevo conserva su epoch y nunca libera una reserva
      posterior, aunque repita transferId/hora; error original preservado.
- [x] Inicio de migración persiste el nuevo epoch junto a reserva/trabajo.
      Páginas comparan trabajo/control; COMPLETED/STOPPED liberan e incrementan
      en su transacción. Trabajos antiguos sin epoch solo coinciden con control
      también sin campo. Terminal replay no toca reservas posteriores.
- [x] Corridas nuevas fijan epoch positivo y reservationHash lo liga. Páginas,
      inicio/replay terminal, extensión S3 y CAS del control lo comparan además
      de revisión de pipeline. Liberación/readquisición idéntica invalida Mongo
      y S3; checkpoint y transición compiten por el mismo documento. Hash S3 liga
      epoch/reservationHash. GET tardío puede acabar, pero no confirmar otra reserva.
- [x] Corridas antiguas sin epoch conservadas como datos, sin reanudación/adopción/
      retrofit. Reserva legacy no permite iniciar una corrida nueva. No liberar
      y readquirir para sortear la guarda: exige otro protocolo operativo/evidencia.
- [x] Contrato central frontend actualizado: funciones, ajustes, anterior/nuevo,
      integración/errores y riesgos. Mismos endpoints/DTO/URLs/cuerpos/éxitos/
      errores públicos, incluido PUT animal primitivo. Sin cambios clínicos/IA/
      BDA/códigos/categorías/acceptedAt/48 h/nameHistory (nombres). Vencimiento y
      cancelación siguen pendientes, sin reglas nuevas.
- [ ] No es epoch universal de contenido/escritores, corte S3 estable, fin remoto,
      liveness o permiso de consumo/commit. Cabeceras/copia/antecedentes/planes/
      materialización/registro NO están todos ligados a epoch persistido todavía.
      Una nueva corrida solo revalida el archivo preparado, no su actualidad
      frente al expediente activo después de intervenir. Mantener guardas.
- [ ] Requiere TODOS los mutadores desplegados/drenaje de versiones anteriores.
      No protege borrado/recreación del control, restauraciones o escrituras
      administrativas directas. No se ejecutó rollout ni intervención real.

Detalle: [animal-reservation-epoch.md](./animal-reservation-epoch.md).

Validación:

- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **76 suites y 915 pruebas aprobadas**, una suite nueva/21 casos y cinco casos
  adicionales en suites existentes, frente a 75 suites/889 de `f09632c`.
- Casos: ausencia/cero/valores corruptos/agotamiento, CAS concurrente y repetición
  no adoptada, incremento en ambas transiciones, liberación atrasada, ABA con
  mismo ID/hora y contador de pipeline intacto; evidencia parcial/terminal obsoleta,
  checkpoint frente a liberación en ambos órdenes, corrida nueva explícita,
  exclusión de corridas/reservas previas, preflight que conserva reserva posterior,
  creación/checkpoint/detención de migración ligados al epoch y schemas sin default/TTL.
- `npm run build` y `npm run test:integration:animal-writes:check`: aprobados.
  El segundo SOLO compila; no se ejecutó de nuevo el arnés Mongo real del journal.
- ESLint de todos los TypeScript nuevos/modificados y `git diff --check`:
  aprobados. Corregida una expectativa con método no ligado en el test de captura.
- Primer intento Jest: caché EPERM; repetido fuera del sandbox con autorización.
  Ajustadas expectativas anteriores de filtros y tipado de inspección de schemas
  del test nuevo. Regresión final completa aprobada, sin alterar éxitos HTTP.
  Aviso SDK/Node heredado no bloqueante, runtime sin cambios.
- Modelos/sesiones/snapshots simulados: no prueban Mongo real, rollback/mayoría/
  índices/exclusión distribuida. Sin llamadas reales Mongo/S3/AWS, arranque de
  AppModule, migraciones, índices reales, borrados, cambios IAM, despliegues,
  commits o push. Ocho suites globales heredadas siguen como deuda separada;
  no se ejecutó ni se declara verde toda la suite global.

### Bloque 2: vigésimo subbloque, vínculo inmutable de preparación y reserva

Base `e54fba9` comprobada, rama codex/animal-transfer-planning y árbol limpio.
2026-10-26. Sin commits/push del agente ni ejecución real de infraestructura.

- [x] NUEVAS cabeceras guardan reservation: ARCHIVE_RESERVATION_V1, epoch positivo
      adquirido y bindingHash ligado al definitionHash original. Allowlist de los
      siete campos originales; hashes de definición/snapshot/manifiesto/planes/
      intenciones y destinos S3 no cambian ni se refijan. Metadatos nuevos ligan
      reservation en SU definición de corrida, sin convertir las previas.
- [x] begin(definition,captureLiveDossier=false,reservationEpoch) exige al ejecutar
      el epoch explícito adquirido. Firma opcional no significa fallback al control
      actual. Capture lo pasa desde preflight; creación/fence del mismo control
      comparten transacción snapshot/primary/majority. La carrera tras el último
      check de preflight queda cercada; creación repetida no retroadapta cabeceras.
- [x] Repositorio base: create/append/checkpointCapture/seal/claimFile/completeFile/
      releaseFile/markReadyIfComplete releen cabecera y cercan la MISMA reserva
      original/período ACTIVE/dueño/versión/sin escritores en transacción corta.
      Campo archivePreparationRevision opcional, CAS/límite de entero seguro;
      sin default/backfill, índice/colección/TTL nuevos. Ninguna transacción en S3.
- [x] Inicio/checkpoint de antecedentes del DESTINO usan ese fence. Planes,
      materialización (inicio/claim/confirmación/release/cierre) y registro PREPARED
      comparan el epoch de cabecera en sus escrituras del control existentes.
      El predecesor efectivo CLOSED permanece como fuente de solo lectura;
      no se le asigna reserva activa. No conversión V1 o generación tras error.
- [x] Observaciones Mongo/S3 exigen que el epoch actual sea el ORIGINAL de
      cabecera. Otra corrida explícita tampoco adopta un archivo de otra reserva.
      Cabeceras anteriores sin vínculo permanecen legibles como datos, pero no
      se reanudan/modifican/copían/materializan/registran/revalidan. No migración
      automática, reetiquetado, cambio de ID/hash o liberación para sortear guardas.
- [x] Claim incierto no inicia S3. Resultado S3 tardío no confirma ni libera lease
      bajo otra reserva, aun con mismo ID/hora. Un release fallido conserva error
      original y puede dejar trabajo registrado; no prueba fin remoto ni permite
      recuperar legacy/MAY_RUN por tiempo/error. No se añaden recuperadores.
- [x] Contrato frontend central actualizado: funciones afectadas, ajustes,
      anterior/nuevo, integración/errores y compatibilidad/riesgos. Mismos HTTP/
      DTO/URLs/cuerpos/éxitos/errores públicos, incluido PUT animal primitivo.
      Guardas generacionales/captura inicial intactas, sin cambios clínicos/IA/
      BDA/códigos/categorías/acceptedAt/48 h/nameHistory (nombres) o reglas abiertas
      de vencimiento/cancelación. Sin endpoint/job/arranque automático nuevo.
- [ ] Vínculo continuo NO es epoch universal de contenido, corte S3 estable,
      actualidad del expediente activo fuera del protocolo, fin remoto, liveness
      o permiso de consumo/publicación. El hash no es firma ni autorización del
      actor; sigue pendiente el futuro llamador operativo autorizado.
- [ ] Actualizar TODOS los callers de begin y réplicas/mutadores, drenar versiones
      viejas y validar índices/transacciones/majority/IAM/privacidad/lifecycle/
      retención y coste/latencia reales. No protege administración directa,
      borrado/recreación de controles/cabeceras o restauraciones fuera de protocolo.

Detalle: [ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).

Validación:

- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **78 suites y 978 pruebas aprobadas**, dos suites nuevas/63 casos frente a
  76 suites/915 de `e54fba9`.
- Casos: vínculo/hash/scope/protocolo/epoch ausentes o corruptos, matriz de
  19 mutadores ante ABA exacto y cabecera anterior sin vínculo, ciclo nuevo sin
  archivos/S3, rollback simulado creación/fence, respuesta de creación/claim
  perdida, no retrofit incluso con nuevo vínculo ofrecido, creación/checkpoint
  contra liberación, resultado S3 tardío sin confirmación/liberación y contador
  agotado/schema sin default/TTL. Tests existentes de fases/conteos/leases y
  contratos HTTP conservados, no eliminados para declarar compatibilidad.
- `npm run build` y `npm run test:integration:animal-writes:check`: aprobados.
  El arnés SOLO se compila; no se ejecutó de nuevo Mongo real del journal ni se
  atribuye su evidencia al nuevo protocolo.
- ESLint de TODOS los TypeScript nuevos/modificados y `git diff --check`:
  aprobados; formato TypeScript revisado con Prettier.
- Primer Jest: caché EPERM; repetido fuera del sandbox con autorización.
  Ajustados modelos/expectativas previas a los nuevos filtros y transacciones,
  y tipado del modelo de período. Regresión final completa aprobada. Aviso
  SDK/Node heredado no bloqueante, runtime/dependencias sin cambios.
- Dobles de modelos/sesiones/snapshots/S3: no prueban rollback/mayoría/índices/
  concurrencia Mongo o fin remoto reales. Sin Mongo/S3/AWS reales, arranque de
  AppModule, índices reales, migraciones, borrados, cambios IAM, despliegues,
  commits o push. Ocho suites globales heredadas siguen separadas; no se ejecutó
  ni se declara verde toda la suite global. Transferencia completa sigue deshabilitada.

### Bloque 2: vigesimoprimer subbloque, consumo único en transacción del llamador

Base `0bf5d9c` comprobada, rama codex/animal-transfer-planning y árbol limpio.
2026-10-26. Colaborador interno, NO commit de propiedad ni transferencia pública.

- [x] OwnershipArchiveEvidenceConsumption exportado como alias de la MISMA
      instancia MongoOwnershipArchiveMetadataRevalidation. consumeWithinTransaction
      exige sesión activa del mismo cliente Mongo y snapshot/primary/majority;
      NO abre/confirma/reintenta transacciones, ejecuta callbacks o llama a S3.
      El futuro llamador debe integrarlo dentro de SU transacción conjunta.
- [x] Request explícito: id/runId/archiveId UUID, revisión/hash de evidencia
      esperados. Relee metadatos/S3 terminales, definición/vínculo, período ACTIVE,
      misma reserva/dueño/versión/sin escritores y conteos. Hash es comparación
      técnica, no capacidad, firma, autorización o nuevo chequeo S3.
- [x] Nuevas corridas fijan pipelineFence de preparación/planes; ausencia distinta
      de cero, enteros seguros. Páginas/replays/consumo comparan los pins y los
      CAS escritos comparan ambos contadores junto a materialización/reserva.
      Avance de otro pipeline o corrida invalida la evidencia sin refijarla.
- [x] CAS de control, cabecera sin evidenceConsumption y corrida sin consumption
      van en la MISMA sesión. Recibo técnico ARCHIVE_EVIDENCE_CONSUMPTION_V1 con
      identidad/hash/epoch/revisiones/tiempo, sin payload clínico/URLs/keys/errores.
      Marcador a nivel de cabecera impide consumir vía otra corrida; TODOS sus
      mutadores y replays quedan cerrados, sin borrar/ignorar marcas malformadas.
      Estado READY no se presenta como estado de negocio; lecturas de datos conservadas.
- [x] Resultado provisional hasta commit del llamador; si su siguiente escritura
      falla debe abortar y propagar. Guardia fallida tras validar sesión intenta
      abortar y conserva error original, aun si abortar falla. Sesión inválida
      se rechaza sin consultas ni abortar transacción ajena no validada.
- [x] Dos consumidores no confirman ambos; respuesta perdida de commit deja
      recibo. Repetir, aun con mismo id, es conflicto, NO permiso de reejecución.
      Idempotencia y consulta de resultado DE NEGOCIO quedan para el orquestador.
      Consumir/confirmar sin cambios conjuntos sería uso incorrecto del colaborador;
      el recibo aislado no demuestra que se efectuó una transferencia.
- [x] Campos opcionales pipelineFence/consumption en corrida y evidenceConsumption
      en cabecera, sin default/backfill/índices/colecciones/TTL nuevos. Corridas
      previas sin pin no se consumen/adoptan; nueva corrida completa explícita
      solo bajo cabecera/reserva válida. No convertir cabeceras o journals previos.
- [x] Contrato frontend central completo actualizado: funciones, ajustes,
      anterior/nuevo, integración/errores y riesgos. Mismos HTTP/DTO/URLs/cuerpos/
      éxitos/errores públicos, incluido PUT animal primitivo. Sin clínica/IA/BDA/
      códigos/categorías/acceptedAt/48 h/nameHistory o reglas de vencimiento/cancelación.
- [ ] No evidencia de fin remoto/corte estable, permisos/retención, proyección/
      commit de referencias/propiedad/períodos/auditoría/eventos, llamador autorizado
      o integración de captura posterior. No activar aceptación/publicación.
- [ ] Verificar driver/sesión/transaction.options/cliente en Mongo real y al
      actualizar dependencias; implementación inspecciona cliente runtime @internal
      de mongodb 6 con cast localizado. Todas las réplicas deben respetar pins/
      marcadores. No proteger administración directa/restauraciones/usuarios internos
      que omitan el protocolo. Medir costes/latencia antes del rollout.

Detalle: [ownership-archive-evidence-consumption.md](./ownership-archive-evidence-consumption.md).

Validación:

- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **80 suites y 1050 pruebas aprobadas**, dos suites nuevas/53 casos y 19 casos
  adicionales en la matriz de mutadores existente frente a 78 suites/978 de `0bf5d9c`.
- Casos: digest/pins/IDs/revisión, ausencia distinta de cero, sesión inactiva/
  terminada/ajena/options incorrectas/modelos de otro cliente, consumo provisional
  y escritura conjunta SINTÉTICA, manifiesto vacío, consumidores concurrentes,
  reserva/pipeline/definición/digests/conteos cambiados, nueva corrida, reserva
  ganadora frente al snapshot, rollback posterior, CAS final fallido aun con error
  tragado, aborto fallido sin ocultar causa, respuesta de commit perdida sin permiso
  de reejecutar y cierre de 19 mutadores/replays ante marcador presente.
- `npm run build`, ESLint de TODOS los TypeScript nuevos/modificados y
  `git diff --check`: aprobados. Formato revisado con Prettier.
- `npm run test:integration:animal-writes:check`: compilación aprobada, NO ejecución
  del arnés Mongo del journal ni evidencia real de este bloque.
- Primer Jest: caché EPERM; repetido fuera del sandbox con autorización. Ajustados
  tipado de acceso al cliente runtime/readConcern y retorno del doble para lint.
  Regresión final completa aprobada; aviso SDK/Node heredado no bloqueante,
  sin cambiar runtime/dependencias o éxitos HTTP.
- Modelos/sesiones/snapshots y escritura conjunta SINTÉTICA: no prueban Mongo real,
  rollback/majority/índices/exclusión distribuida, pérdida de paquetes/commit incierto
  real o fin S3. Sin llamadas reales Mongo/S3/AWS, arranque de AppModule,
  infraestructura/contenedores, migraciones, índices reales, borrados, cambios IAM,
  despliegues, commits o push. Ocho suites globales heredadas siguen separadas;
  no se ejecutó ni se declara verde toda la suite global. Transferencia deshabilitada.

### Subbloque 22: arnés opt-in Mongo de consumo, preparado sin ejecución real

2026-10-26. Base comprobada: `043d467` (`feat(animal-transfers): add transactional
single-use evidence consumption`), rama `codex/animal-transfer-planning`, árbol
limpio al iniciar. No se asumió hash ni se descartaron cambios.

Implementado:

- [x] Comando/configuración separados `test:integration:archive-evidence`, con
      opt-in y URI propios, sin fallback a configuración de aplicación o journal.
      Namespace generado por caso `animalrecord_evidence_test_<UUID>`, marker y
      allowlist cerrada; dos conexiones/clientes independientes.
- [x] Reutilizar conexión/monitorización/drenaje/limpieza mediante hooks protegidos
      del arnés anterior, sin ampliar su prefijo/allowlist o suites descubiertas.
      Mongo local/puerto/replica set/primary/sesiones exigidos, sin AppModule/AWS.
- [x] Quince casos Mongo preparados: manifiesto con/sin archivos, consumo/insert
      sintético atómicos y visibilidad tras commit, rollback posterior del llamador,
      CAS final cero real aun tragando error, dos consumidores desde snapshot
      común, control ganado por consumidor, cuatro cambios competidores de
      reserva/pipeline, respuesta de aplicación perdida tras commit reconocido,
      sesión de cliente ajeno/options inválidas e índices únicos sin TTL.
- [x] Barreras de un uso/timeout y cierre ordenado. Recibos S3 sintéticos, sin
      operaciones remotas. Transacción explícita del llamador sin callback replay.
      Monitor de metadatos sin documentos/queries/URI, mismo transaction ID en
      control/cabecera/corrida/insert conjunto y snapshot/majority comprobables.
- [x] Veintiún casos nuevos sin conexión de guardas/aislamiento, barreras y
      dispatch de limpieza compartida: rechazo de colección extra cierra conexión
      sin borrar. Prefijo/marker/perfil del journal y evidencia incompatibles.
- [x] Documentación de ejecución/límites en
      [ownership-archive-evidence-mongo-integration.md](./ownership-archive-evidence-mongo-integration.md),
      con mapa/estrategia/consumo/arnés anterior actualizados. Contratos anterior/
      nuevo, ajustes, integración/errores, compatibilidad y riesgos centralizados
      en [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).

Validación y compatibilidad:

- `npm run build`, `npm run test:integration:animal-writes:check`, ESLint de TODOS
  los TypeScript nuevos/modificados y `git diff --check`: aprobados. Formato
  revisado con Prettier. La compilación de integración incluye ambos arneses.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **81 suites/1071 pruebas aprobadas**, frente a 80/1050 de la base. Nueva suite
  con 21 casos sin conexión, incluidos dobles de limpieza; NO quince casos Mongo.
  Corrección posterior de dos métodos async innecesarios para lint, con repetición
  de las dos suites de guardas afectadas; sin cambios de comportamiento.
- `--listTests` de cada comando descubre SOLO su archivo correspondiente; no
  ejecuta globalSetup ni conecta. Nuevo comando con opt-in explícitamente `0`
  rechaza en globalSetup como se esperaba, exit 1, antes de conectar.
- Primeros Jest/guardas rechazados por EPERM de caché del sandbox; repetidos fuera
  de él con autorización. Rechazo opt-in repetido manteniendo `0`. Aviso SDK/Node
  heredado no bloqueante, sin cambios de versiones/dependencias.
- Sin cambios al runtime HTTP, DTO, éxito/errores o PUT animal primitivo, schemas
  de aplicación, negocio médico/IA/BDA/nameHistory. Flutter no requiere ajustes
  por este bloque ni debe interpretar consumo como capacidad pública.
- No se ejecutaron pruebas contra Mongo/S3/AWS reales, contenedores, índices o
  borrados reales, infraestructura, migraciones, despliegues, commits o push.
  Quince casos reales preparados, todavía NO validados. Las once pruebas reales
  anteriores del journal no los cubren. Ocho suites globales heredadas con fallos
  siguen separadas; no se ejecutó ni se declara verde toda la suite global.

Limitaciones y siguiente paso:

- Seleccionar y autorizar explícitamente replica set local desechable, revisar
  puerto/topología/versiones, ejecutar el nuevo arnés y registrar resultado y
  limpieza. Este bloque NO autoriza arrancar infraestructura ni activar opt-in.
- La deriva epoch se inyecta sumando dos con el mismo lock; no ejecuta cancelación
  ni secuencia funcional release/reacquire. Recibos remotos y escritura conjunta
  son sintéticos. Error inyectado tras commit no simula fallo de red del driver.
- Después: integración de proyección/commit de negocio, autorización/idempotencia,
  evidencia remota/corte estable, permisos/retención/antecedentes integrados.
  Mayoría multinodo/failover/red/S3 siguen pendientes incluso si el arnés pasa.
  No recuperar legacy/MAY_RUN o incertidumbre remota por edad/error ni inventar
  vencimiento/cancelación. Transferencia completa permanece deshabilitada.

### Subbloque 23: primera validación real del consumo e integridad del snapshot

2026-10-26. Base comprobada `9cbf17d`, rama codex/animal-transfer-planning,
HEAD/origin coincidentes y árbol limpio al retomar. Docker apagado; se obtuvo
autorización expresa para iniciarlo, crear Mongo desechable, ejecutar los quince
casos y eliminar exclusivamente datos/contenedor sintéticos de este ensayo.

Completado:

- [x] MongoDB 8.0.34/FCV 8.0, replica set animalrecord_evidence_test de UN miembro,
      primary y sesiones comprobados. Docker 28.3.2, imagen local fijada por
      digest, puerto 127.0.0.1:27018, tmpfs sin binds/mounts existentes, --rm,
      límites 1 GiB/CPU y etiquetas/ID propios. Sin .env ni AppModule.
- [x] Primer intento real: 14 fallos/1 aprobada, ANTES de consumir evidencia.
      Mongoose eliminaba objetos vacíos del payload y rompía el contentHash.
      Reproducido sin conexión con documentos Mongoose: dos casos fallidos antes
      de la corrección, snapshots nuevos y retenidos.
- [x] Corregir OwnershipArchiveEntrySchema con minimize=false para preservar el
      snapshot exacto. No cambia hash/canonicalización, validadores o reglas de
      negocio. El arnés siembra entradas con create, igual que append real, sin
      alterar datos sintéticos para eludir la guarda. No rehash/backfill/reparación.
- [x] Segundo intento: **1 suite/15 pruebas Mongo reales aprobadas**, 9.09 s.
      Consumo e insert sintético en misma transacción, snapshot/majority,
      visibilidad/rollback, CAS final cero y error capturado, dos consumidores,
      ambos órdenes de control, cambios de fences/reserva, opciones/sesión ajena,
      índices únicos sin TTL y observación perdida DESPUÉS del commit reconocido.
- [x] Limpieza verificada: treinta bases temporales de ambos intentos ausentes,
      consultadas por sus nombres EXACTOS. Identidad/etiquetas/aislamiento de
      contenedor revalidados antes de detenerlo por ID; --rm lo eliminó. Ningún
      otro contenedor detenido/eliminado. Docker Desktop sigue abierto.
- [x] Registrar entorno, comandos, primer fallo/arreglo, resultados, treinta nombres
      y limpieza en [ownership-archive-evidence-mongo-validation.md](./ownership-archive-evidence-mongo-validation.md).
      Actualizar mapa/estrategia/preparación/consumo/arnés y descripción técnica
      médica del snapshot. Impactos centralizados en la guía frontend (subbloque 23).

Validación y compatibilidad:

- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **82 suites/1073 pruebas aprobadas**, frente a 81/1071. Dos casos nuevos sin
  conexión de serialización/payload/bindings/hash. Los quince casos Mongo reales
  se cuentan por separado y NO prueban S3 o commit de negocio completo.
- `npm run build`, `npm run test:integration:animal-writes:check`, ESLint de todos
  los TypeScript nuevos/modificados y `git diff --check`: aprobados. Formato con
  Prettier. Sandbox denegó named pipe Docker; ensayos fuera con autorización.
  Aviso SDK/Node heredado no bloqueante; versiones/dependencias conservadas.
- Cambia la serialización de NUEVAS entradas de archivo, no el payload/hash que
  debe conservarse. Entradas ya podadas seguirán rechazadas: no inventar {},
  rehashéar, adoptar o restaurar por inferencia; cualquier intervención necesita
  inventario/protocolo/autorización propios. No se inspeccionaron datos reales
  de aplicación. Todos los escritores deben usar el schema corregido.
- Sin cambios a HTTP/DTO/éxitos/errores o PUT animal primitivo, clínica/IA/BDA,
  códigos/categorías/acceptedAt/48 h/nameHistory (nombres). Flutter sin ajustes,
  pero impacto de integridad/compatibilidad/errores registrado centralmente en
  [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
- SÍ hubo Mongo/Docker local temporal autorizado e índices/borrados de prueba.
  NO hubo S3/AWS real, datos de aplicación, migraciones, despliegues, commits o
  push. Ocho suites globales heredadas con fallos siguen separadas; no se ejecutó
  ni se declara verde toda la suite global. No habilita transferencias.

Limitaciones y siguiente paso:

- Mayoría de UN miembro no prueba replicación multinodo/failover/particiones.
  Error de respuesta se inyecta en aplicación tras commit reconocido, no en red
  ni UnknownTransactionCommitResult. Epoch +2 es deriva sintética, no cancelación
  o release/reacquire funcional. Dos clientes del mismo Jest, no dos backends.
- Recibos S3 e insert conjunto sintéticos; no prueba fin remoto/corte estable,
  captura completa entre períodos ni propiedad/referencias/períodos/eventos.
- Siguiente bloque concreto: proyección PURA de referencias destinatarias desde
  snapshots/planes e intenciones/registros generacionales verificados. Validar
  conjunto/procedencia y no mutación, sin activar/escribir colecciones de negocio.
  Después integrar commit conjunto, autorización/idempotencia y evidencia remota.
  Permisos/retención/captura posterior/OTP/solicitudes/notificaciones pendientes.
  No recuperar legacy/MAY_RUN por edad/error ni inventar cancelación/vencimiento.

### Subbloque 24: proyección pura del expediente destinatario

2026-10-26. Base comprobada `8c90cb4`, rama codex/animal-transfer-planning,
HEAD/origin coincidentes y árbol limpio al retomar. Sin descarte de cambios,
commits, push, migraciones, despliegues o nueva operación real de infraestructura.

Implementado:

- [x] Función de dominio buildArchiveRecipientProjection y protocolo
      ARCHIVE_RECIPIENT_PROJECTION_V1: recibe archivo/entradas/manifiesto/registros
      completos y codecs puros del backend; sin provider/llamador, HTTP, Mongo/S3.
- [x] Validar reserva original sin consumir, READY/PLANNED/materialización
      generacional terminal, identidad/hash de planes reconstruidos, intención/
      revisión/registros PREPARED, unicidad/cobertura/conteos y procedencia.
      Todos los usos de archivos compartidos deben coincidir; no huérfanos,
      registros extra, leases, rutas arbitrarias o fallback a finales V1.
- [x] Clonar payloads y sustituir solo paths conocidos con destinos efectivos
      verificados; URL HTTPS reversible por el codec o KEY médica. Cambiar ownerId
      solo en candidatos vigentes de animal/documento, conforme al plan existente.
      Mantener antecedentes como RETAINED_READ_ONLY, dueño/identidad/procedencia
      originales. No interpreta clínica, altera códigos/acceptedAt/48 h/nameHistory.
- [x] Resultado privado con definición/reserva/planes/materialización, entries,
      media deduplicada y projectionHash canónico. Determinista aun con listas
      desordenadas, sin timestamps/UUIDs nuevos; no comparte objetos mutables
      con las entradas. No persistir/loguear ni exponer como DTO o canCommit.
- [x] Una suite nueva con 57 casos sintéticos y fixture de conjunto: ficha/foto,
      diario/audio/archivos compartidos, dos referencias médicas al mismo archivo,
      antecedentes y devolución a A, congelación/no mutación/aislamiento, orden,
      conjunto vacío de archivos, metadatos Mongo, integridad/procedencia, paths
      desconocidos y errores de codecs. Primer intento corrigió solo un fixture
      de devolución cuyo progreso de plan conservaba el hash anterior; sin relajar
      guardas para aceptar estado inconsistente.
- [x] Detalle en [ownership-archive-recipient-projection.md](./ownership-archive-recipient-projection.md).
      Actualizar mapa/estrategia/planes/registros/consumo y nota técnica médica;
      compatibilidad central en frontend-animal-transfer-foundations.md, bloque 24.

Validación y compatibilidad:

- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **83 suites/1130 pruebas aprobadas**, frente a 82/1073. Nueva suite/57 pruebas.
- `npm run build`, `npm run test:integration:animal-writes:check`, ESLint de TODOS
  los TypeScript nuevos/modificados y `git diff --check`: aprobados. Prettier
  aplicado. Jest fuera del sandbox con autorización por EPERM de caché conocido.
- Sin cambios de esquemas/índices/TTL/backfill/dependencias, endpoints/DTO/éxitos/
  errores/URLs existentes o PUT animal primitivo. Sin cambios del flujo activo
  médico/IA/BDA, códigos/categorías/extracción/acceptedAt/48 h/nameHistory (nombres).
  Flutter sin ajustes por este bloque; no aplicar candidatos con los CRUD existentes.
- Pruebas sintéticas SIN Mongo/S3/AWS reales, Docker/infraestructura, migraciones,
  despliegues, commits o push. Las quince pruebas Mongo del bloque 23 tienen otro
  alcance; no prueban este proyector integrado. Ocho suites globales heredadas
  con fallos siguen separadas; no se declara verde la suite global.

Limitaciones y siguiente paso:

- Proyección local del conjunto recibido, no captura coherente actual o prueba
  de vigencia del control/período/S3. No exige corrida S3 terminal ni consume
  evidencia, autoriza decisión/OTP, activa medios, cambia dueño, cierra/abre
  períodos o registra eventos. Codecs deben ser puros/de confianza y restringir
  origen; candidato privado en memoria, sin garantía de tamaño/BSON constante.
- Hash de proyección no es firma, idempotencia de negocio o permiso. Marcadores
  consumidos se rechazan; no se reabren archivos o rehashéan snapshots anteriores.
  Sigue pendiente corte estable, retención/permisos históricos y commit conjunto.
- Siguiente subbloque concreto: lectura interna coherente del conjunto para la
  proyección bajo sesión del llamador y comprobación de fences/reserva, con tests
  de deriva/consumo concurrente. Sin escrituras de negocio o publicación. Después
  integrar commit conjunto y evidencia remota, captura posterior/OTP/solicitudes/
  notificaciones. No levantar guarda inicial ni inventar cancelación/vencimiento
  o recuperar legacy/MAY_RUN por edad/error. Transferencia completa deshabilitada.

### Subbloque 25: lectura de proyección en la transacción del llamador

2026-10-26. Base comprobada `33aa3dd`, rama codex/animal-transfer-planning,
HEAD/origin coincidentes y árbol limpio al retomar. Sin descarte de cambios,
commit/push, despliegues, migraciones o ejecución real de infraestructura.

Implementado:

- [x] Colaborador readRecipientProjectionWithinTransaction(selection, session,
      urlForKey), exportado como OwnershipArchiveProjectionRead, alias de la MISMA
      instancia Mongo de revalidación/consumo. Selección sin ID de consumo: UUIDs
      de corrida/archivo y revisión/hash esperados. Respuesta privada
      ARCHIVE_PROJECTION_READ_V1 con selección explícita releída y candidato.
- [x] Validación compartida de selección y guarda de sesión del consumo; conserva
      ID/errores/recibo y comportamiento del consumo existente. Exige sesión activa
      snapshot/primary/majority y mismo cliente en todos los modelos ANTES de queries;
      una sesión no validada no se aborta ni se consulta con ella.
- [x] Releer corrida/cabecera/período/control y validar reserva original drenada,
      versión/dueño/transferId/hora/epoch, pins de preparación/planes/materialización,
      observaciones Mongo/S3 terminales y no consumidas. No retroadapta legacy.
- [x] Conteos y conjunto completo en la MISMA sesión, queries secuenciales por
      cursor ascendente de hasta 100 filas, con presupuesto de una fila excesiva
      y rechazo ante incompletos/duplicados/páginas inconsistentes. Proyección pura
      valida el conjunto y conserva datos/snapshots/planes originales.
- [x] Reconstruir entryDigest/fileDigest/observationDigest y cursores/conteos contra
      la corrida. Un payload con plan nuevo válido pero distinto del observado
      también se rechaza; hash/contadores ofrecidos no sustituyen esa comparación.
- [x] Sin escrituras propias, consumo o revisiones nuevas; no S3 o ciclo de sesión
      propio/reintentos. Error tras validar sesión intenta abortar transacción
      completa del llamador; falla de aborto no oculta causa. No implica rollback
      global o fin remoto. Un snapshot no adquiere lock ni ve necesariamente un
      competidor posterior: futuro consume/CAS obligatorio en la MISMA transacción.
- [x] Suite nueva con 42 casos simulados: sesión/options/modelos ajenos, selección,
      conjuntos con/sin archivos/retención, paginación >100, queries con la sesión,
      ausencia de writes, aislamiento de salida, digests/cursores falsos, cambios
      de fences/epoch/período/consumo, páginas anómalas, aborto preservando causa,
      snapshot viejo que devuelve candidato y consumo competidor que impide la
      confirmación conjunta obsoleta en el doble. Exportación interna sin endpoint.
- [x] Contrato/límites en [ownership-archive-projection-read.md](./ownership-archive-projection-read.md),
      mapa/estrategia/proyección/consumo y nota técnica médica actualizados.
      Impactos centralizados en frontend-animal-transfer-foundations.md, bloque 25.

Validación y compatibilidad:

- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **84 suites/1172 pruebas aprobadas**, frente a 83/1130. Suite nueva/42 casos;
  suites de consumo/validación compartida conservadas. Focalizadas: 3 suites/95.
  Repetida la suite nueva (42 casos) al precisar la consulta que fija el snapshot
  antes del competidor; el inicio de sesión por sí solo no lo fija en Mongo.
- `npm run build`, `npm run test:integration:animal-writes:check`, ESLint de todos
  los TypeScript nuevos/modificados y `git diff --check`: aprobados. Prettier aplicado.
  Primer Jest bloqueado por EPERM de caché; repetido fuera del sandbox con
  autorización. Ajustados tipos de retornos/resultados Jest para lint, sin cambiar
  comportamiento de negocio. Aviso SDK/Node heredado no bloqueante.
- Sin schemas/índices/TTL/backfill/dependencias o cambios HTTP/DTO/éxitos/errores/
  URLs existentes/PUT animal primitivo. Sin cambios clínica/IA/BDA/códigos/
  categorías/extracción/acceptedAt/48 h/nameHistory (nombres). Flutter sin ajustes;
  candidato/selección privados no son DTO, estado de transferencia o permiso.
- Sin Mongo/S3/AWS real, Docker/infraestructura, migraciones, índices/borrados
  reales, despliegues, commits o push. Quince pruebas Mongo del bloque 23 no
  validan esta lectura. Ocho suites globales heredadas con fallos siguen aparte;
  no se ejecutó ni se declara verde la suite global.

Limitaciones y siguiente paso:

- Coherente con SU snapshot, no estado último o exclusión de otro consumidor.
  Repetir un find en la misma sesión no actualiza el snapshot. Futuro llamador
  debe autenticar/autorizar, consumir evidencia y confirmar TODAS las escrituras
  en una única transacción, sin cachear candidato como capacidad. No se prueba
  que el llamador haya consumido o escrito todo el negocio.
- Páginas acotadas, conjunto/candidato completos acumulados en memoria; medir
  tamaño/duración antes de producción. Codecs puros de confianza, sin I/O. No
  liga projectionHash a recibo durable/idempotencia de negocio. Sin garantía de
  corte estable S3/efectos tardíos o recuperación legacy/MAY_RUN por edad/error.
- Siguiente subbloque concreto: preparar extensión OPT-IN del arnés Mongo para
  lectura + consumo/escritura sintética en MISMA sesión, snapshot obsoleto y dos
  clientes. Compilar/validar guardas sin infraestructura; ejecutar realmente con
  autorización aparte. Después commit conjunto/evidencia remota, retención/
  permisos/captura posterior/OTP/solicitudes/notificaciones. No inventar reglas de
  cancelación/vencimiento ni levantar guarda inicial. Transferencia deshabilitada.

### Subbloque 26: arnés opt-in preparado del lector y consumo conjuntos

2026-10-26. Base comprobada `1590c68`, rama codex/animal-transfer-planning,
HEAD/origin coincidentes y árbol limpio al retomar. Sin descartar cambios,
commits/push/despliegues/migraciones o infraestructura real.

Implementado:

- [x] Comando/configuración nuevos test:integration:archive-projection y
      jest-archive-projection-mongo.json. Opt-in y URI propios obligatorios:
      ARCHIVE_PROJECTION_MONGO_TESTS/ARCHIVE_PROJECTION_MONGO_TEST_URI. Sin fallback
      a app/journal/evidencia. GlobalSetup rechaza antes de conectar.
- [x] Reutilizar aislamiento/namespace UUID por caso, marker/lista cerrada y
      limpieza del fixture de evidencia, sin nuevas colecciones o cambios al
      protocolo de limpieza. Parser loopback estricto y hello previos conservados.
      Los tres comandos descubren un archivo distinto; npm test excluye el nuevo.
- [x] Extraer siembra común del fixture conservando valores por defecto del arnés
      anterior. Datos nuevos de diario/compartidos/retención/devolución y cantidad
      opcional para paginación; observación S3 sintética paginada hasta terminal
      con presupuesto. Sin S3 real ni llamador operativo de aplicación.
- [x] Veinte escenarios Mongo preparados: lectura sin writes + consumo/insert
      técnico en misma sesión en cuatro conjuntos (archivos/vacío/antecedentes/
      devolución), rollback posterior, dos fallos del lector abortando writes
      previos, lectura snapshot antigua sin lock, competidor después de leer,
      dos lectores competidores, cuatro cambios de fences/epoch tras lectura,
      payload/plan local distinto de observación, tres sesiones/options inválidas,
      101 registros/archivos/entradas y error de aplicación tras commit reconocido.
- [x] Comprobar en esos escenarios identidad transaccional de TODAS las queries/
      writes monitorizadas, snapshot/majority, conservación de reserva/READY,
      selección releída, un ganador y ausencia de marcadores/inserts parciales.
      Son aserciones PREPARADAS, no resultados Mongo de este bloque.
- [x] Diecinueve casos nuevos sin conexión de opt-in, URI, configuración y
      descubrimiento separado/exclusión de Jest ordinario. Guardas existentes
      de namespace/limpieza conservadas. Tres suites de guardas: 59 aprobadas.
- [x] Documentar alcance/límites en
      [ownership-archive-projection-mongo-integration.md](./ownership-archive-projection-mongo-integration.md),
      con mapa/estrategia/lector/arnés anterior actualizados. Compatibilidad
      central en frontend-animal-transfer-foundations.md, subbloque 26.

Validación y compatibilidad:

- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **85 suites/1191 pruebas aprobadas**, frente a 84/1172. Suite nueva/19 guardas
  SIN conexión; las veinte pruebas Mongo preparadas NO forman parte del resultado.
- `npm run build`, `npm run test:integration:animal-writes:check`, ESLint de todos
  los TypeScript nuevos/modificados y `git diff --check`: aprobados. Prettier aplicado.
- --listTests de los tres comandos: cada uno descubre solo su propia suite.
  Nuevo comando con opt-in explícitamente 0 rechaza en globalSetup, exit 1,
  antes de conexiones. Variables restauradas en finally. Jest/guarda fuera del
  sandbox con autorización por EPERM conocido; aviso SDK/Node heredado no bloqueante.
- Sin código runtime/schemas/índices/TTL/backfill/dependencias de aplicación
  modificados. Mismos HTTP/DTO/URLs/cuerpos/éxitos/errores, incluido PUT animal
  primitivo. Sin cambios clínica/IA/BDA/códigos/categorías/extracción/acceptedAt/
  48 h/nameHistory (nombres). Flutter sin ajustes; no existe nuevo recibo de negocio.
- Sin Mongo/S3/AWS o Docker reales, infraestructura, índices/borrados reales,
  migraciones, despliegues, commits o push. Los quince casos del bloque 23
  validaron otra suite/alcance. Ocho suites globales heredadas con fallos siguen
  separadas; no se ejecutó ni se declara verde la suite global.

Limitaciones y siguiente paso:

- Veinte escenarios SOLO preparados/compilados; aún no se conoce resultado,
  duración o limpieza reales de esta suite. El hash guardado por el TEST es
  técnico, no payload clínico/candidato entero ni idempotencia de negocio.
  Recibos S3 sintéticos incluso al ejecutarlo. Sin callback replay automático.
- Consultar primero para fijar snapshot; un snapshot viejo puede devolver un
  candidato y confirmar SOLO lecturas, pero no es lock/permiso. Futuro commit
  debe consumir y escribir todo en MISMA transacción. Epoch +2 es inyección,
  no cancelación/release/reacquire; error tras commit no es fallo de red del driver.
- Siguiente subbloque concreto: autorizar y ejecutar este arnés en replica set
  local dedicado/desechable seleccionado; confirmar topología/puerto/versiones
  y registrar resultados, fallos/arreglos y limpieza. No activar opt-in o arrancar
  infraestructura automáticamente. Después integrar commit conjunto/evidencia
  remota, retención/permisos/captura posterior/OTP/solicitudes/notificaciones.
  No inventar vencimiento/cancelación ni recuperar legacy/MAY_RUN por edad/error.
  Transferencia completa sigue deshabilitada.

### Subbloque 27: primera ejecución real del lector y consumo conjuntos

2026-10-26. Base comprobada `e72ec8e`, rama codex/animal-transfer-planning,
HEAD/origin coincidentes y árbol limpio al retomar. Entorno temporal y ejecución
de veinte casos autorizados expresamente; sin modificar código fuente, fixtures,
schemas o pruebas para hacerlos pasar. Solo documentación al cerrar.

Completado:

- [x] Crear servidor desechable con imagen local fijada por digest (--pull never),
      MongoDB 8.0.34/FCV 8.0, replica set animalrecord_projection_test de UN miembro,
      primary/sesiones comprobados. Docker 28.3.2 ya abierto, puerto solo loopback
      127.0.0.1:27018, --rm, tmpfs sin binds/mounts existentes, límites y etiquetas
      propios. No .env/AppModule o datos de aplicación.
- [x] Primera ejecución real: **1 suite/20 pruebas aprobadas**, 13.96 s. Sin fallos
      o arreglos. Lectura sin writes + consumo/insert técnico en MISMA transacción,
      identidad de sesión de queries/writes, snapshot/majority, cuatro conjuntos
      con archivos/vacío/antecedentes/devolución y conservación de reserva/READY.
- [x] Confirmar límites/carreras reales: snapshot ya fijado puede devolver datos
      antiguos y confirmar SOLO lecturas después de otro consumo. No es lock.
      Consumo posterior obsoleto no confirma su insert frente a otro consumidor
      o cambios de epoch/preparación/planes/materialización. Relectura en misma
      sesión no actualiza snapshot; otro lector nuevo rechaza evidencia obsoleta.
- [x] Rollback por fallo posterior y por errores de lectura que abortan writes
      previos aun capturando error; dos lectores compitiendo; divergencia válida
      de payload/plan frente a digests; sesión ajena/options incorrectas; 101
      entradas/archivos/registros (caso completo 1.808 s, no benchmark productivo)
      y error de aplicación tras commit reconocido sin reconsumo.
- [x] Verificar ausencia de las VEINTE bases de prueba por sus nombres EXACTOS.
      Revalidar ID/etiquetas/--rm/aislamiento de contenedor y detenerlo por ID exacto;
      --rm lo eliminó, consulta posterior sin resultados. PostgreSQL existente no
      intervenido y sigue healthy. Docker/imagen en caché permanecen disponibles.
- [x] Registrar entorno/comandos/veinte nombres/resultados/limpieza y límites en
      [ownership-archive-projection-mongo-validation.md](./ownership-archive-projection-mongo-validation.md).
      Actualizar mapa/estrategia/arnés/lector/proyección y nota técnica médica.
      Impacto central frontend-animal-transfer-foundations.md, subbloque 27.

Validación y compatibilidad:

- `npm run test:integration:archive-projection`: **20/20 aprobadas** en el entorno
  local descrito, adaptadores/transacciones Mongo reales. DOS clientes de un
  mismo Jest, no dos procesos del backend. Recibos S3 e insert siguen SINTÉTICOS.
- `npm run build`, `npm run test:integration:animal-writes:check` y
  `git diff --check`: aprobados en este bloque. Sin TypeScript nuevo/modificado:
  ESLint no aplica. Docker/Jest fuera del sandbox con autorización por named
  pipe/caché, sin modificar configuración persistente.
- Regresión ordinaria de la BASE: 85 suites/1191 pruebas del subbloque 26. No se
  repitió al cambiar solo documentación; no presentarla como nueva ejecución ni
  sumar los veinte Mongo al número ordinario. Ocho suites globales heredadas
  siguen como deuda separada; no se ejecutó ni se declara verde la suite global.
- Mismos runtime/HTTP/DTO/URLs/cuerpos/éxitos/errores y PUT animal primitivo.
  Sin cambios clínica/IA/BDA/códigos/categorías/extracción/acceptedAt/48 h/
  nameHistory (nombres), schemas/índices de aplicación/dependencias. Flutter sin
  ajustes; un candidato/hash/registro PREPARED no representa transferencia.
- SÍ hubo Mongo/Docker temporal autorizado y creación/borrado de datos/índices
  sintéticos. NO S3/AWS real, datos de aplicación, migraciones, despliegues,
  commits o push. No habilita propiedad/publicación/transferencia.

Limitaciones y siguiente paso:

- Mayoría de UN miembro no prueba multinodo/durabilidad distribuida/failover/
  particiones, muerte/reinicio de procesos o rollout mixto. Error tras commit
  es de aplicación, no fallo de red/UnknownTransactionCommitResult. Epoch +2
  no ejecuta cancelación o release/reacquire funcional.
- Veinte casos no acreditan corte estable S3/fin remoto, IAM/lifecycle/retención,
  permisos históricos/captura completa entre períodos o aplicación real de
  referencias/propiedad/períodos/eventos/idempotencia. Sigue sin llamador operativo.
- Siguiente bloque concreto: auditar TODOS los escritores/efectos remotos del
  expediente (journal, activeWrites, tickets/PUT emitidos, promociones/copias e IA)
  y documentar matriz/contrato de evidencia para CORTE ESTABLE S3 antes del commit
  de negocio. Separar garantías actuales, protocolos faltantes y ensayos reales
  necesarios; no inferir fin por tiempo/error/ausencia de tokens/HEAD. Revisión
  interna sin autorización de AWS, limpieza, recuperación o publicación. Después
  implementar garantías pendientes y commit conjunto/autorización/idempotencia,
  retención/permisos/captura posterior/OTP/solicitudes/notificaciones.
  Vencimiento/cancelación pendientes; no recuperar legacy/MAY_RUN por edad/error.

### Subbloque 28: auditoría de escritores y contrato propuesto de corte S3

Base comprobada: `2a4be2e`, rama `codex/animal-transfer-planning`, árbol limpio;
últimos commits revisados. Sin commit/push/fetch, cambios de runtime, schemas,
índices o migraciones. Revisión local y documentación pública AWS; sin operaciones
de cuenta AWS/S3, Mongo o Docker.

- [x] Matriz de catorce grupos de escritores/efectos, fuentes y garantías en
      [animal-transfer-stable-s3-cut.md](./animal-transfer-stable-s3-cut.md).
      Incluye coordinación/journal, PUT nuevos/legacy, promociones/borrados,
      ingreso/BDA/fallback/revisión/reemplazo/compensación médica, migración,
      histórico/staging, materialización y observación/consumo.
- [x] Brechas concretas: copias histórico/staging sin condición de destino;
      copias/PUT médicos sin pin o condición de destino; ARN persistido después
      de iniciar BDA; restauración médica sobre la misma clave; borrado compartido
      que oculta errores y DeleteObjects médico sin comprobar errores por objeto.
      Lease/fence Mongo no impiden que un efecto remoto en vuelo termine tarde.
- [x] Contrato técnico PROPUESTO de cobertura, intención/autorización por efecto,
      evidencia de fin o aislamiento, revisión/retención y vínculo al futuro commit.
      Ningún ledger, estado persistido, política AWS o autorizador nuevo implementado.
- [x] Seis carreras documentadas y ensayos pendientes; no se afirman reproducidas.
      Inventario actual omite journals ya terminados sin claim/lock; no acredita
      cobertura de efectos ni muerte de proceso. Impacto central en guía frontend,
      subbloque 28; contratos HTTP y PUT animal primitivo sin cambios.

Validación: revisión estática y contraste con contratos públicos AWS, comprobación
de 37 enlaces locales nuevos y `git diff --check` (incluido chequeo separado de
espacios finales del documento nuevo). No se ejecutaron build/tests de runtime
por ser documentación solamente. Última regresión ordinaria sigue siendo la del
subbloque 26: **85 suites/1191 pruebas**; Mongo lector/consumo del subbloque 27:
**1 suite/20 pruebas** en un nodo. No son nuevas ejecuciones ni pruebas S3/BDA;
persisten las ocho suites globales heredadas con fallos ajenos registradas antes.

Compatibilidad/limitaciones: sin cambios clínicos, extracción, códigos, 48 h,
nameHistory (nombres), interfaces públicas, permisos o reglas de transferencia.
Auditoría no demuestra exhaustividad de despliegues antiguos/admin/IAM/lifecycle.
MAY_RUN, LOCALLY_FINISHED, error y vencimiento no acreditan fin remoto o rollback.
No recuperar legacy/MAY_RUN por edad/error ni habilitar transferencia completa.
Vencimiento/cancelación siguen pendientes; estrategia funcional médica intacta.

Siguiente bloque concreto: lector interno paginado de evidencia local de journals
por animal, incluidos terminales sin activeWrites; contrato mínimo, consulta/índice,
cursor/límite y pruebas de errores/compatibilidad. No `canCommit`, recuperación,
API pública ni cierre S3. Después ledger/autorización por efecto, protección de
histórico/staging y retención verificable; tickets/BDA necesitan cobertura propia
antes de integrar el llamador de negocio y su commit conjunto.

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
- [x] Adquisición transaccional y recuperación explícita/auditada previa al permiso
      con fence contra adquisiciones tardías: noveno subbloque, pruebas simuladas.
- [x] Arnés opt-in preparado con guardas/compilación sin conexión: décimo subbloque.
- [x] Primera ejecución real del arnés, once pruebas aprobadas y limpieza local:
      undécimo subbloque; evidencia limitada al replica set de un nodo.
- [x] Importador explícito interno de antecedentes/procedencia/referencias y
      pruebas sintéticas A→B→C/devolución: duodécimo subbloque. No integración
      automática con captura posterior ni transferencia completa.
- [x] Plan persistido/paginado de referencias históricas y destinatarias:
      decimotercer subbloque. PLANNED no es activación ni cierre de períodos.
- [x] Materialización explícita/reanudable desde staging, sin sobrescritura y
      con reconciliación de identidad/digest: decimocuarto subbloque. Colisiones
      ajenas se detienen, no se declaran resueltas ni se activa ninguna referencia.
- [x] Generaciones explícitas para materialización no iniciada y guardas contra
      activación legacy: decimoquinto subbloque. V1 emitido sigue inmutable;
      colisión en una generación tampoco autoriza sobrescritura ni cambio de ruta.
- [x] Registro interno explícito/inmutable por archivo con procedencia PREPARED,
      separado de tickets y publicación: decimosexto subbloque. No concede acceso
      ni activa referencias; guardas ordinarias siguen sin excepciones.
- [x] Recorrido paginado de metadatos del conjunto con digests/fence ligado al
      control: decimoséptimo subbloque. METADATA_OBSERVED no es verificación S3,
      epoch universal de escritores, actualidad del expediente activo o permiso.
- [x] Observación paginada S3 de solo lectura ligada a la corrida y sus registros,
      con HEAD/GET/HEAD, digest y checkpoint bajo fence: decimoctavo subbloque.
      No materializa/repara/adopta, activa o autoriza; solo evidencia observada.
- [x] Identidad monotónica en los cinco mutadores de reserva e invalidación de
      recorridos Mongo/S3 frente a ABA: decimonoveno subbloque. No epoch universal
      de contenido, fin remoto o autorización de commit.
- [x] Vínculo inmutable de NUEVAS cabeceras con reserva original, creación y
      todos sus mutadores/checkpoints cercados transaccionalmente; cabeceras
      previas no adoptadas: vigésimo subbloque. Sin consumo/publicación.
- [x] Colaborador de consumo único de observaciones dentro de transacción del
      llamador, con marcadores cabecera/corrida y pins de preparación/planes:
      vigesimoprimer subbloque. No llamador de negocio/publicación/propiedad.
- [x] Arnés OPT-IN del consumo con escritura conjunta sintética, rollback, dos
      clientes/carreras y cambios de reserva/fences, más respuesta ocultada tras
      commit: subbloque 22 preparado/compilado y guardas verificadas sin conexión.
      Quince casos Mongo pendientes de ejecución, no aceptación habilitada.
- [x] Primera ejecución real autorizada del arnés de evidencia: subbloque 23,
      quince casos aprobados en un nodo, con arreglo de persistencia de objetos
      vacíos del snapshot y limpieza comprobada de treinta bases/contenedor.
- [x] Proyección pura de referencias destinatarias: subbloque 24, conjunto completo
      validado, destinos generacionales y candidatos separados de originales;
      sin I/O, activación o permiso de traspaso.
- [x] Lectura coherente del conjunto para proyección bajo sesión del llamador,
      reserva/período/fences/digests: subbloque 25, con pruebas de deriva/consumo
      simuladas; una lectura snapshot NO adquiere fence o permiso de commit.
- [x] Arnés OPT-IN del lector + consumo preparado: subbloque 26, veinte escenarios,
      comando/opt-in propios, guardas/compilación/descubrimiento sin conexión.
- [x] Primera ejecución real del lector + consumo: subbloque 27, veinte casos
      aprobados en un nodo sin arreglos de código/tests; limpieza de veinte
      bases y contenedor comprobada. Sin S3 real o negocio aplicado.
- [x] Auditoría de escritores/efectos remotos y contrato técnico propuesto de
      corte estable S3: subbloque 28, solo documentación. No demuestra fin remoto.
- [ ] Siguiente subbloque concreto: lector interno paginado de journals por animal,
      incluidos terminales sin tokens; incertidumbre y cobertura explícitas,
      errores sin falso vacío y sin permiso/recuperación/cierre S3. Ver contrato
      de alcance en animal-transfer-stable-s3-cut.md. Después cubrir efectos,
      tickets/BDA, retención y commit conjunto de negocio. No convertir V1 ni
      levantar guarda inicial o fabricar períodos CLOSED para probarlo.
- [ ] Integrar llamador operativo autorizado antes de intervenir; no ampliar
      recuperación a legacy/MAY_RUN/efectos remotos por tiempo/error, pues requieren
      evidencia distinta. Ensayos multinodo/red/S3 siguen pendientes. El impacto
      frontend permanece centralizado.
- [ ] Recuperación verificable de tokens/reservas, pruebas reales, activación
      de referencias y conservación/permisos históricos/limpieza segura antes
      de habilitar aceptación.
- [ ] Siguen pendientes: autorización OTP específica (reutilizando transporte),
      solicitudes/decisiones, notificaciones/outbox/push, migración y prueba integral.

Los endpoints de descubrimiento ya existen; POST de transferencia y aceptación
todavía no existen. No crear solicitudes simuladas en Flutter ni confundir este
checkpoint con el cierre del feature.
