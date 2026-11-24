/* Página de apontamentos: lista, filtros, detalhe com fotos e exportação */
(async function () {
  'use strict';
  const P = window.Painel, { $, esc, fmtDataHora, aviso } = P;
  const S = await P.exigirLogin();
  $('#nomeUsuario').textContent = S.nome;
  $('#btnSair').onclick = () => P.sair();

  let APS = [];
  const dur = m => m == null ? '-' : `${Math.floor(m / 60)}h${P.p2(m % 60)}`;

  async function carregar() {
    $('#linhas').innerHTML = '<tr><td colspan="9" class="vazio">Carregando…</td></tr>';
    APS = await P.carregarApontamentos().catch(e => { aviso(e.message, 'erro'); return []; });
    const nomes = [...new Set(APS.map(a => a.nome).filter(Boolean))].sort();
    $('#quem').innerHTML = '<option value="">Todos</option>' + nomes.map(n => `<option>${esc(n)}</option>`).join('');
    desenhar();
  }
  function filtrados() {
    const de = $('#de').value, ate = $('#ate').value, sit = $('#sit').value, quem = $('#quem').value, q = $('#busca').value.trim().toLowerCase();
    return APS.filter(a => {
      const dia = String(a.inicio || '').slice(0, 10);
      return (!de || dia >= de) && (!ate || dia <= ate) && (!sit || a.situacao === sit) && (!quem || a.nome === quem)
        && (!q || [a.frota, a.equipamento, a.ocorrencia, a.observacao, a.frente].join(' ').toLowerCase().includes(q));
    });
  }
  function desenhar() {
    const l = filtrados();
    const horas = l.reduce((s, a) => s + (a.duracaoMin || 0), 0);
    $('#resumo').textContent = `${l.length} apontamento(s) · ${dur(horas)} de serviço · ${l.filter(a => a.situacao === 'Resolvido').length} resolvido(s)`;
    $('#linhas').innerHTML = l.map((a, i) => `<tr data-i="${APS.indexOf(a)}">
      <td>${fmtDataHora(a.inicio)}</td><td>${fmtDataHora(a.fim)}</td><td>${dur(a.duracaoMin)}</td>
      <td><b>${esc(a.frota)}</b></td><td>${esc(a.equipamento || '-')}</td><td>${esc(a.ocorrencia || '-')}</td>
      <td>${a.situacao === 'Resolvido' ? '<span class="etq verde">Resolvido</span>' : `<span class="etq">${esc(a.situacao)}</span>`}${a.naFila ? ' <span class="etq cinza">no aparelho – falta sincronizar</span>' : ''}</td>
      <td>${esc(a.nome)}</td><td>${(a.fotos || []).length || '-'}</td></tr>`).join('') || '<tr><td colspan="9" class="vazio">Nenhum apontamento no filtro.</td></tr>';
    document.querySelectorAll('tbody tr[data-i]').forEach(tr => tr.onclick = () => detalhe(APS[+tr.dataset.i]));
  }
  ['de', 'ate', 'sit', 'quem'].forEach(id => $('#' + id).onchange = desenhar);
  $('#busca').oninput = desenhar;
  $('#btnAtualizar').onclick = async () => {
    const b = $('#btnAtualizar'); b.disabled = true;
    try { const r = await P.sincronizar(); if (r.enviados) aviso(`${r.enviados} apontamento(s) enviados.`); } catch (e) { aviso(e.message, 'erro', 6000); }
    await carregar(); b.disabled = false; P.atualizarBotaoSinc(b);
  };
  P.atualizarBotaoSinc($('#btnAtualizar'));

  async function detalhe(a) {
    const f = document.createElement('div'); f.className = 'fundo-janela';
    f.innerHTML = `<div class="janela"><header><h2>Frota ${esc(a.frota)}</h2><button class="fechar">×</button></header><div class="corpo">
      <dl class="ficha">
        <dt>Equipamento</dt><dd>${esc(a.equipamento || '-')}</dd>
        <dt>Ocorrência</dt><dd>${esc(a.ocorrencia || '-')}</dd>
        <dt>Abertura</dt><dd>${esc(a.dataAbertura || '-')}</dd>
        <dt>Frente</dt><dd>${esc(a.frente || '-')}</dd>
        <dt>Fazenda</dt><dd>${a.fazenda ? esc(a.fazenda) + ' · Talhão ' + esc(a.talhao || '-') : '-'}</dd>
        <dt>Início</dt><dd>${fmtDataHora(a.inicio)}</dd>
        <dt>Fim</dt><dd>${fmtDataHora(a.fim)} (${dur(a.duracaoMin)})</dd>
        <dt>Situação</dt><dd>${esc(a.situacao)}</dd>
        <dt>Realizado por</dt><dd>${esc(a.nome)}</dd>
        <dt>Serviço</dt><dd>${esc(a.observacao).replace(/\n/g, '<br>')}</dd>
      </dl>
      <div class="fotos-grandes">${(a.fotos || []).length ? '<p class="m">Carregando fotos…</p>' : ''}</div></div></div>`;
    f.onclick = e => { if (e.target === f) f.remove(); }; $('.fechar', f).onclick = () => f.remove();
    document.body.appendChild(f);
    if ((a.fotos || []).length) {
      const box = $('.fotos-grandes', f), imgs = [];
      for (const c of a.fotos) { try { imgs.push(`<img src="${await P.carregarFoto(c)}" alt="Foto do serviço">`); } catch (e) { imgs.push('<p class="m">Foto indisponível.</p>'); } }
      box.innerHTML = imgs.join('');
    }
  }

  const linhasExport = () => filtrados().map(a => ({
    'Início': fmtDataHora(a.inicio), 'Fim': fmtDataHora(a.fim), 'Duração (min)': a.duracaoMin, 'Frota': a.frota, 'Equipamento': a.equipamento,
    'Ocorrência': a.ocorrencia, 'Abertura da pendência': a.dataAbertura, 'Frente': a.frente, 'Fazenda': a.fazenda, 'Talhão': a.talhao,
    'Situação': a.situacao, 'Serviço realizado': a.observacao, 'Realizado por': a.nome, 'Fotos': (a.fotos || []).length,
  }));
  const nomeArq = ext => `Apontamentos_Pendencias_${new Date().toISOString().slice(0, 10)}.${ext}`;
  $('#btnExcel').onclick = () => {
    const ws = XLSX.utils.json_to_sheet(linhasExport()); ws['!cols'] = [16, 16, 10, 9, 22, 34, 14, 24, 9, 8, 22, 50, 20, 6].map(w => ({ wch: w }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Apontamentos'); XLSX.writeFile(wb, nomeArq('xlsx'));
  };
  $('#btnCsv').onclick = () => {
    const l = linhasExport(); if (!l.length) return aviso('Nada para exportar.', 'erro');
    const cab = Object.keys(l[0]), q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = '﻿' + [cab.map(q).join(';'), ...l.map(r => cab.map(c => q(r[c])).join(';'))].join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a.download = nomeArq('csv'); a.click();
  };

  carregar();
})();
