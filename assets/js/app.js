/* Calisthenics Spots — a aplicação.
   ============================================================================
   O QUE ISTO É. Um mapa dos sítios em Portugal onde se pode treinar CALISTENIA
   ao ar livre: barras de elevações, paralelas, argolas, espaldares, escadas
   horizontais. Não é um directório de ginásios ao ar livre para seniores — e é
   por isso que a interface separa, sempre e à frente, o que está confirmado do
   que não está.

   O NÚMERO QUE MANDA NO DESENHO: dos sítios em que o OpenStreetMap diz o que
   lá está, 57 % têm barras. Nos outros — a esmagadora maioria — não se sabe.
   Fingir que se sabe seria mandar alguém dar vinte minutos de carro para ir
   encontrar uma bicicleta estática. Por isso:
     · os sítios com barras confirmadas são maiores e da cor da marca;
     · os por confirmar são cinzentos e dizem-no;
     · e há sempre uma forma de VER o sítio antes de lá ir — satélite e Street
       View, que é o que o dono pediu e é o que resolve mesmo o problema.

   O mapa está em mapa.js, com dois condutores (Google Maps quando há chave,
   MapLibre sempre). Aqui não se sabe qual está a correr.
*/
'use strict';

/* Portugal continental. Enquadrar o país todo — Açores a -31,4° — dá um ecrã
   cheio de oceano com três manchas nos cantos. As ilhas chegam-se pela procura
   ou pelo «perto de mim», e o mapa vai lá ter sozinho. */
const CONTINENTE = [[-9.65, 36.90], [-6.15, 42.20]];

const BASE = document.documentElement.dataset.base || '/';

/* A ORTOFOTO DO SÍTIO — e é isto que responde a «tem mesmo barras?».
   Ortofotografia oficial da Direção-Geral do Território, CC-BY 4.0, com cerca
   de 25 cm por pixel: a esta escala vê-se o pórtico das barras, o piso e as
   árvores à volta.

   Vem como <img> e não como camada do mapa, e não foi por preguiça: o servidor
   da DGT manda o cabeçalho `Access-Control-Allow-Origin` DUAS VEZES, e a
   especificação do CORS exige exactamente um. Medido nos três modos —
   `fetch` falha, `<img crossOrigin>` falha, `<img>` simples funciona. O
   MapLibre precisa de CORS para as texturas de WebGL, logo não os pode usar;
   uma imagem numa ficha pode. E, pensando bem, é aqui que serve melhor. */
const ORTO_WMS = 'https://cartografia.dgterritorio.gov.pt/ortos2018/service' +
  '?service=WMS&version=1.3.0&request=GetMap&layers=Ortos2018-RGB&styles=' +
  '&crs=EPSG:3857&format=image/png';
/* 130 m de lado. A 25 cm/px são ~520 px de imagem real; pedimos 480x360, que
   enche um cartão sem desperdiçar largura de banda de um servidor público. */
const ORTO_METROS = 130;

function urlOrtofoto(lat, lon, largura, altura) {
  const R = 20037508.342789244;
  const x = lon * R / 180;
  const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * R / 180;
  const dx = ORTO_METROS / 2;
  const dy = dx * (altura / largura);
  return `${ORTO_WMS}&bbox=${x - dx},${y - dy},${x + dx},${y + dy}` +
    `&width=${largura}&height=${altura}`;
}

const APARELHOS = {
  barra_fixa: 'Barra fixa',
  paralelas: 'Barras paralelas',
  escada_horizontal: 'Escada horizontal',
  argolas: 'Argolas',
  espaldar: 'Espaldar',
  flexoes: 'Apoio para flexões',
  abdominais: 'Banco de abdominais',
  lombares: 'Banco lombar',
  alongamento: 'Barras de alongamento',
  agachamento: 'Agachamento',
  trave: 'Trave de equilíbrio',
  equilibrio: 'Passadeira de equilíbrio',
  caixa: 'Caixa de saltos',
  escadas: 'Escadas',
  barreiras: 'Barreiras',
  slalom: 'Slalom',
  corda: 'Corda',
  escalada: 'Escalada',
  slackline: 'Slackline',
};

/* Os aparelhos que fazem de um sítio um sítio de CALISTENIA: dá para suportar
   o peso do corpo neles. Os outros são extras. */
const NUCLEO = ['barra_fixa', 'paralelas', 'escada_horizontal', 'argolas', 'espaldar'];

