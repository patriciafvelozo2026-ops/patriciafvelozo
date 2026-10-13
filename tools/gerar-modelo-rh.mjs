// Gera os modelos de RH provisórios (contratação e aditivo) com a MESMA estrutura
// do Relatório de Homologação da Samarco (cabeçalho em tabela + seções 1 a 6).
// O FLOW usa o formulário oficial quando ele está na pasta do processo (ou foi
// carregado na etapa RH); estes modelos só entram quando não há formulário.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, BorderStyle, ShadingType, Header, Footer, PageNumber } = require('docx');
const raiz = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const t = (text, o = {}) => new TextRun({ text, font: 'Arial', size: 18, ...o });
const cel = (runs, o = {}) => new TableCell({
  children: [new Paragraph({ alignment: o.centro ? AlignmentType.CENTER : AlignmentType.LEFT, children: runs })],
  columnSpan: o.span, margins: { top: 60, bottom: 60, left: 80, right: 80 },
  shading: o.cinza ? { type: ShadingType.CLEAR, fill: 'D9D9D9', color: 'auto' } : undefined,
});
const lin = (...cells) => new TableRow({ children: cells });
const rot = (r, v = '') => [t(r + ' ', { bold: true }), t(v)];
const secao = (s) => new Paragraph({
  spacing: { before: 280, after: 120 }, shading: { type: ShadingType.CLEAR, fill: 'D9D9D9', color: 'auto' },
  border: { top: { style: BorderStyle.SINGLE, size: 4, color: '000000' }, bottom: { style: BorderStyle.SINGLE, size: 4, color: '000000' } },
  children: [t(s, { bold: true, size: 20 })],
});

function cabecalho(aditivo) {
  const linhas = [
    lin(cel([t(aditivo ? 'RELATÓRIO DE HOMOLOGAÇÃO DE ALTERAÇÃO CONTRATUAL' : 'RELATÓRIO DE HOMOLOGAÇÃO DE CONTRATAÇÃO/AQUISIÇÃO', { bold: true, size: 24 })], { span: 3, centro: true })),
    lin(cel(rot('CONTRATO/PEDIDO DE COMPRA Nº', 'XXXXXXXXXX'), { span: 2 }), cel(rot('GERÊNCIA:', 'XXXXXXXXXX'))),
    lin(cel(rot('FORNECEDOR:')), cel([t('XXXXXXXXXXXXX')]), cel(rot('DATA DOCUMENTO:'))),
    lin(cel(rot('OBJETO:', 'XXXXXXXXXXXXXXXXXX'), { span: 3 })),
    lin(cel(rot('VALOR DA REQUISIÇÃO DE COMPRA:', 'R$'), { span: 2 }), cel(rot('Nº DA REQUISIÇÃO DE COMPRA:', 'XXXXXXXXXXXXX'))),
    ...(aditivo ? [lin(cel(rot('VALOR DO ADITIVO:', 'R$XXX.XXX,XX'), { span: 3 })), lin(cel(rot('NOVO VALOR TOTAL DO CONTRATO:', 'R$XXX.XXX,XX'), { span: 2 }), cel(rot('CUSTO EVITADO:', 'R$ XXXX – (XX%)')))]
      : [lin(cel(rot('VALOR TOTAL CONTRATADO:', 'R$XXX.XXX,XX'), { span: 2 }), cel(rot('CUSTO EVITADO:', 'R$ XXXX – (XX%)')))]),
    lin(cel(rot('PRAZO DE VIGÊNCIA:', 'Início em  e término em'), { span: 2 }), cel(rot('PRAZO:', 'XX (ano/mês)'))),
    lin(cel(rot('CONDIÇÃO DE PAGAMENTO:', 'XXXXXX'), { span: 3 })),
    lin(cel(rot('REGIME DE CONTRATAÇÃO:')), cel([t('XXXXXXX')]), cel(rot('INCOTERM:', 'XXXXXXX'))),
    lin(cel(rot('FÓRMULA PARAMÉTRICA DE REAJUSTE:')), cel([t('XXXXXXX')]), cel(rot('DATA BASE:', 'XXXXXXX'))),
    lin(cel(rot('PRAZO PARA RESCISÃO SEM ÔNUS:', 'XXXXX'), { span: 2 }), cel(rot('MULTA POR RESCISÃO:', 'XXXXX'))),
    lin(cel(rot(aditivo ? 'CLASSIFICAÇÃO DO ADITIVO:' : 'CLASSIFICAÇÃO DO PROCESSO DE COMPRA:')), cel([t('XXXXXXX')], { span: 2 })),
    lin(cel(rot('GERÊNCIA REQUISITANTE:')), cel([t('XXXXXXXXXXXXXXXXX')]), cel(rot('UNIDADE SAMARCO:', 'XXXXXXX'))),
    lin(cel(rot('GESTOR DO CONTRATO:', 'XXXXXXXXXXXXX'), { span: 3 })),
    lin(cel(rot('RESPONSÁVEL PELO PROCESSO:', 'XXXXXXX'), { span: 3 })),
    lin(cel(rot('FORMALIZAÇÃO DO PROCESSO:', 'XXXXXXX'), { span: 3 })),
    lin(cel([t('Nº RFQ ', { bold: true }), t('xxxxxxxx '), t('(Nº do ME – Nº SAP)', { bold: true })], { span: 3 })),
    lin(cel(rot('EXPLICAÇÃO CASO NÃO TENHA SIDO USADO MERCADO ELETRÔNICO:'), { span: 3 })),
    lin(cel(rot('ARQUIVAMENTO DO PROCESSO NO SHAREPOINT:', 'inserir o link da pasta'), { span: 3 })),
  ];
  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: linhas });
}

