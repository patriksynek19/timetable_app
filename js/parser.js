/**
 * Parser uložených HTML stránek "Informace o předmětu" z katalogu IS MU.
 * Chování viz CLAUDE.md, sekce 3 (vstup dat a parsing) a 4 (datový model).
 *
 * Pracuje přímo s textem HTML, bez DOM. Řádky seminárních skupin nejsou
 * v katalogu samostatné elementy, ale text oddělený <BR>, takže textový
 * přístup je věcně přiléhavější a parser jde spustit i mimo prohlížeč.
 */

export const DAYS = ['Po', 'Út', 'St', 'Čt', 'Pá'];

// Všech pět skloňovaných tvarů parity podle rodu dne (CLAUDE.md 3.2 bod 3).
const PARITY_FORMS = new Map([
  ['každé liché pondělí', { parity: 'odd', day: 'Po' }],
  ['každé sudé pondělí', { parity: 'even', day: 'Po' }],
  ['každé liché úterý', { parity: 'odd', day: 'Út' }],
  ['každé sudé úterý', { parity: 'even', day: 'Út' }],
  ['každou lichou středu', { parity: 'odd', day: 'St' }],
  ['každou sudou středu', { parity: 'even', day: 'St' }],
  ['každý lichý čtvrtek', { parity: 'odd', day: 'Čt' }],
  ['každý sudý čtvrtek', { parity: 'even', day: 'Čt' }],
  ['každý lichý pátek', { parity: 'odd', day: 'Pá' }],
  ['každý sudý pátek', { parity: 'even', day: 'Pá' }],
]);

const HEADING = 'Rozvrh seminárních/paralelních skupin';
const UNSCHEDULED_TEXT = 'Rozvrh nebyl do ISu vložen';
const TIME_PART = '(\\d{1,2}:\\d{2})[–-](\\d{1,2}:\\d{2})';
const PARITY_TIME_RE = new RegExp(
  `(${[...PARITY_FORMS.keys()].join('|')}) ${TIME_PART}`
);
const WEEKLY_TIME_RE = new RegExp(`(Po|Út|St|Čt|Pá) ${TIME_PART}`);
const GROUP_ID_RE = /([A-Za-z0-9]+)\/(\d+):/;
const ROOM_RE = /<A[^>]*class="?okno"?[^>]*>([^<]*)<\/A>/i;
const TEACHER_RE = /,\s*<I>([^<]*)<\/I>/i;
const CANONICAL_RE =
  /<link\s+rel="canonical"\s+href="https:\/\/is\.muni\.cz\/(?:auth\/)?predmet\/([^"/]+)\/([^"/]+)\/([^"/]+)"/;
const TITLE_RE = /<title>([^<]*)<\/title>/i;
const LANGUAGE_RE = /Vyučovací jazyk<\/B><\/DT>\s*<DD>([^<]+)/i;
const TITLE_SUFFIX = ' - Informace o předmětu';

/** Rozloží řetězec období, například "podzim2026". Vrací null při neshodě. */
export function parsePeriod(raw) {
  const m = /^(podzim|jaro)(\d{4})$/.exec(raw);
  if (!m) return null;
  return { raw, term: m[1], year: Number(m[2]) };
}

/** Porovnatelná hodnota období: vyšší = pozdější. Jaro předchází podzimu. */
export function periodOrdinal(period) {
  return period.year * 2 + (period.term === 'podzim' ? 1 : 0);
}

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Zpracuje jeden textový řádek skupiny. Vrací:
 *  - { group }         pro platnou skupinu s rozvrhem,
 *  - { unscheduledId } pro skupinu bez rozvrhu (zahazuje se, CLAUDE.md 3.5),
 *  - null              pro řádek, který nejde přečíst (zapíše warning).
 */
