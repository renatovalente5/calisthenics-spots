# -*- coding: utf-8 -*-
"""Bateria que CONDUZ a aplicação num Chrome a sério.

   Correr:  python3 _source/testar-app.py [--porta 4600]

   PORQUE NÃO CHEGA LER O CÓDIGO. Um mapa que nunca desenha, uma lista que
   carrega 40 cartões e nunca mais carrega os outros 758, um filtro que esconde
   tudo, um botão que fica preso — nada disso aparece a ler o ficheiro, e nada
   disso dá erro na consola. Só se vê a carregar nos botões.

   REGRAS DESTA BATERIA, aprendidas à força:
     · o Chrome tem de ter WEBGL (ver cdp.py). Com --disable-gpu o MapLibre
       atira no construtor e todos os testes do mapa passam a testar o nada;
     · espera-se por uma CONDIÇÃO, nunca por um número de segundos;
     · verifica-se o que o utilizador VÊ (texto, contagens, geometria no ecrã),
       não o estado interno — o estado interno pode estar certo com o ecrã
       errado, e foi o que aconteceu com o canvas de 195x300.
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cdp

falhas = []
passou = 0


def verificar(nome, condicao, detalhe=''):
    global passou
    if condicao:
        passou += 1
        print(f'  ok   {nome}')
    else:
        falhas.append(f'{nome}{" — " + detalhe if detalhe else ""}')
        print(f'  FALHA {nome}{" — " + detalhe if detalhe else ""}')


def esperar(c, expressao, segundos=25, intervalo=0.3):
    """Espera que uma expressão JS seja verdadeira. Devolve True/False."""
    fim = time.time() + segundos
    while time.time() < fim:
        try:
            if c.js(expressao):
                return True
        except Exception:
            pass
        time.sleep(intervalo)
    return False


def main():
    porta = 4600
    if '--porta' in sys.argv:
        porta = int(sys.argv[sys.argv.index('--porta') + 1])
    base = f'http://localhost:{porta}/calisthenics-spots'

    c = cdp.Chrome(webgl=True)
    try:
        c.cmd('Emulation.setDeviceMetricsOverride', width=1440, height=900,
              deviceScaleFactor=1, mobile=False)
        c.abrir(base + '/', espera=1.0)

        print('\n— arranque —')
        verificar('os dados carregam',
                  esperar(c, "typeof estado!=='undefined' && estado.spots.length>0"),
                  'estado.spots ficou vazio')
        n = c.js('estado.spots.length')
        # A vista por omissão exclui os circuitos SÓ DE MÁQUINAS: esta é uma
        # aplicação de calistenia. É esse o número contra o qual se compara.
        visiveis = c.js('estado.vistos.length')
        verificar('há sítios a mais de 700', n > 700, f'só {n}')
        verificar('todos os sítios têm nome',
                  c.js('estado.spots.every(s=>s.nome && s.nome.length>1)'))
        verificar('todos os sítios têm concelho',
                  c.js('estado.spots.every(s=>s.con)'))
        verificar('as coordenadas estão dentro de Portugal',
                  c.js('estado.spots.every(s=>s.lat>29&&s.lat<43&&s.lon>-32&&s.lon<-5)'))
        verificar('a atribuição da ODbL está visível sem carregar em nada',
                  c.js("""(()=>{const e=document.querySelector('.mapa__creditos');
                    if(!e) return false; const r=e.getBoundingClientRect();
                    return r.width>0 && r.height>0 &&
                      /OpenStreetMap/.test(e.textContent);})()"""))

        # Uma sonda: cada condutor guarda os pontos à sua maneira, e a bateria
        # não deve saber qual está a correr. Isto é o único sítio que sabe.
        print('\n— o mapa —')
        verificar('o mapa monta-se',
                  esperar(c, "typeof Mapa!=='undefined' && Mapa.pronto"))
        verificar('sem chave do Google, usa o condutor livre',
                  c.js("Mapa.condutor") == ('google' if c.js("!!CONFIG.googleMapsKey") else 'livre'),
                  c.js("Mapa.condutor"))
        verificar('o mapa acaba de desenhar',
                  esperar(c, "Mapa.condutor!=='livre' || document.querySelector('#mapa canvas')!==null", 40))
        verificar('o canvas tem o tamanho do contentor',
                  c.js("""(()=>{const c=document.querySelector('#mapa canvas'),
                    d=document.getElementById('mapa');
                    if(!c||!d) return false;
                    const a=c.getBoundingClientRect(), b=d.getBoundingClientRect();
                    return Math.abs(a.width-b.width)<2 && Math.abs(a.height-b.height)<2;})()"""),
                  c.js("(()=>{const c=document.querySelector('#mapa canvas'),d=document.getElementById('mapa');"
                       "return c&&d? c.getBoundingClientRect().width+'x'+c.getBoundingClientRect().height"
                       "+' vs '+d.getBoundingClientRect().width+'x'+d.getBoundingClientRect().height : 'sem canvas'})()"))
        verificar('o mapa tem tantos pontos quantos a lista',
                  c.js("Mapa._quantosPontos()") == c.js('estado.vistos.length'),
                  f"{c.js('Mapa._quantosPontos()')} no mapa vs {c.js('estado.vistos.length')} na lista")
        verificar('a app não transborda o ecrã',
                  c.js('document.documentElement.scrollWidth <= window.innerWidth + 1'),
                  c.js("document.documentElement.scrollWidth+' > '+window.innerWidth"))
        verificar('as cores dos pinos vêm do CSS, não estão escritas no JS',
                  c.js("getComputedStyle(document.documentElement)"
                       ".getPropertyValue('--pino-confirmado').trim().length>3"))
        verificar('sem chave do Google, nao ha botao de satelite a fingir',
                  c.js("document.getElementById('satelite').hidden") is True
                  or bool(c.js('!!CONFIG.googleMapsKey')),
                  'o botao so existe quando o mapa o sabe fazer')

        print('\n— a lista —')
        verificar('a lista começa com um lote e não com tudo',
                  0 < c.js("document.querySelectorAll('.cartao').length") <= 45)
        # rolar até ao fim, várias vezes, para o carregamento progressivo correr
        for _ in range(30):
            c.js("""(()=>{const s=document.querySelector('.painel__rolar');
                   s.scrollTop=s.scrollHeight;})()""")
            time.sleep(0.12)
            if c.js("document.querySelectorAll('.cartao').length") >= c.js('estado.vistos.length'):
                break
        desenhados = c.js("document.querySelectorAll('.cartao').length")
        total = c.js('estado.vistos.length')
        verificar('rolando, a lista chega ao fim', desenhados == total,
                  f'{desenhados} de {total}')
        verificar('as ligações do rodapé aparecem no fim da lista',
                  c.js("""(()=>{const e=document.querySelector('.painel__pe');
                    return !!e && e.getBoundingClientRect().height>0 &&
                      e.querySelectorAll('a').length===3;})()"""))

        print('\n— a procura —')
        c.js("""(()=>{const q=document.getElementById('q');
             q.value='lisboa'; q.dispatchEvent(new Event('input',{bubbles:true}));})()""")
        time.sleep(0.5)
        nl = c.js('estado.vistos.length')
        verificar('procurar «lisboa» reduz a lista', 0 < nl < visiveis, f'deu {nl}')
        primeiros = c.js("estado.vistos.slice(0,5).map(s=>s.con).join(', ')")
        n_lisboa = c.js("estado.vistos.filter(s=>s.con==='Lisboa').length")
        verificar('procurar «lisboa» põe Lisboa em primeiro, não Cascais',
                  c.js("estado.vistos.slice(0,20).every(s=>s.con==='Lisboa')"),
                  primeiros)
        # O que se exige NÃO é «só Lisboa»: quem escreve «lisboa» aceita bem os
        # parques de Sintra e de Odivelas, que são do DISTRITO de Lisboa. O que
        # não podia era vir Setúbal, e vinha — entrava pela «Área Metropolitana
        # de Lisboa», uma região que ninguém escreve numa caixa de procura.
        fora = c.js("estado.vistos.filter(s=>s.dis!=='Lisboa' && "
                    "!/lisboa/i.test((s.nome||'')+' '+(s.loc||'')+' '+(s.rua||''))).length")
        verificar('«lisboa» fica pelo distrito de Lisboa, sem arrastar Setúbal',
                  fora == 0, f'{fora} de {nl} vêm de fora do distrito')
        verificar('e Lisboa concelho é a maior fatia', n_lisboa >= 60,
                  f'{n_lisboa} de {nl}')
        c.js("""(()=>{const q=document.getElementById('q');
             q.value='algarve'; q.dispatchEvent(new Event('input',{bubbles:true}));})()""")
        time.sleep(0.4)
        n_alg = c.js('estado.vistos.length')
        verificar('procurar «algarve» continua a dar o Algarve todo',
                  n_alg > 40 and c.js("estado.vistos.every(s=>s.reg==='Algarve')"),
                  f'{n_alg} resultados')
        c.js("""(()=>{const q=document.getElementById('q');
             q.value='lisboa'; q.dispatchEvent(new Event('input',{bubbles:true}));})()""")
        time.sleep(0.4)
        verificar('o mapa acompanha a procura', c.js("Mapa._quantosPontos()") == nl)

        # acentos: quem escreve sem acento tem de encontrar
        for termo, esperado in (('evora', 'Évora'), ('agueda', 'Águeda'), ('setubal', 'Setúbal')):
            c.js(f"""(()=>{{const q=document.getElementById('q');
                 q.value='{termo}'; q.dispatchEvent(new Event('input',{{bubbles:true}}));}})()""")
            time.sleep(0.4)
            verificar(f'procurar «{termo}» encontra {esperado}',
                      c.js(f"estado.vistos.some(s=>s.con==='{esperado}')"),
                      f"{c.js('estado.vistos.length')} resultados")

        c.js("""(()=>{const q=document.getElementById('q');
             q.value='zzzzqq'; q.dispatchEvent(new Event('input',{bubbles:true}));})()""")
        time.sleep(0.4)
        verificar('procura sem resultados mostra o estado vazio',
                  c.js("!!document.querySelector('.vazio') && estado.vistos.length===0"))
        verificar('o botão de limpar aparece quando há texto',
                  c.js("!document.getElementById('limpar').hidden"))
        c.js("document.getElementById('limpar').click()")
        time.sleep(0.4)
        verificar('limpar repõe a lista toda', c.js('estado.vistos.length') == visiveis)
        verificar('os circuitos só de máquinas ficam de fora por omissão',
                  visiveis < n and c.js('estado.vistos.every(s=>s.esc!==4)'),
                  f'{n - visiveis} escondidos')

        print('\n— pesquisa por zona —')
        c.js("(()=>{const q=document.getElementById('q');"
             "q.value='Viana do Castelo';"
             "q.dispatchEvent(new Event('input',{bubbles:true}));})()")
        time.sleep(1.2)
        primeira = c.js("(()=>{const b=document.querySelector('.sugestao');"
                        "return b? b.querySelector('.sugestao__nome').textContent : null;})()")
        # A ARMADILHA: «Viana do Castelo» tem ZERO sitios. Numa primeira versao
        # so os concelhos COM sitios entravam no indice, e a procura caia em
        # «Caminha» — que casa pela palavra do distrito — sem dizer nada.
        verificar('procurar um concelho sem sitios encontra-o na mesma',
                  primeira == 'Viana do Castelo', str(primeira))
        c.js("document.querySelector('.sugestao').click()")
        time.sleep(2.0)
        verificar('o mapa vai para la e assinala a zona',
                  c.js('!!(estado.zonaActiva && estado.zonaActiva.n)'),
                  str(c.js('estado.zonaActiva && estado.zonaActiva.n')))
        verificar('e diz honestamente que ali nao ha nada',
                  c.js("/Ainda n.o h. nada/.test(document.getElementById('lista').textContent)"),
                  c.js("document.getElementById('lista').textContent.slice(0,60)"))
        # e um concelho COM sitios continua a funcionar
        c.js("(()=>{const q=document.getElementById('q');"
             "q.value='Cascais'; q.dispatchEvent(new Event('input',{bubbles:true}));})()")
        time.sleep(1.2)
        c.js("document.querySelector('.sugestao').click()")
        time.sleep(2.0)
        n_cascais = c.js('estado.vistos.length')
        verificar('escolher Cascais filtra a lista para Cascais',
                  n_cascais > 5 and c.js("estado.vistos.every(s=>s.con==='Cascais')"),
                  f'{n_cascais} resultados')
        verificar('e o contorno do concelho foi buscado a parte',
                  c.js('contornosEmCache.size >= 1'),
                  str(c.js('contornosEmCache.size')))
        c.js("document.getElementById('limpar').click()")
        time.sleep(0.5)

        print('\n— os filtros —')
        c.js("document.getElementById('f-barras').click()")
        time.sleep(0.4)
        verificar('«barras confirmadas» só deixa escalão 1',
                  c.js('estado.vistos.length>0 && estado.vistos.every(s=>s.esc===1)'))
        verificar('a contagem do filtro bate com o resultado',
                  c.js("+document.getElementById('n-barras').textContent") ==
                  c.js('estado.vistos.length'))
        c.js("document.getElementById('f-24').click()")
        time.sleep(0.4)
        verificar('dois filtros combinam-se (E, não OU)',
                  c.js('estado.vistos.every(s=>s.esc===1 && s.h24)'))
        c.js("document.getElementById('f-barras').click();document.getElementById('f-24').click()")
        time.sleep(0.4)
        verificar('desligar os filtros repõe tudo', c.js('estado.vistos.length') == visiveis)
        c.js("document.getElementById('f-maquinas').click()")
        time.sleep(0.4)
        verificar('e o filtro das máquinas traz os que faltavam',
                  c.js('estado.vistos.length') == n, f"{c.js('estado.vistos.length')} vs {n}")
        c.js("document.getElementById('f-maquinas').click()")
        time.sleep(0.3)

        print('\n— a ficha —')
        c.js("document.querySelector('.cartao').click()")
        time.sleep(0.6)
        verificar('carregar num cartão abre a ficha',
                  c.js("document.getElementById('ficha').dataset.aberta==='1'"))
        verificar('a ficha tem título',
                  c.js("(document.getElementById('ficha-titulo')||{}).textContent||'' ").strip() != '')
        verificar('«Como chegar» é uma ligação de navegação, sem chave nem iframe',
                  c.js("""(()=>{const a=document.querySelector('.ficha__acoes a');
                    return !!a && /google\\.com\\/maps\\/dir|maps\\.apple\\.com/.test(a.href)
                      && !document.querySelector('#ficha iframe');})()"""))
        verificar('a ficha diz honestamente o que se sabe do equipamento',
                  c.js("/indica|sabemos|máquinas/i.test(document.getElementById('ficha-corpo').textContent)"))
        # A ORTOFOTO. E a peca que responde a «isto tem mesmo barras?», e o
        # servidor da DGT tem um defeito de CORS que a impede de entrar no
        # mapa — por isso entra aqui, como imagem. Se deixar de responder, o
        # cartao fica sem ela e ninguem da por isso: dai o teste.
        orto = c.js("(()=>{const i=document.querySelector('.imagem--orto img');"
                    "return i? i.src : null;})()")
        verificar('a ficha traz a vista aerea do sitio',
                  bool(orto) and 'dgterritorio' in (orto or ''), str(orto)[:60])
        if orto:
            import urllib.request
            try:
                b = len(urllib.request.urlopen(urllib.request.Request(
                    orto, headers={'User-Agent': 'CalisthenicsSpots-teste/1.0'}),
                    timeout=45).read())
            except Exception:
                b = -1
            verificar('e a ortofoto que vem tem mesmo imagem', b > 8000, f'{b} bytes')
        verificar('a ficha diz de que fonte vem o sítio',
                  c.js("/OpenStreetMap|Câmara Municipal/.test("
                       "document.getElementById('ficha-corpo').textContent)"))
        verificar('a ficha aponta para o OpenStreetMap com o objecto certo',
                  c.js("""(()=>{const as=[...document.querySelectorAll('#ficha a')];
                    return as.some(a=>/openstreetmap\\.org\\/(node|way|relation)\\/\\d+/.test(a.href));})()"""))
        verificar('a ligação partilhável vai para o endereço',
                  '#s=' in (c.js('location.hash') or ''))
        verificar('a ficha não tapa os botões do mapa',
                  c.js("""(()=>{const f=document.getElementById('ficha').getBoundingClientRect();
                    const a=document.querySelector('.mapa__acoes').getBoundingClientRect();
                    return a.right <= f.left + 1 || a.bottom <= f.top + 1;})()"""))
        c.js("document.getElementById('ficha-fechar').click()")
        time.sleep(0.5)
        verificar('fechar a ficha limpa o endereço',
                  c.js("document.getElementById('ficha').dataset.aberta==='0'")
                  and not (c.js('location.hash') or ''))

        print('\n— ligação partilhada —')
        # De OUTRA página. Ir de `/` para `/#s=5` não recarrega nada — só muda o
        # hash —, e testar assim escondia se o arranque lia o endereço ou não.
        c.abrir('about:blank', espera=0.3)
        c.abrir(base + '/#s=5', espera=1.2)
        verificar('abrir #s=5 abre a ficha desse sítio',
                  esperar(c, "document.getElementById('ficha').dataset.aberta==='1'"))
        verificar('e é mesmo o sítio 5',
                  c.js("document.getElementById('ficha-titulo').textContent")
                  == c.js('estado.spots[5].nome'))
        # e a colar numa página já aberta, que é como as ligações chegam mesmo
        c.js("location.hash='#s=11'")
        time.sleep(0.8)
        verificar('mudar o #s numa página já aberta troca de sítio',
                  c.js("document.getElementById('ficha-titulo').textContent")
                  == c.js('estado.spots[11].nome'),
                  c.js("document.getElementById('ficha-titulo').textContent"))

        print('\n— telemóvel —')
        c.cmd('Emulation.setDeviceMetricsOverride', width=390, height=844,
              deviceScaleFactor=2, mobile=True)
        c.abrir(base + '/', espera=1.0)
        esperar(c, "typeof estado!=='undefined' && estado.spots.length>0")
        verificar('não há barra de rolagem horizontal',
                  c.js('document.documentElement.scrollWidth <= window.innerWidth + 1'),
                  c.js("document.documentElement.scrollWidth+' > '+window.innerWidth"))
        verificar('o selector Lista/Mapa está visível',
                  c.js("""(()=>{const e=document.querySelector('.vistas');
                    const r=e.getBoundingClientRect();
                    return r.height>0 && r.bottom<=window.innerHeight+1;})()"""))
        verificar('a atribuição do mapa não fica tapada pelo selector',
                  c.js("""(()=>{const a=document.querySelector('.mapa__creditos').getBoundingClientRect();
                    const b=document.querySelector('.vistas').getBoundingClientRect();
                    return a.bottom <= b.top + 1 || a.right <= b.left + 1;})()"""))
        c.js("document.getElementById('v-mapa').click()")
        time.sleep(0.8)
        verificar('o botão «Mapa» muda de vista',
                  c.js("document.getElementById('app').dataset.vista==='mapa'"))
        verificar('e o mapa ocupa mesmo o ecrã (não ficou com 0 px)',
                  esperar(c, """(()=>{const c=document.querySelector('#mapa canvas');
                    return c && c.getBoundingClientRect().width>300;})()"""),
                  c.js("(()=>{const c=document.querySelector('#mapa canvas');"
                       "return c? c.getBoundingClientRect().width : 'sem canvas'})()"))
        verificar('a app não é mais alta que o ecrã',
                  c.js('document.body.scrollHeight <= window.innerHeight + 2'),
                  c.js("document.body.scrollHeight+' > '+window.innerHeight"))

        print('\n— carregar num pino tem de abrir AQUELE sítio —')
        # PORQUE ESTE TESTE EXISTE. Durante semanas, carregar num ponto do mapa
        # abria a ficha de outro sítio qualquer. Nenhum dos 66 testes anteriores
        # deu por isso: todos abriam a ficha pela LISTA. O caminho do mapa —
        # pino desenhado -> evento de rato -> sítio — nunca era percorrido.
        # Por isso este carrega mesmo no pino, com coordenadas do ecrã.
        alvo = c.js("""(()=>{
          const v = estado.vistos;
          // Um sítio cujo ID é DIFERENTE da sua posição na lista filtrada: se
          // alguém voltar a indexar por posição, este abre o sítio errado e o
          // nome na ficha denuncia-o.
          for (let k = v.length - 1; k >= 0; k--) {
            const errado = v[k].id < v.length ? v[v[k].id] : null;
            if (errado && errado.nome !== v[k].nome)
              return {i: v[k].id, nome: v[k].nome, lat: v[k].lat, lon: v[k].lon,
                      seria: errado.nome};
          }
          return null; })()""")
        verificar('há um sítio onde confundir id com posição se notaria',
                  bool(alvo), 'nenhum candidato — o teste não provaria nada')
        if alvo:
            c.js("document.getElementById('ficha-fechar').click()")
            c.js(f"Mapa.irPara({alvo['lat']}, {alvo['lon']}, 17)")
            verificar('o mapa chega ao sítio e desagrupa o pino',
                      esperar(c, "Mapa._zoom() >= 16.5"), c.js('Mapa._zoom()'))
            time.sleep(0.9)
            clicou = c.js("""(()=>{
              const p = Mapa._pixelDe(%f, %f);
              if (!p) return 'sem pixel';
              const cv = document.querySelector('#mapa canvas');
              const r = cv.getBoundingClientRect();
              const x = r.left + p[0], y = r.top + p[1];
              if (x < r.left || x > r.right || y < r.top || y > r.bottom)
                return 'fora do ecrã';
              for (const tipo of ['mousedown', 'mouseup', 'click'])
                cv.dispatchEvent(new MouseEvent(tipo, {clientX: x, clientY: y,
                  bubbles: true, cancelable: true, view: window, button: 0}));
              return 'ok';})()""" % (alvo['lat'], alvo['lon']))
            verificar('o pino recebe um clique de rato a sério', clicou == 'ok', str(clicou))
            verificar('e o clique abre uma ficha',
                      esperar(c, "document.getElementById('ficha').dataset.aberta==='1'", 6))
            aberto = c.js("document.getElementById('ficha-titulo').textContent")
            verificar('e é a ficha DAQUELE sítio, não a do vizinho',
                      aberto == alvo['nome'],
                      f"abriu «{aberto}», devia abrir «{alvo['nome']}» "
                      f"(a troca antiga dava «{alvo['seria']}»)")
            verificar('e o endereço passa a apontar para esse sítio',
                      c.js("location.hash") == '#s=' + str(alvo['i']),
                      c.js("location.hash"))
            c.js("document.getElementById('ficha-fechar').click()")

        print('\n— a mira: marcar um sítio que falta —')
        # O caminho todo, do botão ao endereço do formulário. Sem isto, a mira
        # podia abrir e mandar a pessoa para um assunto vazio, sem coordenada,
        # e ninguém dava por isso até alguém se queixar.
        verificar('a mira começa escondida',
                  c.js("document.getElementById('mira').hidden"))
        c.js("document.getElementById('falta').click()")
        time.sleep(0.6)
        verificar('o botão abre a mira',
                  c.js("!document.getElementById('mira').hidden"))
        verificar('a cruz fica mesmo no centro do mapa',
                  c.js("""(()=>{const m=document.querySelector('.mapa').getBoundingClientRect();
                    const x=document.querySelector('.mira__cruz').getBoundingClientRect();
                    return Math.abs((x.left+x.right)/2-(m.left+m.right)/2)<2
                        && Math.abs((x.top+x.bottom)/2-(m.top+m.bottom)/2)<2;})()"""))
        # Afastar primeiro: a secção anterior deixou o mapa em cima de um pino.
        c.js("document.getElementById('todo-pais').click()")
        esperar(c, 'Mapa._zoom() < 8')
        time.sleep(1.0)
        verificar('longe demais, o botão fica desligado',
                  c.js("document.getElementById('mira-abrir')"
                       ".getAttribute('aria-disabled')==='true'"),
                  f"zoom {c.js('Mapa._zoom()')}")
        c.js('Mapa.irPara(40.9, -8.5, 17)')
        esperar(c, 'Mapa._zoom() >= 16.5')
        time.sleep(1.4)
        verificar('perto, o botão liga-se',
                  c.js("document.getElementById('mira-abrir')"
                       ".getAttribute('aria-disabled')==='false'"),
                  f"zoom {c.js('Mapa._zoom()')}")
        verificar('a coordenada acompanha o mapa, com 5 casas',
                  c.js("/^40\\.90000, -8\\.50000$/"
                       ".test(document.getElementById('mira-coord').textContent)"),
                  c.js("document.getElementById('mira-coord').textContent"))
        alvo = c.js("document.getElementById('mira-abrir').href")
        verificar('a ligação leva a coordenada para o formulário do GitHub',
                  'issues/new' in alvo and 'template=novo-sitio.yml' in alvo
                  and 'coordenadas=40.90000' in alvo.replace('%2C', ',').replace('%20', ' '),
                  alvo[:150])
        c.js("document.getElementById('mira-cancelar').click()")
        time.sleep(0.4)
        verificar('cancelar fecha a mira',
                  c.js("document.getElementById('mira').hidden"))
        print('\n— o que se tirou fica tirado —')
        c.js("document.querySelector('.cartao').click()")
        time.sleep(0.4)
        verificar('não há ligação para o Mapillary em ficha nenhuma',
                  c.js("!document.querySelector('#ficha a[href*=\"mapillary\"]')"))
        verificar('nem o aviso óbvio de verificar as barras',
                  c.js("!/não é por nós mantido/.test(document.getElementById('ficha').textContent)"))
        # Nada de Panoramax: era um pedido a um terceiro que ia buscar fotos de
        # rua a api.panoramax.xyz. Verifica-se pela REDE, e não só pelo texto —
        # o pedido podia partir sem nunca chegar a pôr nada no ecrã.
        time.sleep(1.2)
        verificar('a ficha não vai buscar nada ao Panoramax',
                  c.js("!(performance.getEntriesByType('resource')"
                       ".some(e=>/panoramax/i.test(e.name)))"),
                  c.js("performance.getEntriesByType('resource')"
                       ".filter(e=>/panoramax/i.test(e.name)).map(e=>e.name).join(', ')"))
        # E, já agora, a lista COMPLETA de terceiros. A página de privacidade
        # nomeia dois domínios; se algum dia entrar um terceiro sem ninguém
        # dar por isso, a página passa a mentir. É este teste que a defende.
        # Só http(s): o MapLibre cria o seu operário a partir de um `blob:`,
        # e o `host` de um blob é a string vazia — que não é domínio nenhum
        # nem sai do aparelho.
        fora = c.js("""[...new Set(performance.getEntriesByType('resource')
          .map(e => new URL(e.name))
          .filter(u => /^https?:$/.test(u.protocol))
          .map(u => u.host)
          .filter(h => h !== location.host
            && !/(^|\.)openfreemap\.org$/.test(h)
            && !/(^|\.)dgterritorio\.gov\.pt$/.test(h)))]""")
        verificar('e a app só contacta os domínios que a privacidade nomeia',
                  fora == [], repr(fora))
        c.js("document.getElementById('ficha-fechar').click()")

        print('\n— sem WebGL: a lista tem de aguentar-se sozinha —')
        c.abrir('about:blank', espera=0.3)
        c.cmd('Emulation.setDeviceMetricsOverride', width=1440, height=900,
              deviceScaleFactor=1, mobile=False)
        c.cmd('Page.addScriptToEvaluateOnNewDocument', source="""
            const orig = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(t, ...r){
              if (String(t).indexOf('webgl') === 0) return null;
              return orig.call(this, t, ...r); };""")
        c.abrir(base + '/', espera=2.0)
        verificar('sem WebGL, os dados carregam na mesma',
                  esperar(c, "typeof estado!=='undefined' && estado.spots.length>0"))
        verificar('sem WebGL, a lista desenha-se na mesma',
                  c.js("document.querySelectorAll('.cartao').length>0"))
        verificar('sem WebGL, diz-se porquê em vez de ficar uma caixa cinzenta',
                  c.js("/WebGL|não conseguiu|não carregou/"
                       ".test(document.getElementById('mapa-carregar').textContent)"),
                  c.js("document.getElementById('mapa-carregar').textContent"))
        verificar('sem WebGL, o separador «Mapa» desaparece',
                  c.js("document.getElementById('v-mapa').hidden"))
        verificar('sem WebGL, a ficha continua a abrir',
                  c.js("""(()=>{document.querySelector('.cartao').click();
                    return document.getElementById('ficha').dataset.aberta==='1';})()"""))
    finally:
        c.fechar()

    print(f'\n{passou} passaram, {len(falhas)} falharam')
    if falhas:
        for f in falhas:
            print(f'  · {f}')
        sys.exit(1)
    print('tudo bem.')


if __name__ == '__main__':
    main()
