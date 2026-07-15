# Skladač rozvrhu z IS MU

Specifikace chování aplikace, která z popisů předmětů v katalogu IS MU sestaví
optimální semestrální rozvrh výběrem seminárních skupin.

## Jak číst tento dokument

Rozlišují se tři druhy tvrzení:

- **[POŽADAVEK]**: rozhodnutí zadavatele, závazné.
- **[PARAMETR]**: konfigurovatelná hodnota, výchozí návrh se doladí na reálných datech.
- **[NÁVRH]**: implementační doporučení, které se může při stavbě upravit.

Pokud si implementace není jistá, ptá se, nedomýšlí.

---

## 1. Účel a rozsah

Uživatel má finálně vybrané předměty a řeší jen jejich časové rozvržení. Aplikace
vybírá **seminární skupiny** tak, aby splnila tvrdá omezení a co nejlépe naplnila
měkké preference, a nabídne několik obodovaných variant k výběru.

[POŽADAVEK] Aplikace skládá pouze seminární skupiny. Přednášky nejsou předmětem
skládání.

[POŽADAVEK] Každý nahraný předmět, který má semináře, přispěje do rozvrhu právě
jednou vybranou seminární skupinou.

### Cílová podoba (rozhodnuto)

[NÁVRH, potvrzeno] Statická webová aplikace (HTML a JavaScript, bez serveru),
publikovatelná zdarma přes GitHub Pages. Uživatel nic neinstaluje, aplikace nesahá
na jeho účet v IS. Data dodává uživatel ručně nahranými stránkami katalogu.

---

## 2. Slovník pojmů

- **Blok**: standardní dvouhodinový výukový blok začínající v celou hodinu
  (například 10:00 az 11:40, 12:00 az 13:40, 14:00 az 15:40).
- **Parita týdne**: lichý týden versus sudý týden. V IS MU vyjádřeno slovy
  "každé liché <den>" a "každé sudé <den>". Skupina bez tohoto určení je
  **týdenní** (každý týden).
- **Řada**: počet sousedních obsazených bloků v jednom dni bez volného bloku mezi
  nimi.
- **Okno**: přeskočený (volný) blok mezi dvěma obsazenými bloky téhož dne. Krátká
  přestávka uvnitř bloku (například 11:40 az 12:00) není okno.

---

## 3. Vstup dat a parsing

### 3.1 Zdroj

[POŽADAVEK] Vstupem jsou uložené HTML stránky předmětu z katalogu IS MU (stránka
"Informace o předmětu"). Uživatel nahraje jeden soubor na předmět.

[PARAMETR, budoucí rozšíření] Automatické stahování veřejných stránek katalogu
skriptem. Ověřit dostupnost bez přihlášení a pravidla IS MU pro automatizaci před
implementací. Pro první verzi se neřeší.

### 3.2 Ověřená struktura (na dvou vzorcích)

Následující bylo ověřeno na dvou reálných souborech (jeden česky vyučovaný předmet,
jeden anglicky vyučovaný). Parser má být robustní a otestovaný na dalších vzorcích,
protože dva soubory nemusí pokrýt všechny varianty formátu.

Blok rozvrhu skupin je uvozen českým nadpisem:

    Rozvrh seminárních/paralelních skupin

Popisky struktury katalogu zůstávají české i u anglicky vyučovaných předmětů.
Anglicky je jen volný text (anotace, předpoklady). Parser se proto opírá o české
strukturní popisky bez ohledu na jazyk výuky.

Každá skupina je jeden řádek tohoto tvaru (příklady z ověřených dat):

    MP509Zk/01: Po 28. 9. az Pá 18. 12. každé liché pondělí 10:00–11:40 <room>, <učitel>
    MVV1368K/01: Po 28. 9. az Pá 18. 12. Út 8:00–9:40 <room>, <učitel>

Z řádku se extrahuje:

1. **Kód předmětu a číslo skupiny** (například `MP509Zk/01`).
2. **Rozsah dat semestru** (informativní, viz kontrola semestru).
3. **Parita a den**: přítomnost tvaru "každé liché/sudé <den>" značí čtrnáctidenní
   skupinu dané parity. [POŽADAVEK, ověřeno na datech] Tvar se skloňuje podle rodu
   dne, parser musí rozpoznat všech pět variant: "každé liché/sudé pondělí",
   "každé liché/sudé úterý", "každou lichou/sudou středu", "každý lichý/sudý
   čtvrtek", "každý lichý/sudý pátek". Jinak jde o týdenní skupinu a den je určen
   zkratkou (Po, Út, St, Čt, Pá).
