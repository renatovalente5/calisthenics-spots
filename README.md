# Barra Fixe

**O mapa das barras de rua em Portugal.** 833 parques e espaços com barras de
elevações, paralelas, argolas e espaldares, em 178 concelhos — com o que se sabe
de cada um, e com o que ainda não se sabe dito à frente.

→ **[barrafixe.pt](https://barrafixe.pt)**

*Barra fixa* é o nome do aparelho. *Fixe* é como se diz «bom» em Portugal.

---

## O problema que isto resolve

Existem mapas internacionais de calistenia. Todos têm o mesmo defeito, e vem da
mesma raiz: **o OpenStreetMap não regista parques de calistenia — regista
aparelhos**, um ponto por máquina, quase sempre sem dizer que máquina é.

Em Portugal são 1477 pontos com `leisure=fitness_station`. Desses:

- só **140** têm nome, e o nome é o do aparelho («Abdominais», «Flexões de Braços»);
- só **~60** dizem que aparelho são;
- **562** são um ponto solitário, sem nome nem descrição.

Quem despeja isto tal e qual num site fica com resultados como
`Outdoor Gym - Tver - Tver - C…` e chama «Calisthenics Park» a um circuito de
bicicletas estáticas para seniores. Este projecto faz três coisas em vez disso.

### 1. Agrupar — um sítio não é um aparelho

Os aparelhos a menos de **75 metros** uns dos outros são o mesmo sítio.
O raio não é um palpite: a distância de cada aparelho ao vizinho mais próximo é
bimodal — metade tem um irmão a menos de 51 m, e a partir do percentil 60 salta
para centenas de metros. 75 m fica no vale, do lado conservador.

```
p25 = 12 m   p50 = 51 m  │  p60 = 202 m   p70 = 581 m
── mesmo parque ─────────┴── parques diferentes ──
```

Segue-se uma segunda passagem que funde zonas do **mesmo parque com nome** a
menos de 250 m — mas só as com nome, para o Parque do Calhau (400 ha, em
Monsanto) não colapsar as suas zonas distantes num ponto só.

**1477 aparelhos → 13 recusados → 847 grupos → 795 sítios → 833 com Lisboa.**

### 2. Nomear — o nome vem do lugar, não da máquina

Por ordem: o parque ou jardim que contém o sítio (*Jardim do Torel*), o mesmo a
menos de 120 m, ou a localidade (*Zambujeira do Mar*). A linha de morada junta a
rua mais próxima, a localidade, o concelho e o distrito.

Concelho, distrito e região saem da **CAOP** (Carta Administrativa Oficial de
Portugal, DGT) por ponto-em-polígono, offline. Sem geocodificação, sem API,
sem limites de pedidos.

Em Lisboa entra uma segunda fonte: os **Equipamentos de Fitness** da Câmara
Municipal de Lisboa (Lisboa Aberta, **CC0**). 67 pontos que acrescentam 38
sítios ausentes do OSM e emprestam o nome municipal a outros — mas só depois de
lhes tirar o prefixo `Fitness ` do conjunto de dados, que transformava
«Jardim do Torel» em «Fitness Jardim do Torel».

### 3. Classificar — dizer o que se sabe, e o que não se sabe

| Escalão | Sítios | Significa |
|---|---:|---|
| Barras confirmadas | 56 | O OSM indica barra fixa, paralelas, argolas, espaldar ou escada horizontal |
| Peso corporal | 27 | Equipamento de peso corporal, sem barra nomeada |
| Por confirmar | 744 | Há equipamento; não se sabe qual |
| Só máquinas | 6 | Só máquinas guiadas — sem barras |

**89 % dos sítios estão por confirmar, e o site diz isso.** É a diferença entre
este mapa e os outros — e é o motor da comunidade: quem lá for, confirma, e a
confirmação vai para o OpenStreetMap, não fica aqui.

---

## Arquitectura

Ficheiros estáticos no GitHub Pages. Sem servidor, sem base de dados, sem npm,
sem passo de compilação para o site — e **sem custo recorrente nenhum**.

| Peça | Escolha | Porquê |
|---|---|---|
| Mapa | **MapLibre GL JS**, alojado aqui | Sem chave, sem CDN, sem terceiros a ver o IP de quem visita |
| Mosaicos | **OpenFreeMap** | Sem chave, sem conta, sem limite. O URL do estilo é uma constante — troca-se numa linha |
| Navegação | **Ligação** para o Google Maps / Apple Maps | Grátis e sem chave. Um *iframe* do Google arrastaria cookies e obrigaria a banner de consentimento |
| Dados | 265 KB de JSON, carregados de uma vez | 833 sítios cabem na memória; filtrar e ordenar é instantâneo e não precisa de servidor |
| Tipografia | Pilha do sistema | Zero pedidos à rede, zero cookies de terceiros |

**O Google Maps JavaScript API foi deliberadamente rejeitado**: exige chave com
conta de facturação, e uma chave numa página estática é pública. «Custo zero»
não pode depender de ninguém se portar bem.

## Como se constrói

```bash
python3 _source/recolher.py          # OpenStreetMap + CAOP -> _source/bruto/
python3 _source/gerar-spots.py       # agrupa, nomeia, classifica -> data/spots.json
python3 _source/recolher.py --ruas   # as ruas de cada sítio (lento, opcional)
python3 _source/gerar-paginas.py     # páginas + sw.js, com os números dos dados
python3 _source/gerar-imagens.py     # ícones e imagem social, desenhados em Chrome
```

Nada é escrito à mão duas vezes: os números das páginas («833 sítios») vêm de
`data/spots.json`, e a construção **morre** se um marcador ficar por substituir.
A versão do `?v=` e da cache do service worker é um resumo do próprio conteúdo —
não há números a incrementar à mão.

## Como se testa

```bash
python3 _source/testar-dados.py      # guardas sobre data/spots.json
python3 _source/testar-app.py        # CONDUZ a aplicação num Chrome a sério
python3 _source/capturar.py          # capturas de ecrã verdadeiras
```

`testar-app.py` carrega em botões, escreve na caixa de procura, arrasta a lista
até ao fim e verifica a geometria no ecrã — porque um mapa que nunca desenha,
uma lista que fica nos primeiros 40 resultados ou um canvas de 195×300 dentro de
uma caixa de 845×609 não dão erro nenhum na consola.

Corre também **sem WebGL**, a fingir que o browser não o suporta, para garantir
que a lista se aguenta sozinha.

## Licenças

O **código** está sob MIT. Os **dados não**.

`data/spots.json` é uma base de dados derivada do OpenStreetMap e está sob a
**[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)** — texto completo
em [`LICENSE-DADOS.txt`](LICENSE-DADOS.txt). Quem o usar tem de atribuir
**© contribuidores do OpenStreetMap** e manter obras derivadas sob ODbL.
A atribuição viaja dentro do próprio ficheiro, no bloco `meta`.

Complemento em Lisboa: **Câmara Municipal de Lisboa**, Equipamentos de Fitness, CC0.
Limites administrativos: **CAOP**, Direção-Geral do Território.
Mosaicos: **OpenFreeMap** + **OpenMapTiles**.
`assets/vendor/maplibre-gl.*`: **MapLibre GL JS**, BSD-3-Clause.

Precisas dos dados? Leva o ficheiro em vez de rastejar o site:
<https://barrafixe.pt/data/spots.json>

## As armadilhas conhecidas

Escritas aqui porque nenhuma delas dá erro — todas falham em silêncio.

1. **O service worker prende as pessoas a uma versão velha.** O TTL do GitHub
   Pages não se muda e uma aplicação instalada nunca é fechada. Guarda: rede
   primeiro nas navegações **com prazo de 3 s**, nome da cache derivado do
   conteúdo, `updateViaCache: 'none'`, e `registration.update()` sempre que a
   aplicação volta a ficar visível.
2. **«Perto de mim» falha em silêncio no iPhone.** Numa PWA instalada, o pedido
   de localização pode nunca chamar nem o sucesso nem o erro. Guarda: prazo de
   8 s, três mensagens distintas conforme a causa, e a procura por concelho
   como caminho de igual dignidade — que funciona sempre.
3. **O MapLibre atira no construtor sem WebGL** (~3,5 % dos aparelhos, quase
   todos Android velhos). Guarda: `try/catch` à volta do construtor, o separador
   «Mapa» desaparece, a lista continua. Há um teste que finge não haver WebGL.
4. **O OpenFreeMap pode desaparecer** — um mantenedor, doações, termos que
   permitem desligar sem aviso. Guarda: o URL está numa constante e há um
   fornecedor de reserva (VersaTiles) que entra sozinho ao fim de 9 s.
5. **A partilha-nos-mesmos-termos da ODbL engole texto próprio.** Uma descrição
   escrita à mão dentro de `data/spots.json` licenciaria essa prosa a toda a
   gente. Guarda: o ficheiro só leva factos derivados das fontes; o texto do
   site vive no HTML.
6. **As acções agendadas do GitHub desligam-se sozinhas** ao fim de 60 dias sem
   actividade no repositório, e a recolha mensal pára sem erro nenhum. Guarda:
   `workflow_dispatch` sempre presente, e esta nota.
7. **Uma coordenada do utilizador nunca pode sair do aparelho.** Nem para o
   Overpass, nem para um geocodificador, nem para estatísticas. É isso que
   sustenta não haver pedido de consentimento. Tudo o que é preciso está no
   ficheiro estático.

## Privacidade

Sem cookies, sem publicidade, sem contas, sem estatísticas de visitas, sem
banner de consentimento. A localização é tratada dentro do browser e **nunca
sai do aparelho** — é o que permite não haver pedido de consentimento
(Diretrizes 2/2023 do CEPD, §44). Ver [`/privacidade/`](https://barrafixe.pt/privacidade/).
