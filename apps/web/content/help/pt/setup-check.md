---
title: Fazer o teste de configuração
summary: Teste um dispositivo de cabine antes do evento: câmera, armazenamento, uma gravação de teste, velocidade de renderização, a leitura de um QR, a impressora e os envios.
category: start
order: 20
keywords: [teste, verificação, assistente, fps, benchmark, velocidade de renderização, calibração, régua, teste de qr, preparação]
updated: 2026-10-28
related: [render-speed-and-queue, ios-storage-eviction, printing-setup, offline-mode-and-uploads]
---

O teste de configuração é um teste guiado e curto que você faz no dispositivo que vai operar a cabine. Ele usa a mesma câmera, o mesmo gravador, o mesmo armazenamento, o mesmo mecanismo de renderização e o mesmo caminho de envio que a cabine usa, então passar no teste significa que a cabine vai funcionar. Cada etapa termina em **Ok**, **Conferir** (funciona, mas vale olhar) ou **Corrigir** (vai dar problema), com o que fazer.

## Onde começar

- Na página do evento, toque em **Teste de configuração**.
- Na cabine, abra **Configurações da cabine** e toque em **Executar** ao lado de **Teste de configuração**.
- Na primeira vez que um dispositivo abre uma cabine, a tela inicial oferece o teste. **Pular por enquanto** fica lembrado para aquele dispositivo naquele navegador.

Faça o teste no dispositivo e no navegador que você vai usar no evento, do mesmo lugar e na mesma rede.

## As etapas

### Câmera e lente

Escolha a câmera e a lente (o mesmo seletor das configurações da cabine) e olhe a imagem. Depois o teste conta, por cerca de dois segundos e meio, os quadros por segundo que a câmera entrega de verdade.

- **Ok** quando entrega pelo menos 90% do que o evento pede.
- **Conferir** quando está mais lenta mas ainda fluida (pelo menos 24 fps), por exemplo uma webcam de 30 fps num evento de 60 fps. A câmera lenta fica menos suave. Você também pode baixar o evento para 30 fps.
- **Corrigir** abaixo de 24 fps, que parece travado. Feche outros apps que usam a câmera, tente outra câmera ou outra porta e acrescente luz.

### Armazenamento

As gravações ficam no dispositivo até serem enviadas. O teste pede ao navegador que guarde os dados deste site, lê o espaço livre e anota onde as gravações são gravadas. Avisa abaixo de 2 GB livres e falha abaixo de cerca de 0,5 GB. Se o navegador não prometer guardar os dados, você recebe conselhos para o seu navegador. Veja [Armazenamento no iPad e no iPhone](help:ios-storage-eviction).

### Gravação de teste

Grava quatro segundos com o gravador da própria cabine, escreve no armazenamento do dispositivo, lê o arquivo de volta e confere o tamanho e a duração. O arquivo de teste é apagado quando o teste termina.

### Velocidade de renderização

Renderiza a gravação de teste com as configurações de saída deste evento no mecanismo de renderização de verdade e depois converte o tempo para um clipe de 15 s em 1080p, a régua que prometemos:

| Resultado     | Significado                                                             |
| ------------- | ----------------------------------------------------------------------- |
| 45 s ou menos | **Ok**: dentro da meta para um notebook                                 |
| De 46 a 90 s  | **Conferir**: dentro da meta de um iPad de 2021, lento para um notebook |
| Mais de 90 s  | **Corrigir**: os convidados esperariam muito                            |

A estimativa é um pouco pessimista, porque um clipe curto inclui o tempo de partida. Se o evento troca o fundo, o teste de renderização também troca, então a velocidade o inclui, e você recebe um aviso se o dispositivo não consegue iniciar esse recurso. O resultado fica salvo no dispositivo como seu **caminho de renderização**. Veja [Velocidade de renderização e fila de renderização](help:render-speed-and-queue).

### Leitura de QR de teste

Mostra um QR code. Aponte um celular para ele: a página que abrir diz **Lido**, e o teste percebe isso em alguns segundos. Isso prova que os celulares dos convidados alcançam o servidor de onde a cabine está. O código vale por 10 minutos. Se a cabine estiver aberta num endereço local como `localhost`, você recebe um aviso, porque celulares de outras redes não conseguem abri-la.

### Teste da impressora (cabines de fotos)

Imprime uma folha de calibração no tamanho de impressão do evento, a 300 DPI, com o mesmo código de impressão que a impressão de um convidado usa. Depois você confere com uma régua:

- a **régua de 50 mm** deve medir 50 mm, com tolerância de 1 mm;
- as marcas dos cantos ficam à distância impressa na folha;
- o **círculo de 20 mm** deve parecer redondo;
- as quatro molduras finas ficam a 1, 2, 3 e 4 mm de cada borda. Cada moldura que falta significa cerca de 1 mm cortado.

Em seguida você diz o que viu. A menos de 1 mm e sem cortes é **Ok**. Veja [Imprimir no tamanho certo](help:printing-setup). O tamanho de story 9:16 é para telas, então não há nada a imprimir.

### Envio e rede

Pede ao servidor um envio assinado, manda 1 MB direto ao armazenamento como o arquivo de um convidado, e faz o servidor confirmar que chegou inteiro e apagá-lo. Informa a velocidade. Abaixo de 2 Mbit/s você recebe um aviso, porque um clipe típico de 12 MB levaria mais de 45 segundos para chegar ao convidado.

## Resultados

No fim você vê cada etapa com seu resultado e o que fazer. Toque em **Refazer o teste** depois de corrigir algo.

O registro do dispositivo é atualizado com o tamanho e os quadros por segundo que a câmera entregou, a velocidade de renderização medida, o caminho de renderização e quando o teste foi feito. **Dispositivos** mostra o caminho de renderização ao lado do dispositivo. Também contamos que um teste terminou (com a velocidade de renderização, os fps da câmera e o navegador) na nossa própria análise, que não identifica nenhum convidado.

> [!NOTE]
> O caminho de renderização é uma dica. Hoje cada cabine renderiza no dispositivo em que roda, então um resultado "mais lento" ou "não consegue renderizar" significa: use um dispositivo mais rápido neste evento.
