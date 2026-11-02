---
title: Configurar uma cabine de fotos
summary: Fotos por sessão, contagem regressiva, tamanho do layout, GIFs, boomerangs e vídeos curtos, e o que o convidado vê do primeiro toque até o QR code.
category: photo
order: 10
keywords:
  [
    foto,
    tira,
    colagem,
    layout,
    2x6,
    4x6,
    fotos,
    contagem regressiva,
    refazer,
    gif,
    boomerang,
    vídeo curto,
    live photo,
    cabine de fotos,
  ]
updated: 2026-10-28
related: [printing-setup, templates-and-editor, looks-and-effects, sharing-with-guests]
---

Uma cabine de fotos tira de uma a quatro fotos seguidas, coloca numa tira ou cartão, mostra uma prévia ao convidado e depois entrega um QR code. Abra o evento, vá em **Configuração** e procure a seção **Cabine de fotos**. Se o seu evento tem as duas cabines, as duas seções aparecem.

## As configurações

| Configuração            | Opções                                                    | Observações                                                   |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------- |
| **Fotos por sessão**    | De 1 a 4                                                  | 3 por padrão.                                                 |
| **Contagem regressiva** | De 0 a 10 segundos                                        | Antes da primeira foto. 3 segundos por padrão.                |
| **Pausa entre fotos**   | De 0 a 10 segundos, de meio em meio                       | 2 segundos por padrão.                                        |
| **Permitir refazer**    | Ligado ou desligado                                       | Ligado por padrão: o convidado pode recomeçar a sessão.       |
| **Tamanho do layout**   | Tira 2×6, 4×4, 4×6 retrato, 6×4 paisagem, 5×7, Story 9:16 | 2×6 por padrão. O tamanho story é para telas, não para papel. |
| **GIF**                 | Ligado ou desligado                                       | Ligado por padrão. Um GIF em loop com as fotos.               |
| **Bumerangue**          | Ligado ou desligado                                       | Um clipe curto de ida e volta da última foto.                 |
| **Vídeo curto**         | Ligado ou desligado                                       | Um clipe curto em volta de cada foto, como uma Live Photo.    |
| **Impressão**           | Ligado ou desligado                                       | Veja [Imprimir no tamanho certo](help:printing-setup).        |

A cabine tira as fotos em 1080p e 30 quadros por segundo, quaisquer que sejam as configurações de vídeo do evento.

## O que o convidado faz

1. Toca no botão de início (ou aperta uma tecla, veja [Iniciar com teclado, controle ou movimento](help:capture-triggers-and-shortcuts)).
2. Vê uma contagem regressiva antes de cada foto (a primeira usa **Contagem regressiva**, as outras **Pausa entre fotos**) e um flash quando cada uma é tirada.
3. Vê a tira pronta com a mensagem **Ficou ótimo!** e escolhe **Ficar com esta** ou **Refazer** (se você permitiu refazer). Se ninguém tocar na tela por 20 segundos, a tira é mantida.
4. Chega à tela de resultado com um QR code, e um botão **Imprimir** se a impressão estiver ligada.

O GIF, o bumerangue e o vídeo curto são feitos em segundo plano depois de o convidado já ter o QR code, e aparecem na página dele quando ficam prontos. O bumerangue e o vídeo curto precisam que a cabine guarde uma breve gravação contínua da câmera, então a cabine só faz isso quando um dos dois está ligado.

## A aparência da tira

Cada tamanho vem com um layout pronto: fotos distribuídas sobre um painel de título com o nome e a data do evento e, nas impressões, o QR code e o código curto do convidado. Mude em **Marca** (**Layout de impressão**) ou escolha um dos designs incluídos. Veja [Modelos e editor de design](help:templates-and-editor) e [Estilos, efeitos e troca de fundo](help:looks-and-effects), que também trata do efeito de foto e do fundo.

Se você mudar o tamanho do layout depois de desenhar um layout, o design é ajustado ao novo tamanho.

## QR codes nas impressões

Com **Código QR nas impressões** ligado (em **Compartilhamento**), cada impressão leva um pequeno código no canto que abre a página do convidado. Ele tem pelo menos 18 milímetros de largura, grande o bastante para um celular ler à distância de um braço. A prévia que o convidado vê antes de ficar com a tira mostra onde o código vai; o código em si é adicionado à tira mantida.

> [!TIP]
> Teste com o [teste de configuração](help:setup-check): ele faz uma renderização de teste de verdade e, nas cabines de fotos, imprime uma folha de calibração no seu tamanho de impressão para você conferir o papel antes de os convidados chegarem.
