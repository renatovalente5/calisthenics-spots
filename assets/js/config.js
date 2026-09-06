/* Calisthenics Spots — configuração.
   ============================================================================
   ESTE É O ÚNICO FICHEIRO QUE PRECISAS DE EDITAR À MÃO.

   ────────────────────────────────────────────────────────────────────────────
   PRIMEIRO, A BOA NOTÍCIA: JÁ TENS SATÉLITE, SEM CHAVE NENHUMA
   ────────────────────────────────────────────────────────────────────────────
   O botão de satélite no mapa já funciona sem Google e sem chave: usa as
   ORTOFOTOS OFICIAIS da Direção-Geral do Território, sob licença CC-BY 4.0,
   com ~25 cm por pixel — dá para ver o pórtico das barras. Não põe cookies
   de ninguém, não precisa de conta, não pode gerar factura.

   Só precisas do que vem a seguir se quiseres o mapa do Google mesmo.

   ────────────────────────────────────────────────────────────────────────────
   CHAVE DO GOOGLE MAPS — três coisas que tens de saber antes
   ────────────────────────────────────────────────────────────────────────────

   1. UMA CHAVE DE PRODUÇÃO EXIGE CARTÃO. Sem conta de facturação activa, a
      Google devolve `BillingNotEnabledMapError` e um mapa escurecido com
      «for development purposes only» por cima. Não há meio-termo.

   2. NÃO EXISTE UM TECTO DIÁRIO. Isto é importante e eu escrevi o contrário
      numa primeira versão deste ficheiro: a documentação da Maps JavaScript
      API só define quotas POR MINUTO (30 000/min por projecto, 300/min por IP),
      não por dia. E os orçamentos do Cloud Billing **só enviam email** — a
      própria Google escreve que «definir um orçamento não limita automaticamente
      a utilização nem a despesa». Ou seja: não há forma de garantir zero euros
      com uma chave de produção. O patamar gratuito é de 10 000 carregamentos de
      mapa por mês (~333 por dia); acima disso são 7 USD por cada 1000.

   3. O GOOGLE MAPS PÕE COOKIES. Hoje este site não usa cookies nenhuns e por
      isso não tem — nem precisa de ter — aviso de consentimento. No dia em que
      activares a chave, o browser de quem visita passa a contactar a Google e a
      receber cookies dela, e passa a ser obrigatório um banner de consentimento
      e uma referência aos termos do Google Maps na página de privacidade.
      É uma troca a sério, não um detalhe.

   ────────────────────────────────────────────────────────────────────────────
   SE MESMO ASSIM QUISERES: o caminho SEM cartão, para experimentares
   ────────────────────────────────────────────────────────────────────────────
   A Google publica uma «Demo Key» — uma chave real, obtida só com uma conta
   Google, sem cartão, que suporta mapa, satélite e marcadores, com limite
   diário e sem risco de cobrança. Serve para veres o Google Maps dentro do teu
   site e decidires. A Google diz que não é para produção.
       https://developers.google.com/maps/demo-key

   ────────────────────────────────────────────────────────────────────────────
   E SE QUISERES MESMO UMA CHAVE DE PRODUÇÃO
   ────────────────────────────────────────────────────────────────────────────
     1. https://console.cloud.google.com/google/maps-apis/start
        — cria o projecto e liga uma conta de facturação.
     2. Activa SÓ a «Maps JavaScript API». Mais nenhuma.
     3. Credenciais → Criar credenciais → Chave de API.
     4. Na chave, «Restrições de aplicações» → «Sites», e acrescenta as ORIGENS,
        sem caminho — os browsers cortam o caminho nos pedidos entre domínios,
        por isso `.../calisthenics-spots/*` nunca chega a corresponder:
             https://calisthenics-spots.pt/*
             https://www.calisthenics-spots.pt/*
             https://renatovalente5.github.io/*
     5. Em «Restrições de API», escolhe só «Maps JavaScript API».
     6. Quotas: console.cloud.google.com → Maps JavaScript API → Quotas →
        baixa «Map loads per minute per project» para um número pequeno
        (ex.: 60). Não trava o mês inteiro, mas trava um ataque.

   Se a chave falhar ou esgotar a quota, o site NÃO fica com um rectângulo
   cinzento: volta sozinho ao mapa livre com as ortofotos da DGT.
*/
'use strict';

const CONFIG = {
  /* Cola aqui a chave do Google Maps, entre as aspas. Vazio = mapa livre com
     as ortofotos da DGT, que é o que está a correr agora. */
  googleMapsKey: '',

  /* Identificador de mapa da Google (Map ID). Opcional — só se quiseres
     estilizar o mapa no painel deles. Não altera o custo. */
  googleMapId: '',

  /* Com que zoom se abre a ficha de um sítio. 18 mostra o quarteirão;
     19-20 mostra o equipamento na ortofoto. */
  zoomDoSitio: 18,

  /* Onde vão parar os sítios que faltam. O botão da mira abre um assunto aqui
     com a coordenada já preenchida. Se um dia o repositório mudar de nome, é
     esta linha que muda — e mais nenhuma. */
  repo: 'https://github.com/renatovalente5/calisthenics-spots',
};
