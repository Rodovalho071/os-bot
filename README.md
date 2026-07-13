# 🔧 OS Bot — Ordens de serviço por WhatsApp

Bot para oficina mecânica: o mecânico manda **foto da placa** + **áudio** com as peças
e a mão de obra, e o bot devolve a OS pronta em PDF, salvando tudo em Google Sheets + Drive.

**Fluxo do usuário:** foto da placa → áudio do serviço → confere o resumo → responde "OK" → recebe o PDF.

**Comandos:** `fechamento` (total do mês) · `historico ABC1D23` · `cancelar`

**Custo estimado:** ~R$ 80–150/mês para ~1.000 OS/mês (servidor + APIs; WhatsApp é grátis para conversas iniciadas pelo mecânico).

---

## Configuração (uma única vez, ~1h30)

Você vai precisar de: um número de celular novo (chip dedicado ao bot), uma conta Google, e cartão pra cadastrar na OpenAI (~US$ 5 de crédito já dura meses).

### 1. Planilha e pasta no Google (15 min)

1. Crie uma planilha nova em [sheets.new](https://sheets.new) — anote o **ID** (trecho do link entre `/d/` e `/edit`)
2. Crie uma pasta no [Google Drive](https://drive.google.com) chamada `Oficina - Comprovantes` — anote o **ID** (trecho final do link)
3. Crie a service account (o "robô" que escreve na planilha):
   - Acesse [console.cloud.google.com](https://console.cloud.google.com) → crie um projeto (ex.: `os-bot`)
   - Menu **APIs e serviços → Biblioteca**: ative **Google Sheets API** e **Google Drive API**
   - Menu **IAM → Contas de serviço → Criar**: dê um nome (ex.: `os-bot`) e conclua
   - Na conta criada: **Chaves → Adicionar chave → JSON** — baixa um arquivo `.json`
4. Copie o e-mail da service account (algo como `os-bot@....iam.gserviceaccount.com`) e
   **compartilhe a planilha E a pasta do Drive com esse e-mail, como Editor**

### 2. Chave da OpenAI (5 min)

1. Crie conta em [platform.openai.com](https://platform.openai.com) → **API keys → Create new key**
2. Adicione US$ 5 de crédito em Billing. Guarde a chave (`sk-...`)

### 3. WhatsApp Cloud API — Meta (40 min, a parte chata)

1. Crie uma conta em [business.facebook.com](https://business.facebook.com) (Meta Business)
2. Em [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → tipo **Business**
3. No painel do app, adicione o produto **WhatsApp**
4. Em **WhatsApp → API Setup**:
   - Cadastre o **número do chip dedicado** (ele recebe um SMS de confirmação; depois disso o número só funciona via API, não no app comum)
   - Anote o **Phone number ID**
5. Token permanente: em [business.facebook.com/settings](https://business.facebook.com/settings) →
   **Usuários → Usuários do sistema → Adicionar** (função Admin) → **Gerar token** →
   selecione o app e as permissões `whatsapp_business_messaging` e `whatsapp_business_management` →
   guarde o token (esse não expira)
6. **Importante:** o app começa em modo de desenvolvimento, que já funciona para até 5 números
   cadastrados como testadores — suficiente pra oficina! Cadastre o número do dono em
   **API Setup → To**. (Só precisa publicar o app se quiser atender números ilimitados.)

### 4. Colocar no ar — Railway (15 min)

1. Crie conta em [railway.app](https://railway.app) logando com o GitHub
2. **New Project → Deploy from GitHub repo** → escolha este repositório
3. Em **Variables**, preencha todas as variáveis do arquivo `.env.example`
   (no `GOOGLE_CREDENTIALS_JSON`, cole o conteúdo inteiro do arquivo `.json` da service account)
4. Em **Settings → Networking → Generate Domain** — anote a URL (ex.: `os-bot-production.up.railway.app`)

### 5. Ligar o webhook (5 min)

1. No painel Meta do app: **WhatsApp → Configuration → Webhook → Edit**
2. **Callback URL:** `https://SUA-URL-DO-RAILWAY/webhook`
3. **Verify token:** o mesmo valor que você pôs em `VERIFY_TOKEN`
4. Clique **Verify and save** e depois em **Manage** marque o campo **messages**

### 6. Testar

Mande uma foto de placa pro número do bot. Ele deve responder com a placa lida. 🎉

---

## Manutenção

- **Monitoramento:** cadastre a URL do Railway no [UptimeRobot](https://uptimerobot.com) (grátis) — avisa por e-mail se o bot cair
- **Backup:** a planilha já está na nuvem; opcionalmente exporte um Excel por mês
- **Custos:** acompanhe o uso da OpenAI em platform.openai.com/usage
- **Logs:** painel do Railway → aba Deployments → View logs

## Estrutura do código

| Arquivo | O que faz |
|---|---|
| `server.js` | Webhook e fluxo da conversa (máquina de estados) |
| `whatsapp.js` | Envio/recebimento de mensagens e mídia (Cloud API) |
| `ai.js` | Transcrição (Whisper), leitura de placa e estruturação (visão/LLM) |
| `sheets.js` | Planilha (Sheets) e arquivos (Drive) |
| `pdf.js` | Geração do PDF da OS |

## Roadmap (módulos futuros)

- Cadastro de clientes pela placa (nome/telefone na 1ª visita)
- Foto de nota fiscal de fornecedor → controle de garantia de peças
- Aviso automático ao cliente quando o carro ficar pronto (template pago, ~centavos)
