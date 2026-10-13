// Teste de ponta a ponta no navegador (Chromium), SEM acesso à rede.
// Uso: npm run build && node test/e2e.test.mjs  (gera capturas em test/saida/)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const saida = path.join(raiz, 'test', 'saida');
fs.mkdirSync(saida, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const erros = [], rede = [];
page.on('console', (m) => m.type() === 'error' && erros.push(m.text()));
page.on('pageerror', (e) => erros.push(String(e)));
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  rede.push(u);
  return route.abort();
});

const foto = (n) => page.screenshot({ path: path.join(saida, n), fullPage: true });
await page.goto(pathToFileURL(path.join(raiz, 'dist', 'FLOW-Express.html')).href);
await page.getByText('Da pasta do processo ao RH pronto.').waitFor();
await foto('1-inicio.png');

// demonstração
await page.getByRole('button', { name: /Ver demonstração/ }).click();
await page.getByText('Não reconheci estes arquivos').waitFor({ timeout: 60000 });
await foto('2-documentos.png');
const pend = await page.locator('.painel.destaque .doc').count();
assert.equal(pend, 2, 'dois arquivos não reconhecidos');

// indicar o tipo do PDF de esclarecimentos (Outro anexo)
await page.locator('.painel.destaque .doc', { hasText: 'Esclarecimentos_fornecedor.pdf' }).locator('select').first().selectOption('OUTRO');
await page.locator('.painel.destaque .doc').first().waitFor();
assert.equal(await page.locator('.painel.destaque .doc').count(), 1);

// subir mais arquivos no mesmo processo (pasta grande em partes)
const antes = await page.locator('.resumo-docs .kpi b').first().innerText();
await page.locator('.mini-drop input[type=file]').first().setInputFiles(path.join(raiz, 'exemplo', 'LEIA-ME.txt'));
await page.getByText('somados ao processo').waitFor();
assert.notEqual(await page.locator('.resumo-docs .kpi b').first().innerText(), antes);

// print de tela (fictício) lido por OCR, sem rede: nota de cabeçalho da RC com o gestor
const png = await page.evaluate(async () => {
  const c = document.createElement('canvas'); c.width = 1300; c.height = 420;
  const g = c.getContext('2d');
  g.fillStyle = '#f2f4f7'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; g.fillRect(Math.random() * 1300, Math.random() * 60, 2, 2); }
  g.fillStyle = '#ffffff'; g.fillRect(30, 80, 1240, 310);
  g.fillStyle = '#111'; g.font = '26px Arial';
  ['Exibir Nota cabeçalho: 4100630001 Idioma PT', 'Gestor: JOANA EXEMPLO LIMA', 'Objeto Resumido: Roletes e correia TC-12'].forEach((t, i) => g.fillText(t, 50, 140 + i * 60));
  const b = await new Promise((r) => c.toBlob(r, 'image/png'));
  return [...new Uint8Array(await b.arrayBuffer())];
});
const arqPng = path.join(saida, 'Captura de tela SAP (ficticio).png');
fs.writeFileSync(arqPng, Buffer.from(png));
assert.ok(png.length >= 20 * 1024, 'print com tamanho de captura real: ' + png.length);
await page.locator('.mini-drop input[type=file]').first().setInputFiles(arqPng);
await page.locator('.doc', { hasText: 'Captura de tela SAP' }).first().waitFor({ timeout: 120000 });

// conferência
await page.getByRole('button', { name: /Seguir para a conferência/ }).click();
await page.getByText('Cabeçalho do RH').waitFor();
assert.equal(await page.locator('label.campo', { hasText: 'Nº DA REQUISIÇÃO DE COMPRA' }).locator('input').inputValue(), '4100630001');
assert.equal(await page.locator('label.campo', { hasText: 'FORNECEDOR' }).first().locator('input').inputValue(), '90011 - ALFA EQUIPAMENTOS INDUSTRIAIS LTDA');
assert.equal(await page.locator('label.campo', { hasText: 'GESTOR' }).first().locator('input').inputValue(), 'Joana Exemplo Lima', 'gestor lido do print');
await foto('3-conferencia.png');

