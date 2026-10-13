// Gera um processo de compra FICTÍCIO completo (pasta + .zip) no formato
// esperado pelo FLOW Express. Todos os nomes, CNPJs e valores são inventados.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const PDFDocument = require('pdfkit');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, HeadingLevel } = require('docx');
const PlanilhaPadrao = require('../src/planilha-padrao.js');

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const NOME = '10450001 - ROLETES E CORREIA TC-12 (FICTICIO)';
const destino = path.join(raiz, 'exemplo', NOME);

const RC = '4100630001';
const OBJETO = 'Fornecimento de roletes, correia transportadora 42", raspadores, emendas vulcanizadas e revestimento cerâmico para TC-12';
const ITENS = [
  { item: '1', codigo: '10012345', descricao: 'Rolete de carga Ø6" x 380 mm, eixo 25 mm', un: 'PC', qtd: 120, precoEst: 210 },
  { item: '2', codigo: '10012346', descricao: 'Rolete de retorno Ø6" x 1150 mm', un: 'PC', qtd: 80, precoEst: 260 },
  { item: '3', codigo: '10020011', descricao: 'Correia transportadora 42" EP-630/4 lonas 3/16 x 1/16', un: 'M', qtd: 300, precoEst: 520 },
  { item: '4', codigo: '10030077', descricao: 'Raspador primário em poliuretano para correia 42"', un: 'PC', qtd: 6, precoEst: 3800 },
  { item: '5', codigo: '20000412', descricao: 'Serviço de emenda vulcanizada a quente, correia 42"', un: 'SV', qtd: 4, precoEst: 6500 },
  { item: '6', codigo: '10040990', descricao: 'Revestimento cerâmico para chute de transferência', un: 'M2', qtd: 25, precoEst: 1450 },
];
const FORN = {
  ALFA: { nome: 'Alfa Equipamentos Industriais Ltda', cnpj: '11.222.333/0001-81' },
  BETA: { nome: 'Beta Correias S.A.', cnpj: '22.333.444/0001-92' },
  GAMA: { nome: 'Gama Mineração Serviços Ltda', cnpj: '33.444.555/0001-03' },
};
const precos = (arr, extra = {}) =>
  Object.fromEntries(arr.map((p, i) => [String(i + 1), p]).filter(([, p]) => p != null).map(([k, p]) => [k, { preco: p, ...(extra[k] || {}) }]));

const PROPOSTAS = [
  { f: 'ALFA', r: 'R1', rotulo: 'Proposta inicial', data: '02/09/2026', prazo: 45, pag: 28, val: 60, frete: 'CIF',
    precos: precos([198, 255, 545, 3650, 6200, 1390], { 2: { total: 20040 } }) }, // erro de digitação no total do item 2
  { f: 'BETA', r: 'R1', rotulo: 'Proposta inicial', data: '03/09/2026', prazo: 40, pag: 30, val: 60, frete: 'CIF',
    precos: precos([205, 249, 530, 3900, 5900, null]) }, // não cotou o item 6
  { f: 'ALFA', r: 'R2', rotulo: '1ª rodada', data: '23/09/2026', prazo: 45, pag: 28, val: 60, frete: 'CIF',
    precos: precos([192, 248, 525, 3550, 6000, 1350]) },
  { f: 'BETA', r: 'R2', rotulo: '1ª rodada', data: '23/09/2026', prazo: 40, pag: 30, val: 60, frete: 'CIF',
    precos: precos([199, 240, 515, 3700, 5700, null]) },
  { f: 'ALFA', r: 'BAFO', rotulo: 'Proposta final', data: '06/10/2026', prazo: 40, pag: 28, val: 60, frete: 'CIF',
    precos: precos([188, 242, 512, 3480, 5850, 1310]) },
  { f: 'BETA', r: 'BAFO', rotulo: 'Proposta final', data: '06/10/2026', prazo: 40, pag: 30, val: 60, frete: 'CIF',
    precos: precos([196, 236, 498, 3600, 5600, 1395]) },
];

