/** Testy stavitele mřížky rozvrhu (CLAUDE.md 8.2). */
import { test, assert, assertEqual } from './harness.js';
import { buildVariantGrid } from '../js/grid.js';
import { mkGroup } from './solver.tests.js';

const names = new Map([['A', 'Předmět A'], ['B', 'Předmět B']]);

test('GRID: hlavička má sloupce Den, Týden a šest bloků 8:00–19:40', () => {
  const t = buildVariantGrid([mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')], names);
  const ths = [...t.querySelectorAll('thead th')].map((th) => th.textContent);
  assertEqual(
    ths,
    ['Den', 'Týden', '8:00–9:40', '10:00–11:40', '12:00–13:40', '14:00–15:40', '16:00–17:40', '18:00–19:40'],
    'hlavička'
  );
});

test('GRID: každý den má řádek lichého a sudého týdne', () => {
  const t = buildVariantGrid([], names);
  assertEqual(t.querySelectorAll('tbody tr').length, 10, '5 dnů × 2 řádky');
  assertEqual(t.querySelectorAll('th.day').length, 5, 'popisky dnů');
  const parities = [...t.querySelectorAll('th.parity')].map((th) => th.textContent);
  assertEqual(parities.slice(0, 2), ['lichý', 'sudý'], 'popisky týdnů');
});

test('GRID: týdenní seminář je spojený přes oba řádky (rowspan 2)', () => {
  const t = buildVariantGrid([mkGroup('A', '01', 'Po', 'weekly', '10:00', '11:40')], names);
  const cell = t.querySelector('td.cell');
  assertEqual(cell.rowSpan, 2, 'rowspan');
  assert(cell.classList.contains('weekly'), 'třída weekly');
  assertEqual(t.querySelectorAll('td.cell').length, 1, 'jediná buňka');
  // sudý řádek pondělí nesmí mít vlastní buňku v témže bloku
  const monEven = t.querySelectorAll('tbody tr')[1];
  assertEqual(monEven.querySelectorAll('td').length, 5, 'sudý řádek má o buňku míň');
});

test('GRID: čtrnáctidenní semináře opačné parity sdílí den ve dvou řádcích', () => {
  const t = buildVariantGrid(
    [
      mkGroup('A', '01', 'Po', 'odd', '10:00', '11:40'),
      mkGroup('B', '01', 'Po', 'even', '10:00', '11:40'),
    ],
    names
  );
  const cells = t.querySelectorAll('td.cell');
  assertEqual(cells.length, 2, 'dvě buňky');
  assertEqual(cells[0].rowSpan, 1, 'lichá bez rowspan');
  assertEqual(cells[1].rowSpan, 1, 'sudá bez rowspan');
  assert(cells[0].textContent.includes('A/01'), 'lichý řádek: A');
  assert(cells[1].textContent.includes('B/01'), 'sudý řádek: B');
});

test('GRID: buňka nese id skupiny, název, čas, místnost i vyučujícího', () => {
  const t = buildVariantGrid([mkGroup('A', '03', 'St', 'weekly', '12:00', '13:40')], names);
  const cell = t.querySelector('td.cell');
  for (const part of ['A/03', 'Předmět A', '12:00–13:40', 'T1', 'T. Ester']) {
    assert(cell.textContent.includes(part), `obsahuje ${part}`);
  }
  assert(cell.title.includes('St'), 'title s dnem');
});

test('GRID: skupina přes dva bloky dostane colspan 2', () => {
  const t = buildVariantGrid([mkGroup('A', '01', 'Po', 'weekly', '9:00', '10:40')], names);
  const cell = t.querySelector('td.cell');
  assertEqual(cell.colSpan, 2, 'colspan');
  const monOdd = t.querySelector('tbody tr');
  // Den + parita + (colspan2 buňka) + 4 prázdné = 7 elementů
  assertEqual(monOdd.querySelectorAll('td').length, 5, 'počet td v lichém řádku');
});

test('GRID: nestandardní pozdní čas rozšíří sloupce', () => {
  const t = buildVariantGrid([mkGroup('A', '01', 'Po', 'weekly', '20:00', '21:40')], names);
  const ths = [...t.querySelectorAll('thead th')].map((th) => th.textContent);
  assert(ths.includes('20:00–21:40'), 'sloupec 20:00 existuje');
});
