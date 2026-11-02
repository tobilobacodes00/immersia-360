---
title: Configurar uma cabine 360
summary: As configurações que dão forma a um vídeo 360 (resolução, quadros por segundo, duração do giro, contagem regressiva, qualidade) e como escolhê-las.
category: booth
order: 10
keywords:
  [
    360,
    giro,
    plataforma,
    vídeo,
    resolução,
    4k,
    fps,
    proporção,
    vertical,
    contagem regressiva,
    qualidade,
    microfone,
    som,
  ]
updated: 2026-10-28
related: [slow-motion-tips, capture-triggers-and-shortcuts, render-speed-and-queue, setup-check]
---

Uma cabine 360 grava uma gravação contínua enquanto a plataforma gira e depois renderiza o vídeo pronto no dispositivo. Abra o evento, vá em **Configuração** e procure a seção **Vídeo 360**.

## O vídeo

| Configuração            | Opções                              | Observações                                                        |
| ----------------------- | ----------------------------------- | ------------------------------------------------------------------ |
| **Resolução**           | 720p, 1080p, 4K                     | 1080p por padrão. 4K só onde a câmera suporta.                     |
| **Quadros por segundo** | 30 fps, 60 fps                      | 60 fps por padrão. 60 fps dá uma câmera lenta mais suave.          |
| **Proporção**           | 9:16, 1:1, 16:9                     | 9:16 é um vídeo vertical feito para celulares.                     |
| **Duração do giro**     | De 3 a 20 segundos, de meio em meio | 8 segundos por padrão. A gravação para sozinha depois desse tempo. |
| **Contagem regressiva** | De 0 a 10 segundos                  | 3 segundos por padrão.                                             |
| **Qualidade**           | Pequena, Equilibrada, Original      | Equilibrada dá uns 8 a 12 MB para um clipe de 15 s em 1080p.       |
| **Gravar som**          | Ligado ou desligado                 | Desligado por padrão: a trilha sonora vem da música do evento.     |

Em 1080p um vídeo 9:16 tem 1080 × 1920 pixels; em 4K, 2160 × 3840. A gravação que sai da câmera é salva no dispositivo com taxa de bits alta e o vídeo do convidado é feito a partir dela, então uma qualidade de saída menor não reduz o original que você guarda até apagá-lo.

> [!TIP]
> Mais alto nem sempre é melhor. 4K a 60 fps exige muito da câmera e do dispositivo que renderiza. Faça o [teste de configuração](help:setup-check) com as configurações que pretende usar. Se a renderização demorar demais, 1080p a 30 fps é a alternativa sensata.

## Câmera lenta e reverso

A câmera lenta desacelera uma parte do giro e toca o resto em velocidade normal. **Reverso** pode tocar essa parte para frente e para trás (**Bumerangue**) ou acrescentar o clipe de novo, invertido, no final (**Invertido**). Veja [Câmera lenta e quadros por segundo](help:slow-motion-tips).

## Como iniciar um giro

**Iniciar uma captura**, na mesma página de Configuração, decide o que inicia uma gravação:

- **Tocar na tela**: o convidado toca no botão de início.
- **Teclado e controles Bluetooth**: Espaço, Enter ou os botões de página de um controle. Veja [Iniciar com teclado, controle ou movimento, e atalhos de teclado](help:capture-triggers-and-shortcuts).
- **Movimento**: a gravação começa quando a plataforma começa a girar. A configuração **Movimento necessário** decide quanto da imagem precisa se mover de lado; um valor menor começa mais cedo.

Você também pode adicionar um clipe já filmado, por exemplo um gravado no app de câmera de um celular: em **Configurações da cabine**, toque em **Escolher arquivos** em **Importar vídeos**, ou arraste arquivos de vídeo para a tela da cabine. Eles são renderizados como qualquer outra gravação.

## Deixe com a sua cara

Na aba **Marca** você adiciona uma sobreposição, uma abertura e um encerramento, música, um estilo de cor, efeitos e um fundo de substituição. Veja [Modelos e editor de design](help:templates-and-editor) e [Estilos, efeitos e troca de fundo](help:looks-and-effects).

## Na cabine

Abra **Configurações da cabine** (o botão de controles deslizantes no canto) para escolher a câmera e a lente, ajustar o zoom, a luz da câmera ou uma luz de preenchimento na tela, e espelhar a prévia. O espelhamento só afeta a tela; as gravações nunca são espelhadas. A luz de preenchimento é uma moldura luminosa ao redor da tela que ilumina o rosto dos convidados; ela não aparece nas gravações.

A cabine pede que a tela fique ligada enquanto estiver aberta. Mantenha o dispositivo na tomada e impeça também que ele entre em repouso, nas configurações dele. Veja [Travar a cabine para os convidados](help:kiosk-locking).

## O que o convidado recebe

Logo após o giro, a cabine mostra um QR code e um código curto. A página do convidado abre na hora e se completa quando o vídeo fica pronto, normalmente em um ou dois minutos. Veja [Como os convidados recebem suas fotos e vídeos](help:sharing-with-guests) e [Velocidade de renderização e fila de renderização](help:render-speed-and-queue).
