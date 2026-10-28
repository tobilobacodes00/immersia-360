---
title: Mensajes de la cabina y qué hacer con ellos
summary: Todos los avisos y errores que puede mostrar la cabina (cámara, grabación, guardado, renderizado, subidas, fondo) con la solución de cada uno.
category: troubleshooting
order: 20
keywords:
  [
    error,
    aviso,
    mensaje,
    falló,
    no se puede decodificar,
    codificador,
    gpu,
    webgl,
    aceleración por hardware,
    grabación no admitida,
    almacenamiento,
    recuperada,
    h.264,
    hevc,
    renderizado fallido,
  ]
updated: 2026-10-28
related: [camera-permissions, render-speed-and-queue, offline-mode-and-uploads, ios-storage-eviction]
---

## Mensajes de la cámara

Aparecen en una tarjeta titulada **La cámara no está disponible**. Pulsa **Intentar de nuevo** después de la solución.

- **Se bloqueó el acceso a la cámara / No se encontró ninguna cámara / Otra aplicación está usando la cámara / Esta cámara no ofrece la resolución o los fps del evento / La cámara solo funciona con una conexión segura (https).** Cada uno tiene pasos en [Solucionar problemas de acceso a la cámara](help:camera-permissions).

### La cámara se desconectó {#lost}

Se soltó un cable o el dispositivo puso la cámara en reposo. Vuelve a conectarla e inténtalo de nuevo.

### Este navegador no puede grabar video {#recording_unsupported}

**"Usa Chrome, Edge o Safari."** El navegador no tiene grabador de video (algunos navegadores de Linux y embebidos no lo tienen). Abre la cabina en una versión actual de Chrome, Edge o Safari.

### Algo salió mal al iniciar la cámara {#unknown}

Cierra las otras apps que usen la cámara, recarga la página e inténtalo de nuevo. Si sigue pasando, reinicia el dispositivo.

## Mensajes de guardado

### Este dispositivo tuvo problemas para guardar la última toma {#storage}

**"Se conservó todo hasta el problema. Revisa el almacenamiento libre."** El dispositivo no pudo seguir escribiendo. Libera espacio (consulta [almacenamiento en iOS](help:ios-storage-eviction)) y mira la toma en la **Cola de renderizado**: lo que se escribió se conserva y se puede renderizar.

### Poco almacenamiento {#lowStorage}

Una etiqueta de la barra superior: quedan menos de 2 GB libres en el dispositivo. Elimina en la **Cola de renderizado** las tomas que ya no necesites y libera otro espacio antes de los siguientes invitados.

### Se recuperó 1 toma interrumpida {#recovered}

La página se cerró o falló durante una grabación. La toma se conservó hasta el último momento guardado, aparece marcada como **Recuperada** en la cola de renderizado y se renderizará como cualquier otra.

## Mensajes de renderizado

Aparecen junto a una toma marcada como **Falló** en la **Cola de renderizado**. Pulsa **Intentar de nuevo** después de la solución.

### Este dispositivo no puede leer el formato del video {#undecodable}

La grabación está en un formato que el navegador no puede decodificar. Ocurre sobre todo con clips importados: video de teléfono en HEVC (el ajuste **Alta eficiencia** del iPhone) en un navegador sin compatibilidad con HEVC. Vuelve a grabar con **Más compatible**, o importa en un dispositivo cuyo navegador lea HEVC. Consulta [Cámara lenta y fotogramas por segundo](help:slow-motion-tips). Es raro en las tomas grabadas por la propia cabina.

### Este navegador no puede codificar el video {#unsupported_encoder}

El navegador no tiene un codificador de video H.264, que necesita el MP4 del invitado. Usa una versión actual de Chrome, Edge o Safari. En Linux, usa Google Chrome en lugar de una compilación de Chromium sin códecs propietarios.

### El codificador dejó de responder {#encoder_stall}

El codificador de video se colgó, a menudo porque el dispositivo anda corto de memoria o está caliente. Cierra otras pestañas y apps, deja que el dispositivo se enfríe e inténtalo de nuevo. Si se repite, reinicia el navegador.

### La aceleración gráfica no está disponible {#gpu}

Los videos se componen con WebGL 2, que necesita el hardware gráfico. Activa **Usar aceleración gráfica cuando esté disponible** (en algunas versiones se llama **Usar aceleración de hardware cuando esté disponible**) en los ajustes del navegador; en Chrome está en **Configuración, Sistema**; actualiza el controlador de gráficos y evita usar la cabina en una sesión de escritorio remoto o una máquina virtual que no tenga gráficos.

### Cancelado {#cancelled}

Pulsaste **Cancelar renderizado**. La toma se queda; pulsa **Intentar de nuevo** para renderizarla más tarde.

### El renderizado falló {#failed}

Un problema inesperado. Pulsa **Intentar de nuevo**. Si vuelve a fallar, cierra otras pestañas, reinicia el navegador y haz la [prueba de configuración](help:setup-check) para averiguar qué no puede hacer el dispositivo.

## Mensajes de subida

**Sin conexión**, **subidas pendientes**, **requiere atención** y **Este dispositivo se eliminó** se explican en [Modo sin conexión y la cola de subidas](help:offline-mode-and-uploads).

## Mensajes del fondo

### El reemplazo de fondo no está disponible en este dispositivo; los invitados verán el fondo real {#background}

El evento reemplaza el fondo, pero este dispositivo no pudo iniciar la función. Necesita el modelo que reconoce a la persona, que el dispositivo descarga la primera vez que se usa estando en línea, y un navegador con gráficos WebGL 2 que funcionen. Conecta el dispositivo a internet, recarga la cabina y haz la [prueba de configuración](help:setup-check). Si sigue fallando, usa un navegador más reciente o un dispositivo más potente, o desactiva el fondo en **Marca**.
