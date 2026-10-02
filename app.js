import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const db = createClient(SUPABASE_URL, SUPABASE_KEY);
const view = document.getElementById('view');
const ACTIVE_KEY = 'activeRoundId';

// ---------- small helpers ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmtPar = (n) => (n > 0 ? `+${n}` : n === 0 ? 'E' : `${n}`);
const parClass = (n) => (n < 0 ? 'under' : n > 0 ? 'over' : 'even');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const fmtDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const CATEGORIES = ['Distance Driver', 'Fairway Driver', 'Midrange', 'Putter'];
const CAT_CLASS = { 'Distance Driver': 'dd', 'Fairway Driver': 'fd', Midrange: 'mr', Putter: 'pt' };
const flight = (d) => [d.speed, d.glide, d.turn, d.fade].map((v) => (v == null ? '–' : +v)).join(' | ');

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Every Supabase call goes through here so errors are shown instead of silently ignored.
async function q(promise) {
  const { data, error } = await promise;
  if (error) {
    toast(error.message);
    throw error;
  }
  return data;
}

const getActive = () => {
  try { return Number(localStorage.getItem(ACTIVE_KEY)) || null; } catch { return null; }
};
const setActive = (id) => {
  try { id ? localStorage.setItem(ACTIVE_KEY, id) : localStorage.removeItem(ACTIVE_KEY); } catch { /* storage blocked */ }
};

// ---------- router ----------

const routes = { plan: renderPlan, play: renderPlay, stats: renderStats, bag: renderBag };

