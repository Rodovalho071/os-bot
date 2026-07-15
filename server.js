// server.js — bot de ordens de serviço por WhatsApp (foto da placa + áudio)
'use strict';

const express = require('express');
const wa = require('./whatsapp');
const ai = require('./ai');
const db = require('./sheets');
const { gerarPdfOS } = require('./pdf');

const app = express();
app.use(express.json({ limit: '25mb' })); // fotos/áudios chegam em base64

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
// Números autorizados a usar o bot (separados por vírgula), ex.: "5511999990000"
const AUTORIZADOS = (process.env.ALLOWED_NUMBERS || '')
  .split(',').map((n) => n.trim()).filter(Boolean);

const brl = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

// Rascunho de OS em andamento por usuário (na memória)
const rascunhos = new Map();

const AJUDA =
  '🔧 *Como usar:*\n' +
  '1. Mande a *foto da placa* do carro\n' +
  '2. Mande um *áudio* falando as peças com valores e a mão de obra\n' +
  '3. Confira o resumo e responda *OK* pra salvar\n\n' +
  'Outros comandos:\n' +
  '• *fechamento* — total do mês\n' +
  '• *historico ABC1D23* — serviços daquela placa\n' +
  '• *cancelar* — descarta a OS em andamento';

// ---------- Webhook (verificação da Meta) ----------
app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

// ---------- Webhook (mensagens) ----------
app.post('/webhook', (req, res) => {
  res.sendStatus(200); // responde já; processa em seguida
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg) tratarMensagem(msg).catch(async (e) => {
      console.error('Erro ao tratar mensagem:', e);
      try { await wa.sendText(msg.from, '⚠️ Deu um erro aqui. Tenta de novo em instantes.'); } catch {}
    });
  } catch (e) {
    console.error('Webhook malformado:', e);
  }
});

async function tratarMensagem(msg) {
  const de = msg.from;
  if (AUTORIZADOS.length && !AUTORIZADOS.includes(de)) return; // ignora estranhos

  if (msg.type === 'image') return receberFoto(de, msg.image);
  if (msg.type === 'audio') return receberAudio(de, msg.audio);
  if (msg.type === 'text') return receberTexto(de, msg.text.body);
  await wa.sendText(de, 'Só entendo foto, áudio e texto. 🙂\n\n' + AJUDA);
}

// ---------- Passo 1: foto da placa ----------
async function receberFoto(de, image) {
  await wa.sendText(de, '📷 Recebi! Lendo a placa…');
  const { buffer, mime } = await wa.downloadMedia(image.id);
  const leitura = await ai.lerPlaca(buffer, mime);

  const rascunho = rascunhos.get(de) || {};
  rascunho.foto = { buffer, mime };
  rascunho.placa = leitura.placa || null;
  if (leitura.carro && !rascunho.carro) rascunho.carro = leitura.carro;
  rascunhos.set(de, rascunho);

  if (!leitura.placa) {
    return wa.sendText(de,
      '❌ Não consegui ler a placa. Tenta outra foto (mais de perto, sem reflexo) ' +
      'ou *digita a placa* (ex.: ABC1D23).');
  }
  const aviso = leitura.confianca !== 'alta' ? '\n(Se estiver errada, digita a placa certa.)' : '';
  await wa.sendText(de,
    `✅ Placa: *${leitura.placa}*${rascunho.carro ? `\n🚗 ${rascunho.carro}` : ''}${aviso}\n\n` +
    '🎤 Agora manda um *áudio* com as peças, os valores e a mão de obra.');
}

// ---------- Passo 2: áudio do serviço ----------
async function receberAudio(de, audio) {
  const rascunho = rascunhos.get(de);
  if (!rascunho || !rascunho.placa) {
    return wa.sendText(de, 'Primeiro manda a *foto da placa* (ou digita a placa). 📷');
  }
  await wa.sendText(de, '🎤 Recebi! Montando a OS…');

  const { buffer, mime } = await wa.downloadMedia(audio.id);
  const transcricao = await ai.transcrever(buffer, mime);
  if (!transcricao) {
    return wa.sendText(de, '❌ Não entendi o áudio. Pode gravar de novo?');
  }
  const servico = await ai.interpretarServico(transcricao);

  rascunho.audio = { buffer, mime };
  rascunho.transcricao = transcricao;
  rascunho.itens = servico.itens;
  rascunho.maoDeObra = servico.maoDeObra;
  if (servico.carro && !rascunho.carro) rascunho.carro = servico.carro;
  rascunhos.set(de, rascunho);

  await wa.sendText(de, montarResumo(rascunho));
}

