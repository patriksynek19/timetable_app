/** Testy skórování (CLAUDE.md sekce 6) a výběru variant (8.1). */
import { test, assert, assertEqual } from './harness.js';
import {
  DEFAULT_PARAMS,
  dayShapePenalty,
  groupBlocks,
  scoreSchedule,
} from '../js/scoring.js';
import { findVariants } from '../js/variants.js';
import { mkGroup, mkCourse, assertValidSchedule } from './solver.tests.js';

/** Skupina zabírající výukový blok k (0 = 8:00) daného dne a parity. */
function blockGroup(courseCode, number, day, parity, k, teacher = null) {
  const h = 8 + 2 * k;
  const g = mkGroup(courseCode, number, day, parity, `${h}:00`, `${h + 1}:40`);
  return { ...g, teacher };
}

// ---------- tvar dne (6.2) ----------
test('SCORE: řada 2–3 bloků bez postihu', () => {
  assertEqual(dayShapePenalty([0, 1]), 0, 'řada 2');
  assertEqual(dayShapePenalty([0, 1, 2]), 0, 'řada 3');
  assertEqual(dayShapePenalty([2]), 0, 'jediný blok');
});
test('SCORE: řada 4 mírně, 5+ velký a rostoucí postih', () => {
  const run4 = dayShapePenalty([0, 1, 2, 3]);
  const run5 = dayShapePenalty([0, 1, 2, 3, 4]);
  const run6 = dayShapePenalty([0, 1, 2, 3, 4, 5]);
  assert(run4 < 0, 'řada 4 má postih');
  assert(run5 < run4, 'řada 5 horší než 4');
  assert(run6 < run5, 'řada 6 horší než 5');
});
test('SCORE: 2+2 s pauzou poráží 4 v řadě (požadavek 6.2)', () => {
  const split = dayShapePenalty([0, 1, 3, 4]); // jedno okno
  const run4 = dayShapePenalty([0, 1, 2, 3]);
  assert(split > run4, `2+2 (${split}) má být lepší než řada 4 (${run4})`);
});
test('SCORE: 3 v řadě poráží 2+1 s oknem (požadavek 6.2)', () => {
  const run3 = dayShapePenalty([0, 1, 2]); // nula
  const split = dayShapePenalty([0, 1, 3]); // jedno okno
  assert(run3 > split, `3 v řadě (${run3}) má být lepší než 2+1 (${split})`);
});
test('SCORE: okna zdražují: první levné, druhé výrazně dražší, třetí přísně', () => {
  const w1 = dayShapePenalty([0, 2]);
  const w2 = dayShapePenalty([0, 2, 4]);
  const w3Params = { ...DEFAULT_PARAMS, longDayBlocks: 99 }; // vypnout úlevu
  const w2NoRelief = dayShapePenalty([0, 2, 4], w3Params);
  const w3 = dayShapePenalty([0, 2, 4, 6], w3Params);
  assert(w1 < 0, 'první okno není zdarma');
  assert(w2NoRelief < 2 * w1, 'druhé okno dražší než první');
  assert(w3 - w2NoRelief < w2NoRelief - w1, 'třetí okno dražší než druhé');
  assertEqual(w2, w2NoRelief, 'rozpětí 5 bloků není dlouhý den');
});
test('SCORE: mezera dvou volných bloků jsou dvě okna', () => {
  assertEqual(
    dayShapePenalty([0, 3], { ...DEFAULT_PARAMS, longDayBlocks: 99 }),
    DEFAULT_PARAMS.windowPenalties[0] + DEFAULT_PARAMS.windowPenalties[1],
    'dva přeskočené bloky'
  );
});
test('SCORE: úleva pro dlouhý den — druhé okno jako první (parametr)', () => {
  // Rozpětí 6 bloků (8:00 až 19:40) se dvěma okny.
  const relieved = dayShapePenalty([0, 2, 4, 5]);
  const strict = dayShapePenalty([0, 2, 4, 5], {
    ...DEFAULT_PARAMS,
    longDayBlocks: 99,
  });
  assertEqual(
    relieved,
    2 * DEFAULT_PARAMS.windowPenalties[0],
    'obě okna za cenu prvního'
  );
  assertEqual(
    strict,
    DEFAULT_PARAMS.windowPenalties[0] + DEFAULT_PARAMS.windowPenalties[1],
    'bez úlevy druhé okno plné'
  );
});
test('SCORE: groupBlocks mapuje časy na bloky', () => {
  assertEqual(groupBlocks(mkGroup('A', '01', 'Po', 'weekly', '8:00', '9:40')), [0], '8:00');
  assertEqual(groupBlocks(mkGroup('A', '01', 'Po', 'weekly', '18:00', '19:40')), [5], '18:00');
  assertEqual(
    groupBlocks(mkGroup('A', '01', 'Po', 'weekly', '9:00', '10:40')),
    [0, 1],
    'nestandardní čas přes dva bloky'
  );
});

