/**
 * Prestadores Villagio Campo Grande – avaliações dos vizinhos.
 *
 * Cada celular tem um código aleatório (guardado no próprio aparelho) e vale
 * um voto por prestador: 1 = recomendo, -1 = não recomendo, 0 = tirar o voto.
 * Comentários ficam no prestador (os 10 mais recentes).
 */

var MAX_COMENTARIOS = 10;

function avaliar(id, voto, aparelho, codigo) {
  return mexerNoPrestador_(id, codigo, function (p) {
    aparelho = validarAparelho_(aparelho);
    voto = Number(voto);
    p.votos = p.votos || {};
    if (voto === 1 || voto === -1) p.votos[aparelho] = voto; else delete p.votos[aparelho];
  });
}

function comentar(id, texto, apto, aparelho, codigo) {
  texto = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  apto = String(apto || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (texto.length < 3) throw new Error('Escreva o comentário (pelo menos 3 letras).');
  return mexerNoPrestador_(id, codigo, function (p) {
    aparelho = validarAparelho_(aparelho);
    p.coments = [{
      c: Utilities.getUuid().slice(0, 8), t: texto, a: apto,
      v: (p.votos && p.votos[aparelho]) || 0, q: new Date().toISOString()
    }].concat(p.coments || []).slice(0, MAX_COMENTARIOS);
  });
}

function apagarComentario(id, cid, codigo) {
  return mexerNoPrestador_(id, codigo, function (p, d) {
    var c = (p.coments || []).filter(function (x) { return x.c === cid; })[0];
    if (!c) return;
    p.coments = p.coments.filter(function (x) { return x.c !== cid; });
    d.historico.unshift({
      hid: Utilities.getUuid().slice(0, 8), quando: new Date().toISOString(),
      acao: 'apagou comentário de', resumo: p.servico + ' – ' + p.nome, pid: p.id, coment: c
    });
    d.historico = d.historico.slice(0, MAX_HISTORICO);
  });
}

function mexerNoPrestador_(id, codigo, mudar) {
  if (CODIGO_ACESSO && normalizar_(codigo) !== normalizar_(CODIGO_ACESSO)) {
    throw new Error('Palavra do condomínio incorreta. Confira no grupo.');
  }
  var trava = LockService.getScriptLock();
  trava.waitLock(20000);
  try {
    var d = ler_();
    var p = d.prestadores.filter(function (x) { return x.id === String(id); })[0];
    if (!p) throw new Error('Esse contato foi removido por outra pessoa. A lista foi atualizada.');
    mudar(p, d);
    caber_(d);
    gravar_(d);
  } finally {
    trava.releaseLock();
  }
  return listar();
}

function validarAparelho_(a) {
  a = String(a || '');
  if (!/^[a-z0-9]{6,20}$/.test(a)) throw new Error('Não consegui identificar este celular. Atualize a página.');
  return a;
}

/** Garante que tudo cabe no espaço do script, tirando as alterações mais antigas do histórico. */
function caber_(d) {
  while (JSON.stringify(d).length > 350000 && d.historico.length > 10) d.historico.pop();
}

// ===== FIM DO ARQUIVO Avaliar.gs (se esta linha não aparecer, a cópia veio cortada) =====
