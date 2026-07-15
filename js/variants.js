/**
 * Výběr obodovaných variant rozvrhu (CLAUDE.md 8.1 nad sekcemi 5 a 6).
 *
 * Všech přípustných kombinací mohou být miliardy, takže se nevyjmenovávají:
 * prohledává se do hloubky s ořezáváním podle horní meze skóre (branch and
 * bound). Mez je korektní díky monotonii postihů:
 *
 *  - aditivní příspěvky (vyučující, preferované časy) mají známé maximum
 *    pro každý dosud neumístěný předmět,
 *  - tvar dne nikdy nepřidá kladné body (optimisticky nula),
 *  - postih za dny jen roste; navíc každý (týden, den) pojme nejvýše
 *    blocksPerDay bloků, takže když se zbývající semináře nevejdou do volné
 *    kapacity už obsazených dnů, je spočitatelné, kolik nových dnů si
 *    vynutí, a mez se o ně bezpečně zpřísní.
 *
 * Kapacitní stav (obsazenost dnů) se udržuje přírůstkově při volbě a návratu,
 * mez je tak O(1) na uzel.
 */

import {
  groupsConflict,
  countDays,
  prepareDomains,
  orderDomains,
} from './solver.js';
import {
  DEFAULT_PARAMS,
  scoreSchedule,
  groupAdditiveScore,
  groupBlocks,
} from './scoring.js';

/**
 * Najde až 5 variant rozvrhu dle výchozí skladby 8.1: tři nejvyšší celkové
 * skóre, jedna optimalizovaná na vyučující, jedna nejkompaktnější; seřazené
 * podle skóre. Překryvy skladby se doplní dalšími nejlepšími podle skóre.
 *
 * courses, settings: stejné jako u solve (js/solver.js).
 * prefs: viz groupAdditiveScore (js/scoring.js).
 * options: {
 *   params:       přepis DEFAULT_PARAMS,
 *   keep:         kolik nejlepších řešení držet během hledání (výchozí 16),
 *   nodeLimit:    pojistka rozsahu prohledávání (výchozí 2 000 000 uzlů),
 *   blocksPerDay: kapacita dne pro mez (výchozí 6 bloků),
 * }
 *
 * Vrací { status, errors, warnings, variants, truncated, nodesExplored },
 * variants: [{ schedule, score, tags }].
 */
