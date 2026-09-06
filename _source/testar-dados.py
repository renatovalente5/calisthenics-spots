# -*- coding: utf-8 -*-
"""Guardas sobre data/spots.json. Corre no CI e mata a construção se algo partir.

   Correr:  python3 _source/testar-dados.py

   PORQUE EXISTE. O ficheiro é gerado de dados de terceiros que mudam sozinhos.
   Um dia o Overpass devolve metade, ou a CAOP muda um nome de campo, ou uma
   consulta passa a apanhar ginásios pagos — e nada disso dá erro. Dá um site
   com menos sítios, ou com sítios errados, publicado na mesma.
"""
import json, os, sys, collections

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
falhas = []


def exigir(nome, condicao, detalhe=''):
    if condicao:
        print(f'  ok   {nome}')
    else:
        falhas.append(f'{nome}{" — " + detalhe if detalhe else ""}')
        print(f'  FALHA {nome}{" — " + detalhe if detalhe else ""}')


d = json.load(open(os.path.join(RAIZ, 'data', 'spots.json'), encoding='utf-8'))
exigir('o ficheiro traz o envelope {meta, spots}',
       isinstance(d, dict) and 'meta' in d and 'spots' in d)
meta, s = d.get('meta', {}), d.get('spots', [])

# A ATRIBUIÇÃO. Não é decoração: é a condição da ODbL para se poder distribuir
# isto. Se alguém apagar o bloco `meta`, o site fica em incumprimento e ninguém
# repara — a página continua bonita.
for campo in ('fonte', 'licenca', 'licenca_url', 'atribuicao', 'extraido_em'):
    exigir(f'meta.{campo} está preenchido', bool(meta.get(campo)))
exigir('a licença é a ODbL', 'ODbL' in (meta.get('licenca') or ''))
exigir('a fonte é o OpenStreetMap', 'OpenStreetMap' in (meta.get('fonte') or ''))

exigir('há mais de 700 sítios', len(s) > 700, f'{len(s)}')
exigir('a contagem em meta bate com a lista', meta.get('total') == len(s),
       f"{meta.get('total')} vs {len(s)}")

sem_nome = [x for x in s if not x.get('nome')]
exigir('todos os sítios têm nome', not sem_nome,
       f'{len(sem_nome)} sem nome')
sem_con = [x for x in s if not x.get('con')]
exigir('todos os sítios têm concelho', not sem_con,
       f'{len(sem_con)} sem concelho: ' + ', '.join(
           f"{x['lat']:.4f},{x['lon']:.4f}" for x in sem_con[:3]))

fora = [x for x in s if not (29 < x['lat'] < 43 and -32 < x['lon'] < -5)]
exigir('todas as coordenadas caem em Portugal', not fora,
       f'{len(fora)} fora')

# 5 casas decimais são ~1,1 m à latitude de Portugal. Mais do que isso é ruído
# que só engorda o ficheiro.
exigir('as coordenadas estão arredondadas a 5 casas',
       all(round(x['lat'], 5) == x['lat'] and round(x['lon'], 5) == x['lon'] for x in s))

# O IDENTIFICADOR ESTÁVEL. Sem esta guarda, uma construção que perdesse o
# _source/ids.json renumerava tudo em silêncio e todas as ligações partilhadas
# — e todas as contribuições referidas a um sítio — passavam a apontar para o
# parque do lado.
exigir('todo o sítio tem identificador inteiro',
       all(isinstance(x.get('id'), int) for x in s),
       str([x['nome'] for x in s if not isinstance(x.get('id'), int)][:3]))
exigir('os identificadores não se repetem',
       len({x.get('id') for x in s}) == len(s),
       f"{len(s) - len({x.get('id') for x in s})} repetidos")
_ids = os.path.join(RAIZ, '_source', 'ids.json')
exigir('o registo dos identificadores existe e cobre todos os sítios',
       os.path.exists(_ids) and
       {x['id'] for x in s} <= {y['id'] for y in json.load(open(_ids, encoding='utf-8'))['sitios']},
       'falta _source/ids.json ou tem menos sítios do que os dados')

