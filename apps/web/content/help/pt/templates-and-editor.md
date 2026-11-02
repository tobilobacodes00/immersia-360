---
title: Modelos e o editor de design
summary: Comece de um layout de fotos ou de uma sobreposição de vídeo prontos, edite no editor, salve os seus e envie seus próprios logotipos, fontes, músicas e molduras.
category: design
order: 10
keywords:
  [
    modelo,
    editor,
    layout,
    sobreposição,
    design,
    biblioteca,
    casamento,
    aniversário,
    texto,
    fonte,
    logotipo,
    qr,
    tokens,
    campos dinâmicos,
    recursos,
    enviar,
    png,
    moldura,
  ]
updated: 2026-10-28
related: [photo-booth-and-layouts, looks-and-effects, 360-booth-setup, printing-setup]
---

Dois tipos de design compartilham um mesmo editor:

- Um **layout de impressão** é a impressão ou a tira que um convidado da cabine de fotos leva para casa: espaços para fotos, texto, logotipos e o QR code do convidado.
- Uma **sobreposição** é uma moldura transparente desenhada sobre cada vídeo 360: o nome do evento, um logotipo, uma borda.

## Comece pela biblioteca

Abra **Modelos** no Estúdio. Ela traz designs prontos para eventos de **Casamento, Aniversário, Formatura, Chá de bebê, Natal, Halloween, Debutante** e **Corporativo**, em muitos estilos e em todos os tamanhos de impressão e formatos de sobreposição. Filtre por ocasião e tamanho, ou busque pelo nome. **Meu** mostra os modelos que a sua equipe salvou.

Abra um para ver, depois **Usar em um evento…**: escolha o evento e **Usar este design**. Ele substitui o design atual do evento, e você ainda pode editá-lo depois. Se o modelo for de outro tamanho, é usada a versão do mesmo estilo feita para o tamanho do evento quando existe, ou o design é ajustado ao tamanho. Um aviso informa se o layout tem mais espaços para fotos do que o evento tira de fotos. **Salvar nos meus modelos** guarda uma cópia para reutilizar.

Você também chega à biblioteca pelo painel **Modelos** do editor.

## O editor

Num evento, abra **Marca**. Em **Layout de impressão** (fotos) ou **Sobreposição de vídeo** (360), toque em **Abrir o editor**, ou em **Criar um** se o evento ainda não tem nenhum.

Adicione elementos com a barra de ferramentas:

| Ferramenta                              | O que adiciona                                              |
| --------------------------------------- | ----------------------------------------------------------- |
| **Adicionar um espaço de foto**         | Onde vai uma das fotos do convidado (layouts de fotos).     |
| **Adicionar texto**                     | Texto em qualquer fonte, com campos dinâmicos (abaixo).     |
| **Adicionar uma imagem**                | Um logotipo ou uma imagem dos seus Recursos.                |
| **Adicionar um retângulo / uma elipse** | Uma forma com preenchimento e contorno.                     |
| **Adicionar o QR code do convidado**    | O código que abre a página do convidado (layouts de fotos). |
| **Adicionar uma decoração**             | Um enfeite do conjunto incluído.                            |

Clique num elemento para selecioná-lo; arraste para mover e arraste as alças para redimensionar ou girar. O painel **Propriedades** tem a posição, o tamanho, a rotação e a opacidade exatos, e as configurações de cada tipo de elemento. O painel **Camadas** ordena, mostra, oculta e bloqueia os elementos. Selecione vários com Shift+clique ou arrastando sobre a tela, e depois alinhe. Os atalhos, como desfazer e duplicar, estão em [Atalhos de teclado](help:capture-triggers-and-shortcuts).

O editor salva sozinho (**Todas as alterações salvas**). Se o design foi alterado em outra aba ou em outro dispositivo, ele pergunta se você quer **Carregar a versão deles** ou **Manter a minha**.

### Tamanhos

Uma tela de impressão é criada em **300 DPI**, então o que você vê é o que sai impresso: uma 4×6 tem 1200 × 1800 pixels. Um **QR code** numa impressão precisa ter pelo menos **18 mm** de largura para os celulares lerem; o editor avisa com **QR menor que 18 mm**.

Uma sobreposição é transparente para o vídeo aparecer. Deixe o fundo vazio.

### Campos dinâmicos {#fields}

O texto pode conter campos que se preenchem para cada evento ou convidado, escolhidos pelo botão `{ }` da caixa de texto:

| Campo                                  | Dá                                                                                                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `{eventName}`, `{eventDate}`           | O nome e a data do evento.                                                                                    |
| `{hashtag}`, `{custom1}` a `{custom3}` | Texto que você define em **Marca**, **Campos dinâmicos**.                                                     |
| `{shortCode}`, `{sessionUrl}`          | O código curto e o link do convidado.                                                                         |
| `{shotNumber}`, `{shotCount}`          | Qual foto é esta, e quantas há.                                                                               |
| `%d %B %Y`, `%d.%m.%Y`, `%H:%M`        | A data e a hora num formato.                                                                                  |
| `{upper,{eventName}}` e outras         | Funções: maiúsculas, uma alternativa quando vazio, uma condição, os primeiros caracteres, codificar para URL. |

Uma prévia ao vivo embaixo da caixa mostra o resultado.

## Seus próprios arquivos em Recursos {#assets}

**Recursos** guarda arquivos compartilhados por todos os eventos da conta: sobreposições e molduras, aberturas e encerramentos, músicas, fontes, logotipos e fundos. Envie uma vez e use onde quiser. Os limites:

| Tipo                    | Formatos                                        | Limite                                                    |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| Sobreposição            | PNG ou WebP com transparência                   | 25 MB                                                     |
| Moldura                 | PNG, JPEG ou WebP                               | 25 MB                                                     |
| Abertura e encerramento | MP4, MOV, WebM, ou uma imagem (PNG, JPEG, WebP) | 200 MB para vídeo, até 30 segundos; 25 MB para uma imagem |
| Música                  | MP3, M4A/AAC, WAV                               | 50 MB, até 15 minutos                                     |
| Fontes                  | WOFF2, WOFF, TTF, OTF                           | 10 MB                                                     |
| Logotipos               | PNG, JPEG ou WebP (SVG não é aceito)            | 10 MB                                                     |
| Fundos                  | PNG, JPEG, WebP, MP4 ou WebM                    | 25 MB para uma imagem, 200 MB para um vídeo               |

O editor também oferece, para escolher, uma biblioteca de fontes de licença aberta (livres para impressão e vídeo). As fontes que você enviar aparecem em **Enviadas**.

A biblioteca da conta guarda até 5 GB. O tipo real de um arquivo é conferido pelo conteúdo, não pelo nome. Um arquivo que está em uso não pode ser excluído até você trocar por outro recurso os eventos e modelos que o usam. Tudo o que os seus eventos usam é salvo no dispositivo da cabine enquanto ele está on-line, então funciona off-line.
