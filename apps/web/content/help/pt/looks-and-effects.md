---
title: Estilos, efeitos e troca de fundo
summary: Dê a cada captura um estilo de cor, acrescente efeitos sincronizados com a batida aos vídeos 360, um efeito de foto às tiras e troque o fundo atrás dos seus convidados.
category: design
order: 20
keywords:
  [
    estilo,
    filtro,
    efeitos,
    cor,
    sincronizar com a batida,
    música,
    confete,
    brilhos,
    estroboscópio,
    glitch,
    efeito de foto,
    fundo,
    tela verde,
    desfoque,
    trocar o fundo,
    segmentação,
    recorte,
  ]
updated: 2026-10-28
related: [templates-and-editor, render-speed-and-queue, booth-error-messages, 360-booth-setup]
---

Abra a aba **Marca** do evento. Os cartões **Estilo e efeitos** e **Fundo** são onde você ajusta tudo isso.

## Estilos

Um **estilo** é uma gradação de cor aplicada a todas as capturas do evento: são 24, de **Monocromático**, **Noir** e **Sépia** a **Cinematográfico**, **Hora dourada**, **Ouro rosé**, **Neon noturno**, **Duotone meia-noite** e **Preto e dourado**. **Original** deixa as cores como estão.

O seletor mostra cada estilo numa cena de amostra. Escolha um **Estilo dos vídeos 360** e um **Estilo das fotos**. O estilo é aplicado na prévia ao vivo, ao criar cada captura e no vídeo ou na tira finais, com a mesma matemática em todo lugar, então o que o convidado vê na cabine é o que ele recebe.

## Efeitos de vídeo (cabine 360)

Os efeitos tocam sobre as imagens dos convidados: **Anéis de luz, Confete, Brilhos, Corações, Bolhas, Neve, Fumaça, Aura, Disco, Reflexo prismático, Vazamento de luz, Filme queimado, Estroboscópio, Glitch, Deslocamento RGB, Fita VHS, Rastro de eco** e **Clones**. Escolha até **oito**, em ordem. Cada um tem um controle de **intensidade**, e alguns permitem escolher uma **cor** (**Colorido, Branco, Prata, Dourado**). Eles não tocam sobre a abertura, o encerramento nem a sua sobreposição.

### Sincronizar com a batida

Com música adicionada ao evento, **Sincronizar com a batida** faz os efeitos pulsarem com a batida da música e a câmera lenta começar e terminar numa batida. Se a música não tem uma batida firme (ambiente ou falada), os efeitos mantêm o próprio tempo, e uma música rápida pode conduzir um efeito em meio tempo. A opção precisa de música no evento: adicione em **Música**, na mesma página.

> [!WARNING]
> O estroboscópio e outros efeitos intermitentes podem afetar pessoas sensíveis a luz piscante. Os efeitos incluídos ficam dentro do limite geral para flashes, mas se os seus convidados puderem ser sensíveis, deixe o **Estroboscópio** de fora.

## Efeito de foto (cabine de fotos)

Escolha um **Efeito de foto** para o evento: **Espelho, Esfera, Comprimir, Torcer, Ondulação, Vidro, Prisma, Caleidoscópio, Op art, Meio-tom, Térmico, Pop art, Pixelado, Esboço, Posterizar, Duotone pop, Quadrinhos, Bordas neon** ou **Glitch**. Ele é aplicado, junto com o estilo das fotos, a cada foto antes de montar a tira. Bumerangues e vídeos curtos recebem o mesmo.

## Troca de fundo

Em **Fundo**, troque o que fica atrás dos seus convidados, sem tela verde:

| Opção         | O que os convidados recebem                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Sem fundo** | O fundo real.                                                                                                                                                      |
| **Desfoque**  | O fundo real, desfocado.                                                                                                                                           |
| **Cor**       | Uma cor lisa.                                                                                                                                                      |
| **Imagem**    | Uma imagem dos seus Recursos. Numa cabine 360 pode ser um **vídeo** que toca atrás do convidado e recomeça se for mais curto que o giro. As fotos usam só imagens. |

A cabine encontra a pessoa em cada quadro no dispositivo: nenhuma imagem sai dele. Na primeira vez que o recurso é usado, o dispositivo carrega um modelo pequeno e o ambiente de execução dele do mesmo servidor do app e os guarda, então uma cabine que o usou uma vez on-line continua funcionando off-line.

- **Prévia**: o cartão mostra a prévia com uma silhueta desenhada. Na cabine, o recorte acompanha cada convidado.
- **Custo**: encontrar a pessoa em cada quadro dá trabalho de verdade. Isso deixa a renderização mais lenta, então faça o [teste de configuração](help:setup-check) com as suas configurações; o teste de renderização inclui o fundo.
- **Indisponível**: se um dispositivo não consegue iniciá-lo (sem WebGL 2, ou porque o modelo não pôde ser carregado por nunca ter ficado on-line), os convidados recebem o fundo real e a cabine diz **A troca de fundo não está disponível neste dispositivo**. Veja [Mensagens da cabine](help:booth-error-messages).
- Ilumine bem os convidados e posicione-os diante de uma parede lisa e contrastante: o recorte fica mais limpo quando a pessoa se destaca.

## O que precisa de WebGL 2

Os estilos, os efeitos e as miniaturas usam o hardware gráfico (WebGL 2). Um navegador sem ele não consegue mostrá-los na prévia e diz **A prévia precisa de WebGL2**; suas escolhas continuam sendo salvas e usadas nos dispositivos que têm. Se o shader de um estilo ou de um efeito não puder rodar num dispositivo, esse dispositivo renderiza sem ele em vez de fazer a gravação falhar.
