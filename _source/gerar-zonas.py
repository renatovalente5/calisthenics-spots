# -*- coding: utf-8 -*-
"""Os concelhos, para a pesquisa por zona.

   Correr:  python3 _source/gerar-zonas.py
   Produz:  data/concelhos.json          (índice dos 308, carregado com a app)
            data/limites/<dico>.json     (o contorno de cada um, à pedida)

   PARA QUE SERVE. Escrever «Viana do Castelo» tem de fazer o mapa ir para lá E
   DESENHAR A ÁREA do concelho, para se poder olhar à volta. Filtrar uma lista
   não chega: quem procura uma zona quer ver o mapa.

   PORQUE SÃO OS 308 E NÃO SÓ OS QUE TÊM SÍTIOS. Uma primeira versão só incluía
   os concelhos com sítios. Escrever «Viana do Castelo» — que tem ZERO sítios
   registados — não encontrava nada e, pior, caía em «Caminha», que casa pela
   palavra do distrito. O mapa saltava para o concelho errado sem dizer nada.
   Com os 308, a procura encontra Viana do Castelo, desenha-o, e a lista diz
   com todas as letras que ali ainda não há nada mapeado — que é a verdade e é
   um convite a corrigi-la.

   PORQUE SÃO DOIS ARTEFACTOS. O índice tem nome, distrito, caixa envolvente e
   contagem: chega para procurar e para enquadrar o mapa NO MESMO INSTANTE em
   que se carrega na sugestão. O contorno, que é o que pesa, só se vai buscar
   ao concelho escolhido — 1 a 4 KB em vez dos 300 e tal de todos juntos.

   A TOLERÂNCIA DA SIMPLIFICAÇÃO É ADAPTATIVA. Um valor fixo é errado nos dois
   sentidos: os concelhos vão de ~4 km (São João da Madeira) a ~71 km (Odemira).
   Usa-se a diagonal da caixa envolvente a dividir por 500, o que dá um erro
   máximo no ecrã de ~2,5 px quando o concelho enche o mapa — invisível debaixo
   de um traço de 2 px.
"""
import json, math, os, re, sys, unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAOP = os.path.join(RAIZ, '_source', 'caop-municipios.geojson')
SPOTS = os.path.join(RAIZ, 'data', 'spots.json')
INDICE = os.path.join(RAIZ, 'data', 'concelhos.json')
LIMITES = os.path.join(RAIZ, 'data', 'limites')

DIVISOR = 500      # tolerância = diagonal da caixa / isto
CASAS = 5          # ~1,1 m

MINUSCULAS = {'de', 'da', 'do', 'das', 'dos', 'e', 'a', 'o'}


def titulo(s):
    saida = []
    for i, p in enumerate(s.split()):
        entre = p.startswith('(')
        nu = p.strip('()')
        nv = nu.lower() if (i and nu.lower() in MINUSCULAS and not entre) \
            else (nu[:1].upper() + nu[1:].lower() if nu.isupper() else nu[:1].upper() + nu[1:])
        saida.append('(' + nv + ')' if entre else nv)
    return ' '.join(saida)


def sem_acentos(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn').lower()
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def dist_ponto_recta(p, a, b):
    if a == b:
        return math.hypot(p[0] - a[0], p[1] - a[1])
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))


def simplificar(pontos, tol):
    """Douglas-Peucker ITERATIVO — a versão recursiva estoira a pilha do Python
       num anel de 40 000 vértices, que é o tamanho de alguns concelhos."""
    if len(pontos) < 3:
        return pontos[:]
    manter = [False] * len(pontos)
    manter[0] = manter[-1] = True
    pilha = [(0, len(pontos) - 1)]
    while pilha:
        i, j = pilha.pop()
        if j <= i + 1:
            continue
        pior, k = 0.0, -1
        for m in range(i + 1, j):
            d = dist_ponto_recta(pontos[m], pontos[i], pontos[j])
            if d > pior:
                pior, k = d, m
        if pior > tol and k > 0:
            manter[k] = True
            pilha.append((i, k))
            pilha.append((k, j))
    return [p for p, m in zip(pontos, manter) if m]


def aneis_exteriores(g):
    if g['type'] == 'MultiPolygon':
        return [p[0] for p in g['coordinates']]
    return [g['coordinates'][0]]


def area(anel):
    s = 0.0
    for i in range(len(anel)):
        x1, y1 = anel[i][0], anel[i][1]
        x2, y2 = anel[(i + 1) % len(anel)][0], anel[(i + 1) % len(anel)][1]
        s += x1 * y2 - x2 * y1
    return abs(s) / 2


