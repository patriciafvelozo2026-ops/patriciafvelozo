# FLOW Express – da pasta ao RH

Um **único arquivo HTML** (`dist/FLOW-Express.html`) que o comprador abre no Edge ou no Chrome.
Não instala nada, não tem servidor, não usa API e não acessa a internet. Todos os documentos
são lidos no próprio computador.

> Versão leve, sem TI, para entregar valor ainda em 2026. O FLOW completo (com IA, integrações e
> leitura de qualquer PDF livre) segue como plano estruturado para 2027 e reaproveita as mesmas
> regras de equalização e o mesmo padrão de RH.

## Como usar

1. Abra `dist/FLOW-Express.html` no Edge ou no Chrome. Ele também pode ficar numa pasta do SharePoint, de onde cada comprador baixa e abre.
2. **Novo RH**: arraste a pasta do processo, o `.zip` ou o `.7z`. Pasta grande? Suba em partes com **Adicionar mais arquivos**: tudo se soma no mesmo RH.
3. **Documentos**: o FLOW separa os documentos pela estrutura de pastas da Samarco (1 - Requisição de Compra … 8 - Contrato), lê e-mails (`.eml` e `.msg`) e seus anexos e ignora cópias repetidas e imagens de assinatura. **Prints, fotos e PDF escaneado** são lidos por reconhecimento de texto (OCR) no próprio navegador.
4. **Conferência**: tipo de processo (concorrência, fornecedor pretendido ou aditivo), cabeçalho do RH, vendor list, qualificações e propostas. Cada dado mostra o arquivo de onde veio.
5. **Equalização**: item a item e por rodada, com a ponderação técnica/comercial da aba "4 - TCO" da SMIN-IT-GSU-004.
6. **Negociação**: evolução das rodadas e custo evitado sobre a proposta inicial.
7. **RH pronto**:
   - **Relatório de Homologação (Word)** escrito direto no formulário Samarco (SMIN-FO-GSU-002/059) encontrado na pasta, ou no RH anterior, no caso de aditivo (SMIN-FO-GSU-004). O FLOW preenche o cabeçalho, as seções 1 a 6 e as tabelas. No aditivo, ele acrescenta a nova linha no "Resumo de evolução" e o bloco do novo aditivo.
   - **RH padrão FLOW (PDF)** baixado direto.
   - **Tabelas SMIN-IT-GSU-004 (Excel)**: Vendor List, Carta Convite-Qualificações, Quadro de Preço, TCO (com as fórmulas oficiais), Quadro Comparativo e Aditivo Contratual, mais o detalhe por item.
   - Lista do que ainda falta.

Para conhecer o fluxo sem arquivos reais, clique em **Ver demonstração** na tela inicial. É uma concorrência fictícia na estrutura de pastas da Samarco.

### Pastas grandes

Nada é enviado para servidor: o limite é a memória do computador. O FLOW só descompacta e lê o que entra no RH (Excel, Word, PDF, e-mails, prints). Vídeos e desenhos entram só na lista. Arquivos acima de 150 MB são listados sem leitura. Numa pasta real de 48 MB (.7z com .zip dentro e 20 imagens), a leitura levou cerca de 25 segundos, sendo 6 segundos sem as imagens.

### O que o FLOW lê

| Arquivo | Como |
|---|---|
| Excel (`.xlsx`, `.xls`, `.xlsm`, `.csv`) | Planilhas de preço, RC, SMIN-IT-GSU-004, evolução de aditivos |
| Word (`.docx`) | RH anterior, justificativa, ata, minuta, escopo |
| PDF com texto | Propostas, pedidos, pareceres |
| E-mail (`.eml`, `.msg`) e anexos | Corpo, data, anexos (inclusive `.zip` dentro do e-mail) |
| Print, foto e PDF escaneado (`.png`, `.jpg`, `.bmp`, `.tif`…) | OCR em português, feito no navegador: tela de RC do SAP (nº, valor, gestor, comprador, nota de cabeçalho do aditivo), cláusulas coladas no e-mail (objeto, data-base, reajuste). Até 30 imagens por envio; imagens menores que 20 KB (logos, assinaturas) são ignoradas |
| `.zip`, `.7z`, `.rar` | Abertos inclusive um dentro do outro |

Além dos campos em tabela, o FLOW procura no texto corrido: prazo de vigência do escopo ("será de 03 (três) meses"), data-base e reajuste da minuta, valor estimado da RC citado em e-mail, RFQ e gestor. Cada valor mostra de qual arquivo veio.

## Padrão de nomes (opcional)

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

## Formulário do RH (Word)

O FLOW usa o formulário oficial que estiver na pasta do processo (SMIN-FO-GSU-002, 059 ou 004) ou o RH anterior, no caso de aditivo, sem precisar de marcações. Também é possível carregar o formulário uma vez na etapa *RH pronto*, e ele fica salvo naquele navegador. Sem formulário, entra o **modelo provisório** (`modelos/`), com a mesma estrutura.

## Regras de equalização (resumo)

- Valores sempre pela **quantidade da RC** (preço unitário × qtd da RC).
- **Item não cotado**: equalizado pelo maior preço dos demais. É configurável: preço médio, ou só sinalizar.
- **Total que não bate** (qtd × preço ≠ total informado): usa o cálculo e sinaliza.
- **Unidade ou quantidade diferente da RC**: sinaliza para o comprador converter na Conferência.
- **Rodadas**: se o fornecedor não manda nova proposta, vale a anterior ("mantida").
- **Ponderação (SMIN-IT-GSU-004, aba 4 - TCO)**: nota comercial = (1 − (valor ÷ menor valor − 1)) × 100, e zero se o valor passar do dobro do menor. Final = peso técnico × nota técnica + peso comercial × nota comercial (padrão 30/70). Reprovado na qualificação não é classificado.
- **Custo evitado**: proposta inicial − proposta final do 1º colocado (em R$ e %).
- **Rodadas**: Proposta inicial (6.1 Inicial), 1ª rodada (6.2 Revisão 01), 2ª rodada …, Proposta final.

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
| `src/leitores.js` | Pasta, .zip, .7z/.rar, e-mails .eml/.msg (com anexos) e leitura de Excel, Word, PDF e imagens |
| `src/ocr.js` | OCR local (Tesseract em WebAssembly, dicionário de português embutido) |
| `src/rh-samarco.js` | Escreve o Relatório de Homologação no formulário Samarco (cabeçalho, seções, tabelas, aditivo) |
| `src/saidas.js` | RH padrão FLOW (PDF), Excel no formato SMIN-IT-GSU-004, gráfico |
| `src/planilha-padrao.js` | Planilha de preços padrão Samarco |
| `src/app.js`, `src/estilo.css` | Interface |
| `tools/` | Build, modelo de RH provisório e gerador do processo fictício |
| `exemplo/` | Processo fictício completo (pasta e .zip) |
| `docs/` | Guia de uso e nota para a Segurança da Informação |

## Demonstração ponta a ponta (Orbe)

`demo/FLOW_Demo_Ponta_a_Ponta_V21.html` é a demonstração navegável da RC ao contrato, alinhada ao
**Orbe · Visão 360 de Suprimentos**: as 15 etapas seguem a ordem do Orbe (Preparação, Mercado,
Decisão, Formalização) e a tela Início mostra o mapa do Orbe com o que o FLOW (Fase A) já faz.
