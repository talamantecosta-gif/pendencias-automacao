/* Painel de Pendências – mapa, lista, detalhe, apontamento e rota */
(async function () {
  'use strict';
  const P = window.Painel, { $, esc, fmtDataHora, km, aviso } = P;
  const USINA_PADRAO = [-18.7520, -48.6125];
  const DIAS_ANTIGA = 7;

  const S = await P.exigirLogin();
  P.menuUsuario($('#btnUsuario'));
  const ICONE_ROTA = $('#btnRota').innerHTML;
  // gaveta da lista no celular: toque na alça alterna média → aberta → recolhida
  const painel = $('#painel');
  $('#alca').onclick = () => { if (painel.classList.contains('aberto')) { painel.classList.remove('aberto'); painel.classList.add('fechado'); }
    else if (painel.classList.contains('fechado')) painel.classList.remove('fechado'); else painel.classList.add('aberto'); setTimeout(() => mapa.invalidateSize(), 300); };

  // ---------- sincronizar (PC e celular) ----------
  const botoesSinc = [$('#btnAtualizar')];
  const marcarSinc = () => P.atualizarBotaoSinc(...botoesSinc);
  async function sincronizar() {
    botoesSinc.forEach(b => { b.disabled = true; b.textContent = 'Sincronizando…'; });
    try { const r = await P.sincronizar(); await carregar(); aviso(r.enviados ? `${r.enviados} apontamento(s) enviados. Pendências atualizadas.` : 'Pendências atualizadas.'); }
    catch (e) { aviso(e.message, 'erro', 6000); }
    botoesSinc.forEach(b => b.disabled = false); marcarSinc();
  }
  botoesSinc.forEach(b => b.onclick = sincronizar);
  window.addEventListener('online', () => { marcarSinc(); aviso('Internet de volta. Toque em Sincronizar para enviar e atualizar.'); });
  window.addEventListener('offline', () => mostrarInfo());

  // ---------- mapa ----------
  const mapa = L.map('mapa', { preferCanvas: true, zoomControl: false }).setView(USINA_PADRAO, 11);
  L.control.zoom({ position: 'bottomright' }).addTo(mapa);
  const satelite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagens © Esri' });
  const ruas = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' });
  satelite.addTo(mapa);
  const camTalhoes = L.layerGroup().addTo(mapa), camPinos = L.layerGroup().addTo(mapa), camRota = L.layerGroup().addTo(mapa);
  L.control.layers({ 'Satélite': satelite, 'Mapa': ruas }, { 'Talhões': camTalhoes, 'Pendências': camPinos, 'Rota': camRota }, { position: 'bottomright' }).addTo(mapa);

  let D = { pendencias: [] }, APS = [], usina = USINA_PADRAO, selecionada = null, filtro = 'abertas';

  // ---------- dados ----------
  function mostrarInfo() {
    const quando = D.geradoEm ? `${fmtDataHora(D.geradoEm)}${D.turno ? ', turno ' + D.turno : ''}` : '';
    const off = P.offline();
    $('#info').textContent = !quando ? 'Nenhuma pendência publicada ainda' : off ? `Sem internet – dados de ${quando}` : `Atualizado em ${quando}`;
    $('#info').classList.toggle('offline', off);
    $('#subLista').textContent = $('#info').textContent;
  }
  async function carregar() {
    $('#info').textContent = 'Carregando…'; P.resetCopia();
    try { D = await P.lerCifrado('dados/pendencias.enc'); usina = D.usina || USINA_PADRAO; }
    catch (e) { aviso('Não foi possível abrir as pendências: ' + e.message, 'erro', 6000); D = { pendencias: [] }; }
    APS = await P.carregarApontamentos().catch(() => []);
    mostrarInfo(); marcarSinc(); desenhar();
  }
  const apsDe = p => APS.filter(a => a.pid === P.idPendencia(p));
  const situacao = p => { const a = apsDe(p); if (!a.length) return null; return a.some(x => x.situacao === 'Resolvido') ? 'Resolvido' : a[0].situacao; };
  const diasAberta = p => { const m = String(p.dataAbertura || '').match(/(\d+)\/(\d+)\/(\d+)/); return m ? Math.floor((Date.now() - new Date(+m[3], m[2] - 1, +m[1])) / 86400000) : null; };
  const temPos = p => isFinite(p.lat) && isFinite(p.lon) && p.lat && p.lon;
  const texto = p => [p.frota, p.equipamento, p.ocorrencia, p.frente, p.fazenda, p.talhao, p.fazProx && p.fazProx.faz].join(' ').toLowerCase();
  const classe = p => situacao(p) === 'Resolvido' ? 'atendida' : diasAberta(p) >= DIAS_ANTIGA ? 'antiga' : '';
  const rotuloDias = p => { const d = diasAberta(p); return situacao(p) === 'Resolvido' ? 'Atendida' : d == null ? '–' : d <= 0 ? 'Hoje' : d === 1 ? '1 dia' : d + ' dias'; };
  const etiqueta = p => `<span class="etiqueta ${classe(p)}">${situacao(p) === 'Resolvido' ? 'Atendida' : diasAberta(p) <= 0 ? 'Aberta hoje' : rotuloDias(p) + ' em aberto'}</span>`;
  const fazendaCurta = p => p.fazenda ? `Fazenda ${esc(p.fazenda)}, talhão ${esc(p.talhao || '–')}` : p.fazProx ? `Perto da fazenda ${esc(p.fazProx.faz)}` : '';

  function visiveis() {
    const q = $('#busca').value.trim().toLowerCase();
    return D.pendencias.filter(p => {
      const at = situacao(p) === 'Resolvido';
      return (filtro === 'todas' || (filtro === 'atendidas' ? at : !at)) && (!q || texto(p).includes(q));
    });
  }

  function desenhar() {
    const at = D.pendencias.filter(p => situacao(p) === 'Resolvido').length;
    $('#nAbertas').textContent = D.pendencias.length - at; $('#nAtendidas').textContent = at; $('#nTodas').textContent = D.pendencias.length;
    const lista = visiveis();
    const ab = D.pendencias.length - at, velhas = D.pendencias.filter(p => situacao(p) !== 'Resolvido' && diasAberta(p) >= DIAS_ANTIGA).length;
    $('#titLista').textContent = filtro === 'atendidas' ? `${at} atendida${at === 1 ? '' : 's'}` : filtro === 'todas' ? `${D.pendencias.length} pendências` : `${ab} em aberto`;
    if (D.geradoEm) $('#subLista').textContent = `${$('#info').textContent}.${velhas ? ` ${velhas} há mais de uma semana.` : ''}`;
    $('#itens').innerHTML = lista.map(p => {
      const sit = situacao(p), extra = sit && sit !== 'Resolvido' ? ` · ${esc(sit)}` : '';
      return `<article class="item ${classe(p)} ${p === selecionada ? 'ativo' : ''}" data-i="${D.pendencias.indexOf(p)}" tabindex="0">
        <span class="ponto"></span>
        <div><div class="t"><b>${esc(p.frota)}</b> · ${esc(p.equipamento || 'Equipamento')}</div><small>${esc(p.ocorrencia || '–')}</small>
        <div class="meta">${esc(p.frente || 'Sem frente')}${fazendaCurta(p) ? ' · ' + fazendaCurta(p) : ''}${temPos(p) ? '' : ' · <span class="semposicao">sem posição no SGPA</span>'}${extra}</div></div>
        <span class="dias">${rotuloDias(p)}</span>
      </article>`;
    }).join('') || `<p class="vazio">${filtro === 'atendidas' ? 'Nenhuma pendência atendida ainda.' : 'Nenhuma pendência encontrada.'}</p>`;
    document.querySelectorAll('.item').forEach(el => {
      const abrir = () => abrirDetalhe(D.pendencias[+el.dataset.i]);
      el.onclick = abrir; el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } };
    });

    camPinos.clearLayers();
    const limites = [];
    for (const p of lista) {
      if (!temPos(p)) continue;
      L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html: `<span class="pino ${classe(p)} ${p === selecionada ? 'ativo' : ''}">${esc(p.frota)}</span>`, iconSize: null }), zIndexOffset: p === selecionada ? 1000 : 0 })
        .on('click', () => abrirDetalhe(p)).addTo(camPinos);
      limites.push([p.lat, p.lon]);
    }
    if (limites.length && !desenhar.ja) { mapa.fitBounds(limites, innerWidth > 820 ? { paddingTopLeft: [430, 90], paddingBottomRight: [40, 40], maxZoom: 13 } : { paddingTopLeft: [20, 70], paddingBottomRight: [20, innerHeight * .46], maxZoom: 13 }); desenhar.ja = true; }
  }
  $('#busca').oninput = desenhar;
  document.querySelectorAll('.segmentos button').forEach(b => b.onclick = () => {
    filtro = b.dataset.f; document.querySelectorAll('.segmentos button').forEach(x => x.setAttribute('aria-pressed', x === b)); desenhar();
  });

  // ---------- talhões (shape) ----------
  async function carregarTalhoes() {
    try {
      const T = await P.lerCifrado('dados/talhoes.enc');
      const estilo = { color: '#bfe8cf', weight: 1, opacity: .8, fillColor: '#1fa463', fillOpacity: .07 };
      for (const t of T) {
        const aneis = t.a.map(r => { const c = []; for (let i = 0; i < r.length; i += 2) c.push([r[i], r[i + 1]]); return c; });
        L.polygon(aneis, estilo).bindTooltip(`${esc(t.n)} (${t.f}), talhão ${t.t}`, { className: 'talhao', sticky: true }).addTo(camTalhoes);
      }
    } catch (e) { console.warn('talhões', e); }
  }

  // ---------- janelas ----------
  function janela(cabecalho, html, flutuante = false) {
    document.querySelectorAll('.fundo-janela.flutuante').forEach(x => x.remove());
    const f = document.createElement('div'); f.className = 'fundo-janela' + (flutuante ? ' flutuante' : '');
    f.innerHTML = `<div class="janela" role="dialog" aria-modal="true"><header>${cabecalho}<button class="fechar" aria-label="Fechar">×</button></header><div class="corpo">${html}</div></div>`;
    const anterior = document.activeElement;
    const fechar = () => { f.remove(); document.removeEventListener('keydown', esc_); if (anterior && anterior.focus) anterior.focus(); };
    const esc_ = e => { if (e.key === 'Escape') fechar(); };
    f.onclick = e => { if (e.target === f) fechar(); }; $('.fechar', f).onclick = fechar; document.addEventListener('keydown', esc_);
    document.body.appendChild(f); $('.fechar', f).focus();
    return { el: f, fechar };
  }
  const cabPendencia = (p, sub) => `<div>${etiqueta(p)}<h2>Frota ${esc(p.frota)}</h2><p>${esc(p.equipamento || 'Equipamento')} · ${sub}</p></div>`;
  const linhaFazenda = p => p.fazenda ? `${esc(p.fazenda)}${p.zona ? ` (zona ${esc(p.zona)})` : ''}, talhão ${esc(p.talhao || '–')}`
    : p.fazProx ? `Fora de fazenda. Mais próxima: ${esc(p.fazProx.faz)}${p.fazProx.talhao ? ', talhão ' + esc(p.fazProx.talhao) : ''} (a ${p.fazProx.d < 1 ? Math.round(p.fazProx.d * 1000) + ' m' : p.fazProx.d.toFixed(1).replace('.', ',') + ' km'})` : (temPos(p) ? 'Fora de fazenda' : '–');

  function abrirDetalhe(p) {
    selecionada = p; desenhar();
    if (temPos(p)) mapa.flyTo([p.lat, p.lon], Math.max(mapa.getZoom(), 14), { duration: .6 });
    const d = diasAberta(p), hist = apsDe(p);
    const j = janela(cabPendencia(p, esc(p.ocorrencia || '')), `
      <dl class="ficha">
        <dt>Aberta em</dt><dd>${esc(p.dataAbertura || '–')}${d != null ? ` (${d <= 0 ? 'hoje' : d === 1 ? 'há 1 dia' : 'há ' + d + ' dias'})` : ''}</dd>
        <dt>Frente</dt><dd>${esc(p.frente || '–')}</dd>
        <dt>Fazenda</dt><dd>${linhaFazenda(p)}</dd>
        <dt>Última posição</dt><dd>${temPos(p) ? esc(p.ultimaPosicao || '–') : 'Sem posição no SGPA'}</dd>
        ${p.localidade ? `<dt>Local informado</dt><dd>${esc(p.localidade)}</dd>` : ''}
      </dl>
      ${hist.length ? `<div class="historico"><h4>Serviços registrados</h4>${hist.map((a, i) => `<div class="reg"><b>${esc(a.situacao)}</b> por ${esc(a.nome)}<small>${fmtDataHora(a.inicio)} até ${fmtDataHora(a.fim)}${a.naFila ? ' – salvo no aparelho, falta sincronizar' : ''}</small>${esc(a.observacao)}${S.admin && !a.naFila ? `<div class="acoes-admin"><button class="btn" data-ed="${i}">Editar</button><button class="btn perigo-borda" data-ex="${i}">Excluir</button></div>` : ''}</div>`).join('')}</div>` : ''}
      <div class="botoes">
        <button class="btn primario" data-a="apontar">Registrar serviço</button>
        ${S.admin && situacao(p) === 'Resolvido' ? '<button class="btn perigo-borda" data-a="reabrir">Reabrir pendência</button>' : ''}
        ${temPos(p) ? `<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}">Ir até lá</a>` : ''}
      </div>`, true);
    $('[data-a=apontar]', j.el).onclick = () => { j.fechar(); abrirApontamento(p); };
    const recarregar = async () => { j.fechar(); APS = await P.carregarApontamentos().catch(() => APS); desenhar(); abrirDetalhe(p); };
    j.el.querySelectorAll('[data-ed]').forEach(b => b.onclick = async () => { if (await P.acaoAdmin('editar', hist[+b.dataset.ed])) recarregar(); });
    j.el.querySelectorAll('[data-ex]').forEach(b => b.onclick = async () => { if (await P.acaoAdmin('excluir', hist[+b.dataset.ex])) recarregar(); });
    const rb = $('[data-a=reabrir]', j.el);
    if (rb) rb.onclick = async () => {
      if (!await P.confirmar('Reabrir esta pendência?', 'Os registros marcados como resolvidos passam para "Reaberta" e a pendência volta para Em aberto. O histórico continua salvo.', 'Reabrir pendência')) return;
      try { await P.reabrirPendencia(hist); aviso('Pendência reaberta.'); recarregar(); } catch (e) { aviso(e.message, 'erro', 6000); }
    };
  }

  // ---------- apontamento ----------
  const paraLocal = d => new Date(d - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  function abrirApontamento(p) {
    const agora = new Date(), fotos = [];
    const j = janela(cabPendencia(p, 'Registrar serviço'), `
      <form class="ap">
        <div class="dupla">
          <div><label for="ini">Início</label><input id="ini" type="datetime-local" name="inicio" required value="${paraLocal(agora - 3600000)}"></div>
          <div><label for="fim">Fim</label><input id="fim" type="datetime-local" name="fim" required value="${paraLocal(agora)}"></div>
        </div>
        <label for="sit">Situação</label>
        <select id="sit" name="situacao"><option>Resolvido</option><option>Não resolvido – precisa retorno</option><option>Aguardando peça</option></select>
        <label for="obs">O que foi feito</label>
        <textarea id="obs" name="obs" required placeholder="Ex.: trocado o sensor de roda e calibrado o piloto."></textarea>
        <label>Fotos (até 4, opcional)</label>
        <label class="foto-btn">Adicionar fotos<input type="file" name="fotos" accept="image/*" multiple></label>
        <div class="miniaturas"></div>
        <div class="quem">Registrado por <b>${esc(S.nome)}</b></div>
        <div class="botoes"><button class="btn primario" type="submit">Salvar registro</button><button class="btn" type="button" data-a="cancelar">Cancelar</button></div>
      </form>`);
    const f = $('form', j.el), mini = $('.miniaturas', f);
    $('[data-a=cancelar]', f).onclick = j.fechar;
    const desenharMini = () => { mini.innerHTML = fotos.map((u, i) => `<div><img src="${u}" alt="Foto ${i + 1}"><button type="button" data-i="${i}" aria-label="Remover foto">×</button></div>`).join('');
      mini.querySelectorAll('button').forEach(b => b.onclick = () => { fotos.splice(+b.dataset.i, 1); desenharMini(); }); };
    f.fotos.onchange = async () => {
      for (const arq of f.fotos.files) { if (fotos.length >= 4) break; try { fotos.push(await P.reduzirFoto(arq)); } catch (e) { aviso(e.message, 'erro'); } }
      f.fotos.value = ''; desenharMini();
    };
    f.onsubmit = async ev => {
      ev.preventDefault();
      const ini = new Date(f.inicio.value), fim = new Date(f.fim.value);
      if (fim < ini) return aviso('O fim do serviço está antes do início. Corrija os horários.', 'erro');
      const b = $('button[type=submit]', f); b.disabled = true; b.textContent = 'Salvando…';
      const ts = new Date(), id = `${ts.getFullYear()}${P.p2(ts.getMonth() + 1)}${P.p2(ts.getDate())}-${P.p2(ts.getHours())}${P.p2(ts.getMinutes())}${P.p2(ts.getSeconds())}-${String(p.frota).replace(/\W/g, '')}-${S.usuario.replace(/\W/g, '')}`;
      const ap = { id, pid: P.idPendencia(p), frota: p.frota, equipamento: p.equipamento, ocorrencia: p.ocorrencia, dataAbertura: p.dataAbertura,
        frente: p.frente, fazenda: p.fazenda || '', talhao: p.talhao || '', lat: p.lat || null, lon: p.lon || null,
        inicio: ini.toISOString(), fim: fim.toISOString(), duracaoMin: Math.round((fim - ini) / 60000), situacao: f.situacao.value,
        observacao: f.obs.value.trim(), usuario: S.usuario, nome: S.nome, criadoEm: ts.toISOString(), fotos };
      const r = await P.salvarApontamento(ap);
      aviso(r.enviado ? 'Registro salvo e enviado.' : 'Registro salvo no aparelho. Com internet, toque em Sincronizar para enviar.', r.enviado ? 'ok' : 'erro', 6000);
      j.fechar(); APS = await P.carregarApontamentos().catch(() => APS); marcarSinc(); desenhar();
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
    const Dm = pts.map(a => pts.map(b => km(a, b)));
    const custo = o => { let d = 0, a = 0; for (const i of o) { d += Dm[a][i + 1]; a = i + 1; } return d; };
    if (n <= 12) {
      const N = 1 << n, dp = Array.from({ length: N }, () => new Float64Array(n).fill(Infinity)), pai = Array.from({ length: N }, () => new Int8Array(n).fill(-1));
      for (let j = 0; j < n; j++) dp[1 << j][j] = Dm[0][j + 1];
      for (let m = 1; m < N; m++) for (let j = 0; j < n; j++) { if (!(m & (1 << j)) || dp[m][j] === Infinity) continue;
        for (let k = 0; k < n; k++) { if (m & (1 << k)) continue; const nm = m | (1 << k), v = dp[m][j] + Dm[j + 1][k + 1]; if (v < dp[nm][k]) { dp[nm][k] = v; pai[nm][k] = j; } } }
      let fim = 0; for (let j = 1; j < n; j++) if (dp[N - 1][j] < dp[N - 1][fim]) fim = j;
      const o = []; for (let m = N - 1, j = fim; j >= 0;) { o.unshift(j); const pj = pai[m][j]; m ^= (1 << j); j = pj; } return o;
    }
    let o = [], resto = new Set([...Array(n).keys()]), a = 0;
    while (resto.size) { let b = -1; for (const i of resto) if (b < 0 || Dm[a][i + 1] < Dm[a][b + 1]) b = i; o.push(b); resto.delete(b); a = b + 1; }
    for (let mudou = true; mudou;) { mudou = false;
      for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) { const t = [...o.slice(0, i), ...o.slice(i, j + 1).reverse(), ...o.slice(j + 1)]; if (custo(t) + 1e-9 < custo(o)) { o = t; mudou = true; } } }
    return o;
  }

  const botoesRota = [$('#btnRota')];
  async function tracarRota() {
    botoesRota.forEach(b => { b.disabled = true; b.textContent = 'Calculando…'; });
    const fim = () => botoesRota.forEach(b => { b.disabled = false; b.innerHTML = ICONE_ROTA; });
    const alvo = D.pendencias.filter(p => temPos(p) && situacao(p) !== 'Resolvido');
    if (!alvo.length) { fim(); return aviso('Nenhuma pendência em aberto com posição no mapa.', 'erro'); }
    const gps = await posicaoAtual(), inicio = gps || usina;
    const paradas = [];
    for (const p of alvo) { const g = paradas.find(g => km(g.c, [p.lat, p.lon]) <= 2); if (g) g.itens.push(p); else paradas.push({ c: [p.lat, p.lon], itens: [p] }); }
    const rota = melhorOrdem([inicio, ...paradas.map(g => g.c)]).map(i => paradas[i]);
    camRota.clearLayers();
    const linha = [inicio, ...rota.map(g => g.c)];
    L.polyline(linha, { color: '#0b5d3b', weight: 5, opacity: .95, className: 'rota-linha', renderer: L.svg() }).addTo(camRota);
    L.circleMarker(inicio, { radius: 8, color: '#fff', weight: 3, fillColor: '#1fa463', fillOpacity: 1 }).bindTooltip(gps ? 'Você está aqui' : 'Usina').addTo(camRota);
    rota.forEach((g, i) => L.marker(g.c, { icon: L.divIcon({ className: '', html: `<span class="pino ordem">${i + 1}</span>`, iconSize: null }), zIndexOffset: 2000 }).addTo(camRota));
    mapa.fitBounds(linha, innerWidth > 820 ? { paddingTopLeft: [430, 90], paddingBottomRight: [420, 40] } : { paddingTopLeft: [20, 70], paddingBottomRight: [20, 60] });
    let total = 0, ant = inicio;
    const itens = rota.map(g => { const t = km(ant, g.c) * 1.2; total += t; ant = g.c;
      return `<li><span><b>${esc(g.itens[0].frente || 'Sem frente')}</b><br><small>Frota${g.itens.length > 1 ? 's' : ''} ${g.itens.map(p => esc(p.frota)).join(', ')}</small></span><small>${Math.round(t)} km</small></li>`; }).join('');
    const pts = linha.map(c => `${c[0].toFixed(6)},${c[1].toFixed(6)}`), links = [];
    for (let i = 0; i < pts.length - 1; i += 9) links.push('https://www.google.com/maps/dir/' + pts.slice(i, i + 10).join('/'));
    janela(`<div><h2>Rota sugerida</h2><p>Saindo ${gps ? 'de onde você está' : 'da usina (localização do aparelho indisponível)'}, na ordem que menos roda.</p></div>`, `<div class="rota">
      <ol>${itens}</ol>
      <div class="total"><span>Distância estimada</span><span>${Math.round(total)} km</span></div>
      <p class="dica">Ao chegar em cada frente, aproveite para verificar também os outros equipamentos que estiverem no local.</p>
      <div class="botoes">${links.map((l, i) => `<a class="btn primario" target="_blank" rel="noopener" href="${l}">Abrir no Google Maps${links.length > 1 ? ' – parte ' + (i + 1) : ''}</a>`).join('')}</div>
    </div>`, true);
    fim();
  }
  botoesRota.forEach(b => b.onclick = tracarRota);

  await carregar();
  carregarTalhoes();
})();
