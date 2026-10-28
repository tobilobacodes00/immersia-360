---
title: A Sharing Station
summary: Um segundo dispositivo onde os convidados encontram a captura pelo código, tocam nela e escaneiam o QR code, sem encostar na cabine.
category: sharing
order: 20
keywords: [sharing station, estação, segunda tela, tablet, buscar pelo código, escanear, fila, convidados, quiosque]
updated: 2026-10-28
related: [live-display-pairing, live-display-moderation, kiosk-locking, faq-guest-lost-qr]
---

Num evento movimentado, a tela de resultado da cabine fica ligada só por pouco tempo. A Sharing Station é um segundo tablet ou notebook, colocado um pouco afastado da cabine, aonde os convidados podem voltar para pegar a captura quando quiserem: eles a encontram, tocam nela e escaneiam o QR code que aparece.

## Abra a estação

1. Confira se **Mostrar as capturas nas telas** está ligado na aba **Live Display** do evento. A Sharing Station mostra as mesmas capturas que as telas e nada mais, então com o Live Display desligado ela fica vazia.
2. Na aba **Live Display**, toque em **Abrir a Sharing Station**. Ela abre numa nova aba. Você também pode ir direto ao endereço `/station/` seguido do id do evento.
3. No dispositivo que será a estação, entre no Studio com uma conta de operador. A estação usa a conta conectada, então uma conta de leitor não consegue abri-la.
4. Toque em **Iniciar a Sharing Station**. Ela mantém a tela acesa e vai para tela cheia se o evento tiver um PIN de saída.

## O que os convidados veem

- As capturas mais recentes primeiro, como imagens com os códigos de seis caracteres.
- Uma caixa para **Buscar pelo código**: ao digitar alguns caracteres, a lista diminui. Um código que ainda não está lá diz **Ainda não há captura com esse código. Ela pode estar a caminho.**
- Ao tocar numa captura, ela abre grande, com o QR code, o código em letras grandes e **Escaneie com a câmera do celular para baixar.** Depois de 45 segundos sem toque, a visualização grande se fecha sozinha, para o próximo convidado não ver a captura de outra pessoa.
- Se a conexão cair, a estação mantém o que já tem e diz **Off-line: mostrando o que já estava aqui**.

A lista segue as regras do Live Display: só aparecem as capturas que estão na tela, o que significa que uma captura que você ocultou, uma que ainda espera aprovação e uma cujo convidado pediu para não aparecer na tela não estão lá. Veja [Moderar o que aparece na tela](help:live-display-moderation). As 200 capturas mais recentes são mantidas.

## Mantenha os convidados na estação

A estação usa o mesmo PIN de saída da cabine. Com um PIN definido para o evento, ela roda em tela cheia com o mesmo canto oculto do operador (toque três vezes no canto superior esquerdo). Veja [Travar a cabine para os convidados](help:kiosk-locking).

Um convidado que escaneia um código na estação chega à mesma página de quem escaneou o código da cabine.
