/*
 * FLOW Express — saídas: RH no modelo Samarco (.docx), RH padrão FLOW (PDF via
 * impressão), planilha de equalização (.xlsx) e gráfico da negociação (SVG).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Saidas = factory(root.FlowEngine);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CORES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const corSerie = (i) => CORES[i] || '#8a8f94';

  // ------------------------------------------------------------ Word (modelo Samarco)

  /** Preenche um .docx com marcações {campo} / {#lista}...{/lista} (docxtemplater). */
  function gerarDocx(libs, modeloBytes, dados) {
    const zip = new libs.PizZip(modeloBytes);
    const doc = new libs.Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      nullGetter: () => '',
    });
    doc.render(dados);
    return doc.getZip().generate({
      type: libs.saidaBinaria || 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE',
    });
  }

  /** Lista as marcações encontradas num modelo .docx (para validar o modelo enviado). */
  function marcacoesDoModelo(libs, modeloBytes) {
    const zip = new libs.PizZip(modeloBytes);
    const xml = Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))
      .map((n) => zip.file(n).asText()).join(' ');
    const texto = xml.replace(/<[^>]+>/g, '');
    return [...new Set((texto.match(/\{[#\/^]?[A-Za-z][\w.]*\}/g) || []))];
  }

  const MARCACOES = {
    simples: [
      ['rc', 'Número da RC'], ['objeto', 'Objeto'], ['requisitante', 'Requisitante'], ['centroCusto', 'Centro de custo'],
      ['comprador', 'Comprador'], ['dataRC', 'Data da RC'], ['dataRH', 'Data do RH'], ['valorEstimado', 'Valor estimado (R$)'],
      ['criterio', 'Critério de julgamento'], ['pesoTecnico', 'Peso técnico (%)'], ['pesoComercial', 'Peso comercial (%)'],
      ['qtdFornecedores', 'Nº de fornecedores'], ['qtdRodadas', 'Nº de rodadas'], ['rodadaFinal', 'Nome da rodada final'],
      ['vencedor', 'Fornecedor recomendado'], ['vencedorCnpj', 'CNPJ do recomendado'], ['valorFinal', 'Valor final (R$)'],
      ['valorFinalExtenso', 'Valor final por extenso'], ['valorInicialVencedor', 'Proposta inicial do recomendado'],
      ['savingNegociacao', 'Saving sobre a proposta inicial (R$)'], ['savingNegociacaoPct', 'Saving sobre a proposta inicial (%)'],
      ['savingEstimado', 'Saving sobre o estimado (R$)'], ['savingEstimadoPct', 'Saving sobre o estimado (%)'],
      ['prazoEntregaVencedor', 'Prazo de entrega do recomendado'], ['condPagamentoVencedor', 'Condição de pagamento do recomendado'],
      ['justificativa', 'Justificativa da recomendação'], ['observacoes', 'Observações'],
    ],
    listas: [
      ['fornecedores', 'posicao, nome, cnpj, homologacao, statusTecnico, notaTecnica, notaComercial, notaFinal, valorInicial, valorFinal, saving, savingPct, prazoEntrega, condPagamento, frete, validade, observacao'],
      ['itensVencedor', 'item, codigo, descricao, un, qtd, precoUnit, total, obs'],
      ['rodadas', 'rodada, ata e a sublista {#valores}{fornecedor}: {valor}{/valores}'],
      ['anexos', 'nome, tipo'],
      ['pendencias', 'grupo, desc, dica'],
      ['alertas', 'msg'],
    ],
  };

  // ------------------------------------------------------------ gráfico da negociação

  /** series: [{nome, cor, pontos:[{rodada, rotulo, total, herdada}]}] */
  function svgNegociacao(series, rotulos, opt = {}) {
    const W = opt.largura || 760, H = opt.altura || 300;
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
      s += `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grade,#e6e8ea)" stroke-width="1"/>`;
      s += `<text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--texto-2,#5f6b73)">${esc(abreviar(v))}</text>`;
    }
    rotulos.forEach((r, i) => {
      s += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="12" fill="var(--texto-2,#5f6b73)">${esc(r)}</text>`;
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
          ? `<circle cx="${x(p.j)}" cy="${y(p.total)}" r="4" fill="var(--superficie,#fff)" stroke="${se.cor}" stroke-width="2"/>`
          : `<circle cx="${x(p.j)}" cy="${y(p.total)}" r="4.5" fill="${se.cor}" stroke="var(--superficie,#fff)" stroke-width="2"/>`;
      });
    });
    for (const f of finais) {
      s += `<line x1="${W - m.r + 8}" x2="${W - m.r + 20}" y1="${f.y}" y2="${f.y}" stroke="${f.se.cor}" stroke-width="2"/>`;
      s += `<text x="${W - m.r + 26}" y="${f.y + 4}" font-size="11.5" fill="var(--texto,#1d2327)">${esc(curto(f.se.nome, 17))} · ${esc(abreviar(f.u.total))}</text>`;
    }
    if (opt.hover) {
      const w = rotulos.length === 1 ? W - m.l - m.r : (W - m.l - m.r) / (rotulos.length - 1);
      rotulos.forEach((_, i) => {
        s += `<g class="hcol" data-i="${i}"><line class="cross" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${H - m.b}" stroke="var(--texto-2,#5f6b73)" stroke-dasharray="3 3"/>` +
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

  function htmlFLOW(st, eq, dados) {
    const r = eq.resumo;
    const R = r.ultima ? eq.porRodada[r.ultima] : null;
    const series = seriesNegociacao(st, eq);
    const nomeF = (fid) => E.val(st.fornecedores.find((f) => f.id === fid).nome);
    const kpi = (rot, v, sub) => `<div class="kpi"><div class="kr">${esc(rot)}</div><div class="kv">${esc(v)}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ''}</div>`;
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
@page{size:A4;margin:14mm 13mm 16mm}
*{box-sizing:border-box}body{margin:0;font-family:"Segoe UI",Calibri,Arial,sans-serif;color:#1d2327;font-size:10.5pt;line-height:1.4;background:#fff}
.pg{max-width:190mm;margin:0 auto;padding:6mm 0}
.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #0e4d64;padding-bottom:8px;margin-bottom:14px}
.marca{font-weight:800;letter-spacing:.06em;color:#0e4d64;font-size:20pt}.marca span{font-weight:400;color:#5f6b73;font-size:10pt;letter-spacing:0;margin-left:8px}
.doc{text-align:right;font-size:9pt;color:#5f6b73}.doc b{display:block;font-size:13pt;color:#1d2327}
h2{font-size:11.5pt;color:#0e4d64;margin:18px 0 6px;padding-bottom:3px;border-bottom:1px solid #d5dbdf;break-after:avoid}
.obj{font-size:11pt;margin:0 0 10px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 4px}
.kpi{border:1px solid #d5dbdf;border-radius:6px;padding:8px 10px}.kr{font-size:8.5pt;color:#5f6b73}.kv{font-size:13pt;font-weight:700;margin-top:2px}.ks{font-size:8.5pt;color:#5f6b73}
.kpi.dest{background:#0e4d64;color:#fff;border-color:#0e4d64}.kpi.dest .kr,.kpi.dest .ks{color:#cfe3ea}
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
</style></head><body><div class="pg">
<div class="top"><div class="marca">FLOW<span>RH do processo de compra</span></div><div class="doc"><b>RC ${esc(dados.rc || '—')}</b>Emitido em ${esc(dados.dataRH)}</div></div>
<p class="obj"><b>Objeto:</b> ${esc(dados.objeto || '—')}</p>
<div class="kpis">
${kpi('Fornecedor recomendado', dados.vencedor || '—', dados.vencedorCnpj)}
<div class="kpi dest"><div class="kr">Valor final equalizado</div><div class="kv">${esc(dados.valorFinal || '—')}</div><div class="ks">${esc(dados.rodadaFinal)}</div></div>
${kpi('Saving sobre a proposta inicial', dados.savingNegociacao, dados.savingNegociacaoPct)}
${kpi('Saving sobre o estimado', dados.savingEstimado, dados.savingEstimadoPct + ' · estimado ' + dados.valorEstimado)}
</div>
<section><h2>1. Identificação do processo</h2><table class="id">
${linhaId('Requisição de compra (RC)', dados.rc)}${linhaId('Data da RC', dados.dataRC)}${linhaId('Requisitante', dados.requisitante)}
${linhaId('Centro de custo', dados.centroCusto)}${linhaId('Comprador', dados.comprador)}${linhaId('Valor estimado', dados.valorEstimado)}
${linhaId('Critério de julgamento', dados.criterio)}${linhaId('Fornecedores participantes', dados.qtdFornecedores)}${linhaId('Rodadas de negociação', dados.qtdRodadas)}
</table></section>
<section><h2>2. Classificação final (${esc(dados.rodadaFinal)})</h2><table class="t"><thead><tr><th class="c">Pos.</th><th>Fornecedor</th>${r.usaTec ? '<th class="n">Nota técnica</th><th class="n">Nota comercial</th>' : ''}<th class="n">Nota final</th><th class="n">Valor equalizado</th><th>Homologação</th></tr></thead><tbody>${classif}</tbody></table>
${r.usaTec ? `<p class="mini">Nota comercial = 100 × menor preço equalizado ÷ preço do fornecedor. Nota final = ${r.pT}% técnica + ${r.pC}% comercial.</p>` : ''}</section>
<section><h2>3. Negociação</h2>${svgNegociacao(series, eq.rodadas.map(E.nomeRodada), { largura: 700, altura: 240 })}
<table class="t"><thead><tr><th>Fornecedor</th>${eq.rodadas.map((x) => `<th class="n">${esc(E.nomeRodada(x))}</th>`).join('')}<th class="n">Saving</th><th class="n">%</th></tr></thead><tbody>${neg}</tbody></table>
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

  const rotFlag = (f) => ({ unidade: 'unidade ≠ RC', quantidade: 'qtd ≠ RC', total: 'total ≠ qtd×preço', faltante: 'não cotado' }[f] || f);

  // ------------------------------------------------------------ Excel de equalização

  async function gerarExcel(libs, st, eq, dados) {
    const wb = new libs.ExcelJS.Workbook();
    wb.creator = 'FLOW Express';
    const AZUL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E4D64' } };
    const CLARO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3F5' } };
    const VERDE = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF5EF' } };
    const LARANJA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE9CC' } };
    const AMARELO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8DB' } };
    const B = { style: 'thin', color: { argb: 'FFD5DBDF' } };
    const BORDAS = { top: B, left: B, bottom: B, right: B };
    const MOEDA = '"R$" #,##0.00';
    const nomeF = (fid) => E.val(st.fornecedores.find((f) => f.id === fid).nome);
    const cab = (ws, r, textos, c0 = 1) => textos.forEach((t, i) => {
      const c = ws.getCell(r, c0 + i);
      c.value = t; c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = AZUL; c.border = BORDAS;
      c.alignment = { vertical: 'middle', wrapText: true };
    });
    const titulo = (ws, t, sub) => {
      ws.getCell('A1').value = t; ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0E4D64' } };
      ws.getCell('A2').value = sub; ws.getCell('A2').font = { color: { argb: 'FF5F6B73' } };
    };

    // Resumo
    const wr = wb.addWorksheet('Resumo', { views: [{ showGridLines: false }] });
    wr.columns = [{ width: 34 }, { width: 46 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 34 }];
    titulo(wr, `Equalização — RC ${dados.rc}`, dados.objeto);
    const ident = [['Requisitante', dados.requisitante], ['Comprador', dados.comprador], ['Valor estimado', E.parseNum(E.val(st.processo.valorEstimado))],
      ['Critério', dados.criterio], ['Rodada final', dados.rodadaFinal], ['Fornecedor recomendado', dados.vencedor],
      ['Valor final equalizado', eq.vencedor ? eq.vencedor.total : null], ['Saving sobre a proposta inicial', eq.resumo.savingNegociacao],
      ['Saving sobre a proposta inicial (%)', eq.resumo.savingNegociacaoPct], ['Saving sobre o estimado', eq.resumo.savingEstimado],
      ['Saving sobre o estimado (%)', eq.resumo.savingEstimadoPct]];
    ident.forEach(([k, v], i) => {
      const a = wr.getCell(4 + i, 1), b = wr.getCell(4 + i, 2);
      a.value = k; a.font = { bold: true }; a.fill = CLARO; a.border = BORDAS;
      b.value = v == null ? '—' : v; b.border = BORDAS;
      if (typeof v === 'number') b.numFmt = /%/.test(k) ? '0.0%' : MOEDA;
    });
    let r0 = 4 + ident.length + 2;
    wr.getCell(r0 - 1, 1).value = 'Classificação final'; wr.getCell(r0 - 1, 1).font = { bold: true, size: 12 };
    cab(wr, r0, ['Posição', 'Fornecedor', 'Nota técnica', 'Nota comercial', 'Nota final', 'Valor equalizado', 'Situação']);
    eq.classificacao.forEach((c, i) => {
      const row = wr.getRow(r0 + 1 + i);
      row.values = [c.posicao ? c.posicao + 'º' : 'Desclass.', c.nome, c.nt, c.nc, c.nf, c.total, c.motivos.join('; ') || 'OK'];
      row.eachCell((cel, j) => { cel.border = BORDAS; if (j >= 3 && j <= 5) cel.numFmt = '0.00'; if (j === 6) cel.numFmt = MOEDA; if (c.posicao === 1) cel.fill = VERDE; });
    });

    // Uma aba por rodada
    for (const rod of eq.rodadas) {
      const R = eq.porRodada[rod];
      const ws = wb.addWorksheet(`Equalização ${E.nomeRodada(rod)}`.slice(0, 31), { views: [{ state: 'frozen', xSplit: 4, ySplit: 5, showGridLines: false }] });
      titulo(ws, `Equalização — ${E.nomeRodada(rod)}`, `RC ${dados.rc} · valores pela quantidade da RC · faltantes: ${st.config.faltante === 'nenhum' ? 'não preenchidos' : st.config.faltante === 'media' ? 'preço médio' : 'maior preço'} dos demais`);
      ws.getColumn(1).width = 6; ws.getColumn(2).width = 46; ws.getColumn(3).width = 6; ws.getColumn(4).width = 9;
      const fs = R.fornecedores;
      ws.getRow(4).height = 30;
      fs.forEach((fid, k) => {
        const c0 = 5 + k * 3;
        ws.mergeCells(4, c0, 4, c0 + 2);
        const c = ws.getCell(4, c0);
        c.value = nomeF(fid) + (R.totais[fid].herdada ? ` (mantida da ${E.nomeRodada(R.totais[fid].de)})` : '');
        c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = AZUL; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        ws.getColumn(c0).width = 15; ws.getColumn(c0 + 1).width = 17; ws.getColumn(c0 + 2).width = 22;
      });
      cab(ws, 5, ['Item', 'Descrição', 'Un', 'Qtd RC']);
      fs.forEach((_, k) => cab(ws, 5, ['Preço unit.', 'Total equalizado', 'Observação'], 5 + k * 3));
      R.linhas.forEach((ln, i) => {
        const r = 6 + i;
        [ln.item, ln.descricao, ln.un, ln.qtd].forEach((v, j) => { const c = ws.getCell(r, j + 1); c.value = v; c.border = BORDAS; });
        fs.forEach((fid, k) => {
          const cel = ln.cel[fid], c0 = 5 + k * 3;
          const p = ws.getCell(r, c0), t = ws.getCell(r, c0 + 1), o = ws.getCell(r, c0 + 2);
          p.value = cel.preco ?? null; t.value = cel.valor ?? null; p.numFmt = t.numFmt = MOEDA;
          o.value = cel.preenchido ? 'Não cotado — equalizado' : cel.flags.map(rotFlag).join('; ');
          [p, t, o].forEach((x) => { x.border = BORDAS; if (cel.preenchido) x.fill = LARANJA; else if (cel.flags.length) x.fill = AMARELO; });
          if (!cel.preenchido && !cel.flags.length && ln.menor != null && cel.preco === ln.menor) { p.fill = t.fill = VERDE; p.font = t.font = { bold: true, color: { argb: 'FF0A6B3D' } }; }
          if (cel.fonte) p.note = `Fonte: ${cel.fonte}`;
        });
      });
      let r = 6 + R.linhas.length;
      const rodape = [
        ['Soma dos itens (equalizada)', (t) => t.somaItens, MOEDA], ['Ajuste', (t) => t.ajuste, MOEDA],
        ['TOTAL EQUALIZADO', (t) => t.equalizado, MOEDA], ['Total declarado pelo fornecedor', (t) => t.declarado, MOEDA],
        ['Itens não cotados', (t) => t.faltantes, '0'], ['Prazo de entrega', (t) => t.condicoes.prazoEntrega],
        ['Condição de pagamento', (t) => t.condicoes.condPagamento], ['Frete', (t) => t.condicoes.frete], ['Validade', (t) => t.condicoes.validade],
      ];
      for (const [rot, fn, fmt] of rodape) {
        ws.mergeCells(r, 1, r, 4);
        const a = ws.getCell(r, 1); a.value = rot; a.font = { bold: true }; a.fill = CLARO; a.alignment = { horizontal: 'right' };
        fs.forEach((fid, k) => {
          const c0 = 5 + k * 3;
          ws.mergeCells(r, c0, r, c0 + 2);
          const c = ws.getCell(r, c0);
          const v = fn(R.totais[fid]);
          c.value = v == null ? '—' : v; c.alignment = { horizontal: 'center' }; c.border = BORDAS;
          if (fmt && typeof v === 'number') c.numFmt = fmt;
          if (rot === 'TOTAL EQUALIZADO') { c.font = { bold: true }; c.fill = CLARO; }
        });
        r++;
      }
    }

    // Negociação
    const wn = wb.addWorksheet('Negociação', { views: [{ showGridLines: false }] });
    titulo(wn, 'Evolução da negociação', `RC ${dados.rc} · valores equalizados por rodada`);
    wn.getColumn(1).width = 40;
    cab(wn, 4, ['Fornecedor', ...eq.rodadas.map(E.nomeRodada), 'Proposta inicial', 'Proposta final', 'Saving (R$)', 'Saving (%)']);
    eq.fids.forEach((fid, i) => {
      const n = eq.negociacao[fid];
      const row = wn.getRow(5 + i);
      row.values = [nomeF(fid), ...n.serie.map((p) => p.total), n.inicial, n.final, n.saving, n.savingPct];
      row.eachCell((c, j) => { c.border = BORDAS; if (j > 1) c.numFmt = j === row.cellCount ? '0.0%' : MOEDA; });
    });
    for (let j = 2; j <= eq.rodadas.length + 5; j++) wn.getColumn(j).width = 17;

    // Alertas
    const wa = wb.addWorksheet('Alertas', { views: [{ showGridLines: false }] });
    titulo(wa, 'Alertas da equalização', 'Itens faltantes, unidades/quantidades diferentes e totais que não batem');
    wa.columns = [{ width: 14 }, { width: 12 }, { width: 34 }, { width: 110 }];
    cab(wa, 4, ['Rodada', 'Nível', 'Fornecedor', 'Descrição']);
    eq.alertas.forEach((a, i) => {
      const row = wa.getRow(5 + i);
      row.values = [E.nomeRodada(a.rodada), a.nivel, nomeF(a.fid), a.msg];
      row.eachCell((c) => { c.border = BORDAS; c.alignment = { wrapText: true, vertical: 'top' }; });
    });

    // Fontes
    const wf = wb.addWorksheet('Fontes', { views: [{ showGridLines: false }] });
    titulo(wf, 'De onde veio cada informação', 'Rastreabilidade para auditoria');
    wf.columns = [{ width: 30 }, { width: 50 }, { width: 70 }];
    cab(wf, 4, ['Campo', 'Valor', 'Fonte']);
    const rotulos = { rc: 'RC', objeto: 'Objeto', requisitante: 'Requisitante', centroCusto: 'Centro de custo', comprador: 'Comprador', valorEstimado: 'Valor estimado', dataRC: 'Data da RC' };
    let rf = 5;
    const addF = (k, f) => { wf.getRow(rf++).values = [k, f && f.v != null ? f.v : '—', (f && f.fonte) || '—']; };
    for (const [k, rot] of Object.entries(rotulos)) addF(rot, st.processo[k]);
    for (const f of st.fornecedores) {
      const n = E.val(f.nome);
      addF(`${n} — CNPJ`, f.cnpj); addF(`${n} — nota técnica`, f.nt); addF(`${n} — resultado técnico`, f.statusTecnico);
      addF(`${n} — homologação`, f.homStatus); addF(`${n} — validade homologação`, f.homValidade);
    }
    for (const p of st.propostas) addF(`Proposta ${nomeF(p.fornecedorId)} — ${E.nomeRodada(p.rodada)}`, { v: `${p.itens.length} itens`, fonte: p.arquivo });
    rf++;
    wf.getCell(rf, 1).value = 'Documentos da pasta'; wf.getCell(rf, 1).font = { bold: true }; rf++;
    for (const d of st.documentos) wf.getRow(rf++).values = [d.tipo ? E.TIPOS[d.tipo] : 'Não classificado', d.nome, d.caminho];

    return wb.xlsx.writeBuffer();
  }

  return { gerarDocx, marcacoesDoModelo, MARCACOES, htmlFLOW, gerarExcel, svgNegociacao, seriesNegociacao, corSerie, esc, abreviar };
});
