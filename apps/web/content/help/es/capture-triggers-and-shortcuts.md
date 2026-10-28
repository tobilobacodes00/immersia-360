---
title: Empezar con un teclado, un mando o el movimiento, y atajos de teclado
summary: Todas las formas de iniciar y detener una captura, las teclas que puede enviar un mando Bluetooth y los atajos de la cabina, del editor y de una Live Display.
category: booth
order: 30
keywords:
  [
    teclado,
    atajos,
    mando,
    control remoto,
    bluetooth,
    presentador,
    av pág,
    espacio,
    intro,
    escape,
    teclas rápidas,
    movimiento,
    disparador,
    iniciar,
  ]
updated: 2026-10-28
related: [360-booth-setup, kiosk-locking, templates-and-editor]
---

## Formas de iniciar una captura

En la **Configuración** del evento, en **Iniciar una captura**, activa cualquiera de estas:

- **Tocar la pantalla.** El invitado toca el botón de inicio.
- **Teclado y mandos Bluetooth.** Pulsar una tecla inicia la captura. Útil para un operador, o para un invitado con un presentador de diapositivas.
- **Movimiento** (cabina 360). La cabina vigila la cámara y empieza cuando la plataforma empieza a girar. Sin cuenta atrás, porque la plataforma ya se está moviendo. Una pausa evita que vuelva a empezar de inmediato. También puedes activar el movimiento y ajustar **Movimiento necesario** en **Ajustes de la cabina** para este dispositivo.

## Teclas que inician una captura

Cuando la cabina está lista para un invitado (o en la pantalla de resultado del invitado), cualquiera de estas teclas inicia una captura:

| Tecla                                        | Origen habitual                                                      |
| -------------------------------------------- | -------------------------------------------------------------------- |
| **Espacio**, **Intro**                       | Un teclado                                                           |
| **Av Pág** (Page Down), **Re Pág** (Page Up) | La mayoría de los presentadores de diapositivas                      |
| **Flecha derecha**, **Flecha abajo**         | Algunos presentadores y teclados                                     |
| **F4**                                       | Algunos mandos                                                       |
| **Subir volumen**                            | Disparadores de cámara, cuando el sistema pasa la tecla al navegador |

Las teclas se ignoran mientras alguien escribe en un campo, cuando se mantiene pulsada una tecla modificadora (Ctrl, Alt, Comando) y cuando una tecla se queda pulsada repitiéndose. No hacen nada mientras la galería está abierta, para que una pulsación perdida no pueda iniciar una grabación detrás de ella.

Para detener antes una grabación 360, pulsa **Fin** o **Escape**, o toca **Detener**. El giro también termina solo pasada la **Duración del giro**.

## En otros lugares

| Dónde                          | Tecla                                                        | Hace                                                                          |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Paneles de la cabina           | **Escape**                                                   | Cierra los ajustes, la cola de renderizado o la galería.                      |
| Teclado del PIN de quiosco     | **0** a **9**, **Retroceso**, **Intro**, **Escape**          | Escribe, borra, desbloquea, cancela.                                          |
| Pantalla Live Display          | **F**                                                        | Activa y desactiva la pantalla completa.                                      |
| Editor de plantillas           | **Ctrl/Cmd+Z**                                               | Deshacer.                                                                     |
|                                | **Ctrl/Cmd+Mayús+Z** o **Ctrl/Cmd+Y**                        | Rehacer.                                                                      |
|                                | **Ctrl/Cmd+A**                                               | Seleccionar todo.                                                             |
|                                | **Ctrl/Cmd+D**                                               | Duplicar la selección.                                                        |
|                                | **Supr** o **Retroceso**                                     | Eliminar la selección.                                                        |
|                                | **Escape**                                                   | Deseleccionar.                                                                |
|                                | **Ctrl/Cmd+]** y **Ctrl/Cmd+[**                              | Traer adelante, enviar atrás (añade **Mayús** para el primer y último plano). |
|                                | **Teclas de flecha**                                         | Mover 1 píxel (mantén **Mayús** para 10).                                     |
| Tiradores de recorte de música | **Teclas de flecha**, **Re Pág/Av Pág**, **Inicio**, **Fin** | Mueve el tirador (mantén **Mayús** para pasos mayores).                       |

> [!TIP]
> Prueba tu mando con la [prueba de configuración](help:setup-check) o en la pantalla de inicio de la cabina antes del evento. Si una tecla no hace nada, el mando probablemente envía otra: prueba con sus otros botones.
