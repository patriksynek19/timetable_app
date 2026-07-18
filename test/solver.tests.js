/** Jednotkové testy řešiče tvrdých omezení (CLAUDE.md sekce 5). */
import { test, assert, assertEqual } from './harness.js';
import { groupsConflict, conflictsWithBlocked, countDays, solve } from '../js/solver.js';

function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** Pomocník: skupina se stejným tvarem, jaký vrací parser. */
function mkGroup(courseCode, number, day, parity, start, end) {
  return {
    id: `${courseCode}/${number}`,
    courseCode,
    number,
    day,
    dayIndex: ['Po', 'Út', 'St', 'Čt', 'Pá'].indexOf(day),
    parity,
    start,
    end,
    startMin: toMin(start),
    endMin: toMin(end),
    room: 'T1',
    teacher: 'T. Ester',
  };
}

function mkCourse(code, groups) {
  return {
    code,
    name: code,
    faculty: 'law',
    period: { raw: 'podzim2026', term: 'podzim', year: 2026 },
    language: 'Čeština',
    hasSeminars: true,
    groups,
    unscheduledIds: [],
    singleGroup: groups.length === 1,
  };
}

function assertValidSchedule(schedule, courseCount) {
  assertEqual(schedule.length, courseCount, 'právě jedna skupina na předmět');
  const codes = new Set(schedule.map((g) => g.courseCode));
  assertEqual(codes.size, courseCount, 'žádný předmět dvakrát');
  for (let i = 0; i < schedule.length; i++) {
    for (let j = i + 1; j < schedule.length; j++) {
      assert(
        !groupsConflict(schedule[i], schedule[j]),
        `kolize ${schedule[i].id} × ${schedule[j].id}`
      );
    }
  }
}

// ---------- kolizní predikát ----------
test('SOLVER: týdenní × lichá ve stejném čase kolidují', () => {
  const a = mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40');
  const b = mkGroup('B', '01', 'Po', 'odd', '10:00', '11:40');
  assert(groupsConflict(a, b), 'mají kolidovat');
});
test('SOLVER: lichá × sudá ve stejném čase nekolidují', () => {
  const a = mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40');
  const b = mkGroup('B', '01', 'Po', 'even', '10:00', '11:40');
  assert(!groupsConflict(a, b), 'nemají kolidovat (opačná parita)');
});
test('SOLVER: lichá × lichá s překryvem kolidují', () => {
  const a = mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40');
  const b = mkGroup('B', '01', 'Po', 'odd', '11:00', '12:40');
  assert(groupsConflict(a, b), 'mají kolidovat');
});
test('SOLVER: jiný den nebo navazující časy nekolidují', () => {
  const a = mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40');
  assert(
    !groupsConflict(a, mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40')),
    'jiný den'
  );
  assert(
    !groupsConflict(a, mkGroup('B', '01', 'Po', 'weekly', '11:40', '13:20')),
    'navazující čas'
  );
});

// ---------- základní řešení ----------
test('SOLVER: dva předměty bez kolize => obě skupiny v rozvrhu', () => {
  const r = solve([
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40')]),
  ]);
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules.length, 1, 'jedno řešení');
  assertValidSchedule(r.schedules[0], 2);
});
test('SOLVER: varianta A vytlačí vícekupinový předmět na alternativu', () => {
  const r = solve([
    mkCourse('A', [
      mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'),
      mkGroup('A', '02', 'Po', 'weekly', '12:00', '13:40'),
    ]),
    mkCourse('B', [mkGroup('B', '01', 'Po', 'weekly', '10:00', '11:40')]),
  ]);
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules.length, 1, 'jediné řešení');
  const ids = r.schedules[0].map((g) => g.id).sort();
  assertEqual(ids, ['A/02', 'B/01'], 'A musí uhnout na A/02');
});
test('SOLVER: opačné parity smí sdílet den a čas', () => {
  const r = solve([
    mkCourse('A', [mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Po', 'even', '10:00', '11:40')]),
  ]);
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules.length, 1, 'jedno řešení');
});
test('SOLVER: dvě varianty A ve stejném čase => neřešitelné', () => {
  const r = solve([
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Po', 'weekly', '10:00', '11:40')]),
  ]);
  assertEqual(r.status, 'infeasible', 'status');
});

// ---------- blokované časy ----------
const blockMon10 = [{ day: 'Po', startMin: toMin('10:00'), endMin: toMin('11:40') }];
test('SOLVER: blokovaný čas vyřadí skupinu, zbylá se použije', () => {
  const r = solve(
    [
      mkCourse('A', [
        mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'),
        mkGroup('A', '02', 'Út', 'weekly', '10:00', '11:40'),
      ]),
    ],
    { blockedTimes: blockMon10 }
  );
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules[0][0].id, 'A/02', 'vybrána neblokovaná skupina');
});
test('SOLVER: varianta A přebije blokaci s upozorněním (5.1)', () => {
  const r = solve(
    [mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')])],
    { blockedTimes: blockMon10 }
  );
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules[0][0].id, 'A/01', 'skupina zařazena přes blokaci');
  assert(r.warnings.length === 1 && r.warnings[0].includes('A/01'), 'upozornění');
});
test('SOLVER: více skupin, všechny blokované => neřešitelné, ne varianta A', () => {
  const r = solve(
    [
      mkCourse('A', [
        mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'),
        mkGroup('A', '02', 'Po', 'odd', '10:00', '11:40'),
      ]),
    ],
    { blockedTimes: blockMon10 }
  );
  assertEqual(r.status, 'infeasible', 'status');
  assertEqual(r.warnings, [], 'žádné přebití blokace');
});
test('SOLVER: blokace jen liché parity nechá sudou skupinu být', () => {
  const r = solve(
    [mkCourse('A', [mkGroup('A', '01', 'Po', 'even', '10:00', '11:40'), mkGroup('A', '02', 'Po', 'odd', '10:00', '11:40')])],
    { blockedTimes: [{ ...blockMon10[0], parity: 'odd' }] }
  );
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules.length, 1, 'jen sudá skupina projde');
  assertEqual(r.schedules[0][0].id, 'A/01', 'sudá skupina');
});