4. **Čas od a do** ve tvaru HH:MM–HH:MM.
5. **Místnost**: text v odkazu s třídou `okno` (`<A class="okno">`).
6. **Vyučující**: text v kurzívě (`<I>`) za čárkou. Toto je vyučující rozhodný pro
   preference, tedy vyučující uvedený u konkrétní skupiny, nikoli v obecném výčtu
   garantů předmětu.

[POŽADAVEK, ověřeno na datech] Vyučující nemusí být u skupiny uveden vůbec (řádek
skončí místností bez části ", <I>...</I>"). Parser to nemá řešit jako chybu. Skupina
bez vyučujícího se preferencí z 6.1 nedotkne (ani kladně, ani záporně) — správnost
a úplnost katalogových dat je odpovědnost uživatele.

### 3.3 Kontrola semestru

[POŽADAVEK] Aplikace ověří, že všechny nahrané předměty patří do nadcházejícího
semestru. Období lze spolehlivě přečíst z odkazu na stránce:

    <link rel="canonical" href="https://is.muni.cz/auth/predmet/law/podzim2026/KOD" />

Období je ve tvaru `podzim<rok>` nebo `jaro<rok>`.

[POŽADAVEK] Pokud uživatel nahraje stránku ze staršího období, aplikace zobrazí
chybovou hlášku a předmět nezpracuje jako platný vstup.

[NÁVRH] Pokud se nahrané předměty navzájem liší obdobím, aplikace na neshodu
upozorní.

### 3.4 Jazyk

[POŽADAVEK] Aplikace zvládá české i anglicky vyučované předměty. Jazyk výuky lze
odečíst z pole "Vyučovací jazyk" (hodnoty jako "Čeština", "Angličtina"). Parsing se
neopírá o jazyk volného textu, jen o české strukturní popisky.

[POŽADAVEK, ověřeno na datech] Pole "Vyučovací jazyk" je v HTML přítomné jen tehdy,
když výuka není v češtině; u českých předmětů pole v katalogu chybí úplně. Chybějící
pole se interpretuje jako čeština. Jazyk je informativní údaj — jeho případné chybné
určení nesmí nikdy zabránit sestavení rozvrhu.

### 3.5 Ignorované jevy

[POŽADAVEK] Aplikace ignoruje kapacitu a stav zápisu skupin. Je to odpovědnost
uživatele.

[POŽADAVEK] Předmět bez vypsaného rozvrhu aplikace neřeší zvláštní hláškou. Nemá
u něj co umístit, výběr takového předmětu je na uživateli.

[POŽADAVEK, ověřeno na datech] Jednotlivá seminární skupina bez vypsaného rozvrhu
(v HTML text "Rozvrh nebyl do ISu vložen.", bez dne, času i místnosti) se při
parsování zahodí a do datového modelu se vůbec nezařadí. Jde typicky o poslední
skupiny v seznamu, vyhrazené pro studenty s ISP. Počet skutečných skupin předmětu
pro účely varianty A (5.1, bezalternativní jediná skupina) se počítá až po tomto
odfiltrování.

---

## 4. Datový model

**Předmět**: kód, název, jazyk výuky, období, seznam seminárních skupin, příznak
"má jedinou skupinu".

**Seminární skupina**: kód a číslo (například `MP509Zk/03`), den v týdnu, čas od,
čas do, místnost, vyučující, typ opakování (týdenní, lichý týden, sudý týden).

**Uživatelské nastavení**: viz sekce 5 a 6.

---

## 5. Tvrdá omezení

Rozvrh, který poruší kterékoli tvrdé omezení, je neplatný.

1. [POŽADAVEK] **Právě jeden seminář na předmět** (u předmětů, které semináře mají).

2. [POŽADAVEK] **Kolize s respektováním parity.** Dvě vybrané skupiny se nesmí
   časově překrývat. Skupiny opačné parity (jedna lichý týden, druhá sudý týden) se
   ve stejný den a čas **neberou jako kolize**, protože reálně neprobíhají současně.
   Týdenní skupina koliduje s čímkoli ve stejném dni a čase bez ohledu na paritu.

