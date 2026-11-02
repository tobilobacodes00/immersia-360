---
title: 'Imprimir sin cuadro de diálogo: impresión de quiosco de Chrome'
summary: Inicia Chrome con --kiosk-printing en Windows, macOS o Linux para que las tiras vayan directamente a la impresora predeterminada, y qué preparar antes.
category: photo
order: 30
keywords:
  [
    kiosk-printing,
    impresión silenciosa,
    impresión automática,
    sin cuadro de diálogo,
    opción de chrome,
    impresora predeterminada,
    acceso directo,
    línea de comandos,
    windows,
    mac,
    linux,
  ]
updated: 2026-10-28
related: [printing-setup, kiosk-locking, setup-check]
---

Normalmente una página web no puede imprimir sin preguntar. El navegador muestra su cuadro de impresión y alguien tiene que pulsar **Imprimir**. Para **Imprimir automáticamente** en un evento eso no sirve. Chrome (y los navegadores basados en Chromium, como Edge) tiene una opción de inicio, `--kiosk-printing`, que se salta el cuadro de diálogo y envía el trabajo directamente a la **impresora predeterminada**.

> [!NOTE]
> Esto solo funciona en Chrome u otro navegador Chromium en una computadora con Windows, macOS o Linux. Safari, Firefox, los iPad, los iPhone y los dispositivos Android siempre muestran su cuadro de impresión.

## Antes de empezar

1. **Define la impresora predeterminada** en tu sistema operativo como la impresora del evento. Los trabajos silenciosos van solo a ella.
2. **Haz primero una impresión normal.** Con Chrome abierto en la cabina, imprime una prueba (la prueba de impresora de la [prueba de configuración](help:setup-check) es ideal) y, en el cuadro de diálogo, elige el **tamaño de papel** correcto, **márgenes: Ninguno** y **escala: 100 %**. En el modo de impresión de quiosco Chrome sigue usando las opciones de la última impresión, así que tienen que estar bien una vez. Consulta [Imprimir al tamaño correcto](help:printing-setup).
3. **Cierra Chrome por completo.** La opción solo surte efecto cuando Chrome arranca de nuevo. Si Chrome ya está en ejecución, incluso en segundo plano, se abre una ventana nueva en el proceso antiguo y la opción se ignora. En Windows revisa la bandeja del sistema; en una Mac usa **Chrome > Salir de Google Chrome**.

## Windows

1. Haz clic derecho en el escritorio y elige **Nuevo > Acceso directo**.
2. En la ubicación, escribe la ruta de Chrome con la opción detrás:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing
   ```

3. Ponle de nombre _Cabina_ y abre la cabina siempre desde este acceso directo.

Para Microsoft Edge usa `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing`. Si tu Chrome está en otro sitio, haz clic derecho en su acceso directo normal, elige **Propiedades** y copia el **Destino**.

## macOS

En Terminal:

```text
open -na "Google Chrome" --args --kiosk-printing
```

`--args` pasa todo lo que va detrás a Chrome. Para un lanzador en el que puedas hacer doble clic, abre **Editor de Scripts**, escribe `do shell script "open -na 'Google Chrome' --args --kiosk-printing"` y elige **Archivo > Exportar** con el formato **Aplicación**.

## Linux

```text
google-chrome --kiosk-printing
```

El nombre del programa varía (`google-chrome-stable`, `chromium`). Añádelo a un lanzador o a una entrada de inicio automático si quieres que la cabina arranque sola.

## Combínalo con el modo quiosco

Para una cabina sin supervisión, inicia Chrome con las dos opciones para que la página esté en pantalla completa e imprima en silencio:

```text
chrome.exe --kiosk --kiosk-printing "https://your-address/booth/EVENT-ID"
```

Consulta [Bloquear la cabina para los invitados](help:kiosk-locking) para saber hasta dónde llega ese bloqueo.

## Comprueba que funciona

Abre la cabina desde el nuevo acceso directo, conserva una tira y deja que se imprima. El trabajo debería llegar a la impresora sin cuadro de diálogo. Si el cuadro sigue apareciendo, Chrome ya estaba en ejecución: ciérralo por completo y empieza de nuevo desde el acceso directo.

> [!TIP]
> La impresión automática y el botón **Imprimir** usan este mismo camino, y un trabajo fallido no impide que el invitado reciba su código QR. Si un atasco de papel detiene las impresiones, soluciónalo y pulsa **Imprimir** otra vez en la pantalla de resultado del invitado.
