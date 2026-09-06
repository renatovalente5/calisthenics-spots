# -*- coding: utf-8 -*-
"""Constrói as páginas do site a partir de _source/paginas/.

   Correr:  python3 _source/gerar-paginas.py

   PORQUE EXISTE, e não são só includes. As páginas falam de números — «798
   sítios», «178 concelhos», «57 com barras confirmadas» — e esses números
   mudam sempre que o OpenStreetMap muda. Escritos à mão, divergem em silêncio:
   passa a haver 812 sítios no mapa e 798 na página do «Sobre», e ninguém dá por
   isso porque nada rebenta. Aqui vêm todos de data/spots.json, e a construção
   MORRE se um marcador ficar por substituir.

   Também garante o rodapé e o cabeçalho iguais em todo o lado, que é a outra
   maneira de as páginas divergirem.
"""
import hashlib, json, os, re, sys, datetime, collections

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGINAS = os.path.join(RAIZ, '_source', 'paginas')
SPOTS = os.path.join(RAIZ, 'data', 'spots.json')

MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
         'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

RODAPE = """<footer class="rodape">
  <div class="rodape__grelha">
    <div>
      <h4>Barra Fixe</h4>
      <ul>
        <li><a href="/">Mapa e lista</a></li>
        <li><a href="/sobre/">Como isto funciona</a></li>
        <li><a href="/contribuir/">Falta um sítio?</a></li>
      </ul>
    </div>
    <div>
      <h4>Dados</h4>
      <ul>
        <li><a href="https://www.openstreetmap.org/" rel="noopener">OpenStreetMap</a></li>
        <li><a href="https://geodados-cml.hub.arcgis.com/" rel="noopener">Lisboa Aberta — CML</a></li>
        <li><a href="https://www.dgterritorio.gov.pt/cartografia/cartografia-tematica/caop" rel="noopener">CAOP — DGT</a></li>
        <li><a href="https://github.com/renatovalente5/barra-fixe" rel="noopener">Código no GitHub</a></li>
      </ul>
    </div>
    <div>
      <h4>Legal</h4>
      <ul>
        <li><a href="/privacidade/">Privacidade</a></li>
        <li><a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="noopener">Licença dos dados (ODbL)</a></li>
      </ul>
    </div>
  </div>
  <div class="rodape__fim">
    <p>Dados dos sítios do <strong>OpenStreetMap</strong>, disponibilizados sob a
    <a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="noopener">Open Database License (ODbL)</a>
    — © contribuidores do OpenStreetMap. Em Lisboa, complementados com os
    <strong>Equipamentos de Fitness</strong> da <strong>Câmara Municipal de Lisboa</strong>
    (<a href="https://geodados-cml.hub.arcgis.com/" rel="noopener">Lisboa Aberta</a>, CC0).
    Concelhos e distritos da Carta Administrativa
    Oficial de Portugal (CAOP), da Direção-Geral do Território. Mosaicos do mapa por
    <a href="https://openfreemap.org/" rel="noopener">OpenFreeMap</a> e
    <a href="https://openmaptiles.org/" rel="noopener">OpenMapTiles</a>.</p>
    <p>O Barra Fixe é gratuito, não tem publicidade, não usa cookies e não recolhe
    dados de quem o visita. Última actualização dos dados: {{DATA}}.</p>
  </div>
</footer>"""

CABECA_TEXTO = """<header class="topo">
  <a class="marca" href="/" aria-label="Barra Fixe, página inicial">
    <svg class="marca__pino" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" fill-rule="evenodd" d="M12 1.6c-4.7 0-8.5 3.8-8.5 8.5 0 6.2 8.5 12.3 8.5 12.3s8.5-6.1 8.5-12.3c0-4.7-3.8-8.5-8.5-8.5zM7.6 7.4H16.4V15.6H14.3V9.3H9.7V15.6H7.6Z"/>
    </svg>
    <span class="marca__nome">Barra <b>Fixe</b></span>
  </a>
  <span style="flex:1 1 auto"></span>
  <a class="botao botao--fantasma" href="/" style="height:36px;font-size:.8125rem">Ver o mapa</a>
</header>"""


SW_MODELO = os.path.join(RAIZ, '_source', 'paginas-sw.js')
FICHEIROS_DA_VERSAO = [
    'assets/css/app.css', 'assets/js/app.js',
    'assets/vendor/maplibre-gl.js', 'assets/vendor/maplibre-gl.css',
    'data/spots.json',
]


