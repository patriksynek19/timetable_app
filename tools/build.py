#!/usr/bin/env python3
"""Sestaví jednosouborovou verzi aplikace: dist/skladac-rozvrhu.html.

Prohlížeče blokují ES moduly otevřené přímo ze složky (file://), takže
index.html poklepáním nefunguje. Tento skript zabalí všechny moduly do
jednoho klasického <script> a CSS do <style> — výsledný soubor funguje
otevřený odkudkoli, bez serveru a bez internetu.

Použití:  python3 tools/build.py
Spustit po každé změně js/ nebo css/, výsledek je v dist/.

Bundler je záměrně jednoduchý a spoléhá na kázeň ve zdrojácích:
jen pojmenované exporty tvaru `export function` / `export const` a importy
`import { ... } from './modul.js';` v rámci složky js/.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# V pořadí závislostí (žádný modul neimportuje z pozdějšího).
MODULES = [
    "js/parser.js",
    "js/scoring.js",
    "js/solver.js",
    "js/variants.js",
    "js/grid.js",
    "js/app.js",
]

IMPORT_RE = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'\./([^']+)';")
EXPORT_DECL_RE = re.compile(r"^export\s+(?:function|const)\s+([A-Za-z0-9_]+)", re.M)
EXPORT_KW_RE = re.compile(r"^export\s+", re.M)


def transform_module(path: Path) -> str:
    src = path.read_text(encoding="utf-8")
    leftovers = [
        m.group(0)
        for m in re.finditer(r"^\s*(import|export)\b.*", src, re.M)
        if not IMPORT_RE.search(m.group(0)) and not EXPORT_KW_RE.match(m.group(0).lstrip())
    ]
    src = IMPORT_RE.sub(lambda m: f"const {{{m.group(1)}}} = __m['{m.group(2)}'];", src)
    exports = EXPORT_DECL_RE.findall(src)
    src = EXPORT_KW_RE.sub("", src)
    if re.search(r"^\s*(import|export)\b", src, re.M):
        sys.exit(f"CHYBA: {path} obsahuje import/export, který bundler neumí: {leftovers}")
    ret = "return {" + ", ".join(exports) + "};"
    return f"__m['{path.name}'] = (() => {{\n'use strict';\n{src}\n{ret}\n}})();"


def main() -> None:
    bundle = "const __m = {};\n" + "\n".join(
        transform_module(ROOT / m) for m in MODULES
    )
    css = (ROOT / "css/style.css").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    # Náhrady jako funkce: obsah může obsahovat zpětná lomítka, která by
    # re.subn jinak vykládal jako escape sekvence šablony.
    html, n_css = re.subn(
        r'<link rel="stylesheet" href="css/style.css">',
        lambda _: f"<style>\n{css}</style>",
        html,
    )
    html, n_js = re.subn(
        r'<script type="module" src="js/app.js"></script>',
        lambda _: f"<script>\n{bundle}\n</script>",
        html,
    )
    if n_css != 1 or n_js != 1:
        sys.exit(f"CHYBA: šablona index.html nesedí (css {n_css}, js {n_js}).")

    out = ROOT / "dist/skladac-rozvrhu.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    print(f"OK: {out.relative_to(ROOT)} ({out.stat().st_size // 1024} kB)")


if __name__ == "__main__":
    main()
