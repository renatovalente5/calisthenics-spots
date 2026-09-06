# -*- coding: utf-8 -*-
"""Transforma o despejo do OpenStreetMap em data/spots.json.

   Correr:  python3 _source/gerar-spots.py
   Antes:   python3 _source/recolher.py      (enche _source/bruto/)

   O PROBLEMA QUE ESTE FICHEIRO RESOLVE, e que é o problema todo do projecto:

   O OSM não tem «parques de calistenia» em Portugal. Tem 1477 elementos soltos
   de `leisure=fitness_station`, e a esmagadora maioria é UM NÓ POR APARELHO.
   Um circuito de manutenção com 17 máquinas são 17 nós. Mostrar isso ao
   utilizador dava 1477 resultados para ~800 sítios, com o mesmo sítio repetido
   dezassete vezes.

   Pior: só 140 desses elementos têm `name`, e o nome que têm é o da MÁQUINA —
   «Abdominais», «Flexões de Braços», «Barras Paralelas». Não serve de nome a
   lado nenhum. É por isto que o howtocalisthenics.com mostra coisas como
   «Outdoor Gym - Tver - Tver - C…»: geraram o nome a partir do que havia.

   Portanto, três passos, por esta ordem:

     1. AGRUPAR os aparelhos em sítios, por proximidade;
     2. NOMEAR cada sítio a partir do LUGAR (o parque, o jardim, a localidade);
     3. CLASSIFICAR o que lá há, e dizer com que confiança.
"""
import json, math, os, re, sys, unicodedata, collections, datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRUTO = os.path.join(RAIZ, '_source', 'bruto')
DESTINO = os.path.join(RAIZ, 'data', 'spots.json')
CAOP = os.path.join(RAIZ, '_source', 'caop-municipios.geojson')

# ------------------------------------------------------------- 0. DEITAR FORA
#
# Nem tudo o que traz `leisure=fitness_station` é um sítio para treinar na rua.
# A consulta apanha, e tem de apanhar, porque a etiqueta é a mesma:
#
#   · seis buracos de DISC GOLF — «DiscGolfPark (4) Par 3 - 69 m»;
#   · um estúdio de YOGA, um de TAI CHI e um de ELECTROFITNESS;
#   · dois GINÁSIOS PAGOS que alguém etiquetou como estação de fitness
#     («Premium HealthClub», «Fitness UP Antas»);
#   · uma área de acesso privado.
#
# O que NÃO se deita fora, e é a razão de isto ser uma lista e não uma regra
# larga: «Ginásio ao ar livre» é exactamente o que procuramos. Uma expressão que
# apanhasse «ginásio» levava seis sítios verdadeiros à frente. E o percurso de
# obstáculos do Jamor — «Arms Of Hell», «Low Crawl», «Parede 150cm» — fica: é
# equipamento de treino ao ar livre, público e a sério, e já sai no escalão
# «por confirmar», que é o que honestamente sabemos dele.
RE_NAO_E_CALISTENIA = re.compile(
    r'\b(disc ?golf|yoga|ayuveda|tai ?chi|health ?club|healthclub|'
    r'electrofitness|pilates|padel|crossfit box)\b')
RE_DISC_GOLF = re.compile(r'\b(par ?\d|cesto|tee|fairway)\b')
DESPORTOS_FORA = {'yoga', 'pilates', 'dancing', 'tai_chi', 'disc_golf', 'golf'}


# Um ginásio comercial deixa impressões digitais: telefone, sítio, morada com
# número de porta, marca, horário de semana. Um recinto de barras num jardim não
# tem nada disso. É por aí que se separam — e NÃO por `leisure=fitness_centre`
# sozinho, que foi a primeira tentativa e deitou fora o w733792437: um polígono
# com `fitness_station=horizontal_bar`, sem nome, sem telefone e sem horário,
# que é gente a etiquetar uma área de calistenia ao ar livre da maneira errada.
# Um ginásio fechado nunca leva `fitness_station=*` — essa etiqueta é de quem
# está a descrever um aparelho que se vê da rua.
SINAIS_DE_NEGOCIO = ('phone', 'contact:phone', 'website', 'contact:website',
                     'brand', 'addr:housenumber', 'operator:type')


def e_ginasio_comercial(tags):
    if tags.get('fitness_station'):
        return False                      # descreve um aparelho: é de rua
    if any(k in tags for k in SINAIS_DE_NEGOCIO):
        return True
    h = tags.get('opening_hours')
    if h and h != '24/7' and 'sunrise' not in h:
        return True                       # horário de expediente = porta e chave
    return False


