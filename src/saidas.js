/*
 * FLOW Express — saídas: RH padrão FLOW (PDF), tabelas SMIN-IT-GSU-004 (.xlsx)
 * e gráfico da negociação (SVG). O RH no formulário Samarco fica em rh-samarco.js.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Saidas = factory(root.FlowEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const corSerie = (i) => CORES[i] || '#8a8f94';

  // ------------------------------------------------------------ gráfico da negociação

  /** series: [{nome, cor, pontos:[{rodada, rotulo, total, herdada}]}] */
  function svgNegociacao(series, rotulos, opt = {}) {
    const W = opt.largura || 760, H = opt.altura || 300;
    const k = opt.literal
      ? { grade: '#e6e8ea', texto2: '#5f6b73', texto: '#1d2327', sup: '#ffffff' }
      : { grade: 'var(--grade,#e6e8ea)', texto2: 'var(--texto-2,#5f6b73)', texto: 'var(--texto,#1d2327)', sup: 'var(--superficie,#fff)' };
    const m = { t: 18, r: 215, b: 36, l: 84 };
    const vals = series.flatMap((s) => s.pontos.map((p) => p.total)).filter((v) => v != null);
    if (!vals.length) return '';
    let min = Math.min(...vals), max = Math.max(...vals);
    const folga = (max - min) * 0.15 || max * 0.05;
    min = Math.max(0, min - folga); max = max + folga;
    const passo = escalaPasso((max - min) / 4);
    min = Math.floor(min / passo) * passo; max = Math.ceil(max / passo) * passo;
    const x = (i) => m.l + (rotulos.length === 1 ? (W - m.l - m.r) / 2 : (i * (W - m.l - m.r)) / (rotulos.length - 1));
    const y = (v) => m.t + (1 - (v - min) / (max - min)) * (H - m.t - m.b);
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolução do valor equalizado por rodada" style="font-family:inherit;max-width:${W}px">`;
    for (let v = min; v <= max + 1e-6; v += passo) {
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${k.grade}" stroke-width="1"/>`;
      s += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="${k.texto2}">${esc(abreviar(v))}</text>`;
    }
    rotulos.forEach((r, i) => {
      s += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="12" fill="${k.texto2}">${esc(r)}</text>`;
    });
    // posições dos rótulos diretos sem sobreposição
    const finais = series.map((se, i) => {
      const ps = se.pontos.map((p, j) => ({ ...p, j })).filter((p) => p.total != null);
      const u = ps[ps.length - 1];
      return u ? { i, y: y(u.total), x: x(u.j), se, u } : null;
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let k = 1; k < finais.length; k++) if (finais[k].y - finais[k - 1].y < 15) finais[k].y = finais[k - 1].y + 15;
    series.forEach((se) => {
      const ps = se.pontos.map((p, j) => ({ ...p, j })).filter((p) => p.total != null);
      if (ps.length > 1) s += `<polyline fill="none" stroke="${se.cor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${ps.map((p) => `${x(p.j)},${y(p.total)}`).join(' ')}"/>`;
      ps.forEach((p) => {
        s += p.herdada
          ? `<circle cx="${x(p.j)}" cy="${y(p.total)}" r="4" fill="${k.sup}" stroke="${se.cor}" stroke-width="2"/>`
          : `<circle cx="${x(p.j)}" cy="${y(p.total)}" r="4.5" fill="${se.cor}" stroke="${k.sup}" stroke-width="2"/>`;
      });
    });
    for (const f of finais) {
      s += `<line x1="${W - m.r + 8}" x2="${W - m.r + 20}" y1="${f.y}" y2="${f.y}" stroke="${f.se.cor}" stroke-width="2"/>`;
      s += `<text x="${W - m.r + 26}" y="${f.y + 4}" font-size="11.5" fill="${k.texto}">${esc(curto(f.se.nome, 17))} · ${esc(abreviar(f.u.total))}</text>`;
    }
    if (opt.hover) {
      const w = rotulos.length === 1 ? W - m.l - m.r : (W - m.l - m.r) / (rotulos.length - 1);
      rotulos.forEach((_, i) => {
        s += `<g class="hcol" data-i="${i}"><line class="cross" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${H - m.b}" stroke="${k.texto2}" stroke-dasharray="3 3"/>` +
          `<rect x="${x(i) - w / 2}" y="${m.t}" width="${w}" height="${H - m.t - m.b}" fill="transparent"/></g>`;
      });
    }
    s += '</svg>';
    return s;
  }
  function escalaPasso(bruto) {
    if (!(bruto > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(bruto)));
    const n = bruto / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function abreviar(v) {
    if (Math.abs(v) >= 1e6) return 'R$ ' + E.fmtNum(v / 1e6, 2) + ' mi';
    if (Math.abs(v) >= 1e3) return 'R$ ' + E.fmtNum(v / 1e3, 1) + ' mil';
    return E.fmtBRL(v);
  }
  const curto = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

  function seriesNegociacao(st, eq) {
    return eq.fids.map((fid, i) => ({
      fid, nome: E.val(st.fornecedores.find((f) => f.id === fid).nome), cor: corSerie(i),
      pontos: eq.negociacao[fid].serie.map((p) => ({ ...p, rotulo: E.nomeRodada(p.rodada) })),
    }));
  }

  // ------------------------------------------------------------ RH padrão FLOW (HTML → PDF)

  const CSS_FLOW = `@page{size:A4;margin:14mm 13mm 16mm}
*{box-sizing:border-box}body{--grade:#e6e8ea;--texto-2:#5f6b73;--texto:#1d2327;--superficie:#fff;margin:0;font-family:"Segoe UI",Calibri,Arial,sans-serif;color:#1d2327;font-size:10.5pt;line-height:1.4;background:#fff}
.pg{max-width:190mm;margin:0 auto;padding:6mm 0}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0e4d64;padding-bottom:8px;margin-bottom:14px}
.r-marca{font-weight:800;letter-spacing:.06em;color:#0e4d64;font-size:20pt}.r-marca span{font-weight:400;color:#5f6b73;font-size:10pt;letter-spacing:0;margin-left:8px}
.r-doc{text-align:right;font-size:9pt;color:#5f6b73}.r-doc b{display:block;font-size:13pt;color:#1d2327}
h2{font-size:11.5pt;color:#0e4d64;margin:18px 0 6px;padding-bottom:3px;border-bottom:1px solid #d5dbdf;break-after:avoid}
.obj{font-size:11pt;margin:0 0 10px}
.r-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 4px}
.r-kpi{border:1px solid #d5dbdf;border-radius:6px;padding:8px 10px}.r-kr{font-size:8.5pt;color:#5f6b73}.r-kv{font-size:13pt;font-weight:700;margin-top:2px}.r-ks{font-size:8.5pt;color:#5f6b73}
.r-kpi.r-dest{background:#0e4d64;color:#fff;border-color:#0e4d64}.r-kpi.r-dest .r-kr,.r-kpi.r-dest .r-ks{color:#cfe3ea}
table{border-collapse:collapse;width:100%}
.id th{text-align:left;width:32%;font-weight:600;color:#5f6b73;padding:3px 8px 3px 0;vertical-align:top;font-size:9.5pt}.id td{padding:3px 0}
.t{font-size:9pt;margin-top:4px}.t th{background:#eef3f5;text-align:left;padding:5px 6px;border-bottom:1px solid #c9d3d8;font-weight:600}
.t td{padding:4px 6px;border-bottom:1px solid #e6e8ea;vertical-align:top}.t .n{text-align:right;white-space:nowrap}.t .c{text-align:center}
.t tfoot td{font-weight:700;border-top:2px solid #0e4d64;border-bottom:none}
tr.venc td{background:#eaf5ef}.ruim{color:#b3261e;font-weight:600}
.mini{font-size:7.5pt;color:#5f6b73;font-weight:400}
.mat td.menor{color:#0a6b3d;font-weight:600}.mat td.eqz{background:repeating-linear-gradient(135deg,#fff3e0 0 4px,#fff 4px 8px)}.mat td.flag{background:#fff8db}
.just{border-left:3px solid #0e4d64;padding:6px 10px;background:#f6f9fa;white-space:pre-wrap}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
ul{margin:4px 0;padding-left:18px}li{margin:2px 0}
.pend li{color:#b3261e}
.leg{font-size:8pt;color:#5f6b73;margin-top:4px}.leg i{display:inline-block;width:10px;height:10px;vertical-align:-1px;margin:0 4px 0 10px;border:1px solid #c9d3d8}
.ass{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:40px}.ass div{border-top:1px solid #1d2327;padding-top:4px;text-align:center;font-size:9pt}
.rod{margin-top:18px;font-size:7.5pt;color:#8a8f94;text-align:center}
.quebra{break-before:page}
section{break-inside:avoid}
`;

  /** RH padrão FLOW para aditivos (ou processo sem propostas): evolução do contrato e novo aditivo. */
  function htmlFLOWSimples(st, dados) {
    const ad = E.calcularAditivo(st);
    const ev = (st.evolucao || []).filter((r) => !(ad.substitui && E.parseNum(r.tac) >= ad.numero));
    const fmt = (n) => (n == null || !isFinite(n) ? '—' : E.fmtNum(n, 2));
    const c = dados.cab;
    const kpi = (rot, v, sub, dest) => `<div class="r-kpi${dest ? ' r-dest' : ''}"><div class="r-kr">${esc(rot)}</div><div class="r-kv">${esc(v || '—')}</div>${sub ? `<div class="r-ks">${esc(sub)}</div>` : ''}</div>`;
    const linhaId = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`;
    const lista = (arr, fn) => (arr.length ? `<ul>${arr.map(fn).join('')}</ul>` : '<p class="mini">Nenhum.</p>');
    const aditivo = dados.tipo === 'aditivo';
    const a = st.aditivo || {};
    const evol = aditivo ? `<section><h2>Resumo de evolução do contrato</h2><table class="t"><thead><tr><th>Nº TAC</th><th>Emissão</th><th class="n">Valor aditado</th><th class="n">Valor total</th><th class="n">Variação</th><th class="n">Prazo (meses)</th><th>Início</th><th>Término</th></tr></thead><tbody>
      ${ev.map((r) => `<tr><td>${esc(r.tac)}</td><td>${esc(r.data)}</td><td class="n">${r.aditado ? fmt(r.aditado) : '—'}</td><td class="n">${fmt(r.total)}</td><td class="n">${esc(r.variacao || '—')}</td><td class="n">${r.prazo ?? '—'}</td><td>${esc(r.inicio)}</td><td>${esc(r.termino)}</td></tr>`).join('')}
      <tr class="venc"><td><b>${ad.numero}º</b></td><td>${esc(ad.data)}</td><td class="n">${ad.aditado ? fmt(ad.aditado) : '—'}</td><td class="n"><b>${fmt(ad.total)}</b></td><td class="n">${ad.variacao != null ? E.fmtPct(ad.variacao) : '—'}</td><td class="n"><b>${ad.prazo ?? '—'}</b></td><td>${esc(ad.inicio)}</td><td><b>${esc(ad.termino)}</b></td></tr>
      </tbody></table></section>
      <section><h2>${ad.numero}º aditivo — ${esc(ad.data)}</h2><table class="id">
      ${linhaId('Classificação do aditivo', ad.classificacao || c.classificacao)}${linhaId('Valor', ad.aditado ? `de ${E.fmtBRL(ad.totalAnt)} para ${E.fmtBRL(ad.total)}` : 'não houve alteração do valor total')}
      ${E.val(a.reajuste) ? linhaId('Preços unitários', `reajuste de ${E.val(a.reajuste)}`) : ''}${linhaId('Data de término', ad.termino !== ad.terminoAnt ? `${ad.terminoAnt} para ${ad.termino}` : 'não houve alteração')}
      ${linhaId('Prazo', ad.prazo !== ad.prazoAnt ? `de ${ad.prazoAnt} para ${ad.prazo} meses` : 'não houve alteração')}${linhaId('Escopo', E.val(a.escopo) || 'não houve alteração')}
      </table></section>
      <section><h2>Justificativa do aditivo</h2><div class="just">${esc(dados.textos.justificativaAditivo || '—')}</div></section>
      <section><h2>Considerações de Suprimentos</h2><div class="just">${esc(dados.textos.consideracoes || '—')}</div></section>` : '';
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>RH_FLOW_${esc(c.contrato || dados.rc)}</title><style>
${CSS_FLOW}</style></head><body><div class="pg">
<div class="top"><div class="r-marca">FLOW<span>${aditivo ? 'RH de alteração contratual' : 'RH do processo de compra'}</span></div><div class="r-doc"><b>${aditivo ? 'Contrato ' + esc(c.contrato || '—') : 'RC ' + esc(dados.rc || '—')}</b>Emitido em ${esc(dados.dataRH)}</div></div>
<p class="obj"><b>Fornecedor:</b> ${esc(c.fornecedorRH || dados.vencedorRH || '—')}${c.objeto ? ` · <b>Objeto:</b> ${esc(c.objeto)}` : ''}</p>
<div class="r-kpis">${aditivo ? kpi('Aditivo', `${ad.numero}º TAC`, ad.classificacao) + kpi('Novo valor total', E.fmtBRL(ad.total), ad.aditado ? '+' + E.fmtBRL(ad.aditado) : 'sem alteração de valor', true) + kpi('Prazo', `${ad.prazo ?? '—'} meses`, ad.prazoAnt !== ad.prazo ? `antes: ${ad.prazoAnt} meses` : '') + kpi('Término', ad.termino, ad.termino !== ad.terminoAnt ? `antes: ${ad.terminoAnt}` : '')
      : kpi('Fornecedor', dados.vencedorRH) + kpi('Valor', c.valorContratado, '', true) + kpi('RC', c.numeroRC) + kpi('Condição de pagamento', c.condPagamento)}</div>
<section><h2>Cabeçalho do RH</h2><table class="id">${['numeroRC', 'valorRC', 'condPagamento', 'regime', 'reajuste', 'gerenciaRequisitante', 'gestor', 'responsavel'].map((k) => linhaId(E.ROTULOS_CAB[k], c[k])).join('')}</table></section>
${evol}
<div class="cols"><section><h2>Anexos do processo</h2>${lista(dados.anexos, (x) => `<li>${esc(x.nome)} <span class="mini">— ${esc(x.tipo)}</span></li>`)}</section>
<section><h2>Pendências</h2>${dados.pendencias.length ? `<ul class="pend">${dados.pendencias.map((p) => `<li>${esc(p.grupo)}: ${esc(p.desc)}${p.dica ? ` <span class="mini">(${esc(p.dica)})</span>` : ''}</li>`).join('')}</ul>` : '<p>Nenhuma pendência.</p>'}</section></div>
<div class="ass"><div>${esc(c.responsavel || 'Comprador(a)')}<br><span class="mini">Suprimentos</span></div><div>Aprovação<br><span class="mini">Gerência</span></div></div>
<div class="rod">Gerado pelo FLOW Express em ${esc(new Date().toLocaleString('pt-BR'))} · documentos processados localmente, sem envio de dados.</div>
</div></body></html>`;
  }

  function htmlFLOW(st, eq, dados) {
    if (!eq || dados.tipo === 'aditivo') return htmlFLOWSimples(st, dados);
    const r = eq.resumo;
    const R = r.ultima ? eq.porRodada[r.ultima] : null;
    const series = seriesNegociacao(st, eq);
    const nomeF = (fid) => E.val(st.fornecedores.find((f) => f.id === fid).nome);
    const kpi = (rot, v, sub) => `<div class="r-kpi"><div class="r-kr">${esc(rot)}</div><div class="r-kv">${esc(v)}</div>${sub ? `<div class="r-ks">${esc(sub)}</div>` : ''}</div>`;
    const linhaId = (k, v) => `<tr><th>${esc(k)}</th><td>${esc(v || '—')}</td></tr>`;

    const classif = dados.fornecedores.map((f) => `<tr class="${f.posicao === '1º' ? 'venc' : ''}">
      <td class="c">${esc(f.posicao)}</td><td>${esc(f.nome)}<div class="mini">${esc(f.cnpj)}</div></td>
      ${r.usaTec ? `<td class="n">${esc(f.notaTecnica)}</td><td class="n">${esc(f.notaComercial)}</td>` : ''}
      <td class="n"><b>${esc(f.notaFinal)}</b></td><td class="n">${esc(f.valorFinal)}</td>
      <td class="${/vencid|não|nao/i.test(f.homologacao) ? 'ruim' : ''}">${esc(f.homologacao)}</td></tr>`).join('');

    const cond = dados.fornecedores.map((f) => `<tr><td>${esc(f.nome)}</td><td>${esc(f.prazoEntrega)}</td><td>${esc(f.condPagamento)}</td><td>${esc(f.frete)}</td><td>${esc(f.validade)}</td></tr>`).join('');

    const neg = eq.fids.map((fid) => {
      const n = eq.negociacao[fid];
      return `<tr><td>${esc(nomeF(fid))}</td>${n.serie.map((p) => `<td class="n">${p.total != null ? esc(E.fmtBRL(p.total)) + (p.herdada ? '<span class="mini"> mantida</span>' : '') : '—'}</td>`).join('')}
      <td class="n"><b>${esc(E.fmtBRL(n.saving))}</b></td><td class="n">${esc(E.fmtPct(n.savingPct))}</td></tr>`;
    }).join('');

    let matriz = '';
    if (R) {
      const fs = R.fornecedores;
      matriz = `<table class="t mat"><thead><tr><th>Item</th><th>Descrição</th><th>Un</th><th class="n">Qtd</th>${fs.map((f) => `<th class="n">${esc(curto(nomeF(f), 22))}</th>`).join('')}</tr></thead><tbody>` +
        R.linhas.map((ln) => `<tr><td class="c">${esc(ln.item)}</td><td>${esc(ln.descricao)}</td><td>${esc(ln.un)}</td><td class="n">${esc(E.fmtQtd(ln.qtd))}</td>` +
          fs.map((f) => {
            const c = ln.cel[f];
            const cls = c.preenchido ? 'eqz' : c.flags.length ? 'flag' : ln.menor != null && c.preco === ln.menor ? 'menor' : '';
            return `<td class="n ${cls}">${esc(E.fmtBRL(c.valor))}${c.preenchido ? '<div class="mini">não cotado · equalizado</div>' : c.flags.length ? `<div class="mini">${esc(c.flags.map(rotFlag).join(', '))}</div>` : ''}</td>`;
          }).join('') + '</tr>').join('') +
        `</tbody><tfoot><tr><td colspan="4">Total equalizado</td>${fs.map((f) => `<td class="n">${esc(E.fmtBRL(R.totais[f].equalizado))}</td>`).join('')}</tr></tfoot></table>`;
    }

    const lista = (arr, fn) => (arr.length ? `<ul>${arr.map(fn).join('')}</ul>` : '<p class="mini">Nenhum.</p>');

    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>RH_FLOW_RC${esc(dados.rc)}</title><style>
${CSS_FLOW}</style></head><body><div class="pg">
<div class="top"><div class="r-marca">FLOW<span>RH do processo de compra</span></div><div class="r-doc"><b>RC ${esc(dados.rc || '—')}</b>Emitido em ${esc(dados.dataRH)}</div></div>
<p class="obj"><b>Objeto:</b> ${esc(dados.objeto || '—')}</p>
<div class="r-kpis">
${kpi('Fornecedor recomendado', dados.vencedor || '—', dados.vencedorCnpj)}
<div class="r-kpi r-dest"><div class="r-kr">Valor final equalizado</div><div class="r-kv">${esc(dados.valorFinal || '—')}</div><div class="r-ks">${esc(dados.rodadaFinal)}</div></div>
${kpi('Custo evitado na negociação', dados.custoEvitado, dados.custoEvitadoPct)}
${kpi('Valor da requisição (RC)', dados.cab.valorRC || dados.valorEstimado, dados.cab.numeroRC ? 'RC ' + dados.cab.numeroRC : '')}
</div>
<section><h2>1. Identificação do processo</h2><table class="id">
${linhaId('Requisição de compra (RC)', dados.rc)}${linhaId('Data da RC', dados.dataRC)}${linhaId('Requisitante', dados.requisitante)}
${linhaId('Centro de custo', dados.centroCusto)}${linhaId('Comprador', dados.comprador)}${linhaId('Valor estimado', dados.valorEstimado)}
${linhaId('Critério de julgamento', dados.criterio)}${linhaId('Fornecedores participantes', dados.qtdFornecedores)}${linhaId('Rodadas de negociação', dados.qtdRodadas)}
</table></section>
<section><h2>2. Classificação final (${esc(dados.rodadaFinal)})</h2><table class="t"><thead><tr><th class="c">Pos.</th><th>Fornecedor</th>${r.usaTec ? '<th class="n">Nota técnica</th><th class="n">Nota comercial</th>' : ''}<th class="n">Nota final</th><th class="n">Valor equalizado</th><th>Homologação</th></tr></thead><tbody>${classif}</tbody></table>
${r.usaTec ? `<p class="mini">Nota comercial = 100 × menor preço equalizado ÷ preço do fornecedor. Nota final = ${r.pT}% técnica + ${r.pC}% comercial.</p>` : ''}</section>
<section><h2>3. Negociação</h2>${svgNegociacao(series, eq.rodadas.map(E.nomeRodada), { largura: 700, altura: 240, literal: true })}
<table class="t"><thead><tr><th>Fornecedor</th>${eq.rodadas.map((x) => `<th class="n">${esc(E.nomeRodada(x))}</th>`).join('')}<th class="n">Custo evitado</th><th class="n">%</th></tr></thead><tbody>${neg}</tbody></table>
<p class="mini">"Mantida": o fornecedor não enviou nova proposta na rodada e foi considerada a anterior.</p></section>
<section><h2>4. Condições comerciais</h2><table class="t"><thead><tr><th>Fornecedor</th><th>Prazo de entrega</th><th>Pagamento</th><th>Frete</th><th>Validade</th></tr></thead><tbody>${cond}</tbody></table></section>
<section class="quebra"><h2>5. Equalização item a item (${esc(dados.rodadaFinal)})</h2>${matriz}
<div class="leg"><i style="background:#fff;border-color:#0a6b3d"></i>menor preço<i style="background:repeating-linear-gradient(135deg,#fff3e0 0 3px,#fff 3px 6px)"></i>item não cotado, equalizado pelo critério definido<i style="background:#fff8db"></i>divergência a conferir</div>
${dados.alertas.length ? `<h2>Pontos de atenção da equalização</h2>${lista(dados.alertas, (a) => `<li>${esc(a.msg)}</li>`)}` : ''}</section>
<section><h2>6. Recomendação</h2><div class="just">${esc(dados.justificativa)}</div>
${dados.observacoes ? `<p><b>Observações:</b> ${esc(dados.observacoes)}</p>` : ''}</section>
<div class="cols"><section><h2>7. Anexos do processo</h2>${lista(dados.anexos, (a) => `<li>${esc(a.nome)} <span class="mini">— ${esc(a.tipo)}</span></li>`)}</section>
<section><h2>8. Pendências</h2>${dados.pendencias.length ? `<ul class="pend">${dados.pendencias.map((p) => `<li>${esc(p.grupo)}: ${esc(p.desc)}${p.dica ? ` <span class="mini">(${esc(p.dica)})</span>` : ''}</li>`).join('')}</ul>` : '<p>Nenhuma pendência. Processo completo.</p>'}</section></div>
<div class="ass"><div>${esc(dados.comprador || 'Comprador(a)')}<br><span class="mini">Suprimentos</span></div><div>Aprovação<br><span class="mini">Gerência</span></div></div>
<div class="rod">Gerado pelo FLOW Express em ${esc(new Date().toLocaleString('pt-BR'))} · documentos processados localmente, sem envio de dados.</div>
</div></body></html>`;
  }

  /** Separa CSS e corpo do relatório e prefixa os seletores com .classe (para exibir dentro da página). */
  function escoparRelatorio(doc, classe) {
    const css = (doc.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
    const corpo = (doc.match(/<body>([\s\S]*?)<\/body>/) || [, ''])[1];
    const escopado = css.replace(/([^{}]+)\{([^{}]*)\}/g, (m, sel, dec) => {
      sel = sel.trim();
      if (sel.startsWith('@')) return '';
      return sel.split(',').map((x) => {
        x = x.trim();
        if (x === 'body' || x === 'html') return '.' + classe;
        if (x === '*') return `.${classe},.${classe} *`;
        return `.${classe} ${x}`;
      }).join(',') + '{' + dec + '}';
    });
    return { css: escopado, corpo };
  }

  /** Gera o PDF do RH padrão FLOW direto no navegador (html2canvas + jsPDF), com quebras entre blocos. */
  async function gerarPdfFLOW(libs, doc) {
    const LARG = 794, ALT = Math.floor((LARG * 297) / 210), MARG = 34, UTIL = ALT - 2 * MARG, ESC = 2;
    const { css, corpo } = escoparRelatorio(doc, 'flowpdf');
    const caixa = document.createElement('div');
    caixa.style.cssText = `position:fixed;left:-20000px;top:0;width:${LARG}px;background:#fff`;
    caixa.innerHTML = `<style>${css}.flowpdf .pg{padding:0 12mm;max-width:none}</style><div class="flowpdf">${corpo}</div>`;
    document.body.appendChild(caixa);
    try {
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const raiz = caixa.querySelector('.flowpdf');
      const y0 = raiz.getBoundingClientRect().top;
      const altura = raiz.scrollHeight;
      const pos = (el, lado) => el.getBoundingClientRect()[lado] - y0;
      const cortes = new Set();
      raiz.querySelectorAll('.pg > *, section > *, tr, li, h2').forEach((el) => {
        cortes.add(Math.round(el.tagName === 'H2' ? pos(el, 'top') - 2 : pos(el, 'bottom') + 1));
      });
      const forcados = [...raiz.querySelectorAll('.quebra')].map((el) => Math.round(pos(el, 'top') - 2));
      const lista = [...cortes].filter((c) => c > 0 && c < altura).sort((a, b) => a - b);
      const paginas = [];
      let ini = 0;
      while (ini < altura - 4) {
        const lim = ini + UTIL;
        const f = forcados.find((c) => c > ini + 40 && c <= lim);
        let fim = f;
        if (!fim) fim = lim >= altura ? altura : [...lista].reverse().find((c) => c <= lim && c > ini + UTIL * 0.35) || lim;
        paginas.push([ini, fim]);
        ini = fim;
      }
      const canvas = await libs.html2canvas(raiz, { scale: ESC, backgroundColor: '#ffffff', logging: false, windowWidth: LARG, width: LARG });
      const pdf = new libs.jsPDF({ unit: 'mm', format: 'a4', compress: true });
      const mm = 210 / LARG;
      paginas.forEach(([a, b], i) => {
        if (i) pdf.addPage();
        const c = document.createElement('canvas');
        c.width = LARG * ESC; c.height = Math.ceil((b - a) * ESC);
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(canvas, 0, a * ESC, c.width, c.height, 0, 0, c.width, c.height);
        pdf.addImage(c.toDataURL('image/jpeg', 0.92), 'JPEG', 0, MARG * mm, 210, (b - a) * mm);
        pdf.setFontSize(7.5); pdf.setTextColor(140, 146, 150);
        pdf.text(`Página ${i + 1} de ${paginas.length}`, 210 - 12, 297 - 8, { align: 'right' });
      });
      return pdf.output('blob');
    } finally {
      caixa.remove();
    }
  }

  const rotFlag = (f) => ({ unidade: 'unidade ≠ RC', quantidade: 'qtd ≠ RC', total: 'total ≠ qtd×preço', faltante: 'não cotado' }[f] || f);

  // ------------------------------------------------------------ Excel de equalização

  /**
   * Planilha no formato da SMIN-IT-GSU-004 (Tabelas Modelo do Relatório de Homologação),
   * com as mesmas abas e fórmulas, mais as abas de detalhe do FLOW.
   */
  async function gerarExcel(libs, st, eq, dados) {
    const wb = new libs.ExcelJS.Workbook();
    wb.creator = 'FLOW Express';
    const AZUL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC5D9F1' } };
    const CINZA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
    const VERDE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF5EF' } };
    const LARANJA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE9CC' } };
    const AMARELO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } };
    const B = { style: 'thin', color: { argb: 'FF000000' } };
    const BORDAS = { top: B, left: B, bottom: B, right: B };
    const MOEDA = st.moeda && st.moeda !== 'BRL' ? `"${st.moeda}" #,##0.00` : '"R$" #,##0.00';
    const val = E.val;
    const nomeF = (fid) => String(val(st.fornecedores.find((f) => f.id === fid).nome)).toUpperCase();
    const fonte = { name: 'Arial', size: 9 };
    const celula = (ws, ref, v, o = {}) => {
      const c = ws.getCell(ref);
      c.value = v;
      c.font = { ...fonte, bold: !!o.negrito };
      c.border = BORDAS;
      c.alignment = { vertical: 'middle', horizontal: o.alinhar || (typeof v === 'number' ? 'right' : 'left'), wrapText: true };
      if (o.fundo) c.fill = o.fundo;
      if (o.fmt) c.numFmt = o.fmt;
      return c;
    };
    const cab = (ws, r, c0, textos) => textos.forEach((t, i) => celula(ws, ws.getCell(r, c0 + i).address, t, { negrito: true, alinhar: 'center', fundo: AZUL }));

    // 2 - Vendor List
    const RHS = typeof RHSamarco !== 'undefined' ? RHSamarco : libs.RHSamarco;
    const vl = RHS ? RHS.vendorListEfetiva(st, eq) : st.vendorList || [];
    const w2 = wb.addWorksheet('2 - Vendor List', { views: [{ showGridLines: false }] });
    w2.columns = [{ width: 2 }, { width: 5 }, { width: 12 }, { width: 38 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 40 }, { width: 16 }];
    cab(w2, 2, 2, ['Nº', 'CÓDIGO SAP', 'EMPRESAS', 'LOCALIZAÇÃO (Cidade/Estado)', 'FATURAMENTO ANUAL (R$)', 'RELAÇÃO FATURAMENTO ANUAL E VALOR PREVISTO (%)', 'PRINCIPAIS CLIENTES', 'PARTICIPOU DO PROCESSO ANTERIOR']);
    w2.getRow(2).height = 42;
    const valorPrev = eq && eq.vencedor ? eq.vencedor.total : E.parseNum(val(st.processo.valorEstimado));
    vl.forEach((v, i) => {
      const r = 3 + i;
      celula(w2, `B${r}`, i + 1, { alinhar: 'center' }); celula(w2, `C${r}`, v.codigoSap || '', { alinhar: 'center' }); celula(w2, `D${r}`, v.empresa);
      celula(w2, `E${r}`, v.localizacao || ''); celula(w2, `F${r}`, v.faturamento ?? null, { fmt: '#,##0.00' });
      if (v.faturamento != null && valorPrev) celula(w2, `G${r}`, { formula: `F${r}/(${valorPrev})`, result: v.faturamento / valorPrev }, { fmt: '0.00%', alinhar: 'center' });
      else celula(w2, `G${r}`, v.relacao ?? 'NA', { fmt: '0.00%', alinhar: 'center' });
      celula(w2, `H${r}`, v.clientes || ''); celula(w2, `I${r}`, v.participouAnterior || 'Não', { alinhar: 'center' });
    });

    // 3 - Carta Convite-Qualificações
    const w3 = wb.addWorksheet('3 - Carta Convite-Qualificações', { views: [{ showGridLines: false }] });
    w3.columns = [{ width: 2 }, { width: 5 }, { width: 12 }, { width: 38 }, { width: 14 }, { width: 14 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 13 }, { width: 15 }];
    ['B2:B3', 'C2:C3', 'D2:D3', 'E2:E3', 'F2:F3', 'G2:K2'].forEach((m) => w3.mergeCells(m));
    cab(w3, 2, 2, ['Nº', 'CÓDIGO SAP', 'EMPRESAS', 'CONFIRMOU PARTICIPAÇÃO', 'APRESENTOU PROPOSTA', 'QUALIFICAÇÕES']);
    cab(w3, 3, 7, ['TÉCNICA', 'SEGURANÇA', 'FINANCEIRA', 'COMPLIANCE', 'RESULTADO FINAL']);
    const quals = st.fornecedores.filter((f) => val(f.confirmou) || val(f.apresentou) || val(f.qTec) || (eq && eq.fids.includes(f.id)));
    quals.forEach((f, i) => {
      const r = 4 + i, q = (k, p) => String(val(f[k]) || p || '').toUpperCase();
      [i + 1, val(f.codigoSap) || '', String(val(f.nome)).toUpperCase(), q('confirmou', 'SIM'), q('apresentou', eq && eq.fids.includes(f.id) ? 'SIM' : ''), q('qTec', val(f.statusTecnico)), q('qSeg'), q('qFin'), q('qComp'), q('qResultado')]
        .forEach((v, j) => celula(w3, w3.getCell(r, 2 + j).address, v, { alinhar: j === 2 ? 'left' : 'center' }));
    });

    // 4 - Quadro de Preço
    if (eq && eq.rodadas.length) {
      const w4 = wb.addWorksheet('4 - Quadro de Preço', { views: [{ showGridLines: false }] });
      const rods = eq.rodadas;
      w4.getColumn(2).width = 38;
      const titulos = rods.map((r, i) => (r === 'R1' ? 'Proposta Inicial Equalizada' : r === 'BAFO' || i === rods.length - 1 ? (r === 'BAFO' ? 'Proposta Final' : `${E.nomeRodada(r).replace('ª r', 'ª R')} (Proposta Final)`) : E.nomeRodada(r).replace('ª r', 'ª R')));
      const ultCol = 2 + rods.length * 2;
      w4.mergeCells(2, 2, 2, ultCol);
      celula(w4, 'B2', 'EQUALIZAÇÃO COMERCIAL', { negrito: true, alinhar: 'center', fundo: AZUL });
      w4.mergeCells(3, 2, 5, 2);
      celula(w4, 'B3', 'PROPONENTES', { negrito: true, alinhar: 'center', fundo: AZUL });
      rods.forEach((r, i) => {
        const c = 3 + i * 2;
        w4.mergeCells(3, c, 3, c + 1); w4.mergeCells(4, c, 4, c + 1);
        celula(w4, w4.getCell(3, c).address, titulos[i], { negrito: true, alinhar: 'center', fundo: AZUL });
        const canal = [...new Set(eq.fids.map((f) => (eq.porRodada[r].totais[f] || {}).canal).filter(Boolean))].join(' / ') || 'PORTAL ME';
        celula(w4, w4.getCell(4, c).address, canal, { negrito: true, alinhar: 'center', fundo: AZUL });
        celula(w4, w4.getCell(5, c).address, st.moeda && st.moeda !== 'BRL' ? st.moeda : 'R$', { negrito: true, alinhar: 'center', fundo: AZUL });
        celula(w4, w4.getCell(5, c + 1).address, 'Posição', { negrito: true, alinhar: 'center', fundo: AZUL });
        w4.getColumn(c).width = 18; w4.getColumn(c + 1).width = 9;
      });
      eq.fids.forEach((fid, k) => {
        const r = 6 + k;
        celula(w4, `B${r}`, nomeF(fid));
        rods.forEach((rod, i) => {
          const t = eq.porRodada[rod].totais[fid], c = 3 + i * 2;
          celula(w4, w4.getCell(r, c).address, t ? t.equalizado : null, { fmt: MOEDA, fundo: t && t.herdada ? CINZA : undefined });
          celula(w4, w4.getCell(r, c + 1).address, t ? `${t.posicao}º` : '-', { alinhar: 'center' });
        });
      });
      const v = eq.vencedor;
      if (v) {
        const rv = 6 + eq.fids.indexOf(v.fid), r1 = 6 + eq.fids.length + 1;
        celula(w4, `B${r1}`, `Custo evitado (${st.moeda && st.moeda !== 'BRL' ? st.moeda : 'R$'})`, { negrito: true, fundo: CINZA });
        celula(w4, `B${r1 + 1}`, 'Custo evitado (%)', { negrito: true, fundo: CINZA });
        rods.forEach((rod, i) => {
          const c = 3 + i * 2, col = w4.getColumn(c).letter, col0 = w4.getColumn(3).letter;
          w4.mergeCells(r1, c, r1, c + 1); w4.mergeCells(r1 + 1, c, r1 + 1, c + 1);
          const t = eq.porRodada[rod].totais[v.fid];
          const ce = t && i > 0 ? v.negociacao.inicial - t.equalizado : 0;
          celula(w4, `${col}${r1}`, i > 0 ? { formula: `${col0}${rv}-${col}${rv}`, result: ce } : '-', { fmt: MOEDA, negrito: true, fundo: CINZA });
          celula(w4, `${col}${r1 + 1}`, i > 0 ? { formula: `IFERROR(${col}${r1}/${col0}${rv},0)`, result: v.negociacao.inicial ? ce / v.negociacao.inicial : 0 } : '-', { fmt: '0.00%', negrito: true, fundo: CINZA });
        });
      }

      // 4 - TCO (ponderação técnica e comercial), com as fórmulas da planilha oficial
      if (eq.resumo.usaTec) {
        const wt = wb.addWorksheet('4 - TCO', { views: [{ showGridLines: false }] });
        wt.columns = [{ width: 2 }, { width: 34 }, { width: 18 }, { width: 18 }, { width: 20 }, { width: 18 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 8 }];
        wt.mergeCells('B1:I1'); celula(wt, 'B1', 'PONDERAÇÃO TÉCNICA COMERCIAL', { negrito: true, alinhar: 'center', fundo: AZUL });
        celula(wt, 'C3', 'Peso Técnico', { negrito: true }); celula(wt, 'D3', eq.resumo.pT / 100, { fmt: '0%', fundo: AMARELO });
        celula(wt, 'C4', 'Peso Comercial', { negrito: true }); celula(wt, 'D4', eq.resumo.pC / 100, { fmt: '0%', fundo: AMARELO });
        celula(wt, 'C5', 'TOTAL', { negrito: true }); celula(wt, 'D5', { formula: 'SUM(D3:D4)', result: (eq.resumo.pT + eq.resumo.pC) / 100 }, { fmt: '0%' });
        cab(wt, 7, 2, ['PROPONENTES', 'PONTUAÇÃO TÉCNICA TOTAL', ' PONTUAÇÃO TÉCNICA PONDERADA', 'VALOR DA PROPOSTA COMERCIAL', 'PONTUAÇÃO COMERCIAL PONDERADA', 'PONTUAÇÃO FINAL', '', 'ORDEM PONTUAÇÃO FINAL']);
        const n = eq.classificacao.length, ult = 7 + n;
        eq.classificacao.forEach((c, k) => {
          const r = 8 + k;
          celula(wt, `B${r}`, String(c.nome).toUpperCase());
          celula(wt, `C${r}`, c.nt != null ? c.nt / 100 : null, { fmt: '0.00%', fundo: AMARELO });
          celula(wt, `D${r}`, { formula: `IF(OR($D$3="",C${r}=""),"",((C${r}*100*$D$3)))`, result: c.ntPond }, { fmt: '0.00' });
          celula(wt, `E${r}`, c.total, { fmt: MOEDA, fundo: AMARELO });
          celula(wt, `F${r}`, { formula: `IF(OR(E${r}="",$D$4=""),"",IF(E${r}/MIN($E$8:$E$${ult})>2,0,(1-((E${r}/MIN($E$8:$E$${ult})-1)))*100*$D$4))`, result: c.ncPond }, { fmt: '0.00' });
          celula(wt, `G${r}`, { formula: `IF(OR(D${r}="",F${r}=""),"",D${r}+F${r})`, result: c.nf }, { fmt: '0.00', negrito: c.posicao === 1 });
          celula(wt, `I${r}`, { formula: `IF(J${r}="","",RANK(J${r},$J$8:$J$${ult},1))`, result: c.posicao }, { alinhar: 'center' });
          wt.getCell(`J${r}`).value = { formula: `IF(G${r}="","",1-G${r})`, result: c.nf != null ? 1 - c.nf : null };
          wt.getCell(`J${r}`).font = { color: { argb: 'FFFFFFFF' } };
        });
        celula(wt, `B${ult + 3}`, 'Impacto de valor da ponderação técnica / comercial', { negrito: true });
        celula(wt, `C${ult + 3}`, eq.resumo.impactoPonderacao ?? 0, { fmt: '0.00%' });
      }
    }

    // 6 - Quadro Comparativo
    const ref = st.referencial || {};
    if (ref.contrato && ref.valorRef != null && ref.valorNovo != null) {
      const w6 = wb.addWorksheet('6 - Quadro Comparativo', { views: [{ showGridLines: false }] });
      w6.columns = [{ width: 2 }, { width: 32 }, { width: 20 }, { width: 16 }, { width: 16 }];
      w6.mergeCells('B2:E2'); celula(w6, 'B2', 'QUADRO COMPARATIVO DE PREÇO', { negrito: true, alinhar: 'center', fundo: AZUL });
      cab(w6, 3, 2, [`CONTRATO REFERÊNCIA Nº ${ref.contrato}`, 'NOVO CONTRATO', '', '% COMPARAÇÃO']);
      celula(w6, 'D3', { formula: 'IF(D4>=0,"AUMENTO","REDUÇÃO")', result: ref.valorNovo >= ref.valorRef ? 'AUMENTO' : 'REDUÇÃO' }, { negrito: true, alinhar: 'center', fundo: AZUL });
      celula(w6, 'B4', ref.valorRef, { fmt: MOEDA }); celula(w6, 'C4', ref.valorNovo, { fmt: MOEDA });
      celula(w6, 'D4', { formula: 'C4/B4-1', result: ref.valorNovo / ref.valorRef - 1 }, { fmt: '0.00%', alinhar: 'center' });
      celula(w6, 'E4', ref.pctComparacao ?? 1, { fmt: '0.00%', alinhar: 'center' });
    }

    // Aditivo Contratual
    if (dados.tipo === 'aditivo') {
      const wa = wb.addWorksheet('Aditivo Contratual', { views: [{ showGridLines: false }] });
      wa.columns = [{ width: 2 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 11 }, { width: 14 }, { width: 13 }, { width: 13 }];
      const ad = E.calcularAditivo(st);
      const ev = (st.evolucao || []).filter((r) => !(ad.substitui && E.parseNum(r.tac) >= ad.numero));
      const ini = ev[0];
      cab(wa, 2, 2, ['Data Base da Proposta', 'Valor Inicial (R$)', '', '', '', 'Prazo Inicial (meses)', 'Início ', 'Término ']);
      wa.mergeCells('C2:F2'); wa.mergeCells('C3:F3');
      celula(wa, 'B3', ini ? ini.data : ''); celula(wa, 'C3', ini ? ini.total : null, { fmt: MOEDA });
      celula(wa, 'G3', ini ? ini.prazo : null, { alinhar: 'center' }); celula(wa, 'H3', ini ? ini.inicio : ''); celula(wa, 'I3', ini ? ini.termino : '');
      cab(wa, 4, 2, ['Nº TAC', 'Data de Emissão do TAC', 'Valor  a ser aditado (R$)', 'Valor Total (R$)', 'Variação ', 'Prazo Aditado (meses)', 'Início ', 'Término ']);
      const linhas = ev.slice(1).concat([{ tac: `${ad.numero}º`, data: ad.data, aditado: ad.aditado, prazo: ad.prazo, inicio: ad.inicio, termino: ad.termino, novo: true }]);
      linhas.forEach((l, k) => {
        const r = 5 + k, ant = k === 0 ? 'C3' : `E${r - 1}`;
        const total = (k === 0 ? (ini ? ini.total : 0) : null);
        celula(wa, `B${r}`, l.tac, { alinhar: 'center', fundo: l.novo ? AMARELO : undefined });
        celula(wa, `C${r}`, l.data, { alinhar: 'center' });
        celula(wa, `D${r}`, l.aditado || 0, { fmt: MOEDA });
        celula(wa, `E${r}`, { formula: `D${r}+${ant}`, result: l.novo ? ad.total : l.total ?? total }, { fmt: MOEDA });
        celula(wa, `F${r}`, { formula: `E${r}/$C$3-1`, result: null }, { fmt: '0.00%', alinhar: 'center' });
        celula(wa, `G${r}`, l.prazo ?? null, { alinhar: 'center' }); celula(wa, `H${r}`, l.inicio || '', { alinhar: 'center' }); celula(wa, `I${r}`, l.termino || '', { alinhar: 'center' });
      });
    }

    // Detalhe FLOW: equalização item a item por rodada
    if (eq) for (const rod of eq.rodadas) {
      const R = eq.porRodada[rod];
      if (!R.linhas.length || R.fornecedores.every((f) => R.totais[f].semItens)) continue;
      const ws = wb.addWorksheet(`FLOW itens ${E.nomeRodada(rod)}`.slice(0, 31), { views: [{ state: 'frozen', xSplit: 4, ySplit: 3, showGridLines: false }] });
      ws.getColumn(1).width = 7; ws.getColumn(2).width = 46; ws.getColumn(3).width = 6; ws.getColumn(4).width = 9;
      celula(ws, 'A1', `Equalização item a item — ${E.nomeRodada(rod)} (valores pela quantidade da RC)`, { negrito: true });
      const fs = R.fornecedores;
      cab(ws, 3, 1, ['Item', 'Descrição', 'Un', 'Qtd RC']);
      fs.forEach((fid, k) => {
        const c0 = 5 + k * 3;
        ws.mergeCells(2, c0, 2, c0 + 2);
        celula(ws, ws.getCell(2, c0).address, nomeF(fid) + (R.totais[fid].herdada ? ` (mantida da ${E.nomeRodada(R.totais[fid].de)})` : ''), { negrito: true, alinhar: 'center', fundo: AZUL });
        cab(ws, 3, c0, ['Preço unit.', 'Total equalizado', 'Observação']);
        ws.getColumn(c0).width = 15; ws.getColumn(c0 + 1).width = 17; ws.getColumn(c0 + 2).width = 22;
      });
      R.linhas.forEach((ln, i) => {
        const r = 4 + i;
        [ln.item, ln.descricao, ln.un, ln.qtd].forEach((v, j) => celula(ws, ws.getCell(r, j + 1).address, v));
        fs.forEach((fid, k) => {
          const cel = ln.cel[fid], c0 = 5 + k * 3;
          const fundo = cel.preenchido ? LARANJA : cel.flags && cel.flags.length ? AMARELO : !cel.preenchido && ln.menor != null && cel.preco === ln.menor ? VERDE : undefined;
          const p = celula(ws, ws.getCell(r, c0).address, cel.preco ?? null, { fmt: MOEDA, fundo });
          celula(ws, ws.getCell(r, c0 + 1).address, cel.valor ?? null, { fmt: MOEDA, fundo });
          celula(ws, ws.getCell(r, c0 + 2).address, cel.preenchido ? 'Não cotado — equalizado' : (cel.flags || []).map(rotFlag).join('; '), { fundo });
          if (cel.fonte) p.note = `Fonte: ${cel.fonte}`;
        });
      });
      const rt = 4 + R.linhas.length;
      ws.mergeCells(rt, 1, rt, 4);
      celula(ws, `A${rt}`, 'TOTAL EQUALIZADO', { negrito: true, alinhar: 'right', fundo: CINZA });
      fs.forEach((fid, k) => { const c0 = 5 + k * 3; ws.mergeCells(rt, c0, rt, c0 + 2); celula(ws, ws.getCell(rt, c0).address, R.totais[fid].equalizado, { fmt: MOEDA, negrito: true, alinhar: 'center', fundo: CINZA }); });
    }

    // Alertas e fontes
    const wal = wb.addWorksheet('FLOW alertas', { views: [{ showGridLines: false }] });
    wal.columns = [{ width: 16 }, { width: 12 }, { width: 34 }, { width: 110 }];
    cab(wal, 1, 1, ['Rodada', 'Nível', 'Fornecedor', 'Descrição']);
    (eq ? eq.alertas : []).forEach((a, i) => [E.nomeRodada(a.rodada), a.nivel, nomeF(a.fid), a.msg].forEach((v, j) => celula(wal, wal.getCell(2 + i, 1 + j).address, v)));
    const wf = wb.addWorksheet('FLOW fontes', { views: [{ showGridLines: false }] });
    wf.columns = [{ width: 34 }, { width: 50 }, { width: 80 }];
    cab(wf, 1, 1, ['Campo', 'Valor', 'De onde veio']);
    let rf = 2;
    const addF = (k, f) => { [k, f && f.v != null ? String(f.v) : '—', (f && f.fonte) || '—'].forEach((v, j) => celula(wf, wf.getCell(rf, 1 + j).address, v)); rf++; };
    for (const [k, f] of Object.entries(st.cab || {})) addF(E.ROTULOS_CAB[k] || k, f);
    for (const f of st.fornecedores) { const n = val(f.nome); addF(`${n} — código SAP`, f.codigoSap); addF(`${n} — nota técnica`, f.nt); addF(`${n} — qualificação técnica`, f.qTec); }
    for (const p of st.propostas) addF(`Proposta ${nomeF(p.fornecedorId)} — ${E.nomeRodada(p.rodada)}`, { v: `${p.itens.length} itens · ${E.fmtBRL(E.parseNum(val(p.totalDeclarado)))}`, fonte: p.arquivo });
    rf++;
    for (const d of st.documentos.filter((x) => x.status !== 'duplicado' && x.tipo !== 'IGNORAR')) { [d.tipo ? E.TIPOS[d.tipo] : 'Não classificado', d.nome, d.caminho].forEach((v, j) => celula(wf, wf.getCell(rf, 1 + j).address, v)); rf++; }

    return wb.xlsx.writeBuffer();
  }

  return { escoparRelatorio, gerarPdfFLOW, htmlFLOW, gerarExcel, svgNegociacao, seriesNegociacao, corSerie, esc, abreviar };
});