export function findVariants(courses, settings = {}, prefs = {}, options = {}) {
  const params = { ...DEFAULT_PARAMS, ...(options.params ?? {}) };
  const { dayLimit = null } = settings;

  const prep = prepareDomains(courses, settings);
  const base = { errors: prep.errors, warnings: prep.warnings, variants: [] };
  if (prep.errors.length > 0) return { status: 'error', ...base };
  if (prep.infeasible) return { status: 'infeasible', ...base };
  const { exemptCodes } = prep;
  const { sorted: domains, exemptCount } = orderDomains(prep.domains, exemptCodes);

  // Aditivní skóre skupin předem; slibné skupiny první, aby se dobrá řešení
  // našla brzy a mez začala ořezávat co nejdřív.
  const additiveOf = new Map();
  const blocksOf = new Map();
  for (const d of domains) {
    for (const g of d.groups) {
      additiveOf.set(g.id, groupAdditiveScore(g, prefs, params).total);
      blocksOf.set(g.id, groupBlocks(g, params).length);
    }
    // Skupiny se stejným dnem, paritou, časem i aditivním skóre jsou pro
    // celkové skóre zaměnitelné (liší se jen místností) — do prohledávání
    // stačí jedna z nich. Varianty se pak liší v čase, ne v místnostech.
    const byShape = new Map();
    for (const g of d.groups) {
      const key = `${g.day}|${g.parity}|${g.startMin}|${g.endMin}|${additiveOf.get(g.id)}`;
      if (!byShape.has(key)) byShape.set(key, g);
    }
    d.groups = [...byShape.values()].sort(
      (a, b) => additiveOf.get(b.id) - additiveOf.get(a.id)
    );
  }
  // Optimistický zbytek aditivních příspěvků od i-tého předmětu dál.
  const suffixOptimistic = new Array(domains.length + 1).fill(0);
  for (let i = domains.length - 1; i >= 0; i--) {
    suffixOptimistic[i] =
      suffixOptimistic[i + 1] +
      Math.max(...domains[i].groups.map((g) => additiveOf.get(g.id)));
  }
  // Minimum bloko-slotů, které zbývající předměty ještě potřebují
  // (týdenní skupina zabírá slot v obou týdnech).
  const blocksPerDay = options.blocksPerDay ?? 6;
  const suffixMinSlots = new Array(domains.length + 1).fill(0);
  for (let i = domains.length - 1; i >= 0; i--) {
    suffixMinSlots[i] =
      suffixMinSlots[i + 1] +
      Math.min(
        ...domains[i].groups.map(
          (g) => blocksOf.get(g.id) * (g.parity === 'weekly' ? 2 : 1)
        )
      );
  }

  const keep = options.keep ?? 16;
  const nodeLimit = options.nodeLimit ?? 2000000;

  // top: vzestupně podle skóre, top[0] je nejhorší z držených.
  const top = [];
  let bestTeachers = null;
  let bestCompact = null;
  let nodes = 0;
  let truncated = false;

  const compactnessOf = (entry) =>
    entry.score.breakdown.days + entry.score.breakdown.shape;

  const record = (chosen) => {
    if (dayLimit != null) {
      for (const parityKey of ['odd', 'even']) {
        if (countDays(chosen, parityKey, exemptCodes) > dayLimit) return;
      }
    }
    const entry = {
      schedule: chosen.slice(),
      score: scoreSchedule(chosen, prefs, params),
    };
    if (top.length < keep || entry.score.total > top[0].score.total) {
      top.push(entry);
      top.sort((a, b) => a.score.total - b.score.total);
      if (top.length > keep) top.shift();
    }
    if (
      !bestTeachers ||
      entry.score.breakdown.teachers > bestTeachers.score.breakdown.teachers ||
      (entry.score.breakdown.teachers === bestTeachers.score.breakdown.teachers &&
        entry.score.total > bestTeachers.score.total)
    ) {
      bestTeachers = entry;
    }
    if (
      !bestCompact ||
      compactnessOf(entry) > compactnessOf(bestCompact) ||
      (compactnessOf(entry) === compactnessOf(bestCompact) &&
        entry.score.total > bestCompact.score.total)
    ) {
      bestCompact = entry;
    }
  };

  const withinDayLimit = (chosen, candidate) => {
    if (dayLimit == null) return true;
    for (const parityKey of ['odd', 'even']) {
      if (countDays([...chosen, candidate], parityKey, exemptCodes) > dayLimit) {
        return false;
      }
    }
    return true;
  };

  // Přírůstkový kapacitní stav: obsazené bloky na (týden, den), počet
  // rozsvícených dnů a volná kapacita v nich. Příspěvek dne do kapacity je
  // max(0, blocksPerDay - obsazeno), nerozsvícený den nepřispívá.
  const occupancy = new Map();
  let litDays = 0;
  let freeCapacity = 0;
  const capacityOf = (used) =>
    used > 0 ? Math.max(0, blocksPerDay - used) : 0;
  const weeksOf = (g) => (g.parity === 'weekly' ? ['odd', 'even'] : [g.parity]);
  const applyGroup = (g, sign) => {
    const blocks = blocksOf.get(g.id) * sign;
    for (const week of weeksOf(g)) {
      const key = `${week}|${g.day}`;
      const prev = occupancy.get(key) ?? 0;
      const next = prev + blocks;
      occupancy.set(key, next);
      freeCapacity += capacityOf(next) - capacityOf(prev);
      if (prev === 0 && next > 0) litDays++;
      if (prev > 0 && next === 0) litDays--;
    }
  };
  const introducesNewDay = (g) =>
    weeksOf(g).some((week) => !(occupancy.get(`${week}|${g.day}`) > 0));

  const chosen = [];
  const dfs = (i, additive) => {
    if (truncated) return;
    if (++nodes > nodeLimit) {
      truncated = true;
      return;
    }
    if (i === domains.length) {
      record(chosen);
      return;
    }
    if (top.length === keep) {
      const extraDays = Math.max(
        0,
        Math.ceil((suffixMinSlots[i] - freeCapacity) / blocksPerDay)
      );
      const bound =
        additive +
        suffixOptimistic[i] +
        params.dayPenalty * (litDays + extraDays);
      if (bound <= top[0].score.total) return;
    }
    // Skupiny na už obsazených dnech napřed: kompaktní (dobře skórující)
    // rozvrhy se najdou brzy a mez pak ořezává agresivněji. Stabilní rozklad
    // zachová pořadí podle aditivního skóre uvnitř obou částí.
    const groups = domains[i].groups;
    for (let pass = 0; pass < 2; pass++) {
      for (const g of groups) {
        // 1. průchod: skupiny na už obsazených dnech, 2. průchod: zbytek.
        if ((pass === 0) === introducesNewDay(g)) continue;
        if (chosen.some((c) => groupsConflict(c, g))) continue;
        if (i >= exemptCount && !withinDayLimit(chosen, g)) continue;
        chosen.push(g);
        applyGroup(g, 1);
        dfs(i + 1, additive + additiveOf.get(g.id));
        applyGroup(g, -1);
        chosen.pop();
        if (truncated) return;
      }
    }
  };
  dfs(0, 0);

  if (top.length === 0) {
    return {
      status: 'infeasible',
      errors: [],
      warnings: prep.warnings,
      variants: [],
      truncated,
      nodesExplored: nodes,
    };
  }

  // Výchozí skladba 8.1: 3× nejvyšší skóre + vyučující + nejkompaktnější.
  // Poznámka: bestTeachers/bestCompact se sledují jen mezi dokončenými
  // řešeními; větev ořezaná kvůli beznadějnému celkovému skóre se nedokončí,
  // extrém čistě v jedné ose tedy může uniknout. Váhy vyučujících i
  // kompaktnosti jsou ale zároveň hlavní složky celkového skóre, takže
  // prakticky zůstávají v horní části prostoru, kterou mez propouští.
  const byTotalDesc = [...top].sort((a, b) => b.score.total - a.score.total);
  const keyOf = (e) => e.schedule.map((g) => g.id).sort().join('|');
  const picked = [];
  const pickedByKey = new Map();
  const push = (entry, tag) => {
    if (!entry) return;
    const key = keyOf(entry);
    const existing = pickedByKey.get(key);
    if (existing) {
      if (!existing.tags.includes(tag)) existing.tags.push(tag);
      return;
    }
    const withTags = { schedule: entry.schedule, score: entry.score, tags: [tag] };
    picked.push(withTags);
    pickedByKey.set(key, withTags);
  };
  for (const e of byTotalDesc.slice(0, 3)) push(e, 'skóre');
  push(bestTeachers, 'vyučující');
  push(bestCompact, 'kompaktnost');
  for (const e of byTotalDesc) {
    if (picked.length >= 5) break;
    push(e, 'skóre');
  }
  picked.sort((a, b) => b.score.total - a.score.total);

  return {
    status: 'ok',
    errors: [],
    warnings: prep.warnings,
    variants: picked.slice(0, 5),
    truncated,
    nodesExplored: nodes,
  };
}
