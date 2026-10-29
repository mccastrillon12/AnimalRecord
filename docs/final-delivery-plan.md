# Última entrega: plan y seguimiento

Inicio: 2026-10-25. Este documento organiza planificación, decisiones y ejecución.
Una tarea propuesta no representa funcionalidad implementada.

## Punto de reanudación actual

Actualizado 2026-10-28. Mantener este resumen al cerrar cada bloque; consultar el
detalle histórico solo cuando ayude a resolver una duda o revisar evidencia.

- Base comprobada: `codex/animal-transfer-planning`, HEAD `433014c`, referencia
  origin local coincidente, sin fetch; árbol limpio al iniciar el 53.
- Último bloque: 53 terminado, tres POST autenticados de emisión/reenvío/verificación
  OTP EMAIL/PHONE, prueba opaca de propósito ANIMAL_TRANSFER y consumo interno
  que exige transacción de negocio. TransferOtpModule conectado al grafo; ningún
  POST de creación/aceptación de solicitud todavía. Social sin canal OTP reutilizable
  devuelve conflicto explícito, integración pendiente. Backend no desplegado.
- Validación del 53: 110 suites/2049 pruebas seleccionadas aprobadas (36 nuevas),
  36.084 s, una regresión amplia de cierre; focalizadas durante desarrollo.
  Build/lint de 14 TS/check de arneses correctos, sin infraestructura/envíos reales.
  Arnés S3/Mongo conserva 48 casos preparados/compilados, NO ejecutados con esta versión.
  Los 102 resultados del 48 siguen como evidencia histórica previa al aplicador del 49.
  Ocho suites globales heredadas siguen como deuda; no afirmar suite global verde.
- Pendiente: validar aplicador/ensamblado en el entorno desechable propuesto para
  120 casos (48+23+28+21). Sobre los 108 anteriores el usuario eligió «Solo dejarlo preparado»:
  ensayo NO autorizado; no activar opt-in, inspeccionar/iniciar Docker o conectar
  Mongo por esta propuesta. Requiere autorización específica posterior.
  La ampliación a 120 tampoco está autorizada. Próximo paso de validación: revisar
  y autorizar específicamente entorno/alcance actuales, ejecutar y registrar resultados/
  limpieza antes de integrar el provider real. Sin instalación automática.
  Contrato/entorno en
  [verificación](./animal-media-promotion-verification.md). Evidencia del 42 en
  [arnés de sellado](./animal-media-promotion-seal-mongo-integration.md).
  Autorización del 48 utilizada y cerrada. Estado de Docker/puertos del 48 es histórico;
  no se volvió a inspeccionar y no se presume disponibilidad actual.
- Límites: no Mongo/S3/AWS/Docker reales, migraciones, commit/push o despliegue
  por un simple «continúa». La autorización del ensayo 39 ya se utilizó y cerró.
  MATCH/sello/HEAD/error/edad/token ausente no prueban cierre remoto o rollback;
  no recuperar MAY_RUN/legacy por esas señales. Mantener guarda inicial/V1.
- Objetivo pendiente: histórico exacto de solo lectura para dueño anterior y copia
  independiente para destinatario. Próximo bloque funcional: crear solicitudes
  pendientes idempotentes consumiendo prueba OTP en la MISMA transacción, con
  validación de propietario/animales/destinatario/motivo, sin aplicar transferencia.
  Faltan retención/corte estable, commit de traspaso, aceptación, notificaciones e histórico final.
  Vencimiento, cancelación, máximo de animales y ubicación del histórico siguen abiertos.
- Frontend: nuevos endpoints OTP/DTO/códigos/Retry-After y prueba en la guía existente.
  No habilitar Finalizar por verificar OTP. Registro/reset y éxitos previos intactos;
  puerto opcional de promoción continúa ausente, sin activar transferencia.
  Usar la guía frontend existente cuando cambien contratos o comportamiento observable.
- Forma acordada: bloques funcionales completos, verificaciones focalizadas y una
  regresión de cierre; no fragmentar commits ni repetir suite por guardarlos.

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
| 4      | OTP de transferencia y confirmación idempotente                  | 0, 1, 3     | Prueba de autorización temporal, limitada y consumida una vez                                                      | Emisión/reenvío/verificación EMAIL/PHONE y consumidor interno implementados; faltan consumo con solicitud idempotente, social y validación real |
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

### Subbloque 29: lector interno paginado de journals por animal

Base comprobada: `96e05eb`, HEAD y referencia origin coincidentes en
`codex/animal-transfer-planning`, árbol limpio; sin fetch/commit/push. El bloque
28 quedó confirmado. Contrato/consulta/índice definidos antes de implementar en
[animal-write-journal-inventory.md](./animal-write-journal-inventory.md).

- [x] AnimalWriteJournalInventory y puerto de lectura independiente, exportados
      como servicio interno desde AnimalWriteJournalModule/AnimalModule. Sin
      controller, job, consultas al arranque o cambios del coordinador/escritores.
- [x] Filtro por claim del animal, sin excluir terminales, versiones previas,
      estados inciertos o UNSPECIFIED. Incluye journals sin tokens/control actual.
      Cursor UUID exclusivo por operationId, orden simple por id; default 20,
      máximo 50 más lookahead. Valida tamaño, orden y scope de toda la página.
- [x] Lectura primary/majority, proyección permitida, ejecución Mongo limitada
      con maxTimeMS 5000. Reconstruye salida mínima y solo el claim consultado;
      rechaza claims coincidentes ausentes/duplicados. Omite actor, otros animales,
      auditoría de recuperación, datos clínicos/payloads/URLs/errores.
- [x] coverage INCOMPLETE y remoteEffects NOT_ASSESSED siempre, incluso vacío.
      Conserva protocolo/ownershipVersion ausentes en legacy y fechas de permiso
      aunque callback sea NOT_INVOKED. No interpreta antigüedad ni declara
      recuperable, fin remoto, rollback, permiso de commit o snapshot entre páginas.
- [x] Índice compuesto recomendado documentado, NO declarado en schema ni creado;
      índices existentes sin cambios, sin migración. Coste/plan real e índice deben
      verificarse antes de integrar un caller operativo. Timeout no da falso vacío.
- [x] Dos suites nuevas (33 pruebas) y wiring DI ampliado, con modelos simulados;
      impacto completo centralizado en guía frontend, subbloque 29.

Validación:

- `npm run build`: correcto.
- ESLint de los siete archivos TypeScript nuevos/modificados: correcto.
- Pruebas focalizadas del lector/adaptador/wiring: 3 suites/34 pruebas correctas.
  El primer intento no ejecutó pruebas por EPERM al renombrar caché Jest en el
  sandbox; repetición autorizada fuera del sandbox correcta, sin cambiar protocolo.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **87 suites/1224 pruebas correctas**. No es la suite global; permanecen las ocho
  suites heredadas con fallos ajenos previamente registradas, no reevaluadas aquí.
- `git diff --check`, 11 enlaces locales nuevos y espacios finales de los seis
  archivos nuevos: correctos.

Compatibilidad/limitaciones: éxitos/errores HTTP, incluido PUT animal primitivo,
DTO, URLs, permisos, reglas clínicas/48 h y nameHistory (nombres) intactos. Puerto
existente de escritura sin cambios. No índices/TTL/dependencias/migraciones nuevos,
ni acceso real Mongo/S3/AWS/Docker. Mocks no prueban planes de consulta, mayoría
real, failover o cobertura global. IDs nuevos menores al cursor pueden omitirse;
los estados pueden avanzar entre páginas. El lector no adquiere fence ni modifica
claims/reservas/journals. Requiere autorización explícita del futuro caller y
protocolo distinto para evidencia de efectos legacy/MAY_RUN, tickets y BDA.

Siguiente bloque concreto: definir contrato durable y máquina de estados de
intención/autorización por efecto para promociones de foto/diario. Incluir identidad
de operación, todos los intentos/retries del SDK, autorización frente a revocación
y respuesta perdida; probar las carreras antes de integrar dispatch real. Una
autorización concedida conserva incertidumbre hasta evidencia suficiente; no
convertir ausencia de envío registrado en permiso para recuperar. Ledger remoto,
retención/histórico/staging y commit de negocio siguen pendientes; transferencia
completa deshabilitada y vencimiento/cancelación sin decidir.

### Subbloque 30: contrato y máquina pura de efectos de promoción

2026-10-26. Estado real verificado antes de editar: rama
`codex/animal-transfer-planning`, árbol limpio, HEAD `4909732`
(`feat(animal-transfers): add paginated write-journal inventory`), anterior
`96e05eb`. Últimos seis commits revisados; sin asumir que el dato previo seguía
vigente. Sin fetch, descarte de cambios, commit/push/migraciones o despliegue.

Trabajo terminado:

- [x] Revisión de controllers/casos de uso de foto/diario, AnimalMediaUploads,
      adaptador de promoción, caller compartido LegacyAnimalMediaCopier y journal/
      coordinador. Hoy no se transmite el handle del journal al callback ni al
      ticket. SDK instalado client-s3 3.1003.0/middleware-retry 4.4.39 inspeccionado:
      un client.send puede envolver varios next/intentos; configuración intacta.
- [x] Contrato registrado antes del código en
      [animal-media-promotion-effects.md](./animal-media-promotion-effects.md).
      Separa modelo puro implementado de persistencia durable/dispatch propuestos,
      sin modificar reglas funcionales aprobadas o decidir cancelación/vencimiento.
- [x] Modelo MEDIA_PROMOTION_EFFECT_MODEL_V1 sin provider/caller runtime:
      vínculo local de operación/instancia/animal/dueño/versión/kind con journal
      transaccional OPEN/MAY_RUN/ACQUIRED; efecto UUID y definición/hash inmutables
      de bucket, uploadId, origen fijado/revisión/digest/tamaño, MIME y destino
      con creación condicional. Solo promociones ordinarias nuevas, no legacy,
      tickets sellados o generaciones. Modelo no relee/cerca journal/control.
- [x] Intenciones por intento UUID/ordinal/instancia de dispatcher; INITIAL,
      APPLICATION_RETRY y SDK_RETRY con enlace al anterior autorizado. Permiso
      UUID por intento; revisión CAS de operación compite con puerta OPEN→REVOKED.
      Revocar cierra declaración/intención/permisos futuros; no borra los previos.
      Repetir/releer un permiso nunca concede otro envío. Acknowledgement perdido
      conserva posibilidad de envío aunque no exista registro posterior.
- [x] Respuestas UNKNOWN/ACKNOWLEDGED y observaciones MATCH/ABSENT/CONFLICT
      append-only, admisibles después de revocar. MATCH liga procedencia/digest/
      revisión pero no cierra todos los intentos ni prueba retención. Resumen
      INCOMPLETE/NOT_ASSESSED sin canCommit/remoteClosed/recuperable. Modelo
      determinista sin reloj/TTL/I/O, cambios de entradas o evidencia clínica.
- [x] Pruebas de seis intercalados CAS, dos autorizadores, reply de autorización/
      revocación perdida, permisos previos/enviables después de revocar, retries
      separados y 5040 permutaciones FINITAS de siete acciones con dos efectos.
      Alcance: referencia en memoria y store simulado; no prueba un CAS Mongo
      implementado, instrumentación del SDK o fin remoto. Fixtures sin conexión.
- [x] Contrato anterior/nuevo, funcionalidades, ajustes, integración/errores y
      compatibilidad/riesgos centralizados en
      [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md),
      subbloque 30. Mapa/estrategia/auditoría/coordinación/journal/inventario actualizados.

Pruebas y resultados:

- `npm run build`: correcto, repetido después de fijar bucket en la definición.
- `npm exec -- eslint` de los cinco TypeScript nuevos: correcto en estado final.
  Prettier aplicado solo a esos archivos. Corregido lint de regex con NUL literal.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **89 suites/1292 pruebas aprobadas**, 54.177 s; dos suites nuevas/68 pruebas
  frente a 87/1224 de la base. La exploración de 5040 órdenes es UN caso dentro
  de ese total, no 5040 pruebas adicionales. Primera regresión 89/1289 aprobada;
  se repitió completa tras añadir bucket/hash y tres casos de destino inválido.
- Primer intento focalizado: EPERM al renombrar caché Jest en sandbox, cero
  pruebas ejecutadas; repetición fuera autorizada: 64 correctas/1 expectativa
  incorrecta (la referencia opaca `bad` sí es válida). Se corrigió el fixture
  negativo a `:bad`, sin restringir referencias válidas para hacer pasar la prueba.
  Las regresiones posteriores citadas quedaron completamente correctas.
- Aviso Node20/AWS SDK heredado no bloqueante; runtime/dependencias conservados.
  No se ejecutó ni se declara verde la suite global: ocho suites heredadas con
  fallos ajenos permanecen como deuda separada.
- `git diff --check`: correcto; seis archivos nuevos comprobados también sin
  espacios finales. Comprobados 182 enlaces locales en los nueve documentos
  afectados (57 destinos distintos), cero enlaces rotos.

Compatibilidad y limitaciones:

- Sin cambios de ejecución/HTTP/DTO/URLs/éxitos/errores, incluido PUT animal
  primitivo, módulos/providers, schemas/índices/TTL/backfill o dependencias.
  Flutter sin ajustes nuevos; modelo/comandos/revisiones son privados del backend.
  No se modifica medicina/IA/BDA, clínica/extracción/códigos/acceptedAt/48 h,
  nameHistory (nombres), permisos, tokens/reservas/journals o recuperación previa.
- Modelo puro del contrato, NO ledger persistido ni dispatcher. No protege
  solicitudes AWS actuales. En particular, permiso concedido antes de revocar
  puede producir envío posterior: el modelo lo retiene como riesgo, no afirma
  bloquearlo ni autoriza recuperar por ausencia de envío/antigüedad/error.
- Sin Mongo/S3/AWS/Docker reales, arranque de AppModule, migraciones, índices
  reales, borrados, cambios IAM, despliegues, commits o push. Sin nuevos tests
  de integración preparados/ejecutados o evidencia de retención/corte estable.
  Guarda inicial y preparaciones V1 intactas; transferencia completa deshabilitada.

Siguiente paso concreto: implementar persistencia interna separada de puerta,
efectos/intentos y evidencia, con índices/validación de hidratación, CAS común y
transacciones snapshot/primary/majority; ligar inicio/cierre con journal/control
e impedir recreación tardía de puerta revocada. Probar rollback, dos instancias,
snapshot obsoleto y acknowledgements inciertos con dobles, SIN dispatch ni
conexiones reales. Preparar/autorizar ensayos Mongo reales por separado. Después
elegir/verificar instrumentación por cada envío físico (incluidos retries SDK/
middleware/handler) y enlazar identidad a callers antes de cualquier dispatch.
Cobertura PUT/legacy/migración/borrados/BDA/histórico/staging, aislamiento/retención
y llamador/commit conjunto siguen pendientes; no asumir garantías por el modelo.

### Subbloque 31: persistencia transaccional interna de permisos de promoción

2026-10-26. Rama `codex/animal-transfer-planning`, árbol limpio y HEAD `ad5bd4a`
(`feat(animal-transfers): model media promotion effect authorization`) comprobados
al retomar tras la subida del usuario. Anterior `4909732`; últimos cinco commits
revisados, sin fetch, descarte de cambios o commit/push del agente.

Trabajo terminado:

- [x] Contrato registrado antes de implementar en
      [animal-media-promotion-persistence.md](./animal-media-promotion-persistence.md).
      Puerto MediaPromotionPersistence: open/apply/revoke/read por selección
      interna de operación/instancia/animal y revisiones explícitas. Sin caller
      HTTP/operativo, jobs, integración a AnimalMediaUploads o dispatch AWS.
- [x] Colección declarada animal_media_promotion_records, protocolo
      MEDIA_PROMOTION_ROWS_V1. Filas GATE/EFFECT/ATTEMPT/RESPONSE/OBSERVATION, sin
      arrays crecientes de intentos/evidencia. Identidad global única mediante
      id e identityIds (1–2 UUIDs), índices parciales por recurso/ordinal y lectura
      por operación/kind/id. Sin TTL/reciclaje/upsert/backfill. Nada creado en Mongo.
- [x] Hidratación con allowlists, protocolo/scope/UUID/contadores seguros/hash/
      definición/pin/bucket y vínculos padre/último intento/ordinal. Rechaza
      corrupción y ausencias incompatibles; no normaliza para avanzar. Declarar
      relee ticket por uploadId en sesión, no acepta definición de ticket externa.
      Reutiliza las guardas puras con vista acotada; ordinal persistido desde
      contador/último intento real. Índices cubren unicidad entre filas, pendiente
      validación real. Comandos clonados al entrar para impedir retarget durante I/O.
- [x] MongoMediaPromotionPersistence usa transacciones snapshot/primary/majority
      cortas y secuenciales, sin I/O AWS ni resultados reutilizados de callbacks
      abortados/reintentados. CAS común de puerta junto a cada fila. Abrir/declarar/
      intentar/autorizar cercan journal OPEN/MAY_RUN/claim ACQUIRED y control del
      mismo dueño/versión/token/instancia sin reserva. Campo mediaPromotionRevision
      opcional en journal/control, CAS de ausencia distinto de cero, sin default
      o índice allí; corrupción/agotamiento falla cerrado. No cambia claims,
      reservas, ventanas, resultados/timestamps de callback o criterios de recuperación.
