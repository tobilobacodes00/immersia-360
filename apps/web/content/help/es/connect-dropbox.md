---
title: Copiar todos los archivos a tu Dropbox
summary: Conecta Dropbox una vez y cada archivo terminado se guarda también en una carpeta de Immersia en tu propio Dropbox, sin acceso a nada más.
category: cloud
order: 20
keywords:
  [dropbox, nube, copia de seguridad, copiar, conectar, integraciones, carpeta, carpeta de la aplicación, archivo]
updated: 2026-10-28
related: [connect-google-drive, cloud-copy-errors, expiry-and-extending]
---

Los invitados siempre descargan desde Immersia. Conectar Dropbox añade una segunda copia de cada video, tira y GIF terminado en tu propio Dropbox. La copia es tuya y la conservas cuando caducan los archivos alojados.

## Conectar

1. Abre **Integraciones** en el Estudio. Solo el **propietario** de la cuenta puede conectar o desconectar una nube.
2. En la tarjeta de **Dropbox**, pulsa **Conectar Dropbox**.
3. Dropbox te pide que inicies sesión y que permitas a Immersia 360. Permítelo.
4. Vuelves a la página de Integraciones, que dice **Dropbox está conectado. Ya empezó a copiar.** y muestra **Conectado como** tu cuenta de Dropbox.

Si la tarjeta dice **Sin configurar**, este servidor de Immersia no está preparado para Dropbox. Si alojas Immersia tú mismo, consulta las notas de configuración del README del proyecto.

> [!NOTE]
> Immersia trabaja solo dentro de la carpeta que crea en tu Dropbox (una "carpeta de aplicación", que está en **Aplicaciones** dentro de tu Dropbox). Nunca ve el resto de tus archivos.

## Elige adónde van los archivos

Los archivos van a una carpeta llamada **Immersia 360** dentro de esa carpeta de aplicación, que se crea cuando se hace la primera copia. En **Carpeta**, escribe otro nombre y pulsa **Usar esta carpeta** para cambiarla. Cada evento tiene su propia subcarpeta con el nombre del evento y su fecha, por ejemplo _Gala 360 2026-10-19_. Los archivos ya copiados se quedan donde están.

## Actívalo para un evento

Cada evento elige. En la **Configuración** del evento, en **Compartir**, define **Copiar también a mi nube** como **Dropbox**. Una nube que no está conectada no se puede elegir, y la lista dice por qué.

## Míralo funcionar

La página de Integraciones lista los últimos 20 archivos en **Copias recientes** con un estado (**En espera**, **Copiando**, **Copiado**, **Falló**) y un enlace para abrir cada uno en Dropbox. Las copias nunca crean duplicados: antes de subir, Immersia comprueba si ya hay un archivo con ese nombre en la carpeta.

## Desconectar

**Desconectar** detiene las copias, revoca el acceso de Immersia y borra la conexión guardada. Los archivos ya copiados se quedan en tu Dropbox. Las copias que aún no se habían hecho se descartan; vuelve a conectar más adelante para ponerte al día.

## Si algo sale mal

Cada mensaje tiene una solución en [Problemas al copiar a la nube y qué significan](help:cloud-copy-errors). Si Dropbox está lleno, libera espacio y pulsa **Reintentar**. Si Dropbox cerró la conexión, pulsa **Volver a conectar Dropbox**.
