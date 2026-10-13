/*
 * FLOW Express — leitura de arquivos, 100% local.
 * Abre .zip / pasta, e extrai o conteúdo de Excel, Word e PDF com texto.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Leitores = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IGNORAR = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|~\$[^/]*|\.~lock[^/]*)(\/|$)/i;
  const ext = (n) => (String(n).match(/\.([^.\/]+)$/) || [, ''])[1].toLowerCase();
  let seq = 0;
  const novoId = () => 'D' + Date.now().toString(36) + (seq++).toString(36);

  /** Expande um .zip (inclusive zips dentro do zip) em entradas {nome, caminho, ext, bytes}. */
  async function abrirZip(libs, bytes, prefixo = '', nivel = 0) {
    const zip = await libs.JSZip.loadAsync(bytes);
    const out = [];
    const nomes = Object.keys(zip.files).filter((n) => !zip.files[n].dir && !IGNORAR.test(n));
    for (const n of nomes) {
      const b = await zip.files[n].async('uint8array');
      const caminho = prefixo + n;
      if (ext(n) === 'zip' && nivel < 2) out.push(...(await abrirZip(libs, b, caminho.replace(/\.zip$/i, '') + '/', nivel + 1)));
      else out.push({ id: novoId(), nome: n.split('/').pop(), caminho, ext: ext(n), tamanho: b.length, bytes: b });
    }
    return out;
  }

  /** Lista de File (input de pasta, arrastar e soltar ou .zip). */
  async function abrirArquivos(libs, arquivos) {
    const out = [];
    for (const f of arquivos) {
      const caminho = f.caminho || f.webkitRelativePath || f.name;
      if (IGNORAR.test(caminho)) continue;
      const b = new Uint8Array(await f.arrayBuffer());
      if (ext(f.name) === 'zip') out.push(...(await abrirZip(libs, b, '')));
      else out.push({ id: novoId(), nome: f.name, caminho, ext: ext(f.name), tamanho: b.length, bytes: b });
    }
    // remove a pasta raiz comum para caminhos mais limpos
    const partes = out.map((e) => e.caminho.split('/'));
    if (partes.length > 1 && partes.every((p) => p.length > 1 && p[0] === partes[0][0])) {
      out.forEach((e) => { e.raiz = partes[0][0]; e.caminho = e.caminho.split('/').slice(1).join('/'); });
    }
    return out;
  }

  /** Lê entradas de arrastar e soltar (inclui pastas). */
  async function lerArrasto(dataTransfer) {
    const itens = [...(dataTransfer.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null));
    if (!itens.some(Boolean)) return [...dataTransfer.files];
    const arquivos = [];
    const lerDir = (dir) => new Promise((ok, erro) => {
      const leitor = dir.createReader();
      const todos = [];
      const lote = () => leitor.readEntries((ents) => { if (!ents.length) ok(todos); else { todos.push(...ents); lote(); } }, erro);
      lote();
    });
    const visitar = async (ent, base) => {
      if (!ent) return;
      if (ent.isFile) {
        const f = await new Promise((ok, erro) => ent.file(ok, erro));
        f.caminho = base + f.name;
        arquivos.push(f);
      } else if (ent.isDirectory) {
        for (const e of await lerDir(ent)) await visitar(e, base + ent.name + '/');
      }
    };
    for (const ent of itens) await visitar(ent, '');
    return arquivos;
  }

  // ------------------------------------------------------------ extração

  const decodificar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');

  function textoParagrafo(xml) {
    let s = '';
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    let m;
    while ((m = re.exec(xml))) s += m[1] != null ? decodificar(m[1]) : m[0] === '<w:tab/>' ? '\t' : ' ';
    return s;
  }

  async function lerDocx(libs, bytes) {
    const zip = await libs.JSZip.loadAsync(bytes);
    const arq = zip.file('word/document.xml');
    if (!arq) throw new Error('Arquivo Word sem conteúdo legível.');
    const xml = await arq.async('string');
    const lines = [], tables = [];
    const re = /<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
    let m;
    while ((m = re.exec(xml))) {
      const bloco = m[0];
      if (bloco.startsWith('<w:tbl>')) {
        const rows = [];
        for (const tr of bloco.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g) || []) {
          const cells = (tr.match(/<w:tc>[\s\S]*?<\/w:tc>|<w:tc [\s\S]*?<\/w:tc>/g) || []).map((tc) =>
            (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(textoParagrafo).join(' ').trim());
          const cel = cells.map((c) => (c === '' ? null : c));
          rows.push(cel);
          lines.push({ t: cells.join(' | '), p: 1 });
        }
        tables.push(rows);
      } else {
        const t = textoParagrafo(bloco).trim();
        if (t) lines.push({ t, p: 1 });
      }
    }
    return { kind: 'text', lines, tables };
  }

  async function lerPdf(libs, bytes) {
    const pdf = await libs.pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false, useSystemFonts: true }).promise;
    const lines = [];
    for (let p = 1; p <= Math.min(pdf.numPages, 60); p++) {
      const pg = await pdf.getPage(p);
      const tc = await pg.getTextContent();
      const grupos = [];
      for (const it of tc.items) {
        if (!it.str || !it.str.trim()) continue;
        const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
        let g = grupos.find((g) => Math.abs(g.y - y) <= Math.max(2, h * 0.35));
        if (!g) { g = { y, itens: [] }; grupos.push(g); }
        g.itens.push({ x, w: it.width || 0, s: it.str, h });
      }
      grupos.sort((a, b) => b.y - a.y);
      for (const g of grupos) {
        g.itens.sort((a, b) => a.x - b.x);
        let t = '', fim = null;
        for (const it of g.itens) {
          if (fim != null) {
            const gap = it.x - fim;
            if (gap > it.h * 1.2) t += '  ';
            else if (gap > it.h * 0.15 && !t.endsWith(' ') && !it.s.startsWith(' ')) t += ' ';
          }
          t += it.s;
          fim = it.x + it.w;
        }
        lines.push({ t: t.trim(), p });
      }
    }
    return { kind: 'text', lines, tables: [] };
  }

  function lerPlanilha(libs, bytes, nome) {
    const wb = libs.XLSX.read(bytes, { type: 'array', cellDates: true, cellNF: false, cellText: false });
    const sheets = wb.SheetNames.map((n) => {
      const ws = wb.Sheets[n];
      const rows = libs.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
      // sheet_to_json começa na primeira linha usada; reajusta para o endereço real
      const ref = ws['!ref'] ? libs.XLSX.utils.decode_range(ws['!ref']) : { s: { r: 0, c: 0 } };
      const pre = Array.from({ length: ref.s.r }, () => []);
      const colPre = Array.from({ length: ref.s.c }, () => null);
      return { name: n, rows: pre.concat(rows.map((r) => colPre.concat(r.map((c) => (typeof c === 'string' ? c.trim() || null : c))))) };
    });
    return { kind: 'sheets', sheets };
  }

  function lerTxt(bytes) {
    const t = new TextDecoder('utf-8').decode(bytes);
    return { kind: 'text', lines: t.split(/\r?\n/).map((s) => ({ t: s.trim(), p: 1 })).filter((l) => l.t), tables: [] };
  }

  async function extrair(libs, entrada) {
    const e = entrada.ext;
    try {
      if (['xlsx', 'xlsm', 'xls', 'csv', 'ods'].includes(e)) return { conteudo: lerPlanilha(libs, entrada.bytes, entrada.nome) };
      if (e === 'docx' || e === 'docm') return { conteudo: await lerDocx(libs, entrada.bytes) };
      if (e === 'pdf') return { conteudo: await lerPdf(libs, entrada.bytes) };
      if (e === 'txt') return { conteudo: lerTxt(entrada.bytes) };
      return { conteudo: null };
    } catch (err) {
      return { conteudo: null, erro: `Não consegui ler o arquivo (${err && err.message ? err.message : err}).` };
    }
  }

  /** Texto corrido do documento (para a tela de conferência). */
  function textoPlano(conteudo, max = 20000) {
    if (!conteudo) return '';
    if (conteudo.kind === 'text') return conteudo.lines.map((l) => l.t).join('\n').slice(0, max);
    return conteudo.sheets.map((s) => `[${s.name}]\n` + s.rows.filter((r) => r.some((c) => c != null))
      .map((r) => r.map((c) => (c instanceof Date ? c.toLocaleDateString('pt-BR') : c == null ? '' : c)).join('\t')).join('\n')).join('\n\n').slice(0, max);
  }

  return { abrirZip, abrirArquivos, lerArrasto, extrair, textoPlano, ext };
});
