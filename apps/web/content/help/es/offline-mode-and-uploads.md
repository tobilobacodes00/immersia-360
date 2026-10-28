---
title: Modo sin conexión y la cola de subidas
summary: Cómo sigue funcionando la cabina sin internet, qué significan las etiquetas de subida, qué revisar antes de irte del lugar y qué necesita conexión.
category: troubleshooting
order: 30
keywords:
  [
    sin conexión,
    sin internet,
    wifi,
    conexión,
    subida,
    cola,
    pendiente,
    sincronizar,
    reintentar,
    espera progresiva,
    punto de acceso,
    service worker,
    instalar,
    pwa,
    caché,
  ]
updated: 2026-10-28
related: [ios-storage-eviction, setup-check, booth-error-messages, devices-and-registration]
---

El wifi de los lugares falla. La cabina está hecha para seguir adelante: **nada de lo grabado se pierde, y los invitados siguen recibiendo un código QR que funciona**.

## Qué sigue funcionando sin conexión

- **La captura.** Cada toma se escribe en el almacenamiento del dispositivo, fragmento a fragmento, a medida que se graba, antes de que ocurra cualquier otra cosa con ella. Un fallo, una recarga o una batería agotada cuestan como máximo el último segundo; la toma vuelve como **Recuperada**.
- **El renderizado.** Los videos se hacen en el dispositivo. Consulta [Velocidad de renderizado y la cola](help:render-speed-and-queue).
- **El código QR y el código corto del invitado.** El enlace se crea en el dispositivo. El dispositivo guarda una reserva de códigos cortos para el evento, que repone siempre que está en línea (cuando le quedan menos de 25 pide 100 más), así que los códigos se reparten sin conexión. Si un periodo largo sin conexión los agota todos, la página del invitado muestra el código cuando la captura llega al servidor.
- **Los correos que le pides enviar a la cabina** esperan en la cola y salen cuando vuelve la conexión.
- **Los gráficos superpuestos, la intro y la salida, la música, las tipografías y las imágenes** del evento se guardan en el dispositivo mientras está en línea, y se usan desde ahí.

## Qué necesita conexión

- **Las descargas de los invitados.** Un invitado que escanea mientras la cabina está sin conexión ve **Tus archivos están en camino** y la página se actualiza sola cuando llega la subida.
- **Live Display y la Sharing Station** solo reciben capturas nuevas una vez subidas. Una pantalla sigue repitiendo lo que ya tiene.
- **Los cambios en el Estudio.** Los ajustes que cambias allí llegan a una cabina la próxima vez que carga la página estando en línea.
- **La primera visita.** Un dispositivo debe abrir la cabina una vez en línea para poder guardar la app y los archivos del evento. La [prueba de configuración](help:setup-check) es una buena forma de hacerlo.

## Las etiquetas de la barra superior de la cabina

| Etiqueta                                                        | Significado                                                                                                                    |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Sin conexión**                                                | El dispositivo no tiene conexión. La captura sigue funcionando.                                                                |
| **3 subidas pendientes**                                        | En línea, y la cola está procesando capturas.                                                                                  |
| **Sin conexión · 3 subidas pendientes**                         | Capturas esperando una conexión.                                                                                               |
| **1 subida requiere atención**                                  | El servidor rechazó una captura (por ejemplo, porque el evento ya no existe). El operador debería mirarlo.                     |
| **Este dispositivo se eliminó: regístralo de nuevo para subir** | Se revocó el dispositivo. Consulta [Registrar y gestionar dispositivos de cabina](help:devices-and-registration).              |
| **Poco almacenamiento**                                         | Quedan menos de 2 GB libres en el dispositivo. Consulta [Almacenamiento en iOS y borrado de datos](help:ios-storage-eviction). |

## Cómo funciona la subida

La cola atiende un paso cada vez, empezando por la captura más antigua: registra la captura en el servidor, luego sube cada archivo directamente al almacenamiento y le pide al servidor que compruebe que el archivo llegó entero. Cada paso se puede repetir sin riesgo, así que una conexión que se corta a mitad simplemente continúa.

Cuando un paso falla por la red o porque el servidor está ocupado, la cola espera y lo vuelve a intentar: 2 segundos, luego 4, 8 y así hasta una espera máxima de 5 minutos. La cola también se despierta cuando vuelve la conexión y cada vez que hay algo nuevo listo.

La pestaña **Resumen** del evento muestra **Archivos esperando subirse**, **Cabinas conectadas** y la **Cola de renderizado** de todos los dispositivos que usan el evento.

## Antes de irte del lugar

1. Comprueba que la etiqueta de la cabina diga que no hay nada pendiente, y que el **Resumen** del evento diga **Todo está subido**.
2. Si no es así, deja el dispositivo encendido y al alcance del wifi, o usa el punto de acceso de tu teléfono. Deja abierta la pestaña de la cabina: la cola trabaja dentro de la página.
3. No borres los datos del sitio del navegador ni desinstales la app hasta que haya terminado. Los archivos que aún no se subieron solo existen en ese almacenamiento.

> [!WARNING]
> Un dispositivo que se formatea, o cuyos datos del navegador se borran, se lleva consigo cualquier captura que aún no se haya subido. Si la única copia de un evento está en el dispositivo, termina primero las subidas.

## Las actualizaciones nunca interrumpen un evento

Una versión nueva de la app no toma el control mientras la cabina está abierta. Se activa cuando se han cerrado todas las pestañas de la app, así que una cabina no puede cambiar en mitad de un evento.
