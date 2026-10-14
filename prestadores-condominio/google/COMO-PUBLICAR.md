# Como publicar a lista de prestadores (Google Apps Script)

Faça uma vez só, de preferência no computador, logada na sua conta Google.

1. Entre em https://script.google.com e clique em **Novo projeto**.
2. Dê o nome **Prestadores Villagio** (clique em "Projeto sem título", no alto).
3. No arquivo **Código.gs** que já aparece, apague tudo e cole o conteúdo de `Code.gs`.
4. Clique no **+** ao lado de "Arquivos", escolha **HTML** e dê o nome **Index** (sem ".html").
   Apague o que vier e cole o conteúdo de `Index.html`.
5. Repita o passo 4 criando um arquivo HTML chamado **Logo** com o conteúdo de `Logo.html`.
   Salve (ícone de disquete ou Ctrl+S). Confira o fim de cada arquivo: `Code.gs` termina com `];`,
   `Index.html` com `</html>` e `Logo.html` com `</div>`.
6. Clique em **Implantar** → **Nova implantação** → engrenagem → **App da Web**.
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
7. Clique em **Implantar** e depois em **Autorizar acesso**. Escolha sua conta.
   Se aparecer "O Google não verificou este app", clique em **Avançado** → **Acessar Prestadores Villagio** → **Permitir**.
   (O app é seu; o aviso aparece para todo script pessoal.)
8. Copie o **URL do app da Web** (termina em `/exec`). Esse é o link para o grupo.

## Para mudar algo depois

Edite o arquivo e vá em **Implantar** → **Gerenciar implantações** → lápis → Versão: **Nova versão** → **Implantar**.
O link continua o mesmo, e os contatos salvos não se perdem.

## Se alguém de fora começar a bagunçar

No `Code.gs`, troque `var CODIGO_ACESSO = '';` por uma palavra, por exemplo `var CODIGO_ACESSO = 'villagio';`,
publique uma nova versão e avise a palavra no grupo. A página pede essa palavra uma vez antes de salvar.
Qualquer remoção pode ser desfeita em **Últimas alterações** → **Restaurar**.
