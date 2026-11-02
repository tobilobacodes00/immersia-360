---
title: 'Imprimir sem caixa de diálogo: impressão de quiosque do Chrome'
summary: Inicie o Chrome com --kiosk-printing no Windows, macOS ou Linux para que as tiras vão direto para a impressora padrão, e o que preparar antes.
category: photo
order: 30
keywords:
  [
    kiosk-printing,
    impressão silenciosa,
    impressão automática,
    sem caixa de diálogo,
    opção do chrome,
    impressora padrão,
    atalho,
    linha de comando,
    windows,
    mac,
    linux,
  ]
updated: 2026-10-28
related: [printing-setup, kiosk-locking, setup-check]
---

Normalmente uma página web não consegue imprimir sem perguntar. O navegador mostra a caixa de impressão e alguém precisa tocar em **Imprimir**. Para **Imprimir automaticamente** num evento, isso não serve. O Chrome (e navegadores baseados em Chromium, como o Edge) tem uma opção de inicialização, `--kiosk-printing`, que pula a caixa de diálogo e manda o trabalho direto para a **impressora padrão**.

> [!NOTE]
> Isso só funciona no Chrome ou em outro navegador Chromium num computador com Windows, macOS ou Linux. Safari, Firefox, iPads, iPhones e dispositivos Android sempre mostram a caixa de impressão.

## Antes de começar

1. **Defina a impressora padrão** no seu sistema operacional como a impressora do evento. Os trabalhos silenciosos vão só para ela.
2. **Faça primeiro uma impressão normal.** Com o Chrome aberto na cabine, imprima um teste (o teste de impressora do [teste de configuração](help:setup-check) é ideal) e, na caixa de diálogo, escolha o **tamanho do papel** certo, **margens: Nenhuma** e **escala: 100%**. No modo de impressão de quiosque o Chrome continua usando as opções da última impressão, então elas precisam estar certas uma vez. Veja [Imprimir no tamanho certo](help:printing-setup).
3. **Feche o Chrome por completo.** A opção só vale quando o Chrome inicia do zero. Se o Chrome já estiver rodando, mesmo em segundo plano, uma janela nova abre no processo antigo e a opção é ignorada. No Windows, confira a bandeja do sistema; num Mac, use **Chrome > Sair do Google Chrome**.

## Windows

1. Clique com o botão direito na área de trabalho e escolha **Novo > Atalho**.
2. Em local, digite o caminho do Chrome com a opção depois dele:

   ```text
   "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing
   ```

3. Dê o nome _Cabine_ e abra a cabine sempre por este atalho.

Para o Microsoft Edge, use `"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --kiosk-printing`. Se o seu Chrome estiver em outro lugar, clique com o botão direito no atalho normal dele, escolha **Propriedades** e copie o **Destino**.

## macOS

No Terminal:

```text
open -na "Google Chrome" --args --kiosk-printing
```

`--args` entrega ao Chrome tudo o que vem depois. Para um iniciador em que você possa dar duplo clique, abra o **Editor de Script**, digite `do shell script "open -na 'Google Chrome' --args --kiosk-printing"` e escolha **Arquivo > Exportar** com o formato **Aplicativo**.

## Linux

```text
google-chrome --kiosk-printing
```

O nome do programa varia (`google-chrome-stable`, `chromium`). Acrescente-o a um iniciador ou a uma entrada de inicialização automática se quiser que a cabine suba sozinha.

## Combine com o modo quiosque

Para uma cabine sem supervisão, inicie o Chrome com as duas opções para que a página fique em tela cheia e imprima em silêncio:

```text
chrome.exe --kiosk --kiosk-printing "https://your-address/booth/EVENT-ID"
```

Veja [Travar a cabine para os convidados](help:kiosk-locking) para saber até onde vai esse bloqueio.

## Confira se funciona

Abra a cabine pelo novo atalho, mantenha uma tira e deixe imprimir. O trabalho deve chegar à impressora sem caixa de diálogo. Se a caixa ainda aparecer, o Chrome já estava rodando: feche-o por completo e comece de novo pelo atalho.

> [!TIP]
> A impressão automática e o botão **Imprimir** usam esse mesmo caminho, e um trabalho que falha não impede o convidado de receber o QR code. Se um papel enroscado interromper as impressões, resolva e toque em **Imprimir** de novo na tela de resultado do convidado.
