# -*- coding: utf-8 -*-
"""Vai buscar tudo o que o gerar-spots.py precisa. Enche _source/bruto/.

   Correr:  python3 _source/recolher.py            (as três consultas + a CAOP)
            python3 _source/recolher.py --ruas     (também as ruas: ~13 lotes, lento)

   As consultas estão em _source/overpass.txt, separadas por linhas de `---`,
   com o porquê de cada ramo escrito lá. Ficam num ficheiro à parte para se
   poderem ler e alterar sem mexer em código.

   ETIQUETA COM O OVERPASS. É um serviço público, gratuito, pago por doações e
   partilhado por toda a gente. Por isso: uma consulta de cada vez, pausa entre
   elas, e um User-Agent que diz quem somos e onde nos encontrar. Se alguma
   falhar, tenta noutro espelho — não insiste no mesmo servidor.
"""
import json, os, re, sys, time, urllib.request, urllib.error

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRUTO = os.path.join(RAIZ, '_source', 'bruto')
CONSULTAS = os.path.join(RAIZ, '_source', 'overpass.txt')
CAOP = os.path.join(RAIZ, '_source', 'caop-municipios.geojson')

AGENTE = 'CalisthenicsSpots/1.0 (mapa de calistenia em Portugal; https://github.com/renatovalente5/calisthenics-spots)'
# DOIS espelhos, não três. O `overpass.kumi.systems` parece um terceiro e não é:
#     dig overpass.kumi.systems  ->  overpass.private.coffee. -> 193.219.97.30
#     dig overpass.private.coffee ->                             193.219.97.30
# É um CNAME para a mesma máquina, e tê-lo na lista dava a ilusão de redundância
# que se paga no dia em que essa máquina cair.
ESPELHOS = [
    'https://overpass-api.de/api/interpreter',        # 65.109.112.52 / 162.55.144.139
    'https://overpass.private.coffee/api/interpreter',  # 193.219.97.30
]
NOMES = ['aparelhos', 'contexto', 'localidades']

# A CAOP oficial da Direcção-Geral do Território, em GeoJSON. 9 MB para uma
# tabela de 308 concelhos: descarrega-se, não se commita.
FONTE_CAOP = ('https://raw.githubusercontent.com/nmota/caop_GeoJSON/master/'
              'Portugal_Municipalities.geojson')

# Os equipamentos de fitness da Câmara Municipal de Lisboa, 67 pontos.
# Licença declarada no próprio serviço: «Aplica-se a licença Creative Commons
# CCZero (http://opendefinition.org/licenses/cc-zero/). A reprodução da
# aplicação é autorizada, devendo ser citados os créditos do autor.»
# CC0 não obriga a nada, mas os créditos citam-se na mesma — está no rodapé.
# Vale a pena porque os NOMES são municipais e melhores que os derivados:
# «Circuito de Manutenção do Parque José Gomes Ferreira» não se inventa.
FONTE_CML = ('https://services.arcgis.com/1dSrzEWVQn5kHHyK/arcgis/rest/services/'
             'Desporto_EquipamentosFitness/FeatureServer/0/query'
             '?outFields=*&where=1%3D1&f=geojson')


def pedir(url, dados=None, tentativas=4):
    for i in range(tentativas):
        try:
            req = urllib.request.Request(url, data=dados, headers={'User-Agent': AGENTE})
            with urllib.request.urlopen(req, timeout=300) as r:
                return r.read()
        except Exception as e:
            print(f'    tentativa {i + 1} falhou ({e}); a esperar…', flush=True)
            time.sleep(15 * (i + 1))
    return None


def overpass(consulta, etiqueta):
    dados = consulta.encode('utf-8')
    for espelho in ESPELHOS:
        print(f'  {etiqueta}: {espelho.split("/")[2]}…', flush=True)
        bruto = pedir(espelho, dados, tentativas=2)
        if not bruto:
            continue
        # O Overpass devolve HTTP 200 com uma página de erro em XML quando a
        # consulta rebenta. Quem só olhar para o código de estado não dá por isso.
        if not bruto.lstrip().startswith(b'{'):
            print(f'    devolveu erro, não JSON: {bruto[:160].decode("utf8", "replace")}')
            continue
        try:
            d = json.loads(bruto)
        except ValueError as e:
            print(f'    JSON inválido: {e}')
            continue
        if 'remark' in d:
            # o modo de falha silencioso: 200, JSON válido, zero elementos e um
            # `remark` a dizer que esgotou a memória ou o tempo
            print(f'    AVISO do servidor: {d["remark"]}')
        return d
    sys.exit(f'Nenhum espelho respondeu a «{etiqueta}». Tenta mais tarde.')


def consultas():
    texto = open(CONSULTAS, encoding='utf-8').read()
    partes = re.split(r'^---\s*$', texto, flags=re.M)
    saida = []
    for p in partes:
        # tira os comentários // que explicam a consulta
        linhas = [l for l in p.splitlines() if not l.strip().startswith('//')]
        limpo = '\n'.join(linhas).strip()
        if limpo:
            saida.append(limpo)
    return saida


