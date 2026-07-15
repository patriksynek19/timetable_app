/**
 * Měkké preference a skórování rozvrhů (CLAUDE.md sekce 6).
 *
 * Vyšší skóre = atraktivnější rozvrh; postihy jsou záporné příspěvky.
 * Konkrétní hodnoty jsou [PARAMETR] k doladění na reálných datech (sekce 11) —
 * proto jsou všechny pohromadě v DEFAULT_PARAMS a každá funkce je přijímá
 * jako argument.
 */

export const DEFAULT_PARAMS = {
  // 6.1 kaskáda priorit (od nejvyšší váhy)
  unwantedTeacherPenalty: -1000, // nejvyšší váha, ale ne tvrdý zákaz
  wantedTeacherBonus: 300, // vysoká váha
  dayPenalty: -150, // vysoká váha: každý obsazený den, zvlášť v každé paritě
  preferredTimeBonus: 20, // nižší váha
  // 6.2 tvarová pravidla dne. Řada 2–3 bloků je zdarma; postih za řadu 4 musí
  // zůstat větší než cena prvního okna, aby 2+2 s pauzou porazilo 4 v řadě
  // a zároveň 3 v řadě porazily 2+1 s oknem.
  runPenalties: { 4: -60, 5: -250 }, // delší řady: -250 + krok za blok navíc
  runPenaltyStep: -200,
  windowPenalties: [-40, -120, -300], // 1., 2., 3. okno
  windowPenaltyStep: -200, // každé okno nad tabulku (roste přísně)
  longDayBlocks: 6, // [PARAMETR] od kolika bloků rozpětí je den „dlouhý"
  // mřížka výukových bloků (CLAUDE.md sekce 2: dvouhodinové bloky od 8:00)
  dayStartMin: 480,
  blockMinutes: 120,
};

const normName = (s) => s.trim().toLowerCase();

/** Indexy výukových bloků, které skupina zabírá (0 = blok od 8:00). */
export function groupBlocks(group, params = DEFAULT_PARAMS) {
  const first = Math.floor(
    (group.startMin - params.dayStartMin) / params.blockMinutes
  );
  const last = Math.floor(
    (group.endMin - 1 - params.dayStartMin) / params.blockMinutes
  );
  const blocks = [];
  for (let k = first; k <= last; k++) blocks.push(k);
  return blocks;
}

/**
 * Tvar jednoho dne (CLAUDE.md 6.2) z indexů obsazených bloků.
 * Vrací { penalty, windows, longestRun }.
 *
 * Okno = každý přeskočený volný blok mezi obsazenými bloky téhož dne;
 * mezera dvou volných bloků jsou tedy dvě okna. Úleva pro dlouhý den:
 * při rozpětí >= longDayBlocks se druhé okno trestá jen jako první.
 */
export function dayShape(blockIndices, params = DEFAULT_PARAMS) {
  const blocks = [...new Set(blockIndices)].sort((a, b) => a - b);
  if (blocks.length === 0) return { penalty: 0, windows: 0, longestRun: 0 };
  let penalty = 0;

  // Řady: 2–3 zdarma, 4 mírný postih, 5+ velký a rostoucí s délkou.
  let longestRun = 0;
  let runLength = 1;
  for (let i = 1; i <= blocks.length; i++) {
    if (i < blocks.length && blocks[i] === blocks[i - 1] + 1) {
      runLength++;
      continue;
    }
    longestRun = Math.max(longestRun, runLength);
    if (runLength === 4) penalty += params.runPenalties[4];
    else if (runLength >= 5) {
      penalty += params.runPenalties[5] + (runLength - 5) * params.runPenaltyStep;
    }
    runLength = 1;
  }

  const span = blocks[blocks.length - 1] - blocks[0] + 1;
  const longDay = span >= params.longDayBlocks;
  let windows = 0;
  for (let i = 1; i < blocks.length; i++) {
    for (let skipped = blocks[i] - blocks[i - 1] - 1; skipped > 0; skipped--) {
      windows++;
      const effective = longDay && windows === 2 ? 1 : windows;
      const table = params.windowPenalties;
      penalty +=
        effective <= table.length
          ? table[effective - 1]
          : table[table.length - 1] +
            (effective - table.length) * params.windowPenaltyStep;
    }
  }
  return { penalty, windows, longestRun };
}

/** Jen postih tvaru dne — pohodlnější tvar pro testy a ladění. */
export function dayShapePenalty(blockIndices, params = DEFAULT_PARAMS) {
  return dayShape(blockIndices, params).penalty;
}

/**
 * Aditivní (na rozvrhu nezávislý) příspěvek jedné skupiny: vyučující (6.1
 * body 1 a 2) a preferované časy. Skupina bez vyučujícího se preferencí
 * nedotkne (CLAUDE.md 3.2). Vrací { teacher, preferred, total }.
 *
 * prefs: {
 *   teachers: { kódPředmětu: { wanted: [jména], unwanted: [jména] } },
 *   preferredTimes: [{ day?, startMin, endMin }],
 * }
 */
export function groupAdditiveScore(group, prefs = {}, params = DEFAULT_PARAMS) {
  let teacher = 0;
  const tp = prefs.teachers?.[group.courseCode];
  if (group.teacher && tp) {
    const t = normName(group.teacher);
    if (tp.unwanted?.some((x) => normName(x) === t)) {
      teacher += params.unwantedTeacherPenalty;
    }
    if (tp.wanted?.some((x) => normName(x) === t)) {
      teacher += params.wantedTeacherBonus;
    }
  }
  let preferred = 0;
  for (const p of prefs.preferredTimes ?? []) {
    if (
      (p.day == null || p.day === group.day) &&
      group.startMin >= p.startMin &&
      group.endMin <= p.endMin
    ) {
      preferred = params.preferredTimeBonus;
      break;
    }
  }
  return { teacher, preferred, total: teacher + preferred };
}

/**
 * Skóre celého rozvrhu. Každý den každé parity se hodnotí zvlášť a dílčí
 * postihy se sčítají (6.2); týdenní skupina se počítá v obou týdnech.
 *
 * Vrací { total, breakdown: { teachers, preferredTimes, days, shape },
 * details: { daysOdd, daysEven, windows, longestRun } } — podklad pro
 * přehled hodnocení varianty (8.3).
 */
export function scoreSchedule(schedule, prefs = {}, params = DEFAULT_PARAMS) {
  let teachers = 0;
  let preferredTimes = 0;
  for (const g of schedule) {
    const a = groupAdditiveScore(g, prefs, params);
    teachers += a.teacher;
    preferredTimes += a.preferred;
  }

  let shape = 0;
  let windows = 0;
  let longestRun = 0;
  const daysByWeek = { odd: 0, even: 0 };
  for (const week of ['odd', 'even']) {
    const byDay = new Map();
    for (const g of schedule) {
      if (g.parity !== 'weekly' && g.parity !== week) continue;
      if (!byDay.has(g.day)) byDay.set(g.day, []);
      byDay.get(g.day).push(...groupBlocks(g, params));
    }
    daysByWeek[week] = byDay.size;
    for (const blocks of byDay.values()) {
      const s = dayShape(blocks, params);
      shape += s.penalty;
      windows += s.windows;
      longestRun = Math.max(longestRun, s.longestRun);
    }
  }
  const days = params.dayPenalty * (daysByWeek.odd + daysByWeek.even);

  return {
    total: teachers + preferredTimes + days + shape,
    breakdown: { teachers, preferredTimes, days, shape },
    details: {
      daysOdd: daysByWeek.odd,
      daysEven: daysByWeek.even,
      windows,
      longestRun,
    },
  };
}
