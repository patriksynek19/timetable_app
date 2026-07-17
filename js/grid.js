/**
 * Mřížka rozvrhu (CLAUDE.md 8.2): svisle dny, vodorovně výukové bloky.
 * Každý den má dva navazující řádky (lichý a sudý týden); čtrnáctidenní
 * seminář se ukáže jen ve svém řádku, týdenní je vizuálně spojený přes oba
 * (rowspan). V buňce je celá identifikace skupiny, aby šel výsledek použít
 * k zápisu i k exportu.
 */

import { DAYS } from './parser.js';
import { groupBlocks } from './scoring.js';

function timeLabel(block) {
  return `${8 + 2 * block}:00–${8 + 2 * block + 1}:40`;
}

/** Rozsah sloupců: standardně bloky 0–5, nestandardní časy ho rozšíří. */
function blockRange(schedule) {
  let min = 0;
  let max = 5;
  for (const g of schedule) {
    const blocks = groupBlocks(g);
    min = Math.min(min, blocks[0]);
    max = Math.max(max, blocks[blocks.length - 1]);
  }
  return { min, max };
}

function emptyCell() {
  const td = document.createElement('td');
  td.className = 'empty';
  return td;
}

function groupCell(group, courseName, colSpan, rowSpan) {
  const td = document.createElement('td');
  td.className = 'cell' + (rowSpan === 2 ? ' weekly' : '');
  td.colSpan = colSpan;
  td.rowSpan = rowSpan;
  const id = document.createElement('strong');
  id.textContent = group.id;
  td.append(id);
  if (courseName) {
    const name = document.createElement('div');
    name.className = 'c-name';
    name.textContent = courseName;
    td.append(name);
  }
  const detail = document.createElement('div');
  detail.className = 'c-detail';
  detail.textContent =
    `${group.start}–${group.end}` +
    (group.room ? ` · ${group.room}` : '') +
    (group.teacher ? ` · ${group.teacher}` : '');
  td.append(detail);
  td.title =
    `${group.id}${courseName ? ` — ${courseName}` : ''} · ${group.day} ` +
    `${group.start}–${group.end}` +
    (group.room ? ` · učebna ${group.room}` : '') +
    (group.teacher ? ` · ${group.teacher}` : '');
  return td;
}

/**
 * Postaví <table> s rozvrhem z vybraných skupin.
 * courseNames: Map kód předmětu -> název (pro popisky buněk).
 */
export function buildVariantGrid(schedule, courseNames = new Map()) {
  const { min, max } = blockRange(schedule);
  const table = document.createElement('table');
  table.className = 'timetable';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const label of ['Den', 'Týden']) {
    const th = document.createElement('th');
    th.textContent = label;
    headRow.append(th);
  }
  for (let b = min; b <= max; b++) {
    const th = document.createElement('th');
    th.textContent = timeLabel(b);
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const day of DAYS) {
    const dayGroups = schedule.filter((g) => g.day === day);
    const oddGroups = dayGroups.filter((g) => g.parity !== 'even');
    const evenOnly = dayGroups.filter((g) => g.parity === 'even');

    const trOdd = document.createElement('tr');
    trOdd.className = 'row-odd';
    const trEven = document.createElement('tr');
    trEven.className = 'row-even';

    const dayTh = document.createElement('th');
    dayTh.className = 'day';
    dayTh.rowSpan = 2;
    dayTh.textContent = day;
    trOdd.append(dayTh);
    const oddTh = document.createElement('th');
    oddTh.className = 'parity';
    oddTh.textContent = 'lichý';
    trOdd.append(oddTh);
    const evenTh = document.createElement('th');
    evenTh.className = 'parity';
    evenTh.textContent = 'sudý';
    trEven.append(evenTh);

    // Bloky přeskočené kvůli colspan (víceblokové skupiny) a rowspan
    // (týdenní skupina obsadí i sudý řádek).
    const skipOdd = new Set();
    const skipEven = new Set();
    for (let b = min; b <= max; b++) {
      if (!skipOdd.has(b)) {
        const g = oddGroups.find((x) => groupBlocks(x)[0] === b);
        if (g) {
          const blocks = groupBlocks(g);
          const weekly = g.parity === 'weekly';
          trOdd.append(
            groupCell(g, courseNames.get(g.courseCode), blocks.length, weekly ? 2 : 1)
          );
          for (const bb of blocks.slice(1)) skipOdd.add(bb);
          if (weekly) for (const bb of blocks) skipEven.add(bb);
        } else {
          trOdd.append(emptyCell());
        }
      }
      if (!skipEven.has(b)) {
        const g = evenOnly.find((x) => groupBlocks(x)[0] === b);
        if (g) {
          const blocks = groupBlocks(g);
          trEven.append(groupCell(g, courseNames.get(g.courseCode), blocks.length, 1));
          for (const bb of blocks.slice(1)) skipEven.add(bb);
        } else {
          trEven.append(emptyCell());
        }
      }
    }
    tbody.append(trOdd, trEven);
  }
  table.append(tbody);
  return table;
}
