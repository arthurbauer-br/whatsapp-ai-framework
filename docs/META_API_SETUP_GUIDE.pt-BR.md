# Meta WhatsApp Business API — Guia de configuração

*[Read in English](./META_API_SETUP_GUIDE.md)*

Este guia mostra, passo a passo, como configurar a WhatsApp Business API oficial da Meta para uso em produção.

> Os nomes de botões e menus ficaram em inglês, como aparecem nos painéis da Meta com o idioma em inglês.

---

## Visão geral

**Prazo:** 1 a 3 semanas
**Dificuldade:** fácil (parte técnica) / média (parte burocrática)
**Quem faz o quê:**
- **Cliente:** cria as contas e envia os documentos
- **Você:** configuração técnica, configuração do webhook, testes

---

## Pré-requisitos (o que o cliente precisa ter)

Antes de começar, garanta que o cliente tem:

- [ ] **Registro da empresa** (certificado SSM, para empresas da Malásia)
- [ ] **Comprovante de endereço da empresa** (conta de consumo, extrato bancário ou alvará)
- [ ] **Site OU página comercial no Facebook** (precisa mostrar o nome da empresa)
- [ ] **Número de telefone** (número novo, que não esteja registrado no WhatsApp)
- [ ] **Acesso ao e-mail** para criar e verificar as contas

---

## Configuração passo a passo

### Fase 1: criação das contas (o cliente faz, você orienta)

#### Passo 1.1: criar a conta Meta Business

