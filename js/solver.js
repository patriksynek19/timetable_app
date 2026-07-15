/**
 * Tvrdá omezení a generátor přípustných kombinací (CLAUDE.md sekce 5).
 *
 * Řešič je přímý backtracking (CLAUDE.md 12): předměty seřazené od nejmenšího
 * počtu skupin, průběžné ořezávání podle kolizí a limitu dnů. Vrací přípustné
 * rozvrhy do zadaného stropu počtu řešení; výběr a bodování variant je věcí
 * milníku 3 (sekce 6 a 8.1).
 */

/**
 * Kolize dvou událostí s respektováním parity (CLAUDE.md 5 bod 2):
 * stejný den, časový překryv a slučitelná parita. Skupiny opačné parity
 * kolize nejsou, týdenní koliduje s čímkoli.
 */
export function groupsConflict(a, b) {
  if (a.day !== b.day) return false;
  if (a.endMin <= b.startMin || b.endMin <= a.startMin) return false;
  return a.parity === 'weekly' || b.parity === 'weekly' || a.parity === b.parity;
}

/**
 * Blokovaný čas: { day, startMin, endMin, parity? }, bez parity platí
 * pro oba týdny (chová se jako týdenní událost).
 */
export function conflictsWithBlocked(group, blockedTimes) {
  return blockedTimes.some((b) => groupsConflict(group, { parity: 'weekly', ...b }));
}

/**
 * Počet obsazených dnů v týdnu dané parity ('odd' | 'even').
 * Den, na kterém sedí předmět s ruční výjimkou z limitu (5.2), se do limitu
 * nepočítá celý — i další předmět umístěný na tentýž den je pak „zdarma",
 * protože ve škole ten den stejně jsi. Výjimka ale neospravedlní jiný, nový
 * den. (Jemnost „radši plný den než rozprostřít" řeší až skóre, sekce 6.)
 */
export function countDays(groups, parityKey, exemptCourseCodes = new Set()) {
  const matchesParity = (g) => g.parity === 'weekly' || g.parity === parityKey;
  const excusedDays = new Set();
  for (const g of groups) {
    if (exemptCourseCodes.has(g.courseCode) && matchesParity(g)) {
      excusedDays.add(g.day);
    }
  }
  const days = new Set();
  for (const g of groups) {
    if (matchesParity(g) && !excusedDays.has(g.day)) days.add(g.day);
  }
  return days.size;
}

/**
 * Hlavní vstup řešiče.
 *
 * courses: pole předmětů z parseru (js/parser.js).
 * settings: {
 *   blockedTimes:       [{ day, startMin, endMin, parity? }],
 *   dayLimit:           číslo N, nebo null = bez limitu (CLAUDE.md 5 bod 4),
 *   dayLimitExceptions: [kódy předmětů s ruční výjimkou] (5.2),
 *   anchoredGroups:     { kódPředmětu: idSkupiny } ruční ukotvení (5 bod 5),
 * }
 * options: { maxSolutions } strop počtu vrácených řešení.
 *
 * Vrací { status: 'ok'|'infeasible'|'error', errors, warnings, schedules,
 * truncated }. Rozvrh je pole vybraných skupin, právě jedna na předmět.
 */