def ruas(coords):
    """As ruas perto de cada sítio, para a linha de morada e para desempatar
       nomes repetidos («Linda-a-Velha» aparecia cinco vezes em Oeiras).

       O `around` do Overpass aceita uma LISTA de coordenadas, mas trata-a como
       uma LINHA: com pontos espalhados pelo país devolve tudo o que fica ao
       longo dos segmentos que os unem, e o servidor rebenta. Custou uma hora.
       O que funciona é a UNIÃO de `around` individuais, em lotes."""
    destino = os.path.join(BRUTO, 'ruas.json')
    feito = json.load(open(destino)) if os.path.exists(destino) else {}
    LOTE = 70
    for k in range(0, len(coords), LOTE):
        if f'_lote{k}' in feito:
            continue
        pedaco = coords[k:k + LOTE]
        q = ['[out:json][timeout:180];', '(']
        for lat, lon in pedaco:
            q.append(f'way["highway"]["name"](around:80,{lat:.6f},{lon:.6f});')
        q += [');', 'out tags geom;']
        d = overpass('\n'.join(q), f'ruas {k}-{k + len(pedaco)}')
        feito[f'_lote{k}'] = [
            {'name': e['tags']['name'], 'hw': e['tags'].get('highway'),
             'geom': [[g['lat'], g['lon']] for g in e.get('geometry', [])]}
            for e in d.get('elements', []) if e.get('geometry')]
        json.dump(feito, open(destino, 'w'))
        print(f'    {len(feito[f"_lote{k}"])} ruas', flush=True)
        time.sleep(4)


def main():
    os.makedirs(BRUTO, exist_ok=True)
    qs = consultas()
    if len(qs) != 3:
        sys.exit(f'overpass.txt devia ter 3 consultas separadas por ---, tem {len(qs)}')

    for nome, q in zip(NOMES, qs):
        d = overpass(q, nome)
        n = len(d.get('elements', []))
        caminho = os.path.join(BRUTO, nome + '.json')

        # DUAS GUARDAS, e a segunda custou uma investigação.
        #
        # A primeira: zero elementos é um erro do servidor, não Portugal a ficar
        # sem parques.
        #
        # A segunda: uma resposta MUITO MAIS PEQUENA do que a anterior é o mesmo
        # erro, só que disfarçado. O Overpass pode devolver 200, JSON válido e
        # sem `remark`, com a consulta cortada a meio — e a recolha seguinte
        # apagava em silêncio centenas de sítios. Aconteceu: uma consulta
        # ALARGADA voltou com menos 28 elementos do que a estreita, o que é
        # impossível se a resposta estiver inteira. Abaixo de 90 % do que já cá
        # estava, não se substitui: exige-se --forcar.
        anterior = 0
        if os.path.exists(caminho):
            try:
                anterior = len([e for e in json.load(open(caminho))['elements']
                                if e.get('type') != 'count'])
            except Exception:
                anterior = 0
        if n == 0 and anterior:
            print(f'  {nome}: 0 elementos — MANTIDO o ficheiro anterior')
            continue
        if anterior and n < anterior * 0.9 and '--forcar' not in sys.argv:
            print(f'  {nome}: {n} elementos, MENOS 10 % do que os {anterior} '
                  f'que cá estavam — MANTIDO o anterior.')
            print(f'    (se a quebra for real, corre outra vez com --forcar)')
            continue
        json.dump(d, open(caminho, 'w'))
        print(f'  {nome}: {n} elementos -> _source/bruto/{nome}.json')
        time.sleep(5)

    if not os.path.exists(CAOP):
        print('  CAOP: a descarregar 9 MB da DGT…', flush=True)
        b = pedir(FONTE_CAOP)
        if not b:
            sys.exit('Não consegui a CAOP.')
        open(CAOP, 'wb').write(b)
        print(f'  CAOP: {len(b) / 1e6:.1f} MB -> _source/caop-municipios.geojson')

    print('  CML: equipamentos de fitness de Lisboa…', flush=True)
    b = pedir(FONTE_CML)
    caminho_cml = os.path.join(BRUTO, 'lisboa-cml.json')
    if b:
        try:
            d = json.loads(b)
            n = len(d.get('features', []))
            if n:
                json.dump(d, open(caminho_cml, 'w'))
                print(f'  CML: {n} equipamentos -> _source/bruto/lisboa-cml.json')
            else:
                print('  CML: 0 elementos — MANTIDO o ficheiro anterior')
        except ValueError:
            print('  CML: resposta inválida — MANTIDO o ficheiro anterior')
    else:
        print('  CML: sem resposta — MANTIDO o ficheiro anterior')

    if '--ruas' in sys.argv:
        # As ruas precisam dos centróides dos grupos, que só existem depois do
        # gerar-spots.py. Portanto: correr sem --ruas, gerar, e só depois --ruas.
        spots = os.path.join(RAIZ, 'data', 'spots.json')
        if not os.path.exists(spots):
            sys.exit('Corre primeiro `python3 _source/gerar-spots.py` (sem ruas), '
                     'e depois `--ruas`.')
        s = json.load(open(spots))
        print(f'  ruas: {len(s)} sítios, em lotes de 70')
        ruas([(x['lat'], x['lon']) for x in s])

    print('\nfeito. A seguir: python3 _source/gerar-spots.py')


if __name__ == '__main__':
    main()