const ESCALAO = {
  1: {
    rotulo: 'Barras confirmadas', classe: 'selo--ok',
    diz: 'Os dados indicam barras neste sítio — dá para fazer elevações.',
  },
  2: {
    rotulo: 'Peso corporal', classe: 'selo--info',
    diz: 'Há equipamento para trabalhar com o peso do corpo, mas nenhuma barra ' +
         'está nomeada nos dados. Vale a pena ver as imagens antes de ir.',
  },
  3: {
    rotulo: 'Por confirmar', classe: 'selo--dubio',
    diz: 'Sabemos que há equipamento de exercício aqui, mas não sabemos qual. ' +
         'Pode ter barras ou ser só um circuito de máquinas — vê as imagens.',
  },
  4: {
    rotulo: 'Só máquinas', classe: 'selo--maquina',
    diz: 'O que está registado são máquinas guiadas, do tipo dos circuitos ' +
         'para seniores. Sem barras para calistenia.',
  },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const E = {
  q: $('#q'), limpar: $('#limpar'), lista: $('#lista'), contagem: $('#contagem'),
  ordem: $('#ordem'), app: $('#app'), ficha: $('#ficha'), fichaCorpo: $('#ficha-corpo'),
  anuncio: $('#anuncio'), mapaCarregar: $('#mapa-carregar'), sugestoes: $('#sugestoes'),
  satelite: $('#satelite'),
};

const estado = {
  spots: [],
  vistos: [],
  zonas: null,          // carregadas só quando alguém procura
  zonaActiva: null,
  eu: null,
  ordem: 'concelho',
  // `maquinas` começa FALSO de propósito: esta aplicação é sobre barras para
  // elevações, não sobre circuitos de máquinas guiadas para seniores. Os que os
  // dados identificam como sendo só máquinas ficam de fora até alguém os pedir.
  filtros: { perto: false, barras: false, luz: false, h24: false, acess: false,
             maquinas: false },
  termo: '',
  activo: null,
  satelite: false,
};

/* ---------------------------------------------------------------- utilidades */

function normalizar(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function distanciaKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function formatarDistancia(km) {
  if (km == null) return '';
  if (km < 1) return Math.round(km * 1000) + ' m';
  if (km < 10) return km.toFixed(1).replace('.', ',') + ' km';
  return Math.round(km) + ' km';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function anunciar(txt) { E.anuncio.textContent = txt; }

/* «Área Metropolitana de Lisboa» contém «Lisboa», e por isso procurar «lisboa»
   arrastava Setúbal e Cascais à frente de metade dos parques da cidade. As
   outras regiões — Norte, Centro, Alentejo, Algarve, as ilhas — não colidem
   com nome nenhum de concelho e ficam, que procurar «algarve» faz-se. */
function regiaoProcuravel(r) {
  return (!r || /^Área Metropolitana/i.test(r)) ? '' : r;
}

/* ------------------------------------------------------------------ arranque */

async function arrancar() {
  aplicarTema(localStorage.getItem('cs:tema'));
  ligarBotoes();

  let dados;
  try {
    const r = await fetch(BASE + 'data/spots.json', { cache: 'default' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    dados = await r.json();
  } catch (err) {
    E.lista.innerHTML = `<li class="vazio">
      <h3>Não consegui carregar os sítios</h3>
      <p>Verifica a ligação à internet e tenta outra vez.</p>
      <button class="botao" type="button" onclick="location.reload()">Tentar de novo</button>
    </li>`;
    return;
  }

  const lista = Array.isArray(dados) ? dados : (dados.spots || []);
  estado.meta = Array.isArray(dados) ? null : dados.meta;
  estado.spots = lista.map((s, i) => Object.assign({}, s, {
    i,
    // Dois índices: `forte` é o que uma pessoa escreve quando quer um sítio;
    // `fraco` ajuda a encontrar mas não manda na ordem dos resultados.
    forte: normalizar([s.nome, s.loc, s.con].join(' ')),
    fraco: normalizar([s.dis, regiaoProcuravel(s.reg), s.rua].join(' ')),
  }));

  contarFiltros();
  medirBarras();
  desenhar();
  prepararMapa();
  // 11 KB. Carregado aqui, a primeira letra escrita já encontra concelhos.
  carregarZonas();

  abrirDoEndereco();
  addEventListener('hashchange', abrirDoEndereco);
}

function abrirDoEndereco() {
  const m = location.hash.match(/s=(\d+)/);
  if (!m) return;
  const s = estado.spots[+m[1]];
  if (!s) return;
  if (estado.activo === s.i && E.ficha.dataset.aberta === '1') return;
  abrirFicha(s, { voar: true });
}

/* A barra de filtros e a nota da localização não têm altura fixa: a nota quebra
   em duas linhas num telemóvel estreito. Adivinhar «51 px» no CSS punha o mapa
   a transbordar do ecrã. Mede-se. */
function medirBarras() {
  const medir = () => {
    const f = document.querySelector('.filtros');
    const n = $('#nota-local');
    const r = document.documentElement.style;
    if (f) r.setProperty('--filtros-h', Math.round(f.getBoundingClientRect().height) + 'px');
    if (n) r.setProperty('--nota-h', Math.round(n.getBoundingClientRect().height) + 'px');
  };
  medir();
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(medir);
    for (const sel of ['.filtros', '#nota-local']) {
      const el = document.querySelector(sel);
      if (el) ro.observe(el);
    }
  } else {
    addEventListener('resize', medir);
  }
}

/* ------------------------------------------------------------------- filtrar */

function filtrar() {
  const t = normalizar(estado.termo);
  const palavras = t ? t.split(' ').filter(Boolean) : [];
  const f = estado.filtros;

  // ESCOLHER UMA ZONA É DIFERENTE DE ESCREVER O NOME DELA. Escolhida a zona,
  // o filtro é o CONCELHO e mais nada. Sem isto, escolher «Viana do Castelo»
  // mostrava os parques de Caminha: o texto «viana do castelo» está no
  // DISTRITO de Caminha, e a procura por texto casava-o.
  const zona = estado.zonaActiva;

  const out = estado.spots.filter(s => {
    if (!f.maquinas && s.esc === 4) return false;
    if (zona) return s.con === zona.n;
    if (f.barras && s.esc !== 1) return false;
    if (f.luz && s.lit !== 'yes') return false;
    if (f.h24 && !s.h24) return false;
    if (f.acess && s.wc !== 'yes') return false;
    if (palavras.length && !zona) {
      let nota = 0;
      for (const p of palavras) {
        const nf = s.forte.includes(p);
        if (!nf && !s.fraco.includes(p)) return false;
        if (nf) nota += s.forte.startsWith(p) ? 3 : 2;
      }
      s.nota = nota;
    } else {
      s.nota = 0;
    }
    return true;
  });

  for (const s of out) s.km = estado.eu ? distanciaKm(estado.eu, s) : null;

  if (estado.ordem === 'perto' && estado.eu) {
    out.sort((a, b) => a.km - b.km);
  } else if (palavras.length && !zona) {
    out.sort((a, b) => b.nota - a.nota ||
      (a.con || '').localeCompare(b.con || '', 'pt') ||
      (a.nome || '').localeCompare(b.nome || '', 'pt'));
  } else {
    // Sem procura e sem localização, os CONFIRMADOS vêm primeiro. É o que a
    // aplicação promete; deixá-los soterrados por ordem alfabética entre 744
    // «por confirmar» seria escondê-los.
    out.sort((a, b) => (a.esc === 1 ? 0 : 1) - (b.esc === 1 ? 0 : 1) ||
      (a.con || '').localeCompare(b.con || '', 'pt') ||
      (a.nome || '').localeCompare(b.nome || '', 'pt'));
  }
  return out;
}

function contarFiltros() {
  const n = (fn) => estado.spots.filter(fn).length;
  $('#n-barras').textContent = n(s => s.esc === 1);
  $('#n-luz').textContent = n(s => s.lit === 'yes');
  $('#n-24').textContent = n(s => s.h24);
  $('#n-acess').textContent = n(s => s.wc === 'yes');
  const nm = $('#n-maquinas');
  if (nm) nm.textContent = n(s => s.esc === 4);
}

/* -------------------------------------------------------------------- lista */

const LOTE = 40;
let porDesenhar = [];

function desenhar() {
  estado.vistos = filtrar();
  const n = estado.vistos.length;
  const nb = estado.vistos.filter(s => s.esc === 1).length;

  E.contagem.innerHTML = n === estado.spots.length
    ? `<strong>${n}</strong> sítios · <strong>${nb}</strong> com barras confirmadas`
    : `<strong>${n}</strong> ${n === 1 ? 'sítio' : 'sítios'}` +
      (nb ? ` · ${nb} com barras` : '');
  E.ordem.textContent = estado.ordem === 'perto' ? 'mais perto primeiro' : 'confirmados primeiro';
  E.ordem.hidden = !estado.eu;

  E.lista.innerHTML = '';
  if (!n) { desenharVazio(); Mapa.definirPontos([]); return; }

  porDesenhar = estado.vistos.slice();
  desenharLote();
  Mapa.definirPontos(estado.vistos);
  anunciar(`${n} ${n === 1 ? 'sítio encontrado' : 'sítios encontrados'}.`);
}

function desenharLote() {
  const frag = document.createDocumentFragment();
  for (const s of porDesenhar.splice(0, LOTE)) frag.appendChild(cartao(s));
  E.lista.appendChild(frag);

  const antigo = $('#mais');
  if (antigo) antigo.remove();
  if (porDesenhar.length) {
    const li = document.createElement('li');
    li.id = 'mais';
    li.style.cssText = 'height:1px;list-style:none';
    E.lista.appendChild(li);
    observador.observe(li);
  }
}

const observador = new IntersectionObserver(entradas => {
  for (const e of entradas) {
    if (e.isIntersecting) { observador.unobserve(e.target); desenharLote(); }
  }
}, { root: document.querySelector('.painel__rolar'), rootMargin: '400px' });

function cartao(s) {
  const li = document.createElement('li');
  const e = ESCALAO[s.esc];
  // Só os aparelhos do NÚCLEO aparecem no cartão. Uma «caixa de saltos» ao lado
  // de «Barras paralelas» dilui exactamente a informação que interessa.
  const ap = s.ap.filter(a => NUCLEO.includes(a)).slice(0, 3);
  const onde = [s.loc && s.loc !== s.nome ? s.loc : null, s.con].filter(Boolean).join(' · ');

  li.innerHTML = `<button class="cartao${s.esc === 1 ? ' cartao--top' : ''}" type="button" data-i="${s.i}">
    <span class="cartao__topo">
      <span class="cartao__nome">${esc(s.nome)}</span>
      ${s.km != null ? `<span class="cartao__dist">${formatarDistancia(s.km)}</span>` : ''}
    </span>
    <span class="cartao__onde">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="2.6"/></svg>
      ${esc(onde)}
    </span>
    <span class="cartao__marcas">
      <span class="selo ${e.classe}">${esc(e.rotulo)}</span>
      ${ap.map(a => `<span class="selo selo--ap">${esc(APARELHOS[a])}</span>`).join('')}
      ${s.h24 ? '<span class="selo selo--ap">24 h</span>' : ''}
    </span>
  </button>`;
  return li;
}

function desenharVazio() {
  const temFiltro = Object.values(estado.filtros).some(Boolean);
  // Uma zona escolhida e sem nada é um caso à parte, e merece a verdade em vez
  // de um «nada por aqui» genérico: o concelho existe, o mapa está lá, e o que
  // falta é alguém mapear. Dizê-lo é o convite.
  const z = estado.zonaActiva;
  if (z && !temFiltro) {
    E.lista.innerHTML = `<li class="vazio">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 7.5 10 4l4 2 6-2.5v13L14 19l-4-2-6 2.5z"/><path d="M10 4v13M14 6v13"/></svg>
      <h3>Ainda não há nada em ${esc(z.n)}</h3>
      <p>O concelho está assinalado no mapa, mas ninguém registou aqui nenhum
      sítio com barras. Se conheces algum, é rápido acrescentá-lo.</p>
      <a class="botao" href="${BASE}contribuir/">Como acrescentar um sítio</a>
      <p style="margin-top:1rem"><button class="botao botao--fantasma" type="button" id="limpar-tudo">Ver o país inteiro</button></p>
    </li>`;
    const b = $('#limpar-tudo');
    if (b) b.addEventListener('click', limparTudo);
    return;
  }
  E.lista.innerHTML = `<li class="vazio">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
    <h3>Nada por aqui</h3>
    <p>${estado.termo
      ? 'Não há sítios com esse nome. Tenta o nome do concelho.'
      : 'Nenhum sítio corresponde aos filtros escolhidos.'}</p>
    ${temFiltro || estado.termo
      ? '<button class="botao botao--fantasma" type="button" id="limpar-tudo">Limpar tudo</button>'
      : ''}
  </li>`;
  const b = $('#limpar-tudo');
  if (b) b.addEventListener('click', limparTudo);
}

function limparTudo() {
  estado.termo = '';
  E.q.value = '';
  E.limpar.hidden = true;
  for (const k of Object.keys(estado.filtros)) estado.filtros[k] = false;
  for (const b of $$('.chip')) b.setAttribute('aria-pressed', 'false');
  esconderZona();
  desenhar();
  E.q.focus();
}

/* -------------------------------------------------------------------- ficha */

function abrirFicha(s, { voar = false } = {}) {
  estado.activo = s.i;
  const e = ESCALAO[s.esc];
  const nucleo = s.ap.filter(a => NUCLEO.includes(a));
  const extras = s.ap.filter(a => APARELHOS[a] && !NUCLEO.includes(a));

  const onde = [s.rua, s.loc, s.con, s.dis].filter((v, i, a) => v && a.indexOf(v) === i);

  // «Navegar pelo Google Maps» faz-se com uma LIGAÇÃO, não com um mapa
  // embebido. É grátis, não precisa de chave nem de conta de facturação, e
  // abre a aplicação nativa. Um iframe do Google arrastava cookies do Google
  // para dentro desta página e obrigava a um banner de consentimento
  // (acórdão Fashion ID, C-40/17).
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=walking`;
  const amaps = `https://maps.apple.com/?daddr=${s.lat},${s.lon}&dirflg=w`;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // Estes dois são o que responde mesmo à pergunta «isto tem barras?»:
  // ver o sítio de cima e ver o sítio ao nível do chão. Ambos sem chave.
  const satelite = `https://www.google.com/maps/@?api=1&map_action=map&center=${s.lat},${s.lon}&zoom=20&basemap=satellite`;
  const pano = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}`;
  const osm = `https://www.openstreetmap.org/note/new#map=19/${s.lat}/${s.lon}`;

  E.fichaCorpo.innerHTML = `
    <h2 class="ficha__titulo" id="ficha-titulo">${esc(s.nome)}</h2>
    <p class="ficha__onde">${esc(onde.join(' · '))}</p>
    <div class="ficha__marcas">
      <span class="selo ${e.classe}">${esc(e.rotulo)}</span>
      ${s.km != null ? `<span class="selo selo--ap">a ${formatarDistancia(s.km)} de ti</span>` : ''}
      ${s.h24 ? '<span class="selo selo--ap">Aberto 24 h</span>' : ''}
      ${s.lit === 'yes' ? '<span class="selo selo--ap">Iluminado</span>' : ''}
      ${s.wc === 'yes' ? '<span class="selo selo--ap">Acessível</span>' : ''}
    </div>

    <div class="ficha__seccao" id="ficha-imagens">
      <p class="ficha__rotulo">Ver o sítio</p>
      <div class="imagens" id="imagens">
        <a class="imagem imagem--orto" href="${satelite}" target="_blank" rel="noopener noreferrer"
           title="Ortofoto da DGT — abrir em ecrã inteiro no Google Maps">
          <img src="${urlOrtofoto(s.lat, s.lon, 480, 360)}" width="480" height="360"
               alt="Vista aérea de ${esc(s.nome)}" loading="lazy" decoding="async"
               onerror="this.closest('.imagem').remove()">
          <span class="imagem__etiqueta">Vista aérea · DGT</span>
        </a>
        <a class="imagem imagem--acao" href="${satelite}" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20z"/><circle cx="12" cy="12" r="9.5"/></svg>
          <span>Vista de satélite</span>
        </a>
        <a class="imagem imagem--acao" href="${pano}" target="_blank" rel="noopener noreferrer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="9" r="3.2"/><path d="M4.5 19c1.6-3.4 4.3-5 7.5-5s5.9 1.6 7.5 5"/></svg>
          <span>Street View</span>
        </a>
      </div>
      <p class="ficha__nota">A vista aérea é a ortofotografia oficial da
      <a href="https://www.dgterritorio.gov.pt/" target="_blank" rel="noopener">Direção-Geral
      do Território</a> (CC BY 4.0), com cerca de 25 cm por pixel — dá para ver
      o pórtico das barras. Só cobre o continente.</p>
    </div>

    ${nucleo.length ? `
      <div class="ficha__seccao">
        <p class="ficha__rotulo">Barras e equipamento de peso corporal</p>
        <ul class="lista-ap">
          ${nucleo.map(a => `<li class="lista-ap__nucleo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>
            ${esc(APARELHOS[a])}</li>`).join('')}
          ${extras.map(a => `<li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="3"/></svg>
            ${esc(APARELHOS[a])}</li>`).join('')}
        </ul>
      </div>` : ''}

    <div class="ficha__seccao">
      <div class="aviso">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 7.6v.6"/></svg>
        <span>${esc(e.diz)} ${s.n > 1
          ? `Estão registados <strong>${s.n} aparelhos</strong> aqui.`
          : 'Está registado <strong>1 aparelho</strong> aqui.'}</span>
      </div>
    </div>

    <div class="ficha__acoes">
      <a class="botao" href="${ios ? amaps : gmaps}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M3 11l18-8-8 18-2-8-8-2z"/></svg>
        Como chegar
      </a>
      <a class="ficha__alt" href="${ios ? gmaps : amaps}" target="_blank" rel="noopener noreferrer">
        ou abrir no ${ios ? 'Google Maps' : 'Apple Maps'}
      </a>
      <button class="botao botao--fantasma" type="button" id="partilhar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 3v13M8 7l4-4 4 4M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"/></svg>
        Partilhar
      </button>
      <a class="botao botao--fantasma" href="${osm}" target="_blank" rel="noopener noreferrer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M11 4h2M4 11v2M20 11v2M11 20h2M7.5 4.8 6 6.3M18 17.7l-1.5-1.5M6 17.7l1.5-1.5M16.5 4.8 18 6.3"/><circle cx="12" cy="12" r="3.4"/></svg>
        ${s.osm && s.osm.length ? 'Corrigir no OpenStreetMap' : 'Acrescentar ao OpenStreetMap'}
      </a>
    </div>

    <div class="ficha__seccao">
      <p class="ficha__rotulo">Fonte</p>
      <p class="ficha__fonte">
        ${s.osm && s.osm.length
          ? `Dados do <a href="https://www.openstreetmap.org/${esc(traduzirOsm(s.osm[0]))}" target="_blank" rel="noopener">OpenStreetMap</a>, sob licença ODbL.`
          : ''}
        ${(s.fontes || []).includes('CML')
          ? '<a href="https://geodados-cml.hub.arcgis.com/" target="_blank" rel="noopener">Câmara Municipal de Lisboa</a> (CC0).'
          : ''}
        Concelho e distrito da CAOP (DGT).
      </p>
    </div>`;

  E.ficha.hidden = false;
  void E.ficha.offsetHeight;
  E.ficha.dataset.aberta = '1';

  const p = $('#partilhar');
  if (p) p.addEventListener('click', () => partilhar(s));

  for (const b of $$('.cartao')) {
    b.setAttribute('aria-current', b.dataset.i === String(s.i) ? 'true' : 'false');
  }

  if (voar || innerWidth >= 900) Mapa.irPara(s.lat, s.lon, CONFIG.zoomDoSitio);
  Mapa.marcarActivo(s.i);
  history.replaceState(null, '', '#s=' + s.i);
}

/* ------------------------------------------------------------------ a MIRA */
/* O QUE ISTO RESOLVE. O OpenStreetMap tem cerca de 900 sítios em Portugal e
   129 dos 308 concelhos estão a zero. Não é a consulta que está mal — foram
   verificados todos os baldes de etiquetas, não há mais nada lá. Simplesmente
   ninguém os mapeou, e quem treina na rua sabe de sítios que não estão em fonte
   nenhuma.

   PORQUE UMA MIRA E NÃO UM TOQUE NO MAPA. Num telemóvel, tocar num ponto falha
   por dez ou vinte metros e não há como corrigir sem repetir. Arrastar o mapa
   até a cruz ficar por cima das barras é a manobra que toda a gente já faz no
   Google Maps para largar um alfinete, e vê-se o que se está a escolher até ao
   último momento.

   PORQUE VAI PARAR AO GITHUB. O site não tem servidor e não vai ter — é essa a
   condição do projecto. Um assunto no GitHub com a coordenada já preenchida não
   custa nada, não precisa de conta nenhuma nova aqui, e deixa rasto público. */
const NUM_MIRA = 5;   // ~1,1 m; mais casas seria fingir precisão que não há

function ligarMira() {
  const mira = $('#mira');
  const botao = $('#falta');
  if (!mira || !botao) return;
  const coord = $('#mira-coord');
  const abrir = $('#mira-abrir');

  function actualizar() {
    const c = Mapa.centro();
    if (!c) return;
    const lat = c.lat.toFixed(NUM_MIRA);
    const lon = c.lon.toFixed(NUM_MIRA);
    coord.textContent = lat + ', ' + lon;
    // O formulário do GitHub aceita valores por endereço, com o id do campo.
    abrir.href = CONFIG.repo + '/issues/new?template=novo-sitio.yml' +
      '&title=' + encodeURIComponent('Sítio novo: ') +
      '&coordenadas=' + encodeURIComponent(lat + ', ' + lon);
    // Abaixo do zoom 15 a cruz cobre um quarteirão inteiro e a coordenada não
    // vale nada. Mais vale dizê-lo do que receber um ponto no meio do nada.
    const perto = c.zoom >= 15;
    abrir.classList.toggle('botao--desligado', !perto);
    abrir.setAttribute('aria-disabled', String(!perto));
    $('#mira .mira__diz').innerHTML = perto
      ? 'Arrasta o mapa até <strong>por cima das barras</strong>.'
      : '<strong>Aproxima mais</strong> — daqui de cima a cruz tapa um quarteirão.';
  }

  function ligar(sim) {
    mira.hidden = !sim;
    botao.setAttribute('aria-pressed', String(sim));
    if (sim) {
      actualizar();
      Mapa.aoMudarVista(() => actualizar());
    } else {
      Mapa.aoMudarVista(null);
    }
  }

  botao.addEventListener('click', () => ligar(mira.hidden));
  $('#mira-cancelar').addEventListener('click', () => ligar(false));
  abrir.addEventListener('click', ev => {
    if (abrir.getAttribute('aria-disabled') === 'true') { ev.preventDefault(); return; }
    ligar(false);
  });
  addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && !mira.hidden) ligar(false);
  });
}

