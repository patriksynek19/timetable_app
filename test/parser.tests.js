/** Jednotkové testy parseru na anonymizovaných vzorcích. */
import { test, assert, assertEqual } from './harness.js';
import { parseCourseHtml, parsePeriod, periodOrdinal } from '../js/parser.js';

const csHtml = await (await fetch('./fixtures/fixture-cs.html')).text();
const enHtml = await (await fetch('./fixtures/fixture-en.html')).text();

const cs = parseCourseHtml(csHtml);
test('CS: parsování proběhne bez chyb', () => {
  assertEqual(cs.errors, [], 'errors');
  assert(cs.ok, 'ok má být true');
});
test('CS: kód, název, fakulta, jazyk', () => {
  assertEqual(cs.course.code, 'XX101Zk', 'kód');
  assertEqual(cs.course.name, 'Testovací předmět', 'název');
  assertEqual(cs.course.faculty, 'law', 'fakulta');
  assertEqual(cs.course.language, 'Čeština', 'chybějící pole jazyka = čeština');
});
test('CS: období podzim2026', () => {
  assertEqual(
    cs.course.period,
    { raw: 'podzim2026', term: 'podzim', year: 2026 },
    'období'
  );
});
test('CS: 6 platných skupin, 1 bez rozvrhu zahozena', () => {
  assertEqual(cs.course.groups.length, 6, 'počet skupin');
  assertEqual(cs.course.unscheduledIds, ['XX101Zk/07'], 'zahozené skupiny');
  assertEqual(cs.course.singleGroup, false, 'singleGroup');
});
test('CS: všech 5 tvarů parity + týdenní skupina', () => {
  const parityByNumber = Object.fromEntries(
    cs.course.groups.map((g) => [g.number, [g.parity, g.day]])
  );
  assertEqual(parityByNumber['01'], ['odd', 'Po'], 'liché pondělí');
  assertEqual(parityByNumber['02'], ['even', 'Út'], 'sudé úterý');
  assertEqual(parityByNumber['03'], ['odd', 'St'], 'lichou středu');
  assertEqual(parityByNumber['04'], ['even', 'Čt'], 'sudý čtvrtek');
  assertEqual(parityByNumber['05'], ['odd', 'Pá'], 'lichý pátek');
  assertEqual(parityByNumber['06'], ['weekly', 'Út'], 'týdenní úterý');
});
test('CS: časy, místnosti, vyučující', () => {
  const g1 = cs.course.groups[0];
  assertEqual(
    [g1.start, g1.end, g1.startMin, g1.endMin],
    ['10:00', '11:40', 600, 700],
    'čas skupiny 01'
  );
  assertEqual(g1.room, '315', 'místnost skupiny 01');
  assertEqual(g1.teacher, 'J. Novák', 'vyučující skupiny 01');
  const g6 = cs.course.groups[5];
  assertEqual(g6.teacher, null, 'skupina 06 bez vyučujícího');
  assertEqual(g6.room, '160', 'místnost skupiny 06');
});
test('CS: přednáška před nadpisem se do skupin nesplete', () => {
  assert(
    !cs.course.groups.some((g) => g.room === 'Aula'),
    'Aula nesmí být mezi skupinami'
  );
});

const en = parseCourseHtml(enHtml);
test('EN: parsování proběhne bez chyb', () => {
  assertEqual(en.errors, [], 'errors');
  assert(en.ok, 'ok má být true');
});
test('EN: jazyk z pole Vyučovací jazyk', () => {
  assertEqual(en.course.language, 'Angličtina', 'jazyk');
});
test('EN: jediná skupina => singleGroup (varianta A)', () => {
  assertEqual(en.course.groups.length, 1, 'počet skupin');
  assertEqual(en.course.singleGroup, true, 'singleGroup');
  const g = en.course.groups[0];
  assertEqual(
    [g.parity, g.day, g.start, g.end, g.room, g.teacher],
    ['weekly', 'Út', '8:00', '9:40', '160', 'K. Malá'],
    'obsah skupiny'
  );
});

test('Chybí canonical => chyba, course null', () => {
  const r = parseCourseHtml('<html><title>x</title></html>');
  assert(!r.ok, 'ok má být false');
  assertEqual(r.course, null, 'course');
  assert(r.errors.length === 1, 'jedna chyba');
});
test('Stránka bez nadpisu skupin => hasSeminars false', () => {
  const r = parseCourseHtml(
    csHtml.replace('Rozvrh seminárních/paralelních skupin', 'Nic')
  );
  assert(r.ok, 'ok');
  assertEqual(r.course.hasSeminars, false, 'hasSeminars');
  assertEqual(r.course.groups, [], 'groups');
});
test('Pořadí období: jaro2026 < podzim2026 < jaro2027', () => {
  const j26 = periodOrdinal(parsePeriod('jaro2026'));
  const p26 = periodOrdinal(parsePeriod('podzim2026'));
  const j27 = periodOrdinal(parsePeriod('jaro2027'));
  assert(j26 < p26 && p26 < j27, `${j26}, ${p26}, ${j27}`);
});

export { cs, en };
