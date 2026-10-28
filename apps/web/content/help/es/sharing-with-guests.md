---
title: Cómo reciben los invitados sus fotos y videos
summary: El código QR, el código corto, WhatsApp, SMS y correo, la página del invitado y los ajustes que lo controlan.
category: sharing
order: 10
keywords:
  [
    qr,
    compartir,
    enlace,
    código,
    whatsapp,
    sms,
    mensaje de texto,
    correo,
    descargar,
    página del invitado,
    código corto,
    guardar en fotos,
    versión más ligera,
  ]
updated: 2026-10-28
related: [guest-privacy, gallery-and-zip-export, expiry-and-extending, faq-guest-lost-qr]
---

Los invitados nunca se registran. Escanean un código y su página se abre en el navegador del teléfono.

## En la cabina

Justo después de la captura, la cabina muestra la **pantalla de resultado**: un código QR para la página del invitado y un código corto escrito con letras debajo ("¿Sin cámara? Entra en _dirección_ y escribe" y el código). El enlace del invitado ya funciona en ese momento, aunque la cabina esté sin conexión; la página dice **Tus archivos están en camino** hasta que llega la subida, y se actualiza sola. La pantalla de resultado vuelve a la pantalla de inicio tras 45 segundos sin tocarla, o cuando pulsas **Siguiente invitado**.

Las pestañas bajo el código QR cambian lo que hace el código:

- **Enlace** abre la página del invitado.
- **WhatsApp** abre WhatsApp en el teléfono del invitado con un mensaje y su enlace listos para enviar.
- **SMS** abre la app de mensajes con lo mismo.

La cabina nunca ve un número de teléfono. Y **Envíame el enlace** permite a un invitado escribir una dirección de correo; el enlace se envía desde el servidor y la dirección se usa para ese único mensaje y no se guarda. Una sesión se puede enviar por correo hasta cinco veces por hora, y un dispositivo de cabina 120 veces por hora.

## Los ajustes

En la **Configuración** del evento, en **Compartir**:

| Ajuste                                         | Qué hace                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Código QR en pantalla**                      | Muestra el código en la pantalla de resultado.                                                                                                    |
| **Correo**, **Mensaje de texto**, **WhatsApp** | Ofrece esas formas de enviar el enlace.                                                                                                           |
| **Versión más ligera para mensajería**         | Hace una copia más ligera de los videos 360 que se envía rápido por WhatsApp (de unos 720p).                                                      |
| **Código QR en las impresiones**               | Un pequeño código en cada impresión abre la copia digital. Consulta [Imprimir al tamaño correcto](help:printing-setup).                           |
| **Código QR al final de los videos**           | Una tarjeta final de 2 segundos, para que un video reenviado siga llevando a la descarga.                                                         |
| **Pedir datos a los invitados**                | Un formulario opcional de nombre y correo con una casilla de consentimiento. Consulta [Privacidad de los invitados](help:guest-privacy).          |
| **Contacto para invitados**                    | Se muestra cuando los archivos del evento han caducado, para que los invitados puedan contactarte.                                                |
| **Copiar también a mi nube**                   | Una copia de cada archivo en tu propio Google Drive o Dropbox. Consulta [Copiar todos los archivos a tu Google Drive](help:connect-google-drive). |

## La página del invitado

La página se abre rápido, muestra primero una imagen de portada y luego el video, la tira o el GIF. Un invitado puede:

- **Descargar** el archivo. Los archivos se nombran con el evento y un número si activaste **Numerar los archivos**.
- **Guardar en Fotos** en un teléfono, o **Compartir**.
- Ver la fecha en que se eliminarán los archivos: **Los archivos se eliminan el …. Descarga lo que quieras conservar.**
- Eliminar sus propios archivos. Consulta [Privacidad de los invitados](help:guest-privacy).

En la página puede haber varias versiones: un video y un video más ligero, un GIF, una tira de fotos, un boomerang, un video corto.

## Un invitado sin el código QR

Cada captura tiene un código de seis caracteres, como `K7M-2QX`, hecho de letras y números sin caracteres fáciles de confundir (nunca I, L, O, 0 ni 1). El invitado puede escribirlo en la dirección que aparece en la pantalla de resultado, que es la página `/c` de este sitio o tu dominio corto, y llegar a sus archivos. También puede buscarlo en la galería del evento. Consulta [Un invitado perdió su código QR](help:faq-guest-lost-qr).

> [!TIP]
> Antes del evento, escanea un código real con un teléfono y mira cómo aparece la página. La [prueba de configuración](help:setup-check) hace justo eso, y además prueba la ruta de subida.