def limpar_nome_cml(n):
    """«Fitness Jardim do Torel» -> «Jardim do Torel».

       O «Fitness» à cabeça é o prefixo do CONJUNTO DE DADOS da Câmara, não
       parte do nome do sítio. Adoptá-lo tal e qual piorava nomes que já
       estavam certos: o Jardim do Torel chama-se Jardim do Torel. Um
       «Circuito de Manutenção do Calhau» já é um nome a sério e fica intacto."""
    n = (n or '').strip()
    n = re.sub(r'^Fitness\s+(?:d[oaes]s?\s+)?', '', n, flags=re.I).strip()
    return n or None


def limpar_morada_cml(m):
    """«Avenida General Correia Barreto(antiga Radial de Benfica)» -> só a
       avenida. O parêntesis com o nome antigo é ruído numa linha de morada."""
    m = (m or '').strip()
    m = re.sub(r'\s*\((?:antig[ao]|ex)[^)]*\)', '', m, flags=re.I).strip()
    return m or None


def deitar_fora(tags):
    """Devolve o motivo da exclusão, ou None para ficar."""
    if tags.get('leisure') == 'fitness_centre' and tags.get('outdoor') != 'yes' \
            and e_ginasio_comercial(tags):
        return 'ginásio comercial'
    if tags.get('access') in ('private', 'customers'):
        return 'acesso ' + tags['access']
    if tags.get('fee') == 'yes':
        return 'pago'
    if tags.get('indoor') == 'yes':
        return 'interior'
    for d in re.split(r'[;,]', tags.get('sport') or ''):
        if d.strip().lower() in DESPORTOS_FORA:
            return 'sport=' + d.strip()
    texto = sem_acentos(' '.join(filter(None, (
        tags.get('name'), tags.get('description'), tags.get('operator')))))
    if texto and RE_NAO_E_CALISTENIA.search(texto):
        return 'nome de outra modalidade'
    # Um ginásio com nome de marca e telefone, mesmo sem `leisure=fitness_centre`.
    if e_ginasio_comercial(tags) and tags.get('leisure') != 'fitness_station':
        return 'ginásio comercial'
    if RE_DISC_GOLF.search(sem_acentos(tags.get('description') or '')):
        return 'descrição de disc golf'
    return None


# ---------------------------------------------------------------- 1. AGRUPAR
#
# RAIO = 75 m. Não é um palpite. A distribuição da distância de cada aparelho ao
# seu vizinho mais próximo, medida sobre os 1477, é francamente bimodal:
#
#     p25 = 12 m    p50 = 51 m    |    p60 = 202 m    p70 = 581 m
#     ─── mesmo parque ───────────┴─── parques diferentes ──────────
#
# Metade dos aparelhos tem um irmão a menos de 51 m; a partir do percentil 60 o
# salto é para centenas de metros. O vale está entre os 75 e os 150 m. Escolhido
# 75 m, o mais conservador do vale: a 150 m já se corria o risco de juntar dois
# parques com uma rua pelo meio.
#
# Contagens medidas: 10 m -> 1240 sítios | 50 m -> 927 | 75 m -> 855 | 150 m -> 791.
#
# O agrupamento é de LIGAÇÃO SIMPLES (single-linkage), de propósito: um circuito
# de manutenção com estações de 60 em 60 m tem de sair como UM circuito, e a
# ligação simples encadeia-o todo. Medido: o maior encadeamento dá 408 m — é o
# circuito da marginal de Oeiras, e está certo. O p99 é 160 m.
RAIO_AGRUPAR = 75

# 2.ª passagem: dois grupos dentro do MESMO parque com nome, a menos disto,
# são o mesmo destino. O «Parque das Artes e do Desporto» na Amadora tinha cinco
# zonas de exercício e aparecia cinco vezes na lista. Não se pode simplesmente
# fundir tudo o que partilha o nome do parque: o Parque do Calhau (Monsanto) tem
# 400 hectares, e duas zonas suas a 2 km uma da outra são mesmo dois destinos.
RAIO_MESMO_PARQUE = 250


def extraido_em():
    """A data a que o OpenStreetMap foi consultado, tirada do próprio despejo.
       Inventar esta data seria mentir sobre a idade dos dados."""
    try:
        d = json.load(open(os.path.join(BRUTO, 'aparelhos.json')))
        return (d.get('osm3s') or {}).get('timestamp_osm_base', '')[:10]
    except Exception:
        return ''


def dist(a, b):
    """Metros. Equirectangular — o erro a esta latitude e a esta escala é < 0,1 %."""
    dlat = (a[0] - b[0]) * 111320
    dlon = (a[1] - b[1]) * 111320 * math.cos(math.radians((a[0] + b[0]) / 2))
    return math.hypot(dlat, dlon)


