/* Barra Fixe — a aplicação.
   ============================================================================
   Sem dependências além do MapLibre. Um ficheiro, sem build, sem npm.

   DUAS DECISÕES QUE EXPLICAM O RESTO:

   1. O MAPA NÃO É O GOOGLE MAPS. O Google Maps JavaScript API precisa de uma
      chave de faturação, e uma chave numa página estática é pública. O projecto
      tem de custar zero, e «zero» não pode depender de ninguém se portar bem.
      O mapa que se navega é MapLibre + OpenFreeMap (vector tiles, sem chave,
      sem limite). O Google Maps entra onde interessa e onde é grátis: no botão
      «Como chegar», que abre a aplicação nativa do telemóvel a navegar para o
      sítio. É onde uma pessoa quer mesmo o Google Maps.

   2. OS DADOS SÃO 240 KB E VÊM TODOS DE UMA VEZ. 798 sítios cabem na memória
      com folga; filtrar e ordenar em JavaScript é instantâneo e não precisa de
      servidor nenhum. É por isto que a procura responde a cada tecla.
*/
'use strict';

/* Os mosaicos. O OpenFreeMap é a primeira escolha — sem chave, sem conta, sem
   limite —, mas é um projecto de UMA pessoa, financiado por donativos, com
   termos que permitem desligá-lo sem aviso. Se desaparecer, este site fica sem
   mapa. Por isso a rede de segurança: o VersaTiles é outro projecto livre,
   noutra infra-estrutura, e entra sozinho se o primeiro não responder.
   Trocar de fornecedor é mudar duas linhas aqui, e nada mais. */
const ESTILO = {
  light: 'https://tiles.openfreemap.org/styles/positron',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};
const ESTILO_RESERVA = {
  light: 'https://tiles.versatiles.org/assets/styles/neutrino/style.json',
  dark: 'https://tiles.versatiles.org/assets/styles/neutrino/style.json',
};
const ESPERA_ESTILO = 9000;

/* O enquadramento de arranque é o CONTINENTE, não «Portugal».
   Enquadrar o país todo — Açores a -31,4° e Guadiana a -6,1° — dá 25 graus de
   longitude, um zoom de 1,9 e um ecrã cheio de oceano com três manchas de terra
   nos cantos. Os Açores e a Madeira chegam-se pela procura ou pelo «perto de
   mim», e o mapa vai lá ter sozinho. */
const CONTINENTE = [[-9.65, 36.90], [-6.15, 42.20]];
const PORTUGAL_TODO = [[-31.40, 32.40], [-6.15, 42.20]];

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

/* Os quatro escalões, e exactamente o que a interface promete de cada um.
   Isto é a espinha do produto: não se chama «parque de calistenia» a um sítio
   de que só se sabe que tem qualquer coisa. */
const ESCALAO = {
  1: { rotulo: 'Barras confirmadas', classe: 'selo--ok', cor: '#E85D2A',
       diz: 'O OpenStreetMap indica barras neste sítio.' },
  2: { rotulo: 'Peso corporal', classe: 'selo--info', cor: '#0C6E7A',
       diz: 'Há equipamento de peso corporal, mas nenhuma barra está indicada.' },
  3: { rotulo: 'Por confirmar', classe: 'selo--dubio', cor: '#7C8794',
       diz: 'Sabemos que há equipamento de exercício aqui, mas não qual.' },
  4: { rotulo: 'Só máquinas', classe: 'selo--maquina', cor: '#B8860B',
       diz: 'O que está indicado são máquinas guiadas, sem barras.' },
};

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const E = {
  q: $('#q'), limpar: $('#limpar'), lista: $('#lista'), contagem: $('#contagem'),
  ordem: $('#ordem'), app: $('#app'), ficha: $('#ficha'), fichaCorpo: $('#ficha-corpo'),
  anuncio: $('#anuncio'), mapaCarregar: $('#mapa-carregar'),
};

const estado = {
  spots: [],
  vistos: [],
  eu: null,          // {lat, lon} quando a pessoa deixa
  ordem: 'concelho', // 'concelho' | 'perto'
  filtros: { perto: false, barras: false, luz: false, h24: false, acess: false },
  termo: '',
  activo: null,      // índice do sítio aberto na ficha
  mapa: null,
  mapaPronto: false,
};

/* ---------------------------------------------------------------- utilidades */

