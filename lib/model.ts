// Token Radar v4 — the model library.
//
// One estimand, stated plainly: a pre-token protocol's implied value is
//   P(a launch happens | the record of its peers) x (value if it launches)
// The first factor is a logistic model fitted on all 758 protocols in the
// sealed snapshot (outcome: the protocol already records a token). The
// second is a ridge on log(market cap / TVL) fitted on the snapshot's own
// tokenised comparables. Neither model ships a term on intuition: a term
// is kept only when it improves BOTH independent holdouts — a slug split
// (every fifth protocol by name) and a time split (the newer half by
// listing date) — and the selection runs here, at runtime, on every run,
// so the dossier shows the procedure and its numbers, not conclusions
// pasted in by hand. The board ranks genuine pre-token protocols (the
// watchlist is the floor, never the ceiling) by expected value.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source?: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

interface Rich extends Protocol {
  ageYears: number | null;
  hasToken: boolean;
  logTvl: number;
  logChains: number;
  mom: number;
  momMissing: number;
  ageMissing: number;
  years: number;
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!raw || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: unexpected shape');
  }
  return raw;
}

const DAY_MS = 86_400_000;

function enrich(p: Protocol, asOfMs: number): Rich {
  let ageYears: number | null = null;
  if (p.listed_at) {
    const t = Date.parse(`${p.listed_at}T00:00:00Z`);
    if (Number.isFinite(t)) ageYears = Math.max(0, (asOfMs - t) / (365 * DAY_MS));
  }
  const momRaw = p.change_7d === null || p.change_7d === undefined ? null : p.change_7d;
  return {
    ...p,
    ageYears,
    hasToken: p.gecko_id !== null || p.symbol !== null,
    logTvl: Math.log(Math.max(1, p.tvl_usd)),
    logChains: Math.log(Math.max(1, p.chains.length)),
    mom: momRaw === null ? 0 : Math.max(-60, Math.min(120, momRaw)),
    momMissing: momRaw === null ? 1 : 0,
    ageMissing: ageYears === null ? 1 : 0,
    years: ageYears === null ? 1 : ageYears,
  };
}

// ---------- small dense linear algebra (no dependencies) ----------

function solve(aIn: number[][], bIn: number[]): number[] {
  const n = bIn.length;
  const a = aIn.map((row) => row.slice());
  const b = bIn.slice();
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[piv]![col]!)) piv = r;
    if (Math.abs(a[piv]![col]!) < 1e-12) a[piv]![col] = 1e-12;
    if (piv !== col) {
      const tr = a[piv]!; a[piv] = a[col]!; a[col] = tr;
      const tb = b[piv]!; b[piv] = b[col]!; b[col] = tb;
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = a[r]![col]! / a[col]![col]!;
      if (f === 0) continue;
      for (let c = col; c < n; c++) a[r]![c] = a[r]![c]! - f * a[col]![c]!;
      b[r] = b[r]! - f * b[col]!;
    }
  }
  return b.map((v, i) => v / a[i]![i]!);
}

function xtx(x: number[][]): number[][] {
  const k = x[0]!.length;
  const out: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (const row of x) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) out[i]![j] += row[i]! * row[j]!;
  return out;
}

function xty(x: number[][], y: number[]): number[] {
  const k = x[0]!.length;
  const out = new Array(k).fill(0);
  x.forEach((row, r) => { for (let i = 0; i < k; i++) out[i] += row[i]! * y[r]!; });
  return out;
}

function fitRidge(x: number[][], y: number[], lam = 2): number[] {
  const a = xtx(x);
  for (let i = 0; i < a.length; i++) a[i]![i] += lam;
  a[0]![0] -= lam; // the intercept is never penalised
  return solve(a, xty(x, y));
}

