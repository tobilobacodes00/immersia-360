---
title: Modo off-line e a fila de envios
summary: Como a cabine continua funcionando sem internet, o que significam as etiquetas de envio, o que conferir antes de sair do local e o que precisa de conexão.
category: troubleshooting
order: 30
keywords:
  [
    off-line,
    offline,
    sem internet,
    wifi,
    conexão,
    envio,
    upload,
    fila,
    pendente,
    sincronizar,
    tentar de novo,
    espera progressiva,
    roteador do celular,
    service worker,
    instalar,
    pwa,
    cache,
  ]
updated: 2026-10-28
related: [ios-storage-eviction, setup-check, booth-error-messages, devices-and-registration]
---

O wi-fi dos locais falha. A cabine foi feita para seguir em frente: **nada do que foi gravado se perde, e os convidados continuam recebendo um QR code que funciona**.

## O que continua funcionando sem conexão

- **A captura.** Cada gravação é escrita no armazenamento do dispositivo, pedaço por pedaço, enquanto é gravada, antes de qualquer outra coisa acontecer com ela. Uma falha, um recarregamento ou uma bateria que acaba custam no máximo o último segundo; a gravação volta como **Recuperada**.
- **A renderização.** Os vídeos são feitos no dispositivo. Veja [Velocidade de renderização e a fila](help:render-speed-and-queue).
- **O QR code e o código curto do convidado.** O link é criado no dispositivo. O dispositivo guarda um estoque de códigos curtos reservados para o evento, que ele repõe sempre que está on-line (quando restam menos de 25, pede mais 100), então os códigos são distribuídos off-line. Se um período longo off-line esgotar todos, a página do convidado mostra o código quando a captura chega ao servidor.
- **Os e-mails que você pede para a cabine enviar** esperam na fila e saem quando a conexão volta.
- **Sobreposições, abertura e encerramento, música, fontes e imagens** do evento são salvos no dispositivo enquanto ele está on-line, e usados a partir dali.

## O que precisa de conexão

- **Os downloads dos convidados.** Um convidado que escaneia enquanto a cabine está off-line vê **Seus arquivos estão a caminho** e a página se atualiza sozinha quando o envio chega.
- **O Live Display e a Sharing Station** só recebem capturas novas depois de enviadas. Uma tela continua repetindo o que já tem.
- **As mudanças no Estúdio.** As configurações alteradas lá chegam a uma cabine na próxima vez que ela carregar a página estando on-line.
- **A primeira visita.** Um dispositivo precisa abrir a cabine uma vez on-line para poder guardar o app e os arquivos do evento. O [teste de configuração](help:setup-check) é uma boa forma de fazer isso.

## As etiquetas na barra superior da cabine

| Etiqueta                                                          | Significado                                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Offline**                                                       | O dispositivo está sem conexão. A captura continua funcionando.                                                        |
| **3 envios pendentes**                                            | On-line, e a fila está processando capturas.                                                                           |
| **Offline · 3 envios pendentes**                                  | Capturas esperando uma conexão.                                                                                        |
| **1 envio precisa de atenção**                                    | O servidor recusou uma captura (por exemplo, porque o evento não existe mais). O operador deve dar uma olhada.         |
| **Este dispositivo foi removido: registre-o de novo para enviar** | O dispositivo foi revogado. Veja [Registrar e gerenciar dispositivos de cabine](help:devices-and-registration).        |
| **Pouco armazenamento**                                           | Restam menos de 2 GB livres no dispositivo. Veja [Armazenamento no iOS e limpeza de dados](help:ios-storage-eviction). |

## Como o envio funciona

A fila cuida de um passo de cada vez, começando pela captura mais antiga: registra a captura no servidor, depois envia cada arquivo direto para o armazenamento e pede ao servidor que confira se o arquivo chegou inteiro. Cada passo pode ser repetido com segurança, então uma conexão que cai no meio simplesmente continua.

Quando um passo falha por causa da rede ou porque o servidor está ocupado, a fila espera e tenta de novo: 2 segundos, depois 4, 8 e assim por diante até uma espera máxima de 5 minutos. A fila também acorda quando a conexão volta e sempre que algo novo fica pronto.

A aba **Visão geral** do evento mostra **Arquivos aguardando envio**, **Cabines on-line** e a **Fila de renderização** de todos os dispositivos que rodam o evento.

## Antes de sair do local

1. Confira se a etiqueta da cabine diz que não há nada pendente, e se a **Visão geral** do evento diz **Tudo foi enviado**.
2. Se não disser, mantenha o dispositivo ligado e ao alcance do wi-fi, ou use o roteador do seu celular. Deixe aberta a aba da cabine: a fila trabalha dentro da página.
3. Não limpe os dados do site no navegador nem desinstale o app até terminar. Os arquivos que ainda não foram enviados existem só nesse armazenamento.

> [!WARNING]
> Um dispositivo que é formatado, ou cujos dados do navegador são limpos, leva junto qualquer captura que ainda não foi enviada. Se a única cópia de um evento está no dispositivo, termine os envios primeiro.

## As atualizações nunca interrompem um evento

Uma nova versão do app não assume o controle enquanto a cabine está aberta. Ela é ativada quando todas as abas do app foram fechadas, então uma cabine não pode mudar no meio de um evento.
