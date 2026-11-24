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
    const guardar = { chaveB64: s.chaveB64, usuario: s.usuario, nome: s.nome };
    (manter ? localStorage : sessionStorage).setItem(SESSAO, JSON.stringify(guardar));
    return iniciarSessao(guardar);
  }
  async function iniciarSessao(g) {
    S = { chave: await C.chaveDeB64(g.chaveB64), usuario: g.usuario, nome: g.nome };
    try { S.config = await lerCifrado('dados/config.enc'); } catch (e) { S.config = null; }
    return S;
  }
  async function sessaoSalva() {
    const t = localStorage.getItem(SESSAO) || sessionStorage.getItem(SESSAO);
    if (!t) return null;
    try { return await iniciarSessao(JSON.parse(t)); } catch (e) { sair(false); return null; }
  }
  function sair(recarregar = true) { localStorage.removeItem(SESSAO); sessionStorage.removeItem(SESSAO); if (recarregar) location.reload(); }

  // Tela de login (usada nas duas páginas). Resolve quando entrar.
  function telaLogin() {
    return new Promise(ok => {
      const box = document.createElement('div');
      box.id = 'login';
      box.innerHTML = `<div class="lado"><img src="img/logo.png" alt="Bioenergética Aroeira"><p>Pendências da automação: onde estão os equipamentos e o registro de cada serviço feito em campo.</p></div>
        <form>
        <h1>Entrar</h1>
        <p class="sub">Use o usuário e a senha que você recebeu do COA.</p>
        <label>Usuário<input name="u" autocomplete="username" autocapitalize="none" required></label>
        <label>Senha<input name="s" type="password" autocomplete="current-password" required></label>
        <label class="linha"><input type="checkbox" name="m" checked> Manter conectado neste aparelho</label>
        <button class="btn primario" type="submit">Entrar</button>
        <p class="erro" hidden></p></form>`;
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
  const ghGravar = (caminho, texto, mensagem) => gh('contents/' + caminho, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: mensagem, content: C.b64(new TextEncoder().encode(texto)), branch: S.config.branch || 'main' }),
  });
  const ghLer = caminho => gh('contents/' + caminho + '?ref=' + (S.config.branch || 'main'), { raw: true });
  const ghArvore = async () => (await gh('git/trees/' + (S.config.branch || 'main') + '?recursive=1')).tree || [];

  // ---------- fila offline (IndexedDB): apontamento feito sem sinal é enviado depois ----------
  const db = () => new Promise((ok, erro) => { const r = indexedDB.open('pend-aut', 1); r.onupgradeneeded = () => r.result.createObjectStore('fila', { keyPath: 'id' }); r.onsuccess = () => ok(r.result); r.onerror = () => erro(r.error); });
  const filaOp = async (modo, fn) => { const d = await db(); return new Promise((ok, erro) => { const t = d.transaction('fila', modo), st = t.objectStore('fila'); const r = fn(st); t.oncomplete = () => ok(r && r.result); t.onerror = () => erro(t.error); }); };
  const filaPor = item => filaOp('readwrite', st => st.put(item));
  const filaTirar = id => filaOp('readwrite', st => st.delete(id));
  const filaTodos = () => filaOp('readonly', st => st.getAll());

  // Envia um apontamento (fotos em arquivos separados, tudo criptografado)
  async function enviarApontamento(ap) {
    const pasta = `apontamentos/${ap.id.slice(0, 4)}-${ap.id.slice(4, 6)}`;
    const meta = { ...ap, fotos: [] };
    for (let i = 0; i < (ap.fotos || []).length; i++) {
      const caminho = `${pasta}/${ap.id}-f${i + 1}.enc`;
      await ghGravar(caminho, await C.cifrar(S.chave, { img: ap.fotos[i] }), `Foto ${i + 1} do apontamento ${ap.frota}`);
      meta.fotos.push(caminho);
    }
    await ghGravar(`${pasta}/${ap.id}.enc`, await C.cifrar(S.chave, meta), `Apontamento frota ${ap.frota} – ${ap.nome}`);
    return meta;
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

  // Apontamentos: índice consolidado pelo PC + os novos que ainda não entraram no índice
  async function carregarApontamentos() {
    let indice = [];
    try { indice = (await lerCifrado('dados/apontamentos.enc')).apontamentos || []; } catch (e) { /* ainda não existe */ }
    const conhecidos = new Set(indice.map(a => a.id));
    try {
      const novos = (await ghArvore()).filter(t => t.type === 'blob' && /^apontamentos\/.+\.enc$/.test(t.path) && !/-f\d+\.enc$/.test(t.path))
        .filter(t => !conhecidos.has(t.path.split('/').pop().replace('.enc', '')));
      for (const t of novos) { try { indice.push(await C.decifrar(S.chave, await ghLer(t.path))); } catch (e) { console.warn('apontamento', t.path, e); } }
    } catch (e) { console.warn('sem acesso à API do GitHub, mostrando só o índice', e); }
    const ids = new Set(indice.map(a => a.id));
    for (const ap of await filaTodos().catch(() => [])) if (!ids.has(ap.id)) indice.push({ ...ap, naFila: true, fotos: [] });
    return indice.sort((a, b) => String(b.fim || b.criadoEm).localeCompare(String(a.fim || a.criadoEm)));
  }
  const carregarFoto = async caminho => (await C.decifrar(S.chave, await ghLer(caminho))).img;
  const resetCopia = () => { usandoCopia = false; };

  // Foto do celular → JPEG reduzido (máx. 1280 px, ~150–250 KB)
  function reduzirFoto(arquivo, max = 1280, qualidade = 0.6) {
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

  window.Painel = { $, esc, p2, fmtDataHora, km, aviso, idPendencia, exigirLogin, sair, sessao: () => S, lerCifrado, offline: () => usandoCopia || !navigator.onLine,
    enviarApontamento, enviarFila, filaPor, filaTodos, filaQtd, salvarApontamento, resetCopia, sincronizar, atualizarBotaoSinc, carregarApontamentos, carregarFoto, reduzirFoto };
})();
