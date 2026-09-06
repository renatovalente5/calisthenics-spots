# -*- coding: utf-8 -*-
"""Servidor local que serve o site NO MESMO CAMINHO que o GitHub Pages.

   Correr:  python3 _source/servidor.py [porta]

   PORQUE NÃO CHEGA UM `python3 -m http.server`. Sem domínio próprio, o GitHub
   Pages serve este site em `/calisthenics-spots/`, e é com esse prefixo que a
   construção escreve todos os caminhos. Um servidor que sirva a pasta na raiz
   dá 404 em tudo — ou, pior, dá 200 num sítio onde a produção dará 404, e o
   erro só aparece depois de publicado.

   Serve nos DOIS caminhos: com o prefixo (que é o que a produção faz) e sem
   ele (que é o que acontece quando o domínio existir). Assim a bateria de
   testes corre igual antes e depois de se comprar o domínio.
"""
import http.server, os, socketserver, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREFIXO = '/calisthenics-spots'


class Pedido(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=RAIZ, **k)

    def translate_path(self, path):
        if path == PREFIXO:
            path = PREFIXO + '/'
        if path.startswith(PREFIXO + '/'):
            path = path[len(PREFIXO):]
        return super().translate_path(path)

    def send_error(self, code, message=None, explain=None):
        # A página 404 do site, como no GitHub Pages — e não a do Python.
        if code == 404:
            p = os.path.join(RAIZ, '404.html')
            if os.path.exists(p):
                corpo = open(p, 'rb').read()
                self.send_response(404)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(corpo)))
                self.end_headers()
                if self.command != 'HEAD':
                    self.wfile.write(corpo)
                return
        super().send_error(code, message, explain)

    def log_message(self, *a):
        pass


class Servidor(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 4600
    with Servidor(('', porta), Pedido) as s:
        print(f'http://localhost:{porta}{PREFIXO}/   (e também na raiz)')
        s.serve_forever()
