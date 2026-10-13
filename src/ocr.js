/*
 * FLOW Express — leitura de imagens (prints, fotos e PDF escaneado) por OCR,
 * 100% local: o Tesseract, o núcleo WebAssembly e o dicionário de português
 * vêm embutidos no próprio HTML. Nada é baixado nem enviado.
 */
(function (root) {
  'use strict';
  let workerP = null;
  const blobUrl = (texto) => URL.createObjectURL(new Blob([texto], { type: 'text/javascript' }));

  function disponivel() {
    return typeof root.Tesseract !== 'undefined' && !!document.getElementById('ocr-core') && !!root.FLOW_OCR_POR_B64;
  }

  /** Cria (uma vez) o leitor. O dicionário é entregue ao worker sem rede: o pedido dele é atendido aqui. */
  function obterWorker() {
    if (!workerP) {
      workerP = (async () => {
        const fonteWorker = document.getElementById('ocr-worker').textContent;
        const fonteCore = document.getElementById('ocr-core').textContent;
        const prefixo = 'self.__FLOW_POR=' + JSON.stringify(root.FLOW_OCR_POR_B64) + ';(function(){var f=self.fetch;self.fetch=function(u){' +
          'if(String(u).indexOf("por.traineddata")>=0){var s=atob(self.__FLOW_POR),b=new Uint8Array(s.length);for(var i=0;i<s.length;i++)b[i]=s.charCodeAt(i);' +
          'return Promise.resolve(new Response(b));}return Promise.reject(new Error("FLOW: acesso à rede bloqueado"))};})();\n';
        // o núcleo vai dentro do próprio worker (TesseractCore já definido: nada é importado de fora)
        return root.Tesseract.createWorker('por', 1, {
          workerPath: blobUrl(prefixo + fonteCore + '\n;self.TesseractCore=self.TesseractCore||TesseractCore;\n' + fonteWorker),
          corePath: 'embutido/tesseract-core-simd-lstm.wasm.js',
          langPath: 'https://flow.local/ocr',
          cacheMethod: 'none',
          workerBlobURL: false,
          gzip: true,
        });
      })();
      workerP.catch(() => { workerP = null; });
    }
    return workerP;
  }

  /** Reconhece uma imagem (Blob, canvas ou Uint8Array) e devolve o texto. */
  async function reconhecer(imagem) {
    const w = await obterWorker();
    const entrada = imagem instanceof Uint8Array ? new Blob([imagem]) : imagem;
    const { data } = await w.recognize(entrada);
    return data.text || '';
  }

  /** Desenha uma página de PDF (pdf.js) em canvas para o OCR. */
  async function paginaParaCanvas(pagina, escala = 2) {
    const vp = pagina.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pagina.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  }

  async function encerrar() {
    if (!workerP) return;
    try { (await workerP).terminate(); } catch (e) { /* ok */ }
    workerP = null;
  }

  root.FlowOCR = { disponivel, reconhecer, paginaParaCanvas, encerrar };
})(typeof self !== 'undefined' ? self : this);