function traduzirOsm(id) {
  if (!id) return '';
  const t = { n: 'node', w: 'way', r: 'relation' }[id[0]] || 'node';
  return `${t}/${id.slice(1)}`;
}

function fecharFicha() {
  E.ficha.dataset.aberta = '0';
  estado.activo = null;
  for (const b of $$('.cartao')) b.setAttribute('aria-current', 'false');
  Mapa.marcarActivo(null);
  history.replaceState(null, '', location.pathname);
  setTimeout(() => { if (E.ficha.dataset.aberta === '0') E.ficha.hidden = true; }, 320);
}

async function partilhar(s) {
  const url = location.origin + location.pathname + '#s=' + s.i;
  const dados = { title: `${s.nome} — Calisthenics Spots`, text: `Barras em ${s.nome}, ${s.con}`, url };
  if (navigator.share) {
    try { await navigator.share(dados); return; } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    anunciar('Ligação copiada.');
  } catch (err) {
    prompt('Copia a ligação:', url);
  }
}

/* ------------------------------------------------------ pesquisa por ZONA */

/* Os 308 concelhos vêm em DOIS pedaços, e a divisão é o que faz a procura
   parecer instantânea:

     · o ÍNDICE (11 KB comprimidos) tem nome, distrito, caixa envolvente e
       contagem. Carrega-se com a aplicação e chega para procurar E para
       enquadrar o mapa no mesmo instante em que se carrega na sugestão;
     · o CONTORNO de cada concelho (~1 KB) só se vai buscar ao escolhido.

   São os 308, e não só os 176 que têm sítios. Escrever «Viana do Castelo» —
   que tem zero sítios registados — não encontrava nada e caía em «Caminha»,
   que casa pela palavra do distrito: o mapa saltava para o concelho errado sem
   dizer nada. Agora encontra-o, desenha-o, e diz que ali ainda não há nada. */
