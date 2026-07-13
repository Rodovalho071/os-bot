// pdf.js — gera o PDF da ordem de serviço
'use strict';

const PDFDocument = require('pdfkit');

const NOME_OFICINA = process.env.NOME_OFICINA || 'OFICINA';
const INFO_OFICINA = process.env.INFO_OFICINA || '';
const GARANTIA = process.env.TEXTO_GARANTIA || 'Garantia do serviço: 90 dias';

const brl = (v) => 'R$ ' + (Number(v) || 0).toFixed(2).replace('.', ',');

function gerarPdfOS(os) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const largura = doc.page.width - 80;

    // Cabeçalho
    doc.fontSize(16).font('Helvetica-Bold').text(NOME_OFICINA, { align: 'center' });
    if (INFO_OFICINA) doc.fontSize(9).font('Helvetica').text(INFO_OFICINA, { align: 'center' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(40 + largura, doc.y).stroke();
    doc.moveDown(0.5);

    const dataFmt = new Date(os.data).toLocaleDateString('pt-BR');
    doc.fontSize(10).font('Helvetica-Bold')
      .text(`ORDEM DE SERVIÇO Nº ${String(os.numero).padStart(4, '0')}`, { continued: true })
      .font('Helvetica').text(`   ${dataFmt}`, { align: 'right' });
    doc.moveDown(0.8);

    // Veículo
    doc.fontSize(13).font('Helvetica-Bold').text(os.placa);
    if (os.carro) doc.fontSize(10).font('Helvetica').text(os.carro);
    doc.moveDown(0.8);

    // Peças
    doc.fontSize(10).font('Helvetica-Bold').text('PEÇAS');
    doc.moveTo(40, doc.y).lineTo(40 + largura, doc.y).stroke();
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(10);
    if (os.itens.length) {
      for (const item of os.itens) {
        const y = doc.y;
        doc.text(item.desc, 40, y, { width: largura - 90 });
        doc.text(brl(item.valor), 40 + largura - 85, y, { width: 85, align: 'right' });
        doc.moveDown(0.2);
      }
    } else {
      doc.text('— sem peças —');
    }
    doc.moveDown(0.6);

    // Mão de obra e total
    const yMao = doc.y;
    doc.font('Helvetica-Bold').text('Mão de obra', 40, yMao);
    doc.font('Helvetica').text(brl(os.maoDeObra), 40 + largura - 85, yMao, { width: 85, align: 'right' });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(40 + largura, doc.y).lineWidth(1.5).stroke();
    doc.moveDown(0.3);
    const yTot = doc.y;
    doc.fontSize(13).font('Helvetica-Bold').text('TOTAL', 40, yTot);
    doc.text(brl(os.total), 40 + largura - 110, yTot, { width: 110, align: 'right' });

    // Rodapé
    doc.moveDown(2);
    doc.fontSize(8.5).font('Helvetica')
      .text(GARANTIA, 40, doc.y, { width: largura, align: 'center' });
    doc.text('Obrigado pela preferência!', { width: largura, align: 'center' });

    doc.end();
  });
}

module.exports = { gerarPdfOS };