- [x] Revocación con revisión exacta cierra registro/permisos futuros. Sin puerta,
      expectedRevision ausente explícito crea directamente tombstone REVOKED con
      requestId/operatorId/evidenceRef y fence del journal. Admite vínculo válido
      antes de MAY_RUN o tras cierre local SOLO para denegar permisos futuros;
      no atribuye ejecución/NOT_INVOKED ni retira tokens. Tombstone gana frente a
      apertura tardía; apertura ganadora exige al revocador releer revisión.
      Puertas existentes nunca se adoptan ni reabren al repetir apertura.
- [x] Marca mediaPromotionProtocol=MEDIA_PROMOTION_ROWS_V1 opcional, sin default,
      declarada ÚNICAMENTE al crear el journal inicial de confirmación ordinaria
      de un animal y sin emisión URL. Crear rechaza fence prellenado o marca/tipo/
      scope incompatibles. Abrir/revocar no retroadapta journals anteriores aunque
      estén MAY_RUN/ACQUIRED. Coordinador actual aún no emite la marca: integración
      explícita pendiente, sin adopción de operaciones previas o ampliación de recuperación.
- [x] Lecturas acotadas por ID en transacción coherente, salida local
      INCOMPLETE/NOT_ASSESSED sin permiso nuevo. Respuestas/observaciones son
      append-only, también después de revocar; ningún ACK/MATCH/ABSENT descarga
      autorizaciones previas. Respuesta de commit perdida puede dejar TODO
      confirmado; consultar mismos IDs, no reenviar o recuperar por error/edad.
- [x] MediaPromotionPersistenceModule explícito exporta el puerto; NO importado
      por AppModule/AnimalMediaModule. Schema nuevo con autoCreate/autoIndex false,
      minimize false y strict throw. Wiring probado con modelos simulados;
      serialización Mongoose desconectada, sin URI/connect/init. Callers actuales
      no respetan la puerta nueva todavía y no ganan garantías por este bloque.
- [x] Compatibilidad centralizada en
      [frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md),
      subbloque 31; mapa/estrategia/modelo/journal/coordinación/inventario/auditoría
      actualizados. Separados contrato implementado, objetivo aprobado y pendientes.

Validación y resultados exactos:

- `npm run build`: correcto, repetido tras snapshot de comando y marca de opt-in.
- ESLint de los once TypeScript nuevos/modificados: correcto; repetido en los
  archivos de ajustes finales, correcto. Prettier aplicado solo a archivos del bloque.
- `npm run test:integration:animal-writes:check`: correcto, SOLO compilación de
  arneses existentes; no se activó opt-in ni ejecutó integración Mongo nueva/vieja.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **91 suites/1362 pruebas aprobadas**, 29.801 s. Dos suites nuevas/70 pruebas
  frente a 89/1292 de la base: 66 de adaptador y cuatro de módulo/schema. Incluye
  las 68 pruebas del modelo anterior; no sumar sus 5040 permutaciones aparte.
  Regresiones previas 91/1357 y 91/1358 aprobadas; repetidas después de snapshot
  de comando y marca de opt-in. Ocho suites globales heredadas siguen como deuda separada;
  no se ejecutó ni se declara verde la suite global.
- Nuevos casos: rollback de fences/fila/último puntero/CAS final; dos instancias,
  snapshot obsoleto, apertura contra tombstone y permiso contra revocación en
  ambos órdenes; cierre real del adaptador de journal dentro del doble frente a
  apertura/permiso, pérdida de token/reserva; replies perdidas tras commits del
  doble (sin simular paquetes/UnknownTransactionCommitResult); audit/ID/recurso
  duplicado, retries/ordinales y consultas acotadas, datos corruptos, contadores
  ausentes/cero/agotados, conexión ajena, evidencia tardía y cero defaults/TTL.
- Intento focalizado en sandbox: EPERM de caché Jest y error de tipado del helper
  de prueba, sin casos ejecutados. Repetido fuera con autorización. Durante las
  focalizadas se corrigieron tres expectativas nuevas (writer competidor sin
  sesión y mensaje de reutilización) y tipado de inspección de schemas/wiring;
  sin relajar guardas o cambiar contratos exitosos. Aviso Node20/AWS SDK heredado
  no bloqueante; runtime/dependencias intactos.
- Al incorporar la marca, una pasada terminó con 90 suites/1358 casos correctos
  y la suite de wiring sin ejecutar por un elemento SchemaType colocado en la
  lista de nombres del test. Corregido solo ese test; repetición FINAL 91/1362
  completamente correcta. No se presenta la pasada parcial como verde.
- `git diff --check`: correcto. Ocho archivos nuevos comprobados también sin
  espacios finales; 201 enlaces locales revisados en los diez documentos afectados,
  64 destinos distintos y cero enlaces rotos.

Compatibilidad y limitaciones:

- HTTP/DTO/URLs/cuerpos/éxitos/errores, incluido PUT animal primitivo, conservados.
  Sin consultas nuevas al arranque/CRUD/polling ni ajustes Flutter. Sí hay schema
  técnico opcional e índices nuevos declarados para el módulo aislado; no se afirma
  ausencia de impacto solo porque JSON público sea idéntico. Rollout, instalación
  explícita de colección/índices y compatibilidad de TODOS los callers pendientes.
- Sin Mongo/S3/AWS/Docker reales, migraciones, índices reales, borrados, cambios
  IAM, despliegues, commits o push. Simulador optimista usa revisión global gruesa;
  no acredita conflictos por documento, mayoría/índices/failover Mongo reales o
  transporte AWS. No resuelve edición administrativa/restauración/borrado fuera
  del protocolo ni comprueba recursivamente toda la cadena de intentos al leer.
- No hay ledger remoto completo, SDK instrumentado, autenticación/autorización
  operativa, retención/aislamiento, cierre S3 o commit de negocio. Permiso concedido
  puede enviar tarde tras revocación. Ticket/sellado/borrados concurrentes de los
  callers antiguos necesitan cobertura antes de conectar dispatch. No recuperar
  legacy/MAY_RUN por error/edad/ausencia de envío. Guarda inicial/V1 intactas;
  transferencia completa deshabilitada y decisiones funcionales abiertas intactas.

Siguiente paso concreto: preparar arnés Mongo OPT-IN dedicado a este protocolo,
con dos clientes, índices reales SOLO en base desechable, transacciones/rollback,
tombstone/apertura, permiso/revocación/cierre y respuestas ocultadas tras commit.
Reutilizar aislamiento/guardas de arneses existentes sin ampliar sus allowlists;
comando/opt-in/namespace propios. Compilar, verificar guardas y descubrimiento SIN
conexiones. Ejecución real requiere autorización expresa posterior del entorno.
Sembrar journals con opt-in desde create inicial y progresar por su protocolo;
no agregar la marca retroactivamente a fixtures MAY_RUN para evitar las guardas.
Después enlazar identidad a callers/instrumentar cada envío físico/retry y cubrir
retención/aislamiento/otros writers antes de corte estable y commit conjunto.

### Subbloque 32: arnés Mongo opt-in de promociones preparado sin conexión

Base comprobada: `ede7627` (`feat(animal-transfers): persist media promotion
authorizations`), rama `codex/animal-transfer-planning`, árbol limpio. Anteriores
`ad5bd4a`, `4909732`, `96e05eb`. Sin fetch, commit o push del agente.

Trabajo terminado:

- [x] Comando/configuración/globalSetup propios para persistencia de promociones,
      opt-in y URI MEDIA_PROMOTION_MONGO_TESTS/MEDIA_PROMOTION_MONGO_TEST_URI.
      El comando de check compila todos los arneses mediante el tsconfig existente.
      No forma parte de npm test ni amplía las suites de los comandos anteriores.
- [x] Fixture de dos clientes, base aleatoria propia por caso y allowlist cerrada
      de marker/control/journal/upload/filas de promoción. Reutiliza parser,
      conexión/monitor/drenaje/limpieza de soporte anterior; sus allowlists intactas.
      Solo estrecha a `{connection}` el requisito de entrada del helper compartido
      de pérdida de respuesta; implementación existente sin cambios.
- [x] Siembra opt-in desde create NOT_STARTED, INTENT, adquisición transaccional
      y permiso de callback; no adopta/retromarca MAY_RUN. Tickets/pins sintéticos
      creados por repositorio; sin cliente S3, URL o AppModule.
- [x] **26 escenarios Mongo preparados, NO ejecutados**: índices declarados/
      unicidad, foto/diario y evidencia tardía, rollback de tres etapas, apertura/
      tombstone y permiso/revocación/cierre en ambos órdenes, token retirado,
      snapshot de solo lectura antiguo, cuatro respuestas de aplicación ocultadas
      después de commit confirmado, tombstone previo a permiso, rechazo de journal
      sin marca y retries aplicación/SDK separados. Barreras de un uso, no sleeps.
- [x] Contrato, entorno, límites, lista de escenarios y siguiente paso en
      [animal-media-promotion-mongo-integration.md](./animal-media-promotion-mongo-integration.md).
      Impacto central en frontend-animal-transfer-foundations.md; mapa, estrategia,
      persistencia/modelo, inventario y auditoría de corte actualizados.

Validación y resultados exactos:

- `npm run build`: correcto.
- `npm run test:integration:media-promotion:check`: correcto, SOLO compilación
  del arnés nuevo y anteriores. Primer intento detectó tipos Mongoose/UUID/unión
  de promesas en soporte nuevo; corregidos sin tocar código de producción.
- ESLint de los siete TypeScript nuevos/modificados: correcto. Prettier aplicado
  solo a archivos del bloque; sin nuevas dependencias.
- Focalizada de guardas nuevas: **1 suite/36 pruebas aprobadas**, 5.387 s.
  Primer intento en sandbox falló por EPERM al renombrar caché Jest, cero casos;
  repetición y regresión fuera del sandbox con autorización. No infraestructura.
- `--listTests` de los cuatro comandos de integración: una suite distinta por
  comando, todas separadas del descubrimiento ordinario de npm test.
- Nuevo comando con opt-in forzado a 0: rechazo esperado de globalSetup antes
  de conectar, **npm exit 1** comprobado; wrapper de verificación exit 0. Variable
  restaurada en finally. No se ejecutó ningún caso Mongo nuevo o anterior.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
  **92 suites/1398 pruebas aprobadas**, 30.928 s; frente a 91/1362 de la base,
  una suite/36 pruebas nuevas sin conexión. Los 26 escenarios preparados NO se
  suman a ese resultado. Ocho suites globales heredadas siguen como deuda separada;
  no se ejecutó ni se declara verde la suite global. Aviso Node20/AWS SDK heredado
  no bloqueante; runtime/dependencias intactos.
- `git diff --check`: correcto. Ocho archivos nuevos revisados sin espacios
  finales; 192 enlaces locales en nueve documentos afectados, 71 destinos únicos
  y cero enlaces rotos. HEAD sigue en `ede7627`; src sin modificaciones.

Compatibilidad y limitaciones:

- Sin modificaciones de src, módulos/HTTP/DTO/cuerpos/URLs/éxitos/errores, incluido
  PUT animal primitivo. Sin consultas/latencias nuevas ni cambios de schema de
  producción o ajustes Flutter. Comandos de desarrollo nuevos sí tienen capacidad
  explícita de crear índices/colecciones y limpiar SU namespace al autorizar ejecución.
- Sin Mongo/S3/AWS/Docker reales, índices/colecciones/borrados reales, migraciones,
  IAM, despliegue, commit o push. Preparar/compilar no verifica transacciones,
  índices/mayoría/failover ni duraciones del arnés en una topología real.
- No dispatch/ledger completo/cierre S3, permisos públicos, aceptación, retención
  o commit de negocio. Respuesta perdida inyectada será de aplicación DESPUÉS de
  commit reconocido, no fallo de red/UnknownTransactionCommitResult. SDK_RETRY
  solo etiqueta datos sintéticos; no instrumenta SDK. Guarda inicial/V1 intactas;
  transferencia deshabilitada, recuperación y decisiones funcionales sin cambios.

Siguiente paso concreto: ejecutar los 26 casos en un replica set local desechable
SOLO tras autorización específica del entorno; comprobar puerto/topología/versiones
y registrar resultados exactos/limpieza de cada namespace. No activar opt-in o
arrancar infraestructura automáticamente. Después enlazar identidad a callers y
verificar TODOS los envíos/retries antes de dispatch; ticket/sellado concurrente,
otros escritores, cobertura/aislamiento/retención y corte estable siguen pendientes.

### Preparación del siguiente ensayo: revisión y entorno propuesto, ejecución pendiente

2026-10-26 (America/Bogota). Git comprobado antes de actuar: árbol limpio,
rama `codex/animal-transfer-planning`, HEAD y referencia origin en `9ca8456`;
anteriores `ede7627` y `ad5bd4a`, últimos seis commits revisados. Sin fetch.
Esta preparación documental NO cierra la validación Mongo del siguiente subbloque.

Cierre documental retomado el 2026-10-27: misma rama y HEAD `9ca8456`; conservados
los cuatro documentos modificados y el procedimiento nuevo de esta preparación.
Las lecturas OS y pruebas siguientes son las realizadas en la revisión previa,
no una nueva observación del entorno ni una nueva ejecución de esas suites.

Trabajo terminado:

- [x] Revisión de suite/fixture/parser/opt-in/barreras/monitor/drenaje/limpieza,
      schema de promociones y adaptador transaccional. Sin cambio de código
      identificado como necesario antes de ejecutar; validación real pendiente.
- [x] Entorno concreto y operaciones a autorizar documentados en
      [animal-media-promotion-mongo-runbook.md](./animal-media-promotion-mongo-runbook.md):
      contenedor propio, digest fijado/--pull never, un miembro, puerto loopback
      27018, tmpfs sin datos existentes, límites, restauración de variables,
      inventario exacto de namespaces y limpieza por identidad verificada.
- [x] Lectura OS autorizada: mongod PID 6296 en 127.0.0.1:27017, excluido del
      ensayo; 27018/27019 sin listener observado, Docker Desktop/backend activos.
      Sin contactar a Docker/Mongo; contexto/versión del engine/caché pendientes.
      Node 20.18.0, npm 11.0.0, Mongoose 8.21.0 y driver 6.20.0 comprobados.
- [x] Impacto funcional/operativo, contrato anterior/nuevo, integración/errores,
      compatibilidad y riesgos centralizados en la guía frontend. Mapa y documento
      del arnés enlazan el procedimiento pendiente.

Validación y resultados exactos:

- `npm run test:integration:media-promotion:check`: correcto, solo compilación.
- `npm test -- --runInBand --runTestsByPath test/animal-transfer/infrastructure/media-promotion-mongo-safety.spec.ts test/animal-transfer/infrastructure/local-mongo-test-safety.spec.ts test/animal-transfer/infrastructure/archive-evidence-mongo-safety.spec.ts test/animal-transfer/infrastructure/archive-projection-mongo-safety.spec.ts`:
      **4 suites/95 pruebas aprobadas**, 3.399 s, sin conexión. Primer intento
      falló por EPERM de caché Jest, cero casos; repetición fuera autorizada.
- `npm run test:integration:media-promotion -- --listTests`: una suite dedicada,
      sin ejecutar casos ni globalSetup. Los 26 casos Mongo siguen pendientes.
- Lectura inicial de puertos denegada por sandbox; repetición autorizada solo de
      lectura OS. No fue autorización para operaciones Docker/Mongo.
- Build/ESLint/regresión de negocio no repetidos: cambios solo documentales.
      Resultado 92/1398 del bloque 32 es previo; ocho suites globales heredadas
      siguen como deuda separada. No se afirma suite global verde.
- Cierre del 2026-10-27: `git diff --check` correcto; 115 enlaces locales en los
      cinco documentos afectados, cero rotos y sin espacios finales, incluido el
      archivo nuevo. Diff de src/test/package.json/package-lock.json vacío.

Compatibilidad/límites: sin cambios de src/tests/runtime/HTTP/DTO/URLs/éxitos/
errores (incluido PUT animal primitivo), schemas, dependencias o grafo. Sin
operaciones reales Mongo/S3/AWS/Docker, migraciones, despliegues, commit o push.
Transferencia completa deshabilitada; guarda inicial/V1, recuperación previa al
permiso, objetivo de copia exacta/independiente y decisiones pendientes intactos.
La propuesta de ensayo de un nodo no demuestra cierre remoto ni commit de negocio.

Siguiente paso concreto: obtener autorización específica para inspeccionar Docker
local y crear/ejecutar/limpiar el entorno descrito, revalidar imagen/nombre/puerto/
topología, ejecutar los 26 escenarios y registrar resultados y limpieza exactos.
Si falta la imagen local o cambian los parámetros, presentar la diferencia;
no descargar, reutilizar el mongod existente o conectar Atlas automáticamente.
Después enlazar identidad a callers y verificar cada envío/retry antes de dispatch.

