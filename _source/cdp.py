# -*- coding: utf-8 -*-
"""
Cliente mínimo do Chrome DevTools Protocol — só biblioteca padrão.

Existe porque o pré-render precisa de correr o app.js a sério (e não de
reimplementar a renderização noutra linguagem, que iria divergir). Sem
dependências para poder correr tal e qual na GitHub Action.
"""
import base64
import json
import os
import zlib
import platform
import shutil
import signal
import socket
import struct
import subprocess
import time
import urllib.request


def encontrar_chrome():
    """Procura o Chrome no macOS, no Linux (GitHub Actions) e no PATH."""
    if os.environ.get('CHROME_PATH'):
        return os.environ['CHROME_PATH']
    candidatos = []
    if platform.system() == 'Darwin':
        candidatos.append('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    candidatos += ['google-chrome', 'google-chrome-stable', 'chromium',
                   'chromium-browser', 'chrome']
    for c in candidatos:
        if os.path.isabs(c) and os.path.exists(c):
            return c
        achado = shutil.which(c)
        if achado:
            return achado
    raise RuntimeError('Chrome não encontrado. Define CHROME_PATH.')


class WS:
    """O mínimo de RFC 6455 para falar com o Chrome: handshake + frames."""

    def __init__(self, url):
        assert url.startswith('ws://')
        hostporta, _, caminho = url[5:].partition('/')
        host, _, porta = hostporta.partition(':')
        self.sock = socket.create_connection((host, int(porta or 80)), timeout=90)
        chave = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((
            'GET /%s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n'
            'Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n'
            'Sec-WebSocket-Version: 13\r\n\r\n' % (caminho, hostporta, chave)).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.sock.recv(4096)
        if b' 101 ' not in buf.split(b'\r\n')[0]:
            raise RuntimeError('handshake falhou: %s' % buf[:200])
        self.resto = buf.split(b'\r\n\r\n', 1)[1]

    def _ler(self, n):
        while len(self.resto) < n:
            p = self.sock.recv(1 << 16)
            if not p:
                raise RuntimeError('ligação fechada')
            self.resto += p
        out, self.resto = self.resto[:n], self.resto[n:]
        return out

    def enviar(self, texto):
        d = texto.encode()
        cab = bytearray([0x81])
        n = len(d)
        if n < 126:
            cab.append(0x80 | n)
        elif n < 65536:
            cab.append(0x80 | 126); cab += struct.pack('>H', n)
        else:
            cab.append(0x80 | 127); cab += struct.pack('>Q', n)
        mask = os.urandom(4)
        cab += mask
        self.sock.sendall(bytes(cab) + bytes(b ^ mask[i % 4] for i, b in enumerate(d)))

    def receber(self):
        partes = []
        while True:
            b1, b2 = self._ler(2)
            fin, op = b1 & 0x80, b1 & 0x0F
            n = b2 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._ler(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._ler(8))[0]
            carga = self._ler(n)
            if op == 0x9:
                self.sock.sendall(b'\x8a\x80' + os.urandom(4)); continue
            if op == 0x8:
                raise RuntimeError('servidor fechou a ligação')
            partes.append(carga)
            if fin:
                return b''.join(partes).decode('utf-8', 'replace')

    def fechar(self):
        try:
            self.sock.close()
        except Exception:
            pass


def descodificar_png(dados):
    """Devolve (largura, altura, ler(x, y)) a partir dos bytes de um PNG.

    Existe porque medir contraste a sério obriga a olhar para os PÍXEIS. O
    medidor do verificar.py subia pelos antepassados do DOM à procura de
    `backgroundColor`, e por isso era cego a três coisas de uma vez: a camadas
    que não são antepassadas (a `.ceu` do Praiómetro é `position: fixed;
    z-index: -1`, portanto está POR TRÁS do texto sem nunca ser sua mãe), a
    gradientes e imagens (lia `backgroundColor`, que num `linear-gradient` vem
    transparente) e a qualquer coisa sobreposta. Media o texto do topo do site
    contra um fundo que ninguém tem à frente, e dava «FALHAS: 0» por cima de
    1,21:1 medidos no tema escuro.

    Sem Pillow: este projecto não tem dependências, e a Action que o corre não
    as vai ter por causa de um teste. São ~40 linhas de filtros PNG.
    """
    if dados[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('não é um PNG')
    pos, largura, altura, cor, prof, idat = 8, 0, 0, 0, 8, b''
    while pos < len(dados):
        n = struct.unpack('>I', dados[pos:pos + 4])[0]
        tipo = dados[pos + 4:pos + 8]
        corpo = dados[pos + 8:pos + 8 + n]
        if tipo == b'IHDR':
            largura, altura, prof, cor = struct.unpack('>IIBB', corpo[:10])
        elif tipo == b'IDAT':
            idat += corpo
        elif tipo == b'IEND':
            break
        pos += 12 + n
    if prof != 8 or cor not in (2, 6):
        raise ValueError('PNG inesperado: profundidade %d, cor %d' % (prof, cor))
    canais = 4 if cor == 6 else 3
    cru = zlib.decompress(idat)
    passo = largura * canais
    linhas, i, anterior = [], 0, bytearray(passo)
    for _ in range(altura):
        filtro = cru[i]; i += 1
        linha = bytearray(cru[i:i + passo]); i += passo
        if filtro:
            for j in range(passo):
                a_ = linha[j - canais] if j >= canais else 0
                b_ = anterior[j]
                c_ = anterior[j - canais] if j >= canais else 0
                if filtro == 1:
                    linha[j] = (linha[j] + a_) & 255
                elif filtro == 2:
                    linha[j] = (linha[j] + b_) & 255
                elif filtro == 3:
                    linha[j] = (linha[j] + (a_ + b_) // 2) & 255
                elif filtro == 4:
                    pp = a_ + b_ - c_
                    pa, pb, pc = abs(pp - a_), abs(pp - b_), abs(pp - c_)
                    linha[j] = (linha[j] + (a_ if pa <= pb and pa <= pc
                                            else (b_ if pb <= pc else c_))) & 255
        linhas.append(bytes(linha))
        anterior = linha

    def ler(x, y):
        if 0 <= x < largura and 0 <= y < altura:
            o = x * canais
            L = linhas[y]
            return (L[o], L[o + 1], L[o + 2])
        return None

    return largura, altura, ler


_PORTAS_DADAS = set()


def porta_livre():
    """Uma porta que este processo ainda não usou.

    O `bind(0)` sozinho não chega: o SO reutiliza portas recém-libertadas, e
    dois Chromes seguidos apanhavam a mesma. O segundo ligava-se ao
    `/json/list` da porta certa mas ao ALVO do primeiro, que estava a morrer —
    a ligação abria, e depois nada respondia. O que se via era `Page.navigate`
    a esgotar os 90s do socket, sempre no segundo Chrome de uma secção, e
    sempre num runner (aqui o primeiro morre depressa de mais para chocarem).
    """
    for _ in range(50):
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        n = s.getsockname()[1]
        s.close()
        if n not in _PORTAS_DADAS:
            _PORTAS_DADAS.add(n)
            return n
    raise RuntimeError('sem portas livres')


class Chrome:
    def __init__(self, porta=None, perfil=None, locale='pt-PT', webgl=False):
        if porta is None:
            porta = porta_livre()
        _PORTAS_DADAS.add(porta)
        self.porta = porta
        # Pasta ÚNICA e não `cdp-<porta>`: com a porta a repetir-se, dois
        # Chromes partilhavam perfil e o segundo apanhava-o a ser apagado.
        self.perfil = perfil or ('/tmp/cdp-%d-%s' % (porta, os.urandom(4).hex()))
        shutil.rmtree(self.perfil, ignore_errors=True)
        self.proc = subprocess.Popen(
            [encontrar_chrome(), '--headless=new', '--no-sandbox',
             '--no-first-run', '--mute-audio', '--hide-scrollbars',
             '--disable-dev-shm-usage', '--lang=' + locale,
             # O RESOLVEDOR DE NOMES DO SISTEMA, e não o assíncrono do Chrome.
             # No runner do GitHub o Node alcançava a api.open-meteo.com sem
             # falhar uma vez e o Chrome dizia «Failed to fetch» a cada duas —
             # mesma máquina, mesma rede, mesmo instante. A diferença é que o
             # Chrome resolve nomes por sua conta, e num runner sem rota IPv6
             # isso dá-lhe falhas que o resolvedor do sistema não tem.
             '--disable-features=AsyncDns',
             # E nada de adivinhar ligações que ninguém pediu: o preconnect já
             # tinha prendido o servidor de testes uma vez.
             '--dns-prefetch-disable']
            # WEBGL. O `--disable-gpu` não «usa a CPU em vez da GPU»: desliga o
            # WebGL de vez — `GL_VENDOR = Disabled` — e o MapLibre atira
            # «Failed to initialize WebGL» no construtor. Para capturar o mapa é
            # preciso o SwiftShader, o rasterizador por software do ANGLE. Desde
            # o Chrome 128 é preciso pedi-lo explicitamente com
            # --enable-unsafe-swiftshader, senão fica desligado na mesma.
            + (['--use-gl=angle', '--use-angle=swiftshader',
                '--enable-unsafe-swiftshader']
               if webgl else ['--disable-gpu'])
            + ['--remote-debugging-port=%d' % porta,
             '--user-data-dir=' + self.perfil, 'about:blank'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            # SESSÃO PRÓPRIA, para se poder matar o GRUPO. Um Chrome não é um
            # processo, são vários — o lançador, o zygote, a GPU e um renderer
            # por separador — e o `terminate()` só apanhava o primeiro. Numa
            # máquina com memória a rodos ninguém dá por isso; num runner do
            # GitHub, ao fim de vinte Chromes abertos e fechados, os filhos que
            # ficaram comem a RAM toda e o seguinte fica pendurado sem
            # responder ao DevTools. Foi o que se viu: `Page.navigate` a
            # esgotar 90 s de socket na secção 6, depois de cinco secções boas.
            start_new_session=True)
        alvo = None
        for _ in range(120):
            time.sleep(0.25)
            try:
                lista = json.loads(urllib.request.urlopen(
                    'http://127.0.0.1:%d/json/list' % porta, timeout=3).read())
                alvo = next((t for t in lista if t.get('type') == 'page'), None)
                if alvo:
                    break
            except Exception:
                continue
        if not alvo:
            self.fechar()
            raise RuntimeError('o Chrome não abriu a porta de depuração')
        self.ws = WS(alvo['webSocketDebuggerUrl'])
        self.id = 0
        # E CONFIRMA-SE QUE O ALVO RESPONDE, antes de alguém contar com ele.
        # Uma ligação aberta não prova nada: era exactamente esse o sintoma —
        # o handshake passava e o primeiro comando a sério ficava 90s à espera.
        # Vale mais falhar aqui, com nome, do que a meio de uma secção.
        antigo = self.ws.sock.gettimeout()
        try:
            self.ws.sock.settimeout(20)
            self.cmd('Runtime.evaluate', expression='1+1', returnByValue=True)
        except Exception as e:
            self.fechar()
            raise RuntimeError('o Chrome abriu mas não responde (porta %d): %s'
                               % (porta, e))
        finally:
            try:
                self.ws.sock.settimeout(antigo)
            except Exception:
                pass

    def cmd(self, metodo, **params):
        self.id += 1
        self.ws.enviar(json.dumps({'id': self.id, 'method': metodo, 'params': params}))
        while True:
            msg = json.loads(self.ws.receber())
            if msg.get('id') == self.id:
                if 'error' in msg:
                    raise RuntimeError('%s: %s' % (metodo, msg['error']))
                return msg.get('result', {})

    def js(self, expressao):
        """Avalia JS e DEVOLVE O VALOR — ou estoira com o erro do JavaScript.

        Devolvia `None` em silêncio quando a expressão atirava: o `result` vem
        sem `value` e o `exceptionDetails` era deitado fora. Quem chamava fazia
        `json.loads(c.js(...))` e recebia «the JSON object must be str, bytes
        or bytearray, not NoneType» — uma mensagem que não diz nem o ficheiro
        do erro nem a linha do JS. Perde-se meia hora por cada uma.
        """
        r = self.cmd('Runtime.evaluate', expression=expressao,
                     awaitPromise=True, returnByValue=True)
        ex = r.get('exceptionDetails')
        if ex:
            desc = ((ex.get('exception') or {}).get('description')
                    or ex.get('text') or 'erro desconhecido')
            raise RuntimeError('o JavaScript atirou: %s\n  na expressão: %s'
                               % (desc.split('\n')[0], expressao.strip()[:160]))
        return r.get('result', {}).get('value')

    def abrir(self, url, espera=2.0):
        self.cmd('Page.enable')
        self.cmd('Page.navigate', url=url)
        time.sleep(espera)

    def fechar(self):
        """Fecha o Chrome INTEIRO — o grupo, e não só o processo que lançámos."""
        try:
            self.ws.fechar()
        except Exception:
            pass
        for sinal, espera in ((signal.SIGTERM, 8), (signal.SIGKILL, 4)):
            if self.proc.poll() is not None:
                break
            try:
                os.killpg(os.getpgid(self.proc.pid), sinal)
            except Exception:
                try:
                    self.proc.terminate() if sinal == signal.SIGTERM else self.proc.kill()
                except Exception:
                    pass
            try:
                self.proc.wait(timeout=espera)
            except Exception:
                pass
        shutil.rmtree(self.perfil, ignore_errors=True)