def agrupar(pontos, raio, pares_validos=None):
    """Ligação simples com grelha, para não ser O(n²) sobre o país inteiro."""
    pai = list(range(len(pontos)))

    def raiz(x):
        while pai[x] != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x

    grelha = collections.defaultdict(list)
    for i, p in enumerate(pontos):
        gx = int(p[1] * 111320 * math.cos(math.radians(p[0])) / raio)
        gy = int(p[0] * 111320 / raio)
        grelha[(gx, gy)].append(i)
    for (gx, gy), idxs in grelha.items():
        perto = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                perto += grelha.get((gx + dx, gy + dy), [])
        for i in idxs:
            for j in perto:
                if i >= j or dist(pontos[i], pontos[j]) > raio:
                    continue
                if pares_validos and not pares_validos(i, j):
                    continue
                a, b = raiz(i), raiz(j)
                if a != b:
                    pai[a] = b
    g = collections.defaultdict(list)
    for i in range(len(pontos)):
        g[raiz(i)].append(i)
    return list(g.values())


# ----------------------------------------------------------------- 2. NOMEAR
#
# A ordem de preferência do nome, e o porquê de cada degrau:
#
#   1. o parque/jardim que CONTÉM o sítio  — «Jardim do Torel». É o que uma
#      pessoa diria a outra ao telefone;
#   2. o mesmo, a menos de 120 m           — o polígono do parque no OSM raramente
#      chega à berma onde estão as barras;
#   3. a localidade                        — «Zambujeira do Mar». Para os 44 % que
#      não têm parque nenhum mapeado com nome à volta.
#
# Nunca o `name` do aparelho: 5 sítios chamar-se-iam «Abdominais».
RAIO_CONTEXTO = 120

# Um parque vale mais que um campo de jogos, que vale mais que uma praça.
# Empates resolvem-se pelo mais próximo e, depois, pelo mais pequeno — o polígono
# pequeno é o que descreve melhor onde a pessoa está.
PRIORIDADE_CONTEXTO = {
    'park': 0, 'garden': 1, 'recreation_ground': 2, 'common': 3,
    'sports_centre': 4, 'square': 5, 'nature_reserve': 6, 'pitch': 7,
}
PESO_LOCALIDADE = {
    'city': 0, 'town': 1, 'village': 2, 'suburb': 3,
    'quarter': 4, 'neighbourhood': 5, 'hamlet': 6, 'locality': 7,
}

MINUSCULAS = {'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o'}


def titulo(s):
    """«VILA NOVA DE GAIA» -> «Vila Nova de Gaia»."""
    saida = []
    for i, palavra in enumerate(s.split()):
        entre = palavra.startswith('(')
        nu = palavra.strip('()')
        novo = nu.lower() if (i and nu.lower() in MINUSCULAS and not entre) \
            else (nu[:1].upper() + nu[1:].lower() if nu.isupper() else nu[:1].upper() + nu[1:])
        saida.append('(' + novo + ')' if entre else novo)
    return ' '.join(saida)


