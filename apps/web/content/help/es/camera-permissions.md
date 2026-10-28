---
title: Solucionar problemas de acceso a la cámara
summary: La cámara está bloqueada, en uso, no se encuentra o no ofrece lo que necesita el evento, con pasos para Chrome, Edge, Safari, Firefox, iPad y Android.
category: troubleshooting
order: 10
keywords:
  [
    cámara,
    camara bloqueada,
    permiso,
    bloqueada,
    denegado,
    permitir,
    no se encuentra,
    en uso,
    webcam,
    chrome,
    safari,
    firefox,
    edge,
    android,
    ios,
    https,
    restricciones,
    usb,
    zoom,
  ]
updated: 2026-10-28
related: [booth-error-messages, setup-check, 360-booth-setup]
---

La tarjeta de error de la cabina nombra el problema. Búscalo más abajo. Después de cambiar cualquier cosa, pulsa **Intentar de nuevo** en la tarjeta (o recarga la página).

## Se bloqueó el acceso a la cámara {#permission}

El navegador pregunta una vez si este sitio puede usar la cámara. Si alguien pulsó **Bloquear**, o el ajuste estaba desactivado, el navegador lo recuerda.

**Chrome y Edge (computadora)**

1. Haz clic en el icono que está a la izquierda de la barra de direcciones (un candado o un icono de controles).
2. Define **Cámara** como **Permitir**.
3. Recarga la página.

O abre `chrome://settings/content/camera` (`edge://settings/content/camera` en Edge) y quita este sitio de **No pueden usar tu cámara**. Cuando el navegador pregunte, elige **Permitir en cada visita** en lugar de permitirlo solo esta vez, para que la pregunta no vuelva.

**Safari en una Mac**: elige **Safari, Ajustes, Sitios web, Cámara** y define este sitio web como **Permitir**.

**Safari en un iPad o iPhone**: toca **aA** en la barra de direcciones, luego **Configuración del sitio web**, luego **Cámara**, y elige **Permitir**. Si usas la app de la pantalla de inicio, elimínala y vuelve a añadirla, o busca en **Ajustes, Apps, Safari, Cámara** (en versiones anteriores, **Ajustes, Safari, Cámara**).

**Firefox**: haz clic en el icono de la cámara de la barra de direcciones y quita el bloqueo, o abre `about:preferences#privacy`, busca **Permisos, Cámara, Configuración** y quita el bloqueo.

**Chrome en Android**: toca el icono del candado en la barra de direcciones, luego **Permisos**, luego **Cámara**, y permítela. Si aparece en gris, abre **Ajustes, Apps, Chrome, Permisos, Cámara** del teléfono y permítela allí.

**Ajustes del sistema en Windows y macOS.** Aunque el navegador permita la cámara, el sistema operativo todavía puede bloquearla: en Windows abre **Configuración, Privacidad y seguridad, Cámara** y comprueba que estén activados el acceso a la cámara y el acceso de las apps de escritorio; en una Mac abre **Ajustes del Sistema, Privacidad y seguridad, Cámara** y activa tu navegador.

## No se encontró ninguna cámara {#not_found}

El navegador no ve ninguna cámara.

- Conecta la cámara, o vuelve a colocar su cable. Prueba otro puerto USB; evita los concentradores sin alimentación.
- Las capturadoras y las cámaras que usan un teléfono como webcam tienen que estar funcionando antes.
- Abre los **Ajustes de la cabina** y elige la cámara de la lista: puede que la correcta no sea la predeterminada. La lista termina con **Cámara simulada (sin hardware)**, que solo sirve para probar la cabina sin cámara.
- Un dispositivo sin cámara, o un navegador que no tiene ninguna que ofrecer, no puede usarse como cabina. Usa otro dispositivo.

## Otra aplicación está usando la cámara {#in_use}

La mayoría de las cámaras solo las puede usar una app a la vez. Cierra las apps de videollamadas (Zoom, Teams, Meet), otras pestañas del navegador que usen la cámara y las apps de cámara o de fotos. Luego pulsa **Intentar de nuevo**. Si sigue diciéndolo, desconecta y vuelve a conectar la cámara o reinicia el navegador. En Windows, otra app de escritorio puede estar reteniéndola aunque esté cerrada en la bandeja.

## La cámara no ofrece lo que necesita el evento {#overconstrained}

El evento pide una resolución y una velocidad de fotogramas (por ejemplo, 4K a 60 fps) que esta cámara no puede dar. Elige otra cámara u otra lente en los **Ajustes de la cabina**, o baja la resolución o los fotogramas por segundo en **Configuración**. La [prueba de configuración](help:setup-check) muestra lo que tu cámara ofrece de verdad.

## La cámara necesita una conexión segura {#insecure}

Los navegadores solo permiten el acceso a la cámara en páginas abiertas con **https**, o en `localhost`. Una cabina abierta desde una dirección `http://` sin cifrar, o desde una dirección IP, no puede usar la cámara. Ábrela desde la dirección que te da el Estudio.

## La cámara se desconectó {#lost}

La cámara se detuvo mientras la cabina estaba funcionando: un cable suelto, un puerto USB en reposo, un teléfono que se durmió. Vuelve a conectarla y pulsa **Intentar de nuevo**. Para un evento largo usa un concentrador USB con alimentación o un cable que se bloquee, y desactiva el ahorro de energía de USB en los ajustes del sistema.

## Funciona, pero la imagen se ve mal

- **Lente equivocada**: los teléfonos y las tabletas muestran cada lente como una cámara distinta (gran angular, ultra gran angular, teleobjetivo, frontal). Elige otra en los **Ajustes de la cabina**.
- **Reflejada**: el interruptor **Reflejar la vista previa** solo cambia la pantalla, nunca la grabación.
- **Oscura o entrecortada**: añade luz. Muchas cámaras bajan su velocidad de fotogramas en habitaciones con poca luz.
