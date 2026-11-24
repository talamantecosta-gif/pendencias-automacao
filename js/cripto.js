/* Criptografia do Painel de Pendências – COA Aroeira
 * AES-256-GCM (dados) + PBKDF2-SHA256 (senha do usuário → chave que abre a chave dos dados).
 * O mesmo arquivo roda no navegador (window.Cripto) e no Node 18+ (require).
 * Formato de arquivo criptografado: {"v":1,"iv":"<base64>","d":"<base64>"}  (conteúdo = JSON compactado gzip)
 */
(function (raiz) {
  'use strict';
  const sub = globalThis.crypto.subtle;
  const ITER = 210000;
  const enc = new TextEncoder(), dec = new TextDecoder();

  const b64 = buf => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const deB64 = s => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const aleatorio = n => globalThis.crypto.getRandomValues(new Uint8Array(n));

  async function fluxo(bytes, Stream) {
    const s = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const compactar = b => fluxo(b, CompressionStream);
  const descompactar = b => fluxo(b, DecompressionStream);

  const importarChave = raw => sub.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
  const novaChave = async () => importarChave(aleatorio(32));
  const exportarChave = async k => b64(await sub.exportKey('raw', k));
  const chaveDeB64 = s => importarChave(deB64(s));

  async function chaveDaSenha(senha, salt) {
    const base = await sub.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveKey']);
    return sub.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }

  // objeto JS → texto criptografado
  async function cifrar(chave, obj) {
    const iv = aleatorio(12);
    const dados = await sub.encrypt({ name: 'AES-GCM', iv }, chave, await compactar(enc.encode(JSON.stringify(obj))));
    return JSON.stringify({ v: 1, iv: b64(iv), d: b64(dados) });
  }
  // texto criptografado → objeto JS
  async function decifrar(chave, texto) {
    const o = typeof texto === 'string' ? JSON.parse(texto) : texto;
    const claro = await sub.decrypt({ name: 'AES-GCM', iv: deB64(o.iv) }, chave, deB64(o.d));
    return JSON.parse(dec.decode(await descompactar(new Uint8Array(claro))));
  }

  // id público do usuário (não expõe o nome no repositório)
  async function idUsuario(usuario) {
    const h = await sub.digest('SHA-256', enc.encode('aroeira-pendencias:' + String(usuario).trim().toLowerCase()));
    return b64(h).replace(/[^A-Za-z0-9]/g, '').slice(0, 24);
  }

  // cadastro: guarda a chave dos dados "trancada" com a senha do usuário
  async function trancarParaUsuario(chaveDados, usuario, senha, nome, extra = {}) {
    const salt = aleatorio(16), k = await chaveDaSenha(senha, salt), iv = aleatorio(12);
    const carga = enc.encode(JSON.stringify({ k: await exportarChave(chaveDados), usuario: String(usuario).trim().toLowerCase(), nome, ...extra }));
    const d = await sub.encrypt({ name: 'AES-GCM', iv }, k, carga);
    return { id: await idUsuario(usuario), registro: { salt: b64(salt), iv: b64(iv), d: b64(d) } };
  }
  // login: devolve { chave, usuario, nome } ou lança erro
  async function abrirComSenha(usuariosJson, usuario, senha) {
    const r = (usuariosJson.usuarios || {})[await idUsuario(usuario)];
    if (!r) throw new Error('Usuário ou senha inválidos');
    try {
      const k = await chaveDaSenha(senha, deB64(r.salt));
      const carga = JSON.parse(dec.decode(await sub.decrypt({ name: 'AES-GCM', iv: deB64(r.iv) }, k, deB64(r.d))));
      return { chave: await chaveDeB64(carga.k), chaveB64: carga.k, usuario: carga.usuario, nome: carga.nome, admin: !!carga.admin };
    } catch (e) { throw new Error('Usuário ou senha inválidos'); }
  }

  const api = { cifrar, decifrar, novaChave, exportarChave, chaveDeB64, trancarParaUsuario, abrirComSenha, idUsuario, b64, deB64 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else raiz.Cripto = api;
})(typeof window !== 'undefined' ? window : globalThis);