function parseGroupLine(line, warnings) {
  const idMatch = GROUP_ID_RE.exec(line);
  if (!idMatch) return null;
  const id = `${idMatch[1]}/${idMatch[2]}`;

  if (line.includes(UNSCHEDULED_TEXT)) {
    return { unscheduledId: id };
  }

  const rest = line.slice(idMatch.index + idMatch[0].length);

  let parity;
  let day;
  let timeMatch;
  const parityMatch = PARITY_TIME_RE.exec(rest);
  if (parityMatch) {
    ({ parity, day } = PARITY_FORMS.get(parityMatch[1]));
    timeMatch = parityMatch.slice(2);
  } else {
    const weeklyMatch = WEEKLY_TIME_RE.exec(rest);
    if (!weeklyMatch) {
      warnings.push(
        `Skupině ${id} se nepodařilo přečíst den a čas, řádek se přeskakuje: ` +
          `"${stripTags(line)}"`
      );
      return null;
    }
    parity = 'weekly';
    [, day] = weeklyMatch;
    timeMatch = weeklyMatch.slice(2);
  }

  const allTimes = rest.match(/\d{1,2}:\d{2}[–-]\d{1,2}:\d{2}/g) ?? [];
  if (allTimes.length > 1) {
    warnings.push(
      `Skupina ${id} má na řádku více časů (${allTimes.join(', ')}), ` +
        `použit první. Zkontroluj prosím katalog.`
    );
  }

  const roomMatch = ROOM_RE.exec(rest);
  if (!roomMatch) {
    warnings.push(`Skupina ${id} nemá v katalogu uvedenou místnost.`);
  }
  const teacherMatch = TEACHER_RE.exec(rest);

  const [start, end] = timeMatch;
  return {
    group: {
      id,
      courseCode: idMatch[1],
      number: idMatch[2],
      day,
      dayIndex: DAYS.indexOf(day),
      parity,
      start,
      end,
      startMin: toMinutes(start),
      endMin: toMinutes(end),
      room: roomMatch ? roomMatch[1].trim() : null,
      teacher: teacherMatch ? teacherMatch[1].trim() : null,
    },
  };
}

/**
 * Najde blok skupin za nadpisem "Rozvrh seminárních/paralelních skupin"
 * a rozřeže ho na řádky. Blok končí dalším <DT> (další pole katalogu).
 */
function extractGroups(html, warnings) {
  const headingIdx = html.indexOf(HEADING);
  if (headingIdx === -1) {
    return { hasSeminars: false, groups: [], unscheduledIds: [] };
  }
  let end = html.indexOf('<DT>', headingIdx);
  if (end === -1) end = html.length;
  const block = html.slice(headingIdx + HEADING.length, end);

  const groups = [];
  const unscheduledIds = [];
  for (const segment of block.split(/<BR>|<\/DD>/i)) {
    if (!GROUP_ID_RE.test(segment)) continue;
    const parsed = parseGroupLine(segment, warnings);
    if (!parsed) continue;
    if (parsed.unscheduledId) {
      unscheduledIds.push(parsed.unscheduledId);
    } else {
      groups.push(parsed.group);
    }
  }
  return { hasSeminars: true, groups, unscheduledIds };
}

/**
 * Hlavní vstup parseru. Přijímá text uložené stránky, vrací
 * { ok, errors, warnings, course }. Při chybě je course null a předmět
 * se nemá zpracovat jako platný vstup (CLAUDE.md 3.3).
 */
export function parseCourseHtml(html) {
  const errors = [];
  const warnings = [];

  const canonical = CANONICAL_RE.exec(html);
  if (!canonical) {
    errors.push(
      'V souboru chybí odkaz <link rel="canonical"> na katalog IS MU. ' +
        'Je to opravdu uložená stránka "Informace o předmětu"?'
    );
    return { ok: false, errors, warnings, course: null };
  }
  const [, faculty, periodRaw, code] = canonical;
  const period = parsePeriod(periodRaw);
  if (!period) {
    errors.push(
      `Období "${periodRaw}" v odkazu na katalog nemá tvar podzim<rok> ` +
        'ani jaro<rok>.'
    );
    return { ok: false, errors, warnings, course: null };
  }

  let name = code;
  const titleMatch = TITLE_RE.exec(html);
  if (titleMatch) {
    const title = titleMatch[1];
    const suffixIdx = title.lastIndexOf(TITLE_SUFFIX);
    const withoutSuffix =
      suffixIdx === -1 ? title : title.slice(0, suffixIdx);
    const codePrefix = `${code} `;
    const colonIdx = withoutSuffix.indexOf(':');
    const afterFaculty =
      colonIdx === -1 ? withoutSuffix : withoutSuffix.slice(colonIdx + 1);
    if (afterFaculty.startsWith(codePrefix)) {
      name = afterFaculty.slice(codePrefix.length).trim();
    } else {
      warnings.push(
        `Titulek stránky ("${title}") neodpovídá kódu předmětu ${code} ` +
          'z odkazu na katalog.'
      );
    }
  } else {
    warnings.push('Stránka nemá titulek, jako název předmětu se použije kód.');
  }

  // Pole "Vyučovací jazyk" je přítomné jen u předmětů nevyučovaných česky;
  // chybějící pole znamená češtinu (CLAUDE.md 3.4).
  const languageMatch = LANGUAGE_RE.exec(html);
  const language = languageMatch ? languageMatch[1].trim() : 'Čeština';

  const { hasSeminars, groups, unscheduledIds } = extractGroups(
    html,
    warnings
  );

  return {
    ok: true,
    errors,
    warnings,
    course: {
      code,
      name,
      faculty,
      period,
      language,
      hasSeminars,
      groups,
      unscheduledIds,
      singleGroup: groups.length === 1,
    },
  };
}
