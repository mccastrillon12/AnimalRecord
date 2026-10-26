# Transferencia de animales: estrategia y análisis

Fecha: 2026-10-25.
Estado: desarrollo iniciado por bloques. El avance verificable se registra en
`final-delivery-plan.md`; el flujo completo aún no está habilitado.

Este documento registra el feature F01 de la última entrega. El seguimiento de
ejecución está en [final-delivery-plan.md](./final-delivery-plan.md).

## 1. Requerimiento recibido

El propietario selecciona uno o varios animales, busca y selecciona un usuario
destinatario y escoge un motivo. Inicialmente se busca por nombre, dejando el
contrato preparado para búsqueda por identificación. Confirma un OTP y ve el
resumen. Al pulsar Finalizar crea la solicitud de transferencia.

El destinatario recibe push, una notificación persistida en la campanita y una
card en el inicio. Puede aceptar todos, algunos o ninguno. La propiedad cambia
individualmente al concretar la aceptación de cada animal, nunca al enviar la
solicitud ni al abrir una notificación. Se notifican los resultados a las partes
correspondientes y se conserva la auditoría.

El propietario anterior consulta información y documentos hasta el traspaso. El
nuevo propietario consulta el pasado y puede incorporar nueva información. Las
nuevas escrituras S3 pertenecen al prefijo del propietario actual. Debe existir
un historial de propietarios.

### Decisiones confirmadas el 2026-10-25

- OTP por el canal registrado que utiliza el registro actual: correo o SMS,
  según corresponda a la cuenta. Su función es confirmar identidad e intención
  del propietario remitente. La pertenencia de cada animal se comprueba además
  en el backend. La solicitud se crea al pulsar Finalizar.
- El antiguo dueño conserva toda la información hasta el traspaso, de forma
  exacta y de solo lectura, incluso ante cambios o borrados futuros.
- El nuevo dueño recibe una copia completa e independiente en su carpeta S3,
  respetando la jerarquía existente. Incluye ficha, documentos médicos, diario,
  fotos, audios y foto de perfil del animal.
- Cuando el destinatario finaliza su respuesta, los animales que no seleccionó
  para aceptar se rechazan. No quedan animales sin decisión de negocio.
- Las escrituras solo se bloquean al confirmar la aceptación del animal y
  mientras se concreta su traspaso; una solicitud pendiente no bloquea cambios.
- No existe preparación previa de Firebase ni push en el frontend. Es un bloque
  nuevo de integración móvil e infraestructura.
- Vencimiento y cancelación están expresamente pendientes de confirmación. No
  asumir 48 horas, 7 días, ausencia de vencimiento ni permiso de cancelación.
- Reutilizar el correo/OTP del registro actual; el usuario confirma que ese
  mecanismo ya funciona. La adaptación autoriza transferencias sin cambiar el
  canal de registro ni exigir definir una nueva política de contacto.
- Solo se transfieren animales activos. Los inactivos se consideran fallecidos
  para este flujo y no son elegibles.
- Si hay análisis o revisión/reemplazo IA pendiente, el dueño debe terminarlo o
  descartarlo antes de concretar la aceptación de la transferencia.
- El buscador devuelve información principal del destinatario, incluida su
  identificación; Flutter solicita la cédula y la contrasta con esa información.
- No existen hoy accesos especiales a animales ajenos para veterinarios u otros
  perfiles; la política de permisos debe permitir extenderlos en el futuro.
- Otro es únicamente una opción del dropdown, sin descripción obligatoria ni
  campo adicional asociado.
- El usuario aclaró que el campo mencionado era `nameHistory`. Se conserva para
  nombres y se implementa un historial de propiedad separado, sin reinterpretar
  los datos actuales.

## 2. Barrido del repositorio

Alcance: backend NestJS/Mongoose, pruebas, documentación, Docker y workflow
versionados en este repositorio. No se inspeccionó Flutter, la base productiva,
las políticas reales del bucket ni una configuración externa de push.

