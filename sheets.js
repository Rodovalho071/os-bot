// sheets.js — armazenamento em Google Sheets + arquivos no Google Drive
'use strict';

const { google } = require('googleapis');

const SHEET_ID = process.env.SHEET_ID;
const DRIVE_FOLDER_ID = process.env.DRIVE_FOLDER_ID;
const ABA = 'OS';

const CABECALHO = [
  'numero', 'data', 'placa', 'carro', 'pecas', 'valor_pecas',
  'mao_de_obra', 'total', 'transcricao', 'link_foto', 'link_audio', 'link_pdf',
];

let _clients = null;
function clients() {
  if (_clients) return _clients;
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive',
    ],
  });
  _clients = {
    sheets: google.sheets({ version: 'v4', auth }),
    drive: google.drive({ version: 'v3', auth }),
  };
  return _clients;
}

// Garante que a aba OS existe com cabeçalho (roda uma vez no boot)
async function inicializar() {
  const { sheets } = clients();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const existe = meta.data.sheets.some((s) => s.properties.title === ABA);
  if (!existe) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests: [{ addSheet: { properties: { title: ABA } } }] },
    });
  }
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${ABA}!A1:L1`,
  });
  if (!r.data.values || !r.data.values.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: `${ABA}!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: [CABECALHO] },
    });
  }
}

async function lerTodas() {
  const { sheets } = clients();
  const r = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${ABA}!A2:L`,
  });
  return (r.data.values || []).map((v) => ({
    numero: v[0], data: v[1], placa: v[2], carro: v[3], pecas: v[4],
    valorPecas: parseFloat(v[5]) || 0, maoDeObra: parseFloat(v[6]) || 0,
    total: parseFloat(v[7]) || 0,
  }));
}

async function proximoNumero() {
  return (await lerTodas()).length + 1;
}

async function salvarOS(os) {
  const { sheets } = clients();
  const linha = [
    os.numero,
    os.data,
    os.placa,
    os.carro || '',
    os.itens.map((i) => `${i.desc} (${i.valor.toFixed(2)})`).join(' + '),
    os.itens.reduce((s, i) => s + i.valor, 0).toFixed(2),
    os.maoDeObra.toFixed(2),
    os.total.toFixed(2),
    os.transcricao || '',
    os.linkFoto || '',
    os.linkAudio || '',
    os.linkPdf || '',
  ];
  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${ABA}!A:L`,
    valueInputOption: 'RAW',
    requestBody: { values: [linha] },
  });
}

// Sobe um arquivo (foto/áudio/PDF) pra pasta da oficina no Drive
async function subirArquivo(buffer, nome, mime) {
  const { drive } = clients();
  const { Readable } = require('stream');
  const r = await drive.files.create({
    requestBody: { name: nome, parents: [DRIVE_FOLDER_ID] },
    media: { mimeType: mime, body: Readable.from(buffer) },
    fields: 'id, webViewLink',
  });
  return r.data.webViewLink;
}

// Fechamento do mês corrente
async function fechamentoDoMes() {
  const todas = await lerTodas();
  const agora = new Date();
  const doMes = todas.filter((o) => {
    const d = new Date(o.data);
    return d.getMonth() === agora.getMonth() && d.getFullYear() === agora.getFullYear();
  });
  return {
    qtd: doMes.length,
    total: doMes.reduce((s, o) => s + o.total, 0),
    maoDeObra: doMes.reduce((s, o) => s + o.maoDeObra, 0),
  };
}

// Histórico de uma placa
async function historicoDaPlaca(placa) {
  const todas = await lerTodas();
  return todas.filter((o) => (o.placa || '').toUpperCase() === placa.toUpperCase());
}

module.exports = {
  inicializar, salvarOS, proximoNumero, subirArquivo, fechamentoDoMes, historicoDaPlaca,
};
