---
title: Registrar e gerenciar dispositivos de cabine
summary: Por que uma cabine roda num dispositivo registrado, como nomear, conferir e revogar dispositivos, e o que acontece quando você revoga um.
category: start
order: 30
keywords: [dispositivo, registrar, revogar, token, ipad, notebook, tablet, renomear, on-line, visto por último]
updated: 2026-10-28
related: [setup-check, offline-mode-and-uploads, team-roles]
---

Uma cabine só grava num **dispositivo registrado**, então cada gravação e cada envio pertencem à sua conta e você pode cortar um dispositivo a qualquer momento. Não há limite de dispositivos que você pode registrar, nem custo por eles.

## Registrar um dispositivo

Você pode registrar pela própria cabine ou pelo Estúdio:

- **Pela cabine.** Na primeira vez que um dispositivo abre uma cabine, ele mostra **Registrar este dispositivo**. Digite um nome que você reconheça no local, como _iPad da cabine A_, e toque em **Registrar e continuar**.
- **Pelo Estúdio.** Abra **Dispositivos e equipe**. No próprio dispositivo, toque em **Registrar dispositivo**, ao lado de **Usar este navegador como cabine**.

Ao registrar, o navegador recebe um token longo e aleatório, guardado nesse navegador. O servidor guarda só uma impressão digital dele. A cabine apresenta o token toda vez que envia um arquivo, pede códigos curtos ou informa seu estado, então uma cabine continua enviando durante todo o evento mesmo que a sessão do operador acabe.

> [!NOTE]
> O token fica nos dados do site no navegador. Se você limpar esses dados, ou usar uma janela anônima, o dispositivo esquece que está registrado e pergunta de novo. Registre-o outra vez e renomeie ou revogue a entrada antiga.

## O que a lista mostra

De cada dispositivo você vê o nome, a plataforma e o navegador, quando foi visto por último e o caminho de renderização:

| Etiqueta                              | Significado                                                                                                                                                            |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| renderiza no dispositivo              | O dispositivo consegue renderizar os vídeos sozinho na velocidade da meta.                                                                                             |
| renderiza no dispositivo (mais lento) | Consegue, mas mais devagar que a meta, ou sem codificação de vídeo por hardware. Use um dispositivo mais rápido em eventos movimentados.                               |
| renderiza na nuvem                    | O navegador não tem o que a renderização precisa (gráficos acelerados ou codificação de vídeo), ou o teste de configuração não conseguiu renderizar um clipe de teste. |

Um dispositivo aparece como **On-line** quando foi visto nos últimos dois minutos. Uma cabine aberta informa a cada 30 segundos, junto com quantas gravações esperam para renderizar e quantos arquivos esperam para enviar.

O caminho de renderização começa como um palpite rápido feito no registro, e é substituído por um medido quando você faz o [teste de configuração](help:setup-check). É só uma dica: hoje cada cabine renderiza no dispositivo em que roda.

## Renomear e revogar

- **Renomear** muda o nome na lista, não o dispositivo.
- **Revogar** corta um dispositivo na hora. Na próxima vez que ele falar com o servidor, será recusado, e a cabine mostra **Este dispositivo foi removido: registre-o de novo para enviar**. Os arquivos já enviados ficam. O que ainda espera no dispositivo fica lá; registre o dispositivo de novo para enviar.

Proprietários e operadores podem registrar e renomear dispositivos; leitores podem ver a lista. Só proprietários podem revogar. Veja [Membros da equipe e funções](help:team-roles).

## Bons hábitos

- Nomeie os dispositivos por onde trabalham, não pelo que são: _iPad da cabine A_, _Notebook da entrada_.
- Revogue um dispositivo que for perdido, vendido ou emprestado.
- Registre cada navegador que usar como cabine. Chrome e Safari no mesmo notebook são dois dispositivos.
