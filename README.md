# Calisthenics Spots

**Onde treinar calistenia ao ar livre em Portugal.** Barras de elevações,
paralelas, argolas e espaldares — em parques, jardins e passeios públicos, com o
que se sabe de cada sítio e com o que ainda não se sabe dito à frente.

→ **[calisthenics-spots.pt](https://calisthenics-spots.pt)** *(domínio por comprar;
por agora em [renatovalente5.github.io/calisthenics-spots](https://renatovalente5.github.io/calisthenics-spots/))*

---

## O problema

Isto é uma aplicação de **calistenia**: sítios com barras onde se suporta o peso
do corpo. Não é um directório de circuitos de máquinas guiadas para seniores —
bicicletas estáticas, elípticas, volantes de ombros. E é aí que está a
dificuldade, porque **as duas coisas partilham a mesma etiqueta no mapa**.

O OpenStreetMap não regista parques de calistenia: regista **aparelhos**, um
ponto por máquina, quase sempre sem dizer que máquina é. Em Portugal são ~1500
pontos com `leisure=fitness_station`. Desses, só ~140 têm nome — e o nome é o do
aparelho («Abdominais», «Flexões de Braços»), não o do sítio.

**Medido:** quando o OSM diz o que lá está, **57 % têm barras**. Nos outros
87,5 %, não se sabe. Não é que a maioria seja ginásio de máquinas — é que a
maioria é desconhecida.

## O que este projecto faz

### 1. Junta as fontes que sabem mesmo o que lá está

| Fonte | O que dá | Licença |
|---|---|---|
| **OpenStreetMap** | Cobertura de todo o país | ODbL |
| **Câmara de Cascais** | Uma coluna por aparelho: `barra_elevacao`, `barra_paralela`, `espaldar`, `argola` | CC-BY |
| **Câmara de Oeiras** | Cada aparelho à parte, com o nome: «Pull Up», «Dip Bars» | CC-BY |
| **Câmara de Lisboa** | 67 equipamentos com o nome municipal | CC0 |
| **CAOP (DGT)** | Concelho, distrito e região, por ponto-em-polígono, offline | — |

Os conjuntos das câmaras são descobertos pela API do
[dados.gov.pt](https://dados.gov.pt/) e não por URLs escritos à mão — o ficheiro
de Cascais tem a data no nome e mudaria sozinho dentro de um mês.

**Oeiras publica em EPSG:3763** (ETRS89 / PT-TM06), em metros. A conversão
inversa de Transversa de Mercator está escrita à mão em `fontes-municipais.py`,
porque o projecto não tem dependências. Sem ela, 87 sítios apareciam a sul da
Antárctida — e há uma guarda que recusa uma fonte inteira se algum ponto sair de
Portugal.

### 2. Agrupa — um sítio não é um aparelho

Aparelhos a menos de **75 m** são o mesmo sítio. O raio saiu dos dados: a
distância ao vizinho mais próximo é bimodal, com metade a menos de 51 m e um
salto para centenas de metros a partir do percentil 60.

```
p25 = 12 m   p50 = 51 m  │  p60 = 202 m   p70 = 581 m
── mesmo parque ─────────┴── parques diferentes ──
```

Segunda passagem: funde zonas do **mesmo parque com nome** a menos de 250 m — só
as com nome, para o Parque do Calhau (400 ha, Monsanto) não colapsar num ponto.

### 3. Nomeia a partir do LUGAR

Por ordem: o nome municipal (é o que está na placa), o parque ou jardim que
contém o sítio, ou a localidade. Nunca o nome do aparelho — senão cinco sítios
chamavam-se «Abdominais».

### 4. Classifica, e diz o que não sabe

| Escalão | O que significa | Por omissão |
|---|---|---|
| **Barras confirmadas** | Barra fixa, paralelas, argolas, espaldar ou escada horizontal | visível |
| **Peso corporal** | Equipamento de peso corporal, sem barra nomeada | visível |
| **Por confirmar** | Há equipamento; não se sabe qual | visível |
| **Só máquinas** | Máquinas guiadas — o circuito para seniores | **escondido** |

**Não se filtra pelo NOME.** É a heurística mais tentadora e a mais errada:
verificado nos dois sentidos — os «Circuitos de Manutenção» de Cascais têm barra
fixa, paralelas e espaldar; outros com o mesmo nome só têm máquinas. Só o
equipamento distingue.

### 5. Deixa ver o sítio antes de lá ir

Três formas, todas gratuitas e sem chave nenhuma:

- **Vista aérea na própria ficha** — as **ortofotos oficiais da Direção-Geral
  do Território** (CC-BY), ~25 cm/px, centradas no ponto. Vê-se o pórtico das
  barras.
- **Street View** — ligação para o Google Maps ao nível do chão.

A ortofoto vem como `<img>` e não como camada do mapa, e não foi escolha:
o servidor da DGT manda `Access-Control-Allow-Origin` **duas vezes**, e a
especificação do CORS exige exactamente um. Medido nos três modos — `fetch`
falha, `<img crossOrigin>` falha, `<img>` simples funciona. O MapLibre precisa
de CORS para as texturas de WebGL; uma imagem numa ficha não precisa. Satélite
*dentro* do mapa só com uma chave do Google.

## Arquitectura

Ficheiros estáticos no GitHub Pages. Sem servidor, sem base de dados, sem npm,
sem passo de compilação para o site — e **sem custo recorrente**.

| Peça | Escolha | Porquê |
|---|---|---|
| Mapa | **MapLibre GL JS**, alojado aqui | Sem chave, sem CDN, sem terceiros a ver o IP de quem visita |
| Mosaicos | **OpenFreeMap**, com **VersaTiles** de reserva | Sem chave, sem limite; o URL está numa constante |
| Vista aérea | **Ortofotos da DGT** (WMS, CC-BY) | Oficial, portuguesa, aberta, sem cookies |
| Navegação | **Ligação** para o Google/Apple Maps | Grátis, sem chave. Um *iframe* do Google arrastaria cookies e obrigaria a banner |
| Dados | ~275 KB de JSON de uma vez | Cabe na memória; filtrar é instantâneo |
| Zonas | índice dos 308 concelhos (11 KB) + um contorno por concelho (~1 KB) | O índice enquadra o mapa no instante do clique; o contorno chega a seguir |

### Sobre o Google Maps

O condutor do Google **está escrito e pronto** em `assets/js/mapa.js`: basta pôr
uma chave em `assets/js/config.js`. Mas leia-se o que lá está antes, porque a
troca é real:

- uma chave de produção **exige cartão** — sem conta de facturação a Google
  devolve um mapa escurecido com «for development purposes only»;
- **não existe tecto diário**. A documentação da Maps JS API só define quotas
  por minuto, e os orçamentos do Cloud Billing só enviam email. São 10 000
  carregamentos grátis por mês e 7 USD por cada 1000 acima disso;
- **o Google Maps põe cookies**, e este site hoje não põe nenhum. Activá-lo
  obriga a banner de consentimento.

Há uma [Demo Key](https://developers.google.com/maps/demo-key) sem cartão, para
experimentar. E se a chave falhar ou esgotar a quota, o `gm_authFailure` devolve
o site ao mapa livre em vez de deixar um rectângulo cinzento.

## Como se constrói

```bash
python3 _source/recolher.py           # OpenStreetMap + CAOP -> _source/bruto/
python3 _source/fontes-municipais.py  # Lisboa, Cascais, Oeiras (via dados.gov.pt)
python3 _source/gerar-spots.py        # agrupa, nomeia, classifica -> data/spots.json
python3 _source/recolher.py --ruas    # as ruas de cada sítio (lento, opcional)
python3 _source/gerar-zonas.py        # concelhos -> data/concelhos.json + data/limites/
python3 _source/gerar-paginas.py      # páginas + sw.js + manifesto
python3 _source/gerar-imagens.py      # ícones e imagem social, desenhados em Chrome
```

Nada é escrito à mão duas vezes: os números das páginas vêm de
`data/spots.json`, e a construção **morre** se um marcador ficar por substituir.
A versão do `?v=` e da cache do service worker é um resumo do próprio conteúdo.

## Como se testa

```bash
python3 _source/servidor.py           # serve em /calisthenics-spots/, como o Pages
python3 _source/testar-dados.py       # guardas sobre data/spots.json
python3 _source/testar-ligacoes.py    # nenhuma ligação interna morta
python3 _source/testar-app.py         # CONDUZ a aplicação num Chrome a sério
python3 _source/capturar.py           # capturas de ecrã verdadeiras
```

O servidor local **não** é um `python3 -m http.server`. Sem domínio próprio o
GitHub Pages serve o site em `/calisthenics-spots/`, e é esse o prefixo que a
construção escreve nos caminhos; servir a pasta na raiz dava 200 onde a produção
dá 404.

`testar-app.py` carrega em botões, escreve na caixa de procura, arrasta a lista
até ao fim e mede a geometria no ecrã. Corre também **sem WebGL**, a fingir que
o browser não o suporta, para garantir que a lista se aguenta sozinha.

## O domínio

Enquanto `calisthenics-spots.pt` não estiver comprado, o site vive em
`/calisthenics-spots/`. Isso é **derivado**: a construção procura um ficheiro
`CNAME` na raiz e, se o encontrar, passa a BASE a `/`.

```bash
cp _source/CNAME-quando-o-dominio-existir CNAME
python3 _source/gerar-paginas.py
```

E nos DNS: quatro registos A para `185.199.108.153`, `.109.153`, `.110.153`,
`.111.153`, mais um CNAME de `www` para `renatovalente5.github.io`. Depois, em
*Settings → Pages*, ligar **Enforce HTTPS**.

## As armadilhas conhecidas

Escritas aqui porque nenhuma delas dá erro — todas falham em silêncio.

1. **O service worker prende as pessoas a uma versão velha.** Guarda: rede
   primeiro nas navegações **com prazo de 3 s**, nome da cache derivado do
   conteúdo, `updateViaCache: 'none'`, e `registration.update()` sempre que a
   aplicação volta a ficar visível.
2. **«Perto de mim» falha em silêncio no iPhone.** Numa PWA instalada, o pedido
   pode nunca chamar nem o sucesso nem o erro. Guarda: prazo de 8 s, três
   mensagens distintas conforme a causa, e a procura por concelho como caminho
   de igual dignidade.
3. **O MapLibre atira no construtor sem WebGL.** Guarda: `try/catch`, o
   separador «Mapa» desaparece, a lista continua. Há um teste que finge não
   haver WebGL.
4. **O OpenFreeMap pode desaparecer** — um mantenedor, doações. Guarda: o URL
   está numa constante e o VersaTiles entra sozinho ao fim de 9 s.
5. **Coordenadas projectadas.** Oeiras publica em EPSG:3763. Guarda: lê-se o
   campo `crs` do GeoJSON e recusa-se a fonte inteira se algum ponto sair de
   Portugal.
6. **Uma recolha mais pequena não substitui a anterior.** O Overpass pode
   devolver 200, JSON válido e sem aviso, com a consulta cortada a meio.
   Guarda: abaixo de 90 % do que já lá estava, mantém-se o anterior e exige-se
   `--forcar`.
7. **Escolher uma zona não é escrever o nome dela.** Escolhido «Viana do
   Castelo», o filtro é o CONCELHO. Pelo texto, os parques de Caminha
   apareciam — porque «Viana do Castelo» é o DISTRITO deles.
8. **O índice tem os 308 concelhos, não só os 176 com sítios.** Sem os outros,
   procurar um concelho vazio caía em silêncio no vizinho.
9. **A partilha-nos-mesmos-termos da ODbL engole texto próprio.** Guarda: o
   ficheiro de dados só leva factos derivados das fontes.
10. **As acções agendadas do GitHub desligam-se** ao fim de 60 dias sem
    actividade. Guarda: `workflow_dispatch` sempre presente, e esta nota.
11. **Uma coordenada do utilizador nunca sai do aparelho.** Nem para o Overpass,
   nem para um geocodificador, nem para estatísticas. É isso que sustenta não
   haver pedido de consentimento.

## Licenças

O **código** está sob MIT. Os **dados não**.

`data/spots.json` deriva do OpenStreetMap e está sob
**[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)** — texto em
[`LICENSE-DADOS.txt`](LICENSE-DADOS.txt). Quem o usar tem de atribuir
**© contribuidores do OpenStreetMap** e manter obras derivadas sob ODbL. A
atribuição viaja dentro do próprio ficheiro, no bloco `meta`.

Complementos: **Câmara Municipal de Lisboa** (CC0), **Câmara Municipal de
Cascais** e **Câmara Municipal de Oeiras** (CC-BY 4.0).
Limites administrativos e ortofotos: **Direção-Geral do Território**.
Mosaicos: **OpenFreeMap** + **OpenMapTiles**.
`assets/vendor/maplibre-gl.*`: **MapLibre GL JS**, BSD-3-Clause.

Precisas dos dados? Leva o ficheiro em vez de rastejar o site:
`/data/spots.json`.

## Privacidade

Sem cookies, sem publicidade, sem contas, sem estatísticas de visitas, sem
banner de consentimento. A localização é tratada dentro do browser e **nunca sai
do aparelho** — é o que permite não haver pedido de consentimento (Diretrizes
2/2023 do CEPD, §44).