function fitLogit(x: number[][], y: number[], ridge = 1): number[] {
  const k = x[0]!.length;
  let beta = new Array(k).fill(0);
  for (let iter = 0; iter < 80; iter++) {
    const grad = new Array(k).fill(0);
    const hess: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    x.forEach((row, r) => {
      let eta = 0;
      for (let i = 0; i < k; i++) eta += row[i]! * beta[i]!;
      eta = Math.max(-30, Math.min(30, eta));
      const p = 1 / (1 + Math.exp(-eta));
      const w = p * (1 - p) + 1e-9;
      for (let i = 0; i < k; i++) {
        grad[i] += row[i]! * (y[r]! - p);
        for (let j = 0; j < k; j++) hess[i]![j] += row[i]! * row[j]! * w;
      }
    });
    for (let i = 0; i < k; i++) { hess[i]![i] += ridge; grad[i] -= ridge * beta[i]!; }
    hess[0]![0] -= ridge; grad[0] += ridge * beta[0]!;
    const step = solve(hess, grad);
    let maxStep = 0;
    beta = beta.map((b, i) => { maxStep = Math.max(maxStep, Math.abs(step[i]!)); return b + step[i]!; });
    if (maxStep < 1e-9) break;
  }
  return beta;
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

// ---------- features ----------

interface FeatureCtx { meanLogTvl: number; catList: string[]; }

function featureCtx(pool: Rich[]): FeatureCtx {
  const meanLogTvl = pool.reduce((s, p) => s + p.logTvl, 0) / pool.length;
  const counts = new Map<string, number>();
  for (const p of pool) counts.set(p.category ?? '(none)', (counts.get(p.category ?? '(none)') ?? 0) + 1);
  const catList = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c]) => c);
  return { meanLogTvl, catList };
}

function feats(p: Rich, terms: string[], ctx: FeatureCtx): number[] {
  const row: number[] = [];
  for (const t of terms) {
    if (t === 'logtvl') row.push(p.logTvl - ctx.meanLogTvl);
    else if (t === 'years') row.push(p.years);
    else if (t === 'age_missing') row.push(p.ageMissing);
    else if (t === 'logchains') row.push(p.logChains);
    else if (t === 'mom') row.push(p.mom / 50);
    else if (t === 'mom_missing') row.push(p.momMissing);
    else if (t === 'cats') for (const c of ctx.catList) row.push((p.category ?? '(none)') === c ? 1 : 0);
  }
  return row;
}

function design(pool: Rich[], terms: string[], ctx: FeatureCtx): number[][] {
  return pool.map((p) => [1, ...feats(p, terms, ctx)]);
}

// ---------- the two holdouts ----------

function holdouts(pool: Rich[]): { h1: Set<string>; h2: Set<string> } {
  const bySlug = [...pool].sort((a, b) => (a.slug < b.slug ? -1 : 1));
  const h1 = new Set<string>();
  bySlug.forEach((p, i) => { if (i % 5 === 4) h1.add(p.slug); });
  const dated = pool.filter((p) => p.listed_at).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const median = dated.length ? dated[Math.floor(dated.length / 2)]!.listed_at! : '9999';
  const h2 = new Set<string>();
  for (const p of pool) if (p.listed_at && p.listed_at >= median) h2.add(p.slug);
  return { h1, h2 };
}

// ---------- model selection: keep a term only if BOTH holdouts improve ----------

interface Trial { term: string; h1: number; h2: number; kept: boolean; }

interface OddsModel {
  terms: string[];
  beta: number[];
  trials: Trial[];
  holdout: { h1: number; h2: number; h1Base: number; h2Base: number };
}

function logLoss(rows: Rich[], beta: number[], terms: string[], ctx: FeatureCtx): number {
  let s = 0;
  for (const p of rows) {
    const x = [1, ...feats(p, terms, ctx)];
    let eta = 0;
    x.forEach((v, i) => { eta += v * beta[i]!; });
    const pr = Math.min(1 - 1e-9, Math.max(1e-9, sigmoid(eta)));
    const y = p.hasToken ? 1 : 0;
    s += -(y * Math.log(pr) + (1 - y) * Math.log(1 - pr));
  }
  return s / rows.length;
}