| Área                | Evidencia actual                                                                                                | Uso y cambio necesario                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Animal              | `src/context/animal/domain/animal.ts` y schema Mongo: un `ownerId`, UUID, código, fechas e historial de nombres | Mantener UUID y código. Agregar periodos de propiedad, control de concurrencia y permisos por relación con el animal.            |
| Historial de dueños | Aclarado con el usuario: el campo recordado era `nameHistory`, que guarda nombres                               | Implementar historial de propiedad nuevo y conservar `nameHistory`.                                                              |
| Usuarios            | Hay nombre, identificación, foto y repositorio por identificación; no búsqueda paginada por nombre              | Crear consulta específica y proyección mínima para destinatarios.                                                                |
| Catálogos           | `CatalogsSeeder`, repositorio, schemas y `CatalogsController`                                                   | Extender el patrón con motivos estables y siembra idempotente.                                                                   |
| OTP                 | SNS para SMS, Nodemailer, hash y vencimiento usados para registro                                               | Reutilizar transporte y hash; crear desafíos separados para transferencia. El verificador actual rechaza cuentas ya verificadas. |
| Push/campanita      | No hay módulo, tokens ni bandeja en el backend; el usuario confirma que Flutter tampoco tiene Firebase/push     | Crear backend, configuración del proveedor e integración móvil. SNS actual es SMS.                                               |
| Documentos médicos  | Una copia aceptada por animal, `documentGroupId`, versiones, S3, descarga firmada y reemplazo de 48 h           | Reutilizar extracción/copia/control de versión; adaptar acceso y preservar históricos antes de modificar o borrar objetos.       |
| Diario y adjuntos   | CRUD por animal; rutas S3 construidas con dueño actual; fotos y audio                                           | Incluir en permisos, copia completa e histórico, según regla confirmada.                                                         |
| Infraestructura     | Mongo, S3, API Docker; no worker/outbox persistido identificado                                                 | Agregar ejecución recuperable de tareas y verificar soporte transaccional en el entorno real.                                    |

### Hallazgos que bloquean habilitar transferencias

1. `AnimalController` permite listar/buscar/consultar animales sin filtrar por
   usuario solicitante. La autenticación JWT por sí sola no autoriza acceder a
   cualquier animal.
2. `UpdateAnimalDto` hereda `CreateAnimalDto`, incluido `ownerId`;
   `AnimalUpdater` combina el cuerpo con los datos persistidos. La validación
   explícita de dueño actual solo está en la desactivación. Debe retirarse el
   cambio de dueño del CRUD general y centralizarlo en este feature.
3. El CRUD del diario y las operaciones de foto/adjuntos no reciben de forma
   consistente al usuario solicitante. También hay operaciones por `entryId`
   que necesitan comprobar su relación con el `animalId` de la ruta.
4. Los documentos por ID autorizan usando `document.ownerId`, mientras el listado
   por animal exige propietario actual. Cambiar solo `animal.ownerId` dejaría
   consultas, descargas y escrituras inconsistentes.
5. `UserController` devuelve `toPrimitives()` sin una proyección explícita, y el
   dominio incluye hashes/tokens/códigos. No utilizar esas respuestas para el
   buscador. Corregir la serialización de usuario implicada en este flujo. La
   búsqueda actual por identificación tampoco tiene guard en ese controlador.
6. Reemplazos médicos, borrados y cambio de foto pueden eliminar el archivo
   anterior. Un histórico que apunte a esos objetos necesita retención real.

Estos son hallazgos estáticos del código, no una comprobación de explotación ni
del estado de producción. El usuario confirmó que hoy no existen accesos
especiales sobre animales ajenos. Diseñar un punto de extensión para perfiles
futuros sin otorgarles acceso implícito por un nombre de rol.

## 3. Diseño propuesto

Mantener el monolito modular. Añadir `animal-transfer`, `notification` y una
política compartida de acceso al animal; reutilizar `catalogs`, transportes OTP,
almacenamiento S3 y repositorios existentes.

### Propiedad y visibilidad

- El animal conserva siempre su UUID y su código de negocio.
- `ownerId` expresa dueño actual; `ownershipVersion` protege el cambio de dueño
  y las escrituras concurrentes. El versionado de contenido debe proteger
  también operaciones que cambien información sin cambiar propietario.
- Registrar periodos en `animal_ownership_periods`: animal, propietario,
  `startedAt`, `endedAt`, transferencia origen y archivo histórico asociado.
- El dueño actual lee el expediente completo y escribe; un antiguo dueño solo
  lee su vista histórica autorizada. El destinatario pendiente ve los datos
  mínimos de la solicitud, sin acceso anticipado al expediente completo.
- El acceso del dueño actual incluye los antecedentes y archivos históricos
  retenidos de periodos previos, no solo los documentos activos. Se distinguen
  revisiones históricas de la versión vigente. No se recuperan borrados
  anteriores que nunca fueron retenidos por el sistema.
- Validar permisos en lista, detalle, filtros, grupos documentales, descargas,
  diario, adjuntos, foto, cargas, polling, aceptación, edición y eliminación.
- El backend comunica capacidades (`canEdit`, `canUpload`, `canDelete`,
  `canTransfer`) y modo de vista; Flutter no calcula permisos desde `ownerId`.

### Conservar el pasado sin exponer el futuro

