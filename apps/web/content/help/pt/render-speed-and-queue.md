---
title: Velocidade de renderização e fila de renderização
summary: Como a cabine faz os vídeos em segundo plano, o que a fila mostra, a que velocidade deveria andar e o que mudar quando está lenta.
category: booth
order: 40
keywords:
  [
    renderização,
    fila,
    lento,
    velocidade,
    codificador,
    segundo plano,
    aguardando,
    renderizando,
    falhou,
    tentar de novo,
    ipad,
    notebook,
    desempenho,
  ]
updated: 2026-10-28
related: [setup-check, 360-booth-setup, booth-error-messages, offline-mode-and-uploads]
---

## O que acontece depois de um giro

A cabine salva primeiro a gravação bruta no dispositivo e depois renderiza a partir dela o vídeo do convidado (câmera lenta, sobreposição, abertura e encerramento, música, estilo, efeitos e fundo) no mesmo dispositivo. A renderização roda em segundo plano, uma gravação por vez, então o próximo convidado já pode estar girando.

Para manter a câmera fluida, a renderização pausa enquanto um convidado está sendo capturado, desde o momento em que a câmera liga até a tela de "Salvo" sumir, e volta alguns segundos depois de a cabine ficar pronta de novo. Numa hora movimentada a fila pode crescer e depois diminuir nos momentos mais calmos.

## A fila de renderização

A etiqueta na barra superior da cabine mostra o estado: **Nada aguardando**, **3 gravações aguardando** ou **Renderizando 40%**. Toque nela para abrir a **Fila de renderização**. Cada gravação mostra quando foi feita, a duração e o tamanho, e um status:

| Status                     | Significado                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| **Pronta para renderizar** | Salva e esperando a vez.                                                                           |
| **Renderizando**           | Sendo feita agora. **Cancelar renderização** a interrompe.                                         |
| **Renderizada**            | Pronta. **Reproduzir** mostra o vídeo final.                                                       |
| **Falhou**                 | Algo interrompeu a renderização. O motivo aparece, e **Tentar de novo** a coloca de volta na fila. |
| **Recuperada**             | A página foi fechada ou travou durante a gravação. O que foi salvo até então é mantido.            |
| **Importada**              | Um arquivo de vídeo que você adicionou do disco.                                                   |

Uma gravação nunca é apagada sozinha. **Excluir** a remove, junto com o que foi renderizado a partir dela, deste dispositivo; arquivos já enviados não são afetados. Se a aba da cabine for fechada no meio de uma renderização, essa gravação simplesmente volta para a fila quando a cabine abrir de novo.

Depois do vídeo principal, a cabine também faz uma imagem de capa e, se a **Versão menor para mensagens** estiver ligada, uma cópia mais leve para o WhatsApp e apps parecidos. As duas são feitas atrás de qualquer gravação que ainda esteja aguardando.

## A que velocidade deveria andar?

A meta: um clipe de 15 segundos em 1080p é renderizado em **45 segundos ou menos num notebook e em 90 segundos ou menos num iPad de 2021**. O [teste de configuração](help:setup-check) mede o seu dispositivo em relação a isso, com as configurações reais do seu evento. Quando o dispositivo está dentro da meta, o vídeo de um convidado chega cerca de uma renderização depois do giro, ou seja, em um ou dois minutos.

## Se está lenta

Em ordem de efeito:

1. **Baixe os quadros por segundo** para 30 fps em **Configuração**. Reduz o trabalho quase pela metade.
2. **Baixe a resolução** de 4K para 1080p, ou de 1080p para 720p.
3. **Escolha qualidade Pequena ou Equilibrada** em vez de Original.
4. **Use menos efeitos**, e pense bem na troca de fundo, que procura o convidado em cada quadro. Um estilo é barato; vários efeitos, não.
5. **Encurte o giro ou a parte em câmera lenta.** Trechos desacelerados precisam de quadros intermediários extras.
6. **Feche outras abas e apps**, mantenha o dispositivo fresco e na tomada. Celulares e tablets ficam mais lentos quando esquentam ou no modo de economia de bateria.
7. **Use um dispositivo mais rápido** em eventos movimentados, ou rode uma segunda cabine em outro dispositivo.

> [!NOTE]
> Uma gravação é renderizada no dispositivo que a gravou. Clipes que você filmar no app de câmera de outro dispositivo podem ser adicionados com **Importar vídeos** nas configurações da cabine, e são renderizados no dispositivo para o qual você os importar.

## Se uma renderização falhar

O motivo aparece ao lado da gravação. Os mais comuns são **Este dispositivo não consegue ler o formato do vídeo**, **Este navegador não consegue codificar o vídeo** e **A aceleração gráfica não está disponível**. Cada um tem solução em [Mensagens da cabine e o que fazer](help:booth-error-messages).