// ---------- dny a parita ve skóre ----------
test('SCORE: týdenní skupina platí den v obou paritách, čtrnáctidenní v jedné', () => {
  const weekly = scoreSchedule([blockGroup('A', '01', 'Po', 'weekly', 1)]);
  const oddOnly = scoreSchedule([blockGroup('A', '01', 'Po', 'odd', 1)]);
  assertEqual(weekly.breakdown.days, 2 * DEFAULT_PARAMS.dayPenalty, 'týdenní 2×');
  assertEqual(oddOnly.breakdown.days, DEFAULT_PARAMS.dayPenalty, 'lichá 1×');
  assertEqual(weekly.details.daysOdd, 1, 'lichý týden');
  assertEqual(weekly.details.daysEven, 1, 'sudý týden');
});
test('SCORE: dny se hodnotí zvlášť — nabitý den nezkazí den s dobrým tvarem', () => {
  // Po: řada 5 (postih), Út: řada 2 (nula). Součet = postih jen za Po.
  const monday = [0, 1, 2, 3, 4].map((k) => blockGroup(`A${k}`, '01', 'Po', 'weekly', k));
  const tuesday = [0, 1].map((k) => blockGroup(`B${k}`, '01', 'Út', 'weekly', k));
  const s = scoreSchedule([...monday, ...tuesday]);
  assertEqual(s.breakdown.shape, 2 * DEFAULT_PARAMS.runPenalties[5], 'postih za Po v obou paritách');
});

// ---------- vyučující (6.1) ----------
test('SCORE: nechtěný vyučující = velká ztráta, chtěný = bonus, bez vyučujícího nic', () => {
  const prefs = { teachers: { A: { wanted: ['J. Novák'], unwanted: ['P. Zlý'] } } };
  const wanted = scoreSchedule([blockGroup('A', '01', 'Po', 'weekly', 1, 'J. Novák')], prefs);
  const unwanted = scoreSchedule([blockGroup('A', '02', 'Po', 'weekly', 1, 'P. Zlý')], prefs);
  const noTeacher = scoreSchedule([blockGroup('A', '03', 'Po', 'weekly', 1, null)], prefs);
  assertEqual(wanted.breakdown.teachers, DEFAULT_PARAMS.wantedTeacherBonus, 'bonus');
  assertEqual(unwanted.breakdown.teachers, DEFAULT_PARAMS.unwantedTeacherPenalty, 'postih');
  assertEqual(noTeacher.breakdown.teachers, 0, 'bez vyučujícího se nedotkne');
});