def main():
    if not os.path.exists(CAOP):
        sys.exit('Falta _source/caop-municipios.geojson — corre _source/recolher.py')

    contagem = {}
    if os.path.exists(SPOTS):
        d = json.load(open(SPOTS, encoding='utf-8'))
        for s in (d['spots'] if isinstance(d, dict) else d):
            if s.get('con'):
                contagem[s['con']] = contagem.get(s['con'], 0) + 1

    os.makedirs(LIMITES, exist_ok=True)
    caop = json.load(open(CAOP, encoding='utf-8'))
    indice, escritos, iguais = [], 0, 0
    vertices_antes = vertices_depois = 0

    for f in caop['features']:
        p = f['properties']
        con = titulo((p.get('Concelho') or p.get('MUNICIPIO') or '').strip())
        dis = titulo((p.get('Distrito') or p.get('ILHA') or '').strip())
        dico = str(p.get('DICO') or '').strip()
        if not con or not dico:
            continue

        aneis = aneis_exteriores(f['geometry'])
        maior = max(area(a) for a in aneis)
        guardados = []
        for a in aneis:
            # Ilhas e enclaves com menos de 2 % da área do maior não se vêem
            # e custam bytes. Mas os que passam ficam TODOS: sem isto, Olhão
            # perdia a Armona.
            if area(a) < maior * 0.02:
                continue
            xs = [c[0] for c in a]
            ys = [c[1] for c in a]
            diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
            vertices_antes += len(a)
            simp = simplificar([(c[0], c[1]) for c in a], diag / DIVISOR)
            if len(simp) < 4:
                continue
            if simp[0] != simp[-1]:
                simp.append(simp[0])
            vertices_depois += len(simp)
            guardados.append([[round(x, CASAS), round(y, CASAS)] for x, y in simp])
        if not guardados:
            continue

        todos = [c for anel in guardados for c in anel]
        bb = [round(min(c[0] for c in todos), CASAS), round(min(c[1] for c in todos), CASAS),
              round(max(c[0] for c in todos), CASAS), round(max(c[1] for c in todos), CASAS)]

        indice.append({
            'n': con, 'd': dis, 'c': dico, 'b': bb,
            'q': contagem.get(con, 0),
            'k': sem_acentos(con + ' ' + dis),
        })

        # ESCREVE SÓ O QUE MUDOU. 308 ficheiros reescritos a cada construção
        # fariam o CI reconstruir e republicar o site inteiro por nada.
        caminho = os.path.join(LIMITES, dico + '.json')
        conteudo = json.dumps({'n': con, 'p': guardados},
                              ensure_ascii=False, separators=(',', ':'))
        antigo = None
        if os.path.exists(caminho):
            antigo = open(caminho, encoding='utf-8').read()
        if antigo == conteudo:
            iguais += 1
        else:
            open(caminho, 'w', encoding='utf-8').write(conteudo)
            escritos += 1

    indice.sort(key=lambda z: (-z['q'], z['n']))
    json.dump({'meta': {'fonte': 'Carta Administrativa Oficial de Portugal (CAOP)',
                        'autor': 'Direção-Geral do Território',
                        'total': len(indice)},
               'zonas': indice},
              open(INDICE, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))

    import gzip
    bi = open(INDICE, 'rb').read()
    tam = [os.path.getsize(os.path.join(LIMITES, f)) for f in os.listdir(LIMITES)
           if f.endswith('.json')]
    com = sorted(len(gzip.compress(open(os.path.join(LIMITES, f), 'rb').read(), 9))
                 for f in os.listdir(LIMITES) if f.endswith('.json'))
    print(f'{len(indice)} concelhos ({sum(1 for z in indice if z["q"])} com sítios)')
    print(f'  vértices: {vertices_antes} -> {vertices_depois} '
          f'({vertices_depois * 100 // max(vertices_antes, 1)} %)')
    print(f'  índice:   {len(bi) / 1024:.1f} KB, {len(gzip.compress(bi, 9)) / 1024:.1f} KB comprimido')
    print(f'  contornos: {len(tam)} ficheiros, {sum(tam) / 1024:.0f} KB no repositório; '
          f'mediana {com[len(com) // 2] / 1024:.1f} KB comprimido, máximo {com[-1] / 1024:.1f} KB')
    print(f'  escritos {escritos}, iguais {iguais}')


if __name__ == '__main__':
    main()