### Subbloque 33: validación real de persistencia de promociones

2026-10-27 (America/Bogota), base `0e928fd`, rama esperada y árbol limpio,
HEAD/referencia origin coincidentes y últimos commits comprobados. Usuario
autorizó expresamente inspección/creación/ejecución/limpieza del entorno local.
Sin fetch, commit o push del agente.

Trabajo terminado:

- [x] Docker local desktop-linux/named pipe comprobado; motor inicialmente apagado.
      Inicio de Docker Desktop solicitado y autorizado por separado. Engine 28.3.2,
      imagen local fijada por digest/--pull never, sin descarga. Contenedor propio
      en 127.0.0.1:27018, sin binds/volúmenes existentes, tmpfs y límites verificados.
      MongoDB 8.0.34, FCV 8.0, replica set animalrecord_promotion_test de un miembro
      primary/sesiones 30 min. Mongo existente 27017 del host excluido.
- [x] Dos ejecuciones del arnés real. Primera: 25/26 aprobadas, 22.851 s, npm exit 1.
      Una expectativa del test confundía ConflictError con InvalidArgumentError:
      al reintentar tras el cierre ganador, la guarda ve THREW y deniega el permiso.
      Se corrigió solo el test (clase/mensaje existentes) y se añadió comparación
      del estado completo con el cierre ganador. Sin relajar guardas o tocar src.
- [x] Segunda ejecución: **1 suite/26 pruebas aprobadas**, **9.077 s**, npm exit 0.
      Índices/queries/transacciones/carreras/rollback reales; dos clientes en un
      mismo Jest. Conservación de permisos y rechazo de nuevos tras cierre/revocación.
      Pins S3/SDK_RETRY sintéticos y error de aplicación después de commit reconocido.
- [x] Limpieza de 26 bases del primer intento y luego 52 nombres exactos combinados
      comprobada con listDatabases filtrado, remaining=[]. Contenedor revalidado
      por ID/imagen/etiquetas/aislamiento y detenido solo por ese ID; --rm retiró
      contenedor/tmpfs. Ausencia por ID y puerto 27018 libre comprobados. 27017 y
      PostgreSQL ajeno conservados; Docker Desktop e imagen permanecen disponibles.
- [x] Registro completo de entorno, error, corrección, resultados e inventario
      exacto en [animal-media-promotion-mongo-validation.md](./animal-media-promotion-mongo-validation.md).
      Guía frontend central actualizada junto con mapa, estrategia y documentos
      afectados; notas previas de preparación conservan su alcance histórico.

Validación:

- `npm run test:integration:media-promotion`: resultados de ambos intentos arriba.
- `npm run test:integration:media-promotion:check` y `npm run build`: correctos.
- ESLint de la única suite TypeScript modificada: correcto tras ajustar salto de
      línea de Prettier, sin cambio semántico posterior al ensayo.
- `npm test -- --runInBand --runTestsByPath test/animal-transfer/infrastructure/mongo-media-promotion-persistence.spec.ts`:
      **1 suite/66 pruebas aprobadas**, 3.373 s, con dobles/sin conexión,
      resultado separado de los 26 escenarios Mongo.
- `git diff --check`: correcto; 213 enlaces locales en once documentos afectados,
      cero rotos y sin espacios finales, incluido el documento nuevo. Diff de
      src/package.json/package-lock.json vacío.
- Regresión amplia de negocio no repetida: sin cambio de producción, solo test
      opt-in y documentación. Las 92/1398 del bloque 32 siguen siendo previas;
      ocho suites globales heredadas permanecen como deuda, sin afirmar verde global.

Compatibilidad: HTTP/DTO/URLs/cuerpos/éxitos/errores (PUT animal primitivo incluido),
schemas/índices de aplicación/dependencias/grafo intactos. Índices creados solo
en bases desechables. Sin dispatch/caller nuevo, AWS/S3/Atlas reales, migraciones
de aplicación, despliegue, commit o push. Un miembro no demuestra replicación,
failover/red/UnknownTransactionCommitResult, retención o corte estable. Se conservan
coverage INCOMPLETE/remoteEffects NOT_ASSESSED, guarda inicial/V1 y recuperación
previa al permiso. Transferencia deshabilitada; objetivo aprobado y decisiones
pendientes intactos.

Siguiente paso concreto: definir/enlazar identidad operación/instancia a callers
ordinarios foto/diario con opt-in desde create inicial, sin adoptar legacy/MAY_RUN;
verificar TODOS los envíos físicos/retries/middleware/handler con transporte falso
antes de integrar dispatch. Ticket/sellado concurrente, otros escritores, cobertura,
aislamiento/retención, autorizador de corte estable y commit de negocio pendientes.
Otros ensayos reales requieren autorización específica de su entorno.

### Subbloque 34: enlace interno de identidad a confirmaciones foto/diario

2026-10-27. Base `5500a68`, rama `codex/animal-transfer-planning`, árbol limpio,
HEAD/referencia origin coincidentes y últimos cinco commits comprobados al retomar.
Sin fetch ni descarte de cambios. Contrato registrado antes de implementar:
[animal-media-confirmation-context.md](./animal-media-confirmation-context.md).

Trabajo terminado:

- [x] Contexto interno readonly/congelado: operación, instancia, animal, dueño,
      versión adquirida y kind; copia/valida UUID canónico, versión segura,
      allowlist sin payload y scope/tipo. No es capacidad de envío/fence actual.
- [x] AnimalWriteCoordinator permite opt-in explícito solo en PROFILE_CONFIRM/
      ATTACHMENT_CONFIRM de un animal sin URL. Declara la marca existente al crear
      NOT_STARTED, nunca la agrega a MAY_RUN previo. Solo entrega contexto después
      de adquisición/permiso reconocidos; captura opciones/versión antes de I/O.
      Otros callbacks conservan invocación sin argumentos. Error/ack incierto
      previo no entrega contexto ni ejecuta callback; no amplía recuperación.
- [x] Controllers foto/adjuntos lo propagan a casos de uso/manager y
      AnimalMediaUploads.confirm, incluida reconfirmación idéntica. Validación
      local de animal/dueño/tipo antes de confirmar medios/escribir negocio.
      Contexto copiado antes de esperar lookup; sin DTO/HTTP/log o ticket nuevo.
- [x] Callers directos sin contexto conservan compatibilidad. Un journal marcado
      puede terminar sin ticket, legacy o sellado: la marca solo declara
      elegibilidad para el puerto, no efectos/envíos cubiertos. No se enlaza
      LegacyAnimalMediaCopier ni se le inventa journal HTTP. Sin adopción/backfill.
- [x] Persistencia de efectos fuera del grafo; sin open/apply/revoke desde callers,
      dispatcher, SDK/retries configurados o nuevas consultas. El protocolo S3
      vigente no gana garantías nuevas. Impacto centralizado en guía frontend;
      mapa/estrategia/coordinación/journal/modelo/persistencia/auditoría actualizados.

Validación y resultados exactos:

- `npm run build`: correcto. Primer intento detectó inferencia del spread de dos
      argumentos opcionales del diario; corregido, repetición aprobada.
- `npm run test:integration:media-promotion:check`: correcto; solo compilación
      de todos los arneses. Ningún escenario Mongo ejecutado en este bloque.
- `npm exec -- eslint` de nueve TypeScript nuevos/modificados: correcto en estado
      final. Prettier aplicado solo a ellos. Primer lint detectó tipos de mocks,
      referencia de métodos y formato de tests, corregidos sin relajar guardas.
- Focalizada: 5 suites/103 pruebas aprobadas, 6.371 s. Primera pasada parcial:
      suite nueva sin ejecutar por tipo literal ampliado y un caso HTTP fallido
      por comparar undefined no serializable; tres suites previas correctas.
      Corregidos tipos/expectativa de tests; repetición final completamente verde.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
      **93 suites/1423 pruebas aprobadas**, **37.618 s**. 25 nuevas frente a
      92/1398: una suite/23 casos de contexto y dos HTTP. Incluye fallos inciertos,
      permisos no reconocidos, validaciones, captura contra retarget, identidad
      por operación, propagación foto/diario/idéntica y compatibilidad de cuerpos.
      No es prueba de Mongo ni transporte/retries físicos. Aviso Node20/AWS SDK
      heredado no bloqueante; ocho suites globales heredadas siguen como deuda,
      no reevaluadas aquí ni declaradas verdes. Pruebas fuera del sandbox por
      EPERM de caché Jest conocido; sin infraestructura real.
- `git diff --check`: correcto; 224 enlaces locales comprobados en diez documentos
      afectados, cero rotos. Archivos nuevos de contrato/dominio/test también
      comprobados sin espacios finales; sin cambios de dependencias.

Compatibilidad: rutas/DTO/URLs/cuerpos/éxitos/errores actuales, incluido PUT animal
primitivo, conservados. Nuevos rechazos internos de wiring inválido, no permisos
públicos ni ajustes Flutter. Marca opcional existente ahora emitida por dos callers;
sin nuevos campos/schema/índices/TTL/migraciones/dependencias/providers/consultas.
Sin cambios de medicina/IA/clínica/códigos/acceptedAt/48 h o nameHistory (nombres).
Guarda inicial/V1, recuperación previa y decisiones funcionales abiertas intactas.
Transferencia completa deshabilitada; coverage INCOMPLETE/remoteEffects NOT_ASSESSED.
Sin Mongo/S3/AWS/Docker reales, despliegue, commit o push.

Siguiente bloque concreto: comprobar con request handler falso del SDK instalado
cada envío físico/retry/redirect/middleware/handler antes de instrumentar/conectar
permisos de dispatch por intento. No usar un contexto retenido o una autorización
leída como permiso de reenvío. Integración persistencia/dispatch, ticket/sellado
concurrente, otros writers/legacy, cobertura/aislamiento/retención, corte estable y
commit de negocio siguen pendientes.

### Subbloque 35: ensayos SDK de transporte de promociones sin red

2026-10-27, base `d6a184e`, rama `codex/animal-transfer-planning`, árbol limpio,
HEAD/referencia origin coincidentes y últimos cinco commits comprobados. Sin
fetch o descarte de cambios. Contrato documentado antes de los tests en
[animal-media-promotion-transport.md](./animal-media-promotion-transport.md).

Trabajo terminado:

- [x] Fixture de S3Client real con handler/respuestas HTTP sintéticos. No stub de
      client.send. Firma/serialización/middleware/retry/deserialización reales;
      creds/region/config explícitos de test y backoff cero para rapidez, sin
      cambiar producción. Guarda net.Socket.connect exige cero conexiones por caso.
- [x] Resolución desde el cliente instalado: client-s3 3.1003.0, copia anidada de
      middleware-sdk-s3 3.972.18, middleware-retry 4.4.39, node-http-handler 4.9.7,
      util-retry 4.2.11. Inspeccionado código local realmente cargado; sin registry,
      actualización o instalación. Las versiones/configuraciones futuras requieren
      revalidación. Es evidencia local, no garantía de todos los entornos.
- [x] 28 escenarios: condiciones/origen/versionId, 503/200-Error/reset/timeout,
      200 vacío, 412/403, límites 1/3, redirect habilitado/deshabilitado, middleware
      de reenvío, retry de aplicación, handler duplicador, denegación/permiso
      sintético perdido, revocación antes de retry/redirect y pausa tras permiso;
      adaptador real promote/reconciliación/fallo incierto; cadena SDK→Node handler
      →https.request falso y tres casos aislados del Node handler. Sin sockets.
- [x] Hallazgos comprobados: maxAttempts=1 con redirect habilitado puede generar
      dos llamadas al handler y metadata.attempts=1; tampoco limita un middleware
      que llame next dos veces ni los internos de un handler arbitrario. HTTP 200
      con Error se reintenta en el caso SlowDown; HTTP 200 vacío arroja InternalError
      sin retry en esta versión/configuración. Ninguno prueba rollback remoto.
- [x] Punto candidato elegido: wrapper debajo de middleware/retry/redirect, con
      handler subyacente controlado/no reenvío interno. Probes sintéticos muestran
      por qué debe obtener permiso por delegación y conservar riesgo de permisos
      ya concedidos; NO usan MediaPromotionPersistence ni son permisos reales.
      Sin wrapper de producción o dispatch conectado. Impacto central frontend,
      mapa/estrategia/modelo/persistencia/contexto/auditoría actualizados.

Validación exacta:

- Focalizada final: **1 suite/28 pruebas aprobadas**, **5.648 s**.
      Primera versión de 25 casos pasó (5.814 s). Lint detectó imports require y
      parámetro sin uso; cambio a default imports falló en setup de 28 casos por
      CommonJS sin esModuleInterop. Corregido a namespace imports; siguiente
      pasada 27/28 por expectativa de retry incorrecta ante 200 vacío. Corregida
      expectativa al comportamiento real, sin cambiar SDK/producción; final verde.
- ESLint de dos TypeScript nuevos: correcto en estado final. Prettier solo en ellos.
- `npm run build` y `npm run test:integration:media-promotion:check`: correctos;
      check solo compila arneses, no conecta o ejecuta escenarios Mongo.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
      **94 suites/1451 pruebas aprobadas**, **50.224 s**, frente a 93/1423; incluye
      las 28 nuevas. Verifica también restauración de mocks en la regresión. Ocho
      suites globales heredadas siguen como deuda, sin afirmar verde global.
      Aviso Node20/AWS SDK heredado no bloqueante, sin cambio de runtime/deps.
      Pruebas fuera del sandbox por EPERM de caché Jest conocido; cero red real.
- `git diff --check`: correcto; 208 enlaces locales comprobados en nueve documentos
      afectados, cero rotos; sin espacios finales, incluidos tres archivos nuevos.
      Diff de src/package.json/package-lock.json vacío.

Compatibilidad: sin cambios de src/runtime/handlers/SDK configurado, módulos,
HTTP/DTO/URLs/éxitos/errores (PUT animal primitivo incluido), schemas/índices o
dependencias. Sin Mongo/S3/AWS/Docker reales, migraciones, despliegue, commit o
push. No .env/AppModule/servidor local; queries/reintentos modelados no prueban
provider, proxies/TLS, custom agents/HTTP2/browser, persistencia durable o corte
estable. coverage INCOMPLETE/remoteEffects NOT_ASSESSED, recuperación previa,
guarda inicial/V1, objetivo aprobado y decisiones pendientes conservados.
Transferencia completa deshabilitada. Los 26 escenarios Mongo previos no repetidos.

Siguiente paso concreto: wrapper INTERNO de request handler para un efecto
ordinario fijo, con intención/dispatcher/permiso distintos por cada delegación,
comparación request/definición y errores de permiso distintos de errores S3
reintentables. Probar con puerto simulado/transporte falso denegación, permiso
perdido, retry/redirect, pausa tras permiso y fallo al registrar respuesta. Mantener
fuera de callers actuales hasta cubrir ticket/sellado concurrente y enlace exacto.
Ledger global, otros writers/legacy, retención/aislamiento/corte estable y commit
de negocio continúan pendientes; no recuperar MAY_RUN/legacy por error o edad.

### Subbloque 36: dispatcher interno de promoción por efecto

2026-10-27, base `29c7ff9`, rama `codex/animal-transfer-planning`, árbol limpio,
HEAD/referencia origin coincidentes y últimos cuatro commits comprobados. Sin
fetch o descarte. Contrato registrado antes del código en
[animal-media-promotion-dispatcher.md](./animal-media-promotion-dispatcher.md).

Trabajo terminado:

- [x] MediaPromotionCopyDispatcher aislado, no provider/caller Nest. Factoría
      exige efecto ordinario declarado sin intentos previos, scope/hash/IDs
      válidos y configuración backend acotada. No abre/adopta puerta ni permisos.
      Un send por instancia; no reanuda/reintenta aplicación sobre efectos previos.
- [x] S3Client y NodeHttpHandler propios, sin handlers/middleware/plugins/agents
      arbitrarios. Request copiado/congelado antes de await y comparado con fuente/
      versión/ETag/destino/condición/MIME/metadata/pin, host/región/path/query/PUT/
      HTTPS/cuerpo vacío; headers extra/duplicados se deniegan. Sin logs de payload,
      credenciales, firmas o errores crudos. Endpoints comerciales regionales
      virtual-host/path-style; otras particiones/configuraciones fuera de alcance.
- [x] Cada delegación relee evidencia local, compara contador/último intento y
      obtiene intención+autorización nuevas vía CAS/fences del puerto existente.
      INITIAL/SDK_RETRY con UUIDs separados de intento/dispatcher/permiso y padre
      inmediato. Solo reconocimiento NUEVO permite un envío; no se adopta permiso
      leído tras error. Snapshot no es fence. Sin S3 dentro de transacción Mongo.
- [x] Respuestas del handler conservadoras UNKNOWN, también tras revocar. HTTP
      200 no implica ACK de copia. Fallar autorización/registro detiene instancia
      con error local por etapa sanitizado, sin status/cause retryable del error
      Mongo; SDK no reintenta por esa causa. Resultado de transporte solo se
      propaga tras UNKNOWN reconocido. Falla de evidencia conserva permiso y
      detiene retries; stream se destruye en fallo local posterior. Cliente/handler
      cerrados al terminar. No descarga permisos ni infiere rollback/fin remoto.
