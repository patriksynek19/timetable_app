/**
 * Uživatelské rozhraní skladače (CLAUDE.md sekce 7, milník 4).
 * Nahrání souborů, preference vyučujících, ukotvení, blokace, limit dnů,
 * vyhrazení přednášek; výsledek zatím jako přehled variant (mřížka a export
 * jsou milník 5).
 */

import { parseCourseHtml, periodOrdinal, expectedPeriod, DAYS } from './parser.js';
import { findVariants } from './variants.js';

const STORAGE_KEY = 'skladac-rozvrhu-v1';
const BLOCKS = [0, 1, 2, 3, 4, 5]; // 8:00 az 19:40
const PARITY_LABEL = { odd: 'lichý týden', even: 'sudý týden', weekly: '' };

const state = {
  courses: [],
  teacherPrefs: {}, // kód -> { wanted: [], unwanted: [] }
  dayLimit: null,
  blocked: new Set(), // "den|blok"
  exceptions: new Set(), // kódy předmětů s výjimkou z limitu dnů
  anchors: {}, // kód -> id skupiny
  lectureBlock: new Set(), // kódy předmětů s vyhrazením časů přednášek
};

const el = (id) => document.getElementById(id);
const expected = expectedPeriod();

// ---------- persistence (localStorage) ----------

