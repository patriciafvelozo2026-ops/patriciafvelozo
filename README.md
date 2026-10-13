# FLOW Express – da pasta ao RH

Um **único arquivo HTML** (`dist/FLOW-Express.html`) que o comprador abre no Edge ou no Chrome.
Não instala nada, não tem servidor, não usa API e não acessa a internet. Todos os documentos
são lidos no próprio computador.

> Versão leve, sem TI, para entregar valor ainda em 2026. O FLOW completo (com IA, integrações e
> leitura de qualquer PDF livre) segue como plano estruturado para 2027 e reaproveita as mesmas
> regras de equalização e o mesmo padrão de RH.

## Como usar

1. Abra `dist/FLOW-Express.html` (duplo clique). Ele também pode ficar numa pasta do SharePoint, de onde cada comprador baixa e abre.
2. **Novo RH**: arraste a pasta do processo ou o `.zip`. Também dá para escolher a pasta direto, sem zipar.
3. **Documentos**: o FLOW separa a RC, as propostas técnicas, as propostas comerciais (por fornecedor e por rodada), o parecer técnico, as atas e as homologações. O que ele não reconhecer aparece em destaque para você indicar o que é.
4. **Conferência**: cada dado mostra o arquivo (e a célula/linha) de onde veio. Confira e corrija. Propostas fora do padrão podem ser digitadas ou coladas do Excel/PDF.
5. **Equalização**: feita item a item e por rodada. O FLOW aponta item não cotado, unidade e quantidade diferentes e total que não bate. Também calcula as notas técnica e comercial com os pesos definidos.
6. **Negociação**: evolução das rodadas até o BAFO e saving sobre a proposta inicial e sobre o estimado da RC.
7. **RH pronto**: Word no modelo atual, PDF no padrão FLOW, planilha de equalização em Excel e a lista do que ainda falta anexar.

Para conhecer o fluxo sem arquivos reais, clique em **Ver demonstração** na tela inicial. É um processo fictício com 3 fornecedores e 3 rodadas.

## O que ele lê, e com que segurança

| Formato | Leitura |
|---|---|
| Excel (`.xlsx`, `.xls`, `.csv`), especialmente a **planilha de preços padrão Samarco** | Total confiança |
| Word (`.docx`): texto e tabelas | Total confiança |
| PDF com texto | Razoável: os itens são lidos e marcados "para conferir" |
| PDF escaneado / proposta "no formato do fornecedor" sem padrão | Não lê sozinho: o comprador digita ou cola na Conferência |

**Recomendação:** mande a planilha de preços padrão junto com a carta-convite. Ela é gerada pelo próprio FLOW, no botão *Gerar planilha padrão Samarco*. Com a planilha preenchida pelo fornecedor, a equalização fica automática.

## Padrão de nomes na pasta

| Documento | Nome do arquivo |
|---|---|
| Requisição de compra | `RC_4500012345.xlsx` |
| Carta-convite | `CC_4500012345.pdf` |
| Proposta técnica | `PT_FORNECEDOR.pdf` |
| Proposta comercial | `PC_FORNECEDOR_R1.xlsx`, `PC_FORNECEDOR_R2.xlsx`, `PC_FORNECEDOR_BAFO.xlsx` |
| Parecer / avaliação técnica | `AT_PARECER_TECNICO.xlsx` |
| Ata de negociação | `ATA_NEGOCIACAO_R2.docx`, `ATA_NEGOCIACAO_BAFO.docx` |
| Homologação | `HOM_FORNECEDOR.pdf` |

`FORNECEDOR` é um nome curto, sem espaços (ex.: `ALFA`). As subpastas são livres. Fora do padrão, o FLOW
tenta reconhecer pelo conteúdo e pela pasta, e o que sobrar ele pergunta.

## Modelo atual do RH (Word)

Enquanto o modelo atual da Samarco não chega, o FLOW usa um **modelo provisório** (`modelos/Modelo_RH_provisorio.docx`).
Para usar o modelo real, basta escrever as marcações (`{rc}`, `{objeto}`, `{vencedor}`, `{#fornecedores}…{/fornecedores}` etc.)
no próprio Word e carregá-lo na etapa *RH pronto*. A lista completa fica em *Como marcar o modelo*. O modelo
carregado fica salvo naquele navegador.

## Regras de equalização (resumo)

- Valores sempre pela **quantidade da RC** (preço unitário × qtd da RC).
- **Item não cotado**: equalizado pelo maior preço dos demais. É configurável: preço médio, ou só sinalizar.
- **Total que não bate** (qtd × preço ≠ total informado): usa o cálculo e sinaliza.
- **Unidade ou quantidade diferente da RC**: sinaliza para o comprador converter na Conferência.
- **Rodadas**: se o fornecedor não manda nova proposta, vale a anterior ("mantida").
- **Notas**: comercial = 100 × menor valor equalizado ÷ valor do fornecedor. Final = peso técnico × nota técnica + peso comercial × nota comercial (padrão 30/70). Reprovado tecnicamente não é classificado.
- **Saving**: proposta inicial − valor final do recomendado, e estimado da RC − valor final.

## Para desenvolvedores

```bash
npm install
npm run build       # gera dist/FLOW-Express.html (+ modelo provisório e exemplo)
npm test            # motor de regras + saídas Word/Excel/HTML, com o processo de exemplo
npm run test:e2e    # navegador (Chromium) sem rede, do upload ao RH
```

| Pasta | Conteúdo |
|---|---|
| `src/engine.js` | Classificação, extração, equalização, notas, saving e pendências (sem interface; testável no Node) |
| `src/leitores.js` | Abertura de .zip/pasta e leitura de Excel, Word e PDF |
| `src/saidas.js` | RH em Word (marcações), RH padrão FLOW (HTML → PDF), Excel de equalização, gráfico |
| `src/planilha-padrao.js` | Planilha de preços padrão Samarco |
| `src/app.js`, `src/estilo.css` | Interface |
| `tools/` | Build, modelo de RH provisório e gerador do processo fictício |
| `exemplo/` | Processo fictício completo (pasta e .zip) |
| `docs/` | Guia de uso e nota para a Segurança da Informação |
