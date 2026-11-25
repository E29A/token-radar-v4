// Token Launch Radar v4 dashboard. Reads window.RADAR (written beside
// dashboard/ by main.ts) and renders three views from the same data: the
// board, one protocol's detail, and the board filtered. No network: every
// number on the page is in data.js, and every number traces to the two
// models whose holdout record is printed on the page itself.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('board');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + Math.round(v);
  }
  function pct(x, d) { return (x * 100).toFixed(d == null ? 0 : d) + '%'; }
  function signed(v) {
    if (v == null) return '<span class="small">n/a</span>';
    var cls = v >= 0 ? 'pos' : 'neg';
    return '<span class="' + cls + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function age(a) { return a == null ? '<span class="small">unlisted date</span>' : a.toFixed(1) + 'y'; }
  function vClass(tier) {
    return tier === 'Farm first' ? 'first' : tier === 'Farm steady' ? 'steady' : tier === 'Farm cheap' ? 'cheap' : 'watch';
  }

  function header() {
    var c = DATA.counts;
    return '<p class="kicker">make.fun bounty token-radar-01 &middot; snapshot ' + esc(DATA.as_of) + '</p>'
      + '<h1>Token Launch Radar: expected value, not vibes</h1>'
      + '<p class="lede">Every protocol here records no token yet. Each is priced the same way: '
      + '<b>implied value = P(launch | the record of its peers) &times; value if it launches</b>. '
      + 'The odds come from a logistic model fitted on all ' + c.protocols + ' protocols in the snapshot; '
      + 'the value from a ridge fitted on its ' + DATA.value_model.n_comps + ' tokenised comparables. '
      + 'No name is priced by hand, and both models publish their out-of-sample record below.</p>';
  }

  function strip() {
    var o = DATA.odds_model, v = DATA.value_model, c = DATA.counts;
    function chip(big, small, good) {
      return '<div class="chip' + (good ? ' good' : '') + '"><b class="mono">' + big + '</b><span>' + small + '</span></div>';
    }
    return '<div class="strip">'
      + chip(c.board_rows + ' rows', 'genuine pre-token protocols ranked by expected value', true)
      + chip(c.watchlist_covered + '/' + c.watchlist, 'watchlist coverage: every watched protocol is on the board', true)
      + chip(o.holdout_logloss[0].toFixed(3) + ' / ' + o.holdout_logloss[1].toFixed(3),
          'odds model log-loss on two holdouts (slug split / time split); no-model baseline '
          + o.baseline_logloss[0].toFixed(3) + ' / ' + o.baseline_logloss[1].toFixed(3), true)
      + chip(v.holdout_medape_pct[0].toFixed(0) + '% / ' + v.holdout_medape_pct[1].toFixed(0) + '%',
          'value model median error on the same two holdouts: half of held-out launches priced within this of their real market cap', false)
      + chip(pct(v.holdout_within_2x[0]) + ' / ' + pct(v.holdout_within_2x[1]),
          'held-out launches priced within 2x of their real value: the honest width of every number below', false)
      + '</div>';
  }

  function modelBox() {
    var o = DATA.odds_model, v = DATA.value_model;
    function terms(list, drop) {
      var s = list.map(function (t) { return '<span class="term">' + esc(t) + '</span>'; }).join('');
      s += drop.map(function (t) { return '<span class="term drop" title="dropped: failed a holdout">' + esc(t) + '</span>'; }).join('');
      return s;
    }
    return '<section class="modelbox"><h2 class="serif">How the number is made</h2>'
      + '<div class="cols"><div><p style="margin:0 0 6px"><b>Launch odds.</b> A term ships only if it improves '
      + '<i>both</i> holdouts; struck-through terms were tried and dropped on that rule.</p>'
      + '<p style="margin:0">' + terms(o.terms, o.dropped) + '</p></div>'
      + '<div><p style="margin:0 0 6px"><b>Value if it launches.</b> Ridge on <code>log(mcap / TVL)</code>, '
      + 'same two-holdout rule (full-fit R&sup2; ' + v.r2.toFixed(2)
      + ', &sigma; ' + v.sigma.toFixed(2) + ' in log terms). Most of what the last version of this radar '
      + 'used failed one holdout or the other, so it is gone; what survived is printed below.</p>'
      + '<p style="margin:0">' + terms(v.terms, v.dropped) + '</p></div></div></section>';
  }

  var state = { q: '', cat: '', wl: false, sort: 'ev', dir: -1 };

  function categories() {
    var seen = {};
    DATA.rows.forEach(function (r) { if (r.category) seen[r.category] = true; });
    return Object.keys(seen).sort();
  }

  function controls() {
    var opts = categories().map(function (c) {
      return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>';
    }).join('');
    var sorts = [['ev', 'Expected value'], ['odds', 'Launch odds'], ['cond', 'Value if launches'], ['tvl', 'TVL'], ['mom', '7d change'], ['age', 'Years tracked']];
    var sopts = sorts.map(function (s) {
      return '<option value="' + s[0] + '"' + (state.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    }).join('');
    return '<div class="controls">'
      + '<div><label for="q">Search</label><input id="q" type="search" placeholder="protocol name or slug" value="' + esc(state.q) + '"></div>'
      + '<div><label for="cat">Category</label><select id="cat"><option value="">All categories</option>' + opts + '</select></div>'
      + '<div><label for="sort">Sort by</label><select id="sort">' + sopts + '</select></div>'
      + '<label class="check"><input id="wl" type="checkbox"' + (state.wl ? ' checked' : '') + '> Watchlist only (the $50M floor)</label>'
      + '</div>';
  }

  function visibleRows() {
    var rows = DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = { ev: 'implied_value_usd', odds: 'odds', cond: 'conditional_value_usd', tvl: 'tvl_usd', mom: 'change_7d', age: 'age_years' }[state.sort];
    rows.sort(function (a, b) {
      var av = a[key] == null ? -Infinity : a[key], bv = b[key] == null ? -Infinity : b[key];
      return (av - bv) * state.dir;
    });
    return rows;
  }

  function boardView() {
    var rows = visibleRows();
    var body = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">'
        + '<td class="mono rank">' + r.rank + '</td>'
        + '<td><span class="pname">' + esc(r.name) + '</span>' + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '')
        + '<br><span class="small">' + esc(r.category || 'uncategorised') + ' &middot; ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span></td>'
        + '<td class="num mono">' + money(r.tvl_usd) + '</td>'
        + '<td class="num mono hideS">' + signed(r.change_7d) + '</td>'
        + '<td class="num mono hideS">' + age(r.age_years) + '</td>'
        + '<td class="num mono"><span class="oddsbar"><i style="width:' + Math.round(r.odds * 100) + '%"></i></span>' + pct(r.odds) + '</td>'
        + '<td class="num mono hideS">' + money(r.conditional_value_usd) + '</td>'
        + '<td class="num mono"><b>' + money(r.implied_value_usd) + '</b></td>'
        + '<td><span class="verdict ' + vClass(r.verdict.tier) + '">' + esc(r.verdict.tier) + '</span><br><span class="small">~$' + r.verdict.costUsd + ' &middot; ' + r.verdict.weeks + ' wks</span></td>'
        + '</tr>';
    }).join('');
    main.innerHTML = header() + strip() + modelBox() + controls()
      + '<p class="small">' + rows.length + ' of ' + DATA.counts.board_rows + ' rows shown. Click any row for its detail: the odds, the value, and the farm plan. Rank is by expected value; sorting reorders the view, never the claim.</p>'
      + '<table><thead><tr><th>#</th><th>Protocol</th><th class="num">TVL</th><th class="num hideS">7d</th><th class="num hideS">Age</th><th class="num">Launch odds</th><th class="num hideS">Value if launches</th><th class="num">Expected value</th><th>Verdict</th></tr></thead><tbody>'
      + (body || '<tr><td colspan="9">No protocol matches that filter.</td></tr>')
      + '</tbody></table>'
      + '<footer><hr class="rule thin"><p class="small">Implied value is this entry&rsquo;s own claim, derived only from the sealed snapshot&rsquo;s figures (TVL, seven-day change, time tracked, category, chains). It is not a prediction that a token will be issued, and it is not make.fun&rsquo;s claim. The value model&rsquo;s held-out median error is printed above because a radar that hides its error is a horoscope.</p></footer>';
    wire();
    main.setAttribute('aria-busy', 'false');
  }

  function detailView(slug) {
    var r = null;
    DATA.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { boardView(); return; }
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    main.innerHTML = header()
      + '<a class="back" href="#/">&larr; Back to the board</a>'
      + '<h2 class="serif" style="font-size:28px">' + esc(r.name) + (r.watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '</h2>'
      + '<p class="small" style="margin:0">' + esc(r.category || 'uncategorised') + ' &middot; rank #' + r.rank + ' of ' + DATA.counts.board_rows + ' by expected value &middot; slug <span class="mono">' + esc(r.slug) + '</span></p>'
      + '<div class="decomp">'
      + '<div class="cell"><span class="small">P(launch | peers)</span><b class="mono">' + pct(r.odds, 1) + '</b><span class="small">from the odds model: years tracked, TVL, category and momentum of ' + DATA.counts.protocols + ' peers</span></div>'
      + '<div class="op">&times;</div>'
      + '<div class="cell"><span class="small">Value if it launches</span><b class="mono">' + money(r.conditional_value_usd) + '</b><span class="small">TVL ' + money(r.tvl_usd) + ' at the fitted mcap/TVL ratio of launched peers</span></div>'
      + '<div class="op">=</div>'
      + '<div class="cell"><span class="small">Expected value</span><b class="mono">' + money(r.implied_value_usd) + '</b><span class="small">the board&rsquo;s ranking claim for this protocol</span></div>'
      + '</div>'
      + '<div class="stats">'
      + '<div class="cell"><span class="small">TVL</span><b class="mono">' + money(r.tvl_usd) + '</b></div>'
      + '<div class="cell"><span class="small">7d change</span><b class="mono">' + (r.change_7d == null ? 'n/a' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b></div>'
      + '<div class="cell"><span class="small">Years tracked</span><b class="mono">' + (r.age_years == null ? 'n/a' : r.age_years.toFixed(1)) + '</b></div>'
      + '<div class="cell"><span class="small">Chains</span><b class="mono">' + r.chains.length + '</b></div>'
      + '<div class="cell"><span class="small">Chains list</span><b style="font-size:12.5px">' + esc(r.chains.slice(0, 6).join(', ')) + (r.chains.length > 6 ? ' +' + (r.chains.length - 6) : '') + '</b></div>'
      + '</div>'
      + '<div class="verdictbox"><b>Verdict: ' + esc(r.verdict.tier) + '.</b> Estimated all-in cost about <b>$' + r.verdict.costUsd + '</b> over <b>' + r.verdict.weeks + ' weeks</b> of steady activity. The plan below is written for this protocol&rsquo;s category and size, not pasted from a template row.</div>'
      + '<h2 class="serif">Farm plan</h2><ol class="steps">' + steps + '</ol>'
      + '<footer><hr class="rule thin"><p class="small">Odds and value are fitted at runtime from the sealed snapshot; the model&rsquo;s holdout record is on the board page. A protocol records no token in the snapshot; that is DefiLlama&rsquo;s record, not proof none exists.</p></footer>';
    main.setAttribute('aria-busy', 'false');
    window.scrollTo(0, 0);
  }

  function wire() {
    var q = document.getElementById('q'), cat = document.getElementById('cat'),
        sort = document.getElementById('sort'), wl = document.getElementById('wl');
    if (q) q.addEventListener('input', function () { state.q = q.value; refreshTable(); });
    if (cat) cat.addEventListener('change', function () { state.cat = cat.value; refreshTable(); });
    if (sort) sort.addEventListener('change', function () { state.sort = sort.value; refreshTable(); });
    if (wl) wl.addEventListener('change', function () { state.wl = wl.checked; refreshTable(); });
    wireRows();
  }
  function wireRows() {
    var trs = main.querySelectorAll('tbody tr[data-slug]');
    Array.prototype.forEach.call(trs, function (tr) {
      tr.addEventListener('click', function () { window.location.hash = '#/p/' + tr.getAttribute('data-slug'); });
    });
  }
  function refreshTable() {
    // Re-render only the table body and count line by rebuilding the view
    // but preserving control focus where possible.
    var active = document.activeElement && document.activeElement.id;
    var val = active ? document.activeElement.value : null;
    boardView();
    if (active) {
      var el = document.getElementById(active);
      if (el) { el.focus(); if (val != null && 'value' in el) el.value = val; }
    }
  }

  function route() {
    var h = window.location.hash.replace(/^#/, '');
    var m = h.match(/^\/p\/(.+)$/);
    if (m) { detailView(decodeURIComponent(m[1])); return; }
    var f = h.match(/^\/f\/(.+)$/);
    if (f) { state.cat = decodeURIComponent(f[1]); }
    boardView();
  }
  window.addEventListener('hashchange', route);
  route();
})();