function montarResumo(r) {
  const totalPecas = r.itens.reduce((s, i) => s + i.valor, 0);
  const total = totalPecas + r.maoDeObra;
  let out = `📋 *RESUMO DA OS*\n\n🚗 *${r.placa}*${r.carro ? ` — ${r.carro}` : ''}\n\n*Peças:*\n`;
  out += r.itens.length
    ? r.itens.map((i) => `• ${i.desc}: ${brl(i.valor)}`).join('\n')
    : '• (nenhuma)';
  out += `\n\n*Mão de obra:* ${brl(r.maoDeObra)}\n*TOTAL: ${brl(total)}*\n\n`;
  out += 'Confere? Responde *OK* pra salvar, manda *outro áudio* pra refazer, ou *cancelar*.';
  return out;
}

// ---------- Passo 3: confirmação e comandos de texto ----------
async function receberTexto(de, texto) {
  const t = texto.trim().toLowerCase();
  const rascunho = rascunhos.get(de);

  if (['ok', 'sim', 'confirmar', 'confirma', 'pode salvar', 'salvar'].includes(t)) {
    if (!rascunho || !rascunho.itens) {
      return wa.sendText(de, 'Não tem OS pra confirmar. Manda a foto da placa pra começar. 📷');
    }
    return salvar(de, rascunho);
  }

  if (t === 'cancelar') {
    rascunhos.delete(de);
    return wa.sendText(de, '🗑️ OS descartada. Manda a foto da placa quando quiser começar outra.');
  }

  if (t === 'fechamento') {
    const f = await db.fechamentoDoMes();
    return wa.sendText(de,
      `📊 *Fechamento do mês*\n\nOrdens de serviço: ${f.qtd}\n` +
      `Faturamento: ${brl(f.total)}\nMão de obra: ${brl(f.maoDeObra)}`);
  }

  if (t.startsWith('historico') || t.startsWith('histórico')) {
    const placa = t.replace(/hist[oó]rico/, '').replace(/[^a-z0-9]/g, '').toUpperCase();
    if (placa.length < 7) return wa.sendText(de, 'Manda assim: *historico ABC1D23*');
    const hist = await db.historicoDaPlaca(placa);
    if (!hist.length) return wa.sendText(de, `Nenhuma OS encontrada pra ${placa}.`);
    const linhas = hist.slice(-10).map((o) =>
      `• OS ${String(o.numero).padStart(4, '0')} — ${new Date(o.data).toLocaleDateString('pt-BR')} — ${brl(o.total)}`);
    return wa.sendText(de, `🚗 *${placa}* — ${hist.length} serviço(s):\n\n${linhas.join('\n')}`);
  }

  // Placa digitada (correção ou início sem foto)
  const placaDigitada = t.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placaDigitada)) {
    const r = rascunhos.get(de) || {};
    r.placa = placaDigitada;
    rascunhos.set(de, r);
    if (r.itens) return wa.sendText(de, montarResumo(r));
    return wa.sendText(de,
      `✅ Placa: *${placaDigitada}*\n\n🎤 Agora manda o *áudio* com as peças e a mão de obra.`);
  }

  await wa.sendText(de, AJUDA);
}

// ---------- Salvamento: Drive + Sheets + PDF ----------
async function salvar(de, r) {
  await wa.sendText(de, '💾 Salvando…');
  const numero = await db.proximoNumero();
  const agora = new Date();
  const os = {
    numero,
    data: agora.toISOString(),
    placa: r.placa,
    carro: r.carro || '',
    itens: r.itens,
    maoDeObra: r.maoDeObra,
    total: r.itens.reduce((s, i) => s + i.valor, 0) + r.maoDeObra,
    transcricao: r.transcricao,
  };
  const num = String(numero).padStart(4, '0');

  // Arquivos no Drive (comprovantes)
  if (r.foto) os.linkFoto = await db.subirArquivo(r.foto.buffer, `OS${num}-placa.jpg`, r.foto.mime);
  if (r.audio) os.linkAudio = await db.subirArquivo(r.audio.buffer, `OS${num}-audio.ogg`, r.audio.mime);

  // PDF
  const pdf = await gerarPdfOS(os);
  os.linkPdf = await db.subirArquivo(pdf, `OS${num}.pdf`, 'application/pdf');

  // Planilha
  await db.salvarOS(os);
  rascunhos.delete(de);

  await wa.sendDocument(de, pdf, `OS-${num}.pdf`,
    `✅ OS ${num} salva — ${os.placa} — ${brl(os.total)}\n` +
    'Encaminha esse PDF pro cliente se quiser. 📤');
}