Regla confirmada: al concretar cada traspaso se conserva un archivo de solo
lectura con toda la información visible en ese instante, incluida ficha, diario,
documentos, fotos, audio y foto de perfil. Implementación técnica propuesta:
sus elementos se almacenan en registros paginables, no en un único documento
Mongo que crezca con todo el expediente. Los objetos que utiliza son inmutables
o copias privadas protegidas por referencias del archivo.

Ejemplo A → B en T1 → C en T2:

- A conserva su vista hasta T1, incluso si B cambia nombre, diagnóstico o archivo.
- B conserva su vista hasta T2, que incluye los antecedentes recibidos de A.
- C recibe el expediente vigente, los antecedentes históricos retenidos y crea
  los registros posteriores.

No basta `createdAt <= transferredAt`: el documento puede ser reemplazado,
eliminado, agregado después con una fecha clínica antigua o tener contenido
mutado. El corte corresponde a lo que estaba efectivamente guardado y visible,
no a la fecha escrita por el usuario o por el veterinario.

Los archivos históricos deben sobrevivir a borrados/reemplazos posteriores. El
borrado de una copia activa solo elimina físicamente objetos sin referencias
históricas; las referencias se actualizan de manera consistente. La regla ya
quedó registrada en `medical-document-strategy.md`; falta adaptar
reemplazo/eliminación y documentación técnica durante la implementación.

Los documentos heredados mantienen código, categoría, extracción y fecha de
primera aceptación. El traspaso no es un nuevo análisis ni reinicia las 48 horas.
Las revisiones de archivo deben conservar la procedencia de quien las cargó,
separada de quien tiene acceso actualmente. Las lecturas históricas no ejecutan
diagnósticos, polling ni escrituras como efecto secundario.

### OTP y confirmación final

La app necesita llamadas al backend para enviar y validar el OTP antes de
Finalizar. La solicitud de negocio solo se crea al finalizar.

El usuario confirmó que OTP sirve para confirmar identidad e intención del
propietario actual. Se mantiene el envío de los datos de negocio al Finalizar;
no se establece como requisito previo vincular el código al hash de animales,
destinatario y motivo. Verificar OTP no sustituye la comprobación de propiedad:
el backend valida cada animal al crear la solicitud y al concretar la aceptación.

Después de verificar el código, emitir una prueba temporal de propósito
`ANIMAL_TRANSFER`, ligada al usuario autenticado y al desafío, de un solo uso.
El POST final consume esa prueba y crea la solicitud en la misma transacción.
Un reintento idempotente devuelve la misma solicitud. No emitir un token de
login nuevo ni modificar la verificación de la cuenta por confirmar este OTP.

Reutilizar la selección de canal existente: `authMethod = EMAIL` envía al correo
registrado y `PHONE` al celular registrado mediante los transportes actuales.
Esto es correo/SMS; push para transferencias se implementa por separado. El
usuario ratificó reutilizar la implementación que ya funciona en registro.
La compatibilidad con sus variantes de cuenta se verificará como integración
técnica: el `UserCodeSender` visible solo contiene ramas EMAIL/PHONE. No volver
a plantear al usuario una política de canales ya confirmada; localizar y
reutilizar el flujo efectivo sin inventar un fallback ni simular un envío.

Desafíos separados de registro/reset: generación criptográfica, hash, caducidad,
límite de intentos, enfriamiento de reenvío, límite por usuario/canal y consumo
atómico. Invalidar el código previo al reenviar. No registrar códigos en logs.
No reutilizar el caso de
uso de verificación de cuentas.

La expiración OTP debe seguir la configuración de registro actual
(`VERIFICATION_CODE_EXPIRATION_MINUTES`, valor por defecto actual: 15 minutos).
Propuesta técnica configurable para la prueba de confirmación: 10 minutos,
5 intentos y reenvío desde 60 segundos. El destino se obtiene del perfil; no
se recibe un correo o teléfono alternativo en el cuerpo de la solicitud.

### Solicitud e ítems individuales

`animal_transfers`: remitente, destinatario, motivo y etiqueta histórica,
estado agregado, fechas, versión y clave idempotente. El campo de
vencimiento solo se habilitará cuando se defina la regla pendiente.
`animal_transfer_items`: transferencia, animal, propietario/versión esperados,
estado individual, decisión, fecha efectiva y vínculo al periodo/archivo.

Estados individuales propuestos:

```text
PENDING → PROCESSING → ACCEPTED
PENDING → REJECTED
```

CANCELLED y EXPIRED quedan reservados para el diseño, pendientes de aprobación;
no habilitar sus endpoints ni un vencimiento automático hasta resolverlos.

