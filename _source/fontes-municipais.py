# -*- coding: utf-8 -*-
"""Os dados abertos das câmaras que dizem QUE APARELHOS lá estão.

   Correr:  python3 _source/fontes-municipais.py
   Produz:  _source/bruto/municipios.json

   PORQUE ISTO VALE MAIS QUE O OPENSTREETMAP AQUI. O OSM diz onde há
   equipamento de exercício; quase nunca diz qual. Em 833 sítios, só 56 têm uma
   barra explicitamente etiquetada — e a aplicação promete BARRAS, não circuitos
   de máquinas para seniores.

   Três câmaras publicam, em dados abertos, exactamente o que falta:

     · LISBOA (CC0)   — 67 equipamentos de fitness, com o nome municipal.
     · CASCAIS (CC-BY) — 43 circuitos, cada um com colunas `barra_elevacao`,
                         `barra_paralela`, `espaldar`, `argola`, `barra_flexao`,
                         `banco_abdominal`. É uma resposta directa à pergunta
                         «isto tem barras?».
     · OEIRAS (CC-BY)  — 476 APARELHOS individuais, com o nome do aparelho
                         («Barras Fixas», «Barras Paralelas») e a categoria.
                         Agrupam-se por espaço, como se faz aos nós do OSM.

   ATRIBUIÇÃO. A CC-BY obriga a citar o autor; a CC0 não obriga mas cita-se na
   mesma. Os três estão no rodapé do site e no bloco `meta` de data/spots.json.
"""
import json, math, os, re, sys, time, unicodedata, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRUTO = os.path.join(RAIZ, '_source', 'bruto')
DESTINO = os.path.join(BRUTO, 'municipios.json')

AGENTE = ('CalisthenicsSpots/1.0 (mapa de calistenia em Portugal; '
          'https://github.com/renatovalente5/calisthenics-spots)')

# Os URLs são descobertos pela API do dados.gov.pt e não escritos à mão: o
# ficheiro de Cascais tem a data no nome («…_20260904_172718.geojson») e muda
# a cada actualização. Escrito à mão, partia-se sozinho dentro de um mês.
PROCURAS = [
    ('cascais-circuito', 'circuito de manutenção', 'Cascais', 'Circuito'),
    ('cascais-desportivo', 'equipamento desportivo', 'Cascais', 'Equipamento Desportivo'),
    ('oeiras-equipamentos', 'jogo recreio', 'Oeiras', 'Equipamentos de Jogo'),
    ('lisboa-fitness', 'fitness', 'Lisboa', 'Fitness'),
]


def pedir(url, tentativas=3, timeout=60):
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': AGENTE})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            print(f'    tentativa {i + 1}: {str(e)[:60]}')
            time.sleep(4 * (i + 1))
    return None


def descobrir():
    """Encontra o GeoJSON de cada conjunto pela API do portal nacional."""
    achados = {}
    for chave, termo, org, titulo in PROCURAS:
        q = urllib.request.quote(termo)
        d = pedir(f'https://dados.gov.pt/api/1/datasets/?q={q}&page_size=12')
        if not d:
            continue
        for x in d.get('data', []):
            nome_org = ((x.get('organization') or {}).get('name') or '')
            if org.lower() not in nome_org.lower():
                continue
            if titulo.lower() not in (x.get('title') or '').lower():
                continue
            for r in x.get('resources', []):
                if r.get('format') == 'geojson':
                    achados[chave] = {
                        'url': r['url'], 'titulo': x.get('title'),
                        'org': nome_org, 'licenca': x.get('license'),
                    }
                    break
            if chave in achados:
                break
        time.sleep(1)
    return achados


# ---------------------------------------------------------------- projecção
#
# Oeiras publica em EPSG:3763 (ETRS89 / Portugal TM06), que é uma Transversa de
# Mercator em METROS — coordenadas como (-103195, -99717). O GeoJSON declara-o
# no campo `crs`, e quem não olhar para lá fica com 87 sítios algures a sul da
# Antárctida. A conversão está aqui à mão porque o projecto não tem
# dependências e não vai ter: são vinte linhas de fórmula fechada.
#
# Parâmetros oficiais do PT-TM06: origem em 39°40'05,73"N, meridiano central
# -8°07'59,19", factor de escala 1, falsos leste e norte a zero, elipsóide GRS80.
TM06 = dict(lat0=math.radians(39.6682583333333), lon0=math.radians(-8.13310833333333),
            k0=1.0, fe=0.0, fn=0.0, a=6378137.0, f=1 / 298.257222101)