3. [POŽADAVEK] **Blokované časy jsou neobsaditelné.** Vznikají dvěma způsoby:
   ručním zadáním uživatele, nebo z volitelného vyhrazení času přednášky (sekce 7).

4. [POŽADAVEK] **Limit počtu dnů zvlášť pro každou paritu.** Nejvýše N dnů v lichém
   týdnu a zároveň nejvýše N dnů v sudém týdnu. Díky rozlišení parity smí student
   během čtrnácti dnů navštívit více různých dnů, pokud v žádném jednotlivém týdnu
   nepřekročí N (příklad: v lichém týdnu pondělí a úterý, v sudém úterý a středa, při
   limitu N rovno 2).

5. [POŽADAVEK] **Ukotvené skupiny.** Skupina ručně ukotvená uživatelem (sekce 7) je
   ve výsledku pevně a nemění se; aplikace dopočítá zbytek rozvrhu okolo ní.
   [POŽADAVEK] Padne-li ukotvená skupina do blokovaného času, ukotvení blokaci
   přebije a aplikace na to upozorní — stejně jako u varianty A (5.1), protože ruční
   ukotvení je silnější projev vůle uživatele než blokace. Limit počtu dnů (bod 4)
   tím ukotvení nepřebíjí: pokud ukotvená skupina tlačí rozvrh přes limit dnů, jde
   o případ výjimky z limitu (5.2), o které rozhoduje výhradně uživatel.

### 5.1 Předmět s jediným seminářem (varianta A)

[POŽADAVEK] Předmět, který má v katalogu jedinou seminární skupinu, je bezalternativní.
Tato skupina je vždy ukotvena. Pokud padne do času, který si uživatel vyhradil jako
blokovaný, **povinný seminář přebije blokaci** a aplikace na to upozorní.

[POŽADAVEK] Varianta A platí jen pro předmět se skutečně jedinou skupinou. Předmět
s více skupinami, u něhož všechny náhodou kolidují s blokacemi nebo jinými
povinnostmi, spadá pod "řešení neexistuje", nikoli pod variantu A.

### 5.2 Výjimka z limitu dnů

[POŽADAVEK] Uživatel může u konkrétního předmětu ručně udělit výjimku z limitu dnů.
O výjimce rozhoduje výhradně uživatel, aplikace ji neuděluje automaticky (ani u
předmětů s jediným seminářem).

[NÁVRH, budoucí rozšíření] Když pevně daná skupina (ukotvená nebo jediná) tlačí
rozvrh přes limit dnů, takže by rozvrh jinak nešel sestavit nebo by výrazně ztrácel
na skóre, aplikace může uživateli nabídnout hlášku, zda pro daný předmět výjimku
z limitu neudělit. Rozhodnutí zůstává na uživateli.

### 5.3 Jiná fakulta

[PARAMETR, budoucí rozšíření] Rezerva na přesun mezi budovami různých fakult se
neřeší. V rámci téže fakulty se žádná rezerva mezi bloky nevyžaduje. Pro předmět
z jiné fakulty aplikace pouze upozorní. Uživatel to řeší ručně (výjimka z počtu dnů,
blokace času, nebo separátní rozvrh).

### 5.4 Neexistence řešení

[POŽADAVEK] Pokud nelze sestavit žádný platný rozvrh, aplikace zobrazí prostou hlášku
o neplatnosti.

[PARAMETR, budoucí rozšíření] Vysvětlení, které konkrétní omezení řešení blokuje.

---

## 6. Měkké preference a skórování

Aplikace používá **vážené skóre**: každá preference přispívá body, které se sčítají.
Vyšší skóre znamená atraktivnější rozvrh.

### 6.1 Váhové úrovně (kaskáda priorit)

Seřazeno od nejvyšší váhy:

1. [POŽADAVEK] **Nechtěný vyučující (nejvyšší váha).** Uživatel může u předmětu zadat
   vyučujícího, kterého nechce. Toto **není tvrdý zákaz**. Aplikace se nechtěnému
   vyučujícímu rázně vyhne, pokud existuje skupina s jiným vyučujícím. Jsou-li úplně
   všechny skupiny předmětu vedeny nechtěným vyučujícím, aplikace jej přesto zařadí
   s velkou ztrátou bodů, místo aby prohlásila rozvrh za neřešitelný.

