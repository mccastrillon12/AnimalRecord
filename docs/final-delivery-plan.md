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

| Bloque | Trabajo                                                          | Dependencia | Criterio de cierre                                                                                                 | Estado                                                                       |
| ------ | ---------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 0      | Barrido del backend y decisiones de negocio                      | Ninguna     | Historial, OTP, parciales y vencimiento acordados                                                                  | Historial/OTP/parciales confirmados; vencimiento y cancelación pendientes    |
| 1      | Política de acceso y protección de cambios de propietario        | 0           | Lecturas/escrituras por actor autorizadas; CRUD general no transfiere                                              | Completado: propiedad actual; histórico y bloqueos corresponden al bloque 2  |
| 2      | Modelo de periodos/archivos históricos y retención S3            | 0, 1        | Antiguo dueño conserva todo el corte; nuevo dueño recibe copia completa con jerarquía existente; migración probada | En progreso: periodos/control/lock listos; instantánea y copia S3 pendientes |
| 3      | Motivos, seeder y buscador de destinatarios                      | 0, 1        | Catálogo idempotente y búsqueda mínima paginada; preparada para identificación                                     | Completado en backend; sin despliegue ni integración Flutter                 |
| 4      | OTP de transferencia y confirmación idempotente                  | 0, 1, 3     | Prueba de autorización temporal, limitada y consumida una vez                                                      | Pendiente                                                                    |
| 5      | Configuración push nueva, bandeja, dispositivos, outbox y worker | 0, 1        | Backend y Flutter integrados; avisos persistidos aun con push fallido; entrega recuperable                         | Pendiente                                                                    |
| 6      | Solicitudes y aceptación/rechazo por animal                      | 2, 4, 5     | Cambio consistente por animal; copia S3 recuperable; estados parciales                                             | Pendiente                                                                    |
| 7      | Historial/consultas y contrato final Flutter                     | 6           | Actual, histórico y destinatario pendiente separados; campanita/card coherentes                                    | Pendiente                                                                    |
| 8      | Integración y despliegue controlado                              | 7           | Pruebas funcionales, concurrencia, reinicios y regresiones aprobadas                                               | Pendiente                                                                    |

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

Rama: `codex/animal-transfer-planning`. Sin commit, push ni despliegue realizados
por este checkpoint. El feature completo sigue en desarrollo.

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
- [ ] Acceso histórico y coordinación de escrituras ya iniciadas: bloque 2.
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
- [ ] Falta drenar/coordenar escrituras que ya estaban en curso al tomar el lock;
      la aceptación no se habilita hasta cerrar esa carrera con reserva/transacción.
- [ ] Falta persistir la instantánea paginable, manifiesto de archivos, copia S3
      histórica/activa, reintentos y commit de cierre/apertura de periodos.
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

### Contexto persistente y siguiente paso

- [x] Mapa de módulos, invariantes y riesgos en
      [application-map.md](./application-map.md).
- [x] AGENTS.md indica leer mapa/plan/estrategia y registrar avances al retomar.
- [ ] Siguiente subbloque: instantáneas paginables por periodo y manifiesto de
      copia independiente S3, con preparación reanudable y limpieza segura.
      Después, coordinar escrituras ya iniciadas y adaptar borrados/reemplazos/fotos
      para preservar el histórico antes de habilitar la aceptación.
- [ ] Siguen pendientes: autorización OTP específica (reutilizando transporte),
      solicitudes/decisiones, notificaciones/outbox/push, migración y prueba integral.

Los endpoints de descubrimiento ya existen; POST de transferencia y aceptación
todavía no existen. No crear solicitudes simuladas en Flutter ni confundir este
checkpoint con el cierre del feature.
