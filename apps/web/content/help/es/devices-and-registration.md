---
title: Registrar y gestionar dispositivos de cabina
summary: Por qué una cabina funciona en un dispositivo registrado, cómo nombrar, revisar y revocar dispositivos, y qué pasa cuando revocas uno.
category: start
order: 30
keywords: [dispositivo, registrar, revocar, token, ipad, laptop, tableta, renombrar, conectado, visto por última vez]
updated: 2026-10-28
related: [setup-check, offline-mode-and-uploads, team-roles]
---

Una cabina solo graba en un **dispositivo registrado**, así que cada toma y cada subida pertenece a tu cuenta y puedes cortar un dispositivo en cualquier momento. No hay límite de dispositivos que puedas registrar, ni cuesta nada hacerlo.

## Registrar un dispositivo

Puedes registrarlo desde la propia cabina o desde el Estudio:

- **Desde la cabina.** La primera vez que un dispositivo abre una cabina muestra **Registrar este dispositivo**. Escribe un nombre que reconozcas en el lugar del evento, como _iPad de la cabina A_, y pulsa **Registrar y continuar**.
- **Desde el Estudio.** Abre **Dispositivos y equipo**. En el propio dispositivo pulsa **Registrar dispositivo**, junto a **Usar este navegador como cabina**.

Al registrarlo, el navegador recibe un token largo y aleatorio que se guarda en ese navegador. El servidor guarda solo una huella de él. La cabina presenta el token cada vez que sube un archivo, pide códigos cortos o informa de su estado, así que una cabina sigue subiendo durante todo el evento aunque se cierre la sesión del operador.

> [!NOTE]
> El token vive en los datos del sitio del navegador. Si borras esos datos, o usas una ventana privada, el dispositivo olvida que está registrado y lo vuelve a pedir. Regístralo de nuevo y renombra o revoca la entrada antigua.

## Qué muestra la lista

De cada dispositivo ves su nombre, su plataforma y navegador, cuándo se vio por última vez y su ruta de renderizado:

| Etiqueta                                | Significado                                                                                                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renderiza en el dispositivo             | El dispositivo puede renderizar los videos por sí mismo a la velocidad objetivo.                                                                                       |
| renderiza en el dispositivo (más lento) | Puede, pero más lento que el objetivo, o sin codificación de video por hardware. Usa un dispositivo más rápido para eventos concurridos.                               |
| renderiza en la nube                    | Al navegador le falta lo que necesita el renderizado (gráficos acelerados o codificación de video), o la prueba de configuración no pudo renderizar un clip de prueba. |

Un dispositivo aparece como **Conectado** cuando se vio en los últimos dos minutos. Una cabina abierta informa cada 30 segundos, junto con cuántas tomas esperan para renderizarse y cuántos archivos esperan para subirse.

La ruta de renderizado empieza como una estimación rápida hecha al registrar, y la sustituye una medida cuando haces la [prueba de configuración](help:setup-check). Es solo una pista: hoy cada cabina renderiza en el dispositivo en el que funciona.

## Renombrar y revocar

- **Renombrar** cambia el nombre en la lista, no el dispositivo.
- **Revocar** corta un dispositivo al instante. La próxima vez que hable con el servidor, este lo rechaza, y su cabina muestra **Este dispositivo se eliminó: regístralo de nuevo para subir**. Los archivos ya subidos se quedan. Lo que aún espera en el dispositivo se queda ahí; regístralo de nuevo para subirlo.

Los propietarios y los operadores pueden registrar y renombrar dispositivos; los lectores pueden ver la lista. Solo los propietarios pueden revocar. Consulta [Miembros del equipo y roles](help:team-roles).

## Buenos hábitos

- Nombra los dispositivos por dónde trabajan, no por lo que son: _iPad de la cabina A_, _Laptop de la entrada_.
- Revoca un dispositivo que se pierda, se venda o se preste.
- Registra cada navegador que uses como cabina. Chrome y Safari en la misma laptop son dos dispositivos.