2. [POŽADAVEK] **Chtěný vyučující (vysoká váha).** Uživatel může u předmětu zadat
   jednoho nebo více vyučujících, které preferuje nebo kteří mu nevadí.

3. [POŽADAVEK] **Co nejméně dnů ve škole (vysoká váha).** Preference méně dnů i pod
   stanovený limit.

4. [POŽADAVEK] **Minimalizace oken, preferované časy, kompaktnost dne (nižší váha).**

Preference jsou nepovinné. Uživatel může u předmětu zadat kladnou preferenci,
zápornou, obě, nebo žádnou. Prázdná preference nesmí bránit funkci.

### 6.2 Tvarová pravidla dne

[POŽADAVEK] Každý den se hodnotí zvlášť, dílčí postihy se sčítají přes celý týden.
Jeden nabitý den tak nezkazí skóre dnů s dobrým tvarem.

**Postih za dlouhou řadu (škálovaný):**

- Řada dvou nebo tří seminářů: bez postihu.
- Řada čtyř: mírný postih (dá se zkousnout).
- Řada pěti a více: velký postih (extrém), postih dále roste s délkou.

[POŽADAVEK] Postih za řadu čtyř je nastaven **větší než cena jednoho okna**, aby při
čtyřech seminářích za den vyhrálo rozdělení dva plus dva s pauzou nad čtyřmi v řadě.
Při třech seminářích naopak vyhrají tři v řadě bez pauzy (nula postihu) nad dva plus
jedna (jedno okno).

**Postih za okna (škálovaný, přísnější):**

- První okno: levné, ale ne úplně zdarma.
- Druhé okno: výrazně dražší.
- Tři a více oken: velký postih, roste přísně (plýtvání časem).

[PARAMETR] **Úleva pro dlouhý den.** Když se obsazené bloky roztáhnou přes prakticky
celý den (řádově 6 bloků od rána do večera, například 8:00 az 20:00), druhé okno se
netrestá nebo se trestá jen jako první. Přesná hranice délky dne je parametr,
doladí se na reálných datech. Škálování řeší "kolikáté okno", délka dne řeší "kdy je
druhé okno omluvitelné". Potřeba je obojí, samotné škálování dlouhý den nerozliší.

### 6.3 Odvozené chování (nevyžaduje zvláštní pravidlo)

Závislost "kolik seminářů za den je ideální" vyplývá sama z pravidel v 6.2 a nemá se
kódovat jako další pravidlo. Také varianta, kdy se čtrnáctidenní semináře seskupí tak,
že se jeden den dané parity celý uvolní, není vynucována, ale objeví se přirozeně mezi
obodovanými výsledky a uživatel si ji porovná s ostatními.

---

## 7. Ruční ovládání a volby uživatele

- [POŽADAVEK] **Výběr předmětů**: uživatel nahraje předměty, které chce absolvovat.
- [POŽADAVEK] **Preferovaní a nechtění vyučující** u jednotlivých předmětů (viz 6.1).
- [POŽADAVEK] **Blokované časy**: ruční zadání neobsaditelných bloků.
- [POŽADAVEK] **Limit dnů** a **ruční výjimky** z limitu u konkrétních předmětů.
- [POŽADAVEK] **Ukotvení skupiny**: uživatel může určit konkrétní skupinu napevno,
  aplikace dopočítá zbytek okolo ní.
- [POŽADAVEK] **Vyhrazení času přednášky (volitelné, ve výchozím stavu vypnuté).**
  Zapíná se u každého předmětu zvlášť. Když je zapnuté, časy přednášek daného předmětu
  se stanou blokovanými. U nepravidelných přednášek (různý den nebo čas každý týden)
  aplikace upozorní, že si tím uživatel značně omezí možnosti, ale pokud to uživatel
  zapne, všechny takové časy se přesto zablokují. Platí i pro předměty, které mají
  jen přednášky.

---

## 8. Výstup

### 8.1 Sada variant

[POŽADAVEK] Aplikace vrací 5 variant. Výchozí skladba:

- 3 varianty s nejvyšším celkovým skóre,
- 1 varianta optimalizovaná na vyučující,
- 1 nejkompaktnější varianta.

Varianty jsou seřazené podle skóre.