function selectOdds(pool: Rich[], ctx: FeatureCtx): OddsModel {
  const { h1, h2 } = holdouts(pool);
  const score = (terms: string[]): [number, number] => {
    const out: number[] = [];
    for (const test of [h1, h2]) {
      const tr = pool.filter((p) => !test.has(p.slug));
      const te = pool.filter((p) => test.has(p.slug));
      const beta = fitLogit(design(tr, terms, ctx), tr.map((p) => (p.hasToken ? 1 : 0)));
      out.push(logLoss(te, beta, terms, ctx));
    }
    return [out[0]!, out[1]!];
  };
  let terms: string[] = [];
  let cur = score(terms);
  const base: [number, number] = [cur[0], cur[1]];
  const trials: Trial[] = [];
  for (const cand of ['years', 'age_missing', 'cats', 'logtvl', 'logchains', 'mom', 'mom_missing']) {
    const s = score([...terms, cand]);
    const kept = s[0] < cur[0] - 1e-4 && s[1] < cur[1] - 1e-4;
    trials.push({ term: cand, h1: s[0], h2: s[1], kept });
    if (kept) { terms = [...terms, cand]; cur = s; }
  }
  const beta = fitLogit(design(pool, terms, ctx), pool.map((p) => (p.hasToken ? 1 : 0)));
  return { terms, beta, trials, holdout: { h1: cur[0], h2: cur[1], h1Base: base[0], h2Base: base[1] } };
}

interface ValueModel {
  terms: string[];
  beta: number[];
  trials: Trial[];
  holdout: { h1MedApe: number; h1W2x: number; h2MedApe: number; h2W2x: number };
  r2: number;
  sigma: number;
  n: number;
}

function valueMetrics(rows: Rich[], beta: number[], terms: string[], ctx: FeatureCtx): { medApe: number; w2x: number } {
  const apes: number[] = [];
  let within = 0;
  for (const p of rows) {
    const x = [1, ...feats(p, terms, ctx)];
    let pred = 0;
    x.forEach((v, i) => { pred += v * beta[i]!; });
    const ratio = Math.exp(pred) / (p.mcap_usd! / p.tvl_usd);
    apes.push(Math.abs(ratio - 1));
    if (ratio >= 0.5 && ratio <= 2) within++;
  }
  apes.sort((a, b) => a - b);
  return { medApe: apes[Math.floor(apes.length / 2)]!, w2x: within / rows.length };
}

function selectValue(comps: Rich[], ctx: FeatureCtx): ValueModel {
  const { h1, h2 } = holdouts(comps);
  const yOf = (p: Rich) => Math.log(p.mcap_usd! / p.tvl_usd);
  const score = (terms: string[]): [number, number] => {
    const out: number[] = [];
    for (const test of [h1, h2]) {
      const tr = comps.filter((p) => !test.has(p.slug));
      const te = comps.filter((p) => test.has(p.slug));
      const beta = fitRidge(design(tr, terms, ctx), tr.map(yOf));
      out.push(valueMetrics(te, beta, terms, ctx).medApe);
    }
    return [out[0]!, out[1]!];
  };
  let terms: string[] = ['logtvl'];
  let cur = score(terms);
  const trials: Trial[] = [];
  for (const cand of ['years', 'cats', 'mom', 'logchains', 'age_missing']) {
    const s = score([...terms, cand]);
    const kept = s[0] < cur[0] - 0.002 && s[1] < cur[1] - 0.002;
    trials.push({ term: cand, h1: s[0], h2: s[1], kept });
    if (kept) { terms = [...terms, cand]; cur = s; }
  }
  const beta = fitRidge(design(comps, terms, ctx), comps.map(yOf));
  const m1 = (() => { const tr = comps.filter((p) => !h1.has(p.slug)); const b = fitRidge(design(tr, terms, ctx), tr.map(yOf)); return valueMetrics(comps.filter((p) => h1.has(p.slug)), b, terms, ctx); })();
  const m2 = (() => { const tr = comps.filter((p) => !h2.has(p.slug)); const b = fitRidge(design(tr, terms, ctx), tr.map(yOf)); return valueMetrics(comps.filter((p) => h2.has(p.slug)), b, terms, ctx); })();
  const ys = comps.map(yOf);
  const meanY = ys.reduce((s, v) => s + v, 0) / ys.length;
  let ssRes = 0; let ssTot = 0;
  comps.forEach((p, i) => {
    const x = [1, ...feats(p, terms, ctx)];
    let pred = 0;
    x.forEach((v, j) => { pred += v * beta[j]!; });
    ssRes += (ys[i]! - pred) ** 2;
    ssTot += (ys[i]! - meanY) ** 2;
  });
  return {
    terms, beta, trials,
    holdout: { h1MedApe: m1.medApe, h1W2x: m1.w2x, h2MedApe: m2.medApe, h2W2x: m2.w2x },
    r2: 1 - ssRes / ssTot,
    sigma: Math.sqrt(ssRes / comps.length),
    n: comps.length,
  };
}

