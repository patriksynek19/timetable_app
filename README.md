# Skladač rozvrhu z IS MU

Statická webová aplikace, která z uložených stránek předmětů v katalogu IS MU
sestaví optimální semestrální rozvrh výběrem seminárních skupin. Celá běží
v prohlížeči, nic se nikam neodesílá. Podrobná specifikace chování je
v [CLAUDE.md](CLAUDE.md).

## Jak aplikaci spustit

**Nejjednodušší cesta:** otevři soubor `dist/skladac-rozvrhu.html`
(poklepáním, v libovolném prohlížeči). Je to kompletní aplikace v jednom
souboru, funguje i bez internetu.

Pozor: vývojový `index.html` poklepáním **nefunguje** — prohlížeče blokují
JavaScriptové moduly otevřené přímo ze složky (`file://`). Vývojová verze
potřebuje lokální server:

```bash
python3 test/serve.py          # spustí server na http://localhost:8123
```

## Vývoj

- Zdrojáky: `js/` (parser, řešič, skórování, varianty, mřížka, UI),
  `css/`, `index.html`.
- Po změně `js/` nebo `css/` znovu sestav jednosouborovou verzi:
  `python3 tools/build.py` → `dist/skladac-rozvrhu.html`.
- Testy běží v prohlížeči: spusť server a otevři
  `http://localhost:8123/test/`. Sekce testů nad reálnými stránkami se
  přeskočí, pokud v kořeni projektu nejsou uložené stránky z IS MU a
  vygenerovaný `test/local-samples.json` (obojí zůstává jen lokálně,
  do repozitáře nepatří — viz CLAUDE.md sekce 12).

## Vstupní data

Ulož si z katalogu IS MU stránku „Informace o předmětu“ pro každý předmět
(File → Save Page As…, stačí samotné HTML) a nahraj je v aplikaci. Kapacitu
skupin a stav zápisu aplikace neřeší — zkontroluj před zápisem v IS.
