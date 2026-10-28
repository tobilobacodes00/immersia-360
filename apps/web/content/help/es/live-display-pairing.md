---
title: Muestra las capturas en una TV con Live Display
summary: Activa Live Display, vincula una TV o cualquier pantalla con un código de seis caracteres, elige un diseño y define cuánto tiempo se queda cada captura.
category: live
order: 10
keywords:
  [
    live display,
    tv,
    pantalla,
    vincular,
    emparejar,
    código,
    proyector,
    diseño,
    destacado,
    mosaico,
    cinta,
    contador,
    chromecast,
    hdmi,
    pantalla grande,
    navegador de la tv,
  ]
updated: 2026-10-28
related: [live-display-moderation, sharing-station, offline-mode-and-uploads]
---

Live Display muestra cada captura nueva en una TV, un proyector o una laptop conectada por HDMI, cada una con su propio código QR, para que los invitados puedan llevarse la suya desde la pantalla. Cualquier dispositivo con un navegador web puede ser una pantalla.

## Actívalo

Abre el evento y ve a la pestaña **Live Display**. **Mostrar las capturas en pantallas** está desactivado hasta que lo actives. En la pantalla de resultado se avisa a los invitados de que su captura puede aparecer en la pantalla grande del evento, y cada uno puede elegir **No mostrar la mía en pantalla**.

Junto a eso, **Publicación** decide si las capturas nuevas se publican solas (**Mostrar automáticamente**) o esperan a que tú las apruebes (**Aprobar primero**). Consulta [Moderar lo que sale en pantalla](help:live-display-moderation).

## Vincula una pantalla {#pair}

1. En la tarjeta **Pantallas**, pulsa **Vincular una pantalla**. Aparece un código de seis caracteres, válido durante 10 minutos.
2. En la pantalla, abre el navegador y ve a la dirección que muestra la ventana, que termina en `/tv`.
3. Escribe el código y pulsa **Conectar pantalla**.

Solo letras y números, y nunca I, L, O, 0 ni 1. Una tableta o un teléfono que vaya a ser la pantalla puede simplemente escanear el código QR de la misma ventana: eso abre la dirección de emparejamiento con el código ya escrito y vincula al instante.

Un código vencido muestra **Ese código venció. Crea uno nuevo en Estudio.** Pulsa **Obtener un código nuevo**. Los códigos de emparejamiento están limitados a 20 intentos desde una misma red cada 10 minutos para que no se puedan adivinar.

La pantalla recuerda que está vinculada en ese navegador. Si borras los datos del sitio del navegador o usas una ventana privada, vincúlala de nuevo.

## Diseños y ajustes

Cada pantalla tiene su propio nombre, diseño y reproducción, y los cambios le llegan en menos de un segundo:

| Ajuste                        | Opciones                                                                                                                                                                                                                                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Diseño**                    | **Destacado** (una captura a pantalla completa con su código QR al lado), **Mosaico** (de seis a doce reproduciéndose en silencio, la que toca ampliada con su QR), **Cinta** (Destacado más una franja de capturas recientes y una insignia de «recién llegado»), **Contador** (el logo y cuántos momentos se han capturado) |
| **Tiempo por elemento**       | De 3 a 15 segundos, 8 de forma predeterminada. Los videos se reproducen hasta el final, hasta tres veces este tiempo.                                                                                                                                                                                                         |
| **Silenciar videos**          | Activado de forma predeterminada.                                                                                                                                                                                                                                                                                             |
| **Tamaño del QR**             | Pequeño, Mediano, Grande.                                                                                                                                                                                                                                                                                                     |
| **Esquina del QR del evento** | La esquina donde está el código de la galería de todo el evento.                                                                                                                                                                                                                                                              |
| **Videos verticales**         | **Relleno difuminado** o **Lado a lado**, para videos 9:16 en una pantalla horizontal.                                                                                                                                                                                                                                        |

Una captura nueva se cuela en la cola: el elemento en pantalla se acorta, pero nunca a menos de 3 segundos, así que un invitado que esté junto a la pantalla ve la suya en cuestión de segundos.

## En la pantalla

- **Pantalla completa**: pulsa **F**, o usa el botón de la esquina.
- **Sonido**: los navegadores bloquean el sonido hasta que alguien interactúa. Con **Silenciar videos** desactivado, un mensaje dice **Pulsa OK para activar el sonido**: púlsalo (o tócalo) una vez.
- **Estado** en la esquina: **En vivo**, **En vivo, actualizando** (cuando la conexión en tiempo real no está disponible, la pantalla pregunta si hay novedades cada pocos segundos, lo que sigue estando dentro de los 5 segundos) o **Sin conexión, repitiendo los momentos guardados**.

Una pantalla guarda su propia copia de los últimos 200 elementos y de sus archivos, así que si la conexión se corta a mitad del evento sigue repitiendo lo que tiene en lugar de quedarse en blanco.

## Quita o vuelve a vincular una pantalla

**Quitar**, junto a una pantalla, la detiene al instante: vuelve a su página de vinculación. La lista muestra **En línea** para una pantalla vista en los últimos dos minutos.

> [!TIP]
> Pon el navegador de la pantalla en pantalla completa e impide que la TV se suspenda. Consulta [Bloquear la cabina para los invitados](help:kiosk-locking) para ver ideas que también sirven para una pantalla.
