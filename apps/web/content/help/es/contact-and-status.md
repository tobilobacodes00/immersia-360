---
title: Contacto y estado del servicio
summary: Cómo contactarnos, en cuánto tiempo respondemos (en un plazo de 2 días hábiles), qué incluir y la página pública de estado.
category: account
order: 20
keywords:
  [
    soporte,
    contacto,
    correo,
    ayuda,
    estado,
    caída,
    incidente,
    no funciona,
    tiempo de respuesta,
    días hábiles,
    informar de un problema,
  ]
updated: 2026-10-28
related: [setup-check, booth-error-messages, guest-privacy]
---

## Contáctanos

Usa el formulario **Contáctanos** que está al final del [centro de ayuda](/help), o escribe a la dirección de soporte que aparece en el formulario y en la [página de estado](/status). Los dos van a la misma bandeja, y al responder a nuestra respuesta llegas a la persona que la escribió.

**Respondemos en un plazo de 2 días hábiles** (de lunes a viernes), a menudo antes. Si es urgente porque hay un evento en marcha, dilo al principio de tu mensaje; la respuesta es más rápida cuando viene con los datos de abajo.

El centro de ayuda está abierto a todo el mundo, con la sesión iniciada o sin ella, así que puedes contactarnos aunque no puedas entrar al Estudio. Por favor, no envíes contraseñas ni datos de pago completos. Nunca los necesitamos.

## Qué incluir

Un buen informe son sobre todo hechos:

- **Qué estabas haciendo** y **qué esperabas**.
- **Qué pasó en cambio**, con las palabras exactas de cualquier mensaje. Los mensajes de la cabina están en [Mensajes de la cabina y qué hacer con ellos](help:booth-error-messages).
- **El dispositivo y el navegador**: por ejemplo "iPad (9.ª generación), Safari 18" o "laptop con Windows, Chrome".
- **El nombre del evento** y más o menos **cuándo** ocurrió.
- El resultado de la [prueba de configuración](help:setup-check), si la has hecho en ese dispositivo.

El formulario añade la página desde la que lo enviaste y, si tienes la sesión iniciada, tu cuenta, para que podamos investigarlo.

## Solicitudes de privacidad

Las solicitudes sobre los datos de los invitados, tus propios datos o el aviso de privacidad de este producto van a la misma dirección. Los invitados pueden eliminar sus propios archivos en su página, y los operadores tienen herramientas para el resto. Consulta [Privacidad de los invitados](help:guest-privacy).

## La página de estado

La [página de estado](/status) muestra comprobaciones en vivo de lo que usa Immersia 360:

| Servicio                       | Qué hace                                                                                                                         |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| **Base de datos**              | Cuentas, eventos, dispositivos y enlaces de invitados.                                                                           |
| **Almacenamiento de archivos** | Fotos y videos de los invitados, y sus descargas.                                                                                |
| **Servidor de Live Display**   | Envía las capturas nuevas a las pantallas en menos de un segundo. Opcional: sin él, las pantallas consultan cada pocos segundos. |
| **Correo electrónico**         | Enlaces de inicio de sesión, correos a invitados y respuestas de soporte.                                                        |

Cada uno muestra **Funciona**, **Degradado** (más lento de lo normal), **Caído** o **No configurado** si esta instalación no lo usa. El titular de la página dice **Todos los sistemas funcionan**, **Algunos sistemas van más lentos de lo normal** o **Un sistema está caído**. Las comprobaciones salen directamente de nuestros propios servidores, no de un servicio de estado de terceros, y los resultados se conservan unos 20 segundos para que la página no se pueda usar para sobrecargarlos.

Debajo de las comprobaciones, **Incidentes recientes** lista todo lo que fue mal o fue un mantenimiento programado en los últimos 90 días, con cuándo empezó y terminó, qué afectó y qué pasó. Se escribe a mano cuando ocurre algo.

Los monitores de disponibilidad pueden leer las mismas comprobaciones como JSON en `/api/status`; responde con un estado de error cuando un servicio esencial está caído.

Si la página de estado dice que todo va bien y aun así tienes un problema, probablemente sea el dispositivo o la red del lugar. Haz la [prueba de configuración](help:setup-check) o contáctanos.