Un fallo técnico durante PROCESSING conserva un estado recuperable; no se
convierte en rechazo del usuario. El estado agregado refleja pendientes,
aceptados y rechazados; una aceptación parcial no significa que todos cambiaron
de dueño. Al finalizar la respuesta se registra la decisión sobre el conjunto
completo: seleccionados a PROCESSING, no seleccionados a REJECTED. Validar la
selección contra el conjunto persistido; sin selección significa rechazo total.
La decisión sobre el conjunto se registra atómicamente antes de ejecutar copias
por animal; después cada aceptación se concreta en su propia transacción. Un
fallo técnico puede dejar ítems PROCESSING en reintento, no pendientes de decisión.

Cada animal se concreta en su propia transacción, con resultado individual. El
frontend debe poder representar progreso/errores por animal. Una petición
repetida o dos dispositivos no pueden aplicar dos traspasos. Solo un ítem activo
por animal, respaldado por una restricción persistida (por ejemplo una reserva
única por `animalId`), no por un chequeo previo en memoria.

El dueño puede transferir únicamente animales propios y activos. Se excluye
transferirse a sí mismo. Se revalida destinatario, propiedad, estado activo y
versiones al finalizar y al aceptar; desactivar el animal mientras está pendiente
impide aceptarlo. Si se habilitan cancelación/vencimiento, solo actuarían
sobre pendientes, sin revertir animales ya aceptados. Su comportamiento todavía
no está aprobado.

Antes de registrar la respuesta completa del destinatario, comprobar que ningún
animal elegido para aceptar tenga análisis o revisión/reemplazo médico pendiente.
Si existe uno, informar el conflicto y esperar que su propietario lo termine o
descarte; no cancelar el proceso automáticamente. Todavía no se aplican decisiones
parciales ni rechazos de los demás animales al fallar esa validación. La reserva
posterior debe impedir que aparezca un proceso nuevo entre comprobar y copiar.

### Aplicación segura y S3

MongoDB y S3 no comparten transacción. Usar un trabajo persistido por animal:

1. Reclamar el trabajo y reservar el animal con comparación de versión/estado.
   Comprobar cargas/revisiones en curso. La aceptación reserva también frente
   a cancelación y vencimiento para que solo una transición gane.
2. Obtener un corte consistente. Regla confirmada: permitir cambios mientras
   está PENDING y bloquear las escrituras desde que se confirma la aceptación
   y durante PROCESSING. Todas las
   rutas mutadoras, incluso confirmaciones de URLs de carga ya emitidas, deben
   respetar el bloqueo y la versión de propiedad.
3. Preparar el archivo histórico y las copias activas destinadas al nuevo dueño
   con manifiesto, claves deterministas y validación de copias. Trabajar por
   lotes y reanudar después de un reinicio; no mantener una transacción Mongo
   abierta durante copias S3.
4. En una transacción corta: revalidar reserva/versiones, cerrar/abrir periodos,
   cambiar dueño y referencias activas, publicar el archivo histórico, marcar
   ACCEPTED, persistir auditoría/notificaciones y outbox. La fecha efectiva y
   el corte se definen en esa confirmación. Durante la preparación no se anuncia
   un traspaso completado ni se expone el expediente al destinatario.
5. Liberar el bloqueo y distribuir notificaciones. Limpiar solo copias de
   preparación huérfanas; conservar objetos que usa un archivo histórico.

Nuevas escrituras:

```text
users/{currentOwnerId}/animals/{animalId}/...
```

Regla confirmada: copiar toda la información y archivos del animal al prefijo del
nuevo dueño, preservando los subdirectorios existentes, categorías, documentos,
revisiones y diario. No basta cambiar `ownerId` ni conceder acceso al prefijo del
remitente. El archivo histórico del anterior conserva su propia copia/referencias
protegidas; eliminar algo en la copia del nuevo dueño no lo afecta. Cada recurso
copiado debe tener metadatos/referencias coherentes en base de datos. No se clona
la identidad del animal. No se fija una limpieza por tiempo del histórico sin
una regla de retención aprobada; no borrar recursivamente la carpeta del usuario.

No asumir que cambiar el prefijo S3 concede o revoca permisos. Validar cada
descarga en backend y usar objetos privados/URLs firmadas. Diario y foto hoy
guardan URLs directas: auditar privacidad del bucket y adaptar la entrega de
esos medios antes de prometer aislamiento histórico. Las URLs firmadas ya
emitidas siguen siendo válidas hasta vencer; contemplar expiración y caché.

Los `documentGroupId` que involucren animales con dueños distintos necesitan
filtrado de autorizaciones en cada resultado. No devolver automáticamente todo
el grupo ni permitir que un reemplazo pendiente alcance animales ya transferidos.

### Motivos y buscador

| Código estable propuesto | Etiqueta                   |
| ------------------------ | -------------------------- |
| PURCHASE_SALE            | Compra / venta             |
| ADOPTION                 | Adopción                   |
| GIFT_DONATION            | Regalo / donación          |
| PRIMARY_ACCOUNT_CHANGE   | Cambio de cuenta principal |
| OTHER                    | Otro                       |

