/**
 * Prestadores Villagio Campo Grande – servidor (Google Apps Script).
 *
 * Publica a página (Index.html) num link que qualquer vizinho abre sem login.
 * Os contatos ficam guardados nas propriedades do próprio script: não há
 * planilha. Quem abre o link pode adicionar, corrigir e remover; toda remoção
 * fica nas "Últimas alterações" com um botão para restaurar.
 */

// Opcional: uma palavra combinada no grupo (ex.: 'villagio'). Se preenchida, a
// página pede essa palavra uma vez antes de salvar. Vazio = ninguém precisa.
var CODIGO_ACESSO = '';

var TITULO = 'Prestadores Villagio Campo Grande';
var CATEGORIAS = ['Reparos e obras', 'Eletrodomésticos', 'Casa e decoração', 'Comida',
  'Beleza e bem-estar', 'Carro e moto', 'Outros serviços'];
var CAMPOS = ['servico', 'nome', 'tel', 'cat', 'insta', 'obs', 'indicado'];
var MAX_HISTORICO = 100;
var TAMANHO_PEDACO = 3000; // cada propriedade aceita até 9 KB

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(TITULO)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * A logomarca fica no arquivo Logo.html (só o código da imagem, em base64).
 * Se o arquivo faltar ou vier cortado, a página abre sem logo.
 */
function logo() {
  try {
    var b64 = HtmlService.createHtmlOutputFromFile('Logo').getContent().replace(/[^A-Za-z0-9+\/=]/g, '');
    if (b64.length < 1000 || b64.length % 4 !== 0) return '';
    Utilities.base64Decode(b64);
    return '<div class="marca"><img src="data:image/webp;base64,' + b64 +
      '" alt="Patrícia Velozo Consultoria &amp; IA"></div>';
  } catch (e) {
    return '';
  }
}

/** Chamado pela página ao abrir e ao voltar para ela. */
function listar() {
  var d = ler_();
  return {
    prestadores: d.prestadores,
    categorias: CATEGORIAS,
    historico: d.historico.slice(0, 30),
    atualizada: d.atualizada,
    pedeCodigo: CODIGO_ACESSO !== ''
  };
}

/**
 * op.acao: 'adicionar' | 'corrigir' | 'remover' | 'restaurar'.
 * Devolve a lista nova, ou {repetido} quando o telefone já existe.
 */
function salvar(op, codigo) {
  op = op || {};
  if (CODIGO_ACESSO && normalizar_(codigo) !== normalizar_(CODIGO_ACESSO)) {
    throw new Error('Palavra do condomínio incorreta. Confira no grupo.');
  }
  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var d = ler_();
    var agora = new Date().toISOString();
    var acharPorId = function (id) {
      for (var i = 0; i < d.prestadores.length; i++) if (d.prestadores[i].id === id) return i;
      return -1;
    };
    var i, item;

    if (op.acao === 'adicionar' || op.acao === 'corrigir') {
      item = validar_(op.item);
      var repetido = d.prestadores.filter(function (p) {
        return p.tel === item.tel && p.id !== (op.acao === 'corrigir' ? op.item.id : null);
      })[0];
      if (repetido && !op.confirmarRepetido) return { repetido: repetido };
    }

    if (op.acao === 'adicionar') {
      item.id = Utilities.getUuid().slice(0, 8);
      d.prestadores.push(item);
      registrar_(d, agora, 'adicionou', item, null);
    } else if (op.acao === 'corrigir') {
      i = acharPorId(String(op.item.id));
      if (i < 0) throw new Error('Esse contato foi removido por outra pessoa. A lista foi atualizada.');
      item.id = d.prestadores[i].id;
      registrar_(d, agora, 'corrigiu', item, d.prestadores[i]);
      d.prestadores[i] = item;
    } else if (op.acao === 'remover') {
      i = acharPorId(String(op.id));
      if (i >= 0) {
        registrar_(d, agora, 'removeu', d.prestadores[i], d.prestadores[i]);
        d.prestadores.splice(i, 1);
      }
    } else if (op.acao === 'restaurar') {
      var h = d.historico.filter(function (x) { return x.hid === op.hid; })[0];
      if (!h || !h.antes) throw new Error('Não encontrei essa alteração para desfazer.');
      i = acharPorId(h.antes.id);
      if (i >= 0) d.prestadores[i] = h.antes; else d.prestadores.push(h.antes);
      registrar_(d, agora, 'restaurou', h.antes, null);
    } else {
      throw new Error('Ação desconhecida.');
    }
    d.atualizada = agora;
    gravar_(d);
  } finally {
    trava.releaseLock();
  }
  return listar();
}

