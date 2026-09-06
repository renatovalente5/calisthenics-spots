# -*- coding: utf-8 -*-
"""Nenhuma ligação interna pode estar morta.

   Correr:  python3 _source/testar-ligacoes.py

   PORQUE EXISTE. Contar ficheiros não prova nada: uma página pode existir e o
   `href` que lhe aponta ter um erro de escrita. Isto abre CADA página
   construída, tira TODOS os href e src, e vai ver se o ficheiro existe mesmo
   no sítio para onde o browser iria.
"""
import os, re, sys
from urllib.parse import urlparse, unquote

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
mortas, vistas = [], 0

paginas = [os.path.join(RAIZ, f) for f in ('index.html', '404.html')]
for pasta in ('sobre', 'contribuir', 'privacidade'):
    p = os.path.join(RAIZ, pasta, 'index.html')
    if os.path.exists(p):
        paginas.append(p)

for pagina in paginas:
    if not os.path.exists(pagina):
        mortas.append(f'FALTA a própria página {os.path.relpath(pagina, RAIZ)}')
        continue
    html = open(pagina, encoding='utf-8').read()
    for atributo, alvo in re.findall(r'\b(href|src)="([^"]+)"', html):
        u = urlparse(alvo)
        if u.scheme or alvo.startswith('#') or alvo.startswith('mailto:'):
            continue
        if not alvo.startswith('/'):
            continue
        vistas += 1
        caminho = unquote(u.path)
        destino = os.path.join(RAIZ, caminho.lstrip('/'))
        if caminho.endswith('/'):
            destino = os.path.join(destino, 'index.html')
        if not os.path.exists(destino):
            mortas.append(f'{os.path.relpath(pagina, RAIZ)} -> {alvo}')

# e os ficheiros que o manifesto e o service worker prometem
for f, chave in (('manifest.webmanifest', r'"src"\s*:\s*"([^"]+)"'),
                 ('sw.js', r"'(/[^']+)'")):
    p = os.path.join(RAIZ, f)
    if not os.path.exists(p):
        continue
    for alvo in re.findall(chave, open(p, encoding='utf-8').read()):
        alvo = alvo.split('?')[0]
        if not alvo.startswith('/') or alvo == '/':
            continue
        vistas += 1
        destino = os.path.join(RAIZ, alvo.lstrip('/'))
        if not os.path.exists(destino):
            mortas.append(f'{f} -> {alvo}')

print(f'{vistas} ligações internas verificadas em {len(paginas)} páginas')
if mortas:
    print(f'\n{len(mortas)} MORTAS:')
    for m in mortas:
        print(f'  · {m}')
    sys.exit(1)
print('nenhuma morta.')