Catálogo con `id`, `code`, `name`, `sortOrder` e `isActive`. Seeder mediante upsert
por código/índice único, seguro ante rearranques y múltiples instancias, sin borrar
historial. Regla confirmada: OTHER es solo la opción Otro, sin solicitar texto
adicional. Si se utiliza el atributo de presentación `requiresComment`, devolver
false. Guardar código y etiqueta usada en la solicitud para que renombrar el
catálogo no altere el pasado.

Búsqueda autenticada y paginada: contrato `searchBy=NAME|IDENTIFICATION`, `q`,
`limit` y cursor; habilitar NAME inicialmente y rechazar explícitamente modos
aún no habilitados. Normalizar acentos/mayúsculas y escapar expresiones de
búsqueda. No descargar todos los usuarios al móvil. Definir índices según la
búsqueda acordada; identificación futura exacta, no sugerencias de cédulas.
Respuesta explícita con información principal: `id`, `name`,
`identificationType`, `identificationNumber`, `profilePictureUrl` y ubicación
principal cuando exista. El usuario autoriza devolver identificación completa
para que Flutter solicite la cédula y la contraste al seleccionar el destinatario.
La búsqueda inicial continúa siendo por nombre; esto no habilita todavía buscar
por cédula. Utilizar DTO y mapeo con campos permitidos, no `toPrimitives()` completo:
password/hash, PIN, tokens, OTP y datos de recuperación nunca se incluyen. El
contraste en Flutter no sustituye autenticación ni autorización del backend.

### Notificaciones durables y push

Persistir por destinatario `type`, `transferId`, ítems involucrados, título,
texto, fecha, `readAt` y clave única de evento. La campanita y contador salen de
esta colección; la card de inicio sale de transferencias entrantes accionables.
Abrir/marcar leído no acepta animales ni hace desaparecer una acción pendiente.

Persistir el cambio de negocio, evento de auditoría, notificación y outbox en la
misma transacción. Un worker envía push con reintentos, lease, deduplicación y
registro de fallos; una caída del proveedor no pierde la notificación ni revierte
propiedad. No prometer entrega exactamente una vez del push.

Guardar tokens por dispositivo/cuenta, soportar rotación, múltiples teléfonos,
logout y tokens inválidos. El usuario confirmó que no hay Firebase/push preparado.
Propuesta técnica: adaptador FCM para Flutter Android/iOS, con configuración nueva
del proyecto Firebase, credenciales del backend y APNs para iOS, coordinada con
el frontend; esos servicios aún no están configurados ni implementados.
El push transporta IDs mínimos, sin expediente clínico. Al tocarlo, o al abrir
la app normalmente, Flutter vuelve a consultar el backend y muestra el estado
vigente aunque el push sea antiguo o no haya llegado.

Eventos relevantes: solicitud enviada/recibida, decisión por animal,
transferencia completada/parcial, cancelación y vencimiento si se habilitan.
No enviar push por cada etapa técnica de copiado; esas etapas pertenecen a
auditoría/progreso, no a avisos al usuario. Agrupar decisiones de una misma
acción para evitar avisos repetitivos.

## 4. Contratos HTTP preliminares

Motivos y destinatarios están implementados en el primer checkpoint. Las demás
rutas son propuestas, aún no implementadas; cerrar sus ejemplos antes de Flutter.

| Operación                | Ruta propuesta                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------- | ------------------- |
| Motivos                  | GET /catalogs/animal-transfer-reasons                                                     |
| Destinatarios            | GET /animal-transfers/recipients?searchBy=NAME&q=...                                      |
| Solicitar/reenvíar OTP   | POST /animal-transfers/otp-challenges y POST /animal-transfers/otp-challenges/{id}/resend |
| Validar OTP              | POST /animal-transfers/otp-challenges/{id}/verify                                         |
| Finalizar solicitud      | POST /animal-transfers con prueba OTP e Idempotency-Key                                   |
| Entrantes/salientes      | GET /animal-transfers?direction=INCOMING                                                  | OUTGOING&status=... |
| Detalle                  | GET /animal-transfers/{id}                                                                |
| Decidir por animal       | POST /animal-transfers/{id}/decisions con versiones y decisiones explícitas               |
| Cancelar pendientes      | POST /animal-transfers/{id}/cancel, si se aprueba                                         |
| Historial de dueños      | GET /animals/{id}/ownership-history con proyección autorizada                             |
| Consultar archivo propio | GET /animals/{id}/ownership-archives/{archiveId}, con recursos paginados                  |
| Bandeja/contador/leído   | GET /notifications, GET /notifications/unread-count, PATCH /notifications/{id}/read       |
| Dispositivos             | PUT /notification-devices/{installationId}, DELETE /notification-devices/{installationId} |

