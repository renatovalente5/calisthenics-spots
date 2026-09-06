/* Calisthenics Spots — o mapa, com dois condutores.
   ============================================================================
   O dono quis o Google Maps, pelo satélite. O Google Maps precisa de uma chave
   com conta de facturação, e a chave num site estático é pública — pelo que o
   site não pode DEPENDER dela para funcionar. Daí dois condutores atrás da
   mesma interface:

     · GOOGLE   — quando CONFIG.googleMapsKey está preenchida. Mapa, satélite e
                  Street View dentro do site.
     · LIVRE    — MapLibre + OpenFreeMap. Sem chave, sem conta, sem limite.
                  O satélite e o Street View abrem no Google Maps numa página
                  nova, por LIGAÇÃO — que é grátis e não precisa de chave.

   Trocar de condutor é mudar uma linha no config.js. O resto da aplicação não
   sabe qual está a correr: fala sempre com `Mapa.*`.

   A INTERFACE, e é só isto:
     Mapa.criar(el, opcoes)      -> promessa que resolve quando estiver de pé
     Mapa.definirPontos(spots)   -> substitui os pontos visíveis
     Mapa.irPara(lat, lon, zoom)
     Mapa.enquadrar([[so],[ne]])
     Mapa.marcarActivo(i | null)
     Mapa.mostrarZona(geojson | null)
     Mapa.satelite(ligado)       -> devolve false se o condutor não souber
     Mapa.temSatelite()
     Mapa.redimensionar()
     Mapa.aoMudarVista(fn)
*/
'use strict';

