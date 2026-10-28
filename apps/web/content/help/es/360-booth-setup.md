---
title: Configurar una cabina 360
summary: Los ajustes que dan forma a un video 360 (resolución, fotogramas por segundo, duración del giro, cuenta atrás, calidad) y cómo elegirlos.
category: booth
order: 10
keywords:
  [
    360,
    giro,
    plataforma,
    video,
    resolución,
    4k,
    fps,
    relación de aspecto,
    vertical,
    cuenta atrás,
    calidad,
    micrófono,
    sonido,
  ]
updated: 2026-10-28
related: [slow-motion-tips, capture-triggers-and-shortcuts, render-speed-and-queue, setup-check]
---

Una cabina 360 graba una toma continua mientras la plataforma gira, y luego renderiza el video terminado en el dispositivo. Abre el evento, ve a **Configuración** y busca la sección **Video 360**.

## El video

| Ajuste                     | Opciones                              | Notas                                                                    |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------------ |
| **Resolución**             | 720p, 1080p, 4K                       | 1080p por defecto. 4K solo donde la cámara lo admite.                    |
| **Fotogramas por segundo** | 30 fps, 60 fps                        | 60 fps por defecto. 60 fps da una cámara lenta más suave.                |
| **Relación de aspecto**    | 9:16, 1:1, 16:9                       | 9:16 es un video vertical pensado para teléfonos.                        |
| **Duración del giro**      | De 3 a 20 segundos, de medio en medio | 8 segundos por defecto. La grabación se detiene sola pasado este tiempo. |
| **Cuenta atrás**           | De 0 a 10 segundos                    | 3 segundos por defecto.                                                  |
| **Calidad**                | Pequeña, Equilibrada, Original        | Equilibrada son unos 8 a 12 MB para un clip de 15 s en 1080p.            |
| **Grabar sonido**          | Activado o desactivado                | Desactivado por defecto: la banda sonora sale de la música del evento.   |

En 1080p un video 9:16 mide 1080 × 1920 píxeles; en 4K, 2160 × 3840. La grabación que sale de la cámara se guarda en el dispositivo con una tasa de bits alta y el video del invitado se hace a partir de ella, así que una calidad de salida menor no rebaja el original que conservas hasta que lo elimines.

> [!TIP]
> Más alto no siempre es mejor. 4K a 60 fps exige mucho a la cámara y al dispositivo que renderiza. Haz la [prueba de configuración](help:setup-check) con los ajustes que pienses usar. Si el renderizado tarda demasiado, 1080p a 30 fps es la alternativa sensata.

## Cámara lenta y reversa

La cámara lenta ralentiza una parte del giro y reproduce el resto a velocidad normal. **Reversa** puede reproducir esa parte hacia delante y hacia atrás (**Boomerang**) o añadir el clip otra vez, invertido, al final (**Invertido**). Consulta [Cámara lenta y fotogramas por segundo](help:slow-motion-tips).

## Cómo empezar un giro

**Iniciar una captura**, en la misma página de Configuración, decide qué inicia una grabación:

- **Tocar la pantalla**: el invitado toca el botón de inicio.
- **Teclado y mandos Bluetooth**: Espacio, Intro o los botones de página de un mando. Consulta [Empezar con un teclado, un mando o el movimiento, y atajos de teclado](help:capture-triggers-and-shortcuts).
- **Movimiento**: la grabación empieza cuando la plataforma empieza a girar. El ajuste **Movimiento necesario** decide cuánto de la imagen debe moverse de lado; un valor más bajo empieza antes.

También puedes añadir un clip ya grabado, por ejemplo uno filmado con la app de cámara de un teléfono: en **Ajustes de la cabina** pulsa **Elegir archivos** en **Importar videos**, o arrastra archivos de video a la pantalla de la cabina. Se renderizan como cualquier otra toma.

## Hazlo tuyo

En la pestaña **Marca** añades una superposición, una intro y un cierre, música, un estilo de color, efectos y un fondo de reemplazo. Consulta [Plantillas y editor de diseño](help:templates-and-editor) y [Estilos, efectos y reemplazo del fondo](help:looks-and-effects).

## En la cabina

Abre **Ajustes de la cabina** (el botón de controles deslizantes en la esquina) para elegir la cámara y la lente, ajustar el zoom, la luz de la cámara o una luz de relleno en pantalla, y reflejar la vista previa. El reflejo solo afecta a la pantalla; las grabaciones nunca se reflejan. La luz de relleno es un marco luminoso alrededor de la pantalla que ilumina la cara de los invitados; no aparece en las grabaciones.

La cabina le pide a la pantalla que se mantenga encendida mientras está abierta. Mantén el dispositivo conectado a la corriente y evita también que se suspenda desde sus propios ajustes. Consulta [Bloquear la cabina para los invitados](help:kiosk-locking).

## Lo que recibe el invitado

Justo después del giro, la cabina muestra un código QR y un código corto. La página del invitado se abre al instante y se completa cuando el video está listo, normalmente en uno o dos minutos. Consulta [Cómo reciben los invitados sus fotos y videos](help:sharing-with-guests) y [Velocidad de renderizado y cola de renderizado](help:render-speed-and-queue).