// ---------- armazenamento ----------

function ler_() {
  var props = PropertiesService.getScriptProperties();
  var n = Number(props.getProperty('pedacos') || 0);
  if (!n) return { prestadores: DADOS_INICIAIS.slice(), historico: [], atualizada: '2026-10-14T21:30:00.000Z' };
  var texto = '';
  for (var i = 0; i < n; i++) texto += props.getProperty('p' + i) || '';
  return JSON.parse(texto);
}

function gravar_(d) {
  var props = PropertiesService.getScriptProperties();
  var texto = JSON.stringify(d);
  var novo = {}, n = 0;
  for (var i = 0; i < texto.length; i += TAMANHO_PEDACO) novo['p' + n++] = texto.slice(i, i + TAMANHO_PEDACO);
  var antigo = Number(props.getProperty('pedacos') || 0);
  novo.pedacos = String(n);
  props.setProperties(novo);
  for (var j = n; j < antigo; j++) props.deleteProperty('p' + j);
}

function registrar_(d, quando, acao, item, antes) {
  d.historico.unshift({
    hid: Utilities.getUuid().slice(0, 8),
    quando: quando,
    acao: acao,
    resumo: item.servico + ' – ' + item.nome,
    antes: acao === 'removeu' || acao === 'corrigiu' ? antes : null
  });
  d.historico = d.historico.slice(0, MAX_HISTORICO);
}

function validar_(dados) {
  dados = dados || {};
  var p = {};
  CAMPOS.forEach(function (c) {
    p[c] = String(dados[c] == null ? '' : dados[c]).replace(/\s+/g, ' ').trim().slice(0, 160);
  });
  p.insta = p.insta.replace(/^@/, '');
  var tel = p.tel.replace(/\D/g, '');
  if (tel.length > 11 && tel.indexOf('55') === 0) tel = tel.slice(2);
  if (tel.length === 8 || tel.length === 9) tel = '27' + tel; // sem DDD: assume 27
  p.tel = tel;
  if (!p.servico) throw new Error('Escreva o serviço, por exemplo Eletricista.');
  if (!p.nome) throw new Error('Escreva o nome da pessoa ou da empresa.');
  if (tel.length < 10 || tel.length > 11) throw new Error('Confira o telefone: use DDD e número, como 27 99999-9999.');
  if (CATEGORIAS.indexOf(p.cat) < 0) p.cat = 'Outros serviços';
  return p;
}

function normalizar_(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
}