- [x] Treinta y nueve pruebas nuevas con store optimista simulado + adaptador real,
      SDK/Node handler y peticiones nativas falsas. Revocación antes de permiso,
      permiso reconocido/reply pausado que todavía envía después de revocar,
      ack de intención/autorización perdido, retries/redirects por permiso propio,
      respuesta fallida/confirmada con ack perdido, CAS tardío, dos dispatchers,
      journal cerrado, retargets, fuente versionada y scope/request inmutables.
- [x] @smithy/node-http-handler=4.9.7 y @smithy/protocol-http=5.3.11 declarados
      directos en package.json; ya instalados transitivamente, mismas versiones.
      npm ls --depth=0 correcto; sin instalar/descargar/actualizar SDK. Lockfile
      local ignorado no modificado; no hay lockfile versionado en el repositorio.
- [x] Guía frontend central actualizada con contrato anterior/nuevo, integración/
      errores, compatibilidad y riesgos; mapa/estrategia/modelo/persistencia/
      contexto/ensayos/auditoría enlazan el contrato. Objetivo aprobado separado
      de dispatcher implementado y su integración/corte/negocio pendientes.

Validación exacta:

- Focalizada nueva: **1 suite/39 pruebas aprobadas**, **7.805 s**. Primera pasada
      28/28 correcta (8.417 s); ampliada con once casos de retarget/versión/copia
      durante pausa/evidencia tardía/lectura/cierre. Sin relajar guardas.
- `npm run build`: correcto, repetido tras guarda final de effectCount.
- `npm run test:integration:media-promotion:check`: correcto; solo compilación
      de todos los arneses, ningún caso Mongo ejecutado en este bloque.
- ESLint de dos TypeScript nuevos correcto; primer lint señaló import de test
      sin uso, retirado. Prettier aplicado solo a ambos archivos nuevos.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
      **95 suites/1490 pruebas aprobadas**, **47.751 s**, frente a 94/1451; incluye
      los 39 nuevos. Store simulado y cero sockets; no son resultados Mongo reales.
      Las ocho suites globales heredadas siguen como deuda separada; no afirmar
      suite global verde. Aviso heredado Node20/AWS SDK no bloqueante. Pruebas
      fuera del sandbox por EPERM de caché Jest conocido; sin infraestructura.
- `git diff --check`: correcto; 220 enlaces locales en diez documentos afectados,
      cero rotos y sin espacios finales, incluidos tres archivos nuevos.

Compatibilidad: HTTP/DTO/URLs/cuerpos/éxitos/errores actuales, incluido PUT animal
primitivo, módulos/SDK operativo/schemas/índices/TTL/recuperación conservados.
Código nuevo sin integración o consultas al arranque/CRUD. Dos dependencias
existentes ahora declaradas directas con versión exacta. No cambia medicina/IA,
clínica/códigos/acceptedAt/48 h/nameHistory (nombres), guarda inicial/V1 o decisiones
funcionales pendientes. coverage INCOMPLETE/remoteEffects NOT_ASSESSED y transferencia
deshabilitada. Sin Mongo/S3/AWS/Docker reales, migraciones/índices ejecutados,
despliegue, commit o push. No prueba SDK futuro, Mongo/failover, TLS/proxies,
retención, corte estable ni commit conjunto. Permiso previo conserva incertidumbre.

Siguiente paso concreto: auditar/cerrar contrato ticket/pin/sellado ante
confirmaciones concurrentes y cambios entre declaración y envío, incluidas rutas
legacy/selladas/fallos inciertos. Implementar/probar guardas con dobles antes de
conectar dispatcher a AnimalMediaUploads/callers. Luego preparar arnés Mongo +
transporte falso; ejecución real requiere autorización específica. Siguen pendientes
otros writers/legacy/BDA, cobertura/aislamiento/retención, autorizador de corte y
commit de negocio, sin recuperar MAY_RUN/legacy por edad/error.

### Subbloque 37: fence del ticket frente a permiso y sellado

2026-10-27, base `ffd7309`, rama `codex/animal-transfer-planning`; árbol limpio,
HEAD/referencia origin coincidentes y últimos cuatro commits comprobados al
retomar. Sin fetch, descarte o commits del agente. Contrato registrado antes del
código en [animal-media-promotion-ticket-fence.md](./animal-media-promotion-ticket-fence.md).

Trabajo terminado:

- [x] Auditado el pin/seal vigente: ambos CAS sobre el mismo ticket, pin/sello
      insert-only. La declaración previa solo leía en snapshot, e intención/
      autorización no tocaban ticket. Esa lectura no compite con seal posterior.
- [x] mediaPromotionRevision opcional en AnimalMediaUpload/schema, sin default,
      backfill, índice o TTL. Ausencia distinta de cero; contador inválido/agotado
      falla cerrado. No entra en definición/hash ni se expone en DTO o URLs.
- [x] DECLARE_EFFECT/INTEND_ATTEMPT/AUTHORIZE_ATTEMPT releen ticket ordinario
      fijado y no sellado, reconstruyen definición/hash completos y escriben CAS
      sobre ese documento en MISMA transacción que journal/control/puerta/filas.
      Cambio de pin/identidad/contenido/sello o coincidencia cero revierte todo;
      no se refija definición ni se adopta legacy/generaciones.
- [x] Seal ganador invalida autorización con snapshot antiguo; autorización
      ganadora conserva permiso incluso si seal confirma antes del envío. No se
      prohíbe seal, reserva propiedad exclusiva o inventa rollback remoto.
      Revocación/evidencia tardía siguen permitidas sin exigir ticket no sellado.
- [x] 39 pruebas nuevas del adaptador con store optimista simulado y métodos
      reales de pin/seal. Tres pasos, rollback, mutaciones, contador, ambos órdenes
      de carrera y uso del pin ganador. Cuatro pruebas adicionales del dispatcher
      con SDK/Node handler reales y transporte nativo falso/guarda cero sockets:
      sello antes de intención, antes de permiso, después de commit/reply pausado
      y antes de SDK retry. UNKNOWN/permisos previos conservados.
- [x] Arnés Mongo ampliado con pausas UPLOAD_FENCE/UPLOAD_SEAL y dos carreras;
      snapshot de rollback incluye ticket y monitor exige su update en transacción.
      **28 casos preparados/compilados, ninguno ejecutado en este bloque.** Dos
      clientes, allowlists y namespace propio por caso conservados. Los 26 casos
      aprobados del 33 corresponden al código anterior a este cambio.
- [x] Impacto funcional central actualizado en guía frontend: contrato anterior/
      nuevo, ajustes, integración/errores, compatibilidad y riesgos. Mapa,
      estrategia, aislamiento, modelo, persistencia, dispatcher, arnés y auditoría
      distinguen soporte implementado del objetivo aprobado y pendientes.

Validación exacta:

- Focalizada de fence/persistencia/dispatcher: **3 suites/144 pruebas aprobadas**,
      **5.75 s**, antes de añadir las cuatro pruebas finales del dispatcher.
- `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
      **96 suites/1533 pruebas aprobadas**, **42.68 s**, frente a 95/1490: 43
      casos nuevos incluidos. Jest fuera del sandbox por EPERM de caché conocido;
      sin conexiones reales. Ocho suites globales heredadas siguen como deuda
      separada; no afirmar suite global verde. Aviso heredado Node20/AWS no bloqueante.
- `npm run build`: correcto.
- `npm run test:integration:media-promotion:check`: correcto; compila todos los
      arneses, sin ejecutar casos o conectar Mongo.
- ESLint de ocho TypeScript nuevos/modificados correcto. Prettier aplicado solo
      a esos archivos. Sin instalación/actualización de paquetes.
- `git diff --check`: correcto; 244 enlaces locales comprobados en once
      documentos afectados, cero rotos y sin espacios finales. Incluye el
      documento nuevo; el TypeScript nuevo también se comprobó por separado.

Compatibilidad: HTTP/DTO/URLs/cuerpos/éxitos/errores actuales, incluido PUT animal
primitivo, conservados. Campo técnico opcional de schema sin migración/índices.
Sin nuevas consultas/condiciones en pin/seal operativo, módulos/callers actuales
o cambios de SDK/dependencias. No se modifica medicina/IA, nameHistory (nombres),
guarda inicial/V1 o recuperación previa al permiso; sin períodos CLOSED fabricados.
Objetivo histórico exacto/copia independiente y decisiones de negocio pendientes
intactos. coverage INCOMPLETE/remoteEffects NOT_ASSESSED y transferencia completa
deshabilitada. Sin operaciones Mongo/S3/AWS/Docker reales, despliegue, commit o push.

Límites: pruebas con dobles no acreditan esta carrera en Mongo/failover. El fence
protege metadata local/permisos nuevos; no cierra copias remotas previas ni evita
delete/recreate o múltiples efectos de journals distintos sobre un ticket. No
serializa todo el callback, no acredita ACK/MATCH ni autoriza corte estable.

Siguiente paso concreto: completar arnés opt-in Mongo + dispatcher con transporte
falso, para permiso/sellado/retries/fallos de evidencia sin AWS. Su ejecución
requiere autorización específica del entorno y nuevo registro de versiones,
topología/puerto/resultados/limpieza; no reutilizar la autorización del 33. Cerrar
verificación del resultado/sellado y mapeo HTTP antes de conectar callers. Otros
escritores/legacy/BDA, retención/aislamiento/cobertura remota, autorizador de corte,
commit de negocio, OTP, solicitudes, notificaciones e histórico final pendientes.

### Subbloque 38: arnés opt-in Mongo + dispatcher/transporte falso

2026-10-27, base `13a2146`, rama `codex/animal-transfer-planning`, árbol limpio y
HEAD/referencia origin coincidentes al retomar; últimos cinco commits comprobados.
Sin fetch/descarte. Contrato registrado antes del código en
[animal-media-promotion-dispatch-mongo-integration.md](./animal-media-promotion-dispatch-mongo-integration.md).

Trabajo terminado:

- [x] Nuevo comando `npm run test:integration:media-promotion-dispatch` y su
      `:check`, config/globalSetup propios; opt-in exclusivamente por
      MEDIA_PROMOTION_DISPATCH_MONGO_TESTS=1 y MEDIA_PROMOTION_DISPATCH_MONGO_TEST_URI.
      Parser loopback estricto existente, sin fallback a variables de aplicación/
      arneses anteriores. El check solo compila TODOS los arneses.
- [x] Fixture hereda siembra desde create NOT_STARTED con marca inicial,
      adquisición/permiso, dos clientes, monitor, índices, barreras y limpieza
      existentes. Namespace aleatorio propio animalrecord_dispatch_test_<UUID>,
      allowlist independiente de cinco colecciones, sin ampliar anteriores.
      No .env/AppModule, infraestructura automática o credenciales reales.
- [x] SDK/dispatcher/NodeHttpHandler reales con credenciales sintéticas fijas;
      https.request falso por guion y streams, http.request rechazado. Socket.connect
      solo reenvía al método original con receptor intacto para loopback/puerto
      Mongo seleccionado; admite forma normalizada Node y rechaza sockets Unix,
      hosts/puertos distintos. No reemplaza send/handle o transacciones Mongo.
      Solo conserva método/path/source, sin firmas o Authorization.
- [x] **21 escenarios combinados preparados y compilados, NO ejecutados contra
      Mongo**: foto/diario y permiso durable previo a petición nativa falsa;
      transacción journal/control/ticket/filas; SDK retry/redirect/agotamiento;
      sello ganador frente a snapshot antiguo; sello/revocación/cierre entre
      intención/permiso; permiso reconocido/reply pausado que aún envía después;
      pérdida de ack de intención/permiso/respuesta tras commit reconocido;
      rollback de respuesta por CAS cero, retry bloqueado, dos dispatchers/clientes
      y CAS tardío de evidencia. Recuento AST de tablas literales, sin cargar suite.
- [x] Drenaje libera pausas, espera sends observados y destruye dispatchers antes
      de limpieza. Guardas de transporte conservadas hasta cerrar Mongo y restauradas
      en finally. Snapshot/limpieza/allowlists del arnés anterior sin cambios;
      mantiene sus 28 casos preparados. No se adoptan journals/intentados anteriores.
- [x] 57 pruebas nuevas sin conexión de opt-in/URI/propiedad/allowlists/configs,
      rechazo antes de conectar, sockets/HTTP/HTTPS/restauración y SDK real con store
      simulado en éxito/retry/pausa. Namespace impreso por setup fallido es generado,
      no una base creada: createConnection lanza una excepción inyectada.
- [x] Guía frontend central y mapa/estrategia/modelo/persistencia/dispatcher/fence/
      arnés anterior/auditoría actualizados, separando soporte de pruebas del objetivo
      aprobado y pendientes. Entorno futuro concreto propuesto, sin inspección Docker.

Validación exacta:

- Primera compilación señaló tipos de lectura lean de Mongoose; corregidos en
      soporte de prueba. Primera focalizada: 53/56, tres fallos del doble por host
      frente a hostname y pausa/timeout; corregidos destino y manejo de rechazos/
      drenaje. Siguiente focalizada **1 suite/56 pruebas aprobadas, 9.145 s**.
      Después se añadió el caso 57 de receptor/restauración de Socket.connect.
- Primera regresión: **94 suites aprobadas/3 fallidas, 1557 pruebas aprobadas/33
      fallidas, 51.376 s**. Descriptor del delegado sintético quedaba en registro
      de Jest y se reinstalaba al restaurar mocks en suites HTTP. Corregido orden
      de limpieza y añadida aserción de restauración posterior. Focalizada posterior:
      **4 suites/94 pruebas aprobadas, 7.756 s**.
- Regresión FINAL `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
      **97 suites/1590 pruebas aprobadas, 43.465 s**, frente a 96/1533; incluye
      las 57 nuevas. Ocho suites globales heredadas siguen como deuda separada;
      no afirmar suite global verde. Aviso Node20/AWS SDK heredado no bloqueante.
- `npm run build`: correcto. `npm run test:integration:media-promotion-dispatch:check`:
      correcto, repetido tras ajustes finales de fixture. Ningún caso Mongo ejecutado.
- ESLint de seis TypeScript nuevos correcto; primera pasada señaló referencias
      de método/matchers any, corregidas. Prettier solo en esos archivos.
- Cinco comandos `--listTests`: una suite distinta cada uno. Nuevo comando con
      opt-in forzado a 0 rechaza en globalSetup antes de conectar: npm exit 1 esperado,
      cero casos; wrapper de verificación exit 0 y variable restaurada en finally.
      Jest fuera del sandbox por EPERM de caché conocido, sin infraestructura real.
- `git diff --check`: correcto; 257 enlaces locales en once documentos afectados,
      cero rotos/sin espacios finales. Ocho archivos nuevos también comprobados
      por separado, sin espacios finales o marcadores de conflicto.

Compatibilidad: solo soporte de pruebas/config/scripts; sin cambios en src,
dependencias, módulos/schemas/índices productivos, consultas o latencia HTTP,
DTO/URLs/cuerpos/éxitos/errores vigentes (incluido PUT animal primitivo). Medicina/IA,
nameHistory (nombres), guarda inicial/V1, recuperación previa y decisiones pendientes
intactos. Objetivo histórico exacto/copia independiente sin cambios. Transferencia
deshabilitada; INCOMPLETE/NOT_ASSESSED. Sin Mongo/S3/AWS/Docker reales, descargas,
migraciones/índices ejecutados, despliegue, commit o push.

Límites: 57 guardas con dobles no son los 21 casos Mongo nuevos ni los 28 anteriores.
La aplicación que pierde respuesta después de commit reconocido no reproduce red
rota o UnknownTransactionCommitResult. HTTP falso no acredita copia, ACK/MATCH,
sellado verificado, fin remoto, retención/corte estable o commit de negocio.

Siguiente paso concreto: revisar/autorizar el entorno propuesto en el documento
del bloque: Docker Linux LOCAL, imagen Mongo 8.0.34 por digest en caché, contenedor
nuevo animalrecord-dispatch-mongo-test-13a2146, tmpfs/--rm y 127.0.0.1:27018,
replica set animalrecord_dispatch_test de un miembro. Autorización específica para
inspección local, crear/inicializar, ejecutar 28+21 casos en comandos separados,
verificar cada namespace exacto y retirar SU contenedor. No reutilizar permiso del
33, conectar Atlas/27017 existente o descargar si falta imagen. Revalidar Git,
disponibilidad/topología/versiones/puerto, resultados por intento y limpieza antes
de afirmar validación real. Después cerrar verificación/sellado y mapeo HTTP antes
de callers. Otros escritores/legacy/BDA, retención/cobertura/corte estable, commit
conjunto, OTP, solicitudes, notificaciones e histórico final siguen pendientes.

### Subbloque 39: validación local autorizada de 28+21 casos

