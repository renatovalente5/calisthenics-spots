/* A casa das máquinas: rever o que chegou.
 *
 * PORQUE ISTO EXISTE, e não é opcional. A página «Falta um sítio?» promete que
 * um envio com nome escrito à mão fica visível em menos de 24 horas. Sem um
 * sítio onde carregar em «aceitar», essa promessa é mentira dentro de uma
 * semana — e uma promessa quebrada é pior do que promessa nenhuma.
 *
 * A chave fica no armazenamento local depois de a primeira resposta a aceitar.
 * É de quem gere, não de quem visita: esta página não está ligada de lado
 * nenhum e leva `noindex`.
 */
(() => {
  'use strict';

  const $ = s => document.querySelector(s);
  const CHAVE = 'cs:chave-gerir';
  let chave = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function pedir(rota, corpo) {
    const r = await fetch((CONFIG.api || '') + rota, {
      method: corpo ? 'POST' : 'GET',
      headers: Object.assign({ 'X-Chave': chave },
        corpo ? { 'content-type': 'application/json' } : {}),
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (r.status === 401) throw new Error('chave errada');
    if (!r.ok) throw new Error('erro ' + r.status);
    return r.json();
  }

  // Os mesmos nomes que a aplicação mostra. Ver «barra_fixa, paralelas» numa
  // página de revisão obriga a traduzir de cabeça a cada envio.
  const NOMES = {
    barra_fixa: 'Barra fixa', paralelas: 'Barras paralelas',
    escada_horizontal: 'Escada horizontal', argolas: 'Argolas', espaldar: 'Espaldar',
    flexoes: 'Apoio para flexões', abdominais: 'Banco de abdominais',
    lombares: 'Banco lombar', alongamento: 'Barras de alongamento',
    agachamento: 'Agachamento', trave: 'Trave de equilíbrio',
    equilibrio: 'Passadeira de equilíbrio', caixa: 'Caixa de saltos',
    escadas: 'Escadas', barreiras: 'Barreiras', slalom: 'Slalom',
    corda: 'Corda', escalada: 'Escalada', slackline: 'Slackline',
    suspensao: 'Suspensão',
  };

  function urlOrtofoto(lat, lon) {
    const R = 20037508.342789244;
    const x = lon * R / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * R / 180;
    const d = 70;
    return 'https://cartografia.dgterritorio.gov.pt/ortos2018/service?service=WMS' +
      '&version=1.3.0&request=GetMap&layers=Ortos2018-RGB&styles=&crs=EPSG:3857' +
      `&format=image/png&bbox=${x - d},${y - d},${x + d},${y + d}&width=360&height=270`;
  }

  function cartao(e) {
    const ap = (e.aparelhos || []).map(a => NOMES[a] || a).join(' · ')
      || '— nenhum aparelho marcado —';
    return `<article class="gerir__envio" data-id="${e.id}">
      <img class="gerir__orto" src="${urlOrtofoto(e.lat, e.lon)}" width="360" height="270"
           alt="Vista aérea do ponto enviado" loading="lazy"
           onerror="this.style.display='none'">
      <div class="gerir__corpo">
        <p class="gerir__coord">${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}
          · <a href="https://www.google.com/maps/@?api=1&map_action=map&center=${e.lat},${e.lon}&zoom=20&basemap=satellite"
               target="_blank" rel="noopener">satélite</a>
          · <a href="https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${e.lat},${e.lon}"
               target="_blank" rel="noopener">rua</a></p>
        ${e.nome ? `<p class="gerir__nome">${esc(e.nome)}</p>` : ''}
        <p class="gerir__ap">${esc(ap)}</p>
        ${e.nota ? `<p class="gerir__nota">${esc(e.nota)}</p>` : ''}
        <p class="gerir__quando">${esc((e.criado_em || '').replace('T', ' ').slice(0, 16))}</p>
        <div class="gerir__botoes">
          <button class="botao botao--pequeno" data-decisao="aceite">Aceitar</button>
          <button class="botao botao--fantasma botao--pequeno" data-decisao="recusado">Recusar</button>
        </div>
      </div>
    </article>`;
  }

  async function carregar() {
    const d = await pedir('/v1/gerir/fila');
    const c = d.contagens || {};
    $('#gerir-contagens').textContent =
      `${c.pendente || 0} à espera · ${c.aceite || 0} aceites · ${c.recusado || 0} recusados`;
    $('#gerir-lista').innerHTML = d.pendentes.length
      ? d.pendentes.map(cartao).join('')
      : '<p class="gerir__vazio">Nada à espera. Está tudo em dia.</p>';
    $('#gerir-desmentidos').innerHTML = (d.desmentidos || []).length
      ? '<ul class="gerir__desmentidos">' + d.desmentidos.map(x =>
        `<li><a href="${CONFIG.base || '../'}#s=${x.sitio}">sítio ${x.sitio}</a>
         — ${x.quantos} ${x.quantos === 1 ? 'pessoa diz' : 'pessoas dizem'} que já não existe
         (última: ${esc((x.ultima || '').slice(0, 10))})</li>`).join('') + '</ul>'
      : '<p class="gerir__vazio">Ninguém desmentiu nada.</p>';
  }

  async function decidir(id, decisao, botao) {
    botao.disabled = true;
    try {
      await pedir('/v1/gerir/decidir', { id, decisao });
      const cartaoDom = botao.closest('.gerir__envio');
      cartaoDom.classList.add('gerir__envio--decidido');
      cartaoDom.querySelector('.gerir__botoes').innerHTML =
        `<span class="gerir__decidido">${decisao === 'aceite' ? 'Aceite' : 'Recusado'}</span>`;
    } catch (err) {
      botao.disabled = false;
      alert('Não deu: ' + err.message);
    }
  }

  async function abrir() {
    chave = $('#gerir-chave').value.trim();
    if (!chave) return;
    try {
      await carregar();
      try { localStorage.setItem(CHAVE, chave); } catch (e) { /* modo privado */ }
      $('#gerir-entrar').hidden = true;
      $('#gerir-painel').hidden = false;
    } catch (err) {
      $('#gerir-erro').textContent = err.message;
      $('#gerir-erro').hidden = false;
    }
  }

  addEventListener('DOMContentLoaded', () => {
    $('#gerir-abrir').addEventListener('click', abrir);
    $('#gerir-chave').addEventListener('keydown', ev => {
      if (ev.key === 'Enter') abrir();
    });
    $('#gerir-painel').addEventListener('click', ev => {
      const b = ev.target.closest('[data-decisao]');
      if (!b) return;
      decidir(+b.closest('.gerir__envio').dataset.id, b.dataset.decisao, b);
    });
    // Se a chave já cá está, entra sozinho — quem gere não escreve isto todos os dias.
    let guardada = null;
    try { guardada = localStorage.getItem(CHAVE); } catch (e) { /* nada */ }
    if (guardada) { $('#gerir-chave').value = guardada; abrir(); }
  });
})();