/* Sem acentos e sem pontuação, para a procura. «Évora» tem de aparecer a quem
   escreve «evora», e «Vila Nova de Gaia» a quem escreve «vila nova gaia». */
function normalizar(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/* Haversine. A esta escala a diferença para a fórmula plana é irrelevante, mas
   é barata e evita ter de justificar aproximações. */
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

/* «Área Metropolitana de Lisboa» e «do Porto» são as únicas regiões que contêm
   o nome de um concelho. Fora do índice: ninguém procura por elas, e dentro
   dele afogam a cidade que lhes dá o nome. */
function regiaoProcuravel(r) {
  if (!r) return '';
  return /^Área Metropolitana/i.test(r) ? '' : r;
}

/* ------------------------------------------------------------------ arranque */

async function arrancar() {
  aplicarTema(localStorage.getItem('bf:tema'));
  ligarBotoes();

  let dados;
  try {
    const r = await fetch('/data/spots.json', { cache: 'default' });
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

  // O ficheiro traz {meta, spots}: a atribuição da ODbL viaja com os dados, e
  // não só no rodapé. Aceita-se também o array nu, para não partir se alguém
  // tiver uma cópia antiga em cache.
  const lista = Array.isArray(dados) ? dados : (dados.spots || []);
  estado.meta = Array.isArray(dados) ? null : dados.meta;

  estado.spots = lista.map((s, i) => Object.assign({}, s, {
    i,
    // DOIS índices, e a diferença entre eles é o que faz a procura ser útil.
    //
    // `forte` é o que uma pessoa escreve quando quer um sítio: o nome, a
    // localidade, o concelho. `fraco` é o resto — distrito, região, rua — que
    // ajuda a encontrar mas não devia mandar na ordem.
    //
    // A REGIÃO É PODADA. «Área Metropolitana de Lisboa» contém «Lisboa», e por
    // isso procurar «lisboa» devolvia 286 sítios, dos quais só 72 são de Lisboa:
    // vinham Sintra, Cascais, Amadora e Oeiras à frente de metade dos parques da
    // cidade. As outras regiões — Norte, Centro, Alentejo, Algarve, as ilhas —
    // não colidem com nome nenhum de concelho e ficam, que procurar «algarve» é
    // coisa que se faz.
    forte: normalizar([s.nome, s.loc, s.con].join(' ')),
    fraco: normalizar([s.dis, regiaoProcuravel(s.reg), s.rua].join(' ')),
  }));

  contarFiltros();
  medirBarras();
  desenhar();
  prepararMapa();

  abrirDoEndereco();
  // Colar uma ligação partilhada na barra de endereço de uma página JÁ ABERTA
  // não recarrega nada — só muda o `hash`. Sem isto, o `#s=123` de um amigo não
  // fazia absolutamente nada a quem já estivesse no site.
  addEventListener('hashchange', abrirDoEndereco);
}

/* Um sítio partilhado por ligação: #s=123 */
function abrirDoEndereco() {
  const m = location.hash.match(/s=(\d+)/);
  if (!m) return;
  const s = estado.spots[+m[1]];
  if (!s) return;
  if (estado.activo === s.i && E.ficha.dataset.aberta === '1') return;
  abrirFicha(s, { voar: true });
}

/* A barra de filtros e a nota da localização não têm altura fixa: a nota quebra
   em duas linhas num telemóvel estreito, e os filtros crescem se um dia levarem
   mais um. Adivinhar «51 px» no CSS punha o mapa a transbordar do ecrã e o
   selector Lista/Mapa a flutuar sobre o nada. Mede-se. */
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

  let out = estado.spots.filter(s => {
    if (f.barras && s.esc !== 1) return false;
    if (f.luz && s.lit !== 'yes') return false;
    if (f.h24 && !s.h24) return false;
    if (f.acess && s.wc !== 'yes') return false;
    if (palavras.length) {
      // Cada palavra tem de aparecer nalgum lado — mas guarda-se ONDE, para
      // ordenar depois. Quem escreve «lisboa» quer os parques de Lisboa em
      // primeiro, não os de Cascais que só casam pela região.
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

  if (estado.eu) {
    for (const s of out) s.km = distanciaKm(estado.eu, s);
  } else {
    for (const s of out) s.km = null;
  }

  // «Perto de mim» é ao mesmo tempo um filtro e uma ordem: só faz sentido depois
  // de haver localização, e o botão trata de a pedir antes de se ligar.
  if (estado.ordem === 'perto' && estado.eu) {
    out.sort((a, b) => a.km - b.km);
  } else if (palavras.length) {
    out.sort((a, b) => b.nota - a.nota ||
      (a.con || '').localeCompare(b.con || '', 'pt') ||
      (a.nome || '').localeCompare(b.nome || '', 'pt'));
  } else {
    out.sort((a, b) => (a.con || '').localeCompare(b.con || '', 'pt') ||
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
}

/* -------------------------------------------------------------------- lista */

const LOTE = 40;
let porDesenhar = [];

function desenhar() {
  estado.vistos = filtrar();
  const n = estado.vistos.length;

  E.contagem.innerHTML = n === estado.spots.length
    ? `<strong>${n}</strong> sítios em Portugal`
    : `<strong>${n}</strong> ${n === 1 ? 'sítio' : 'sítios'}`;
  E.ordem.textContent = estado.ordem === 'perto' ? 'mais perto primeiro' : 'por concelho';
  E.ordem.hidden = !estado.eu;

  E.lista.innerHTML = '';
  if (!n) { desenharVazio(); atatualizarMapa(); return; }

  porDesenhar = estado.vistos.slice();
  desenharLote();
  atatualizarMapa();
  anunciar(`${n} ${n === 1 ? 'sítio encontrado' : 'sítios encontrados'}.`);
}

/* Desenhar 798 cartões de uma vez trava um telemóvel fraco durante meio segundo.
   Vão 40 de cada vez, e o resto só quando a pessoa chega ao fim da lista. */
function desenharLote() {
  const frag = document.createDocumentFragment();
  const lote = porDesenhar.splice(0, LOTE);
  for (const s of lote) frag.appendChild(cartao(s));
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

// A raiz é o BLOCO QUE ROLA, não a janela. Com root nulo funciona por acaso —
// o observador acaba por respeitar o recorte do antepassado — mas o rootMargin
// passa a ser medido contra a janela, e os 400 px de antecipação deixavam de
// valer o que se pensava. Explícito, é previsível.
const observador = new IntersectionObserver(entradas => {
  for (const e of entradas) {
    if (e.isIntersecting) { observador.unobserve(e.target); desenharLote(); }
  }
}, { root: document.querySelector('.painel__rolar'), rootMargin: '400px' });

function cartao(s) {
  const li = document.createElement('li');
  const e = ESCALAO[s.esc];
  const ap = s.ap.filter(a => APARELHOS[a]).slice(0, 3);
  const onde = [s.loc && s.loc !== s.nome ? s.loc : null, s.con].filter(Boolean).join(' · ');

  li.innerHTML = `<button class="cartao" type="button" data-i="${s.i}">
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
  desenhar();
  E.q.focus();
}

/* -------------------------------------------------------------------- ficha */

function abrirFicha(s, { voar = false } = {}) {
  estado.activo = s.i;
  const e = ESCALAO[s.esc];
  const ap = s.ap.filter(a => APARELHOS[a]);

  const onde = [s.rua, s.loc, s.con, s.dis].filter((v, i, a) => v && a.indexOf(v) === i);
  // «Navegar pelo Google Maps» faz-se com uma LIGAÇÃO, não com um mapa
  // embebido. A ligação é grátis, não precisa de chave nem de conta de
  // facturação, e abre a aplicação nativa no telemóvel. Um iframe do Google
  // arrastaria cookies do Google para dentro desta página e obrigaria a um
  // banner de consentimento (acórdão Fashion ID, C-40/17).
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}&travelmode=walking`;
  // No iPhone, o Apple Maps é o que a maioria tem por omissão.
  const amaps = `https://maps.apple.com/?daddr=${s.lat},${s.lon}&dirflg=w`;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
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

    ${ap.length ? `
      <div class="ficha__seccao">
        <p class="ficha__rotulo">O que lá está</p>
        <ul class="lista-ap">
          ${ap.map(a => `<li>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="m4 12.5 5 5L20 6.5"/></svg>
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
      <a class="botao botao--fantasma" href="${osm}" target="_blank" rel="noopener">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M11 4h2M4 11v2M20 11v2M11 20h2M7.5 4.8 6 6.3M18 17.7l-1.5-1.5M6 17.7l1.5-1.5M16.5 4.8 18 6.3"/><circle cx="12" cy="12" r="3.4"/></svg>
        Corrigir no OpenStreetMap
      </a>
    </div>

    <div class="ficha__seccao">
      <div class="aviso">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3z"/><path d="M12 10v4M12 17v.5"/></svg>
        <span>Este equipamento não é nosso e não é por nós mantido.
        <strong>Verifica o estado das barras antes de as usares.</strong></span>
      </div>
    </div>

    <div class="ficha__seccao">
      <p class="ficha__rotulo">Fonte</p>
      <p style="font-size:.8125rem;color:var(--ink-muted);margin:0">
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
  // Um reflow entre o `hidden=false` e o `data-aberta` para a transição correr.
  void E.ficha.offsetHeight;
  E.ficha.dataset.aberta = '1';

  const p = $('#partilhar');
  if (p) p.addEventListener('click', () => partilhar(s));

  for (const b of $$('.cartao')) {
    b.setAttribute('aria-current', b.dataset.i === String(s.i) ? 'true' : 'false');
  }

  if (estado.mapaPronto) {
    if (voar || innerWidth >= 900) {
      estado.mapa.easeTo({ center: [s.lon, s.lat], zoom: Math.max(estado.mapa.getZoom(), 15), duration: 600 });
    }
    estado.mapa.getSource('spots') && marcarActivo(s);
  }
  history.replaceState(null, '', '#s=' + s.i);
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
  marcarActivo(null);
  history.replaceState(null, '', location.pathname);
  setTimeout(() => { if (E.ficha.dataset.aberta === '0') E.ficha.hidden = true; }, 320);
}

async function partilhar(s) {
  const url = location.origin + location.pathname + '#s=' + s.i;
  const dados = { title: `${s.nome} — Barra Fixe`, text: `Barras em ${s.nome}, ${s.con}`, url };
  // navigator.share só existe em contexto seguro e em alguns browsers; e atira
  // AbortError quando a pessoa fecha o menu, o que não é um erro para mostrar.
  if (navigator.share) {
    try { await navigator.share(dados); return; } catch (err) {
      if (err && err.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    anunciar('Ligação copiada.');
    const b = $('#partilhar');
    if (b) { const t = b.lastChild; b.childNodes[b.childNodes.length - 1].textContent = ' Copiado!'; setTimeout(() => { if (t) t.textContent = ' Partilhar'; }, 1800); }
  } catch (err) {
    prompt('Copia a ligação:', url);
  }
}

/* ------------------------------------------------------------------ o mapa */

function prepararMapa() {
  if (typeof maplibregl === 'undefined') {
    // O MapLibre vem de um CDN. Se não chegar, a lista continua a funcionar —
    // não se deita a aplicação fora por causa do mapa.
    semMapa('O mapa não carregou. A lista continua a funcionar.');
    return;
  }
  const escuro = document.documentElement.dataset.theme === 'dark' ||
    (!document.documentElement.dataset.theme &&
      matchMedia('(prefers-color-scheme: dark)').matches);

  let mapa;
  try {
    mapa = new maplibregl.Map({
    container: 'mapa',
    style: escuro ? ESTILO.dark : ESTILO.light,
    bounds: CONTINENTE,
    fitBoundsOptions: { padding: 30 },
    attributionControl: false,
    // O `cooperativeGestures` evita que a página fique presa quando alguém
    // desliza o dedo por cima do mapa a tentar percorrer a página.
    cooperativeGestures: false,
    });
  } catch (err) {
    // O MapLibre ATIRA no construtor quando não há WebGL — não devolve nada
    // nem dispara `error`. Acontece em Androids velhos, em browsers com o
    // WebGL desligado por privacidade, e em qualquer Chrome lançado com
    // --disable-gpu. Sem este apanho, a excepção subia e matava o resto do
    // arranque: a ligação partilhada #s=123 deixava de abrir a ficha.
    semMapa('Este browser não suporta o mapa (falta o WebGL). A lista continua a funcionar.');
    return;
  }
  estado.mapa = mapa;
  mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

  // Se o estilo não chegar em 9 segundos, troca-se de fornecedor. Uma só vez:
  // se também o segundo falhar, é a rede da pessoa e não o servidor, e insistir
  // só faria o mapa piscar entre dois erros.
  let jaTrocou = false;
  const relogio = setTimeout(() => {
    if (estado.mapaPronto || jaTrocou) return;
    jaTrocou = true;
    console.warn('mosaicos: o fornecedor principal não respondeu; a usar a reserva');
    try { mapa.setStyle(ESTILO_RESERVA[escuro ? 'dark' : 'light']); } catch (e) {}
  }, ESPERA_ESTILO);

  // Cinto e suspensórios para o tamanho do canvas. O MapLibre mede o contentor
  // uma vez, na construção, e nunca mais olha para ele. Basta o CSS chegar
  // tarde, a coluna do mapa nascer escondida no telemóvel, ou a barra de
  // endereços do telefone encolher a janela, para ficar um mapa de 195x300
  // dentro de uma caixa de 845x609 — que foi exactamente o que aconteceu.
  if (window.ResizeObserver) {
    new ResizeObserver(() => mapa.resize()).observe(document.getElementById('mapa'));
  } else {
    addEventListener('resize', () => mapa.resize());
  }

  // `style.load`, e NÃO `load`. O `load` do MapLibre só dispara depois do
  // PRIMEIRO RENDER completo, e o render vive do requestAnimationFrame — que o
  // browser não dispara em separadores escondidos. Resultado: abrir a aplicação
  // num separador de fundo deixava-a presa em «A carregar o mapa…» com o estilo
  // já carregado e as camadas por montar. O `style.load` dispara assim que o
  // estilo é lido, esteja a página visível ou não, e é o momento certo para
  // acrescentar fontes e camadas.
  mapa.on('style.load', () => {
    clearTimeout(relogio);
    E.mapaCarregar.hidden = true;
    estado.mapaPronto = true;
    aportuguesar(mapa);

    mapa.addSource('spots', {
      type: 'geojson',
      data: geojson(estado.vistos),
      cluster: true,
      clusterRadius: 46,
      clusterMaxZoom: 12,
    });

    mapa.addLayer({
      id: 'grupos', type: 'circle', source: 'spots', filter: ['has', 'point_count'],
      paint: {
        'circle-color': '#E85D2A',
        'circle-opacity': .88,
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 40, 26],
        'circle-stroke-width': 2,
        'circle-stroke-color': 'rgba(255,255,255,.85)',
      },
    });
    mapa.addLayer({
      id: 'grupos-n', type: 'symbol', source: 'spots', filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'],
        'text-size': 12,
      },
      paint: { 'text-color': '#fff' },
    });
    mapa.addLayer({
      id: 'pontos', type: 'circle', source: 'spots', filter: ['!', ['has', 'point_count']],
      paint: {
        // A COR SEGUE A CONFIANÇA, e estava ao contrário: o laranja da marca —
        // a cor mais forte do mapa — estava nos «por confirmar», que são 89 %,
        // e os confirmados ficavam num verde discreto. Quem olhasse via um mapa
        // cheio de promessas. Agora só as barras confirmadas levam laranja; o
        // resto é ardósia, que se vê mas não se impõe.
        'circle-color': ['match', ['get', 'esc'],
          1, '#E85D2A', 2, '#0C6E7A', 4, '#B8860B', '#7C8794'],
        // E o tamanho também: um sítio confirmado é maior que um por confirmar.
        'circle-radius': ['case',
          ['boolean', ['feature-state', 'activo'], false], 12,
          ['==', ['get', 'esc'], 1], 8.5,
          6.5],
        'circle-stroke-width': 2.4,
        'circle-stroke-color': 'rgba(255,255,255,.9)',
      },
    });

    mapa.on('click', 'pontos', ev => {
      const f = ev.features[0];
      const s = estado.spots[f.properties.i];
      if (s) abrirFicha(s);
    });
    mapa.on('click', 'grupos', async ev => {
      const f = mapa.queryRenderedFeatures(ev.point, { layers: ['grupos'] })[0];
      if (!f) return;
      const z = await mapa.getSource('spots').getClusterExpansionZoom(f.properties.cluster_id);
      mapa.easeTo({ center: f.geometry.coordinates, zoom: z });
    });
    for (const c of ['pontos', 'grupos']) {
      mapa.on('mouseenter', c, () => { mapa.getCanvas().style.cursor = 'pointer'; });
      mapa.on('mouseleave', c, () => { mapa.getCanvas().style.cursor = ''; });
    }
  });

  mapa.on('error', e => {
    if (!estado.mapaPronto) {
      E.mapaCarregar.hidden = false;
      E.mapaCarregar.textContent = 'O mapa não carregou. A lista continua a funcionar.';
    }
    console.warn('mapa:', e && e.error);
  });
}

/* O mapa é um extra. Quando falha, a aplicação não fica meia: esconde-se o
   botão de «Mapa» no telemóvel, para não haver um separador que abre uma caixa
   cinzenta, e fica-se na lista. */
function semMapa(mensagem) {
  E.mapaCarregar.hidden = false;
  E.mapaCarregar.textContent = mensagem;
  const b = $('#v-mapa');
  if (b) b.hidden = true;
  for (const id of ['localizar', 'todo-pais']) {
    const x = $('#' + id);
    if (x) x.hidden = true;
  }
  E.app.dataset.vista = 'lista';
}

/* Os mosaicos do OpenFreeMap trazem os topónimos no campo `name`, que é o nome
   LOCAL: «España», «Sevilla». Mas trazem também `name:pt` para quase tudo o que
   tem exónimo. Num mapa de Portugal em português, ver «Spain» ao lado de
   «Setúbal» é uma falha de acabamento. Isto varre as camadas de texto do estilo
   e põe o português à frente, com o nome local como recurso. */
function aportuguesar(mapa) {
  let camadas;
  try { camadas = mapa.getStyle().layers || []; } catch (e) { return; }
  for (const c of camadas) {
    if (c.type !== 'symbol') continue;
    const campo = c.layout && c.layout['text-field'];
    if (!campo) continue;
    // Só se mexe nas camadas cujo texto É o nome. As que mostram alturas,
    // números de estrada ou códigos ficam como estão.
    const usaNome = JSON.stringify(campo).includes('"name"');
    if (!usaNome) continue;
    try {
      mapa.setLayoutProperty(c.id, 'text-field',
        ['coalesce', ['get', 'name:pt'], ['get', 'name:latin'], ['get', 'name']]);
    } catch (e) { /* uma camada teimosa não estraga as outras */ }
  }
}

function geojson(spots) {
  return {
    type: 'FeatureCollection',
    features: spots.map(s => ({
      type: 'Feature',
      id: s.i,
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { i: s.i, esc: s.esc },
    })),
  };
}

function atatualizarMapa() {
  if (!estado.mapaPronto) return;
  const src = estado.mapa.getSource('spots');
  if (src) src.setData(geojson(estado.vistos));
}

let activoAnterior = null;
function marcarActivo(s) {
  if (!estado.mapaPronto) return;
  if (activoAnterior != null) {
    estado.mapa.setFeatureState({ source: 'spots', id: activoAnterior }, { activo: false });
  }
  if (s) {
    estado.mapa.setFeatureState({ source: 'spots', id: s.i }, { activo: true });
    activoAnterior = s.i;
  } else {
    activoAnterior = null;
  }
}

/* ------------------------------------------------------------- localização */

let marcadorEu = null;

function ondeEstou({ centrar = true } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(2); return; }
    navigator.geolocation.getCurrentPosition(
      pos => {
        estado.eu = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (estado.mapaPronto) {
          if (marcadorEu) marcadorEu.remove();
          const el = document.createElement('div');
          el.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#2563EB;' +
            'border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,.28)';
          el.setAttribute('aria-hidden', 'true');
          marcadorEu = new maplibregl.Marker({ element: el })
            .setLngLat([estado.eu.lon, estado.eu.lat]).addTo(estado.mapa);
          if (centrar) estado.mapa.easeTo({ center: [estado.eu.lon, estado.eu.lat], zoom: 13 });
        }
        resolve(true);
      },
      err => resolve(err && err.code ? err.code : 2),
      // 8 s e não 30: numa PWA instalada no iOS o pedido fica pendurado sem
      // nunca chamar nem o sucesso nem o erro, e um botão preso é pior do que
      // uma mensagem. Reportado desde 2021 e ainda sem resolução da Apple.
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 120000 }
    );
  });
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
  if (meta) meta.content = escuro ? '#14161A' : '#F5F3EE';
}

/* ------------------------------------------------------------------ ligações */

function ligarBotoes() {
  let temporizador;
  E.q.addEventListener('input', () => {
    E.limpar.hidden = !E.q.value;
    clearTimeout(temporizador);
    temporizador = setTimeout(() => {
      estado.termo = E.q.value;
      desenhar();
    }, 110);
  });
  E.q.addEventListener('keydown', ev => {
    if (ev.key === 'Escape') { E.q.value = ''; E.limpar.hidden = true; estado.termo = ''; desenhar(); }
  });
  E.limpar.addEventListener('click', () => {
    E.q.value = ''; E.limpar.hidden = true; estado.termo = ''; desenhar(); E.q.focus();
  });

  const chips = {
    'f-perto': 'perto', 'f-barras': 'barras', 'f-luz': 'luz',
    'f-24': 'h24', 'f-acess': 'acess',
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

  // Delegação: os cartões nascem e morrem a cada filtro, não vale a pena
  // pendurar um ouvinte em cada um.
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
    if (estado.mapaPronto) estado.mapa.fitBounds(CONTINENTE, { padding: 30, duration: 700 });
  });

  $('#tema').addEventListener('click', () => {
    const escuroAgora = document.documentElement.dataset.theme === 'dark' ||
      (!document.documentElement.dataset.theme &&
        matchMedia('(prefers-color-scheme: dark)').matches);
    const novo = escuroAgora ? 'light' : 'dark';
    try { localStorage.setItem('bf:tema', novo); } catch (e) { /* modo privado */ }
    aplicarTema(novo);
    if (estado.mapaPronto) {
      estado.mapaPronto = false;
      // O setStyle deita fora as fontes e as camadas — mas dispara `style.load`
      // outra vez, e é esse mesmo ouvinte que as repõe. Nada a fazer aqui.
      estado.mapa.setStyle(novo === 'dark' ? ESTILO.dark : ESTILO.light);
    }
  });

  $('#v-lista').addEventListener('click', () => mudarVista('lista'));
  $('#v-mapa').addEventListener('click', () => mudarVista('mapa'));
}

function mudarVista(v) {
  E.app.dataset.vista = v;
  $('#v-lista').setAttribute('aria-selected', String(v === 'lista'));
  $('#v-mapa').setAttribute('aria-selected', String(v === 'mapa'));
  if (v === 'mapa' && estado.mapaPronto) {
    // O mapa nasceu com a coluna escondida e mediu 0 px de largura.
    requestAnimationFrame(() => estado.mapa.resize());
  }
}

/* Três causas, três frases. «Não consegui saber onde estás» não diz a ninguém
   o que fazer a seguir; «recusaste a permissão» diz. E em todas se aponta para
   o caminho que funciona sempre: escrever o nome do concelho. */
const ERRO_LOCAL = {
  1: 'Recusaste o acesso à localização. Podes voltar a permitir nas definições ' +
     'do browser para este site — ou procurar pelo nome do concelho aqui em cima.',
  2: 'O aparelho não conseguiu determinar onde estás. Acontece dentro de ' +
     'edifícios e com o GPS desligado. Procura pelo nome do concelho aqui em cima.',
  3: 'A localização demorou demasiado a responder. Se instalaste o site como ' +
     'aplicação no iPhone, abre-o antes no Safari. Ou procura pelo concelho aqui em cima.',
};

function avisarLocalizacao(codigo) {
  const b = $('#f-perto');
  if (b) b.setAttribute('aria-pressed', 'false');
  const msg = ERRO_LOCAL[codigo] || ERRO_LOCAL[2];
  anunciar(msg);
  alert(msg);
}

/* O service worker serve para o site abrir no parque, com rede fraca. Regista-se
   DEPOIS de a página estar de pé — nunca à frente do arranque — e o `catch`
   engole a falha de propósito: em modo privado, em `file://` ou com o
   armazenamento cheio, o registo atira, e não há razão nenhuma para isso
   estragar a aplicação a quem só quer ver a lista. */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  addEventListener('load', () => {
    // `updateViaCache: 'none'` obriga o browser a ir buscar o /sw.js à rede em
    // vez de o servir da sua própria cache HTTP. Sem isto, o GitHub Pages
    // devolve o worker com um TTL que não se pode mudar, e um worker velho
    // pode ficar semanas a servir uma versão velha do site.
    navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .then(reg => {
        // Uma aplicação instalada no telemóvel nunca é «fechada»: fica meses no
        // multitarefas. Sem isto, nunca chegaria a procurar uma versão nova.
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {});
        });
      })
      .catch(() => {});
  });
}

arrancar();
