---
title: Hacer la prueba de configuración
summary: Prueba un dispositivo de cabina antes del evento: cámara, almacenamiento, una grabación de prueba, velocidad de renderizado, un escaneo de QR, la impresora y las subidas.
category: start
order: 20
keywords: [prueba, comprobación, asistente, fps, benchmark, velocidad de renderizado, calibración, regla, prueba de qr, preparación]
updated: 2026-10-28
related: [render-speed-and-queue, ios-storage-eviction, printing-setup, offline-mode-and-uploads]
---

La prueba de configuración es una prueba guiada y corta que haces en el dispositivo que va a manejar la cabina. Usa la misma cámara, el mismo grabador, el mismo almacenamiento, el mismo motor de renderizado y la misma ruta de subida que usa la cabina, así que si la pasa, la cabina funcionará. Cada paso termina en **Bien**, **Revisar** (funciona, pero conviene mirarlo) o **Corregir** (dará problemas), con lo que hay que hacer.

## Dónde empezarla

- En la página del evento, pulsa **Prueba de configuración**.
- En la cabina, abre **Ajustes de la cabina** y pulsa **Ejecutar** junto a **Prueba de configuración**.
- La primera vez que un dispositivo abre una cabina, la pantalla de inicio la ofrece. **Omitir por ahora** se recuerda para ese dispositivo en ese navegador.

Hazla en el dispositivo y el navegador que usarás en el evento, desde el mismo lugar y en la misma red.

## Los pasos

### Cámara y lente

Elige la cámara y la lente (el mismo selector que en los ajustes de la cabina) y mira la imagen. Después la prueba cuenta durante unos dos segundos y medio los fotogramas por segundo que la cámara entrega de verdad.

- **Bien** cuando entrega al menos el 90 % de lo que pide el evento.
- **Revisar** cuando va más lenta pero sigue fluida (al menos 24 fps), por ejemplo una webcam de 30 fps en un evento de 60 fps. La cámara lenta se verá menos suave. También puedes bajar el evento a 30 fps.
- **Corregir** por debajo de 24 fps, que se ve entrecortado. Cierra otras apps que usen la cámara, prueba con otra cámara u otro puerto y añade luz.

### Almacenamiento

Las grabaciones viven en el dispositivo hasta que se suben. La prueba le pide al navegador que conserve los datos de este sitio, lee el espacio libre y anota dónde se escriben las grabaciones. Avisa por debajo de 2 GB libres y falla por debajo de unos 0,5 GB. Si el navegador no promete conservar los datos, recibes consejos para tu navegador. Consulta [Almacenamiento en iPad y iPhone](help:ios-storage-eviction).

### Grabación de prueba

Graba cuatro segundos con el propio grabador de la cabina, los escribe en el almacenamiento del dispositivo, vuelve a leer el archivo y comprueba su tamaño y duración. El archivo de prueba se elimina cuando termina la prueba.

### Velocidad de renderizado

Renderiza la grabación de prueba con los ajustes de salida de este evento en el motor de renderizado real, y luego escala el tiempo a un clip de 15 s en 1080p, la vara de medir que prometemos:

| Resultado    | Significado                                                                |
| ------------ | -------------------------------------------------------------------------- |
| 45 s o menos | **Bien**: dentro del objetivo para una laptop                              |
| De 46 a 90 s | **Revisar**: dentro del objetivo de un iPad de 2021, lento para una laptop |
| Más de 90 s  | **Corregir**: los invitados esperarían mucho                               |

La estimación es algo pesimista, porque un clip corto incluye el tiempo de arranque. Si el evento reemplaza el fondo, la prueba de renderizado también lo hace, así que la velocidad lo incluye, y recibes un aviso si el dispositivo no puede iniciar esa función. El resultado se guarda en el dispositivo como su **ruta de renderizado**. Consulta [Velocidad de renderizado y cola de renderizado](help:render-speed-and-queue).

### Escaneo de QR de prueba

Muestra un código QR. Apunta un teléfono hacia él: la página que se abre dice **Escaneado**, y la prueba lo detecta en un par de segundos. Esto demuestra que los teléfonos de los invitados pueden llegar al servidor desde donde está la cabina. El código funciona 10 minutos. Si la cabina está abierta en una dirección local como `localhost`, recibes un aviso, porque los teléfonos de otras redes no pueden abrirla.

### Prueba de impresora (cabinas de fotos)

Imprime una hoja de calibración con el tamaño de impresión del evento, a 300 DPI, con el mismo código de impresión que usa la impresión de un invitado. Después la compruebas con una regla:

- la **regla de 50 mm** debe medir 50 mm, con un margen de 1 mm;
- las marcas de las esquinas están a la distancia que indica la hoja;
- el **círculo de 20 mm** debe verse redondo;
- los cuatro marcos finos están a 1, 2, 3 y 4 mm de cada borde. Cada marco que falta significa que se recorta cerca de 1 mm.

Luego indicas lo que viste. A menos de 1 mm y sin recortes es **Bien**. Consulta [Imprimir al tamaño correcto](help:printing-setup). El tamaño de historia 9:16 es para pantallas, así que no hay nada que imprimir.

### Subida y red

Le pide al servidor una subida firmada, envía 1 MB directamente al almacenamiento como el archivo de un invitado, y hace que el servidor confirme que llegó completo y lo elimine. Informa de la velocidad. Por debajo de 2 Mbit/s recibes un aviso, porque un clip típico de 12 MB tardaría más de 45 segundos en llegar al invitado.

## Resultados

Al final ves cada paso con su resultado y qué hacer. Pulsa **Repetir la prueba** después de corregir algo.

El registro del dispositivo se actualiza con el tamaño y los fotogramas por segundo que entregó la cámara, la velocidad de renderizado medida, la ruta de renderizado y cuándo se hizo la prueba. **Dispositivos** muestra la ruta de renderizado junto al dispositivo. También contamos que una prueba terminó (con su velocidad de renderizado, los fps de la cámara y el navegador) en nuestras propias analíticas, que no identifican a ningún invitado.

> [!NOTE]
> La ruta de renderizado es una pista. Hoy cada cabina renderiza en el dispositivo en el que funciona, así que un resultado "más lento" o "no puede renderizar" significa: usa un dispositivo más rápido para este evento.