const comum = (filhos) => new Document({
  creator: 'FLOW Express',
  styles: { default: { document: { run: { font: 'Arial', size: 20 } } }, paragraphStyles: [{ id: 'Default', name: 'Default', run: { font: 'Arial', size: 20 } }] },
  sections: [{
    properties: { page: { margin: { top: 900, bottom: 900, left: 1000, right: 1000 } } },
    headers: { default: new Header({ children: [new Paragraph({ children: [t('GERÊNCIA GERAL DE SUPRIMENTOS', { bold: true })] })] }) },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t('Modelo provisório FLOW Express · página ', { size: 14, color: '7F7F7F' }), new TextRun({ children: [PageNumber.CURRENT], size: 14, color: '7F7F7F' })] })] }) },
    children: filhos,
  }],
});

const contratacao = comum([
  cabecalho(false),
  ...['1. ESTRATÉGIA DE CONTRATAÇÃO', '2. VENDOR LIST', '3. CARTA CONVITE E QUALIFICAÇÕES', '4. ANÁLISE E NEGOCIAÇÃO COMERCIAL', '5. REFERENCIAL COMPARATIVO', '6. CONCLUSÃO']
    .flatMap((s) => [secao(s), new Paragraph({ children: [t('(preenchido pelo FLOW Express)', { italics: true, color: '7F7F7F' })] })]),
]);
const aditivo = comum([
  cabecalho(true),
  secao('1. RESUMO DE EVOLUÇÃO DO CONTRATO:'),
  new Paragraph({ children: [t('Exemplo:', { italics: true, color: '7F7F7F' })] }),
  secao('2. DESCRIÇÃO DOS ADITIVOS:'),
  new Paragraph({ children: [t('1º Aditivo – Data: XX/XX/XXXX', { bold: true })] }),
  new Paragraph({ children: [t('Analista de compras/responsável: xxxxxxxxx')] }),
]);

const dir = path.join(raiz, 'modelos');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'Modelo_RH_provisorio.docx'), await Packer.toBuffer(contratacao));
fs.writeFileSync(path.join(dir, 'Modelo_RH_aditivo_provisorio.docx'), await Packer.toBuffer(aditivo));
console.log('Modelos de RH provisórios gerados em modelos/');