Todos los endpoints sensibles se autentican y validan actor/recurso. Listas con
paginación. Las decisiones de aceptación pueden responder 202 durante las copias;
el detalle informa avance y estado individual. Flutter no reenvía OTP en claro al
finalizar, no cambia dueños localmente ni espera una entrega push para refrescar.

## 5. Migración y pruebas de aceptación

Migración idempotente para abrir un periodo de propiedad a cada animal existente
con su dueño actual. Usar fecha conocida y marcar procedencia inferida cuando
corresponda; no inventar propietarios anteriores. El usuario aclaró que el campo
recordado era `nameHistory`. Se conserva ese historial de nombres y se crea por
separado el historial de propiedad desde el dueño actual conocido.

Normalizar documentos aceptados antiguos multi-animal antes de transferir; no
extender el acceso a copias de otros animales. Versionar cambios de contratos y
probar los clientes anteriores. Confirmar Mongo con transacciones y despliegue
del worker; no leer ni registrar secretos para documentar esa verificación.

Casos que deben bloquear la salida a producción si fallan:

- Uno, varios, todos aceptados, todos rechazados y selección parcial.
- Dos envíos o decisiones simultáneos, OTP reutilizado/caducado, destinatario o
  selección inválidos al Finalizar, auto-transferencia y búsqueda con homónimos.
- Cancelación/vencimiento contra aceptación, dos dispositivos y cambio de dueño
  concurrente. Un único propietario efectivo y una única reserva por animal.
- Fallo S3 a mitad de copia, caída antes/después del commit, reintento del worker
  y push fallido: ningún expediente parcial ni pérdida del original.
- A → B → C y devolución a un propietario anterior; cada vista histórica queda
  aislada de información posterior.
- Documento médico nuevo, editado, eliminado o fechado retroactivamente después
  del traspaso; archivo histórico y descarga siguen correctos.
- Carga/URL prefirmada, análisis IA o reemplazo médico iniciados antes del cambio
  de propietario: no pueden confirmar después con permisos obsoletos.
- No permitir aceptar con análisis/revisión médica pendiente ni transferir
  animales inactivos; revalidar si se desactivaron después del envío.
- Diario/foto/adjuntos y documentos agrupados con animales de dueños diferentes.
- El código del animal y códigos de documentos heredados no cambian, y la
  ventana médica de 48 h no se reinicia.
- Notificaciones leídas/no leídas, app abierta/cerrada, push duplicado, cuenta
  cambiada en el dispositivo y card pendiente independiente de leído.
- Regresión de registro/login, animales y documentos médicos; buscador nunca
  devuelve credenciales, tokens o datos personales innecesarios.

## 6. Decisiones abiertas

Las siguientes opciones son preguntas de negocio, no reglas aprobadas:

1. Plazo de respuesta y posibilidad de cancelar: pendientes expresos del usuario.
   Definir también qué ocurre con los pendientes al vencer o cancelar.
2. Límite de animales por solicitud: propuesta de configuración, sin cifra
   aprobada. Los límites técnicos deben constar en el contrato antes de release.
3. Si una card basta como resumen de varias transferencias o se muestra una por
   solicitud; ubicación de animales históricos en la app.

Las decisiones ya recibidas están en la sección 1 y en el tablero de entrega.
La estrategia médica ya recoge la conservación/copia y el corte por aceptación;
el avance de implementación y los contratos disponibles constan en el tablero.
Los puntos abiertos
no deben presentarse como funcionalidad acordada.

### Implementación disponible al 2026-10-25

