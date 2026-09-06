/* A API do Calisthenics Spots.
 *
 * O QUE ESTA API É, E O QUE NÃO É. Não serve o mapa. O mapa são 887 sítios num
 * ficheiro estático de 300 KB, servido pela rede de distribuição, de graça, e
 * assim continua a ser com dez mil. Esta API é uma CAIXA DE CORREIO: recebe o
 * que as pessoas sabem e que não está em fonte nenhuma, e devolve o pouco que
 * mudou desde a última construção.
 *
 * Isto não é preciosismo de arquitectura, é aritmética. Desde 1 de Setembro de
 * 2026 o D1 gratuito deixou de apenas contabilizar e passou a FAZER FALHAR as
 * consultas ao fim de 5 milhões de linhas lidas por dia. E as «linhas lidas»
 * são linhas PERCORRIDAS: um `SELECT *` dos 887 sítios a cada visita gasta 887
 * leituras e esgota o dia em cerca de 5600 visitas. Servir o mapa daqui seria
 * comprar uma avaria para o dia em que a aplicação corresse bem.
 *
 * Os pedidos do Workers gratuito são 100 000 por dia E POR CONTA — partilhados
 * com o outro Worker que corre nesta conta. Mais uma razão para o caminho de
 * leitura não passar por aqui.
 */

const VERSAO = '1';

/* ------------------------------------------------------------------ utilidades */

function json(dados, estado = 200, cabecalhos = {}) {
  return new Response(JSON.stringify(dados), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...cabecalhos,
    },
  });
}

function erro(mensagem, estado = 400, extra = {}) {
  return json({ erro: mensagem, ...extra }, estado);
}

/* A LISTA BRANCA DE ORIGENS é o que impede um site qualquer de usar esta API
   como se fosse dele. Não é segurança a sério — quem quiser, faz o pedido de
   um servidor — mas trava o caso comum e mantém o Referer honesto. */