async function route() {
  const [tab = 'plan', ...rest] = location.hash.replace(/^#\/?/, '').split('/');
  const render = routes[tab] || renderPlan;
  document.querySelectorAll('.tabs button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === (routes[tab] ? tab : 'plan')));
  view.innerHTML = '<p class="muted">Loading…</p>';
  window.scrollTo(0, 0);
  try {
    await render(...rest);
  } catch (e) {
    console.error(e);
    view.innerHTML = `<div class="card empty">Something went wrong: ${esc(e.message)}</div>`;
  }
}
const go = (hash) => (location.hash === hash ? route() : (location.hash = hash));

document.querySelectorAll('.tabs button').forEach((b) =>
  b.addEventListener('click', () => go(`#${b.dataset.tab}`)));
window.addEventListener('hashchange', route);

// ---------- PLAN YOUR BAG ----------

async function renderPlan(courseId) {
  if (courseId) return renderCourse(Number(courseId));

  const courses = await q(db.from('course_layout_stats').select('*').order('course_name'));
  view.innerHTML = `
    <h2>Plan your bag</h2>
    <p class="muted small">Pick a course to see its layout and choose discs.</p>
    <input type="search" id="search" placeholder="Search ${courses.length} Utah courses or cities…" autocomplete="off">
    <div class="card" style="margin-top:12px"><ul class="list" id="courses"></ul></div>`;

  const list = document.getElementById('courses');
  const draw = (term = '') => {
    const t = term.trim().toLowerCase();
    const rows = courses
      .filter((c) => !t || c.course_name.toLowerCase().includes(t) || (c.city || '').toLowerCase().includes(t))
      // courses with hole data first, since those are the ones you can score
      .sort((a, b) => (b.mapped_holes > 0) - (a.mapped_holes > 0) || a.course_name.localeCompare(b.course_name));
    list.innerHTML = rows.length
      ? rows.map((c) => `
        <li data-id="${c.course_id}">
          <div><b>${esc(c.course_name)}</b><div class="muted small">${esc(c.city)}</div></div>
          <div>${c.mapped_holes
            ? `<span class="pill">${c.mapped_holes} holes · par ${c.total_par}</span>`
            : `<span class="pill gray">${c.holes_count ?? '?'} holes</span>`}</div>
        </li>`).join('')
      : '<li class="muted">No courses match.</li>';
  };
  draw();
  document.getElementById('search').addEventListener('input', (e) => draw(e.target.value));
  list.addEventListener('click', (e) => {
    const li = e.target.closest('li[data-id]');
    if (li) go(`#plan/${li.dataset.id}`);
  });
}

async function renderCourse(courseId) {
  const [course] = await q(db.from('course_layout_stats').select('*').eq('course_id', courseId));
  if (!course) { view.innerHTML = '<div class="card empty">Course not found.</div>'; return; }
  const [holes, discs, lastBag] = await Promise.all([
    q(db.from('holes').select('*').eq('course_id', courseId).order('hole_number')),
    q(db.from('discs').select('*').order('speed', { ascending: false })),
    lastRoundBag(),
  ]);

  const hasHoles = holes.length > 0;
  const long = holes.filter((h) => h.distance_feet >= 400).length;
  const mid = holes.filter((h) => h.distance_feet >= 300 && h.distance_feet < 400).length;
  const short = holes.filter((h) => h.distance_feet < 300).length;

  view.innerHTML = `
    <a href="#plan" class="muted small">← All courses</a>
    <h2>${esc(course.course_name)}</h2>
    <p class="muted" style="margin-top:-8px">${esc(course.city)}</p>

    ${hasHoles ? `
    <div class="card">
      <h3>Layout</h3>
      <div class="metrics">
        <div class="metric"><b>${course.avg_feet}</b><span>avg ft</span></div>
        <div class="metric"><b>${course.min_feet}</b><span>shortest ft</span></div>
        <div class="metric"><b>${course.max_feet}</b><span>longest ft</span></div>
        <div class="metric"><b>${course.mapped_holes}</b><span>holes</span></div>
        <div class="metric"><b>${course.total_par}</b><span>par</span></div>
        <div class="metric"><b>${course.total_feet.toLocaleString()}</b><span>total ft</span></div>
      </div>
      <p class="small muted">${long} long (400+ ft) · ${mid} medium (300–399) · ${short} short (&lt;300)</p>
      <div class="holebars">
        ${holes.map((h) => `
          <div class="holebar">
            <span class="muted">${h.hole_number}</span>
            <div class="track"><div class="fill ${h.distance_feet >= 400 ? 'long' : h.distance_feet < 300 ? 'short' : ''}"
              style="width:${Math.round((h.distance_feet / course.max_feet) * 100)}%"></div></div>
            <span>${h.distance_feet} ft · ${h.par}</span>
          </div>`).join('')}
      </div>
    </div>` : `
    <div class="card empty">No hole-by-hole data for this course yet, so it can't be scored.
      <div class="small" style="margin-top:6px">${course.holes_count ?? '?'} holes listed.</div></div>`}

    <div class="card">
      <h3>My notes</h3>
      <textarea id="notes" placeholder="Wind, tricky holes, which discs worked…">${esc(course.user_notes)}</textarea>
      <button class="btn" id="saveNotes" style="margin-top:8px">Save notes</button>
    </div>

    ${hasHoles ? `
    <div class="card">
      <div class="spread"><h3>Pack your bag</h3><span class="muted small" id="bagCount"></span></div>
      <div class="tip">${bagTip(course, long, mid)}</div>
      <div class="row" style="margin-bottom:6px">
        <button class="btn" id="suggest">Suggest</button>
        <button class="btn" id="copyLast" ${lastBag.length ? '' : 'disabled'}>Copy last bag</button>
      </div>
      ${discs.length ? discs.map((d) => `
        <label class="disc">
          <input type="checkbox" value="${d.disc_id}" data-speed="${d.speed}">
          <span class="name"><span class="cat ${CAT_CLASS[d.category]}"></span>${esc(d.disc_name)}
            <span class="muted small">${esc(d.brand)}</span></span>
          <span class="flight">${flight(d)}</span>
        </label>`).join('') : '<p class="muted">Your bag is empty. Add discs on the Bag tab.</p>'}
      <label for="roundDate">Round date</label>
      <input type="date" id="roundDate" value="${today()}" max="${today()}">
      <button class="btn primary block" id="start" style="margin-top:12px">Start round with this bag</button>
    </div>` : ''}`;

  document.getElementById('saveNotes').onclick = async () => {
    await q(db.from('courses').update({ user_notes: document.getElementById('notes').value || null }).eq('course_id', courseId));
    toast('Notes saved');
  };
  if (!hasHoles) return;

  const boxes = [...view.querySelectorAll('.disc input')];
  const count = () => {
    document.getElementById('bagCount').textContent = `${boxes.filter((b) => b.checked).length} selected`;
  };
  boxes.forEach((b) => b.addEventListener('change', count));
  count();

  document.getElementById('suggest').onclick = () => {
    // Putters and mids always come; faster discs only when the layout needs the distance.
    boxes.forEach((b) => {
      const speed = Number(b.dataset.speed);
      b.checked = speed <= 5 || (speed <= 9 && (mid > 0 || long > 0)) || (speed >= 10 && long > 0);
    });
    count();
  };
  document.getElementById('copyLast').onclick = () => {
    boxes.forEach((b) => { b.checked = lastBag.includes(Number(b.value)); });
    count();
  };

  document.getElementById('start').onclick = async (e) => {
    if (getActive() && !confirm('You already have a round in progress. Start a new one anyway?')) return;
    e.target.disabled = true;
    const discIds = boxes.filter((b) => b.checked).map((b) => Number(b.value));
    const id = await startRound(courseId, document.getElementById('roundDate').value || today(), discIds)
      .finally(() => { e.target.disabled = false; });
    go(`#play/${id}`);
  };
}

function bagTip(course, long, mid) {
  if (long >= 3) return `🚀 <b>${long} holes are 400+ ft</b> (longest ${course.max_feet} ft). Bring your distance drivers.`;
  if (long > 0) return `Mostly mid-length with ${long} long hole${long > 1 ? 's' : ''}. One distance driver plus fairways and mids.`;
  if (mid > 0) return `No holes over 400 ft. Fairway drivers, mids and putters should cover it.`;
  return `Short, technical course (avg ${course.avg_feet} ft). Mids and putters are all you need.`;
}

async function lastRoundBag() {
  const [last] = await q(db.from('rounds').select('round_id, round_discs!inner(disc_id)')
    .order('round_date', { ascending: false }).order('round_id', { ascending: false }).limit(1));
  return last ? last.round_discs.map((r) => r.disc_id) : [];
}

async function startRound(courseId, date, discIds) {
  const [round] = await q(db.from('rounds').insert({ course_id: courseId, round_date: date }).select());
  if (discIds.length) {
    await q(db.from('round_discs').insert(discIds.map((disc_id) => ({ round_id: round.round_id, disc_id }))));
  }
  setActive(round.round_id);
  return round.round_id;
}

// ---------- INPUT SCORES ----------

async function renderPlay(roundId) {
  const id = Number(roundId) || getActive();
  if (!id) return renderStartForm();

  const [round] = await q(db.from('rounds').select('*, courses(course_name)').eq('round_id', id));
  if (!round) { setActive(null); return renderStartForm(); }
  const [holes, scores] = await Promise.all([
    q(db.from('holes').select('*').eq('course_id', round.course_id).order('hole_number')),
    q(db.from('hole_scores').select('*').eq('round_id', id)),
  ]);
  setActive(id);

  const strokes = new Map(scores.map((s) => [s.hole_id, s.strokes]));
  let idx = Math.max(0, holes.findIndex((h) => !strokes.has(h.hole_id)));
  if (strokes.size === holes.length) idx = holes.length - 1;
  let current = strokes.get(holes[idx].hole_id) ?? holes[idx].par;

  const draw = () => {
    const hole = holes[idx];
    const done = holes.filter((h) => strokes.has(h.hole_id));
    const total = done.reduce((s, h) => s + strokes.get(h.hole_id), 0);
    const toPar = done.reduce((s, h) => s + strokes.get(h.hole_id) - h.par, 0);
    const allDone = done.length === holes.length;

    view.innerHTML = `
      <div class="spread">
        <div><b>${esc(round.courses.course_name)}</b><div class="muted small">${fmtDate(round.round_date)}</div></div>
        <button class="btn danger" id="discard">Discard</button>
      </div>

      <div class="card" style="margin-top:12px">
        <div class="running">
          <div><b>${total}</b><span class="muted small">strokes</span></div>
          <div><b class="to-par ${parClass(toPar)}">${done.length ? fmtPar(toPar) : '–'}</b><span class="muted small">to par</span></div>
          <div><b>${done.length}/${holes.length}</b><span class="muted small">holes</span></div>
        </div>
      </div>

      <div class="card">
        <div class="hole-head">
          <div class="muted small">HOLE</div>
          <div class="num">${hole.hole_number}</div>
          <div class="meta">Par ${hole.par} · ${hole.distance_feet} ft</div>
        </div>
        <div class="stepper">
          <button id="minus" aria-label="One fewer stroke">−</button>
          <div class="val to-par ${parClass(current - hole.par)}" aria-live="polite">${current}</div>
          <button id="plus" aria-label="One more stroke">+</button>
        </div>
        <div class="row">
          <button class="btn" id="prev" ${idx === 0 ? 'disabled' : ''}>← Back</button>
          <button class="btn primary" id="save">${idx === holes.length - 1 ? 'Save hole' : 'Save & next →'}</button>
        </div>
        <div class="dots">
          ${holes.map((h, i) => {
            const s = strokes.get(h.hole_id);
            const cls = s == null ? '' : `done ${parClass(s - h.par)}`;
            return `<button data-i="${i}" class="${cls} ${i === idx ? 'current' : ''}">${h.hole_number}</button>`;
          }).join('')}
        </div>
      </div>

      ${allDone ? `
      <div class="card">
        <h3>Round complete: ${total} (${fmtPar(toPar)})</h3>
        <label for="rnotes">Round notes</label>
        <textarea id="rnotes" placeholder="Conditions, what went well…">${esc(round.round_notes)}</textarea>
        <button class="btn primary block" id="finish" style="margin-top:10px">Finish round</button>
      </div>` : `
      <button class="btn block" id="finishEarly">Finish early (${done.length} holes)</button>`}`;

    document.getElementById('minus').onclick = () => { if (current > 1) { current--; draw(); } };
    document.getElementById('plus').onclick = () => { if (current < 15) { current++; draw(); } };
    document.getElementById('prev').onclick = () => moveTo(idx - 1);
    document.getElementById('save').onclick = saveHole;
    view.querySelectorAll('.dots button').forEach((b) => (b.onclick = () => moveTo(Number(b.dataset.i))));
    document.getElementById('discard').onclick = async () => {
      if (!confirm('Delete this round and all its scores?')) return;
      await deleteRound(id);
      toast('Round discarded');
      go('#play');
    };
    const finish = async () => {
      const notes = document.getElementById('rnotes');
      if (notes) await q(db.from('rounds').update({ round_notes: notes.value || null }).eq('round_id', id));
      setActive(null);
      toast('Round saved');
      go(`#stats/round/${id}`);
    };
    document.getElementById('finish')?.addEventListener('click', finish);
    document.getElementById('finishEarly')?.addEventListener('click', () => {
      if (!done.length) { toast('Score at least one hole first'); return; }
      if (confirm(`Finish with only ${done.length} of ${holes.length} holes scored?`)) finish();
    });
  };

  const moveTo = (i) => {
    idx = Math.min(Math.max(i, 0), holes.length - 1);
    current = strokes.get(holes[idx].hole_id) ?? holes[idx].par;
    draw();
  };

  async function saveHole() {
    const hole = holes[idx];
    // Upsert so editing a hole replaces its score (hole_scores is unique on round_id + hole_id).
    await q(db.from('hole_scores').upsert(
      { round_id: id, hole_id: hole.hole_id, course_id: round.course_id, strokes: current },
      { onConflict: 'round_id,hole_id' },
    ));
    strokes.set(hole.hole_id, current);
    const next = holes.findIndex((h, i) => i > idx && !strokes.has(h.hole_id));
    if (next >= 0) moveTo(next);
    else if (idx < holes.length - 1) moveTo(idx + 1);
    else draw();
  }

  draw();
}

async function renderStartForm() {
  const courses = await q(db.from('course_layout_stats').select('course_id, course_name, mapped_holes, total_par')
    .gt('mapped_holes', 0).order('course_name'));
  const lastBag = await lastRoundBag();
  view.innerHTML = `
    <h2>Start a round</h2>
    <div class="card">
      <label for="course">Course</label>
      <select id="course">
        ${courses.map((c) => `<option value="${c.course_id}">${esc(c.course_name)} (${c.mapped_holes} holes, par ${c.total_par})</option>`).join('')}
      </select>
      <label for="date">Date</label>
      <input type="date" id="date" value="${today()}" max="${today()}">
      <label class="disc" style="color:var(--text)">
        <input type="checkbox" id="sameBag" ${lastBag.length ? 'checked' : 'disabled'}>
        <span class="name">Bring the same ${lastBag.length || ''} discs as my last round</span>
      </label>
      <button class="btn primary block" id="go" style="margin-top:12px">Start round</button>
      <button class="btn block" id="plan" style="margin-top:8px">Plan my bag first</button>
    </div>
    <p class="muted small">Only courses with hole-by-hole data are listed.</p>`;

  const courseId = () => Number(document.getElementById('course').value);
  document.getElementById('plan').onclick = () => go(`#plan/${courseId()}`);
  document.getElementById('go').onclick = async (e) => {
    e.target.disabled = true;
    const bag = document.getElementById('sameBag').checked ? lastBag : [];
    const id = await startRound(courseId(), document.getElementById('date').value || today(), bag)
      .finally(() => { e.target.disabled = false; });
    go(`#play/${id}`);
  };
}

async function deleteRound(id) {
  await q(db.from('hole_scores').delete().eq('round_id', id));
  await q(db.from('round_discs').delete().eq('round_id', id));
  await q(db.from('rounds').delete().eq('round_id', id));
  if (getActive() === id) setActive(null);
}

// ---------- REVIEW PERFORMANCE ----------

async function renderStats(sub, roundId) {
  if (sub === 'round' && roundId) return renderRound(Number(roundId));

  const [rounds, rates] = await Promise.all([
    q(db.from('round_summary').select('*').order('round_date', { ascending: false }).order('round_id', { ascending: false })),
    q(db.from('scoring_rates').select('*')),
  ]);
  const played = rounds.filter((r) => r.holes_played > 0);
  if (!played.length) {
    view.innerHTML = '<h2>Stats</h2><div class="card empty">No rounds yet. Play one on the Play tab!</div>';
    return;
  }

  const coursesPlayed = [...new Map(played.map((r) => [r.course_id, r.course_name])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));

  view.innerHTML = `
    <h2>Stats</h2>
    <select id="filter" aria-label="Course filter">
      <option value="">All courses</option>
      ${coursesPlayed.map(([id, name]) => `<option value="${id}">${esc(name)}</option>`).join('')}
    </select>
    <div id="statsBody" style="margin-top:12px"></div>`;

  const body = document.getElementById('statsBody');
  const draw = (courseId) => {
    const rs = courseId ? played.filter((r) => r.course_id === courseId) : played;
    // Averages only use complete rounds so a 10-hole round doesn't look like a great score.
    const full = rs.filter((r) => r.holes_played === r.course_holes);
    const avgToPar = full.length ? full.reduce((s, r) => s + r.score_to_par, 0) / full.length : null;
    const best = full.reduce((b, r) => (!b || r.score_to_par < b.score_to_par ? r : b), null);

    const rr = rates.filter((r) => !courseId || r.course_id === courseId)
      .reduce((a, r) => {
        for (const k of ['holes_played', 'eagles', 'birdies', 'pars', 'bogeys', 'doubles']) a[k] += r[k];
        return a;
      }, { holes_played: 0, eagles: 0, birdies: 0, pars: 0, bogeys: 0, doubles: 0 });
    const rateRow = (label, n, cls) => `
      <div class="rate"><span>${label}</span>
        <div class="track"><div class="fill ${cls}" style="width:${pct(n, rr.holes_played)}%"></div></div>
        <b style="text-align:right">${pct(n, rr.holes_played)}%</b></div>`;

    const perCourse = courseId ? '' : coursesPlayed.map(([id, name]) => {
      const f = played.filter((r) => r.course_id === id && r.holes_played === r.course_holes);
      if (!f.length) return '';
      const avg = f.reduce((s, r) => s + r.strokes, 0) / f.length;
      const avgP = f.reduce((s, r) => s + r.score_to_par, 0) / f.length;
      const b = Math.min(...f.map((r) => r.score_to_par));
      return `<tr><td style="text-align:left">${esc(name)}</td><td>${f.length}</td><td>${avg.toFixed(1)}</td>
        <td class="${parClass(avgP)}">${fmtPar(+avgP.toFixed(1))}</td><td class="${parClass(b)}">${fmtPar(b)}</td></tr>`;
    }).join('');

    body.innerHTML = `
      <div class="metrics">
        <div class="metric"><b>${rs.length}</b><span>rounds</span></div>
        <div class="metric"><b class="to-par ${avgToPar == null ? '' : parClass(avgToPar)}">${avgToPar == null ? '–' : fmtPar(+avgToPar.toFixed(1))}</b><span>avg to par</span></div>
        <div class="metric"><b class="to-par ${best ? parClass(best.score_to_par) : ''}">${best ? fmtPar(best.score_to_par) : '–'}</b><span>best round</span></div>
      </div>

      <div class="card">
        <h3>Scoring rates <span class="muted small">(${rr.holes_played} holes)</span></h3>
        ${rateRow('Eagle+', rr.eagles, 'c-eagle')}
        ${rateRow('Birdie', rr.birdies, 'c-birdie')}
        ${rateRow('Par', rr.pars, 'c-par')}
        ${rateRow('Bogey', rr.bogeys, 'c-bogey')}
        ${rateRow('Double+', rr.doubles, 'c-double')}
      </div>

      ${full.length >= 2 ? `<div class="card"><h3>Trend <span class="muted small">(score to par, last ${Math.min(full.length, 20)} full rounds)</span></h3>${trendChart(full.slice(0, 20).reverse())}</div>` : ''}

      ${perCourse ? `<div class="card"><h3>By course <span class="muted small">(full rounds)</span></h3>
        <table class="scorecard"><thead><tr><th style="text-align:left">Course</th><th>Rds</th><th>Avg</th><th>±Par</th><th>Best</th></tr></thead>
        <tbody>${perCourse}</tbody></table></div>` : ''}

      <div class="card"><h3>Rounds</h3><ul class="list">
        ${rs.map((r) => `
          <li data-id="${r.round_id}">
            <div><b>${esc(r.course_name)}</b><div class="muted small">${fmtDate(r.round_date)}${r.holes_played < r.course_holes ? ` · ${r.holes_played}/${r.course_holes} holes` : ''}</div></div>
            <div style="text-align:right"><b>${r.strokes}</b> <span class="to-par ${parClass(r.score_to_par)}">${fmtPar(r.score_to_par)}</span></div>
          </li>`).join('')}
      </ul></div>`;

    body.querySelector('.list').addEventListener('click', (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) go(`#stats/round/${li.dataset.id}`);
    });
  };

  document.getElementById('filter').addEventListener('change', (e) => draw(Number(e.target.value) || null));
  draw(null);
}

// Simple inline SVG line chart; below the zero line is under par.
function trendChart(rounds) {
  const w = 320, h = 140, pad = 24;
  const vals = rounds.map((r) => r.score_to_par);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const x = (i) => pad + (i * (w - pad * 2)) / Math.max(rounds.length - 1, 1);
  const y = (v) => 10 + ((hi - v) * (h - 30)) / span;
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `
    <svg class="trend" viewBox="0 0 ${w} ${h}" role="img" aria-label="Score to par over recent rounds">
      <line x1="${pad}" x2="${w - pad}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line)" stroke-dasharray="4 4"/>
      <text x="2" y="${y(0) + 4}" font-size="10" fill="var(--muted)">E</text>
      <text x="2" y="${y(hi) + 4}" font-size="10" fill="var(--muted)">${fmtPar(hi)}</text>
      <text x="2" y="${y(lo) + 4}" font-size="10" fill="var(--muted)">${fmtPar(lo)}</text>
      <polyline points="${pts}" fill="none" stroke="var(--brand)" stroke-width="2"/>
      ${vals.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="var(--${v < 0 ? 'under' : v > 0 ? 'over' : 'even'})">
        <title>${fmtDate(rounds[i].round_date)}: ${fmtPar(v)}</title></circle>`).join('')}
      <text x="${pad}" y="${h - 2}" font-size="10" fill="var(--muted)">${fmtDate(rounds[0].round_date)}</text>
      <text x="${w - pad}" y="${h - 2}" font-size="10" fill="var(--muted)" text-anchor="end">${fmtDate(rounds[rounds.length - 1].round_date)}</text>
    </svg>`;
}

async function renderRound(id) {
  const [[summary], details, bag] = await Promise.all([
    q(db.from('round_summary').select('*').eq('round_id', id)),
    q(db.from('score_details').select('*').eq('round_id', id).order('hole_number')),
    q(db.from('round_discs').select('discs(*)').eq('round_id', id)),
  ]);
  if (!summary) { view.innerHTML = '<div class="card empty">Round not found.</div>'; return; }

  const chunks = [];
  for (let i = 0; i < details.length; i += 9) chunks.push(details.slice(i, i + 9));

  view.innerHTML = `
    <a href="#stats" class="muted small">← Stats</a>
    <h2>${esc(summary.course_name)}</h2>
    <p class="muted" style="margin-top:-8px">${fmtDate(summary.round_date)}</p>
    <div class="metrics">
      <div class="metric"><b>${summary.strokes}</b><span>strokes</span></div>
      <div class="metric"><b class="to-par ${parClass(summary.score_to_par)}">${fmtPar(summary.score_to_par)}</b><span>to par</span></div>
      <div class="metric"><b>${summary.holes_played}/${summary.course_holes}</b><span>holes</span></div>
    </div>
    <div class="card">
      <h3>Scorecard</h3>
      ${chunks.map((c) => `
        <table class="scorecard" style="margin-bottom:10px">
          <tr><th>Hole</th>${c.map((d) => `<th>${d.hole_number}</th>`).join('')}</tr>
          <tr><td class="muted">Par</td>${c.map((d) => `<td class="muted">${d.par}</td>`).join('')}</tr>
          <tr><td class="muted">Score</td>${c.map((d) => `<td class="${parClass(d.to_par)}">${d.strokes}</td>`).join('')}</tr>
        </table>`).join('') || '<p class="muted">No holes scored.</p>'}
    </div>
    <div class="card">
      <h3>Bag</h3>
      ${bag.length ? bag.map(({ discs: d }) => `
        <div class="disc"><span class="name"><span class="cat ${CAT_CLASS[d.category]}"></span>${esc(d.disc_name)}
          <span class="muted small">${esc(d.brand)}</span></span><span class="flight">${flight(d)}</span></div>`).join('')
        : '<p class="muted">No discs recorded for this round.</p>'}
    </div>
    ${summary.round_notes ? `<div class="card"><h3>Notes</h3><p style="margin:0">${esc(summary.round_notes)}</p></div>` : ''}
    <div class="row">
      <button class="btn" id="edit">Edit scores</button>
      <button class="btn danger" id="del">Delete round</button>
    </div>`;

  document.getElementById('edit').onclick = () => go(`#play/${id}`);
  document.getElementById('del').onclick = async () => {
    if (!confirm('Delete this round and all its scores?')) return;
    await deleteRound(id);
    toast('Round deleted');
    go('#stats');
  };
}