// ---------- findVariants (8.1) ----------
test('SCORE: findVariants preferuje chtěného a vyhne se nechtěnému vyučujícímu', () => {
  const courses = [
    mkCourse('A', [
      { ...mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'), teacher: 'P. Zlý' },
      { ...mkGroup('A', '02', 'Út', 'weekly', '10:00', '11:40'), teacher: 'J. Novák' },
    ]),
  ];
  const prefs = { teachers: { A: { wanted: ['J. Novák'], unwanted: ['P. Zlý'] } } };
  const r = findVariants(courses, {}, prefs);
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.variants[0].schedule[0].teacher, 'J. Novák', 'nejlepší varianta');
  assert(r.variants[0].score.total > r.variants[1].score.total, 'seřazeno sestupně');
});
test('SCORE: všechny skupiny nechtěné => zařadí se se ztrátou, ne neřešitelné (6.1)', () => {
  const courses = [
    mkCourse('A', [
      { ...mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'), teacher: 'P. Zlý' },
    ]),
  ];
  const prefs = { teachers: { A: { unwanted: ['P. Zlý'] } } };
  const r = findVariants(courses, {}, prefs);
  assertEqual(r.status, 'ok', 'není infeasible');
  assert(
    r.variants[0].score.total <= DEFAULT_PARAMS.unwantedTeacherPenalty,
    'velká ztráta bodů'
  );
});
test('SCORE: skládání ke stávajícím blokům poráží nový den i okno', () => {
  // Pevné: Po bloky 0,1. Volba předmětu C: Po blok 2 (řada 3),
  // Po blok 4 (dvě okna), nebo Út blok 0 (nový den).
  const courses = [
    mkCourse('A', [blockGroup('A', '01', 'Po', 'weekly', 0)]),
    mkCourse('B', [blockGroup('B', '01', 'Po', 'weekly', 1)]),
    mkCourse('C', [
      blockGroup('C', '01', 'Po', 'weekly', 4),
      blockGroup('C', '02', 'Út', 'weekly', 0),
      blockGroup('C', '03', 'Po', 'weekly', 2),
    ]),
  ];
  const r = findVariants(courses);
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.variants[0].schedule.find((g) => g.courseCode === 'C').id, 'C/03', 'řada 3 vítězí');
  assertEqual(r.variants.length, 3, 'tři možné kombinace = tři varianty');
});
test('SCORE: vrací nejvýše 5 navzájem různých variant se štítky', () => {
  const mk = (code, day) =>
    mkCourse(code, [
      mkGroup(code, '01', day, 'odd', '10:00', '11:40'),
      mkGroup(code, '02', day, 'even', '10:00', '11:40'),
    ]);
  // 3 předměty × 2 volby = 8 kombinací se shodným skóre.
  const r = findVariants([mk('A', 'Po'), mk('B', 'Út'), mk('C', 'St')]);
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.variants.length, 5, 'pět variant');
  const keys = new Set(
    r.variants.map((v) => v.schedule.map((g) => g.id).sort().join('|'))
  );
  assertEqual(keys.size, 5, 'navzájem různé');
  for (const v of r.variants) {
    assertValidSchedule(v.schedule, 3);
    assert(v.tags.length > 0, 'má štítek');
  }
  assert(
    r.variants.some((v) => v.tags.includes('vyučující')) &&
      r.variants.some((v) => v.tags.includes('kompaktnost')),
    'skladba dle 8.1'
  );
});
test('SCORE: varianta optimalizovaná na vyučující vs. nejlepší celkové skóre', () => {
  // Chtěný vyučující učí jen večer izolovaně (nový den), jinak kompaktní řešení.
  const courses = [
    mkCourse('A', [blockGroup('A', '01', 'Po', 'weekly', 0)]),
    mkCourse('B', [
      blockGroup('B', '01', 'Po', 'weekly', 1, 'M. Jiná'),
      blockGroup('B', '02', 'Út', 'weekly', 3, 'V. Hvězda'),
    ]),
  ];
  const prefs = { teachers: { B: { wanted: ['V. Hvězda'] } } };
  const r = findVariants(courses, {}, prefs);
  assertEqual(r.status, 'ok', 'status');
  const teacherVariant = r.variants.find((v) => v.tags.includes('vyučující'));
  assertEqual(
    teacherVariant.schedule.find((g) => g.courseCode === 'B').teacher,
    'V. Hvězda',
    'varianta na vyučující drží chtěného'
  );
  const compactVariant = r.variants.find((v) => v.tags.includes('kompaktnost'));
  assertEqual(
    compactVariant.schedule.find((g) => g.courseCode === 'B').id,
    'B/01',
    'nejkompaktnější drží jeden den'
  );
});
test('SCORE: findVariants respektuje tvrdá omezení (blokace + limit dnů)', () => {
  const courses = [
    mkCourse('A', [
      mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'),
      mkGroup('A', '02', 'Út', 'weekly', '10:00', '11:40'),
    ]),
    mkCourse('B', [
      mkGroup('B', '01', 'Po', 'weekly', '12:00', '13:40'),
      mkGroup('B', '02', 'St', 'weekly', '10:00', '11:40'),
    ]),
  ];
  const r = findVariants(courses, {
    blockedTimes: [{ day: 'Út', startMin: 600, endMin: 700 }],
    dayLimit: 1,
  });
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.variants.length, 1, 'jediná přípustná kombinace (vše na Po)');
  assertEqual(
    r.variants[0].schedule.map((g) => g.id).sort(),
    ['A/01', 'B/01'],
    'obě na pondělí'
  );
});