// ---------- limit dnů ----------
test('SOLVER: limit dnů zvlášť pro parity (příklad ze spec 5 bodu 4)', () => {
  // lichý týden: Po + Út, sudý týden: Út + St, N = 2 => v pořádku
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40')]),
    mkCourse('C', [mkGroup('C', '01', 'St', 'even', '10:00', '11:40')]),
  ];
  const r = solve(courses, { dayLimit: 2 });
  assertEqual(r.status, 'ok', 'tři dny během 14 dnů, ale nikdy víc než 2 v týdnu');
});
test('SOLVER: překročení limitu dnů => neřešitelné', () => {
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'odd', '10:00', '11:40')]),
    mkCourse('C', [mkGroup('C', '01', 'St', 'odd', '10:00', '11:40')]),
  ];
  const r = solve(courses, { dayLimit: 2 });
  assertEqual(r.status, 'infeasible', '3 dny v lichém týdnu při N=2');
});
test('SOLVER: ruční výjimka z limitu dnů předmět vyjme z počítání (5.2)', () => {
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'odd', '10:00', '11:40')]),
    mkCourse('C', [mkGroup('C', '01', 'St', 'odd', '10:00', '11:40')]),
  ];
  const r = solve(courses, { dayLimit: 2, dayLimitExceptions: ['C'] });
  assertEqual(r.status, 'ok', 'výjimka pro C');
});
test('SOLVER: výjimka uvolní celý den — další předmět na tentýž den je zdarma', () => {
  // Po + Út obsazené, C (výjimka) na St; D nevyňaté také na St, jiný čas.
  // St je díky výjimce uvolněná, takže D na ní nepřidá počítaný den. N=2 ok.
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40')]),
    mkCourse('C', [mkGroup('C', '01', 'St', 'weekly', '10:00', '11:40')]),
    mkCourse('D', [mkGroup('D', '01', 'St', 'weekly', '12:00', '13:40')]),
  ];
  const r = solve(courses, { dayLimit: 2, dayLimitExceptions: ['C'] });
  assertEqual(r.status, 'ok', 'St uvolněná pro C i D');
  assertEqual(r.schedules[0].map((g) => g.id).sort(), ['A/01', 'B/01', 'C/01', 'D/01'], 'všechny 4');
});
test('SOLVER: výjimka neospravedlní jiný, nový den', () => {
  // Stejné jako výše, ale D je na Čt (nový den, ne na uvolněné St). => přes limit.
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40')]),
    mkCourse('C', [mkGroup('C', '01', 'St', 'weekly', '10:00', '11:40')]),
    mkCourse('D', [mkGroup('D', '01', 'Čt', 'weekly', '12:00', '13:40')]),
  ];
  const r = solve(courses, { dayLimit: 2, dayLimitExceptions: ['C'] });
  assertEqual(r.status, 'infeasible', 'Čt je nový počítaný den, přes N=2');
});
test('SOLVER: výjimka jen liché parity neuvolní stejný den v sudém týdnu', () => {
  // C (výjimka) na St lichý uvolní St jen v lichém týdnu. D nevyňaté na St sudý
  // proto v sudém týdnu počítaný den je. Po + Út + (sudá St) = 3 > N=2.
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40')]),
    mkCourse('C', [mkGroup('C', '01', 'St', 'odd', '10:00', '11:40')]),
    mkCourse('D', [mkGroup('D', '01', 'St', 'even', '10:00', '11:40')]),
  ];
  const r = solve(courses, { dayLimit: 2, dayLimitExceptions: ['C'] });
  assertEqual(r.status, 'infeasible', 'sudá St se počítá');
});
test('SOLVER: limit dnů platí i pro variantu A (bez automatické výjimky)', () => {
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40')]),
  ];
  const r = solve(courses, { dayLimit: 1 });
  assertEqual(r.status, 'infeasible', 'dvě varianty A na dvou dnech při N=1');
});
test('SOLVER: odlišné limity pro lichý a sudý týden (dayLimits)', () => {
  // Dva čtrnáctidenní předměty v lichém týdnu na různých dnech.
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'odd', '10:00', '11:40')]),
    mkCourse('C', [mkGroup('C', '01', 'St', 'even', '10:00', '11:40')]),
  ];
  const strict = solve(courses, { dayLimits: { odd: 1, even: 3 } });
  assertEqual(strict.status, 'infeasible', '2 liché dny při odd=1');
  const loose = solve(courses, { dayLimits: { odd: 2, even: 1 } });
  assertEqual(loose.status, 'ok', 'odd=2, even=1 sedí');
  const oddOnly = solve(courses, { dayLimits: { odd: 2, even: null } });
  assertEqual(oddOnly.status, 'ok', 'null = bez limitu pro sudý týden');
});
test('SOLVER: dayLimits má přednost, týdenní skupina se počítá v obou týdnech', () => {
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [mkGroup('B', '01', 'Út', 'even', '10:00', '11:40')]),
  ];
  // Sudý týden má Po (týdenní) + Út = 2 dny.
  const r = solve(courses, { dayLimits: { odd: 1, even: 1 } });
  assertEqual(r.status, 'infeasible', 'even=1 nestačí');
  const r2 = solve(courses, { dayLimits: { odd: 1, even: 2 } });
  assertEqual(r2.status, 'ok', 'even=2 stačí');
});
test('SOLVER: countDays počítá týdenní skupinu v obou paritách', () => {
  const groups = [
    mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'),
    mkGroup('B', '01', 'Út', 'odd', '10:00', '11:40'),
  ];
  assertEqual(countDays(groups, 'odd'), 2, 'lichý týden');
  assertEqual(countDays(groups, 'even'), 1, 'sudý týden');
});

