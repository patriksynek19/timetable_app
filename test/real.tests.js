/**
 * Integrační testy nad reálnými uloženými stránkami v kořeni projektu.
 * Soubory jsou jen lokální (mimo repozitář); bez nich se sekce přeskočí.
 */
import { test, assert, assertEqual } from './harness.js';
import { parseCourseHtml, DAYS } from '../js/parser.js';
import { solve, groupsConflict, countDays } from '../js/solver.js';
import { findVariants } from '../js/variants.js';

const realList = document.getElementById('real');
const courses = [];

try {
  const listing = await (await fetch('/')).text();
  const doc = new DOMParser().parseFromString(listing, 'text/html');
  const files = [...doc.querySelectorAll('a')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => h && h.endsWith('.html') && !h.includes('test'));

  if (files.length === 0) {
    realList.innerHTML =
      '<li class="warn">Žádné reálné soubory nenalezeny (v pořádku např. na CI).</li>';
  }

  for (const href of files) {
    const html = await (await fetch('/' + href)).text();
    const r = parseCourseHtml(html);
    const label = decodeURIComponent(href);
    test(`REAL ${label}: parsování ok`, () => {
      assertEqual(r.errors, [], 'errors');
      assert(r.ok && r.course, 'ok');
      assert(r.course.hasSeminars, 'má mít semináře');
      assert(r.course.groups.length > 0, 'aspoň jedna skupina');
    });
    test(`REAL ${label}: všechny skupiny mají platný tvar`, () => {
      for (const g of r.course.groups) {
        assert(DAYS.includes(g.day), `den ${g.day} u ${g.id}`);
        assert(['weekly', 'odd', 'even'].includes(g.parity), `parita u ${g.id}`);
        assert(g.startMin < g.endMin, `čas u ${g.id}`);
        assert(g.room, `místnost u ${g.id}`);
      }
    });
    if (r.course) courses.push(r.course);

    const li = document.createElement('li');
    li.textContent =
      `${label} → ${r.course.code} (${r.course.period.raw}, ${r.course.language}): ` +
      `${r.course.groups.length} skupin, ${r.course.unscheduledIds.length} bez rozvrhu zahozeno` +
      (r.course.singleGroup ? ' — JEDINÁ SKUPINA (varianta A)' : '');
    realList.appendChild(li);
  }
} catch (e) {
  realList.innerHTML = `<li class="warn">Reálné soubory nešlo načíst: ${e}</li>`;
}

if (courses.length > 0) {
  const assertValid = (schedule, settings = {}) => {
    assertEqual(schedule.length, courses.length, 'jedna skupina na předmět');
    for (let i = 0; i < schedule.length; i++) {
      for (let j = i + 1; j < schedule.length; j++) {
        assert(
          !groupsConflict(schedule[i], schedule[j]),
          `kolize ${schedule[i].id} × ${schedule[j].id}`
        );
      }
    }
    if (settings.dayLimit != null) {
      for (const parityKey of ['odd', 'even']) {
        assert(
          countDays(schedule, parityKey) <= settings.dayLimit,
          `limit dnů (${parityKey})`
        );
      }
    }
  };

  test('REAL solve: bez omezení existuje řešení a je platné', () => {
    const r = solve(courses, {}, { maxSolutions: 200 });
    assertEqual(r.status, 'ok', 'status');
    for (const s of r.schedules) assertValid(s);
  });

  test('REAL solve: varianta A (MVV1368K) je v každém řešení', () => {
    const single = courses.find((c) => c.singleGroup);
    assert(single, 'v datech má být předmět s jedinou skupinou');
    const r = solve(courses, {}, { maxSolutions: 200 });
    for (const s of r.schedules) {
      assert(
        s.some((g) => g.id === single.groups[0].id),
        `${single.groups[0].id} chybí v řešení`
      );
    }
  });

  test('REAL solve: blokace Út 8:00 => varianta A ji přebije s upozorněním', () => {
    const settings = {
      blockedTimes: [{ day: 'Út', startMin: 480, endMin: 580 }],
    };
    const r = solve(courses, settings, { maxSolutions: 50 });
    assertEqual(r.status, 'ok', 'status');
    assert(
      r.warnings.some((w) => w.includes('MVV1368K/01')),
      'upozornění na přebití blokace'
    );
  });

  test('REAL solve: s limitem dnů jsou řešení konzistentní', () => {
    for (const dayLimit of [2, 3, 4]) {
      const r = solve(courses, { dayLimit }, { maxSolutions: 100 });
      if (r.status === 'ok') {
        for (const s of r.schedules) assertValid(s, { dayLimit });
      }
      const li = document.createElement('li');
      li.textContent = `solve s limitem ${dayLimit} dnů: ${r.status}` +
        (r.status === 'ok' ? ` (${r.schedules.length}${r.truncated ? '+' : ''} řešení)` : '');
      realList.appendChild(li);
    }
  });

  test('REAL variants: findVariants vrací 5 platných variant seřazených podle skóre', () => {
    const started = performance.now();
    const r = findVariants(courses);
    const elapsed = Math.round(performance.now() - started);
    assertEqual(r.status, 'ok', 'status');
    assertEqual(r.variants.length, 5, 'pět variant');
    const single = courses.find((c) => c.singleGroup);
    for (let i = 0; i < r.variants.length; i++) {
      assertValid(r.variants[i].schedule);
      assert(
        r.variants[i].schedule.some((g) => g.id === single.groups[0].id),
        'varianta A přítomna'
      );
      if (i > 0) {
        assert(
          r.variants[i - 1].score.total >= r.variants[i].score.total,
          'seřazeno sestupně'
        );
      }
    }
    const v0 = r.variants[0];
    const li = document.createElement('li');
    li.textContent =
      `findVariants: ${elapsed} ms, ${r.nodesExplored} uzlů` +
      `${r.truncated ? ' (oříznuto pojistkou)' : ''}; nejlepší varianta: ` +
      `skóre ${v0.score.total}, dny ${v0.score.details.daysOdd}+${v0.score.details.daysEven}, ` +
      `okna ${v0.score.details.windows}, nejdelší řada ${v0.score.details.longestRun}, ` +
      `štítky [${v0.tags.join(', ')}]`;
    realList.appendChild(li);
  });

  test('REAL variants: nechtěný vyučující se v nejlepší variantě nevyskytne', () => {
    // MP509Zk vede Z. Králíčková a M. Kornel; nechtěná Králíčková
    // má alternativu, takže nejlepší varianta ji obsahovat nesmí (6.1).
    const prefs = { teachers: { MP509Zk: { unwanted: ['Z. Králíčková'] } } };
    const r = findVariants(courses, {}, prefs);
    assertEqual(r.status, 'ok', 'status');
    const g = r.variants[0].schedule.find((x) => x.courseCode === 'MP509Zk');
    assert(g, 'MP509Zk je v rozvrhu');
    assert(g.teacher !== 'Z. Králíčková', `vybrán ${g.teacher}`);
  });

  test('REAL variants: limit dnů 2 dá platné varianty', () => {
    const r = findVariants(courses, { dayLimit: 2 });
    assertEqual(r.status, 'ok', 'status');
    for (const v of r.variants) {
      assertValid(v.schedule, { dayLimit: 2 });
    }
  });
}
