/*
 * FLOW Express — preenche o Relatório de Homologação no formulário da Samarco
 * (SMIN-FO-GSU-002 / 059 / 004, ou um RH anterior usado como base).
 *  - Cabeçalho: escreve cada campo ao lado do seu rótulo.
 *  - Contratação: substitui o conteúdo das seções 1 a 6 por texto e tabelas.
 *  - Aditivo: acrescenta a linha no "Resumo de evolução" e o bloco do novo aditivo.
 * Tabelas no padrão visual dos RH (Arial 8, cabeçalho azul-claro C5D9F1).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.RHSamarco = factory(root.FlowEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const val = E.val, norm = E.norm;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------ DOM helpers
  const filhos = (el, nome) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.localName === nome);
  const todos = (el, nome) => Array.from(el.getElementsByTagNameNS(W, nome));
  const texto = (el) => todos(el, 't').map((t) => t.textContent).join('');
  const textoPars = (el) => todos(el, 'p').map(texto);

  function fragmento(ctx, xml) {
    const d = new ctx.DOMParser().parseFromString(`<w:body xmlns:w="${W}">${xml}</w:body>`, 'application/xml');
    return Array.from(d.documentElement.childNodes).filter((n) => n.nodeType === 1).map((n) => ctx.doc.importNode(n, true));
  }

  // ------------------------------------------------------------ construção de XML
  function rPr({ negrito, tam = 20, cor, italico } = {}) {
    return `<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${negrito ? '<w:b/><w:bCs/>' : ''}${italico ? '<w:i/>' : ''}<w:color w:val="${cor || 'auto'}"/><w:sz w:val="${tam}"/><w:szCs w:val="${tam}"/></w:rPr>`;
  }
  function runs(txt, opt) {
    return String(txt).split('\n').map((linha, i) => `${i ? `<w:r>${rPr(opt)}<w:br/></w:r>` : ''}<w:r>${rPr(opt)}<w:t xml:space="preserve">${esc(linha)}</w:t></w:r>`).join('');
  }
  function par(ctx, txt, opt = {}) {
    const estilo = ctx.estiloDefault ? `<w:pStyle w:val="${ctx.estiloDefault}"/>` : '';
    const partes = Array.isArray(txt) ? txt : [{ t: txt, negrito: opt.negrito }];
    return `<w:p><w:pPr>${estilo}<w:spacing w:before="${opt.antes ?? 60}" w:after="${opt.depois ?? 60}"/><w:jc w:val="${opt.alinhar || 'both'}"/></w:pPr>${partes.map((p) => runs(p.t, { ...opt, negrito: p.negrito })).join('')}</w:p>`;
  }
  const pars = (ctx, txt, opt) => String(txt || '').split(/\n{1,}/).map((s) => s.trim()).filter(Boolean).map((s) => par(ctx, s, opt)).join('');

  /**
   * Tabela no padrão dos RH. linhas: [[{t, span, vm:'ini'|'cont', cab, negrito, alinhar, fundo}]]
   */
  function tabela(larguras, linhas) {
    const total = larguras.reduce((a, b) => a + b, 0);
    const grid = larguras.map((w) => `<w:gridCol w:w="${w}"/>`).join('');
    const trs = linhas.map((cels, ri) => {
      let col = 0;
      const tcs = cels.map((c) => {
        const span = c.span || 1;
        const w = larguras.slice(col, col + span).reduce((a, b) => a + b, 0);
        col += span;
        const fundo = c.fundo || (c.cab ? 'C5D9F1' : null);
        const tcPr = `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}${c.vm === 'ini' ? '<w:vMerge w:val="restart"/>' : c.vm === 'cont' ? '<w:vMerge/>' : ''}${fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fundo}"/>` : ''}<w:vAlign w:val="center"/></w:tcPr>`;
        const al = c.alinhar || (c.cab ? 'center' : 'left');
        const conteudo = c.vm === 'cont' ? '' : runs(c.t == null ? '' : c.t, { negrito: c.cab || c.negrito, tam: 16 });
        return `<w:tc>${tcPr}<w:p><w:pPr><w:spacing w:before="20" w:after="20"/><w:jc w:val="${al}"/></w:pPr>${conteudo}</w:p></w:tc>`;
      }).join('');
      const cab = cels.some((c) => c.cab) && ri < 3 ? '<w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>';
      return `<w:tr>${cab}${tcs}</w:tr>`;
    }).join('');
    const borda = (n, sz) => `<w:${n} w:val="single" w:sz="${sz}" w:space="0" w:color="000000"/>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="${total}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders>${borda('top', 8)}${borda('left', 8)}${borda('bottom', 8)}${borda('right', 8)}${borda('insideH', 4)}${borda('insideV', 4)}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="57" w:type="dxa"/><w:right w:w="57" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${trs}</w:tbl>`;
  }
  const espaco = () => '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p>';

  // ------------------------------------------------------------ cabeçalho
  const CAMPOS = [
    ['objeto', /^OBJETO\s*:/, 'OBJETO:'],
    ['contrato', /^CONTRATO\/PEDIDO DE COMPRA/, 'CONTRATO/PEDIDO DE COMPRA Nº'],
    ['gerencia', /^GERENCIA(?! REQUISITANTE)/, 'GERÊNCIA:'],
    ['fornecedorRH', /^FORNECEDOR/, 'FORNECEDOR:'],
    ['dataDocumento', /^DATA DOCUMENTO/, 'DATA DOCUMENTO:'],
    ['valorRC', /^VALOR DA REQUISICAO/, 'VALOR DA REQUISIÇÃO DE COMPRA:'],
    ['numeroRC', /^N DA REQUISICAO/, 'Nº DA REQUISIÇÃO DE COMPRA:'],
    ['valorAditivo', /^VALOR DO ADITIVO/, 'VALOR DO ADITIVO:'],
    ['valorContratado', /^VALOR TOTAL CONTRATADO/, 'VALOR TOTAL CONTRATADO:'],
    ['valorContratado', /^NOVO VALOR TOTAL/, 'NOVO VALOR TOTAL DO CONTRATO:'],
    ['custoEvitado', /^CUSTO EVITADO/, 'CUSTO EVITADO:'],
    ['vigencia', /^PRAZO DE VIGENCIA/, 'PRAZO DE VIGÊNCIA:'],
    ['prazo', /^PRAZO:/, 'PRAZO:'],
    ['condPagamento', /^CONDICAO DE PAGAMENTO/, 'CONDIÇÃO DE PAGAMENTO:'],
    ['regime', /^REGIME DE CONTRATACAO/, 'REGIME DE CONTRATAÇÃO:'],
    ['incoterm', /^INCOTERM/, 'INCOTERM:'],
    ['reajuste', /^FORMULA PARAMETRICA/, 'FÓRMULA PARAMÉTRICA DE REAJUSTE:'],
    ['dataBase', /^DATA BASE/, 'DATA BASE:'],
    ['rescisao', /^PRAZO PARA RESCISAO/, 'PRAZO PARA RESCISÃO SEM ÔNUS:'],
    ['multa', /^MULTA POR RESCISAO/, 'MULTA POR RESCISÃO:'],
    ['classificacao', /^CLASSIFICACAO DO (PROCESSO|ADITIVO)/, null],
    ['gerenciaRequisitante', /^GERENCIA REQUISITANTE/, 'GERÊNCIA REQUISITANTE:'],
    ['unidade', /^UNIDADE SAMARCO/, 'UNIDADE SAMARCO:'],
    ['gestor', /^GESTOR DO CONTRATO/, 'GESTOR DO CONTRATO:'],
    ['responsavel', /^RESPONS.VEL PELO PROCESSO/, 'RESPONSÁVEL PELO PROCESSO:'],
    ['formalizacao', /^FORMALIZACAO DO PROCESSO/, 'FORMALIZAÇÃO DO PROCESSO:'],
    ['rfq', /^N RFQ/, null],
    ['explicacaoME', /^EXPLICACAO CASO/, 'EXPLICAÇÃO CASO NÃO TENHA SIDO USADO MERCADO ELETRÔNICO:'],
    ['sharepoint', /^ARQUIVAMENTO DO PROCESSO/, 'ARQUIVAMENTO DO PROCESSO NO SHAREPOINT:'],
  ];
  const ehRotulo = (t) => CAMPOS.some(([, re]) => re.test(norm(t)));
  const PLACE = /^[\s:\/–-]*(Selecionar uma op[cç][aã]o|X{3,}.*|R\$\s*X*[\s.,X]*|R\$\s*XXX.*|XX\s*\(ano\/m[eê]s\)|inserir o link da pasta|Informação não localizada\.?|Início em\s+e término em|Local de Entrega)?[\s:\/–-]*$/i;

  function primeiroRPr(p) {
    const r = filhos(p, 'r')[0];
    const rp = r && filhos(r, 'rPr')[0];
    return rp ? rp.cloneNode(true) : null;
  }
  function escreverParagrafo(ctx, p, partes) {
    const base = primeiroRPr(p);
    Array.from(p.childNodes).forEach((n) => { if (!(n.nodeType === 1 && n.localName === 'pPr')) p.removeChild(n); });
    for (const { t, negrito } of partes) {
      if (t == null || t === '') continue;
      const r = ctx.doc.createElementNS(W, 'w:r');
      if (base) {
        const rp = base.cloneNode(true);
        filhos(rp, 'b').concat(filhos(rp, 'bCs')).forEach((b) => rp.removeChild(b));
        // valor preenchido: sem marca-texto, sem cor de "campo a preencher" e sem estilo de placeholder
        if (!negrito) filhos(rp, 'highlight').concat(filhos(rp, 'color'), filhos(rp, 'rStyle'), filhos(rp, 'shd')).forEach((x) => rp.removeChild(x));
        if (negrito) { rp.insertBefore(ctx.doc.createElementNS(W, 'w:b'), rp.firstChild); }
        r.appendChild(rp);
      } else if (negrito) {
        const rp = ctx.doc.createElementNS(W, 'w:rPr');
        rp.appendChild(ctx.doc.createElementNS(W, 'w:b'));
        r.appendChild(rp);
      }
      const tt = ctx.doc.createElementNS(W, 'w:t');
      tt.setAttribute('xml:space', 'preserve');
      tt.textContent = t;
      r.appendChild(tt);
      p.appendChild(r);
    }
  }
  function escreverCelula(ctx, tc, partes) {
    const ps = filhos(tc, 'p');
    ps.slice(1).forEach((p) => tc.removeChild(p));
    escreverParagrafo(ctx, ps[0], partes);
  }

  function ancestral(el, nome) { for (let n = el.parentNode; n; n = n.parentNode) if (n.nodeType === 1 && n.localName === nome) return n; return null; }

  /** Escreve dentro de um controle de conteúdo do Word (lista suspensa, data, texto). */
  function escreverSdt(ctx, sdt, valor) {
    const pr = filhos(sdt, 'sdtPr')[0];
    if (pr) {
      filhos(pr, 'showingPlcHdr').forEach((x) => pr.removeChild(x));
      // lista suspensa: usa a opção do formulário que corresponde ao valor
      const lista = filhos(pr, 'comboBox')[0] || filhos(pr, 'dropDownList')[0];
      if (lista) {
        const opcoes = filhos(lista, 'listItem').map((li) => li.getAttributeNS(W, 'displayText') || li.getAttribute('w:displayText')).filter(Boolean);
        const nv = norm(valor);
        const achada = opcoes.find((o) => norm(o) === nv) || opcoes.find((o) => norm(o).length > 3 && !/SELECIONAR/.test(norm(o)) && (nv.includes(norm(o)) || norm(o).includes(nv)));
        if (achada) valor = achada;
      }
    }
    const cont = filhos(sdt, 'sdtContent')[0];
    if (!cont) return false;
    const rs = todos(cont, 'r');
    if (!rs.length) return false;
    rs.forEach((r, i) => {
      const rp = filhos(r, 'rPr')[0];
      if (rp) {
        filhos(rp, 'color').concat(filhos(rp, 'highlight')).forEach((x) => rp.removeChild(x));
        const cor = ctx.doc.createElementNS(W, 'w:color');
        cor.setAttribute('w:val', '000000');
        rp.appendChild(cor);
      }
      filhos(r, 't').forEach((t, j) => { t.textContent = i === 0 && j === 0 ? valor : ''; if (i === 0 && j === 0) t.setAttribute('xml:space', 'preserve'); });
    });
    return true;
  }

  function preencherCabecalho(ctx, tbl, cab) {
    const usados = new Set();
    // só as células "folha" (sem tabela aninhada dentro)
    const tcs = todos(tbl, 'tc').filter((tc) => !todos(tc, 'tbl').length);
    tcs.forEach((tc, i) => {
      const t = texto(tc).trim();
      const n = norm(t);
      const def = CAMPOS.find(([k, re]) => re.test(n) && !usados.has(k + re));
      if (!def) return;
      const [k, re, rotulo] = def;
      const v = cab[k];
      if (v == null || String(v).trim() === '') return;
      usados.add(k + re);
      const ps = filhos(tc, 'p');
      const sdtCel = todos(tc, 'sdt')[0];
      if (sdtCel && escreverSdt(ctx, sdtCel, String(v))) return;
      const prox0 = tcs[i + 1] && ancestral(tcs[i + 1], 'tr') === ancestral(tc, 'tr') ? tcs[i + 1] : null;
      const sdtProx0 = prox0 && (ancestral(prox0, 'sdt') || todos(prox0, 'sdt')[0]);
      if (sdtProx0 && ancestral(sdtProx0, 'tr') === ancestral(tc, 'tr') && /:\s*$/.test(t) && escreverSdt(ctx, sdtProx0, String(v))) return;
      if (k === 'rfq') {
        escreverCelula(ctx, tc, [{ t: 'Nº RFQ ', negrito: true }, { t: `${v} ` }, { t: '(Nº do ME – Nº SAP)', negrito: true }]);
        return;
      }
      const rotuloTxt = rotulo || (t.match(/^[^:]*:/) || [t])[0];
      const temDoisPontos = t.indexOf(':') >= 0;
      const resto = temDoisPontos ? t.slice(t.indexOf(':') + 1).trim() : '';
      // (a) rótulo no 1º parágrafo e valor no 2º
      if (ps.length >= 2 && norm(texto(ps[0])).replace(/[:\s\/]+$/, '') === norm(rotuloTxt).replace(/[:\s]+$/, '')) {
        ps.slice(2).forEach((p) => tc.removeChild(p));
        escreverParagrafo(ctx, ps[1], [{ t: String(v) }]);
        return;
      }
      // (b) rótulo sozinho e valor na célula seguinte da mesma linha
      const prox = prox0;
      if (temDoisPontos && (!resto || PLACE.test(resto)) && prox && !ehRotulo(texto(prox))) {
        const sdtProx = ancestral(prox, 'sdt') || todos(prox, 'sdt')[0];
        if (!(sdtProx && escreverSdt(ctx, sdtProx, String(v)))) escreverCelula(ctx, prox, [{ t: String(v) }]);
        return;
      }
      // (c) rótulo e valor na mesma célula
      const rot = k === 'contrato' ? (t.match(/^CONTRATO\/PEDIDO DE COMPRA\s*N[º°o]?\.?/i) || ['CONTRATO/PEDIDO DE COMPRA Nº'])[0]
        : k === 'gerencia' ? (t.match(/^GER[ÊE]NCIA\s*:?/i) || ['GERÊNCIA:'])[0]
        : k === 'classificacao' ? (t.match(/^[^:]*:/) || [t])[0] : rotuloTxt;
      escreverCelula(ctx, tc, [{ t: rot.trim() + ' ', negrito: true }, { t: String(v) }]);
    });
  }

  // ------------------------------------------------------------ seções (contratação)
  const SECOES = [
    ['estrategia', /^(\d\s*\.?\s*)?ESTRATEGIA DE CONTRATACAO$/],
    ['vendor', /^(\d\s*\.?\s*)?VENDOR LIST$/],
    ['carta', /^(\d\s*\.?\s*)?CARTA CONVITE E QUALIFICACOES$/],
    ['comercial', /^(\d\s*\.?\s*)?ANALISE E NEGOCIACAO COMERCIAL$/],
    ['referencial', /^(\d\s*\.?\s*)?REFERENCIAL COMPARATIVO$/],
    ['conclusao', /^(\d\s*\.?\s*)?CONCLUSAO$/],
  ];

  function conteudoSecoes(ctx) {
    const { st, eq, dados } = ctx;
    const T = dados.textos;
    const tipo = dados.tipo;
    const fmt = (n) => (n == null || !isFinite(n) ? '-' : E.fmtNum(n, 2));
    const out = {};
    const sub = (t) => par(ctx, t, { negrito: true, antes: 160 });

    out.estrategia = pars(ctx, T.estrategia);

    // 2. vendor list
    const vl = vendorListEfetiva(st, eq);
    out.vendor = pars(ctx, T.vendorList) + (vl.length ? tabela([380, 800, 2400, 1300, 1150, 1350, 1400, 1220], [
      ['Nº', 'CÓDIGO SAP', 'EMPRESAS', 'LOCALIZAÇÃO (Cidade/Estado)', 'FATURAMENTO ANUAL (R$)', 'RELAÇÃO FATURAMENTO ANUAL E VALOR PREVISTO (%)', 'PRINCIPAIS CLIENTES', 'PARTICIPOU DO PROCESSO ANTERIOR'].map((t) => ({ t, cab: true })),
      ...vl.map((v, i) => [
        { t: String(i + 1), alinhar: 'center' }, { t: v.codigoSap || '', alinhar: 'center' }, { t: v.empresa }, { t: v.localizacao || 'NA', alinhar: 'center' },
        { t: v.faturamento != null ? E.fmtNum(v.faturamento, 2) : 'NA', alinhar: 'right' }, { t: v.relacao != null ? E.fmtPct(v.relacao) : 'NA', alinhar: 'center' },
        { t: v.clientes || 'NA' }, { t: String(v.participouAnterior || 'NÃO').toUpperCase(), alinhar: 'center' },
      ]),
    ]) + espaco() : '');

    // 3. carta convite e qualificações
    const quals = st.fornecedores.filter((f) => val(f.confirmou) || val(f.apresentou) || val(f.qTec) || (eq && eq.fids.includes(f.id)));
    const q = (f, k, pad) => String(val(f[k]) || pad || '').toUpperCase();
    out.carta = pars(ctx, T.cartaConvite) + (quals.length ? tabela([380, 800, 2600, 1000, 1000, 900, 950, 950, 950, 1000], [
      [{ t: 'Nº', cab: true, vm: 'ini' }, { t: 'CÓDIGO SAP', cab: true, vm: 'ini' }, { t: 'EMPRESAS', cab: true, vm: 'ini' }, { t: 'CONFIRMOU PARTICIPAÇÃO', cab: true, vm: 'ini' }, { t: 'APRESENTOU PROPOSTA', cab: true, vm: 'ini' }, { t: 'QUALIFICAÇÕES', cab: true, span: 5 }],
      [{ cab: true, vm: 'cont' }, { cab: true, vm: 'cont' }, { cab: true, vm: 'cont' }, { cab: true, vm: 'cont' }, { cab: true, vm: 'cont' }, ...['TÉCNICA', 'SEGURANÇA', 'FINANCEIRA', 'COMPLIANCE', 'RESULTADO FINAL'].map((t) => ({ t, cab: true }))],
      ...quals.map((f, i) => [
        { t: String(i + 1), alinhar: 'center' }, { t: val(f.codigoSap) || '', alinhar: 'center' }, { t: String(val(f.nome)).toUpperCase() },
        { t: q(f, 'confirmou', 'SIM'), alinhar: 'center' }, { t: q(f, 'apresentou', eq && eq.fids.includes(f.id) ? 'SIM' : ''), alinhar: 'center' },
        { t: q(f, 'qTec', val(f.statusTecnico)), alinhar: 'center' }, { t: q(f, 'qSeg'), alinhar: 'center' }, { t: q(f, 'qFin'), alinhar: 'center' },
        { t: q(f, 'qComp'), alinhar: 'center' }, { t: q(f, 'qResultado'), alinhar: 'center' },
      ]),
    ]) : '') + sub('Análise Técnica') + pars(ctx, T.analiseTecnica || '—') + sub('Saúde e Segurança do Trabalho') + pars(ctx, T.sst || '—')
      + sub('Análise Financeira') + pars(ctx, T.financeira || '—') + (T.compliance ? sub('Análise de Compliance') + pars(ctx, T.compliance) : '');

    // 4. análise e negociação comercial
    let com = sub('4.1. Apresentação das Propostas Comerciais') + pars(ctx, T.apresentacao || '—') + sub('4.2. Análise e Negociação comercial') + pars(ctx, T.negociacao || '—');
    if (eq && eq.rodadas.length) {
      const rods = eq.rodadas.slice();
      const colRod = rods.map((r) => (r === 'R1' ? 'Proposta Inicial Equalizada' : r === 'BAFO' ? 'Proposta Final' : E.nomeRodada(r).replace('ª r', 'ª R')));
      if (rods[rods.length - 1] !== 'BAFO' && rods.length > 1) colRod[colRod.length - 1] += ' (Proposta Final)';
      const lv = 2600, resto = 7400, wcol = Math.floor(resto / (rods.length * 2));
      const larg = [lv, ...rods.flatMap(() => [Math.round(wcol * 1.35), Math.round(wcol * 0.65)])];
      const moeda = st.moeda && st.moeda !== 'BRL' ? st.moeda : 'R$';
      const linhas = [
        [{ t: `EQUALIZAÇÃO COMERCIAL${st.moeda && st.moeda !== 'BRL' ? ` (${st.moeda})` : ''}`, cab: true, span: 1 + rods.length * 2 }],
        [{ t: 'PROPONENTE', cab: true, vm: 'ini' }, ...colRod.map((t) => ({ t, cab: true, span: 2 }))],
        [{ cab: true, vm: 'cont' }, ...rods.flatMap(() => [{ t: moeda, cab: true }, { t: 'Pos.', cab: true }])],
        ...eq.fids.map((fid) => [{ t: String(val(st.fornecedores.find((f) => f.id === fid).nome)).toUpperCase() },
          ...rods.flatMap((r) => { const t = eq.porRodada[r].totais[fid]; return t ? [{ t: fmt(t.equalizado), alinhar: 'right' }, { t: `${t.posicao}º`, alinhar: 'center' }] : [{ t: '-', alinhar: 'center' }, { t: '-', alinhar: 'center' }]; })]),
      ];
      const v = eq.vencedor;
      if (v) {
        const ini = v.negociacao.inicial;
        linhas.push([{ t: `Custo evitado (${moeda})`, negrito: true, fundo: 'F2F2F2' }, ...rods.flatMap((r, i) => { const t = eq.porRodada[r].totais[v.fid]; const ce = t && i > 0 ? ini - t.equalizado : null; return [{ t: ce != null ? fmt(ce) : '-', alinhar: 'right', negrito: true, fundo: 'F2F2F2', span: 2 }]; })]);
        linhas.push([{ t: 'Custo evitado (%)', negrito: true, fundo: 'F2F2F2' }, ...rods.flatMap((r, i) => { const t = eq.porRodada[r].totais[v.fid]; const ce = t && i > 0 && ini ? (ini - t.equalizado) / ini : null; return [{ t: ce != null ? E.fmtPct(ce) : '-', alinhar: 'right', negrito: true, fundo: 'F2F2F2', span: 2 }]; })]);
      }
      com += tabela(larg, linhas) + espaco();
      // composição do valor contratado (itens do 1º colocado)
      const R = eq.porRodada[eq.resumo.ultima];
      if (v && R.linhas.length && !R.totais[v.fid].semItens) {
        const its = R.linhas.filter((ln) => ln.cel[v.fid] && ln.cel[v.fid].valor != null);
        com += par(ctx, 'Composição do valor contratado:', { antes: 120 }) + tabela([900, 4300, 700, 700, 1600, 1800], [
          ['Item', 'Descrição', 'Qtde', 'Un', `Preço unitário (${moeda})`, `Valor total (${moeda})`].map((t) => ({ t, cab: true })),
          ...its.map((ln) => [{ t: ln.item, alinhar: 'center' }, { t: ln.descricao }, { t: E.fmtQtd(ln.qtd), alinhar: 'center' }, { t: ln.un || '', alinhar: 'center' }, { t: fmt(ln.cel[v.fid].preco), alinhar: 'right' }, { t: fmt(ln.cel[v.fid].valor), alinhar: 'right' }]),
          [{ t: 'TOTAL', negrito: true, span: 5, fundo: 'F2F2F2' }, { t: fmt(R.totais[v.fid].equalizado), alinhar: 'right', negrito: true, fundo: 'F2F2F2' }],
        ]) + espaco();
      }
    }
    com += sub('4.3. Ponderação Técnica e Comercial') + pars(ctx, T.ponderacao || 'Não aplicável.');
    if (eq && eq.resumo.usaTec) {
      com += tabela([2600, 1300, 1300, 1600, 1300, 1100, 800], [
        ['PROPONENTES', 'PONTUAÇÃO TÉCNICA TOTAL', 'PONTUAÇÃO TÉCNICA PONDERADA', 'VALOR DA PROPOSTA COMERCIAL', 'PONTUAÇÃO COMERCIAL PONDERADA', 'PONTUAÇÃO FINAL', 'ORDEM'].map((t) => ({ t, cab: true })),
        ...eq.classificacao.map((c) => [{ t: String(c.nome).toUpperCase() }, { t: c.nt != null ? E.fmtNum(c.nt, 2) + '%' : '-', alinhar: 'center' }, { t: fmt(c.ntPond), alinhar: 'center' },
          { t: fmt(c.total), alinhar: 'right' }, { t: fmt(c.ncPond), alinhar: 'center' }, { t: fmt(c.nf), alinhar: 'center', negrito: c.posicao === 1 }, { t: c.posicao ? `${c.posicao}º` : '-', alinhar: 'center' }]),
      ]) + espaco();
    }
    out.comercial = com;

    // 5. referencial comparativo
    const ref = st.referencial || {};
    out.referencial = pars(ctx, T.referencial) + (ref.contrato && ref.valorRef != null && ref.valorNovo != null ? tabela([3000, 2400, 2200, 2400], [
      [`CONTRATO REFERÊNCIA Nº ${ref.contrato}`, 'NOVO CONTRATO', ref.valorNovo - ref.valorRef >= 0 ? 'AUMENTO' : 'REDUÇÃO', '% COMPARAÇÃO'].map((t) => ({ t, cab: true })),
      [{ t: fmt(ref.valorRef), alinhar: 'right' }, { t: fmt(ref.valorNovo), alinhar: 'right' }, { t: E.fmtPct(ref.valorNovo / ref.valorRef - 1), alinhar: 'center' }, { t: ref.pctComparacao != null ? E.fmtPct(ref.pctComparacao) : '100,00%', alinhar: 'center' }],
    ]) : '');

    // 6. conclusão
    out.conclusao = pars(ctx, T.conclusao);
    void tipo;
    return out;
  }

  /** Vendor list do RH: a da planilha, se for deste processo; senão, os participantes. */
  function vendorListEfetiva(st, eq) {
    const participantes = st.fornecedores.filter((f) => (eq && eq.fids.includes(f.id)) || val(f.apresentou) === 'SIM' || val(f.confirmou));
    const vl = st.vendorList || [];
    const bate = vl.some((v) => participantes.some((f) => E.acharFornecedor({ fornecedores: [f] }, v.empresa)));
    if (vl.length && (bate || !participantes.length)) return vl;
    return participantes.map((f) => ({ codigoSap: val(f.codigoSap) || '', empresa: String(val(f.nome)).toUpperCase(), localizacao: '', faturamento: null, relacao: null, clientes: '', participouAnterior: 'NÃO' }));
  }

  function substituirSecoes(ctx, body) {
    const blocos = Array.from(body.childNodes).filter((n) => n.nodeType === 1);
    const cabecalhos = [];
    blocos.forEach((n, i) => {
      if (n.localName !== 'p') return;
      const t = norm(texto(n));
      const s = SECOES.find(([, re]) => re.test(t));
      if (s && !cabecalhos.some((c) => c.k === s[0])) cabecalhos.push({ k: s[0], i, no: n });
    });
    const conteudo = conteudoSecoes(ctx);
    const fimCorpo = blocos.findIndex((n) => n.localName === 'sectPr');
    const limite = fimCorpo >= 0 ? fimCorpo : blocos.length;
    if (!cabecalhos.length) {
      // modelo sem as seções: acrescenta tudo ao final
      const ref = fimCorpo >= 0 ? blocos[fimCorpo] : null;
      const titulos = { estrategia: '1. ESTRATÉGIA DE CONTRATAÇÃO', vendor: '2. VENDOR LIST', carta: '3. CARTA CONVITE E QUALIFICAÇÕES', comercial: '4. ANÁLISE E NEGOCIAÇÃO COMERCIAL', referencial: '5. REFERENCIAL COMPARATIVO', conclusao: '6. CONCLUSÃO' };
      for (const [k] of SECOES) for (const n of fragmento(ctx, par(ctx, titulos[k], { negrito: true, antes: 240 }) + conteudo[k])) body.insertBefore(n, ref);
      return;
    }
    cabecalhos.sort((a, b) => a.i - b.i);
    cabecalhos.forEach((c, j) => {
      const ate = j + 1 < cabecalhos.length ? cabecalhos[j + 1].i : limite;
      for (let x = c.i + 1; x < ate; x++) body.removeChild(blocos[x]);
      const ref = j + 1 < cabecalhos.length ? cabecalhos[j + 1].no : fimCorpo >= 0 ? blocos[fimCorpo] : null;
      for (const n of fragmento(ctx, conteudo[c.k] || '')) body.insertBefore(n, ref);
    });
  }

  // ------------------------------------------------------------ aditivo
  function atualizarAditivo(ctx, body) {
    const { st, dados } = ctx;
    const ad = E.calcularAditivo(st);
    const a = st.aditivo || {};
    const fmt = (n) => (n == null || !isFinite(n) ? '-' : E.fmtNum(n, 2));
    const novaLinha = [`${ad.numero}º`, ad.data, ad.aditado ? fmt(ad.aditado) : '-', fmt(ad.total), ad.variacao != null ? E.fmtPct(ad.variacao) : '-', ad.prazo != null ? String(ad.prazo) : '-', ad.inicio || '-', ad.termino || '-'];

    // 1) resumo de evolução
    const tbls = filhos(body, 'tbl');
    const tev = tbls.find((t) => /N TAC/.test(norm(texto(filhos(t, 'tr')[0] || t))));
    if (tev) {
      const trs = filhos(tev, 'tr');
      let alvo = trs.find((tr) => norm(texto(filhos(tr, 'tc')[0] || tr)).replace(/\s/g, '') === `${ad.numero}`);
      if (!alvo) { alvo = trs[trs.length - 1].cloneNode(true); tev.appendChild(alvo); }
      filhos(alvo, 'tc').forEach((tc, i) => { if (novaLinha[i] != null) escreverCelula(ctx, tc, [{ t: novaLinha[i] }]); });
    } else {
      const ancora = filhos(body, 'p').find((p) => /RESUMO DE EVOLUCAO DO CONTRATO/.test(norm(texto(p))));
      const linhas = [
        ['Nº TAC', 'Data de Emissão do TAC', 'Valor a ser aditado (R$)', 'Valor Total (R$)', 'Variação', 'Prazo c/ aditamento (meses)', 'Início', 'Término'].map((t) => ({ t, cab: true })),
        ...(st.evolucao || []).filter((r) => !(ad.substitui && E.parseNum(r.tac) >= ad.numero)).map((r) => [r.tac, r.data, r.aditado ? fmt(r.aditado) : '-', fmt(r.total), r.variacao || '-', r.prazo != null ? String(r.prazo) : '-', r.inicio, r.termino].map((t) => ({ t, alinhar: 'center' }))),
        novaLinha.map((t) => ({ t, alinhar: 'center' })),
      ];
      const xml = tabela([1500, 1200, 1300, 1400, 900, 1300, 1200, 1200], linhas);
      // remove o "Exemplo:" e a imagem do formulário em branco
      if (ancora) {
        let n = ancora.nextSibling;
        while (n && !(n.nodeType === 1 && /DESCRICAO DOS ADITIVOS/.test(norm(texto(n))))) { const prox = n.nextSibling; if (n.nodeType === 1 && n.localName !== 'sectPr') body.removeChild(n); n = prox; }
        for (const no of fragmento(ctx, xml)) body.insertBefore(no, n);
      }
    }

    // 2) descrição do novo aditivo
    const pDesc = filhos(body, 'p').find((p) => /DESCRICAO DOS ADITIVOS/.test(norm(texto(p))));
    if (!pDesc) return;
    const reBloco = /^\d+\s*[º°o]?\s*ADITIVO\s*[–-]\s*DATA/;
    const blocosApos = [];
    for (let n = pDesc.nextSibling; n; n = n.nextSibling) if (n.nodeType === 1) blocosApos.push(n);
    const preenchido = blocosApos.some((n) => reBloco.test(norm(texto(n))) && !/XXXX/.test(norm(blocosApos.map(texto).join(' '))));
    if (!preenchido || ad.substitui) {
      // remove o exemplo do formulário ou o bloco do mesmo aditivo
      let removendo = !preenchido;
      for (const n of blocosApos) {
        if (n.localName === 'sectPr') break;
        const t = norm(texto(n));
        if (reBloco.test(t)) removendo = !preenchido || parseInt(t, 10) === ad.numero;
        if (removendo) body.removeChild(n);
      }
    }
    const T = dados.textos;
    const valorTxt = ad.aditado ? `Alterado o valor total de ${E.fmtBRL(ad.totalAnt)} para ${E.fmtBRL(ad.total)}.` : 'não houve alteração do valor total do contrato.';
    const inicioTxt = val(a.inicio) && ad.inicio !== (st.evolucao[0] || {}).inicio ? `Alterada para ${ad.inicio}.` : 'não houve alteração.';
    const termTxt = ad.termino && ad.terminoAnt && ad.termino !== ad.terminoAnt ? `${ad.terminoAnt} para ${ad.termino}.` : 'não houve alteração.';
    const prazoTxt = ad.prazo != null && ad.prazoAnt != null && ad.prazo !== ad.prazoAnt ? `de ${ad.prazoAnt} para ${ad.prazo} meses.` : 'não houve alteração.';
    let xml = par(ctx, `${ad.numero}º Aditivo – Data: ${ad.data}`, { negrito: true, antes: 200 })
      + par(ctx, [{ t: 'Analista de compras/responsável: ', negrito: false }, { t: dados.cab.responsavel || '' }])
      + par(ctx, `Classificação do Aditivo: ${ad.classificacao || dados.cab.classificacao || ''}`)
      + par(ctx, `Valor: ${valorTxt}`)
      + (val(a.reajuste) ? par(ctx, `Preços unitários: reajuste de ${val(a.reajuste)} sobre os preços vigentes${val(a.reajusteAplicacao) ? ', ' + val(a.reajusteAplicacao) : ''}.`) : '')
      + par(ctx, `Data de início: ${inicioTxt}`)
      + par(ctx, `Data de término: ${termTxt}`)
      + par(ctx, `Escopo: ${val(a.escopo) || 'não houve alteração.'}`)
      + par(ctx, `Prazo: ${prazoTxt}`)
      + par(ctx, `Validade do aditivo: ${val(a.validade) || `a partir da data de assinatura do ${ad.numero}º TAC.`}`)
      + par(ctx, 'Justificativa do Aditivo:', { negrito: true, antes: 120 }) + pars(ctx, T.justificativaAditivo || '—')
      + par(ctx, 'Considerações de Suprimentos:', { negrito: true, antes: 120 }) + pars(ctx, T.consideracoes || '—');
    const neg = (a.negociacao || []).filter((r) => r && (r.cenario || r.resultado));
    if (neg.length) xml += par(ctx, 'Resultado da negociação:', { antes: 120 }) + tabela([6000, 4000], [[{ t: 'Cenário', cab: true }, { t: 'Resultado', cab: true }], ...neg.map((r) => [{ t: r.cenario }, { t: r.resultado, alinhar: 'center' }])]) + espaco();
    const ref = pDesc.nextSibling;
    for (const n of fragmento(ctx, xml)) body.insertBefore(n, ref);
  }

  // ------------------------------------------------------------ principal
  /**
   * libs: { PizZip, DOMParser, XMLSerializer, saidaBinaria? }
   * ctx:  { st, eq, dados }  (dados = FlowEngine.dadosRH(st, eq))
   */
  function gerar(libs, modeloBytes, ctxBase) {
    const zip = new libs.PizZip(modeloBytes);
    const xml = zip.file('word/document.xml').asText();
    const doc = new libs.DOMParser().parseFromString(xml, 'application/xml');
    const estilos = zip.file('word/styles.xml') ? zip.file('word/styles.xml').asText() : '';
    const ctx = { ...ctxBase, doc, DOMParser: libs.DOMParser, estiloDefault: /w:styleId="Default"/.test(estilos) ? 'Default' : null };
    const body = todos(doc, 'body')[0];
    const cabTbl = filhos(body, 'tbl')[0];
    const titulo = cabTbl ? norm(texto(cabTbl)).slice(0, 120) : '';
    const modoAditivo = ctx.dados.tipo === 'aditivo' || /ALTERACAO CONTRATUAL/.test(titulo);
    if (cabTbl) preencherCabecalho(ctx, cabTbl, ctx.dados.cab);
    if (modoAditivo) atualizarAditivo(ctx, body);
    else substituirSecoes(ctx, body);
    zip.file('word/document.xml', new libs.XMLSerializer().serializeToString(doc));
    return zip.generate({ type: libs.saidaBinaria || 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
  }

  /** Escolhe o modelo de RH entre os documentos da pasta (formulário em branco ou RH anterior). */
  function escolherModelo(st, preferencia) {
    const tipo = val(st.tipoProcesso);
    const ms = st.modelos || [];
    if (preferencia) { const m = ms.find((x) => x.docId === preferencia); if (m) return m; }
    if (tipo === 'aditivo') {
      const ant = ms.filter((m) => m.tipo === 'aditivo' && m.preenchido).sort((a, b) => b.evolucao - a.evolucao)[0];
      return ant || ms.find((m) => m.tipo === 'aditivo') || null;
    }
    return ms.find((m) => m.tipo === 'contratacao' && !m.preenchido) || ms.find((m) => m.tipo === 'simplificado' && !m.preenchido)
      || ms.find((m) => m.tipo === 'contratacao') || null;
  }

  return { gerar, vendorListEfetiva, escolherModelo, CAMPOS };
});
