// Monta o FLOW Express em UM único arquivo HTML, com todas as bibliotecas,
// o modelo de RH provisório e o processo de demonstração embutidos.
// Uso: npm run build  →  dist/FLOW-Express.html
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const r = (...p) => path.join(raiz, ...p);
const lerTxt = (p) => fs.readFileSync(r(p), 'utf8');

execFileSync(process.execPath, [r('tools/gerar-modelo-rh.mjs')], { stdio: 'inherit' });
execFileSync(process.execPath, [r('tools/gerar-exemplo.mjs')], { stdio: 'inherit' });

const versao = JSON.parse(lerTxt('package.json')).version;
const bibliotecas = [
  'node_modules/htm/preact/standalone.umd.js',
  'node_modules/jszip/dist/jszip.min.js',
  'node_modules/xlsx/dist/xlsx.full.min.js',
  'node_modules/exceljs/dist/exceljs.min.js',
  'node_modules/pizzip/dist/pizzip.min.js',
  'node_modules/pdfjs-dist/build/pdf.min.js',
  'node_modules/html2canvas/dist/html2canvas.min.js',
  'node_modules/jspdf/dist/jspdf.umd.min.js',
  'node_modules/7z-wasm/7zz.umd.js',
  'node_modules/.cache/flow/msgreader.min.js',
  'node_modules/tesseract.js/dist/tesseract.min.js',
];
const proprios = ['src/engine.js', 'src/planilha-padrao.js', 'src/leitores.js', 'src/ocr.js', 'src/rh-samarco.js', 'src/saidas.js', 'src/app.js'];

// leitor de e-mails do Outlook (.msg) empacotado como global do navegador
fs.mkdirSync(r('node_modules/.cache/flow'), { recursive: true });
(await import('esbuild')).buildSync({
  entryPoints: [r('tools/vendor/msgreader-entry.js')], bundle: true, minify: true, format: 'iife', platform: 'browser',
  outfile: r('node_modules/.cache/flow/msgreader.min.js'), logLevel: 'silent',
});

function seguro(codigo, nome) {
  if (/<\/script/i.test(codigo)) throw new Error(`${nome} contém "</script" e quebraria o HTML.`);
  // U+FFFD literal (tabelas de codepage do SheetJS) vira o escape equivalente \uFFFD
  return codigo.replace(/\uFFFD/g, '\\uFFFD');
}
const script = (p) => `<script>/* ${path.basename(p)} */\n${seguro(lerTxt(p).replace(/\/\/# sourceMappingURL=\S+/g, ''), p)}\n</script>`;

const modelo = fs.readFileSync(r('modelos/Modelo_RH_provisorio.docx')).toString('base64');
const modeloAditivo = fs.readFileSync(r('modelos/Modelo_RH_aditivo_provisorio.docx')).toString('base64');
const zipExemplo = fs.readdirSync(r('exemplo')).find((n) => n.endsWith('.zip'));
const exemplo = fs.readFileSync(r('exemplo', zipExemplo)).toString('base64');
const wasm7z = fs.readFileSync(r('node_modules/7z-wasm/7zz.wasm')).toString('base64');
// OCR (prints, fotos, PDF escaneado): Tesseract + dicionário de português, sem rede
const ocrPor = fs.readFileSync(r('node_modules/@tesseract.js-data/por/4.0.0_best_int/por.traineddata.gz')).toString('base64');
const semMapa = (t) => t.replace(/\/\/# sourceMappingURL=\S+/g, '');

const corpo = `<div id="app"><p style="padding:40px;font-family:sans-serif">Carregando o FLOW Express…</p></div>
<noscript><p style="padding:40px">O FLOW Express precisa de JavaScript habilitado (Edge ou Chrome).</p></noscript>
<script type="text/plain" id="pdf-worker">${seguro(lerTxt('node_modules/pdfjs-dist/build/pdf.worker.min.js'), 'pdf.worker')}</script>
<script type="text/plain" id="ocr-worker">${seguro(semMapa(lerTxt('node_modules/tesseract.js/dist/worker.min.js')), 'tesseract worker')}</script>
<script type="text/plain" id="ocr-core">${seguro(lerTxt('node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'tesseract core')}</script>
${bibliotecas.map(script).join('\n')}
<script>window.FLOW_VERSAO=${JSON.stringify(versao)};window.FLOW_MODELO_RH_B64="${modelo}";window.FLOW_MODELO_ADITIVO_B64="${modeloAditivo}";window.FLOW_EXEMPLO_NOME=${JSON.stringify(zipExemplo)};window.FLOW_EXEMPLO_B64="${exemplo}";window.FLOW_7Z_WASM_B64="${wasm7z}";window.FLOW_OCR_POR_B64="${ocrPor}";</script>
${proprios.map(script).join('\n')}
`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FLOW Express</title>
<meta name="description" content="FLOW Express ${versao} — da pasta ao RH. Funciona offline; nenhum dado sai do computador.">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0e4d64"/><path d="M9 8h14v4H13.5v3H21v4h-7.5v5H9z" fill="#fff"/></svg>')}">
<style>
${lerTxt('src/estilo.css')}
</style>
</head>
<body>
${corpo}</body>
</html>
`;

// Versão para publicar como página no claude.ai (o envoltório <html>/<head> é colocado na publicação)
const pagina = `<title>FLOW Express</title>
<style>
${lerTxt('src/estilo.css')}
</style>
${corpo}`;

fs.mkdirSync(r('dist/pagina-claude'), { recursive: true });
fs.writeFileSync(r('dist/FLOW-Express.html'), html);
fs.writeFileSync(r('dist/pagina-claude/FLOW-Express.html'), pagina);
console.log(`dist/FLOW-Express.html gerado (${(html.length / 1024 / 1024).toFixed(2)} MB, versão ${versao})`);
