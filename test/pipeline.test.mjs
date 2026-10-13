// Teste ponta a ponta do motor com o processo de exemplo FICTÍCIO (Node, sem navegador).
// Uso: npm test
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const XLSX = require('xlsx');
const JSZip = require('jszip');
const PizZip = require('pizzip');
const ExcelJS = require('exceljs');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const SevenZip = require('7z-wasm');
const E = require('../src/engine.js');
const L = require('../src/leitores.js');
const S = require('../src/saidas.js');
const RH = require('../src/rh-samarco.js');

const libs = { XLSX, JSZip, pdfjsLib, SevenZip, wasm7z: () => fs.readFileSync(require.resolve('7z-wasm/7zz.wasm')) };
const zipNome = fs.readdirSync(path.join(raiz, 'exemplo')).find((n) => n.endsWith('.zip'));
const arq = (p) => ({ name: path.basename(p), size: fs.statSync(p).size, arrayBuffer: async () => fs.readFileSync(p) });

const { entradas } = await L.lerTudo(libs, [arq(path.join(raiz, 'exemplo', zipNome))]);
const st = E.montarEstado(entradas);
const porNome = Object.fromEntries(st.documentos.map((d) => [d.nome, d]));

// leitura: zip, e-mails com anexos
assert.ok(entradas.length >= 23, 'arquivos + anexos de e-mail: ' + entradas.length);
assert.equal(st.nomeProcesso, '10450001 - ROLETES E CORREIA TC-12 (FICTICIO)');
assert.ok(porNome['AT_PARECER_TECNICO.xlsx'] && porNome['AT_PARECER_TECNICO.xlsx'].anexoDe, 'anexo do e-mail do parecer');
// classificação pelas pastas 1–8
assert.equal(porNome['RC_4100630001.xlsx'].tipo, 'RC');
assert.equal(porNome['De acordo gestor - RC 4100630001.eml'].tipo, 'JUST');
assert.equal(porNome['SMIN-IT-GSU-004 - Tabelas Modelo Relatório de Homologação.xlsx'].tipo, 'TAB');
assert.equal(porNome['Carta Convite RFP 10450001.eml'].tipo, 'CC');
assert.equal(porNome['RE_ Parecer técnico RFP 10450001.eml'].tipo, 'QT');
assert.equal(porNome['Proposta_GAMA_rev0.pdf'].tipo, 'PC');
assert.equal(porNome['Proposta_GAMA_rev0.pdf'].rodada, 'R1');
assert.equal(porNome['PC_BETA_BAFO.xlsx'].rodada, 'BAFO');
assert.equal(porNome['ATA_NEGOCIACAO_R2.docx'].rodada, 'R2');
assert.equal(porNome['Esclarecimentos_fornecedor.pdf'].status, 'pendente');
assert.equal(porNome['foto_visita_tecnica.jpg'].status, 'pendente');
assert.equal(porNome['Proposta_GAMA_rev0.pdf'].status, 'conferir');
assert.equal(E.val(st.tipoProcesso), 'concorrencia');

// dados
assert.equal(String(E.val(st.processo.rc)), '4100630001');
assert.equal(st.itensRC.length, 6);
const f = (n) => st.fornecedores.find((x) => E.norm(E.val(x.nome)).startsWith(n));
assert.ok(f('ALFA') && f('BETA') && f('GAMA'));
assert.equal(st.vendorList.length, 5);
assert.equal(E.val(f('ALFA').codigoSap), '90011');
assert.equal(E.val(f('BETA').qTec), 'APROVADO');
assert.equal(E.val(f('ALFA').nt), 88);
assert.equal(E.val(f('GAMA').statusTecnico), 'Aprovado com ressalvas');
assert.equal(E.situacaoHomologacao(f('GAMA')).nivel, 'ruim');
const gamaR1 = st.propostas.find((p) => p.fornecedorId === f('GAMA').id);
assert.equal(gamaR1.itens.length, 6, 'itens lidos do PDF da Gama');
assert.equal(E.val(gamaR1.totalDeclarado), 283400);

// equalização e ponderação (fórmula SMIN-IT-GSU-004)
const eq = E.equalizar(st);
assert.deepEqual(eq.rodadas, ['R1', 'R2', 'BAFO']);
assert.equal(E.nomeRodada('R1'), 'Proposta inicial');
assert.equal(E.nomeRodada('R2'), '1ª rodada');
const tot = (rod, n) => eq.porRodada[rod].totais[f(n).id];
assert.equal(tot('R1', 'ALFA').equalizado, 289110);
assert.equal(tot('R1', 'BETA').equalizado, 250520 + 1390 * 25);
assert.equal(tot('BAFO', 'GAMA').herdada, true);
assert.equal(tot('BAFO', 'BETA').equalizado, 270675);
assert.ok(Math.abs(E.notaComercial(110, 100) - 90) < 1e-9);
assert.equal(E.notaComercial(250, 100), 0);
const alfa = eq.classificacao.find((c) => c.nome.startsWith('Alfa'));
assert.ok(Math.abs(alfa.nc - (1 - (272550 / 264400 - 1)) * 100) < 1e-9);
assert.equal(eq.vencedor.nome, 'Alfa Equipamentos Industriais Ltda');
assert.ok(Math.abs(eq.resumo.custoEvitado - (289110 - 272550)) < 0.01);

// aditivo: cálculo de meses
assert.equal(E.mesesEntre('01/01/2025', '31/12/2026'), 24);
assert.equal(E.mesesEntre('15/03/2024', '30/06/2026'), 27);
assert.deepEqual(E.dadosDoNome('7__TAC_CRT_4500000123-EXEMPLO_CONCRETO_LTDA'), { tac: 7, contrato: '4500000123', fornecedor: 'EXEMPLO CONCRETO LTDA' });

