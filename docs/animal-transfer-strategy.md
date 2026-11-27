# Transferencia de animales: estrategia y análisis

Fecha: 2026-10-25.
Estado: desarrollo iniciado por bloques. El avance verificable se registra en
`final-delivery-plan.md`; el flujo completo aún no está habilitado.
Bloques 53–58: OTP específico EMAIL/PHONE, creación idempotente/consulta de
solicitudes pendientes, bandeja/contador/leído y registro/baja de dispositivos
implementados; procesador de outbox interno con proveedor simulado, sin activar.
El destinatario puede finalizar sin seleccionar animales: rechazo total transaccional
con recibo idempotente, avisos y liberación exacta de claims; aceptación sigue bloqueada.
No aceptación o traspaso aplicado; integración
social e integración productiva siguen pendientes. El 60 validó 39 escenarios del
flujo hasta rechazo en Mongo local de un miembro; puertos de cuenta/hash/envío
simulados, sin habilitar proveedores reales o aceptación.

Bloque 65 observa un candidato; el 66 implementa el inicio interno atómico desde la
solicitud, tras preflight Mongo del conjunto, con reservas/cabeceras y respuesta
PROCESSING/REJECTED. Fuera del grafo HTTP, sin copiar o cambiar propietario; conserva
guarda inicial y no acredita corte remoto. Validación Mongo real, avance operativo,
retención/corte/commit y aceptación pública siguen pendientes; reglas intactas.

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

La vista previa de cada ítem puede mostrar la foto del animal a través
del detalle autorizado de la solicitud. La ficha completa conserva su
regla de acceso por propietario.

El propietario anterior consulta información y documentos hasta el traspaso. El
nuevo propietario consulta el pasado y puede incorporar nueva información. Las
nuevas escrituras S3 pertenecen al prefijo del propietario actual. Debe existir
un historial de propietarios.

Decisión del 2026-11-18. En la lista del dueño anterior se conserva la
ficha histórica del animal con `transferStatus: TRANSFERRED` y
`readOnly: true`. El detalle se abre mediante su publicación histórica.
La ficha activa del nuevo dueño conserva su identidad. En el listado del
dueño actual, una solicitud saliente se presenta como `PENDING` y el
traspaso en curso como `PROCESSING`. El estado `isActive` conserva su
significado de actividad o fallecimiento. Una solicitud pendiente permite
las escrituras del propietario.

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
- El 2026-11-25 se confirmó la cancelación automática si no se responde en
  60 días. Se implementó en el bloque 344. La cancelación manual sigue sin
  definirse.
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
- Actualización del 2026-11-18: `OTHER` exige una explicación en texto al
  crear una transferencia o indicar ese motivo al rechazarla. Los motivos
  se sirven por catálogo sembrado automáticamente en el arranque.
- El usuario aclaró que el campo mencionado era `nameHistory`. Se conserva para
  nombres y se implementa un historial de propiedad separado, sin reinterpretar
  los datos actuales.

### Plazo de respuesta de 60 días — requisito del 2026-11-25

**Implementado en el bloque 344.** Para solicitudes nuevas, el servidor guarda
`expiresAt = createdAt + 60 × 24 horas` en UTC. El límite es inclusivo y queda
fijo durante consultas, OTP y reintentos. Las solicitudes existentes sin
`expiresAt` conservan su tratamiento previo. Incorporarlas requiere una
decisión sobre su fecha de inicio. La cancelación manual sigue por definir.

- El plazo cubre solicitudes `PENDING` sin decisión admitida. Aceptación y
  rechazo lo comprueban en sus transacciones, antes del cambio de cabecera. El
  mismo estado y versión limitan qué transición puede ganar. Una aceptación ya
  admitida en `PROCESSING` continúa por su protocolo; sus reintentos siguen
  consultando la decisión original.
- El barrido del backend recorre hasta 20 solicitudes por vuelta en orden de
  `expiresAt/_id`, al iniciar y cada minuto después de completar una vuelta.
  Revalida cabecera, fecha, versión, ítems y claims en la transacción. Guarda
  `EXPIRED`, incrementa la versión, libera los claims originales y escribe
  auditoría y un aviso al emisor. Ante una inconsistencia, el caso vuelve a ser
  elegible en una vuelta futura. Se conservan propietario, períodos,
  documentos, archivos y reservas de aceptación. La solicitud se conserva.
