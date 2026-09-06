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
    base = f'http://localhost:{porta}'

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

        print('\n— o mapa —')
        verificar('o mapa monta as camadas',
                  esperar(c, "estado.mapaPronto && !!estado.mapa.getSource('spots')"))
        verificar('o mapa acaba de desenhar',
                  esperar(c, 'estado.mapa.loaded()', 40),
                  'nunca ficou idle')
        verificar('o canvas tem o tamanho do contentor',
                  c.js("""(()=>{const c=document.querySelector('#mapa canvas'),
                    d=document.getElementById('mapa');
                    if(!c||!d) return false;
                    const a=c.getBoundingClientRect(), b=d.getBoundingClientRect();
                    return Math.abs(a.width-b.width)<2 && Math.abs(a.height-b.height)<2;})()"""),
                  c.js("(()=>{const c=document.querySelector('#mapa canvas'),d=document.getElementById('mapa');"
                       "return c&&d? c.getBoundingClientRect().width+'x'+c.getBoundingClientRect().height"
                       "+' vs '+d.getBoundingClientRect().width+'x'+d.getBoundingClientRect().height : 'sem canvas'})()"))
        verificar('o mapa tem os 798 pontos',
                  c.js("estado.mapa.getSource('spots')._data.features.length")
                  == c.js('estado.vistos.length'))
        verificar('a app não transborda o ecrã',
                  c.js('document.documentElement.scrollWidth <= window.innerWidth + 1'),
                  c.js("document.documentElement.scrollWidth+' > '+window.innerWidth"))
        verificar('os sítios confirmados são os mais visíveis no mapa',
                  c.js('''(()=>{const p=estado.mapa.getPaintProperty('pontos','circle-color');
                    const j=JSON.stringify(p);
                    // o laranja da marca tem de estar no escalão 1, e não no 3
                    const i1=j.indexOf('1,"#E85D2A"')>=0 || /1,\s*"#E85D2A"/.test(j);
                    return i1;})()'''),
                  c.js("JSON.stringify(estado.mapa.getPaintProperty('pontos','circle-color'))"))
        verificar('e também maiores que os por confirmar',
                  c.js('''(()=>{const r=JSON.stringify(
                    estado.mapa.getPaintProperty('pontos','circle-radius'));
                    return /esc.*1.*8\.5/.test(r) || r.includes('8.5');})()'''))
        verificar('há um fornecedor de mosaicos de reserva declarado',
                  c.js("typeof ESTILO_RESERVA==='object' && !!ESTILO_RESERVA.light "
                       "&& ESTILO_RESERVA.light!==ESTILO.light"))
        verificar('os topónimos estão em português',
                  c.js("""(()=>{const ls=estado.mapa.getStyle().layers.filter(
                    l=>l.type==='symbol'&&l.layout&&l.layout['text-field']);
                    if(!ls.length) return false;
                    return ls.some(l=>JSON.stringify(l.layout['text-field']).includes('name:pt'));})()"""))

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
        verificar('procurar «lisboa» reduz a lista', 0 < nl < n, f'deu {nl}')
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
        verificar('o mapa acompanha a procura',
                  c.js("estado.mapa.getSource('spots')._data.features.length") == nl)

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
        verificar('limpar repõe a lista toda', c.js('estado.vistos.length') == n)

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
        verificar('desligar os filtros repõe tudo', c.js('estado.vistos.length') == n)

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
        verificar('a ficha diz de que fonte vem o sítio',
                  c.js("/OpenStreetMap|Câmara Municipal/.test("
                       "document.getElementById('ficha-corpo').textContent)"))
        verificar('a ficha avisa para verificar o equipamento',
                  c.js("/[Vv]erifica o estado/.test(document.getElementById('ficha-corpo').textContent)"))
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
                  c.js("/WebGL|não carregou/.test(document.getElementById('mapa-carregar').textContent)"))
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
