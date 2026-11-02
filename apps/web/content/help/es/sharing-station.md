---
title: La Sharing Station
summary: Un segundo dispositivo donde los invitados encuentran su captura por código, la tocan y escanean su código QR, sin tocar la cabina.
category: sharing
order: 20
keywords:
  [sharing station, estación, segunda pantalla, tableta, buscar por código, escanear, cola, invitados, fila, quiosco]
updated: 2026-10-28
related: [live-display-pairing, live-display-moderation, kiosk-locking, faq-guest-lost-qr]
---

En un evento concurrido, la pantalla de resultado de la cabina solo está encendida un rato. La Sharing Station es una segunda tableta o computadora, colocada a cierta distancia de la cabina, adonde los invitados pueden volver por su captura cuando quieran: la encuentran, la tocan y escanean el código QR que aparece.

## Ábrela

1. Comprueba que **Mostrar las capturas en pantallas** esté activado en la pestaña **Live Display** del evento. La Sharing Station muestra las mismas capturas que las pantallas y nada más, así que con Live Display desactivado se queda vacía.
2. En la pestaña **Live Display** pulsa **Abrir la Sharing Station**. Se abre en una pestaña nueva. También puedes ir directamente a la dirección `/station/` seguida del id del evento.
3. En el dispositivo que será la estación, inicia sesión en el Studio con una cuenta de operador. La estación usa la cuenta con la sesión iniciada, así que una cuenta de lector no puede abrirla.
4. Pulsa **Iniciar la Sharing Station**. Mantiene la pantalla encendida y pasa a pantalla completa si el evento tiene un PIN de salida.

## Qué ven los invitados

- Las capturas más recientes primero, como imágenes con sus códigos de seis caracteres.
- Una casilla para **Buscar por código**: al escribir unos pocos caracteres la lista se reduce. Un código que aún no está dice **Todavía no hay una captura con ese código. Puede que siga en camino.**
- Al tocar una captura se abre en grande, con su código QR, el código en letra grande y **Escanéalo con la cámara de tu teléfono para descargarla.** Tras 45 segundos sin tocar nada la vista grande se cierra sola, para que el siguiente invitado no vea la captura de otra persona.
- Si se corta la conexión, la estación conserva lo que tiene y dice **Sin conexión: se muestra lo que ya estaba aquí**.

La lista sigue las reglas de Live Display: solo aparecen las capturas que están en pantalla, lo que significa que una captura que ocultaste, una que sigue esperando aprobación y una cuyo invitado pidió no salir en pantalla no están. Consulta [Moderar lo que sale en pantalla](help:live-display-moderation). Se conservan las 200 capturas más recientes.

## Mantén a los invitados en la estación

La estación usa el mismo PIN de salida que la cabina. Con un PIN definido para el evento, funciona a pantalla completa con la misma esquina oculta para el operador (toca tres veces la esquina superior izquierda). Consulta [Bloquear la cabina para los invitados](help:kiosk-locking).

Un invitado que escanea un código en la estación llega a la misma página que uno que escaneó el código de la cabina.
