/*
 * Planilha de Preços Padrão Samarco — enviada junto com a carta-convite.
 * O fornecedor preenche as células amarelas e devolve; o FLOW Express lê
 * automaticamente. Usada no navegador (botão "Gerar planilha padrão") e no
 * Node (geração do processo de exemplo).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlanilhaPadrao = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const AMARELO = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF4C2' } };
  const CINZA = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F3F4' } };
  const AZUL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E4D64' } };
  const BORDA = { style: 'thin', color: { argb: 'FFB8C2C8' } };
  const BORDAS = { top: BORDA, left: BORDA, bottom: BORDA, right: BORDA };
  const MOEDA = '#,##0.00';

  /**
   * dados = { rc, objeto, itens:[{item,codigo,descricao,un,qtd}],
   *           proposta?: { fornecedor, cnpj, rodada, data, prazoEntrega, condPagamento, validade, frete,
   *                        precos: { [item]: { preco, total?, un?, qtd? } } } }
   */
  function criar(ExcelJS, dados) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'FLOW Express';
    const ws = wb.addWorksheet('Proposta', { views: [{ showGridLines: false }] });
    ws.columns = [
      { width: 7 }, { width: 13 }, { width: 58 }, { width: 7 }, { width: 10 }, { width: 19 }, { width: 19 },
    ];
    const p = dados.proposta || {};

    ws.mergeCells('A1:G1');
    const t = ws.getCell('A1');
    t.value = 'PLANILHA DE PREÇOS PADRÃO SAMARCO';
    t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t.fill = AZUL;
    t.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
    ws.getRow(1).height = 26;
    ws.mergeCells('A2:G2');
    ws.getCell('A2').value =
      'Preencha somente as células em amarelo. Não altere linhas, colunas ou a ordem dos itens. Valores em R$, sem impostos destacados.';
    ws.getCell('A2').font = { italic: true, size: 9, color: { argb: 'FF5F6B73' } };

    const cab = [
      ['RC', dados.rc, false],
      ['Objeto', dados.objeto, false],
      ['Fornecedor', p.fornecedor, true],
      ['CNPJ', p.cnpj, true],
      ['Rodada', p.rodada || '1ª rodada', true],
      ['Data da proposta', p.data, true],
      ['Prazo de entrega (dias)', p.prazoEntrega, true],
      ['Condição de pagamento (dias)', p.condPagamento, true],
      ['Validade da proposta (dias)', p.validade, true],
      ['Frete', p.frete, true],
    ];
    cab.forEach(([rot, v, edit], i) => {
      const r = 4 + i;
      ws.mergeCells(`A${r}:B${r}`);
      const a = ws.getCell(`A${r}`);
      a.value = rot;
      a.font = { bold: true, size: 10 };
      a.fill = CINZA;
      a.border = BORDAS;
      ws.mergeCells(`C${r}:D${r}`);
      const c = ws.getCell(`C${r}`);
      c.value = v == null ? null : v;
      c.border = BORDAS;
      if (edit) c.fill = AMARELO;
      if (v instanceof Date) c.numFmt = 'dd/mm/yyyy';
    });
    ws.getCell('C8').dataValidation = {
      type: 'list', allowBlank: false, formulae: ['"1ª rodada,2ª rodada,3ª rodada,4ª rodada,BAFO"'],
    };
    ws.getCell('C13').dataValidation = { type: 'list', allowBlank: true, formulae: ['"CIF,FOB"'] };

    const hr = 15;
    const cabecalho = ['Item', 'Código', 'Descrição', 'Un', 'Qtd', 'Preço unitário (R$)', 'Total (R$)'];
    cabecalho.forEach((h, i) => {
      const c = ws.getCell(hr, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = AZUL;
      c.border = BORDAS;
      c.alignment = { horizontal: i >= 4 ? 'right' : 'left', vertical: 'middle', wrapText: true };
    });
    ws.getRow(hr).height = 30;

    const precos = p.precos || {};
    dados.itens.forEach((it, i) => {
      const r = hr + 1 + i;
      const pr = precos[it.item] || {};
      const omitido = p.precos && !(it.item in precos);
      const qtd = pr.qtd != null ? pr.qtd : it.qtd;
      const preco = omitido ? null : pr.preco != null ? pr.preco : null;
      const vals = [Number(it.item) || it.item, it.codigo || '', it.descricao, pr.un || it.un, qtd, preco];
      vals.forEach((v, j) => {
        const c = ws.getCell(r, j + 1);
        c.value = v;
        c.border = BORDAS;
        if (j === 5) { c.fill = AMARELO; c.numFmt = MOEDA; }
        if (j === 4) c.numFmt = '#,##0.###';
        if (j === 2) c.alignment = { wrapText: true, vertical: 'top' };
      });
      const tot = ws.getCell(r, 7);
      tot.border = BORDAS;
      tot.numFmt = MOEDA;
      if (pr.total != null) tot.value = pr.total; // permite simular erro de digitação
      else tot.value = { formula: `E${r}*F${r}`, result: preco != null && qtd != null ? preco * qtd : 0 };
    });
    const rt = hr + 1 + dados.itens.length;
    ws.mergeCells(`A${rt}:F${rt}`);
    const lt = ws.getCell(`A${rt}`);
    lt.value = 'TOTAL GERAL (R$)';
    lt.font = { bold: true };
    lt.alignment = { horizontal: 'right' };
    lt.fill = CINZA;
    const somaRes = dados.itens.reduce((s, it) => {
      const pr = precos[it.item];
      if (!pr) return s;
      if (pr.total != null) return s + pr.total;
      const q = pr.qtd != null ? pr.qtd : it.qtd;
      return s + (pr.preco || 0) * (q || 0);
    }, 0);
    const ct = ws.getCell(`G${rt}`);
    ct.value = { formula: `SUM(G${hr + 1}:G${rt - 1})`, result: somaRes };
    ct.font = { bold: true };
    ct.numFmt = MOEDA;
    ct.fill = CINZA;
    ct.border = BORDAS;

    ws.getCell(`A${rt + 2}`).value = 'Observações do fornecedor:';
    ws.getCell(`A${rt + 2}`).font = { bold: true, size: 10 };
    ws.mergeCells(`A${rt + 3}:G${rt + 5}`);
    ws.getCell(`A${rt + 3}`).fill = AMARELO;
    ws.getCell(`A${rt + 3}`).border = BORDAS;
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return wb;
  }

  return { criar };
});