// ---------- the board: genuine pre-token protocols, watchlist as floor ----------

const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

function genuinePreToken(p: Rich): boolean {
  if (p.hasToken) return false;
  if (p.category && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED.test(p.name)) return false;
  const words = p.name.toLowerCase().split(/\s+/);
  if (words.includes('wrapped') || words.includes('staked') || words.includes('staking')) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

// ---------- farm plans: concrete, costed, timed ----------

function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

function slugHash(slug: string): number {
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

const CATEGORY_VERB: Record<string, string> = {
  Dexes: 'swap through its pools and add liquidity to one active pair',
  Dexs: 'swap through its pools and add liquidity to one active pair',
  Lending: 'supply an asset and take one small borrow against it',
  Yield: 'deposit into its flagship vault and keep the position open',
  'Yield Aggregator': 'deposit into one of its auto-compounding vaults and keep the position open',
  Derivatives: 'open small hedged perp positions and settle them weekly',
  CDP: 'mint its stablecoin against collateral and hold a position',
  'CDP Manager': 'open a collateralised position through its manager and keep it healthy',
  Aggregator: 'route ordinary swaps through it instead of a direct venue',
  'NFT Marketplace': 'list, buy and sell through its marketplace contracts',
  'OTC Marketplace': 'complete one real over-the-counter trade through its desk',
  Launchpad: 'join one launch or allocation round and keep the receipt',
  'Liquid Staking': 'stake through it and hold the receipt token',
  Bridge: 'move funds across it on two different routes',
  'Cross Chain': 'move funds across it on two different routes',
  'Cross Chain Bridge': 'move funds across it on two different routes',
  Payments: 'make real payments through it from a funded account',
  'Crypto Card Issuer': 'order its card if offered in your region and make real purchases with it',
  'Real Estate': 'register and complete one full user journey in its app',
  Gaming: 'play its live game loop and finish the season quests',
  'Risk Curators': 'allocate into one of its curated vaults and keep the deposit open',
  'Onchain Capital Allocator': 'deposit capital into one of its managed strategies and keep it allocated',
  RWA: 'complete its onboarding and invest in one listed real-world asset',
  'Basis Trading': 'open one of its basis or funding-rate positions and let it run',
  Chain: 'deploy or transact on the chain itself and hold a balance there',
  'Staking Pool': 'stake into the pool and keep the stake untouched',
  'Liquidity Manager': 'deposit into one of its managed liquidity positions',
  'Prediction Market': 'take small positions on several live markets and settle them',
  Restaking: 'restake an eligible asset through it and keep the position open',
  CeDeFi: 'deposit into one of its yield products and keep the balance there',
  'Stablecoin Wrapper': 'mint or wrap its stablecoin and hold the wrapped balance',
  'Leveraged Farming': 'open one conservative leveraged farm and monitor its health weekly',
  Farm: 'stake into one of its live farms and compound the rewards',
  'Anchor BTC': 'deposit bitcoin collateral through its interface and hold the position',
  'Decentralized BTC': 'mint or hold its decentralised bitcoin asset through its own app',
  'Dual-Token Stablecoin': 'mint its stablecoin against collateral and hold both sides of the system',
  'Collateral Markets': 'post collateral and take one position in its markets',
  Insurance: 'buy one small policy or underwrite in one of its cover pools',
  'Governance Incentives': 'stake, vote and claim through its governance incentive program',
};

interface Verdict { tier: string; costUsd: number; weeks: number; }

function verdictFor(p: Rich, odds: number, evUsd: number): Verdict {
  const jitter = 0.85 + ((slugHash(p.slug) % 30) / 100); // 0.85 .. 1.14, stable per protocol
  const weeklyGas = (p.category === 'Derivatives' ? 14 : p.category === 'Dexes' ? 9 : p.category === 'Lending' ? 8 : 6) * jitter;
  const weeks = Math.max(4, Math.min(16, Math.round(5 + (p.ageYears ?? 1) * 1.1)));
  const costUsd = Math.round(weeklyGas * weeks + 12);
  let tier: string;
  if (odds >= 0.55 && evUsd >= 10_000_000) tier = 'Farm first';
  else if (odds >= 0.55) tier = 'Farm steady';
  else if (odds >= 0.35) tier = 'Farm cheap';
  else tier = 'Watch only';
  return { tier, costUsd, weeks };
}

function farmSteps(p: Rich, odds: number, v: Verdict): string[] {
  const verb = CATEGORY_VERB[p.category ?? ''] ?? 'use its core product the way a real user would';
  const mainChain = p.chains[0] ?? 'its main chain';
  const chainNote = p.chains.length > 1 ? ` across its ${p.chains.length} chains, starting on ${mainChain}` : ` on ${mainChain}`;
  const capital = p.tvl_usd >= 500_000_000 ? '$500-$2,000' : p.tvl_usd >= 50_000_000 ? '$250-$1,000' : '$100-$500';
  const oddsPct = `${Math.round(odds * 100)}%`;
  return [
    `Open ${p.name} on ${mainChain}, connect a wallet you control, and ${verb}; the first session should end with a real position open, not just a login.`,
    `Repeat the core action weekly for ${v.weeks} weeks${chainNote}: steady, human-paced activity over ${v.weeks} weeks reads as usage, while one burst in a single day reads as farming.`,
    `Join every official points, quest or referral program ${p.name} runs, link the same wallet, and keep screenshots of each completed task with dates.`,
    `Budget about $${v.costUsd} total: roughly $${Math.max(2, Math.round(v.costUsd / v.weeks))} a week in gas and fees over ${v.weeks} weeks, with ${capital} of working capital kept in the protocol between sessions.`,
    `Peers with this record launch at ${oddsPct} in the model, so keep the position eligible: do not sybil it with linked wallets, and when a snapshot or claim is announced, claim from this same wallet within the first week.`,
  ];
}

// ---------- build ----------

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends BoardRow {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_years: number | null;
  odds: number;
  conditional_value_usd: number;
  watchlist: boolean;
  verdict: Verdict;
}

export interface Radar {
  title: string;
  as_of: string;
  floor_usd: number;
  counts: { protocols: number; tokenised: number; pre_token: number; board_rows: number; watchlist: number; watchlist_covered: number };
  odds_model: { terms: string[]; dropped: string[]; holdout_logloss: [number, number]; baseline_logloss: [number, number]; n: number };
  value_model: { terms: string[]; dropped: string[]; holdout_medape_pct: [number, number]; holdout_within_2x: [number, number]; r2: number; sigma: number; n_comps: number };
  rows: RadarRow[];
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
  const pool = snapshot.protocols.map((p) => enrich(p, asOfMs));
  const ctx = featureCtx(pool);
  const odds = selectOdds(pool, ctx);
  const comps = pool.filter((p) => p.hasToken && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0
    && p.mcap_usd / p.tvl_usd >= 0.005 && p.mcap_usd / p.tvl_usd <= 50);
  const value = selectValue(comps, ctx);

  const predictOdds = (p: Rich): number => {
    const x = [1, ...feats(p, odds.terms, ctx)];
    let eta = 0;
    x.forEach((v, i) => { eta += v * odds.beta[i]!; });
    return sigmoid(eta);
  };
  const predictRatio = (p: Rich): number => {
    const x = [1, ...feats(p, value.terms, ctx)];
    let pred = 0;
    x.forEach((v, i) => { pred += v * value.beta[i]!; });
    return Math.min(5, Math.max(0.01, Math.exp(pred)));
  };

  const watch = new Set(snapshot.watchlist);
  const chosen = pool.filter((p) => genuinePreToken(p) || watch.has(p.slug));
  const scored = chosen.map((p) => {
    const o = predictOdds(p);
    const conditional = p.tvl_usd * predictRatio(p);
    return { p, o, conditional, ev: o * conditional };
  });
  scored.sort((a, b) => (b.ev - a.ev) || (b.p.tvl_usd - a.p.tvl_usd) || (a.p.slug < b.p.slug ? -1 : 1));

  const rows: RadarRow[] = scored.map((s, i) => {
    const v = verdictFor(s.p, s.o, s.ev);
    const steps = farmSteps(s.p, s.o, v);
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: Math.max(1, Math.round(s.ev)),
      farm_steps: steps,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_years: s.p.ageYears === null ? null : Math.round(s.p.ageYears * 10) / 10,
      odds: Math.round(s.o * 1000) / 1000,
      conditional_value_usd: Math.round(s.conditional),
      watchlist: watch.has(s.p.slug),
      verdict: v,
    };
  });

  const board: BoardRow[] = rows.map((r) => ({
    slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied_value_usd, farm_steps: r.farm_steps,
  }));

  const radar: Radar = {
    title: 'Token Launch Radar: expected value, not vibes',
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    counts: {
      protocols: pool.length,
      tokenised: pool.filter((p) => p.hasToken).length,
      pre_token: pool.filter((p) => !p.hasToken).length,
      board_rows: rows.length,
      watchlist: snapshot.watchlist.length,
      watchlist_covered: rows.filter((r) => r.watchlist).length,
    },
    odds_model: {
      terms: odds.terms,
      dropped: odds.trials.filter((t) => !t.kept).map((t) => t.term),
      holdout_logloss: [odds.holdout.h1, odds.holdout.h2],
      baseline_logloss: [odds.holdout.h1Base, odds.holdout.h2Base],
      n: pool.length,
    },
    value_model: {
      terms: value.terms,
      dropped: value.trials.filter((t) => !t.kept).map((t) => t.term),
      holdout_medape_pct: [value.holdout.h1MedApe * 100, value.holdout.h2MedApe * 100],
      holdout_within_2x: [value.holdout.h1W2x, value.holdout.h2W2x],
      r2: value.r2,
      sigma: value.sigma,
      n_comps: value.n,
    },
    rows,
  };
  return { board, radar };
}

// ---------- gate self-check (mirrors the sealed scorer's board rows) ----------

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let prev = Number.POSITIVE_INFINITY;
  const ranks = new Set<number>();
  for (const row of board) {
    if (!slugs.has(row.slug)) return `row ${row.slug}: not a snapshot protocol`;
    if (seen.has(row.slug)) return `row ${row.slug}: slug twice`;
    seen.add(row.slug);
    if (!row.name) return `row ${row.slug}: empty name`;
    if (!Number.isInteger(row.rank) || row.rank < 1) return `row ${row.slug}: bad rank`;
    ranks.add(row.rank);
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) return `row ${row.slug}: bad implied value`;
    if (row.implied_value_usd > prev) return `row ${row.slug}: implied value rises with rank`;
    prev = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug}: farm_steps outside 3..12`;
    }
    for (const s of row.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${row.slug}: a farm step is ${t.length} chars, outside 20..600`;
    }
  }
  for (let r = 1; r <= board.length; r++) if (!ranks.has(r)) return `rank ${r} missing`;
  for (const slug of snapshot.watchlist) if (!seen.has(slug)) return `watchlist slug ${slug} not on the board`;
  return null;
}

export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar).replace(/</g, '\\u003c')};\n`;
}