const arquivos = {}; // caminho relativo -> Buffer
const PASTA_RODADA = { R1: '6 - Proposta Comercial/6.1 Inicial', R2: '6 - Proposta Comercial/6.2 Revisão 01', BAFO: '6 - Proposta Comercial/6.3 Proposta Final' };

/** E-mail .eml (MIME) com anexos opcionais. */
function eml({ de, para, data, assunto, corpo, anexos = [] }) {
  const b = 'FLOW-limite-' + Math.random().toString(36).slice(2);
  const enc = (t) => '=?UTF-8?B?' + Buffer.from(t).toString('base64') + '?=';
  let s = `From: ${de}\r\nTo: ${para}\r\nDate: ${data}\r\nSubject: ${enc(assunto)}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${b}"\r\n\r\n`;
  s += `--${b}\r\nContent-Type: text/plain; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(corpo).toString('base64').replace(/.{76}/g, '$&\r\n')}\r\n`;
  for (const a of anexos) {
    s += `--${b}\r\nContent-Type: application/octet-stream; name="${enc(a.nome)}"\r\nContent-Disposition: attachment; filename="${enc(a.nome)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${a.buf.toString('base64').replace(/.{76}/g, '$&\r\n')}\r\n`;
  }
  return Buffer.from(s + `--${b}--\r\n`);
}

async function xlsx(wb) { return Buffer.from(await wb.xlsx.writeBuffer()); }
async function docx(children) {
  const doc = new Document({ styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } }, sections: [{ children }] });
  return Buffer.from(await Packer.toBuffer(doc));
}
const P = (t, o = {}) => new Paragraph({ children: [new TextRun({ text: t, ...o })] });

