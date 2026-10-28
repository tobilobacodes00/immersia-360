---
title: Travar a cabine para os convidados (modo quiosque)
summary: Defina um PIN de saída e acrescente o Acesso Guiado do iOS, a fixação de tela do Android ou o modo quiosque do Chrome quando os convidados não devem sair da cabine. Um navegador não consegue travar um dispositivo por completo.
category: booth
order: 50
keywords:
  [
    quiosque,
    bloqueio,
    pin,
    acesso guiado,
    fixar tela,
    fixação de apps,
    tela cheia,
    sem supervisão,
    ipad,
    tablet,
    sair,
    operador,
    toque triplo,
  ]
updated: 2026-10-28
related: [chrome-kiosk-printing, 360-booth-setup, sharing-station]
---

> [!WARNING]
> Uma página web não consegue travar um dispositivo por completo. O bloqueio de quiosque da Immersia mantém mãos curiosas longe da tela da cabine, mas um convidado decidido ainda pode sair da tela cheia, fechar a aba ou trocar de app. Para um evento que ninguém vigia, combine-o com o bloqueio do próprio dispositivo: Acesso Guiado, fixação de tela ou o modo quiosque do Chrome, descritos abaixo.

## O bloqueio de quiosque embutido na cabine

Na **Configuração** do evento, em **Quiosque**, toque em **Salvar PIN** e escolha de 4 a 8 dígitos. Com um PIN definido:

- Ao tocar em **Iniciar cabine**, a cabine entra em tela cheia, onde o navegador permite (os navegadores do iPhone em geral não).
- Os controles do operador somem: o link de volta, a fila de renderização, a galeria e as configurações. Os convidados veem o nome do evento e a cabine.
- Sair da tela cheia (por exemplo com Escape) mostra uma tela **Toque para voltar à cabine**.
- O navegador pede confirmação antes de a aba ser fechada ou recarregada (a maioria só faz isso depois que a página foi tocada).

O PIN é conferido na própria cabine, então funciona sem internet. O dispositivo recebe apenas uma impressão digital do PIN, nunca o PIN em si.

### Sair como operador

1. **Toque três vezes no canto superior esquerdo da tela** em um segundo e meio. O canto não tem botão visível, mas é um alvo generoso.
2. Digite o PIN e toque em **Desbloquear**.
3. Cinco PINs errados pausam o teclado por 30 segundos.

Remova ou troque o PIN em **Configuração** para desligar o bloqueio no próximo evento: **Remover PIN**.

A Sharing Station usa o mesmo bloqueio. Veja [A Sharing Station](help:sharing-station).

## iPad e iPhone: Acesso Guiado

O Acesso Guiado mantém o dispositivo em um único app e pode desligar os botões físicos e partes da tela.

1. Abra **Ajustes**, depois **Acessibilidade**, depois **Acesso Guiado**, e ative.
2. Defina um código.
3. Abra a cabine no Safari ou, melhor, pelo ícone da Tela de Início (Compartilhar, depois **Adicionar à Tela de Início**), que roda sem as barras do Safari.
4. Clique três vezes no botão lateral (ou no botão de início, nos modelos que têm) e escolha **Acesso Guiado**. Em **Opções** você pode desligar os botões, o teclado e o toque.
5. Toque em **Iniciar**.

Para encerrar, clique três vezes de novo e digite o código.

## Android: fixação de tela

1. Abra **Configurações**, procure **Fixação de apps** (nos celulares Samsung chama-se **Fixar janelas**) e ative. Ative a opção de pedir o PIN antes de desafixar, para que os convidados não consigam desfazer.
2. Abra a cabine no Chrome.
3. Abra a tela de apps recentes, toque no ícone do app no alto do cartão e escolha **Fixar**.

Para desafixar, mantenha pressionados ao mesmo tempo os botões Voltar e Recentes, ou deslize para cima e segure, conforme o seu estilo de navegação, e digite o PIN.

## Windows, macOS e Linux: modo quiosque do Chrome

Iniciar o Chrome com `--kiosk` abre uma página em tela cheia, sem barra de endereço nem abas:

```text
chrome.exe --kiosk "https://your-address/booth/EVENT-ID"
```

Isso esconde os controles mas não bloqueia o teclado: Alt+F4 no Windows ou Command+Q num Mac ainda fecham. Esconda o teclado, ou dê à cabine sua própria conta de usuário limitada. O Windows tem um modo de acesso atribuído (quiosque) para isso, e uma política de dispositivo gerenciado dá um bloqueio de verdade em qualquer plataforma.

Você também pode acrescentar `--kiosk-printing` para imprimir em silêncio, veja [Imprimir sem caixa de diálogo](help:chrome-kiosk-printing).

## Impeça também que a tela apague

A cabine pede que a tela fique ligada enquanto estiver aberta, mas o navegador pode recusar (a economia de bateria, por exemplo). Mantenha o dispositivo na tomada e coloque o bloqueio automático em **Nunca** nas configurações do próprio dispositivo.
