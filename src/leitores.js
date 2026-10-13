/*
 * FLOW Express — leitura de arquivos, 100% local.
 * Abre pastas, .zip, .7z/.rar (inclusive compactados dentro de compactados),
 * e-mails (.eml/.msg, com anexos) e extrai o conteúdo de Excel, Word e PDF.
 * Para aguentar pastas grandes, só descompacta e lê o que interessa ao RH:
 * imagens, vídeos, desenhos etc. entram só na lista, sem ocupar memória.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Leitores = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const IGNORAR = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini|~\$[^/]*|\.~lock[^/]*)(\/|$)/i;
  const ext = (n) => (String(n).match(/\.([^.\/]+)$/) || [, ''])[1].toLowerCase();
  const LEGIVEIS = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'ods', 'docx', 'docm', 'pdf', 'txt', 'eml', 'msg']);
  const COMPACTADOS = new Set(['zip', '7z', 'rar']);
  const MAX_LEITURA = 150 * 1024 * 1024; // arquivo individual acima disso é só listado
  let seq = 0;
  const novoId = () => 'D' + Date.now().toString(36) + (seq++).toString(36);
  const MB = (n) => (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';

  // ------------------------------------------------------------ nomes de arquivo em zip
  // Zips criados no Windows costumam gravar nomes em CP850 (sem a marca UTF-8).
  const CP850 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ';
  function decodificarNome(bytes) {
    const u = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { /* não é UTF-8 */ }
    let s = '';
    for (const b of u) s += b < 128 ? String.fromCharCode(b) : CP850[b - 128];
    return s;
  }

  // ------------------------------------------------------------ entrada de arquivos
  /**
   * Percorre arquivos (File, pasta, .zip, .7z) e chama `aoArquivo(entrada)` para cada um.
   * entrada = {id, nome, caminho, ext, tamanho, bytes|null, origem}
   * bytes só vem preenchido para formatos que o FLOW lê; o chamador deve liberar após extrair.
   */
  async function percorrer(libs, arquivos, aoArquivo, aoProgresso) {
    const prog = { lidos: 0, bytes: 0 };
    const avisar = (msg) => aoProgresso && aoProgresso({ msg, ...prog });
    const emitir = async (e) => {
      prog.lidos++;
      prog.bytes += e.tamanho || 0;
      await aoArquivo(e);
    };
    for (const f of arquivos) {
      const caminho = f.caminho || f.webkitRelativePath || f.name;
      if (IGNORAR.test(caminho)) continue;
      const x = ext(f.name);
      if (COMPACTADOS.has(x)) {
        avisar(`Abrindo ${f.name} (${MB(f.size)})…`);
        const b = new Uint8Array(await f.arrayBuffer());
        await abrirCompactado(libs, b, x, caminho.replace(/\.(zip|7z|rar)$/i, '') + '/', emitir, avisar, 0, f.name);
      } else {
        const legivel = LEGIVEIS.has(x) && f.size <= MAX_LEITURA;
        avisar(`Lendo ${f.name}`);
        await emitir({ id: novoId(), nome: f.name, caminho, ext: x, tamanho: f.size, bytes: legivel ? new Uint8Array(await f.arrayBuffer()) : null });
      }
    }
    return prog;
  }

  async function abrirCompactado(libs, bytes, tipo, prefixo, emitir, avisar, nivel, nomeOrig) {
    if (tipo === 'zip') {
      let zip;
      try { zip = await libs.JSZip.loadAsync(bytes, { decodeFileName: decodificarNome }); }
      catch (e) {
        if (libs.SevenZip) return abrir7z(libs, bytes, prefixo, emitir, avisar, nivel, nomeOrig, 'zip');
        throw e;
      }
      for (const n of Object.keys(zip.files)) {
        const z = zip.files[n];
        if (z.dir || IGNORAR.test(n)) continue;
        const x = ext(n), caminho = prefixo + n;
        const tam = (z._data && z._data.uncompressedSize) || 0;
        if (COMPACTADOS.has(x) && nivel < 3) {
          avisar(`Abrindo ${n.split('/').pop()}…`);
          const b = await z.async('uint8array');
          await abrirCompactado(libs, b, x, caminho.replace(/\.(zip|7z|rar)$/i, '') + '/', emitir, avisar, nivel + 1, n);
        } else {
          const legivel = LEGIVEIS.has(x) && tam <= MAX_LEITURA;
          if (legivel) avisar(`Lendo ${n.split('/').pop()}`);
          const b = legivel ? await z.async('uint8array') : null;
          await emitir({ id: novoId(), nome: n.split('/').pop(), caminho, ext: x, tamanho: b ? b.length : tam, bytes: b });
        }
      }
      return;
    }
    return abrir7z(libs, bytes, prefixo, emitir, avisar, nivel, nomeOrig, tipo);
  }

  let fabrica7z = null;
  async function sete(libs) {
    if (!libs.SevenZip) throw new Error('leitor de .7z indisponível nesta versão');
    if (!fabrica7z) {
      const wasm = libs.wasm7z ? libs.wasm7z() : undefined;
      fabrica7z = { wasm };
    }
    // uma instância nova por arquivo: a memória é devolvida ao terminar
    return libs.SevenZip({ wasmBinary: fabrica7z.wasm, print: () => {}, printErr: () => {} });
  }

  async function abrir7z(libs, bytes, prefixo, emitir, avisar, nivel, nomeOrig, tipo) {
    avisar(`Descompactando ${nomeOrig || 'arquivo'} (${MB(bytes.length)})…`);
    const sz = await sete(libs);
    const arq = '/entrada.' + (tipo || '7z');
    sz.FS.writeFile(arq, bytes);
    bytes = null;
    sz.FS.mkdir('/saida');
    try { sz.callMain(['x', arq, '-o/saida', '-y', '-bso0', '-bsp0']); }
    catch (e) { if (!(e && e.status === 0)) throw new Error('não consegui descompactar ' + (nomeOrig || 'o arquivo')); }
    try { sz.FS.unlink(arq); } catch (e) { /* ok */ }
    const visitar = async (dir, rel) => {
      for (const n of sz.FS.readdir(dir)) {
        if (n === '.' || n === '..') continue;
        const p = dir + '/' + n, r = rel ? rel + '/' + n : n;
        const st = sz.FS.stat(p);
        if (sz.FS.isDir(st.mode)) { await visitar(p, r); continue; }
        if (IGNORAR.test(r)) continue;
        const x = ext(n), caminho = prefixo + r;
        if (COMPACTADOS.has(x) && nivel < 3) {
          const b = sz.FS.readFile(p);
          sz.FS.unlink(p);
          await abrirCompactado(libs, b, x, caminho.replace(/\.(zip|7z|rar)$/i, '') + '/', emitir, avisar, nivel + 1, n);
        } else {
          const legivel = LEGIVEIS.has(x) && st.size <= MAX_LEITURA;
          if (legivel) avisar(`Lendo ${n}`);
          const b = legivel ? sz.FS.readFile(p) : null;
          sz.FS.unlink(p);
          await emitir({ id: novoId(), nome: n, caminho, ext: x, tamanho: st.size, bytes: b });
        }
      }
    };
    await visitar('/saida', '');
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

  // ------------------------------------------------------------ Word
  const decodificar = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, '&');

  function textoParagrafo(xml) {
    let s = '';
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
    let m;
    while ((m = re.exec(xml))) s += m[1] != null ? decodificar(m[1]) : m[0] === '<w:tab/>' ? '\t' : ' ';
    return s;
  }

  /** Divide o XML em blocos de primeiro nível (parágrafos e tabelas, respeitando tabelas aninhadas). */
  function blocosCorpo(xml) {
    const out = [];
    const re = /<w:tbl>|<\/w:tbl>|<w:p[ >]|<w:p\/>/g;
    let m, prof = 0, ini = -1, iniP = -1;
    while ((m = re.exec(xml))) {
      if (m[0] === '<w:tbl>') { if (prof === 0) ini = m.index; prof++; }
      else if (m[0] === '</w:tbl>') { prof--; if (prof === 0) { out.push(xml.slice(ini, m.index + 8)); } }
      else if (prof === 0 && m[0] !== '<w:p/>') {
        iniP = m.index;
        const fim = xml.indexOf('</w:p>', iniP);
        if (fim < 0) break;
        out.push(xml.slice(iniP, fim + 6));
        re.lastIndex = fim + 6;
      }
    }
    return out;
  }

  function linhasTabela(tbl) {
    const rows = [];
    // linhas do primeiro nível da tabela
    const corpo = tbl.slice(7, -8);
    const re = /<w:tr[ >]|<\/w:tr>|<w:tbl>|<\/w:tbl>/g;
    let m, prof = 0, ini = -1;
    while ((m = re.exec(corpo))) {
      if (m[0] === '<w:tbl>') prof++;
      else if (m[0] === '</w:tbl>') prof--;
      else if (prof === 0 && m[0] !== '</w:tr>') ini = m.index;
      else if (prof === 0 && m[0] === '</w:tr>' && ini >= 0) {
        const tr = corpo.slice(ini, m.index);
        const cells = (tr.match(/<w:tc>[\s\S]*?<\/w:tc>|<w:tc [\s\S]*?<\/w:tc>/g) || []).map((tc) =>
          (tc.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map(textoParagrafo).map((t) => t.trim()).filter(Boolean).join(' / ').trim());
        rows.push(cells.map((c) => (c === '' ? null : c)));
        ini = -1;
      }
    }
    return rows;
  }

  async function lerDocx(libs, bytes) {
    const zip = await libs.JSZip.loadAsync(bytes);
    const arq = zip.file('word/document.xml');
    if (!arq) throw new Error('Arquivo Word sem conteúdo legível.');
    const xml = await arq.async('string');
    const lines = [], tables = [];
    for (const bloco of blocosCorpo(xml)) {
      if (bloco.startsWith('<w:tbl>')) {
        const rows = linhasTabela(bloco);
        rows.forEach((r) => lines.push({ t: r.map((c) => c || '').join(' | '), p: 1, tab: tables.length }));
        tables.push(rows);
      } else {
        const t = textoParagrafo(bloco).trim();
        if (t) lines.push({ t, p: 1 });
      }
    }
    return { kind: 'text', lines, tables };
  }

  // ------------------------------------------------------------ PDF
  async function lerPdf(libs, bytes) {
    const pdf = await libs.pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false, useSystemFonts: true }).promise;
    const lines = [];
    const paginas = Math.min(pdf.numPages, 80);
    for (let p = 1; p <= paginas; p++) {
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
      pg.cleanup();
    }
    const n = pdf.numPages;
    await pdf.destroy();
    return { kind: 'text', lines, tables: [], paginas: n, paginasLidas: paginas };
  }

  // ------------------------------------------------------------ Excel
  function lerPlanilha(libs, bytes) {
    const wb = libs.XLSX.read(bytes, { type: 'array', cellDates: true, cellNF: false, cellText: false, cellStyles: false, sheetStubs: false });
    const sheets = wb.SheetNames.map((n) => {
      const ws = wb.Sheets[n];
      // planilhas enormes: limita a área lida (5 mil linhas x 60 colunas)
      if (ws['!ref']) {
        const r = libs.XLSX.utils.decode_range(ws['!ref']);
        if (r.e.r - r.s.r > 5000) r.e.r = r.s.r + 5000;
        if (r.e.c - r.s.c > 60) r.e.c = r.s.c + 60;
        ws['!ref'] = libs.XLSX.utils.encode_range(r);
      }
      const rows = libs.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: true });
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

  // ------------------------------------------------------------ E-mail (.eml)
  const latin1 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return s; };
  const paraBytes = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
  function decodCharset(u, cs) {
    try { return new TextDecoder((cs || 'utf-8').toLowerCase().replace(/^(us-)?ascii$/, 'utf-8')).decode(u); } catch (e) { return new TextDecoder('windows-1252').decode(u); }
  }
  function b64bytes(s) {
    s = s.replace(/[^A-Za-z0-9+/=]/g, '');
    try { return paraBytes(atob(s)); } catch (e) { return new Uint8Array(0); }
  }
  function qpBytes(s) {
    s = s.replace(/=\r?\n/g, '');
    const out = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else out.push(s.charCodeAt(i) & 255);
    }
    return Uint8Array.from(out);
  }
  function palavraCodificada(s) {
    return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_, cs, enc, txt) =>
      decodCharset(enc.toUpperCase() === 'B' ? b64bytes(txt) : qpBytes(txt.replace(/_/g, ' ')), cs));
  }
  /** Cabeçalho gravado em UTF-8 "cru" (sem =?utf-8?…?=) lido como latin1: corrige. */
  function utf8Cru(s) {
    if (!/[\u00c0-\u00ff][\u0080-\u00bf]/.test(s)) return s;
    try { return new TextDecoder('utf-8', { fatal: true }).decode(paraBytes(s)); } catch (e) { return s; }
  }
  function cabecalhos(bloco) {
    const h = {};
    bloco.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach((l) => {
      const m = l.match(/^([^:\s]+):\s*(.*)$/);
      if (m) { const k = m[1].toLowerCase(); if (!(k in h)) h[k] = utf8Cru(m[2]); }
    });
    return h;
  }
  function param(v, nome) {
    const re = new RegExp(nome + '\\*?=(?:"([^"]*)"|([^;\\s]*))', 'i');
    const m = String(v || '').match(re);
    if (!m) {
      // RFC 2231 em partes: filename*0*=...
      const partes = [...String(v || '').matchAll(new RegExp(nome + '\\*(\\d+)\\*?=(?:"([^"]*)"|([^;\\s]*))', 'gi'))];
      if (!partes.length) return null;
      return rfc2231(partes.map((p) => p[2] ?? p[3]).join(''));
    }
    const val = m[1] ?? m[2];
    return /\*=/.test(m[0]) ? rfc2231(val) : palavraCodificada(val);
  }
  function rfc2231(v) {
    const m = String(v).match(/^([^']*)'[^']*'(.*)$/);
    if (!m) return v;
    try { return decodCharset(Uint8Array.from(unescape(m[2]).split('').map((c) => c.charCodeAt(0) & 255)), m[1] || 'utf-8'); } catch (e) { return m[2]; }
  }
  function htmlParaTexto(h) {
    return h.replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&');
  }
  function parteMime(raw, acc) {
    const sep = raw.search(/\r?\n\r?\n/);
    const h = cabecalhos(sep < 0 ? raw : raw.slice(0, sep));
    const corpo = sep < 0 ? '' : raw.slice(sep).replace(/^\r?\n\r?\n/, '');
    const ct = h['content-type'] || 'text/plain';
    const tipo = ct.split(';')[0].trim().toLowerCase();
    if (tipo.startsWith('multipart/')) {
      const b = param(ct, 'boundary');
      if (b) corpo.split('--' + b).slice(1).forEach((p) => { if (!p.startsWith('--')) parteMime(p.replace(/^\r?\n/, ''), acc); });
      return h;
    }
    const enc = (h['content-transfer-encoding'] || '').toLowerCase();
    const bytes = enc === 'base64' ? b64bytes(corpo) : enc === 'quoted-printable' ? qpBytes(corpo) : paraBytes(corpo);
    const nome = param(h['content-disposition'], 'filename') || param(ct, 'name');
    const anexo = /attachment/i.test(h['content-disposition'] || '') || (nome && !tipo.startsWith('text/'));
    if (tipo === 'message/rfc822' && !nome) { parteMime(latin1(bytes), acc); return h; }
    if (anexo && nome) acc.anexos.push({ nome, bytes });
    else if (tipo === 'text/plain' && !acc.texto) acc.texto = decodCharset(bytes, param(ct, 'charset'));
    else if (tipo === 'text/html' && !acc.html) acc.html = decodCharset(bytes, param(ct, 'charset'));
    return h;
  }
  function lerEml(bytes) {
    const acc = { texto: '', html: '', anexos: [] };
    const h = parteMime(latin1(bytes), acc);
    const email = {
      assunto: palavraCodificada(h.subject || ''), de: palavraCodificada(h.from || ''), para: palavraCodificada(h.to || ''),
      data: h.date ? new Date(h.date) : null,
    };
    if (email.data && isNaN(email.data)) email.data = null;
    return montarEmail(email, acc.texto || htmlParaTexto(acc.html || ''), acc.anexos);
  }
  function lerMsg(libs, bytes) {
    if (!libs.MsgReader) throw new Error('leitor de .msg indisponível');
    const r = new libs.MsgReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const d = r.getFileData();
    const anexos = (d.attachments || []).map((a) => {
      try { const x = r.getAttachment(a); return { nome: x.fileName, bytes: x.content }; } catch (e) { return null; }
    }).filter((a) => a && a.nome && a.bytes);
    const email = {
      assunto: d.subject || '', de: [d.senderName, d.senderEmail && `<${d.senderEmail}>`].filter(Boolean).join(' '),
      para: (d.recipients || []).map((x) => x.name || x.email).join('; '),
      data: d.messageDeliveryTime ? new Date(d.messageDeliveryTime) : d.clientSubmitTime ? new Date(d.clientSubmitTime) : null,
    };
    if (email.data && isNaN(email.data)) email.data = null;
    return montarEmail(email, d.body || '', anexos);
  }
  function montarEmail(email, corpo, anexos) {
    const dt = email.data ? email.data.toLocaleDateString('pt-BR') : '';
    const linhas = [`Assunto: ${email.assunto}`, `De: ${email.de}`, `Para: ${email.para}`, `Data: ${dt}`]
      .concat(String(corpo).replace(/\r/g, '').split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 400));
    return { conteudo: { kind: 'text', lines: linhas.map((t) => ({ t, p: 1 })), tables: [], email: { ...email, data: dt } }, anexos };
  }

  // ------------------------------------------------------------ extração
  async function extrair(libs, entrada) {
    const e = entrada.ext;
    if (!entrada.bytes) {
      return LEGIVEIS.has(e) ? { conteudo: null, aviso: `Arquivo muito grande (${MB(entrada.tamanho)}): só listado.` } : { conteudo: null };
    }
    try {
      if (['xlsx', 'xlsm', 'xls', 'csv', 'ods'].includes(e)) return { conteudo: lerPlanilha(libs, entrada.bytes) };
      if (e === 'docx' || e === 'docm') return { conteudo: await lerDocx(libs, entrada.bytes) };
      if (e === 'pdf') return { conteudo: await lerPdf(libs, entrada.bytes) };
      if (e === 'txt') return { conteudo: lerTxt(entrada.bytes) };
      if (e === 'eml') return lerEml(entrada.bytes);
      if (e === 'msg') return lerMsg(libs, entrada.bytes);
      return { conteudo: null };
    } catch (err) {
      return { conteudo: null, erro: `Não consegui ler o arquivo (${err && err.message ? err.message : err}).` };
    }
  }

  /**
   * Lê tudo (pasta, zip, 7z, e-mails com anexos) e devolve as entradas já com conteúdo.
   * Os bytes são liberados logo após a leitura, exceto Word (usado como modelo de RH).
   */
  async function lerTudo(libs, arquivos, aoProgresso) {
    const saida = [];
    const processar = async (e) => {
      const r = await extrair(libs, e);
      e.conteudo = r.conteudo || null;
      if (r.erro) e.erro = r.erro;
      if (r.aviso) e.avisoLeitura = r.aviso;
      if (!(e.ext === 'docx' || e.ext === 'docm') || e.tamanho > 15 * 1024 * 1024) e.bytes = null;
      saida.push(e);
      for (const a of r.anexos || []) {
        const x = ext(a.nome);
        const filho = { id: novoId(), nome: a.nome, caminho: e.caminho + '/' + a.nome, ext: x, tamanho: a.bytes.length, bytes: a.bytes, anexoDe: e.id };
        if (COMPACTADOS.has(x)) {
          await abrirCompactado(libs, a.bytes, x, filho.caminho.replace(/\.(zip|7z|rar)$/i, '') + '/', processar, () => {}, 1, a.nome);
        } else {
          if (!LEGIVEIS.has(x)) filho.bytes = null;
          await processar(filho);
        }
      }
      if (aoProgresso && saida.length % 3 === 0) await new Promise((ok) => setTimeout(ok, 0));
    };
    const prog = await percorrer(libs, arquivos, processar, aoProgresso);
    // remove a pasta raiz comum (ex.: "RC-123 Objeto/…") para caminhos mais limpos
    for (let volta = 0; volta < 3; volta++) {
      const partes = saida.filter((e) => !e.anexoDe).map((e) => e.caminho.split('/'));
      if (!(partes.length > 1 && partes.every((p) => p.length > 1 && p[0] === partes[0][0]))) break;
      const raiz = partes[0][0];
      saida.forEach((e) => { e.raiz = raiz; if (e.caminho.startsWith(raiz + '/')) e.caminho = e.caminho.slice(raiz.length + 1); });
    }
    return { entradas: saida, bytesTotais: prog.bytes };
  }

  /** Texto corrido do documento (para a tela de conferência). */
  function textoPlano(conteudo, max = 20000) {
    if (!conteudo) return '';
    if (conteudo.kind === 'text') return conteudo.lines.map((l) => l.t).join('\n').slice(0, max);
    return conteudo.sheets.map((s) => `[${s.name}]\n` + s.rows.filter((r) => r.some((c) => c != null))
      .map((r) => r.map((c) => (c instanceof Date ? c.toLocaleDateString('pt-BR') : c == null ? '' : c)).join('\t')).join('\n')).join('\n\n').slice(0, max);
  }

  return { lerTudo, lerArrasto, extrair, textoPlano, ext, decodificarNome, lerEml, MB, LEGIVEIS };
});
