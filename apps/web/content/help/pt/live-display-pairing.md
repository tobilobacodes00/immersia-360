---
title: Mostre as capturas numa TV com o Live Display
summary: Ative o Live Display, pareie uma TV ou qualquer tela com um código de seis caracteres, escolha um layout e defina quanto tempo cada captura fica no ar.
category: live
order: 10
keywords:
  [
    live display,
    tv,
    tela,
    parear,
    pareamento,
    código,
    projetor,
    layout,
    destaque,
    mosaico,
    faixa,
    contador,
    chromecast,
    hdmi,
    telão,
    navegador da tv,
  ]
updated: 2026-10-28
related: [live-display-moderation, sharing-station, offline-mode-and-uploads]
---

O Live Display mostra cada captura nova numa TV, num projetor ou num notebook ligado por HDMI, cada uma com o próprio QR code, para que os convidados levem a deles direto da tela. Qualquer dispositivo com um navegador web pode ser uma tela.

## Ative

Abra o evento e vá para a aba **Live Display**. **Mostrar as capturas nas telas** fica desligado até você ligá-lo. Na tela de resultado, os convidados são avisados de que a captura deles pode aparecer no telão do evento, e cada um pode escolher **Não mostrar a minha no telão**.

Ao lado, **Publicação** decide se as capturas novas sobem sozinhas (**Mostrar automaticamente**) ou esperam por você (**Aprovar antes**). Veja [Moderar o que aparece na tela](help:live-display-moderation).

## Pareie uma tela {#pair}

1. No cartão **Telas**, toque em **Parear uma tela**. Aparece um código de seis caracteres, válido por 10 minutos.
2. Na tela, abra o navegador e vá para o endereço mostrado na janela, que termina em `/tv`.
3. Digite o código e toque em **Conectar tela**.

Só letras e números, e nunca I, L, O, 0 nem 1. Um tablet ou celular que vai ser a tela pode simplesmente escanear o QR code da mesma janela: isso abre o endereço de pareamento com o código já preenchido e pareia na hora.

Um código expirado mostra **Esse código expirou. Crie um novo no Estúdio.** Toque em **Gerar um código novo**. Os códigos de pareamento são limitados a 20 tentativas por rede a cada 10 minutos, para que não possam ser adivinhados.

A tela lembra que está pareada naquele navegador. Se você limpar os dados do site no navegador ou usar uma janela privada, pareie de novo.

## Layouts e configurações

Cada tela tem o próprio nome, layout e reprodução, e as mudanças chegam a ela em menos de um segundo:

| Configuração              | Opções                                                                                                                                                                                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layout**                | **Destaque** (uma captura em tela cheia com o QR code ao lado), **Mosaico** (de seis a doze tocando sem som, a da vez ampliada com o QR), **Faixa** (Destaque mais uma tira de capturas recentes e um selo de "acabou de chegar"), **Contador** (o logo e quantos momentos foram capturados) |
| **Tempo por item**        | De 3 a 15 segundos, 8 por padrão. Os vídeos tocam até o fim, até três vezes esse tempo.                                                                                                                                                                                                      |
| **Silenciar vídeos**      | Ligado por padrão.                                                                                                                                                                                                                                                                           |
| **Tamanho do QR**         | Pequeno, Médio, Grande.                                                                                                                                                                                                                                                                      |
| **Canto do QR do evento** | O canto onde fica o código da galeria do evento inteiro.                                                                                                                                                                                                                                     |
| **Vídeos verticais**      | **Fundo desfocado** ou **Lado a lado**, para vídeos 9:16 numa tela horizontal.                                                                                                                                                                                                               |

Uma captura nova fura a fila: o item na tela é encurtado, mas nunca para menos de 3 segundos, então um convidado parado diante da tela vê a dele em poucos segundos.

## Na tela

- **Tela cheia**: pressione **F**, ou use o botão no canto.
- **Som**: os navegadores bloqueiam o som até alguém interagir. Com **Silenciar vídeos** desligado, uma mensagem diz **Pressione OK para ligar o som**: pressione (ou toque) uma vez.
- **Status** no canto: **Ao vivo**, **Ao vivo, atualizando** (quando a conexão em tempo real não está disponível, a tela pergunta se há novidades a cada poucos segundos, o que continua dentro de 5 segundos) ou **Sem conexão, repetindo os momentos salvos**.

Uma tela guarda a própria cópia dos últimos 200 itens e das mídias deles, então, se a conexão cair no meio do evento, ela continua repetindo o que tem em vez de ficar em branco.

## Remova ou pareie de novo uma tela

**Remover**, ao lado de uma tela, a interrompe na hora: ela volta para a página de pareamento. A lista mostra **On-line** para uma tela vista nos últimos dois minutos.

> [!TIP]
> Coloque o navegador da tela em tela cheia e impeça a TV de entrar em repouso. Veja [Travar a cabine para os convidados](help:kiosk-locking) para ideias que também servem para uma tela.