// ---------- ukotvení ----------
test('SOLVER: ukotvená skupina je ve všech řešeních', () => {
  const courses = [
    mkCourse('A', [
      mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'),
      mkGroup('A', '02', 'Út', 'weekly', '10:00', '11:40'),
    ]),
  ];
  const r = solve(courses, { anchoredGroups: { A: 'A/02' } });
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules.length, 1, 'jedno řešení');
  assertEqual(r.schedules[0][0].id, 'A/02', 'ukotvená skupina');
});
test('SOLVER: neexistující ukotvená skupina => chyba', () => {
  const r = solve(
    [mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')])],
    { anchoredGroups: { A: 'A/99' } }
  );
  assertEqual(r.status, 'error', 'status');
  assert(r.errors[0].includes('A/99'), 'chybová hláška');
});
test('SOLVER: ukotvená skupina v blokovaném čase přebíjí blokaci s upozorněním', () => {
  const courses = [
    mkCourse('A', [
      mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40'),
      mkGroup('A', '02', 'Út', 'weekly', '10:00', '11:40'),
    ]),
  ];
  const r = solve(courses, {
    anchoredGroups: { A: 'A/01' },
    blockedTimes: blockMon10,
  });
  assertEqual(r.status, 'ok', 'ukotvení přebíjí blokaci, skládá se okolo');
  assertEqual(r.schedules[0][0].id, 'A/01', 'ukotvená skupina zůstává');
  assert(r.warnings.some((w) => w.includes('A/01')), 'upozornění na přebití');
});
test('SOLVER: ukotvení nepřebíjí limit dnů (to řeší jen výjimka 5.2)', () => {
  const courses = [
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
    mkCourse('B', [
      mkGroup('B', '01', 'Út', 'weekly', '10:00', '11:40'),
      mkGroup('B', '02', 'Po', 'weekly', '12:00', '13:40'),
    ]),
  ];
  // Ukotvíme B na úterý, takže Po+Út = 2 dny; při N=1 je to přes limit.
  const r = solve(courses, { anchoredGroups: { B: 'B/01' }, dayLimit: 1 });
  assertEqual(r.status, 'infeasible', 'limit dnů ukotvení nepřebíjí');
  const r2 = solve(courses, {
    anchoredGroups: { B: 'B/01' },
    dayLimit: 1,
    dayLimitExceptions: ['B'],
  });
  assertEqual(r2.status, 'ok', 's výjimkou z limitu už řešení je');
});

// ---------- různé ----------
test('SOLVER: předmět bez seminářů se přeskočí, ostatní se vyřeší', () => {
  const noSem = { ...mkCourse('X', []), hasSeminars: false };
  const r = solve([
    noSem,
    mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]),
  ]);
  assertEqual(r.status, 'ok', 'status');
  assertEqual(r.schedules[0].length, 1, 'jen skupina předmětu A');
});
test('SOLVER: duplicitně nahraný předmět => chyba', () => {
  const c = mkCourse('A', [mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')]);
  const r = solve([c, c]);
  assertEqual(r.status, 'error', 'status');
});
test('SOLVER: strop počtu řešení nastaví truncated', () => {
  const mk = (code) =>
    mkCourse(code, [
      mkGroup(code, '01', 'Po', 'odd', '10:00', '11:40'),
      mkGroup(code, '02', 'Po', 'even', '10:00', '11:40'),
    ]);
  // 3 předměty po 2 nezávislých volbách na různých dnech => 8 kombinací
  const courses = [
    mk('A'),
    mkCourse('B', [
      mkGroup('B', '01', 'Út', 'odd', '10:00', '11:40'),
      mkGroup('B', '02', 'Út', 'even', '10:00', '11:40'),
    ]),
    mkCourse('C', [
      mkGroup('C', '01', 'St', 'odd', '10:00', '11:40'),
      mkGroup('C', '02', 'St', 'even', '10:00', '11:40'),
    ]),
  ];
  const r = solve(courses, {}, { maxSolutions: 3 });
  assertEqual(r.schedules.length, 3, 'strop');
  assert(r.truncated, 'truncated');
  const full = solve(courses);
  assertEqual(full.schedules.length, 8, 'bez stropu všech 8');
  assert(!full.truncated, 'plný výčet');
});

export { mkGroup, mkCourse, assertValidSchedule };
