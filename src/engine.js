/*
 * FLOW Express — motor de regras (sem interface).
 * Classifica documentos, extrai dados, equaliza propostas, calcula notas,
 * negociação, saving e pendências. Funciona no navegador e no Node (testes).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FlowEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- utilidades

  const norm = (s) =>
    String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[º°ª]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();

  const F = (v, fonte) => ({ v: v == null || v === '' ? null : v, fonte: fonte || null });
  const val = (f) => (f && typeof f === 'object' && 'v' in f ? f.v : f);

  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).replace(/R\$|\s| /g, '').replace(/[^\d.,-]/g, '');
    if (!s || !/\d/.test(s)) return null;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) {
      s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lc >= 0) {
      s = /^-?\d{1,3}(,\d{3})+$/.test(s) && s.split(',').pop().length === 3 && (s.match(/,/g) || []).length > 1
        ? s.replace(/,/g, '')
        : s.replace(/\./g, '').replace(',', '.');
    } else if (ld >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      return new Date(Math.round((v - 25569) * 86400000) + new Date().getTimezoneOffset() * 60000);
    }
    const m = String(v).match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (!m) return null;
    let y = +m[3];
    if (y < 100) y += 2000;
    const d = new Date(y, +m[2] - 1, +m[1]);
    return isNaN(d) ? null : d;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const fmtData = (d) => (d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '');
  const fmtBRL = (n) =>
    n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtNum = (n, d = 2) =>
    n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtQtd = (n) =>
    n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const fmtPct = (n, d = 1) => (n == null || !isFinite(n) ? '—' : fmtNum(n * 100, d) + '%');

  function colLetra(c) {
    let s = '';
    c += 1;
    while (c > 0) {
      const m = (c - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  }

  // ------------------------------------------------------------------ rodadas

  function normRodada(s) {
    const t = norm(s);
    if (!t) return null;
    if (/\bBAFO\b|MELHOR (E )?ULTIMA|OFERTA FINAL|PROPOSTA FINAL|\bFINAL\b/.test(t)) return 'BAFO';
    let m = t.match(/(?:^|[^A-Z0-9])R(\d{1,2})(?:[^A-Z0-9]|$)/) || t.match(/RODADA\s*(\d{1,2})/) ||
      t.match(/(\d{1,2})\s*A?\s*RODADA/) || t.match(/^(\d{1,2})A?$/);
    if (m) return 'R' + parseInt(m[1], 10);
    if (/PROPOSTA INICIAL|\bINICIAL\b/.test(t)) return 'R1';
    return null;
  }
  const ordemRodada = (r) => (r === 'BAFO' ? 999 : parseInt(String(r).slice(1), 10) || 0);
  const ordenarRodadas = (rs) => [...new Set(rs.filter(Boolean))].sort((a, b) => ordemRodada(a) - ordemRodada(b));
  const nomeRodada = (r) => (r === 'BAFO' ? 'BAFO' : r ? `${String(r).slice(1)}ª rodada` : '—');

  // ---------------------------------------------------------- tipos de documento

  const TIPOS = {
    RC: 'Requisição de compra (RC)',
    CC: 'Carta-convite',
    PT: 'Proposta técnica',
    PC: 'Proposta comercial',
    AT: 'Parecer / avaliação técnica',
    ATA: 'Ata de negociação',
    HOM: 'Homologação do fornecedor',
    OUTRO: 'Outro anexo do processo',
    IGNORAR: 'Ignorar (não entra no RH)',
  };
  const TIPO_COM_FORNECEDOR = { PT: 1, PC: 1, HOM: 1 };
  const TIPO_COM_RODADA = { PC: 1, ATA: 1 };

  const PREFIXOS = {
    RC: 'RC', REQ: 'RC', CC: 'CC', CONVITE: 'CC', PT: 'PT', PC: 'PC', AT: 'AT', PARECER: 'AT',
    ATA: 'ATA', HOM: 'HOM', HOMOLOGACAO: 'HOM',
  };

  const CONTEUDO_TIPO = [
    [/PLANILHA DE PRECOS PADRAO SAMARCO/, 'PC'],
    [/REQUISICAO DE COMPRA/, 'RC'],
    [/ATA DE (REUNIAO DE )?NEGOCIACAO/, 'ATA'],
    [/PARECER TECNICO|AVALIACAO TECNICA DAS PROPOSTAS|AVALIACAO TECNICA/, 'AT'],
    [/CERTIFICADO DE HOMOLOGACAO|HOMOLOGACAO DE FORNECEDOR|CADASTRO DE FORNECEDOR/, 'HOM'],
    [/PROPOSTA TECNICA/, 'PT'],
    [/PROPOSTA COMERCIAL|PROPOSTA DE PRECOS|COTACAO/, 'PC'],
    [/CARTA[ -]CONVITE/, 'CC'],
  ];

  const NOME_TIPO = [
    [/PROPOSTA TECNICA|PROP TEC|PROPOSTAS TECNICAS/, 'PT'],
    [/PROPOSTA COMERCIAL|PROPOSTAS COMERCIAIS|COTACAO|COTACOES|PLANILHA DE PRECOS/, 'PC'],
    [/\bATAS?\b/, 'ATA'],
    [/HOMOLOG/, 'HOM'],
    [/PARECER|AVALIACAO TECNICA/, 'AT'],
    [/REQUISICAO|\bRC\b/, 'RC'],
    [/CARTA ?CONVITE|\bCONVITE\b/, 'CC'],
  ];

  const nomeSemExt = (n) => String(n).replace(/\.[^.\/]+$/, '');
  const tokensNome = (n) => norm(nomeSemExt(n)).split(/[^A-Z0-9]+/).filter(Boolean);

  function textoInicio(conteudo, max = 800) {
    if (!conteudo) return '';
    if (conteudo.kind === 'sheets') {
      const out = [];
      for (const sh of conteudo.sheets) {
        for (const row of sh.rows.slice(0, 12)) out.push(row.filter((c) => c != null).join(' '));
      }
      return norm(out.join(' ')).slice(0, max);
    }
    if (conteudo.kind === 'text') return norm(conteudo.lines.slice(0, 30).map((l) => l.t).join(' ')).slice(0, max);
    return '';
  }

  /** Classifica um documento pelo nome, conteúdo e pasta. */
  function classificar(doc) {
    const toks = tokensNome(doc.nome);
    const nomeN = toks.join(' ');
    const pastas = norm(String(doc.caminho || '').split('/').slice(0, -1).join(' / '));
    const ini = textoInicio(doc.conteudo);
    let tipo = null, origem = null;

    if (toks.length && PREFIXOS[toks[0]]) { tipo = PREFIXOS[toks[0]]; origem = 'nome do arquivo'; }
    if (!tipo) for (const [re, t] of CONTEUDO_TIPO) if (re.test(ini)) { tipo = t; origem = 'conteúdo'; break; }
    if (!tipo) for (const [re, t] of NOME_TIPO) if (re.test(nomeN)) { tipo = t; origem = 'nome do arquivo'; break; }
    if (!tipo && /^(PDF|DOCX|XLSX|XLS|XLSM|CSV|DOC)$/.test(String(doc.ext).toUpperCase()))
      for (const [re, t] of NOME_TIPO) if (re.test(pastas)) { tipo = t; origem = 'pasta'; break; }

    // rodada
    let rodada = null;
    if (tipo && TIPO_COM_RODADA[tipo]) {
      for (const t of toks) { const r = normRodada(t); if (r) { rodada = r; break; } }
      if (!rodada) rodada = normRodada(nomeN);
      if (!rodada) for (const p of pastas.split(' / ').reverse()) { const r = normRodada(p); if (r) { rodada = r; break; } }
    }

    // pista de fornecedor pelo nome padrão: PC_<FORNECEDOR>_R1, PT_<FORNECEDOR>, HOM_<FORNECEDOR>
    let fornecedorPista = null;
    if (tipo && TIPO_COM_FORNECEDOR[tipo]) {
      const resto = toks.filter((t, i) => !(i === 0 && PREFIXOS[t]) && !normRodada(t) &&
        !/^(PROPOSTA|COMERCIAL|TECNICA|REV\d*|V\d+|FINAL|BAFO|RODADA|HOMOLOGACAO|CERTIFICADO|\d+)$/.test(t));
      if (resto.length) fornecedorPista = resto.join(' ');
    }

    return { tipo, origem, rodada, fornecedorPista };
  }

  // ------------------------------------------------------------ rótulos (chave: valor)

  function normRotulo(s) {
    return norm(s)
      .replace(/\(.*?\)/g, ' ')
      .replace(/[:.]+\s*$/, '')
      .replace(/^(N|NO|NUM|NUMERO)\.?\s+/, '')
      .replace(/\b(DA|DO|DE|DAS|DOS)\b/g, ' ')
      .replace(/[^A-Z0-9\/ ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const ROTULOS = [
    ['rc', /^(RC|RC SAP|REQUISICAO|REQUISICAO COMPRA|PROCESSO|N RC)$/],
    ['objeto', /^(OBJETO|DESCRICAO OBJETO|ESCOPO|OBJETO CONTRATACAO)$/],
    ['requisitante', /^(REQUISITANTE|SOLICITANTE|AREA REQUISITANTE|AREA SOLICITANTE)$/],
    ['centroCusto', /^(CENTRO CUSTO|C CUSTO|CENTRO CUSTOS)$/],
    ['comprador', /^(COMPRADOR|COMPRADOR RESPONSAVEL|COMPRADORA)$/],
    ['valorEstimado', /^(VALOR ESTIMADO|ESTIMATIVA|VALOR REFERENCIA|ORCAMENTO|VALOR ESTIMADO TOTAL|TOTAL ESTIMADO)$/],
    ['dataRC', /^(DATA RC|DATA EMISSAO|DATA REQUISICAO)$/],
    ['fornecedor', /^(FORNECEDOR|RAZAO SOCIAL|PROPONENTE|EMPRESA|LICITANTE)$/],
    ['cnpj', /^CNPJ$/],
    ['rodada', /^RODADA$/],
    ['prazoEntrega', /^(PRAZO ENTREGA|PRAZO|PRAZO EXECUCAO)$/],
    ['condPagamento', /^(CONDICAO PAGAMENTO|COND PAGAMENTO|CONDICOES PAGAMENTO|PAGAMENTO)$/],
    ['validade', /^(VALIDADE PROPOSTA|VALIDADE)$/],
    ['frete', /^(FRETE|INCOTERM|MODALIDADE FRETE)$/],
    ['totalGeral', /^(TOTAL GERAL|VALOR TOTAL PROPOSTA|TOTAL PROPOSTA|VALOR GLOBAL|VALOR TOTAL GERAL)$/],
    ['data', /^(DATA|DATA PROPOSTA|DATA REUNIAO)$/],
    ['status', /^(STATUS|SITUACAO|STATUS HOMOLOGACAO|RESULTADO)$/],
    ['validadeHom', /^(VALIDA ATE|VALIDADE HOMOLOGACAO|VALIDADE CERTIFICADO|VENCIMENTO)$/],
    ['participantes', /^(PARTICIPANTES|PRESENTES)$/],
  ];

  function chaveRotulo(s) {
    const r = normRotulo(s);
    if (!r || r.length > 45) return null;
    for (const [k, re] of ROTULOS) if (re.test(r)) return k;
    return null;
  }

  /** Lê pares "Rótulo | valor" de planilhas. */
  function kvPlanilha(conteudo) {
    const out = {};
    for (const sh of conteudo.sheets) {
      sh.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          const cel = row[c];
          if (typeof cel !== 'string') continue;
          let k = null, v = null, vc = c;
          const m = cel.match(/^([^:]{2,45}):\s*(.+)$/);
          if (m && chaveRotulo(m[1])) { k = chaveRotulo(m[1]); v = m[2].trim(); }
          else if ((k = chaveRotulo(cel))) {
            for (let j = c + 1; j < Math.min(row.length, c + 5); j++) {
              if (row[j] != null && row[j] !== '') { v = row[j]; vc = j; break; }
            }
          }
          if (k && v != null && v !== '' && !(k in out)) out[k] = F(v, `${sh.name}!${colLetra(vc)}${r + 1}`);
        }
      });
    }
    return out;
  }

  /** Lê pares "Rótulo: valor" de texto (PDF/Word). */
  function kvTexto(conteudo, nome) {
    const out = {};
    conteudo.lines.forEach((ln) => {
      const partes = ln.t.split(/\s{2,}|\t|\s\|\s/);
      for (const p of partes) {
        const m = p.match(/^\s*([^:]{2,45}):\s*(.+?)\s*$/);
        if (!m) continue;
        const k = chaveRotulo(m[1]);
        if (k && !(k in out)) out[k] = F(m[2], `${nome} › pág. ${ln.p} · linha "${m[1].trim()}"`);
      }
    });
    return out;
  }

  // ------------------------------------------------------------ tabelas de itens

  const COLUNAS = [
    ['precoEst', /(ESTIMAD|REFERENCIA)/],
    ['total', /^(PRECO |VALOR |VLR )?TOTAL( ITEM)?$|^SUBTOTAL$/],
    ['preco', /(PRECO|VALOR|VLR)( UNIT|UNIT)|UNITARIO|^P UNIT/],
    ['item', /^(ITEM|IT|SEQ|N|#|LINHA)$/],
    ['codigo', /^(CODIGO|COD|COD MATERIAL|CODIGO SAP|COD SAP|CODIGO MATERIAL|MATERIAL SAP|NM)$/],
    ['descricao', /^(DESCRI|ESPECIFICA|MATERIAL\/SERVICO|MATERIAL SERVICO)/],
    ['un', /^(UN|UND|UNID|UNIDADE|UM|U M|UNIDADE MEDIDA)$/],
    ['qtd', /^(QTD|QTDE|QUANT|QUANTIDADE)/],
  ];

  function chaveColuna(s) {
    if (typeof s !== 'string') return null;
    const r = normRotulo(s);
    for (const [k, re] of COLUNAS) if (re.test(r)) return k;
    return null;
  }

  function acharCabecalho(rows) {
    for (let r = 0; r < Math.min(rows.length, 80); r++) {
      const mapa = {};
      rows[r].forEach((cel, c) => {
        const k = chaveColuna(cel);
        if (k && !(k in mapa)) mapa[k] = c;
      });
      const n = Object.keys(mapa).length;
      if (n >= 3 && 'descricao' in mapa && ('qtd' in mapa || 'preco' in mapa || 'total' in mapa)) return { r, mapa };
    }
    return null;
  }

  const vazio = (row) => !row || row.every((c) => c == null || String(c).trim() === '');

  function itensDeLinhas(rows, nomeFonte, fonteLinha) {
    const cab = acharCabecalho(rows);
    if (!cab) return null;
    const { mapa } = cab;
    const itens = [];
    let totalLinha = null, vazias = 0;
    for (let r = cab.r + 1; r < rows.length; r++) {
      const row = rows[r];
      if (vazio(row)) { if (++vazias >= 2 && itens.length) break; continue; }
      vazias = 0;
      const g = (k) => (k in mapa ? row[mapa[k]] : null);
      const textoLinha = norm(row.filter((c) => typeof c === 'string').join(' '));
      if (/\bTOTAL\b/.test(textoLinha)) {
        const desc = norm(g('descricao') || '');
        const semQtd = parseNum(g('qtd')) == null;
        if (/^(TOTAL|VALOR TOTAL|SUBTOTAL)/.test(desc) || (semQtd && (!desc || /^(VALOR )?TOTAL/.test(textoLinha)))) {
          const nums = row.map((c) => (typeof c === 'number' ? c : null)).filter((n) => n != null);
          const numsTxt = nums.length ? nums : row.map(parseNum).filter((n) => n != null);
          if (numsTxt.length) totalLinha = F(numsTxt[numsTxt.length - 1], fonteLinha(r));
          break;
        }
      }
      const descricao = g('descricao');
      const qtd = parseNum(g('qtd'));
      const preco = parseNum(g('preco'));
      const total = parseNum(g('total'));
      if (descricao == null && qtd == null && preco == null) continue;
      if (descricao == null && g('item') == null) continue;
      let item = g('item');
      item = item == null || item === '' ? String(itens.length + 1) : String(parseNum(item) ?? item).trim();
      itens.push({
        item,
        codigo: g('codigo') == null ? '' : String(g('codigo')).trim(),
        descricao: descricao == null ? '' : String(descricao).trim(),
        un: g('un') == null ? '' : String(g('un')).trim().toUpperCase(),
        qtd,
        preco,
        total,
        precoEst: parseNum(g('precoEst')),
        fonte: fonteLinha(r),
      });
    }
    return { itens, totalLinha };
  }

  function itensPlanilha(conteudo) {
    for (const sh of conteudo.sheets) {
      const res = itensDeLinhas(sh.rows, sh.name, (r) => `${sh.name}!linha ${r + 1}`);
      if (res && res.itens.length) return res;
    }
    return { itens: [], totalLinha: null };
  }

  const RE_ITEM_TEXTO =
    /^\s*(\d{1,3})[\s.)-]+(.+?)\s+([A-Za-z]{1,4}[23²³]?)\s+([\d.,]+)\s+(?:R\$\s*)?([\d.,]+)\s+(?:R\$\s*)?([\d.,]+)\s*$/;

  function itensTexto(conteudo, nome) {
    // 1) tabelas do Word
    for (const [i, rows] of (conteudo.tables || []).entries()) {
      const res = itensDeLinhas(rows, nome, (r) => `${nome} › tabela ${i + 1}, linha ${r + 1}`);
      if (res && res.itens.length) return { ...res, confianca: 'alta' };
    }
    // 2) linhas de texto do PDF
    const itens = [];
    let totalLinha = null;
    for (const ln of conteudo.lines) {
      const t = ln.t.replace(/\s+/g, ' ');
      const m = t.match(RE_ITEM_TEXTO);
      if (m) {
        itens.push({
          item: String(parseInt(m[1], 10)),
          codigo: '',
          descricao: m[2].trim(),
          un: m[3].toUpperCase().replace('²', '2').replace('³', '3'),
          qtd: parseNum(m[4]),
          preco: parseNum(m[5]),
          total: parseNum(m[6]),
          precoEst: null,
          fonte: `${nome} › pág. ${ln.p}`,
        });
        continue;
      }
      const tm = norm(t).match(/^(VALOR )?TOTAL( GERAL| DA PROPOSTA)?\b[^0-9]*([\d.,]+)\s*$/);
      if (tm && itens.length && !totalLinha) totalLinha = F(parseNum(tm[3]), `${nome} › pág. ${ln.p}`);
    }
    return { itens, totalLinha, confianca: itens.length ? 'media' : null };
  }

  // ------------------------------------------------------------ fornecedores

  const STOP_FORN = new Set(
    ('LTDA S/A SA EIRELI ME EPP CIA COMPANHIA COMERCIO INDUSTRIA INDUSTRIAL INDUSTRIAIS SERVICOS SERVICO ' +
      'EQUIPAMENTOS MINERACAO BRASIL ENGENHARIA SOLUCOES TECNOLOGIA GRUPO DO DA DE DOS DAS E COM IND').split(' ')
  );
  const palavrasForn = (s) => norm(s).split(/[^A-Z0-9]+/).filter((w) => w.length >= 3 && !STOP_FORN.has(w));

  function acharFornecedor(st, pista, cnpj) {
    const cn = String(cnpj || '').replace(/\D/g, '');
    if (cn.length >= 14) {
      const f = st.fornecedores.find((x) => String(val(x.cnpj) || '').replace(/\D/g, '') === cn);
      if (f) return f;
    }
    const ws = palavrasForn(pista);
    if (!ws.length) return null;
    let melhor = null, pts = 0;
    for (const f of st.fornecedores) {
      const fw = palavrasForn(val(f.nome));
      let p = 0;
      if (fw[0] && fw[0] === ws[0]) p += 3;
      for (const w of ws) if (fw.includes(w)) p += 1;
      if (p > pts) { pts = p; melhor = f; }
    }
    return pts >= 1 ? melhor : null;
  }

  function garantirFornecedor(st, nome, fonte, cnpj, cnpjFonte) {
    let f = acharFornecedor(st, nome, cnpj);
    if (!f) {
      f = {
        id: 'F' + (st.seq.f++),
        nome: F(String(nome).trim(), fonte),
        cnpj: F(cnpj || null, cnpjFonte),
        nt: F(null), statusTecnico: F(null), obsTecnica: F(null),
        homStatus: F(null), homValidade: F(null),
      };
      st.fornecedores.push(f);
    } else {
      // nome completo vence apelido curto
      if (String(nome).trim().length > String(val(f.nome) || '').length && fonte) f.nome = F(String(nome).trim(), fonte);
      if (cnpj && !val(f.cnpj)) f.cnpj = F(cnpj, cnpjFonte);
    }
    return f;
  }

  // ------------------------------------------------------------ estado

  function estadoVazio() {
    return {
      versao: 1,
      criadoEm: new Date().toISOString(),
      processo: {
        rc: F(null), objeto: F(null), requisitante: F(null), centroCusto: F(null), comprador: F(null),
        valorEstimado: F(null), dataRC: F(null),
      },
      itensRC: [],
      fornecedores: [],
      propostas: [],
      atas: [],
      documentos: [],
      config: { pesoTecnico: 30, pesoComercial: 70, faltante: 'maior', tolerancia: 0.5 },
      rh: { justificativa: '', observacoes: '', dataRH: fmtData(new Date()) },
      seq: { f: 1, p: 1 },
    };
  }

  const PRIORIDADE = { RC: 0, PC: 1, AT: 2, HOM: 3, PT: 4, ATA: 5, CC: 6, OUTRO: 7, IGNORAR: 8 };

  /** Aplica todos os documentos (já com conteúdo extraído) a um estado novo. */
  function montarEstado(docs, base) {
    const st = estadoVazio();
    if (base) { st.config = { ...st.config, ...base.config }; st.rh = { ...st.rh, ...base.rh }; }
    for (const d of docs) {
      if (!d.manual) {
        const c = classificar(d);
        d.tipo = c.tipo; d.rodada = c.rodada; d.fornecedorPista = c.fornecedorPista; d.origem = c.origem;
      }
    }
    const ordem = [...docs].sort((a, b) => (PRIORIDADE[a.tipo] ?? 9) - (PRIORIDADE[b.tipo] ?? 9));
    for (const d of ordem) aplicarDocumento(st, d);
    st.documentos = docs.map(resumoDoc);
    return st;
  }

  function resumoDoc(d) {
    return {
      id: d.id, nome: d.nome, caminho: d.caminho, ext: d.ext, tamanho: d.tamanho,
      tipo: d.tipo || null, rodada: d.rodada || null, fornecedorId: d.fornecedorId || null,
      fornecedorPista: d.fornecedorPista || null, fornecedorManual: d.fornecedorManual || null,
      origem: d.origem || null, manual: !!d.manual,
      status: d.status || (d.tipo ? 'ok' : 'pendente'), aviso: d.aviso || null, erro: d.erro || null,
      temTexto: !!(d.conteudo && d.conteudo.kind === 'text' && d.conteudo.lines.length),
      ehPdfImagem: !!(d.conteudo && d.conteudo.kind === 'text' && d.ext === 'pdf' && !d.conteudo.lines.length),
    };
  }

  function aplicarDocumento(st, d) {
    d.aviso = null;
    d.fornecedorId = null;
    if (d.erro) { d.status = 'erro'; return; }
    if (!d.tipo) { d.status = 'pendente'; return; }
    d.status = 'ok';
    const c = d.conteudo;
    const kv = !c ? {} : c.kind === 'sheets' ? kvPlanilha(c) : c.kind === 'text' ? kvTexto(c, d.nome) : {};
    const fonteKV = (f) => (f && f.fonte && c && c.kind === 'sheets' ? `${d.nome} › ${f.fonte}` : f && f.fonte);
    const NUMERICOS = { totalGeral: 1, valorEstimado: 1 };
    const DIAS = { prazoEntrega: 1, condPagamento: 1, validade: 1 };
    const pegar = (k) => {
      if (!kv[k]) return null;
      let v = kv[k].v;
      if (NUMERICOS[k] && typeof v !== 'number') v = parseNum(v) ?? v;
      if (v instanceof Date) v = fmtData(v);
      if (k === 'cnpj') { const m = String(v).match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/); if (m) v = m[0]; }
      if (DIAS[k] && typeof v === 'number') v = `${v} dias`;
      return F(v, fonteKV(kv[k]));
    };

    const vincularFornecedor = (exigeCriar) => {
      let f = null;
      if (d.fornecedorManual) f = garantirFornecedor(st, d.fornecedorManual, `${d.nome} (indicado pelo comprador)`);
      const kf = pegar('fornecedor'), kc = pegar('cnpj');
      if (!f && kf) f = exigeCriar ? garantirFornecedor(st, kf.v, kf.fonte, kc && kc.v, kc && kc.fonte) : acharFornecedor(st, kf.v, kc && kc.v);
      if (!f && d.fornecedorPista) f = exigeCriar ? garantirFornecedor(st, d.fornecedorPista, `${d.nome} (nome do arquivo)`) : acharFornecedor(st, d.fornecedorPista);
      if (f && kc && !val(f.cnpj)) f.cnpj = kc;
      d.fornecedorId = f ? f.id : null;
      return f;
    };

    switch (d.tipo) {
      case 'RC': {
        for (const k of ['rc', 'objeto', 'requisitante', 'centroCusto', 'comprador', 'valorEstimado', 'dataRC']) {
          const v = pegar(k);
          if (v && val(st.processo[k]) == null) st.processo[k] = v;
        }
        if (val(st.processo.rc) == null) {
          const m = d.nome.match(/(\d{6,12})/);
          if (m) st.processo.rc = F(m[1], `${d.nome} (nome do arquivo)`);
        }
        const res = c && c.kind === 'sheets' ? itensPlanilha(c) : c && c.kind === 'text' ? itensTexto(c, d.nome) : { itens: [] };
        if (res.itens.length && !st.itensRC.length) {
          st.itensRC = res.itens.map((it) => ({
            item: it.item, codigo: it.codigo, descricao: it.descricao, un: it.un, qtd: it.qtd,
            precoEst: it.precoEst ?? it.preco, fonte: `${d.nome} › ${it.fonte}`,
          }));
          if (val(st.processo.valorEstimado) == null) {
            const soma = st.itensRC.reduce((s, it) => s + (it.precoEst || 0) * (it.qtd || 0), 0);
            if (soma > 0) st.processo.valorEstimado = F(soma, `${d.nome} (soma dos itens estimados)`);
          }
        }
        if (!res.itens.length) d.aviso = 'RC lida sem tabela de itens — a equalização usará os itens das propostas.';
        break;
      }
      case 'PC': {
        const f = vincularFornecedor(true);
        if (!f) { d.status = 'pendente'; d.aviso = 'Indique de qual fornecedor é esta proposta.'; break; }
        const rod = d.rodada || normRodada(val(pegar('rodada'))) || 'R1';
        d.rodada = rod;
        const res = !c ? { itens: [] } : c.kind === 'sheets' ? itensPlanilha(c) : itensTexto(c, d.nome);
        const conf = c && c.kind === 'sheets' ? 'alta' : res.confianca || null;
        const prop = {
          id: 'P' + (st.seq.p++), fornecedorId: f.id, rodada: rod, docId: d.id, arquivo: d.nome,
          confianca: conf,
          prazoEntrega: pegar('prazoEntrega') || F(null), condPagamento: pegar('condPagamento') || F(null),
          validade: pegar('validade') || F(null), frete: pegar('frete') || F(null),
          data: pegar('data') || F(null),
          totalDeclarado: pegar('totalGeral') || (res.totalLinha ? F(res.totalLinha.v, c && c.kind === 'sheets' ? `${d.nome} › ${res.totalLinha.fonte}` : res.totalLinha.fonte) : F(null)),
          itens: res.itens.map((it) => ({ ...it, fonte: c && c.kind === 'sheets' ? `${d.nome} › ${it.fonte}` : it.fonte })),
          ajuste: { valor: 0, motivo: '' },
        };
        // substitui proposta do mesmo fornecedor/rodada
        st.propostas = st.propostas.filter((p) => !(p.fornecedorId === f.id && p.rodada === rod));
        st.propostas.push(prop);
        if (!res.itens.length) {
          d.status = 'conferir';
          d.aviso = d.ext === 'pdf' && !(c && c.lines && c.lines.length)
            ? 'PDF escaneado (imagem): digite ou cole os itens na Conferência.'
            : 'Não encontrei a tabela de preços: digite ou cole os itens na Conferência.';
        } else if (conf !== 'alta') {
          d.status = 'conferir';
          d.aviso = 'Proposta fora do padrão: itens lidos do texto — confira na Conferência.';
        }
        break;
      }
      case 'AT': {
        const res = c && c.kind === 'sheets' ? lerAvaliacaoTecnica(c, d.nome) : c ? lerAvaliacaoTexto(c, d.nome) : [];
        for (const a of res) {
          const f = acharFornecedor(st, a.fornecedor) || garantirFornecedor(st, a.fornecedor, a.fonte);
          if (a.nota != null) f.nt = F(a.nota, a.fonte);
          if (a.status) f.statusTecnico = F(a.status, a.fonte);
          if (a.obs) f.obsTecnica = F(a.obs, a.fonte);
        }
        if (!res.length) { d.status = 'conferir'; d.aviso = 'Não encontrei as notas técnicas: informe-as na Conferência.'; }
        break;
      }
      case 'HOM': {
        const f = vincularFornecedor(false);
        if (!f) { d.status = 'pendente'; d.aviso = 'Indique de qual fornecedor é esta homologação.'; break; }
        const texto = c ? (c.kind === 'text' ? norm(c.lines.map((l) => l.t).join(' ')) : textoInicio(c, 5000)) : '';
        let status = null;
        const ks = pegar('status');
        const sN = norm(ks ? ks.v : texto);
        if (/NAO HOMOLOGADO|REPROVADO|BLOQUEADO|SUSPENSO|INAPTO/.test(sN)) status = 'Não homologado';
        else if (/VENCID/.test(sN)) status = 'Vencida';
        else if (/HOMOLOGADO|APROVADO|APTO|ATIVO/.test(sN)) status = 'Homologado';
        const kval = pegar('validadeHom') || pegar('validade');
        let validade = kval ? parseDate(kval.v) : null;
        if (!validade) {
          const m = texto.match(/VALID[A-Z ]*?(\d{1,2}\/\d{1,2}\/\d{2,4})/);
          if (m) validade = parseDate(m[1]);
        }
        f.homStatus = F(status, ks ? ks.fonte : `${d.nome} (texto do documento)`);
        f.homValidade = F(validade ? fmtData(validade) : null, kval ? kval.fonte : `${d.nome} (texto do documento)`);
        break;
      }
      case 'PT': {
        const f = vincularFornecedor(false);
        if (!f) { d.status = 'pendente'; d.aviso = 'Indique de qual fornecedor é esta proposta técnica.'; }
        break;
      }
      case 'ATA': {
        const kd = pegar('data');
        const rod = d.rodada || normRodada(val(pegar('rodada')));
        d.rodada = rod;
        st.atas.push({ docId: d.id, arquivo: d.nome, rodada: rod, data: kd || F(null), participantes: pegar('participantes') || F(null) });
        if (!rod) { d.status = 'conferir'; d.aviso = 'Indique a qual rodada esta ata se refere.'; }
        break;
      }
      default:
        break;
    }
  }

  function lerAvaliacaoTecnica(conteudo, nome) {
    const out = [];
    for (const sh of conteudo.sheets) {
      const rows = sh.rows;
      for (let r = 0; r < Math.min(rows.length, 40); r++) {
        const mapa = {};
        rows[r].forEach((cel, c) => {
          const t = normRotulo(cel);
          if (/^(FORNECEDOR|EMPRESA|PROPONENTE|RAZAO SOCIAL)$/.test(t)) mapa.forn = c;
          else if (/NOTA|PONTUACAO|PONTOS|IT$|INDICE TECNICO/.test(t)) mapa.nota ??= c;
          else if (/RESULTADO|STATUS|SITUACAO|PARECER|CONCLUSAO/.test(t)) mapa.status ??= c;
          else if (/OBS|COMENTARIO|RESSALVA/.test(t)) mapa.obs ??= c;
        });
        if (mapa.forn == null || (mapa.nota == null && mapa.status == null)) continue;
        for (let i = r + 1; i < rows.length; i++) {
          const row = rows[i];
          const fn = row[mapa.forn];
          if (fn == null || String(fn).trim() === '') { if (out.length) break; continue; }
          out.push({
            fornecedor: String(fn).trim(),
            nota: mapa.nota != null ? parseNum(row[mapa.nota]) : null,
            status: mapa.status != null ? normStatusTecnico(row[mapa.status]) : null,
            obs: mapa.obs != null && row[mapa.obs] ? String(row[mapa.obs]) : null,
            fonte: `${nome} › ${sh.name}!linha ${i + 1}`,
          });
        }
        return out;
      }
    }
    return out;
  }

  function lerAvaliacaoTexto(conteudo, nome) {
    for (const [i, rows] of (conteudo.tables || []).entries()) {
      const r = lerAvaliacaoTecnica({ sheets: [{ name: `tabela ${i + 1}`, rows }] }, nome);
      if (r.length) return r;
    }
    return [];
  }

  function normStatusTecnico(v) {
    const t = norm(v);
    if (!t) return null;
    if (/REPROVAD|DESCLASSIFICAD|NAO ATENDE|INAPTO/.test(t)) return 'Reprovado';
    if (/RESSALVA/.test(t)) return 'Aprovado com ressalvas';
    if (/APROVAD|ATENDE|APTO|CLASSIFICAD/.test(t)) return 'Aprovado';
    return String(v);
  }

  // ------------------------------------------------------------ equalização

  function chaveDesc(s) { return palavrasDesc(s).join(' '); }
  function palavrasDesc(s) { return norm(s).split(/[^A-Z0-9]+/).filter((w) => w.length >= 2); }
  function similaridade(a, b) {
    const A = new Set(palavrasDesc(a)), B = new Set(palavrasDesc(b));
    if (!A.size || !B.size) return 0;
    let i = 0;
    for (const w of A) if (B.has(w)) i++;
    return i / Math.max(A.size, B.size);
  }

  function itensBase(st) {
    if (st.itensRC.length) return st.itensRC.map((it) => ({ ...it, origem: 'RC' }));
    const mapa = new Map();
    for (const p of [...st.propostas].sort((a, b) => ordemRodada(a.rodada) - ordemRodada(b.rodada))) {
      for (const it of p.itens) {
        const k = String(it.item);
        if (!mapa.has(k)) mapa.set(k, { item: k, codigo: it.codigo, descricao: it.descricao, un: it.un, qtd: it.qtd, precoEst: null, origem: 'propostas' });
      }
    }
    return [...mapa.values()].sort((a, b) => (parseNum(a.item) ?? 0) - (parseNum(b.item) ?? 0));
  }

  function casarItem(base, itens, usados) {
    let c = itens.find((it, i) => !usados.has(i) && String(it.item) === String(base.item) &&
      (!base.descricao || !it.descricao || similaridade(base.descricao, it.descricao) >= 0.25 || (base.codigo && base.codigo === it.codigo)));
    if (!c && base.codigo) c = itens.find((it, i) => !usados.has(i) && it.codigo && it.codigo === base.codigo);
    if (!c && base.descricao) {
      let melhor = null, s = 0;
      itens.forEach((it, i) => {
        if (usados.has(i)) return;
        const x = similaridade(base.descricao, it.descricao);
        if (x > s) { s = x; melhor = it; }
      });
      if (s >= 0.5) c = melhor;
    }
    if (!c) c = itens.find((it, i) => !usados.has(i) && String(it.item) === String(base.item));
    if (c) usados.add(itens.indexOf(c));
    return c || null;
  }

  const UN_EQUIV = { UN: 'UN', UND: 'UN', UNID: 'UN', PC: 'PC', PCA: 'PC', PECA: 'PC', M: 'M', MT: 'M', MTS: 'M', M2: 'M2', 'M²': 'M2', KG: 'KG', SV: 'SV', SERV: 'SV', VB: 'VB', CJ: 'CJ', RL: 'RL' };
  const normUn = (u) => { const t = norm(u).replace(/\./g, ''); return UN_EQUIV[t] || t; };

  function propostaVigente(st, fid, rodadas, idx) {
    for (let i = idx; i >= 0; i--) {
      const p = st.propostas.find((x) => x.fornecedorId === fid && x.rodada === rodadas[i]);
      if (p) return { p, herdada: i !== idx, de: rodadas[i] };
    }
    return null;
  }

  /** Equaliza todas as rodadas e calcula notas, negociação e saving. */
  function equalizar(st) {
    const cfg = st.config;
    const tol = Math.max(0, parseNum(cfg.tolerancia) ?? 0.5);
    const rodadas = ordenarRodadas(st.propostas.map((p) => p.rodada));
    const fids = st.fornecedores.filter((f) => st.propostas.some((p) => p.fornecedorId === f.id)).map((f) => f.id);
    const base = itensBase(st);
    const alertas = [];
    const nomeF = (fid) => val((st.fornecedores.find((f) => f.id === fid) || {}).nome) || fid;
    const porRodada = {};

    rodadas.forEach((rod, idx) => {
      const vig = {};
      for (const fid of fids) vig[fid] = propostaVigente(st, fid, rodadas, idx);
      const ativos = fids.filter((fid) => vig[fid]);
      const linhas = base.map((b) => ({ ...b, cel: {} }));
      const extras = {};
      for (const fid of ativos) {
        const { p } = vig[fid];
        const usados = new Set();
        linhas.forEach((ln) => {
          const it = casarItem(ln, p.itens, usados);
          const cel = { flags: [] };
          ln.cel[fid] = cel;
          if (!it || !((it.preco || 0) > 0 || (it.total || 0) > 0)) { cel.faltante = true; cel.flags.push('faltante'); return; }
          const qtdF = it.qtd ?? ln.qtd;
          let preco = it.preco;
          if (preco == null && it.total != null && qtdF) preco = it.total / qtdF;
          cel.preco = preco;
          cel.qtdF = qtdF;
          cel.unF = it.un;
          cel.totalInf = it.total;
          cel.fonte = it.fonte;
          cel.totalCalc = preco != null && qtdF != null ? preco * qtdF : null;
          if (ln.un && it.un && normUn(ln.un) !== normUn(it.un)) cel.flags.push('unidade');
          if (ln.qtd != null && it.qtd != null && Math.abs(ln.qtd - it.qtd) > 1e-9) cel.flags.push('quantidade');
          if (cel.totalInf != null && cel.totalCalc != null && Math.abs(cel.totalInf - cel.totalCalc) > tol) cel.flags.push('total');
          cel.valor = preco != null && ln.qtd != null ? preco * ln.qtd : cel.totalCalc ?? cel.totalInf;
        });
        extras[fid] = p.itens.filter((_, i) => !usados.has(i));
      }

      // preenchimento de itens faltantes (equalização)
      linhas.forEach((ln) => {
        const precos = ativos.map((f) => ln.cel[f]).filter((c) => !c.faltante && c.preco != null).map((c) => c.preco);
        ln.menor = precos.length ? Math.min(...precos) : null;
        for (const fid of ativos) {
          const cel = ln.cel[fid];
          if (!cel.faltante) continue;
          if (cfg.faltante !== 'nenhum' && precos.length) {
            const ref = cfg.faltante === 'media' ? precos.reduce((a, b) => a + b, 0) / precos.length : Math.max(...precos);
            cel.preco = ref; cel.valor = ref * (ln.qtd || 0); cel.preenchido = true;
          } else cel.valor = 0;
        }
      });

      const totais = {};
      for (const fid of ativos) {
        const { p, herdada, de } = vig[fid];
        const soma = linhas.reduce((s, ln) => s + (ln.cel[fid].valor || 0), 0);
        const somaInf = p.itens.reduce((s, it) => s + (it.total ?? (it.preco != null && it.qtd != null ? it.preco * it.qtd : 0)), 0);
        const ajuste = parseNum(p.ajuste && p.ajuste.valor) || 0;
        const decl = parseNum(val(p.totalDeclarado));
        totais[fid] = {
          propostaId: p.id, herdada, de, somaItens: soma, ajuste, equalizado: soma + ajuste,
          declarado: decl, somaInformada: somaInf,
          faltantes: linhas.filter((ln) => ln.cel[fid].faltante).length,
          divergeDeclarado: decl != null && Math.abs(decl - somaInf) > tol,
          extras: extras[fid],
          condicoes: { prazoEntrega: val(p.prazoEntrega), condPagamento: val(p.condPagamento), validade: val(p.validade), frete: val(p.frete) },
        };
      }
      porRodada[rod] = { rodada: rod, fornecedores: ativos, linhas, totais };
    });

    // alertas (consolidados por fornecedor/rodada — só da proposta original, sem repetir herdadas)
    rodadas.forEach((rod) => {
      const R = porRodada[rod];
      for (const fid of R.fornecedores) {
        const t = R.totais[fid];
        if (t.herdada) continue;
        R.linhas.forEach((ln) => {
          const c = ln.cel[fid];
          const ref = `item ${ln.item}${ln.descricao ? ' (' + resumir(ln.descricao, 55) + ')' : ''}`;
          if (c.faltante) alertas.push({ nivel: 'alto', tipo: 'faltante', fid, rodada: rod, item: ln.item,
            msg: `${nomeF(fid)} não cotou o ${ref}` + (c.preenchido ? ` — equalizado pelo ${cfg.faltante === 'media' ? 'preço médio' : 'maior preço'} dos demais (${fmtBRL(c.preco)}/${ln.un || 'un'}).` : '.') });
          if (c.flags.includes('unidade')) alertas.push({ nivel: 'alto', tipo: 'unidade', fid, rodada: rod, item: ln.item,
            msg: `${nomeF(fid)} cotou o ${ref} em "${c.unF}", mas a RC pede "${ln.un}". Converta o preço na Conferência.` });
          if (c.flags.includes('quantidade')) alertas.push({ nivel: 'medio', tipo: 'quantidade', fid, rodada: rod, item: ln.item,
            msg: `${nomeF(fid)} cotou ${fmtQtd(c.qtdF)} no ${ref}; a RC pede ${fmtQtd(ln.qtd)}. Equalizado pela quantidade da RC.` });
          if (c.flags.includes('total')) alertas.push({ nivel: 'medio', tipo: 'total', fid, rodada: rod, item: ln.item,
            msg: `${nomeF(fid)}: no ${ref} o total informado (${fmtBRL(c.totalInf)}) não bate com qtd × preço (${fmtBRL(c.totalCalc)}). Usado o cálculo.` });
        });
        if (t.divergeDeclarado) alertas.push({ nivel: 'medio', tipo: 'totalGeral', fid, rodada: rod,
          msg: `${nomeF(fid)}: total geral informado (${fmtBRL(t.declarado)}) difere da soma dos itens (${fmtBRL(t.somaInformada)}).` });
        if (t.extras.length) alertas.push({ nivel: 'baixo', tipo: 'extra', fid, rodada: rod,
          msg: `${nomeF(fid)} cotou ${t.extras.length} item(ns) que não estão na RC: ${t.extras.map((e) => e.descricao || e.item).join('; ').slice(0, 120)}.` });
      }
    });

    // negociação
    const ultima = rodadas[rodadas.length - 1];
    const negociacao = {};
    for (const fid of fids) {
      const serie = rodadas.map((r) => {
        const t = porRodada[r].totais[fid];
        return t ? { rodada: r, total: t.equalizado, herdada: t.herdada } : { rodada: r, total: null };
      });
      const validos = serie.filter((s) => s.total != null);
      const inicial = validos.length ? validos[0].total : null;
      const final = validos.length ? validos[validos.length - 1].total : null;
      negociacao[fid] = { serie, inicial, final, saving: inicial != null ? inicial - final : null,
        savingPct: inicial ? (inicial - final) / inicial : null };
    }

    // classificação técnica + comercial (rodada final)
    const pT = Math.max(0, parseNum(cfg.pesoTecnico) ?? 0), pC = Math.max(0, parseNum(cfg.pesoComercial) ?? 0);
    const algumNT = st.fornecedores.some((f) => parseNum(val(f.nt)) != null);
    const usaTec = algumNT && pT > 0;
    const R = ultima ? porRodada[ultima] : null;
    const classificacao = [];
    if (R) {
      const aptos = R.fornecedores.filter((fid) => norm(val(st.fornecedores.find((f) => f.id === fid).statusTecnico)) !== 'REPROVADO');
      const menor = aptos.length ? Math.min(...aptos.map((fid) => R.totais[fid].equalizado).filter((v) => v > 0)) : null;
      for (const fid of R.fornecedores) {
        const f = st.fornecedores.find((x) => x.id === fid);
        const reprovado = norm(val(f.statusTecnico)) === 'REPROVADO';
        const total = R.totais[fid].equalizado;
        const nt = parseNum(val(f.nt));
        const nc = !reprovado && total > 0 && menor ? (100 * menor) / total : null;
        let nf = null;
        if (nc != null) nf = usaTec ? (nt != null ? (pT * nt + pC * nc) / (pT + pC) : null) : nc;
        const motivos = [];
        if (reprovado) motivos.push('reprovado tecnicamente');
        if (usaTec && nt == null && !reprovado) motivos.push('sem nota técnica');
        const hom = situacaoHomologacao(f);
        if (hom.nivel !== 'ok') motivos.push(hom.texto.toLowerCase());
        classificacao.push({ fid, nome: val(f.nome), total, nt, nc, nf, reprovado, motivos, hom });
      }
      classificacao.sort((a, b) => (b.nf ?? -1) - (a.nf ?? -1) || a.total - b.total);
      let pos = 1;
      for (const c of classificacao) c.posicao = c.nf != null ? pos++ : null;
    }
    const venc = classificacao.find((c) => c.posicao === 1) || null;
    const vencedor = venc ? { ...venc, negociacao: negociacao[venc.fid] } : null;
    const estimado = parseNum(val(st.processo.valorEstimado));
    const resumo = {
      rodadas, ultima, usaTec, pT, pC,
      savingNegociacao: vencedor ? negociacao[vencedor.fid].saving : null,
      savingNegociacaoPct: vencedor ? negociacao[vencedor.fid].savingPct : null,
      savingEstimado: vencedor && estimado ? estimado - vencedor.total : null,
      savingEstimadoPct: vencedor && estimado ? (estimado - vencedor.total) / estimado : null,
      menorInicial: (() => {
        const v = fids.map((f) => negociacao[f].inicial).filter((x) => x != null);
        return v.length ? Math.min(...v) : null;
      })(),
    };

    return { rodadas, porRodada, base, fids, alertas, negociacao, classificacao, vencedor, resumo };
  }

  function resumir(s, n) {
    s = String(s || '');
    if (s.length <= n) return s;
    const c = s.slice(0, n);
    return c.slice(0, Math.max(c.lastIndexOf(' '), n * 0.6)).replace(/[\s,;-]+$/, '') + '…';
  }

  function situacaoHomologacao(f, hoje = new Date()) {
    const st = val(f.homStatus), vd = parseDate(val(f.homValidade));
    if (!st && !vd) return { nivel: 'falta', texto: 'Homologação não encontrada' };
    if (st === 'Não homologado') return { nivel: 'ruim', texto: 'Não homologado' };
    if (st === 'Vencida' || (vd && vd < new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())))
      return { nivel: 'ruim', texto: `Homologação vencida${vd ? ' em ' + fmtData(vd) : ''}` };
    return { nivel: 'ok', texto: `Homologado${vd ? ' até ' + fmtData(vd) : ''}` };
  }

  // ------------------------------------------------------------ pendências (o que falta anexar)

  function pendencias(st, eq) {
    const docs = st.documentos;
    const tem = (fn) => docs.some((d) => d.tipo && d.tipo !== 'IGNORAR' && fn(d));
    const out = [];
    const add = (grupo, desc, ok, obrig = true, dica = '') => out.push({ grupo, desc, ok, obrig, dica });
    add('Processo', 'Requisição de compra (RC)', tem((d) => d.tipo === 'RC'));
    add('Processo', 'Carta-convite', tem((d) => d.tipo === 'CC'), false);
    add('Processo', 'Parecer / avaliação técnica', tem((d) => d.tipo === 'AT'));
    for (const f of st.fornecedores) {
      if (!st.propostas.some((p) => p.fornecedorId === f.id)) continue;
      const n = val(f.nome);
      add(n, 'Proposta técnica', tem((d) => d.tipo === 'PT' && d.fornecedorId === f.id));
      add(n, 'Proposta comercial inicial', st.propostas.some((p) => p.fornecedorId === f.id));
      const hom = situacaoHomologacao(f);
      add(n, 'Homologação válida', hom.nivel === 'ok', true, hom.nivel === 'ok' ? '' : hom.texto);
      if (val(f.nt) == null && eq.resumo.usaTec) add(n, 'Nota técnica', false, true, 'Informe a nota na Conferência.');
    }
    for (const r of eq.rodadas.slice(1)) {
      add('Negociação', `Ata de negociação — ${nomeRodada(r)}`, st.atas.some((a) => a.rodada === r));
    }
    for (const [k, rot] of [['rc', 'Número da RC'], ['objeto', 'Objeto'], ['requisitante', 'Requisitante'], ['valorEstimado', 'Valor estimado']]) {
      if (val(st.processo[k]) == null) add('Dados do RH', rot, false, true, 'Preencha na Conferência.');
    }
    if (!String(st.rh.justificativa || '').trim())
      add('Dados do RH', eq.vencedor ? 'Revisar a justificativa sugerida' : 'Justificativa da recomendação', false, !eq.vencedor,
        eq.vencedor ? 'o RH usa o texto automático' : 'Preencha na etapa RH.');
    const pend = docs.filter((d) => d.status === 'pendente').length;
    if (pend) add('Documentos', `${pend} documento(s) sem classificação`, false, true, 'Indique o tipo na etapa Documentos.');
    const altos = eq.alertas.filter((a) => a.nivel === 'alto' && a.rodada === eq.resumo.ultima).length;
    if (altos) add('Equalização', `${altos} alerta(s) importante(s) na rodada final`, false, false, 'Revise na etapa Equalização.');
    return out;
  }

  // ------------------------------------------------------------ texto do RH

  function extenso(valor) {
    if (valor == null || !isFinite(valor)) return '';
    const U = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
    const D = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
    const C = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
    const ate999 = (n) => {
      if (n === 0) return '';
      if (n === 100) return 'cem';
      const c = Math.floor(n / 100), r = n % 100, p = [];
      if (c) p.push(C[c]);
      if (r) p.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? ' e ' + U[r % 10] : ''));
      return p.join(' e ');
    };
    const grupos = [['', ''], ['mil', 'mil'], ['milhão', 'milhões'], ['bilhão', 'bilhões']];
    const porExtenso = (n) => {
      if (n === 0) return 'zero';
      const partes = [];
      let i = 0;
      while (n > 0) {
        const g = n % 1000;
        if (g) {
          let t = i === 1 && g === 1 ? 'mil' : ate999(g) + (i ? ' ' + (g === 1 ? grupos[i][0] : grupos[i][1]) : '');
          partes.unshift({ t, g });
        }
        n = Math.floor(n / 1000); i++;
      }
      return partes.map((p, k) => (k > 0 && k === partes.length - 1 && (p.g < 100 || p.g % 100 === 0) ? 'e ' : '') + p.t).join(' ').replace(/ +/g, ' ');
    };
    const inteiro = Math.floor(Math.round(valor * 100) / 100);
    const cent = Math.round((valor - inteiro) * 100);
    let s = '';
    if (inteiro) s += porExtenso(inteiro) + (inteiro === 1 ? ' real' : (inteiro % 1000000 === 0 ? ' de reais' : ' reais'));
    if (cent) s += (s ? ' e ' : '') + porExtenso(cent) + (cent === 1 ? ' centavo' : ' centavos');
    return s || 'zero reais';
  }

  function justificativaSugerida(st, eq) {
    const v = eq.vencedor;
    if (!v) return '';
    const r = eq.resumo;
    const partes = [];
    partes.push(`Recomendamos a contratação de ${v.nome}, 1º colocado na classificação final` +
      (r.usaTec ? ` (nota final ${fmtNum(v.nf, 2)}, com pesos ${r.pT}% técnico e ${r.pC}% comercial)` : ' (menor preço equalizado)') +
      `, pelo valor global equalizado de ${fmtBRL(v.total)} (${extenso(v.total)}).`);
    if (eq.rodadas.length > 1 && r.savingNegociacao != null)
      partes.push(`Após ${eq.rodadas.length - 1} rodada(s) de negociação, obteve-se redução de ${fmtBRL(r.savingNegociacao)} (${fmtPct(r.savingNegociacaoPct)}) sobre a proposta inicial do fornecedor.`);
    if (r.savingEstimado != null)
      partes.push(r.savingEstimado >= 0
        ? `O valor final está ${fmtPct(r.savingEstimadoPct)} abaixo do valor estimado na RC (${fmtBRL(val(st.processo.valorEstimado))}).`
        : `O valor final está ${fmtPct(-r.savingEstimadoPct)} acima do valor estimado na RC (${fmtBRL(val(st.processo.valorEstimado))}).`);
    if (v.hom && v.hom.nivel !== 'ok') partes.push(`Atenção: ${v.hom.texto.toLowerCase()} — regularizar antes da emissão do pedido.`);
    return partes.join(' ');
  }

  /** Dados prontos para os dois modelos de RH (Word Samarco e PDF FLOW). */
  function dadosRH(st, eq) {
    const p = st.processo;
    const r = eq.resumo;
    const v = eq.vencedor;
    const R = r.ultima ? eq.porRodada[r.ultima] : null;
    const nomeF = (fid) => val((st.fornecedores.find((f) => f.id === fid) || {}).nome);
    const fornecedores = eq.classificacao.map((c) => {
      const f = st.fornecedores.find((x) => x.id === c.fid);
      const ng = eq.negociacao[c.fid];
      const cond = R.totais[c.fid].condicoes;
      return {
        posicao: c.posicao ? `${c.posicao}º` : 'Desclass.', nome: c.nome, cnpj: val(f.cnpj) || '',
        homologacao: c.hom.texto, statusTecnico: val(f.statusTecnico) || '—',
        notaTecnica: c.nt != null ? fmtNum(c.nt, 2) : '—', notaComercial: c.nc != null ? fmtNum(c.nc, 2) : '—',
        notaFinal: c.nf != null ? fmtNum(c.nf, 2) : '—',
        valorInicial: fmtBRL(ng.inicial), valorFinal: fmtBRL(ng.final), saving: fmtBRL(ng.saving), savingPct: fmtPct(ng.savingPct),
        prazoEntrega: cond.prazoEntrega != null ? String(cond.prazoEntrega) : '—',
        condPagamento: cond.condPagamento != null ? String(cond.condPagamento) : '—',
        frete: cond.frete != null ? String(cond.frete) : '—', validade: cond.validade != null ? String(cond.validade) : '—',
        observacao: c.motivos.join('; '),
      };
    });
    const rodadas = eq.rodadas.map((rod) => ({
      rodada: nomeRodada(rod),
      valores: eq.fids.map((fid) => {
        const t = eq.porRodada[rod].totais[fid];
        return { fornecedor: nomeF(fid), valor: t ? fmtBRL(t.equalizado) + (t.herdada ? ' (mantida)' : '') : '—' };
      }),
      ata: (st.atas.find((a) => a.rodada === rod) || {}).arquivo || '',
    }));
    const itensVencedor = v && R ? R.linhas.map((ln) => {
      const c = ln.cel[v.fid];
      return { item: ln.item, codigo: ln.codigo || '', descricao: ln.descricao, un: ln.un, qtd: fmtQtd(ln.qtd),
        precoUnit: fmtBRL(c.preco), total: fmtBRL(c.valor), obs: c.preenchido ? 'equalizado' : c.flags.length ? c.flags.join(', ') : '' };
    }) : [];
    const anexos = st.documentos.filter((d) => d.tipo && d.tipo !== 'IGNORAR').map((d) => ({
      nome: d.nome, tipo: TIPOS[d.tipo] + (d.fornecedorId ? ' — ' + nomeF(d.fornecedorId) : '') + (d.rodada && TIPO_COM_RODADA[d.tipo] ? ' — ' + nomeRodada(d.rodada) : ''),
    }));
    const pend = pendencias(st, eq).filter((x) => !x.ok).map((x) => ({ grupo: x.grupo, desc: x.desc, dica: x.dica || '' }));
    return {
      rc: val(p.rc) || '', objeto: val(p.objeto) || '', requisitante: val(p.requisitante) || '',
      centroCusto: val(p.centroCusto) || '', comprador: val(p.comprador) || '',
      dataRC: p.dataRC && val(p.dataRC) ? (parseDate(val(p.dataRC)) ? fmtData(parseDate(val(p.dataRC))) : String(val(p.dataRC))) : '',
      dataRH: st.rh.dataRH || fmtData(new Date()),
      valorEstimado: fmtBRL(parseNum(val(p.valorEstimado))),
      qtdFornecedores: String(eq.fids.length), qtdRodadas: String(eq.rodadas.length),
      rodadaFinal: nomeRodada(r.ultima),
      pesoTecnico: String(r.usaTec ? r.pT : 0), pesoComercial: String(r.usaTec ? r.pC : 100),
      criterio: r.usaTec ? `Técnica e preço (${r.pT}% técnico / ${r.pC}% comercial)` : 'Menor preço equalizado',
      fornecedores, rodadas, itensVencedor, anexos, pendencias: pend, temPendencias: pend.length > 0,
      vencedor: v ? v.nome : '', vencedorCnpj: v ? val(st.fornecedores.find((f) => f.id === v.fid).cnpj) || '' : '',
      valorFinal: v ? fmtBRL(v.total) : '', valorFinalExtenso: v ? extenso(v.total) : '',
      valorInicialVencedor: v ? fmtBRL(v.negociacao.inicial) : '',
      savingNegociacao: fmtBRL(r.savingNegociacao), savingNegociacaoPct: fmtPct(r.savingNegociacaoPct),
      savingEstimado: fmtBRL(r.savingEstimado), savingEstimadoPct: fmtPct(r.savingEstimadoPct),
      prazoEntregaVencedor: v ? (R.totais[v.fid].condicoes.prazoEntrega ?? '—') + '' : '',
      condPagamentoVencedor: v ? (R.totais[v.fid].condicoes.condPagamento ?? '—') + '' : '',
      justificativa: st.rh.justificativa || justificativaSugerida(st, eq),
      observacoes: st.rh.observacoes || '',
      alertas: eq.alertas.filter((a) => a.rodada === r.ultima).map((a) => ({ msg: a.msg })),
    };
  }

  return {
    norm, F, val, parseNum, parseDate, fmtData, fmtBRL, fmtNum, fmtQtd, fmtPct, colLetra,
    normRodada, ordemRodada, ordenarRodadas, nomeRodada, TIPOS, TIPO_COM_FORNECEDOR, TIPO_COM_RODADA,
    classificar, kvPlanilha, kvTexto, itensPlanilha, itensTexto, acharCabecalho, itensDeLinhas,
    estadoVazio, montarEstado, aplicarDocumento, resumoDoc, acharFornecedor, garantirFornecedor,
    equalizar, situacaoHomologacao, pendencias, extenso, justificativaSugerida, dadosRH, normUn,
  };
});
