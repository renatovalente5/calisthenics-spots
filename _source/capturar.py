# -*- coding: utf-8 -*-
"""Capturas verdadeiras do site, em Chrome headless.

   Correr:  python3 _source/capturar.py [url] [--porta 4600]

   PORQUE EXISTE. As ferramentas do painel de pré-visualização deste editor
   tiram fotografias de um separador que pode estar ESCONDIDO — e num separador
   escondido o browser não dispara `requestAnimationFrame`. O MapLibre desenha
   dentro do rAF. Resultado: o mapa aparece em branco e a captura mente, sem
   dar erro nenhum. Aqui o Chrome é nosso, está visível para si próprio, e o
   que sai é o que uma pessoa veria.

   Espera EXPLICITAMENTE que o mapa diga que acabou de desenhar, em vez de
   dormir uns segundos à sorte.
"""
import base64, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, '_capturas')

ECRAS = [
    ('telemovel', 390, 844, 3),
    ('computador', 1440, 900, 2),
]


def capturar(c, url, nome, largura, altura, dpr, esperar_mapa=True, antes=None,
             espera_extra=0.0):
    c.cmd('Emulation.setDeviceMetricsOverride', width=largura, height=altura,
          deviceScaleFactor=dpr, mobile=largura < 700)
    c.abrir(url, espera=1.0)
    if antes:
        c.js(antes)
    if esperar_mapa:
        # `estado.mapaPronto` diz que as camadas estão montadas; `idle` diz que
        # já não há tiles a chegar nem nada por desenhar. Sem o segundo, apanha-se
        # o mapa a meio.
        pronto = False
        for _ in range(80):
            try:
                pronto = bool(c.js(
                    "(typeof estado!=='undefined' && estado.mapaPronto"
                    " && estado.mapa && estado.mapa.loaded()) || false"))
            except Exception:
                pronto = False
            if pronto:
                break
            time.sleep(0.35)
        if not pronto:
            print(f'    AVISO: {nome} — o mapa não chegou a «idle»')
        time.sleep(0.6 + espera_extra)
    else:
        time.sleep(0.5 + espera_extra)
    dados = c.cmd('Page.captureScreenshot', format='png',
                  captureBeyondViewport=False)['data']
    caminho = os.path.join(SAIDA, nome + '.png')
    open(caminho, 'wb').write(base64.b64decode(dados))
    print(f'    {nome}.png  ({largura}x{altura} @{dpr}x)')
    return caminho


def main():
    porta = 4600
    if '--porta' in sys.argv:
        porta = int(sys.argv[sys.argv.index('--porta') + 1])
    base = f'http://localhost:{porta}/calisthenics-spots'
    os.makedirs(SAIDA, exist_ok=True)

    paginas = [('inicio', '/', True)]
    for a in sys.argv[1:]:
        if a.startswith('/'):
            paginas = [(a.strip('/').replace('/', '-') or 'inicio', a, a == '/')]

    c = cdp.Chrome(webgl=True)   # o mapa precisa de WebGL: ver cdp.py
    try:
        for nome, caminho, com_mapa in paginas:
            print(f'  {caminho}')
            for ecra, w, h, dpr in ECRAS:
                capturar(c, base + caminho, f'{nome}-{ecra}', w, h, dpr,
                         esperar_mapa=com_mapa)
            if com_mapa:
                # a vista de mapa do telemóvel, que é a que interessa mesmo
                capturar(c, base + caminho, f'{nome}-telemovel-mapa', 390, 844, 3,
                         esperar_mapa=True,
                         antes="document.getElementById('v-mapa').click()")
                # e uma ficha aberta, que é o ecrã de decisão
                capturar(c, base + caminho, f'{nome}-ficha', 1440, 900, 2,
                         esperar_mapa=True,
                         antes="document.querySelector('.cartao').click()")
                # Uma ficha com a ortofoto — a peça que responde à pergunta
                # «isto tem mesmo barras?». Escolhe-se um sítio CONFIRMADO.
                capturar(c, base + caminho, f'{nome}-ortofoto', 1440, 900, 2,
                         esperar_mapa=True,
                         antes=("[...document.querySelectorAll('.cartao')]"
                                ".find(b=>b.classList.contains('cartao--top')).click()"),
                         espera_extra=5.0)
                # E a pesquisa por zona, com o concelho assinalado no mapa.
                capturar(c, base + caminho, f'{nome}-zona', 1440, 900, 2,
                         esperar_mapa=True,
                         antes=("(async()=>{const q=document.getElementById('q');"
                                "q.value='Viana do Castelo';"
                                "q.dispatchEvent(new Event('input',{bubbles:true}));"
                                "await new Promise(r=>setTimeout(r,1400));"
                                "const b=document.querySelector('.sugestao');"
                                "if(b) b.click();})()"),
                         espera_extra=3.0)
    finally:
        c.fechar()
    print(f'\nem {SAIDA}')


if __name__ == '__main__':
    main()
