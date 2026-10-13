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

// conferência
await page.getByRole('button', { name: /Seguir para a conferência/ }).click();
await page.getByText('Dados do processo').waitFor();
assert.equal(await page.locator('.campo input').first().inputValue(), '4500012345');
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
await page.locator('.aba', { hasText: '1ª rodada' }).click();
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
await page.locator('iframe.previa').waitFor();
await page.waitForTimeout(500);
await foto('6-rh.png');
const [dlWord] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /RH no modelo atual/ }).click()]);
await dlWord.saveAs(path.join(saida, 'e2e_RH.docx'));
const [dlXls] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Planilha de equalização/ }).click()]);
await dlXls.saveAs(path.join(saida, 'e2e_Equalizacao.xlsx'));
assert.ok(fs.statSync(path.join(saida, 'e2e_RH.docx')).size > 5000);
assert.ok(fs.statSync(path.join(saida, 'e2e_Equalizacao.xlsx')).size > 5000);

// prévia FLOW em PDF (o botão abre a impressão; aqui geramos o PDF da mesma página)
const htmlFlow = await page.locator('iframe.previa').getAttribute('srcdoc');
const p2 = await ctx.newPage();
await p2.setContent(htmlFlow);
await p2.pdf({ path: path.join(saida, 'e2e_RH_FLOW.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true });
await p2.close();

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
