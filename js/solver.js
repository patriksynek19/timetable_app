/**
 * Tvrdá omezení a generátor přípustných kombinací (CLAUDE.md sekce 5).
 *
 * Řešič je přímý backtracking (CLAUDE.md 12): předměty seřazené od nejmenšího
 * počtu skupin, průběžné ořezávání podle kolizí a limitu dnů. Vrací přípustné
 * rozvrhy do zadaného stropu počtu řešení; bodované hledání nejlepších variant
 * staví na stejných doménách v js/variants.js.
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
 * Limity dnů z nastavení. Výchozí je jeden společný limit (settings.dayLimit)
 * platný zvlášť pro lichý i sudý týden (CLAUDE.md 5 bod 4); volitelně lze
 * zadat odlišné limity přes settings.dayLimits = { odd, even }, kde null
 * znamená bez limitu pro daný týden.
 */
export function dayLimitsOf(settings = {}) {
  const { dayLimit = null, dayLimits = null } = settings;
  if (dayLimits) {
    return { odd: dayLimits.odd ?? null, even: dayLimits.even ?? null };
  }
  return { odd: dayLimit, even: dayLimit };
}

/**
 * Společná příprava domén pro solve i findVariants (js/variants.js):
 * deduplikace předmětů, ukotvení, varianta A a blokované časy.
 *
 * Vrací { errors, warnings, domains, exemptCodes, infeasible }, kde doména je
 * { course, groups, anchored }.
 */
export function prepareDomains(courses, settings = {}) {
  const {
    blockedTimes = [],
    dayLimitExceptions = [],
    anchoredGroups = {},
  } = settings;

  const errors = [];
  const warnings = [];
  const exemptCodes = new Set(dayLimitExceptions);

  // Jen předměty, které mají co umístit (CLAUDE.md 3.5).
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
    return { errors, warnings, domains: [], exemptCodes, infeasible: false };
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
      return { errors, warnings, domains: [], exemptCodes, infeasible: true };
    }
  }

  return { errors, warnings, domains, exemptCodes, infeasible: false };
}

/**
 * Pořadí předmětů pro prohledávání. Předměty s výjimkou z limitu dnů jdou
 * první: jejich den může „uvolnit" den ostatním (5.2), takže dokud nejsou
 * všechny umístěné, nelze na limit dnů bezpečně ořezávat. Uvnitř skupin se
 * řadí podle velikosti domény, aby ukotvené a bezalternativní skupiny
 * (varianta A) ořezaly co nejvíc.
 */
export function orderDomains(domains, exemptCodes) {
  const sorted = [...domains].sort((a, b) => {
    const ea = exemptCodes.has(a.course.code) ? 0 : 1;
    const eb = exemptCodes.has(b.course.code) ? 0 : 1;
    if (ea !== eb) return ea - eb;
    return a.groups.length - b.groups.length;
  });
  const exemptCount = sorted.filter((d) =>
    exemptCodes.has(d.course.code)
  ).length;
  return { sorted, exemptCount };
}

/**
 * Hlavní vstup řešiče.
 *
 * courses: pole předmětů z parseru (js/parser.js).
 * settings: {
 *   blockedTimes:       [{ day, startMin, endMin, parity? }],
 *   dayLimit:           číslo N, nebo null = bez limitu (CLAUDE.md 5 bod 4),
 *   dayLimits:          volitelně { odd, even } — odlišné limity pro lichý
 *                       a sudý týden, má přednost před dayLimit,
 *   dayLimitExceptions: [kódy předmětů s ruční výjimkou] (5.2),
 *   anchoredGroups:     { kódPředmětu: idSkupiny } ruční ukotvení (5 bod 5),
 * }
 * options: { maxSolutions } strop počtu vrácených řešení.
 *
 * Vrací { status: 'ok'|'infeasible'|'error', errors, warnings, schedules,
 * truncated }. Rozvrh je pole vybraných skupin, právě jedna na předmět.
 */
export function solve(courses, settings = {}, options = {}) {
  const limits = dayLimitsOf(settings);
  const hasLimit = limits.odd != null || limits.even != null;
  const maxSolutions = options.maxSolutions ?? 5000;

  const prep = prepareDomains(courses, settings);
  if (prep.errors.length > 0) {
    return {
      status: 'error',
      errors: prep.errors,
      warnings: prep.warnings,
      schedules: [],
      truncated: false,
    };
  }
  if (prep.infeasible) {
    return {
      status: 'infeasible',
      errors: [],
      warnings: prep.warnings,
      schedules: [],
      truncated: false,
    };
  }
  const { exemptCodes } = prep;
  const { sorted: domains, exemptCount } = orderDomains(prep.domains, exemptCodes);

  const withinDayLimit = (chosen, candidate) => {
    if (!hasLimit) return true;
    for (const parityKey of ['odd', 'even']) {
      const limit = limits[parityKey];
      if (limit == null) continue;
      if (countDays([...chosen, candidate], parityKey, exemptCodes) > limit) {
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
      if (hasLimit) {
        for (const parityKey of ['odd', 'even']) {
          const limit = limits[parityKey];
          if (limit == null) continue;
          if (countDays(chosen, parityKey, exemptCodes) > limit) return;
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
    errors: [],
    warnings: prep.warnings,
    schedules,
    truncated,
  };
}
