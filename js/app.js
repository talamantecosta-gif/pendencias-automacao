/* Painel de Pendências – mapa, lista, detalhe, apontamento e rota */
(async function () {
  'use strict';
  const P = window.Painel, { $, esc, fmtDataHora, km, aviso } = P;
  const USINA_PADRAO = [-18.7520, -48.6125];
  const DIAS_ANTIGA = 7;

  const S = await P.exigirLogin();
  $('#nomeUsuario').textContent = S.nome;
  $('#btnSair').onclick = () => P.sair();
  const btnSinc = $('#btnAtualizar');
  btnSinc.onclick = async () => {
    btnSinc.disabled = true; btnSinc.textContent = 'Sincronizando…';
    try { const r = await P.sincronizar(); await carregar(); aviso(r.enviados ? `${r.enviados} apontamento(s) enviados e dados atualizados.` : 'Dados atualizados.'); }
    catch (e) { aviso(e.message, 'erro', 6000); }
    btnSinc.disabled = false; P.atualizarBotaoSinc(btnSinc);
  };
  window.addEventListener('online', () => { P.atualizarBotaoSinc(btnSinc); aviso('Internet de volta. Toque em Sincronizar para enviar e atualizar.'); });
  window.addEventListener('offline', () => { $('#info').textContent = 'Sem internet – trabalhando com os dados salvos no aparelho'; });

  // ---------- mapa ----------
  const mapa = L.map('mapa', { preferCanvas: true, zoomControl: true }).setView(USINA_PADRAO, 11);
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagens © Esri' });
  const ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  satelite.addTo(mapa);
  const camTalhoes = L.layerGroup().addTo(mapa), camPinos = L.layerGroup().addTo(mapa), camRota = L.layerGroup().addTo(mapa);
  L.control.layers({ 'Satélite': satelite, 'Mapa': ruas }, { 'Talhões': camTalhoes, 'Pendências': camPinos, 'Rota': camRota }, { position: 'topright' }).addTo(mapa);

  let D = { pendencias: [] }, APS = [], usina = USINA_PADRAO, selecionada = null;
  const pinos = new Map();

  // ---------- dados ----------
  async function carregar() {
    $('#info').textContent = 'Carregando…'; P.resetCopia();
    try {
      D = await P.lerCifrado('dados/pendencias.enc');
      usina = D.usina || USINA_PADRAO;
    } catch (e) { aviso('Não foi possível abrir as pendências: ' + e.message, 'erro', 6000); D = { pendencias: [] }; }
    APS = await P.carregarApontamentos().catch(() => []);
    const base = D.geradoEm ? `Atualizado em ${fmtDataHora(D.geradoEm)}${D.turno ? ' · Turno ' + D.turno : ''}` : 'Sem dados publicados ainda';
    $('#info').textContent = P.offline() ? 'Offline · ' + base + ' (dados salvos no aparelho)' : base;
    P.atualizarBotaoSinc(btnSinc);
    desenhar();
  }
  // situação da pendência a partir dos apontamentos
  const apsDe = p => APS.filter(a => a.pid === P.idPendencia(p));
  const situacao = p => { const a = apsDe(p); if (!a.length) return null; return a.some(x => x.situacao === 'Resolvido') ? 'Resolvido' : a[0].situacao; };
  const diasAberta = p => { const m = String(p.dataAbertura || '').match(/(\d+)\/(\d+)\/(\d+)/); return m ? Math.floor((Date.now() - new Date(+m[3], m[2] - 1, +m[1])) / 86400000) : null; };
  const temPos = p => isFinite(p.lat) && isFinite(p.lon) && p.lat && p.lon;
  const texto = p => [p.frota, p.equipamento, p.ocorrencia, p.frente, p.fazenda, p.talhao, p.fazProx && p.fazProx.faz].join(' ').toLowerCase();

  function visiveis() {
    const q = $('#busca').value.trim().toLowerCase(), todas = $('#mostrarAtendidas').checked;
    return D.pendencias.filter(p => (todas || situacao(p) !== 'Resolvido') && (!q || texto(p).includes(q)));
  }

  function desenhar() {
    const lista = visiveis(), atendidas = D.pendencias.filter(p => situacao(p) === 'Resolvido').length;
    $('#contagem').textContent = `${D.pendencias.length - atendidas} em aberto · ${atendidas} atendida(s)`;
    $('#itens').innerHTML = lista.map((p, i) => {
      const sit = situacao(p), d = diasAberta(p), cls = sit === 'Resolvido' ? 'atendida' : d >= DIAS_ANTIGA ? 'antiga' : '';
      const etq = sit === 'Resolvido' ? '<span class="etq verde">Atendida</span>' : sit ? `<span class="etq">${esc(sit)}</span>` : d >= DIAS_ANTIGA ? `<span class="etq vermelha">${d} dias</span>` : `<span class="etq cinza">${d ?? '-'} dia(s)</span>`;
      return `<div class="item ${cls}" data-i="${D.pendencias.indexOf(p)}">
        <div class="t"><span>Frota ${esc(p.frota)} · ${esc(p.equipamento || '-')}</span>${etq}</div>
        <div class="o">${esc(p.ocorrencia || '-')}</div>
        <div class="m">${esc(p.frente || '-')}${p.fazenda ? ` · Faz ${esc(p.fazenda)} T${esc(p.talhao || '-')}` : ''}${temPos(p) ? '' : ' · sem posição'}</div></div>`;
    }).join('') || '<p class="vazio">Nenhuma pendência para mostrar.</p>';
    document.querySelectorAll('.item').forEach(el => el.onclick = () => abrirDetalhe(D.pendencias[+el.dataset.i]));

    camPinos.clearLayers(); pinos.clear();
    const limites = [];
    for (const p of lista) {
      if (!temPos(p)) continue;
      const sit = situacao(p), d = diasAberta(p), cls = sit === 'Resolvido' ? 'atendida' : d >= DIAS_ANTIGA ? 'antiga' : '';
      const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<span class="pino ${cls}">${esc(p.frota)}</span>`, iconSize: null }) })
        .on('click', () => abrirDetalhe(p)).addTo(camPinos);
      pinos.set(p, m); limites.push([p.lat, p.lon]);
    }
    if (limites.length && !desenhar.ja) { mapa.fitBounds(limites, { padding: [40, 40], maxZoom: 13 }); desenhar.ja = true; }
  }
  $('#busca').oninput = desenhar;
  $('#mostrarAtendidas').onchange = desenhar;

  // ---------- talhões (shape) ----------
  async function carregarTalhoes() {
    try {
      const T = await P.lerCifrado('dados/talhoes.enc');
      const estilo = { color: '#ffe066', weight: 1, opacity: .8, fillOpacity: .04 };
      for (const t of T) {
        const aneis = t.a.map(r => { const c = []; for (let i = 0; i < r.length; i += 2) c.push([r[i], r[i + 1]]); return c; });
        L.polygon(aneis, estilo).bindTooltip(`${esc(t.n)} (${t.f}) · Talhão ${t.t}`, { className: 'talhao', sticky: true }).addTo(camTalhoes);
      }
    } catch (e) { console.warn('talhões', e); }
  }

  // ---------- janelas ----------
  function janela(titulo, html) {
    const f = document.createElement('div'); f.className = 'fundo-janela';
    f.innerHTML = `<div class="janela" role="dialog"><header><h2>${titulo}</h2><button class="fechar" aria-label="Fechar">×</button></header><div class="corpo">${html}</div></div>`;
    const fechar = () => f.remove();
    f.onclick = e => { if (e.target === f) fechar(); }; $('.fechar', f).onclick = fechar;
    document.body.appendChild(f); return { el: f, fechar };
  }
  const linhaFazenda = p => p.fazenda ? `${esc(p.fazenda)}${p.zona ? ` (zona ${esc(p.zona)})` : ''} · Talhão ${esc(p.talhao || '-')}`
    : p.fazProx ? `Fora de fazenda · mais próxima: ${esc(p.fazProx.faz)}${p.fazProx.talhao ? ', T' + esc(p.fazProx.talhao) : ''} (${p.fazProx.d < 1 ? Math.round(p.fazProx.d * 1000) + ' m' : p.fazProx.d.toFixed(1).replace('.', ',') + ' km'})` : (temPos(p) ? 'Fora de fazenda' : '-');

  function abrirDetalhe(p) {
    selecionada = p;
    document.querySelectorAll('.item').forEach(el => el.classList.toggle('ativo', D.pendencias[+el.dataset.i] === p));
    if (temPos(p)) mapa.setView([p.lat, p.lon], Math.max(mapa.getZoom(), 14));
    const d = diasAberta(p), hist = apsDe(p);
    const j = janela(`Frota ${esc(p.frota)}`, `
      <dl class="ficha">
        <dt>Equipamento</dt><dd>${esc(p.equipamento || '-')}</dd>
        <dt>Ocorrência</dt><dd>${esc(p.ocorrencia || '-')}</dd>
        <dt>Abertura</dt><dd>${esc(p.dataAbertura || '-')}${d != null ? ` (${d <= 0 ? 'hoje' : d + ' dia(s)'})` : ''}</dd>
        <dt>Frente</dt><dd>${esc(p.frente || '-')}</dd>
        <dt>Fazenda</dt><dd>${linhaFazenda(p)}</dd>
        <dt>Última posição</dt><dd>${esc(p.ultimaPosicao || (temPos(p) ? '-' : 'Sem posição no SGPA'))}</dd>
        ${p.localidade ? `<dt>Local informado</dt><dd>${esc(p.localidade)}</dd>` : ''}
      </dl>
      ${hist.length ? `<div class="separador"></div><b>Apontamentos</b>${hist.map(a => `<p class="m">${fmtDataHora(a.inicio)} → ${fmtDataHora(a.fim)} · <b>${esc(a.situacao)}</b> · ${esc(a.nome)}<br>${esc(a.observacao)}${a.naFila ? ' <span class="etq">aguardando envio</span>' : ''}</p>`).join('')}` : ''}
      <div class="botoes">
        <button class="btn primario" data-a="apontar">Fazer apontamento</button>
        ${temPos(p) ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}">Navegar até aqui</a>` : ''}
      </div>`);
    $('[data-a=apontar]', j.el).onclick = () => { j.fechar(); abrirApontamento(p); };
  }

  // ---------- apontamento ----------
  const paraLocal = d => { const z = new Date(d - new Date().getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
  function abrirApontamento(p) {
    const agora = new Date(), fotos = [];
    const j = janela(`Apontamento · Frota ${esc(p.frota)}`, `
      <form class="ap">
        <p class="m">${esc(p.equipamento || '')} · ${esc(p.ocorrencia || '')}</p>
        <div class="dupla">
          <div><label>Início do serviço</label><input type="datetime-local" name="inicio" required value="${paraLocal(agora - 3600000)}"></div>
          <div><label>Fim do serviço</label><input type="datetime-local" name="fim" required value="${paraLocal(agora)}"></div>
        </div>
        <label>Situação</label>
        <select name="situacao"><option>Resolvido</option><option>Não resolvido – precisa retorno</option><option>Aguardando peça</option></select>
        <label>Serviço realizado (observação)</label>
        <textarea name="obs" required placeholder="Descreva o que foi feito…"></textarea>
        <label>Fotos (opcional, até 4)</label>
        <input type="file" name="fotos" accept="image/*" multiple>
        <div class="miniaturas"></div>
        <label>Realizado por</label>
        <input value="${esc(S.nome)}" disabled>
        <div class="botoes"><button class="btn primario" type="submit">Registrar apontamento</button><button class="btn" type="button" data-a="cancelar">Cancelar</button></div>
      </form>`);
    const f = $('form', j.el), mini = $('.miniaturas', f);
    $('[data-a=cancelar]', f).onclick = j.fechar;
    const desenharMini = () => { mini.innerHTML = fotos.map((u, i) => `<div><img src="${u}"><button type="button" data-i="${i}">×</button></div>`).join('');
      mini.querySelectorAll('button').forEach(b => b.onclick = () => { fotos.splice(+b.dataset.i, 1); desenharMini(); }); };
    f.fotos.onchange = async () => {
      for (const arq of f.fotos.files) { if (fotos.length >= 4) break; try { fotos.push(await P.reduzirFoto(arq)); } catch (e) { aviso(e.message, 'erro'); } }
      f.fotos.value = ''; desenharMini();
    };
    f.onsubmit = async ev => {
      ev.preventDefault();
      const ini = new Date(f.inicio.value), fim = new Date(f.fim.value);
      if (fim < ini) return aviso('O fim do serviço não pode ser antes do início.', 'erro');
      const b = $('button[type=submit]', f); b.disabled = true; b.textContent = 'Enviando…';
      const ts = new Date(), id = `${ts.getFullYear()}${P.p2(ts.getMonth() + 1)}${P.p2(ts.getDate())}-${P.p2(ts.getHours())}${P.p2(ts.getMinutes())}${P.p2(ts.getSeconds())}-${String(p.frota).replace(/\W/g, '')}-${S.usuario.replace(/\W/g, '')}`;
      const ap = { id, pid: P.idPendencia(p), frota: p.frota, equipamento: p.equipamento, ocorrencia: p.ocorrencia, dataAbertura: p.dataAbertura,
        frente: p.frente, fazenda: p.fazenda || '', talhao: p.talhao || '', lat: p.lat || null, lon: p.lon || null,
        inicio: ini.toISOString(), fim: fim.toISOString(), duracaoMin: Math.round((fim - ini) / 60000), situacao: f.situacao.value,
        observacao: f.obs.value.trim(), usuario: S.usuario, nome: S.nome, criadoEm: ts.toISOString(), fotos };
      const r = await P.salvarApontamento(ap);
      aviso(r.enviado ? 'Apontamento registrado e enviado.' : 'Apontamento salvo no aparelho. Com internet, toque em Sincronizar para enviar.', r.enviado ? 'ok' : 'erro', 6000);
      j.fechar(); APS = await P.carregarApontamentos().catch(() => APS); P.atualizarBotaoSinc(btnSinc); desenhar();
    };
  }

  // ---------- rota ----------
  const posicaoAtual = () => new Promise(ok => {
    if (!navigator.geolocation) return ok(null);
    navigator.geolocation.getCurrentPosition(g => ok([g.coords.latitude, g.coords.longitude]), () => ok(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
  // ordem que menos roda saindo do ponto 0 (sem voltar): exata até 12 paradas, senão vizinho mais próximo + 2-opt
  function melhorOrdem(pts) {
    const n = pts.length - 1; if (n <= 0) return [];
    const D = pts.map(a => pts.map(b => km(a, b)));
    const custo = o => { let d = 0, a = 0; for (const i of o) { d += D[a][i + 1]; a = i + 1; } return d; };
    if (n <= 12) {
      const N = 1 << n, dp = Array.from({ length: N }, () => new Float64Array(n).fill(Infinity)), pai = Array.from({ length: N }, () => new Int8Array(n).fill(-1));
      for (let j = 0; j < n; j++) dp[1 << j][j] = D[0][j + 1];
      for (let m = 1; m < N; m++) for (let j = 0; j < n; j++) { if (!(m & (1 << j)) || dp[m][j] === Infinity) continue;
        for (let k = 0; k < n; k++) { if (m & (1 << k)) continue; const nm = m | (1 << k), v = dp[m][j] + D[j + 1][k + 1]; if (v < dp[nm][k]) { dp[nm][k] = v; pai[nm][k] = j; } } }
      let fim = 0; for (let j = 1; j < n; j++) if (dp[N - 1][j] < dp[N - 1][fim]) fim = j;
      const o = []; for (let m = N - 1, j = fim; j >= 0;) { o.unshift(j); const pj = pai[m][j]; m ^= (1 << j); j = pj; } return o;
    }
    let o = [], resto = new Set([...Array(n).keys()]), a = 0;
    while (resto.size) { let b = -1; for (const i of resto) if (b < 0 || D[a][i + 1] < D[a][b + 1]) b = i; o.push(b); resto.delete(b); a = b + 1; }
    for (let mudou = true; mudou;) { mudou = false;
      for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) { const t = [...o.slice(0, i), ...o.slice(i, j + 1).reverse(), ...o.slice(j + 1)]; if (custo(t) + 1e-9 < custo(o)) { o = t; mudou = true; } } }
    return o;
  }

  $('#btnRota').onclick = async () => {
    const b = $('#btnRota'); b.disabled = true; b.textContent = 'Calculando…';
    const alvo = visiveis().filter(p => temPos(p) && situacao(p) !== 'Resolvido');
    if (!alvo.length) { b.disabled = false; b.textContent = 'Traçar rota'; return aviso('Nenhuma pendência em aberto com posição.', 'erro'); }
    const gps = await posicaoAtual(), inicio = gps || usina;
    // frotas a menos de 2 km viram a mesma parada
    const paradas = [];
    for (const p of alvo) { const g = paradas.find(g => km(g.c, [p.lat, p.lon]) <= 2); if (g) g.itens.push(p); else paradas.push({ c: [p.lat, p.lon], itens: [p] }); }
    const ordem = melhorOrdem([inicio, ...paradas.map(g => g.c)]), rota = ordem.map(i => paradas[i]);
    camRota.clearLayers();
    const linha = [inicio, ...rota.map(g => g.c)];
    L.polyline(linha, { color: '#1b4fa0', weight: 4, opacity: .85, dashArray: '8 8' }).addTo(camRota);
    L.circleMarker(inicio, { radius: 8, color: '#fff', weight: 2, fillColor: '#1b4fa0', fillOpacity: 1 }).bindTooltip(gps ? 'Você está aqui' : 'Usina').addTo(camRota);
    rota.forEach((g, i) => L.marker(g.c, { icon: L.divIcon({ className: '', html: `<span class="pino ordem">${i + 1}</span>`, iconSize: null }), zIndexOffset: 1000 }).addTo(camRota));
    mapa.fitBounds(linha, { padding: [40, 40] });
    let total = 0, ant = inicio;
    const itens = rota.map((g, i) => { const t = km(ant, g.c) * 1.2; total += t; ant = g.c;
      return `<li><b>${esc(g.itens[0].frente || '-')}</b> – frota${g.itens.length > 1 ? 's' : ''} ${g.itens.map(p => esc(p.frota)).join(', ')} <span class="m">(${Math.round(t)} km)</span></li>`; }).join('');
    const pts = linha.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`), links = [];
    for (let i = 0; i < pts.length - 1; i += 9) links.push('https://www.google.com/maps/dir/' + pts.slice(i, i + 10).join('/'));
    janela('Rota sugerida', `<div class="rota">
      <p class="m">Saída: ${gps ? 'sua localização atual' : 'usina (localização do aparelho indisponível)'} · ordem com o menor deslocamento total.</p>
      <ol>${itens}</ol>
      <p class="total">Distância estimada: ${Math.round(total)} km</p>
      <p class="m">Ao chegar em cada frente, aproveite para verificar também os demais equipamentos que estiverem no local.</p>
      <div class="botoes">${links.map((l, i) => `<a class="btn primario" target="_blank" rel="noopener" href="${l}">Abrir no Google Maps${links.length > 1 ? ' (parte ' + (i + 1) + ')' : ''}</a>`).join('')}</div>
    </div>`);
    b.disabled = false; b.textContent = 'Traçar rota';
  };

  await carregar();
  carregarTalhoes();
})();
