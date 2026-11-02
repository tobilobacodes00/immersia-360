---
title: Mensagens da cabine e o que fazer com elas
summary: Todos os avisos e erros que a cabine pode mostrar (câmera, gravação, salvamento, renderização, envios, fundo) com a solução de cada um.
category: troubleshooting
order: 20
keywords:
  [
    erro,
    aviso,
    mensagem,
    falhou,
    não decodificável,
    codificador,
    gpu,
    webgl,
    aceleração por hardware,
    gravação não suportada,
    armazenamento,
    recuperada,
    h.264,
    hevc,
    renderização falhou,
  ]
updated: 2026-10-28
related: [camera-permissions, render-speed-and-queue, offline-mode-and-uploads, ios-storage-eviction]
---

## Mensagens da câmera

Aparecem num cartão intitulado **A câmera não está disponível**. Toque em **Tentar de novo** depois da solução.

- **O acesso à câmera foi bloqueado / Nenhuma câmera encontrada / Outro app está usando a câmera / Esta câmera não entrega a resolução ou os fps do evento / A câmera só funciona em uma conexão segura (https).** Cada uma tem passos em [Resolver problemas de acesso à câmera](help:camera-permissions).

### A câmera desconectou {#lost}

Um cabo se soltou ou o dispositivo colocou a câmera em repouso. Reconecte-a e tente de novo.

### Este navegador não consegue gravar vídeo {#recording_unsupported}

**"Use Chrome, Edge ou Safari."** O navegador não tem gravador de vídeo (alguns navegadores de Linux e embarcados não têm). Abra a cabine numa versão atual do Chrome, do Edge ou do Safari.

### Algo deu errado ao iniciar a câmera {#unknown}

Feche os outros apps que usam a câmera, recarregue a página e tente de novo. Se continuar acontecendo, reinicie o dispositivo.

## Mensagens de salvamento

### Este dispositivo teve problemas para salvar a última gravação {#storage}

**"Tudo até o problema foi mantido. Confira o armazenamento livre."** O dispositivo não conseguiu continuar gravando. Libere espaço (veja [armazenamento no iOS](help:ios-storage-eviction)) e confira a gravação na **Fila de renderização**: o que foi gravado fica guardado e pode ser renderizado.

### Pouco armazenamento {#lowStorage}

Uma etiqueta na barra superior: há menos de 2 GB livres no dispositivo. Exclua na **Fila de renderização** as gravações de que você não precisa mais e libere outro espaço antes dos próximos convidados.

### Recuperamos 1 gravação interrompida {#recovered}

A página fechou ou travou durante uma gravação. A gravação foi mantida até o último momento salvo, aparece marcada como **Recuperada** na fila de renderização e será renderizada como qualquer outra.

## Mensagens de renderização

Aparecem ao lado de uma gravação marcada como **Falhou** na **Fila de renderização**. Toque em **Tentar de novo** depois da solução.

### Este dispositivo não consegue ler o formato do vídeo {#undecodable}

A gravação está num formato que o navegador não consegue decodificar. Acontece principalmente com clipes importados: vídeo de celular em HEVC (a configuração **Alta eficiência** do iPhone) num navegador sem suporte a HEVC. Grave de novo em **Mais compatível**, ou importe num dispositivo cujo navegador leia HEVC. Veja [Câmera lenta e quadros por segundo](help:slow-motion-tips). É raro nas gravações feitas pela própria cabine.

### Este navegador não consegue codificar o vídeo {#unsupported_encoder}

O navegador não tem um codificador de vídeo H.264, que o MP4 do convidado exige. Use uma versão atual do Chrome, do Edge ou do Safari. No Linux, use o Google Chrome em vez de uma compilação do Chromium sem codecs proprietários.

### O codificador parou de responder {#encoder_stall}

O codificador de vídeo travou, muitas vezes porque o dispositivo está com pouca memória ou quente. Feche outras abas e apps, deixe o dispositivo esfriar e tente de novo. Se se repetir, reinicie o navegador.

### A aceleração gráfica não está disponível {#gpu}

Os vídeos são compostos com WebGL 2, que precisa do hardware gráfico. Ligue **Usar aceleração gráfica quando disponível** (em algumas versões chamada **Usar aceleração de hardware quando disponível**) nas configurações do navegador; no Chrome fica em **Configurações, Sistema**; atualize o driver de vídeo e evite rodar a cabine numa sessão de área de trabalho remota ou máquina virtual sem gráficos.

### Cancelado {#cancelled}

Você tocou em **Cancelar renderização**. A gravação continua; toque em **Tentar de novo** para renderizá-la depois.

### A renderização falhou {#failed}

Um problema inesperado. Toque em **Tentar de novo**. Se falhar de novo, feche outras abas, reinicie o navegador e faça o [teste de configuração](help:setup-check) para descobrir o que o dispositivo não consegue fazer.

## Mensagens de envio

**Offline**, **envios pendentes**, **precisa de atenção** e **Este dispositivo foi removido** são explicados em [Modo off-line e a fila de envios](help:offline-mode-and-uploads).

## Mensagens do fundo

### A troca de fundo não está disponível neste dispositivo; os convidados verão o fundo real {#background}

O evento troca o fundo, mas este dispositivo não conseguiu iniciar o recurso. Ele precisa do modelo que reconhece a pessoa, que o dispositivo baixa na primeira vez em que é usado estando on-line, e de um navegador com gráficos WebGL 2 funcionando. Conecte o dispositivo à internet, recarregue a cabine e faça o [teste de configuração](help:setup-check). Se ainda falhar, use um navegador mais novo ou um dispositivo mais capaz, ou desligue o fundo em **Marca**.
