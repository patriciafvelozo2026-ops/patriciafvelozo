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

// ===== FIM DO ARQUIVO Código.gs (se esta linha não aparecer, a cópia veio cortada) =====
