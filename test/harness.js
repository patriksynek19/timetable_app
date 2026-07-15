/** Minimální testovací harness pro testy spouštěné v prohlížeči. */

export const results = [];

export function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, error: String(e.message ?? e) });
  }
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg}: očekáváno ${b}, dostal ${a}`);
}

/** Vykreslí výsledky do seznamů podle prefixu názvu testu. */
export function renderResults() {
  const lists = {
    SOLVER: document.getElementById('solver'),
    REAL: document.getElementById('real'),
  };
  const unitList = document.getElementById('unit');
  for (const r of results) {
    const li = document.createElement('li');
    li.className = r.ok ? 'pass' : 'fail';
    li.textContent = r.ok ? `✓ ${r.name}` : `✗ ${r.name} — ${r.error}`;
    const prefix = r.name.split(' ')[0].replace(':', '');
    (lists[prefix] ?? unitList).appendChild(li);
  }
  const failed = results.filter((r) => !r.ok).length;
  const summary = document.getElementById('summary');
  summary.textContent =
    failed === 0
      ? `Vše prošlo: ${results.length} testů ✓`
      : `SELHALO ${failed} z ${results.length} testů`;
  summary.className = failed === 0 ? 'pass' : 'fail';
  document.title = failed === 0 ? 'Testy: OK' : `Testy: ${failed} FAIL`;
}