def tm06_para_wgs84(x, y):
    """Transversa de Mercator inversa (Snyder, 8-17 a 8-21)."""
    a, f = TM06['a'], TM06['f']
    e2 = 2 * f - f * f
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))

    def M(phi):
        return a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
                    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * phi)
                    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * phi)
                    - (35 * e2 ** 3 / 3072) * math.sin(6 * phi))

    m = M(TM06['lat0']) + (y - TM06['fn']) / TM06['k0']
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    phi1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu)
            + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
            + (151 * e1 ** 3 / 96) * math.sin(6 * mu)
            + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    ep2 = e2 / (1 - e2)
    C1 = ep2 * math.cos(phi1) ** 2
    T1 = math.tan(phi1) ** 2
    N1 = a / math.sqrt(1 - e2 * math.sin(phi1) ** 2)
    R1 = a * (1 - e2) / (1 - e2 * math.sin(phi1) ** 2) ** 1.5
    D = (x - TM06['fe']) / (N1 * TM06['k0'])
    lat = phi1 - (N1 * math.tan(phi1) / R1) * (
        D ** 2 / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 ** 2 - 9 * ep2) * D ** 4 / 24
        + (61 + 90 * T1 + 298 * C1 + 45 * T1 ** 2 - 252 * ep2 - 3 * C1 ** 2) * D ** 6 / 720)
    lon = TM06['lon0'] + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
                          + (5 - 2 * C1 + 28 * T1 - 3 * C1 ** 2 + 8 * ep2 + 24 * T1 ** 2)
                          * D ** 5 / 120) / math.cos(phi1)
    return math.degrees(lon), math.degrees(lat)


def crs_do_geojson(d):
    """O EPSG declarado no ficheiro, ou 4326 se não disser nada."""
    c = ((d.get('crs') or {}).get('properties') or {}).get('name') or ''
    m = re.search(r'(\d{4,5})\s*$', str(c))
    return int(m.group(1)) if m else 4326


