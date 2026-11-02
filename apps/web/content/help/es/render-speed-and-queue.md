---
title: Velocidad de renderizado y cola de renderizado
summary: Cómo hace la cabina los videos en segundo plano, qué muestra la cola, qué tan rápido debería ir y qué cambiar cuando va lento.
category: booth
order: 40
keywords:
  [
    renderizado,
    cola,
    lento,
    velocidad,
    codificador,
    segundo plano,
    en espera,
    renderizando,
    error,
    reintentar,
    ipad,
    laptop,
    rendimiento,
  ]
updated: 2026-10-28
related: [setup-check, 360-booth-setup, booth-error-messages, offline-mode-and-uploads]
---

## Qué pasa después de un giro

La cabina guarda primero la toma en bruto en el dispositivo, y luego renderiza a partir de ella el video del invitado (cámara lenta, superposición, intro y cierre, música, estilo, efectos y fondo) en el mismo dispositivo. El renderizado funciona en segundo plano, una toma cada vez, así que el siguiente invitado ya puede estar girando.

Para que la cámara vaya fluida, el renderizado se pausa mientras se captura a un invitado, desde que arranca la cámara hasta que desaparece la pantalla de "Guardado", y se reanuda un par de segundos después de que la cabina vuelve a estar lista. En una hora con mucha gente la cola puede crecer, y reducirse en los momentos más tranquilos.

## La cola de renderizado

La etiqueta de la barra superior de la cabina muestra el estado: **Nada en espera**, **3 tomas en espera** o **Renderizando 40 %**. Púlsala para abrir la **Cola de renderizado**. Cada toma muestra cuándo se hizo, su duración y su tamaño, y un estado:

| Estado                    | Significado                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| **Lista para renderizar** | Guardada y esperando su turno.                                                                   |
| **Renderizando**          | Se está haciendo ahora. **Cancelar renderizado** la detiene.                                     |
| **Renderizada**           | Terminada. **Reproducir** muestra el video acabado.                                              |
| **Falló**                 | Algo detuvo el renderizado. Se muestra el motivo, y **Intentar de nuevo** la devuelve a la cola. |
| **Recuperada**            | La página se cerró o falló durante la grabación. Se conserva lo guardado hasta entonces.         |
| **Importada**             | Un archivo de video que añadiste desde el disco.                                                 |

Una toma nunca se elimina sola. **Eliminar** la quita, junto con lo renderizado a partir de ella, de este dispositivo; los archivos ya subidos no se ven afectados. Si la pestaña de la cabina se cierra en mitad de un renderizado, esa toma simplemente vuelve a la cola cuando la cabina se abre otra vez.

Tras el video principal, la cabina también hace una imagen de portada y, si está activada la **Versión más ligera para mensajería**, una copia más ligera para WhatsApp y apps parecidas. Ambas se hacen detrás de cualquier toma que siga esperando.

## ¿Qué tan rápido debería ir?

El objetivo: un clip de 15 segundos en 1080p se renderiza en **45 segundos o menos en una laptop y en 90 segundos o menos en un iPad de 2021**. La [prueba de configuración](help:setup-check) mide tu dispositivo con respecto a esto, con los ajustes reales de tu evento. Cuando el dispositivo cumple el objetivo, el video de un invitado llega aproximadamente un renderizado después de su giro, es decir, uno o dos minutos.

## Si va lento

Por orden de efecto:

1. **Baja los fotogramas por segundo** a 30 fps en **Configuración**. Reduce el trabajo casi a la mitad.
2. **Baja la resolución** de 4K a 1080p, o de 1080p a 720p.
3. **Elige calidad Pequeña o Equilibrada** en lugar de Original.
4. **Usa menos efectos**, y piénsatelo bien con el reemplazo del fondo, que busca al invitado en cada fotograma. Un estilo es barato; varios efectos, no.
5. **Acorta el giro o la parte en cámara lenta.** Los tramos ralentizados necesitan fotogramas intermedios adicionales.
6. **Cierra otras pestañas y apps**, mantén el dispositivo fresco y conectado a la corriente. Los teléfonos y las tabletas se ralentizan cuando se calientan o con el ahorro de batería.
7. **Usa un dispositivo más rápido** para eventos concurridos, o pon una segunda cabina en otro dispositivo.

> [!NOTE]
> Una toma se renderiza en el dispositivo que la grabó. Los clips que filmes con la app de cámara de otro dispositivo se pueden añadir con **Importar videos** en los ajustes de la cabina, y se renderizan en el dispositivo al que los importes.

## Si falla un renderizado

El motivo aparece junto a la toma. Los más habituales son **Este dispositivo no puede leer el formato del video**, **Este navegador no puede codificar el video** y **La aceleración gráfica no está disponible**. Cada uno tiene solución en [Mensajes de la cabina y qué hacer](help:booth-error-messages).
