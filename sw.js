/* Service worker – faz o painel abrir e funcionar sem internet.
 * Site: guardado na instalação. Dados (criptografados): rede primeiro, cópia salva se estiver offline.
 * Mapa de satélite: os pedaços já vistos ficam guardados (até ~4000). API do GitHub: nunca guardada. */
const VERSAO = 'pend-v6';
const SITE = ['./', 'index.html', 'apontamentos.html', 'css/estilo.css', 'js/cripto.js', 'js/comum.js', 'js/app.js', 'js/apontamentos.js',
  'vendor/leaflet.js', 'vendor/leaflet.css', 'vendor/xlsx.mini.min.js', 'vendor/images/layers.png', 'vendor/images/layers-2x.png',
  'vendor/images/marker-icon.png', 'manifest.json', 'icone-192.png', 'icone-512.png',
  'img/logo.png', 'img/marca.png', 'vendor/fonts/manrope-latin-400-normal.woff2', 'vendor/fonts/manrope-latin-500-normal.woff2',
  'vendor/fonts/manrope-latin-600-normal.woff2', 'vendor/fonts/manrope-latin-700-normal.woff2', 'vendor/fonts/manrope-latin-800-normal.woff2'];
const DADOS = ['dados/usuarios.json', 'dados/config.enc', 'dados/pendencias.enc', 'dados/talhoes.enc', 'dados/apontamentos.enc'];
const MAX_MAPA = 4000;

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(VERSAO);
  await c.addAll(SITE);
  await Promise.all(DADOS.map(d => c.add(d).catch(() => null))); // os que ainda não existem são ignorados
  self.skipWaiting();
})()));
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSAO && k !== 'mapa') await caches.delete(k);
  self.clients.claim();
})()));

const semBusca = url => { const u = new URL(url); u.search = ''; return u.toString(); };

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.hostname === 'api.github.com') return; // envio/consulta ao GitHub: sempre direto
  // pedaços do mapa: guarda o que já foi visto
  if (/arcgisonline\.com|tile\.openstreetmap\.org/.test(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open('mapa'), salvo = await c.match(req.url);
      if (salvo) return salvo;
      try {
        const r = await fetch(req);
        if (r.ok || r.type === 'opaque') { c.put(req.url, r.clone()); c.keys().then(k => { if (k.length > MAX_MAPA) k.slice(0, k.length - MAX_MAPA).forEach(x => c.delete(x)); }); }
        return r;
      } catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }
  if (url.origin !== location.origin) return;
  const chave = semBusca(req.url);
  if (url.pathname.endsWith('/dados/talhoes.enc')) { // shape: abre na hora pela cópia salva e atualiza em segundo plano
    e.respondWith((async () => {
      const c = await caches.open(VERSAO), salvo = await c.match(chave);
      const rede = fetch(req).then(r => { if (r.ok) c.put(chave, r.clone()); return r; }).catch(() => null);
      return salvo || (await rede) || new Response('', { status: 504 });
    })());
    return;
  }
  if (url.pathname.includes('/dados/')) { // dados: rede primeiro, cópia salva se offline
    e.respondWith((async () => {
      const c = await caches.open(VERSAO);
      try { const r = await fetch(req); if (r.ok) c.put(chave, r.clone()); return r; }
      catch (err) { const s = await c.match(chave); if (s) { const h = new Headers(s.headers); h.set('X-Offline', '1'); return new Response(await s.blob(), { status: 200, headers: h }); } throw err; }
    })());
    return;
  }
  // site: rede primeiro (sempre a versão mais nova); sem internet, usa a cópia salva
  e.respondWith((async () => {
    const c = await caches.open(VERSAO);
    try { const r = await fetch(req, { cache: 'no-cache' }); if (r.ok) c.put(chave, r.clone()); return r; }
    catch (err) { return (await c.match(chave)) || (await c.match(new URL('index.html', location.href).toString())) || new Response('Sem conexão', { status: 503 }); }
  })());
});