// leitor de item em PDF no formato "descrição  R$ preço  qtd  R$ total" (com e sem desconto)
assert.deepEqual(E.itemDeLinha('Licença Server 5000      R$ 39.480,00            2              R$ 78.960,00'), { item: null, descricao: 'Licença Server 5000', un: '', qtd: 2, preco: 39480, total: 78960, desconto: null });
assert.equal(E.itemDeLinha('Licença Server 5000      R$ 39.480,00    6,00 %     2             R$ 74.222,40').preco, 37111.2);

const pend = E.pendencias(st, eq).filter((p) => !p.ok).map((p) => p.desc);
assert.ok(pend.includes('Nº da RC') === false, 'RC preenchida a partir da planilha');
assert.ok(pend.includes('Gestor do contrato'));

const rh = E.dadosRH(st, eq);
assert.equal(rh.vencedor, 'Alfa Equipamentos Industriais Ltda');
assert.equal(rh.cab.fornecedorRH, '90011 - ALFA EQUIPAMENTOS INDUSTRIAIS LTDA');
assert.match(rh.cab.custoEvitado, /16\.560,00/);
assert.equal(E.extenso(1001.5), 'mil e um reais e cinquenta centavos');

// RH no formato Samarco (modelo provisório com a mesma estrutura do formulário)
const modelo = fs.readFileSync(path.join(raiz, 'modelos', 'Modelo_RH_provisorio.docx'));
const out = RH.gerar({ PizZip, DOMParser, XMLSerializer, saidaBinaria: 'nodebuffer' }, modelo, { st, eq, dados: rh });
const texto = new PizZip(out).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
for (const t of ['90011 - ALFA EQUIPAMENTOS INDUSTRIAIS LTDA', 'EQUALIZAÇÃO COMERCIAL', 'Proposta Inicial Equalizada', 'PONTUAÇÃO FINAL', 'Composição do valor contratado', 'DELTA TRANSPORTADORES', 'prosseguimos com a contratação'])
  assert.ok(texto.toUpperCase().includes(t.toUpperCase()), 'RH contém: ' + t);
assert.ok(!/preenchido pelo FLOW Express/.test(texto), 'textos de exemplo removidos');

// RH de aditivo a partir do modelo provisório de alteração contratual
const sta = E.estadoVazio();
sta.tipoProcesso = E.F('aditivo', 'teste');
sta.evolucao = [{ tac: 'Dados iniciais - Contrato', data: '01/01/2025', aditado: null, total: 100000, variacao: '100,00%', prazo: 12, inicio: '01/01/2025', termino: '31/12/2025' }];
sta.aditivo = { numero: E.F(1), novoTermino: E.F('31/12/2026'), valorAditado: E.F(20000), classificacao: E.F('Valor e Prazo') };
sta.cab = { contrato: E.F('4500000001'), responsavel: E.F('Ana Souza') };
sta.fornecedores = [];
const da = E.dadosRH(sta, null);
assert.equal(da.cab.valorContratado.replace(/\u00a0/g, ' '), 'R$ 120.000,00');
assert.equal(da.cab.prazo, '24 (meses)');
const outA = RH.gerar({ PizZip, DOMParser, XMLSerializer, saidaBinaria: 'nodebuffer' }, fs.readFileSync(path.join(raiz, 'modelos', 'Modelo_RH_aditivo_provisorio.docx')), { st: sta, eq: null, dados: da });
const ta = new PizZip(outA).file('word/document.xml').asText().replace(/<[^>]+>/g, ' ').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ');
for (const t of ['1º Aditivo – Data', 'Alterado o valor total de R$ 100.000,00 para R$ 120.000,00', '31/12/2025 para 31/12/2026', 'de 12 para 24 meses', '120.000,00'])
  assert.ok(ta.includes(t), 'RH aditivo contém: ' + t);
assert.ok(!/XX\/XX\/XXXX/.test(ta), 'exemplo do formulário removido');

// Excel no formato SMIN-IT-GSU-004
const xbuf = await S.gerarExcel({ ExcelJS, RHSamarco: RH }, st, eq, rh);
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(xbuf);
const abas = wb.worksheets.map((w) => w.name);
for (const a of ['2 - Vendor List', '3 - Carta Convite-Qualificações', '4 - Quadro de Preço', '4 - TCO']) assert.ok(abas.includes(a), 'aba ' + a);
assert.equal(wb.getWorksheet('4 - TCO').getCell('F8').value.formula.startsWith('IF(OR(E8="",$D$4=""),"",IF(E8/MIN($E$8:$E$'), true);

const html = S.htmlFLOW(st, eq, rh);
assert.ok(html.includes('<svg') && html.includes('Alfa Equipamentos'));
fs.mkdirSync(path.join(raiz, 'test', 'saida'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'test', 'saida', 'RH_modelo.docx'), out);
fs.writeFileSync(path.join(raiz, 'test', 'saida', 'RH_aditivo.docx'), outA);
fs.writeFileSync(path.join(raiz, 'test', 'saida', 'Tabelas_SMIN.xlsx'), Buffer.from(xbuf));
fs.writeFileSync(path.join(raiz, 'test', 'saida', 'RH_FLOW.html'), html);

console.log('Classificação final:');
for (const c of eq.classificacao) console.log(`  ${c.posicao}º ${c.nome}: ${E.fmtBRL(c.total)} NT ${c.nt} NC ${E.fmtNum(c.nc)} NF ${E.fmtNum(c.nf)} ${c.motivos.join('; ')}`);
console.log('OK — motor, RH Samarco (contratação e aditivo), Excel SMIN-IT-GSU-004 e PDF FLOW validados.');
