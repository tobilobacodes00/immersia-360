---
title: Estilos, efectos y reemplazo de fondo
summary: Dale a cada captura un estilo de color, añade efectos sincronizados con el ritmo a los videos 360, un efecto de foto a las tiras y cambia el fondo detrás de tus invitados.
category: design
order: 20
keywords:
  [
    estilo,
    filtro,
    efectos,
    color,
    sincronizar con el ritmo,
    música,
    confeti,
    destellos,
    estroboscopio,
    glitch,
    efecto de foto,
    fondo,
    pantalla verde,
    desenfoque,
    reemplazar el fondo,
    segmentación,
    recorte,
  ]
updated: 2026-10-28
related: [templates-and-editor, render-speed-and-queue, booth-error-messages, 360-booth-setup]
---

Abre la pestaña **Marca** del evento. Las tarjetas **Estilo y efectos** y **Fondo** son donde ajustas todo esto.

## Estilos

Un **estilo** es una gradación de color que se aplica a todas las capturas del evento: hay 24, desde **Monocromo**, **Noir** y **Sepia** hasta **Cinematográfico**, **Hora dorada**, **Oro rosa**, **Neón nocturno**, **Duotono medianoche** y **Negro y oro**. **Original** deja los colores como están.

El selector muestra cada estilo sobre una escena de muestra. Elige un **Estilo de los videos 360** y un **Estilo de las fotos**. El estilo se aplica en la vista previa en directo, al crear cada captura y en el video o la tira finales, con las mismas matemáticas en todas partes, así que lo que el invitado ve en la cabina es lo que recibe.

## Efectos de video (cabina 360)

Los efectos se reproducen sobre las imágenes de los invitados: **Anillos de luz, Confeti, Destellos, Corazones, Burbujas, Nieve, Humo, Aura, Disco, Destello prismático, Fuga de luz, Película quemada, Estroboscopio, Glitch, Desfase RGB, Cinta VHS, Estela de eco** y **Clones**. Elige hasta **ocho**, en orden. Cada uno tiene un control de **intensidad**, y algunos permiten elegir un **color** (**Color, Blanco, Plata, Dorado**). No se reproducen sobre la intro, el cierre ni tu superposición.

### Sincronizar con el ritmo

Con música añadida al evento, **Sincronizar con el ritmo** hace que los efectos latan con el ritmo de la música y que la cámara lenta empiece y termine en un tiempo. Si la canción no tiene un ritmo estable (ambiental o hablada), los efectos conservan su propio tiempo, y una canción rápida puede mover un efecto a medio tiempo. La opción necesita música en el evento: añádela en **Música**, en la misma página.

> [!WARNING]
> El estroboscopio y otros efectos intermitentes pueden afectar a las personas sensibles a la luz intermitente. Los efectos incluidos se mantienen dentro del umbral general de destellos, pero si tus invitados pueden ser sensibles, deja fuera el **Estroboscopio**.

## Efecto de foto (cabina de fotos)

Elige un **Efecto de foto** para el evento: **Espejo, Esferizar, Pellizcar, Molinete, Ondas, Cristal, Prisma, Caleidoscopio, Op art, Semitono, Térmico, Pop art, Pixelado, Boceto, Posterizar, Duotono pop, Cómic, Bordes neón** o **Glitch**. Se aplica, junto con el estilo de las fotos, a cada foto antes de crear la tira. Los boomerangs y los videos cortos reciben lo mismo.

## Reemplazo de fondo {#background}

En **Fondo**, cambia lo que hay detrás de tus invitados, sin pantalla verde:

| Opción         | Qué reciben los invitados                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sin fondo**  | El fondo real.                                                                                                                                                                            |
| **Desenfoque** | El fondo real, desenfocado.                                                                                                                                                               |
| **Color**      | Un color liso.                                                                                                                                                                            |
| **Imagen**     | Una imagen de tus Recursos. En una cabina 360 puede ser un **video** que se reproduce detrás del invitado y vuelve a empezar si es más corto que la vuelta. Las fotos usan solo imágenes. |

La cabina encuentra a la persona en cada fotograma en el dispositivo: ninguna imagen sale de él. La primera vez que se usa la función, el dispositivo carga un modelo pequeño y su entorno de ejecución desde el mismo servidor que la app y los conserva, así que una cabina que lo ha usado una vez en línea sigue funcionando sin conexión.

- **Vista previa**: la tarjeta la muestra con una silueta dibujada. En la cabina el recorte sigue a cada invitado.
- **Costo**: encontrar a la persona en cada fotograma es trabajo de verdad. Ralentiza el renderizado, así que haz la [prueba de configuración](help:setup-check) con tus ajustes; la prueba de renderizado incluye el fondo.
- **No disponible**: si un dispositivo no puede iniciarlo (sin WebGL 2, o porque el modelo no se pudo cargar al no haber estado nunca en línea), los invitados reciben el fondo real y la cabina dice **El reemplazo de fondo no está disponible en este dispositivo**. Consulta [Mensajes de la cabina](help:booth-error-messages).
- Ilumina bien a los invitados y colócalos frente a una pared lisa y de contraste: el recorte queda más limpio cuando la persona destaca.

## Qué necesita WebGL 2

Los estilos, los efectos y las miniaturas usan el hardware gráfico (WebGL 2). Un navegador que no lo tenga no puede mostrarlos en la vista previa y dice **La vista previa necesita WebGL2**; tus elecciones se guardan igualmente y se usan en los dispositivos que sí lo tienen. Si el sombreador de un estilo o de un efecto no puede ejecutarse en un dispositivo, ese dispositivo renderiza sin él en lugar de hacer fallar la toma.
