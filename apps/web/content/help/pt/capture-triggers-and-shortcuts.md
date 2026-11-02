---
title: Iniciar com teclado, controle ou movimento, e atalhos de teclado
summary: Todas as formas de iniciar e parar uma captura, as teclas que um controle Bluetooth pode enviar e os atalhos da cabine, do editor e de uma Live Display.
category: booth
order: 30
keywords:
  [
    teclado,
    atalhos,
    controle,
    controle remoto,
    bluetooth,
    apresentador,
    page down,
    espaço,
    enter,
    escape,
    teclas de atalho,
    movimento,
    gatilho,
    iniciar,
  ]
updated: 2026-10-28
related: [360-booth-setup, kiosk-locking, templates-and-editor]
---

## Formas de iniciar uma captura

Na **Configuração** do evento, em **Iniciar uma captura**, ative qualquer uma destas:

- **Tocar na tela.** O convidado toca no botão de início.
- **Teclado e controles Bluetooth.** Apertar uma tecla inicia a captura. Útil para um operador, ou para um convidado com um apresentador de slides.
- **Movimento** (cabine 360). A cabine vigia a câmera e começa quando a plataforma começa a girar. Sem contagem regressiva, porque a plataforma já está se movendo. Uma pausa impede que comece de novo logo em seguida. Você também pode ativar o movimento e ajustar **Movimento necessário** em **Configurações da cabine** para este dispositivo.

## Teclas que iniciam uma captura

Quando a cabine está pronta para um convidado (ou na tela de resultado do convidado), qualquer uma destas teclas inicia uma captura:

| Tecla                                        | Origem típica                                                         |
| -------------------------------------------- | --------------------------------------------------------------------- |
| **Espaço**, **Enter**                        | Um teclado                                                            |
| **Page Down**, **Page Up**                   | A maioria dos apresentadores de slides                                |
| **Seta para a direita**, **Seta para baixo** | Alguns apresentadores e teclados                                      |
| **F4**                                       | Alguns controles                                                      |
| **Aumentar volume**                          | Disparadores de câmera, quando o sistema repassa a tecla ao navegador |

As teclas são ignoradas enquanto alguém digita num campo, quando uma tecla modificadora (Ctrl, Alt, Command) está pressionada e quando uma tecla fica segura repetindo. Elas não fazem nada enquanto a galeria está aberta, para que um toque perdido não inicie uma gravação por trás dela.

Para parar antes uma gravação 360, aperte **End** ou **Escape**, ou toque em **Parar**. O giro também termina sozinho depois da **Duração do giro**.

## Em outros lugares

| Onde                       | Tecla                                                   | Faz                                                                                     |
| -------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Painéis da cabine          | **Escape**                                              | Fecha as configurações, a fila de renderização ou a galeria.                            |
| Teclado do PIN de quiosque | **0** a **9**, **Backspace**, **Enter**, **Escape**     | Digita, apaga, desbloqueia, cancela.                                                    |
| Tela Live Display          | **F**                                                   | Liga e desliga a tela cheia.                                                            |
| Editor de modelos          | **Ctrl/Cmd+Z**                                          | Desfazer.                                                                               |
|                            | **Ctrl/Cmd+Shift+Z** ou **Ctrl/Cmd+Y**                  | Refazer.                                                                                |
|                            | **Ctrl/Cmd+A**                                          | Selecionar tudo.                                                                        |
|                            | **Ctrl/Cmd+D**                                          | Duplicar a seleção.                                                                     |
|                            | **Delete** ou **Backspace**                             | Excluir a seleção.                                                                      |
|                            | **Escape**                                              | Desmarcar.                                                                              |
|                            | **Ctrl/Cmd+]** e **Ctrl/Cmd+[**                         | Trazer para frente, enviar para trás (com **Shift**, para o primeiro e o último plano). |
|                            | **Teclas de seta**                                      | Mover 1 pixel (segure **Shift** para 10).                                               |
| Alças de corte da música   | **Teclas de seta**, **Page Up/Down**, **Home**, **End** | Move a alça (segure **Shift** para passos maiores).                                     |

> [!TIP]
> Teste seu controle com o [teste de configuração](help:setup-check) ou na tela inicial da cabine antes do evento. Se uma tecla não faz nada, o controle provavelmente envia outra: tente os outros botões dele.
