---
title: Imprimir al tamaño correcto
summary: Los tamaños de impresión, cómo imprime la cabina, los ajustes del cuadro de impresión que importan, dos tiras en una hoja 4×6 y cómo comprobar el resultado con una regla.
category: photo
order: 20
keywords:
  [
    imprimir,
    impresora,
    tamaño,
    4x6,
    2x6,
    5x7,
    dpi,
    escala,
    márgenes,
    sublimación,
    dos tiras,
    doble tira,
    airprint,
    copias,
    calibración,
  ]
updated: 2026-10-28
related: [chrome-kiosk-printing, photo-booth-and-layouts, setup-check]
---

## Cómo funciona la impresión

La cabina hace la impresión como una imagen a **300 DPI** con el tamaño exacto del papel (una impresión de 4×6 son 1200 × 1800 píxeles) y se la entrega a la función de impresión del navegador en una página del mismo tamaño y sin márgenes. A partir de ahí se encarga el sistema de impresión de tu computadora o tableta. Immersia no habla directamente con las impresoras, así que sirve cualquier impresora a la que tu dispositivo pueda imprimir: impresoras de oficina, de fotos, de sublimación para eventos y AirPrint.

Tamaños: tira **2×6**, **4×4**, **4×6** vertical, **6×4** horizontal y **5×7** pulgadas. El tamaño de historia 9:16 es para pantallas y no tiene tamaño de papel.

## Activar la impresión {#turn-on}

En la **Configuración** del evento, sección **Cabina de fotos**:

- **Impresión** activada.
- **Imprimir automáticamente** envía cada tira conservada a la impresora sin que el invitado pulse nada. Necesita impresión silenciosa: consulta [Imprimir sin cuadro de diálogo](help:chrome-kiosk-printing). Sin ella, el cuadro de impresión se abre con cada tira.
- **Copias por sesión**, de 1 a 10, es cuántas copias hace cada trabajo de impresión.
- En la pantalla de resultado los invitados tienen un botón **Imprimir**. Está limitado a dos impresiones por sesión, para que no se pueda agotar una impresora; una impresión automática cuenta como una. Cuando llegan al límite, el botón lo dice.
- **Dos tiras en una hoja 4×6** (solo en el tamaño 2×6) se describe más abajo.

## El cuadro de impresión

Sea cual sea tu impresora, tres ajustes deciden si la impresión sale del tamaño correcto:

1. **Tamaño del papel**: el tamaño real del papel que hay en la impresora (4×6 pulgadas, 5×7 pulgadas).
2. **Escala**: **100 %**, no "Ajustar a la página" ni "Reducir para ajustar". Ajustar cambia el tamaño.
3. **Márgenes**: **Ninguno** (o impresión sin bordes, si la impresora la ofrece). Deja desactivados los encabezados y pies de página.

La cabina pide una página del tamaño correcto y sin margen, y Chrome y Edge suelen respetarlo, pero los controladores de impresora a menudo añaden sus propios márgenes o su propia escala. Comprueba el resultado como se describe más abajo.

En un **iPad, iPhone o dispositivo Android** el cuadro de impresión del sistema siempre aparece; esos sistemas no pueden imprimir en silencio desde una página web. Una computadora con Chrome sí puede, consulta el artículo siguiente.

## Dos tiras en una hoja 4×6

La mayoría de las impresoras de sublimación para eventos usan papel 4×6. Una tira 2×6 cabe dos veces. Elige el tamaño de diseño **2×6**, activa la impresión y activa **Dos tiras en una hoja 4×6**: la cabina imprime la misma tira dos veces, una al lado de la otra, en una página 4×6. Carga papel 4×6. Corta la hoja por la mitad, a mano o, si tu impresora tiene la opción, con su cortador integrado (busca en el controlador de la impresora un ajuste de corte de 2 pulgadas o 2×6).

La opción no aparece en los demás tamaños.

## Comprueba la impresión con una regla

La [prueba de configuración](help:setup-check) incluye una prueba de impresora para las cabinas de fotos. Imprime una hoja de calibración con el tamaño de impresión de tu evento, con:

- una **regla de 50 mm** en la hoja, que debe medir 50 mm con un margen de 1 mm;
- **marcas de esquina** cuya distancia está impresa en la hoja;
- un **círculo de 20 mm** que debe verse redondo;
- cuatro marcos finos a **1, 2, 3 y 4 mm** de cada borde: cada marco que falta significa que se recorta cerca de 1 mm.

Estar a menos de 1 mm y sin recortes significa que las impresiones de los invitados saldrán del tamaño que elegiste. En tus diseños, mantén las caras y el texto al menos a 4 mm del borde, porque las impresoras que recortan necesitan ese margen.

## Si la impresión sale mal

| Qué ves                             | Qué probar                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| La regla sale muy corta o muy larga | Pon la escala en 100 % y desactiva "Ajustar a la página". Revisa la escala del propio controlador.                                          |
| Los bordes salen cortados           | Márgenes en ninguno, o impresión sin bordes; el tamaño de papel correcto.                                                                   |
| Borde blanco alrededor              | Impresión sin bordes, o márgenes en ninguno; el tamaño de papel correcto.                                                                   |
| Imprime en el papel equivocado      | Elige el tamaño de papel correcto, y la bandeja correcta, en el controlador.                                                                |
| No imprime nada                     | Comprueba que la impresora esté encendida, cargada y definida como predeterminada; prueba a imprimir una página de prueba desde el sistema. |