def sem_acentos(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def slug(s):
    return re.sub(r'-+', '-', re.sub(r'[^a-z0-9]+', '-', sem_acentos(s))).strip('-')


# ------------------------------------------------------------ 3. CLASSIFICAR
#
# O QUE ESTE PROJECTO PROMETE é dizer onde há BARRAS para fazer elevações. E a
# verdade medida é dura: dos 798 sítios, só 57 têm uma barra explicitamente
# etiquetada no OSM. 708 são um `leisure=fitness_station` sem mais nada, e 562
# desses são um único nó sem nome nem descrição.
#
# Há duas maneiras de reagir a isto. A do howtocalisthenics.com é chamar
# «Calisthenics Park» a tudo e deixar a pessoa descobrir no local que só lá tem
# uma bicicleta e um volante. A daqui é DIZER O QUE SE SABE, e transformar o que
# não se sabe no motor da comunidade: quem lá for, confirma.
#
# Aparelhos que PROVAM calistenia: dá para suportar o peso do corpo neles.
BARRAS = {
    'horizontal_bar': 'barra_fixa', 'pull_up_bar': 'barra_fixa', 'chin_up_bar': 'barra_fixa',
    'parallel_bars': 'paralelas', 'dip_bar': 'paralelas', 'dips': 'paralelas',
    'horizontal_ladder': 'escada_horizontal', 'monkey_bar': 'escada_horizontal',
    'hand_over_hand': 'escada_horizontal',
    'rings': 'argolas', 'gymnastic_rings': 'argolas',
    'wall_bars': 'espaldar', 'stall_bars': 'espaldar',
    'push-up': 'flexoes', 'push_up': 'flexoes',
    'sit-up': 'abdominais', 'sit_up': 'abdominais', 'captains_chair': 'abdominais',
    'stretch_bars': 'alongamento', 'hyperextension': 'lombares', 'squat': 'agachamento',
    'slackline': 'slackline', 'climbing': 'escalada', 'rope': 'corda', 'rope_climb': 'corda',
    'balance_beam': 'trave', 'stepping_stone': 'equilibrio', 'box': 'caixa',
    'stairs': 'escadas', 'hurdling': 'barreiras', 'slalom': 'slalom',
}
# Só isto = o «circuito sénior» de máquinas guiadas. Não é calistenia.
MAQUINAS = {
    'exercise_bike', 'elliptical_trainer', 'air_walker', 'steering_wheel', 'rower',
    'leg_press', 'chest_press', 'pull_down', 'horizontal_fly', 'ski_swing',
    'back_stretcher', 'leg_extension', 'preacher_curl', 'tbar_row', 'bench_press',
    'leg_stretching', 'bench', 'surfboard', 'twister', 'waist_twister', 'pendulum',
    'cross_trainer', 'shoulder_wheel',
}
# Estes cinco são o que faz de um sítio um sítio de calistenia. Os outros são
# extras simpáticos — uma caixa e umas escadas não fazem um treino de barras.
NUCLEO = {'barra_fixa', 'paralelas', 'escada_horizontal', 'argolas', 'espaldar'}

# Alguns mapeadores portugueses escreveram o aparelho em português no
# `fitness_station`, ou puseram-no no `name`. «Barras Paralelas», «Barras
# fixas», «Espaldar e Agilidade», «equipamento_de_treino_da_falésia_-_street_workout».
# Ler isso é de graça e rende sítios que se perderiam.
RE_BARRA = re.compile(r'\b(barra|barras|elevacoes|elevacao|flexoes|espaldar|paralelas|'
                      r'street ?workout|calistenia|calisthenics|trepar|suspens|argolas|'
                      r'escada horizontal|dominadas|pull ?up|chin ?up|dip)\b')
RE_MAQUINA = re.compile(r'\b(bicicleta|eliptic|remo|leg press|volante|pendul|surf|twist|'
                        r'cavalgada|esqui|passadeira|air ?walker)\b')


def _do_texto(s, ap):
    if 'paralel' in s:
        ap.add('paralelas')
    elif 'espaldar' in s:
        ap.add('espaldar')
    elif 'argola' in s:
        ap.add('argolas')
    elif 'escada horizontal' in s:
        ap.add('escada_horizontal')
    elif re.search(r'\bflexoes\b', s) and 'barra' not in s:
        ap.add('flexoes')
    else:
        ap.add('barra_fixa')


def aparelhos_de(tags):
    """(aparelhos vistos, viu_alguma_maquina) para UM elemento do OSM."""
    ap, maq = set(), False
    for bruto in re.split(r'[;,]', (tags.get('fitness_station') or '')) + \
                 re.split(r'[;,]', (tags.get('sport') or '')):
        b = bruto.strip()
        if not b:
            continue
        if b.lower() in MAQUINAS:
            maq = True
            continue
        if b.lower() in BARRAS:
            ap.add(BARRAS[b.lower()])
            continue
        s = sem_acentos(b)
        if RE_MAQUINA.search(s):
            maq = True
        if RE_BARRA.search(s):
            _do_texto(s, ap)
    texto = sem_acentos(' '.join(filter(None, (
        tags.get('name'), tags.get('description'), tags.get('note')))))
    if texto:
        if RE_MAQUINA.search(texto):
            maq = True
        if RE_BARRA.search(texto):
            _do_texto(texto, ap)
    return ap, maq


# Os quatro escalões, e o que a interface diz de cada um.
#   1  há barras, e sabemos quais              -> «Barras confirmadas»
#   2  há equipamento de peso corporal, sem barra nomeada
#   3  há equipamento, o OSM não diz qual      -> «Por confirmar»  (a maioria)
#   4  o OSM só lista máquinas guiadas         -> «Ginásio de máquinas»
def classificar(lista_de_tags):
    ap, maq, genericos = set(), False, 0
    for t in lista_de_tags:
        a, m = aparelhos_de(t)
        ap |= a
        maq = maq or m
        if not a and not m:
            genericos += 1
    if ap & NUCLEO:
        return 1, ap
    if ap:
        return 2, ap
    if maq and not genericos:
        return 4, ap
    return 3, ap


# ------------------------------------------------------------------- CONCELHO
# A CAOP (Carta Administrativa Oficial de Portugal, DGT) resolve concelho,
# distrito e região offline, por ponto-em-polígono. Sem API, sem limites de
# pedidos, sem depender de ninguém. 9 MB que não são commitados.
def carregar_municipios():
    if not os.path.exists(CAOP):
        sys.exit('Falta _source/caop-municipios.geojson — corre _source/recolher.py')
    dados = json.load(open(CAOP))
    muns = []
    for f in dados['features']:
        p = f['properties']
        # O ficheiro mistura duas convenções: o continente e a Madeira enchem
        # Concelho/Distrito, os Açores deixam-nos vazios e usam MUNICIPIO/ILHA.
        con = (p.get('Concelho') or p.get('MUNICIPIO') or '').strip()
        dis = (p.get('Distrito') or p.get('ILHA') or '').strip()
        reg = (p.get('NUTII_DSG') or p.get('NUT2_DSG') or '').strip()
        g = f['geometry']
        aneis = [q[0] for q in g['coordinates']] if g['type'] == 'MultiPolygon' \
            else [g['coordinates'][0]]
        cx = [c for r in aneis for c in r]
        bb = (min(c[1] for c in cx), min(c[0] for c in cx),
              max(c[1] for c in cx), max(c[0] for c in cx))
        muns.append((bb, aneis, titulo(con), titulo(dis), titulo(reg), p.get('DICO')))
    return muns


def dentro(x, y, anel):
    """Ray casting. O projecto não tem dependências e não vai ter."""
    d, n, j = False, len(anel), len(anel) - 1
    for i in range(n):
        xi, yi = anel[i][0], anel[i][1]
        xj, yj = anel[j][0], anel[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            d = not d
        j = i
    return d


def main():
    for f in ('aparelhos', 'contexto', 'localidades'):
        if not os.path.exists(os.path.join(BRUTO, f + '.json')):
            sys.exit(f'Falta _source/bruto/{f}.json — corre _source/recolher.py')

    els = [e for e in json.load(open(os.path.join(BRUTO, 'aparelhos.json')))['elements']
           if e.get('type') != 'count']
    pontos, elementos = [], []
    recusados = collections.Counter()
    for e in els:
        motivo = deitar_fora(e.get('tags', {}))
        if motivo:
            recusados[motivo] += 1
            continue
        if e['type'] == 'node':
            lat, lon = e['lat'], e['lon']
        elif 'center' in e:
            lat, lon = e['center']['lat'], e['center']['lon']
        else:
            continue
        pontos.append((lat, lon))
        elementos.append(e)
    if recusados:
        print(f'deitados fora {sum(recusados.values())}: ' +
              ', '.join(f'{v}x {k}' for k, v in recusados.most_common()))
    print(f'aparelhos com coordenada: {len(pontos)}')

    grupos = agrupar(pontos, RAIO_AGRUPAR)
    print(f'agrupados a {RAIO_AGRUPAR} m: {len(grupos)} sítios')

    # --- contexto: caixas envolventes dos parques com nome
    ctx = json.load(open(os.path.join(BRUTO, 'contexto.json')))['elements']
    caixas = []
    for e in ctx:
        nome = e.get('tags', {}).get('name')
        if not nome:
            continue
        if e['type'] == 'node':
            bb = (e['lat'], e['lon'], e['lat'], e['lon'])
        else:
            b = e.get('bounds')
            if not b:
                continue
            bb = (b['minlat'], b['minlon'], b['maxlat'], b['maxlon'])
        caixas.append((bb, nome, e['tags']))
    gctx = collections.defaultdict(list)
    for item in caixas:
        mila, milo, mala, malo = item[0]
        for la in {round(mila, 2), round(mala, 2)}:
            for lo in {round(milo, 2), round(malo, 2)}:
                gctx[(la, lo)].append(item)

    def contexto_de(lat, lon):
        cand = []
        for dx in (-0.01, 0, 0.01):
            for dy in (-0.01, 0, 0.01):
                cand += gctx.get((round(lat + dx, 2), round(lon + dy, 2)), [])
        melhor = None
        for (mila, milo, mala, malo), nome, tags in cand:
            dlat = max(mila - lat, 0, lat - mala) * 111320
            dlon = max(milo - lon, 0, lon - malo) * 111320 * math.cos(math.radians(lat))
            d = math.hypot(dlat, dlon)
            if d > RAIO_CONTEXTO:
                continue
            k = tags.get('leisure') or tags.get('landuse') or tags.get('place')
            chave = (0 if d <= 1 else 1, PRIORIDADE_CONTEXTO.get(k, 8),
                     round(d), (mala - mila) * (malo - milo))
            if melhor is None or chave < melhor[0]:
                melhor = (chave, nome, k, round(d))
        return melhor

    # --- localidades
    locs = json.load(open(os.path.join(BRUTO, 'localidades.json')))['elements']
    gloc = collections.defaultdict(list)
    for e in locs:
        gloc[(round(e['lat'], 1), round(e['lon'], 1))].append(e)

    def localidade_de(lat, lon):
        cand = []
        for dx in (-0.1, 0, 0.1):
            for dy in (-0.1, 0, 0.1):
                cand += gloc.get((round(lat + dx, 1), round(lon + dy, 1)), [])
        melhor = None
        for e in cand:
            d = dist((lat, lon), (e['lat'], e['lon']))
            # uma aldeia à porta vale mais que uma cidade a 8 km
            peso = PESO_LOCALIDADE.get(e['tags'].get('place'), 9)
            nota = d / (1 + (9 - peso) * 0.35)
            if melhor is None or nota < melhor[0]:
                melhor = (nota, e['tags']['name'], e['tags'].get('place'), round(d))
        return melhor

    # --- ruas (opcional: só existe se recolher.py --ruas correu)
    #
    # As ruas vêm em lotes, mas NÃO se casam pelo número do lote. Chegaram assim
    # numa primeira versão e é uma armadilha: o lote é a ordem por que os sítios
    # saíram do agrupamento, e basta o OSM ganhar um aparelho para essa ordem
    # mudar e cada sítio passar a exibir a rua do vizinho. Indexadas por espaço,
    # a ordem deixa de importar.
    grelha_ruas = collections.defaultdict(list)
    fr = os.path.join(BRUTO, 'ruas.json')
    if os.path.exists(fr):
        vistas = set()
        for lote, lista in json.load(open(fr)).items():
            if not lote.startswith('_lote'):
                continue
            for r in lista:
                g = r.get('geom')
                if not g:
                    continue
                chave = (r['name'], round(g[0][0], 5), round(g[0][1], 5), len(g))
                if chave in vistas:      # a mesma rua vem em vários lotes
                    continue
                vistas.add(chave)
                for la, lo in {(round(p[0], 2), round(p[1], 2)) for p in g}:
                    grelha_ruas[(la, lo)].append(r)

    HW = {'residential': 0, 'living_street': 1, 'pedestrian': 2, 'unclassified': 3,
          'tertiary': 4, 'secondary': 5, 'primary': 6, 'service': 7,
          'footway': 8, 'path': 9, 'track': 10, 'cycleway': 11}

    def dist_segmento(p, a, b):
        k = 111320 * math.cos(math.radians(p[0]))
        px, py = p[1] * k, p[0] * 111320
        ax, ay = a[1] * k, a[0] * 111320
        bx, by = b[1] * k, b[0] * 111320
        dx, dy = bx - ax, by - ay
        if dx == 0 and dy == 0:
            return math.hypot(px - ax, py - ay)
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
        return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

    def rua_de(lat, lon):
        cand, vistas = [], set()
        for dx in (-0.01, 0, 0.01):
            for dy in (-0.01, 0, 0.01):
                for r in grelha_ruas.get((round(lat + dx, 2), round(lon + dy, 2)), []):
                    if id(r) not in vistas:
                        vistas.add(id(r))
                        cand.append(r)
        melhor = None
        for r in cand:
            g = r['geom']
            if not g:
                continue
            m = min((dist_segmento((lat, lon), g[i], g[i + 1]) for i in range(len(g) - 1)),
                    default=1e9) if len(g) > 1 else dist_segmento((lat, lon), g[0], g[0])
            if m > 90:
                continue
            # agrupar a distância em degraus de 12 m evita que uma azinhaga a 8 m
            # ganhe sempre à avenida a 11 m que é a que dá o nome ao sítio
            chave = (round(m / 12), HW.get(r['hw'], 12), m)
            if melhor is None or chave < melhor[0]:
                melhor = (chave, r['name'], round(m))
        return melhor

    muns = carregar_municipios()

    def municipio_de(lat, lon):
        for bb, aneis, con, dis, reg, dico in muns:
            if not (bb[0] <= lat <= bb[2] and bb[1] <= lon <= bb[3]):
                continue
            for anel in aneis:
                if dentro(lon, lat, anel):
                    return con, dis, reg, dico
        # Encostado à água. A CAOP desenha a linha de costa e um aparelho no
        # passeio marítimo pode cair uns metros fora dela — um em São Miguel cai.
        # Vale mais encostá-lo ao concelho mais próximo do que deixá-lo sem
        # concelho, que é o mesmo que o esconder da procura.
        melhor = None
        for bb, aneis, con, dis, reg, dico in muns:
            dlat = max(bb[0] - lat, 0, lat - bb[2]) * 111320
            dlon = max(bb[1] - lon, 0, lon - bb[3]) * 111320 * math.cos(math.radians(lat))
            d = math.hypot(dlat, dlon)
            if melhor is None or d < melhor[0]:
                melhor = (d, con, dis, reg, dico)
        if melhor and melhor[0] <= 2000:
            return melhor[1:]
        return None

    # --- reunir cada grupo
    brutos = []
    for grupo in grupos:
        lat = sum(pontos[i][0] for i in grupo) / len(grupo)
        lon = sum(pontos[i][1] for i in grupo) / len(grupo)
        brutos.append(dict(lat=lat, lon=lon, idx=grupo,
                           ctx=contexto_de(lat, lon), loc=localidade_de(lat, lon),
                           mun=municipio_de(lat, lon),
                           rua=rua_de(lat, lon)))

    sem_mun = [b for b in brutos if not b['mun']]
    if sem_mun:
        print(f'AVISO: {len(sem_mun)} sítios fora de qualquer concelho da CAOP '
              f'(o primeiro em {sem_mun[0]["lat"]:.4f},{sem_mun[0]["lon"]:.4f})')

    # --- 2.ª passagem: fundir zonas do mesmo parque
    pai = list(range(len(brutos)))

    def raiz(x):
        while pai[x] != x:
            pai[x] = pai[pai[x]]
            x = pai[x]
        return x

    por_parque = collections.defaultdict(list)
    for i, b in enumerate(brutos):
        if b['ctx']:
            por_parque[(b['ctx'][1], b['mun'][0] if b['mun'] else '?')].append(i)
    for _, idxs in por_parque.items():
        for a in range(len(idxs)):
            for c in range(a + 1, len(idxs)):
                i, j = idxs[a], idxs[c]
                if dist((brutos[i]['lat'], brutos[i]['lon']),
                        (brutos[j]['lat'], brutos[j]['lon'])) <= RAIO_MESMO_PARQUE:
                    x, y = raiz(i), raiz(j)
                    if x != y:
                        pai[x] = y
    juntos = collections.defaultdict(list)
    for i in range(len(brutos)):
        juntos[raiz(i)].append(i)
    print(f'fundidas as zonas do mesmo parque a {RAIO_MESMO_PARQUE} m: {len(juntos)} sítios')

    spots = []
    for grupo in juntos.values():
        lat = round(sum(brutos[i]['lat'] for i in grupo) / len(grupo), 5)
        lon = round(sum(brutos[i]['lon'] for i in grupo) / len(grupo), 5)
        idxs = [j for i in grupo for j in brutos[i]['idx']]
        tags = [elementos[j].get('tags', {}) for j in idxs]
        escalao, ap = classificar(tags)
        b0 = brutos[grupo[0]]
        nome = b0['ctx'][1] if b0['ctx'] else (b0['loc'][1] if b0['loc'] else None)
        mun = b0['mun']
        spots.append(dict(
            nome=nome,
            lat=lat, lon=lon,
            con=mun[0] if mun else None,
            dis=mun[1] if mun else None,
            reg=mun[2] if mun else None,
            dico=mun[3] if mun else None,
            loc=b0['loc'][1] if b0['loc'] else None,
            rua=b0['rua'][1] if b0['rua'] else None,
            esc=escalao,
            ap=sorted(ap),
            n=len(idxs),
            zonas=len(grupo),
            # agregados: basta um aparelho dizer que sim
            lit=('yes' if any(t.get('lit') == 'yes' for t in tags)
                 else ('no' if any(t.get('lit') == 'no' for t in tags) else None)),
            wc=('yes' if any(t.get('wheelchair') == 'yes' for t in tags) else None),
            h24=any(t.get('opening_hours') == '24/7' for t in tags),
            surf=next((t['surface'] for t in tags if t.get('surface')), None),
            op=next((t['operator'] for t in tags if t.get('operator')), None),
            osm=sorted({f"{elementos[j]['type'][0]}{elementos[j]['id']}" for j in idxs}),
        ))

    # ------------------------------------------------- os dados abertos da CML
    #
    # 67 equipamentos de fitness da Câmara Municipal de Lisboa, em CC0. Fazem
    # duas coisas, e a segunda é a mais valiosa:
    #
    #   · os que o OSM não tem entram como sítios novos;
    #   · os que o OSM tem EMPRESTAM O NOME. «Circuito de Manutenção do Parque
    #     José Gomes Ferreira» é o nome municipal do sítio; o derivado do
    #     polígono do parque dá só «Parque José Gomes Ferreira». O nome
    #     municipal é o que está na placa lá no sítio.
    #
    # RAIO 60 m: metade do raio de contexto. Um equipamento da CML e um nó do
    # OSM a essa distância são o mesmo. Mais do que isso começava a colar
    # equipamentos de parques vizinhos, que em Lisboa estão perto uns dos outros.
    caminho_cml = os.path.join(BRUTO, 'lisboa-cml.json')
    novos_cml = emprestados = 0
    if os.path.exists(caminho_cml):
        cml = json.load(open(caminho_cml)).get('features', [])
        for f in cml:
            g = (f.get('geometry') or {}).get('coordinates')
            if not g:
                continue
            lon_c, lat_c = round(g[0], 5), round(g[1], 5)
            props = f.get('properties') or {}
            nome_c = limpar_nome_cml(props.get('NOME'))
            if not nome_c:
                continue
            perto = min(spots, key=lambda x: dist((lat_c, lon_c), (x['lat'], x['lon'])),
                        default=None)
            d_perto = dist((lat_c, lon_c), (perto['lat'], perto['lon'])) if perto else 1e9
            if perto and d_perto <= 60:
                # O nome municipal ganha ao derivado, mas só se for MAIS
                # informativo — não se troca «Jardim do Torel» por «Fitness».
                if len(nome_c) > len(perto['nome'] or ''):
                    perto['nome'] = nome_c
                    emprestados += 1
                perto.setdefault('fontes', []).append('CML')
                continue
            mun = municipio_de(lat_c, lon_c)
            loc = localidade_de(lat_c, lon_c)
            spots.append(dict(
                nome=nome_c, lat=lat_c, lon=lon_c,
                con=mun[0] if mun else None, dis=mun[1] if mun else None,
                reg=mun[2] if mun else None, dico=mun[3] if mun else None,
                loc=loc[1] if loc else None,
                rua=limpar_morada_cml(props.get('MORADA')),
                esc=3, ap=[], n=1, zonas=1,
                lit=None, wc=None, h24=False, surf=None, op='Câmara Municipal de Lisboa',
                osm=[], fontes=['CML']))
            novos_cml += 1
    for x in spots:
        x.setdefault('fontes', ['OSM'] if x['osm'] else ['CML'])
        x['fontes'] = sorted(set(x['fontes']))
    if novos_cml or emprestados:
        print(f'dados abertos da CML: +{novos_cml} sítios novos, '
              f'{emprestados} nomes melhorados')

    spots.sort(key=lambda s: (s['con'] or 'zz', s['nome'] or 'zz'))

    # O AVISO DE LICENÇA VIAJA COM O FICHEIRO. A ODbL obriga a que quem receba a
    # base de dados derivada saiba de onde ela vem e sob que licença está — e
    # quem descarrega o spots.json directamente não vê o rodapé do site. Por
    # isso a atribuição vive DENTRO do JSON, e não só na página.
    saida = {
        'meta': {
            'nome': 'Barra Fixe — sítios com equipamento de exercício ao ar livre em Portugal',
            'fonte': 'OpenStreetMap',
            'fonte_url': 'https://www.openstreetmap.org/copyright',
            'licenca': 'ODbL 1.0',
            'licenca_url': 'https://opendatacommons.org/licenses/odbl/1-0/',
            'atribuicao': '© contribuidores do OpenStreetMap',
            'limites_administrativos': 'CAOP — Direção-Geral do Território',
            'fonte_complementar': 'Câmara Municipal de Lisboa, Equipamentos de '
                                  'Fitness (CC0 / CCZero)',
            'consulta': '_source/overpass.txt',
            'extraido_em': extraido_em(),
            'gerado_em': datetime.date.today().isoformat(),
            'total': len(spots),
        },
        'spots': spots,
    }
    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    json.dump(saida, open(DESTINO, 'w'), ensure_ascii=False, separators=(',', ':'))

    cnt = collections.Counter(s['esc'] for s in spots)
    print(f'\nescrito {DESTINO}')
    print(f'  {len(spots)} sítios em {len({s["con"] for s in spots if s["con"]})} concelhos')
    print(f'  escalão 1 (barras confirmadas): {cnt[1]}')
    print(f'  escalão 2 (peso corporal):      {cnt[2]}')
    print(f'  escalão 3 (por confirmar):      {cnt[3]}')
    print(f'  escalão 4 (só máquinas):        {cnt[4]}')
    print(f'  sem nome: {sum(1 for s in spots if not s["nome"])}')
    print(f'  {os.path.getsize(DESTINO) / 1024:.1f} KB em disco')


if __name__ == '__main__':
    main()
