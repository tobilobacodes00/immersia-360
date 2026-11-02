---
title: Plantillas y el editor de diseño
summary: Empieza desde un diseño de fotos o una superposición de video ya hechos, edítalo en el editor, guarda los tuyos y sube tus propios logotipos, fuentes, música y marcos.
category: design
order: 10
keywords:
  [
    plantilla,
    editor,
    diseño,
    superposición,
    biblioteca,
    boda,
    cumpleaños,
    texto,
    fuente,
    logotipo,
    qr,
    tokens,
    campos dinámicos,
    recursos,
    subir,
    png,
    marco,
  ]
updated: 2026-10-28
related: [photo-booth-and-layouts, looks-and-effects, 360-booth-setup, printing-setup]
---

Dos tipos de diseño comparten un mismo editor:

- Un **diseño de impresión** es la impresión o la tira que un invitado de la cabina de fotos se lleva a casa: espacios para fotos, texto, logotipos y el código QR del invitado.
- Una **superposición** es un marco transparente que se dibuja sobre cada video 360: el nombre del evento, un logotipo, un borde.

## Empieza desde la biblioteca

Abre **Plantillas** en el Estudio. Contiene diseños ya hechos para eventos de **Boda, Cumpleaños, Graduación, Baby shower, Navidad, Halloween, Quinceañera** y **Corporativo**, en muchos estilos y en todos los tamaños de impresión y formas de superposición. Filtra por ocasión y tamaño, o busca por nombre. **Propia** muestra las plantillas que ha guardado tu equipo.

Abre una para verla, luego **Usar en un evento…**: elige el evento y **Usar este diseño**. Reemplaza el diseño actual del evento, y después todavía puedes editarlo. Si la plantilla es de otro tamaño, se usa el estilo equivalente hecho para el tamaño del evento cuando lo hay, o el diseño se ajusta al tamaño. Una advertencia te avisa si el diseño tiene más espacios para fotos que fotos toma el evento. **Guardar en mis plantillas** conserva una copia para reutilizarla.

También puedes llegar a la biblioteca desde el panel **Plantillas** del editor.

## El editor

En un evento, abre **Marca**. En **Diseño de impresión** (fotos) o **Superposición de video** (360), pulsa **Abrir el editor**, o **Diseñar uno** si el evento todavía no tiene ninguno.

Añade elementos con la barra de herramientas:

| Herramienta                            | Qué añade                                                     |
| -------------------------------------- | ------------------------------------------------------------- |
| **Agregar un espacio de foto**         | Dónde va una de las fotos del invitado (diseños de fotos).    |
| **Agregar texto**                      | Texto con cualquier fuente, con campos dinámicos (más abajo). |
| **Agregar una imagen**                 | Un logotipo o una imagen de tus Recursos.                     |
| **Agregar un rectángulo / una elipse** | Una forma con relleno y contorno.                             |
| **Agregar el código QR del invitado**  | El código que abre la página del invitado (diseños de fotos). |
| **Agregar una decoración**             | Un adorno del conjunto incluido.                              |

Haz clic en un elemento para seleccionarlo; arrastra para moverlo y arrastra los tiradores para cambiar el tamaño o girarlo. El panel **Propiedades** tiene la posición, el tamaño, la rotación y la opacidad exactos, y los ajustes propios de cada tipo de elemento. El panel **Capas** los ordena, los muestra, los oculta y los bloquea. Selecciona varios con Mayús+clic o arrastrando sobre el lienzo, y luego alinéalos. Los atajos, como deshacer y duplicar, están en [Atajos de teclado](help:capture-triggers-and-shortcuts).

El editor guarda por sí solo (**Todos los cambios guardados**). Si el diseño se cambió en otra pestaña o en otro dispositivo, pregunta si quieres **Cargar su versión** o **Conservar la mía**.

### Tamaños

Un lienzo de impresión se crea a **300 DPI**, así que lo que ves es lo que se imprime: una de 4×6 mide 1200 × 1800 píxeles. Un **código QR** en una impresión debe tener al menos **18 mm** de ancho para que los teléfonos lo lean; el editor avisa con **QR de menos de 18 mm**.

Una superposición es transparente para que se vea el video. Deja el fondo vacío.

### Campos dinámicos {#fields}

El texto puede contener campos que se rellenan para cada evento o invitado, y que se eligen con el botón `{ }` del cuadro de texto:

| Campo                                  | Da                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `{eventName}`, `{eventDate}`           | El nombre y la fecha del evento.                                                                                  |
| `{hashtag}`, `{custom1}` a `{custom3}` | Texto que defines en **Marca**, **Campos dinámicos**.                                                             |
| `{shortCode}`, `{sessionUrl}`          | El código corto y el enlace del invitado.                                                                         |
| `{shotNumber}`, `{shotCount}`          | Qué foto es esta, y cuántas hay.                                                                                  |
| `%d %B %Y`, `%d.%m.%Y`, `%H:%M`        | La fecha y la hora en un formato.                                                                                 |
| `{upper,{eventName}}` y otras          | Funciones: mayúsculas, una alternativa si está vacío, una condición, los primeros caracteres, codificar para URL. |

Una vista previa en directo bajo el cuadro muestra el resultado.

## Tus propios archivos en Recursos {#assets}

**Recursos** contiene archivos que comparten todos los eventos de la cuenta: superposiciones y marcos, intros y cierres, música, fuentes, logotipos y fondos. Súbelos una vez y úsalos donde quieras. Los límites:

| Tipo           | Formatos                                       | Límite                                                      |
| -------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| Superposición  | PNG o WebP con transparencia                   | 25 MB                                                       |
| Marco          | PNG, JPEG o WebP                               | 25 MB                                                       |
| Intro y cierre | MP4, MOV, WebM, o una imagen (PNG, JPEG, WebP) | 200 MB para video, hasta 30 segundos; 25 MB para una imagen |
| Música         | MP3, M4A/AAC, WAV                              | 50 MB, hasta 15 minutos                                     |
| Fuentes        | WOFF2, WOFF, TTF, OTF                          | 10 MB                                                       |
| Logotipos      | PNG, JPEG o WebP (no se admite SVG)            | 10 MB                                                       |
| Fondos         | PNG, JPEG, WebP, MP4 o WebM                    | 25 MB para una imagen, 200 MB para un video                 |

El editor también ofrece para elegir una biblioteca de fuentes de licencia abierta (libres para impresión y video). Las fuentes que subas aparecen en **Subidas**.

La biblioteca de la cuenta admite hasta 5 GB. El tipo real de un archivo se comprueba por su contenido, no por su nombre. Un archivo que está en uso no se puede eliminar hasta que cambies a otro recurso los eventos y las plantillas que lo usan. Todo lo que usan tus eventos se guarda en el dispositivo de la cabina mientras está en línea, así que funciona sin conexión.