export function solve(courses, settings = {}, options = {}) {
  const {
    blockedTimes = [],
    dayLimit = null,
    dayLimitExceptions = [],
    anchoredGroups = {},
  } = settings;
  const maxSolutions = options.maxSolutions ?? 5000;

  const errors = [];
  const warnings = [];
  const exemptCodes = new Set(dayLimitExceptions);

  // Sestavení domén: jen předměty, které mají co umístit (CLAUDE.md 3.5).
  const domains = [];
  const seenCodes = new Set();
  for (const course of courses) {
    if (seenCodes.has(course.code)) {
      errors.push(`Předmět ${course.code} je nahraný vícekrát.`);
      continue;
    }
    seenCodes.add(course.code);
    if (!course.hasSeminars || course.groups.length === 0) continue;

    let groups = course.groups;
    const anchorId = anchoredGroups[course.code];
    if (anchorId != null) {
      groups = groups.filter((g) => g.id === anchorId);
      if (groups.length === 0) {
        errors.push(
          `Ukotvená skupina ${anchorId} u předmětu ${course.code} neexistuje.`
        );
        continue;
      }
    }
    domains.push({ course, groups, anchored: anchorId != null });
  }
  for (const code of Object.keys(anchoredGroups)) {
    if (!seenCodes.has(code)) {
      warnings.push(`Ukotvení se odkazuje na nenahraný předmět ${code}.`);
    }
  }
  if (errors.length > 0) {
    return { status: 'error', errors, warnings, schedules: [], truncated: false };
  }

  // Blokované časy. Pevně daná skupina — varianta A (jediná skupina, 5.1) nebo
  // ruční ukotvení (5 bod 5) — je silnější projev vůle než blokace, takže ji
  // přebije s upozorněním; aplikace dopočítá zbytek okolo ní. Limit dnů tím
  // přebit není (to řeší výjimka 5.2). Ostatní skupiny musí blokace respektovat.
  for (const d of domains) {
    if (d.course.singleGroup || d.anchored) {
      const g = d.groups[0];
      if (conflictsWithBlocked(g, blockedTimes)) {
        const kind = d.course.singleGroup
          ? 'jediná skupina předmětu'
          : 'ručně ukotvená skupina';
        warnings.push(
          `Skupina ${g.id} (${kind}) padá do blokovaného času; blokace se ` +
            'u ní neuplatní (pevné ukotvení přebíjí blokaci).'
        );
      }
      continue;
    }
    d.groups = d.groups.filter((g) => !conflictsWithBlocked(g, blockedTimes));
    if (d.groups.length === 0) {
      // Více skupin, všechny v blokovaných časech: řešení neexistuje (5.1, 5.4).
      return { status: 'infeasible', errors, warnings, schedules: [], truncated: false };
    }
  }

  // Pořadí předmětů. Předměty s výjimkou z limitu dnů jdou první: jejich den
  // může „uvolnit" den ostatním (5.2), takže dokud nejsou všechny umístěné,
  // nelze na limit dnů bezpečně ořezávat. Uvnitř skupin řadíme podle velikosti
  // domény, aby ukotvené a bezalternativní skupiny (varianta A) ořezaly co
  // nejvíc.
  domains.sort((a, b) => {
    const ea = exemptCodes.has(a.course.code) ? 0 : 1;
    const eb = exemptCodes.has(b.course.code) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return a.groups.length - b.groups.length;
  });
  const exemptCount = domains.filter((d) => exemptCodes.has(d.course.code)).length;

  const withinDayLimit = (chosen, candidate) => {
    if (dayLimit == null) return true;
    for (const parityKey of ['odd', 'even']) {
      if (countDays([...chosen, candidate], parityKey, exemptCodes) > dayLimit) {
        return false;
      }
    }
    return true;
  };

  const schedules = [];
  const chosen = [];
  let truncated = false;

  const backtrack = (i) => {
    if (schedules.length >= maxSolutions) {
      truncated = true;
      return;
    }
    if (i === domains.length) {
      // Ořez během hledání platnost limitu zaručuje; tahle kontrola je jen
      // pojistka na kompletním rozvrhu, protože logika výjimek je netriviální.
      if (dayLimit != null) {
        for (const parityKey of ['odd', 'even']) {
          if (countDays(chosen, parityKey, exemptCodes) > dayLimit) return;
        }
      }
      schedules.push(chosen.slice());
      return;
    }
    for (const g of domains[i].groups) {
      if (chosen.some((c) => groupsConflict(c, g))) continue;
      // Ořez na limit dnů je korektní až po umístění všech předmětů s výjimkou:
      // teprve pak jsou „uvolněné" dny konečné a počet dnů už jen roste.
      if (i >= exemptCount && !withinDayLimit(chosen, g)) continue;
      chosen.push(g);
      backtrack(i + 1);
      chosen.pop();
      if (truncated) return;
    }
  };
  backtrack(0);

  return {
    status: schedules.length > 0 ? 'ok' : 'infeasible',
    errors,
    warnings,
    schedules,
    truncated,
  };
}