const Mapa = (() => {
  /* Os mosaicos livres. O OpenFreeMap é a primeira escolha — sem chave, sem
     limite —, mas é um projecto de uma pessoa só. Se não responder em 9 s,
     entra o VersaTiles, que é outro projecto e outra infra-estrutura. */
  const ESTILO = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  };
  const ESTILO_RESERVA = {
    light: 'https://tiles.versatiles.org/assets/styles/neutrino/style.json',
    dark: 'https://tiles.versatiles.org/assets/styles/neutrino/style.json',
  };
  const ESPERA_ESTILO = 9000;

  /* SATÉLITE DENTRO DO MAPA: só com o Google.
     As ortofotos da Direção-Geral do Território seriam a escolha certa —
     oficiais, portuguesas, CC-BY, 25 cm por pixel. Mas o servidor deles manda
     o cabeçalho `Access-Control-Allow-Origin` DUAS VEZES, e a especificação
     do CORS exige exactamente um: o browser rejeita. Medido nos três modos:
         fetch                     -> falha
         <img crossOrigin>         -> falha
         <img> simples             -> FUNCIONA
     O MapLibre carrega os mosaicos com CORS (a textura de WebGL fica marcada
     sem isso), por isso não os pode usar. Mas uma <img> pode — e é por isso
     que a ortofoto aparece na FICHA de cada sítio, em `app.js`, que é onde
     serve mesmo para alguém confirmar se há barras. */

  /* As cores dos pinos vivem no CSS, como custom properties, e são lidas daqui.
     Assim mudar a paleta muda o mapa, e não há um segundo sítio para esquecer. */
  function cor(nome, recuo) {
    const v = getComputedStyle(document.documentElement).getPropertyValue(nome).trim();
    return v || recuo;
  }
  function coresDosPinos() {
    return {
      1: cor('--pino-confirmado', '#9D4DE8'),
      2: cor('--pino-provavel', '#0074A4'),
      3: cor('--pino-duvida', '#77757C'),
      4: cor('--pino-maquinas', '#976203'),
      anelClaro: cor('--pino-anel-claro', '#FFFFFF'),
      anelEscuro: cor('--pino-anel-escuro', '#100D14'),
    };
  }

  const estado = {
    condutor: null,   // 'google' | 'livre'
    mapa: null,
    pronto: false,
    spots: [],
    activo: null,
    satelite: false,
    aoClicar: null,
    aoMudarVista: null,
    marcadores: null,
    agrupador: null,
    zona: null,
  };

  /* ------------------------------------------------------------ carregadores */

  function carregarScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('não carregou: ' + src));
      document.head.appendChild(s);
    });
  }

  /* ------------------------------------------------------------- condutor GOOGLE */

  async function criarGoogle(el, opcoes) {
    // `loading=async` é o que a Google pede desde 2023; sem isso a consola
    // enche-se de avisos e o carregamento é síncrono e mais lento.
    const p = new URLSearchParams({
      key: CONFIG.googleMapsKey,
      v: 'weekly',
      libraries: 'marker',
      language: 'pt-PT',
      region: 'PT',
      loading: 'async',
      callback: '__mapaPronto',
    });
    const espera = new Promise((resolve, reject) => {
      window.__mapaPronto = resolve;
      setTimeout(() => reject(new Error('o Google Maps não respondeu')), 12000);
    });
    await carregarScript('https://maps.googleapis.com/maps/api/js?' + p);
    await espera;

    const opts = {
      center: { lat: (opcoes.enquadrar[0][1] + opcoes.enquadrar[1][1]) / 2,
                lng: (opcoes.enquadrar[0][0] + opcoes.enquadrar[1][0]) / 2 },
      zoom: 7,
      mapTypeId: 'roadmap',
      // A barra de tipos de mapa é redundante: temos o nosso botão de satélite.
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      // O gesto de um dedo dentro do mapa deve percorrer a PÁGINA no telemóvel,
      // senão a pessoa fica presa dentro do mapa a tentar chegar ao rodapé.
      gestureHandling: 'greedy',
      clickableIcons: false,
      keyboardShortcuts: true,
    };
    if (CONFIG.googleMapId) opts.mapId = CONFIG.googleMapId;

    const mapa = new google.maps.Map(el, opts);
    estado.mapa = mapa;
    estado.condutor = 'google';

    mapa.addListener('idle', () => {
      if (estado.aoMudarVista) estado.aoMudarVista(limitesGoogle());
    });

    // O agrupador de marcadores. Vem de um CDN e é opcional: sem ele os pinos
    // aparecem todos, o que com 900 é lento mas não parte nada.
    try {
      await carregarScript('https://cdnjs.cloudflare.com/ajax/libs/' +
        'js-marker-clusterer/1.0.0/markerclusterer.js');
    } catch (e) { /* segue sem agrupar */ }

    estado.pronto = true;
    return mapa;
  }

  function limitesGoogle() {
    const b = estado.mapa.getBounds();
    if (!b) return null;
    const so = b.getSouthWest(), ne = b.getNorthEast();
    return [[so.lng(), so.lat()], [ne.lng(), ne.lat()]];
  }

  function pontosGoogle(spots) {
    const cores = coresDosPinos();
    if (estado.marcadores) {
      for (const m of estado.marcadores) m.setMap(null);
    }
    estado.marcadores = spots.map(s => {
      const m = new google.maps.Marker({
        position: { lat: s.lat, lng: s.lon },
        map: estado.mapa,
        title: s.nome,
        // Um círculo desenhado, e não o alfinete vermelho de origem: a cor tem
        // de dizer o escalão, e o contorno branco é o que o mantém visível por
        // cima de imagens de satélite, que são escuras e cheias de textura.
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          fillColor: cores[s.esc] || cores[3],
          fillOpacity: 1,
          // Anel branco grosso nos confirmados, fino nos outros: por cima de
          // satélite é o anel que se vê, e o tamanho é o que distingue os
          // escalões para quem não distingue cores.
          strokeColor: cores.anelClaro,
          strokeWeight: s.esc === 1 ? 3 : 2,
          scale: s.esc === 1 ? 9 : 6.5,
        },
        zIndex: s.esc === 1 ? 3 : 1,
      });
      m.addListener('click', () => { if (estado.aoClicar) estado.aoClicar(s); });
      return m;
    });
    if (window.MarkerClusterer) {
      if (estado.agrupador) estado.agrupador.clearMarkers();
      estado.agrupador = new MarkerClusterer(estado.mapa, estado.marcadores, {
        maxZoom: 13, gridSize: 46,
        styles: [1, 2, 3].map((n, i) => ({
          width: 34 + i * 10, height: 34 + i * 10,
          textColor: '#fff', textSize: 12,
          url: pinoAgrupado(34 + i * 10, coresDosPinos()[1]),
        })),
      });
    }
  }

  /* Um PNG não: um data-URI de SVG, que fica nítido em qualquer densidade e
     não custa um pedido à rede. */
  function pinoAgrupado(lado, cor) {
    const r = lado / 2 - 2;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lado}" height="${lado}">
      <circle cx="${lado / 2}" cy="${lado / 2}" r="${r}" fill="${cor}" opacity=".92"/>
      <circle cx="${lado / 2}" cy="${lado / 2}" r="${r}" fill="none"
              stroke="#fff" stroke-width="2.2"/></svg>`;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  /* -------------------------------------------------------------- condutor LIVRE */

  async function criarLivre(el, opcoes) {
    if (typeof maplibregl === 'undefined') throw new Error('sem MapLibre');
    const mapa = new maplibregl.Map({
      container: el,
      style: opcoes.escuro ? ESTILO.dark : ESTILO.light,
      bounds: opcoes.enquadrar,
      fitBoundsOptions: { padding: 30 },
      attributionControl: false,
      cooperativeGestures: false,
    });
    estado.mapa = mapa;
    estado.condutor = 'livre';

    if (window.ResizeObserver) new ResizeObserver(() => mapa.resize()).observe(el);
    else addEventListener('resize', () => mapa.resize());

    let trocou = false;
    const relogio = setTimeout(() => {
      if (estado.pronto || trocou) return;
      trocou = true;
      console.warn('mosaicos: fornecedor principal calado; a usar a reserva');
      try { mapa.setStyle(ESTILO_RESERVA[opcoes.escuro ? 'dark' : 'light']); } catch (e) {}
    }, ESPERA_ESTILO);

    await new Promise((resolve, reject) => {
      // `style.load` e NÃO `load`: o `load` só dispara depois do primeiro
      // render, e o render vive do requestAnimationFrame, que o browser não
      // dispara em separadores escondidos. Assim a aplicação monta-se na mesma.
      mapa.on('style.load', () => { clearTimeout(relogio); resolve(); });
      mapa.on('error', e => {
        if (!estado.pronto) console.warn('mapa:', e && e.error);
      });
      setTimeout(() => reject(new Error('o estilo do mapa nunca chegou')), 25000);
    });

    aportuguesar(mapa);
    mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

    mapa.addSource('spots', {
      type: 'geojson', data: geojson([]),
      cluster: true, clusterRadius: 46, clusterMaxZoom: 12,
    });
    const cores = coresDosPinos();
    mapa.addLayer({
      id: 'grupos', type: 'circle', source: 'spots', filter: ['has', 'point_count'],
      paint: {
        'circle-color': cores[1], 'circle-opacity': .9,
        'circle-radius': ['step', ['get', 'point_count'], 15, 10, 20, 40, 26],
        'circle-stroke-width': 2, 'circle-stroke-color': 'rgba(255,255,255,.9)',
      },
    });
    mapa.addLayer({
      id: 'grupos-n', type: 'symbol', source: 'spots', filter: ['has', 'point_count'],
      layout: {
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['Noto Sans Bold'], 'text-size': 12,
      },
      paint: { 'text-color': '#fff' },
    });
    // DUAS camadas para os pontos, e não uma. A de baixo é um disco escuro um
    // pouco maior: é o «fio» exterior da auréola dupla. Sem ele, o anel branco
    // sozinho desaparece por cima de areia e de betão claro (1,2:1) quando se
    // liga o satélite. Com os dois, o pior fundo dá 5,7:1 num deles.
    mapa.addLayer({
      id: 'pontos-fio', type: 'circle', source: 'spots',
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': cores.anelEscuro,
        'circle-opacity': .55,
        'circle-radius': ['case',
          ['boolean', ['feature-state', 'activo'], false], 15.5,
          ['==', ['get', 'esc'], 1], 12, 9.6],
      },
    });
    mapa.addLayer({
      id: 'pontos', type: 'circle', source: 'spots', filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': ['match', ['get', 'esc'],
          1, cores[1], 2, cores[2], 4, cores[4], cores[3]],
        // O TAMANHO carrega o significado tanto como a cor. O violeta dos
        // confirmados e o cinzento dos por confirmar diferem 1,01:1 em
        // luminância — para quem não distingue cores, são o mesmo pino. O que
        // se vê é que um é claramente maior do que o outro.
        'circle-radius': ['case',
          ['boolean', ['feature-state', 'activo'], false], 12,
          ['==', ['get', 'esc'], 1], 8.5, 5.5],
        'circle-stroke-width': ['case', ['==', ['get', 'esc'], 1], 3, 2.2],
        'circle-stroke-color': cores.anelClaro,
      },
    });
    // A zona do concelho, por baixo dos pontos.
    mapa.addSource('zona', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    mapa.addLayer({
      id: 'zona-fundo', type: 'fill', source: 'zona',
      paint: { 'fill-color': cores[1], 'fill-opacity': .07 },
    }, 'grupos');
    mapa.addLayer({
      id: 'zona-linha', type: 'line', source: 'zona',
      paint: { 'line-color': cores[1], 'line-width': 2, 'line-dasharray': [2, 1.6], 'line-opacity': .85 },
    }, 'grupos');

    mapa.on('click', 'pontos', ev => {
      const f = ev.features[0];
      const s = estado.spots[f.properties.i];
      if (s && estado.aoClicar) estado.aoClicar(s);
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
    mapa.on('moveend', () => {
      if (estado.aoMudarVista) {
        const b = mapa.getBounds();
        estado.aoMudarVista([[b.getWest(), b.getSouth()], [b.getEast(), b.getNorth()]]);
      }
    });

    estado.pronto = true;
    return mapa;
  }

  /* Os mosaicos trazem o topónimo local — «España», «Sevilla». Num mapa de
     Portugal em português, «Spain» ao lado de «Setúbal» é falta de acabamento. */
  function aportuguesar(mapa) {
    let camadas;
    try { camadas = mapa.getStyle().layers || []; } catch (e) { return; }
    for (const c of camadas) {
      if (c.type !== 'symbol') continue;
      const campo = c.layout && c.layout['text-field'];
      if (!campo || !JSON.stringify(campo).includes('"name"')) continue;
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
        type: 'Feature', id: s.i,
        geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
        properties: { i: s.i, esc: s.esc },
      })),
    };
  }

  /* ---------------------------------------------------------------- interface */

  let activoAnterior = null;

  return {
    get condutor() { return estado.condutor; },
    get pronto() { return estado.pronto; },

    async criar(el, opcoes) {
      estado.aoClicar = opcoes.aoClicar || null;
      if (CONFIG.googleMapsKey) {
        try {
          await criarGoogle(el, opcoes);
          return 'google';
        } catch (err) {
          console.warn('Google Maps falhou (' + err.message + '); a usar o mapa livre.');
        }
      }
      await criarLivre(el, opcoes);
      return 'livre';
    },

    definirPontos(spots) {
      estado.spots = spots;
      if (!estado.pronto) return;
      if (estado.condutor === 'google') pontosGoogle(spots);
      else {
        const src = estado.mapa.getSource('spots');
        if (src) src.setData(geojson(spots));
      }
    },

    irPara(lat, lon, zoom) {
      if (!estado.pronto) return;
      if (estado.condutor === 'google') {
        estado.mapa.panTo({ lat, lng: lon });
        if (zoom) estado.mapa.setZoom(Math.max(estado.mapa.getZoom(), zoom));
      } else {
        estado.mapa.easeTo({ center: [lon, lat],
          zoom: Math.max(estado.mapa.getZoom(), zoom || 0), duration: 600 });
      }
    },

    enquadrar(limites, margem) {
      if (!estado.pronto) return;
      const m = margem == null ? 40 : margem;
      if (estado.condutor === 'google') {
        const b = new google.maps.LatLngBounds(
          { lat: limites[0][1], lng: limites[0][0] },
          { lat: limites[1][1], lng: limites[1][0] });
        estado.mapa.fitBounds(b, m);
      } else {
        estado.mapa.fitBounds(limites, { padding: m, duration: 700 });
      }
    },

    marcarActivo(i) {
      if (!estado.pronto) return;
      if (estado.condutor === 'google') {
        if (!estado.marcadores) return;
        const cores = coresDosPinos();
        estado.marcadores.forEach(m => {
          const s = estado.spots.find(x => x.nome === m.getTitle());
          const activo = s && s.i === i;
          const ic = m.getIcon();
          m.setIcon(Object.assign({}, ic, {
            scale: activo ? 12 : (s && s.esc === 1 ? 9 : 7),
            strokeWeight: activo ? 3.4 : 2.2,
          }));
          m.setZIndex(activo ? 9 : (s && s.esc === 1 ? 3 : 1));
        });
        return;
      }
      if (activoAnterior != null) {
        estado.mapa.setFeatureState({ source: 'spots', id: activoAnterior }, { activo: false });
      }
      if (i != null) {
        estado.mapa.setFeatureState({ source: 'spots', id: i }, { activo: true });
        activoAnterior = i;
      } else {
        activoAnterior = null;
      }
    },

    mostrarZona(geo) {
      if (!estado.pronto) return;
      if (estado.condutor === 'google') {
        if (estado.zona) estado.zona.forEach(f => estado.mapa.data.remove(f));
        estado.zona = null;
        if (!geo) return;
        estado.zona = estado.mapa.data.addGeoJson(geo);
        const cores = coresDosPinos();
        estado.mapa.data.setStyle({
          fillColor: cores[1], fillOpacity: .07,
          strokeColor: cores[1], strokeWeight: 2, clickable: false,
        });
        return;
      }
      const src = estado.mapa.getSource('zona');
      if (src) src.setData(geo || { type: 'FeatureCollection', features: [] });
    },

    /* Satélite DENTRO do mapa só o Google o faz — ver a nota no topo do
       ficheiro sobre o CORS da DGT. Sem chave, o botão não aparece e a ficha
       de cada sítio mostra a ortofoto como imagem, que é onde serve. */
    temSatelite() { return estado.pronto && estado.condutor === 'google'; },

    satelite(ligado) {
      if (!estado.pronto || estado.condutor !== 'google') return false;
      estado.satelite = !!ligado;
      estado.mapa.setMapTypeId(ligado ? 'hybrid' : 'roadmap');
      return true;
    },

    redimensionar() {
      if (!estado.pronto) return;
      if (estado.condutor === 'google') {
        google.maps.event.trigger(estado.mapa, 'resize');
      } else {
        estado.mapa.resize();
      }
    },

    aoMudarVista(fn) { estado.aoMudarVista = fn; },

    /* Janelas para a bateria de testes. Não são usadas pela aplicação: existem
       para se poder verificar o que está no ecrã sem furar o encapsulamento e
       sem a bateria ter de saber qual dos condutores está a correr. */
    _satelite() {
      if (!estado.pronto || estado.condutor !== 'google') return null;
      return estado.mapa.getMapTypeId() === 'hybrid';
    },

    _zoom() { return estado.pronto ? +estado.mapa.getZoom().toFixed(2) : -1; },

    /* O bbox actual em EPSG:3857, no formato que o WMS espera. Serve para a
       bateria poder pedir um mosaico à DGT com as coordenadas que o mapa está
       mesmo a usar, e verificar que não vem em branco. */
    _bboxActual() {
      if (!estado.pronto || estado.condutor !== 'livre') return null;
      const b = estado.mapa.getBounds();
      const R = 20037508.342789244;
      const m = (lat, lon) => [
        lon * R / 180,
        Math.log(Math.tan((90 + Math.min(85.05, Math.max(-85.05, lat))) * Math.PI / 360))
          / (Math.PI / 180) * R / 180,
      ];
      const so = m(b.getSouth(), b.getWest());
      const ne = m(b.getNorth(), b.getEast());
      return [so[0], so[1], ne[0], ne[1]].join(',');
    },

    _quantosPontos() {
      if (!estado.pronto) return -1;
      if (estado.condutor === 'google') return (estado.marcadores || []).length;
      const src = estado.mapa.getSource('spots');
      return src && src._data ? src._data.features.length : -1;
    },
  };
})();
