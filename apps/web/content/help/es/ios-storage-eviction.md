---
title: Almacenamiento en iPad y iPhone, y navegadores que borran datos
summary: Por qué Safari puede borrar los datos guardados de una cabina, cómo evitarlo con la app de la pantalla de inicio y cuánto espacio libre necesitas.
category: troubleshooting
order: 40
keywords:
  [
    ios,
    ipad,
    iphone,
    safari,
    almacenamiento,
    borrado,
    expulsado,
    cuota,
    persistir,
    pantalla de inicio,
    pwa,
    borrar datos,
    espacio,
    poco almacenamiento,
    navegación privada,
  ]
updated: 2026-10-28
related: [offline-mode-and-uploads, setup-check, kiosk-locking, faq-free-up-space]
---

Una cabina guarda las grabaciones y los renderizados en el almacenamiento del navegador hasta que se suben. Los navegadores pueden borrar ese almacenamiento en algunas situaciones, y Safari en iPad y iPhone es el más estricto. Con un poco de preparación el riesgo desaparece.

## Qué puede salir mal

- **Safari borra los datos de un sitio web tras un periodo sin uso.** WebKit, el motor detrás de todos los navegadores en iOS, elimina los datos guardados de un sitio si no lo abres durante aproximadamente una semana, salvo que el sitio esté instalado en la pantalla de inicio. Una cabina que pasa guardada en un cajón entre eventos puede perder todo lo que no se haya subido.
- **El sistema puede borrar almacenamiento cuando el dispositivo se queda sin espacio**, y puede que no pregunte.
- **Borrar el historial** (Ajustes, luego Safari, luego **Borrar historial y datos de sitios web**) elimina todo.
- **Una pestaña o ventana privada** olvida todo cuando se cierra.

En otras plataformas, Chrome y Edge también pueden borrar los datos de un sitio cuando el dispositivo se queda sin espacio, a menos que al sitio se le haya concedido almacenamiento persistente. La cabina lo pide al iniciarse; la [prueba de configuración](help:setup-check) indica si el navegador aceptó.

## La solución: usa la app de la pantalla de inicio

1. Abre la dirección de la cabina en Safari.
2. Toca **Compartir**, luego **Añadir a pantalla de inicio** y luego **Añadir**.
3. A partir de ahora, abre Immersia 360 desde su icono de la pantalla de inicio.

Una app web instalada tiene su propio almacenamiento, que la limpieza de una semana de Safari no toca, funciona sin las barras de Safari y es mejor también para el [modo quiosco](help:kiosk-locking). Registra el dispositivo y haz la prueba de configuración desde la app instalada, porque por lo general tiene su propio almacenamiento, separado de la pestaña de Safari: un dispositivo registrado en Safari puede necesitar registrarse otra vez en la app.

## Espacio libre

La cabina muestra **Poco almacenamiento** cuando queda menos de 2 GB libres, y la prueba de configuración avisa en el mismo punto y falla por debajo de unos 0,5 GB. Una grabación de 15 segundos a 1080p ocupa decenas de megabytes; un día entero en un evento concurrido, gigabytes.

Para liberar espacio:

- Elimina en la **Cola de renderizado** las tomas que ya no necesites. Eliminar quita del dispositivo la toma y lo que se renderizó a partir de ella; los archivos ya subidos no se ven afectados. Mira primero las etiquetas de subida.
- Quita otras apps, fotos y videos del dispositivo.
- Revisa **Ajustes, General, Almacenamiento del iPhone (o del iPad)** para ver qué ocupa espacio.

## Algunos hábitos que evitan pérdidas

- No dejes una cabina sin usar más de unos pocos días con capturas todavía pendientes. Deja que terminen las subidas.
- Mantén el dispositivo cargando durante el evento.
- No uses una pestaña privada para una cabina.
- Si tienes que borrar los datos del navegador, espera a que las etiquetas muestren que no hay nada pendiente. Consulta [Modo sin conexión y la cola de subidas](help:offline-mode-and-uploads).
