---
title: Contato e status
summary: Como falar com a gente, em quanto tempo respondemos (em até 2 dias úteis), o que incluir e a página pública de status.
category: account
order: 20
keywords:
  [
    suporte,
    contato,
    e-mail,
    ajuda,
    status,
    queda,
    incidente,
    fora do ar,
    tempo de resposta,
    dias úteis,
    relatar um problema,
  ]
updated: 2026-10-28
related: [setup-check, booth-error-messages, guest-privacy]
---

## Fale com a gente

Use o formulário **Fale com a gente** no fim da [central de ajuda](/help), ou escreva para o endereço de suporte que aparece no formulário e na [página de status](/status). Os dois vão para a mesma caixa de entrada, e responder à nossa resposta chega à pessoa que a escreveu.

**Respondemos em até 2 dias úteis** (de segunda a sexta), muitas vezes antes. Se for urgente porque há um evento em andamento, diga isso no começo da mensagem; a resposta é mais rápida quando vem com os dados abaixo.

A central de ajuda está aberta a todos, com ou sem login, então você consegue falar com a gente mesmo sem conseguir entrar no Estúdio. Por favor, não envie senhas nem dados completos de pagamento. Nunca precisamos deles.

## O que incluir

Um bom relato é feito principalmente de fatos:

- **O que você estava fazendo** e **o que esperava**.
- **O que aconteceu em vez disso**, com as palavras exatas de qualquer mensagem. As mensagens da cabine estão em [Mensagens da cabine e o que fazer com elas](help:booth-error-messages).
- **O dispositivo e o navegador**: por exemplo "iPad (9ª geração), Safari 18" ou "notebook com Windows, Chrome".
- **O nome do evento** e mais ou menos **quando** aconteceu.
- O resultado do [teste de configuração](help:setup-check), se você o fez nesse dispositivo.

O formulário acrescenta a página de onde você o enviou e, se você estiver conectado, a sua conta, para que possamos investigar.

## Pedidos de privacidade

Pedidos sobre os dados dos convidados, os seus próprios dados ou o aviso de privacidade deste produto vão para o mesmo endereço. Os convidados podem excluir os próprios arquivos na página deles, e os operadores têm ferramentas para o resto. Veja [Privacidade dos convidados](help:guest-privacy).

## A página de status

A [página de status](/status) mostra verificações ao vivo do que o Immersia 360 usa:

| Serviço                       | O que faz                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Banco de dados**            | Contas, eventos, dispositivos e links dos convidados.                                                                       |
| **Armazenamento de arquivos** | Fotos e vídeos dos convidados e os downloads deles.                                                                         |
| **Servidor do Live Display**  | Envia as capturas novas para as telas em menos de um segundo. Opcional: sem ele, as telas consultam a cada poucos segundos. |
| **E-mail**                    | Links de login, e-mails para convidados e respostas do suporte.                                                             |

Cada um mostra **Operando**, **Degradado** (mais lento que o normal), **Fora do ar** ou **Não configurado** se esta instalação não o usa. A manchete da página diz **Todos os sistemas operando normalmente**, **Alguns sistemas estão mais lentos que o normal** ou **Um sistema está fora do ar**. As verificações vêm direto dos nossos próprios servidores, não de um serviço de status de terceiros, e os resultados ficam guardados por cerca de 20 segundos para que a página não possa ser usada para sobrecarregá-los.

Abaixo das verificações, **Incidentes recentes** lista tudo o que deu errado ou foi manutenção programada nos últimos 90 dias, com quando começou e terminou, o que afetou e o que aconteceu. É escrito à mão quando algo acontece.

Monitores de disponibilidade podem ler as mesmas verificações como JSON em `/api/status`; ele responde com um status de falha quando um serviço essencial está fora do ar.

Se a página de status diz que está tudo bem e mesmo assim você tem um problema, provavelmente é o dispositivo ou a rede do local. Faça o [teste de configuração](help:setup-check) ou fale com a gente.