async function carregarZonas() {
  if (estado.zonas) return estado.zonas;
  try {
    const r = await fetch(BASE + 'data/concelhos.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    estado.zonas = (j.zonas || []).map((z, i) => Object.assign({}, z, { i }));
  } catch (err) {
    estado.zonas = [];
  }
  return estado.zonas;
}

const contornosEmCache = new Map();

async function contornoDe(z) {
  if (contornosEmCache.has(z.c)) return contornosEmCache.get(z.c);
  try {
    const r = await fetch(BASE + 'data/limites/' + z.c + '.json');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    contornosEmCache.set(z.c, j.p || null);
    return j.p || null;
  } catch (err) {
    contornosEmCache.set(z.c, null);   // não voltar a tentar em cada tecla
    return null;
  }
}

function zonasQueCasam(termo) {
  if (!estado.zonas || !termo) return [];
  const t = normalizar(termo);
  if (!t) return [];
  return estado.zonas
    .filter(z => z.k.includes(t))
    .sort((a, b) => (a.k.startsWith(t) ? 0 : 1) - (b.k.startsWith(t) ? 0 : 1) || b.q - a.q)
    .slice(0, 5);
}

function mostrarSugestoes(zonas) {
  if (!E.sugestoes) return;
  if (!zonas.length) { E.sugestoes.hidden = true; E.sugestoes.innerHTML = ''; return; }
  E.sugestoes.innerHTML = zonas.map(z => `
    <li><button type="button" class="sugestao" data-zona="${z.i}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><path d="M4 7.5 10 4l4 2 6-2.5v13L14 19l-4-2-6 2.5z"/><path d="M10 4v13M14 6v13"/></svg>
      <span class="sugestao__nome">${esc(z.n)}</span>
      <span class="sugestao__sub">${esc(z.d)} · ${z.q} ${z.q === 1 ? 'sítio' : 'sítios'}</span>
    </button></li>`).join('');
  E.sugestoes.hidden = false;
}

async function irParaZona(z) {
  estado.zonaActiva = z;
  // O ENQUADRAMENTO É IMEDIATO, com a caixa que já veio no índice. O contorno
  // chega uns 100 ms depois e desenha-se por cima. Esperar pelo contorno para
  // mexer o mapa fazia a procura parecer lenta sem necessidade nenhuma.
  Mapa.enquadrar([[z.b[0], z.b[1]], [z.b[2], z.b[3]]], 50);
  estado.termo = z.n;
  E.q.value = z.n;
  E.limpar.hidden = false;
  mostrarSugestoes([]);
  desenhar();
  if (innerWidth < 900) mudarVista('mapa');
  anunciar(z.q
    ? `${z.n} assinalado no mapa, com ${z.q} ${z.q === 1 ? 'sítio' : 'sítios'}.`
    : `${z.n} assinalado no mapa. Ainda não há sítios registados aqui.`);

  const aneis = await contornoDe(z);
  if (!aneis || estado.zonaActiva !== z) return;   // já mudou de zona entretanto
  Mapa.mostrarZona({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature', properties: { nome: z.n },
      geometry: { type: 'MultiPolygon', coordinates: aneis.map(anel => [anel]) },
    }],
  });
}

