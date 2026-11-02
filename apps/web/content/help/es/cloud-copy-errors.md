---
title: Problemas al copiar a la nube y qué significan
summary: Cada mensaje de la página de Integraciones y de la página del evento cuando falla la conexión o la copia a Google Drive o Dropbox, con lo que hay que hacer.
category: cloud
order: 30
keywords:
  [
    error,
    volver a conectar,
    iniciar sesión de nuevo,
    cuota,
    lleno,
    almacenamiento lleno,
    carpeta,
    eliminada,
    denegado,
    permiso,
    actualizar,
    reintentar,
    falló,
    dropbox,
    google drive,
    integraciones,
    conexión,
  ]
updated: 2026-10-28
related: [connect-google-drive, connect-dropbox, expiry-and-extending, team-roles]
---

Cuando algo impide que los archivos lleguen a tu Google Drive o a tu Dropbox, la app te dice qué falló y qué hacer. Busca tu mensaje más abajo. **Los invitados nunca se ven afectados**: sus archivos siguen en Immersia, y las copias que no se pudieron hacer esperan y se completan, sin duplicados, en cuanto se arregla el problema.

## Problemas al conectar

Aparecen en un cuadro rojo de la página de Integraciones después de pulsar **Conectar**.

### Cancelaste la conexión {#denied}

**"Cancelaste la conexión, así que no cambió nada."** Pulsaste Cancelar en la pantalla de Google o de Dropbox. Pulsa **Conectar** para intentarlo de nuevo.

### El enlace de inicio de sesión venció {#state}

**"Ese enlace de inicio de sesión venció o no se generó desde esta cuenta."** La conexión hay que terminarla en 10 minutos, por la misma persona y en la misma cuenta. O bien la página de Google o de Dropbox se quedó abierta demasiado tiempo, o bien se abrió desde otra cuenta. Pulsa **Conectar** y termina sin hacer pausas.

### No se concedió el permiso {#scope}

**"… no concedió el permiso que necesita Immersia."** En la pantalla de Google hay una casilla que permite a Immersia ver y crear archivos. Si estaba desmarcada, Immersia no puede guardar archivos. Pulsa **Conectar** otra vez y deja la casilla marcada.

### No se dio un acceso duradero {#no_refresh}

**"… no le dio a Immersia un acceso duradero. Quita Immersia de las aplicaciones conectadas de tu … y vuelve a conectar."** El proveedor recuerda una conexión anterior y no emite una clave nueva de larga duración. Quita Immersia 360 de la lista de aplicaciones con acceso a tu cuenta (en la configuración de seguridad de tu cuenta de Google, en aplicaciones y servicios de terceros, o en Dropbox, en **Configuración** y **Aplicaciones conectadas**) y pulsa **Conectar** otra vez.

### El proveedor rechazó el inicio de sesión {#exchange}

**"… rechazó el inicio de sesión."** Pulsa **Conectar** para intentarlo una vez más. Si sigue pasando, prueba en una ventana privada o sin extensiones del navegador que bloqueen las páginas de inicio de sesión.

### No se pudo contactar con el proveedor {#unreachable}

**"No se pudo contactar con …"** El proveedor no respondió. Revisa la conexión e inténtalo de nuevo en un minuto.

### Este servidor no está configurado para eso {#unavailable}

**"Este servidor no está configurado para …"** (también se muestra como **Sin configurar** en la tarjeta). El servidor de Immersia que usas no tiene credenciales para ese proveedor. Si alojas Immersia tú mismo, añade sus credenciales y `INTEGRATION_TOKEN_KEY` al entorno, como se describe en el README; el servicio alojado lo configura por ti.

### Solo el propietario puede hacerlo {#forbidden}

**"Solo el propietario de la cuenta puede conectar una nube."** Pídele al propietario de la cuenta que la conecte o la desconecte, o que te cambie el rol. Consulta [Roles del equipo](help:team-roles).

### Salió mal otra cosa {#failed}

**"Algo salió mal al conectar …"** Inténtalo de nuevo. Si persiste, contacta con soporte indicando la hora a la que ocurrió. Consulta [Contacto y estado del servicio](help:contact-and-status).

## Problemas al copiar archivos

Aparecen en un archivo de **Copias recientes**, en la tarjeta del proveedor y en un aviso ámbar de la pestaña **Resumen** del evento.

### Tienes que volver a iniciar sesión {#reauth_required}

**"Se revocó o venció el acceso a …"** El proveedor cerró la conexión: quitaste Immersia de tus aplicaciones conectadas, cambiaste tu contraseña o el acceso se agotó por tiempo. No se pierde nada; los archivos nuevos se quedan en Immersia y esperan. Pulsa **Volver a conectar** en la tarjeta y todos los archivos en espera se copian solos.

Si administras tú mismo un proyecto de Google y su pantalla de consentimiento sigue en modo de **prueba**, Google cierra la conexión a los 7 días. Publica la pantalla de consentimiento para evitarlo.

### Tu nube está llena {#quota_exceeded}

**"Tu … está lleno. Libera espacio y pulsa Reintentar."** Libera espacio en tu Drive o Dropbox y pulsa **Reintentar** en la tarjeta.

### El proveedor no respondió {#transient}

**"No se pudo contactar con … tras varios intentos. Pulsa Reintentar."** Immersia lo intentó varias veces (la pausa empieza en 30 segundos y se duplica cada vez) y se rindió a los ocho intentos. Comprueba que el proveedor funcione y pulsa **Reintentar**. Mientras sigue intentándolo, la lista dice **no respondió. Se volverá a intentar …** y no hace falta hacer nada.

### Se eliminó la carpeta {#folder_missing}

**"La carpeta se eliminó de …"** Tú (u otra persona) quitaste la carpeta de Immersia de tu nube. Elige una carpeta en la tarjeta ("Carpeta" y luego **Usar esta carpeta**); las copias fallidas se reinician solas.

### Immersia no puede escribir en esa carpeta {#folder_inaccessible}

**"Immersia no puede escribir en esa carpeta."** La carpeta se movió o cambió el acceso a ella. Crea una carpeta nueva en la tarjeta de la misma manera; las copias fallidas se reinician solas.

### El archivo venció antes de poder copiarse {#source_gone}

**"Este archivo venció en Immersia antes de poder copiarse, así que ya no se puede enviar."** Los archivos de los invitados llegaron al final de su periodo de conservación antes de que se pudiera hacer la copia, normalmente porque la conexión estuvo rota mucho tiempo. Ese archivo no se puede recuperar. Para evitarlo, arregla los problemas de conexión rápido y consulta [Caducidad y ampliación](help:expiry-and-extending): ampliar los enlaces del evento da tiempo a que las copias se pongan al día.

### No se pudo copiar este archivo {#other}

**"No se pudo copiar este archivo. Pulsa Reintentar; si sigue fallando, vuelve a conectar …"** Un error poco habitual. Pulsa **Reintentar**. Si vuelve a fallar, pulsa **Desconectar** y luego **Conectar** otra vez, y contacta con soporte si eso no ayuda.

## Problemas de copia en la página del evento

Un aviso ámbar en la pestaña **Resumen** del evento dice **Las copias a … necesitan tu atención**, con el mismo motivo, y **Abrir Integraciones** te lleva a la tarjeta para solucionarlo. Si el evento está configurado para copiar a una nube que no está conectada en absoluto, lo dice: conéctala y los archivos del evento se ponen al día.
