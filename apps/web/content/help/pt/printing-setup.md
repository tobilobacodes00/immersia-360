---
title: Imprimir no tamanho certo
summary: Os tamanhos de impressão, como a cabine imprime, as configurações da caixa de impressão que importam, duas tiras em uma folha 4×6 e como conferir o resultado com uma régua.
category: photo
order: 20
keywords:
  [
    imprimir,
    impressora,
    tamanho,
    4x6,
    2x6,
    5x7,
    dpi,
    escala,
    margens,
    sublimação,
    duas tiras,
    tira dupla,
    airprint,
    cópias,
    calibração,
  ]
updated: 2026-10-28
related: [chrome-kiosk-printing, photo-booth-and-layouts, setup-check]
---

## Como a impressão funciona

A cabine faz a impressão como uma imagem a **300 DPI** no tamanho exato do papel (uma impressão 4×6 tem 1200 × 1800 pixels) e a entrega à função de impressão do navegador numa página do mesmo tamanho e sem margens. A partir daí, quem cuida é o sistema de impressão do seu computador ou tablet. A Immersia não conversa diretamente com impressoras, então serve qualquer impressora para a qual o seu dispositivo consiga imprimir: impressoras de escritório, de fotos, de sublimação para eventos e AirPrint.

Tamanhos: tira **2×6**, **4×4**, **4×6** retrato, **6×4** paisagem e **5×7** polegadas. O tamanho story 9:16 é para telas e não tem tamanho de papel.

## Ligar a impressão

Na **Configuração** do evento, seção **Cabine de fotos**:

- **Impressão** ligada.
- **Imprimir automaticamente** manda cada tira mantida para a impressora sem o convidado tocar em nada. Precisa de impressão silenciosa: veja [Imprimir sem caixa de diálogo](help:chrome-kiosk-printing). Sem ela, a caixa de impressão abre a cada tira.
- **Cópias por sessão**, de 1 a 10, é quantas cópias cada trabalho de impressão faz.
- Na tela de resultado os convidados têm um botão **Imprimir**. Ele é limitado a duas impressões por sessão, para não esgotar uma impressora; uma impressão automática conta como uma. Quando chegam ao limite, o botão avisa.
- **Duas tiras em uma folha 4×6** (só no tamanho 2×6) é descrito mais abaixo.

## A caixa de impressão

Seja qual for a impressora, três configurações decidem se a impressão sai do tamanho certo:

1. **Tamanho do papel**: o tamanho real do papel que está na impressora (4×6 polegadas, 5×7 polegadas).
2. **Escala**: **100%**, e não "Ajustar à página" nem "Reduzir para caber". Ajustar muda o tamanho.
3. **Margens**: **Nenhuma** (ou impressão sem bordas, se a impressora oferecer). Deixe cabeçalhos e rodapés desligados.

A cabine pede uma página do tamanho certo e sem margem, e o Chrome e o Edge costumam respeitar isso, mas os drivers de impressora muitas vezes acrescentam margens ou escala próprias. Confira o resultado como descrito abaixo.

Num **iPad, iPhone ou dispositivo Android** a caixa de impressão do sistema sempre aparece; esses sistemas não conseguem imprimir em silêncio a partir de uma página web. Um computador com Chrome consegue, veja o próximo artigo.

## Duas tiras em uma folha 4×6

A maioria das impressoras de sublimação para eventos usa papel 4×6. Uma tira 2×6 cabe duas vezes nele. Escolha o tamanho de layout **2×6**, ligue a impressão e ligue **Duas tiras em uma folha 4×6**: a cabine imprime a mesma tira duas vezes, lado a lado, numa página 4×6. Coloque papel 4×6. Corte a folha ao meio, à mão ou, se a sua impressora tiver a opção, com o cortador embutido (procure no driver da impressora uma configuração de corte de 2 polegadas ou 2×6).

A opção não aparece nos outros tamanhos.

## Confira a impressão com uma régua

O [teste de configuração](help:setup-check) inclui um teste de impressora para as cabines de fotos. Ele imprime uma folha de calibração no tamanho de impressão do seu evento, com:

- uma **régua de 50 mm** na folha, que deve medir 50 mm com tolerância de 1 mm;
- **marcas de canto** cuja distância está impressa na folha;
- um **círculo de 20 mm** que deve parecer redondo;
- quatro molduras finas a **1, 2, 3 e 4 mm** de cada borda: cada moldura que falta significa cerca de 1 mm cortado.

Ficar a menos de 1 mm e sem cortes significa que as impressões dos convidados sairão no tamanho que você escolheu. Nos seus designs, mantenha rostos e texto a pelo menos 4 mm da borda, porque impressoras que cortam precisam dessa margem.

## Se a impressão sair errada

| O que você vê               | O que tentar                                                                                                            |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Régua curta ou longa demais | Coloque a escala em 100% e desligue "Ajustar à página". Confira a escala do próprio driver.                             |
| Bordas cortadas             | Margens em nenhuma, ou impressão sem bordas; o tamanho de papel certo.                                                  |
| Borda branca em volta       | Impressão sem bordas, ou margens em nenhuma; o tamanho de papel certo.                                                  |
| Imprime no papel errado     | Escolha o tamanho de papel certo, e a bandeja certa, no driver.                                                         |
| Nada imprime                | Confira se a impressora está ligada, com papel e definida como padrão; tente imprimir uma página de teste pelo sistema. |
