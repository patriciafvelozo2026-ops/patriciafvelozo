/*
 * FLOW Express — motor de regras (sem interface).
 * Classifica os documentos da pasta do processo (padrão de pastas Samarco),
 * extrai os dados, equaliza as propostas por rodada, calcula a ponderação
 * técnica/comercial (fórmula da SMIN-IT-GSU-004), o custo evitado, o histórico
 * de aditivos e as pendências. Funciona no navegador e no Node (testes).
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
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[º°ª]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();

  const F = (v, fonte) => ({ v: v == null || v === '' ? null : v, fonte: fonte || null });
  const val = (f) => (f && typeof f === 'object' && 'v' in f ? f.v : f);

  function parseNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    let s = String(v).replace(/R\$|AUD|USD|US\$|EUR|€|\s|\u00a0/g, '').replace(/[^\d.,-]/g, '');
    if (!s || !/\d/.test(s)) return null;
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) {
      s = lc > ld ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lc >= 0) {
      s = /^-?\d{1,3}(,\d{3}){2,}$/.test(s) ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
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
  let MOEDA = 'BRL';
  const fmtBRL = (n, moeda) => {
    if (n == null || !isFinite(n)) return '—';
    const m = moeda || MOEDA;
    if (m === 'BRL') return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    return m + ' ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const fmtNum = (n, d = 2) =>
    n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtQtd = (n) =>
    n == null || !isFinite(n) ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  const fmtPct = (n, d = 2) => (n == null || !isFinite(n) ? '—' : fmtNum(n * 100, d) + '%');
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

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

  /** Meses entre duas datas (arredondado, como nos RH: início 01/01/2025 → término 31/12/2026 = 24). */
  function mesesEntre(a, b) {
    a = parseDate(a); b = parseDate(b);
    if (!a || !b) return null;
    let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() - a.getDate() > 15) m += 1;
    else if (b.getDate() - a.getDate() < -15) m -= 1;
    return m;
  }

  // ------------------------------------------------------------------ rodadas
  // R1 = proposta inicial; R2 = 1ª rodada; R3 = 2ª rodada…; BAFO = proposta final.

  function normRodada(s) {
    const t = norm(s);
    if (!t) return null;
    if (/\bBAFO\b|MELHOR (E )?ULTIMA|OFERTA FINAL|PROPOSTA FINAL|RODADA FINAL|\bFINAL\b/.test(t)) return 'BAFO';
    let m = t.match(/REV(?:ISAO)?\s*\.?\s*0*(\d{1,2})\b/);
    if (m) return 'R' + (parseInt(m[1], 10) + 1);
    m = t.match(/(?:^|[^A-Z0-9])R(\d{1,2})(?:[^A-Z0-9]|$)/);
    if (m) return 'R' + parseInt(m[1], 10);
    m = t.match(/(\d{1,2})\s*A?\s*RODADA/) || t.match(/RODADA\s*(\d{1,2})/);
    if (m) return 'R' + (parseInt(m[1], 10) + 1);
    if (/PROPOSTA INICIAL|\bINICIAL\b|ORIGINAL/.test(t)) return 'R1';
    return null;
  }
  const ordemRodada = (r) => (r === 'BAFO' ? 999 : parseInt(String(r).slice(1), 10) || 0);
  const ordenarRodadas = (rs) => [...new Set(rs.filter(Boolean))].sort((a, b) => ordemRodada(a) - ordemRodada(b));
  const nomeRodada = (r) => (r === 'BAFO' ? 'Proposta final' : r === 'R1' ? 'Proposta inicial' : r ? `${ordemRodada(r) - 1}ª rodada` : '—');

  // ---------------------------------------------------------- tipos de documento

  const TIPOS = {
    RC: 'Requisição de compra (RC)',
    PQ: 'Planilha de quantidades da RC',
    JUST: 'Justificativa / de acordo da área',
    VL: 'Vendor list',
    TAB: 'Tabelas do RH (SMIN-IT-GSU-004)',
    CC: 'Carta-convite',
    COM: 'E-mail / comunicado do processo',
    QT: 'Qualificação técnica',
    QS: 'Qualificação de segurança (SST)',
    QF: 'Qualificação financeira',
    QC: 'Análise de compliance',
    PT: 'Proposta técnica',
    PC: 'Proposta comercial',
    AT: 'Parecer técnico com notas',
    ATA: 'Ata / registro de negociação',
    HOM: 'Homologação / cadastro do fornecedor',
    TAC: 'Termo aditivo',
    CTR: 'Contrato / minuta / pedido',
    RHM: 'Formulário de RH em branco',
    RHA: 'RH anterior / do processo',
    OUTRO: 'Outro anexo do processo',
    IGNORAR: 'Ignorar (não entra no RH)',
  };
  const TIPO_COM_FORNECEDOR = { PT: 1, PC: 1, HOM: 1 };
  const TIPO_COM_RODADA = { PC: 1, ATA: 1 };
  const EXT_DOC = /^(PDF|DOCX|DOCM|DOC|XLSX|XLSM|XLS|CSV|EML|MSG|TXT)$/;

  const PREFIXOS = {
    RC: 'RC', REQ: 'RC', CC: 'CC', CONVITE: 'CC', PT: 'PT', PC: 'PC', AT: 'AT', PARECER: 'AT',
    ATA: 'ATA', HOM: 'HOM', HOMOLOGACAO: 'HOM', VL: 'VL', PQ: 'PQ', TAC: 'TAC',
  };

  const NOME_FORTE = [
    [/SMIN IT GSU 004|TABELAS MODELO/, 'TAB'],
    [/SMIN FO GSU 0(02|04|59)\b/, 'RHM'],
    [/\bMINUTA\b/, 'CTR'],
    [/JUSTIFICATIVA/, 'JUST'],
  ];

  const CONTEUDO_TIPO = [
    [/REQUISICAO (DE )?COMPRA:? ?4[12]\d{8}|NOTA CABECALHO:? ?4[12]\d{8}/, 'RC'],
    [/RELATORIO DE HOMOLOGACAO DE (CONTRATACAO|AQUISICAO|ALTERACAO)/, 'RH'],
    [/TERMO ADITIVO AO CONTRATO/, 'TAC'],
    [/PLANILHA DE PRECOS PADRAO SAMARCO/, 'PC'],
    [/REQUISICAO DE COMPRA/, 'RC'],
    [/ATA DE (REUNIAO DE )?NEGOCIACAO/, 'ATA'],
    [/PARECER TECNICO|AVALIACAO TECNICA DAS PROPOSTAS/, 'AT'],
    [/CERTIFICADO DE HOMOLOGACAO|HOMOLOGACAO DE FORNECEDOR|CADASTRO DE FORNECEDOR/, 'HOM'],
    [/PROPOSTA TECNICA/, 'PT'],
    [/PROPOSTA COMERCIAL|PROPOSTA DE PRECOS|COTACAO|^PROPOSTA #?\d/, 'PC'],
    [/CARTA[ -]CONVITE/, 'CC'],
    [/^.{0,150}(PEDIDO DE COMPRA|ORDEM DE COMPRA|PURCHASE ORDER)/, 'CTR'],
  ];

  const NOME_TIPO = [
    [/SMIN IT GSU 004|TABELAS MODELO/, 'TAB'],
    [/SMIN FO GSU 0(02|04|59)|RELATORIO DE HOMOLOGACAO/, 'RHM'],
    [/^RH\b/, 'RHA'],
    [/\bTAC\b|TERMO ADITIVO/, 'TAC'],
    [/JUSTIFICATIVA|DE ACORDO/, 'JUST'],
    [/VENDOR ?LIST/, 'VL'],
    [/PROPOSTA TECNICA|PROP TEC|PROPOSTAS TECNICAS/, 'PT'],
    [/PROPOSTA COMERCIAL|PROPOSTAS COMERCIAIS|COTACAO|COTACOES|PLANILHA DE PRECOS/, 'PC'],
    [/\bATAS?\b/, 'ATA'],
    [/HOMOLOG/, 'HOM'],
    [/PARECER|AVALIACAO TECNICA/, 'AT'],
    [/REQUISICAO|\bRC\b/, 'RC'],
    [/CARTA ?CONVITE|\bCONVITE\b/, 'CC'],
  ];

  /** Tipo pela pasta, no padrão Samarco (1 - Requisição … 8 - Contrato). */
  function tipoPelaPasta(pastas, ext, nomeN) {
    const E = String(ext).toUpperCase();
    for (const p of [...pastas].reverse()) {
      if (/^4\.1\b|ANALISE TECNICA/.test(p)) return 'QT';
      if (/^4\.2\b|SEGURANCA|\bSST\b|SAUDE/.test(p)) return 'QS';
      if (/^4\.[34]\b|FINANCEIRA|SERASA/.test(p)) return 'QF';
      if (/^4\.5\b|COMPLIANCE/.test(p)) return 'QC';
      if (/^3\.1\b|CARTA CONVITE/.test(p)) return E === 'EML' || E === 'MSG' || E === 'PDF' || E === 'DOCX' ? 'CC' : 'OUTRO';
      if (/^3\.\d\b|COMUNICADO/.test(p)) return 'COM';
      if (/^2\.1\b|VENDOR LIST/.test(p)) return /^XLS/.test(E) ? 'TAB' : 'VL';
      if (/^7\.1\b|EQUALIZACAO/.test(p)) return /^XLS/.test(E) ? 'TAB' : 'COM';
      if (/^7\.4\b|RELATORIO DE HOMOLOGACAO/.test(p)) return /^DOC/.test(E) ? (/^RH\b/.test(nomeN) ? 'RHA' : 'RHM') : 'OUTRO';
    }
    for (const p of [...pastas].reverse()) {
      if (/^1\b|REQUISICAO/.test(p)) return /^XLS/.test(E) ? 'PQ' : E === 'EML' || E === 'MSG' || /JUSTIFICATIVA|ACORDO/.test(nomeN) ? 'JUST' : /^RC/.test(nomeN) ? 'RC' : 'OUTRO';
      if (/^2\b|ESTRATEGIA/.test(p)) return /^XLS/.test(E) ? 'TAB' : 'OUTRO';
      if (/^3\b|SOLICITACAO DE PROPOSTA/.test(p)) return 'COM';
      if (/^4\b|QUALIFICACAO/.test(p)) return 'QT';
      if (/^5\b|PROPOSTA TECNICA/.test(p)) return E === 'EML' || E === 'MSG' ? 'COM' : 'PT';
      if (/^6\b|PROPOSTA COMERCIAL/.test(p)) return E === 'EML' || E === 'MSG' ? 'COM' : 'PC';
      if (/ADITIVO/.test(p)) return /^XLS/.test(E) ? 'TAB' : /^DOC/.test(E) ? (/^RH\b/.test(nomeN) ? 'RHA' : 'RHM') : E === 'EML' || E === 'MSG' ? 'COM' : 'OUTRO';
      if (/^7\b|ANALISE COMERCIAL/.test(p)) return /^XLS/.test(E) ? 'TAB' : 'COM';
      if (/^8\b|CONTRATO/.test(p)) return /^DOC/.test(E) && /SMIN FO GSU/.test(nomeN) ? 'RHM' : 'CTR';
    }
    return null;
  }

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
    const pastas = String(doc.caminho || '').split('/').slice(0, -1).map(norm).filter(Boolean);
    const ini = textoInicio(doc.conteudo);
    const ocr = !!(doc.conteudo && doc.conteudo.ocr);
    const E = ocr ? 'PDF' : String(doc.ext || '').toUpperCase();
    const ehEmail = !!(doc.conteudo && doc.conteudo.email);
    let tipo = null, origem = null;

    if (doc.anexoDe && /^(PNG|JPG|JPEG|GIF|BMP|EMF|WMF|WEBP)$/i.test(doc.ext) && ini.length < 60) return { tipo: 'IGNORAR', origem: 'imagem de e-mail', rodada: null, fornecedorPista: null };
    if (toks.length && PREFIXOS[toks[0]] && !ehEmail) { tipo = PREFIXOS[toks[0]]; origem = 'nome do arquivo'; }
    if (!tipo && !ehEmail) for (const [re, t] of NOME_FORTE) if (re.test(nomeN)) { tipo = t; origem = 'nome do arquivo'; break; }
    if (!tipo && /^DOC/.test(E) && /^RH\b/.test(nomeN)) { tipo = 'RHA'; origem = 'nome do arquivo'; }
    if (!tipo && EXT_DOC.test(E) && !ehEmail) {
      for (const [re, t] of CONTEUDO_TIPO) if (re.test(ini)) {
        // em print/foto, "proposta" no meio do texto (ex.: anexos citados num contrato) não basta
        if (ocr && /^(PC|PT|CC)$/.test(t) && !re.test(ini.slice(0, 200))) continue;
        tipo = t === 'RH' ? (/XXXXXX/.test(ini) || /SMIN FO GSU/.test(nomeN) ? 'RHM' : 'RHA') : t;
        origem = 'conteúdo';
        break;
      }
    }
    // print colado num e-mail: só vale o que a própria imagem diz logo no início (ou uma tela de RC do SAP)
    if (ocr && doc.anexoDe && tipo && !(tipo === 'RC' && /4[12]\d{8}/.test(ini))) {
      const re = (CONTEUDO_TIPO.find(([, t]) => t === tipo || (t === 'RH' && /^RH[MA]$/.test(tipo))) || [])[0];
      if (!re || !re.test(ini.slice(0, 300))) tipo = null;
    }
    if (ocr && doc.anexoDe && !tipo) return { tipo: 'OUTRO', origem: 'imagem de e-mail', rodada: null, fornecedorPista: null };
    if (ehEmail && /DE ACORDO|JUSTIFICATIVA|APROVAC/.test(nomeN)) { tipo = 'JUST'; origem = 'nome do e-mail'; }
    if (!tipo && EXT_DOC.test(E) && !ehEmail) for (const [re, t] of NOME_TIPO) if (re.test(nomeN)) {
      if (t === 'RHA' && !/^DOC/.test(E)) continue;
      if ((t === 'RHM' || t === 'TAB') && ehEmail) continue;
      tipo = t; origem = 'nome do arquivo'; break;
    }
    if (!tipo || (ehEmail && (tipo === 'JUST' || tipo === 'TAC'))) {
      const tp = tipoPelaPasta(pastas, E, nomeN);
      if (tp && (!tipo || EXT_DOC.test(E))) { tipo = tp; origem = 'pasta'; }
    }
    if (!tipo && ehEmail) { tipo = 'COM'; origem = 'e-mail'; }
    // planilha de preços em branco enviada com a carta-convite não é proposta
    if (tipo === 'PC' && pastas.some((p) => /^3(\.\d)?\b|SOLICITACAO DE PROPOSTA|CARTA CONVITE/.test(p))) { tipo = 'CC'; origem = 'pasta'; }
    if (tipo === 'TAC' && ehEmail) tipo = 'COM';

    // rodada
    let rodada = null;
    if (tipo && TIPO_COM_RODADA[tipo]) {
      for (const t of toks) { const r = normRodada(t); if (r) { rodada = r; break; } }
      if (!rodada) rodada = normRodada(nomeN);
      if (!rodada) for (const p of [...pastas].reverse()) { const r = normRodada(p.replace(/^\d+(\.\d+)*\s*-?\s*/, '')); if (r) { rodada = r; break; } }
    }

    // pista de fornecedor pelo nome padrão: PC_<FORNECEDOR>_R1, PT_<FORNECEDOR>, HOM_<FORNECEDOR>
    let fornecedorPista = null;
    if (tipo && TIPO_COM_FORNECEDOR[tipo] && toks.length && PREFIXOS[toks[0]]) {
      const resto = toks.filter((t, i) => !(i === 0 && PREFIXOS[t]) && !normRodada(t) &&
        !/^(PROPOSTA|COMERCIAL|TECNICA|REV\d*|V\d+|FINAL|BAFO|RODADA|HOMOLOGACAO|CERTIFICADO|\d+)$/.test(t));
      if (resto.length) fornecedorPista = resto.join(' ');
    } else if (tipo && TIPO_COM_FORNECEDOR[tipo]) {
      const m = nomeN.match(/^(?:PROPOSTA(?: COMERCIAL| TECNICA)?|HOM|HOMOLOGACAO)\s+([A-Z][A-Z0-9 ]{2,30}?)(?:\s+REV\d*|\s+R\d|\s+\d|$)/);
      if (m) fornecedorPista = m[1];
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
    ['rc', /^(RC|RC SAP|REQUISICAO|REQUISICAO COMPRA|N RC)$/],
    ['objeto', /^(OBJETO|DESCRICAO OBJETO|ESCOPO|OBJETO CONTRATACAO)$/],
    ['requisitante', /^(REQUISITANTE|SOLICITANTE|AREA REQUISITANTE|AREA SOLICITANTE)$/],
    ['centroCusto', /^(CENTRO CUSTO|C CUSTO|CENTRO CUSTOS)$/],
    ['comprador', /^(COMPRADOR|COMPRADOR RESPONSAVEL|COMPRADORA)$/],
    ['valorEstimado', /^(VALOR ESTIMADO|ESTIMATIVA|VALOR REFERENCIA|ORCAMENTO|VALOR ESTIMADO TOTAL|TOTAL ESTIMADO)$/],
    ['dataRC', /^(DATA RC|DATA EMISSAO|DATA REQUISICAO)$/],
    ['fornecedor', /^(FORNECEDOR|RAZAO SOCIAL|PROPONENTE|EMPRESA|LICITANTE)$/],
    ['cnpj', /^CNPJ$/],
    ['rodada', /^RODADA$/],
    ['prazoEntrega', /^(PRAZO ENTREGA|PRAZO EXECUCAO)$/],
    ['condPagamento', /^(CONDICAO PAGAMENTO|COND PAGAMENTO|CONDICOES PAGAMENTO|PAGAMENTO)$/],
    ['validade', /^(VALIDADE PROPOSTA|VALIDADE)$/],
    ['frete', /^(FRETE|MODALIDADE FRETE)$/],
    ['totalGeral', /^(TOTAL GERAL|VALOR TOTAL PROPOSTA|TOTAL PROPOSTA|VALOR GLOBAL|VALOR TOTAL GERAL)$/],
    ['data', /^(DATA|DATA PROPOSTA|DATA REUNIAO)$/],
    ['status', /^(STATUS|SITUACAO|STATUS HOMOLOGACAO|RESULTADO)$/],
    ['validadeHom', /^(VALIDA ATE|VALIDADE HOMOLOGACAO|VALIDADE CERTIFICADO|VENCIMENTO)$/],
    ['participantes', /^(PARTICIPANTES|PRESENTES)$/],
    ['dataInicio', /^(DATA INICIO|INICIO VIGENCIA)$/],
    ['dataTermino', /^(DATA TERMINO|TERMINO VIGENCIA|FIM VIGENCIA)$/],
  ];

  function chaveRotulo(s) {
    const r = normRotulo(s);
    if (!r || r.length > 45) return null;
    for (const [k, re] of ROTULOS) if (re.test(r)) return k;
    return null;
  }

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

  function kvTexto(conteudo, nome) {
    const out = {};
    conteudo.lines.forEach((ln) => {
      const partes = ln.t.split(/\s{2,}|\t|\s\|\s/);
      for (const p of partes) {
        const m = p.match(/^\s*([^:]{2,45}):\s*(.+?)\s*$/);
        if (!m) continue;
        const k = chaveRotulo(m[1]);
        if (k && !(k in out)) out[k] = F(m[2], `${nome} › pág. ${ln.p} · "${m[1].trim()}"`);
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
    ['codigo', /^(CODIGO|COD|COD MATERIAL|CODIGO SAP|COD SAP|CODIGO MATERIAL|MATERIAL SAP|NM|CPX)$/],
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
      (rows[r] || []).forEach((cel, c) => {
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
      if (vazio(row)) { if (++vazias >= 3 && itens.length) break; continue; }
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
      // linhas de grupo / subtotal (sem quantidade e sem preço unitário) ficam de fora
      if (qtd == null && (preco == null || preco === 0)) continue;
      if (descricao == null && g('item') == null) continue;
      let item = g('item');
      item = item == null || item === '' ? String(itens.length + 1) : String(typeof item === 'number' ? item : String(item).trim());
      itens.push({
        item,
        codigo: g('codigo') == null ? '' : String(g('codigo')).trim(),
        descricao: descricao == null ? '' : String(descricao).trim(),
        un: g('un') == null ? '' : String(g('un')).trim().toUpperCase(),
        qtd, preco, total,
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

  const UNIDADES = /^(UN|UND|UNID|PC|PCA|PCS|M|MT|M2|M²|M3|M³|KG|T|TON|L|LT|SV|VB|CJ|JG|RL|CX|HRS?|H|HH|MES|MÊS|ANO|DIA|KM|GL|PAR)$/i;
  const NUM_TOKEN = /^(R\$|AUD|USD|US\$|EUR)?\s*-?\d{1,3}(?:[.\s]\d{3})*(?:,\d+)?$|^(R\$|AUD|USD)?\s*-?\d+(?:[.,]\d+)?$|^\d+(?:,\d+)?\s*%$/;

  /**
   * Lê uma linha de item em PDF/texto, em vários formatos:
   *  "1  Rolete …  PC  120  185,00  22.200,00"     (item, descrição, un, qtd, preço, total)
   *  "Licença Server  R$ 39.480,00  2  R$ 78.960,00" (descrição, preço, qtd, total)
   *  "Licença Server  R$ 39.480,00  6,00 %  2  R$ 74.222,40" (com desconto)
   * Só aceita quando qtd × preço (× desconto) bate com o total.
   */
  function itemDeLinha(t) {
    const tk = t.replace(/R\$\s+/g, 'R$').replace(/(\d)\s+%/g, '$1%').split(/\s+/).filter(Boolean);
    const nums = [];
    for (let i = tk.length - 1; i >= 0; i--) {
      if (NUM_TOKEN.test(tk[i])) nums.unshift({ i, s: tk[i], v: parseNum(tk[i]), pct: /%$/.test(tk[i]), moeda: /^(R\$|AUD|USD|US\$|EUR)/.test(tk[i]) });
      else break;
    }
    if (nums.length < 3) return null;
    const total = nums[nums.length - 1];
    const cand = nums.slice(0, -1);
    for (let a = 0; a < cand.length; a++) for (let b = 0; b < cand.length; b++) {
      if (a === b || cand[a].pct || cand[b].pct) continue;
      const q = cand[a].v, p = cand[b].v;
      if (q == null || p == null || q <= 0 || p <= 0) continue;
      if (cand[a].moeda && !cand[b].moeda) continue;
      const desc = cand.find((x) => x.pct);
      const fator = desc ? 1 - desc.v / 100 : 1;
      if (Math.abs(q * p * fator - total.v) <= Math.max(0.05, total.v * 0.0005)) {
        const ini = Math.min(cand[a].i, cand[b].i, desc ? desc.i : Infinity);
        let palavras = tk.slice(0, ini);
        let item = null, un = '';
        if (palavras.length && /^\d{1,3}(\.\d{1,3})?$/.test(palavras[0]) && palavras.length > 1) item = palavras.shift();
        if (palavras.length > 1 && UNIDADES.test(palavras[palavras.length - 1])) un = palavras.pop().toUpperCase().replace('²', '2').replace('³', '3');
        if (!palavras.length) return null;
        return { item, descricao: palavras.join(' '), un, qtd: q, preco: p * fator, total: total.v, desconto: desc ? desc.v : null };
      }
    }
    return null;
  }

  function itensTexto(conteudo, nome) {
    for (const [i, rows] of (conteudo.tables || []).entries()) {
      const res = itensDeLinhas(rows, nome, (r) => `${nome} › tabela ${i + 1}, linha ${r + 1}`);
      if (res && res.itens.length) return { ...res, confianca: 'alta' };
    }
    const itens = [];
    let totalLinha = null;
    const vistos = new Set();
    for (const ln of conteudo.lines) {
      if (conteudo.email && /^(Assunto|De|Para|Data):/.test(ln.t)) continue;
      const it = itemDeLinha(ln.t.replace(/\s+/g, ' '));
      if (it) {
        const chave = it.descricao + '|' + it.total;
        if (vistos.has(chave)) continue; // cabeçalho repetido em cada página
        vistos.add(chave);
        itens.push({ ...it, item: it.item || String(itens.length + 1), codigo: '', precoEst: null, fonte: `${nome} › pág. ${ln.p}` });
        continue;
      }
      const tm = norm(ln.t).match(/^(VALOR )?TOTAL( GERAL| DA PROPOSTA)?\b[^0-9]*([\d.,]+)\s*$/) || norm(ln.t).match(/\bTOTAL( GERAL)?:\s*(?:R\$|AUD|USD)?\s*([\d.,]+)\s*$/);
      if (tm && itens.length && !totalLinha) totalLinha = F(parseNum(tm[tm.length - 1]), `${nome} › pág. ${ln.p}`);
    }
    return { itens, totalLinha, confianca: itens.length ? 'media' : null };
  }

  // ------------------------------------------------------------ tabelas SMIN-IT-GSU-004

  const LIXO_MODELO = /^(EMPRESA (XX|YY|ZZ)|PROPONENTE ?-? ?[A-Z]|[A-Z])$/;

  function acharLinhaCab(rows, testes, max = 40) {
    for (let r = 0; r < Math.min(rows.length, max); r++) {
      const cel = (rows[r] || []).map(norm);
      if (testes.every((t) => cel.some((c) => t.test(c)))) return r;
    }
    return -1;
  }

  /** Vendor list (aba "2 - Vendor List" ou planilha avulsa). */
  function lerVendorList(conteudo, nome) {
    for (const sh of conteudo.sheets) {
      const r = acharLinhaCab(sh.rows, [/^EMPRESAS?$/, /FATURAMENTO/]);
      if (r < 0) continue;
      const cab = sh.rows[r].map(norm);
      const col = (re) => cab.findIndex((c) => re.test(c));
      const c = {
        n: col(/^N$/), sap: col(/CODIGO SAP|COD SAP/), emp: col(/^EMPRESAS?$/), loc: col(/LOCALIZACAO/), fat: col(/^FATURAMENTO/),
        rel: col(/RELACAO/), cli: col(/CLIENTES/), ant: col(/PARTICIPOU/),
      };
      const out = [];
      for (let i = r + 1; i < sh.rows.length; i++) {
        const row = sh.rows[i] || [];
        const emp = row[c.emp];
        if (emp == null || String(emp).trim() === '') { if (out.length && vazio(row)) break; continue; }
        if (LIXO_MODELO.test(norm(emp))) continue;
        out.push({
          n: row[c.n] ?? out.length + 1, codigoSap: c.sap >= 0 && row[c.sap] != null ? String(row[c.sap]).trim() : '',
          empresa: String(emp).trim(), localizacao: c.loc >= 0 ? row[c.loc] || '' : '',
          faturamento: c.fat >= 0 ? parseNum(row[c.fat]) : null, relacao: c.rel >= 0 ? parseNum(row[c.rel]) : null,
          clientes: c.cli >= 0 ? row[c.cli] || '' : '', participouAnterior: c.ant >= 0 ? row[c.ant] || '' : '',
          fonte: `${nome} › ${sh.name}!linha ${i + 1}`,
        });
      }
      if (out.length) return out;
    }
    return [];
  }

  /** Carta convite e qualificações (aba "3 - Carta Convite-Qualificações" ou avulsa). */
  function lerQualificacoes(conteudo, nome) {
    for (const sh of conteudo.sheets) {
      const r = acharLinhaCab(sh.rows, [/^EMPRESAS?$/, /CONFIRMOU|APRESENTOU|QUALIFICAC/]);
      if (r < 0) continue;
      const cab = sh.rows[r].map(norm), sub = (sh.rows[r + 1] || []).map(norm);
      const col = (re) => { let i = sub.findIndex((c) => re.test(c)); if (i < 0) i = cab.findIndex((c) => re.test(c)); return i; };
      const c = {
        sap: cab.findIndex((x) => /CODIGO SAP/.test(x)), emp: cab.findIndex((x) => /^EMPRESAS?$/.test(x)),
        conf: col(/CONFIRMOU/), apr: col(/APRESENTOU/), tec: col(/^TECNICA$/), seg: col(/SEGURANCA|SST/),
        fin: col(/FINANCEIRA/), comp: col(/COMPLIANCE/), res: col(/RESULTADO/),
      };
      const out = [];
      for (let i = r + 1; i < sh.rows.length; i++) {
        const row = sh.rows[i] || [];
        const emp = row[c.emp];
        if (emp == null || String(emp).trim() === '' || /^(TECNICA|EMPRESAS?)$/.test(norm(emp))) continue;
        if (LIXO_MODELO.test(norm(emp))) continue;
        const g = (k) => (c[k] >= 0 && row[c[k]] != null ? String(row[c[k]]).trim().toUpperCase() : '');
        const sap = c.sap >= 0 && row[c.sap] != null ? String(row[c.sap]).trim() : '';
        out.push({
          empresa: String(emp).trim(), codigoSap: /^\d{1,2}$/.test(sap) ? '' : sap,
          confirmou: g('conf'), apresentou: g('apr'), tec: g('tec'), seg: g('seg'), fin: g('fin'), comp: g('comp'), resultado: g('res'),
          fonte: `${nome} › ${sh.name}!linha ${i + 1}`,
        });
      }
      if (out.length) return out;
    }
    return [];
  }

  /** Quadro de preço (totais por rodada, aba "4 - Quadro de Preço"). */
  function lerQuadroPrecos(conteudo, nome) {
    for (const sh of conteudo.sheets) {
      const r = acharLinhaCab(sh.rows, [/^PROPONENTES?$/, /PROPOSTA (INICIAL|FINAL)|RODADA/]);
      if (r < 0) continue;
      const cab = sh.rows[r].map((x) => (x == null ? '' : String(x)));
      const colunas = [];
      cab.forEach((t, i) => { const rod = /INICIAL/i.test(t) ? 'R1' : normRodada(t); if (rod) colunas.push({ i, rod }); });
      const cProp = sh.rows[r].map(norm).findIndex((x) => /^PROPONENTES?$/.test(x));
      const out = [];
      for (let i = r + 1; i < sh.rows.length; i++) {
        const row = sh.rows[i] || [];
        const n = row[cProp];
        if (n == null || /CUSTO EVITADO|^R\$$|PORTAL|E-MAIL/i.test(String(n))) continue;
        if (LIXO_MODELO.test(norm(n))) continue;
        const valores = {};
        colunas.forEach(({ i: ci, rod }) => { const v = parseNum(row[ci]); if (v) valores[rod] = v; });
        if (Object.keys(valores).length) out.push({ empresa: String(n).trim(), valores, fonte: `${nome} › ${sh.name}!linha ${i + 1}` });
      }
      if (out.length) return out;
    }
    return [];
  }

  // ------------------------------------------------------------ RH anterior (cabeçalho + aditivos)

  const CAMPOS_CAB = [
    ['objeto', /^OBJETO\s*:/],
    ['contrato', /^CONTRATO\/PEDIDO DE COMPRA N/],
    ['gerencia', /^GERENCIA(?!.*REQUISITANTE)/],
    ['fornecedorRH', /^FORNECEDOR/],
    ['dataDocumento', /^DATA DOCUMENTO/],
    ['valorRC', /^VALOR DA REQUISICAO/],
    ['numeroRC', /^N DA REQUISICAO/],
    ['valorAditivo', /^VALOR DO ADITIVO/],
    ['valorContratado', /^(VALOR TOTAL CONTRATADO|NOVO VALOR TOTAL)/],
    ['custoEvitado', /^CUSTO EVITADO/],
    ['vigencia', /^PRAZO DE VIGENCIA/],
    ['prazo', /^PRAZO:/],
    ['condPagamento', /^CONDICAO DE PAGAMENTO/],
    ['regime', /^REGIME DE CONTRATACAO/],
    ['incoterm', /^INCOTERM/],
    ['reajuste', /^FORMULA PARAMETRICA/],
    ['dataBase', /^DATA BASE/],
    ['rescisao', /^PRAZO PARA RESCISAO/],
    ['multa', /^MULTA POR RESCISAO/],
    ['classificacao', /^CLASSIFICACAO DO (PROCESSO|ADITIVO)/],
    ['gerenciaRequisitante', /^GERENCIA REQUISITANTE/],
    ['unidade', /^UNIDADE SAMARCO/],
    ['gestor', /^GESTOR DO CONTRATO/],
    ['responsavel', /^RESPONS[AÁ]VEL PELO PROCESSO/],
    ['formalizacao', /^FORMALIZACAO DO PROCESSO/],
    ['rfq', /^N RFQ/],
    ['explicacaoME', /^EXPLICACAO CASO/],
    ['sharepoint', /^ARQUIVAMENTO DO PROCESSO/],
  ];
  const ROTULOS_CAB = {
    contrato: 'CONTRATO/PEDIDO DE COMPRA Nº', gerencia: 'GERÊNCIA', fornecedorRH: 'FORNECEDOR', dataDocumento: 'DATA DOCUMENTO',
    valorRC: 'VALOR DA REQUISIÇÃO DE COMPRA', numeroRC: 'Nº DA REQUISIÇÃO DE COMPRA', valorAditivo: 'VALOR DO ADITIVO',
    valorContratado: 'VALOR TOTAL CONTRATADO', custoEvitado: 'CUSTO EVITADO', vigencia: 'PRAZO DE VIGÊNCIA', prazo: 'PRAZO',
    condPagamento: 'CONDIÇÃO DE PAGAMENTO', regime: 'REGIME DE CONTRATAÇÃO', incoterm: 'INCOTERM', reajuste: 'FÓRMULA PARAMÉTRICA DE REAJUSTE',
    dataBase: 'DATA BASE', rescisao: 'PRAZO PARA RESCISÃO SEM ÔNUS', multa: 'MULTA POR RESCISÃO', classificacao: 'CLASSIFICAÇÃO DO PROCESSO DE COMPRA',
    gerenciaRequisitante: 'GERÊNCIA REQUISITANTE', unidade: 'UNIDADE SAMARCO', gestor: 'GESTOR DO CONTRATO', responsavel: 'RESPONSÁVEL PELO PROCESSO',
    formalizacao: 'FORMALIZAÇÃO DO PROCESSO', rfq: 'Nº RFQ (Nº do ME – Nº SAP)', explicacaoME: 'EXPLICAÇÃO CASO NÃO TENHA SIDO USADO MERCADO ELETRÔNICO',
    sharepoint: 'ARQUIVAMENTO DO PROCESSO NO SHAREPOINT',
  };
  const PLACEHOLDER = /^(X{3,}.*|R\$\s*X.*|R\$\s*$|R\$X+.*|inserir o link da pasta|Informação não localizada\.?)$/i;

  /** Lê o cabeçalho (1ª tabela) de um RH. */
  function lerCabecalhoRH(rows, nome) {
    const out = {};
    const limpar = (s) => String(s || '').replace(/^[\s:/]+/, '').replace(/\s+/g, ' ').trim();
    (rows || []).forEach((row, ri) => {
      row.forEach((cel, ci) => {
        if (cel == null) return;
        const t = String(cel);
        const n = norm(t);
        for (const [k, re] of CAMPOS_CAB) {
          if (!re.test(n) || k in out) continue;
          // valor na mesma célula, depois do rótulo
          const idx = t.indexOf(':');
          let v = idx >= 0 ? limpar(t.slice(idx + 1)) : '';
          if (k === 'contrato') { const m = t.match(/(\d{6,})/); v = m ? m[1] : ''; }
          if (k === 'gerencia') v = limpar(t.replace(/^GER[ÊE]NCIA\s*:?/i, ''));
          if (k === 'rfq') { const m = t.match(/RFQ\s*:?\s*(\S+)/i); v = m && !/^\(?N/i.test(m[1]) ? m[1] : ''; }
          if (k === 'prazo') v = limpar(t.replace(/^PRAZO\s*:/i, ''));
          if (!v && row[ci + 1] != null && !CAMPOS_CAB.some(([, r2]) => r2.test(norm(row[ci + 1])))) v = limpar(row[ci + 1]);
          if (v && !PLACEHOLDER.test(v)) out[k] = F(v, `${nome} › cabeçalho, linha ${ri + 1}`);
        }
      });
    });
    return out;
  }

  /** Tabela "Resumo de evolução do contrato" de um RH de aditivo. */
  function lerEvolucao(tables, nome) {
    for (const rows of tables || []) {
      const h = (rows[0] || []).map(norm);
      if (!h.some((c) => /^N TAC$|^N TAC\b/.test(c)) || !h.some((c) => /VALOR TOTAL/.test(c))) continue;
      const col = (re) => h.findIndex((c) => re.test(c));
      const c = { n: col(/^N TAC/), data: col(/DATA DE EMISSAO/), adit: col(/ADITADO/), total: col(/VALOR TOTAL/), varia: col(/VARIACAO/), prazo: col(/PRAZO/), ini: col(/INICIO/), fim: col(/TERMINO/) };
      const linhas = rows.slice(1).filter((r) => r && r[c.n]).map((r, i) => ({
        tac: String(r[c.n]).trim(), data: r[c.data] || '', aditado: parseNum(r[c.adit]), total: parseNum(r[c.total]),
        variacao: r[c.varia] || '', prazo: parseNum(r[c.prazo]), inicio: r[c.ini] || '', termino: r[c.fim] || '',
        fonte: `${nome} › resumo de evolução, linha ${i + 2}`,
      }));
      if (linhas.length) return linhas;
    }
    return [];
  }

  /** Dados do nome da pasta/arquivo: "7º TAC CRT 4500000123-EXEMPLO CONCRETO LTDA". */
  function dadosDoNome(s) {
    const t = String(s || '');
    const out = {};
    const m = t.match(/(\d{1,2})\s*[º°o]?\s*_*\s*TAC[\s_]+(?:CRT|CTR|CONTRATO)?[\s_]*(\d{10})\s*[-–_]+\s*(.+)$/i);
    if (m) { out.tac = parseInt(m[1], 10); out.contrato = m[2]; out.fornecedor = m[3].replace(/[-_]?(Manifesto|assinado|validado)$/i, '').replace(/_/g, ' ').trim(); }
    const rc = t.match(/\b(4[12]\d{8})\b/);
    if (rc) out.rc = rc[1];
    const ctr = t.match(/\b(4[3-6]\d{8})\b/);
    if (ctr && !out.contrato) out.contrato = ctr[1];
    const rfp = t.match(/^(\d{8})\s*[-–]\s*(.+)$/);
    if (rfp) { out.rfp = rfp[1]; out.objeto = rfp[2].trim(); }
    return out;
  }

  // ------------------------------------------------------------ fornecedores

  const STOP_FORN = new Set(
    ('LTDA S/A SA EIRELI ME EPP CIA COMPANHIA COMERCIO INDUSTRIA INDUSTRIAL INDUSTRIAIS SERVICOS SERVICO ' +
      'EQUIPAMENTOS MINERACAO BRASIL ENGENHARIA SOLUCOES TECNOLOGIA GRUPO DO DA DE DOS DAS E COM IND PTY LIMITED ' +
      'SOFTWARE CONSULTORIA PROJETOS CONSORCIO DESENVOLVIMENTO').split(' ')
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

  function novoFornecedor(st, nome, fonte) {
    return {
      id: 'F' + (st.seq.f++), nome: F(String(nome).trim(), fonte), cnpj: F(null), codigoSap: F(null),
      nt: F(null), statusTecnico: F(null), obsTecnica: F(null), homStatus: F(null), homValidade: F(null),
      confirmou: F(null), apresentou: F(null), qTec: F(null), qSeg: F(null), qFin: F(null), qComp: F(null), qResultado: F(null),
    };
  }

  function garantirFornecedor(st, nome, fonte, cnpj, cnpjFonte) {
    let f = acharFornecedor(st, nome, cnpj);
    if (!f) {
      f = novoFornecedor(st, nome, fonte);
      if (cnpj) f.cnpj = F(cnpj, cnpjFonte);
      st.fornecedores.push(f);
    } else {
      if (String(nome).trim().length > String(val(f.nome) || '').length && fonte && !/nome do arquivo/.test(fonte)) f.nome = F(String(nome).trim(), fonte);
      if (cnpj && !val(f.cnpj)) f.cnpj = F(cnpj, cnpjFonte);
    }
    return f;
  }

  /** Procura no texto do documento o nome de um fornecedor já conhecido. */
  function fornecedorNoTexto(st, conteudo) {
    if (!conteudo) return null;
    const txt = conteudo.kind === 'text' ? norm(conteudo.lines.slice(0, 120).map((l) => l.t).join(' ')) : textoInicio(conteudo, 6000);
    const achados = st.fornecedores.filter((f) => {
      const w = palavrasForn(val(f.nome))[0];
      return w && w.length >= 4 && new RegExp('\\b' + w + '\\b').test(txt);
    });
    return achados.length === 1 ? achados[0] : null;
  }

  // ------------------------------------------------------------ estado

  function estadoVazio() {
    return {
      versao: 2,
      criadoEm: new Date().toISOString(),
      tipoProcesso: F(null),
      moeda: 'BRL',
      processo: {
        rc: F(null), objeto: F(null), requisitante: F(null), centroCusto: F(null), comprador: F(null),
        valorEstimado: F(null), dataRC: F(null),
      },
      cab: {},
      itensRC: [],
      fornecedores: [],
      vendorList: [],
      quadroPrecos: [],
      propostas: [],
      atas: [],
      emails: [],
      evolucao: [],
      aditivo: {},
      modelos: [],
      documentos: [],
      textos: {},
      config: { pesoTecnico: 30, pesoComercial: 70, faltante: 'maior', tolerancia: 0.5, notaCorte: null },
      rh: { justificativa: '', observacoes: '', dataRH: fmtData(new Date()) },
      seq: { f: 1, p: 1 },
    };
  }

  const PRIORIDADE = { RHA: 0, TAB: 1, VL: 1, RC: 2, PQ: 2, JUST: 3, TAC: 3, QT: 4, QS: 4, QF: 4, QC: 4, AT: 4, PC: 5, HOM: 6, PT: 7, ATA: 8, CC: 8, COM: 8, CTR: 9, RHM: 9, OUTRO: 10, IGNORAR: 11 };

  /** Marca cópias repetidas (mesmo nome e tamanho), mantendo a primeira fora de e-mail. */
  function marcarDuplicados(novos, antigos) {
    const chave = (d) => norm(d.nome) + '|' + d.tamanho;
    const vistos = new Map((antigos || []).filter((d) => !d.duplicadoDe).map((d) => [chave(d), d.id]));
    novos.forEach((d) => { d.duplicadoDe = null; });
    const ordem = [...novos].sort((a, b) => (a.anexoDe ? 1 : 0) - (b.anexoDe ? 1 : 0) || a.caminho.split('/').length - b.caminho.split('/').length);
    for (const d of ordem) {
      const k = chave(d);
      if (d.tamanho && vistos.has(k)) d.duplicadoDe = vistos.get(k);
      else vistos.set(k, d.id);
    }
  }

  /** Monta o estado a partir de todos os documentos. */
  function montarEstado(docs, base) {
    const st = estadoVazio();
    if (base) {
      st.config = { ...st.config, ...base.config };
      st.rh = { ...st.rh, ...base.rh };
      if (base.cabPadrao) st.cabPadrao = base.cabPadrao;
    }
    adicionarDocumentos(st, docs, []);
    return st;
  }

  const prioridade = (d) => (PRIORIDADE[d.tipo] ?? 9) + (d.tipo === 'PQ' && !/\bPQ\b|QUANTIDADE/.test(norm(d.nome).replace(/[^A-Z0-9]+/g, ' ')) ? 0.5 : 0);

  /** Acrescenta documentos a um processo já aberto, sem desfazer o que já foi conferido. */
  function adicionarDocumentos(st, docs, antigos) {
    marcarDuplicados(docs, antigos);
    for (const d of docs) {
      if (!d.manual) {
        const c = classificar(d);
        d.tipo = c.tipo; d.rodada = c.rodada; d.fornecedorPista = c.fornecedorPista; d.origem = c.origem;
      }
    }
    const ordem = docs.filter((d) => !d.duplicadoDe).sort((a, b) => prioridade(a) - prioridade(b));
    for (const d of ordem) aplicarDocumento(st, d);
    for (const d of docs.filter((x) => x.duplicadoDe)) { d.status = 'duplicado'; }
    // dados do nome da pasta raiz
    const raiz = docs.find((d) => d.raiz);
    if (raiz && !st.nomeProcesso) st.nomeProcesso = raiz.raiz;
    if (!st.nomeProcesso) {
      const cont = {};
      docs.filter((d) => !d.anexoDe && d.caminho.includes('/')).forEach((d) => { const s0 = d.caminho.split('/')[0]; cont[s0] = (cont[s0] || 0) + 1; });
      const top = Object.entries(cont).sort((a, b) => b[1] - a[1])[0];
      if (top && top[1] >= 2) st.nomeProcesso = top[0];
    }
    aplicarNomeProcesso(st, st.nomeProcesso);
    if (st.codigoPretendido) {
      const f = st.codigoPretendido.nome ? acharFornecedor(st, st.codigoPretendido.nome) : st.fornecedores.length === 1 ? st.fornecedores[0] : null;
      if (f && !val(f.codigoSap)) f.codigoSap = F(st.codigoPretendido.codigo, st.codigoPretendido.fonte);
    }
    detectarTipoProcesso(st);
    preencherCabecalho(st);
    st.documentos = (st.documentos || []).filter((x) => !docs.some((d) => d.id === x.id)).concat(docs.map(resumoDoc));
    return st;
  }

  function aplicarNomeProcesso(st, nome) {
    if (!nome) return;
    const d = dadosDoNome(nome);
    if (d.contrato && !val(st.cab.contrato)) st.cab.contrato = F(d.contrato, `nome da pasta`);
    if (d.rc && !val(st.processo.rc)) st.processo.rc = F(d.rc, 'nome da pasta');
    if (d.objeto && !val(st.processo.objeto)) st.processo.objeto = F(d.objeto, 'nome da pasta');
    if (d.rfp && !val(st.cab.rfp)) st.cab.rfp = F(d.rfp, 'nome da pasta');
    if (d.tac) st.aditivo.numero = st.aditivo.numero || F(d.tac, 'nome da pasta');
    if (d.fornecedor && !st.fornecedores.length) garantirFornecedor(st, d.fornecedor, 'nome da pasta');
  }

  function resumoDoc(d) {
    return {
      id: d.id, nome: d.nome, caminho: d.caminho, ext: d.ext, tamanho: d.tamanho, anexoDe: d.anexoDe || null,
      tipo: d.tipo || null, rodada: d.rodada || null, fornecedorId: d.fornecedorId || null,
      fornecedorPista: d.fornecedorPista || null, fornecedorManual: d.fornecedorManual || null,
      origem: d.origem || null, manual: !!d.manual, duplicadoDe: d.duplicadoDe || null,
      status: d.status || (d.tipo ? 'ok' : 'pendente'), aviso: d.aviso || d.avisoLeitura || null, erro: d.erro || null,
      temTexto: !!(d.conteudo && d.conteudo.kind === 'text' && d.conteudo.lines.length),
      email: d.conteudo && d.conteudo.email ? { assunto: d.conteudo.email.assunto, de: d.conteudo.email.de, data: d.conteudo.email.data } : null,
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
    const texto = c && c.kind === 'text' ? c.lines.map((l) => l.t).join('\n') : '';
    const email = c && c.email;
    if (texto) {
      const sap = lerTelaSAP(texto);
      if (sap) aplicarTelaSAP(st, d, sap);
      camposEmTexto(st, d, texto);
    }

    const vincularFornecedor = (exigeCriar) => {
      let f = null;
      if (d.fornecedorManual) f = garantirFornecedor(st, d.fornecedorManual, `${d.nome} (indicado pelo comprador)`);
      const kf = pegar('fornecedor'), kc = pegar('cnpj');
      if (!f && kf && !/SAMARCO/i.test(kf.v)) f = exigeCriar ? garantirFornecedor(st, kf.v, kf.fonte, kc && kc.v, kc && kc.fonte) : acharFornecedor(st, kf.v, kc && kc.v);
      if (!f && d.fornecedorPista) f = exigeCriar ? garantirFornecedor(st, d.fornecedorPista, `${d.nome} (nome do arquivo)`) : acharFornecedor(st, d.fornecedorPista);
      if (!f) f = fornecedorNoTexto(st, c);
      if (!f && st.fornecedores.length === 1) f = st.fornecedores[0];
      if (f && kc && !val(f.cnpj)) f.cnpj = kc;
      d.fornecedorId = f ? f.id : null;
      return f;
    };

    switch (d.tipo) {
      case 'RC': {
        for (const k of ['rc', 'objeto', 'requisitante', 'centroCusto', 'comprador', 'valorEstimado', 'dataRC']) {
          const v = pegar(k);
          if (k === 'objeto' && v && /^(NAO HOUVE|SEM ALTERACAO|N\/?A$|-+$)/.test(norm(val(v)))) continue;
          if (v && val(st.processo[k]) == null) st.processo[k] = v;
        }
        const dn = dadosDoNome(d.nome);
        if (val(st.processo.rc) == null && dn.rc) st.processo.rc = F(dn.rc, `${d.nome} (nome do arquivo)`);
        if (c && c.kind === 'text' && !c.lines.length) d.aviso = 'PDF escaneado (imagem): informe os dados da RC na Conferência.';
      }
      // segue para ler itens, se houver
      // eslint-disable-next-line no-fallthrough
      case 'PQ': {
        const res = c && c.kind === 'sheets' ? itensPlanilha(c) : c && c.kind === 'text' ? itensTexto(c, d.nome) : { itens: [] };
        if (res.itens.length && !st.itensRC.length) {
          st.itensRC = res.itens.map((it) => ({
            item: it.item, codigo: it.codigo, descricao: it.descricao, un: it.un, qtd: it.qtd,
            precoEst: it.precoEst ?? (it.preco || null), fonte: c.kind === 'sheets' ? `${d.nome} › ${it.fonte}` : it.fonte,
          }));
          if (val(st.processo.valorEstimado) == null) {
            const soma = st.itensRC.reduce((s, it) => s + (it.precoEst || 0) * (it.qtd || 0), 0);
            if (soma > 0) st.processo.valorEstimado = F(soma, `${d.nome} (soma dos itens estimados)`);
          }
        }
        break;
      }
      case 'TAB':
      case 'VL': {
        if (!c || c.kind !== 'sheets') break;
        const vl = lerVendorList(c, d.nome);
        if (vl.length && !st.vendorList.length) st.vendorList = vl;
        const q = lerQualificacoes(c, d.nome);
        for (const r of q) {
          const f = garantirFornecedor(st, r.empresa, r.fonte);
          const set = (k, v) => { if (v) f[k] = F(v, r.fonte); };
          set('confirmou', r.confirmou); set('apresentou', r.apresentou); set('qTec', r.tec); set('qSeg', r.seg);
          set('qFin', r.fin); set('qComp', r.comp); set('qResultado', r.resultado); set('codigoSap', r.codigoSap);
          if (r.tec && !val(f.statusTecnico)) f.statusTecnico = F(normStatusTecnico(r.tec), r.fonte);
        }
        const qp = lerQuadroPrecos(c, d.nome);
        if (qp.length && !st.quadroPrecos.length) st.quadroPrecos = qp;
        const tco = lerTCO(c, d.nome);
        for (const t of tco.notas) {
          const f = acharFornecedor(st, t.empresa);
          if (f && t.nota != null && val(f.nt) == null) f.nt = F(t.nota, t.fonte);
        }
        if (tco.pesoT != null && tco.notas.length) { st.config.pesoTecnico = Math.round(tco.pesoT * 100); st.config.pesoComercial = Math.round((1 - tco.pesoT) * 100); }
        if (!vl.length && !q.length && !qp.length && d.tipo === 'TAB') d.aviso = 'Tabelas do RH sem dados do processo (só o modelo).';
        if (vl.length) d.aviso = `Vendor list: ${vl.length} empresa(s) — confira se é deste processo.`;
        break;
      }
      case 'JUST': {
        const atual = st.textos._justificativa;
        if (texto && (!atual || (atual.email && !email))) {
          const corpo = (c.lines || []).filter((l) => !/^(Assunto|De|Para|Data|Enviado em|Enviada em|Cc|Para):/i.test(l.t))
            .map((l) => l.t.replace(/<mailto:[^>]+>|<[^@>\s]+@[^>]+>|\[cid:[^\]]+\]/g, '').trim()).filter(Boolean).join(' ');
          if (corpo.trim().length > 40) {
            st.textos._justificativa = { v: corpo.slice(0, 2500), fonte: d.nome, email: !!email };
            if (/PRETENDIDO/.test(norm(d.nome) + norm(corpo.slice(0, 600)))) st.indicioPretendido = d.nome;
            const cod = corpo.match(/C[óo]digo do Fornecedor:\s*(\d{3,7})/i), nf = corpo.match(/Nome do Fornecedor:\s*([^\n]+?)(?:\s{2,}|\s+Descreva|\s+Nome completo|$)/i);
            if (cod) st.codigoPretendido = { codigo: cod[1], nome: nf ? nf[1].trim() : null, fonte: d.nome };
          }
        }
        if (email) st.emails.push({ docId: d.id, tipo: 'JUST', ...email });
        break;
      }
      case 'PC': {
        const f = vincularFornecedor(true);
        if (!f) { d.status = 'pendente'; d.aviso = 'Indique de qual fornecedor é esta proposta.'; break; }
        const rod = d.rodada || normRodada(val(pegar('rodada'))) || 'R1';
        d.rodada = rod;
        const res = !c ? { itens: [] } : c.kind === 'sheets' ? itensPlanilha(c) : itensTexto(c, d.nome);
        res.itens = res.itens.filter((it) => (it.preco || 0) > 0 || (it.total || 0) > 0);
        const conf = c && c.kind === 'sheets' && res.itens.length ? 'alta' : res.confianca || null;
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
        if (!val(prop.condPagamento) && texto) {
          const m = texto.match(/pagamento[^.\n]{0,40}?(\d{1,3})\s*(dias|ddl)([^.\n]{0,40})/i);
          if (m) prop.condPagamento = F(`${m[1]} dias${/fatura/i.test(m[3]) ? ' após o faturamento' : ''}`, `${d.nome} (texto)`);
        }
        const peso = { alta: 3, media: 2 }[conf] || 1;
        const existente = st.propostas.find((p) => p.fornecedorId === f.id && p.rodada === rod);
        if (existente && ({ alta: 3, media: 2, conferida: 4, manual: 4 }[existente.confianca] || 1) > peso) {
          for (const k of ['condPagamento', 'prazoEntrega', 'validade', 'frete']) if (!val(existente[k]) && val(prop[k])) existente[k] = prop[k];
          d.aviso = 'Mesma proposta lida de outro arquivo (mantida a leitura mais segura).';
          break;
        }
        if (existente) for (const k of ['condPagamento', 'prazoEntrega', 'validade', 'frete']) if (!val(prop[k]) && val(existente[k])) prop[k] = existente[k];
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
        if (!res.length && st.fornecedores.length > 1) { d.status = 'conferir'; d.aviso = 'Não encontrei as notas técnicas: informe-as na Conferência.'; }
        break;
      }
      case 'QT': case 'QS': case 'QF': case 'QC': {
        if (email) {
          st.emails.push({ docId: d.id, tipo: d.tipo, ...email });
          const t = norm(texto.slice(0, 3000));
          const m = texto.match(/(\d{1,3}(?:[.,]\d+)?)\s*%/);
          if (d.tipo === 'QT' && /APROVAD|DE ACORDO|ATENDE/.test(t) && m && st.fornecedores.length === 1 && val(st.fornecedores[0].nt) == null && /PONTUA|NOTA/.test(t))
            st.fornecedores[0].nt = F(parseNum(m[1]), `${d.nome} (e-mail)`);
        }
        break;
      }
      case 'HOM': {
        const f = vincularFornecedor(false);
        if (!f) { d.status = 'pendente'; d.aviso = 'Indique de qual fornecedor é esta homologação.'; break; }
        const tx = c ? (c.kind === 'text' ? norm(texto) : textoInicio(c, 5000)) : '';
        let status = null;
        const ks = pegar('status');
        const sN = norm(ks ? ks.v : tx);
        if (/NAO HOMOLOGADO|REPROVADO|BLOQUEADO|SUSPENSO|INAPTO/.test(sN)) status = 'Não homologado';
        else if (/VENCID/.test(sN)) status = 'Vencida';
        else if (/HOMOLOGADO|APROVADO|APTO|ATIVO/.test(sN)) status = 'Homologado';
        const kval = pegar('validadeHom') || pegar('validade');
        let validade = kval ? parseDate(kval.v) : null;
        if (!validade) { const m = tx.match(/VALID[A-Z ]*?(\d{1,2}\/\d{1,2}\/\d{2,4})/); if (m) validade = parseDate(m[1]); }
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
        st.atas.push({ docId: d.id, arquivo: d.nome, rodada: rod, data: kd || F(email ? email.data : null), participantes: pegar('participantes') || F(null) });
        if (!rod) { d.status = 'conferir'; d.aviso = 'Indique a qual rodada esta ata se refere.'; }
        break;
      }
      case 'CC': case 'COM': {
        if (email) st.emails.push({ docId: d.id, tipo: d.tipo, ...email });
        if (d.tipo === 'CC' && email && !st.cartaConvite) st.cartaConvite = { data: email.data, assunto: email.assunto, fonte: d.nome };
        break;
      }
      case 'TAC': {
        const ini = pegar('dataInicio'), fim = pegar('dataTermino');
        if (fim) st.aditivo.novoTermino = st.aditivo.novoTermino || F(String(fim.v).replace(/\.$/, ''), fim.fonte);
        if (ini) st.aditivo.inicio = st.aditivo.inicio || F(String(ini.v).replace(/\.$/, ''), ini.fonte);
        const dn = dadosDoNome(d.nome);
        if (dn.tac && !val(st.aditivo.numero)) st.aditivo.numero = F(dn.tac, `${d.nome} (nome do arquivo)`);
        if (dn.contrato && !val(st.cab.contrato)) st.cab.contrato = F(dn.contrato, `${d.nome} (nome do arquivo)`);
        if (dn.fornecedor) garantirFornecedor(st, dn.fornecedor, `${d.nome} (nome do arquivo)`);
        st.indicioAditivo = d.nome;
        break;
      }
      case 'RHA': {
        if (!c || !c.tables || !c.tables.length) break;
        const cab = lerCabecalhoRH(c.tables[0], d.nome);
        const titulo = norm((c.tables[0][0] || [])[0] || '');
        const ehAditivo = /ALTERACAO CONTRATUAL/.test(titulo);
        const ev = lerEvolucao(c.tables, d.nome);
        st.modelos.push({ docId: d.id, nome: d.nome, tipo: ehAditivo ? 'aditivo' : 'contratacao', preenchido: true, evolucao: ev.length });
        if (ehAditivo) {
          st.indicioAditivo = st.indicioAditivo || d.nome;
          if (ev.length > st.evolucao.length) { st.evolucao = ev; st.rhAnterior = d.id; }
        }
        for (const [k, v] of Object.entries(cab)) if (!val(st.cab[k])) st.cab[k] = v;
        if (cab.fornecedorRH) {
          const m = String(cab.fornecedorRH.v).match(/^\s*(\d{3,7})\s*[-–_ ]\s*(.+)$/);
          const f = garantirFornecedor(st, m ? m[2] : cab.fornecedorRH.v, cab.fornecedorRH.fonte);
          if (m && !val(f.codigoSap)) f.codigoSap = F(m[1], cab.fornecedorRH.fonte);
        }
        break;
      }
      case 'RHM': {
        const titulo = c && c.tables && c.tables[0] ? norm((c.tables[0][0] || [])[0] || '') : '';
        if (/RELATORIO DE HOMOLOGACAO/.test(titulo) || /SMIN FO GSU/.test(norm(d.nome)))
          st.modelos.push({ docId: d.id, nome: d.nome, tipo: /ALTERACAO/.test(titulo) || /004/.test(d.nome) ? 'aditivo' : /SIMPLIFICADO|059/.test(norm(d.nome) + titulo) ? 'simplificado' : 'contratacao', preenchido: false });
        break;
      }
      default:
        if (email) st.emails.push({ docId: d.id, tipo: d.tipo, ...email });
        break;
    }
  }

  // ------------------------------------------------------------ telas do SAP e campos em texto livre

  const tituloCaso = (s) => String(s).toLowerCase().replace(/(^|\s)([a-zà-ú])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Da|Do|Dos|Das|E)\b/g, (m) => m.toLowerCase());

  /** Lê a tela "Exibir Requisição compra" / "Nota cabeçalho" do SAP (print ou PDF escaneado). */
  function lerTelaSAP(texto) {
    const t = String(texto).replace(/[—–]/g, '-');
    const out = {};
    let m = t.match(/Requisi[çc][ãa]o\s*(?:de\s*)?compra[:\s]+(4[12]\d{8})/i) || t.match(/Nota cabe[çc]alho:?\s*(4[12]\d{8})/i);
    if (!m) return null;
    out.numeroRC = m[1];
    m = t.match(/(\d{1,2})\s*[ºo°]\s*Aditivo\s*-\s*(\d{2}\/\d{2}\/\d{4})(?:\s*-\s*PRAZO AT[ÉE]\s*(\d{2}\/\d{2}\/\d{4}))?/i);
    if (m) { out.tac = parseInt(m[1], 10); out.dataTac = m[2]; if (m[3]) out.novoTermino = m[3]; }
    m = t.match(/Data de t[ée]rmino:?\s*Alterad[ao] de (\d{2}\/\d{2}\/\d{4}) para (\d{2}\/\d{2}\/\d{4})/i);
    if (m) { out.terminoAnt = m[1]; out.novoTermino = m[2]; }
    m = t.match(/\b(4[3-6]\d{8})\b/);
    if (m) out.contrato = m[1];
    m = t.match(/Contrato\s+\d{8,10}\s*-\s*([A-ZÀ-Ú0-9][A-ZÀ-Ú0-9 .&/-]{3,80}?)\s*$/im);
    if (m) out.fornecedor = m[1].trim();
    m = t.match(/Gestor(?: do contrato)?\s*:\s*([A-ZÀ-Úa-zà-ú][A-ZÀ-Úa-zà-ú .]{4,60}?)\s*(?:["'”]|$)/im);
    if (m) out.gestor = tituloCaso(m[1].trim());
    m = t.match(/Classifica[çc][ãa]o do Aditivo\s*:\s*(.+?)\s*$/im);
    if (m) out.classificacao = m[1].replace(/[.;]$/, '');
    m = t.match(/^\s*V?alor\s*:\s*(.+?)\s*$/im);
    if (m) out.valorTexto = m[1];
    m = t.match(/Escopo\s*:\s*(.+?)\s*$/im);
    if (m) out.escopo = m[1].replace(/[.;]$/, '');
    // justificativa: linhas seguidas até fechar a frase (ou até outra informação da tela)
    const ls = t.split('\n'), ij = ls.findIndex((l) => /Justificativa\s*:/i.test(l));
    if (ij >= 0) {
      const partes = [ls[ij].replace(/^.*?Justificativa\s*:\s*/i, '')];
      for (let i = ij + 1; i < ls.length && !/[.!;]\s*$/.test(partes[partes.length - 1]); i++) {
        const l = ls[i].trim();
        if (!l || /^\d{2,5}\s|^[A-ZÀ-Ú][\wÀ-ú. ]{1,30}:|^Grp\.|^\S{0,3}$/.test(l)) break;
        partes.push(l);
      }
      const j = partes.join(' ').replace(/\s+/g, ' ').trim();
      if (j) out.justificativa = j;
    }
    // itens da RC: "... 1 SV 0,01 BRL" -> valor da RC = soma de qtd × preço
    let soma = 0, achou = false;
    for (const l of t.split('\n')) {
      const it = l.match(/^\s*\d{2,5}\s.*?\s(\d+(?:[.,]\d+)?)\s*[A-Za-z]{1,4}\s+([\d.]+,\d{2})\s+(BRL|USD|EUR|AUD)\b/);
      if (it) { soma += parseNum(it[1]) * parseNum(it[2]); achou = true; out.moeda = it[3]; }
    }
    if (achou) out.valorRC = soma;
    m = t.match(/Grp\.?\s*compradores\s+\d+\s*\|?\s*([A-ZÀ-Ú][a-zà-ú]+(?:\s+(?:de |da |do |dos )?(?!Telefone|Fone|Tel\b|E-?mail|Ramal)[A-ZÀ-Ú][a-zà-ú]+){1,4})/);
    if (m) out.responsavel = m[1].trim();
    return out;
  }

  /** Campos do cabeçalho que aparecem em texto livre (escopo, minuta, e-mails). */
  function camposEmTexto(st, d, texto) {
    const cab = st.cab;
    const set = (k, v, como) => { if (v && !val(cab[k])) cab[k] = F(v, `${d.nome} (${como})`); };
    let m = texto.match(/prazo de vig[eê]ncia[^.\n]{0,60}?(?:ser[aá] de|de)\s*0?(\d{1,3})\s*(?:\([^)]*\))?\s*(meses|m[eê]s|dias|anos)/i);
    if (m) set('prazo', `${parseInt(m[1], 10)} (${/dia/i.test(m[2]) ? 'dias' : /ano/i.test(m[2]) ? 'anos' : 'meses'})`, 'prazo de vigência no texto');
    // cláusulas de contrato/minuta (também em print colado no e-mail)
    const corrido = texto.replace(/\s*\n\s*/g, ' ');
    const clausula = d.tipo === 'CTR' || d.tipo === 'CC' || /data[- ]base,? que [eé]|presente CONTRATO/i.test(corrido);
    if (clausula) {
      m = corrido.match(/data[- ]base[^:]{0,25}?(?:que [eé])?\s*:?\s*[-—–]?\s*(\d{1,2})[./](\d{1,2})[./](\d{4})/i);
      if (m) set('dataBase', `${MESES[parseInt(m[2], 10) - 1]}-${m[3].slice(2)}`, 'data-base da minuta');
      m = !m && corrido.match(/data[- ]base[^:]{0,25}?(?:que [eé])?\s*:?\s*[-—–]?\s*(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\s*(?:\/|de)\s*(\d{4})/i);
      if (m) set('dataBase', `${m[1].toLowerCase()}-${m[2].slice(2)}`, 'data-base da cláusula');
      if (/irreajust[aá]ve/i.test(corrido) && /livre negocia/i.test(corrido)) set('reajuste', 'Livre Negociação', 'cláusula de reajuste');
      m = corrido.match(/reajustad[ao]s?\b.{0,80}?menor [ií]ndice (?:apurado )?(?:no per[ií]odo )?entre ([A-Z][A-Z0-9 ,-]{3,40}? e [A-Z][A-Z0-9-]{2,10})/);
      if (m) set('reajuste', `O preço será corrigido a cada 12 meses pelo menor índice apurado no período entre ${m[1].replace(/\s+/g, ' ')}.`, 'cláusula de reajuste');
      m = corrido.match(/tem por objeto (?:a presta[cç][aã]o de servi[cç]os de|o fornecimento de)?\s*\]?\s*([^\[\]]{15,300}?)\s*(?:\]|\.\s|\s\d+\s+Fazem parte)/i);
      if (m) set('objeto', m[1].replace(/^.{0,80}?\bdenominad[oa]\s+/i, '').replace(/^(a|o)\s+(?=[a-zà-ú])/i, '').replace(/\s*[—–]\s*/g, ' - ').trim(), 'objeto do contrato');
    }
    m = texto.match(/valor (?:estimado(?: pela [aá]rea requisitante)?|da RC|da requisi[cç][aã]o(?: de compra)?)[^:\n]{0,40}:\s*R\$\s*([\d.]+,\d{2})/i);
    if (m) set('valorRC', fmtBRL(parseNum(m[1])), 'valor citado no texto');
    m = texto.match(/\bRFQ\s*(?:n[º°o.]*)?\s*:?\s*(4\d{9}|\d{8})\b/i);
    if (m) set('rfq', m[1], 'RFQ citada no texto');
    m = texto.match(/gestor(?: do contrato)?\s*:\s*([A-ZÀ-Ú][A-Za-zÀ-ú]+(?:\s+(?:de |da |do |dos )?[A-ZÀ-Ú][A-Za-zÀ-ú]+){1,5})/);
    if (m) set('gestor', tituloCaso(m[1]), 'gestor citado no texto');
  }

  function aplicarTelaSAP(st, d, sap) {
    const fonte = `${d.nome} (${d.conteudo && d.conteudo.ocr ? 'leitura da imagem' : 'tela do SAP'})`;
    const set = (alvo, k, v) => { if (v != null && v !== '' && !val(alvo[k])) alvo[k] = F(v, fonte); };
    set(st.cab, 'numeroRC', sap.numeroRC);
    set(st.processo, 'rc', sap.numeroRC);
    if (sap.valorRC != null) { set(st.cab, 'valorRC', fmtBRL(sap.valorRC, sap.moeda && sap.moeda !== 'BRL' ? sap.moeda : 'BRL')); set(st.processo, 'valorEstimado', sap.valorRC); }
    set(st.cab, 'gestor', sap.gestor);
    set(st.cab, 'contrato', sap.contrato);
    set(st.cab, 'responsavel', sap.responsavel);
    if (sap.fornecedor && !st.fornecedores.length) garantirFornecedor(st, sap.fornecedor, fonte);
    if (sap.tac) {
      st.indicioAditivo = st.indicioAditivo || d.nome;
      set(st.aditivo, 'numero', sap.tac);
      set(st.aditivo, 'data', sap.dataTac);
      set(st.aditivo, 'novoTermino', sap.novoTermino);
      if (sap.classificacao) set(st.aditivo, 'classificacao', /prorroga/i.test(sap.classificacao) && !/valor|reajuste/i.test(sap.classificacao) ? 'Prazo' : sap.classificacao);
      if (sap.escopo && !/n[ãa]o houve/i.test(sap.escopo)) set(st.aditivo, 'escopo', sap.escopo);
      if (sap.justificativa && !st.textos.justificativaAditivo && !st.textos._justSAP) st.textos._justSAP = { v: sap.justificativa, fonte };
    }
  }

  function lerTCO(conteudo, nome) {
    const out = { pesoT: null, notas: [] };
    for (const sh of conteudo.sheets) {
      const r = acharLinhaCab(sh.rows, [/^PROPONENTES?$/, /PONTUACAO TECNICA/]);
      if (r < 0) continue;
      sh.rows.slice(0, r).forEach((row) => row.forEach((cel, i) => { if (/^PESO TECNICO$/.test(norm(cel)) && typeof row[i + 1] === 'number') out.pesoT = row[i + 1]; }));
      const cab = sh.rows[r].map(norm);
      const cp = cab.findIndex((x) => /^PROPONENTES?$/.test(x)), cn = cab.findIndex((x) => /^PONTUACAO TECNICA TOTAL/.test(x));
      for (let i = r + 1; i < sh.rows.length; i++) {
        const row = sh.rows[i] || [];
        if (!row[cp] || LIXO_MODELO.test(norm(row[cp]))) continue;
        const n = parseNum(row[cn]);
        if (n != null) out.notas.push({ empresa: String(row[cp]), nota: n <= 1 ? n * 100 : n, fonte: `${nome} › ${sh.name}!linha ${i + 1}` });
      }
    }
    return out;
  }

  function lerAvaliacaoTecnica(conteudo, nome) {
    const out = [];
    for (const sh of conteudo.sheets) {
      const rows = sh.rows;
      for (let r = 0; r < Math.min(rows.length, 40); r++) {
        const mapa = {};
        (rows[r] || []).forEach((cel, c) => {
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
    if (/DISPENSAD/.test(t)) return 'Dispensado';
    return String(v);
  }

  // ------------------------------------------------------------ tipo de processo e cabeçalho

  const CAMPOS_PADRAO = ['responsavel', 'gerencia', 'unidade', 'formalizacao', 'rescisao', 'multa', 'regime', 'explicacaoME'];
  const TIPOS_PROCESSO = { concorrencia: 'Concorrência', pretendido: 'Fornecedor pretendido', aditivo: 'Aditivo contratual' };

  function detectarTipoProcesso(st) {
    if (val(st.tipoProcesso) && st.tipoProcesso.fonte === 'editado') return;
    let t = 'concorrencia', fonte = 'mais de um fornecedor';
    const participantes = st.fornecedores.filter((f) => st.propostas.some((p) => p.fornecedorId === f.id) || val(f.apresentou) === 'SIM');
    if (st.indicioAditivo) { t = 'aditivo'; fonte = st.indicioAditivo; }
    else if (st.indicioPretendido) { t = 'pretendido'; fonte = st.indicioPretendido; }
    else if (participantes.length <= 1) { t = 'pretendido'; fonte = 'um único fornecedor no processo'; }
    st.tipoProcesso = F(t, fonte);
  }

  /** Completa o cabeçalho com o que dá para deduzir dos documentos (sem apagar o que já existe). */
  function preencherCabecalho(st) {
    const cab = st.cab;
    const set = (k, v, fonte) => { if (v != null && v !== '' && !val(cab[k])) cab[k] = F(v, fonte); };
    set('numeroRC', val(st.processo.rc), st.processo.rc && st.processo.rc.fonte);
    if (val(st.processo.valorEstimado) != null) set('valorRC', fmtBRL(parseNum(val(st.processo.valorEstimado))), st.processo.valorEstimado.fonte);
    if (val(cab.rfp)) set('rfq', val(cab.rfp), 'número da RFP (pasta / carta-convite)');
    const p = st.cabPadrao || {};
    for (const k of CAMPOS_PADRAO) if (p[k]) set(k, p[k], 'seu padrão salvo');
  }

  // ------------------------------------------------------------ equalização

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

  const UN_EQUIV = { UN: 'UN', UND: 'UN', UNID: 'UN', PC: 'PC', PCA: 'PC', PECA: 'PC', M: 'M', MT: 'M', MTS: 'M', M2: 'M2', 'M²': 'M2', KG: 'KG', SV: 'SV', SERV: 'SV', VB: 'VB', CJ: 'CJ', RL: 'RL', HRS: 'H', HR: 'H', H: 'H', HH: 'H' };
  const normUn = (u) => { const t = norm(u).replace(/\./g, ''); return UN_EQUIV[t] || t; };

  /** Propostas efetivas: as lidas dos documentos e, na falta delas, os totais do quadro de preço. */
  function propostasEfetivas(st) {
    const out = [...st.propostas];
    for (const q of st.quadroPrecos || []) {
      const f = acharFornecedor(st, q.empresa);
      if (!f || out.some((p) => p.fornecedorId === f.id)) continue;
      for (const [rod, v] of Object.entries(q.valores)) {
        out.push({ id: 'Q' + f.id + rod, fornecedorId: f.id, rodada: rod, arquivo: 'quadro de preço', confianca: 'quadro', itens: [],
          totalDeclarado: F(v, q.fonte), prazoEntrega: F(null), condPagamento: F(null), validade: F(null), frete: F(null), ajuste: { valor: 0, motivo: '' } });
      }
    }
    return out;
  }

  function propostaVigente(props, fid, rodadas, idx) {
    for (let i = idx; i >= 0; i--) {
      const p = props.find((x) => x.fornecedorId === fid && x.rodada === rodadas[i]);
      if (p) return { p, herdada: i !== idx, de: rodadas[i] };
    }
    return null;
  }

  /** Nota comercial pela fórmula da SMIN-IT-GSU-004 (0–100, antes do peso). */
  function notaComercial(valor, menor) {
    if (!(valor > 0) || !(menor > 0)) return null;
    const razao = valor / menor;
    return razao > 2 ? 0 : (1 - (razao - 1)) * 100;
  }

  function equalizar(st) {
    const cfg = st.config;
    const tol = Math.max(0, parseNum(cfg.tolerancia) ?? 0.5);
    const props = propostasEfetivas(st);
    const rodadas = ordenarRodadas(props.map((p) => p.rodada));
    const fids = st.fornecedores.filter((f) => props.some((p) => p.fornecedorId === f.id)).map((f) => f.id);
    const base = itensBase(st);
    const alertas = [];
    const nomeF = (fid) => val((st.fornecedores.find((f) => f.id === fid) || {}).nome) || fid;
    const porRodada = {};

    rodadas.forEach((rod, idx) => {
      const vig = {};
      for (const fid of fids) vig[fid] = propostaVigente(props, fid, rodadas, idx);
      const ativos = fids.filter((fid) => vig[fid]);
      const linhas = base.map((b) => ({ ...b, cel: {} }));
      const extras = {};
      for (const fid of ativos) {
        const { p } = vig[fid];
        const usados = new Set();
        linhas.forEach((ln) => {
          const cel = { flags: [] };
          ln.cel[fid] = cel;
          if (!p.itens.length) { cel.semItens = true; return; }
          const it = casarItem(ln, p.itens, usados);
          if (!it || !((it.preco || 0) > 0 || (it.total || 0) > 0)) { cel.faltante = true; cel.flags.push('faltante'); return; }
          const qtdF = it.qtd ?? ln.qtd;
          let preco = it.preco;
          if (preco == null && it.total != null && qtdF) preco = it.total / qtdF;
          cel.preco = preco; cel.qtdF = qtdF; cel.unF = it.un; cel.totalInf = it.total; cel.fonte = it.fonte;
          cel.totalCalc = preco != null && qtdF != null ? preco * qtdF : null;
          if (ln.un && it.un && normUn(ln.un) !== normUn(it.un)) cel.flags.push('unidade');
          if (ln.qtd != null && it.qtd != null && Math.abs(ln.qtd - it.qtd) > 1e-9) cel.flags.push('quantidade');
          if (cel.totalInf != null && cel.totalCalc != null && Math.abs(cel.totalInf - cel.totalCalc) > tol) cel.flags.push('total');
          cel.valor = preco != null && ln.qtd != null ? preco * ln.qtd : cel.totalCalc ?? cel.totalInf;
        });
        extras[fid] = p.itens.filter((_, i) => !usados.has(i));
      }

      linhas.forEach((ln) => {
        const precos = ativos.map((f) => ln.cel[f]).filter((c) => !c.faltante && !c.semItens && c.preco != null).map((c) => c.preco);
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
        const decl = parseNum(val(p.totalDeclarado));
        const semItens = !p.itens.length;
        const soma = semItens ? decl || 0 : linhas.reduce((s, ln) => s + (ln.cel[fid].valor || 0), 0);
        const somaInf = p.itens.reduce((s, it) => s + (it.total ?? (it.preco != null && it.qtd != null ? it.preco * it.qtd : 0)), 0);
        const ajuste = parseNum(p.ajuste && p.ajuste.valor) || 0;
        totais[fid] = {
          propostaId: p.id, herdada, de, somaItens: soma, ajuste, equalizado: soma + ajuste, semItens,
          declarado: decl, somaInformada: somaInf, nItens: p.itens.length,
          faltantes: linhas.filter((ln) => ln.cel[fid].faltante).length,
          divergeDeclarado: !semItens && decl != null && Math.abs(decl - somaInf) > tol,
          extras: extras[fid] || [],
          condicoes: { prazoEntrega: val(p.prazoEntrega), condPagamento: val(p.condPagamento), validade: val(p.validade), frete: val(p.frete) },
          canal: p.confianca === 'quadro' ? 'quadro de preço' : /\.eml|\.msg/i.test(p.arquivo || '') ? 'E-MAIL' : 'PORTAL ME / E-MAIL',
        };
      }
      // posição na rodada (menor valor = 1º)
      [...ativos].sort((a, b) => totais[a].equalizado - totais[b].equalizado).forEach((fid, i) => { totais[fid].posicao = i + 1; });
      porRodada[rod] = { rodada: rod, fornecedores: ativos, linhas, totais };
    });

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
        if (t.semItens) alertas.push({ nivel: 'baixo', tipo: 'semItens', fid, rodada: rod, msg: `${nomeF(fid)} — ${nomeRodada(rod)}: só o valor total (${fmtBRL(t.declarado)}), sem itens.` });
        if (t.divergeDeclarado) alertas.push({ nivel: 'medio', tipo: 'totalGeral', fid, rodada: rod,
          msg: `${nomeF(fid)}: total geral informado (${fmtBRL(t.declarado)}) difere da soma dos itens (${fmtBRL(t.somaInformada)}).` });
        if (t.extras.length) alertas.push({ nivel: 'baixo', tipo: 'extra', fid, rodada: rod,
          msg: `${nomeF(fid)} cotou ${t.extras.length} item(ns) que não estão na RC: ${t.extras.map((e) => e.descricao || e.item).join('; ').slice(0, 120)}.` });
      }
    });

    const ultima = rodadas[rodadas.length - 1];
    const negociacao = {};
    for (const fid of fids) {
      const serie = rodadas.map((r) => {
        const t = porRodada[r].totais[fid];
        return t ? { rodada: r, total: t.equalizado, herdada: t.herdada, posicao: t.posicao } : { rodada: r, total: null };
      });
      const validos = serie.filter((s) => s.total != null);
      const inicial = validos.length ? validos[0].total : null;
      const final = validos.length ? validos[validos.length - 1].total : null;
      negociacao[fid] = { serie, inicial, final, saving: inicial != null ? inicial - final : null, savingPct: inicial ? (inicial - final) / inicial : null };
    }

    // ponderação técnica/comercial — fórmula da aba "4 - TCO" (SMIN-IT-GSU-004)
    const pT = Math.max(0, parseNum(cfg.pesoTecnico) ?? 0), pC = Math.max(0, parseNum(cfg.pesoComercial) ?? 0);
    const somaP = pT + pC || 1;
    const algumNT = st.fornecedores.some((f) => parseNum(val(f.nt)) != null);
    const usaTec = algumNT && pT > 0 && fids.length > 1;
    const R = ultima ? porRodada[ultima] : null;
    const classificacao = [];
    if (R) {
      const reprov = (f) => norm(val(f.statusTecnico)) === 'REPROVADO' || norm(val(f.qResultado)) === 'REPROVADO';
      const aptos = R.fornecedores.filter((fid) => !reprov(st.fornecedores.find((f) => f.id === fid)));
      const vals = aptos.map((fid) => R.totais[fid].equalizado).filter((v) => v > 0);
      const menor = vals.length ? Math.min(...vals) : null;
      for (const fid of R.fornecedores) {
        const f = st.fornecedores.find((x) => x.id === fid);
        const reprovado = reprov(f);
        const total = R.totais[fid].equalizado;
        let nt = parseNum(val(f.nt));
        if (nt != null && nt <= 1) nt *= 100;
        const nc = !reprovado ? notaComercial(total, menor) : null;
        let nf = null;
        if (nc != null) nf = usaTec ? (nt != null ? (pT * nt + pC * nc) / somaP : null) : nc;
        const motivos = [];
        if (reprovado) motivos.push('reprovado na qualificação');
        if (usaTec && nt == null && !reprovado) motivos.push('sem nota técnica');
        const hom = situacaoHomologacao(f);
        if (hom.nivel === 'ruim') motivos.push(hom.texto.toLowerCase());
        classificacao.push({ fid, nome: val(f.nome), total, nt, nc, nf, ntPond: nt != null ? (nt * pT) / somaP : null, ncPond: nc != null ? (nc * pC) / somaP : null, reprovado, motivos, hom });
      }
      classificacao.sort((a, b) => (b.nf ?? -1) - (a.nf ?? -1) || a.total - b.total);
      let pos = 1;
      for (const c of classificacao) c.posicao = c.nf != null ? pos++ : null;
    }
    const venc = classificacao.find((c) => c.posicao === 1) || null;
    const vencedor = venc ? { ...venc, negociacao: negociacao[venc.fid] } : null;
    const estimado = parseNum(val(st.processo.valorEstimado));
    // impacto da ponderação: quanto o 1º colocado custa a mais que o menor preço
    const menorFinal = R ? Math.min(...R.fornecedores.map((f) => R.totais[f].equalizado).filter((v) => v > 0)) : null;
    const resumo = {
      rodadas, ultima, usaTec, pT, pC,
      custoEvitado: vencedor ? negociacao[vencedor.fid].saving : null,
      custoEvitadoPct: vencedor ? negociacao[vencedor.fid].savingPct : null,
      savingNegociacao: vencedor ? negociacao[vencedor.fid].saving : null,
      savingNegociacaoPct: vencedor ? negociacao[vencedor.fid].savingPct : null,
      savingEstimado: vencedor && estimado ? estimado - vencedor.total : null,
      savingEstimadoPct: vencedor && estimado ? (estimado - vencedor.total) / estimado : null,
      impactoPonderacao: vencedor && menorFinal ? vencedor.total / menorFinal - 1 : null,
    };
    return { rodadas, porRodada, base, fids, alertas, negociacao, classificacao, vencedor, resumo, propostas: props };
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

  // ------------------------------------------------------------ aditivo

  /** Nova linha do "Resumo de evolução do contrato" a partir do histórico e dos dados do aditivo. */
  function calcularAditivo(st) {
    let ev = st.evolucao || [];
    const a = st.aditivo || {};
    const numInf = parseNum(val(a.numero));
    let substitui = false;
    if (numInf && ev.some((r) => parseNum(r.tac) === numInf)) { ev = ev.filter((r) => parseNum(r.tac) == null || parseNum(r.tac) < numInf); substitui = true; }
    const ult = ev[ev.length - 1] || null;
    const inicial = ev[0] || null;
    const numero = parseNum(val(a.numero)) || (ult ? (parseNum(ult.tac) || ev.length - 1) + 1 : 1);
    const aditado = parseNum(val(a.valorAditado)) || 0;
    const totalAnt = ult ? ult.total : parseNum(val(st.cab.valorContratado));
    const total = totalAnt != null ? totalAnt + aditado : null;
    const base = inicial && inicial.total ? inicial.total : null;
    const inicio = val(a.inicio) || (ult && ult.inicio) || '';
    const terminoAnt = ult ? ult.termino : '';
    const termino = val(a.novoTermino) || terminoAnt;
    const prazoAnt = ult ? ult.prazo : null;
    const prazo = mesesEntre(inicio, termino) ?? prazoAnt;
    return {
      numero, rotulo: `${numero}º`, data: val(a.data) || fmtData(new Date()), aditado, total, totalAnt,
      variacao: base && total ? total / base : null, prazo, prazoAnt, inicio, termino, terminoAnt,
      classificacao: val(a.classificacao) || '', substitui,
    };
  }

  // ------------------------------------------------------------ pendências

  function pendencias(st, eq) {
    const docs = st.documentos;
    const tem = (fn) => docs.some((d) => d.tipo && d.tipo !== 'IGNORAR' && d.status !== 'duplicado' && fn(d));
    const out = [];
    const add = (grupo, desc, ok, obrig = true, dica = '') => out.push({ grupo, desc, ok, obrig, dica });
    const tipo = val(st.tipoProcesso);
    if (tipo === 'aditivo') {
      add('Aditivo', 'De acordo / justificativa da área', tem((d) => d.tipo === 'JUST' || d.tipo === 'COM'));
      add('Aditivo', 'Histórico do contrato (RH do aditivo anterior)', (st.evolucao || []).length > 0, true, 'Suba também o RH do aditivo anterior.');
      add('Aditivo', 'Nova data de término / valor do aditivo', !!(val(st.aditivo.novoTermino) || parseNum(val(st.aditivo.valorAditado))));
    } else {
      add('Processo', 'Requisição de compra / planilha de quantidades', tem((d) => d.tipo === 'RC' || d.tipo === 'PQ'));
      add('Processo', 'Carta-convite', tem((d) => d.tipo === 'CC'), false);
      if (tipo === 'concorrencia') add('Processo', 'Vendor list', (st.vendorList || []).length > 0, false, 'Aba "2 - Vendor List" da SMIN-IT-GSU-004.');
      add('Qualificação', 'Análise técnica', tem((d) => d.tipo === 'QT' || d.tipo === 'AT') || st.fornecedores.some((f) => val(f.qTec)));
      add('Qualificação', 'Análise de compliance', tem((d) => d.tipo === 'QC') || st.fornecedores.some((f) => val(f.qComp)), false);
      for (const f of st.fornecedores) {
        if (!st.propostas.some((p) => p.fornecedorId === f.id) && !(st.quadroPrecos || []).some((q) => acharFornecedor(st, q.empresa) === f)) continue;
        const n = val(f.nome);
        add(n, 'Proposta técnica', tem((d) => d.tipo === 'PT' && (d.fornecedorId === f.id || st.fornecedores.length === 1)), false);
        add(n, 'Proposta comercial', true);
        if (eq && eq.resumo.usaTec && val(f.nt) == null) add(n, 'Nota técnica', false, true, 'Informe a nota na Conferência.');
      }
      if (eq) for (const r of eq.rodadas.slice(1)) add('Negociação', `Registro da negociação — ${nomeRodada(r)}`, st.atas.some((a) => a.rodada === r) || tem((d) => d.tipo === 'COM' && /6/.test(d.caminho)), false);
    }
    for (const [k, rot] of [['numeroRC', 'Nº da RC'], ['valorRC', 'Valor da RC'], ['gestor', 'Gestor do contrato'], ['responsavel', 'Responsável pelo processo'], ['condPagamento', 'Condição de pagamento']]) {
      if (!val(st.cab[k])) add('Cabeçalho do RH', rot, false, true, 'Preencha na Conferência.');
    }
    const pend = docs.filter((d) => d.status === 'pendente').length;
    if (pend) add('Documentos', `${pend} documento(s) sem classificação`, false, false, 'Indique o tipo na etapa Documentos.');
    if (eq) {
      const altos = eq.alertas.filter((a) => a.nivel === 'alto' && a.rodada === eq.resumo.ultima).length;
      if (altos) add('Equalização', `${altos} alerta(s) importante(s) na rodada final`, false, false, 'Revise na etapa Equalização.');
    }
    return out;
  }

  // ------------------------------------------------------------ textos do RH

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
        if (g) partes.unshift({ t: i === 1 && g === 1 ? 'mil' : ate999(g) + (i ? ' ' + (g === 1 ? grupos[i][0] : grupos[i][1]) : ''), g });
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

  const nomeRH = (st, f) => { const sap = val(f.codigoSap) || ((st.vendorList || []).find((v) => acharFornecedor({ fornecedores: [f] }, v.empresa) === f) || {}).codigoSap; return (sap ? sap + ' - ' : '') + String(val(f.nome) || '').toUpperCase(); };

  /** Textos sugeridos para cada seção do RH, no estilo dos RH da Samarco. */
  function textosSugeridos(st, eq) {
    const tipo = val(st.tipoProcesso);
    const v = eq && eq.vencedor;
    const fv = v ? st.fornecedores.find((f) => f.id === v.fid) : st.fornecedores[0];
    const nomeV = fv ? nomeRH(st, fv) : 'XXXXXXXXX';
    const T = {};
    const just = st.textos._justificativa ? val(st.textos._justificativa) : '';
    if (tipo === 'pretendido') T.estrategia = `A contratação será feita com fornecedor pretendido, conforme justificativa apresentada pelo requisitante na RC${just ? ':\n“' + resumir(just, 1500) + '”' : '.'}`;
    else T.estrategia = `Contratação conduzida por concorrência${val(st.processo.objeto) ? ' para ' + val(st.processo.objeto) : ''}. ${st.vendorList.length ? `O vendor list foi composto por ${st.vendorList.length} empresa(s), conforme tabela do item 2.` : ''}`.trim();
    T.vendorList = tipo === 'pretendido' ? 'O vendor list é composto exclusivamente pelo fornecedor pretendido, conforme item 1.' : st.vendorList.length ? `Foram consideradas ${st.vendorList.length} empresas no vendor list, conforme quadro abaixo.` : '';
    const cc = st.cartaConvite;
    const partic = st.fornecedores.filter((f) => val(f.apresentou) === 'SIM' || (eq && eq.fids.includes(f.id)));
    T.cartaConvite = cc ? `A carta convite foi enviada por e-mail em ${cc.data}${partic.length ? `, e ${partic.length === 1 ? 'a empresa apresentou proposta' : partic.length + ' empresas apresentaram proposta'}` : ''}.` : '';
    const qt = st.emails.filter((e) => e.tipo === 'QT');
    const statusTec = st.fornecedores.map((f) => val(f.qTec) || val(f.statusTecnico)).filter(Boolean);
    T.analiseTecnica = qt.length ? `${/REPROV/.test(norm(statusTec.join(' '))) ? 'Avaliada' : 'Aprovada'} pela área técnica${qt[0].de ? ' (' + qt[0].de.replace(/<.*?>/g, '').trim() + ')' : ''} em ${qt[0].data}, conforme e-mail anexo na pasta do processo e conforme Procedimento Operacional nº SMIN-PO-GSU-013 – Avaliação e Qualificação de Fornecedores.`
      : statusTec.length ? `Resultado da análise técnica: ${st.fornecedores.filter((f) => val(f.qTec) || val(f.statusTecnico)).map((f) => `${val(f.nome)} – ${String(val(f.qTec) || val(f.statusTecnico)).toLowerCase()}`).join('; ')}.` : '';
    const resumoQ = (k, seTodosOk, seDispensa) => {
      const fs = st.fornecedores.filter((f) => val(f[k]));
      if (!fs.length) return '';
      const vs = fs.map((f) => norm(val(f[k])));
      if (vs.every((x) => /DISPENS|NAO APLIC/.test(x))) return seDispensa;
      if (vs.every((x) => /APROVAD/.test(x))) return seTodosOk(fs.length);
      return fs.map((f) => `${val(f.nome)}: ${String(val(f[k])).toLowerCase()}`).join('; ') + '.';
    };
    T.sst = resumoQ('qSeg', (n) => n > 1 ? `Aprovada para as ${n} empresas qualificadas.` : 'Aprovada.', 'Não aplicável.') || 'Não aplicável.';
    T.financeira = resumoQ('qFin', (n) => n > 1 ? `Aprovada para as ${n} empresas qualificadas.` : 'Aprovada.', 'Dispensada.') || 'Não aplicável.';
    T.compliance = resumoQ('qComp', () => 'Aprovada pela Gerência de Compliance, conforme evidência anexa na pasta do processo.', 'Dispensada.');
    if (eq && eq.rodadas.length) {
      const ini = eq.rodadas[0], fim = eq.resumo.ultima;
      T.apresentacao = `As propostas comerciais foram recebidas${st.emails.some((e) => e.tipo === 'COM') ? ' por e-mail / Mercado Eletrônico' : ''}${val(st.cab.rfq) ? ' em atendimento à RFQ ' + val(st.cab.rfq) : ''}. ${eq.rodadas.map((r) => `${nomeRodada(r)}: ${eq.fids.map((f) => { const t = eq.porRodada[r].totais[f]; return t && !t.herdada ? `${val(st.fornecedores.find((x) => x.id === f).nome)} ${fmtBRL(t.equalizado)}` : null; }).filter(Boolean).join('; ')}`).join('. ')}.`;
      const r = eq.resumo;
      T.negociacao = v ? (eq.rodadas.length > 1 || (r.custoEvitado || 0) > 0
        ? `Com o objetivo de obter as melhores condições comerciais, foi realizada negociação com ${eq.fids.length > 1 ? 'os proponentes' : val(fv.nome)}. Como resultado, o valor ${eq.fids.length > 1 ? 'do 1º colocado ' : ''}passou de ${fmtBRL(v.negociacao.inicial)} (${nomeRodada(ini).toLowerCase()}) para ${fmtBRL(v.total)} (${nomeRodada(fim).toLowerCase()}), o que representa custo evitado de ${fmtBRL(r.custoEvitado)} (${fmtPct(r.custoEvitadoPct)}).`
        : `Não houve rodadas de negociação; a proposta de ${val(fv.nome)} foi mantida em ${fmtBRL(v.total)}.`) : '';
      const cond = v && eq.porRodada[fim].totais[v.fid].condicoes.condPagamento;
      if (cond) T.negociacao += ` Condição de pagamento: ${cond}.`;
      T.ponderacao = r.usaTec ? `Aplicada a ponderação técnica e comercial com pesos de ${r.pT}% técnico e ${r.pC}% comercial (SMIN-IT-GSU-004). ${eq.classificacao.filter((c) => c.posicao).map((c) => `${c.posicao}º ${c.nome}: ${fmtNum(c.nf, 2)} pontos`).join('; ')}.${r.impactoPonderacao > 0.0001 ? ` O impacto de valor da ponderação é de ${fmtPct(r.impactoPonderacao)} sobre o menor preço.` : ''}` : 'Não aplicável.';
    }
    T.referencial = 'Não há referencial comparativo de preços para esta contratação.';
    T.conclusao = `Com base no histórico do processo apresentado anteriormente e considerando a qualificação do Fornecedor atendendo aos requisitos estabelecidos para o referido processo, prosseguimos com a contratação da empresa ${nomeV}.`;
    // aditivo
    if (tipo === 'aditivo') {
      const ad = calcularAditivo(st);
      const a = st.aditivo;
      T.justificativaAditivo = st.textos._justSAP ? val(st.textos._justSAP) : just ? resumir(just, 1500) : '';
      const partes = [];
      if (ad.termino && ad.terminoAnt && ad.termino !== ad.terminoAnt) partes.push(`prorroga a vigência do contrato nº ${val(st.cab.contrato) || ''} de ${ad.terminoAnt} para ${ad.termino} (de ${ad.prazoAnt} para ${ad.prazo} meses)`);
      if (ad.aditado) partes.push(`acrescenta ${fmtBRL(ad.aditado)} ao valor do contrato, que passa de ${fmtBRL(ad.totalAnt)} para ${fmtBRL(ad.total)}`);
      if (val(a.reajuste)) partes.push(`reajusta em ${val(a.reajuste)} os preços unitários vigentes`);
      T.consideracoes = partes.length ? `O presente aditivo ${partes.join(' e ')}.${val(st.processo.rc) ? ` Para sua formalização foi aberta a Requisição de Compra nº ${val(st.processo.rc)}.` : ''}` : '';
    }
    return T;
  }

  function justificativaSugerida(st, eq) {
    const T = textosSugeridos(st, eq);
    return [T.negociacao, T.conclusao].filter(Boolean).join(' ');
  }

  /** Valor efetivo de um texto do RH: o editado pelo comprador ou o sugerido. */
  function textoRH(st, eq, k, sug) {
    const e = st.textos[k];
    if (e != null && String(e).trim() !== '') return String(e);
    return (sug || textosSugeridos(st, eq))[k] || '';
  }

  /** Dados prontos para os modelos de RH (Word Samarco e PDF FLOW). */
  function dadosRH(st, eq) {
    MOEDA = st.moeda || 'BRL';
    const p = st.processo;
    const tipo = val(st.tipoProcesso) || 'concorrencia';
    const r = eq ? eq.resumo : {};
    const v = eq && eq.vencedor;
    const R = eq && r.ultima ? eq.porRodada[r.ultima] : null;
    const nomeF = (fid) => val((st.fornecedores.find((f) => f.id === fid) || {}).nome);
    const sug = textosSugeridos(st, eq);
    const tx = (k) => textoRH(st, eq, k, sug);
    const fornecedores = eq ? eq.classificacao.map((c) => {
      const f = st.fornecedores.find((x) => x.id === c.fid);
      const ng = eq.negociacao[c.fid];
      const cond = R.totais[c.fid].condicoes;
      return {
        posicao: c.posicao ? `${c.posicao}º` : 'Desclass.', nome: c.nome, cnpj: val(f.cnpj) || '', codigoSap: val(f.codigoSap) || '',
        homologacao: c.hom.texto, statusTecnico: val(f.statusTecnico) || '—',
        notaTecnica: c.nt != null ? fmtNum(c.nt, 2) : '—', notaComercial: c.nc != null ? fmtNum(c.nc, 2) : '—',
        notaFinal: c.nf != null ? fmtNum(c.nf, 2) : '—',
        valorInicial: fmtBRL(ng.inicial), valorFinal: fmtBRL(ng.final), saving: fmtBRL(ng.saving), savingPct: fmtPct(ng.savingPct),
        prazoEntrega: cond.prazoEntrega != null ? String(cond.prazoEntrega) : '—',
        condPagamento: cond.condPagamento != null ? String(cond.condPagamento) : '—',
        frete: cond.frete != null ? String(cond.frete) : '—', validade: cond.validade != null ? String(cond.validade) : '—',
        observacao: c.motivos.join('; '),
      };
    }) : [];
    const rodadas = eq ? eq.rodadas.map((rod) => ({
      rodada: nomeRodada(rod),
      valores: eq.fids.map((fid) => { const t = eq.porRodada[rod].totais[fid]; return { fornecedor: nomeF(fid), valor: t ? fmtBRL(t.equalizado) + (t.herdada ? ' (mantida)' : '') : '—' }; }),
      ata: (st.atas.find((a) => a.rodada === rod) || {}).arquivo || '',
    })) : [];
    const itensVencedor = v && R ? R.linhas.map((ln) => {
      const c = ln.cel[v.fid];
      return { item: ln.item, codigo: ln.codigo || '', descricao: ln.descricao, un: ln.un, qtd: fmtQtd(ln.qtd),
        precoUnit: fmtBRL(c.preco), total: fmtBRL(c.valor), obs: c.preenchido ? 'equalizado' : c.flags.length ? c.flags.join(', ') : '' };
    }).filter((x) => x.total !== '—') : [];
    const anexos = st.documentos.filter((d) => d.tipo && d.tipo !== 'IGNORAR' && d.status !== 'duplicado' && !d.anexoDe).map((d) => ({
      nome: d.nome, tipo: TIPOS[d.tipo] + (d.fornecedorId ? ' — ' + nomeF(d.fornecedorId) : '') + (d.rodada && TIPO_COM_RODADA[d.tipo] ? ' — ' + nomeRodada(d.rodada) : ''),
    }));
    const pend = pendencias(st, eq).filter((x) => !x.ok).map((x) => ({ grupo: x.grupo, desc: x.desc, dica: x.dica || '' }));
    const fv = v ? st.fornecedores.find((f) => f.id === v.fid) : st.fornecedores[0];
    const cab = cabecalhoFinal(st, eq);
    return {
      tipo, tipoNome: TIPOS_PROCESSO[tipo],
      rc: val(cab.numeroRC) || val(p.rc) || '', objeto: val(p.objeto) || st.nomeProcesso || '', requisitante: val(cab.gerenciaRequisitante) || val(p.requisitante) || '',
      centroCusto: val(p.centroCusto) || '', comprador: val(cab.responsavel) || val(p.comprador) || '',
      dataRC: p.dataRC && val(p.dataRC) ? String(val(p.dataRC)) : '',
      dataRH: st.rh.dataRH || fmtData(new Date()),
      valorEstimado: fmtBRL(parseNum(val(p.valorEstimado))),
      qtdFornecedores: String(eq ? eq.fids.length : st.fornecedores.length), qtdRodadas: String(eq ? eq.rodadas.length : 0),
      rodadaFinal: nomeRodada(r.ultima),
      pesoTecnico: String(r.usaTec ? r.pT : 0), pesoComercial: String(r.usaTec ? r.pC : 100),
      criterio: r.usaTec ? `Técnica e preço (${r.pT}% técnico / ${r.pC}% comercial)` : 'Menor preço equalizado',
      fornecedores, rodadas, itensVencedor, anexos, pendencias: pend, temPendencias: pend.length > 0,
      vencedor: fv ? String(val(fv.nome)) : '', vencedorRH: fv ? nomeRH(st, fv) : '', vencedorCnpj: fv ? val(fv.cnpj) || '' : '',
      valorFinal: v ? fmtBRL(v.total) : '', valorFinalExtenso: v ? extenso(v.total) : '',
      valorInicialVencedor: v ? fmtBRL(v.negociacao.inicial) : '',
      custoEvitado: fmtBRL(r.custoEvitado), custoEvitadoPct: fmtPct(r.custoEvitadoPct),
      savingNegociacao: fmtBRL(r.custoEvitado), savingNegociacaoPct: fmtPct(r.custoEvitadoPct),
      savingEstimado: fmtBRL(r.savingEstimado), savingEstimadoPct: fmtPct(r.savingEstimadoPct),
      prazoEntregaVencedor: v ? (R.totais[v.fid].condicoes.prazoEntrega ?? '—') + '' : '',
      condPagamentoVencedor: v ? (R.totais[v.fid].condicoes.condPagamento ?? '—') + '' : '',
      justificativa: st.rh.justificativa || [tx('negociacao'), tx('conclusao')].filter(Boolean).join(' '),
      observacoes: st.rh.observacoes || '',
      alertas: eq ? eq.alertas.filter((a) => a.rodada === r.ultima).map((a) => ({ msg: a.msg })) : [],
      cab: Object.fromEntries(Object.entries(cab).map(([k, f]) => [k, val(f) == null ? '' : String(val(f))])),
      textos: Object.fromEntries(['estrategia', 'vendorList', 'cartaConvite', 'analiseTecnica', 'sst', 'financeira', 'compliance', 'apresentacao', 'negociacao', 'ponderacao', 'referencial', 'conclusao', 'justificativaAditivo', 'consideracoes'].map((k) => [k, tx(k)])),
    };
  }

  /** Cabeçalho completo do RH (o que está em st.cab + o que é calculado). */
  function cabecalhoFinal(st, eq) {
    const cab = { ...st.cab };
    const set = (k, v, fonte) => { if (v != null && v !== '' && !(cab[k] && cab[k].fonte === 'editado')) cab[k] = F(v, fonte); };
    if (!val(cab.objeto) && val(st.processo.objeto)) cab.objeto = st.processo.objeto;
    const tipo = val(st.tipoProcesso);
    const v = eq && eq.vencedor;
    const fv = v ? st.fornecedores.find((f) => f.id === v.fid) : null;
    if (fv) set('fornecedorRH', nomeRH(st, fv), 'calculado: 1º colocado');
    else if (st.fornecedores.length === 1 && !val(cab.fornecedorRH)) set('fornecedorRH', nomeRH(st, st.fornecedores[0]), 'fornecedor do processo');
    set('dataDocumento', st.rh.dataRH || fmtData(new Date()), 'data do RH');
    if (tipo === 'aditivo') {
      const ad = calcularAditivo(st);
      set('valorAditivo', fmtBRL(ad.aditado), 'calculado: aditivo');
      if (ad.total != null) set('valorContratado', fmtBRL(ad.total), 'calculado: histórico + aditivo');
      if (ad.inicio && ad.termino) set('vigencia', `Início em ${ad.inicio} e término em ${ad.termino}`, 'calculado: aditivo');
      if (ad.prazo) set('prazo', `${ad.prazo} (meses)`, 'calculado: aditivo');
      if (ad.classificacao) set('classificacao', `Aditivo Contratual de ${ad.classificacao}`, 'aditivo');
      if (!val(cab.custoEvitado)) set('custoEvitado', 'NA', 'padrão para aditivo');
    } else if (v) {
      set('valorContratado', fmtBRL(v.total), 'calculado: valor final do 1º colocado');
      const r = eq.resumo;
      set('custoEvitado', r.custoEvitado > 0.004 ? `${fmtBRL(r.custoEvitado)} – (${fmtPct(r.custoEvitadoPct)})` : 'NA', 'calculado: proposta inicial − final');
      const cond = eq.porRodada[r.ultima].totais[v.fid].condicoes.condPagamento;
      if (cond && !val(cab.condPagamento)) set('condPagamento', cond, 'proposta do 1º colocado');
      if (!val(cab.classificacao)) set('classificacao', { concorrencia: 'Concorrencial', pretendido: 'Pretendido' }[tipo] || '', 'tipo de processo');
    }
    return cab;
  }

  return {
    norm, F, val, parseNum, parseDate, fmtData, fmtBRL, fmtNum, fmtQtd, fmtPct, colLetra, mesesEntre, MESES,
    normRodada, ordemRodada, ordenarRodadas, nomeRodada, TIPOS, TIPO_COM_FORNECEDOR, TIPO_COM_RODADA, TIPOS_PROCESSO,
    classificar, kvPlanilha, kvTexto, itensPlanilha, itensTexto, itemDeLinha, acharCabecalho, itensDeLinhas,
    lerVendorList, lerQualificacoes, lerQuadroPrecos, lerCabecalhoRH, lerEvolucao, dadosDoNome, ROTULOS_CAB,
    estadoVazio, montarEstado, adicionarDocumentos, aplicarDocumento, resumoDoc, acharFornecedor, garantirFornecedor,
    detectarTipoProcesso, preencherCabecalho, cabecalhoFinal, lerTelaSAP, camposEmTexto, CAMPOS_PADRAO, calcularAditivo, notaComercial, propostasEfetivas,
    equalizar, situacaoHomologacao, pendencias, extenso, justificativaSugerida, textosSugeridos, textoRH, dadosRH, normUn, nomeRH,
  };
});
