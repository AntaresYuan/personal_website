/* ════════════════════════════════════════════════════════════════════════
   usage-page.js — charts for /usage/, the full AI-usage dashboard.

   Standalone on purpose: the homepage's render.js is a big module that also
   owns cards, palette, terminal and QA. This page needs none of that, so it
   ships its own ~1 file of inline-SVG drawing instead of importing it.

   Design rules it follows:
   - Data-driven visibility. A card is shown only when the fetched payload
     actually contains what it needs. Nothing here assumes a field is public;
     USAGE_PUBLISH on the Worker decides, and the page adapts.
   - No charting library. Same yellow quartile ramp as the homepage heatmap,
     drawn with plain SVG so it inherits the site's CSS variables and themes.
   - Owner view is opt-in and ephemeral: a bearer token typed into the unlock
     box lives in sessionStorage for this tab only, and is used solely to call
     the Worker's /detail endpoint.
   ════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const TOKEN_KEY = 'usage-detail-token';
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const $ = (id) => document.getElementById(id);
  const stateEl = $('usage-page-state');
  const summaryEl = $('usage-page-summary');

  /* ── formatting ──────────────────────────────────────────────────── */
  const fmtCompact = (n) => {
    const v = Number(n) || 0;
    if (v >= 1e12) return (v / 1e12).toFixed(1).replace(/\.0$/, '') + 'T';
    if (v >= 1e9) return (v / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(v);
  };
  const fmtDur = (sec) => {
    const s = Math.max(0, Math.round(Number(sec) || 0));
    if (s < 3600) return `${Math.round(s / 60)}m`;
    // Hours stay hours well past a day: "55h" is easier to reason about for
    // working time than "2d", which invites reading it as elapsed calendar
    // time rather than time at the keyboard.
    const h = s / 3600;
    if (h < 1000) return `${h < 10 ? h.toFixed(1) : Math.round(h)}h`;
    return `${Math.round(h).toLocaleString()}h`;
  };
  const fmtDate = (iso) => {
    const d = new Date(iso + 'T00:00:00Z');
    if (isNaN(d)) return iso;
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  };
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Quartile bin over the non-zero values — identical ramp to the homepage so
  // the two heatmaps are visually comparable.
  const bins = (vals) => {
    const nz = vals.filter((v) => v > 0).sort((a, b) => a - b);
    return (v) => {
      if (v <= 0) return -1;
      if (nz.length === 0) return 0;
      const q = (p) => nz[Math.min(nz.length - 1, Math.floor(nz.length * p))];
      if (v <= q(0.25)) return 0;
      if (v <= q(0.5)) return 1;
      if (v <= q(0.75)) return 2;
      return 3;
    };
  };

  const show = (id, captionHtml) => {
    const c = $('ucard-' + id);
    if (c) c.hidden = false;
    if (captionHtml) {
      const cap = $('ucap-' + id);
      if (cap) { cap.innerHTML = captionHtml; cap.hidden = false; }
    }
  };
  const put = (id, svg) => {
    const el = $('uchart-' + id);
    if (el) el.innerHTML = svg;
  };

  /* ── generic chart primitives ────────────────────────────────────── */
  // Horizontal bars for a keyed breakdown — used for tool / model / project
  // and for the tool-category mix.
  //
  // `fmt` exists because the two callers count different things. Token
  // breakdowns want "1.2M"; tool-call counts are small integers where
  // fmtCompact's output ("186") sits ambiguously next to the percentage —
  // reading the two spans together gave "1861%", which is how this was
  // caught. Counts therefore use a thousands separator instead.
  const barList = (rows, totalOverride, fmt) => {
    const total = totalOverride || rows.reduce((a, r) => a + r.value, 0);
    if (total <= 0) return '';
    const val = fmt || fmtCompact;
    return `<ul class="ubars">${rows
      .map((r) => {
        const p = (r.value / total) * 100;
        return `<li class="ubar-row">
          <span class="ubar-label" title="${esc(r.label)}">${esc(r.label)}</span>
          <span class="ubar-track"><span class="ubar-fill" style="width:${p.toFixed(1)}%"></span></span>
          <span class="ubar-value">${val(r.value)}<span class="ubar-pct">${p.toFixed(0)}%</span></span>
        </li>`;
      })
      .join('')}</ul>`;
  };

  // Vertical column chart (hour-of-day, weekday).
  // Width scales with the number of columns so 7 weekday bars don't get
  // stretched into slabs while 24 hour bars stay slim — a fixed 720 viewBox
  // made both look wrong in the same card grid.
  const columns = (values, labels, opts) => {
    const o = opts || {};
    const n = values.length;
    const max = Math.max(...values, 1);
    const perCol = n <= 8 ? 46 : 26;
    const W = Math.max(320, n * perCol);
    const H = Math.round(W * (n <= 8 ? 0.36 : 0.3));
    const padL = 6, padB = 20, padT = 6;
    const gap = n <= 8 ? 8 : 3;
    const bw = (W - padL * 2 - gap * (n - 1)) / n;
    const plotH = H - padB - padT;
    const cells = values.map((v, i) => {
      const h = (v / max) * plotH;
      const x = padL + i * (bw + gap);
      const y = padT + plotH - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" class="ucol${o.highlight === i ? ' is-peak' : ''}"><title>${esc(labels[i])} — ${v.toLocaleString()}</title></rect>`;
    });
    const ticks = labels
      .map((lab, i) =>
        o.everyTick && i % o.everyTick !== 0
          ? ''
          : `<text x="${(padL + i * (bw + gap) + bw / 2).toFixed(1)}" y="${H - 6}" class="ucol-label" text-anchor="middle">${esc(lab)}</text>`
      )
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet" class="uchart-svg">${cells.join('')}${ticks}</svg>`;
  };

  // Stacked proportion bar — the token mix.
  const stacked = (parts) => {
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (total <= 0) return '';
    let x = 0;
    const W = 720, H = 44;
    const segs = parts
      .filter((p) => p.value > 0)
      .map((p, i) => {
        const w = (p.value / total) * W;
        const r = `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}" class="umix umix-${i}"><title>${esc(p.label)} — ${p.value.toLocaleString()} (${pct(p.value, total)}%)</title></rect>`;
        x += w;
        return r;
      })
      .join('');
    const legend = parts
      .filter((p) => p.value > 0)
      .map((p, i) => `<span class="umix-key"><span class="umix-swatch umix-${i}"></span>${esc(p.label)} <strong>${pct(p.value, total)}%</strong></span>`)
      .join('');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="uchart-svg umix-svg">${segs}</svg><div class="umix-legend">${legend}</div>`;
  };

  /* ── individual charts ───────────────────────────────────────────── */
  function drawCalendar(days) {
    const withDate = days.filter((d) => d.date);
    if (!withDate.length) return;
    const activeDays = withDate.filter((d) => (d.tokens || 0) > 0);
    if (!activeDays.length) {
      show('calendar', 'No activity in this window');
      return;
    }

    // Draw only the range that HAS data, plus a little lead-in — not the
    // full 365-day window. The Worker returns a dense zero-padded year, so
    // rendering all of it produced 371 cells of which 40 were real: a wall
    // of empty squares on the left that looked like a layout bug.
    const newest = withDate[withDate.length - 1].date;
    const firstActive = activeDays[0].date;
    const end = new Date(newest + 'T00:00:00Z');
    const firstMs = new Date(firstActive + 'T00:00:00Z').getTime();
    // Start on the Sunday of the first active week so columns stay aligned.
    const startSunday = new Date(firstMs - new Date(firstMs).getUTCDay() * 86400000);
    const spanDays = Math.round((end - startSunday) / 86400000) + 1;
    const cols = Math.max(4, Math.ceil(spanDays / 7));

    const byDate = new Map(withDate.map((d) => [d.date, d]));
    const rows = 7, gap = 3, left = 34, top = 14;
    // The card is a fixed half-column wide, so pick the cell size that fills
    // it for the number of weeks we actually have. A fixed 13px left a
    // 200px-wide calendar floating in a 480px card.
    const targetW = 520;
    const cell = Math.max(10, Math.min(22, Math.floor((targetW - left) / cols) - gap));
    const endDow = end.getUTCDay();
    const bin = bins(activeDays.map((d) => d.tokens || 0));
    const rects = [];
    const months = [];
    let prevMonth = -1;

    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < rows; r++) {
        const daysAgo = endDow - r + 7 * (cols - 1 - c);
        const x = left + c * (cell + gap);
        const y = top + r * (cell + gap);
        const ms = end.getTime() - daysAgo * 86400000;
        // Future days in the current week, and anything before the range.
        if (daysAgo < 0 || ms < startSunday.getTime()) {
          rects.push(`<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" class="usage-cell usage-cell-outside"/>`);
          continue;
        }
        const iso = new Date(ms).toISOString().slice(0, 10);
        const d = byDate.get(iso);
        const v = d ? d.tokens || 0 : 0;
        const b = d ? bin(v) : -1;
        const cls = b < 0 ? 'usage-cell-empty' : `usage-cell-q${b}`;
        rects.push(
          `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" rx="2" class="usage-cell ${cls}"><title>${fmtDate(iso)} — ${v.toLocaleString()} tokens</title></rect>`
        );
        if (r === 0) {
          const m = new Date(iso + 'T00:00:00Z').getUTCMonth();
          if (m !== prevMonth) {
            prevMonth = m;
            months.push(`<text x="${x}" y="${top - 4}" class="ucol-label">${MONTHS[m]}</text>`);
          }
        }
      }
    }
    const dayLabels = [1, 3, 5]
      .map((r) => `<text x="${left - 6}" y="${top + r * (cell + gap) + cell / 2}" class="usage-day-label" text-anchor="end" dominant-baseline="middle">${DAYS[r]}</text>`)
      .join('');
    const w = left + cols * (cell + gap);
    const h = top + rows * (cell + gap);
    put('calendar', `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMinYMin meet" class="uchart-svg" style="--cal-w:${w}px">${months.join('')}${dayLabels}${rects.join('')}</svg>`);

    const span = Math.round((end - new Date(firstMs)) / 86400000) + 1;
    show(
      'calendar',
      `<strong>${activeDays.length}</strong> active days since ${fmtDate(firstActive)} · <strong>${pct(activeDays.length, span)}%</strong> of days in that span`
    );
  }

  function drawRhythm(days) {
    const flat = new Array(168).fill(0);
    let any = false;
    for (const d of days) {
      const v = d.promptWeekHours;
      if (!Array.isArray(v) || v.length !== 168) continue;
      any = true;
      for (let i = 0; i < 168; i++) flat[i] += Number(v[i]) || 0;
    }
    if (!any) return;
    const total = flat.reduce((a, b) => a + b, 0);
    if (total === 0) return;
    const bin = bins(flat.filter((n) => n > 0));
    const cell = 20, gap = 3, left = 30, top = 16;
    const rects = [];
    for (let d = 0; d < 7; d++) {
      for (let hr = 0; hr < 24; hr++) {
        const n = flat[d * 24 + hr];
        const b = bin(n);
        const cls = b < 0 ? 'usage-cell-empty' : `usage-cell-q${b}`;
        rects.push(
          `<rect x="${left + hr * (cell + gap)}" y="${top + d * (cell + gap)}" width="${cell}" height="${cell}" rx="2" class="usage-cell ${cls}"><title>${DAYS[d]} ${String(hr).padStart(2, '0')}:00 — ${n.toLocaleString()} prompts</title></rect>`
        );
      }
    }
    const hourTicks = [];
    for (let hr = 0; hr < 24; hr += 2) {
      hourTicks.push(`<text x="${left + hr * (cell + gap) + cell / 2}" y="12" class="ucol-label" text-anchor="middle">${String(hr).padStart(2, '0')}</text>`);
    }
    const dayLabels = DAYS.map(
      (nm, d) => `<text x="${left - 6}" y="${top + d * (cell + gap) + cell / 2}" class="usage-day-label" text-anchor="end" dominant-baseline="middle">${nm}</text>`
    ).join('');
    const w = left + 24 * (cell + gap);
    const h = top + 7 * (cell + gap);
    put('rhythm', `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMin meet" class="uchart-svg">${hourTicks.join('')}${dayLabels}${rects.join('')}</svg>`);

    let peak = 0, peakIdx = 0, night = 0, weekend = 0;
    flat.forEach((n, i) => {
      if (n > peak) { peak = n; peakIdx = i; }
      const hr = i % 24;
      const dow = Math.floor(i / 24);
      if (hr >= 22 || hr < 6) night += n;
      if (dow === 0 || dow === 6) weekend += n;
    });
    const tz = days.find((d) => Number.isInteger(d.tzOffsetMinutes));
    const tzNote = tz
      ? ` · local time (UTC${tz.tzOffsetMinutes >= 0 ? '+' : '−'}${Math.abs(tz.tzOffsetMinutes / 60)})`
      : '';
    show(
      'rhythm',
      `peak <strong>${DAYS[Math.floor(peakIdx / 24)]} ${String(peakIdx % 24).padStart(2, '0')}:00</strong> · <strong>${pct(night, total)}%</strong> after hours · <strong>${pct(weekend, total)}%</strong> weekend · ${total.toLocaleString()} prompts${tzNote}`
    );

    // Hour-of-day and weekday views reuse the same vector.
    const byHour = new Array(24).fill(0);
    const byDay = new Array(7).fill(0);
    flat.forEach((n, i) => { byHour[i % 24] += n; byDay[Math.floor(i / 24)] += n; });
    const peakHour = byHour.indexOf(Math.max(...byHour));
    put('hours', columns(byHour, byHour.map((_, i) => String(i).padStart(2, '0')), { everyTick: 2, highlight: peakHour }));
    show('hours', `busiest hour <strong>${String(peakHour).padStart(2, '0')}:00</strong> · quietest <strong>${String(byHour.indexOf(Math.min(...byHour))).padStart(2, '0')}:00</strong>`);
    const peakDay = byDay.indexOf(Math.max(...byDay));
    put('weekday', columns(byDay, DAYS, { highlight: peakDay }));
    show('weekday', `busiest day <strong>${DAYS[peakDay]}</strong> · ${barPctLine(byDay)}`);
  }

  const barPctLine = (byDay) => {
    const total = byDay.reduce((a, b) => a + b, 0);
    const wk = byDay[0] + byDay[6];
    return `weekend share <strong>${pct(wk, total)}%</strong>`;
  };

  function drawTrend(days) {
    const byWeek = new Map();
    for (const d of days) {
      if (!d.date) continue;
      const t = new Date(d.date + 'T00:00:00Z');
      const sunday = new Date(t.getTime() - t.getUTCDay() * 86400000).toISOString().slice(0, 10);
      if (!byWeek.has(sunday)) byWeek.set(sunday, { week: sunday, v: 0, cost: 0 });
      const w = byWeek.get(sunday);
      w.v += Number.isFinite(d.totalTokens) && d.totalTokens > 0 ? d.totalTokens : d.tokens || 0;
      w.cost += d.costCents || 0;
    }
    const allWeeks = [...byWeek.values()].sort((a, b) => a.week.localeCompare(b.week));
    // Trim leading zero-weeks. The Worker returns a dense 365-day range, so
    // plotting every week drew a flat line across 42 empty weeks and squeezed
    // the real 11 weeks into the right-hand fifth of the chart.
    const firstReal = allWeeks.findIndex((s) => s.v > 0);
    if (firstReal < 0) return;
    const series = allWeeks.slice(firstReal);
    if (series.length < 2) return;
    const vals = series.map((s) => s.v);
    const max = Math.max(...vals);
    if (max <= 0) return;

    const W = 900, H = 220, padL = 44, padR = 30, padB = 24, padT = 8;
    const plotH = H - padB - padT;
    const stepX = (W - padL - padR) / (series.length - 1);
    const xAt = (i) => padL + i * stepX;
    const yAt = (v) => padT + plotH - (v / max) * plotH;

    // 4-week trailing mean, drawn as a second, calmer line.
    const mean = vals.map((_, i) => {
      const from = Math.max(0, i - 3);
      const slice = vals.slice(from, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    const line = vals.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    const meanLine = mean.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
    const area = `${padL},${(padT + plotH).toFixed(1)} ${line} ${xAt(series.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)}`;

    // y-axis: three gridlines is enough to read magnitude without clutter.
    const grid = [0, 0.5, 1]
      .map((f) => {
        const y = padT + plotH - f * plotH;
        return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${(W - padR).toFixed(1)}" y2="${y.toFixed(1)}" class="ugrid"/><text x="${padL - 6}" y="${(y + 3).toFixed(1)}" class="ucol-label" text-anchor="end">${fmtCompact(max * f)}</text>`;
      })
      .join('');

    // With a trimmed range there's room for a label per week; show one every
    // other week so they don't collide, and include the day so two ticks in
    // the same month stay distinguishable.
    const every = series.length <= 8 ? 1 : Math.ceil(series.length / 8);
    const ticks = series
      .map((s, i) => {
        if (i % every !== 0 && i !== series.length - 1) return '';
        const dt = new Date(s.week + 'T00:00:00Z');
        return `<text x="${xAt(i).toFixed(1)}" y="${H - 6}" class="ucol-label" text-anchor="middle">${MONTHS[dt.getUTCMonth()]} ${dt.getUTCDate()}</text>`;
      })
      .join('');

    const hits = series
      .map((s, i) => {
        const bw = Math.max(6, stepX);
        return `<rect x="${(xAt(i) - bw / 2).toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${plotH.toFixed(1)}" fill="transparent"><title>week of ${fmtDate(s.week)} — ${fmtCompact(s.v)}${s.cost ? ` · $${(s.cost / 100).toFixed(2)}` : ''}</title></rect>`;
      })
      .join('');

    put(
      'trend',
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMin meet" class="uchart-svg">${grid}<polygon points="${area}" class="usage-trend-area"/><polyline points="${line}" class="usage-trend-line" fill="none"/><polyline points="${meanLine}" class="utrend-mean" fill="none"/>${ticks}${hits}</svg>`
    );
    // Exclude the in-progress week from the comparison: on a Monday the
    // newest "week" is one day long, which would read as a collapse rather
    // than as incomplete data.
    const newest = series[series.length - 1].week;
    const weekEndMs = new Date(newest + 'T00:00:00Z').getTime() + 6 * 86400000;
    const complete = Date.now() > weekEndMs + 86400000 ? vals : vals.slice(0, -1);
    const tail = complete.slice(-4);
    const prev = complete.slice(-8, -4);
    const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    let delta = '';
    if (prev.length === 4 && tail.length === 4 && avg(prev) > 0) {
      const d = Math.round(((avg(tail) - avg(prev)) / avg(prev)) * 100);
      delta = ` · last 4 full weeks <strong>${d > 0 ? '+' : ''}${d}%</strong>`;
    }
    show('trend', `${series.length} weeks · peak <strong>${fmtCompact(max)}</strong>${delta}`);
  }

  function drawMix(days) {
    const sum = (f) => days.reduce((a, d) => a + (Number(d[f]) || 0), 0);
    const parts = [
      { label: 'cache read', value: sum('cachedInputTokens') },
      { label: 'cache write', value: sum('cacheCreationInputTokens') },
      { label: 'fresh input', value: sum('inputTokens') },
      { label: 'output', value: sum('outputTokens') },
      { label: 'reasoning', value: sum('reasoningOutputTokens') },
    ];
    const total = parts.reduce((a, p) => a + p.value, 0);
    if (total <= 0) return;
    put('mix', stacked(parts));
    const cached = parts[0].value;
    show('mix', `<strong>${fmtCompact(total)}</strong> tokens · <strong>${pct(cached, total)}%</strong> served from cache`);
  }

  function drawDim(id, days, dim, label) {
    const totals = new Map();
    for (const d of days) {
      const m = d[dim];
      if (!m || typeof m !== 'object') continue;
      for (const k of Object.keys(m)) {
        const v = Number(m[k] && m[k].totalTokens) || 0;
        totals.set(k, (totals.get(k) || 0) + v);
      }
    }
    if (!totals.size) return;
    const rows = [...totals.entries()]
      .map(([k, v]) => ({ label: k || '(none)', value: v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 12);
    if (!rows.length || rows.every((r) => r.value === 0)) return;
    put(id, barList(rows));
    show(id, `${totals.size} ${label}${totals.size === 1 ? '' : 's'} · top: <strong>${esc(rows[0].label)}</strong>`);
  }

  function drawSessions(days) {
    const withData = days.filter((d) => (d.sessions || 0) > 0);
    if (!withData.length) return;
    const hasActive = withData.some((d) => Number.isFinite(d.activeSeconds) && d.activeSeconds > 0);
    if (!hasActive) return;
    const vals = withData.map((d) => d.activeSeconds || 0);
    put('sessions', columns(vals, withData.map((d) => fmtDate(d.date)), { everyTick: Math.max(1, Math.ceil(withData.length / 12)) }));
    const totalActive = vals.reduce((a, b) => a + b, 0);
    const sessions = withData.reduce((a, d) => a + (d.sessions || 0), 0);
    const msgs = withData.reduce((a, d) => a + (d.messageCount || 0), 0);
    const perSession = sessions > 0 ? totalActive / sessions : 0;
    show(
      'sessions',
      `<strong>${fmtDur(totalActive)}</strong> active across <strong>${sessions.toLocaleString()}</strong> sessions · <strong>${fmtDur(perSession)}</strong> average per session${msgs ? ` · ${msgs.toLocaleString()} messages` : ''}`
    );
  }

  /* Tool mix — what the work consisted of, not how many tokens it cost.
     The categories are fixed by the collector (see usage-sources.js); no
     tool, MCP-server or skill NAME ever reaches the browser, which is why
     this can be public at all.

     Uses barList rather than the stacked bar because these are counts on a
     single scale where the ordering is the story, and because `shell`
     dominates so heavily that a stacked bar would render the other six
     categories as invisible slivers. */
  function drawTools(days) {
    const CATS = ['shell', 'edit', 'read', 'browser', 'search', 'task', 'other'];
    const totals = {};
    let mcp = 0;
    let anyDay = false;
    for (const d of days) {
      const tc = d.toolCounts;
      if (!tc || typeof tc !== 'object') continue;
      anyDay = true;
      for (const k of CATS) totals[k] = (totals[k] || 0) + (Number(tc[k]) || 0);
      mcp += Number(tc.mcp) || 0;
    }
    if (!anyDay) return;
    const rows = CATS
      .map((k) => ({ label: k, value: totals[k] || 0 }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    const total = rows.reduce((a, r) => a + r.value, 0);
    if (total <= 0) return;
    put('tools', barList(rows, total, (n) => n.toLocaleString()));
    // `mcp` is cross-cutting, not a category, so it's reported as a share of
    // the same total rather than added to it.
    const mcpNote = mcp > 0 ? ` · <strong>${pct(mcp, total)}%</strong> through MCP servers` : '';
    show('tools', `<strong>${total.toLocaleString()}</strong> tool calls${mcpNote}`);
  }

  function drawSummary(days, updated) {
    const sum = (f) => days.reduce((a, d) => a + (Number(d[f]) || 0), 0);
    const total = sum('totalTokens') || sum('tokens');
    const items = [
      { k: 'tokens', v: fmtCompact(total) },
      { k: 'sessions', v: sum('sessions').toLocaleString() },
    ];
    if (sum('costCents') > 0) items.push({ k: 'spend', v: '$' + (sum('costCents') / 100).toFixed(0) });
    if (sum('activeSeconds') > 0) items.push({ k: 'at keyboard', v: fmtDur(sum('activeSeconds')) });
    const active = days.filter((d) => (d.tokens || 0) > 0).length;
    items.push({ k: 'active days', v: String(active) });
    if (summaryEl) {
      summaryEl.innerHTML = items
        .map((i) => `<span class="ustat"><strong>${i.v}</strong><span class="ustat-k">${i.k}</span></span>`)
        .join('');
    }
    if (stateEl) {
      const when = updated ? new Date(updated) : null;
      stateEl.textContent = when && !isNaN(when)
        ? `Updated ${when.toLocaleString()} · ${days.length} days in window`
        : `${days.length} days in window`;
    }
  }

  /* ── data loading ────────────────────────────────────────────────── */
  function render(payload) {
    const days = Array.isArray(payload.days) ? payload.days : [];
    if (!days.length) {
      if (stateEl) stateEl.textContent = 'No usage data published yet.';
      return;
    }
    drawSummary(days, payload.updated);
    drawCalendar(days);
    drawRhythm(days);
    drawTrend(days);
    drawMix(days);
    drawTools(days);
    drawDim('source', days, 'bySource', 'tool');
    drawDim('model', days, 'byModel', 'model');
    drawDim('project', days, 'byProject', 'project');
    drawSessions(days);
  }

  async function loadConfig() {
    const res = await fetch('/content/site.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('site.json ' + res.status);
    const site = await res.json();
    const cfg = site && site.usage;
    if (!cfg || cfg.enabled === false || !cfg.endpoint) throw new Error('usage disabled');
    return cfg.endpoint.replace(/\/+$/, '');
  }

  async function load(endpoint, token) {
    const url = token ? `${endpoint}/detail?days=365` : `${endpoint}/`;
    const opts = { cache: 'no-store' };
    if (token) opts.headers = { authorization: `Bearer ${token}` };
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error('http ' + res.status);
    return res.json();
  }

  /* ── copy buttons in the "Add a device" section ──────────────────── */
  function wireCopy() {
    var btns = document.querySelectorAll('.ucli-cmd[data-copy]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        var label = btn.querySelector('.ucli-copy');
        var timer = null;
        btn.addEventListener('click', function () {
          var text = btn.getAttribute('data-copy') || '';
          var done = function (ok) {
            if (!label) return;
            label.textContent = ok ? 'copied' : 'select it';
            btn.classList.toggle('is-copied', ok);
            if (timer) clearTimeout(timer);
            timer = setTimeout(function () {
              label.textContent = 'copy';
              btn.classList.remove('is-copied');
            }, 1600);
          };
          /* navigator.clipboard is undefined on http:// origins other than
             localhost, so a plain-HTTP preview would throw here. Fall back to
             selecting the text rather than failing silently — the visitor can
             still copy it by hand, and the label says so. */
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
          } else {
            try {
              var r = document.createRange();
              r.selectNodeContents(btn.querySelector('code'));
              var sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(r);
            } catch (e) { /* noop */ }
            done(false);
          }
        });
      })(btns[i]);
    }
  }

  /* ── owner unlock ────────────────────────────────────────────────── */
  function wireUnlock(endpoint) {
    const form = $('usage-unlock-form');
    const input = $('usage-unlock-input');
    const clear = $('usage-unlock-clear');
    const state = $('usage-unlock-state');
    if (!form || !input) return;

    const say = (msg, ok) => {
      if (!state) return;
      state.textContent = msg;
      state.hidden = false;
      state.className = 'usage-unlock-state' + (ok ? ' is-ok' : ' is-err');
    };

    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const token = input.value.trim();
      if (!token) return;
      say('Checking…', true);
      try {
        const data = await load(endpoint, token);
        // sessionStorage, not localStorage: the token dies with the tab.
        try { sessionStorage.setItem(TOKEN_KEY, token); } catch (e) {}
        input.value = '';
        render(data);
        say('Unlocked — showing private detail for this tab only.', true);
      } catch (e) {
        say('That token was rejected (' + e.message + ').', false);
      }
    });

    if (clear) {
      clear.addEventListener('click', async () => {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (e) {}
        say('Cleared — back to the public view.', true);
        try { render(await load(endpoint, null)); } catch (e) {}
      });
    }
  }

  /* ── boot ────────────────────────────────────────────────────────── */
  (async () => {
    /* Before loadConfig: the copy buttons are static markup and must keep
       working even when usage tracking isn't configured or the fetch fails --
       the early `return` below would otherwise leave them dead. */
    wireCopy();
    let endpoint;
    try {
      endpoint = await loadConfig();
    } catch (e) {
      if (stateEl) stateEl.textContent = 'Usage tracking is not configured on this site.';
      return;
    }
    wireUnlock(endpoint);
    let token = null;
    try { token = sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
    try {
      render(await load(endpoint, token));
    } catch (e) {
      // A stale token shouldn't strand the page on an error — fall back to
      // the public feed, which is what an ordinary visitor sees anyway.
      if (token) {
        try { sessionStorage.removeItem(TOKEN_KEY); } catch (e2) {}
        try {
          render(await load(endpoint, null));
          return;
        } catch (e2) { /* fall through */ }
      }
      if (stateEl) stateEl.textContent = 'Could not load usage data (' + e.message + ').';
    }
  })();
})();