// corrigir a unidade da Gama no item 6 (PC → M2, preço convertido): 50 placas de 0,5 m² = 25 m²
await page.locator('.aba', { hasText: 'Gama' }).click();
const linha6 = page.locator('.editor .tab.itens tbody tr').nth(5);
await linha6.locator('input').nth(3).fill('M2');
await linha6.locator('input').nth(3).blur();
await linha6.locator('input').nth(4).fill('25');
await linha6.locator('input').nth(4).blur();
await linha6.locator('input').nth(5).fill('1520');
await linha6.locator('input').nth(5).blur();
await linha6.locator('input').nth(6).fill('38000');
await linha6.locator('input').nth(6).blur();
await page.getByRole('button', { name: /Marcar como conferida/ }).click();
await foto('3b-conferencia-gama.png');

// equalização
await page.getByRole('button', { name: /Ver a equalização/ }).click();
await page.locator('.matriz').waitFor();
await foto('4-equalizacao.png');
const total = await page.locator('.matriz tfoot tr.forte').innerText();
assert.match(total, /272\.550,00/);
assert.match(total, /283\.400,00/, 'Gama corrigida = 283.400,00');
await page.locator('.aba', { hasText: 'Proposta inicial' }).click();
await foto('4b-equalizacao-r1.png');
assert.ok(await page.locator('.tag.laranja').count() >= 1, 'item não cotado equalizado (Beta)');

// negociação
await page.getByRole('button', { name: /Ver a negociação/ }).click();
await page.locator('.grafico svg').waitFor();
const box = await page.locator('.grafico svg').boundingBox();
await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.5);
await page.locator('.tooltip').waitFor();
await foto('5-negociacao.png');

// RH
await page.getByRole('button', { name: /Montar o RH/ }).click();
await page.locator('.previa .flowrel').waitFor();
await page.waitForTimeout(500);
await foto('6-rh.png');
const [dlWord] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Relatório de Homologação \(Word\)/ }).click()]);
await dlWord.saveAs(path.join(saida, 'e2e_RH.docx'));
const [dlXls] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Tabelas SMIN-IT-GSU-004/ }).click()]);
await dlXls.saveAs(path.join(saida, 'e2e_Equalizacao.xlsx'));
assert.ok(fs.statSync(path.join(saida, 'e2e_RH.docx')).size > 5000);
assert.ok(fs.statSync(path.join(saida, 'e2e_Equalizacao.xlsx')).size > 5000);

// RH padrão FLOW em PDF, gerado direto no navegador
const [dlPdf] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: /RH padrão FLOW/ }).click()]);
await dlPdf.saveAs(path.join(saida, 'e2e_RH_FLOW.pdf'));
assert.ok(fs.statSync(path.join(saida, 'e2e_RH_FLOW.pdf')).size > 50000);

// diálogo próprio (confirm/prompt não existem na página do claude.ai)
await page.getByRole('button', { name: /Novo RH/ }).click();
await page.getByText('Começar um novo RH?').waitFor();
await page.getByRole('button', { name: 'Cancelar' }).click();
assert.equal(await page.locator('.dialogo').count(), 0);

// planilha padrão Samarco gerada a partir da RC do processo aberto
await page.getByRole('button', { name: /Início/ }).click();
await page.getByRole('button', { name: /Gerar planilha padrão Samarco/ }).click();
const [dlPad] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Gerar com os itens da RC/ }).click()]);
const padrao = path.join(saida, 'e2e_Planilha_Padrao.xlsx');
await dlPad.saveAs(padrao);
await page.getByRole('button', { name: 'Fechar' }).click();
{
  const XLSX = require('xlsx');
  const E = require('../src/engine.js');
  const wb = XLSX.read(fs.readFileSync(padrao), { type: 'buffer' });
  const conteudo = { kind: 'sheets', sheets: wb.SheetNames.map((n) => ({ name: n, rows: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null, blankrows: true }) })) };
  const c = E.classificar({ nome: 'qualquer_nome.xlsx', caminho: 'qualquer_nome.xlsx', ext: 'xlsx', conteudo });
  assert.equal(c.tipo, 'PC', 'planilha padrão reconhecida pelo conteúdo');
  assert.equal(E.itensPlanilha(conteudo).itens.length, 6);
}

// celular
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(saida, '7-celular.png') });
const larg = await page.evaluate(() => document.documentElement.scrollWidth);
assert.ok(larg <= 392, 'sem rolagem horizontal no celular: ' + larg);

await browser.close();
assert.deepEqual(rede, [], 'nenhum acesso à rede');
assert.deepEqual(erros, [], 'sem erros no console');
console.log('OK — E2E no navegador, sem rede. Capturas em test/saida/.');
