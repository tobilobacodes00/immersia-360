---
title: Copiar todos os arquivos para o seu Dropbox
summary: Conecte o Dropbox uma vez e cada arquivo finalizado também é salvo numa pasta da Immersia no seu próprio Dropbox, sem acesso a mais nada.
category: cloud
order: 20
keywords: [dropbox, nuvem, backup, copiar, conectar, integrações, pasta, pasta do aplicativo, arquivo]
updated: 2026-10-28
related: [connect-google-drive, cloud-copy-errors, expiry-and-extending]
---

Os convidados sempre baixam pela Immersia. Conectar o Dropbox adiciona uma segunda cópia de cada vídeo, tira e GIF finalizado no seu próprio Dropbox. A cópia é sua e continua com você depois que os arquivos hospedados expiram.

## Conectar

1. Abra **Integrações** no Estúdio. Só o **proprietário** da conta pode conectar ou desconectar uma nuvem.
2. No cartão do **Dropbox**, toque em **Conectar Dropbox**.
3. O Dropbox pede que você entre e que autorize a Immersia 360. Autorize.
4. Você volta para a página de Integrações, que diz **O Dropbox está conectado. A cópia já começou.** e mostra **Conectado como** a sua conta do Dropbox.

Se o cartão disser **Não configurado**, este servidor da Immersia não foi preparado para o Dropbox. Se você hospeda a Immersia por conta própria, veja as notas de configuração no README do projeto.

> [!NOTE]
> A Immersia trabalha só dentro da pasta que cria no seu Dropbox (uma "pasta de aplicativo", que fica em **Aplicativos** no seu Dropbox). Ela nunca vê o resto dos seus arquivos.

## Escolha para onde os arquivos vão

Os arquivos vão para uma pasta chamada **Immersia 360** dentro dessa pasta de aplicativo, criada quando a primeira cópia acontece. Em **Pasta**, digite outro nome e toque em **Usar esta pasta** para mudá-la. Cada evento ganha a própria subpasta, com o nome do evento e a data, como _Gala 360 2026-10-19_. Os arquivos já copiados continuam onde estão.

## Ative para um evento

Cada evento escolhe. Na **Configuração** do evento, em **Compartilhamento**, defina **Copiar também para a minha nuvem** como **Dropbox**. Uma nuvem que não está conectada não pode ser escolhida, e a lista diz por quê.

## Veja funcionando

A página de Integrações lista os últimos 20 arquivos em **Cópias recentes** com um status (**Em espera**, **Copiando**, **Copiado**, **Falhou**) e um link para abrir cada um no Dropbox. As cópias nunca criam duplicatas: antes de enviar, a Immersia confere se já existe um arquivo com esse nome na pasta.

## Desconectar

**Desconectar** interrompe as cópias, revoga o acesso da Immersia e apaga a conexão salva. Os arquivos já copiados continuam no seu Dropbox. As cópias que ainda não tinham acontecido são descartadas; conecte de novo depois para se atualizar.

## Se algo der errado

Cada mensagem tem uma solução em [Problemas ao copiar para a nuvem e o que significam](help:cloud-copy-errors). Se o Dropbox estiver cheio, libere espaço e toque em **Tentar de novo**. Se o Dropbox encerrou a conexão, toque em **Reconectar Dropbox**.