Bloques de permisos de propietario actual y descubrimiento implementados y
probados. El catálogo y el buscador de la tabla HTTP ya existen. El primer
subbloque de propiedad crea el periodo actual separado de `nameHistory`, una
versión interna y un lock atómico; las escrituras existentes devuelven conflicto
cuando el lock está activo, sin cambiar sus respuestas exitosas. El segundo
subbloque aporta preparación interna de instantáneas paginables y manifiestos,
con copias S3 verificadas/reanudables a histórico y staging del destinatario.
El tercer subbloque coordina escritores HTTP con tokens persistidos, impide
reservar con escritores/URLs vigentes y cubre polling/rechazo/normalización
médicos. No prueba fin de PUT ya iniciados ni habilita aceptación pública.
El cuarto subbloque agrega preflight de IA pendiente bajo reserva, validación
de legacy y captura paginada/reanudable del periodo inicial; no publica datos ni
cambia propietario. Rechaza periodos posteriores hasta incorporar antecedentes
retenidos y mantiene pendiente el cierre del corte S3.
El quinto subbloque aísla las cargas nuevas de foto/diario y promueve una copia
final verificada sin sobrescribir; reconcilia copias de respuesta incierta. La
captura exige medios sellados y deniega legacy hasta migración explícita. Los
JSON de carga/confirmación se conservan, pero finalUrl solo está disponible
después de confirmar y hay conflictos/errores S3 adicionales documentados.
El sexto subbloque implementa migración interna explícita/paginada de foto y
adjuntos legacy a claves aisladas, sin borrar originales ni alterar identidad,
metadatos o fechas. Reutiliza fijación/copia/sellado y reserva del animal; activa
solo URLs con CAS y checkpoint transaccional. No se ha ejecutado en datos reales
ni tiene endpoint/job automático. Cambios de URLs, confirmaciones retiradas y
requisitos de integración en
[animal-media-legacy-migration.md](./animal-media-legacy-migration.md).
El séptimo subbloque añade detención técnica explícita de migraciones mediante
revisión/auditoría y liberación transaccional solo de su reserva, sin revertir
páginas ni borrar medios. STOPPED no es cancelación de una transferencia. Copias
de migración no actuales no pueden activarse por confirmaciones ordinarias.
Inventario paginado interno de tokens/reservas solo observa, no demuestra muerte
de operaciones ni retira claims. Detalle en
[animal-media-migration-recovery.md](./animal-media-migration-recovery.md).
El octavo subbloque agrega journal persistido y una identidad de proceso para
nuevos tokens de escritura: intención previa, permiso de callback y resultados
locales/claims inciertos, con mayoría y sin datos clínicos ni credenciales.
Tokens legacy se conservan sin atribución ni limpieza. El journal no deduplica
negocio, no prueba muerte de procesos/fin de S3 y no habilita recuperación general.
Los cuerpos/éxitos HTTP se conservan; fallar preparar evidencia puede devolver
500/409 documentados antes de invocar callback. Detalle y compatibilidad en
[animal-write-journal.md](./animal-write-journal.md) y la guía frontend central.
El noveno subbloque liga las nuevas adquisiciones al journal en una transacción
Mongo corta y marca su protocolo sin backfill de los anteriores. Añade servicio
interno explícito/auditado para operaciones que nunca obtuvieron permiso del
callback: retiro exacto y fence terminal conjuntos, en competencia con MAY_RUN
y adquisiciones en vuelo. Una operación con permiso previo queda excluida aun
si después registra NOT_INVOKED. No recupera tokens legacy ni reservas generales,
no declara rollback de negocio y no se ejecuta automáticamente. Las escrituras
HTTP coordinadas ahora requieren transacciones Mongo: éxitos/DTO conservados,
500/409 de preparación y latencia documentados en la guía central. Pruebas con
sesiones/snapshots simulados; Mongo replica set real y autorización operativa
siguen pendientes antes de intervenir. No cambia reglas de cancelación/vencimiento.
El décimo subbloque prepara el arnés opt-in con dos conexiones independientes
y barreras alrededor de consultas reales, excluido de las pruebas ordinarias y
del arranque del backend. Solo permite endpoint local explícito y base desechable
generada/verificada. El undécimo subbloque ejecutó los once escenarios con éxito
en MongoDB 8.0.34, replica set local de un nodo, y verificó limpieza del entorno.
No cambió código de ejecución ni amplió recuperación. La mayoría observada es
la de ese único miembro; no aporta evidencia de failover/multinodo, fallos de red,
S3 o recuperación general. Evidencia en
[animal-write-mongo-validation.md](./animal-write-mongo-validation.md). Arnés en
[animal-write-mongo-integration.md](./animal-write-mongo-integration.md).
El subbloque 12 añade importación interna explícita de antecedentes a preparaciones
manuales, desde el predecesor efectivo vinculado por períodos y transferencia,
con procedencia raíz, registros retenidos separados y copias históricas fijadas
por revisión/digest. Incluye pruebas sintéticas A→B→C/devolución, sin mutar datos
activos ni recuperar borrados nunca retenidos. La captura automática conserva
la guarda del período inicial: integración posterior/cierre/activación pendientes.
Detalle en [ownership-archive-history.md](./ownership-archive-history.md).
El subbloque 13 aporta un plan persistido de referencias por entrada, con
procedencia/hash, bindings históricos/destinatarios y cambio de ownerId solo
propuesto para recursos vigentes. No duplica payloads clínicos ni activa datos.
Planes/cursor se confirman juntos y compiten mediante fence del control. PLANNED
no es una transferencia, una copia final verificada o un período cerrado.
Materialización final y commit conjunto siguen pendientes; no se retira la guarda
inicial. Detalle en [ownership-archive-reference-plan.md](./ownership-archive-reference-plan.md).
El subbloque 14 materializa finales desde staging de forma explícita, con intención
durable, copia condicional al destino ausente y verificación de identidad/digest.
Reanuda/reconcilia respuestas inciertas sin sobrescribir; un objeto previo de una
devolución se conserva con conflicto, aun con bytes iguales. Falta resolver esas
colisiones con destinos explícitos compatibles antes de habilitar retornos.
MATERIALIZED solo es evidencia registrada: no activa, publica, cambia dueño o
cierra períodos. Registro de medios/commit conjunto/captura posterior siguen
pendientes. Detalle en [ownership-archive-materialization.md](./ownership-archive-materialization.md).
El subbloque 15 agrega selección generacional interna explícita para nuevas
materializaciones, manteniendo jerarquía/nombres y planes originales. El destino
efectivo queda ligado a una intención inmutable; no se convierte V1 ni se cambia
de ruta tras errores/copias inciertas. Permite copiar junto a objetos antiguos
sin adoptarlos/sobrescribirlos; un destino generacional ajeno también se rechaza.
Las guardas de medios reservan estas URLs para impedir activarlas por fallback
legacy, incluso sin ticket. Registro/publicación transferida y commit conjunto
siguen pendientes; no cambia el objetivo funcional ni habilita devoluciones
completas. Detalle en [ownership-archive-generations.md](./ownership-archive-generations.md)
y compatibilidad en la guía frontend central.
El subbloque 16 añade registro explícito por archivo generacional verificado en
animal_transferred_media: hashes, destino efectivo/revisión/digest y procedencia
inmutables, con estado PREPARED separado de tickets ordinarios/publicación.
Registro/fence comparten transacción bajo reserva drenada y período ACTIVE;
repetir reconcilia la misma constancia sin convertir V1 ni autorizar otras rutas.
No lee S3, acredita completitud global, activa referencias o cambia permisos;
se conservan las guardas contra confirmación/migración/captura generacionales.
Pruebas simuladas, sin ejecución real. Revalidación final/commit conjunto siguen
pendientes. Detalle en
[ownership-archive-media-registration.md](./ownership-archive-media-registration.md).
El subbloque 17 revalida metadatos del conjunto preparado mediante una corrida
interna paginada: reconstruye snapshots/planes y comprueba manifiesto completo,
registros PREPARED/cobertura/conteos, con digests y checkpoint/fence conjuntos.
La revisión compartida impide continuar tras otra materialización/registro/
corrida; no se adopta silenciosamente una revisión nueva. METADATA_OBSERVED no
es verificación S3, corte estable, vigencia del expediente activo o autorización
de commit/publicación. No se aflojan guardas ni se habilita aceptación. Detalle:
[ownership-archive-metadata-revalidation.md](./ownership-archive-metadata-revalidation.md).
El subbloque 18 observa destinos finales con HEAD actual/GET fijado/HEAD actual,
identidad/revisión/tamaño/SHA-256 y checkpoint paginado sobre la corrida/control
vigentes. No escribe S3 ni repara/adopta versiones. S3_OBSERVED registra lecturas,
no corte estable, simultaneidad, fin remoto, acceso o autorización de commit.
Sin cambios de negocio o habilitación de transferencia. Siguiente: identidad
monotónica de reserva e invalidación ABA, auditando mutadores antes del consumo;
esa identidad tampoco prueba cierre de efectos remotos. Detalle:
[ownership-archive-s3-observation.md](./ownership-archive-s3-observation.md).
La captura completa entre periodos, integración de antecedentes retenidos, activación
de referencias/publicación, limpieza, OTP y decisiones/notificaciones siguen
pendientes. Los éxitos HTTP no cambian; polling ANALYZING y REJECT también
pueden devolver 409 por reserva. Contratos/integración en la guía frontend.
Detalle técnico en [animal-write-coordination.md](./animal-write-coordination.md) y
[`ownership-archive-preparation.md`](./ownership-archive-preparation.md).
La captura disponible y sus límites constan en
[`ownership-archive-capture.md`](./ownership-archive-capture.md).
El aislamiento y transición pendiente están en
[`animal-media-upload-isolation.md`](./animal-media-upload-isolation.md).
El contrato disponible está en
[`frontend-animal-transfer-foundations.md`](./frontend-animal-transfer-foundations.md).

## 7. Referencias técnicas contrastadas

- [AWS: transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html): guardar cambios y eventos juntos y entregar después con manejo de duplicados.
- [MongoDB: transacciones](https://www.mongodb.com/docs/manual/core/transactions/): consistencia de cambios que afectan múltiples registros; verificar topología compatible.
- [Firebase: recepción de mensajes en Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages): atender primer plano, segundo plano y apertura desde una notificación si se elige FCM.