// Lista do grupo do WhatsApp, usada só até a primeira alteração.
var DADOS_INICIAIS = [
  {"id": "lfxctnc", "cat": "Reparos e obras", "servico": "Marido de aluguel", "nome": "Edilson", "tel": "27992477907", "insta": "", "obs": "", "indicado": ""},
  {"id": "sbpcdp3", "cat": "Reparos e obras", "servico": "Marido de aluguel e eletricista", "nome": "Salomão", "tel": "27999135343", "insta": "", "obs": "", "indicado": ""},
  {"id": "eiw8uo9", "cat": "Reparos e obras", "servico": "Pedreiro", "nome": "Devalcy", "tel": "27999665049", "insta": "", "obs": "", "indicado": ""},
  {"id": "b4kfel3", "cat": "Reparos e obras", "servico": "Pedreiro", "nome": "Natalino", "tel": "27998054227", "insta": "", "obs": "", "indicado": ""},
  {"id": "guxntcc", "cat": "Reparos e obras", "servico": "Pedreiro", "nome": "Pablo", "tel": "27988864245", "insta": "", "obs": "", "indicado": ""},
  {"id": "hyplvqk", "cat": "Reparos e obras", "servico": "Eletricista", "nome": "Baiano", "tel": "27998493600", "insta": "", "obs": "", "indicado": ""},
  {"id": "2zius50", "cat": "Reparos e obras", "servico": "Eletricista", "nome": "Starley", "tel": "27996232605", "insta": "", "obs": "", "indicado": ""},
  {"id": "k9ep1fr", "cat": "Reparos e obras", "servico": "Engenheiro eletricista", "nome": "Roger", "tel": "27999896475", "insta": "", "obs": "", "indicado": ""},
  {"id": "by1u5lz", "cat": "Reparos e obras", "servico": "Pintor", "nome": "Bruno", "tel": "27999657313", "insta": "", "obs": "", "indicado": ""},
  {"id": "vuq48rx", "cat": "Reparos e obras", "servico": "Varal, rede e olho mágico", "nome": "Emerson", "tel": "27995787511", "insta": "", "obs": "", "indicado": ""},
  {"id": "czx93kn", "cat": "Reparos e obras", "servico": "Papel de parede", "nome": "Hugou", "tel": "27997906401", "insta": "", "obs": "", "indicado": ""},
  {"id": "yaqgec1", "cat": "Eletrodomésticos", "servico": "Conserto de geladeira", "nome": "Junior", "tel": "27997415439", "insta": "", "obs": "", "indicado": ""},
  {"id": "eio5cqt", "cat": "Eletrodomésticos", "servico": "Conserto de geladeira", "nome": "Edgar", "tel": "27998270313", "insta": "", "obs": "", "indicado": ""},
  {"id": "535kom5", "cat": "Eletrodomésticos", "servico": "Conserto de geladeira", "nome": "Paulo", "tel": "27999146416", "insta": "", "obs": "", "indicado": ""},
  {"id": "8fgiirv", "cat": "Eletrodomésticos", "servico": "Conserto de máquina de lavar", "nome": "Marcos", "tel": "27992918762", "insta": "", "obs": "", "indicado": ""},
  {"id": "japnu8y", "cat": "Eletrodomésticos", "servico": "Conserto de fogão", "nome": "Dênio", "tel": "27999574498", "insta": "", "obs": "", "indicado": ""},
  {"id": "swyb625", "cat": "Eletrodomésticos", "servico": "Conserto de ar-condicionado", "nome": "Rodrigo", "tel": "27998879427", "insta": "", "obs": "", "indicado": ""},
  {"id": "2oodwcc", "cat": "Eletrodomésticos", "servico": "Conserto de ar-condicionado", "nome": "Marcelo", "tel": "27999821700", "insta": "", "obs": "", "indicado": ""},
  {"id": "hfmbafd", "cat": "Casa e decoração", "servico": "Cortinas e persianas", "nome": "Volkers Cortinas", "tel": "27998167466", "insta": "", "obs": "", "indicado": ""},
  {"id": "na5wfjm", "cat": "Casa e decoração", "servico": "Loja de tintas", "nome": "Espaço das Tintas", "tel": "27998866243", "insta": "", "obs": "Contato: Rogério, Esmeralda 1001", "indicado": ""},
  {"id": "ne49qrd", "cat": "Casa e decoração", "servico": "Lavagem de sofá a seco", "nome": "Deu Service", "tel": "27995794538", "insta": "", "obs": "", "indicado": ""},
  {"id": "dmj3fa8", "cat": "Casa e decoração", "servico": "Gás do condomínio", "nome": "Geraldo", "tel": "27995047579", "insta": "", "obs": "", "indicado": ""},
  {"id": "tftat95", "cat": "Comida", "servico": "Restaurante marmitex", "nome": "JC Restaurante", "tel": "27996281561", "insta": "", "obs": "", "indicado": ""},
  {"id": "zjng1t2", "cat": "Comida", "servico": "Marmita fitness e salgados fitness", "nome": "Marilia", "tel": "27997839720", "insta": "", "obs": "", "indicado": ""},
  {"id": "li39433", "cat": "Comida", "servico": "Salgadinho de festa", "nome": "Elda", "tel": "27998374867", "insta": "", "obs": "", "indicado": ""},
  {"id": "0ismbbk", "cat": "Comida", "servico": "Salgadinho de festa", "nome": "Márcia", "tel": "27999767008", "insta": "", "obs": "", "indicado": ""},
  {"id": "jy8q798", "cat": "Comida", "servico": "Salgadinho de festa", "nome": "Gleydi", "tel": "27998247191", "insta": "", "obs": "", "indicado": ""},
  {"id": "nhihhw6", "cat": "Comida", "servico": "Feijão tropeiro, salpicão e torta salgada", "nome": "Amanda", "tel": "27997144152", "insta": "", "obs": "Por encomenda, para aniversários", "indicado": ""},
  {"id": "4rx2dx6", "cat": "Beleza e bem-estar", "servico": "Personal trainer", "nome": "Wagner Neres", "tel": "27996896093", "insta": "", "obs": "", "indicado": ""},
  {"id": "21rg2l2", "cat": "Beleza e bem-estar", "servico": "Personal trainer", "nome": "Lorena", "tel": "27988880735", "insta": "", "obs": "", "indicado": ""},
  {"id": "8oo80ge", "cat": "Beleza e bem-estar", "servico": "Personal trainer", "nome": "Júlia", "tel": "27995126230", "insta": "", "obs": "", "indicado": ""},
  {"id": "f63f39x", "cat": "Beleza e bem-estar", "servico": "Personal trainer", "nome": "Victor", "tel": "27999494948", "insta": "", "obs": "", "indicado": ""},
  {"id": "mtea8xs", "cat": "Beleza e bem-estar", "servico": "Cabeleireira domiciliar", "nome": "Roseane Zanque", "tel": "27988288229", "insta": "", "obs": "", "indicado": ""},
  {"id": "7p53hjk", "cat": "Beleza e bem-estar", "servico": "Maquiadora", "nome": "Jenifer", "tel": "27996324412", "insta": "", "obs": "", "indicado": ""},
  {"id": "ivjpe6m", "cat": "Beleza e bem-estar", "servico": "Estética e cosmetologia", "nome": "Elizângela Caldeira", "tel": "27999223494", "insta": "", "obs": "", "indicado": ""},
  {"id": "qv6p7st", "cat": "Carro e moto", "servico": "Baterias de carro e moto 24h", "nome": "Thiago", "tel": "27996060888", "insta": "", "obs": "", "indicado": ""},
  {"id": "sapga2g", "cat": "Carro e moto", "servico": "Borracheiro", "nome": "Betho", "tel": "27998792618", "insta": "", "obs": "", "indicado": ""},
  {"id": "r0ulst2", "cat": "Outros serviços", "servico": "Comunicação visual e gráfica rápida", "nome": "Wendênnis", "tel": "27999256616", "insta": "", "obs": "Adesivos, papel de parede, placas, lona e mais", "indicado": ""},
  {"id": "duij1su", "cat": "Outros serviços", "servico": "Planos de saúde, seguros, odontológicos e consórcios", "nome": "Ingrid Rossin", "tel": "27998098339", "insta": "rmscorretorasaude", "obs": "", "indicado": ""},
  {"id": "16pwssy", "cat": "Outros serviços", "servico": "Corretor(a) de imóveis", "nome": "Kelli Leal", "tel": "27999436125", "insta": "", "obs": "", "indicado": ""},
  {"id": "qtr7z57", "cat": "Outros serviços", "servico": "Corretor(a) de imóveis", "nome": "Andrea Anholete", "tel": "27997991412", "insta": "", "obs": "", "indicado": ""}
];