def versao():
    """A versão É o conteúdo: os 8 primeiros dígitos de um resumo de tudo o que
       o browser guarda em cache.

       Assim o `?v=` das folhas e do código, e o nome da cache do service
       worker, mudam SOZINHOS quando alguma coisa muda — e só quando muda. Um
       número escrito à mão esquece-se, e o custo de o esquecer é uma pessoa
       presa numa versão velha do site sem forma de sair dela."""
    h = hashlib.sha256()
    for f in FICHEIROS_DA_VERSAO:
        caminho = os.path.join(RAIZ, f)
        if os.path.exists(caminho):
            h.update(open(caminho, 'rb').read())
    return h.hexdigest()[:8]


def numeros():
    if not os.path.exists(SPOTS):
        sys.exit('Falta data/spots.json — corre _source/gerar-spots.py')
    d = json.load(open(SPOTS))
    s = d['spots'] if isinstance(d, dict) else d
    meta = d.get('meta', {}) if isinstance(d, dict) else {}
    esc = collections.Counter(x['esc'] for x in s)
    hoje = datetime.date.today()
    return {
        'N_SPOTS': f'{len(s)}',
        'N_CONCELHOS': f'{len({x["con"] for x in s if x["con"]})}',
        'N_DISTRITOS': f'{len({x["dis"] for x in s if x["dis"]})}',
        'N_BARRAS': f'{esc[1]}',
        'N_CORPO': f'{esc[2]}',
        'N_CONFIRMAR': f'{esc[3]}',
        'N_MAQUINAS': f'{esc[4]}',
        'N_APARELHOS': f'{sum(x["n"] for x in s)}',
        'N_LUZ': f'{sum(1 for x in s if x["lit"] == "yes")}',
        'N_24': f'{sum(1 for x in s if x["h24"])}',
        'N_ACESS': f'{sum(1 for x in s if x["wc"] == "yes")}',
        'DATA': f'{hoje.day} de {MESES[hoje.month - 1]} de {hoje.year}',
        'ANO': f'{hoje.year}',
        'EXTRAIDO': meta.get('extraido_em', '') or hoje.isoformat(),
        'VERSAO': versao(),
        'RODAPE': RODAPE,
        'CABECA_TEXTO': CABECA_TEXTO,
    }


def main():
    vals = numeros()
    # O RODAPE também tem marcadores; resolve-se antes de ser injectado.
    for k in ('RODAPE', 'CABECA_TEXTO'):
        for _ in range(3):
            vals[k] = re.sub(r'\{\{(\w+)\}\}',
                             lambda m: vals.get(m.group(1), m.group(0)), vals[k])

    if not os.path.isdir(PAGINAS):
        sys.exit(f'Falta {PAGINAS}')

    # O service worker sai do mesmo molde e leva a mesma versão.
    if os.path.exists(SW_MODELO):
        sw = open(SW_MODELO, encoding='utf-8').read().replace('{{VERSAO}}', vals['VERSAO'])
        sobra_sw = re.findall(r'\{\{(\w+)\}\}', sw)
        if sobra_sw:
            sys.exit(f'ERRO no sw.js: marcadores sem valor: {sorted(set(sobra_sw))}')
        open(os.path.join(RAIZ, 'sw.js'), 'w', encoding='utf-8').write(sw)
        print(f'  paginas-sw.js -> sw.js  (versão {vals["VERSAO"]})')

    escritas = 0
    for nome in sorted(os.listdir(PAGINAS)):
        if not nome.endswith('.html'):
            continue
        html = open(os.path.join(PAGINAS, nome), encoding='utf-8').read()
        for _ in range(3):                       # marcadores dentro de marcadores
            html = re.sub(r'\{\{(\w+)\}\}',
                          lambda m: vals.get(m.group(1), m.group(0)), html)

        # A GUARDA. Um marcador por substituir é um erro de construção, não um
        # detalhe: chega a produção como «{{N_SPOTS}}» à vista de toda a gente.
        sobra = re.findall(r'\{\{(\w+)\}\}', html)
        if sobra:
            sys.exit(f'ERRO em {nome}: marcadores sem valor: {sorted(set(sobra))}')

        if nome == 'index.html':
            destino = os.path.join(RAIZ, 'index.html')
        elif nome == '404.html':
            destino = os.path.join(RAIZ, '404.html')
        else:
            pasta = os.path.join(RAIZ, nome[:-5])
            os.makedirs(pasta, exist_ok=True)
            destino = os.path.join(pasta, 'index.html')
        open(destino, 'w', encoding='utf-8').write(html)
        print(f'  {nome} -> {os.path.relpath(destino, RAIZ)}')
        escritas += 1

    print(f'\n{escritas} páginas. {vals["N_SPOTS"]} sítios, '
          f'{vals["N_CONCELHOS"]} concelhos, {vals["N_BARRAS"]} com barras confirmadas.')


if __name__ == '__main__':
    main()