function esconderZona() {
  estado.zonaActiva = null;
  Mapa.mostrarZona(null);
}

/* ------------------------------------------------------------------ o mapa */

function prepararMapa() {
  // A Google não atira uma excepção quando a chave é recusada ou a quota
  // esgota: chama esta função global e deixa um mapa escurecido com «for
  // development purposes only» por cima. Sem isto, ficava assim.
  window.gm_authFailure = () => {
    console.warn('Google Maps recusou a chave; a voltar ao mapa livre.');
    CONFIG.googleMapsKey = '';
    const el = document.getElementById('mapa');
    if (el) el.innerHTML = '';
    prepararMapa();
  };

  const escuro = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme &&
      matchMedia('(prefers-color-scheme: dark)').matches);

  Mapa.criar(document.getElementById('mapa'), {
    escuro,
    enquadrar: CONTINENTE,
    aoClicar: s => abrirFicha(s),
  }).then(condutor => {
    E.mapaCarregar.hidden = true;
    Mapa.definirPontos(estado.vistos);
    if (estado.activo != null) Mapa.marcarActivo(estado.activo);
    // O botão de satélite só existe se o condutor souber fazer satélite —
    // um botão que não faz nada é pior do que não ter botão.
    if (E.satelite) E.satelite.hidden = !Mapa.temSatelite();
    document.body.dataset.mapa = condutor;
  }).catch(err => {
    console.warn('mapa:', err);
    semMapa('Este browser não conseguiu abrir o mapa. A lista continua a funcionar.');
  });
}

