---
title: Armazenamento no iPad e iPhone, e navegadores que apagam dados
summary: Por que o Safari pode apagar os dados salvos de uma cabine, como evitar isso com o app da Tela de Início e quanto espaço livre você precisa.
category: troubleshooting
order: 40
keywords:
  [
    ios,
    ipad,
    iphone,
    safari,
    armazenamento,
    limpeza,
    removido,
    cota,
    persistir,
    tela de início,
    pwa,
    limpar dados,
    espaço,
    pouco armazenamento,
    navegação privada,
  ]
updated: 2026-10-28
related: [offline-mode-and-uploads, setup-check, kiosk-locking, faq-free-up-space]
---

Uma cabine guarda as gravações e as renderizações no armazenamento do navegador até serem enviadas. Os navegadores podem apagar esse armazenamento em algumas situações, e o Safari no iPad e no iPhone é o mais rigoroso. Com um pouco de preparação, o risco desaparece.

## O que pode dar errado

- **O Safari apaga os dados de um site depois de um período sem uso.** O WebKit, o motor por trás de todos os navegadores no iOS, exclui os dados salvos de um site se você não o abrir por cerca de uma semana, a menos que o site esteja instalado na Tela de Início. Uma cabine parada numa gaveta entre eventos pode perder tudo o que não foi enviado.
- **O sistema pode apagar armazenamento quando o dispositivo fica com pouco espaço**, e pode não perguntar.
- **Limpar o histórico** (Ajustes, depois Safari, depois **Limpar Histórico e Dados de Websites**) remove tudo.
- **Uma aba ou janela privada** esquece tudo quando é fechada.

Em outras plataformas, o Chrome e o Edge também podem apagar os dados de um site quando o dispositivo fica com pouco espaço, a menos que o site tenha recebido armazenamento persistente. A cabine pede isso quando inicia; o [teste de configuração](help:setup-check) informa se o navegador concordou.

## A solução: use o app da Tela de Início

1. Abra o endereço da cabine no Safari.
2. Toque em **Compartilhar**, depois em **Adicionar à Tela de Início** e em **Adicionar**.
3. A partir de agora, abra a Immersia 360 pelo ícone dela na Tela de Início.

Um app web instalado tem o próprio armazenamento, que a limpeza de uma semana do Safari não toca, roda sem as barras do Safari e também é melhor para o [modo quiosque](help:kiosk-locking). Registre o dispositivo e faça o teste de configuração pelo app instalado, porque em geral ele tem o próprio armazenamento, separado da aba do Safari: um dispositivo registrado no Safari pode precisar ser registrado de novo no app.

## Espaço livre

A cabine mostra **Pouco armazenamento** quando há menos de 2 GB livres, e o teste de configuração avisa nesse mesmo ponto e falha abaixo de uns 0,5 GB. Uma gravação de 15 segundos em 1080p ocupa dezenas de megabytes; um dia inteiro num evento movimentado, gigabytes.

Para liberar espaço:

- Exclua na **Fila de renderização** as gravações de que você não precisa mais. Excluir remove do dispositivo a gravação e o que foi renderizado a partir dela; os arquivos já enviados não são afetados. Veja primeiro as etiquetas de envio.
- Remova outros apps, fotos e vídeos do dispositivo.
- Confira **Ajustes, Geral, Armazenamento do iPhone (ou do iPad)** para ver o que está ocupando espaço.

## Alguns hábitos que evitam perdas

- Não deixe uma cabine sem uso por mais de poucos dias com capturas ainda pendentes. Deixe os envios terminarem.
- Mantenha o dispositivo carregando durante o evento.
- Não use uma aba privada para uma cabine.
- Se precisar limpar os dados do navegador, espere as etiquetas mostrarem que não há nada pendente. Veja [Modo off-line e a fila de envios](help:offline-mode-and-uploads).