[PARAMETR, budoucí rozšíření] Volba, aby si uživatel nechal generovat cíleně podle
osy kompaktnější, volnější, nebo vyučující.

### 8.2 Zobrazení rozvrhu

[POŽADAVEK] Jednoduchá mřížka jako tradiční školní rozvrh: svisle dny, vodorovně
hodiny. Střídmá barevnost.

[NÁVRH] Lichý a sudý týden odděleny vizuálně ve stejné mřížce: každý den má dva
navazující řádky (lichý, sudý). Čtrnáctidenní seminář se ukáže jen v příslušném
řádku, týdenní seminář v obou (vizuálně spojený). Pokud se to na reálných datech
ukáže jako nepřehledné, použije se místo toho přepínač lichý versus sudý.

[POŽADAVEK] V mřížce má být u každého bloku dostatečně znázorněna konkrétní seminární
skupina (aby šel výsledek použít k zápisu i k exportu).

### 8.3 Hodnocení varianty

[POŽADAVEK] U každé varianty se zobrazí celková známka a přehled, jak si vedla
v jednotlivých kritériích (vyučující, počet dnů, okna, tvar dne a podobně). Podrobné
slovní zdůvodnění není potřeba.

### 8.4 Export

[POŽADAVEK] Uložení vybraného rozvrhu, ideálně PDF, přijatelný i obrázek. Preferovaně
na ležato (landscape), jiná orientace je snesitelná.

---

## 9. Okrajové případy (shrnutí)

- Jediný povinný seminář v blokovaném čase: varianta A, seminář přebije blokaci
  s upozorněním (5.1).
- Více skupin, všechny kolidují: řešení neexistuje, prostá hláška (5.4).
- Nechtěný vyučující ve všech skupinách předmětu: zařadí se s velkou ztrátou bodů,
  nikoli neřešitelné (6.1).
- Předmět bez rozvrhu nebo přeplněná skupina: aplikace neřeší, odpovědnost uživatele
  (3.5).
- Nahraný předmět ze starého období: chybová hláška (3.3).

---

## 10. Doporučené milníky implementace

1. Parser uloženého HTML z IS MU do datového modelu (sekce 3 a 4), otestovaný na
   dodaných vzorcích i na dalších uložených stránkách.
2. Tvrdá omezení a generátor přípustných kombinací (sekce 5), včetně parity.
3. Skórování a výběr variant (sekce 6 a 8.1).
4. Uživatelské rozhraní: nahrání souborů, nastavení preferencí, ukotvení, blokace,
   vyhrazení přednášek (sekce 7).
5. Zobrazení mřížky a hodnocení (8.2, 8.3) a export (8.4).
6. Publikace na GitHub Pages.
7. Volitelná rozšíření: automatické stahování, cílené generování variant, jiná
   fakulta, vysvětlení neřešitelnosti.

---

## 11. Parametry k doladění na reálných datech

- Konkrétní bodové váhy jednotlivých preferencí (6.1).
- Škálování postihů za řadu a za okna (6.2).
- Hranice "dlouhého dne" pro úlevu druhého okna (6.2).
- Počet a skladba nabízených variant, pokud by 5 nevyhovovalo (8.1).

[NÁVRH, domluveno] Postup ladění vah: vygeneruje se několik různých rozvrhů
z reálných dat, zadavatel je komplexně ohodnotí (které jsou lepší a proč) a
z tohoto hodnocení se zpětně odvodí úpravy vah. Provede se po dokončení UI.

---

## 12. Technická a publikační doporučení

- [NÁVRH] Řešič jako prohledávání s omezeními (constraint satisfaction). Při běžném
  počtu předmětů za semestr postačí přímý backtracking, u složitějších omezení lze
  zvážit knihovnu typu OR-Tools.
- [POŽADAVEK] Do veřejného repozitáře nedávat stažená data katalogu ani žádné
  přihlašovací údaje. Jen kód, případně malý anonymizovaný testovací vzorek.
- [NÁVRH] Publikace přes GitHub Pages přímo z repozitáře, aplikace běží čistě
  v prohlížeči.
- [NÁVRH] Prohlížeč nemůže sám stahovat stránky z is.muni.cz kvůli bezpečnostní
  politice (CORS), proto je vstupem ruční nahrání souborů. Případná automatizace by
  byla samostatný skript, ne součást frontendu.