function pdf(desenhar) {
  return new Promise((ok) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const partes = [];
    doc.on('data', (b) => partes.push(b));
    doc.on('end', () => ok(Buffer.concat(partes)));
    desenhar(doc);
    doc.end();
  });
}
const br = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  // 01 RC ----------------------------------------------------------------
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('RC');
    ws.columns = [{ width: 7 }, { width: 13 }, { width: 55 }, { width: 6 }, { width: 8 }, { width: 22 }, { width: 22 }];
    ws.getCell('A1').value = 'REQUISIÇÃO DE COMPRA';
    ws.getCell('A1').font = { bold: true, size: 14 };
    const est = ITENS.reduce((s, i) => s + i.qtd * i.precoEst, 0);
    [['Nº da RC', RC], ['Data de emissão', new Date(2026, 7, 18)], ['Objeto', OBJETO],
      ['Requisitante', 'Gerência de Manutenção de Correias – Mina (fictício)'], ['Centro de custo', 'MNT-2201'],
      ['Comprador', 'Ana Souza (fictício)'], ['Valor estimado (R$)', est]].forEach(([k, v], i) => {
      ws.getCell(3 + i, 1).value = k;
      ws.getCell(3 + i, 1).font = { bold: true };
      ws.getCell(3 + i, 3).value = v;
      if (v instanceof Date) ws.getCell(3 + i, 3).numFmt = 'dd/mm/yyyy';
      if (typeof v === 'number') ws.getCell(3 + i, 3).numFmt = '#,##0.00';
    });
    const h = 11;
    ['Item', 'Código SAP', 'Descrição', 'Un', 'Qtd', 'Preço unit. estimado (R$)', 'Total estimado (R$)'].forEach((t, i) => {
      ws.getCell(h, i + 1).value = t;
      ws.getCell(h, i + 1).font = { bold: true };
    });
    ITENS.forEach((it, i) => {
      const r = h + 1 + i;
      [Number(it.item), it.codigo, it.descricao, it.un, it.qtd, it.precoEst].forEach((v, j) => (ws.getCell(r, j + 1).value = v));
      ws.getCell(r, 7).value = { formula: `E${r}*F${r}`, result: it.qtd * it.precoEst };
    });
    arquivos[`1 - Requisição de Compra/1.1 - Original/RC_${RC}.xlsx`] = await xlsx(wb);
    arquivos['1 - Requisição de Compra/1.1 - Original/De acordo gestor - RC ' + RC + '.eml'] = eml({
      de: 'Carlos Menezes (fictício) <carlos.menezes@exemplo.com>', para: 'Suprimentos <suprimentos@exemplo.com>', data: 'Tue, 18 Aug 2026 09:12:00 -0300',
      assunto: `RE: RC ${RC} - roletes e correia TC-12 | De acordo`,
      corpo: 'Prezados,\n\nEstou de acordo com a abertura da RC para substituição dos roletes, da correia do TC-12, raspadores e revestimento cerâmico do chute de transferência. A correia atual está no fim da vida útil e a parada programada de novembro exige o material em campo até 30/10.\n\nAtenciosamente,\nCarlos Menezes\nGerência de Manutenção de Correias (fictício)' });
  }

  // 02 Propostas técnicas ---------------------------------------------------
  for (const k of ['ALFA', 'BETA']) {
    arquivos[`5 - Proposta Técnica/5.1 Inicial/PT_${k}.pdf`] = await pdf((d) => {
      d.fontSize(16).text('PROPOSTA TÉCNICA');
      d.moveDown().fontSize(11).text(`Proponente: ${FORN[k].nome}`);
      d.text(`CNPJ: ${FORN[k].cnpj}`);
      d.text(`Referência: RC ${RC}`);
      d.moveDown().text('1. Escopo do fornecimento conforme especificação técnica ET-MNT-0412.');
      d.text('2. Roletes conforme NBR 6678, rolamentos blindados 6305 2RS.');
      d.text('3. Correia com certificado de ensaio de aderência entre lonas.');
      d.text('4. Equipe de vulcanização com NR-35 e NR-10 válidas.');
    });
  }
  arquivos['5 - Proposta Técnica/5.1 Inicial/PT_GAMA.docx'] = await docx([
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('PROPOSTA TÉCNICA')] }),
    P(`Proponente: ${FORN.GAMA.nome}`), P(`CNPJ: ${FORN.GAMA.cnpj}`), P(`Referência: RC ${RC}`),
    P('Atendemos integralmente a especificação, com ressalva de prazo de entrega da correia (60 dias).'),
  ]);

  // 03 Propostas comerciais (planilha padrão) --------------------------------
  for (const pr of PROPOSTAS) {
    const wb = PlanilhaPadrao.criar(ExcelJS, {
      rc: RC, objeto: OBJETO, itens: ITENS,
      proposta: { fornecedor: FORN[pr.f].nome, cnpj: FORN[pr.f].cnpj, rodada: pr.rotulo, data: pr.data,
        prazoEntrega: pr.prazo, condPagamento: pr.pag, validade: pr.val, frete: pr.frete, precos: pr.precos },
    });
    arquivos[`${PASTA_RODADA[pr.r]}/PC_${pr.f}_${pr.r}.xlsx`] = await xlsx(wb);
  }
  // Proposta da Gama: PDF "no formato do fornecedor" (sem usar a planilha padrão)
  const gama = [
    [1, 'Rolete de carga 6" x 380mm eixo 25', 'PC', 120, 185], [2, 'Rolete de retorno 6" x 1150mm', 'PC', 80, 270],
    [3, 'Correia 42" EP630 4 lonas 3/16x1/16', 'M', 300, 498], [4, 'Raspador primário PU 42"', 'PC', 6, 4100],
    [5, 'Emenda vulcanizada a quente 42"', 'SV', 4, 6900], [6, 'Placa cerâmica p/ chute (0,5 m²)', 'PC', 50, 760],
  ];
  arquivos['6 - Proposta Comercial/6.1 Inicial/Proposta_GAMA_rev0.pdf'] = await pdf((d) => {
    d.fontSize(15).text('GAMA MINERAÇÃO SERVIÇOS LTDA');
    d.fontSize(9).text(`CNPJ: ${FORN.GAMA.cnpj}    Contagem/MG`);
    d.moveDown().fontSize(13).text('PROPOSTA COMERCIAL Nº 0917/2026 – rev.0');
    d.fontSize(10).moveDown(0.5).text('À Samarco – Suprimentos');
    d.text(`Referência: RC ${RC} – roletes, correia e revestimentos`);
    d.text(`Proponente: ${FORN.GAMA.nome}`);
    d.text('Data: 04/09/2026');
    d.moveDown();
    const xs = [50, 80, 330, 370, 410, 480];
    let y = d.y;
    d.fontSize(9);
    ['Item', 'Descrição', 'Un', 'Qtd', 'Preço Unit.', 'Total'].forEach((t, i) => d.text(t, xs[i], y, { lineBreak: false }));
    y += 16;
    let soma = 0;
    for (const [it, ds, un, q, p] of gama) {
      const tot = q * p;
      soma += tot;
      [String(it), ds, un, String(q), br(p), br(tot)].forEach((t, i) => d.text(t, xs[i], y, { lineBreak: false }));
      y += 14;
    }
    y += 6;
    d.text(`TOTAL GERAL: R$ ${br(soma)}`, 330, y, { lineBreak: false });
    d.text('Prazo de entrega: 60 dias', 50, y + 30, { lineBreak: false });
    d.text('Condição de pagamento: 28 ddl', 50, y + 44, { lineBreak: false });
    d.text('Validade da proposta: 30 dias', 50, y + 58, { lineBreak: false });
    d.text('Frete: CIF', 50, y + 72, { lineBreak: false });
  });

  // 04 Avaliação técnica -----------------------------------------------------
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Parecer');
    ws.columns = [{ width: 38 }, { width: 22 }, { width: 24 }, { width: 60 }];
    ws.getCell('A1').value = 'PARECER TÉCNICO – AVALIAÇÃO DAS PROPOSTAS';
    ws.getCell('A1').font = { bold: true, size: 13 };
    ws.getCell('A2').value = `RC ${RC} – Responsável técnico: Eng. Marcos Lima (fictício)`;
    ['Fornecedor', 'Nota técnica (0–100)', 'Resultado', 'Observações'].forEach((t, i) => {
      ws.getCell(4, i + 1).value = t;
      ws.getCell(4, i + 1).font = { bold: true };
    });
    [[FORN.ALFA.nome, 88, 'Aprovado', 'Atende integralmente.'],
      [FORN.BETA.nome, 79, 'Aprovado', 'Atende; raspador de fabricante alternativo homologado.'],
      [FORN.GAMA.nome, 62, 'Aprovado com ressalvas', 'Prazo de 60 dias acima do solicitado (45 dias).']]
      .forEach((r, i) => r.forEach((v, j) => (ws.getCell(5 + i, j + 1).value = v)));
    const at = await xlsx(wb);
    arquivos['4 - Qualificação de Fornecedores/4.1 - Análise Técnica/RE_ Parecer técnico RFP 10450001.eml'] = eml({
      de: 'Eng. Marcos Lima (fictício) <marcos.lima@exemplo.com>', para: 'Ana Souza <ana.souza@exemplo.com>', data: 'Mon, 14 Sep 2026 16:40:00 -0300',
      assunto: 'RE: Parecer técnico RFP 10450001 - roletes e correia TC-12',
      corpo: 'Ana,\n\nSegue o parecer técnico. As três propostas foram aprovadas, a Gama com ressalva de prazo. Notas na planilha anexa.\n\nMarcos Lima\nEngenharia de Manutenção (fictício)',
      anexos: [{ nome: 'AT_PARECER_TECNICO.xlsx', buf: at }] });
  }

  // 05 Negociação (falta propositalmente a ata do BAFO) ------------------------
  arquivos['6 - Proposta Comercial/6.2 Revisão 01/ATA_NEGOCIACAO_R2.docx'] = await docx([
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('ATA DE NEGOCIAÇÃO – 1ª RODADA')] }),
    P(`RC: ${RC}`), P('Data: 22/09/2026'),
    P('Participantes: Ana Souza (Suprimentos), Alfa Equipamentos, Beta Correias'),
    P('Gama Mineração foi convidada e informou que mantém a proposta inicial.'),
    P('Rodada: 1ª rodada'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [['Fornecedor', 'Valor antes', 'Valor após'], ['Alfa', 'R$ 288.750,00', 'R$ 279.430,00'], ['Beta', 'R$ 250.520,00', 'R$ 242.580,00']]
        .map((r) => new TableRow({ children: r.map((c) => new TableCell({ children: [P(c)] })) })),
    }),
  ]);

  // 06 Homologação -----------------------------------------------------------
  for (const [k, validade] of [['ALFA', '15/03/2027'], ['BETA', '30/11/2026'], ['GAMA', '30/06/2026']]) {
    arquivos[`4 - Qualificação de Fornecedores/4.6 - Cadastro/HOM_${k}.pdf`] = await pdf((d) => {
      d.fontSize(14).text('CERTIFICADO DE HOMOLOGAÇÃO DE FORNECEDOR');
      d.moveDown().fontSize(11).text(`Razão social: ${FORN[k].nome}`);
      d.text(`CNPJ: ${FORN[k].cnpj}`);
      d.text('Status: HOMOLOGADO');
      d.text(`Válida até: ${validade}`);
      d.text('Categoria: Materiais de transportadores de correia');
    });
  }

  // 07 Outros (não reconhecidos de propósito) ------------------------------------
  arquivos['Esclarecimentos_fornecedor.pdf'] = await pdf((d) => {
    d.fontSize(11).text('Prezados,');
    d.moveDown().text('Em resposta ao questionamento enviado por e-mail, confirmamos que os roletes possuem vedação labirinto tripla.');
    d.text('Atenciosamente, Beta Correias.');
  });
  arquivos['foto_visita_tecnica.jpg'] = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
    'base64');

  // 2.1 Vendor list + 3 Qualificações (no formato das tabelas SMIN-IT-GSU-004, dados fictícios)
  {
    const wb = new ExcelJS.Workbook();
    const v = wb.addWorksheet('2 - Vendor List');
    ['Nº', 'CÓDIGO SAP', 'EMPRESAS', 'LOCALIZAÇÃO (Cidade/Estado)', 'FATURAMENTO ANUAL (R$)', 'RELAÇÃO FATURAMENTO ANUAL E VALOR PREVISTO (%)', 'PRINCIPAIS CLIENTES', 'PARTICIPOU DO PROCESSO ANTERIOR']
      .forEach((t, i) => (v.getCell(2, 2 + i).value = t));
    [[90011, FORN.ALFA.nome, 'Contagem - MG', 180000000, null, 'Mineradoras e siderúrgicas da região (fictício)', 'Sim'],
      [90012, FORN.BETA.nome, 'Sorocaba - SP', 420000000, null, 'Indústria de mineração e cimento (fictício)', 'Não'],
      [90013, FORN.GAMA.nome, 'Contagem - MG', 65000000, null, 'Mineração de médio porte (fictício)', 'Não'],
      [90014, 'Delta Transportadores Ltda (fictício)', 'Betim - MG', 95000000, null, 'Siderurgia (fictício)', 'Não'],
      [90015, 'Épsilon Borrachas S.A. (fictício)', 'Joinville - SC', 310000000, null, 'Papel e celulose (fictício)', 'Não']]
      .forEach((r, i) => { v.getCell(3 + i, 2).value = i + 1; r.forEach((x, j) => (v.getCell(3 + i, 3 + j).value = x)); });
    const q = wb.addWorksheet('3 - Carta Convite-Qualificações');
    ['Nº', 'CÓDIGO SAP', 'EMPRESAS', 'CONFIRMOU PARTICIPAÇÃO', 'APRESENTOU PROPOSTA', 'QUALIFICAÇÕES'].forEach((t, i) => (q.getCell(2, 2 + i).value = t));
    ['TÉCNICA', 'SEGURANÇA', 'FINANCEIRA', 'COMPLIANCE', 'RESULTADO FINAL'].forEach((t, i) => (q.getCell(3, 7 + i).value = t));
    [[90011, FORN.ALFA.nome, 'SIM', 'SIM', 'APROVADO', 'APROVADO', 'DISPENSADO', 'APROVADO', 'APROVADO'],
      [90012, FORN.BETA.nome, 'SIM', 'SIM', 'APROVADO', 'APROVADO', 'DISPENSADO', 'APROVADO', 'APROVADO'],
      [90013, FORN.GAMA.nome, 'SIM', 'SIM', 'APROVADO', 'APROVADO', 'DISPENSADO', 'APROVADO', 'APROVADO'],
      [90014, 'Delta Transportadores Ltda (fictício)', 'NÃO', 'NÃO', '', '', '', '', ''],
      [90015, 'Épsilon Borrachas S.A. (fictício)', 'SIM', 'NÃO', '', '', '', '', '']]
      .forEach((r, i) => { q.getCell(4 + i, 2).value = i + 1; r.forEach((x, j) => (q.getCell(4 + i, 3 + j).value = x)); });
    arquivos['2 - Estratégia de Contratação/2.1 - Vendor List/SMIN-IT-GSU-004 - Tabelas Modelo Relatório de Homologação.xlsx'] = await xlsx(wb);
  }
  arquivos['3 - Solicitação de Proposta/3.1 - Carta Convite/Carta Convite RFP 10450001.eml'] = eml({
    de: 'Ana Souza (fictício) <ana.souza@exemplo.com>', para: 'fornecedores@exemplo.com', data: 'Tue, 25 Aug 2026 10:05:00 -0300',
    assunto: 'Carta Convite RFP 10450001 - ROLETES E CORREIA TC-12',
    corpo: 'Prezados,\n\nA Gerência Geral de Suprimentos convida sua empresa para o processo de fornecimento de roletes, correia transportadora, raspadores, emendas e revestimento cerâmico para o TC-12.\nPreencha a planilha de preços padrão anexa e envie até 02/09/2026.\n\nAna Souza\nSuprimentos (fictício)',
    anexos: [{ nome: 'Planilha_Precos_Padrao_RFP10450001.xlsx', buf: await xlsx(PlanilhaPadrao.criar(ExcelJS, { rc: RC, objeto: OBJETO, itens: ITENS })) }] });

  // grava pasta + zip ----------------------------------------------------------
  fs.rmSync(path.join(raiz, 'exemplo'), { recursive: true, force: true });
  const zip = new JSZip();
  for (const [rel, buf] of Object.entries(arquivos)) {
    const alvo = path.join(destino, rel);
    fs.mkdirSync(path.dirname(alvo), { recursive: true });
    fs.writeFileSync(alvo, buf);
    zip.file(`${NOME}/${rel}`, buf);
  }
  const zbuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(raiz, 'exemplo', `${NOME}.zip`), zbuf);
  fs.writeFileSync(path.join(raiz, 'exemplo', 'LEIA-ME.txt'), 'Processo de compra FICTÍCIO usado na demonstração do FLOW Express. Todos os nomes, CNPJs, códigos e valores são inventados.\n');
  console.log(`Exemplo gerado: ${Object.keys(arquivos).length} arquivos, zip com ${(zbuf.length / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