Inicio 2026-10-27 y cierre 2026-10-28 (America/Bogota), base `5245ce7`, rama
codex/animal-transfer-planning. Árbol inicialmente limpio, HEAD/referencia origin
coincidentes y últimos cinco commits comprobados, sin fetch/descarte. El usuario
autorizó específicamente el entorno/operaciones propuestos en el 38; no se dedujo
infraestructura real de «continúa». Registro iniciado antes de crear el contenedor:
[animal-media-promotion-dispatch-mongo-validation.md](./animal-media-promotion-dispatch-mongo-validation.md).

Trabajo terminado:

- [x] Inspección de contexto Docker efectivo/local y ausencia de overrides,
      nombre/puerto disponibles e imagen exacta en caché, sin descarga. Docker
      Desktop 4.44.3, cliente/Engine 28.3.2; consultas Docker/CIM iniciales denegadas
      por sandbox, repetidas con escalación. No se inició Docker Desktop ni se
      contactó Atlas o el Mongo existente de 127.0.0.1:27017 (PID 6252).
- [x] Creado solo animalrecord-dispatch-mongo-test-13a2146, ID completo
      93252bbc53d1961dcb91a20f5267eb1c5ed982dd0303c4b2f827bf44e774f16b,
      por digest mongo@sha256:4a4ab5d4834207389e0d7270fac988e21ffedccecba77991a552f755df229907,
      --pull never, tmpfs /data/db=1 GiB y /data/configdb=32 MiB, sin binds/volúmenes,
      AutoRemove, 1 GiB RAM y 1 CPU. Labels owner/base/revision comprobados y
      publicación exclusiva 127.0.0.1:27018→27017. Nombre/base corresponden a
      propuesta 13a2146, revision=5245ce7 identifica código efectivamente probado.
- [x] Inicializado únicamente SU replica set animalrecord_dispatch_test, un
      miembro primary anunciado 127.0.0.1:27017 dentro del contenedor. Mongo
      8.0.34, FCV 8.0, sesiones y topología verificados por comandos internos.
      URI de pruebas sin credenciales/base, directConnection=true. Variables
      propias de cada arnés activadas solo para su comando y restauradas en finally.
- [x] **28/28 persistencia y 21/21 dispatcher aprobados en la primera pasada**,
      sin cambios de código/tests, reejecuciones de suite o guardas relajadas.
      Dos clientes independientes por caso. Ambas carreras permiso/sello del 37,
      snapshot obsoleto, transacción journal/control/ticket/filas, retries/redirect,
      ack perdido después de commit reconocido, evidencia tardía y dos dispatchers
      comprobados. SDK/Node handler reales con HTTP falso; sin S3/AWS real.
- [x] 49 namespaces aleatorios exactos capturados. AfterEach de cada caso sin
      error; consulta independiente comparó los 28 nombres antes del segundo
      arnés y los 49 al final: todos ausentes, solo admin/config/local. Listas
      exactas por caso conservadas en el registro; ningún drop por prefijo/manual.
- [x] Identidad/imagen/labels/aislamiento del contenedor propio revalidados antes
      de detenerlo por ID completo. Retirado por AutoRemove, ID ausente y 27018
      libre comprobados el 2026-10-28T00:03:32.3566049-05:00. Listener 27017 permanece
      en PID 6252. Docker Desktop, imagen y demás servicios preexistentes conservados.
- [x] Guía frontend central, mapa/estrategia/modelo/persistencia/dispatcher/fence/
      arneses/procedimiento/auditoría actualizados, separando validación ejecutada,
      objetivo aprobado y funcionalidad pendiente. Solo documentación versionada
      modificada; logs/reportes JSON locales ignorados en node_modules/.cache.

Validación exacta:

- `npm run test:integration:media-promotion -- --json --outputFile=...`:
      **1 suite/28 pruebas aprobadas, 15.29 s, npm exit 0**. Inicio UTC
      2026-10-28T04:53:29.465Z. Incluye índices reales/sin TTL y los dos casos
      permiso/sellado añadidos en el 37; no son solo los 26 históricos del 33.
- `npm run test:integration:media-promotion-dispatch -- --json --outputFile=...`:
      **1 suite/21 pruebas aprobadas, 14.38 s, npm exit 0**. Inicio UTC
      2026-10-28T05:00:29.004Z. Transporte S3 falso con sockets solo al Mongo local.
- Consulta final de los 49 nombres exactos: **remaining=[]**, únicamente
      admin/config/local, 2026-10-28T05:01:53.727Z. Limpieza verificada antes de
      retirar contenedor; ausencia posterior del contenedor/puerto comprobada.
- `npm run test:integration:media-promotion-dispatch:check`: correcto antes de
      conexión; compila todos los arneses. Node/npm 20.18.0/11.0.0, Mongoose/driver
      8.21.0/6.20.0, Jest/ts-jest/TypeScript 29.7.0/29.4.6/5.9.3; versiones SDK y
      detalles de aislamiento registrados. Una consulta de versión intentó ruta
      anidada de driver ausente; resuelta desde Mongoose sin instalación/cambio.
- Build, ESLint y regresión de negocio no repetidos porque solo cambia
      documentación. Las **97 suites/1590 pruebas del 38** mantienen su fecha y
      alcance; ocho suites globales heredadas siguen como deuda separada. No se
      afirma suite global verde ni se suman esos casos con los 49 para inventarla.
- `git diff --check`: correcto; 276 enlaces locales en trece documentos afectados,
      cero rotos/sin espacios finales, incluido el registro nuevo. Los 49 nombres
      documentados contrastados automáticamente con ambos logs, sin diferencias.

Compatibilidad: sin cambios en src/test/package.json, dependencias, módulos,
schemas/índices de aplicación, HTTP/DTO/URLs/cuerpos/éxitos/errores (incluido PUT
animal primitivo). Índices/filas creados y borrados únicamente en namespaces del
ensayo autorizado; no migraciones de aplicación. Medicina/IA, nameHistory
(nombres), guarda inicial/V1, recuperación previa y decisiones pendientes intactos.
Objetivo histórico exacto/copia independiente sin cambios. Transferencia completa
deshabilitada e INCOMPLETE/NOT_ASSESSED. Sin S3/AWS real, Atlas, despliegue, commit
o push. La autorización utilizada no habilita otro entorno/ensayo o limpieza general.

Límites: un nodo y dos clientes del mismo proceso no prueban failover/multinodo,
red real S3, autenticidad/retención de bytes, delete/recreate, fin remoto o corte.
Pins/ETags/hash/sellos/recibos sintéticos; HTTP 200 del doble no produce ACK/MATCH
automático ni permite sellar/transferir. Un permiso anterior conserva incertidumbre
tras revocación/sellado, sin recuperarlo por edad/lease/error/HEAD/token ausente.
Pérdida de respuesta después de commit reconocido no reproduce fallo de red o
UnknownTransactionCommitResult. Consumo de evidencia y negocio aún deben compartir
transacción en el futuro caller; el ensayo no implementa ese commit.

Siguiente paso concreto: contrato/colaborador aislado de verificación del resultado
y sellado ligado a definición/ticket/observación, pruebas de bytes/revisión,
cambios concurrentes y fallos de evidencia; documentar mapeo de errores antes de
conectar callers. No confundir un final observado con cierre de todos los intentos.
Otros escritores/legacy/BDA, aislamiento/retención/cobertura global, autorizador
de corte y commit conjunto, OTP específico, solicitudes, notificaciones e histórico
final siguen pendientes. Nueva ejecución real requiere autorización específica.

### Subbloque 40: verificación y sellado por efecto, sin integración operativa

2026-10-28, base `bcac363`, rama codex/animal-transfer-planning. Git inicialmente
limpio, HEAD/referencia origin coincidentes y cinco commits comprobados, sin
fetch/descarte. Contrato registrado antes del código en
[animal-media-promotion-verification.md](./animal-media-promotion-verification.md).

Trabajo terminado:

- [x] MediaPromotionVerifier aislado, sin provider Nest/caller HTTP. Recibe
      selección/scope/efecto y observationId UUID del backend, capturados antes
      de await. Sujeto de puerta/efecto/hash/contador obtenido por lectura snapshot;
      no concede fence/permisos. Query/revisión congeladas ante reader pausado.
- [x] HEAD/GET condicionado por ETag y VersionId observado/HEAD actual: bucket/
      key, MIME, uploadId, digest, revisión y tamaño deben coincidir. Cuenta bytes
      y SHA-256 por stream sin buffering completo; rechaza exceso/truncamiento,
      chunk no binario, cambios después de GET o errores y cierra cuerpo en finally.
      No lee temporal, copia, borra o adopta resultado de dispatcher/HTTP 200.
- [x] Puerto readonly de destino y AwsMediaPromotionDestinationReader, únicamente
      HeadObject/GetObject y cliente aportado por backend, sin .env/credenciales/
      bootstrap propios. GET fija revisión; HEAD 404 es ausencia, demás errores
      no inventan vacío. Solo stream Node y errores externos sanitizados.
      Cliente SDK falso en tests; no prueba transporte físico de estas lecturas.
- [x] MediaPromotionSealingPersistence separado del puerto de dispatch y realizado
      por el adaptador existente. readForSeal solo observa. sealVerified relee
      filas/ticket, compara gateRevision/contador capturados y definición/hash,
      cerca journal/control actuales y persiste MATCH+sealed+contador de ticket+
      revisión de puerta en la MISMA transacción. No S3 en tx ni referencias,
      owner/periodos/eventos de negocio. Sin schema/índice/TTL/default nuevo.
- [x] Contador ausente distinto de cero, corrupción/agotamiento rechazada. Ticket
      ya sellado/cambiado, token retirado, journal cerrado/marca ausente, owner/
      versión/lock o CAS cero no permiten sello parcial. No rebase/retry automático.
      El helper transaccional conserva su rechazo a callback sin resultado; nuevo
      callback devuelve valor interno explícito antes de retornar void al caller.
- [x] MATCH/sello admitidos con puerta previamente REVOKED si journal/claim aún
      actuales: revocar bloquea permisos nuevos, no evidencia técnica. Si puerta
      avanza durante I/O, sujeto queda obsoleto. Un final existente puede verificarse
      sin atribuir causalidad a un intento. Permisos previos/tokens conservados.
- [x] Error interno fijo READ/VERIFY/SEAL y CONFLICT/UNAVAILABLE/UNCERTAIN, sin
      causa/credenciales/payload/status SDK retryable. El caller conserva observationId
      ante error y puede consultar la fila por ID. Commit incierto puede haber
      confirmado MATCH+sello; encontrarlo no autoriza reenvío/traspaso. Observación
      tardía existente por apply sigue disponible aun cuando ya no pueda sellarse.
- [x] Guía frontend central actualizada: contrato anterior/nuevo, ajustes,
      integración/errores, compatibilidad y riesgos. Mapeo HTTP propuesto documentado
      sin publicarlo. Mapa/estrategia/modelo/persistencia/fence/dispatcher/aislamiento/
      arneses/auditoría enlazan límites y siguiente bloque.

Validación exacta:

- Dos suites nuevas: 69 casos de verificador/sellado sobre store optimista simulado
      y 16 del lector con cliente SDK falso. Primera focalizada **69 aprobadas/7
      fallidas de 76**, 7.392 s: callback transaccional nuevo sin retorno explícito,
      helper rechazaba tras commit simulado. Corregido sin relajar guarda. Segunda
      **76/76, 8.259 s**. Ampliación con nueve casos contador/snapshot/inserción:
      **2 suites/85 pruebas aprobadas, 6.572 s**.
- Regresión `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
      **99 suites/1675 pruebas aprobadas, 34.254 s**, frente a 97/1590; incluye
      las 85 nuevas. No incluye/repite los 49 escenarios Mongo reales del 39.
      Ocho suites globales heredadas siguen como deuda separada; no afirmar suite
      global verde. Aviso Node20/AWS SDK heredado no bloqueante.
- npm run build y npm run test:integration:media-promotion-dispatch:check correctos;
      este último compila todos los arneses, sin conectar ni ejecutar integración.
- ESLint de seis TypeScript nuevos/modificados correcto. Primera pasada señaló
      any de mocks, formato y generator async; corregidos con mocks tipados,
      formato y stream async. Prettier solo en esos seis archivos.
      Jest fuera del sandbox por EPERM de caché conocido, con dobles sin red real.
- git diff --check correcto; 293 enlaces locales en trece documentos afectados,
      cero rotos/sin espacios finales. Seis archivos nuevos comprobados también
      por separado, sin espacios finales o marcadores de conflicto.

Compatibilidad: sin nuevos HTTP/DTO/URLs/cuerpos/éxitos/errores públicos, incluido
PUT animal primitivo; sin cambios de dependencias, módulos, schemas/índices/TTL,
pin/promote/verifyFinal/seal o SDK operativos. No hay provider nuevo de sellado,
latencia/queries HTTP adicionales o integración con AnimalMediaUploads/dispatcher.
Medicina/IA, nameHistory (nombres), guarda inicial/V1, recuperación previa y
decisiones pendientes conservados. Objetivo exacto/independiente intacto; sin
transferencia completa, INCOMPLETE/NOT_ASSESSED. Sin Mongo/S3/AWS/Docker reales,
migraciones/índices ejecutados, descargas, despliegue, commit o push en este bloque.

Límites: modelos/cliente SDK simulados no acreditan Mongo real del nuevo método,
SDK/lecturas físicas, autenticidad/retención S3 o fin remoto. Puerto de evidencia
es de confianza, no firma/capacidad pública: JSON MATCH no prueba lectura de bytes.
Último HEAD y seal no impiden cambios posteriores o delete/recreate. Permisos
previos conservan incertidumbre; no se convierten en ACK/cierre/rollback. Los
49 resultados del 39 son anteriores a esta ampliación y no la validan. Ninguna
evidencia previa se consume para autorizar negocio; consumo y escrituras finales
deberán compartir transacción en el caller operativo aún inexistente.

Siguiente paso concreto: preparar extensión opt-in para sealVerified en Mongo y
lector SDK con transporte falso/guardas propias sin ampliar allowlists anteriores.
Incluir rollback de MATCH/sello/fences, snapshot viejo, permisos/sello en ambos
órdenes, revocación/cierre y respuesta perdida. Ejecución real con autorización
específica nueva. Después ciclo completo/wiring/configuración y mapeo HTTP antes
de integrar callers; no sustituir parcialmente confirmaciones vigentes. Otros
escritores/legacy/BDA, retención/cobertura/corte y commit de negocio, OTP específico,
solicitudes, notificaciones e histórico final siguen pendientes.

### Subbloque 41: arnés opt-in de verificación/sellado preparado

2026-10-28, base `17fe684`, rama codex/animal-transfer-planning. Git inicialmente
limpio y cinco commits comprobados; referencia origin LOCAL ahead 1 al retomar,
sin fetch/push ni asumir que la referencia remota estaba actualizada. Contrato
registrado antes del código en
[animal-media-promotion-seal-mongo-integration.md](./animal-media-promotion-seal-mongo-integration.md).

Trabajo terminado:

- [x] Nuevo comando npm run test:integration:media-promotion-seal y su :check,
      config/globalSetup propios, sin solapamiento con cinco comandos anteriores
      ni descubrimiento por npm test. Check compila TODOS los arneses, no ejecuta.
      Requiere MEDIA_PROMOTION_SEAL_MONGO_TESTS=1 y MEDIA_PROMOTION_SEAL_MONGO_TEST_URI,
      sin fallback a .env/AppModule/URI o opt-in de aplicación/otros arneses.
- [x] Parser loopback estricto existente, namespace aleatorio nuevo
      animalrecord_seal_test_<UUID>, marker/UUID y allowlist propia cerrada de cinco
      colecciones. No amplía allowlists anteriores. Fixture hereda apertura,
      monitor, índices, drenaje y limpieza; dos clientes, sin iniciar servicios.
- [x] Siembra desde create NOT_STARTED con MEDIA_PROMOTION_ROWS_V1 inicial,
      INTENT/adquisición/permiso normales. SHA de 32 bytes sintéticos se fija en
      el primer pin, sin reescribirlo, retag de MAY_RUN o generaciones/períodos
      ficticios. Grants de fixture no acreditan que CopyObject haya sido enviado.
- [x] S3Client/NodeHttpHandler/lector/verificador reales con credenciales/región
      sintéticas y transporte nativo readonly propio. HTTPS solo tras bind único
      de bucket/key ordinario, HEAD/GET y query acotada, GET If-Match. HTTP plano,
      PUT/POST/DELETE, hosts/keys/puertos ajenos denegados. Socket.connect permite
      únicamente Mongo loopback/puerto seleccionado. Reutiliza validador puro de
      sockets, sin cambiar/instanciar transporte PUT anterior. No mock de send o tx.
      Solo registra método/path/IfMatch/VersionId, sin firma/Authorization/cuerpo.
- [x] **23 escenarios preparados/compilados, NO ejecutados contra Mongo**:
      foto/diario y MATCH+sello/fences en la misma tx, SDK retry HEAD/GET readonly,
      412/404, bytes/revisión distintos, contador cambiado durante I/O, rollback por
      CAS/colisión de evidencia, permiso/sello y sello ordinario/verificado en ambos
      órdenes, revocación/cierre/token con GET pausado, ack perdido después de
      commit reconocido, retry posterior bloqueado, puerta ya revocada y final sin
      intentos. Pausas de tx antes de primera escritura para evitar locks retenidos.
- [x] Drenaje libera respuestas/queries pausadas y espera sends observados;
      destruye clientes SDK antes de limpieza/cierre Mongo y restaura guardas al
      final, también ante setup parcial. Faults deliberados de contador/token
      solo en namespace de prueba; no recuperación de aplicación o reglas nuevas.
- [x] 50 pruebas nuevas sin conexión de opt-in/URI/namespace/limpieza/allowlists,
      setup/configs/transporte y SDK+verificador reales sobre store simulado:
      éxito/retries HEAD/GET/pausa/bytes incorrectos. Nombres impresos por fallo de
      setup son generados: createConnection lanza excepción inyectada, sin base real.
- [x] Guía frontend central y mapa/estrategia/modelo/persistencia/fence/verificador/
      arneses/auditoría actualizados. Entorno concreto propuesto para validar 23
      nuevos + 49 de regresión, todavía sin autorización/inspección o ejecución real.

Validación exacta:

- Focalizada nueva: **1 suite/50 pruebas aprobadas, 18.582 s**, primera ejecución.
      No usa Mongo ni endpoints S3 reales; SDK/Node handler serializan/deserializan
      HEAD/GET contra respuestas nativas falsas y store optimista simulado.
- Regresión `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
      **100 suites/1725 pruebas aprobadas, 41.502 s**, frente a 99/1675. Incluye
      los 50 nuevos, NO los 23 escenarios Mongo preparados. Ocho suites globales
      heredadas siguen como deuda separada; no afirmar suite global verde. Aviso
      Node20/AWS SDK heredado no bloqueante.
