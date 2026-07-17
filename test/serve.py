"""Lokální statický server pro vývoj a testy, bez cache.

Spouští se z kořene projektu: python3 test/serve.py [port]
Cache-Control: no-store zajistí, že prohlížeč po každé změně souboru
načte čerstvou verzi modulů (jinak drží staré verze v paměťové cache).
"""

import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
    print(f"Servíruji na http://localhost:{port} (bez cache)")
    ThreadingHTTPServer(("127.0.0.1", port), NoCacheHandler).serve_forever()