exigir('nenhum sítio partilha coordenada com outro',
       len({(x['lat'], x['lon']) for x in s}) == len(s),
       f"{len(s) - len({(x['lat'], x['lon']) for x in s})} repetidas")

esc = collections.Counter(x['esc'] for x in s)
exigir('os escalões são 1 a 4', set(esc) <= {1, 2, 3, 4}, str(sorted(esc)))
exigir('há sítios com barras confirmadas', esc[1] > 20, f'{esc[1]}')
exigir('os «só máquinas» são poucos', esc[4] < len(s) * 0.08, f'{esc[4]}')
exigir('as câmaras acrescentam barras confirmadas ao que o OSM sabia',
       sum(1 for x in s if x['esc'] == 1 and set(x.get('fontes', [])) - {'OSM'}) >= 15,
       f"{sum(1 for x in s if x['esc'] == 1 and set(x.get('fontes', [])) - {'OSM'})}")

exigir('cada sítio declara de onde veio',
       all(x.get('fontes') for x in s))
exigir('todo o sítio sem objecto do OSM veio de uma câmara',
       all(x.get('osm') or (set(x.get('fontes', [])) - {'OSM'}) for x in s),
       str([x['nome'] for x in s if not x.get('osm')
            and not (set(x.get('fontes', [])) - {'OSM'})][:3]))
usadas = {f for x in s for f in x.get('fontes', [])}
exigir('a atribuição de todas as fontes municipais está declarada',
       (not (usadas - {'OSM'})) or
       len(meta.get('fontes_complementares') or []) >= len(usadas - {'OSM'}),
       f'fontes nos dados: {sorted(usadas)}')
# CMA = Amadora, CMC = Cascais, CML = Lisboa, CMO = Oeiras. Esta guarda existe
# para que uma fonte nova não entre nos dados sem passar pela atribuição: quem
# acrescentar um normalizador tem de vir aqui e à lista do rodapé.
exigir('as fontes conhecidas são só estas seis',
       usadas <= {'OSM', 'CMA', 'CMC', 'CML', 'CMO', 'COM'}, str(sorted(usadas)))

# Um aparelho inventado num sítio da comunidade seria ignorado em silêncio pela
# aplicação e ninguém dava por isso. Aqui mata a construção.
CONHECIDOS = {'barra_fixa', 'paralelas', 'escada_horizontal', 'argolas', 'espaldar',
              'flexoes', 'abdominais', 'lombares', 'alongamento', 'agachamento',
              'trave', 'equilibrio', 'caixa', 'escadas', 'barreiras', 'slalom',
              'corda', 'escalada', 'slackline', 'suspensao'}
maus = sorted({a for x in s for a in (x.get('ap') or [])} - CONHECIDOS)
exigir('todo o aparelho tem etiqueta na aplicação', not maus, str(maus))
exigir('os ids do OSM têm a forma certa (n/w/r + número)',
       all(all(o[0] in 'nwr' and o[1:].isdigit() for o in x.get('osm', [])) for x in s))

concelhos = {x['con'] for x in s if x['con']}
exigir('há mais de 150 concelhos cobertos', len(concelhos) > 150, f'{len(concelhos)}')
exigir('nenhum concelho vem em MAIÚSCULAS da CAOP',
       not [c for c in concelhos if c.isupper()],
       str([c for c in concelhos if c.isupper()][:3]))

# O ficheiro é carregado inteiro à primeira visita. Se um dia passar de meio
# mega, é preciso repensar — não deixar acontecer por acumulação.
tam = os.path.getsize(os.path.join(RAIZ, 'data', 'spots.json'))
exigir('o ficheiro cabe em 500 KB', tam < 500_000, f'{tam / 1024:.0f} KB')

print(f'\n{len(falhas)} falhas')
if falhas:
    for f in falhas:
        print(f'  · {f}')
    sys.exit(1)
print('dados bem.')
