/* Calisthenics Spots — service worker.
   ============================================================================
   PARA QUE SERVE: estar no parque, com 4G mau, e o site abrir na mesma.

   O PERIGO, e é real: um service worker mal feito serve para sempre uma versão
   velha do site, e quem o instalou nunca mais vê uma actualização — nem
   limpando a cache, porque é o próprio worker que responde antes da rede. Já
   aconteceu noutro projecto alojado no GitHub Pages.

   As quatro regras que evitam isso:

     1. A VERSÃO É O CONTEÚDO. `VERSAO` é um resumo de app.css + app.js +
        spots.json, calculado na construção. Muda o conteúdo, muda o nome da
        cache, e a antiga é apagada. Não há como esquecer de a incrementar.
     2. NAVEGAÇÃO VAI À REDE PRIMEIRO. Um pedido de página tenta a rede e só cai
        na cache se falhar. Uma pessoa online vê sempre o HTML de hoje.
     3. skipWaiting + clients.claim. O worker novo assume já, sem esperar que
        todos os separadores fechem.
     4. SÓ SE GUARDA O QUE É NOSSO. Os mosaicos do mapa são de outro domínio e
        vêm como respostas opacas: guardá-los enche a quota sem se poder sequer
        verificar se são válidos. Ficam de fora, e o browser trata deles.
*/
const VERSAO = '7b9a22ff';
const BASE = '/calisthenics-spots/';
const CACHE = 'calisthenics-spots-' + VERSAO;

const ESSENCIAL = [
  BASE,
  BASE + 'assets/css/app.css?v=' + VERSAO,
  BASE + 'assets/js/app.js?v=' + VERSAO,
  BASE + 'assets/vendor/maplibre-gl.js?v=' + VERSAO,
  BASE + 'assets/vendor/maplibre-gl.css?v=' + VERSAO,
  BASE + 'data/spots.json',
  BASE + 'data/concelhos.json',
  BASE + 'assets/img/pino.svg',
];

self.addEventListener('install', ev => {
  ev.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // `addAll` é tudo-ou-nada: um ficheiro em falta cancela a instalação toda e
    // fica-se sem worker nenhum. Um a um, o que falhar fica só por guardar.
    await Promise.all(ESSENCIAL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', ev => {
  ev.waitUntil((async () => {
    for (const n of await caches.keys()) {
      if (n.startsWith('calisthenics-spots-') && n !== CACHE) await caches.delete(n);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Outro domínio (os mosaicos do mapa): passa ao lado. Ver a regra 4.
  if (url.origin !== location.origin) return;

  // Páginas: rede primeiro. É isto que impede o site de ficar preso no passado.
  if (req.mode === 'navigate') {
    ev.respondWith((async () => {
      try {
        // COM PRAZO. «Rede primeiro» sem limite de tempo é pior do que a cache:
        // numa rede que aceita a ligação e depois não responde — o 4G de um
        // parque —, a página fica em branco durante o tempo que o browser
        // quiser. Três segundos, e passa-se à cópia guardada.
        const r = await Promise.race([
          fetch(req),
          new Promise((_, rej) => setTimeout(() => rej(new Error('lento')), 3000)),
        ]);
        const c = await caches.open(CACHE);
        c.put(BASE, r.clone());
        return r;
      } catch (e) {
        return (await caches.match(BASE)) ||
          new Response('<!doctype html><meta charset=utf-8>' +
            '<p style="font:16px system-ui;padding:2rem">Sem ligação, e ainda não ' +
            'há uma cópia guardada deste site. Tenta outra vez com rede.</p>',
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }

  // O resto: da cache se lá estiver, senão da rede, guardando pelo caminho.
  ev.respondWith((async () => {
    const guardado = await caches.match(req);
    if (guardado) return guardado;
    try {
      const r = await fetch(req);
      if (r.ok && r.type === 'basic') {
        const c = await caches.open(CACHE);
        c.put(req, r.clone());
      }
      return r;
    } catch (e) {
      // O ficheiro dos sítios é o que interessa mesmo ter offline: se o pedido
      // trouxer uma query diferente, ainda assim serve-se a cópia que há.
      if (url.pathname === BASE + 'data/spots.json') {
        const alt = await caches.match(BASE + 'data/spots.json');
        if (alt) return alt;
      }
      throw e;
    }
  })());
});
