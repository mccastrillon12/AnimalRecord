# Proyección pura de referencias destinatarias

Subbloque 24, 2026-10-26, base `8c90cb4`. Función interna de dominio
`buildArchiveRecipientProjection`, sin llamador operativo, provider nuevo,
endpoint, repositorio, lectura/escritura Mongo, S3 o arranque automático.
**El resultado es un candidato privado en memoria, no una transferencia,
publicación, permiso, estado activo o capacidad canCommit.**

## Contrato

```text
buildArchiveRecipientProjection(archive, entries, files, registrations, urls)
  -> ArchiveRecipientProjection
urls: keyFromUrl(url), urlForKey(key)
```

Recibe el conjunto COMPLETO del archivo preparado, no una página ni referencias
arbitrarias de un cliente. Las listas pueden venir en distinto orden. Requiere
la reservation original válida y sin marcador evidenceConsumption, READY,
REFERENCE_PLAN_V1 PLANNED y materialización GENERATIONAL_V1 MATERIALIZED.
No convierte preparaciones V1 o cabeceras anteriores sin reservation.

Reconstruye cada plan desde payload/bindings/manifiesto y lo compara entero con
el persistido. Reconstruye cada registro PREPARED desde la intención generacional
VERIFIED y exige coincidencia completa, salvo _id/__v propios de Mongo. Rechaza
leases presentes, cambios de identidad/revisión/digest/ruta/modo/procedencia,
registros faltantes/sobrantes, duplicados y archivos sin referencias. Un archivo
compartido se valida en TODOS sus usos y se representa una sola vez en media.

Valida conteos de cabecera, cursor final, una ficha vigente, cobertura exacta de
archivos/registros y conteos de antecedentes/archivos retenidos. Revisa identidad
raíz/inmediata y su relación con history; no vuelve a cargar el archivo predecesor
ni certifica por sí sola la procedencia frente a datos externos al conjunto.
Validar hashes locales no es una firma o autenticación.

Primero valida el conjunto entero. Después clona cada payload con structuredClone
y resuelve los destinos efectivos del registro generacional comprobado. No usa
plannedFinalKey como destino activo, no conserva staging y no sondea ni adopta
objetos de otra generación. Solo cambia estos campos en la COPIA:

| Clase fuente | Cambios del candidato |
| --- | --- |
| ANIMAL vigente | ownerId del destinatario y profilePictureUrl si existe |
| DIARY_ENTRY vigente | attachments[i].url; no agrega/cambia propietario |
| MEDICAL_DOCUMENT vigente | ownerId, storageKey y documentLocations[0].storageKey |
| RETAINED_RECORD | Las mismas referencias según clase raíz; mantiene dueño original, identidad y procedencia; modo RETAINED_READ_ONLY |

Solo se admiten los paths conocidos reconstruidos; no aplica JSON pointers
genéricos ni rutas __proto__/constructor recibidas del llamador. El resto del
contenido es opaco y se conserva: UUID/código, nombres/nameHistory, fechas,
categoría, extracción, códigos médicos, versión, documentGroupId, acceptedAt,
asignaciones y campos vacíos. No interpreta clínica ni reinicia las 48 horas.
Un antecedente no se convierte en registro vigente ni cambia de identidad.

Los codecs son funciones síncronas PURAS, deterministas y de confianza del
backend. keyFromUrl debe restringirse al origen configurado; urlForKey debe
renderizar la URL del mismo origen, sin firmar, consultar red o leer configuración
cambiante por llamada. Cada URL emitida debe ser HTTPS, sin credenciales, query
o fragmento y resolver de vuelta a la misma key. No hay un adapter/configuración
nuevo en este bloque. Los codecs no se reciben de Flutter. Un fallo de codec
se propaga sin devolver un candidato parcial ni modificar entradas.

## Resultado e integración futura

ARCHIVE_RECIPIENT_PROJECTION_V1 contiene definición original explícita, hash/epoch
de reservation, hash del progreso de planes, definición de materialización,
entries y media. Las entries conservan ID/clase/modo/hash de fuente/plan y
procedencia, junto al payload candidato y vínculos a registros. media contiene
solo registros reconstruidos, con key/revisión/digest/procedencia PREPARED.
projectionHash es el hash canónico del resultado sin ese mismo campo.

Ordena entries por ID y media por fileId. No genera UUIDs o timestamps; mismos
datos/codecs producen el mismo candidato aun si el orden de entrada cambia.
No modifica ni comparte objetos mutables con las entradas. El resultado puede
ser modificado por quien lo recibe; hacerlo invalida su projectionHash y no
otorga ningún permiso de persistencia. No se guarda/loguea ni expone en HTTP:
contiene información privada y URLs/keys completas, no una bitácora técnica.

No recibe sesión/control/período/corrida S3, no compara las revisiones actuales
del control y no exige METADATA_OBSERVED/S3_OBSERVED para calcular un candidato.
Puede calcular sobre datos que después queden obsoletos. El epoch/hash aquí es
contexto local, no una comprobación de reserva vigente ni fin remoto. Tampoco
consume evidencia o prueba autorización del destinatario/OTP/decisión.

El futuro llamador deberá leer datos coherentes, autenticar/autorizar y revalidar
fences/reserva/observaciones dentro del protocolo del commit conjunto. No aplicar
estos payloads mediante PUT animal/diario/documento, activar registros PREPARED,
ni guardar propietario y referencias por separado. El consumo confirmado previo
cierra el archivo; esta función lo rechaza, no lo reabre o reconstruye como replay
de negocio. Una operación incierta requiere resultado durable/idempotencia de
negocio; projectionHash no los sustituye. Corte estable, retención y permisos
históricos siguen siendo requisitos separados.

## Validación y compatibilidad

Una suite nueva con 57 casos sintéticos: ficha/foto, diario con archivos
compartidos, claves médicas duplicadas, antecedentes y devolución a A, objeto
congelado, aislamiento de salidas, determinismo/orden, expediente sin archivos,
metadatos Mongo, conjunto/procedencia/fences locales alterados, paths extra,
URLs incorrectas y fallo de codec. Primer intento corrigió solo la preparación
del fixture de devolución: su progreso de plan aún tenía el hash anterior del
destinatario. No se relajó la implementación para aceptar ese estado incoherente.

Regresión seleccionada: **83 suites/1130 pruebas** aprobadas (antes 82/1073).
Build, ESLint de TODOS los TypeScript nuevos/modificados, compilación de los
arneses y git diff --check aprobados. No se ejecutaron Mongo/S3/AWS, Docker,
infraestructura, migraciones, despliegues, commits o push. Las quince pruebas
Mongo del subbloque 23 validan otro alcance, no integración de este proyector.
Ocho suites globales heredadas con fallos siguen separadas; no se declara verde
la suite global.

Sin cambios de esquemas/índices/dependencias o contratos públicos. Compatibilidad,
integración/errores/riesgos centralizados en
[frontend-animal-transfer-foundations.md](./frontend-animal-transfer-foundations.md).
No hay nuevos ajustes Flutter. Transferencia completa deshabilitada; no cambia
cancelación/vencimiento o recuperación de legacy/MAY_RUN por edad/error.

Siguiente bloque: lectura interna coherente del conjunto para este proyector,
bajo sesión del futuro llamador y comprobación de fences/reserva, con pruebas de
deriva/consumo concurrente; sin escrituras de negocio o publicación. Después,
integración del commit conjunto y evidencia remota, permisos/retención/captura
posterior/OTP/solicitudes/notificaciones. No levantar la guarda inicial todavía.