// ---------- BAG (discs) ----------

async function renderBag() {
  const discs = await q(db.from('discs').select('*').order('speed', { ascending: false }));
  view.innerHTML = `
    <h2>My discs</h2>
    ${CATEGORIES.map((cat) => {
      const ds = discs.filter((d) => d.category === cat);
      return ds.length ? `
        <div class="card"><h3><span class="cat ${CAT_CLASS[cat]}"></span>${cat}s</h3>
          ${ds.map((d) => `
            <div class="disc">
              <span class="name"><b>${esc(d.disc_name)}</b> <span class="muted small">${esc(d.brand)}</span></span>
              <span class="flight" title="Speed | Glide | Turn | Fade">${flight(d)}</span>
              <button class="btn danger small" data-del="${d.disc_id}" aria-label="Remove ${esc(d.disc_name)}">✕</button>
            </div>`).join('')}
        </div>` : '';
    }).join('') || '<div class="card empty">No discs yet.</div>'}
    <p class="muted small">Flight numbers: Speed | Glide | Turn | Fade</p>

    <form class="card" id="addDisc">
      <h3>Add a disc</h3>
      <div class="row">
        <div><label for="dname">Name</label><input type="text" id="dname" required></div>
        <div><label for="dbrand">Brand</label><input type="text" id="dbrand"></div>
      </div>
      <label for="dcat">Type</label>
      <select id="dcat">${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select>
      <div class="row">
        <div><label for="dspeed">Speed</label><input type="number" id="dspeed" min="1" max="14" required></div>
        <div><label for="dglide">Glide</label><input type="number" id="dglide" min="1" max="7" step="0.5"></div>
        <div><label for="dturn">Turn</label><input type="number" id="dturn" min="-5" max="1" step="0.5"></div>
        <div><label for="dfade">Fade</label><input type="number" id="dfade" min="0" max="5" step="0.5"></div>
      </div>
      <button class="btn primary block" style="margin-top:12px">Add disc</button>
    </form>`;

  view.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => {
    const id = Number(b.dataset.del);
    // round_discs references discs, so a disc that's been carried in a round can't be deleted.
    const { count, error } = await db.from('round_discs').select('round_id', { count: 'exact', head: true }).eq('disc_id', id);
    if (error) { toast(error.message); return; }
    if (count) { toast(`Can't remove: this disc was in your bag for ${count} round${count > 1 ? 's' : ''}.`); return; }
    if (!confirm('Remove this disc?')) return;
    await q(db.from('discs').delete().eq('disc_id', id));
    toast('Disc removed');
    route();
  }));

  document.getElementById('addDisc').onsubmit = async (e) => {
    e.preventDefault();
    const num = (id) => (document.getElementById(id).value === '' ? null : Number(document.getElementById(id).value));
    await q(db.from('discs').insert({
      disc_name: document.getElementById('dname').value.trim(),
      brand: document.getElementById('dbrand').value.trim() || null,
      category: document.getElementById('dcat').value,
      speed: num('dspeed'), glide: num('dglide'), turn: num('dturn'), fade: num('dfade'),
    }));
    toast('Disc added');
    route();
  };
}

route();
