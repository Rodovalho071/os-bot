// whatsapp.js — envio e recebimento de mídia via WhatsApp Cloud API (Meta)
'use strict';

const GRAPH = 'https://graph.facebook.com/v20.0';
const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_ID = process.env.PHONE_NUMBER_ID;

async function graphFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Erro na API do WhatsApp (${res.status}): ${body}`);
  }
  return res;
}

// Envia mensagem de texto simples
async function sendText(to, body) {
  await graphFetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });
}

// Baixa uma mídia recebida (foto ou áudio) e devolve um Buffer
async function downloadMedia(mediaId) {
  const meta = await (await graphFetch(`${GRAPH}/${mediaId}`)).json();
  const bin = await graphFetch(meta.url);
  return {
    buffer: Buffer.from(await bin.arrayBuffer()),
    mime: meta.mime_type || 'application/octet-stream',
  };
}

// Envia um documento (PDF da OS): primeiro sobe a mídia, depois manda a mensagem
async function sendDocument(to, buffer, filename, caption) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('type', 'application/pdf');
  fd.append('file', new Blob([buffer], { type: 'application/pdf' }), filename);

  const up = await (await graphFetch(`${GRAPH}/${PHONE_ID}/media`, {
    method: 'POST',
    body: fd,
  })).json();

  await graphFetch(`${GRAPH}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'document',
      document: { id: up.id, filename, caption },
    }),
  });
}

module.exports = { sendText, downloadMedia, sendDocument };
