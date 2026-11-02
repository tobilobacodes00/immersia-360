---
title: Câmera lenta e quadros por segundo
summary: Escolha o trecho e a velocidade da câmera lenta e consiga resultados suaves com câmeras de 60 fps ou com clipes gravados num iPhone.
category: booth
order: 20
keywords:
  [
    câmera lenta,
    slowmo,
    240 fps,
    120 fps,
    60 fps,
    iphone,
    mais compatível,
    hevc,
    h.264,
    importar,
    interpolação,
    boomerang,
  ]
updated: 2026-10-28
related: [360-booth-setup, render-speed-and-queue, booth-error-messages]
---

## Como funciona

Na **Configuração** do evento, a **Câmera lenta** desacelera uma parte do giro; o resto toca em velocidade normal.

- O **Trecho em câmera lenta** é dado em segundos desde o início do giro, por exemplo de 2 a 6 segundos de um giro de 8. Ele precisa terminar dentro do giro; se não, a página avisa: _O trecho em câmera lenta precisa terminar dentro do giro._
- A **Velocidade da câmera lenta** pode ser 0,125×, 0,25×, 0,5× (padrão), 0,75× ou 1×.
- **Reverso** pode tocar o trecho para frente e para trás (**Bumerangue**) ou acrescentá-lo invertido no final (**Invertido**).

## Resultados suaves

A câmera lenta precisa de quadros para mostrar. Para usar só quadros reais, a câmera precisa entregar os quadros por segundo do vídeo divididos pela velocidade: um vídeo de 30 fps a 0,5× precisa de uma câmera de 60 fps, e um vídeo de 60 fps a 0,25× precisa de 240 fps. Onde a câmera entrega menos, o renderizador cria os quadros intermediários acompanhando como as coisas se movem de um quadro real para o seguinte (interpolação com compensação de movimento). Fica suave com um movimento de giro constante, embora gestos rápidos de mão possam deixar um leve rastro.

Então:

- **Use uma câmera, ou um modo de câmera, de 60 fps** e ajuste os **Quadros por segundo** para 60 fps. Muitas webcams entregam 30 fps sem avisar; o [teste de configuração](help:setup-check) mede o que a sua faz de verdade.
- **Ilumine bem a plataforma.** As câmeras desaceleram em ambientes escuros para captar luz, e uma câmera que cai para 24 fps não consegue dar uma câmera lenta suave.
- **Mantenha curta a parte lenta.** Um trecho de 4 segundos a 0,25× vira 16 segundos de vídeo. Dois ou três segundos de câmera lenta costumam bastar.
- Se uma renderização ficar borrada numa velocidade muito baixa, aumente a velocidade ou encurte o trecho.

## Clipes gravados num celular (120 ou 240 fps)

Você pode importar arquivos de vídeo para uma cabine 360: **Configurações da cabine**, **Importar vídeos**, **Escolher arquivos**, ou arraste arquivos para a tela da cabine. Clipes gravados a 120 ou 240 fps mantêm seus quadros reais, então a câmera lenta deles é a mais suave possível. Cada clipe importado vira uma gravação, ganha um QR code para o convidado e é renderizado em segundo plano.

### iPhone: escolha "Mais compatível"

O iPhone grava por padrão no formato **Alta eficiência**, que guarda o vídeo como HEVC. Alguns navegadores não conseguem ler HEVC, por exemplo o Chrome num computador sem decodificador HEVC por hardware. Um clipe assim falha na renderização com **Este dispositivo não consegue ler o formato do vídeo**.

Antes de gravar:

1. Abra **Ajustes**, depois **Câmera**, depois **Formatos**.
2. Escolha **Mais compatível**. O celular passa a salvar vídeo H.264, que todos os navegadores conseguem ler.
3. Abra **Ajustes**, **Câmera**, **Gravar em câmera lenta** e escolha os quadros por segundo que quiser entre as opções do seu modelo.

Se você já gravou em Alta eficiência, grave de novo em **Mais compatível**, ou importe o clipe num dispositivo cujo navegador leia HEVC, como o Safari num iPad ou num Mac.

> [!NOTE]
> Um dispositivo que não consegue ler um clipe não o perde. A gravação fica na fila de renderização marcada como **Falhou** com o motivo, e você pode importar uma cópia compatível. Veja [Mensagens da cabine e o que fazer](help:booth-error-messages).
