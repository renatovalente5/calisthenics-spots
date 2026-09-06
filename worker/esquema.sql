-- ---------------------------------------------------------------- envios
-- O QUE ISTO GUARDA, E O QUE NÃO PODE GUARDAR.
--
-- Esta tabela é a caixa de correio da comunidade. Um envio NUNCA referencia um
-- objecto do OpenStreetMap — nem `osm_id`, nem `ref:osm`, nem uma coordenada
-- copiada de um nó do OSM. Não é escrúpulo: a orientação da OSMF sobre camadas
-- horizontais diz que dois conjuntos que se referenciem deixam de ser bases
-- independentes, e nesse instante o ficheiro da comunidade passa a ser uma base
-- derivada do OSM e não pode sair em CC0. Há um teste no CI que morre se
-- aparecer aqui uma chave que não esteja prevista.
CREATE TABLE IF NOT EXISTS envios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo          TEXT    NOT NULL,   -- 'sitio' | 'correccao' | 'ausente'
  sitio         INTEGER,            -- id estável do sítio; NULL num sítio novo
  lat           REAL,
  lon           REAL,
  nome          TEXT,
  aparelhos     TEXT,               -- JSON: ["barra_fixa","paralelas"]
  nota          TEXT,
  estado        TEXT    NOT NULL DEFAULT 'pendente',  -- pendente|aceite|recusado
  -- PUBLICA-SE JÁ, OU ESPERA POR OLHOS?
  -- Um envio feito só de caixas — «barra fixa», «paralelas» — não pode ser
  -- insulto, spam nem pornografia: o pior que dá é um pino no sítio errado, e
  -- isso as confirmações corrigem. Esses ficam visíveis no instante em que são
  -- enviados, que é o que faz alguém voltar a contribuir.
  -- Um envio com NOME ou NOTA escritos à mão já é texto livre de um estranho
  -- publicado com a nossa cara. Esse espera. É a diferença entre moderar tudo
  -- (lento, e a promessa quebra-se na primeira semana atarefada) e moderar o
  -- que precisa mesmo.
  visivel       INTEGER NOT NULL DEFAULT 0,
  motivo        TEXT,               -- porque foi recusado, para se poder dizer
  autor         TEXT    NOT NULL,   -- resumo da assinatura do autor (ver o Worker)
  ip_resumo     TEXT,               -- SHA-256 truncado do IP + sal diário
  -- A PROVA DA CEDÊNCIA. Sem isto não há como demonstrar que quem contribuiu
  -- aceitou que o texto possa ser publicado, redistribuído e devolvido ao
  -- OpenStreetMap — e sem essa prova o ficheiro da comunidade não pode sair em
  -- CC0. Guarda-se a VERSÃO do texto aceite, não só «sim».
  cedencia      TEXT,
  criado_em     TEXT    NOT NULL,
  decidido_em   TEXT,
  -- Quando o envio já foi «cozido» no ficheiro estático. Enquanto for NULL, o
  -- sítio viaja no delta que a aplicação vai buscar à API; depois disso deixa de
  -- viajar, porque já está no spots.json que a rede de distribuição serve.
  cozido_em     TEXT
);
CREATE INDEX IF NOT EXISTS envios_estado ON envios(estado, criado_em);
CREATE INDEX IF NOT EXISTS envios_sitio  ON envios(sitio);

-- ---------------------------------------------------- confirmações de frescura
-- «Este sítio ainda cá está e tem isto.» É a acção mais barata e a mais valiosa:
-- é o que nos deixa dizer «confirmado há N dias», que é a única coisa que
-- nenhum concorrente pode copiar sem refazer a base de dados de raiz.
--
-- NÃO passa por moderação: uma confirmação que demore um dia a contar não vale
-- nada. O que a protege do abuso é a chave única — cada autor confirma um
-- sítio uma vez, e uma segunda confirmação substitui a primeira em vez de somar.
CREATE TABLE IF NOT EXISTS confirmacoes (
  sitio         INTEGER NOT NULL,
  autor         TEXT    NOT NULL,
  existe        INTEGER NOT NULL,   -- 1 = ainda cá está, 0 = já não existe
  aparelhos     TEXT,               -- opcional: o que a pessoa viu
  -- A ALTURA DA BARRA, e não há campo nenhum no mundo que a tenha.
  -- É a primeira pergunta de quem faz calistenia — numa barra baixa não se
  -- fazem elevações a sério, numa alta demais não se chega — e nenhum
  -- directório a regista. Não se pede em centímetros: ninguém anda com fita
  -- métrica. Pede-se o que qualquer pessoa sabe responder pendurada nela:
  --   'chao'  = os pés chegam ao chão  (barra baixa; dá para remadas)
  --   'ar'    = fico no ar             (barra alta; dá para elevações a sério)
  --   NULL    = não experimentei
  altura        TEXT,
  ip_resumo     TEXT,
  criado_em     TEXT    NOT NULL,
  PRIMARY KEY (sitio, autor)
);
CREATE INDEX IF NOT EXISTS confirmacoes_sitio ON confirmacoes(sitio);

-- --------------------------------------------------------------- travões
-- Contagem por resumo de IP e por dia. Sem isto, uma pessoa aborrecida enche o
-- mapa numa tarde e o selo de frescura passa a mentir — e um selo que mente é
-- pior do que selo nenhum.
CREATE TABLE IF NOT EXISTS travao (
  chave         TEXT    PRIMARY KEY,   -- '<dia>:ip:<resumo>'
  quantos       INTEGER NOT NULL DEFAULT 0,
  ate           TEXT    NOT NULL       -- quando a linha pode ser apagada
);