- npm run build y npm run test:integration:media-promotion-seal:check correctos.
      Primera compilación detectó seed incompatible con método heredado y unión
      de promesas en la carrera; corregidos como seedSeal/observe<unknown> en
      soporte nuevo. Sin modificar arneses anteriores ni producción.
- ESLint de seis TypeScript nuevos correcto; Prettier solo en esos archivos.
      Sin instalación/actualización de paquetes. Jest fuera del sandbox por EPERM
      de caché conocido; no operaciones Mongo/S3/AWS/Docker reales.
- Nuevo --listTests descubre solo media-promotion-seal.mongo.integration.ts.
      Matriz de seis configuraciones/disjunción comprobada en tests sin conexión;
      comandos anteriores intactos. Nuevo opt-in forzado a 0 rechaza en globalSetup
      antes de conectar, npm exit 1 esperado y wrapper de verificación exit 0;
      variable restaurada en finally. Recuento AST de tablas literales: 23, sin
      importar/ejecutar la suite.
- git diff --check correcto; 299 enlaces locales en doce documentos afectados,
      cero rotos/sin espacios finales. Ocho archivos nuevos comprobados por separado,
      sin espacios finales o marcadores de conflicto.

Compatibilidad: solo tests/scripts/documentación. Sin cambios en src/dependencias,
módulos/schemas/índices/TTL de aplicación, queries/latencia HTTP, DTO/URLs/cuerpos/
éxitos/errores, incluido PUT animal primitivo. No callers, activación de referencias
o wiring nuevo. Objetivo exacto/independiente, nameHistory (nombres), guarda inicial/
V1, recuperación previa y reglas pendientes conservados. Transferencia deshabilitada,
INCOMPLETE/NOT_ASSESSED. Sin infraestructura real, migración, despliegue, commit o push.

Límites: las 50 guardas/SDK con transporte falso no son ejecución de los 23 casos
Mongo ni prueba de autenticidad/retención/fin remoto. MATCH, sello o HEAD no cierran
permisos previos. Fallo de aplicación DESPUÉS del commit reconocido no reproduce
red rota o UnknownTransactionCommitResult. Los 49 resultados reales del 39 son
anteriores al método de sellado del 40 y no validan este nuevo arnés.

Siguiente paso concreto: revisar/autorizar el entorno propuesto en el documento,
Docker Desktop Linux LOCAL, imagen Mongo 8.0.34 por digest de caché, contenedor
nuevo animalrecord-seal-mongo-test-17fe684, replica set animalrecord_seal_test de
un miembro en 127.0.0.1:27018, tmpfs/--rm/sin binds. Alcance de inspección local,
crear/inicializar, consultar versiones/topología, ejecutar 23+28+21 casos en tres
comandos y verificar/borrar SUS nombres exactos antes de retirar SU contenedor.
No reutilizar permiso del 39, contactar Atlas/27017 existente o descargar imagen.
Si cambia aislamiento/disponibilidad, detener y presentar diferencia. Registrar
resultados por intento/versiones/puerto/topología/limpieza. Después ciclo completo/
wiring/configuración/mapeo HTTP antes de callers; otros writers/legacy/BDA,
retención/cobertura/corte, commit de negocio, OTP, solicitudes, notificaciones e
histórico final siguen pendientes.

### Subbloque 42: validación local autorizada de verificación y sellado

2026-10-28 America/Bogota (2026-10-29 UTC), base `9f56736`, rama esperada y
referencia origin local coincidentes, sin fetch. Se preservaron cambios previos
de política documental en AGENTS.md y este plan. Autorización específica del
ensayo 23+28+21 y adicional para iniciar Docker Desktop cerrado.

- Primera pasada: sellado **23/23, 11.617 s**; persistencia **28/28, 13.103 s**;
  dispatcher **21/21, 10.377 s**. Sin arreglos de código/tests ni repetición.
- Mongo 8.0.34/FCV 8.0, replica set local de un miembro, 127.0.0.1:27018,
  imagen de caché por digest y tmpfs. SDK real con transporte S3 falso.
  Versiones, tiempos y limpieza por namespace en el
  [registro técnico existente](./animal-media-promotion-seal-mongo-integration.md).
- 72 nombres exactos verificados ausentes por consulta independiente; solo
  admin/config/local. Contenedor propio eliminado, 27018 libre y 27017 conserva
  PID 6068. Compilación de todos los arneses correcta; build/lint/regresión del
  41 no repetidos al no cambiar código. Ocho suites globales heredadas pendientes.
- Cierre documental: git diff --check correcto; 65 enlaces locales comprobados,
  cero rotos. Los 72 nombres del registro coinciden exactamente con los tres logs.

Compatibilidad: sin cambios en src/test/package, dependencias o contratos HTTP;
PUT animal primitivo y guía frontend siguen vigentes. No Atlas/S3/AWS reales,
migración de aplicación, despliegue, commit o push. No prueba multinodo/failover,
fin remoto, retención o corte estable; permisos previos siguen inciertos,
INCOMPLETE/NOT_ASSESSED y transferencia deshabilitada. Siguiente: contrato/ciclo
completo/configuración/mapeo HTTP antes de callers; no reutilizar este permiso.

### Subbloque 43: ciclo interno de confirmación ordinaria, aislado

2026-10-28 America/Bogota, base `ff29a94`, rama esperada y referencia origin local
coincidentes, árbol inicialmente limpio; sin fetch. Implementado
[MediaPromotionConfirmation](../src/context/animal-media/application/media-promotion-confirmation.ts):
contexto/IDs backend capturados, puerta nueva, declaración desde ticket fijado,
HEAD previo, dispatcher controlado si falta final y verificación/MATCH+sello juntos.
Final existente y SDK 409/412 solo permiten verificación, nunca otra copia;
errores locales de permisos/evidencia y otros errores de envío detienen el ciclo.
Una instancia/un uso, sin adopción de permisos/efectos/MATCH, retry de aplicación,
rollback inferido o éxito fabricado tras commit incierto. IDs originales conservados.
Puerto de factoría/error movido a dominio con reexport compatible del dispatcher.

Validación: **101 suites/1762 pruebas aprobadas, 33.962 s**, comando seleccionado
habitual de animal/interface, animal-transfer, user/interface y medical-document.
Incluye **37 casos nuevos** con adaptador Mongo sobre store simulado y SDK real/
transporte nativo falso: foto/diario, retries físicos, permisos visibles antes
de enviar, final existente, conflictos, respuesta perdida en cada fase, retiro
de claim/revocación durante I/O, mutación de entradas y limpieza. Socket real
denegado; no arneses Mongo ejecutados. Ocho suites globales heredadas pendientes.
Build, compilación de todos los arneses y ESLint de cuatro TypeScript correctos.
Prettier check y git diff --check correctos; siete archivos revisados, 114 enlaces
locales comprobados, cero rotos o marcadores de conflicto/espacios finales.
La primera focalizada encontró uso ES2022 en test/EPERM de caché; luego errores
del helper XML y de expectativa de cleanup (SDK también destruye su handler).
Corregidos los tests, sin relajar protocolo; pasada focalizada intermedia 77/77.
La primera regresión fue 1759/1762 por cleanup; la final indicada pasó completa.

Compatibilidad: sin provider/import Nest, callers, DTO/HTTP/errores/latencia nuevos,
incluido PUT animal primitivo; guía frontend vigente, sin ajustes necesarios.
Sin schemas/índices/TTL/dependencias nuevos, infraestructura real, migración,
commit/push o despliegue. Límite técnico de efectos 5 GiB conservado incluso con
final existente; tickets sellados/legacy/fallback permanecen fuera del ciclo.
Objetivo exacto/independiente, guarda inicial/V1, recuperación previa y decisiones
de negocio intactos; transferencia deshabilitada e INCOMPLETE/NOT_ASSESSED.

Siguiente: factoría/configuración controladas y mapeo HTTP antes de conectar ambos
callers conjuntamente; revisar requisito operativo de índices sin instalarlos.
Prueba Mongo del ciclo nuevo requiere arnés y autorización específicos. Retención,
otros escritores, corte estable, commit de negocio, OTP/solicitudes/notificaciones
e histórico final continúan pendientes. Contrato durable en
[verificación](./animal-media-promotion-verification.md), dependencias en el mapa.

### Subbloque 44: factoría AWS aislada y errores HTTP del ciclo

2026-10-28 America/Bogota, base `913c52c`, rama/referencia origin local coincidentes,
árbol inicialmente limpio y cinco commits comprobados; sin fetch/descarte.

- [AwsMediaPromotionConfirmation](../src/context/animal-media/infrastructure/aws-media-promotion-confirmation.ts):
  bucket/una región comercial/credenciales backend explícitos y retries positivos,
  por defecto 3. Configuración capturada, sin custom endpoint/agent/handler/plugins
  o redirects. Cliente lector privado por confirmación y dispatcher controlado;
  ambos se liberan al terminar o fallar. Lector con endpoint regional fijo; un
  override ambiental de copia ajeno se rechaza antes de permiso/delegación.
  SDK anota credenciales: entregar copias mutables del snapshot o provider, sin
  mutar la configuración capturada. IDs siguen aportados/conservados por backend.
- [Mapper HTTP](../src/app/animal-media/media-promotion-http-error.ts) conectado al
  filtro: CONFLICT 409, UNCERTAIN 500, UNAVAILABLE en INSPECT/VERIFY 502 y demás
  etapas 500. Mensajes fijos, sin cause/metadata/IDs ni log del error crudo; misma
  envoltura statusCode/message/path/timestamp. Otras ramas del filtro intactas,
  con formato normalizado. Guía frontend actualizada antes de activar callers.
- Revisión de requisito de replica set/transacciones e índices declarados, sin
  instalarlos ni implementar readiness. Persistencia/factoría fuera del grafo
  Nest actual; no cambios en AnimalMediaUploads o callers foto/diario.

Validación: **3 suites/90 pruebas focalizadas, 6.673 s**; regresión seleccionada
`npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`:
**102 suites/1797 pruebas aprobadas, 38.332 s**. Añade 27 casos de configuración/
SDK/ciclo/limpieza y ocho de salida HTTP. Pruebas con adaptador/store simulado,
SDK real/transporte nativo falso y sockets denegados; no Mongo/S3/AWS/Docker reales.
La primera focalizada detectó el snapshot de credenciales congelado entregado
al SDK: corregido copiándolo antes del uso, incluida respuesta del provider.
Se ajustaron tipado/matcher de pruebas sin alterar guardas. Build, compilación
de TODOS los arneses y ESLint de cinco TypeScript correctos. Ocho suites globales
heredadas siguen pendientes; esta regresión no acredita suite global verde.
Prettier y git diff --check correctos; nueve archivos revisados y 156 enlaces
locales comprobados, cero rotos o marcadores de conflicto/espacios finales.

Compatibilidad: éxitos/PUT animal primitivo y flujos existentes conservados;
mapear el nuevo error no activa sus callers. Sin schemas/índices/TTL/dependencias,
migraciones, despliegues, commit o push. Sin nuevo MD; contexto/contrato/impacto
centralizados en plan, verificación, mapa y guía frontend. Objetivo exacto/
independiente, nameHistory, guarda inicial/V1 y recuperación previa intactos.
Transferencia deshabilitada; INCOMPLETE/NOT_ASSESSED y permisos inciertos conservados.

Siguiente: arnés opt-in Mongo del ciclo completo/factoría con transporte falso,
sin ampliar allowlists anteriores o reutilizar el permiso cerrado del 42. Ejecutar
solo con aprobación específica del entorno. Luego requisitos/índices operativos
y conexión conjunta de callers. Otros escritores, retención/corte, commit de
negocio, OTP/solicitudes/notificaciones e histórico final siguen pendientes.

### Subbloque 45: arnés opt-in del ciclo completo preparado

2026-10-28 America/Bogota, base `9de88d2`, rama/referencia origin local coincidentes,
árbol inicialmente limpio y cinco commits comprobados; sin fetch o descarte.

- Comando `npm run test:integration:media-promotion-confirm` y :check propios;
  config/globalSetup, opt-in MEDIA_PROMOTION_CONFIRM_MONGO_TESTS=1 y URI dedicada.
  Sin .env/AppModule o inicio automático. :check compila todos los arneses.
- Namespace animalrecord_confirm_test_<UUID> por caso, marker/allowlist cerrada
  propia de cinco colecciones, dos clientes y parser/monitor/cleanup existentes.
  No se amplían allowlists, configs o transportes anteriores. Primer pin sintético
  correcto y journal opt-in desde create NOT_STARTED, adquisición/permiso normales.
  El fixture NO abre puerta/declara efecto/siembra grants: lo hace la factoría real.
- Transporte nuevo ligado a fuente/destino/revisiones: PUT condicional y HEAD/GET,
  sin otros métodos/keys/hosts. SDK/Node handler/ciclo reales; un segundo cliente
  comprueba permiso nuevo visible antes de cada PUT falso. Sin firmas/credenciales/
  cuerpos registrados. Promesas subyacentes también drenadas ante timeout local;
  cierre SDK antes de cleanup y restauración de guardas después de cerrar Mongo.
- **22 escenarios compilados, NO ejecutados en Mongo**: foto/diario, final existente,
  retries PUT/HEAD/GET, 409/412, envío incierto, bytes inválidos, revocación/token
  durante preflight, revocación/cierre durante GET, pérdida de respuesta después
  de commit reconocido en cinco fases, rollback final y rechazo de replay/journal
  sin marca. No atribuir ACK/fin remoto o rollback a respuesta local/HEAD/MATCH.

Validación: focalizada inicial **1 suite/52 guardas aprobadas, 6.365 s**, sin Mongo;
regresión seleccionada habitual de animal/interface, animal-transfer, user/interface
y medical-document: **103 suites/1849 pruebas aprobadas, 34.482 s**. Incluye las
52 nuevas, no los 22 casos Mongo. Build, compilación de todos los arneses y ESLint/
Prettier de seis TypeScript correctos. Siete configs disjuntas verificadas; nuevo
--listTests descubre exactamente la suite nueva. Recuento AST de tablas: 22,
sin importar/ejecutar suite. Opt-in forzado a 0: rechazo explícito en globalSetup,
npm exit 1 esperado/wrapper exit 0 y variable restaurada; primera comprobación
bloqueada por EPERM de caché, repetida fuera del sandbox. Ocho suites globales
heredadas siguen como deuda separada; no se afirma suite global verde.
git diff --check correcto; diez archivos revisados y 82 enlaces locales comprobados,
cero rotos/conflictos/espacios finales. Scripts anteriores y dependencias idénticos
a HEAD; únicamente se añadieron los dos comandos nuevos.

Compatibilidad: solo tests/scripts/documentación, sin src/dependencias/schemas/
índices de aplicación, HTTP/éxitos/errores/latencia nuevos (incluido PUT primitivo).
No requiere cambios frontend ni nueva sección en su guía; mapa de módulos intacto.
Sin Mongo/S3/AWS/Docker reales, migración, despliegue, commit/push o nuevo MD.
Transferencia deshabilitada e INCOMPLETE/NOT_ASSESSED; guarda inicial/V1 y reglas
de negocio conservadas. Datos/revisiones S3 sintéticos, no fallo real de red Mongo
o UnknownTransactionCommitResult, ni prueba de retención/corte estable.

