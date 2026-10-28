---
title: Problemas ao copiar para a nuvem e o que significam
summary: Cada mensagem da página de Integrações e da página do evento quando a conexão ou a cópia para o Google Drive ou o Dropbox falha, com o que fazer.
category: cloud
order: 30
keywords:
  [
    erro,
    reconectar,
    entrar novamente,
    cota,
    cheio,
    armazenamento cheio,
    pasta,
    apagada,
    negado,
    permissão,
    atualizar,
    tentar de novo,
    falhou,
    dropbox,
    google drive,
    integrações,
    conexão,
  ]
updated: 2026-10-28
related: [connect-google-drive, connect-dropbox, expiry-and-extending, team-roles]
---

Quando algo impede que os arquivos cheguem ao seu Google Drive ou ao seu Dropbox, o app diz o que falhou e o que fazer. Procure a sua mensagem abaixo. **Os convidados nunca são afetados**: os arquivos deles continuam na Immersia, e as cópias que não puderam ser feitas esperam e são concluídas, sem duplicatas, assim que o problema é resolvido.

## Problemas ao conectar

Aparecem numa caixa vermelha da página de Integrações depois que você toca em **Conectar**.

### Você cancelou a conexão {#denied}

**"Você cancelou a conexão, então nada mudou."** Você tocou em Cancelar na tela do Google ou do Dropbox. Toque em **Conectar** para tentar de novo.

### O link de login expirou {#state}

**"Esse link de login expirou ou não foi gerado por esta conta."** A conexão precisa ser concluída em 10 minutos, pela mesma pessoa e na mesma conta. Ou a página do Google ou do Dropbox ficou aberta por tempo demais, ou foi aberta a partir de outra conta. Toque em **Conectar** e conclua sem pausas.

### A permissão não foi concedida {#scope}

**"O … não concedeu a permissão de que a Immersia precisa."** Na tela do Google há uma caixa que permite à Immersia ver e criar arquivos. Se ela estava desmarcada, a Immersia não consegue salvar arquivos. Toque em **Conectar** de novo e deixe a caixa marcada.

### Não foi dado um acesso duradouro {#no_refresh}

**"O … não deu à Immersia um acesso duradouro. Remova a Immersia dos aplicativos conectados do seu … e conecte de novo."** O provedor lembra de uma conexão anterior e não emite uma nova chave de longa duração. Remova a Immersia 360 da lista de apps com acesso à sua conta (nas configurações de segurança da sua Conta do Google, em apps e serviços de terceiros, ou no Dropbox, em **Configurações** e **Aplicativos conectados**) e toque em **Conectar** de novo.

### O provedor recusou o login {#exchange}

**"O … recusou o login."** Toque em **Conectar** para tentar mais uma vez. Se continuar acontecendo, tente numa janela privada ou sem extensões do navegador que bloqueiem páginas de login.

### Não foi possível falar com o provedor {#unreachable}

**"Não foi possível falar com o …"** O provedor não respondeu. Verifique a conexão e tente de novo em um minuto.

### Este servidor não está configurado para isso {#unavailable}

**"Este servidor não está configurado para o …"** (também aparece como **Não configurado** no cartão). O servidor da Immersia que você usa não tem credenciais para esse provedor. Se você hospeda a Immersia por conta própria, adicione as credenciais dele e a `INTEGRATION_TOKEN_KEY` ao ambiente, como descrito no README; o serviço hospedado já cuida disso para você.

### Só o proprietário pode fazer isso {#forbidden}

**"Só o proprietário da conta pode conectar uma nuvem."** Peça ao proprietário da conta que conecte ou desconecte, ou que altere a sua função. Veja [Funções da equipe](help:team-roles).

### Deu errado outra coisa {#failed}

**"Algo deu errado ao conectar o …"** Tente de novo. Se persistir, fale com o suporte informando o horário em que aconteceu. Veja [Contato e status](help:contact-and-status).

## Problemas ao copiar arquivos

Aparecem num arquivo de **Cópias recentes**, no cartão do provedor e num aviso âmbar na aba **Visão geral** do evento.

### Você precisa entrar novamente {#reauth_required}

**"O acesso ao … foi revogado ou expirou."** O provedor encerrou a conexão: você removeu a Immersia dos seus aplicativos conectados, trocou a senha ou o acesso expirou por tempo. Nada se perde; os arquivos novos ficam na Immersia e esperam. Toque em **Reconectar** no cartão e todos os arquivos em espera são copiados sozinhos.

Se você administra por conta própria um projeto do Google e a tela de consentimento dele ainda está em modo de **teste**, o Google encerra a conexão depois de 7 dias. Publique a tela de consentimento para evitar isso.

### A sua nuvem está cheia {#quota_exceeded}

**"Seu … está cheio. Libere espaço e toque em Tentar de novo."** Libere espaço no seu Drive ou Dropbox e toque em **Tentar de novo** no cartão.

### O provedor não respondeu {#transient}

**"Não foi possível falar com o … após várias tentativas. Toque em Tentar de novo."** A Immersia tentou várias vezes (a pausa começa em 30 segundos e dobra a cada vez) e desistiu na oitava tentativa. Confira se o provedor está funcionando e toque em **Tentar de novo**. Enquanto ainda está tentando, a lista diz **não respondeu. Vamos tentar de novo …** e não é preciso fazer nada.

### A pasta foi apagada {#folder_missing}

**"A pasta foi apagada do …"** Você (ou alguém) removeu a pasta da Immersia da sua nuvem. Escolha uma pasta no cartão ("Pasta" e depois **Usar esta pasta**); as cópias com falha recomeçam sozinhas.

### A Immersia não consegue gravar nessa pasta {#folder_inaccessible}

**"A Immersia não consegue gravar nessa pasta."** A pasta foi movida, ou o acesso a ela mudou. Crie uma pasta nova no cartão da mesma forma; as cópias com falha recomeçam sozinhas.

### O arquivo expirou antes de ser copiado {#source_gone}

**"Este arquivo expirou na Immersia antes de ser copiado, então não pode mais ser enviado."** Os arquivos dos convidados chegaram ao fim do período de retenção antes que a cópia pudesse ser feita, geralmente porque a conexão ficou quebrada por muito tempo. Esse arquivo não pode ser recuperado. Para evitar isso, resolva rápido os problemas de conexão e veja [Expiração e extensão](help:expiry-and-extending): estender os links do evento dá tempo para as cópias se atualizarem.

### Não foi possível copiar este arquivo {#other}

**"Não foi possível copiar este arquivo. Toque em Tentar de novo; se continuar falhando, reconecte o …"** Um erro incomum. Toque em **Tentar de novo**. Se falhar outra vez, toque em **Desconectar** e depois em **Conectar** de novo, e fale com o suporte se isso não ajudar.

## Problemas de cópia na página do evento

Um aviso âmbar na aba **Visão geral** do evento diz **As cópias para o … precisam da sua atenção**, com o mesmo motivo, e **Abrir Integrações** leva você ao cartão para resolver. Se o evento está configurado para copiar para uma nuvem que não está conectada, ele diz isso: conecte-a e os arquivos do evento se atualizam.
