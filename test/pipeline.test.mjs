// Teste ponta a ponta do motor com o processo de exemplo (Node, sem navegador).
// Uso: node test/pipeline.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const XLSX = require('xlsx');
const JSZip = require('jszip');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const E = require('../src/engine.js');
const L = require('../src/leitores.js');

const libs = { XLSX, JSZip, pdfjsLib };
const zipPath = path.join(raiz, 'exemplo', 'RC-4500012345 Correias e Roletes.zip');

export async function carregarExemplo() {
  const entradas = await L.abrirArquivos(libs, [{ name: path.basename(zipPath), arrayBuffer: async () => fs.readFileSync(zipPath) }]);
  for (const e of entradas) Object.assign(e, await L.extrair(libs, e));
  const st = E.montarEstado(entradas);
  return { st, entradas };
}

const { st, entradas } = await carregarExemplo();
const porNome = Object.fromEntries(st.documentos.map((d) => [d.nome, d]));

// classificação
assert.equal(entradas.length, 18);
assert.equal(porNome['RC_4500012345.xlsx'].tipo, 'RC');
assert.equal(porNome['Proposta_GAMA_rev0.pdf'].tipo, 'PC');
assert.equal(porNome['Proposta_GAMA_rev0.pdf'].rodada, 'R1');
assert.equal(porNome['PC_BETA_BAFO.xlsx'].rodada, 'BAFO');
assert.equal(porNome['AT_PARECER_TECNICO.xlsx'].tipo, 'AT');
assert.equal(porNome['ATA_NEGOCIACAO_R2.docx'].rodada, 'R2');
assert.equal(porNome['Esclarecimentos_fornecedor.pdf'].status, 'pendente');
assert.equal(porNome['foto_visita_tecnica.jpg'].status, 'pendente');
assert.equal(porNome['Proposta_GAMA_rev0.pdf'].status, 'conferir');

// dados
assert.equal(String(E.val(st.processo.rc)), '4500012345');
assert.equal(st.itensRC.length, 6);
assert.equal(st.fornecedores.length, 3, st.fornecedores.map((f) => E.val(f.nome)).join(', '));
const f = (n) => st.fornecedores.find((x) => E.norm(E.val(x.nome)).startsWith(n));
assert.equal(E.val(f('ALFA').nt), 88);
assert.equal(E.val(f('GAMA').statusTecnico), 'Aprovado com ressalvas');
assert.equal(E.situacaoHomologacao(f('GAMA')).nivel, 'ruim');
assert.equal(E.situacaoHomologacao(f('ALFA')).nivel, 'ok');
assert.ok(E.val(f('GAMA').cnpj));
const gamaR1 = st.propostas.find((p) => p.fornecedorId === f('GAMA').id);
assert.equal(gamaR1.itens.length, 6, 'itens lidos do PDF da Gama');
assert.equal(E.val(gamaR1.totalDeclarado), 283400);
assert.equal(E.val(gamaR1.prazoEntrega), '60 dias');

// equalização
const eq = E.equalizar(st);
assert.deepEqual(eq.rodadas, ['R1', 'R2', 'BAFO']);
const tot = (rod, n) => eq.porRodada[rod].totais[f(n).id];
assert.equal(tot('R1', 'ALFA').equalizado, 289110); // usa qtd × preço, não o total digitado errado
assert.equal(tot('R1', 'BETA').equalizado, 250520 + 1390 * 25); // item 6 pelo maior preço (Alfa 1390; Gama cotou 760/PC)
assert.equal(tot('BAFO', 'GAMA').herdada, true);
assert.equal(tot('BAFO', 'BETA').equalizado, 270675);
assert.equal(tot('BAFO', 'ALFA').equalizado, 272550);
const tipos = new Set(eq.alertas.map((a) => a.tipo + ':' + E.norm(eq.classificacao.find((c) => c.fid === a.fid)?.nome || '').split(' ')[0]));
for (const t of ['faltante:BETA', 'total:ALFA', 'unidade:GAMA', 'quantidade:GAMA']) assert.ok(tipos.has(t), 'alerta ' + t);
assert.equal(eq.vencedor.nome, 'Alfa Equipamentos Industriais Ltda');
assert.equal(eq.negociacao[f('ALFA').id].inicial, 289110);
assert.ok(Math.abs(eq.resumo.savingNegociacao - (289110 - 272550)) < 0.01);

const pend = E.pendencias(st, eq).filter((p) => !p.ok).map((p) => p.desc);
assert.ok(pend.includes('Ata de negociação — BAFO'));
assert.ok(pend.includes('Homologação válida'));
assert.ok(pend.includes('Carta-convite'));

const rh = E.dadosRH(st, eq);
assert.equal(rh.vencedor, 'Alfa Equipamentos Industriais Ltda');
assert.match(rh.valorFinalExtenso, /^duzentos e setenta e dois mil quinhentos e cinquenta reais$/);
assert.equal(E.extenso(1001.5), 'mil e um reais e cinquenta centavos');
assert.equal(E.extenso(1250000), 'um milhão duzentos e cinquenta mil reais');

console.log('Classificação final:');
for (const c of eq.classificacao) console.log(`  ${c.posicao}º ${c.nome}: ${E.fmtBRL(c.total)} NT ${c.nt} NC ${E.fmtNum(c.nc)} NF ${E.fmtNum(c.nf)} ${c.motivos.join('; ')}`);
console.log(`Alertas: ${eq.alertas.length}; pendências: ${pend.length}`);
console.log('OK — pipeline do exemplo validado.');

// saídas: Word (modelo provisório), Excel e HTML FLOW
{
  const PizZip = require('pizzip');
  const Docxtemplater = require('docxtemplater');
  const ExcelJS = require('exceljs');
  const S = require('../src/saidas.js');
  const modelo = fs.readFileSync(path.join(raiz, 'modelos', 'Modelo_RH_provisorio.docx'));
  const tags = S.marcacoesDoModelo({ PizZip }, modelo);
  assert.ok(tags.includes('{#fornecedores}') && tags.includes('{valorFinalExtenso}'));
  const out = S.gerarDocx({ PizZip, Docxtemplater, saidaBinaria: 'nodebuffer' }, modelo, rh);
  const xml = new PizZip(out).file('word/document.xml').asText().replace(/<[^>]+>/g, '');
  assert.ok(xml.includes('Alfa Equipamentos Industriais Ltda'));
  assert.ok(xml.includes('duzentos e setenta e dois mil'));
  assert.ok(!/\{[#\/]?[a-zA-Z]+\}/.test(xml), 'nenhuma marcação sobrando');
  const xbuf = await S.gerarExcel({ ExcelJS }, st, eq, rh);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xbuf);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumo', 'Equalização 1ª rodada', 'Equalização 2ª rodada', 'Equalização BAFO', 'Negociação', 'Alertas', 'Fontes']);
  const html = S.htmlFLOW(st, eq, rh);
  assert.ok(html.includes('<svg') && html.includes('Alfa Equipamentos'));
  fs.mkdirSync(path.join(raiz, 'test', 'saida'), { recursive: true });
  fs.writeFileSync(path.join(raiz, 'test', 'saida', 'RH_modelo.docx'), out);
  fs.writeFileSync(path.join(raiz, 'test', 'saida', 'Equalizacao.xlsx'), Buffer.from(xbuf));
  fs.writeFileSync(path.join(raiz, 'test', 'saida', 'RH_FLOW.html'), html);
  console.log('OK — saídas (Word, Excel, HTML FLOW) geradas em test/saida/.');
}
