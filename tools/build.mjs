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
  'node_modules/docxtemplater/build/docxtemplater.min.js',
  'node_modules/pdfjs-dist/build/pdf.min.js',
];
const proprios = ['src/engine.js', 'src/planilha-padrao.js', 'src/leitores.js', 'src/saidas.js', 'src/app.js'];

function seguro(codigo, nome) {
  if (/<\/script/i.test(codigo)) throw new Error(`${nome} contém "</script" e quebraria o HTML.`);
  return codigo;
}
const script = (p) => `<script>/* ${path.basename(p)} */\n${seguro(lerTxt(p), p)}\n</script>`;

const modelo = fs.readFileSync(r('modelos/Modelo_RH_provisorio.docx')).toString('base64');
const exemplo = fs.readFileSync(r('exemplo/RC-4500012345 Correias e Roletes.zip')).toString('base64');

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
<div id="app"><p style="padding:40px;font-family:sans-serif">Carregando o FLOW Express…</p></div>
<noscript><p style="padding:40px">O FLOW Express precisa de JavaScript habilitado (Edge ou Chrome).</p></noscript>
<script type="text/plain" id="pdf-worker">${seguro(lerTxt('node_modules/pdfjs-dist/build/pdf.worker.min.js'), 'pdf.worker')}</script>
${bibliotecas.map(script).join('\n')}
<script>window.FLOW_VERSAO=${JSON.stringify(versao)};window.FLOW_MODELO_RH_B64="${modelo}";window.FLOW_EXEMPLO_B64="${exemplo}";</script>
${proprios.map(script).join('\n')}
</body>
</html>
`;

fs.mkdirSync(r('dist'), { recursive: true });
fs.writeFileSync(r('dist/FLOW-Express.html'), html);
console.log(`dist/FLOW-Express.html gerado (${(html.length / 1024 / 1024).toFixed(2)} MB, versão ${versao})`);
