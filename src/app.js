/* FLOW Express — interface (Preact + htm, sem servidor). */
(function () {
  'use strict';
  const { html, render, useState, useEffect, useMemo, useRef } = htmPreact;
  const E = FlowEngine, S = Saidas, L = Leitores;
  let wasm7z = null;
  const libs = {
    XLSX, JSZip, pdfjsLib, ExcelJS, PizZip, html2canvas: window.html2canvas, jsPDF: window.jspdf && window.jspdf.jsPDF,
    SevenZip: window.SevenZip, MsgReader: window.MsgReader, DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, RHSamarco: window.RHSamarco,
    wasm7z: () => (wasm7z = wasm7z || (window.FLOW_7Z_WASM_B64 ? b64bytes(window.FLOW_7Z_WASM_B64) : undefined)),
    ocr: window.FlowOCR && window.FlowOCR.disponivel() ? window.FlowOCR : null,
  };
  const val = E.val;

  // pdf.js com worker embutido (nada é baixado da internet)
  try {
    const w = document.getElementById('pdf-worker');
    if (w) pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w.textContent], { type: 'text/javascript' }));
  } catch (e) { console.warn(e); }

  const CHAVE = 'flowexpress.processo.v1';
  const CHAVE_MODELO = 'flowexpress.modeloRH.v2';
  const CHAVE_PADRAO = 'flowexpress.cabPadrao.v1';
  const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const gravar = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch { return false; } };

  const b64bytes = (b64) => { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
  const bytesB64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  // Na página do claude.ai, downloads passam pela confirmação do visualizador;
  // no arquivo local, um link de download comum.
  async function baixar(dados, nome, tipo) {
    const blob = dados instanceof Blob ? dados : new Blob([dados], { type: tipo || 'application/octet-stream' });
    const dl = window.claude && window.claude.use ? await window.claude.use('downloads').catch(() => null) : null;
    if (dl) {
      try { await dl.save({ filename: nome, data: blob }); }
      catch (e) { if (e && e.code !== 'declined') informar('Não foi possível baixar o arquivo (' + ((e && e.message) || e) + ').'); }
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nome;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  const nomeArq = (s) => String(s || 'processo').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80);

  // ------------------------------------------------------------ ícones
  const I = {
    pasta: 'M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    arquivo: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
    ok: 'M5 12.5l4.5 4.5L19 7.5',
    x: 'M6 6l12 12M18 6L6 18',
    alerta: 'M12 4l9 16H3zM12 10v4M12 17.5v.5',
    lapis: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
    baixar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
    subir: 'M12 20V9M7 14l5-5 5 5M5 4h14',
    cadeado: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v9H5z',
    mais: 'M12 5v14M5 12h14',
    lixo: 'M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13',
    seta: 'M5 12h14M13 6l6 6-6 6',
    voltar: 'M19 12H5M11 6l-6 6 6 6',
    olho: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    planilha: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16',
    impressora: 'M7 9V4h10v5M7 17H5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2M7 14h10v6H7z',
    salvar: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 14h8v6H8z',
    raio: 'M13 3L5 13h6l-1 8 8-10h-6z',
  };
  const Icone = ({ n, t = 16 }) => html`<svg class="ic" width=${t} height=${t} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${I[n]} /></svg>`;

  // ------------------------------------------------------------ campos
  function Fonte({ f, vazioTxt = 'não encontrado nos documentos — preencha' }) {
    if (!f || f.v == null || f.v === '') return html`<span class="fonte falta"><${Icone} n="alerta" t=${12} /> ${vazioTxt}</span>`;
    if (f.fonte === 'editado') return html`<span class="fonte edit"><${Icone} n="lapis" t=${12} /> editado por você</span>`;
    return html`<span class="fonte" title=${f.fonte || ''}><${Icone} n="arquivo" t=${12} /> ${f.fonte || 'origem não registrada'}</span>`;
  }

  const paraTexto = (v) => (v == null ? '' : v instanceof Date ? E.fmtData(v) : String(v));
  function CampoTexto({ rotulo, f, onFim, area, larg, num }) {
    const [txt, setTxt] = useState(num ? fmtEdit(val(f)) : paraTexto(val(f)));
    useEffect(() => setTxt(num ? fmtEdit(val(f)) : paraTexto(val(f))), [val(f)]);
    const fim = () => {
      const novo = num ? E.parseNum(txt) : txt.trim() || null;
      if (novo !== val(f) && !(novo == null && val(f) == null)) onFim(novo);
    };
    const props = { value: txt, onInput: (e) => setTxt(e.target.value), onBlur: fim, class: 'inp' + (num ? ' num' : '') };
    return html`<label class=${'campo' + (val(f) == null ? ' vazio' : '') + (larg ? ' larg' : '')}>
      <span class="rot">${rotulo}</span>
      ${area ? html`<textarea rows="2" ...${props} />` : html`<input type="text" inputmode=${num ? 'decimal' : 'text'} ...${props} />`}
      <${Fonte} f=${f} />
    </label>`;
  }
  function fmtEdit(v) {
    if (v == null || v === '') return '';
    if (typeof v !== 'number') return String(v);
    return v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });
  }
  function Num({ v, onFim, cls = '', ph = '' }) {
    const [t, setT] = useState(fmtEdit(v));
    useEffect(() => setT(fmtEdit(v)), [v]);
    return html`<input class=${'inp num ' + cls} inputmode="decimal" value=${t} placeholder=${ph}
      onInput=${(e) => setT(e.target.value)} onBlur=${() => { const n = E.parseNum(t); setT(fmtEdit(n)); if (n !== v) onFim(n); }} />`;
  }
  function Txt({ v, onFim, cls = '', ph = '' }) {
    const [t, setT] = useState(v ?? '');
    useEffect(() => setT(v ?? ''), [v]);
    return html`<input class=${'inp ' + cls} value=${t} placeholder=${ph} onInput=${(e) => setT(e.target.value)} onBlur=${() => t !== (v ?? '') && onFim(t)} />`;
  }

  // ------------------------------------------------------------ diálogos
  let abrirDialogo = () => {};
  const confirmar = (msg, sim = 'Continuar') => new Promise((res) => abrirDialogo({ tipo: 'confirmar', msg, sim, res }));
  const pedirTexto = (msg) => new Promise((res) => abrirDialogo({ tipo: 'texto', msg, res }));
  const informar = (msg) => new Promise((res) => abrirDialogo({ tipo: 'info', msg, res }));
  function Dialogo() {
    const [d, setD] = useState(null);
    const [txt, setTxt] = useState('');
    abrirDialogo = (x) => { setTxt(''); setD(x); };
    if (!d) return null;
    const fim = (v) => { setD(null); d.res(v); };
    return html`<div class="veu" onClick=${(e) => e.target === e.currentTarget && fim(d.tipo === 'confirmar' ? false : null)}>
      <form class="modal dialogo" onSubmit=${(e) => { e.preventDefault(); fim(d.tipo === 'texto' ? txt.trim() || null : true); }}>
        <p>${d.msg}</p>
        ${d.tipo === 'texto' && html`<input id="dialogo-texto" class="inp" value=${txt} onInput=${(e) => setTxt(e.target.value)} ref=${(el) => el && setTimeout(() => el.focus(), 0)} />`}
        <div class="modal-acoes">
          ${d.tipo !== 'info' && html`<button type="button" class="btn sec" onClick=${() => fim(d.tipo === 'confirmar' ? false : null)}>Cancelar</button>`}
          <button type="submit" class="btn pri">${d.tipo === 'info' ? 'Entendi' : d.tipo === 'texto' ? 'OK' : d.sim}</button>
        </div>
      </form></div>`;
  }

  const ETAPAS = [
    ['inicio', 'Início'], ['documentos', 'Documentos'], ['conferencia', 'Conferência'],
    ['equalizacao', 'Equalização'], ['negociacao', 'Negociação'], ['rh', 'RH pronto'],
  ];
  const RODADAS_OPC = ['R1', 'R2', 'R3', 'R4', 'R5', 'BAFO'];

  // ================================================================== App
  function App() {
    const [st, setSt] = useState(null);
    const [ver, setVer] = useState(0);
    const [etapa, setEtapa] = useState('inicio');
    const [carregando, setCarregando] = useState(null);
    const [toast, setToast] = useState(null);
    const [modal, setModal] = useState(null);
    const entradas = useRef([]);
    const salvo = useMemo(() => { const s = ler(CHAVE); try { return s ? JSON.parse(s) : null; } catch { return null; } }, []);

    const avisar = (msg, tipo = 'ok') => { setToast({ msg, tipo }); setTimeout(() => setToast(null), 4200); };
    const mudar = (fn, conf = true) => { fn(st); if (conf) st.editadoConf = true; setVer((v) => v + 1); };
    const eq = useMemo(() => (st && (st.propostas.length || (st.quadroPrecos || []).length) ? E.equalizar(st) : null), [st, ver]);
    useEffect(() => { if (st) gravar(CHAVE, JSON.stringify(st)); }, [st, ver]);
    useEffect(() => { window.scrollTo(0, 0); }, [etapa]);

    function anexarTextos(novo) {
      for (const d of novo.documentos) {
        const e = entradas.current.find((x) => x.id === d.id);
        if (e && e.conteudo && (d.status !== 'ok' || d.tipo === 'PC' || d.tipo === 'ATA')) d.texto = L.textoPlano(e.conteudo, 15000);
      }
      return novo;
    }

    /** Lê arquivos; com `adicionar`, soma ao processo aberto (para pastas grandes enviadas em partes). */
    async function processar(arquivos, nomeOrigem, adicionar) {
      try {
        const totalMB = arquivos.reduce((t, f) => t + (f.size || 0), 0);
        setCarregando({ msg: `Abrindo ${arquivos.length} arquivo(s) · ${L.MB(totalMB)}…` });
        await tick();
        const { entradas: ents } = await L.lerTudo(libs, arquivos, (p) => setCarregando({ msg: p.msg, sub: `${p.lidos} arquivo(s) · ${L.MB(p.bytes)}` }));
        if (!ents.length) { setCarregando(null); avisar('Não encontrei arquivos nessa pasta/zip.', 'erro'); return; }
        setCarregando({ msg: 'Separando os documentos…' });
        await tick();
        const padrao = (() => { try { return JSON.parse(ler(CHAVE_PADRAO) || 'null'); } catch { return null; } })();
        if (adicionar && st) {
          const antigos = entradas.current;
          E.adicionarDocumentos(st, ents, antigos);
          entradas.current = antigos.concat(ents);
          anexarTextos(st);
          setVer((v) => v + 1);
          avisar(`${ents.length} arquivo(s) somados ao processo.`);
        } else {
          entradas.current = ents;
          const novo = anexarTextos(E.montarEstado(ents, padrao ? { cabPadrao: padrao } : null));
          if (!novo.nomeProcesso) novo.nomeProcesso = String(nomeOrigem || '').replace(/\.(zip|7z|rar)$/i, '') || 'Processo';
          setSt(novo); setVer(0); setEtapa('documentos');
        }
        setCarregando(null);
      } catch (err) {
        console.error(err);
        setCarregando(null);
        avisar('Não consegui abrir: ' + (err.message || err), 'erro');
      }
    }

    async function reclassificar(docId, mud) {
      const ent = entradas.current.find((e) => e.id === docId);
      if (!ent) { avisar('Para reclassificar, abra a pasta do processo novamente (os arquivos não ficam salvos no navegador).', 'erro'); return; }
      if (st.editadoConf && !(await confirmar('Reclassificar relê todos os documentos e desfaz as correções feitas na Conferência. Continuar?', 'Reclassificar'))) return;
      Object.assign(ent, mud, { manual: true });
      if (mud.tipo && !E.TIPO_COM_FORNECEDOR[mud.tipo]) ent.fornecedorManual = null;
      const novo = anexarTextos(E.montarEstado(entradas.current, st));
      novo.nomeProcesso = st.nomeProcesso;
      if (st.tipoProcesso && st.tipoProcesso.fonte === 'editado') novo.tipoProcesso = st.tipoProcesso;
      setSt(novo); setVer((v) => v + 1);
    }

    async function novoRH() {
      if (st && !(await confirmar('Começar um novo RH? O processo atual só fica guardado se você clicar antes em Salvar (.json).', 'Começar novo RH'))) return;
      setSt(null); entradas.current = []; gravar(CHAVE, null); setEtapa('inicio');
    }

    function exportarJSON() {
      baixar(JSON.stringify(st, null, 1), `FLOW_${nomeArq(val(st.processo.rc) || st.nomeProcesso)}.json`, 'application/json');
    }
    async function abrirJSON(file) {
      try {
        const obj = JSON.parse(await file.text());
        if (!obj || !obj.processo || !obj.propostas) throw new Error('arquivo não é um processo do FLOW Express');
        entradas.current = [];
        setSt(obj); setVer(0); setEtapa('conferencia');
      } catch (e) { avisar('Não consegui abrir: ' + e.message, 'erro'); }
    }

    const podeIr = (k) => k === 'inicio' || (!!st && (k === 'documentos' || k === 'conferencia' || k === 'rh' || !!eq));
    const props = { st, eq, mudar, setEtapa, avisar, reclassificar, setModal, entradas, setSt, setVer, processar };

    return html`
      <header class="topo">
        <div class="marca" onClick=${() => setEtapa('inicio')}><span class="logo">FLOW</span><span class="exp">Express</span><span class="sub">da pasta ao RH</span></div>
        <nav class="passos" aria-label="Etapas">
          ${ETAPAS.map(([k, rot], i) => html`<button class=${'passo' + (etapa === k ? ' atual' : '')} disabled=${!podeIr(k)} onClick=${() => setEtapa(k)}>
            <span class="num">${i + 1}</span><span class="txt">${rot}</span></button>`)}
        </nav>
        <div class="acoes-topo">
          ${st && html`<button class="btn sec peq" onClick=${exportarJSON} title="Salvar os dados do processo em um arquivo .json"><${Icone} n="salvar" /> Salvar</button>`}
          ${st && html`<button class="btn sec peq" onClick=${novoRH}><${Icone} n="mais" /> Novo RH</button>`}
          <span class="selo" title="Os documentos são lidos neste computador. Nenhum dado é enviado para a internet."><${Icone} n="cadeado" t=${14} /> 100% local</span>
        </div>
      </header>
      <main class="conteudo">
        ${st && etapa !== 'inicio' && html`<div class="processo-tit">
          <span class="rc">${val(st.tipoProcesso) === 'aditivo' ? `Contrato ${val(st.cab.contrato) || '—'}` : `RC ${val(st.cab.numeroRC) || val(st.processo.rc) || '—'}`}</span>
          <span class="chip">${E.TIPOS_PROCESSO[val(st.tipoProcesso)] || 'Processo'}</span>
          <span class="obj">${val(st.processo.objeto) || st.nomeProcesso || ''}</span></div>`}
        ${etapa === 'inicio' && html`<${Inicio} processar=${processar} salvo=${salvo} abrirJSON=${abrirJSON} st=${st} setEtapa=${setEtapa}
            continuar=${() => { setSt(salvo); setEtapa('conferencia'); }} setModal=${setModal} />`}
        ${etapa === 'documentos' && st && html`<${Documentos} ...${props} />`}
        ${etapa === 'conferencia' && st && html`<${Conferencia} ...${props} />`}
        ${etapa === 'equalizacao' && eq && html`<${Equalizacao} ...${props} />`}
        ${etapa === 'negociacao' && eq && html`<${Negociacao} ...${props} />`}
        ${etapa === 'rh' && st && html`<${RH} ...${props} />`}
      </main>
      ${carregando && html`<div class="veu"><div class="carregando"><div class="giro"></div><b>${carregando.msg}</b>${carregando.sub && html`<span class="mut">${carregando.sub}</span>`}
        ${carregando.total && html`<div class="barra"><i style=${{ width: (100 * carregando.atual) / carregando.total + '%' }} /></div><span>${carregando.atual} de ${carregando.total}</span>`}</div></div>`}
      ${toast && html`<div class=${'toast ' + toast.tipo} role="status">${toast.msg}</div>`}
      <${Dialogo} />
      ${modal && html`<div class="veu" onClick=${(e) => e.target === e.currentTarget && setModal(null)}><div class="modal">${modal}</div></div>`}
    `;
  }

  // ================================================================== 1. Início
  function Inicio({ processar, salvo, abrirJSON, st, setEtapa, continuar, setModal }) {
    const [sobre, setSobre] = useState(false);
    const refPasta = useRef(), refZip = useRef(), refJson = useRef();
    useEffect(() => { if (refPasta.current) { refPasta.current.setAttribute('webkitdirectory', ''); refPasta.current.setAttribute('directory', ''); } }, []);
    const soltar = async (e) => {
      e.preventDefault(); setSobre(false);
      const arqs = await L.lerArrasto(e.dataTransfer);
      processar(arqs, arqs[0] && arqs[0].name);
    };
    const demo = () => processar([new File([b64bytes(window.FLOW_EXEMPLO_B64)], window.FLOW_EXEMPLO_NOME || 'exemplo.zip')], window.FLOW_EXEMPLO_NOME);
    return html`
      <section class="hero">
        <div>
          <h1>Da pasta do processo ao RH pronto.</h1>
          <p class="lead">Arraste a pasta do processo (ou o .zip / .7z). O FLOW Express lê RC, vendor list, qualificações, propostas, e-mails e o RH anterior, equaliza por rodada e monta o Relatório de Homologação no formulário da Samarco, mais o PDF FLOW e as tabelas SMIN-IT-GSU-004.</p>
        </div>
      </section>
      <div class=${'drop' + (sobre ? ' sobre' : '')} onDragOver=${(e) => { e.preventDefault(); setSobre(true); }} onDragLeave=${() => setSobre(false)} onDrop=${soltar}>
        <div class="drop-ic"><${Icone} n="pasta" t=${40} /></div>
        <div class="drop-tit">Novo RH: arraste aqui a pasta do processo, o .zip ou o .7z</div>
        <div class="drop-acoes">
          <button class="btn pri" onClick=${() => refPasta.current.click()}><${Icone} n="pasta" /> Escolher pasta</button>
          <button class="btn sec" onClick=${() => refZip.current.click()}><${Icone} n="subir" /> Escolher arquivos (.zip, .7z…)</button>
        </div>
        <input ref=${refPasta} type="file" multiple hidden onChange=${(e) => e.target.files.length && processar([...e.target.files])} />
        <input ref=${refZip} type="file" multiple hidden onChange=${(e) => e.target.files.length && processar([...e.target.files], e.target.files[0].name)} />
        <p class="drop-nota"><${Icone} n="cadeado" t=${13} /> Os arquivos são lidos aqui, neste computador. Nada é instalado e nenhum dado sai da máquina.</p>
        <p class="drop-nota">Pasta grande? Suba em partes: depois de abrir, use <b>Adicionar mais arquivos</b> na etapa Documentos. Vídeos só são listados.</p>
        <p class="drop-nota">${libs.ocr ? html`<b>Lê também prints e fotos</b> (telas do SAP, cláusulas coladas no e-mail, PDF escaneado) por reconhecimento de texto feito aqui mesmo, até ${30} imagens por envio.` : 'Prints e fotos são listados, mas não lidos neste navegador.'}</p>
      </div>
      <div class="cartoes">
        ${st && html`<button class="cartao" onClick=${() => setEtapa('documentos')}><b>Voltar ao processo aberto</b><span>RC ${val(st.processo.rc) || st.nomeProcesso}</span></button>`}
        ${!st && salvo && html`<button class="cartao" onClick=${continuar}><b>Continuar o último processo</b><span>RC ${val(salvo.processo.rc) || salvo.nomeProcesso || '—'} · salvo neste navegador</span></button>`}
        <button class="cartao" onClick=${demo}><b>Ver demonstração</b><span>Concorrência fictícia com 3 fornecedores, 3 rodadas, e-mails e situações para conferir</span></button>
        <button class="cartao" onClick=${() => setModal(html`<${ModalPlanilha} fechar=${() => setModal(null)} st=${st} />`)}><b>Gerar planilha padrão Samarco</b><span>Para enviar com a carta-convite e equalizar automaticamente</span></button>
        <button class="cartao" onClick=${() => refJson.current.click()}><b>Abrir processo salvo (.json)</b><span>Retomar um RH exportado anteriormente</span></button>
        <input ref=${refJson} type="file" accept=".json" hidden onChange=${(e) => e.target.files.length && abrirJSON(e.target.files[0])} />
      </div>
      <section class="como">
        <h2>Como funciona</h2>
        <ol class="fluxo">
          <li><b>Pasta</b><span>Arraste a pasta, o .zip ou o .7z do processo (pode ser em partes).</span></li>
          <li><b>Documentos</b><span>O FLOW separa os documentos pelas pastas 1 a 8, lê e-mails e anexos e ignora cópias repetidas.</span></li>
          <li><b>Conferência</b><span>Cabeçalho do RH, vendor list, qualificações e propostas, cada dado com o arquivo de onde veio.</span></li>
          <li><b>Equalização</b><span>Item a item e por rodada, com a ponderação técnica e comercial da SMIN-IT-GSU-004.</span></li>
          <li><b>Negociação</b><span>Evolução das rodadas e custo evitado sobre a proposta inicial.</span></li>
          <li><b>RH pronto</b><span>Relatório de Homologação no formulário Samarco (ou aditivo), PDF FLOW e Excel das tabelas.</span></li>
        </ol>
        <details class="padrao"><summary>Como o FLOW reconhece os documentos</summary>
          <p>Pela estrutura de pastas do processo (1 - Requisição de Compra, 2 - Estratégia de Contratação, 3 - Solicitação de Proposta, 4 - Qualificação de Fornecedores, 5 - Proposta Técnica, 6 - Proposta Comercial com 6.1 Inicial / 6.2 Revisão 01…, 7 - Análise Comercial ou 7 - Aditivo, 8 - Contrato), pelo nome e pelo conteúdo. Para aditivos, inclua também o RH do aditivo anterior. Nomes que ajudam:</p>
          <table class="tab"><thead><tr><th>Documento</th><th>Nome do arquivo</th></tr></thead><tbody>
            <tr><td>Requisição de compra</td><td><code>RC_4500012345.xlsx</code></td></tr>
            <tr><td>Carta-convite</td><td><code>CC_4500012345.pdf</code></td></tr>
            <tr><td>Proposta técnica</td><td><code>PT_FORNECEDOR.pdf</code></td></tr>
            <tr><td>Proposta comercial (planilha padrão)</td><td><code>PC_FORNECEDOR_R1.xlsx</code>, <code>PC_FORNECEDOR_R2.xlsx</code>, <code>PC_FORNECEDOR_BAFO.xlsx</code></td></tr>
            <tr><td>Parecer / avaliação técnica</td><td><code>AT_PARECER_TECNICO.xlsx</code></td></tr>
            <tr><td>Ata de negociação</td><td><code>ATA_NEGOCIACAO_R2.docx</code>, <code>ATA_NEGOCIACAO_BAFO.docx</code></td></tr>
            <tr><td>Homologação do fornecedor</td><td><code>HOM_FORNECEDOR.pdf</code></td></tr>
          </tbody></table>
          <p class="mut">FORNECEDOR = nome curto, sem espaços (ex.: ALFA, BETA). Subpastas são livres.</p>
        </details>
      </section>`;
  }

  // ------------------------------------------------------------ Planilha padrão (modal)
  function ModalPlanilha({ fechar, st }) {
    const [itens, setItens] = useState(st && st.itensRC.length ? st.itensRC : null);
    const [rc, setRc] = useState(st ? paraTexto(val(st.processo.rc)) : '');
    const [obj, setObj] = useState(st ? paraTexto(val(st.processo.objeto)) : '');
    const [msg, setMsg] = useState('');
    const ref = useRef();
    async function lerRC(file) {
      const { entradas: ents } = await L.lerTudo(libs, [file]);
      ents.forEach((e) => { e.tipo = 'PQ'; e.manual = true; });
      const s = E.montarEstado(ents);
      if (!s.itensRC.length) { setMsg('Não encontrei a tabela de itens nesse arquivo.'); return; }
      setItens(s.itensRC); setRc(paraTexto(val(s.processo.rc))); setObj(paraTexto(val(s.processo.objeto))); setMsg('');
    }
    async function gerar(branco) {
      const its = branco || !itens ? Array.from({ length: 15 }, (_, i) => ({ item: String(i + 1), codigo: '', descricao: '', un: '', qtd: null })) : itens;
      const wb = PlanilhaPadrao.criar(ExcelJS, { rc, objeto: obj, itens: its });
      baixar(await wb.xlsx.writeBuffer(), `Planilha_Precos_Padrao_RC${nomeArq(rc || 'modelo')}.xlsx`);
    }
    return html`<h2>Planilha de preços padrão Samarco</h2>
      <p>Envie esta planilha junto com a carta-convite. O fornecedor preenche só as células amarelas e devolve, e a equalização fica automática.</p>
      <div class="grade2">
        <label class="campo"><span class="rot">RC</span><input class="inp" value=${rc} onInput=${(e) => setRc(e.target.value)} /></label>
        <label class="campo larg"><span class="rot">Objeto</span><input class="inp" value=${obj} onInput=${(e) => setObj(e.target.value)} /></label>
      </div>
      <p>${itens ? html`<b>${itens.length} itens</b> da RC serão incluídos.` : 'Nenhuma RC carregada.'}
        <button class="btn link" onClick=${() => ref.current.click()}>Ler itens de um arquivo de RC (.xlsx)</button></p>
      <input ref=${ref} type="file" accept=".xlsx,.xls,.xlsm,.csv" hidden onChange=${(e) => e.target.files.length && lerRC(e.target.files[0])} />
      ${msg && html`<p class="erro">${msg}</p>`}
      <div class="modal-acoes">
        <button class="btn sec" onClick=${fechar}>Fechar</button>
        <button class="btn sec" onClick=${() => gerar(true)}>Planilha em branco</button>
        <button class="btn pri" disabled=${!itens} onClick=${() => gerar(false)}><${Icone} n="baixar" /> Gerar com os itens da RC</button>
      </div>`;
  }

  // ================================================================== 2. Documentos
  function Documentos({ st, eq, setEtapa, reclassificar, setModal, processar }) {
    const todosDocs = st.documentos;
    const docs = todosDocs.filter((d) => d.status !== 'duplicado' && d.tipo !== 'IGNORAR');
    const dup = todosDocs.filter((d) => d.status === 'duplicado');
    const ign = todosDocs.filter((d) => d.tipo === 'IGNORAR');
    const pend = docs.filter((d) => d.status === 'pendente' || d.status === 'erro');
    const conf = docs.filter((d) => d.status === 'conferir');
    const okN = docs.filter((d) => d.status === 'ok').length;
    const mb = todosDocs.reduce((t, d) => t + (d.tamanho || 0), 0);
    const [sobre, setSobre] = useState(false);
    const refMais = useRef(), refPastaMais = useRef();
    useEffect(() => { if (refPastaMais.current) refPastaMais.current.setAttribute('webkitdirectory', ''); }, []);
    const fornNome = (id) => val((st.fornecedores.find((f) => f.id === id) || {}).nome);
    const grupos = Object.keys(E.TIPOS).filter((t) => t !== 'IGNORAR').map((t) => [t, docs.filter((d) => d.tipo === t && d.status !== 'pendente')]).filter(([, l]) => l.length);
    const verTexto = (d) => setModal(html`<h2>${d.nome}</h2><pre class="texto-doc">${d.texto || 'Sem texto legível (imagem, PDF escaneado ou arquivo não lido).'}</pre>
      <div class="modal-acoes"><button class="btn sec" onClick=${() => setModal(null)}>Fechar</button></div>`);
    const soltar = async (e) => { e.preventDefault(); setSobre(false); const arqs = await L.lerArrasto(e.dataTransfer); if (arqs.length) processar(arqs, null, true); };
    return html`
      <div class="resumo-docs">
        <div class="kpi"><b>${docs.length}</b><span>documentos · ${L.MB(mb)}</span></div>
        <div class="kpi bom"><b>${okN}</b><span>lidos automaticamente</span></div>
        <div class=${'kpi' + (conf.length ? ' atencao' : '')}><b>${conf.length}</b><span>para conferir</span></div>
        <div class=${'kpi' + (pend.length ? ' ruim' : '')}><b>${pend.length}</b><span>precisam da sua indicação</span></div>
      </div>
      <div class=${'drop mini-drop' + (sobre ? ' sobre' : '')} onDragOver=${(e) => { e.preventDefault(); setSobre(true); }} onDragLeave=${() => setSobre(false)} onDrop=${soltar}>
        <span><${Icone} n="mais" /> <b>Faltou algo ou a pasta é grande?</b> Arraste aqui mais arquivos, pastas ou compactados: eles são somados a este processo.</span>
        <span class="drop-acoes">
          <button class="btn sec peq" onClick=${() => refMais.current.click()}><${Icone} n="subir" /> Adicionar mais arquivos</button>
          <button class="btn sec peq" onClick=${() => refPastaMais.current.click()}><${Icone} n="pasta" /> Adicionar pasta</button>
        </span>
        <input ref=${refMais} type="file" multiple hidden onChange=${(e) => e.target.files.length && processar([...e.target.files], null, true)} />
        <input ref=${refPastaMais} type="file" multiple hidden onChange=${(e) => e.target.files.length && processar([...e.target.files], null, true)} />
      </div>
      ${pend.length > 0 && html`<section class="painel destaque">
        <h2><${Icone} n="alerta" /> Não reconheci estes arquivos. O que é cada um?</h2>
        ${pend.map((d) => html`<${LinhaDoc} d=${d} st=${st} reclassificar=${reclassificar} verTexto=${verTexto} destaque />`)}
      </section>`}
      ${grupos.map(([t, lista]) => html`<section class="painel">
        <h3>${E.TIPOS[t]} <span class="cont">${lista.length}</span></h3>
        ${lista.map((d) => html`<${LinhaDoc} d=${d} st=${st} reclassificar=${reclassificar} verTexto=${verTexto} fornNome=${fornNome} />`)}
      </section>`)}
      ${(dup.length > 0 || ign.length > 0) && html`<details class="painel recolhido"><summary>${dup.length} cópia(s) repetida(s) e ${ign.length} imagem(ns) de e-mail não entram no RH</summary>
        <ul class="lista-simples">${dup.concat(ign).map((d) => html`<li><span class="caminho">${d.caminho}</span></li>`)}</ul></details>`}
      <div class="rodape-acoes">
        <span class="mut">${pend.length ? `${pend.length} arquivo(s) sem classificação. Você pode seguir e voltar depois.` : 'Todos os arquivos classificados.'}</span>
        <button class="btn pri" onClick=${() => setEtapa('conferencia')}>Seguir para a conferência <${Icone} n="seta" /></button>
      </div>`;
  }

  function LinhaDoc({ d, st, reclassificar, verTexto, fornNome, destaque }) {
    const precisaForn = d.tipo && E.TIPO_COM_FORNECEDOR[d.tipo];
    const precisaRod = d.tipo && E.TIPO_COM_RODADA[d.tipo];
    const nomeForn = d.fornecedorId ? (fornNome ? fornNome(d.fornecedorId) : val((st.fornecedores.find((f) => f.id === d.fornecedorId) || {}).nome)) : '';
    const statusIc = { ok: ['ok', 'Lido'], conferir: ['alerta', 'Conferir'], pendente: ['alerta', 'Indicar'], erro: ['x', 'Erro'] }[d.status] || ['alerta', d.status];
    const escolherForn = async (v) => {
      if (v === '__novo') { const n = await pedirTexto('Nome do fornecedor:'); if (n) reclassificar(d.id, { fornecedorManual: n }); return; }
      const f = st.fornecedores.find((x) => x.id === v);
      if (f) reclassificar(d.id, { fornecedorManual: val(f.nome) });
    };
    return html`<div class=${'doc ' + d.status + (destaque ? ' dest' : '')}>
      <div class="doc-nome"><span class=${'ext e-' + d.ext}>${d.ext || '?'}</span>
        <div><b>${d.nome}</b><span class="caminho">${d.caminho}</span>
          ${d.email && html`<span class="caminho">✉ ${d.email.assunto || '(sem assunto)'} · ${d.email.data || ''}${d.email.de ? ' · ' + d.email.de.replace(/<.*?>/g, '').trim() : ''}</span>`}
          ${d.aviso && html`<span class="aviso-doc">${d.aviso}</span>`}${d.erro && html`<span class="aviso-doc erro">${d.erro}</span>`}
          ${d.origem && !destaque && html`<span class="caminho">reconhecido pelo ${d.origem}${d.manual ? ' · indicado por você' : ''}</span>`}
        </div></div>
      <div class="doc-campos">
        <select class="inp" value=${d.tipo || ''} onChange=${(e) => reclassificar(d.id, { tipo: e.target.value || null })} aria-label="Tipo do documento">
          <option value="">— o que é? —</option>
          ${Object.entries(E.TIPOS).map(([k, v]) => html`<option value=${k} selected=${d.tipo === k}>${v}</option>`)}
        </select>
        ${precisaForn && html`<select class="inp" value=${d.fornecedorId || ''} onChange=${(e) => escolherForn(e.target.value)} aria-label="Fornecedor">
          <option value="">${d.fornecedorId ? nomeForn : '— fornecedor —'}</option>
          ${st.fornecedores.map((f) => html`<option value=${f.id} selected=${d.fornecedorId === f.id}>${val(f.nome)}</option>`)}
          <option value="__novo">+ outro fornecedor…</option>
        </select>`}
        ${precisaRod && html`<select class="inp rod" value=${d.rodada || ''} onChange=${(e) => reclassificar(d.id, { rodada: e.target.value || null })} aria-label="Rodada">
          <option value="">— rodada —</option>${RODADAS_OPC.map((r) => html`<option value=${r} selected=${d.rodada === r}>${E.nomeRodada(r)}</option>`)}
        </select>`}
        ${d.texto && html`<button class="btn ico" title="Ver o texto lido" onClick=${() => verTexto(d)}><${Icone} n="olho" /></button>`}
        <span class=${'st st-' + d.status}><${Icone} n=${statusIc[0]} t=${13} /> ${statusIc[1]}</span>
      </div>
    </div>`;
  }

  // ================================================================== 3. Conferência
  function Conferencia({ st, eq, mudar, setEtapa, avisar }) {
    const p = st.processo;
    const setP = (k) => (v) => mudar((s) => { s.processo[k] = { v, fonte: 'editado' }; });
    const [sel, setSel] = useState(null);
    const props = [...st.propostas].sort((a, b) => fornIdx(st, a.fornecedorId) - fornIdx(st, b.fornecedorId) || E.ordemRodada(a.rodada) - E.ordemRodada(b.rodada));
    const atual = props.find((x) => x.id === sel) || props.find((x) => x.confianca && x.confianca !== 'alta' && x.confianca !== 'conferida') || props[0];

    function novaProposta() {
      if (!st.fornecedores.length) { avisar('Cadastre um fornecedor primeiro.', 'erro'); return; }
      mudar((s) => {
        const prop = {
          id: 'P' + s.seq.p++, fornecedorId: s.fornecedores[0].id, rodada: 'R1', docId: null, arquivo: '(digitada na conferência)', confianca: 'manual',
          prazoEntrega: E.F(null), condPagamento: E.F(null), validade: E.F(null), frete: E.F(null), data: E.F(null), totalDeclarado: E.F(null),
          itens: s.itensRC.map((it) => ({ item: it.item, codigo: it.codigo, descricao: it.descricao, un: it.un, qtd: it.qtd, preco: null, total: null, fonte: 'digitado' })),
          ajuste: { valor: 0, motivo: '' },
        };
        s.propostas.push(prop);
        setSel(prop.id);
      });
    }
    async function novoFornecedor() {
      const n = await pedirTexto('Nome do fornecedor:');
      if (n) mudar((s) => { E.garantirFornecedor(s, n, 'editado'); });
    }

    const tipo = val(st.tipoProcesso) || 'concorrencia';
    const setQ = (f, k) => (v) => mudar((s) => { s.fornecedores.find((x) => x.id === f.id)[k] = { v: v || null, fonte: 'editado' }; });
    const OPC_Q = ['', 'APROVADO', 'REPROVADO', 'DISPENSADO', 'NÃO APLICÁVEL'];
    const selQ = (f, k, opc = OPC_Q) => html`<select class="inp mini-sel" onChange=${(e) => setQ(f, k)(e.target.value)}>${opc.map((o) => html`<option value=${o} selected=${String(val(f[k]) || '') === o}>${o || '—'}</option>`)}</select>`;
    return html`
      <p class="intro">Confira os dados abaixo. Cada informação mostra <b>o arquivo de onde veio</b>. Corrija o que for preciso: a equalização e o RH são recalculados na hora.</p>
      <section class="painel config"><div class="cfg"><span class="rot">Tipo de processo</span>
        <select class="inp" onChange=${(e) => mudar((s) => { s.tipoProcesso = { v: e.target.value, fonte: 'editado' }; })}>
          ${Object.entries(E.TIPOS_PROCESSO).map(([k, n]) => html`<option value=${k} selected=${tipo === k}>${n}</option>`)}</select>
        <${Fonte} f=${st.tipoProcesso} /></div>
        <div class="cfg"><span class="rot">Moeda das propostas</span>
          <select class="inp" onChange=${(e) => mudar((s) => { s.moeda = e.target.value; })}>${['BRL', 'USD', 'EUR', 'AUD'].map((m) => html`<option value=${m} selected=${(st.moeda || 'BRL') === m}>${m}</option>`)}</select></div>
      </section>

      <${PainelCabecalho} st=${st} eq=${eq} mudar=${mudar} avisar=${avisar} />

      ${tipo === 'aditivo' && html`<${PainelAditivo} st=${st} mudar=${mudar} />`}

      ${tipo !== 'aditivo' && html`
      <section class="painel"><h2>Itens da RC <span class="cont">${st.itensRC.length}</span></h2>
        ${st.itensRC.length ? html`<p class="mut">Fonte: ${(st.itensRC[0].fonte || '').split(' › ')[0]}. A equalização compara as propostas com estes itens e quantidades.</p>`
          : html`<p class="aviso"><${Icone} n="alerta" /> Não encontrei a planilha de quantidades da RC. A equalização usará os itens das propostas. Se preferir, cole os itens abaixo.</p>`}
        <${TabelaItens} itens=${st.itensRC} rc mudar=${mudar} lista=${(s) => s.itensRC} />
      </section>

      <${PainelVendorList} st=${st} eq=${eq} mudar=${mudar} />

      <section class="painel"><h2>Fornecedores e qualificações <span class="cont">${st.fornecedores.length}</span>
        <button class="btn sec peq dir" onClick=${novoFornecedor}><${Icone} n="mais" /> Fornecedor</button></h2>
        <div class="rolagem"><table class="tab forn"><thead><tr><th>Fornecedor</th><th>Código SAP</th><th>Confirmou</th><th>Apresentou</th><th>Técnica</th><th>Segurança</th><th>Financeira</th><th>Compliance</th><th>Resultado</th><th>Nota técnica</th></tr></thead><tbody>
        ${st.fornecedores.map((f) => {
          const set = (k) => (v) => mudar((s) => { s.fornecedores.find((x) => x.id === f.id)[k] = { v, fonte: 'editado' }; });
          return html`<tr>
            <td><${Txt} v=${val(f.nome)} onFim=${set('nome')} /><${Fonte} f=${f.nome} /></td>
            <td><${Txt} v=${val(f.codigoSap)} onFim=${set('codigoSap')} cls="cod" /><${Fonte} f=${f.codigoSap} vazioTxt="informe" /></td>
            <td>${selQ(f, 'confirmou', ['', 'SIM', 'NÃO'])}</td><td>${selQ(f, 'apresentou', ['', 'SIM', 'NÃO'])}</td>
            <td>${selQ(f, 'qTec')}</td><td>${selQ(f, 'qSeg')}</td><td>${selQ(f, 'qFin')}</td><td>${selQ(f, 'qComp')}</td><td>${selQ(f, 'qResultado')}</td>
            <td><${Num} v=${val(f.nt)} onFim=${set('nt')} ph="0–100" cls="qtd" /><${Fonte} f=${f.nt} vazioTxt="se houver ponderação" /></td>
          </tr>`;
        })}
        </tbody></table></div>
        ${st.fornecedores.some((f) => val(f.qTec)) && html`<p class="mut">Qualificações lidas de: ${[...new Set(st.fornecedores.map((f) => f.qTec && f.qTec.fonte).filter(Boolean).map((x) => x.split(' › ')[0]))].join(', ')}.</p>`}
      </section>

      <section class="painel"><h2>Propostas comerciais <span class="cont">${st.propostas.length}</span>
        <button class="btn sec peq dir" onClick=${novaProposta}><${Icone} n="mais" /> Digitar proposta</button></h2>
        ${props.length ? html`
          <div class="abas">${props.map((x) => html`<button class=${'aba' + (atual && atual.id === x.id ? ' sel' : '')} onClick=${() => setSel(x.id)}>
            ${curto(val((st.fornecedores.find((f) => f.id === x.fornecedorId) || {}).nome), 22)} · ${E.nomeRodada(x.rodada)}
            ${x.confianca === 'alta' || x.confianca === 'conferida' ? html`<span class="ok-ic"><${Icone} n="ok" t=${12} /></span>` : html`<span class="at-ic"><${Icone} n="alerta" t=${12} /></span>`}</button>`)}</div>
          ${atual && html`<${EditorProposta} key=${atual.id} st=${st} p=${atual} mudar=${mudar} setSel=${setSel} />`}`
        : (st.quadroPrecos || []).length ? html`<p class="aviso">Sem arquivos de proposta: a equalização usa os totais do quadro de preço (${st.quadroPrecos[0].fonte.split(' › ')[0]}).</p>`
        : html`<p class="aviso">Nenhuma proposta comercial encontrada. Classifique as propostas na etapa Documentos ou digite uma proposta.</p>`}
      </section>`}
      <div class="rodape-acoes">
        <button class="btn sec" onClick=${() => setEtapa('documentos')}><${Icone} n="voltar" /> Documentos</button>
        ${tipo === 'aditivo' || !eq ? html`<button class="btn pri" onClick=${() => setEtapa('rh')}>Montar o RH <${Icone} n="seta" /></button>`
          : html`<button class="btn pri" onClick=${() => setEtapa('equalizacao')}>Ver a equalização <${Icone} n="seta" /></button>`}
      </div>`;
  }

  // ------------------------------------------------------------ cabeçalho do RH
  const ORDEM_CAB = ['contrato', 'gerencia', 'fornecedorRH', 'dataDocumento', 'objeto', 'valorRC', 'numeroRC', 'valorAditivo', 'valorContratado', 'custoEvitado',
    'vigencia', 'prazo', 'condPagamento', 'regime', 'incoterm', 'reajuste', 'dataBase', 'rescisao', 'multa', 'classificacao', 'gerenciaRequisitante',
    'unidade', 'gestor', 'responsavel', 'formalizacao', 'rfq', 'explicacaoME', 'sharepoint'];
  const PADRAO_CAMPOS = E.CAMPOS_PADRAO;

  function PainelCabecalho({ st, eq, mudar, avisar }) {
    const tipo = val(st.tipoProcesso);
    const cab = E.cabecalhoFinal(st, eq);
    const [aberto, setAberto] = useState(true);
    const vazios = ORDEM_CAB.filter((k) => !(k === 'valorAditivo' && tipo !== 'aditivo') && !val(cab[k])).length;
    const salvarPadrao = () => {
      const p = {};
      PADRAO_CAMPOS.forEach((k) => { if (val(cab[k])) p[k] = val(cab[k]); });
      gravar(CHAVE_PADRAO, JSON.stringify(p));
      mudar((s) => { s.cabPadrao = p; }, false);
      avisar('Padrão salvo: responsável, gerência, unidade, formalização, rescisão, multa, regime e explicação do ME entram sozinhos nos próximos RH (só onde o processo não trouxer outro valor).');
    };
    return html`<section class="painel"><h2>Cabeçalho do RH ${vazios ? html`<span class="cont ruim">${vazios} em branco</span>` : html`<span class="cont bom">completo</span>`}
      <button class="btn link dir" onClick=${() => setAberto(!aberto)}>${aberto ? 'recolher' : 'mostrar'}</button></h2>
      ${aberto && html`<div class="grade">
        ${ORDEM_CAB.filter((k) => !(k === 'valorAditivo' && tipo !== 'aditivo')).map((k) => html`<${CampoTexto} key=${k} rotulo=${k === 'objeto' ? 'OBJETO' : E.ROTULOS_CAB[k]} f=${cab[k] || E.F(null)}
          area=${k === 'objeto' || k === 'reajuste' || k === 'explicacaoME'} larg=${k === 'objeto'}
          onFim=${(v) => mudar((s) => { s.cab[k] = { v, fonte: 'editado' }; })} />`)}
      </div>
      <p class="mut">Os campos com "calculado" são atualizados pelo FLOW (fornecedor, valor, custo evitado, prazo). Ao editar, vale o que você escreveu.
        <button class="btn link" onClick=${salvarPadrao}>Guardar responsável, gerência, unidade, formalização, rescisão, multa e regime como meu padrão</button></p>`}
    </section>`;
  }

  // ------------------------------------------------------------ aditivo
  const CLASSIF_ADITIVO = ['Prazo', 'Valor', 'Reajuste', 'Escopo', 'Valor e Prazo', 'Prazo e Reajuste', 'Valor, Prazo e Reajuste', 'Regularização de Prazo'];

  function PainelAditivo({ st, mudar }) {
    const a = st.aditivo || {};
    const ad = E.calcularAditivo(st);
    const set = (k) => (v) => mudar((s) => { s.aditivo[k] = { v, fonte: 'editado' }; });
    const ev = (st.evolucao || []).filter((r) => !(ad.substitui && E.parseNum(r.tac) >= ad.numero));
    const neg = a.negociacao || [];
    const fmt = (n) => (n == null || !isFinite(n) ? '—' : E.fmtNum(n, 2));
    return html`<section class="painel"><h2>Novo aditivo — ${ad.numero}º TAC</h2>
      ${!(st.evolucao || []).length && html`<p class="aviso"><${Icone} n="alerta" /> Não encontrei o RH do aditivo anterior. Suba-o na etapa Documentos ("Adicionar mais arquivos") para trazer o histórico e o cabeçalho do contrato.</p>`}
      <div class="grade">
        <label class="campo"><span class="rot">Nº do aditivo</span><${Num} v=${ad.numero} onFim=${set('numero')} /></label>
        <${CampoTexto} rotulo="Data de emissão do TAC" f=${a.data || E.F(ad.data, 'hoje')} onFim=${set('data')} />
        <label class="campo"><span class="rot">Classificação do aditivo</span>
          <select class="inp" onChange=${(e) => set('classificacao')(e.target.value)}>
            <option value="">—</option>${CLASSIF_ADITIVO.map((c) => html`<option value=${c} selected=${val(a.classificacao) === c}>${c}</option>`)}</select></label>
        <label class="campo"><span class="rot">Valor a ser aditado (R$)</span><${Num} v=${E.parseNum(val(a.valorAditado))} onFim=${set('valorAditado')} ph="0" /></label>
        <${CampoTexto} rotulo="Nova data de término" f=${a.novoTermino || E.F(null)} onFim=${set('novoTermino')} />
        <${CampoTexto} rotulo="Data de início (se mudar)" f=${a.inicio || E.F(null)} onFim=${set('inicio')} />
        <${CampoTexto} rotulo="Reajuste dos preços unitários" f=${a.reajuste || E.F(null)} onFim=${set('reajuste')} />
        <${CampoTexto} rotulo="Aplicação do reajuste" f=${a.reajusteAplicacao || E.F(null)} onFim=${set('reajusteAplicacao')} />
        <${CampoTexto} rotulo="Escopo" f=${a.escopo || E.F(null)} onFim=${set('escopo')} />
        <${CampoTexto} rotulo="Validade do aditivo" f=${a.validade || E.F(null)} onFim=${set('validade')} />
      </div>
      <h3>Resumo de evolução do contrato</h3>
      <div class="rolagem"><table class="tab"><thead><tr><th>Nº TAC</th><th>Emissão</th><th class="n">Valor aditado</th><th class="n">Valor total</th><th class="n">Variação</th><th class="n">Prazo (meses)</th><th>Início</th><th>Término</th></tr></thead><tbody>
        ${ev.map((r) => html`<tr><td>${r.tac}</td><td>${r.data}</td><td class="n">${r.aditado ? fmt(r.aditado) : '—'}</td><td class="n">${fmt(r.total)}</td><td class="n">${r.variacao}</td><td class="n">${r.prazo ?? '—'}</td><td>${r.inicio}</td><td>${r.termino}</td></tr>`)}
        <tr class="venc"><td><b>${ad.numero}º</b></td><td>${ad.data}</td><td class="n">${ad.aditado ? fmt(ad.aditado) : '—'}</td><td class="n"><b>${fmt(ad.total)}</b></td><td class="n">${ad.variacao != null ? E.fmtPct(ad.variacao) : '—'}</td><td class="n"><b>${ad.prazo ?? '—'}</b></td><td>${ad.inicio}</td><td><b>${ad.termino}</b></td></tr>
      </tbody></table></div>
      ${(st.evolucao || []).length > 0 && html`<p class="mut">Histórico lido de: ${(st.evolucao[0].fonte || '').split(' › ')[0]}${ad.substitui ? ` · a pasta já tinha o ${ad.numero}º TAC no RH anterior: a linha dele será refeita.` : ''}</p>`}
      <h3>Resultado da negociação (opcional)</h3>
      <div class="rolagem"><table class="tab"><thead><tr><th>Cenário</th><th>Resultado</th><th></th></tr></thead><tbody>
        ${neg.map((r, i) => html`<tr><td><${Txt} v=${r.cenario} onFim=${(v) => mudar((s) => { s.aditivo.negociacao[i].cenario = v; })} /></td>
          <td><${Txt} v=${r.resultado} onFim=${(v) => mudar((s) => { s.aditivo.negociacao[i].resultado = v; })} cls="cod" /></td>
          <td><button class="btn ico" onClick=${() => mudar((s) => { s.aditivo.negociacao.splice(i, 1); })}><${Icone} n="x" t=${14} /></button></td></tr>`)}
      </tbody></table></div>
      <div class="tab-acoes"><button class="btn sec peq" onClick=${() => mudar((s) => { s.aditivo.negociacao = (s.aditivo.negociacao || []).concat([{ cenario: '', resultado: '' }]); })}><${Icone} n="mais" /> Linha</button></div>
      <p class="mut">A justificativa e as considerações de Suprimentos são editadas na etapa RH pronto.</p>
    </section>`;
  }

  // ------------------------------------------------------------ vendor list
  function PainelVendorList({ st, eq, mudar }) {
    const vl = st.vendorList || [];
    const efetiva = RHSamarco.vendorListEfetiva(st, eq);
    const usandoParticipantes = vl.length && efetiva !== vl && efetiva.length !== vl.length;
    const setV = (i, k) => (v) => mudar((s) => { s.vendorList[i][k] = v; });
    return html`<section class="painel"><h2>Vendor list <span class="cont">${vl.length}</span>
      <button class="btn sec peq dir" onClick=${() => mudar((s) => { s.vendorList = (s.vendorList || []).concat([{ codigoSap: '', empresa: '', localizacao: '', faturamento: null, relacao: null, clientes: '', participouAnterior: 'Não', fonte: 'editado' }]); })}><${Icone} n="mais" /> Empresa</button></h2>
      ${vl.length ? html`<p class="mut">Fonte: ${(vl[0].fonte || 'editado').split(' › ')[0]}</p>` : html`<p class="mut">Sem vendor list na pasta. No RH entram os fornecedores do processo.</p>`}
      ${usandoParticipantes && html`<p class="aviso"><${Icone} n="alerta" /> Nenhuma empresa desta lista aparece nas propostas ou qualificações: parece ser de outro processo (sobra do modelo). No RH entram os participantes. <button class="btn link" onClick=${() => mudar((s) => { s.vendorList = []; })}>Limpar esta lista</button></p>`}
      ${vl.length > 0 && html`<div class="rolagem"><table class="tab"><thead><tr><th>Código SAP</th><th>Empresa</th><th>Localização</th><th class="n">Faturamento anual (R$)</th><th>Principais clientes</th><th>Participou do anterior</th><th></th></tr></thead><tbody>
        ${vl.map((v, i) => html`<tr><td><${Txt} v=${v.codigoSap} onFim=${setV(i, 'codigoSap')} cls="cod" /></td><td><${Txt} v=${v.empresa} onFim=${setV(i, 'empresa')} /></td>
          <td><${Txt} v=${v.localizacao} onFim=${setV(i, 'localizacao')} /></td><td><${Num} v=${v.faturamento} onFim=${setV(i, 'faturamento')} /></td>
          <td><${Txt} v=${v.clientes} onFim=${setV(i, 'clientes')} /></td><td><${Txt} v=${v.participouAnterior} onFim=${setV(i, 'participouAnterior')} cls="estreito" /></td>
          <td><button class="btn ico" onClick=${() => mudar((s) => { s.vendorList.splice(i, 1); })}><${Icone} n="x" t=${14} /></button></td></tr>`)}
      </tbody></table></div>`}
    </section>`;
  }

  const fornIdx = (st, id) => st.fornecedores.findIndex((f) => f.id === id);
  const curto = (s, n) => (String(s || '').length > n ? String(s).slice(0, n - 1) + '…' : String(s || ''));

  function EditorProposta({ st, p, mudar, setSel }) {
    const doc = st.documentos.find((d) => d.id === p.docId);
    const setF = (k) => (v) => mudar((s) => { s.propostas.find((x) => x.id === p.id)[k] = { v, fonte: 'editado' }; });
    const set = (fn) => mudar((s) => fn(s.propostas.find((x) => x.id === p.id)));
    const somaItens = p.itens.reduce((s, it) => s + (it.total ?? (it.preco != null && it.qtd != null ? it.preco * it.qtd : 0)), 0);
    const remover = async () => { if (await confirmar('Remover esta proposta da equalização?', 'Remover')) { mudar((s) => { s.propostas = s.propostas.filter((x) => x.id !== p.id); }); setSel(null); } };
    const conferida = () => mudar((s) => {
      s.propostas.find((x) => x.id === p.id).confianca = 'conferida';
      const d = s.documentos.find((x) => x.id === p.docId);
      if (d) { d.status = 'ok'; d.aviso = null; }
    });
    return html`<div class="editor">
      <div class="editor-cab">
        <div class="ed-orig"><${Icone} n="arquivo" t=${14} /> ${p.arquivo}
          ${p.confianca === 'alta' && html`<span class="chip ok">planilha lida com segurança</span>`}
          ${p.confianca === 'media' && html`<span class="chip atencao">lida de PDF/Word fora do padrão: confira os valores</span>`}
          ${(p.confianca == null) && html`<span class="chip ruim">não consegui ler os itens: digite ou cole</span>`}
          ${p.confianca === 'manual' && html`<span class="chip">digitada</span>`}
          ${p.confianca === 'conferida' && html`<span class="chip ok">conferida por você</span>`}
        </div>
        <div class="ed-botoes">
          ${p.confianca !== 'alta' && p.confianca !== 'conferida' && html`<button class="btn sec peq" onClick=${conferida}><${Icone} n="ok" /> Marcar como conferida</button>`}
          <button class="btn sec peq" onClick=${remover}><${Icone} n="lixo" /> Remover</button>
        </div>
      </div>
      <div class="grade">
        <label class="campo"><span class="rot">Fornecedor</span><select class="inp" value=${p.fornecedorId} onChange=${(e) => set((x) => { x.fornecedorId = e.target.value; })}>
          ${st.fornecedores.map((f) => html`<option value=${f.id} selected=${p.fornecedorId === f.id}>${val(f.nome)}</option>`)}</select></label>
        <label class="campo"><span class="rot">Rodada</span><select class="inp" value=${p.rodada} onChange=${(e) => set((x) => { x.rodada = e.target.value; })}>
          ${RODADAS_OPC.map((r) => html`<option value=${r} selected=${p.rodada === r}>${E.nomeRodada(r)}</option>`)}</select></label>
        <${CampoTexto} rotulo="Prazo de entrega" f=${p.prazoEntrega} onFim=${setF('prazoEntrega')} />
        <${CampoTexto} rotulo="Condição de pagamento" f=${p.condPagamento} onFim=${setF('condPagamento')} />
        <${CampoTexto} rotulo="Validade da proposta" f=${p.validade} onFim=${setF('validade')} />
        <${CampoTexto} rotulo="Frete" f=${p.frete} onFim=${setF('frete')} />
        <${CampoTexto} rotulo="Total geral informado (R$)" f=${p.totalDeclarado} onFim=${setF('totalDeclarado')} num />
        <label class="campo"><span class="rot">Ajuste na equalização (R$)</span><${Num} v=${p.ajuste.valor} onFim=${(v) => set((x) => { x.ajuste.valor = v || 0; })} ph="0" />
          <${Txt} v=${p.ajuste.motivo} onFim=${(v) => set((x) => { x.ajuste.motivo = v; })} ph="motivo (ex.: frete FOB estimado)" /></label>
      </div>
      <div class=${'editor-corpo' + (doc && doc.texto && p.confianca !== 'alta' ? ' com-texto' : '')}>
        <div>
          <${TabelaItens} itens=${p.itens} mudar=${mudar} lista=${(s) => s.propostas.find((x) => x.id === p.id).itens} itensRC=${st.itensRC} />
          <p class="soma">Soma dos itens informados: <b>${E.fmtBRL(somaItens)}</b>
            ${val(p.totalDeclarado) != null && Math.abs(E.parseNum(val(p.totalDeclarado)) - somaItens) > 0.5 ? html` <span class="chip atencao">difere do total geral informado (${E.fmtBRL(E.parseNum(val(p.totalDeclarado)))})</span>` : ''}</p>
        </div>
        ${doc && doc.texto && p.confianca !== 'alta' && html`<aside class="texto-lado"><b>Texto do documento</b><span class="mut">Selecione e copie (Ctrl+C) para colar na tabela.</span><pre>${doc.texto}</pre></aside>`}
      </div>
    </div>`;
  }

  function interpretarColagem(texto) {
    const linhas = texto.split(/\r?\n/).filter((l) => l.trim()).map((l) => l.split('\t').map((c) => c.trim()));
    if (linhas.length && linhas.every((l) => l.length === 1 && E.parseNum(l[0]) != null)) return { precos: linhas.map((l) => E.parseNum(l[0])) };
    const cab = E.itensDeLinhas(linhas.map((l) => l.map((c) => (c === '' ? null : c))), 'colado', (r) => `colado pelo comprador (linha ${r + 1})`);
    if (cab && cab.itens.length) return { itens: cab.itens };
    const itens = linhas.filter((l) => l.length >= 4).map((c, i) => {
      const [item, codigo, descricao, un, qtd, preco, total] = c.length >= 7 ? c : c.length === 6 ? [c[0], '', c[1], c[2], c[3], c[4], c[5]] :
        c.length === 5 ? [c[0], '', c[1], c[2], c[3], c[4], null] : [String(i + 1), '', c[0], c[1], c[2], c[3], null];
      return { item: String(E.parseNum(item) ?? item), codigo: codigo || '', descricao: descricao || '', un: (un || '').toUpperCase(), qtd: E.parseNum(qtd),
        preco: E.parseNum(preco), total: E.parseNum(total), fonte: 'colado pelo comprador' };
    }).filter((it) => it.qtd != null || it.preco != null);
    return { itens };
  }

  function TabelaItens({ itens, mudar, lista, rc, itensRC }) {
    const [colar, setColar] = useState(false);
    const [txt, setTxt] = useState('');
    const edit = (i, k) => (v) => mudar((s) => { const it = lista(s)[i]; it[k] = v; it.fonte = 'editado'; });
    const aplicarColagem = async () => {
      const r = interpretarColagem(txt);
      if (r.precos) {
        if (!itens.length) { informar('Cole a tabela completa (item, descrição, un, qtd, preço).'); return; }
        mudar((s) => { lista(s).forEach((it, i) => { if (r.precos[i] != null) { it.preco = r.precos[i]; it.total = null; it.fonte = 'colado pelo comprador'; } }); });
      } else if (r.itens && r.itens.length) {
        if (itens.length && !(await confirmar(`Substituir os ${itens.length} itens atuais pelos ${r.itens.length} colados?`, 'Substituir'))) return;
        mudar((s) => { const l = lista(s); l.splice(0, l.length, ...r.itens.map((it) => (rc ? { ...it, precoEst: it.precoEst ?? it.preco } : it))); });
      } else { informar('Não reconheci a tabela colada. Copie do Excel/PDF com as colunas: item, descrição, un, qtd, preço unitário.'); return; }
      setColar(false); setTxt('');
    };
    const usarRC = () => mudar((s) => { const l = lista(s); l.splice(0, l.length, ...s.itensRC.map((it) => ({ item: it.item, codigo: it.codigo, descricao: it.descricao, un: it.un, qtd: it.qtd, preco: null, total: null, fonte: 'digitado' }))); });
    return html`<div class="rolagem"><table class="tab itens">
      <thead><tr><th>Item</th><th>Código</th><th class="desc">Descrição</th><th>Un</th><th class="n">Qtd</th>
        ${rc ? html`<th class="n">Preço est. (R$)</th>` : html`<th class="n">Preço unit. (R$)</th><th class="n">Total informado</th>`}<th></th></tr></thead>
      <tbody>${itens.map((it, i) => {
        const calc = it.preco != null && it.qtd != null ? it.preco * it.qtd : null;
        const difTot = !rc && it.total != null && calc != null && Math.abs(it.total - calc) > 0.5;
        return html`<tr class=${!rc && !(it.preco > 0) && !(it.total > 0) ? 'sem-preco' : ''}>
          <td><${Txt} v=${it.item} onFim=${edit(i, 'item')} cls="estreito" /></td>
          <td><${Txt} v=${it.codigo} onFim=${edit(i, 'codigo')} cls="cod" /></td>
          <td class="desc"><${Txt} v=${it.descricao} onFim=${edit(i, 'descricao')} /></td>
          <td><${Txt} v=${it.un} onFim=${(v) => edit(i, 'un')(String(v).toUpperCase())} cls="estreito" /></td>
          <td class="n"><${Num} v=${it.qtd} onFim=${edit(i, 'qtd')} cls="qtd" /></td>
          ${rc ? html`<td class="n"><${Num} v=${it.precoEst} onFim=${edit(i, 'precoEst')} /></td>`
            : html`<td class="n"><${Num} v=${it.preco} onFim=${edit(i, 'preco')} ph="não cotado" /></td>
              <td class="n"><${Num} v=${it.total} onFim=${edit(i, 'total')} cls=${difTot ? 'dif' : ''} />${difTot && html`<span class="mini-alerta" title=${'qtd × preço = ' + E.fmtBRL(calc)}>≠ ${E.fmtBRL(calc)}</span>`}</td>`}
          <td><button class="btn ico" title="Remover item" onClick=${() => mudar((s) => { lista(s).splice(i, 1); })}><${Icone} n="x" t=${14} /></button></td>
        </tr>`;
      })}</tbody></table></div>
      <div class="tab-acoes">
        <button class="btn sec peq" onClick=${() => mudar((s) => { const l = lista(s); l.push({ item: String(l.length + 1), codigo: '', descricao: '', un: '', qtd: null, preco: null, total: null, precoEst: null, fonte: 'digitado' }); })}><${Icone} n="mais" /> Item</button>
        <button class="btn sec peq" onClick=${() => setColar(!colar)}>Colar do Excel / PDF</button>
        ${!rc && itensRC && itensRC.length > 0 && !itens.length && html`<button class="btn sec peq" onClick=${usarRC}>Preencher com os itens da RC</button>`}
      </div>
      ${colar && html`<div class="colar">
        <textarea class="inp" rows="6" placeholder=${'Cole aqui (Ctrl+V) as linhas copiadas do Excel ou do PDF.\nColunas: item, [código], descrição, un, qtd, preço unitário, [total].\nOu cole só a coluna de preços, na ordem dos itens.'} value=${txt} onInput=${(e) => setTxt(e.target.value)} />
        <div><button class="btn pri peq" onClick=${aplicarColagem}>Aplicar</button> <button class="btn sec peq" onClick=${() => setColar(false)}>Cancelar</button></div>
      </div>`}`;
  }

  // ================================================================== 4. Equalização
  function Equalizacao({ st, eq, mudar, setEtapa }) {
    const [rod, setRod] = useState(eq.resumo.ultima);
    const r = eq.porRodada[rod] ? rod : eq.resumo.ultima;
    const R = eq.porRodada[r];
    const cfg = st.config;
    const nomeF = (fid) => val(st.fornecedores.find((f) => f.id === fid).nome);
    const setCfg = (k) => (v) => mudar((s) => { s.config[k] = v; }, false);
    const alertas = eq.alertas.filter((a) => a.rodada === r);
    const rotFlag = { unidade: 'Un ≠', quantidade: 'Qtd ≠', total: 'Total ≠' };
    const dicaFlag = (c, ln) => [
      c.flags.includes('unidade') ? `Unidade do fornecedor: ${c.unF} (RC: ${ln.un})` : '',
      c.flags.includes('quantidade') ? `Quantidade do fornecedor: ${E.fmtQtd(c.qtdF)} (RC: ${E.fmtQtd(ln.qtd)})` : '',
      c.flags.includes('total') ? `Total informado ${E.fmtBRL(c.totalInf)} ≠ qtd × preço ${E.fmtBRL(c.totalCalc)}` : '',
      c.fonte ? 'Fonte: ' + c.fonte : '',
    ].filter(Boolean).join('\n');
    return html`
      <section class="painel config">
        <div class="cfg"><span class="rot">Peso técnico</span><div class="pesos"><${Num} v=${cfg.pesoTecnico} onFim=${(v) => mudar((s) => { s.config.pesoTecnico = v ?? 0; s.config.pesoComercial = Math.max(0, 100 - (v ?? 0)); }, false)} cls="curto" />%</div></div>
        <div class="cfg"><span class="rot">Peso comercial</span><div class="pesos"><${Num} v=${cfg.pesoComercial} onFim=${(v) => mudar((s) => { s.config.pesoComercial = v ?? 0; s.config.pesoTecnico = Math.max(0, 100 - (v ?? 0)); }, false)} cls="curto" />%</div></div>
        <div class="cfg"><span class="rot">Item não cotado</span><select class="inp" value=${cfg.faltante} onChange=${(e) => setCfg('faltante')(e.target.value)}>
          <option value="maior">equalizar pelo maior preço dos demais</option><option value="media">equalizar pelo preço médio dos demais</option><option value="nenhum">não preencher (só sinalizar)</option></select></div>
        <div class="cfg"><span class="rot">Tolerância de arredondamento</span><div class="pesos">R$ <${Num} v=${cfg.tolerancia} onFim=${(v) => setCfg('tolerancia')(v ?? 0)} cls="curto" /></div></div>
        ${!eq.resumo.usaTec && html`<p class="mut cfg-nota">Sem notas técnicas informadas: a classificação usa só o preço. Informe as notas na Conferência para aplicar os pesos.</p>`}
      </section>

      <div class="abas">${eq.rodadas.map((x) => html`<button class=${'aba' + (x === r ? ' sel' : '')} onClick=${() => setRod(x)}>${E.nomeRodada(x)}</button>`)}</div>
      <section class="painel sem-borda-topo">
        <div class="rolagem"><table class="tab matriz">
          <thead>
            <tr><th rowspan="2">Item</th><th rowspan="2" class="desc">Descrição</th><th rowspan="2">Un</th><th rowspan="2" class="n">Qtd RC</th>
              ${R.fornecedores.map((fid) => html`<th colspan="2" class="forn-cab">${nomeF(fid)}${R.totais[fid].herdada ? html`<span class="mini">mantida da ${E.nomeRodada(R.totais[fid].de)}</span>` : ''}</th>`)}</tr>
            <tr>${R.fornecedores.map(() => html`<th class="n">Unit.</th><th class="n">Total</th>`)}</tr>
          </thead>
          <tbody>${R.linhas.map((ln) => html`<tr>
            <td>${ln.item}</td><td class="desc">${ln.descricao}${ln.codigo ? html`<span class="mini">${ln.codigo}</span>` : ''}</td><td>${ln.un}</td><td class="n">${E.fmtQtd(ln.qtd)}</td>
            ${R.fornecedores.map((fid) => {
              const c = ln.cel[fid];
              const menor = !c.preenchido && !c.faltante && ln.menor != null && c.preco === ln.menor && R.fornecedores.length > 1;
              const cls = c.preenchido ? 'eqz' : c.faltante ? 'falta' : c.flags.length ? 'flag' : menor ? 'menor' : '';
              return html`<td class=${'n ' + cls} title=${dicaFlag(c, ln)}>${c.faltante && !c.preenchido ? '—' : E.fmtBRL(c.preco)}</td>
                <td class=${'n ' + cls} title=${dicaFlag(c, ln)}>${c.faltante && !c.preenchido ? html`<span class="tag ruim">não cotado</span>` : E.fmtBRL(c.valor)}
                  ${c.preenchido ? html`<span class="tag laranja">não cotado · equalizado</span>` : ''}
                  ${c.flags.filter((f) => rotFlag[f]).map((f) => html`<span class="tag amarelo">${rotFlag[f]}</span>`)}
                  ${menor ? html`<span class="tag verde">menor</span>` : ''}</td>`;
            })}
          </tr>`)}</tbody>
          <tfoot>
            <tr><td colspan="4">Soma dos itens (equalizada)</td>${R.fornecedores.map((fid) => html`<td colspan="2" class="n">${E.fmtBRL(R.totais[fid].somaItens)}</td>`)}</tr>
            ${R.fornecedores.some((fid) => R.totais[fid].ajuste) && html`<tr><td colspan="4">Ajustes</td>${R.fornecedores.map((fid) => html`<td colspan="2" class="n">${E.fmtBRL(R.totais[fid].ajuste)}</td>`)}</tr>`}
            <tr class="forte"><td colspan="4">Total equalizado</td>${R.fornecedores.map((fid) => html`<td colspan="2" class="n">${E.fmtBRL(R.totais[fid].equalizado)}</td>`)}</tr>
            <tr><td colspan="4">Total declarado pelo fornecedor</td>${R.fornecedores.map((fid) => html`<td colspan="2" class=${'n' + (R.totais[fid].divergeDeclarado ? ' flag' : '')}>${E.fmtBRL(R.totais[fid].declarado)}</td>`)}</tr>
            ${[['prazoEntrega', 'Prazo de entrega'], ['condPagamento', 'Pagamento'], ['frete', 'Frete'], ['validade', 'Validade']].map(([k, rot]) => html`<tr class="cond"><td colspan="4">${rot}</td>${R.fornecedores.map((fid) => html`<td colspan="2" class="n">${R.totais[fid].condicoes[k] ?? '—'}</td>`)}</tr>`)}
          </tfoot>
        </table></div>
        <div class="legenda"><span><i class="lg-menor"></i>menor preço do item</span><span><i class="lg-eqz"></i>não cotado, equalizado</span><span><i class="lg-flag"></i>divergência a conferir</span><span class="mut">Passe o mouse sobre um valor para ver o detalhe e a fonte.</span></div>
      </section>

      ${alertas.length > 0 && html`<section class="painel"><h2><${Icone} n="alerta" /> Pontos de atenção — ${E.nomeRodada(r)} <span class="cont">${alertas.length}</span></h2>
        <ul class="alertas">${alertas.map((a) => html`<li class=${'al-' + a.nivel}><span class="nivel">${{ alto: 'importante', medio: 'conferir', baixo: 'info' }[a.nivel]}</span>${a.msg}</li>`)}</ul>
        <p class="mut">Corrija na etapa Conferência (ex.: converter o preço para a unidade da RC). A equalização é recalculada na hora.</p></section>`}

      <section class="painel"><h2>Classificação — ${E.nomeRodada(eq.resumo.ultima)}</h2>
        <div class="rolagem"><table class="tab classif"><thead><tr><th>Pos.</th><th>Fornecedor</th><th class="n">Valor equalizado</th>
          ${eq.resumo.usaTec && html`<th class="n">Nota técnica</th><th class="n">Nota comercial</th>`}<th class="n">Nota final</th><th>Situação</th></tr></thead>
          <tbody>${eq.classificacao.map((c) => html`<tr class=${c.posicao === 1 ? 'venc' : ''}>
            <td>${c.posicao ? c.posicao + 'º' : '—'}</td><td><b>${c.nome}</b></td><td class="n">${E.fmtBRL(c.total)}</td>
            ${eq.resumo.usaTec && html`<td class="n">${c.nt != null ? E.fmtNum(c.nt) : '—'}</td><td class="n">${c.nc != null ? E.fmtNum(c.nc) : '—'}</td>`}
            <td class="n"><b>${c.nf != null ? E.fmtNum(c.nf) : '—'}</b></td>
            <td>${c.motivos.length ? c.motivos.map((m) => html`<span class="chip ruim">${m}</span>`) : html`<span class="chip ok">ok</span>`}</td></tr>`)}</tbody></table></div>
        ${eq.resumo.usaTec && html`<p class="mut">Nota comercial = 100 × menor valor equalizado ÷ valor do fornecedor. Nota final = ${eq.resumo.pT}% × técnica + ${eq.resumo.pC}% × comercial.</p>`}
      </section>
      <div class="rodape-acoes">
        <button class="btn sec" onClick=${() => setEtapa('conferencia')}><${Icone} n="voltar" /> Conferência</button>
        <button class="btn pri" onClick=${() => setEtapa('negociacao')}>Ver a negociação <${Icone} n="seta" /></button>
      </div>`;
  }

  // ================================================================== 5. Negociação
  function Negociacao({ st, eq, setEtapa }) {
    const series = S.seriesNegociacao(st, eq);
    const rotulos = eq.rodadas.map(E.nomeRodada);
    const [hover, setHover] = useState(null);
    const ref = useRef();
    const v = eq.vencedor, r = eq.resumo;
    const svg = useMemo(() => S.svgNegociacao(series, rotulos, { largura: 820, altura: 320, hover: true }), [eq]);
    const mover = (e) => {
      const g = e.target.closest && e.target.closest('[data-i]');
      if (!g) { setHover(null); return; }
      const box = ref.current.getBoundingClientRect();
      setHover({ i: +g.getAttribute('data-i'), x: e.clientX - box.left, y: e.clientY - box.top });
    };
    return html`
      <div class="kpis">
        <div class="kpi"><span>Fornecedor recomendado</span><b>${v ? v.nome : '—'}</b></div>
        <div class="kpi"><span>Proposta inicial (${v ? 'do recomendado' : ''})</span><b>${E.fmtBRL(v && v.negociacao.inicial)}</b></div>
        <div class="kpi dest"><span>Valor final · ${E.nomeRodada(r.ultima)}</span><b>${E.fmtBRL(v && v.total)}</b></div>
        <div class="kpi bom"><span>Custo evitado</span><b>${E.fmtBRL(r.savingNegociacao)}</b><em>${E.fmtPct(r.savingNegociacaoPct)}</em></div>
        <div class="kpi"><span>Diferença para o estimado da RC</span><b>${E.fmtBRL(r.savingEstimado)}</b><em>${E.fmtPct(r.savingEstimadoPct)}</em></div>
      </div>
      <section class="painel"><h2>Evolução do valor equalizado por rodada</h2>
        <div class="leg-graf">${series.map((s) => html`<span><i style=${{ background: s.cor }}></i>${s.nome}</span>`)}<span class="mut">○ proposta mantida da rodada anterior</span></div>
        <div class="grafico" ref=${ref} onMouseMove=${mover} onMouseLeave=${() => setHover(null)}>
        <div dangerouslySetInnerHTML=${{ __html: svg }}></div>
        ${hover && html`<div class="tooltip" style=${{ left: Math.min(hover.x + 14, (ref.current ? ref.current.clientWidth : 800) - 250) + 'px', top: hover.y + 14 + 'px' }}>
          <b>${rotulos[hover.i]}</b>
          ${series.map((s) => s.pontos[hover.i] && s.pontos[hover.i].total != null && html`<div><i style=${{ background: s.cor }}></i>${curto(s.nome, 26)}<span>${E.fmtBRL(s.pontos[hover.i].total)}${s.pontos[hover.i].herdada ? ' (mantida)' : ''}</span></div>`)}
        </div>`}
        </div>
      </section>
      <section class="painel"><h2>Valores por rodada</h2>
        <div class="rolagem"><table class="tab"><thead><tr><th>Fornecedor</th>${rotulos.map((x) => html`<th class="n">${x}</th>`)}<th class="n">Custo evitado</th><th class="n">%</th></tr></thead>
        <tbody>${eq.fids.map((fid) => { const n = eq.negociacao[fid]; return html`<tr class=${v && v.fid === fid ? 'venc' : ''}><td><b>${val(st.fornecedores.find((f) => f.id === fid).nome)}</b></td>
          ${n.serie.map((p) => html`<td class="n">${p.total != null ? E.fmtBRL(p.total) : '—'}${p.herdada ? html`<span class="mini">mantida</span>` : ''}</td>`)}
          <td class="n"><b>${E.fmtBRL(n.saving)}</b></td><td class="n">${E.fmtPct(n.savingPct)}</td></tr>`; })}</tbody></table></div>
      </section>
      <section class="painel"><h2>Atas de negociação</h2>
        <ul class="atas">${eq.rodadas.slice(1).map((x) => { const a = st.atas.find((y) => y.rodada === x); return html`<li class=${a ? 'ok' : 'falta'}>
          <${Icone} n=${a ? 'ok' : 'alerta'} t=${14} /> ${E.nomeRodada(x)}: ${a ? html`${a.arquivo}${val(a.data) ? ' · ' + val(a.data) : ''}` : 'ata não encontrada na pasta'}</li>`; })}
          ${eq.rodadas.length <= 1 && html`<li class="mut">Processo com uma única rodada.</li>`}</ul>
      </section>
      <div class="rodape-acoes">
        <button class="btn sec" onClick=${() => setEtapa('equalizacao')}><${Icone} n="voltar" /> Equalização</button>
        <button class="btn pri" onClick=${() => setEtapa('rh')}>Montar o RH <${Icone} n="seta" /></button>
      </div>`;
  }

  // ================================================================== 6. RH pronto
  const SECOES_TXT = {
    contratacao: [
      ['estrategia', '1. Estratégia de contratação', 5], ['vendorList', '2. Vendor list (texto antes da tabela)', 2], ['cartaConvite', '3. Carta convite (texto antes da tabela)', 2],
      ['analiseTecnica', '3. Análise técnica', 3], ['sst', '3. Saúde e Segurança do Trabalho', 2], ['financeira', '3. Análise financeira', 2], ['compliance', '3. Análise de compliance', 2],
      ['apresentacao', '4.1 Apresentação das propostas comerciais', 3], ['negociacao', '4.2 Análise e negociação comercial', 5], ['ponderacao', '4.3 Ponderação técnica e comercial', 2],
      ['referencial', '5. Referencial comparativo', 2], ['conclusao', '6. Conclusão', 3],
    ],
    aditivo: [['justificativaAditivo', 'Justificativa do aditivo', 6], ['consideracoes', 'Considerações de Suprimentos', 8]],
  };

  function RH({ st, eq, mudar, avisar, entradas }) {
    const tipo = val(st.tipoProcesso) || 'concorrencia';
    const dados = useMemo(() => E.dadosRH(st, eq), [st, eq, JSON.stringify(st.textos), JSON.stringify(st.cab), JSON.stringify(st.aditivo), st.rh.dataRH]);
    const sug = useMemo(() => E.textosSugeridos(st, eq), [st, eq, JSON.stringify(st.aditivo), JSON.stringify(st.cab)]);
    const htmlFlow = useMemo(() => S.htmlFLOW(st, eq, dados), [dados]);
    const previa = useMemo(() => { const r = S.escoparRelatorio(htmlFlow, 'flowrel'); return `<style>${r.css}</style><div class="flowrel">${r.corpo}</div>`; }, [htmlFlow]);
    const pend = E.pendencias(st, eq);
    const faltam = pend.filter((p) => !p.ok && p.obrig);
    const [modeloSalvo, setModeloSalvo] = useState(() => { const s = ler(CHAVE_MODELO); try { return s ? JSON.parse(s) : null; } catch { return null; } });
    const [escolha, setEscolha] = useState(null);
    const [gerando, setGerando] = useState('');
    const refModelo = useRef();
    const base = nomeArq((tipo === 'aditivo' ? val(st.cab.contrato) : val(st.cab.numeroRC) || val(st.processo.rc)) || st.nomeProcesso);
    const setRH = (k) => (v) => mudar((s) => { s.rh[k] = v; }, false);
    const setTxt = (k) => (v) => mudar((s) => { s.textos[k] = v; }, false);

    // modelos disponíveis: formulários / RH anteriores da pasta, modelo carregado, provisório
    const modelosPasta = (st.modelos || []).filter((m) => entradas.current.some((e) => e.id === m.docId && e.bytes));
    const auto = RHSamarco.escolherModelo({ ...st, modelos: modelosPasta });
    const opcoes = [
      ...modelosPasta.map((m) => ({ id: m.docId, nome: `${m.nome}${m.preenchido ? ` (RH ${m.tipo === 'aditivo' ? 'anterior' : 'preenchido'})` : ' (formulário em branco)'}`, tipo: m.tipo })),
      ...(modeloSalvo ? [{ id: 'salvo', nome: `${modeloSalvo.nome} (carregado por você)` }] : []),
      { id: 'provisorio', nome: tipo === 'aditivo' ? 'Modelo provisório FLOW (alteração contratual)' : 'Modelo provisório FLOW (contratação)' },
    ];
    const escolhido = escolha || (auto ? auto.docId : modeloSalvo ? 'salvo' : 'provisorio');
    const bytesModelo = () => {
      if (escolhido === 'salvo' && modeloSalvo) return b64bytes(modeloSalvo.b64);
      if (escolhido === 'provisorio') return b64bytes(tipo === 'aditivo' ? window.FLOW_MODELO_ADITIVO_B64 : window.FLOW_MODELO_RH_B64);
      const e = entradas.current.find((x) => x.id === escolhido);
      return e && e.bytes ? e.bytes : b64bytes(window.FLOW_MODELO_RH_B64);
    };

    async function baixarWord() {
      setGerando('word');
      try {
        const blob = RHSamarco.gerar(libs, bytesModelo(), { st, eq, dados });
        await baixar(blob, `RH_${tipo === 'aditivo' ? `${base}_${E.calcularAditivo(st).numero}TAC` : base}.docx`);
      } catch (e) { console.error(e); avisar('Erro ao montar o RH no Word: ' + e.message, 'erro'); }
      finally { setGerando(''); }
    }
    async function baixarExcel() {
      setGerando('excel');
      try { await baixar(await S.gerarExcel(libs, st, eq, dados), `SMIN-IT-GSU-004_Tabelas_RH_${base}.xlsx`); }
      catch (e) { console.error(e); avisar('Erro ao gerar o Excel: ' + e.message, 'erro'); }
      finally { setGerando(''); }
    }
    async function baixarPDF() {
      setGerando('pdf');
      try { await baixar(await S.gerarPdfFLOW(libs, htmlFlow), `RH_FLOW_${base}.pdf`); }
      catch (e) { console.error(e); avisar('Erro ao gerar o PDF: ' + e.message, 'erro'); }
      finally { setGerando(''); }
    }
    async function carregarModelo(file) {
      try {
        const u = new Uint8Array(await file.arrayBuffer());
        const info = { nome: file.name, b64: bytesB64(u), data: new Date().toLocaleDateString('pt-BR') };
        if (!gravar(CHAVE_MODELO, JSON.stringify(info))) avisar('O modelo é grande demais para ficar salvo no navegador; ele vale só nesta sessão.', 'erro');
        setModeloSalvo(info); setEscolha('salvo');
        avisar('Modelo carregado. O FLOW preenche o cabeçalho e as seções 1 a 6 (ou o resumo de aditivos) direto no formulário.');
      } catch (e) { avisar('Não consegui ler o modelo: ' + e.message, 'erro'); }
    }

    const secoes = SECOES_TXT[tipo === 'aditivo' ? 'aditivo' : 'contratacao'];
    return html`
      <div class="rh-grade">
        <div class="rh-esq">
          <section class="painel"><h2>Baixar o RH</h2>
            <label class="campo larg"><span class="rot">Modelo do RH (Word)</span>
              <select class="inp" onChange=${(e) => setEscolha(e.target.value)}>${opcoes.map((o) => html`<option value=${o.id} selected=${o.id === escolhido}>${o.nome}</option>`)}</select>
              <span class="mut">${escolhido === 'provisorio' ? 'Sem formulário na pasta: usando o modelo provisório no formato Samarco. Para usar o formulário oficial, inclua-o na pasta ou carregue abaixo.' : 'O FLOW escreve direto no formulário: cabeçalho, seções e tabelas.'}</span></label>
            <div class="saidas">
              <button class="saida" onClick=${baixarWord} disabled=${!!gerando}><${Icone} n="arquivo" t=${22} /><b>Relatório de Homologação (Word)</b><span>${gerando === 'word' ? 'Montando…' : tipo === 'aditivo' ? 'RH de alteração contratual com o novo aditivo' : 'Formulário Samarco preenchido'}</span></button>
              <button class="saida dest" onClick=${baixarPDF} disabled=${!!gerando}><${Icone} n="impressora" t=${22} /><b>RH padrão FLOW (PDF)</b><span>${gerando === 'pdf' ? 'Gerando o PDF…' : 'Resumo visual, pronto para enviar'}</span></button>
              <button class="saida" onClick=${baixarExcel} disabled=${!!gerando}><${Icone} n="planilha" t=${22} /><b>Tabelas SMIN-IT-GSU-004 (Excel)</b><span>${gerando === 'excel' ? 'Gerando…' : 'Vendor list, qualificações, quadro de preço, TCO, aditivo e detalhe por item'}</span></button>
            </div>
            <div class="modelo">
              <button class="btn sec peq" onClick=${() => refModelo.current.click()}><${Icone} n="subir" /> Carregar formulário de RH (.docx)</button>
              ${modeloSalvo && html`<button class="btn link" onClick=${() => { gravar(CHAVE_MODELO, null); setModeloSalvo(null); setEscolha(null); }}>esquecer o modelo carregado</button>`}
              <input ref=${refModelo} type="file" accept=".docx" hidden onChange=${(e) => e.target.files.length && carregarModelo(e.target.files[0])} />
            </div>
          </section>

          <section class="painel"><h2>Textos do RH</h2>
            <p class="mut">Em branco, vale o texto sugerido (em cinza), montado a partir dos documentos. Clique em "usar e editar" para ajustar.</p>
            ${secoes.map(([k, rot, linhas]) => html`<label class="campo larg" key=${k}><span class="rot">${rot}
                ${!(st.textos[k] || '').trim() && sug[k] ? html` <button class="btn link" onClick=${(e) => { e.preventDefault(); setTxt(k)(sug[k]); }}>usar e editar</button>` : ''}</span>
              <textarea class="inp" rows=${linhas} value=${st.textos[k] || ''} placeholder=${sug[k] || ''} onBlur=${(e) => setTxt(k)(e.target.value)} /></label>`)}
            <label class="campo"><span class="rot">Data do RH</span><input class="inp" value=${st.rh.dataRH || ''} onBlur=${(e) => setRH('dataRH')(e.target.value)} /></label>
          </section>

          <section class="painel"><h2>O que ainda falta ${faltam.length ? html`<span class="cont ruim">${faltam.length}</span>` : html`<span class="cont bom">completo</span>`}</h2>
            <ul class="check">${pend.map((p) => html`<li class=${p.ok ? 'ok' : p.obrig ? 'falta' : 'opc'}>
              <${Icone} n=${p.ok ? 'ok' : 'alerta'} t=${14} /><div><b>${p.grupo}</b> · ${p.desc}${!p.ok && p.dica ? html`<span class="mut"> (${p.dica})</span>` : ''}${!p.ok && !p.obrig ? html`<span class="mut"> (recomendado)</span>` : ''}</div></li>`)}</ul>
          </section>
        </div>
        <div class="rh-dir">
          <div class="previa-cab"><b>Prévia: RH padrão FLOW</b><span class="mut">atualiza conforme você edita</span></div>
          <div class="previa" role="region" aria-label="Prévia do RH padrão FLOW" dangerouslySetInnerHTML=${{ __html: previa }}></div>
        </div>
      </div>`;
  }

  const raizApp = document.getElementById('app');
  raizApp.textContent = '';
  render(html`<${App} />`, raizApp);
})();
