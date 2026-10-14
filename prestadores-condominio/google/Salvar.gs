/**
 * Prestadores Villagio Campo Grande – salvar alterações feitas pelos vizinhos.
 */

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

// ===== FIM DO ARQUIVO Salvar.gs (se esta linha não aparecer, a cópia veio cortada) =====
