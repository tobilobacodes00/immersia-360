---
title: Resolver problemas de acesso à câmera
summary: A câmera está bloqueada, em uso, não foi encontrada ou não entrega o que o evento precisa, com passos para Chrome, Edge, Safari, Firefox, iPad e Android.
category: troubleshooting
order: 10
keywords:
  [
    câmera,
    camera bloqueada,
    permissão,
    bloqueada,
    negado,
    permitir,
    não encontrada,
    em uso,
    webcam,
    chrome,
    safari,
    firefox,
    edge,
    android,
    ios,
    https,
    restrições,
    usb,
    zoom,
  ]
updated: 2026-10-28
related: [booth-error-messages, setup-check, 360-booth-setup]
---

O cartão de erro da cabine nomeia o problema. Procure-o abaixo. Depois de mudar qualquer coisa, toque em **Tentar de novo** no cartão (ou recarregue a página).

## O acesso à câmera foi bloqueado {#permission}

O navegador pergunta uma vez se este site pode usar a câmera. Se alguém tocou em **Bloquear**, ou a configuração estava desligada, o navegador lembra.

**Chrome e Edge (computador)**

1. Clique no ícone à esquerda da barra de endereço (um cadeado ou um ícone de controles).
2. Defina **Câmera** como **Permitir**.
3. Recarregue a página.

Ou abra `chrome://settings/content/camera` (`edge://settings/content/camera` no Edge) e remova este site de **Não é permitido usar sua câmera**. Quando o navegador perguntar, escolha **Permitir em todas as visitas** em vez de permitir só desta vez, para a pergunta não voltar.

**Safari num Mac**: escolha **Safari, Ajustes, Sites, Câmera** e defina este site como **Permitir**.

**Safari num iPad ou iPhone**: toque em **aA** na barra de endereço, depois em **Ajustes do Site**, depois em **Câmera**, e escolha **Permitir**. Se você usa o app da Tela de Início, exclua-o e adicione de novo, ou olhe em **Ajustes, Apps, Safari, Câmera** (em versões mais antigas, **Ajustes, Safari, Câmera**).

**Firefox**: clique no ícone da câmera na barra de endereço e remova o bloqueio, ou abra `about:preferences#privacy`, encontre **Permissões, Câmera, Configurações** e remova o bloqueio.

**Chrome no Android**: toque no ícone de cadeado na barra de endereço, depois em **Permissões**, depois em **Câmera**, e permita. Se aparecer em cinza, abra **Configurações, Apps, Chrome, Permissões, Câmera** do celular e permita lá.

**Configurações do sistema no Windows e no macOS.** Mesmo que o navegador permita a câmera, o sistema operacional ainda pode bloqueá-la: no Windows, abra **Configurações, Privacidade e segurança, Câmera** e confira se o acesso à câmera e o acesso dos aplicativos de área de trabalho estão ligados; num Mac, abra **Ajustes do Sistema, Privacidade e Segurança, Câmera** e ative o seu navegador.

## Nenhuma câmera encontrada {#not_found}

O navegador não enxerga nenhuma câmera.

- Conecte a câmera, ou encaixe de novo o cabo dela. Experimente outra porta USB; evite hubs sem alimentação.
- Placas de captura e câmeras que usam um celular como webcam precisam estar funcionando antes.
- Abra as **Configurações da cabine** e escolha a câmera na lista: a certa pode não ser a padrão. A lista termina com **Câmera simulada (sem hardware)**, que serve só para testar a cabine sem câmera.
- Um dispositivo sem câmera, ou um navegador que não tem nenhuma para oferecer, não consegue rodar uma cabine. Use outro dispositivo.

## Outro app está usando a câmera {#in_use}

A maioria das câmeras só pode ser usada por um app de cada vez. Feche os apps de videochamada (Zoom, Teams, Meet), outras abas do navegador que usam a câmera e os apps de câmera ou de fotos. Depois toque em **Tentar de novo**. Se ainda disser isso, desconecte e conecte a câmera de novo ou reinicie o navegador. No Windows, outro app de área de trabalho pode estar segurando a câmera mesmo fechado na bandeja.

## A câmera não entrega o que o evento precisa {#overconstrained}

O evento pede uma resolução e uma taxa de quadros (por exemplo, 4K a 60 fps) que esta câmera não consegue dar. Escolha outra câmera ou outra lente nas **Configurações da cabine**, ou reduza a resolução ou os quadros por segundo em **Configuração**. O [teste de configuração](help:setup-check) mostra o que a sua câmera realmente entrega.

## A câmera precisa de uma conexão segura {#insecure}

Os navegadores só permitem o acesso à câmera em páginas abertas com **https**, ou em `localhost`. Uma cabine aberta a partir de um endereço `http://` simples, ou de um endereço IP, não consegue usar a câmera. Abra-a pelo endereço que o Estúdio fornece.

## A câmera desconectou {#lost}

A câmera parou enquanto a cabine estava rodando: um cabo solto, uma porta USB em repouso, um celular que dormiu. Reconecte-a e toque em **Tentar de novo**. Para um evento longo, use um hub USB com alimentação ou um cabo que trave, e desligue a economia de energia do USB nas configurações do sistema.

## Funciona, mas a imagem parece errada

- **Lente errada**: celulares e tablets listam cada lente como uma câmera separada (grande-angular, ultra grande-angular, teleobjetiva, frontal). Escolha outra nas **Configurações da cabine**.
- **Espelhada**: a chave **Espelhar a prévia** só muda a tela, nunca a gravação.
- **Escura ou travando**: acrescente luz. Muitas câmeras reduzem a taxa de quadros em ambientes escuros.
