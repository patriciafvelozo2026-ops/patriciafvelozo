/**
 * Prestadores Villagio Campo Grande – funções de apoio (guardar dados, validar, histórico).
 */

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

// ===== FIM DO ARQUIVO Apoio.gs (se esta linha não aparecer, a cópia veio cortada) =====