- Desde el instante límite, las lecturas muestran `EXPIRED` y omiten la
  solicitud de la bandeja accionable. `expiredAt` indica cuándo se guardó
  la transición. Al abrir el aviso entrante vencido, mostrar «El tiempo de la
  transferencia expiró». El emisor recibe `ANIMAL_TRANSFER_EXPIRED` en la
  campanita. Volver a solicitar usa una intención y clave nuevas después de
  liberarse los claims. [Contrato para Flutter](./frontend-animal-transfer-foundations.md#solicitudes-pendientes-disponibles-bloque-54).

### Ampliación funcional del 2026-11-18

El buscador admite coincidencias parciales literales de identificación,
conservando ceros iniciales y excluyendo al remitente, además de nombres.
El catálogo de transferencia conserva Venta/Compra, Adopción, Regalo/Donación,
Cambio de cuenta principal y Otro. El rechazo dispone de Desconocimiento de
transferencia, No tiene la responsabilidad o recursos y Otro.
El motivo de rechazo es común para todos los animales rechazados de una
misma decisión, incluso en aceptaciones parciales.
La ficha devuelve un historial de propietarios separado de `nameHistory`,
con nombre y fecha de cada periodo; no se fabrica una fecha desconocida.
Los documentos médicos conservan la identidad de quien subió cada archivo,
independiente del dueño actual. Flutter agrupa por esa identidad y no se
modifican los PDF ni se infiere un veterinario a partir del diseño visual.

### Despliegue con el backend y el bucket actuales

Decisión del 2026-11-17. Mantener la lógica en AnimalRecord sobre
Lightsail, Mongo y el bucket de medios actual. El piloto usará animales
y documentos nuevos en Flutter. La aceptación se probará desde la app.

Estrategia del modo `direct-s3`

1. Reservar el animal al aceptar y fijar las versiones de los archivos
   del dueño actual bajo `users/{anterior}/animals/{animalId}/`. Mantener
   las comprobaciones de escrituras activas y trabajo médico pendiente.
2. Conservar el histórico de solo lectura para el dueño anterior,
   vinculado a las versiones exactas de S3. Mantener la retención acordada.
   Preparar y verificar la copia de cada archivo bajo
   `users/{nuevo}/animals/{animalId}/`, con su jerarquía actual. Reutilizar
   las claves aisladas por traspaso y el registro de intentos en Mongo.
3. Confirmar la copia directamente en S3. La revisión debe corresponder
   al destino e intento guardados y coincidir en versión y contenido.
   Si se pierde la respuesta, reconciliar la versión exacta y su
   procedencia. Una ausencia deja la ejecución pendiente. El permiso
   guardado no se reenvía y el prefijo no se borra ni recicla al reintentar.
4. En una transacción, consumir las verificaciones, publicar el
   histórico y cambiar dueño y referencias. Desde ese momento las
   mutaciones y emisiones nuevas de URLs firmadas autorizan al nuevo
   dueño y apuntan a su prefijo. El anterior lee su histórico por
   la API autorizada.

La simplificación sustituye la acreditación independiente de eventos
por comprobaciones de versiones y contenido desde el backend. Su
alcance es el flujo de AnimalRecord y los prefijos protegidos del
bucket. La copia verificada no acredita el cierre de todos los
escritores externos. Los permisos de aplicación y la privacidad de los
archivos históricos siguen siendo requisitos del
[despliegue](./application-map.md#activación-del-primer-traspaso-en-lightsail).
El recibo directo se consume junto con el cambio de dueño. El histórico
descarga su versión retenida y verifica el contenido.

Decisión del 2026-11-18. Se admite devolver el animal a un dueño anterior.
Cada transferencia cierra el periodo del remitente y abre uno nuevo para
el destinatario. El regreso mantiene el mismo animal y la información
vigente, incluyendo lo añadido por el dueño intermedio. Cada dueño
conserva sus publicaciones históricas inmutables.

Los periodos sucesivos del modo directo requieren el recibo publicado del
traspaso anterior y su vínculo exacto con el periodo activo. La decisión
usa un protocolo explícito y conserva el predecesor en la cabecera.
Los archivos heredados se capturan desde las versiones verificadas de
la copia que recibió el dueño actual. Cada regreso genera destinos nuevos.
La guarda inicial sigue aplicando a las decisiones anteriores sin ese
vínculo y al preparador manual.

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
  de la solicitud y un resumen por animal con nombre, UUID/código, edad, raza
  y sexo. El resumen se guarda al enviar la solicitud. El acceso al
  expediente completo requiere la relación de propiedad correspondiente.
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

Desde el bloque 340, todos los métodos de registro pueden autorizar transferencias.
Una cuenta `PHONE` prefiere el celular registrado; las cuentas EMAIL, GOOGLE,
APPLE y MICROSOFT prefieren el correo registrado. Si falta el contacto preferido,
usar el otro contacto guardado en el perfil. Sin ninguno, rechazar con 409 antes
de persistir o enviar. No aceptar destinos del cliente ni cambiar `authMethod`.
Reutilizar los transportes actuales de correo/SMS, solo con esta selección para
el contexto de transferencia; el registro y recuperación conservan su selección.
Esto es correo/SMS; push para transferencias se implementa por separado. El
usuario ratificó reutilizar la implementación que ya funciona en registro.
La selección debe ser compartida por el desafío y el transporte para ligar la
prueba al canal/contacto utilizado. No simular un envío para cuentas sociales.

Desafíos separados de registro/reset: generación criptográfica, hash, caducidad,
límite de intentos, enfriamiento de reenvío, límite por usuario/canal y consumo
atómico. Invalidar el código previo al reenviar. No registrar códigos en logs.
No reutilizar el caso de
uso de verificación de cuentas.

La expiración OTP debe seguir la configuración de registro actual
(`VERIFICATION_CODE_EXPIRATION_MINUTES`, valor por defecto actual: 15 minutos).
Política técnica configurable implementada en el bloque 53: prueba de confirmación
de 10 minutos, 5 intentos por código, reenvío desde 60 segundos y 3 envíos por
usuario en una ventana de 15 minutos. Desde el bloque 315, el código de
transferencia tiene cinco dígitos generados criptográficamente. Los plazos
y cuotas son controles técnicos configurables, independientes de los 60 días de
respuesta definidos el 2026-11-25; su implementación sigue pendiente.
El destino se obtiene del perfil; no
se recibe un correo o teléfono alternativo en el cuerpo de la solicitud.
El registro social sigue marcando la cuenta verificada sin enviar OTP de registro.
Esto no sustituye el desafío específico de transferencia: GOOGLE/APPLE/MICROSOFT
deben recibirlo y verificarlo mediante su contacto registrado, como EMAIL/PHONE.
No se modifican códigos, verificación de cuenta, sesión ni flujo de registro/reset.

### Solicitud e ítems individuales

Implementación del bloque 54: POST /animal-transfers consume la prueba OTP y guarda
solicitud PENDING, ítems, exclusividad por animal, evento y notificaciones/outbox
locales en la misma transacción snapshot/primary/majority. Idempotency-Key UUID
ligada al remitente y al contenido de negocio normalizado (animales sin orden);
repetición devuelve la misma solicitud sin consumir otra prueba, cambio de contenido
devuelve conflicto. Error incierto exige repetir explícitamente la misma clave,
sin inferir rollback ni reenviar OTP. El 58 añade rechazo total; aceptación y
worker/push reales siguen sin habilitarse.

El ítem activo se respalda con _id=animalId en animal_transfer_active_items, separado
de transferLock/activeWrites: impide otra solicitud activa pero permite seguir
editando. El rechazo total del bloque 58 libera esos claims transaccionalmente;
no se libera por edad/error sin una transición de vencimiento autorizada y
confirmada bajo la regla de 60 días. El estado activo/propiedad y versiones se validan con
escrituras en sus fuentes durante la creación, sin modificar dueño ni períodos.
El contexto clínico/medios no se captura al solicitar; la copia exacta sigue
correspondiendo a la aplicación de la aceptación. La guía frontend describe el
contrato actual de POST, lista entrante/saliente y detalle de ítems paginado.

`animal_transfers`: remitente, destinatario, motivo y etiqueta histórica,
estado agregado, fechas, versión y clave idempotente. Añadir `expiresAt` según
el plan de respuesta de 60 días del 2026-11-25; todavía no existe en el runtime.
`animal_transfer_items`: transferencia, animal, propietario/versión esperados,
estado individual, decisión, fecha efectiva y vínculo al periodo/archivo.

Estados individuales propuestos:

```text
PENDING → PROCESSING → ACCEPTED
PENDING → REJECTED
```

Implementado en el 58: solo rechazo del conjunto completo por el destinatario,
POST decisions con expectedVersion/Idempotency-Key y acceptedAnimalIds vacío.
Solicitud e ítems pasan a REJECTED, versión/fecha/recibo/evento/avisos/outbox y
liberación de claims en una transacción con CAS escrito en la solicitud. Claims o
ítems faltantes/extra/inconsistentes abortan, sin reparación. No exige estado activo,
pausar escritores ni análisis IA para rechazar: no modifica el animal/expediente.
Las selecciones HTTP no vacías fallan 409 sin decisiones parciales. PROCESSING existe
solo por el inicio interno del 66; ACCEPTED sigue pendiente. Ese inicio compite
con rechazo mediante CAS de la misma solicitud/versión, y registra reservas,
cabeceras y decisión de todos los ítems en una tx, después del preflight completo.
Cada futuro escritor de decisiones deberá competir con la misma
versión de solicitud; snapshot PENDING por sí solo no autoriza escrituras.
Detalle por página consistente/cursor ligado a versión y filtro PENDING/REJECTED
disponibles; contrato y efectos para frontend en su guía centralizada.

`EXPIRED` representa la cancelación automática por vencimiento para las
solicitudes cubiertas por el bloque 344. La cancelación manual sigue pendiente.

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
impide aceptarlo. El vencimiento de 60 días se aplica
solo para pendientes sin decisión admitida, sin revertir animales ya aceptados.
La cancelación manual y los detalles operativos siguen pendientes.

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

#### Matriz de canales y primera entrega del 2026-11-26

`Notificaciones.docx` define los canales y la navegación general. La guía de
Flutter del 2026-11-26 y los prototipos concretan el comportamiento de
transferencias. La bandeja reúne todos los avisos definidos y el push se habilita
por evento. Agenda, dosis y genealogía se desarrollarán más adelante. Los avisos
asociados al perfil veterinario quedan fuera de alcance por ahora.

| Evento | Campanita | Push y destino al abrir |
| --- | --- | --- |
| Vinculación de animales al perfil | Sí | Sin push. Abrir ficha si es uno, «Mis animales» si son varios. |
| Nueva transferencia recibida | Sí | Push al receptor. Abrir la decisión si sigue pendiente y vigente. Tras aceptar, «Mis animales». Tras rechazar, sin redirección. |
| Transferencia enviada pendiente, resultados y vencimiento | Sí | Solo campanita. Son informativos. El aviso original de recepción debe mostrar el vencimiento si el receptor lo abre después del plazo. |
| Evento programado de agenda | Sí | Push. Abrir Agenda. |
| Recordatorio de vacuna o desparasitación solicitado por el tutor | Sí | Push. Abrir la sección correspondiente del animal. |
| Solicitud de parentesco de otro tutor | Sí | Push. Abrir la decisión. Si confirma, abrir genealogía. El rechazo es informativo. |
| Resultado de una solicitud de parentesco y confirmación de la propia respuesta | Sí | Solo campanita. Para el solicitante, el enlace aceptado abre genealogía. El rechazo y la confirmación al usuario que respondió son informativos. |

El plazo de genealogía se definirá con ese módulo. Su aviso de solicitud debe
informar si el enlace venció al abrirse y el solicitante debe poder saber que
no hubo respuesta. El Word recomienda mostrar avisos durante 60 días, del más
reciente al más antiguo y con carga por páginas. La ventana de visibilidad y su
efecto sobre el contador quedan por cerrar. Es independiente del plazo de decisión
de transferencias y de cualquier retención de datos. Consultar o marcar leído
conserva el aviso disponible durante la ventana aplicable.

**Primera entrega de transferencias, bloque 342.** La rama de notificaciones
genera los siguientes tipos para avisos nuevos y conserva la lectura de avisos
anteriores con sus tipos e IDs originales.

| Momento | Aviso al emisor | Aviso al receptor |
| --- | --- | --- |
| Solicitud creada | `ANIMAL_TRANSFER_PENDING` | `ANIMAL_TRANSFER_RECEIVED`, único evento elegible para push |
| Aceptación total confirmada | `ANIMAL_TRANSFER_ACCEPTED` | `ANIMAL_TRANSFER_RECIPIENT_ACCEPTED` |
| Rechazo total confirmado | `ANIMAL_TRANSFER_REJECTED` | `ANIMAL_TRANSFER_RECIPIENT_REJECTED` |
| Resultado mixto confirmado | `ANIMAL_TRANSFER_MIXED_RESULT`, un resumen con aceptados sobre el total | `ANIMAL_TRANSFER_RECIPIENT_ACCEPTED` y `ANIMAL_TRANSFER_RECIPIENT_REJECTED`, uno por grupo con su conteo |

En las aceptaciones totales o mixtas, el backend emite el conjunto de resultados
cuando el último ítem seleccionado termina su cambio de dueño y el resultado agregado
queda confirmado. Guarda los avisos en esa transacción con IDs deterministas por
solicitud/decisión, tipo y destinatario. Cada aviso tiene su propia lectura y el
mismo `transferId`. Los títulos y textos se arman con nombres y conteos guardados
en la solicitud, conforme al rol de la cuenta. El contrato objetivo para el push
visible lleva el conteo, y sus datos de navegación identifican el aviso y la
transferencia.

La creación encola solo `ANIMAL_TRANSFER_RECEIVED`. La expansión y la concesión
verifican el tipo, el alcance del aviso y el protocolo `TRANSFER_RECEIVED_V1`;
las filas y entregas anteriores quedan fuera del despacho. Antes de conectar
FCM falta acordar un corte de activación que excluya también los avisos de este
protocolo generados antes de encender el envío. La entrega se mantiene por
instalación. La referencia de recurso para otras funciones queda para sus bloques.

Reutilizar `GET/PUT/DELETE /notification-devices/{installationId}` y su control
de revisión. Junto a la lista, contador y marcado individual, están implementados
`GET /notifications/{id}` con autorización del destinatario y
`PATCH /notifications/read-all`. El marcado global guarda el corte y las
lecturas de la cuenta en una transacción. Repetir una operación confirmada
conserva sin leer los avisos nuevos. Al abrir el push, Flutter debe
validar el aviso y consultar el estado de `GET /animal-transfers/{id}` con la
sesión actual. Los textos informativos no necesitan abrir el detalle. Coordinar
la adopción del [contrato implementado](./frontend-animal-transfer-foundations.md#campanita-y-avisos-leídos-disponibles).

Quedan pendientes el ejecutor de envíos y el adaptador FCM, además de la
validación en Android e iOS autorizada.

#### Extensión común y revisión de fechas — propuesta del 2026-11-25

El administrador requiere que la base de notificaciones sirva también al futuro
árbol genealógico: solicitudes a dueños de animales padres/hijos. No se implementa
genealogía ahora ni se le asigna por inferencia el vencimiento de transferencias.
Propuesta: sobre único aviso de bandeja/entregas con tipo de evento, usuario destino
y referencia tipada al recurso (transferencia, recordatorio o solicitud de
genealogía); cada dominio autoriza y procesa su solicitud. Conservar `transferId`
para avisos existentes y añadir referencias para otros tipos, sin IDs ficticios.
Abrir un push consulta el recurso autorizado; leerlo no aprueba ninguna solicitud.

Un coordinador del mismo backend puede despertar periódicamente los casos de uso
de vencimiento y recordatorios (por ejemplo cada minuto y al arrancar). Cada uno
consulta su modelo con índices de fecha/estado y lotes acotados; no se necesita
una tabla universal de trabajos ni duplicar reglas en el coordinador. El bloque
344 ya ejecuta vencimientos de solicitudes en el mismo backend. Aprovechar
el patrón existente de `InitialTransferAcceptanceResumer`, sin mezclarlo con la
recuperación de capturas ni ampliar sus permisos.

La hora del servidor se compara con `expiresAt` para solicitudes pendientes y con
`notifyAt` para recordatorios programados. La vacuna conserva además fecha civil
y zona para calcular ese instante UTC. La condición temporal se revalida al
escribir: una lectura anterior o un timer no concede permiso. Identidades estables
y escrituras condicionales evitan avisos duplicados entre instancias. FCM queda
fuera de Mongo y conserva su protocolo de incertidumbre/reintentos.

Si el servidor está apagado no se despacha; al volver consulta pendientes guardados,
aplica vencimientos y recupera avisos según su política de atraso. El límite HTTP
de respuesta no depende de que el barrido haya corrido. No mantener contadores de
60 días o de cada vacuna en memoria ni depender de Flutter abierto. Este diseño
funciona dentro del mismo backend. Los recordatorios quedan para su entrega.

#### Revisión de la propuesta Flutter, 2026-11-21

Referencia histórica. Para canales, tipos, agrupación y lectura prevalece la
matriz del 2026-11-26. Las comprobaciones del backend y Firebase descritas aquí
corresponden a la revisión anterior.

Revisión sobre `124569f` de `guia-backend-notificaciones-transferencias.md`
entregada por el administrador. El equipo Flutter declara Firebase Messaging
16.1.1, proyecto `animalrecord-12904`, canal Android `animal_transfers` y clave
APNs de producción cargada en Firebase. No se inspeccionó su consola, app ni
credenciales. Esto actualiza el contexto anterior: Firebase está preparado según
el equipo móvil; el backend todavía no tiene adaptador FCM ni despacho activo.
La guía es una propuesta de integración, no autorización para cambiar reglas,
activar envíos, instalar índices o modificar infraestructura.

La arquitectura propuesta es compatible: reutilizar `NotificationModule`,
outbox y `NotificationPushProvider`; añadir el adaptador FCM y un ejecutor
acotado en el mismo proceso/backend. No exige Lambda, SQS ni un backend nuevo.
`google-auth-library` ya está disponible para autenticación HTTP v1; la identidad
servidora y sus permisos aún deben configurarse por un canal seguro.
[Autenticación FCM](https://firebase.google.com/docs/cloud-messaging/send/v1-api).

| Punto | Implementado | Diferencia de la propuesta / trabajo pendiente |
| --- | --- | --- |
| Instalaciones | GET/PUT/DELETE `/notification-devices/{installationId}`, éxito 200 con estado/revisión; Bearer, `X-Installation-Key`, y para mutaciones `If-Match` e `Idempotency-Key`. Body PUT `{provider,platform,token}`. | Reutilizar estas rutas; `/me/push-installations`, 204 y `{addressType,address,appVersion}` no están implementados. El body propuesto sería rechazado. No se guarda `appVersion` ni un campo ambiente. |
| Rotación y cuentas | Instalación UUID con credencial privada, revisión y unicidad del token; cambio explícito de cuenta y baja anterior protegidos. Varios dispositivos por cuenta. | Flutter debe integrar estas credenciales/conciliación; el token FCM no sustituye la credencial de instalación. El logout no tiene endpoint propio: baja antes de descartar Bearer. |
| Bandeja | Lista paginada, contador y lectura individual idempotente. La respuesta incluye `itemIds` (ítems de transferencia), no `animals`. `readAt` y `nextCursor` se omiten cuando no existen. | Resolver nombres desde los ítems o añadir una proyección controlada; no tratarlos como IDs de animales. `read-all`, `animals` y los null explícitos son cambios de contrato pendientes. El cursor actual no tiene vencimiento definido. |
| Avisos | Solicitud enviada/recibida; rechazo total a ambos participantes; aceptación confirmada por animal a ambos participantes. Aviso y outbox se guardan con el cambio transaccional. | La guía pide aceptación agrupada solo al emisor, rechazo agrupado solo al emisor y dos avisos en decisión mixta. Cambia agrupación/destinatarios. La aceptación parcial actual rechaza los no seleccionados pero no genera su aviso específico de rechazo. |
| Push | Procesador y persistencia internos con generaciones, permisos e invalidación condicional; fuera del grafo activo. | Falta proveedor, configuración, preparación operativa de colecciones/índices y ejecutor. El permiso actual solo incluye `notificationId/transferId/recipientId`: faltan título/texto/tipo/eventId para el mensaje visible propuesto. |
| Reintentos | Espera fija y presupuesto; nuevo intento solo tras rechazo explícito. Timeout/UNKNOWN no se reenvía automáticamente. | Añadir backoff/Retry-After persistido y clasificación FCM sin retries físicos ocultos. UNREGISTERED solo retira la revisión exacta; INVALID_ARGUMENT no demuestra por sí solo token inválido. |

Tipos vigentes y equivalencia semántica propuesta, todavía sin renombrar API:
`TRANSFER_REQUEST_SENT` → `ANIMAL_TRANSFER_PENDING`;
`TRANSFER_REQUEST_RECEIVED` → `ANIMAL_TRANSFER_RECEIVED`;
`TRANSFER_ITEM_ACCEPTED` → `ANIMAL_TRANSFER_ACCEPTED`;
`TRANSFER_REQUEST_REJECTED` → `ANIMAL_TRANSFER_REJECTED`.
La equivalencia de aceptación no resuelve por sí sola la agrupación por decisión.
No mezclar tipos anteriores/nuevos ni duplicar avisos/outbox al adoptar la propuesta.

La guía acierta al separar bandeja de entrega, usar token FCM también en iOS,
enviar datos de navegación sin secretos y volver a autorizar el detalle al abrir.
FCM aceptado no prueba recepción ni lectura. El adaptador deberá respetar las
[reglas de errores y reintentos FCM](https://firebase.google.com/docs/cloud-messaging/error-codes)
y comprobar el payload antes de considerar INVALID_ARGUMENT una baja de token,
como indica la [gestión de tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens).

Siguiente bloque propuesto: acordar agrupación/destinatarios y contrato compatible;
implementar ese ajuste, lectura global y mensaje visible con FCM simulado; conectar
después adaptador/ejecutor y probar en dispositivos con autorización específica.
La identidad Firebase del servidor no se sustituye por `google-services.json`,
configuración pública de Flutter o token de dispositivo. No compartir claves aquí.

Implementado hasta el 55: solicitud y dos avisos/outbox locales transaccionales
(54); GET /notifications paginado, GET /notifications/unread-count y PATCH
/notifications/{id}/read (55). Solo avisos del usuario autenticado, tipos enviados/
recibidos actuales y proyección explícita. Primera lectura por actualización atómica
con mayoría; repetición conserva la fecha, sin modificar solicitud/ítems/outbox.
Leer no retira acciones pendientes. Conteo/lista no forman un snapshot conjunto;
el cliente refresca al cambiar de dispositivo o marcar leído. Registro/baja de
dispositivos implementado en el 56 y procesador interno aislado en el 57, sin entrega
push real ni scheduler. Pruebas con Mongo/transporte simulados;
validación real y preparación de índices siguen pendientes.

Persistir por destinatario `type`, `transferId`, ítems involucrados, título,
texto, fecha, `readAt` y clave única de evento. La campanita y contador salen de
esta colección; la card de inicio sale de transferencias entrantes accionables.
Abrir/marcar leído no acepta animales ni hace desaparecer una acción pendiente.

Persistir el cambio de negocio, evento de auditoría, notificación y outbox en la
misma transacción. Un worker envía push con reintentos, lease, deduplicación y
registro de fallos; una caída del proveedor no pierde la notificación ni revierte
propiedad. No prometer entrega exactamente una vez del push.

Guardar tokens por dispositivo/cuenta, soportar rotación, múltiples teléfonos,
logout y tokens inválidos. En el contexto inicial no había Firebase/push preparado;
la revisión del 2026-11-21 anterior recoge la preparación reportada por Flutter.
Bloque 56: instalación con UUID/credencial local privada (hash en backend), revisión
monotónica y operación idempotente. GET del estado con credencial para conciliar;
PUT alta/rotación/cambio explícito de cuenta y DELETE baja antes de descartar sesión.
Una asignación por token mediante _id de hash separado y una por instalación,
actualizadas juntas. Tombstone tras baja impide reactivación por petición antigua;
baja de cuenta anterior no retira la nueva. Estos son controles técnicos de
integración, no identidad autenticada del hardware/proveedor o cancelación remota.
No existe logout HTTP previo que ejecute esto por sí solo. Bloque 57 implementa
fan-out paginado ligado a generación y permiso escrito junto con fence del dispositivo
vigente, intento y respuesta durable separados. Invalidez solo retira la revisión/
hash/cuenta esperados. Política técnica explícita de presupuesto/espera; un rechazo
reintentable persistido permite intento nuevo, nunca reutilizar un permiso concedido.
MAY_SEND significa que pudo enviarse; UNKNOWN/edad/error/lease no prueban cierre ni
autorizan recuperación. ACCEPTED acredita únicamente el resultado declarado por el
puerto, no entrega/lectura. Fan-out no es snapshot global ni hace backfill de dispositivos
nuevos; permisos previos sobreviven a logout/rotación con incertidumbre. Outbox antiguo
sin marca excluido; no limpieza/adopción automática. Proveedor real y activación siguen
pendientes; cada intento deberá corresponder a un envío físico sin retries ocultos.
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

Motivos/destinatarios, tres POST OTP, POST de solicitud, GET de lista/detalle y
bandeja/contador/leído y GET/PUT/DELETE de dispositivos están implementados hasta
el 56; rechazo total/filtro y detalle por snapshot en el 58, contratos en la guía frontend.
Las demás decisiones/rutas siguen propuestas, aún no implementadas. No habilitar aceptación.

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
| Dispositivos             | GET /notification-devices/{installationId}, PUT y DELETE en la misma ruta |

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
El subbloque 19 añade identidad monotónica a transiciones de reserva y liga
observaciones Mongo/S3 a ella. Adquirir/liberar captura e iniciar/finalizar/detener
migración comparan el epoch e incrementan junto a la transición. Invalida ABA
idéntico bajo mutadores actualizados; no es epoch universal de contenido o fin
remoto. No adopta corridas anteriores ni reserva legacy para otorgar garantía.
Falta persistir identidad en nuevas cabeceras y ligarla a todos sus workers,
consumo/commit conjunto y corte estable. Sin cambios de reglas de negocio o
habilitación pública. Detalle:
[animal-reservation-epoch.md](./animal-reservation-epoch.md).
El subbloque 20 fija reservation inmutable en NUEVAS cabeceras y exige su epoch
original en creación y todos los mutadores/checkpoints del archivo preparado,
con fence transaccional del control. Cabeceras anteriores sin vínculo no se
retroadaptan; hashes/planes/manifiestos/rutas S3 originales conservados. Otra
corrida tampoco adopta un archivo de otra reserva. Una copia remota tardía puede
terminar, pero no confirmar/liberar trabajo bajo otra identidad. Sin consumo,
publicación o cambio de negocio. Siguiente: guardia de consumo único dentro de
futura transacción conjunta; evidencia remota/corte estable siguen pendientes.
Detalle: [ownership-archive-reservation-binding.md](./ownership-archive-reservation-binding.md).
El subbloque 21 aporta colaborador de consumo único dentro de una sesión ya
activa del futuro commit. Relee evidencia y pins/fences, marca cabecera/corrida
juntos y rechaza reutilización incluso por otra corrida. No inicia/confirma
transacciones ni llama negocio/S3. Recibo aislado no acredita traspaso o corte
estable; falta integrar autorización, idempotencia y escritura conjunta. Nuevas
corridas fijan también revisiones de preparación/planes; sin retrofijar las previas.
Sin habilitación pública o nuevas reglas de vencimiento/cancelación. Detalle:
[ownership-archive-evidence-consumption.md](./ownership-archive-evidence-consumption.md).

El subbloque 22 prepara el arnés Mongo aislado OPT-IN del consumo, con escritura
conjunta sintética, dos clientes, carreras/rollback y error posterior al commit.
Comando/autorización técnica/namespace propios; no amplía el arnés del journal.
Compilado y comprobado sin conexión en ese bloque; ejecución posterior en el 23.
No cambia el objetivo funcional ni prueba traspaso, corte S3 o reglas nuevas. Detalle:
[ownership-archive-evidence-mongo-integration.md](./ownership-archive-evidence-mongo-integration.md).

El subbloque 23 ejecuta el arnés con autorización: quince pruebas aprobadas en
replica set local de un nodo, después de corregir objetos vacíos eliminados al
persistir snapshots. Se conserva el contenido y su hash, sin relajar guardas,
adoptar entradas antiguas o cambiar reglas médicas/IA. Limpieza comprobada de
treinta bases sintéticas y contenedor; S3 e insert conjunto siguen sintéticos.
No es transferencia ni validación multinodo. Corte estable, permisos/retención
y commit conjunto siguen pendientes. Detalle:
[ownership-archive-evidence-mongo-validation.md](./ownership-archive-evidence-mongo-validation.md).

El subbloque 24 aporta proyección pura del conjunto completo hacia el destinatario:
valida snapshots/planes/destinos generacionales/registros, clona payloads y
conserva antecedentes como solo lectura con su dueño/procedencia original. No
crea registros activos, cambia propiedad, consume evidencia, publica o concede
acceso. No interpreta clínica ni reinicia códigos o fechas. Su hash no demuestra
vigencia del control, corte estable S3 o autorización. Pruebas sintéticas, sin
operaciones reales en este bloque; decisiones de negocio intactas.
Detalle: [ownership-archive-recipient-projection.md](./ownership-archive-recipient-projection.md).

El subbloque 25 añade lectura coherente de ese conjunto en la transacción del
llamador, con reserva/período/fences y digests de observación contrastados. No
escribe ni consume evidencia. El snapshot puede ignorar cambios confirmados
después de fijarlo: el consumo con CAS sigue siendo necesario en la MISMA
transacción del futuro commit. En fallo intenta abortar esa transacción, sin
deducir rollback o fin remoto del error. Pruebas simuladas, sin habilitar
transferencias o cambiar decisiones pendientes.
Detalle: [ownership-archive-projection-read.md](./ownership-archive-projection-read.md).

El subbloque 26 prepara veinte escenarios Mongo del lector y consumo conjuntos,
incluidos snapshots antiguos, dos clientes, cambios de reserva/fences y rollback.
Comando/configuración/opt-in propios, sin ampliar suites/colecciones anteriores.
Compilación/guardas verificadas sin conexión en ese bloque; ejecución posterior
en el 27. No cambia runtime o decisiones de negocio.
Detalle: [ownership-archive-projection-mongo-integration.md](./ownership-archive-projection-mongo-integration.md).

El subbloque 27 ejecuta esos veinte escenarios con autorización: todos aprobados
en un replica set local de UN miembro, sin modificar código o tests. Confirmó
lecturas snapshot antiguas sin lock y rechazo del commit obsoleto frente a
consumidores/fences ganadores. Limpieza comprobada de veinte bases/contenedor.
No prueba S3 real, propiedad aplicada, retención o idempotencia de negocio.
Siguiente: auditoría de escritores/efectos remotos y contrato de evidencia de
corte estable S3 antes del commit. No inferir fin por tiempo/error/ausencia de
tokens/HEAD, ni ampliar recuperación o decidir cancelación/vencimiento.
Detalle: [ownership-archive-projection-mongo-validation.md](./ownership-archive-projection-mongo-validation.md).

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

### Subbloque 28: auditoría técnica, objetivo funcional sin cambios

Matriz de escritores y carreras en
[animal-transfer-stable-s3-cut.md](./animal-transfer-stable-s3-cut.md). Revisión
estática: copias histórico/staging sin condición de destino, copias médicas sin
pin/condición, ventana de inicio BDA antes de persistir ARN y limpieza con evidencia
insuficiente. No se ejecutaron ni reprodujeron fallos AWS. Claims/journal/lease y
observaciones no prueban cierre remoto. Contrato por efecto/aislamiento/retención
propuesto, sin implementación o reglas nuevas. Siguiente: lector interno paginado
de journals por animal, incluidos terminales sin tokens; no recuperación ni permiso
de commit. Se mantienen guarda inicial, transferencia deshabilitada y pendientes
de vencimiento/cancelación; terminar/descartar IA pendiente no equivale a abortar BDA.

### Subbloque 29: evidencia local de journals por animal

Ya existe lector interno paginado de journals por animal,
incluidos terminales sin tokens; evidencia local con cobertura incompleta/efectos
remotos no evaluados. No cambia objetivo funcional, HTTP, recuperación o permisos.
Sin índice nuevo creado/declarado ni pruebas reales Mongo/S3. Contrato en
[animal-write-journal-inventory.md](./animal-write-journal-inventory.md).
Siguiente: contrato/máquina de estados de intención y autorización por efecto para
promoción foto/diario, con carreras de revocación/retries/respuesta perdida antes de
dispatch real. Transferencia deshabilitada; vencimiento/cancelación pendientes.

### Subbloque 30: contrato técnico y modelo puro de promociones

Implementado solo en dominio/pruebas: identidades operación/efecto/intento y puerta
de autorización revocable, definición inmutable de bucket/origen/destino y evidencia
local append-only. Revocación compite con nuevos permisos; los ya concedidos
conservan incertidumbre, incluso sin constancia de envío. Retries de aplicación/SDK
son intentos separados en el modelo, sin cambiar el cliente S3 existente.
Contrato durable de persistencia/transacciones y dispatch propuesto, no integrado:
[animal-media-promotion-effects.md](./animal-media-promotion-effects.md).

El objetivo funcional aprobado no cambia. Sin nuevo endpoint, permisos, recuperación,
cancelación/vencimiento o transferencia habilitada. No resuelve retención, legacy,
BDA o corte estable, ni levanta la guarda inicial/convierte preparaciones V1.
Siguiente bloque: persistencia y carreras transaccionales sin dispatch real;
después instrumentar cada envío y demostrar cobertura/aislamiento/retención.

### Subbloque 31: persistencia interna sin dispatch

Puerto y adaptador Mongo implementados para el protocolo de promoción ordinaria:
filas separadas y CAS de puerta; permisos nuevos requieren journal/claim/control
actuales cercados en la misma transacción. Tombstone anterior a apertura impide
adoptar un OPEN tardío. Revocar no borra permisos previos ni retira tokens; cierre
local no demuestra fin remoto. Callers y configuración S3 existentes intactos.

Colección/índices declarados con autoCreate/autoIndex desactivados; módulo opt-in
fuera del arranque. Pruebas simuladas, sin infraestructura real o transferencia
habilitada. No cambia objetivo funcional, guarda inicial/V1, recuperación previa
al permiso o reglas pendientes. Siguiente: arnés Mongo opt-in preparado sin
conexión, con ejecución real autorizada aparte; luego dispatch por intento y
cobertura/aislamiento/retención verificables.
Contrato: [animal-media-promotion-persistence.md](./animal-media-promotion-persistence.md).

### Subbloque 32: preparación del arnés, sin cambio funcional

Arnés Mongo propio para promoción ordinaria, con dos clientes, 26 escenarios de
índices/transacciones/carreras y respuestas perdidas después de commit confirmado.
Preparado/compilado y guardas sin conexión aprobadas; NO ejecutado en Mongo. No
modifica src, handlers, permisos o reglas; sigue sin dispatch o ledger completo.
Siembra opt-in desde creación inicial, sin adoptar journals MAY_RUN anteriores.
Objetivo de histórico exacto y copia independiente intacto, igual que guarda
inicial/V1, recuperación previa al permiso y decisiones funcionales pendientes.
Siguiente: ejecución real solo con autorización del entorno desechable y evidencia
de resultados/limpieza. Luego enlace a callers y cobertura de cada envío/retry;
transferencia completa continúa deshabilitada.
Detalle: [animal-media-promotion-mongo-integration.md](./animal-media-promotion-mongo-integration.md).

### Subbloque 33: validación Mongo local, sin cambio funcional

Persistencia de promociones validada con autorización en MongoDB 8.0.34 y replica
set de un miembro: 26/26 escenarios aprobados. Primer intento 25/26 por clase de
error esperada en el test tras retry de transacción; ajustada esa expectativa y
añadida igualdad de estado. Sin cambiar guardas, reglas o producción. Dos intentos,
52 bases y contenedor eliminados. Sin SDK/dispatch/S3 ni ledger remoto completo.
Objetivo aprobado y decisiones pendientes intactos; guarda inicial/V1 y
transferencia deshabilitada conservadas. Siguiente: identidad a callers y pruebas
de cada envío físico/retry antes de integrar dispatch.
Evidencia: [animal-media-promotion-mongo-validation.md](./animal-media-promotion-mongo-validation.md).

### Subbloque 34: enlace de identidad, sin cambio de reglas funcionales

Confirmaciones HTTP de foto/diario enlazan contexto interno inmutable a su journal
opt-in desde creación, tras adquisición/permiso reconocidos. AnimalMediaUploads
valida scope/tipo, sin adoptar legacy ni crear efectos. La marca no demuestra
dispatch cubierto; persistencia de efectos sigue fuera del grafo. No se alteran
HTTP/éxitos, recuperación o decisiones de negocio. Objetivo exacto/independiente,
guarda inicial/V1 y transferencia deshabilitada conservados. Siguiente: pruebas
de cada envío físico/retry con transporte falso antes de dispatch.
Contrato: [animal-media-confirmation-context.md](./animal-media-confirmation-context.md).

### Subbloque 35: validación del SDK, sin cambio funcional

Veintiocho escenarios con SDK instalado/handler y peticiones nativas falsos,
cero sockets: retries/redirects, errores dentro de HTTP 200 y límites de contadores.
Probes de permisos/revocación solo de test; producción no gana garantías nuevas.
No cambian reglas de negocio, contratos HTTP, recuperación o guarda inicial/V1.
Transferencia deshabilitada. Siguiente: wrapper interno del handler con definición
y autorización por delegación, antes de integrar callers o dispatch operativo.
Evidencia: [animal-media-promotion-transport.md](./animal-media-promotion-transport.md).

### Subbloque 36: dispatcher interno, sin habilitación funcional

Una invocación por efecto nuevo ya declarado, request fijado y autorización nueva
por delegación/retry; NodeHttpHandler propio y errores de persistencia terminales.
No se integra a HTTP, sellado o callers actuales. Resultados del handler conservan
UNKNOWN, sin fin remoto/rollback; revocar no borra permisos anteriores. Sin cambios
de reglas aprobadas, recuperación previa o guarda inicial/V1. Transferencia
deshabilitada. Falta cerrar ticket/pin/sellado concurrente antes de integración.
Contrato: [animal-media-promotion-dispatcher.md](./animal-media-promotion-dispatcher.md).

### Subbloque 37: fence del ticket, sin nuevas reglas de negocio

Declaración/intención/autorización escriben CAS del ticket ordinario fijado y no
sellado en la misma transacción que journal/control/puerta, revalidando definición/
hash. Sello ganador impide permiso nuevo; si permiso ganó, sellar no lo borra ni
demuestra fin remoto, incluso antes del envío. No se prohíbe el seal actual ni se
crea propiedad exclusiva del ticket. Evidencia tardía sigue disponible. Guardas
probadas con dobles, dos carreras Mongo añadidas y compiladas sin ejecución real.
Callers/HTTP sin integración ni cambios; objetivo exacto/independiente, guarda
inicial/V1, recuperación previa y decisiones pendientes intactos. Transferencia
deshabilitada. Falta arnés combinado y verificación/sellado antes de callers.
Contrato: [animal-media-promotion-ticket-fence.md](./animal-media-promotion-ticket-fence.md).

### Subbloque 38: arnés combinado preparado, sin habilitación funcional

21 escenarios Mongo + dispatcher real con HTTP falso preparados y compilados,
sin ejecutarlos. Comando/opt-in/namespace nuevos y guardas de socket; 57 pruebas
sin conexión y regresión seleccionada 97/1590 aprobadas. No cambian reglas de
negocio, HTTP, callers, modelo o persistencia de producción. No se verifica/sella
desde una respuesta sintética ni se acredita cierre remoto. Objetivo exacto/
independiente, guarda inicial/V1 y decisiones pendientes conservados; transferencia
deshabilitada. Siguiente ensayo requiere autorización específica del entorno
concreto y registro de resultados/limpieza. Verificación/sellado antes de callers.
Contrato: [animal-media-promotion-dispatch-mongo-integration.md](./animal-media-promotion-dispatch-mongo-integration.md).

### Subbloque 39: ensayo Mongo autorizado, sin cambio funcional

28/28 casos de persistencia y 21/21 de dispatcher con HTTP falso aprobados en
primera pasada, Mongo local 8.0.34/FCV 8.0 de un miembro, con autorización específica.
49 bases verificadas ausentes y contenedor retirado. Sin cambios de código/tests,
HTTP o reglas de negocio; no prueba AWS, fin remoto, retención/corte o commit
conjunto. Objetivo exacto/independiente, guarda inicial/V1, recuperación previa y
decisiones pendientes intactos. Transferencia deshabilitada. Siguiente: contrato/
colaborador de verificación y sellado aislados, antes de callers y mapeo HTTP.
Otra ejecución real requiere nueva autorización del entorno.
Evidencia: [animal-media-promotion-dispatch-mongo-validation.md](./animal-media-promotion-dispatch-mongo-validation.md).

### Subbloque 40: verificación/sellado internos, sin cambio de negocio

Colaborador separado para bytes/revisión HEAD/GET condicionado/HEAD y persistencia
transaccional de MATCH+sello, con fences actuales de journal/control/puerta/ticket.
Sin copiar/borrar S3, atribuir causalidad o descargar permisos; una observación no
autoriza transferir ni prueba retención/fin remoto. Fuera de HTTP/Nest/callers,
flujo vigente conservado. 85 pruebas nuevas con dobles y regresión 99/1675 aprobadas;
método nuevo sin validación Mongo real. Objetivo exacto/independiente, guarda
inicial/V1, recuperación previa y decisiones abiertas intactos. Transferencia
deshabilitada. Siguiente: extensión del arnés antes de integrar ciclo/mapeo HTTP.
Contrato: [animal-media-promotion-verification.md](./animal-media-promotion-verification.md).

### Subbloque 41: ensayo de sellado preparado, sin cambio funcional

23 casos Mongo+SDK readonly preparados y compilados, sin ejecutarlos. Opt-in y
namespace separados, transporte HEAD/GET falso y 50 pruebas nuevas sin conexión
aprobadas; regresión seleccionada 100/1725. Sin cambios en src, contratos HTTP,
reglas o permisos; los grants previos conservan incertidumbre. Objetivo exacto/
independiente, guarda inicial/V1, recuperación previa y decisiones pendientes
intactos. Transferencia deshabilitada. Entorno propuesto para 23+49 casos requiere
autorización específica antes de ejecutar/registrar limpieza y avanzar a callers.
Contrato: [animal-media-promotion-seal-mongo-integration.md](./animal-media-promotion-seal-mongo-integration.md).

## 7. Referencias técnicas contrastadas

- [AWS: transactional outbox](https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html): guardar cambios y eventos juntos y entregar después con manejo de duplicados.
- [MongoDB: transacciones](https://www.mongodb.com/docs/manual/core/transactions/): consistencia de cambios que afectan múltiples registros; verificar topología compatible.
- [Firebase: recepción de mensajes en Flutter](https://firebase.google.com/docs/cloud-messaging/flutter/receive-messages): atender primer plano, segundo plano y apertura desde una notificación si se elige FCM.
