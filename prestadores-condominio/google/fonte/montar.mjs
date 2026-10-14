// Gera ../Index.html (poucas linhas, para colar no Apps Script sem cortar) a partir de Index.fonte.html.
// Uso: ESBUILD=/caminho/para/esbuild node montar.mjs   (ou com esbuild instalado no projeto)
import { readFileSync, writeFileSync } from 'node:fs';
const { transform } = await import(process.env.ESBUILD || 'esbuild');
const aqui = new URL('.', import.meta.url);
const src = readFileSync(new URL('Index.fonte.html', aqui), 'utf8');

const [, head, css, meio, js, fim] = src.match(/^([\s\S]*?)<style>([\s\S]*?)<\/style>([\s\S]*?)<script>([\s\S]*?)<\/script>([\s\S]*)$/);
const cssMin = (await transform(css, { loader: 'css', minify: true })).code.trim();
const jsMin = (await transform(js, { loader: 'js', minify: true, target: 'es2017' })).code.trim();
const compactar = (h) => h.replace(/<!--[\s\S]*?-->/g, '').replace(/>\s*\n\s*</g, '><').replace(/\n\s*/g, ' ').trim();

const saida = [
  ...head.trim().split('\n').map((l) => l.trim()),
  '<style>' + cssMin + '</style>',
  compactar(meio),
  '<script>' + jsMin + '</script>',
  compactar(fim),
  '<!-- ===== FIM DO ARQUIVO Index.html (se esta linha não aparecer, a cópia veio cortada) ===== -->',
].join('\n') + '\n';
writeFileSync(new URL('../Index.html', aqui), saida);
console.log(`Index.html: ${saida.split('\n').length - 1} linhas, ${saida.length} caracteres`);
