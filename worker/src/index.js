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
    'access-control-allow-headers': 'content-type',
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
async function resumoIp(pedido, env) {
  const ip = pedido.headers.get('CF-Connecting-IP') || '';
  if (!ip) return null;
  const dados = new TextEncoder().encode(`${hoje()}:${env.SAL || 'sem-sal'}:${ip}`);
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
  if (!env.TURNSTILE_SEGREDO) return { ok: true, salto: 'sem segredo configurado' };
  if (!ficha) return { ok: false, porque: 'sem ficha' };
  const corpo = new FormData();
  corpo.append('secret', env.TURNSTILE_SEGREDO);
  corpo.append('response', ficha);
  const ip = pedido.headers.get('CF-Connecting-IP');
  if (ip) corpo.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',
      { method: 'POST', body: corpo });
    const d = await r.json();
    return { ok: !!d.success, porque: (d['error-codes'] || []).join(',') };
  } catch (e) {
    // Se o Turnstile estiver em baixo, não se deita fora a contribuição de uma
    // pessoa honesta. Deixa-se passar e a moderação apanha o que vier mal.
    return { ok: true, salto: 'turnstile inacessível' };
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

async function postSitio(pedido, env, corpo, autor, ip) {
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
  const visivel = soCaixas ? 1 : 0;

  const r = await env.DB.prepare(
    'INSERT INTO envios (tipo, sitio, lat, lon, nome, aparelhos, nota, ' +
    'visivel, estado, autor, ip_resumo, criado_em) ' +
    'VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12) RETURNING id')
    .bind('sitio', corpo.sitio ?? null, v.lat, v.lon,
          nome, JSON.stringify(v.aparelhos), nota,
          visivel, soCaixas ? 'aceite' : 'pendente', autor, ip, agora())
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

  if (ip) {
    const t = await travar(env, `${hoje()}:cf:${ip}`, 80);
    if (!t.passou) return erro('demasiadas confirmações desta ligação hoje.', 429);
  }

  // UM DISPOSITIVO, UMA CONFIRMAÇÃO POR SÍTIO. A segunda substitui a primeira em
  // vez de somar — senão o selo de frescura seria trivial de encher e um selo
  // que mente é pior do que selo nenhum.
  await env.DB.prepare(
    'INSERT INTO confirmacoes (sitio, autor, existe, aparelhos, ip_resumo, criado_em) ' +
    'VALUES (?1,?2,?3,?4,?5,?6) ' +
    'ON CONFLICT(sitio, autor) DO UPDATE SET ' +
    'existe = ?3, aparelhos = ?4, criado_em = ?6')
    .bind(sitio, autor, existe, ap.length ? JSON.stringify(ap) : null, ip, agora())
    .run();

  const c = await env.DB.prepare(
    'SELECT COUNT(*) AS quantos, MAX(criado_em) AS ultima FROM confirmacoes ' +
    'WHERE sitio = ?1 AND existe = 1').bind(sitio).first();
  return json({ ok: true, confirmacoes: c?.quantos || 0, ultima: c?.ultima || null });
}

/* O DELTA. É o único caminho de LEITURA que passa por aqui, e é pequeno de
   propósito: só o que ainda não foi cozido no ficheiro estático. Uma resposta
   típica são zero ou meia dúzia de linhas. */
async function getDelta(env) {
  const [novos, conf] = await Promise.all([
    env.DB.prepare(
      "SELECT id, lat, lon, nome, aparelhos, criado_em FROM envios " +
      "WHERE tipo = 'sitio' AND visivel = 1 AND cozido_em IS NULL " +
      "ORDER BY id LIMIT 500").all(),
    env.DB.prepare(
      'SELECT sitio, COUNT(*) AS quantos, MAX(criado_em) AS ultima ' +
      'FROM confirmacoes WHERE existe = 1 GROUP BY sitio LIMIT 2000').all(),
  ]);
  return json({
    versao: VERSAO,
    gerado_em: agora(),
    novos: (novos.results || []).map(r => ({
      id: r.id, lat: r.lat, lon: r.lon, nome: r.nome,
      ap: JSON.parse(r.aparelhos || '[]'), desde: r.criado_em,
    })),
    confirmados: (conf.results || []).map(r => ({
      s: r.sitio, n: r.quantos, em: r.ultima,
    })),
  }, 200, { 'cache-control': 'public, max-age=300' });
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
      if (rota === '/v1/delta' && pedido.method === 'GET') return responder(await getDelta(env));

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

      if (rota === '/v1/sitios') return responder(await postSitio(pedido, env, corpo, autor, ip));
      if (rota === '/v1/confirmar') return responder(await postConfirmar(pedido, env, corpo, autor, ip));
      return responder(erro('rota desconhecida', 404));
    } catch (e) {
      return responder(erro('avaria no servidor', 500, { detalhe: String(e).slice(0, 200) }));
    }
  },
};