/* O mapa é um extra. Quando falha, a aplicação não fica meia: esconde-se o
   separador «Mapa» no telemóvel, para não haver um botão que abre uma caixa
   cinzenta, e fica-se na lista. */
function semMapa(mensagem) {
  E.mapaCarregar.hidden = false;
  E.mapaCarregar.textContent = mensagem;
  const b = $('#v-mapa');
  if (b) b.hidden = true;
  for (const id of ['localizar', 'todo-pais', 'satelite']) {
    const x = $('#' + id);
    if (x) x.hidden = true;
  }
  E.app.dataset.vista = 'lista';
}

/* ------------------------------------------------------------- localização */

function ondeEstou({ centrar = true } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(2); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        estado.eu = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (centrar) Mapa.irPara(estado.eu.lat, estado.eu.lon, 13);
        resolve(true);
      },
      err => resolve(err && err.code ? err.code : 2),
      // 8 s e não 30: numa aplicação instalada no iOS o pedido fica pendurado
      // sem nunca chamar nem o sucesso nem o erro, e um botão preso é pior do
      // que uma mensagem. Reportado desde 2021 e ainda por resolver.
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
    );
  });
}

/* Três causas, três frases. «Não consegui saber onde estás» não diz a ninguém o
   que fazer a seguir; «recusaste a permissão» diz. E em todas se aponta para o
   caminho que funciona sempre: escrever o nome do concelho. */
