# FLOW Express: nota para "de acordo" da Segurança da Informação

**O que é:** um arquivo HTML estático (`FLOW-Express.html`, ~13 MB) usado pelos compradores de Suprimentos
para montar o RH a partir da pasta de um processo de compra.

## Como funciona, do ponto de vista de segurança

| Ponto | Situação |
|---|---|
| Instalação | Nenhuma. O arquivo é aberto no Edge ou no Chrome. |
| Servidor / API / nuvem | Nenhum. Não há backend nem chamadas a APIs. |
| Acesso à internet | Nenhum. Todas as bibliotecas estão **embutidas** no arquivo, e não há chamadas de rede (verificado em teste automatizado com a rede bloqueada). |
| Onde os documentos são lidos | Na memória do navegador, no computador do comprador. |
| O que fica gravado | Os dados extraídos do processo atual (texto e valores, não os arquivos originais) e o modelo de RH carregado ficam no armazenamento local do navegador (`localStorage`) daquele usuário, para retomar o trabalho. O botão *Novo RH* apaga o processo atual. |
| Saídas | Arquivos baixados pelo próprio usuário: Relatório de Homologação (.docx), RH padrão FLOW (.pdf), tabelas SMIN-IT-GSU-004 (.xlsx) e dados do processo (.json). |
| Distribuição | Uma cópia do arquivo numa pasta do SharePoint com acesso restrito a Suprimentos. |
| Atualização | Uma nova versão do arquivo substitui a anterior no SharePoint. O número da versão aparece na descrição do arquivo. |

## Bibliotecas embutidas (código aberto, versões fixas)

| Biblioteca | Versão | Licença | Uso |
|---|---|---|---|
| SheetJS (xlsx) | 0.18.5 | Apache-2.0 | Ler planilhas |
| ExcelJS | 4.4.0 | MIT | Gerar a planilha de equalização |
| JSZip | 3.10.2 | MIT | Abrir .zip e .docx |
| PDF.js (pdfjs-dist) | 3.11.174 | Apache-2.0 | Ler PDF com texto |
| PizZip | 3.3.0 | MIT | Abrir e salvar o formulário de RH em Word |
| 7-Zip (7z-wasm) | 1.2.0 | LGPL / unRAR | Abrir .7z e .rar |
| msgreader | 1.28.0 | Apache-2.0 | Ler e-mails do Outlook (.msg) |
| html2canvas + jsPDF | 1.4.1 / 2.5.1 | MIT | Gerar o PDF do RH padrão FLOW |
| Preact + htm | 3.1.1 | MIT / Apache-2.0 | Interface |
| Tesseract.js + tesseract.js-core | 7.0.0 / 6.1.2 | Apache-2.0 | Ler texto de prints, fotos e PDF escaneado (OCR) |
| Dicionário de português (tessdata `por`, best_int) | 4.0.0 | Apache-2.0 | Idioma do OCR |

## Pontos para avaliação

- Os documentos tratados são internos (propostas, RC, atas). Eles não saem da máquina, mas o `localStorage` guarda os dados extraídos do processo aberto até o usuário clicar em *Novo RH*. Em computador compartilhado, recomenda-se usar *Novo RH* ao terminar.
- O OCR roda num *web worker* do próprio navegador. O dicionário de português está embutido no arquivo e o pedido de download que o Tesseract faria é atendido localmente; qualquer outro acesso à rede é recusado dentro do worker.
- O código-fonte é legível e fica no repositório do projeto (`src/`). O arquivo final é gerado por `npm run build`.
