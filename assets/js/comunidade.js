/* O que as pessoas sabem e as fontes não têm.
 *
 * PORQUE ISTO EXISTE. O OpenStreetMap tem cerca de 900 sítios em Portugal e 130
 * dos 308 concelhos ficam a zero. Foi verificado balde a balde — as etiquetas
 * todas do OSM, o dados.gov.pt inteiro, os servidores de mapas de 29 câmaras —
 * e não há mais nada para ir buscar. O mapa só se enche com quem lá vai.
 *
 * A ASSINATURA, E PORQUE SÓ NASCE NO FIM.
 * Quem só consulta o mapa não deixa nada no aparelho. A assinatura é criada no
 * instante em que a pessoa carrega em «Enviar» pela primeira vez, e não antes.
 * Não é preciosismo: o §63 das Orientações 2/2023 do Comité Europeu para a
 * Protecção de Dados trata ler um identificador guardado no aparelho como
 * acesso ao equipamento terminal, e a isenção de «estritamente necessário» só
 * se aplica ao serviço que a pessoa PEDIU. Consultar o mapa não é pedir nada;
 * enviar um sítio é. É esta separação que mantém a aplicação sem aviso de
 * cookies — que é meio posicionamento dela.
 *
 * E o que sai do aparelho é só o RESUMO da assinatura. O segredo fica no
 * telemóvel; o servidor guarda um resumo que serve para duas coisas do próprio
 * serviço pedido: não deixar a mesma pessoa confirmar o mesmo sítio duas vezes,
 * e deixá-la ver e apagar o que enviou. Para mais nada — e é essa a condição.
 */
const Comunidade = (() => {
  'use strict';

  const CHAVE = 'cs:assinatura';
  let resumoEmCache = null;

  function hex(buffer) {
    return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /* Devolve o resumo da assinatura, criando-a se for a primeira vez.
     `criar: false` devolve null em vez de escrever no aparelho — é assim que a
     aplicação sabe se a pessoa já contribuiu, sem lhe tocar. */
  async function assinatura({ criar = true } = {}) {
    if (resumoEmCache) return resumoEmCache;
    let segredo = null;
    try { segredo = localStorage.getItem(CHAVE); } catch (e) { /* modo privado */ }
    if (!segredo) {
      if (!criar) return null;
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      segredo = hex(bytes.buffer);
      try { localStorage.setItem(CHAVE, segredo); } catch (e) { /* segue sem memória */ }
    }
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(segredo));
    resumoEmCache = hex(d);
    return resumoEmCache;
  }

  function jaContribuiu() {
    try { return !!localStorage.getItem(CHAVE); } catch (e) { return false; }
  }

  function esquecer() {
    try { localStorage.removeItem(CHAVE); } catch (e) { /* nada a fazer */ }
    resumoEmCache = null;
  }

  /* ------------------------------------------------------------------ pedidos */

  function base() {
    return (CONFIG.api || '').replace(/\/+$/, '');
  }

  function ligada() {
    return !!base();
  }

  async function enviar(rota, dados) {
    if (!ligada()) return { ok: false, erro: 'sem servidor configurado' };
    const corpo = Object.assign({ autor: await assinatura() }, dados);
    let r;
    try {
      r = await fetch(base() + rota, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corpo),
      });
    } catch (e) {
      // SEM REDE NÃO SE PERDE O QUE A PESSOA ESCREVEU. Fica na fila do aparelho
      // e vai da próxima vez que a aplicação abrir com rede.
      guardarNaFila(rota, dados);
      return { ok: false, erro: 'sem rede', naFila: true };
    }
    let d = {};
    try { d = await r.json(); } catch (e) { /* resposta sem corpo */ }
    if (!r.ok) return { ok: false, erro: d.erro || `erro ${r.status}`, estado: r.status };
    return Object.assign({ ok: true }, d);
  }

  /* -------------------------------------------------------------------- fila */

  const FILA = 'cs:fila';

  function lerFila() {
    try { return JSON.parse(localStorage.getItem(FILA) || '[]'); } catch (e) { return []; }
  }

  function guardarNaFila(rota, dados) {
    try {
      const f = lerFila();
      if (f.length >= 20) return;                     // não se enche a memória de ninguém
      f.push({ rota, dados, quando: Date.now() });
      localStorage.setItem(FILA, JSON.stringify(f));
    } catch (e) { /* modo privado: perde-se, e paciência */ }
  }

  async function escoarFila() {
    const f = lerFila();
    if (!f.length || !ligada()) return 0;
    let saiu = 0;
    for (const item of f.slice()) {
      const r = await enviar(item.rota, item.dados);
      if (r.ok || r.estado === 400 || r.estado === 429) {
        // Sai da fila se passou, e também se o servidor o recusou por razão que
        // não muda com o tempo — senão fica a bater na porta para sempre.
        f.shift(); saiu++;
      } else {
        break;
      }
    }
    try { localStorage.setItem(FILA, JSON.stringify(f)); } catch (e) { /* nada */ }
    return saiu;
  }

  /* ------------------------------------------------------------------- delta */

  /* O QUE MUDOU DESDE A ÚLTIMA CONSTRUÇÃO. É o único caminho de leitura que bate
     no servidor, e é minúsculo de propósito: os sítios aprovados que ainda não
     entraram no ficheiro estático, e a contagem de confirmações por sítio.
     Se falhar, a aplicação fica exactamente como estava — os 887 sítios vêm de
     um ficheiro que a rede de distribuição serve, e não daqui. */
  async function delta() {
    if (!ligada()) return null;
    try {
      // SEM `no-cache`. O servidor manda `max-age=300`; forçar o browser a
      // revalidar a cada visita transformava isto num pedido ao Worker por
      // pessoa, e os 100 000 pedidos/dia do plano gratuito são POR CONTA e
      // partilhados com outro projecto. Cinco minutos de atraso num sítio novo
      // não incomoda ninguém; ficar sem API a meio de um dia bom, sim.
      const r = await fetch(base() + '/v1/delta');
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    }
  }

  return {
    ligada, jaContribuiu, esquecer, assinatura, delta, escoarFila,
    novoSitio: dados => enviar('/v1/sitios', dados),
    confirmar: dados => enviar('/v1/confirmar', dados),
  };
})();
