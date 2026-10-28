---
title: Bloquear la cabina para los invitados (modo quiosco)
summary: Define un PIN de salida y añade el Acceso guiado de iOS, la fijación de pantalla de Android o el modo quiosco de Chrome cuando los invitados no deban salir de la cabina. Un navegador no puede bloquear un dispositivo del todo.
category: booth
order: 50
keywords:
  [
    quiosco,
    bloqueo,
    pin,
    acceso guiado,
    fijar pantalla,
    fijación de apps,
    pantalla completa,
    sin supervisión,
    ipad,
    tableta,
    salir,
    operador,
    triple toque,
  ]
updated: 2026-10-28
related: [chrome-kiosk-printing, 360-booth-setup, sharing-station]
---

> [!WARNING]
> Una página web no puede bloquear un dispositivo por completo. El bloqueo de quiosco de Immersia mantiene las manos curiosas fuera de la pantalla de la cabina, pero un invitado decidido aún puede salir de la pantalla completa, cerrar la pestaña o cambiar de app. Para un evento que nadie vigila, combínalo con el bloqueo propio del dispositivo: Acceso guiado, fijación de pantalla o el modo quiosco de Chrome, descritos abajo.

## El bloqueo de quiosco integrado en la cabina

En la **Configuración** del evento, en **Quiosco**, pulsa **Guardar PIN** y elige de 4 a 8 dígitos. Con un PIN definido:

- Al pulsar **Iniciar cabina**, la cabina pasa a pantalla completa, donde el navegador lo permite (los navegadores del iPhone en general no).
- Los controles del operador desaparecen: el enlace de vuelta, la cola de renderizado, la galería y los ajustes. Los invitados ven el nombre del evento y la cabina.
- Salir de la pantalla completa (por ejemplo con Escape) muestra una pantalla **Toca para volver al fotomatón**.
- El navegador pide confirmación antes de cerrar o recargar la pestaña (la mayoría solo lo hacen una vez que se ha tocado la página).

El PIN se comprueba en la propia cabina, así que funciona sin internet. El dispositivo recibe solo una huella del PIN, nunca el PIN en sí.

### Salir como operador

1. **Toca tres veces la esquina superior izquierda de la pantalla** en un segundo y medio. La esquina no tiene ningún botón visible, pero es un objetivo generoso.
2. Escribe el PIN y pulsa **Desbloquear**.
3. Cinco PIN incorrectos pausan el teclado durante 30 segundos.

Quita o cambia el PIN en **Configuración** para desactivar el bloqueo en el siguiente evento: **Quitar PIN**.

La Sharing Station usa el mismo bloqueo. Consulta [La Sharing Station](help:sharing-station).

## iPad y iPhone: Acceso guiado

El Acceso guiado mantiene el dispositivo en una sola app y puede desactivar los botones físicos y partes de la pantalla.

1. Abre **Ajustes**, luego **Accesibilidad**, luego **Acceso guiado**, y actívalo.
2. Define un código.
3. Abre la cabina en Safari o, mejor, desde el icono de la pantalla de inicio (Compartir, luego **Añadir a pantalla de inicio**), que funciona sin las barras de Safari.
4. Pulsa tres veces el botón lateral (o el botón de inicio en los modelos que lo tienen) y elige **Acceso guiado**. En **Opciones** puedes desactivar los botones, el teclado y el tacto.
5. Pulsa **Comenzar**.

Para terminarlo, vuelve a pulsar tres veces y escribe el código.

## Android: fijación de pantalla

1. Abre **Ajustes**, busca **Fijación de apps** (en los teléfonos Samsung se llama **Fijar ventanas**) y actívala. Activa la opción de pedir el PIN antes de dejar de fijar, para que los invitados no puedan deshacerlo.
2. Abre la cabina en Chrome.
3. Abre la pantalla de apps recientes, toca el icono de la app en la parte superior de su tarjeta y elige **Fijar**.

Para dejar de fijar, mantén pulsados a la vez los botones Atrás y Recientes, o desliza hacia arriba y mantén, según tu estilo de navegación, y escribe el PIN.

## Windows, macOS y Linux: modo quiosco de Chrome

Iniciar Chrome con `--kiosk` abre una página a pantalla completa, sin barra de direcciones ni pestañas:

```text
chrome.exe --kiosk "https://your-address/booth/EVENT-ID"
```

Esto oculta los controles pero no bloquea el teclado: Alt+F4 en Windows o Comando+Q en una Mac todavía lo cierran. Esconde el teclado, o dale a la cabina su propia cuenta de usuario limitada. Windows tiene un modo de acceso asignado (quiosco) para eso, y una directiva de dispositivo administrado da un bloqueo real en cualquier plataforma.

También puedes añadir `--kiosk-printing` para imprimir en silencio, consulta [Imprimir sin cuadro de diálogo](help:chrome-kiosk-printing).

## Evita también que la pantalla se apague

La cabina le pide a la pantalla que se mantenga encendida mientras está abierta, pero el navegador puede negarse (el ahorro de batería, por ejemplo). Mantén el dispositivo conectado a la corriente y pon el bloqueo automático en **Nunca** en los ajustes del propio dispositivo.