const ERRO_LOCAL = {
  1: 'Recusaste o acesso à localização. Podes voltar a permitir nas definições ' +
     'do browser para este site — ou escrever o nome do concelho aqui em cima.',
  2: 'O aparelho não conseguiu determinar onde estás. Acontece dentro de ' +
     'edifícios e com o GPS desligado. Escreve o nome do concelho aqui em cima.',
  3: 'A localização demorou demasiado a responder. Se instalaste o site como ' +
     'aplicação no iPhone, abre-o antes no Safari. Ou procura pelo concelho.',
};

function avisarLocalizacao(codigo) {
  const b = $('#f-perto');
  if (b) b.setAttribute('aria-pressed', 'false');
  const msg = ERRO_LOCAL[codigo] || ERRO_LOCAL[2];
  anunciar(msg);
  alert(msg);
}

/* --------------------------------------------------------------------- tema */

function aplicarTema(t) {
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
  const escuro = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme &&
      matchMedia('(prefers-color-scheme: dark)').matches);
  const ic = $('#tema-icone');
  if (ic) {
    ic.innerHTML = escuro
      ? '<circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.6M12 19.4V22M2 12h2.6M19.4 12H22M4.9 4.9l1.9 1.9M17.2 17.2l1.9 1.9M19.1 4.9l-1.9 1.9M6.8 17.2l-1.9 1.9"/>'
      : '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>';
  }
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = escuro ? '#110F15' : '#F6F3EE';
}

/* ------------------------------------------------------------------ ligações */