Siguiente: revisar y autorizar el entorno concreto del
[registro técnico existente](./animal-media-promotion-verification.md): Mongo 8.0.34
de caché por digest, contenedor nuevo animalrecord-confirm-mongo-test-9de88d2,
replica set de un miembro en 127.0.0.1:27018 y tmpfs; 94 casos (22+23+28+21),
cuatro comandos y limpieza exclusiva verificada. Nada de ese entorno se inspeccionó
o arrancó en este bloque; no reutilizar permiso del 42. Después requisitos/índices
operativos y conexión conjunta de callers. Otros escritores/retención/corte,
commit de negocio, OTP/solicitudes/notificaciones e histórico final pendientes.

### Subbloque 46: ensayo local autorizado del ciclo completo y regresión

2026-10-28 America/Bogota / 2026-10-29 UTC. Base `9de88d2`, rama/referencia origin
local coincidentes, sin fetch. Diez cambios del 45 sin commit preservados y probados;
huella de ocho archivos de pruebas/scripts registrada y revalidada al cerrar.

- **94/94 casos aprobados en primera pasada**, cuatro comandos: confirmación
  **22/22, 12.058 s**; sellado **23/23, 8.04 s**; persistencia **28/28, 8.261 s**;
  dispatcher **21/21, 10.411 s**. Sin arreglos de código/tests o repeticiones.
- Mongo 8.0.34/FCV 8.0, replica set de un miembro animalrecord_confirm_test,
  127.0.0.1:27018, imagen de caché por digest/tmpfs/--rm. Docker Desktop ya estaba
  iniciado; contexto/nombre/puerto/versiones/topología e aislamiento comprobados.
  Autorización expresa usada solo en ese entorno. SDK/Node handler reales y S3 falso.
- AfterEach/marker/allowlists completados; consultas independientes comprobaron
  los 22 nombres nuevos y al final los 94 exactos, ninguno presente. Contenedor
  propio eliminado por ID, 27018 libre y Mongo ajeno de 27017 conserva PID 6068.
  Versiones, tiempos, fuente probada e inventario de limpieza en el
  [registro existente](./animal-media-promotion-verification.md).
- Cierre: git diff --check correcto, 83 enlaces locales comprobados/cero rotos;
  inventario de 94 namespaces coincide exactamente con los cuatro logs.

Compatibilidad: solo documentación en el 46, sin src/tests/scripts modificados
respecto del 45. No se repiten build/lint/regresión sin cambios de código; las
103/1849 del 45 y estos 94 Mongo son resultados separados. Ocho suites globales
heredadas siguen pendientes. Sin Atlas/S3/AWS reales, descarga, migración de
aplicación, despliegue, commit o push; sin nuevo MD o ajustes frontend.
Un nodo/HTTP falso no acredita autenticidad S3, failover/red rota, cierre remoto,
retención o corte estable. Permisos inciertos, guarda inicial/V1 y recuperación
previa intactos; INCOMPLETE/NOT_ASSESSED y transferencia deshabilitada.

Siguiente: readiness/requisitos de índices (sin crearlos automáticamente) y
conexión conjunta de callers foto/diario. La autorización del ensayo queda cerrada;
no se reutiliza para ese trabajo. Otros escritores, retención/corte, commit de
negocio, OTP/solicitudes/notificaciones e histórico final continúan pendientes.

### Subbloque 47: requisitos Mongo versionados e inspector de solo lectura

2026-10-28 America/Bogota, base `74a6d00`, rama/referencia origin local coincidentes,
árbol inicialmente limpio y cinco commits revisados; sin fetch o descarte.

- Manifiesto MEDIA_PROMOTION_MONGO_REQUIREMENTS_V1 explícito/inmutable: cuatro
  colecciones/14 índices, contrastados con sus schemas. Evalúa claves/orden,
  unique/partial/sparse/collation/visibilidad y construcción; informa faltantes,
  TTL y unicidad adicional sin revisar. Sin crear, eliminar o remediar índices.
- Inspector sobre Db y nombre esperado suministrados por backend, solo comandos
  de metadata primary/maxTimeMS. Fallo sanitizado sin parcial o catálogo vacío.
  Reporte SATISFIED/BLOCKED de requisitos observados con transactions NOT_PROBED,
  data NOT_ASSESSED y activation DISABLED. Metadata antigua no adquiere fence ni
  autoriza commit/envío. Replica set primary/sesiones observado; mongos no validado.
  No se impone una nueva versión Mongo o regla de negocio para avanzar.
- Sin provider/endpoint/arranque, conexiones, sesiones/tx, datos leídos o escritura
  desde inspector. Ocho escenarios Mongo añadidos al arnés de confirmación: ahora
  30 preparados/compilados, NO ejecutados con esta versión. Sus cambios deliberados
  de índices/colección solo serán fixtures propios de un ensayo futuro autorizado.
  Monitor incluye metadata sin registrar respuestas; allowlists/parser intactos.

Validación: focalizada inicial **1 suite/43 pruebas aprobadas, 5.965 s**; añadido
caso de tipo de colección ausente y guardas de tipado. Regresión seleccionada
habitual de animal/interface, animal-transfer, user/interface y medical-document:
**104 suites/1893 pruebas aprobadas, 34.739 s**, incluye las 44 nuevas, no los
30 escenarios Mongo. Build, compilación de TODOS los arneses y ESLint de cinco
TypeScript correctos. Se corrigió type opcional de catálogo sin asumir collection,
tipado de documentos del driver y writeConcern de creación de índices en fixture
(opción del handle de colección). Ocho suites globales heredadas siguen como deuda;
no se afirma suite global verde. Prettier y git diff --check correctos; ocho archivos
revisados y 130 enlaces locales comprobados, cero rotos/conflictos/espacios finales.

Compatibilidad: ningún caller/HTTP/cuerpo exitoso/latencia cambia, incluido PUT
animal primitivo; guía frontend vigente sin ajustes por este bloque. Schemas,
índices declarados, autoCreate/autoIndex, dependencias y scripts intactos.
Sin Mongo/S3/AWS/Docker reales, migración, despliegue, commit/push o nuevo MD.
NameHistory, objetivo de histórico exacto/copia independiente, guarda inicial/V1
y recuperación previa conservados. Transferencia deshabilitada, INCOMPLETE/
NOT_ASSESSED; reporte no afirma capacidad de transacción, integridad de datos,
retención, cierre remoto, corte estable o despliegue preparado.

Siguiente: revisar/autorizar entorno desechable propuesto para **102 casos**,
Mongo 8.0.34 de caché por digest, contenedor animalrecord-readiness-mongo-test-74a6d00,
replica set animalrecord_readiness_test en 127.0.0.1:27018/tmpfs; índices/colección
alterados solo en SUS namespaces. Ejecución/versiones/resultados/limpieza pendientes.
Después proceso operativo de índices y conexión conjunta foto/diario. La
autorización del 46 está cerrada. Otros escritores, retención/corte, commit de
negocio, OTP/solicitudes/notificaciones e histórico final siguen pendientes.
Contrato y propuesta en [verificación](./animal-media-promotion-verification.md).

### Subbloque 48: validación local autorizada del inspector y regresión

2026-10-28 America/Bogota / 2026-10-29 UTC. HEAD `74a6d00`, rama/referencia origin
local coincidentes, sin fetch. Ocho cambios sin commit del 47 preservados/probados;
huella de sus cinco archivos de código/tests capturada y revalidada al cerrar.

- **102/102 aprobados en primera pasada**: ciclo/inspector **30/30, 17.573 s**;
  sellado **23/23, 9.764 s**; persistencia **28/28, 11.746 s**; dispatcher
  **21/21, 10.441 s**. Sin arreglos, repeticiones o relajación de guardas.
- Mongo 8.0.34/FCV 8.0, replica set de un miembro animalrecord_readiness_test,
  contexto Docker local, 127.0.0.1:27018, imagen de caché por digest/tmpfs/--rm.
  Desktop ya iniciado; identidad/puerto/versiones/topología/aislamiento comprobados.
  Cambios de índices/una colección hechos solo por fixtures propios autorizados;
  el inspector consultó metadata sin reparar/escribir ni adquirir fence.
- Consultas independientes confirmaron los 30 nombres nuevos y los 102 exactos
  al terminar: ninguno presente. Contenedor retirado por ID, 27018 libre y Mongo
  de 27017 conserva PID 6068, sin conectarse a él. Versiones, tiempos, árbol probado
  e inventario por namespace en [registro existente](./animal-media-promotion-verification.md).
- Cierre: git diff --check correcto; 88 enlaces locales comprobados/cero rotos,
  los 102 nombres documentados coinciden con los cuatro logs y la huella del
  código/tests probado sigue idéntica.

Compatibilidad: solo documentación cambia en el 48; código/tests del 47 intactos.
Build/lint/check y regresión 104/1893 anteriores mantienen su alcance, sin repetición
por rutina; estos 102 Mongo son evidencia separada. Ocho suites globales heredadas
siguen pendientes. Sin Atlas/S3/AWS reales, descarga, migración de aplicación,
despliegue, commit/push, nuevo MD o ajustes frontend. Callers/éxitos/PUT primitivo
intactos; transferencia deshabilitada e INCOMPLETE/NOT_ASSESSED.

Un nodo y S3 falso no prueban multinodo/failover, red rota, autenticidad, cierre
remoto/retención/corte estable. SATISFIED sigue siendo metadata observada, no permiso
o transacción probada. La autorización del 48 queda utilizada y cerrada. Siguiente:
proceso operativo versionado de índices/remediación sin ejecución automática y
conexión conjunta foto/diario. Otros escritores, retención/corte, commit de negocio,
OTP/solicitudes/notificaciones e histórico final continúan pendientes.

### Subbloque 49: proceso versionado de adiciones de índices y colecciones

2026-10-28 America/Bogota, base `43f8804`, rama/referencia origin local coincidentes,
árbol inicialmente limpio y cinco commits revisados, sin fetch/descarte.

- [Operador prepare/apply](../src/context/animal-media/application/media-promotion-index-maintenance.ts)
  con plan MEDIA_PROMOTION_INDEX_PLAN_V1: manifiesto/base/bloqueos/acciones ligados
  por digest estable, hora excluida. prepare no escribe; apply exige base/digest
  revisados, un uso por instancia y acciones restantes idénticas tras cada paso.
  Solo añade colecciones/índices faltantes declarados. Opciones incompatibles,
  TTL o unique extra bloquean el plan completo; sin drop/collMod/syncIndexes,
  transformación de datos, borrados de duplicados o cambio de reglas de negocio.
- [Adaptador DDL Mongo](../src/context/animal-media/infrastructure/mongo-media-promotion-index-maintenance.ts)
  con Db aportado/target esperado, mayoría, collation simple y claves/opciones
  reconstruidas desde manifiesto. Sin URI/.env/CLI/provider/arranque. No ejecución
  desde inspector/factoría/callers HTTP. Límite por comando/ack no prueba cancelación.
- DDL sin transacción/rollback, sin retry automático. Error al aplicar conserva
  UNCERTAIN, paso en duda y pasos reconocidos sanitizados. Revisión nueva explícita
  tras error; no convierte consulta posterior en éxito previo. Metadatos releídos
  no adquieren fence: coordinar ventana DBA sin cambios concurrentes. Digest no
  autentica al operador ni identifica un servidor distinto con el mismo nombre
  de base. Guardar plan/recibos corresponde al backend operativo; ledger durable
  y proceso completo de despliegue no implementados. Final observado mantiene
  transactions NOT_PROBED/data NOT_ASSESSED/activation DISABLED.
- Seis escenarios Mongo añadidos al opt-in existente (ahora **36 preparados/
  compilados, NO ejecutados con esta versión**): no cambios, índice faltante,
  colección+índices faltantes, deriva, TTL bloqueante y duplicados sin reparar.
  Fixtures DDL/datos solo en SU namespace si se autoriza futuro ensayo. Allowlist/
  parser/transporte sin ampliar; monitor añade create, sin payloads. No se
  atribuyen los 102 Mongo del 48 al aplicador nuevo.

Validación: focalizada inicial **1 suite/32 pruebas aprobadas, 3.92 s**. Añadidas
dos pruebas de creación concurrente ajena y ack sin catálogo final esperado.
Regresión seleccionada habitual animal/interface, animal-transfer, user/interface,
medical-document: **105 suites/1927 pruebas aprobadas, 37.952 s**, incluye 34
nuevas con metadata/DDL simulados. Build, compilación de TODOS los arneses y ESLint
de cinco TypeScript correctos. Recuento AST 36 sin importar/ejecutar suite.
Ocho suites globales heredadas siguen como deuda; no se afirma suite global verde.
Prettier y git diff --check correctos; ocho archivos revisados y 137 enlaces
locales comprobados, cero rotos/conflictos/espacios finales.

Compatibilidad: callers/HTTP/DTO/latencia/éxitos/errores intactos, incluido PUT
animal primitivo; sin ajustes frontend por este bloque. Schemas/índices declarados,
autoCreate/autoIndex, scripts y dependencias conservados. Sin Mongo/S3/AWS/Docker
reales, migración, despliegue, commit/push o nuevo MD. Objetivo exacto/independiente,
nameHistory, guarda inicial/V1 y recuperación previa intactos. Transferencia
deshabilitada e INCOMPLETE/NOT_ASSESSED; sin cierre remoto/retención/corte de negocio.

Siguiente: autorización específica del entorno propuesto para **108 casos**:
el usuario respondió «Solo dejarlo preparado»; no se autoriza ni ejecuta el ensayo.
Mongo 8.0.34 de caché por digest, contenedor animalrecord-indexes-mongo-test-43f8804,
replica set animalrecord_indexes_test de un miembro en 127.0.0.1:27018/tmpfs.
Crear/quitar índices/una colección y duplicados solo en fixtures propios; registrar
versiones/resultados/limpieza exacta y retirar el contenedor. No se inspeccionó
infraestructura en el 49 ni se reutiliza permiso del 48. Luego integración conjunta
foto/diario con selección operativa explícita; otros escritores, retención/corte,
commit de negocio, OTP/solicitudes/notificaciones e histórico final pendientes.
Contrato, uso y propuesta en [verificación](./animal-media-promotion-verification.md).

### Subbloque 50: enlace opcional compartido al ciclo de confirmación

2026-10-28 America/Bogota, base `0d75b3f`, rama esperada/árbol limpio y commits
comprobados. El ensayo del 49 sigue preparado por decisión del usuario.

- [AnimalMediaUploads](../src/context/animal-media/application/animal-media-uploads.ts)
  admite [puerto opcional](../src/context/animal-media/domain/media-promotion-confirmation-runner.ts)
  implementado por la factoría AWS existente. Ausente conserva promote/seal.
  Presente exige contexto backend para ticket ordinario no sellado, captura antes
  de await, fija fuente y delega al ciclo con IDs nuevos. No vuelve a promote/seal
  tras error. Sin ticket, migrado/legacy y sellado conservan sus guardas y rutas;
  no se atribuye cobertura global. Correlación interna inmutable en error sin causa
  cruda/URLs/IDs públicos, sin ledger durable ni autorización de replay.
- Pruebas de ambos callers: solo actualizan referencias tras éxito; ante fallo
  no mutan ficha/diario ni borran foto anterior. Nest resuelve puerto presente/
  ausente sin módulos externos. Dos recorridos con SDK/handler reales y HTTP
  simulado llegan a MATCH+sello transaccionales en persistencia simulada, conservan
  permisos y MAY_RUN. Revalidada exclusión de correlación privada del error HTTP.

Validación: focalizada **3 suites/99 pruebas, 23.5 s**; primer intento no ejecutó
pruebas por EPERM de caché Jest, repetición fuera del sandbox aprobada. Tras cuatro
pruebas adicionales de callers, regresión seleccionada habitual:
`npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`
**106 suites/1958 pruebas, 53.373 s**, 31 nuevas. Build, compilación de todos los
arneses y ESLint de siete TypeScript correctos. Ocho suites globales heredadas
siguen como deuda separada; no se afirma suite global verde.
Prettier y git diff --check correctos; 181 enlaces locales comprobados, cero rotos.

Compatibilidad/límites: puerto sin provider en módulos actuales, sin flags/env,
dependencias, DDL, índices o arranque nuevos. DTO/éxitos vigentes (incluido PUT
animal primitivo) intactos; comportamiento al seleccionar y ajustes de retries
centralizados en [guía frontend](./frontend-animal-transfer-foundations.md).
Sin Mongo/S3/AWS/Docker reales, migraciones, despliegue o commit/push; no se usó
ninguna autorización previa. Ensayo de 108 casos continúa SIN autorización.
INCOMPLETE/NOT_ASSESSED, guarda inicial/V1, nameHistory y recuperación previa
intactos; no prueba retención, fin remoto, rollback, corte estable o commit de negocio.
Siguiente: preparar ensamblado/selección verificables sin activar provider real;
validar aplicador con autorización específica antes de la integración operativa.

### Subbloque 51: selección y ensamblado explícitos, sin activación

2026-10-28 America/Bogota, base `c8293dd`, árbol limpio y rama/commits comprobados.

- [Helper de provider](../src/app/animal-media/media-promotion-confirmation.provider.ts)
  con selección backend cerrada CURRENT/PROMOTION_ROWS_V1, sin modo implícito/env.
  CURRENT no depende de Mongo/configuración. El otro modo captura configuración
  y exige binding aportado; un fallo aborta la preparación, sin fallback.