def sem_acentos(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def coord(g, epsg=4326):
    """O primeiro ponto de qualquer geometria, sempre em WGS84."""
    if not g:
        return None
    t, c = g.get('type'), g.get('coordinates')
    if not c:
        return None
    if t != 'Point':
        while isinstance(c[0], list):
            c = c[0]
    if len(c) < 2:
        return None
    if epsg == 3763:
        return tm06_para_wgs84(c[0], c[1])
    return c[0], c[1]


SIM = ('sim', 's', '1', 'true', 'yes', 'x')


def normalizar_cascais(features, epsg=4326):
    """Cascais dá um circuito por linha, com uma coluna por aparelho."""
    COLUNAS = {
        'barra_elevacao': 'barra_fixa',
        'barra_flexao': 'barra_fixa',
        'barra_paralela': 'paralelas',
        'espaldar': 'espaldar',
        'argola': 'argolas',
        'banco_abdominal': 'abdominais',
    }
    saida = []
    for f in features:
        p = f.get('properties') or {}
        xy = coord(f.get('geometry'), epsg)
        if not xy:
            continue
        ap, negados = set(), set()
        for col, nosso in COLUNAS.items():
            v = str(p.get(col) or '').strip().lower()
            if v in SIM:
                ap.add(nosso)
            elif v in ('nao', 'não', 'n', '0', 'false'):
                negados.add(nosso)
        # Cascais abrevia: «C. M. do Bosque dos Gaios». Ninguém lê «C. M.» como
        # «Circuito de Manutenção» — e escrito por extenso o nome diz logo o que
        # o sítio é.
        nome = (p.get('designacao') or p.get('local') or '').strip()
        nome = re.sub(r'^C\.?\s*M\.?\s+', 'Circuito de Manutenção ', nome)
        nome = re.sub(r'^Circuito de Manuenç', 'Circuito de Manutenç', nome)
        saida.append({
            'nome': nome or None,
            'lon': round(xy[0], 5), 'lat': round(xy[1], 5),
            'ap': sorted(ap), 'nega': sorted(negados),
            'rua': (p.get('local') or '').strip() or None,
            'fonte': 'CMC',
        })
    return saida


def normalizar_oeiras(features, epsg=4326):
    """Oeiras dá um APARELHO por linha. Os aparelhos do mesmo espaço juntam-se
       depois, no gerar-spots.py, pelo mesmo agrupamento por proximidade que se
       usa nos nós do OpenStreetMap."""
    # Os nomes vêm do catálogo do fornecedor e são metade em inglês: «Pull Up»,
    # «Dip Bars», «Ministation», «Multifunções». Foram lidos do conjunto real,
    # não adivinhados — a primeira versão desta lista só apanhou 2 dos 87.
    RE_AP = [
        (re.compile(r'pull ?up|barras? fixas?|barra de elevac|^barras$|'
                    r'multifuncoes|ministation'), 'barra_fixa'),
        (re.compile(r'dip ?bars?|paralelas?'), 'paralelas'),
        (re.compile(r'espaldar|wall bars?'), 'espaldar'),
        (re.compile(r'argolas?|rings?'), 'argolas'),
        (re.compile(r'escada horizontal|monkey|trepar'), 'escada_horizontal'),
        (re.compile(r'abdomin|dorsais'), 'abdominais'),
        (re.compile(r'flexoes|flexao|push ?up'), 'flexoes'),
        (re.compile(r'\btrx\b|suspens'), 'suspensao'),
    ]
    # E estas são as máquinas guiadas — o «circuito para seniores» que esta
    # aplicação não quer apresentar como sítio de calistenia.
    RE_MAQUINA = re.compile(r'eliptic|bicicleta|remo\b|volante|pendul|air ?walker|'
                            r'esqui|surf|twist|cavalgada|press|pedaleira|balanca|'
                            r'leme|degrau|upper body')
    saida = []
    for f in features:
        p = f.get('properties') or {}
        xy = coord(f.get('geometry'), epsg)
        if not xy:
            continue
        # Só o que é fitness. O conjunto tem baloiços e escorregas às centenas.
        # SÓ a categoria «Fitness». O conjunto tem 385 baloiços e escorregas,
        # que são equipamento de recreio infantil e não têm nada que ver com isto.
        cat = sem_acentos(str(p.get('Categoria do Equipamento') or ''))
        if 'fitness' not in cat:
            continue
        texto = sem_acentos(' '.join(str(p.get(k) or '') for k in
                                     ('header', 'Label', 'modelo', 'Tipo de Exercício')))
        # Um aparelho retirado não serve a ninguém.
        if 'retirado' in sem_acentos(str(p.get('Estado Operacional') or '')):
            continue
        ap = {nosso for r, nosso in RE_AP if r.search(texto)}
        saida.append({
            'nome': (p.get('Espaço de Jogo e recreio') or p.get('header') or '').strip() or None,
            'lon': round(xy[0], 5), 'lat': round(xy[1], 5),
            'ap': sorted(ap), 'nega': [],
            'maquina': bool(RE_MAQUINA.search(texto)) and not ap,
            'rua': None,
            'fonte': 'CMO',
        })
    return saida


def normalizar_lisboa(features, epsg=4326):
    saida = []
    for f in features:
        p = f.get('properties') or {}
        xy = coord(f.get('geometry'), epsg)
        if not xy:
            continue
        nome = re.sub(r'^Fitness\s+(?:d[oaes]s?\s+)?', '',
                      (p.get('NOME') or '').strip(), flags=re.I).strip()
        morada = re.sub(r'\s*\((?:antig[ao]|ex)[^)]*\)', '',
                        (p.get('MORADA') or '').strip(), flags=re.I).strip()
        saida.append({
            'nome': nome or None,
            'lon': round(xy[0], 5), 'lat': round(xy[1], 5),
            'ap': [], 'nega': [],
            'rua': morada or None,
            'fonte': 'CML',
        })
    return saida


NORMALIZADORES = {
    'cascais-circuito': normalizar_cascais,
    'oeiras-equipamentos': normalizar_oeiras,
    'lisboa-fitness': normalizar_lisboa,
}


def main():
    os.makedirs(BRUTO, exist_ok=True)
    print('a descobrir os conjuntos no dados.gov.pt…')
    achados = descobrir()
    if not achados:
        print('nenhum conjunto encontrado; nada mudou.')
        return

    saida = {'meta': {}, 'pontos': []}
    for chave, info in achados.items():
        fn = NORMALIZADORES.get(chave)
        if not fn:
            continue
        print(f"  {info['titulo'][:44]:44s} [{info['licenca']}]")
        d = pedir(info['url'])
        if not d:
            print('    sem resposta — ignorado')
            continue
        epsg = crs_do_geojson(d)
        if epsg != 4326:
            print(f'    coordenadas em EPSG:{epsg} — convertidas para WGS84')
        pontos = fn(d.get('features', []), epsg)
        # Guarda: um ponto fora de Portugal é uma projecção mal lida, não um
        # parque no Atlântico. Melhor perder a fonte do que estragar o mapa.
        fora = [p for p in pontos if not (-32 < p['lon'] < -5 and 29 < p['lat'] < 43)]
        if fora:
            print(f'    AVISO: {len(fora)} pontos fora de Portugal — fonte ignorada '
                  f'(o primeiro em {fora[0]["lat"]:.4f},{fora[0]["lon"]:.4f})')
            continue
        com_barra = sum(1 for p in pontos if 'barra_fixa' in p['ap'])
        print(f"    {len(pontos)} pontos, {com_barra} com barra declarada")
        saida['pontos'] += pontos
        saida['meta'][chave] = {
            'titulo': info['titulo'], 'organizacao': info['org'],
            'licenca': info['licenca'], 'url': info['url'], 'n': len(pontos),
        }
        time.sleep(1)

    # Uma fonte que hoje devolve zero é quase de certeza um servidor com
    # problemas, não um município a demolir os parques todos. Não deitar fora
    # o que já cá está.
    if not saida['pontos'] and os.path.exists(DESTINO):
        print('\nzero pontos — MANTIDO o ficheiro anterior')
        return
    json.dump(saida, open(DESTINO, 'w', encoding='utf-8'), ensure_ascii=False)
    total_barra = sum(1 for p in saida['pontos'] if 'barra_fixa' in p['ap'])
    print(f"\n{len(saida['pontos'])} pontos municipais, "
          f"{total_barra} com barra de elevação declarada pela câmara")
    print(f'-> {os.path.relpath(DESTINO, RAIZ)}')


if __name__ == '__main__':
    main()
