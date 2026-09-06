# -*- coding: utf-8 -*-
"""Desenha os ícones e a imagem social, em Chrome, a partir de HTML.

   Correr:  python3 _source/gerar-imagens.py

   Produz em assets/img/:
     icone-192.png, icone-512.png   — para o manifesto e para o ecrã inicial
     apple-touch-icon.png           — 180x180, o iOS ignora o manifesto
     og.png                         — 1200x630, para partilhas

   PORQUÊ EM HTML E NÃO À MÃO. Não há Pillow nem Inkscape neste projecto e não
   vai haver: o Chrome já cá está por causa das capturas, desenha SVG e tipografia
   melhor do que qualquer biblioteca, e o resultado é editável por quem souber
   CSS. Cada imagem é uma página; a captura é o ficheiro.

   O ÍCONE MASCARÁVEL. O Android recorta os ícones em círculo, losango ou
   squircle, conforme o fabricante. Tudo o que interesse tem de caber na «zona
   segura»: um círculo com 80 % da largura, centrado. Por isso o pino vive a 62 %
   do lado, e não encostado às margens — senão o Samsung corta-lhe a ponta.
"""
import base64, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(RAIZ, 'assets', 'img')

FERRUGEM = '#E85D2A'
GRAFITE = '#14161A'
CALCADA = '#F5F3EE'

# O pino com a barra fixa recortada por dentro. `evenodd` é o que abre o buraco:
# o segundo sub-caminho (o «П» da barra) fura o primeiro (a gota do pino).
PINO = ('M12 1.6c-4.7 0-8.5 3.8-8.5 8.5 0 6.2 8.5 12.3 8.5 12.3s8.5-6.1 8.5-12.3'
        'c0-4.7-3.8-8.5-8.5-8.5zM7.6 7.4H16.4V15.6H14.3V9.3H9.7V15.6H7.6Z')


def pagina_icone(lado, fundo, cor, escala=0.62, redondo=False):
    p = lado * (1 - escala) / 2
    raio = '50%' if redondo else f'{lado * 0.22:.0f}px'
    return f"""<!doctype html><meta charset=utf-8>
<style>
  html,body{{margin:0;padding:0;background:transparent}}
  .c{{width:{lado}px;height:{lado}px;background:{fundo};border-radius:{raio};
      display:flex;align-items:center;justify-content:center}}
  svg{{width:{lado * escala:.0f}px;height:{lado * escala:.0f}px;display:block;
      margin-top:{-lado * 0.015:.0f}px}}
</style>
<div class=c><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
<path fill="{cor}" fill-rule="evenodd" d="{PINO}"/></svg></div>"""


def pagina_og(n_spots, n_concelhos, n_barras):
    return f"""<!doctype html><meta charset=utf-8>
<style>
  @font-face{{font-family:x;src:local("Helvetica")}}
  html,body{{margin:0;padding:0}}
  body{{width:1200px;height:630px;background:{GRAFITE};color:{CALCADA};
       font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
       display:flex;flex-direction:column;justify-content:center;
       padding:0 76px;box-sizing:border-box;position:relative;overflow:hidden}}
  .brilho{{position:absolute;right:-160px;top:-160px;width:620px;height:620px;
        border-radius:50%;background:radial-gradient(circle,{FERRUGEM}44,transparent 68%)}}
  .marca{{display:flex;align-items:center;gap:16px;margin-bottom:40px}}
  .marca svg{{width:52px;height:52px}}
  .marca span{{font-size:38px;font-weight:800;letter-spacing:-.035em}}
  .marca b{{color:{FERRUGEM}}}
  h1{{font-size:82px;line-height:1.02;letter-spacing:-.042em;margin:0 0 26px;
     font-weight:800;max-width:19ch}}
  p{{font-size:31px;color:#A8AFB8;margin:0 0 46px;letter-spacing:-.012em}}
  .n{{display:flex;gap:56px}}
  .n div{{display:flex;flex-direction:column}}
  .n b{{font-size:50px;font-weight:800;letter-spacing:-.035em;color:{FERRUGEM};
       line-height:1}}
  .n span{{font-size:19px;color:#A8AFB8;margin-top:7px;letter-spacing:.01em}}
</style>
<div class=brilho></div>
<div class=marca>
  <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
  <path fill="{CALCADA}" fill-rule="evenodd" d="{PINO}"/></svg>
  <span>Barra <b>Fixe</b></span>
</div>
<h1>Encontra barras de rua perto de ti.</h1>
<p>Parques com barras de elevações, paralelas e argolas — em todo o país.</p>
<div class=n>
  <div><b>{n_spots}</b><span>SÍTIOS</span></div>
  <div><b>{n_concelhos}</b><span>CONCELHOS</span></div>
  <div><b>{n_barras}</b><span>COM BARRAS CONFIRMADAS</span></div>
</div>"""


def capturar(c, html, largura, altura, destino, transparente=True):
    c.cmd('Emulation.setDeviceMetricsOverride', width=largura, height=altura,
          deviceScaleFactor=1, mobile=False)
    if transparente:
        c.cmd('Emulation.setDefaultBackgroundColorOverride',
              color={'r': 0, 'g': 0, 'b': 0, 'a': 0})
    else:
        c.cmd('Emulation.setDefaultBackgroundColorOverride')
    b64 = base64.b64encode(html.encode()).decode()
    c.abrir('data:text/html;base64,' + b64, espera=0.8)
    dados = c.cmd('Page.captureScreenshot', format='png',
                  captureBeyondViewport=False)['data']
    open(destino, 'wb').write(base64.b64decode(dados))
    print(f'  {os.path.basename(destino)}  ({largura}x{altura}, '
          f'{len(base64.b64decode(dados)) / 1024:.0f} KB)')


def main():
    import json
    d = json.load(open(os.path.join(RAIZ, 'data', 'spots.json')))
    spots = d['spots'] if isinstance(d, dict) else d
    n = len(spots)
    nc = len({s['con'] for s in spots if s['con']})
    nb = sum(1 for s in spots if s['esc'] == 1)

    os.makedirs(IMG, exist_ok=True)
    c = cdp.Chrome()
    try:
        # Os ícones do manifesto levam FUNDO OPACO. Um PNG transparente no ecrã
        # inicial do Android fica com o pino a flutuar sobre o papel de parede.
        capturar(c, pagina_icone(192, GRAFITE, CALCADA), 192, 192,
                 os.path.join(IMG, 'icone-192.png'), transparente=False)
        capturar(c, pagina_icone(512, GRAFITE, CALCADA), 512, 512,
                 os.path.join(IMG, 'icone-512.png'), transparente=False)
        # O iOS não recorta nada e não lê `purpose`, mas também não aceita
        # transparência: põe preto por baixo. Fundo opaco, cantos quadrados.
        capturar(c, pagina_icone(180, GRAFITE, CALCADA, escala=0.66),
                 180, 180, os.path.join(IMG, 'apple-touch-icon.png'), transparente=False)
        capturar(c, pagina_og(n, nc, nb), 1200, 630,
                 os.path.join(IMG, 'og.png'), transparente=False)
    finally:
        c.fechar()


if __name__ == '__main__':
    main()