function cors(pedido, env) {
  const origem = pedido.headers.get('Origin') || '';
  const permitidas = (env.ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
  const ok = permitidas.includes(origem);
  return {
    'access-control-allow-origin': ok ? origem : permitidas[0] || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-chave',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

function agora() {
  return new Date().toISOString();
}

function hoje() {
  return agora().slice(0, 10);
}

/* O IP NÃO SE GUARDA. Guarda-se um resumo com sal do DIA, que serve para contar
   quantos envios vieram do mesmo sítio nas últimas horas e deixa de servir para
   o que quer que seja no dia seguinte. É a diferença entre limitar abusos e
   fazer um registo de quem passou por aqui.

   E É AQUI QUE O TRAVÃO TEM DE VIVER, e não no telemóvel. O §63 das Orientações
   2/2023 do Comité Europeu para a Protecção de Dados diz que ler um
   identificador guardado no aparelho é «gaining of access» ao equipamento
   terminal, e a isenção de «estritamente necessário» que mais se aproxima está
   escrita para abusos de AUTENTICAÇÃO — que aqui não existem. Travar pelo
   aparelho obrigaria a um aviso de consentimento; travar pelo IP, que o
   servidor recebe de qualquer maneira para poder responder, é interesse
   legítimo (art. 6.º/1/f, e o acórdão Breyer). A aplicação continua sem aviso
   de cookies, que é meio posicionamento dela. */
/* EM IPv6, O TRAVÃO TEM DE SER O PREFIXO. Um /64 doméstico — ou um servidor
   alugado por quatro euros — tem 18 triliões de endereços, e resumir o endereço
   inteiro dava uma identidade nova a cada pedido: o travão não travava nada e o
   selo de frescura fabricava-se por 4 €. O /64 é o bloco que se atribui a uma
   ligação, por isso é esse que conta. Em IPv4 usa-se o endereço todo, que já é
   escasso. */
function chaveDoIp(ip) {
  if (!ip.includes(':')) return ip;
  const partes = ip.split(':');
  return partes.slice(0, 4).join(':') + '::/64';
}

async function resumoIp(pedido, env) {
  const ip = pedido.headers.get('CF-Connecting-IP') || '';
  if (!ip) return null;
  const dados = new TextEncoder().encode(
    `${hoje()}:${env.SAL || 'sem-sal'}:${chaveDoIp(ip)}`);
  const digest = await crypto.subtle.digest('SHA-256', dados);
  return [...new Uint8Array(digest)].slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------- Turnstile */

/* PORQUE TURNSTILE E NÃO UM CAPTCHA. Não pede nada à pessoa, não põe cookies de
   rastreio e é gratuito sem tecto. Um registo com conta afastaria muito mais
   gente do que o abuso que evitaria — e o que esta aplicação precisa é de
   contribuições, não de utilizadores registados. */
async function turnstileValido(ficha, pedido, env) {
  // FALHA FECHADA, e isto custou uma auditoria. A primeira versão devolvia
  // `{ok: true}` quando o segredo não estava configurado — «para não estorvar
  // durante o desenvolvimento». O efeito real: a caixa de correio ficou aberta
  // ao mundo, e um `curl` publicava no mapa de toda a gente sem verificação
  // nenhuma. Uma porta que se abre sozinha quando falta a fechadura não é uma
  // fechadura.
  if (!env.TURNSTILE_SEGREDO) return { ok: false, porque: 'servidor por configurar', fechado: true };
  if (!ficha) return { ok: false, porque: 'sem ficha' };
  // A FICHA DE ENSAIO da Cloudflare, para a bateria poder percorrer o envio de
  // ponta a ponta. Só é aceite quando o segredo de ensaio está configurado —
  // e o segredo de ensaio nunca está em produção.
  const ensaio = env.TURNSTILE_SEGREDO.startsWith('1x0000');
  const corpo = new FormData();
  corpo.append('secret', env.TURNSTILE_SEGREDO);
  if (ensaio) corpo.append('__ensaio', '1');
  corpo.append('response', ficha);
  const ip = pedido.headers.get('CF-Connecting-IP');
  if (ip) corpo.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: corpo });
    const d = await r.json();
    return { ok: !!d.success, porque: (d['error-codes'] || []).join(',') };
  } catch (e) {
    // Se o Turnstile estiver em baixo não se deita fora a contribuição de uma
    // pessoa honesta — mas TAMBÉM não se publica sem verificação. Passa, e fica
    // à espera de olhos. É o meio-termo honesto entre perder o trabalho de
    // alguém e publicar o que não foi verificado.
    return { ok: true, semVerificar: true };
  }
}

/* ---------------------------------------------------------------------- travão */

/* Um contador por chave e por dia, com prazo de validade. A chave é sempre
   derivada do IP — ver a nota acima sobre porque não pode ser o aparelho. */
async function travar(env, chave, tecto, horas = 24) {
  const ate = new Date(Date.now() + horas * 3600e3).toISOString();
  const linha = await env.DB.prepare(
    'INSERT INTO travao (chave, quantos, ate) VALUES (?1, 1, ?2) ' +
    'ON CONFLICT(chave) DO UPDATE SET quantos = quantos + 1 ' +
    'RETURNING quantos').bind(chave, ate).first();
  return { passou: (linha?.quantos || 1) <= tecto, quantos: linha?.quantos || 1 };
}

/* ------------------------------------------------------------------- validação */

const APARELHOS = new Set([
  'barra_fixa', 'paralelas', 'escada_horizontal', 'argolas', 'espaldar',
  'flexoes', 'abdominais', 'lombares', 'alongamento', 'agachamento',
  'trave', 'equilibrio', 'caixa', 'escadas', 'barreiras', 'slalom',
  'corda', 'escalada', 'slackline', 'suspensao',
]);

// A caixa envolvente de Portugal, ilhas incluídas. Um ponto fora disto não é um
// parque no Atlântico, é um erro — ou alguém a testar a API.
const PORTUGAL = { lat: [29.5, 42.3], lon: [-31.5, -6.0] };

function limparTexto(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim().slice(0, max);
  return t || null;
}

function validarSitio(c) {
  const lat = Number(c.lat), lon = Number(c.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return 'faltam as coordenadas';
  if (lat < PORTUGAL.lat[0] || lat > PORTUGAL.lat[1] ||
      lon < PORTUGAL.lon[0] || lon > PORTUGAL.lon[1]) return 'isso não é em Portugal';
  const ap = Array.isArray(c.aparelhos) ? c.aparelhos.filter(a => APARELHOS.has(a)) : [];
  return { lat: +lat.toFixed(5), lon: +lon.toFixed(5), aparelhos: ap };
}

/* ---------------------------------------------------------------------- rotas */

async function postSitio(pedido, env, corpo, autor, ip, verificado) {
  const v = validarSitio(corpo);
  if (typeof v === 'string') return erro(v);

  // O TRAVÃO É PELO IP. Ver a nota em `resumoIp`: travar pelo identificador
  // guardado no telemóvel faria nascer um aviso de consentimento.
  if (ip) {
    const ti = await travar(env, `${hoje()}:i:${ip}`, 20);
    if (!ti.passou) return erro('demasiados envios desta ligação hoje. Amanhã continuamos.', 429);
  }

  const nome = limparTexto(corpo.nome, 80);
  const nota = limparTexto(corpo.nota, 400);

  // A REGRA QUE FAZ ISTO FUNCIONAR: só de caixas, publica-se já; com texto
  // escrito à mão, espera por olhos. Ver a nota no esquema.
  const soCaixas = !nome && !nota;
  const visivel = (soCaixas && verificado) ? 1 : 0;

  // A CEDÊNCIA GRAVA-SE COM A LINHA. Sem prova de que quem enviou aceitou que
  // isto possa ser publicado e devolvido ao OpenStreetMap, o ficheiro da
  // comunidade não pode sair em CC0 — e sem a VERSÃO do texto não se sabe, daqui
  // a dois anos, a que é que cada pessoa aderiu.
  const cedencia = limparTexto(corpo.cedencia, 40);
  if (!cedencia) return erro('falta a cedência de direitos');

  const r = await env.DB.prepare(
    'INSERT INTO envios (tipo, sitio, lat, lon, nome, aparelhos, nota, ' +
    'visivel, estado, autor, ip_resumo, cedencia, criado_em) ' +
    'VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) RETURNING id')
    .bind('sitio', corpo.sitio ?? null, v.lat, v.lon,
          nome, JSON.stringify(v.aparelhos), nota,
          visivel, soCaixas ? 'aceite' : 'pendente', autor, ip, cedencia, agora())
    .first();
  return json({
    ok: true, id: r?.id,
    visivel: !!visivel,
    diz: visivel
      ? 'Já está no mapa para toda a gente.'
      : 'Escreveste um nome, por isso passa por revisão. Fica visível em menos de 24 horas.',
  }, 201);
}

async function postConfirmar(pedido, env, corpo, autor, ip) {
  const sitio = Number(corpo.sitio);
  if (!Number.isInteger(sitio) || sitio < 0) return erro('falta o sítio');
  const existe = corpo.existe === false ? 0 : 1;
  const ap = Array.isArray(corpo.aparelhos)
    ? corpo.aparelhos.filter(a => APARELHOS.has(a)) : [];
  const altura = ['chao', 'ar'].includes(corpo.altura) ? corpo.altura : null;

  // TRÊS TRAVÕES, e o terceiro é o que importa.
  //
  // A `autor` é uma cadeia que o TELEMÓVEL escolhe. Nada impede alguém de a
  // mudar a cada pedido, e a chave única `(sitio, autor)` sozinha não trava
  // isso — bastava rodar o valor para pôr um sítio a dizer «confirmado por 400
  // pessoas». Um selo de frescura que mente é pior do que selo nenhum, e a
  // frescura é a única coisa desta aplicação que a concorrência não consegue
  // copiar. Por isso conta-se também por RESUMO DE IP, que o cliente não
  // escolhe: a mesma ligação confirma um sítio uma vez por dia, ponto.
  if (ip) {
    const dia = await travar(env, `${hoje()}:cf:${ip}`, 30);
    if (!dia.passou) return erro('demasiadas confirmações desta ligação hoje.', 429);
    const hora = new Date().toISOString().slice(0, 13);
    const h = await travar(env, `${hora}:cfh:${ip}`, 10, 2);
    if (!h.passou) return erro('devagar. Tenta daqui a bocado.', 429);
    const mesmo = await travar(env, `${hoje()}:cfs:${sitio}:${ip}`, 1);
    if (!mesmo.passou) {
      const j = await contarConfirmacoes(env, sitio);
      return json({ ok: true, jaContava: true, ...j });
    }
  }

  await env.DB.prepare(
    'INSERT INTO confirmacoes (sitio, autor, existe, aparelhos, altura, ip_resumo, criado_em) ' +
    'VALUES (?1,?2,?3,?4,?5,?6,?7) ' +
    'ON CONFLICT(sitio, autor) DO UPDATE SET ' +
    'existe = ?3, aparelhos = ?4, altura = COALESCE(?5, altura), criado_em = ?7')
    .bind(sitio, autor, existe, ap.length ? JSON.stringify(ap) : null, altura, ip, agora())
    .run();

  return json({ ok: true, ...(await contarConfirmacoes(env, sitio)) });
}

/* A CONTAGEM QUE A FICHA MOSTRA. Conta AUTORES DISTINTOS que dizem que o sítio
   existe — e conta à parte quem diz que já não existe, porque essa é a
   informação que faz um sítio sair do mapa. */
async function contarConfirmacoes(env, sitio) {
  const r = await env.DB.prepare(
    'SELECT SUM(existe) AS sim, SUM(1 - existe) AS nao, MAX(criado_em) AS ultima, ' +
    "SUM(CASE WHEN altura = 'ar' THEN 1 ELSE 0 END) AS ar, " +
    "SUM(CASE WHEN altura = 'chao' THEN 1 ELSE 0 END) AS chao " +
    'FROM confirmacoes WHERE sitio = ?1').bind(sitio).first();
  return {
    confirmacoes: r?.sim || 0,
    desmentidos: r?.nao || 0,
    ultima: r?.ultima || null,
    // A altura sai por maioria simples. Uma barra é alta ou é baixa; se as
    // respostas se dividirem, não se diz nada — é mais honesto do que inventar.
    altura: (r?.ar || 0) > (r?.chao || 0) ? 'ar'
      : ((r?.chao || 0) > (r?.ar || 0) ? 'chao' : null),
  };
}

/* O DELTA. É o único caminho de LEITURA que passa por aqui, e é pequeno de
   propósito: só o que ainda não foi cozido no ficheiro estático. Uma resposta
   típica são zero ou meia dúzia de linhas. */
async function getDelta(env, pedido) {
  // A CACHE DO PRÓPRIO WORKER, com chave FIXA. Sem isto, cada visita fazia dois
  // varrimentos completos no D1 — e «linhas lidas» no D1 são linhas PERCORRIDAS,
  // não devolvidas. A 1000 visitas por dia isto esgotava os 5 milhões diários em
  // meses, e desde 1 de Setembro de 2026 esgotar não é ficar caro: é as consultas
  // passarem a FALHAR até à meia-noite. A chave ignora a query string de
  // propósito, senão bastava juntar `?1`, `?2`, `?3` para a contornar.
  const chave = new Request('https://delta.interno/v1/delta', { method: 'GET' });
  const cache = caches.default;
  const guardada = await cache.match(chave);
  if (guardada) return guardada;

  const [novos, conf] = await Promise.all([
    env.DB.prepare(
      "SELECT id, lat, lon, nome, aparelhos, criado_em FROM envios " +
      "WHERE tipo = 'sitio' AND visivel = 1 AND cozido_em IS NULL " +
      "ORDER BY id LIMIT 500").all(),
    env.DB.prepare(
      'SELECT sitio, COUNT(*) AS quantos, MAX(criado_em) AS ultima, ' +
      "SUM(CASE WHEN altura = 'ar' THEN 1 ELSE 0 END) AS ar, " +
      "SUM(CASE WHEN altura = 'chao' THEN 1 ELSE 0 END) AS chao " +
      'FROM confirmacoes WHERE existe = 1 GROUP BY sitio LIMIT 2000').all(),
  ]);
  const resposta = json({
    versao: VERSAO,
    gerado_em: agora(),
    novos: (novos.results || []).map(r => ({
      id: r.id, lat: r.lat, lon: r.lon, nome: r.nome,
      ap: JSON.parse(r.aparelhos || '[]'), desde: r.criado_em,
    })),
    confirmados: (conf.results || []).map(r => ({
      s: r.sitio, n: r.quantos, em: r.ultima,
      alt: (r.ar || 0) > (r.chao || 0) ? 'ar' : ((r.chao || 0) > (r.ar || 0) ? 'chao' : null),
    })),
  }, 200, { 'cache-control': 'public, max-age=300' });
  await cache.put(chave, resposta.clone());
  return resposta;
}

/* ------------------------------------------------------------------ moderação */

/* QUEM MODERA. Uma chave mestra num cabeçalho, e mais nada — sem contas, sem
   sessões, sem base de utilizadores. A página que a usa não está ligada de lado
   nenhum e o segredo vive nos segredos do Worker.
   A comparação é feita em tempo constante: comparar segredos com `===` deixa o
   tempo de resposta dizer quantos caracteres estão certos. */
function chaveCerta(pedido, env) {
  const dada = pedido.headers.get('X-Chave') || '';
  const certa = env.CHAVE_MESTRA || '';
  if (!certa || dada.length !== certa.length) return false;
  let diferenca = 0;
  for (let i = 0; i < certa.length; i++) diferenca |= dada.charCodeAt(i) ^ certa.charCodeAt(i);
  return diferenca === 0;
}

async function getFila(env) {
  const [pendentes, contagens] = await Promise.all([
    env.DB.prepare(
      "SELECT id, tipo, sitio, lat, lon, nome, aparelhos, nota, estado, visivel, " +
      "criado_em FROM envios WHERE estado = 'pendente' ORDER BY id LIMIT 200").all(),
    env.DB.prepare(
      "SELECT estado, COUNT(*) AS quantos FROM envios GROUP BY estado").all(),
  ]);
  // Os desmentidos são o outro lado da moderação: um sítio que várias pessoas
  // dizem que já não existe tem de chegar aos olhos de alguém.
  const desmentidos = await env.DB.prepare(
    'SELECT sitio, COUNT(*) AS quantos, MAX(criado_em) AS ultima FROM confirmacoes ' +
    'WHERE existe = 0 GROUP BY sitio ORDER BY quantos DESC LIMIT 50').all();
  return json({
    pendentes: (pendentes.results || []).map(r => ({
      ...r, aparelhos: JSON.parse(r.aparelhos || '[]'),
    })),
    contagens: Object.fromEntries((contagens.results || []).map(r => [r.estado, r.quantos])),
    desmentidos: desmentidos.results || [],
  });
}

async function postDecidir(env, corpo) {
  const id = Number(corpo.id);
  const aceite = corpo.decisao === 'aceite';
  if (!Number.isInteger(id)) return erro('falta o id');
  await env.DB.prepare(
    'UPDATE envios SET estado = ?2, visivel = ?3, motivo = ?4, decidido_em = ?5 ' +
    'WHERE id = ?1')
    .bind(id, aceite ? 'aceite' : 'recusado', aceite ? 1 : 0,
          limparTexto(corpo.motivo, 200), agora())
    .run();
  return json({ ok: true });
}

/* ------------------------------------------------------------------ despachante */

export default {
  async fetch(pedido, env) {
    const cabecalhos = cors(pedido, env);
    if (pedido.method === 'OPTIONS') return new Response(null, { status: 204, headers: cabecalhos });

    const url = new URL(pedido.url);
    const rota = url.pathname.replace(/\/+$/, '');

    const responder = r => new Response(r.body, {
      status: r.status, headers: { ...Object.fromEntries(r.headers), ...cabecalhos },
    });

    try {
      if (rota === '/v1/saude') return responder(json({ ok: true, versao: VERSAO }));
      if (rota === '/v1/delta' && pedido.method === 'GET') {
        return responder(await getDelta(env, pedido));
      }

      if (rota.startsWith('/v1/gerir/')) {
        if (!chaveCerta(pedido, env)) return responder(erro('chave errada', 401));
        if (rota === '/v1/gerir/fila') return responder(await getFila(env));
        if (rota === '/v1/gerir/decidir' && pedido.method === 'POST') {
          const c = await pedido.json().catch(() => null);
          if (!c) return responder(erro('corpo inválido'));
          return responder(await postDecidir(env, c));
        }
        return responder(erro('rota desconhecida', 404));
      }

      if (pedido.method !== 'POST') return responder(erro('rota desconhecida', 404));

      const corpo = await pedido.json().catch(() => null);
      if (!corpo) return responder(erro('corpo inválido'));

      // A ASSINATURA DO AUTOR. Nasce no telemóvel na PRIMEIRA submissão — nunca
      // ao abrir a página — e o que chega aqui é só um resumo dela. Serve para
      // duas coisas do próprio serviço que a pessoa pediu: não deixar a mesma
      // pessoa confirmar o mesmo sítio duas vezes, e deixá-la ver e apagar o que
      // enviou. Não serve para mais nada, e é essa a condição da isenção.
      const autor = limparTexto(corpo.autor, 64);
      if (!autor || autor.length < 16) return responder(erro('falta a assinatura'));

      const t = await turnstileValido(corpo.ficha, pedido, env);
      if (!t.ok) return responder(erro('verificação falhou', 403, { porque: t.porque }));

      const ip = await resumoIp(pedido, env);

      if (rota === '/v1/sitios') {
        return responder(await postSitio(pedido, env, corpo, autor, ip, !t.semVerificar));
      }
      if (rota === '/v1/confirmar') return responder(await postConfirmar(pedido, env, corpo, autor, ip));
      return responder(erro('rota desconhecida', 404));
    } catch (e) {
      return responder(erro('avaria no servidor', 500, { detalhe: String(e).slice(0, 200) }));
    }
  },
};