function ligarBotoes() {
  let temporizador;
  E.q.addEventListener('input', async () => {
    E.limpar.hidden = !E.q.value;
    if (!E.q.value) { esconderZona(); mostrarSugestoes([]); }
    clearTimeout(temporizador);
    temporizador = setTimeout(async () => {
      // Mexer no texto desfaz a zona escolhida: a pessoa está a procurar
      // outra coisa, e deixar o filtro do concelho pendurado dava zero
      // resultados sem se perceber porquê.
      if (estado.zonaActiva && E.q.value !== estado.zonaActiva.n) esconderZona();
      estado.termo = E.q.value;
      desenhar();
      if (E.q.value.length >= 2) {
        await carregarZonas();
        mostrarSugestoes(zonasQueCasam(E.q.value));
      } else {
        mostrarSugestoes([]);
      }
    }, 110);
  });
  E.q.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') {
      E.q.value = ''; E.limpar.hidden = true; estado.termo = '';
      esconderZona(); mostrarSugestoes([]); desenhar();
    }
    if (ev.key === 'Enter' && E.sugestoes && !E.sugestoes.hidden) {
      const b = E.sugestoes.querySelector('.sugestao');
      if (b) { ev.preventDefault(); b.click(); }
    }
    if (ev.key === 'ArrowDown' && E.sugestoes && !E.sugestoes.hidden) {
      const b = E.sugestoes.querySelector('.sugestao');
      if (b) { ev.preventDefault(); b.focus(); }
    }
  });
  if (E.sugestoes) {
    E.sugestoes.addEventListener('click', ev => {
      const b = ev.target.closest('.sugestao');
      if (!b || !estado.zonas) return;
      const z = estado.zonas[+b.dataset.zona];
      if (z) irParaZona(z);
    });
  }
  document.addEventListener('click', ev => {
    if (E.sugestoes && !E.sugestoes.hidden &&
        !ev.target.closest('.procura') && !ev.target.closest('#sugestoes')) {
      mostrarSugestoes([]);
    }
  });
  E.limpar.addEventListener('click', () => {
    E.q.value = ''; E.limpar.hidden = true; estado.termo = '';
    esconderZona(); mostrarSugestoes([]); desenhar(); E.q.focus();
  });

  const chips = {
    'f-perto': 'perto', 'f-barras': 'barras', 'f-luz': 'luz',
    'f-24': 'h24', 'f-acess': 'acess', 'f-maquinas': 'maquinas',
  };
  for (const [id, chave] of Object.entries(chips)) {
    const b = $('#' + id);
    if (!b) continue;
    b.addEventListener('click', async () => {
      const ligar = b.getAttribute('aria-pressed') !== 'true';
      if (chave === 'perto') {
        if (ligar) {
          b.disabled = true;
          const r = estado.eu ? true : await ondeEstou({ centrar: false });
          b.disabled = false;
          if (r !== true) { avisarLocalizacao(r); return; }
          estado.ordem = 'perto';
        } else {
          estado.ordem = 'concelho';
        }
        estado.filtros.perto = ligar;
        b.setAttribute('aria-pressed', String(ligar));
        desenhar();
        return;
      }
      estado.filtros[chave] = ligar;
      b.setAttribute('aria-pressed', String(ligar));
      desenhar();
    });
  }

  E.ordem.addEventListener('click', () => {
    estado.ordem = estado.ordem === 'perto' ? 'concelho' : 'perto';
    desenhar();
  });

  E.lista.addEventListener('click', ev => {
    const b = ev.target.closest('.cartao');
    if (!b) return;
    const s = estado.spots[+b.dataset.i];
    if (s) {
      abrirFicha(s, { voar: true });
      if (innerWidth < 900) mudarVista('mapa');
    }
  });

  $('#ficha-fechar').addEventListener('click', fecharFicha);
  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && E.ficha.dataset.aberta === '1') fecharFicha();
  });

  $('#localizar').addEventListener('click', async ev => {
    const b = ev.currentTarget;           // guardado ANTES do await: depois é null
    b.disabled = true;
    const r = await ondeEstou({ centrar: true });
    b.disabled = false;
    if (r !== true) avisarLocalizacao(r);
    else desenhar();
  });

  $('#todo-pais').addEventListener('click', () => {
    esconderZona();
    Mapa.enquadrar(CONTINENTE, 30);
  });

  ligarMira();

  if (E.satelite) {
    E.satelite.addEventListener('click', () => {
      estado.satelite = !estado.satelite;
      Mapa.satelite(estado.satelite);
      E.satelite.setAttribute('aria-pressed', String(estado.satelite));
    });
  }

  $('#tema').addEventListener('click', () => {
    const escuroAgora = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme &&
        matchMedia('(prefers-color-scheme: dark)').matches);
    const novo = escuroAgora ? 'light' : 'dark';
    try { localStorage.setItem('cs:tema', novo); } catch (e) { /* modo privado */ }
    aplicarTema(novo);
  });

  $('#v-lista').addEventListener('click', () => mudarVista('lista'));
  $('#v-mapa').addEventListener('click', () => mudarVista('mapa'));
}

function mudarVista(v) {
  E.app.dataset.vista = v;
  $('#v-lista').setAttribute('aria-selected', String(v === 'lista'));
  $('#v-mapa').setAttribute('aria-selected', String(v === 'mapa'));
  // O mapa nasceu com a coluna escondida e mediu 0 px de largura.
  if (v === 'mapa') requestAnimationFrame(() => Mapa.redimensionar());
}

/* O service worker serve para o site abrir no parque, com rede fraca.
   Regista-se DEPOIS de a página estar de pé, e o `catch` engole a falha de
   propósito: em modo privado ou com o armazenamento cheio o registo atira, e
   não há razão para isso estragar a aplicação a quem só quer ver a lista. */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => {
    navigator.serviceWorker.register(BASE + 'sw.js', { updateViaCache: 'none', scope: BASE })
      .then(reg => {
        // Uma aplicação instalada no telemóvel nunca é «fechada»: fica meses no
        // multitarefas. Sem isto, nunca procuraria uma versão nova.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

arrancar();
