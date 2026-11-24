/* Funções comuns do Painel de Pendências (login, dados, GitHub, fila offline) */
(function () {
  'use strict';
  const C = window.Cripto;
  const SESSAO = 'pend-aut-sessao';

  // ---------- utilidades ----------
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const fmtDataHora = d => { d = new Date(d); return isNaN(d) ? '-' : `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
  const km = (a, b) => { const R = 6371, r = x => x * Math.PI / 180, dLa = r(b[0] - a[0]), dLo = r(b[1] - a[1]);
    const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const aviso = (msg, tipo = 'ok', ms = 3500) => {
    let el = $('#aviso'); if (!el) { el = document.createElement('div'); el.id = 'aviso'; document.body.appendChild(el); }
    el.textContent = msg; el.className = 'mostrar ' + tipo; clearTimeout(el._t); el._t = setTimeout(() => el.className = '', ms);
  };
  // chave única da pendência (liga apontamento ↔ pendência)
  const idPendencia = p => [p.frota, p.dataAbertura, p.ocorrencia].map(x => String(x || '').trim().toUpperCase()).join('|');

  // ---------- sessão / login ----------
  let S = null; // { chave, usuario, nome, config }
  let usandoCopia = false; // true = algum dado veio da cópia salva no aparelho (sem internet)
  const lerArquivo = async (caminho) => {
    let r;
    try { r = await fetch(caminho + '?t=' + Date.now(), { cache: 'no-store' }); }
    catch (e) { throw new Error('Sem internet e sem cópia salva de ' + caminho); }
    if (!r.ok) throw new Error('Não foi possível carregar ' + caminho + ' (' + r.status + ')');
    if (r.headers.get('X-Offline')) usandoCopia = true;
    return r.text();
  };
  const lerCifrado = async caminho => C.decifrar(S.chave, await lerArquivo(caminho));

  async function entrar(usuario, senha, manter) {
    const usuarios = JSON.parse(await lerArquivo('dados/usuarios.json'));
    const s = await C.abrirComSenha(usuarios, usuario, senha);
    const guardar = { v: 2, chaveB64: s.chaveB64, usuario: s.usuario, nome: s.nome, admin: !!s.admin };
    (manter ? localStorage : sessionStorage).setItem(SESSAO, JSON.stringify(guardar));
    return iniciarSessao(guardar);
  }
  async function iniciarSessao(g) {
    S = { chave: await C.chaveDeB64(g.chaveB64), usuario: g.usuario, nome: g.nome, admin: !!g.admin };
    try { S.config = await lerCifrado('dados/config.enc'); } catch (e) { S.config = null; }
    return S;
  }
  async function sessaoSalva() {
    const t = localStorage.getItem(SESSAO) || sessionStorage.getItem(SESSAO);
    if (!t) return null;
    try {
      const g = JSON.parse(t);
      if (g.v !== 2) { sair(false); return null; } // login antigo (sem perfil de administrador): pede para entrar de novo uma vez
      return await iniciarSessao(g);
    } catch (e) { sair(false); return null; }
  }
  function sair(recarregar = true) { localStorage.removeItem(SESSAO); sessionStorage.removeItem(SESSAO); if (recarregar) location.reload(); }

  // Tela de login (usada nas duas páginas). Resolve quando entrar.
  function telaLogin() {
    return new Promise(ok => {
      const box = document.createElement('div');
      box.id = 'login';
      box.innerHTML = `<div class="cartao-login">
        <div class="cab-login"><img src="img/logo.png" alt="Bioenergética Aroeira"></div>
        <form>
          <h1>Pendências da automação</h1>
          <p class="sub">Entre com o usuário e a senha que você recebeu do COA.</p>
          <label>Usuário<input name="u" autocomplete="username" autocapitalize="none" required></label>
          <label>Senha<input name="s" type="password" autocomplete="current-password" required></label>
          <label class="linha"><input type="checkbox" name="m" checked> Manter conectado neste aparelho</label>
          <button class="btn primario" type="submit">Entrar</button>
          <p class="erro" hidden></p>
        </form></div>
        <p class="rodape-login">COA · Bioenergética Aroeira</p>`;
      document.body.appendChild(box);
      const f = $('form', box), erro = $('.erro', box);
      f.onsubmit = async ev => {
        ev.preventDefault(); erro.hidden = true; const b = $('button', f); b.disabled = true; b.textContent = 'Entrando…';
        try { await entrar(f.u.value, f.s.value, f.m.checked); box.remove(); ok(S); }
        catch (e) { erro.textContent = e.message; erro.hidden = false; b.disabled = false; b.textContent = 'Entrar'; }
      };
    });
  }
  async function exigirLogin() { return (await sessaoSalva()) || telaLogin(); }

  // ---------- GitHub (token temporário guardado criptografado em dados/config.enc) ----------
  const gh = async (caminho, opt = {}) => {
    const c = S.config; if (!c || !c.token) throw new Error('Painel sem token de envio configurado');
    const r = await fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/${caminho}`, {
      ...opt, cache: 'no-store',
      headers: { Authorization: 'Bearer ' + c.token, Accept: opt.raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', ...(opt.headers || {}) },
    });
    if (r.status === 401) throw new Error('Token do painel expirado ou inválido – avise o administrador');
    if (!r.ok) throw new Error('GitHub ' + r.status + ': ' + (await r.text()).slice(0, 150));
    return opt.raw ? r.text() : r.json();
  };
  const json = corpo => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
  // Vários arquivos num ÚNICO commit (evita várias publicações do GitHub Pages). conteudo null = apagar
  async function ghCommit(arquivos, mensagem) {
    const br = S.config.branch || 'main';
    for (let tentativa = 1; ; tentativa++) {
      const pai = (await gh('git/ref/heads/' + br)).object.sha, base = (await gh('git/commits/' + pai)).tree.sha, tree = [];
      for (const a of arquivos) {
        if (a.conteudo === null) { tree.push({ path: a.caminho, mode: '100644', type: 'blob', sha: null }); continue; }
        const blob = await gh('git/blobs', json({ content: C.b64(new TextEncoder().encode(a.conteudo)), encoding: 'base64' }));
        tree.push({ path: a.caminho, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const nova = await gh('git/trees', json({ base_tree: base, tree }));
      const cm = await gh('git/commits', json({ message: mensagem, tree: nova.sha, parents: [pai] }));
      try { await gh('git/refs/heads/' + br, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: cm.sha }) }); return cm.sha; }
      catch (e) { if (tentativa >= 4) throw e; await new Promise(r => setTimeout(r, 1200 * tentativa)); } // outro envio ao mesmo tempo: refaz
    }
  }
  const ghLer = caminho => gh('contents/' + caminho + '?ref=' + (S.config.branch || 'main'), { raw: true });
  const ghArvore = async () => (await gh('git/trees/' + (S.config.branch || 'main') + '?recursive=1')).tree || [];

  // ---------- fila offline (IndexedDB): apontamento feito sem sinal é enviado depois ----------
  const db = () => new Promise((ok, erro) => { const r = indexedDB.open('pend-aut', 1); r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error); });
  const filaOp = async (modo, fn) => { const d = await db(); return new Promise((ok, erro) => { const t = d.transaction('fila', modo), st = t.objectStore('fila'); const r = fn(st); t.oncomplete = () => ok(r && r.result); t.onerror = () => erro(t.error); }); };
  const filaPor = item => filaOp('readwrite', st => st.put(item));
  const filaTirar = id => filaOp('readwrite', st => st.delete(id));
  const filaTodos = () => filaOp('readonly', st => st.getAll());

  // Caminho do arquivo de um apontamento no repositório
  const caminhoAp = id => `apontamentos/${id.slice(0, 4)}-${id.slice(4, 6)}/${id}.enc`;
  // Envia um apontamento com as fotos (arquivos separados, tudo criptografado) num único commit
  async function enviarApontamento(ap) {
    const pasta = caminhoAp(ap.id).replace(/\/[^/]+$/, ''), meta = { ...ap, fotos: [] }, arquivos = [];
    for (let i = 0; i < (ap.fotos || []).length; i++) {
      const caminho = `${pasta}/${ap.id}-f${i + 1}.enc`;
      arquivos.push({ caminho, conteudo: await C.cifrar(S.chave, { img: ap.fotos[i] }) });
      meta.fotos.push(caminho);
    }
    arquivos.push({ caminho: caminhoAp(ap.id), conteudo: await C.cifrar(S.chave, meta) });
    await ghCommit(arquivos, `Apontamento frota ${ap.frota} – ${ap.nome}`);
    return meta;
  }
  // ---- administrador ----
  const limpo = a => { const x = { ...a }; delete x._sha; delete x.naFila; return x; };
  async function editarApontamento(ap, mudancas) {
    if (!S.admin) throw new Error('Só administradores podem editar.');
    const novo = { ...limpo(ap), ...mudancas, editadoPor: S.nome, editadoEm: new Date().toISOString() };
    await ghCommit([{ caminho: caminhoAp(ap.id), conteudo: await C.cifrar(S.chave, novo) }], `Edita apontamento frota ${ap.frota} – ${S.nome}`);
    return novo;
  }
  async function excluirApontamento(ap) {
    if (!S.admin) throw new Error('Só administradores podem excluir.');
    const arquivos = [caminhoAp(ap.id), ...(ap.fotos || [])].map(caminho => ({ caminho, conteudo: null }));
    await ghCommit(arquivos, `Exclui apontamento frota ${ap.frota} – ${S.nome}`);
  }
  // Reabrir: os registros "Resolvido" da pendência passam a "Reaberta" (o histórico fica)
  async function reabrirPendencia(aps) {
    if (!S.admin) throw new Error('Só administradores podem reabrir.');
    const agora = new Date().toISOString(), arquivos = [];
    for (const ap of aps.filter(a => a.situacao === 'Resolvido' && !a.naFila))
      arquivos.push({ caminho: caminhoAp(ap.id), conteudo: await C.cifrar(S.chave, { ...limpo(ap), situacao: 'Reaberta', reabertaPor: S.nome, reabertaEm: agora }) });
    if (!arquivos.length) throw new Error('Nada para reabrir.');
    await ghCommit(arquivos, `Reabre pendência frota ${aps[0].frota} – ${S.nome}`);
  }
  // Envia o que está guardado no aparelho (botão Sincronizar)
  async function enviarFila() {
    const itens = await filaTodos().catch(() => []); let n = 0, erro = null;
    for (const ap of itens) { try { await enviarApontamento(ap); await filaTirar(ap.id); n++; } catch (e) { erro = e; break; } }
    return { enviados: n, restantes: itens.length - n, erro };
  }
  const filaQtd = async () => (await filaTodos().catch(() => [])).length;
  // Salva o apontamento no aparelho; se houver internet, já tenta enviar
  async function salvarApontamento(ap) {
    await filaPor(ap);
    if (!navigator.onLine) return { enviado: false };
    try { await enviarApontamento(ap); await filaTirar(ap.id); return { enviado: true }; }
    catch (e) { return { enviado: false, erro: e }; }
  }
  // Barra de sincronização (mostra quantos estão no aparelho e se está offline)
  async function atualizarBotaoSinc(...btns) {
    const n = await filaQtd();
    for (const btn of btns) { if (!btn) continue;
      btn.innerHTML = n ? `Sincronizar <span class="contador">${n}</span>` : 'Sincronizar';
      btn.classList.toggle('alerta', n > 0);
      btn.title = n ? `${n} apontamento(s) salvos no aparelho, ainda não enviados` : 'Envia os apontamentos salvos no aparelho e baixa as pendências novas'; }
  }
  async function sincronizar() {
    if (!navigator.onLine) throw new Error('Sem internet. Os apontamentos continuam salvos no aparelho.');
    const r = await enviarFila();
    if (r.erro) throw new Error(`${r.enviados} enviado(s); ${r.restantes} continuam no aparelho (${r.erro.message})`);
    return r;
  }
  // site funciona offline (service worker)
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => console.warn('sw', e));

  // Apontamentos: índice consolidado pelo PC, acertado com o repositório (novos, editados e excluídos)
  async function carregarApontamentos() {
    let indice = [];
    try { indice = (await lerCifrado('dados/apontamentos.enc')).apontamentos || []; } catch (e) { /* ainda não existe */ }
    let lista = indice;
    try {
      const metas = (await ghArvore()).filter(t => t.type === 'blob' && /^apontamentos\/.+\.enc$/.test(t.path) && !/-f\d+\.enc$/.test(t.path));
      const porId = new Map(indice.map(a => [a.id, a])); lista = [];
      for (const t of metas) {
        const id = t.path.split('/').pop().replace('.enc', ''), v = porId.get(id);
        if (v && v._sha === t.sha) { lista.push(v); continue; }
        try { const a = await C.decifrar(S.chave, await ghLer(t.path)); a._sha = t.sha; lista.push(a); } catch (e) { console.warn('apontamento', t.path, e); }
      }
    } catch (e) { console.warn('sem acesso à API do GitHub, mostrando só o índice', e); }
    const ids = new Set(lista.map(a => a.id));
    for (const ap of await filaTodos().catch(() => [])) if (!ids.has(ap.id)) lista.push({ ...ap, naFila: true, fotos: [] });
    return lista.sort((a, b) => String(b.fim || b.criadoEm).localeCompare(String(a.fim || a.criadoEm)));
  }
  const carregarFoto = async caminho => (await C.decifrar(S.chave, await ghLer(caminho))).img;
  const resetCopia = () => { usandoCopia = false; };

  // Foto do celular → JPEG reduzido (máx. 1024 px, ~80–150 KB)
  function reduzirFoto(arquivo, max = 1024, qualidade = 0.55) {
    return new Promise((ok, erro) => {
      const img = new Image(), url = URL.createObjectURL(arquivo);
      img.onload = () => {
        const e = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * e); c.height = Math.round(img.height * e);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', qualidade));
      };
      img.onerror = () => erro(new Error('Imagem inválida')); img.src = url;
    });
  }

  // ---------- janelas de administrador (confirmar / editar) ----------
  function caixa(html) {
    const f = document.createElement('div'); f.className = 'fundo-janela'; f.style.zIndex = 2500;
    f.innerHTML = `<div class="janela" role="dialog" aria-modal="true">${html}</div>`; document.body.appendChild(f); return f;
  }
  const confirmar = (titulo, texto, rotulo) => new Promise(ok => {
    const f = caixa(`<header><div><h2>${esc(titulo)}</h2><p>${esc(texto)}</p></div></header><div class="corpo"><div class="botoes">
      <button class="btn perigo" data-r="1">${esc(rotulo)}</button><button class="btn" data-r="0">Cancelar</button></div></div>`);
    f.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { f.remove(); ok(b.dataset.r === '1'); }); f.querySelector('[data-r="0"]').focus();
  });
  const paraLocalDT = d => { d = new Date(d); return isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  const SITUACOES = ['Resolvido', 'Não resolvido – precisa retorno', 'Aguardando peça', 'Reaberta'];
  // Formulário de edição (admin). Resolve com as mudanças ou null.
  const formEditar = ap => new Promise(ok => {
    const f = caixa(`<header><div><h2>Editar registro – frota ${esc(ap.frota)}</h2><p>Registrado por ${esc(ap.nome)}</p></div></header><div class="corpo"><form class="ap">
      <div class="dupla"><div><label>Início</label><input type="datetime-local" name="inicio" required value="${paraLocalDT(ap.inicio)}"></div>
      <div><label>Fim</label><input type="datetime-local" name="fim" required value="${paraLocalDT(ap.fim)}"></div></div>
      <label>Situação</label><select name="situacao">${SITUACOES.map(s => `<option ${s === ap.situacao ? 'selected' : ''}>${s}</option>`).join('')}</select>
      <label>O que foi feito</label><textarea name="obs" required>${esc(ap.observacao)}</textarea>
      <div class="botoes"><button class="btn primario" type="submit">Salvar alterações</button><button class="btn" type="button" data-c>Cancelar</button></div></form></div>`);
    const fm = f.querySelector('form');
    fm.querySelector('[data-c]').onclick = () => { f.remove(); ok(null); };
    fm.onsubmit = e => { e.preventDefault(); const ini = new Date(fm.inicio.value), fim = new Date(fm.fim.value);
      if (fim < ini) return aviso('O fim está antes do início. Corrija os horários.', 'erro');
      f.remove(); ok({ inicio: ini.toISOString(), fim: fim.toISOString(), duracaoMin: Math.round((fim - ini) / 60000), situacao: fm.situacao.value, observacao: fm.obs.value.trim() }); };
  });
  // Ações de admin num registro: devolve true se algo mudou
  async function acaoAdmin(tipo, ap) {
    if (!navigator.onLine) { aviso('Editar e excluir precisam de internet.', 'erro'); return false; }
    try {
      if (tipo === 'editar') { const m = await formEditar(ap); if (!m) return false; await editarApontamento(ap, m); aviso('Registro atualizado.'); }
      if (tipo === 'excluir') { if (!await confirmar('Excluir este registro?', `Frota ${ap.frota}, feito por ${ap.nome}. As fotos também serão apagadas. Se era o único registro resolvido, a pendência volta a ficar em aberto.`, 'Excluir registro')) return false;
        await excluirApontamento(ap); aviso('Registro excluído.'); }
      return true;
    } catch (e) { aviso(e.message, 'erro', 6000); return false; }
  }

  // Botão redondo do usuário (iniciais) com menu: nome, Mapa, Registros, Sair
  function menuUsuario(btn) {
    const ini = String(S.nome || S.usuario).split(/\s+/).map(p => p[0]).join('').slice(0, 2).toUpperCase();
    btn.textContent = ini; btn.title = S.nome;
    btn.onclick = e => {
      e.stopPropagation();
      let m = $('.menu'); if (m) { m.remove(); return; }
      m = document.createElement('div'); m.className = 'menu'; m.setAttribute('role', 'menu');
      m.innerHTML = `<p><b>${esc(S.nome)}</b>${S.admin ? 'Administrador' : 'Técnico'}</p>
        <a href="index.html" role="menuitem">Mapa das pendências</a><a href="apontamentos.html" role="menuitem">Registros de serviço</a>
        <button type="button" role="menuitem" data-sair>Sair</button>`;
      document.body.appendChild(m); m.querySelector('[data-sair]').onclick = () => sair();
      setTimeout(() => document.addEventListener('click', function fora(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', fora); } }), 0);
    };
  }

  window.Painel = { menuUsuario, $, esc, p2, fmtDataHora, km, aviso, idPendencia, exigirLogin, sair, sessao: () => S, editarApontamento, excluirApontamento, reabrirPendencia, confirmar, acaoAdmin, lerCifrado, offline: () => usandoCopia || !navigator.onLine,
    enviarApontamento, enviarFila, filaPor, filaTodos, filaQtd, salvarApontamento, resetCopia, sincronizar, atualizarBotaoSinc, carregarApontamentos, carregarFoto, reduzirFoto };
})();