1. Acesse [business.facebook.com](https://business.facebook.com)
2. Clique em "Create Account"
3. Preencha:
   - Nome da empresa (igual ao do SSM)
   - Seu nome
   - E-mail da empresa
4. Confirme o endereço de e-mail

**Tempo:** 10 minutos

#### Passo 1.2: criar a conta Meta Developer

1. Acesse [developers.facebook.com](https://developers.facebook.com)
2. Clique em "Get Started"
3. Aceite os termos
4. Confirme o número de telefone

**Tempo:** 5 minutos

#### Passo 1.3: criar o app da Meta

1. No painel Meta Developer, clique em "Create App"
2. Escolha "Business" como tipo de app
3. Dê um nome ao app (ex.: "Nome da Empresa WhatsApp Bot")
4. Selecione a conta Business criada no passo 1.1
5. Clique em "Create App"

**Tempo:** 5 minutos

#### Passo 1.4: adicionar o produto WhatsApp

1. No painel do seu app, procure "Add Products"
2. Clique em "Set Up" no WhatsApp
3. Selecione a sua conta Business
4. Clique em "Continue"

**Tempo:** 2 minutos

---

### Fase 2: verificação da empresa (o cliente faz)

Esta é a etapa mais demorada — a Meta analisa se a empresa é legítima.

#### Passo 2.1: iniciar a verificação

1. Acesse [Business Settings](https://business.facebook.com/settings)
2. Clique em "Security Center", no menu da esquerda
3. Clique em "Start Verification"

#### Passo 2.2: enviar os documentos

A Meta vai pedir:

**Opção A: documentos da empresa**
- Certificado de registro da empresa (SSM)
- Alvará de funcionamento
- Inscrição fiscal

**Opção B: comprovação de endereço**
- Conta de consumo (dos últimos 3 meses)
- Extrato bancário (dos últimos 3 meses)
- Registro da empresa que mostre o endereço

**Dicas para o envio:**
- PDF ou fotos nítidas
- Os documentos precisam mostrar o nome da empresa
- O endereço precisa bater com o que foi informado
- Todo o texto precisa estar legível

#### Passo 2.3: aguardar a aprovação

- **Prazo:** 3 a 7 dias úteis
- **Como acompanhar:** o Security Center mostra "Verified" quando termina
- **Se for recusado:** a Meta explica o motivo; reenvie os documentos corrigidos

**Motivos comuns de recusa:**
- O nome da empresa não bate exatamente com os documentos
- Documentos borrados ou cortados
- O endereço não bate
- O site não mostra o nome da empresa

---

### Fase 3: configuração do número (juntos)

#### Passo 3.1: conseguir um número

**Opção A: usar o número de teste da Meta (gratuito, só para testes)**
- Fornecido automaticamente na configuração da WhatsApp API
- Só consegue mandar mensagem para os números que você adicionar em "Test Numbers"
- Bom para os primeiros testes

**Opção B: adicionar o seu próprio número (produção)**
1. Na configuração da WhatsApp API, clique em "Add Phone Number"
2. Informe o número (com o código do país)
3. Escolha o método de verificação (SMS ou ligação)
4. Digite o código de verificação

**Importante:**
- O número NÃO pode estar registrado no WhatsApp neste momento
- Se estiver, apague o WhatsApp daquele celular primeiro
- Depois de adicionado, o número SÓ pode ser usado pela API (não pelo app do WhatsApp)

#### Passo 3.2: configurar o número

1. Defina o nome de exibição (nome da empresa que aparece para os clientes)
2. Defina a foto de perfil
3. Defina a descrição da empresa

---

### Fase 4: configuração técnica (você faz)

#### Passo 4.1: obter as credenciais da API

No painel Meta Developer → seu app → WhatsApp → API Setup:

1. **Phone Number ID**
   - Aparece abaixo do número que você adicionou
   - Exemplo: `123456789012345`

2. **Access Token**
   - Clique em "Generate Token" (temporário, 24 horas)
   - Ou crie um token permanente por um System User (recomendado para produção)

3. **App Secret**
   - Fica em App Settings → Basic
   - Usado para verificar a assinatura dos webhooks

#### Passo 4.2: criar um access token permanente (recomendado)

Tokens temporários expiram em 24 horas. Crie um permanente:

1. Acesse Business Settings → Users → System Users
2. Clique em "Add" para criar um novo system user
3. Dê um nome (ex.: "WhatsApp Bot")
4. Defina a função como "Admin"
5. Clique em "Add Assets"
6. Selecione o seu app
7. Ative "Manage App"
8. Clique em "Generate Token"
9. Selecione as permissões:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
10. Copie o token e guarde em lugar seguro

#### Passo 4.3: configurar as variáveis de ambiente

Atualize o arquivo `.env`:

```env
WHATSAPP_MODE=meta

META_PHONE_NUMBER_ID=123456789012345
META_ACCESS_TOKEN=EAAxxxxxxxxxxxxxxxxxxxxxxxx
META_WEBHOOK_VERIFY_TOKEN=your-random-secret-string
META_APP_SECRET=abcd1234567890
META_BUSINESS_ID=987654321098765
```

#### Passo 4.4: configurar o webhook

1. Deixe o seu servidor acessível pela internet (ngrok para testes, domínio próprio para produção)

2. No painel Meta Developer → WhatsApp → Configuration:
   - **Callback URL:** `https://your-domain.com/webhook/meta`
   - **Verify Token:** o mesmo valor de `META_WEBHOOK_VERIFY_TOKEN` no .env

3. Assine os campos do webhook:
   - `messages` (obrigatório — mensagens recebidas)
   - `message_deliveries` (opcional — status de entrega)
   - `message_reads` (opcional — confirmação de leitura)

4. Clique em "Verify and Save"

---

### Fase 5: testes

#### Passo 5.1: testar com o número de teste

Se estiver usando o número de teste da Meta:
1. Adicione o seu celular em "Test Numbers", no API Setup
2. Mande uma mensagem de WhatsApp para o número de teste
3. Confira se o webhook recebe a mensagem
4. Confira se o bot responde

#### Passo 5.2: testar com o número de produção

1. Mande uma mensagem de qualquer WhatsApp para o número da empresa
2. Confira se o webhook recebe a mensagem
3. Confira se o bot responde
4. Confira se a mensagem aparece no WhatsApp

#### Passo 5.3: conferir os recursos

Teste cada recurso:
- [ ] Mensagens de texto
- [ ] Imagens (se for o caso)
- [ ] Botões de resposta rápida (se implementados)
- [ ] Mensagens de template (se aprovadas)

---

## Configuração da rota do webhook

Acrescente isto ao seu servidor Express:

```javascript
const { MetaWhatsAppAPI, createWebhookMiddleware } = require('./src/whatsapp/meta-api');

// Inicializa a Meta API
const metaApi = new MetaWhatsAppAPI();
const webhook = createWebhookMiddleware(metaApi);

// Verificação do webhook (GET)
app.get('/webhook/meta', webhook.verify);

// Mensagens recebidas (POST)
app.post('/webhook/meta', webhook.receive);

// Trata as mensagens recebidas (igual ao Baileys)
metaApi.on('messages.upsert', async ({ messages }) => {
    // O seu código de tratamento de mensagens já existente funciona aqui!
});
```

---

## Templates de mensagem (opcional)

Para mensagens iniciadas pela empresa (quando você escreve primeiro), é preciso ter templates aprovados.

### Criar um template

1. Acesse WhatsApp Manager → Message Templates
2. Clique em "Create Template"
3. Preencha:
   - Nome (minúsculas e sublinhado, ex.: `order_confirmation`)
   - Categoria (Marketing, Utility, Authentication)
   - Idioma
   - Conteúdo

### Exemplo de template

```
Name: appointment_reminder
Category: Utility
Language: English

Header: Appointment Reminder
Body: Hi {{1}}, this is a reminder for your appointment on {{2}} at {{3}}.
Footer: Reply YES to confirm or NO to reschedule.
```

### Aguardar a aprovação

- **Prazo:** normalmente 24 a 48 horas
- **Status:** aparece na lista de Message Templates

### Usando templates no código

```javascript
await metaApi.sendTemplateMessage(
    '60123456789',
    'appointment_reminder',
    'en',
    [
        { type: 'body', parameters: [
            { type: 'text', text: 'John' },
            { type: 'text', text: 'Dec 20' },
            { type: 'text', text: '3:00 PM' }
        ]}
    ]
);
```

---

## Guia de preços

### Cobrança por conversa

A Meta cobra por janela de conversa de 24 horas, não por mensagem.

| Tipo de conversa | Descrição | Custo aprox. (MYR) |
|------------------|-----------|--------------------|
| Iniciada pelo usuário | O cliente escreve primeiro | RM 0,15–0,25 |
| Iniciada pela empresa | Você escreve primeiro (template) | RM 0,30–0,45 |
| Marketing | Templates promocionais | RM 0,50–0,70 |

### Faixa gratuita

- **1.000 conversas iniciadas pelo usuário grátis por mês**
- Bom para pequenas empresas

### Exemplos de custo

| Volume mensal | Custo estimado |
|---------------|----------------|
| 500 conversas | Grátis (dentro da faixa gratuita) |
| 2.000 conversas | ~RM 200–400 |
| 5.000 conversas | ~RM 500–1.000 |
| 10.000 conversas | ~RM 1.000–2.000 |

---

## Solução de problemas

### "Business Not Verified"

- Confira o status da verificação no Security Center
- Reenvie documentos mais nítidos
- Garanta que o nome da empresa bate exatamente

### O webhook não recebe mensagens

1. Confira se a callback URL está acessível (teste com curl)
2. Confira se o verify token bate exatamente
3. Confira se as assinaturas do webhook estão ativas
4. Veja os logs de webhook da Meta no painel do app

### As mensagens não saem

1. Confira se o access token é válido
2. Confira se o número está ativo
3. Garanta que o destinatário tem WhatsApp
4. Leia a mensagem de erro devolvida pela API

### Template recusado

Motivos comuns:
- Contém conteúdo proibido
- Faltam os marcadores de variável
- Promocional demais para a categoria Utility
- Erros de gramática ou ortografia

---

## Resumo em checklist

### Tarefas do cliente
- [ ] Criar a conta Meta Business
- [ ] Criar a conta Meta Developer
- [ ] Concluir a verificação da empresa
- [ ] Fornecer o número de telefone
- [ ] Verificar o número de telefone

### Suas tarefas
- [ ] Criar o app da Meta
- [ ] Adicionar o produto WhatsApp
- [ ] Obter as credenciais da API
- [ ] Criar o access token permanente
- [ ] Configurar o webhook
- [ ] Atualizar a configuração do .env
- [ ] Testar o envio de mensagens
- [ ] Criar os templates de mensagem (se necessário)

---

## Recursos de suporte

- [Central de Ajuda do Meta Business](https://www.facebook.com/business/help)
- [Documentação da WhatsApp Business API](https://developers.facebook.com/docs/whatsapp)
- [Suporte para desenvolvedores da Meta](https://developers.facebook.com/support)

---

*Versão do documento: 1.0*
*Última atualização: dezembro de 2024*
