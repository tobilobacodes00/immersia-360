---
title: Cámara lenta y fotogramas por segundo
summary: Elige el tramo y la velocidad de la cámara lenta, y consigue resultados suaves con cámaras de 60 fps o con clips grabados en un iPhone.
category: booth
order: 20
keywords:
  [
    cámara lenta,
    slowmo,
    240 fps,
    120 fps,
    60 fps,
    iphone,
    más compatible,
    hevc,
    h.264,
    importar,
    interpolación,
    boomerang,
  ]
updated: 2026-10-28
related: [360-booth-setup, render-speed-and-queue, booth-error-messages]
---

## Cómo funciona

En la **Configuración** del evento, la **Cámara lenta** ralentiza una parte del giro; el resto se reproduce a velocidad normal.

- El **Tramo en cámara lenta** se da en segundos desde el inicio del giro, por ejemplo de 2 a 6 segundos de un giro de 8. Tiene que terminar dentro del giro; si no, la página te avisa: _El tramo en cámara lenta debe terminar dentro del giro._
- La **Velocidad de la cámara lenta** puede ser 0,125×, 0,25×, 0,5× (por defecto), 0,75× o 1×.
- **Reversa** puede reproducir el tramo hacia delante y hacia atrás (**Boomerang**) o añadirlo invertido al final (**Invertido**).

## Resultados suaves

La cámara lenta necesita fotogramas que mostrar. Para usar solo fotogramas reales, la cámara debe entregar los fotogramas por segundo del video divididos entre la velocidad: un video de 30 fps a 0,5× necesita una cámara de 60 fps, y un video de 60 fps a 0,25× necesita 240 fps. Donde la cámara entrega menos, el renderizador crea los fotogramas intermedios siguiendo cómo se mueven las cosas de un fotograma real al siguiente (interpolación con compensación de movimiento). Se ve suave con un movimiento de giro constante, aunque los gestos rápidos de las manos pueden dejar un leve rastro.

Por eso:

- **Usa una cámara, o un modo de cámara, de 60 fps** y ajusta los **Fotogramas por segundo** a 60 fps. Muchas webcams entregan en silencio 30 fps; la [prueba de configuración](help:setup-check) mide lo que hace la tuya de verdad.
- **Ilumina bien la plataforma.** Las cámaras se ralentizan en salas poco iluminadas para captar luz, y una cámara que baja a 24 fps no puede dar una cámara lenta suave.
- **Mantén corta la parte lenta.** Un tramo de 4 segundos a 0,25× se convierte en 16 segundos de video. Dos o tres segundos de cámara lenta suelen bastar.
- Si un renderizado se ve borroso a una velocidad muy baja, sube la velocidad o acorta el tramo.

## Clips grabados con un teléfono (120 o 240 fps)

Puedes importar archivos de video a una cabina 360: **Ajustes de la cabina**, **Importar videos**, **Elegir archivos**, o arrastra archivos a la pantalla de la cabina. Los clips grabados a 120 o 240 fps conservan sus fotogramas reales, así que la cámara lenta que sale de ellos es todo lo suave que puede ser. Cada clip importado se convierte en una toma, recibe un código QR para el invitado y se renderiza en segundo plano.

### iPhone: elige "Más compatible"

Un iPhone graba por defecto en el formato **Alta eficiencia**, que guarda el video como HEVC. Algunos navegadores no pueden leer HEVC, por ejemplo Chrome en una computadora sin decodificador HEVC por hardware. Un clip así falla al renderizarse con **Este dispositivo no puede leer el formato del video**.

Antes de grabar:

1. Abre **Ajustes**, luego **Cámara**, luego **Formatos**.
2. Elige **Más compatible**. El teléfono guarda entonces video H.264, que todos los navegadores pueden leer.
3. Abre **Ajustes**, **Cámara**, **Grabar cámara lenta** y elige los fotogramas por segundo que quieras entre las opciones de tu modelo.

Si ya lo grabaste en Alta eficiencia, vuelve a grabarlo en **Más compatible**, o importa el clip en un dispositivo cuyo navegador pueda leer HEVC, como Safari en un iPad o en una Mac.

> [!NOTE]
> Un dispositivo que no puede leer un clip no lo pierde. La toma se queda en la cola de renderizado marcada como **Falló** con el motivo, y puedes importar una copia compatible. Consulta [Mensajes de la cabina y qué hacer](help:booth-error-messages).
