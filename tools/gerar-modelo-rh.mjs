// Gera o modelo de RH em Word (provisório) com as marcações do FLOW Express.
// Quando chegar o modelo atual da Samarco, basta inserir as mesmas marcações nele.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle,
  ShadingType, PageOrientation, Footer, PageNumber,
} = require('docx');

const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AZUL = '0E4D64';

const t = (text, o = {}) => new TextRun({ text, font: 'Calibri', size: 20, ...o });
const p = (runs, o = {}) => new Paragraph({ spacing: { after: 80 }, ...o, children: Array.isArray(runs) ? runs : [t(runs)] });
const titulo = (s) => new Paragraph({
  spacing: { before: 240, after: 100 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: AZUL } },
  children: [t(s, { bold: true, size: 24, color: AZUL })],
});
const cel = (text, o = {}) => new TableCell({
  children: [new Paragraph({ alignment: o.dir ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [t(text, { bold: !!o.cab, color: o.cab ? 'FFFFFF' : undefined, size: 18 })] })],
  shading: o.cab ? { type: ShadingType.CLEAR, fill: AZUL, color: 'auto' } : o.cinza ? { type: ShadingType.CLEAR, fill: 'EEF3F5', color: 'auto' } : undefined,
  margins: { top: 50, bottom: 50, left: 80, right: 80 },
  ...(o.w ? { width: { size: o.w, type: WidthType.PERCENTAGE } } : {}),
});
const tabela = (cab, linhaLoop, dir = [], larg = []) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: cab.map((c, i) => cel(c, { cab: true, w: larg[i] })) }),
    new TableRow({ children: linhaLoop.map((c, i) => cel(c, { dir: dir.includes(i), w: larg[i] })) }),
  ],
});
const pares = (linhas) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: linhas.map(([k, v]) => new TableRow({ children: [cel(k, { cinza: true, w: 32 }), cel(v, { w: 68 })] })),
});

const doc = new Document({
  creator: 'FLOW Express',
  title: 'RH – modelo provisório',
  sections: [{
    properties: { page: { margin: { top: 900, bottom: 900, left: 900, right: 900 } } },
    footers: {
      default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t('RH – RC {rc} · página ', { size: 16, color: '5F6B73' }), new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '5F6B73' })] })] }),
    },
    children: [
      new Paragraph({ children: [t('RH – RELATÓRIO DO PROCESSO DE COMPRA', { bold: true, size: 32, color: AZUL })] }),
      p([t('RC {rc}', { bold: true, size: 24 }), t('   ·   emitido em {dataRH}', { color: '5F6B73' })]),

      titulo('1. Identificação'),
      pares([
        ['Requisição de compra (RC)', '{rc}'], ['Data da RC', '{dataRC}'], ['Objeto', '{objeto}'],
        ['Requisitante', '{requisitante}'], ['Centro de custo', '{centroCusto}'], ['Comprador', '{comprador}'],
        ['Valor estimado', '{valorEstimado}'], ['Critério de julgamento', '{criterio}'],
        ['Fornecedores participantes', '{qtdFornecedores}'], ['Rodadas de negociação', '{qtdRodadas}'],
      ]),

      titulo('2. Classificação final ({rodadaFinal})'),
      tabela(['Pos.', 'Fornecedor', 'CNPJ', 'Nota técnica', 'Nota comercial', 'Nota final', 'Valor final', 'Homologação'],
        ['{#fornecedores}{posicao}', '{nome}', '{cnpj}', '{notaTecnica}', '{notaComercial}', '{notaFinal}', '{valorFinal}', '{homologacao}{/fornecedores}'], [3, 4, 5, 6], [6, 22, 16, 9, 10, 9, 13, 15]),
      p([t('Pesos: {pesoTecnico}% técnico e {pesoComercial}% comercial. Nota comercial = 100 × menor preço ÷ preço do fornecedor.', { size: 16, color: '5F6B73' })]),

      titulo('3. Condições comerciais'),
      tabela(['Fornecedor', 'Prazo de entrega', 'Pagamento', 'Frete', 'Validade'],
        ['{#fornecedores}{nome}', '{prazoEntrega}', '{condPagamento}', '{frete}', '{validade}{/fornecedores}']),

      titulo('4. Negociação'),
      tabela(['Fornecedor', 'Proposta inicial', 'Proposta final', 'Saving (R$)', 'Saving (%)'],
        ['{#fornecedores}{nome}', '{valorInicial}', '{valorFinal}', '{saving}', '{savingPct}{/fornecedores}'], [1, 2, 3, 4]),
      p('{#rodadas}'),
      p([t('{rodada}: ', { bold: true }), t('{#valores}{fornecedor} {valor}; {/valores}'), t('{#ata} (ata: {ata}){/ata}', { color: '5F6B73' })]),
      p('{/rodadas}'),

      titulo('5. Recomendação'),
      pares([
        ['Fornecedor recomendado', '{vencedor} – CNPJ {vencedorCnpj}'],
        ['Valor final', '{valorFinal} ({valorFinalExtenso})'],
        ['Proposta inicial do fornecedor', '{valorInicialVencedor}'],
        ['Saving sobre a proposta inicial', '{savingNegociacao} ({savingNegociacaoPct})'],
        ['Saving sobre o valor estimado', '{savingEstimado} ({savingEstimadoPct})'],
        ['Prazo de entrega / pagamento', '{prazoEntregaVencedor} / {condPagamentoVencedor}'],
      ]),
      p([t('Justificativa: ', { bold: true }), t('{justificativa}')], { spacing: { before: 120, after: 80 } }),
      p([t('Observações: ', { bold: true }), t('{observacoes}')]),

      titulo('6. Itens do fornecedor recomendado'),
      tabela(['Item', 'Código', 'Descrição', 'Un', 'Qtd', 'Preço unit.', 'Total'],
        ['{#itensVencedor}{item}', '{codigo}', '{descricao}', '{un}', '{qtd}', '{precoUnit}', '{total}{/itensVencedor}'], [4, 5, 6], [6, 11, 43, 6, 8, 12, 14]),

      titulo('7. Anexos'),
      p('{#anexos}'), p([t('• {nome} – {tipo}')]), p('{/anexos}'),

      p('{#temPendencias}'),
      titulo('8. Pendências'),
      p('{#pendencias}'), p([t('• {grupo}: {desc}{#dica} ({dica}){/dica}', { color: 'B3261E' })]), p('{/pendencias}'),
      p('{/temPendencias}'),

      new Paragraph({ spacing: { before: 700 }, children: [] }),
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: [
          new TableCell({ borders: { top: { style: BorderStyle.SINGLE, size: 6, color: '1D2327' } }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('{comprador}'), t(' – Suprimentos', { color: '5F6B73' })] })] }),
          new TableCell({ children: [new Paragraph('')], width: { size: 10, type: WidthType.PERCENTAGE } }),
          new TableCell({ borders: { top: { style: BorderStyle.SINGLE, size: 6, color: '1D2327' } }, children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('Aprovação – Gerência')] })] }),
        ] })],
      }),
    ],
  }],
});

const destino = path.join(raiz, 'modelos', 'Modelo_RH_provisorio.docx');
fs.mkdirSync(path.dirname(destino), { recursive: true });
fs.writeFileSync(destino, await Packer.toBuffer(doc));
console.log('Modelo de RH gerado:', path.relative(raiz, destino));