function saveState() {
  const data = {
    courses: state.courses,
    teacherPrefs: state.teacherPrefs,
    dayLimit: state.dayLimit,
    blocked: [...state.blocked],
    exceptions: [...state.exceptions],
    anchors: state.anchors,
    lectureBlock: [...state.lectureBlock],
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    state.courses = data.courses ?? [];
    state.teacherPrefs = data.teacherPrefs ?? {};
    state.dayLimit = data.dayLimit ?? null;
    state.blocked = new Set(data.blocked ?? []);
    state.exceptions = new Set(data.exceptions ?? []);
    state.anchors = data.anchors ?? {};
    state.lectureBlock = new Set(data.lectureBlock ?? []);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

// ---------- pomocníci ----------

function message(kind, text) {
  const div = document.createElement('div');
  div.className = `msg ${kind}`;
  div.textContent = text;
  return div;
}

function timeLabel(block) {
  return `${8 + 2 * block}:00–${8 + 2 * block + 1}:40`;
}

function groupLabel(g) {
  const parity = PARITY_LABEL[g.parity];
  return (
    `${g.number} · ${g.day} ${g.start}–${g.end}` +
    (parity ? ` (${parity})` : '') +
    (g.room ? ` · uč. ${g.room}` : '') +
    (g.teacher ? ` · ${g.teacher}` : '')
  );
}

function courseTeachers(course) {
  // Skupina může mít víc vyučujících najednou — nabízej jednotlivá jména.
  return [
    ...new Set(
      course.groups
        .flatMap((g) => (g.teacher ? g.teacher.split(',') : []))
        .map((t) => t.trim())
        .filter(Boolean)
    ),
  ];
}

function groupHasTeacher(group, teacher) {
  if (!group.teacher) return false;
  return group.teacher.split(',').some((t) => t.trim() === teacher);
}

function teacherStateOf(code, teacher) {
  const p = state.teacherPrefs[code];
  if (p?.wanted?.includes(teacher)) return 'want';
  if (p?.unwanted?.includes(teacher)) return 'avoid';
  return 'neutral';
}

function setTeacherState(code, teacher, value) {
  const p = (state.teacherPrefs[code] ??= { wanted: [], unwanted: [] });
  p.wanted = p.wanted.filter((t) => t !== teacher);
  p.unwanted = p.unwanted.filter((t) => t !== teacher);
  if (value === 'want') p.wanted.push(teacher);
  if (value === 'avoid') p.unwanted.push(teacher);
}

function removeCourse(code) {
  state.courses = state.courses.filter((c) => c.code !== code);
  delete state.teacherPrefs[code];
  delete state.anchors[code];
  state.exceptions.delete(code);
  state.lectureBlock.delete(code);
}

// ---------- nahrávání souborů ----------

async function handleFiles(files) {
  const messages = el('upload-messages');
  messages.replaceChildren();
  for (const file of files) {
    const html = await file.text();
    const r = parseCourseHtml(html);
    if (!r.ok) {
      messages.append(
        message('error', `${file.name}: ${r.errors.join(' ')}`)
      );
      continue;
    }
    const c = r.course;
    // Kontrola semestru (CLAUDE.md 3.3): starší období je chyba,
    // novější se přijme s upozorněním.
    if (periodOrdinal(c.period) < periodOrdinal(expected)) {
      messages.append(
        message(
          'error',
          `${c.code}: stránka je z minulého období (${c.period.raw}, ` +
            `očekává se ${expected.raw}). Předmět nebyl přidán — ulož si ` +
            'aktuální stránku z katalogu.'
        )
      );
      continue;
    }
    if (periodOrdinal(c.period) > periodOrdinal(expected)) {
      messages.append(
        message(
          'warning',
          `${c.code}: stránka je z budoucího období (${c.period.raw}). ` +
            'Přidáno — skládáš rozvrh dopředu.'
        )
      );
    }
    for (const w of r.warnings) {
      messages.append(message('warning', `${c.code}: ${w}`));
    }
    const existing = state.courses.findIndex((x) => x.code === c.code);
    if (existing !== -1) {
      state.courses[existing] = c;
      messages.append(
        message('ok', `${c.code}: znovu nahráno, nahrazena starší verze.`)
      );
    } else {
      state.courses.push(c);
    }
  }
  saveState();
  renderCourses();
}

// ---------- vykreslení předmětů ----------

function renderCourses() {
  // Překreslení dočasně zkrátí stránku a prohlížeč by přiskřípl scroll
  // nahoru — pozici si proto zapamatujeme a hned vrátíme.
  const scrollY = window.scrollY;
  const container = el('courses');
  container.replaceChildren();
  if (state.courses.length === 0) {
    container.append(message('ok', 'Zatím žádné předměty.'));
    return;
  }
  const periods = new Set(state.courses.map((c) => c.period.raw));
  if (periods.size > 1) {
    container.append(
      message(
        'warning',
        `Nahrané předměty se liší obdobím (${[...periods].join(', ')}).`
      )
    );
  }

  for (const c of state.courses) {
    const card = document.createElement('div');
    card.className = 'course';

    const header = document.createElement('div');
    header.className = 'course-header';
    const title = document.createElement('strong');
    title.textContent = `${c.code} — ${c.name}`;
    header.append(title);
    const periodBadge = document.createElement('span');
    periodBadge.className =
      'badge' + (c.period.raw !== expected.raw ? ' warn' : '');
    periodBadge.textContent = c.period.raw;
    header.append(periodBadge);
    if (c.language !== 'Čeština') {
      const lang = document.createElement('span');
      lang.className = 'badge info';
      lang.textContent = c.language;
      header.append(lang);
    }
    if (c.groups.length > 0) {
      const groupsBadge = document.createElement('span');
      groupsBadge.className = 'badge' + (c.singleGroup ? ' info' : '');
      groupsBadge.textContent = c.singleGroup
        ? 'jediná skupina — vždy v rozvrhu'
        : `${c.groups.length} skupin`;
      header.append(groupsBadge);
    } else {
      const noSem = document.createElement('span');
      noSem.className = 'badge';
      noSem.textContent = 'bez seminárních skupin';
      header.append(noSem);
    }
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    header.append(spacer);
    const remove = document.createElement('button');
    remove.className = 'remove-course';
    remove.textContent = 'Odebrat';
    remove.addEventListener('click', () => {
      removeCourse(c.code);
      saveState();
      renderCourses();
    });
    header.append(remove);
    card.append(header);

    const controls = document.createElement('div');
    controls.className = 'course-controls';

    // Preference vyučujících (6.1) — jen skuteční vyučující skupin.
    const teachers = courseTeachers(c);
    if (teachers.length > 0) {
      for (const t of teachers) {
        const row = document.createElement('div');
        row.className = 'teacher-row';
        const name = document.createElement('span');
        name.textContent = t;
        row.append(name);
        const tri = document.createElement('span');
        tri.className = 'tri';
        const current = teacherStateOf(c.code, t);
        for (const [value, label] of [
          ['neutral', 'neutrální'],
          ['want', 'chci'],
          ['avoid', 'nechci'],
        ]) {
          const b = document.createElement('button');
          b.textContent = label;
          b.dataset.value = value;
          if (current === value) b.className = `active-${value}`;
          // Aktualizace na místě, bez překreslení stránky — překreslení by
          // uživatele odhodilo ze scrollované pozice.
          b.addEventListener('click', () => {
            setTeacherState(c.code, t, value);
            saveState();
            for (const sibling of tri.children) sibling.className = '';
            b.className = `active-${value}`;
          });
          tri.append(b);
        }
        row.append(tri);
        row.append(spanNote(noteForTeacher(c, t)));
        controls.append(row);
      }
    }

    // Ukotvení skupiny (5 bod 5) — jen u předmětů s výběrem.
    if (c.groups.length > 1) {
      const row = document.createElement('div');
      const label = document.createElement('span');
      label.className = 'control-label';
      label.textContent = 'Ukotvit skupinu:';
      row.append(label);
      const select = document.createElement('select');
      const none = document.createElement('option');
      none.value = '';
      none.textContent = '— žádná —';
      select.append(none);
      for (const g of c.groups) {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = groupLabel(g);
        select.append(o);
      }
      select.value = state.anchors[c.code] ?? '';
      select.addEventListener('change', () => {
        if (select.value) state.anchors[c.code] = select.value;
        else delete state.anchors[c.code];
        saveState();
      });
      row.append(select);
      controls.append(row);
    }

    // Výjimka z limitu dnů (5.2).
    if (c.groups.length > 0) {
      controls.append(
        checkboxRow(
          'Výjimka z limitu dnů (dny tohoto předmětu se do limitu nepočítají)',
          state.exceptions.has(c.code),
          (checked) => {
            if (checked) state.exceptions.add(c.code);
            else state.exceptions.delete(c.code);
            saveState();
          }
        )
      );
    }

    // Vyhrazení časů přednášek (sekce 7, výchozí stav vypnuto).
    if (c.lectures.length > 0) {
      const lecturesText = c.lectures
        .map(
          (l) =>
            `${l.day} ${l.start}–${l.end}` +
            (l.parity !== 'weekly' ? ` (${PARITY_LABEL[l.parity]})` : '')
        )
        .join(', ');
      const row = checkboxRow(
        `Vyhradit časy přednášek jako blokované (${lecturesText})`,
        state.lectureBlock.has(c.code),
        (checked) => {
          if (checked) state.lectureBlock.add(c.code);
          else state.lectureBlock.delete(c.code);
          saveState();
        }
      );
      if (c.hasIrregularLectures) {
        row.append(
          spanNote(
            '⚠ Přednášky jsou nepravidelné (konkrétní data) — vyhrazení ' +
              'zablokuje všechny jejich časy a značně omezí možnosti.'
          )
        );
      }
      controls.append(row);
    }

    card.append(controls);
    container.append(card);
  }
  window.scrollTo(0, scrollY);
}

function noteForTeacher(course, teacher) {
  const count = course.groups.filter((g) => groupHasTeacher(g, teacher)).length;
  return `(${count} z ${course.groups.length} skupin)`;
}

function spanNote(text) {
  const s = document.createElement('span');
  s.className = 'hint';
  s.textContent = ` ${text}`;
  return s;
}

function checkboxRow(labelText, checked, onChange) {
  const row = document.createElement('div');
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = checked;
  box.addEventListener('change', () => onChange(box.checked));
  label.append(box, ` ${labelText}`);
  row.append(label);
  return row;
}

// ---------- mřížka blokovaných časů ----------

function renderBlockedGrid() {
  const table = el('blocked-grid');
  table.replaceChildren();
  const head = document.createElement('tr');
  head.append(document.createElement('th'));
  for (const day of DAYS) {
    const th = document.createElement('th');
    th.textContent = day;
    head.append(th);
  }
  table.append(head);
  for (const block of BLOCKS) {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.textContent = timeLabel(block);
    tr.append(th);
    for (const day of DAYS) {
      const key = `${day}|${block}`;
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.textContent = state.blocked.has(key) ? 'blokováno' : '·';
      if (state.blocked.has(key)) b.className = 'blocked';
      b.addEventListener('click', () => {
        if (state.blocked.has(key)) state.blocked.delete(key);
        else state.blocked.add(key);
        saveState();
        renderBlockedGrid();
      });
      td.append(b);
      tr.append(td);
    }
    table.append(tr);
  }
}

// ---------- výpočet a výsledky ----------

function buildSettings() {
  const blockedTimes = [];
  for (const key of state.blocked) {
    const [day, block] = key.split('|');
    blockedTimes.push({
      day,
      startMin: 480 + 120 * Number(block),
      endMin: 480 + 120 * (Number(block) + 1),
    });
  }
  for (const code of state.lectureBlock) {
    const course = state.courses.find((c) => c.code === code);
    for (const l of course?.lectures ?? []) {
      blockedTimes.push({
        day: l.day,
        startMin: l.startMin,
        endMin: l.endMin,
        ...(l.parity !== 'weekly' ? { parity: l.parity } : {}),
      });
    }
  }
  return {
    blockedTimes,
    dayLimit: state.dayLimit,
    dayLimitExceptions: [...state.exceptions],
    anchoredGroups: state.anchors,
  };
}

function compute() {
  const status = el('status');
  const results = el('results');
  results.replaceChildren();
  if (state.courses.length === 0) {
    status.replaceChildren(message('error', 'Nejdřív nahraj předměty.'));
    return;
  }
  status.replaceChildren(message('ok', 'Hledám nejlepší varianty…'));
  // setTimeout: ať se stihne vykreslit stav před ~2s výpočtem.
  setTimeout(() => {
    const started = performance.now();
    const r = findVariants(state.courses, buildSettings(), {
      teachers: state.teacherPrefs,
    });
    const elapsed = Math.round(performance.now() - started);
    renderResults(r, elapsed);
  }, 30);
}

function renderResults(r, elapsed) {
  const status = el('status');
  const results = el('results');
  status.replaceChildren();
  results.replaceChildren();

  for (const w of r.warnings) results.append(message('warning', w));

  if (r.status === 'error') {
    for (const e of r.errors) results.append(message('error', e));
    return;
  }
  if (r.status === 'infeasible') {
    // Prostá hláška dle 5.4.
    results.append(
      message('error', 'Žádný platný rozvrh neexistuje. Uber omezení a zkus to znovu.')
    );
    return;
  }

  status.replaceChildren(
    message('ok', `Hotovo za ${elapsed} ms. Nalezené varianty seřazené podle skóre:`)
  );

  r.variants.forEach((v, i) => {
    const card = document.createElement('div');
    card.className = 'variant';

    const header = document.createElement('div');
    header.className = 'variant-header';
    const title = document.createElement('strong');
    title.textContent = `Varianta ${i + 1}`;
    header.append(title);
    const score = document.createElement('span');
    score.className = 'score';
    score.textContent = `skóre ${v.score.total}`;
    header.append(score);
    for (const tag of v.tags) {
      const badge = document.createElement('span');
      badge.className = 'badge info';
      badge.textContent = tag;
      header.append(badge);
    }
    card.append(header);

    // Přehled hodnocení podle kritérií (8.3).
    const b = v.score.breakdown;
    const d = v.score.details;
    const breakdown = document.createElement('div');
    breakdown.className = 'breakdown';
    breakdown.textContent =
      `vyučující ${b.teachers} · dny ${b.days} · tvar dne ${b.shape} · ` +
      `preferované časy ${b.preferredTimes} — dnů lichý/sudý týden: ` +
      `${d.daysOdd}/${d.daysEven}, oken: ${d.windows}, nejdelší řada: ${d.longestRun}`;
    card.append(breakdown);

    const list = document.createElement('ul');
    const sorted = [...v.schedule].sort(
      (a, x) =>
        a.dayIndex - x.dayIndex ||
        a.startMin - x.startMin ||
        a.parity.localeCompare(x.parity)
    );
    for (const g of sorted) {
      const li = document.createElement('li');
      const course = state.courses.find((c) => c.code === g.courseCode);
      const parity = PARITY_LABEL[g.parity];
      li.append(`${g.day} ${g.start}–${g.end} `);
      if (parity) {
        const note = document.createElement('span');
        note.className = 'parity-note';
        note.textContent = `(${parity}) `;
        li.append(note);
      }
      li.append(
        `— ${g.id} ${course ? course.name : ''}` +
          (g.room ? ` · uč. ${g.room}` : '') +
          (g.teacher ? ` · ${g.teacher}` : '')
      );
      list.append(li);
    }
    card.append(list);
    results.append(card);
  });
}

// ---------- start ----------

el('expected-period').textContent = expected.raw;
el('file-input').addEventListener('change', (e) => {
  handleFiles([...e.target.files]);
  e.target.value = '';
});
el('day-limit').addEventListener('change', (e) => {
  state.dayLimit = e.target.value ? Number(e.target.value) : null;
  saveState();
});
el('compute').addEventListener('click', compute);
el('clear-all').addEventListener('click', () => {
  if (!confirm('Opravdu vymazat všechny předměty a nastavení?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state.courses = [];
  state.teacherPrefs = {};
  state.dayLimit = null;
  state.blocked = new Set();
  state.exceptions = new Set();
  state.anchors = {};
  state.lectureBlock = new Set();
  el('day-limit').value = '';
  el('upload-messages').replaceChildren();
  el('results').replaceChildren();
  el('status').replaceChildren();
  renderCourses();
  renderBlockedGrid();
});

loadState();
el('day-limit').value = state.dayLimit ?? '';
renderCourses();
renderBlockedGrid();