// ======================================================
// APP WEB — mesma inteligência, sem depender do WhatsApp
// ======================================================
const path = require('path');

// PIN opcional: defina a variável APP_PIN no Railway pra proteger o app
function pinOk(req) {
  const pin = process.env.APP_PIN;
  return !pin || req.headers['x-pin'] === pin;
}
function exigePin(req, res) {
  if (pinOk(req)) return true;
  res.status(401).json({ erro: 'PIN incorreto' });
  return false;
}

// Lê a placa a partir da foto
app.post('/api/placa', async (req, res) => {
  if (!exigePin(req, res)) return;
  try {
    const buf = Buffer.from(req.body.imagem, 'base64');
    const leitura = await ai.lerPlaca(buf, req.body.mime || 'image/jpeg');
    res.json(leitura);
  } catch (e) {
    console.error('api/placa:', e.message);
    res.status(500).json({ erro: 'Falha ao ler a placa' });
  }
});

// Transcreve o áudio (ou recebe texto) e estrutura peças + mão de obra
app.post('/api/servico', async (req, res) => {
  if (!exigePin(req, res)) return;
  try {
    let texto = (req.body.texto || '').trim();
    if (!texto && req.body.audio) {
      const buf = Buffer.from(req.body.audio, 'base64');
      texto = await ai.transcrever(buf, req.body.mime || 'audio/mp4');
    }
    if (!texto) return res.status(400).json({ erro: 'Sem áudio nem texto' });
    const servico = await ai.interpretarServico(texto);
    res.json({ transcricao: texto, ...servico });
  } catch (e) {
    console.error('api/servico:', e.message);
    res.status(500).json({ erro: 'Falha ao entender o serviço' });
  }
});

// Salva a OS: planilha + arquivos no Drive + PDF (devolvido em base64)
app.post('/api/os', async (req, res) => {
  if (!exigePin(req, res)) return;
  try {
    const b = req.body;
    const numero = await db.proximoNumero();
    const itens = (b.itens || []).map((i) => ({ desc: String(i.desc || ''), valor: Number(i.valor) || 0 }))
      .filter((i) => i.desc);
    const os = {
      numero,
      data: new Date().toISOString(),
      placa: String(b.placa || '').toUpperCase(),
      carro: b.carro || '',
      itens,
      maoDeObra: Number(b.maoDeObra) || 0,
      transcricao: b.transcricao || '',
    };
    os.total = itens.reduce((s, i) => s + i.valor, 0) + os.maoDeObra;
    const num = String(numero).padStart(4, '0');

    if (b.foto) os.linkFoto = await db.subirArquivo(Buffer.from(b.foto, 'base64'), `OS${num}-placa.jpg`, b.fotoMime || 'image/jpeg');
    if (b.audio) os.linkAudio = await db.subirArquivo(Buffer.from(b.audio, 'base64'), `OS${num}-audio.m4a`, b.audioMime || 'audio/mp4');

    const pdf = await gerarPdfOS(os);
    os.linkPdf = await db.subirArquivo(pdf, `OS${num}.pdf`, 'application/pdf');
    await db.salvarOS(os);

    res.json({ numero, total: os.total, data: os.data, pdfBase64: pdf.toString('base64') });
  } catch (e) {
    console.error('api/os:', e.message);
    res.status(500).json({ erro: 'Falha ao salvar a OS' });
  }
});

// Fechamento do mês + últimas OS
app.get('/api/resumo', async (req, res) => {
  if (!exigePin(req, res)) return;
  try {
    const [fechamento, ultimas] = await Promise.all([db.fechamentoDoMes(), db.listarUltimas(30)]);
    res.json({ fechamento, ultimas });
  } catch (e) {
    console.error('api/resumo:', e.message);
    res.status(500).json({ erro: 'Falha ao consultar a planilha' });
  }
});

// ---------- Início ----------
const PORT = process.env.PORT || 3000;
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'app.html')));
app.get('/status', (_req, res) => res.send('Bot OS no ar 🔧'));
db.inicializar()
  .then(() => app.listen(PORT, () => console.log(`Bot rodando na porta ${PORT}`)))
  .catch((e) => { console.error('Falha ao inicializar planilha:', e); process.exit(1); });
