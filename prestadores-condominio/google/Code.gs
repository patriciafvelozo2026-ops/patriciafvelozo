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

// ===== FIM DO ARQUIVO Código.gs (se esta linha não aparecer, a cópia veio cortada) =====
