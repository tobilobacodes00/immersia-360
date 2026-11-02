---
title: Copiar todos los archivos a tu Google Drive
summary: Conecta Google Drive una vez, elige una carpeta y cada archivo terminado se guarda también en tu propio Drive, sin que Immersia vea nada más.
category: cloud
order: 10
keywords: [google drive, drive, nube, copia de seguridad, copiar, conectar, integraciones, carpeta, archivo, oauth]
updated: 2026-10-28
related: [connect-dropbox, cloud-copy-errors, expiry-and-extending, team-roles]
---

Los invitados siempre descargan desde Immersia. Conectar Google Drive añade una segunda copia de cada video, tira y GIF terminado en tu propio Drive. La copia es tuya y la conservas cuando caducan los archivos alojados.

## Conectar

1. Abre **Integraciones** en el Estudio. Solo el **propietario** de la cuenta puede conectar o desconectar una nube.
2. En la tarjeta de **Google Drive**, pulsa **Conectar Google Drive**.
3. Google te pide que inicies sesión y que permitas a Immersia 360. **Deja marcada la casilla de acceso.** Sin ella, Immersia no puede guardar archivos.
4. Vuelves a la página de Integraciones, que dice **Google Drive está conectado. Ya empezó a copiar.** y muestra **Conectado como** tu cuenta de Google.

Si la tarjeta dice **Sin configurar**, este servidor de Immersia no está preparado para Google Drive. Si alojas Immersia tú mismo, consulta las notas de configuración del README del proyecto.

> [!NOTE]
> Immersia pide el permiso más acotado que ofrece Google (`drive.file`). Solo ve y toca los archivos y carpetas que crea ella misma, y nunca puede explorar el resto de tu Drive.

## Elige adónde van los archivos

Los archivos van a una carpeta llamada **Immersia 360**, que se crea en tu Drive cuando se hace la primera copia. En **Carpeta**, escribe otro nombre y pulsa **Usar esta carpeta** si lo prefieres. Cada evento tiene su propia subcarpeta con el nombre del evento y su fecha, por ejemplo _Gala 360 2026-10-19_. Los archivos ya copiados se quedan donde están.

Los archivos se nombran con el evento y el código del invitado, por ejemplo `gala-K7M2QX-mp4.mp4`, así que cada archivo de la carpeta es único.

## Actívalo para un evento

Conectar no basta por sí solo: cada evento elige. En la **Configuración** del evento, en **Compartir**, define **Copiar también a mi nube** como **Google Drive**. Una nube que no está conectada no se puede elegir, y la lista dice por qué.

## Míralo funcionar

La página de Integraciones lista los últimos 20 archivos en **Copias recientes** con un estado (**En espera**, **Copiando**, **Copiado**, **Falló**) y un enlace para abrir cada uno en Drive. La pestaña **Resumen** del evento muestra un aviso cuando las copias a tu nube necesitan tu atención.

Las copias nunca crean duplicados: antes de subir, Immersia comprueba si ya hay un archivo con ese nombre en la carpeta. Los archivos grandes se copian por partes, así que sirve cualquier tamaño.

## Desconectar

**Desconectar** detiene las copias, revoca el acceso de Immersia en Google y borra la conexión guardada. Los archivos ya copiados se quedan en tu Drive. Las copias que aún no se habían hecho se descartan; vuelve a conectar más adelante para ponerte al día.

## Si algo sale mal

Cada mensaje de esta página tiene una solución en [Problemas al copiar a la nube y qué significan](help:cloud-copy-errors). El más habitual es que Google haya cerrado la conexión (**Google Drive necesita que vuelvas a iniciar sesión**): pulsa **Volver a conectar Google Drive** y las copias en espera se completan solas.
