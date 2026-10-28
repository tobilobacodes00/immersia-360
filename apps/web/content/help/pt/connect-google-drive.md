---
title: Copiar todos os arquivos para o seu Google Drive
summary: Conecte o Google Drive uma vez, escolha uma pasta e cada arquivo finalizado também é salvo no seu próprio Drive, sem que a Immersia veja mais nada.
category: cloud
order: 10
keywords: [google drive, drive, nuvem, backup, copiar, conectar, integrações, pasta, arquivo, oauth]
updated: 2026-10-28
related: [connect-dropbox, cloud-copy-errors, expiry-and-extending, team-roles]
---

Os convidados sempre baixam pela Immersia. Conectar o Google Drive adiciona uma segunda cópia de cada vídeo, tira e GIF finalizado no seu próprio Drive. A cópia é sua e continua com você depois que os arquivos hospedados expiram.

## Conectar

1. Abra **Integrações** no Estúdio. Só o **proprietário** da conta pode conectar ou desconectar uma nuvem.
2. No cartão do **Google Drive**, toque em **Conectar Google Drive**.
3. O Google pede que você entre e que autorize a Immersia 360. **Deixe a caixa de acesso marcada.** Sem ela, a Immersia não consegue salvar arquivos.
4. Você volta para a página de Integrações, que diz **O Google Drive está conectado. A cópia já começou.** e mostra **Conectado como** a sua conta do Google.

Se o cartão disser **Não configurado**, este servidor da Immersia não foi preparado para o Google Drive. Se você hospeda a Immersia por conta própria, veja as notas de configuração no README do projeto.

> [!NOTE]
> A Immersia pede a permissão mais restrita que o Google oferece (`drive.file`). Ela só enxerga e mexe nos arquivos e pastas que ela mesma cria, e nunca pode navegar pelo resto do seu Drive.

## Escolha para onde os arquivos vão

Os arquivos vão para uma pasta chamada **Immersia 360**, criada no seu Drive quando a primeira cópia acontece. Em **Pasta**, digite outro nome e toque em **Usar esta pasta** se preferir. Cada evento ganha a própria subpasta, com o nome do evento e a data, como _Gala 360 2026-10-19_. Os arquivos já copiados continuam onde estão.

Os arquivos são nomeados com o evento e o código do convidado, por exemplo `gala-K7M2QX-mp4.mp4`, então cada arquivo da pasta é único.

## Ative para um evento

Conectar não basta por si só: cada evento escolhe. Na **Configuração** do evento, em **Compartilhamento**, defina **Copiar também para a minha nuvem** como **Google Drive**. Uma nuvem que não está conectada não pode ser escolhida, e a lista diz por quê.

## Veja funcionando

A página de Integrações lista os últimos 20 arquivos em **Cópias recentes** com um status (**Em espera**, **Copiando**, **Copiado**, **Falhou**) e um link para abrir cada um no Drive. A aba **Visão geral** do evento mostra um aviso quando as cópias para a sua nuvem precisam da sua atenção.

As cópias nunca criam duplicatas: antes de enviar, a Immersia confere se já existe um arquivo com esse nome na pasta. Arquivos grandes são copiados em partes, então qualquer tamanho funciona.

## Desconectar

**Desconectar** interrompe as cópias, revoga o acesso da Immersia no Google e apaga a conexão salva. Os arquivos já copiados continuam no seu Drive. As cópias que ainda não tinham acontecido são descartadas; conecte de novo depois para se atualizar.

## Se algo der errado

Cada mensagem desta página tem uma solução em [Problemas ao copiar para a nuvem e o que significam](help:cloud-copy-errors). O mais comum é o Google ter encerrado a conexão (**O Google Drive precisa que você entre novamente**): toque em **Reconectar Google Drive** e as cópias em espera são concluídas sozinhas.
