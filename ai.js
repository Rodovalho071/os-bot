// ai.js — transcrição de áudio (Whisper) e leitura de placa/peças (visão + texto)
'use strict';

const OPENAI = 'https://api.openai.com/v1';
const KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

async function openaiFetch(path, options) {
  const res = await fetch(`${OPENAI}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${KEY}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Erro na API de IA (${res.status}): ${body}`);
  }
  return res.json();
}

// Transcreve um áudio (Buffer ogg/opus do WhatsApp) em pt-BR
async function transcrever(buffer, mime) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: mime }), 'audio.ogg');
  fd.append('model', 'whisper-1');
  fd.append('language', 'pt');
  const r = await openaiFetch('/audio/transcriptions', { method: 'POST', body: fd });
  return (r.text || '').trim();
}

// Lê a placa (e, se visível, modelo/cor) a partir da foto
async function lerPlaca(buffer, mime) {
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  const r = await openaiFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                'A imagem mostra a placa de um veículo brasileiro (formato Mercosul ABC1D23 ou antigo ABC1234). ' +
                'Responda APENAS em JSON: {"placa": "ABC1D23" ou null se ilegível, ' +
                '"carro": "marca modelo cor" se o veículo estiver visível, senão null, ' +
                '"confianca": "alta" | "media" | "baixa"}',
            },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    }),
  });
  const out = JSON.parse(r.choices[0].message.content);
  if (out.placa) out.placa = String(out.placa).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return out;
}

// Estrutura a fala do mecânico em peças + mão de obra
async function interpretarServico(texto) {
  const r = await openaiFetch('/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Você estrutura a fala de um mecânico brasileiro descrevendo um serviço. ' +
            'Extraia as peças trocadas com seus valores em reais e o valor da mão de obra. ' +
            'Códigos como "15w40" ou "dot4" fazem parte do nome da peça, não são valores. ' +
            'Medidas ("60 amperes", "4 litros") também fazem parte do nome. ' +
            'Se o mecânico citar o carro (ex.: "fiat argo prata"), extraia em "carro". ' +
            'Responda APENAS em JSON: {"itens": [{"desc": "nome da peça", "valor": 0.0}], ' +
            '"mao_de_obra": 0.0, "carro": "..." ou null}',
        },
        { role: 'user', content: texto },
      ],
    }),
  });
  const out = JSON.parse(r.choices[0].message.content);
  return {
    itens: Array.isArray(out.itens)
      ? out.itens
          .filter((i) => i && i.desc)
          .map((i) => ({ desc: String(i.desc), valor: Number(i.valor) || 0 }))
      : [],
    maoDeObra: Number(out.mao_de_obra) || 0,
    carro: out.carro || null,
  };
}

module.exports = { transcrever, lerPlaca, interpretarServico };