- [Ensamblado](../src/context/animal-media/infrastructure/prepare-media-promotion-confirmation.ts)
  con cuatro modelos/conexión existentes; comprueba estado/Db/nombre/cliente y
  colecciones Mongoose/nativas, inspecciona requisitos y revalida tras await/antes
  de cada confirmación. Usa los mismos modelos para la persistencia del ciclo.
  No abre/init conexiones/modelos, DDL/DML/sesiones o clientes S3 al preparar.
  No resuelve credenciales anticipadamente. Error interno sanitizado de arranque;
  deriva posterior INPUT/UNAVAILABLE. Inspección NO es fence del catálogo, prueba
  de datos/transacciones/servidor autenticado o permiso de envío; no reconsulta
  índices por llamada. Cambios de esquema requieren coordinación operativa.

Validación final: regresión seleccionada habitual animal/interface, animal-transfer,
user/interface y medical-document, **107 suites/2002 pruebas aprobadas, 37.545 s**,
incluidas 44 nuevas. Nest aislado, metadata/persistencia simuladas y sockets
prohibidos: configuración/target erróneos, deriva durante/después de inspección,
handles de otra base/colección, contexto/configuración capturados y journal sin
marca rechazado aun con metadata satisfactoria. Primera regresión 107/1997 pasó;
cinco casos/refuerzo del handle nativo motivaron la repetición final. Build,
compilación de todos los arneses y ESLint de tres TypeScript correctos. Ocho suites
globales heredadas siguen como deuda; no se afirma suite global verde.
Prettier/git diff --check correctos; 150 enlaces locales comprobados, cero rotos.

Compatibilidad/límites: helper fuera del grafo activo, sin import/registro en
AnimalMediaModule/AppModule, sin flags/dependencias/índices/arranque nuevos. DTO,
éxitos/errores/latencia activos intactos, incluido PUT animal primitivo; no requiere
ajustes frontend adicionales al contrato del 50. Sin Mongo/S3/AWS/Docker reales,
migraciones, despliegue, commit/push o nuevos MD. Los 108 casos del 49 continúan
preparados y NO autorizados; 102 del 48 son históricos. INCOMPLETE/NOT_ASSESSED,
guarda inicial/V1, nameHistory y recuperación previa intactos. Corte estable,
retención, fin remoto y commit conjunto de negocio siguen pendientes.
Siguiente: extender arnés opt-in al ensamblado sin ejecutarlo, antes de registrar
provider real; cualquier ensayo/activación requiere revisión del entorno y alcance.

### Subbloque 52: arnés del ensamblado/selección preparado sin ejecución Mongo

2026-10-28 America/Bogota, base `904713f`, rama/referencia origin local coincidentes,
árbol limpio y cinco commits comprobados, sin fetch/descarte.

- Doce escenarios del selector Nest + AnimalMediaUploads + ciclo añadidos al
  arnés de confirmación existente: foto/diario, CURRENT, target/modelos/handles
  incorrectos, índice faltante sin reparación/fallback, journal sin marca, deriva
  durante/después de inspección, copia incierta y retry PUT con permisos separados.
  Ahora **48 casos compilados, NO ejecutados contra Mongo**. Dos clientes y namespace
  propio por caso conservados; sin ampliar allowlists/comandos o iniciar AppModule/.env.
  Pausas acotadas, restauración de handles, cierre Nest y drenaje de promesas.
- Observador de fixture valida scope/ticket/IDs separados y captura contexto
  inmutable del backend. Antes de cada PUT exige permiso persistido visible desde
  el otro cliente del efecto/dispatcher capturados, sin reutilizar delegación.
  No modifica producción, concede permisos ni atribuye cierre remoto. CURRENT usa
  puerto antiguo simulado, no prueba su transporte real ni cobertura global.

Validación sin conexión: regresión seleccionada habitual animal/interface,
animal-transfer, user/interface y medical-document: **107 suites/2013 pruebas
aprobadas, 41.593 s**, incluidas 11 guardas nuevas. Los 48 Mongo NO están incluidos.
Build, compilación de todos los arneses y ESLint de tres TypeScript correctos;
Prettier y git diff --check correctos. AST estático contó 48 sin importar suite.
Opt-in forzado a 0: globalSetup rechaza explícitamente antes de conectar, npm exit 1
esperado; repetido fuera del sandbox tras EPERM de caché. Ocho suites globales
heredadas siguen como deuda separada; no se afirma suite global verde.

Compatibilidad/límites: sin cambios HTTP/DTO/éxitos (incluido PUT animal primitivo),
arranque, frontend, schemas/índices de producción o dependencias. Sin Mongo/S3/AWS/
Docker reales, migración, despliegue, commit/push o nuevos MD. No se ejecuta el
aplicador. INCOMPLETE/NOT_ASSESSED, guarda inicial/V1 y nameHistory intactos;
no se aplican referencias/propietario/períodos/eventos ni retención/corte estable.

Siguiente: ensayo conjunto de **120 casos (48+23+28+21)** solo tras autorización
específica posterior. Los 108 anteriores quedaron preparados por decisión del usuario;
la ampliación NO autoriza infraestructura. Propuesta actualizada de contenedor/
topología/operaciones y limpieza en [verificación](./animal-media-promotion-verification.md).
No activar provider real hasta validar aplicador/ensamblado; 102 resultados del 48
siguen siendo históricos. Otros escritores, retención, commit de negocio y flujo
OTP/solicitudes/notificaciones/histórico final siguen pendientes.

### Subbloque 53: OTP de transferencias, bloque funcional HTTP/persistencia/transporte

2026-10-28 America/Bogota, base `433014c`, rama/referencia origin local coincidentes,
árbol inicialmente limpio. Se priorizó funcionalidad independiente del ensayo S3
pendiente, con focalizadas durante implementación y una regresión amplia al cerrar.

- [Servicio](../src/context/animal-transfer/application/transfer-otp.ts) y tres POST
  autenticados de emisión/reenvío/verificación en TransferOtpModule, importado por
  AnimalTransferModule. Scope/destino del perfil; EMAIL/PHONE usan UserCodeSender,
  SMS/SNS y SMTP existentes, con contexto opcional para intención/TTL del mensaje.
  Social no tiene envío OTP efectivo en registro y se rechaza explícitamente;
  pendiente integración, sin fallback o éxito ficticio. No muta verificación,
  códigos de registro/reset, contraseñas o tokens de login.
- Código criptográfico de seis dígitos, bcrypt; prueba aleatoria de 32 bytes,
  solo digest persistido ligado a propósito/actor/desafío. Una fila por usuario
  en animal_transfer_otp (_id string), CAS/revisión/mayoría, intentos reservados
  antes de comparar, fechas y cuotas. Reenvío invalida prueba anterior. Pendiente
  de entrega no verifica; error no autoriza reenvío automático ni prueba rollback.
  Si se pierde respuesta de activación puede existir READY; si se pierde proof
  no se recupera repitiendo verify. Callbacks viejos pueden entregar mensajes
  tardíos, pero no activar una revisión reemplazada; no se atribuye cancelación AWS.
- [Persistencia](../src/context/animal-transfer/infrastructure/persistence/mongo/mongo-transfer-otp.ts):
  expiración también mediante $$NOW en Mongo. Consumo exige sesión activa del mismo
  cliente y actualiza la prueba en ESA sesión; aún falta el caller que cree solicitud
  junto al consumo, con idempotencia y validaciones de negocio. Sin TTL/índices
  adicionales/autoCreate/autoIndex o inicializador. La primera emisión puede crear
  la colección ordinaria por CRUD; _id es su unicidad por actor. No auditoría histórica
  completa de entregas ni límite demostrado de envíos físicos/retries del SDK.
- Política técnica configurable: VERIFICATION_CODE_EXPIRATION_MINUTES vigente
  (default 15), TRANSFER_OTP_PROOF_MINUTES=10, TRANSFER_OTP_MAX_ATTEMPTS=5,
  TRANSFER_OTP_RESEND_SECONDS=60, TRANSFER_OTP_MAX_SENDS=3 y
  TRANSFER_OTP_WINDOW_MINUTES=15. Enteros positivos; cuota global por usuario,
  no se evade cambiando canal. Defaults técnicos, sin definir vencimiento/cancelación
  de solicitudes. Registrar requisitos/privilegios de colección antes de desplegar;
  Atlas/Lightsail no se configuran al publicar la imagen.

Validación final: `npm test -- --runInBand test/animal/interface test/animal-transfer test/user/interface test/medical-document`
**110 suites/2049 pruebas aprobadas, 36.084 s**, incluye 36 nuevas de aplicación,
HTTP/Swagger y adaptadores con persistencia/SMTP/SNS simulados. Carreras de emisión/
verificación/reenvío, cuotas, expiración, contacto/actor ajeno, canales ausentes,
respuesta de activación perdida, propósito/consumo/sesión y compatibilidad de mensaje
de registro cubiertos. Focalizadas previas 3/33, 7.46 s; tres casos posteriores en
la regresión final. Build, ESLint de 14 TS y compilación de todos los arneses correctos.
Prettier y git diff --check correctos; 202 enlaces locales comprobados, cero rotos.
Ocho suites globales heredadas siguen como deuda; no se afirma suite global verde.

Compatibilidad: tres rutas nuevas; contratos/errores/retries centralizados en
[guía frontend](./frontend-animal-transfer-foundations.md). Registro/reset conservan
contratos/mensajes sin contexto y PUT animal conserva éxito primitivo. Retirados
logs de OTP y causas crudas SNS; error HTTP genérico previo se conserva. Sin Mongo,
SMTP/SNS/S3/AWS/Docker reales, migración, despliegue, commit/push o nuevos MD.
Consumo real/transacciones del OTP aún NO validados contra Mongo; 120 casos de
medios siguen preparados y sin autorización, no incluyen OTP. Guarda inicial/V1,
nameHistory, recuperación previa y promoción desactivada intactos.

Siguiente funcional: solicitud pendiente idempotente + consumo OTP transaccional,
antes de aceptación/cambio de propietario. No inventar máximo de animales,
vencimiento/cancelación o ubicación histórica. Social y validación real de entregas/
Mongo pendientes; agrupar prueba real con caller de negocio tras autorización.

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
- [x] Lector interno paginado de journals por animal, incluidos terminales sin
      tokens: subbloque 29. Cobertura incompleta y efectos no evaluados explícitos;
      sin recuperación/cierre S3. Índice recomendado documentado, no creado.
- [x] Contrato y modelo puro de intención/autorización por efecto de promoción
      foto/diario: subbloque 30, revisión/CAS, retries modelados y respuesta perdida;
      sin persistencia/dispatch ni cierre remoto. Contrato durable sigue propuesto.
- [x] Persistencia interna separada y transaccional de puerta/efectos/intentos/
      evidencia con CAS/fences, hidratación y tombstone: subbloque 31. Módulo
      opt-in sin dispatch; índices declarados, solo pruebas simuladas.
- [x] Arnés Mongo OPT-IN dedicado a promoción: subbloque 32, 26 escenarios
      preparados; guardas/compilación/descubrimiento sin conexión aprobados.
- [x] Revisión y procedimiento concreto del ensayo posterior preparados sobre
      `9ca8456`; autorización y ejecución reales pendientes. Ver
      [animal-media-promotion-mongo-runbook.md](./animal-media-promotion-mongo-runbook.md).
- [x] Validación real autorizada de promociones: subbloque 33, 26/26 aprobadas;
      expectativa del test corregida tras primera pasada 25/26. 52 bases de dos
      intentos y contenedor eliminados. Ver animal-media-promotion-mongo-validation.md.
- [x] Enlace de identidad coordinador→callers foto/diario→confirmación: subbloque
      34, opt-in desde create y contexto congelado, sin permiso de envío/dispatch.
- [x] Ensayos SDK de transporte sin red: subbloque 35, 28 casos nuevos y regresión
      94/1451; límites de maxAttempts/metadata/handlers y revocación comprobados.
- [x] Dispatcher interno por efecto: subbloque 36, una invocación/handler propio,
      permiso nuevo por delegación, UNKNOWN y errores locales terminales; 39 casos
      nuevos y regresión 95/1490. Aislado de callers y sin infraestructura real.
- [x] Fence del ticket ante sellado: subbloque 37, CAS en los tres pasos junto
      con journal/control/puerta, 39 casos nuevos + cuatro del dispatcher y
      regresión 96/1533. Arnés Mongo ampliado a 28 casos compilados, no ejecutados.
- [x] Arnés Mongo + dispatcher/transporte falso preparado: subbloque 38, comando/
      opt-in/namespace propios, 21 casos compilados sin ejecución Mongo; 57 guardas
      nuevas sin conexión y regresión 97/1590 aprobada. Los 28 casos anteriores
      conservados. Entorno concreto propuesto pendiente de autorización específica.
- [x] Validación real autorizada de ambos arneses: subbloque 39, 28/28 y 21/21
      aprobados en primera pasada, 49 bases verificadas ausentes y contenedor
      retirado. Sin cambios de código/tests; Mongo de un nodo y transporte S3 falso.
- [x] Verificación/sellado aislados por efecto: subbloque 40, HEAD/GET/HEAD y
      MATCH+sello transaccionales cercados. 85 pruebas nuevas y regresión 99/1675,
      sin infraestructura real/callers. Error interno y mapeo HTTP solo propuesto.
- [x] Arnés opt-in del sellado preparado: subbloque 41, 23 casos compilados sin
      ejecución Mongo, namespace/opt-in/transporte HEAD/GET propios. 50 guardas
      sin conexión y regresión 100/1725 aprobadas; entorno propuesto pendiente.
- [x] Validación local autorizada del sellado: subbloque 42, 23+28+21 casos
      aprobados en primera pasada, 72 namespaces ausentes y contenedor retirado.
- [x] Ciclo interno de confirmación aislado: subbloque 43, 37 casos nuevos y
      regresión 101/1762; no callers, infraestructura real o cambios HTTP.
- [x] Factoría AWS/configuración explícita y mapeo HTTP: subbloque 44, 35 casos
      nuevos y regresión 102/1797, sin conexión de callers o infraestructura real.
- [x] Arnés Mongo opt-in del ciclo completo preparado: subbloque 45, 22 casos
      compilados sin ejecución Mongo, 52 guardas y regresión 103/1849 aprobadas.
- [x] Validación local autorizada del ciclo completo/regresión: subbloque 46,
      94/94 aprobados en primera pasada, 94 namespaces ausentes y contenedor retirado.
- [x] Requisitos Mongo/inspector de solo lectura: subbloque 47, 44 pruebas nuevas
      y regresión 104/1893; ocho escenarios Mongo preparados, sin ejecución real.
- [x] Validación local autorizada del inspector/regresión: subbloque 48, 102/102
      en primera pasada, 102 namespaces ausentes y contenedor retirado.
- [x] Proceso versionado prepare/apply de adiciones: subbloque 49, 34 pruebas
      nuevas y regresión 105/1927; seis escenarios Mongo preparados, sin ejecutar.
- [x] Enlace opcional compartido al ciclo: subbloque 50, 31 pruebas nuevas y
      regresión 106/1958, sin provider real ni infraestructura. Callers probados
      con éxito/error sin fallback ni referencias guardadas tras fallo.
- [x] Selector/ensamblado preparados: subbloque 51, 44 pruebas nuevas y regresión
      107/2002, sin registro/activación del provider real o infraestructura.
- [x] Arnés de ensamblado preparado: subbloque 52, 12 casos Mongo añadidos (48
      compilados sin ejecutar) y 11 guardas nuevas sin conexión; regresión 107/2013.
- [x] OTP específico EMAIL/PHONE: subbloque 53, emisión/reenvío/verificación HTTP,
      persistencia y prueba de propósito único; 36 nuevas y regresión 110/2049.
      Faltan consumo con creación idempotente de solicitud, social y ensayo real.
- [ ] Siguiente: validar 120 casos del aplicador/ensamblado/regresión solo tras
      autorización específica, sin activar provider real antes. Cubrir efectos,
      tickets/BDA, retención y commit conjunto de negocio. No convertir V1 ni
      levantar guarda inicial o fabricar períodos CLOSED para probarlo.
- [ ] Integrar llamador operativo autorizado antes de intervenir; no ampliar
      recuperación a legacy/MAY_RUN/efectos remotos por tiempo/error, pues requieren
      evidencia distinta. Ensayos multinodo/red/S3 siguen pendientes. El impacto
      frontend permanece centralizado.
- [ ] Recuperación verificable de tokens/reservas, pruebas reales, activación
      de referencias y conservación/permisos históricos/limpieza segura antes
      de habilitar aceptación.
- [ ] Siguen pendientes: integrar consumo OTP con solicitud idempotente, cuentas
      sociales, decisiones, notificaciones/outbox/push, migración y prueba integral.

Los endpoints de descubrimiento ya existen; POST de transferencia y aceptación
todavía no existen. No crear solicitudes simuladas en Flutter ni confundir este
checkpoint con el cierre del feature.
