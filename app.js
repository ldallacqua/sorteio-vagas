(function () {
  'use strict';

  const LOT = window.LOT;
  const TOTAL = LOT.spots.length;
  const STORE = 'sorteio-vagas:v1';
  const SIZE = { G: 'Grande', M: 'Média', P: 'Pequena' };

  const $ = (sel, root) => (root || document).querySelector(sel);
  const pad3 = (n) => String(n).padStart(3, '0');
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pts = (list) => list.map((p) => p.join(',')).join(' ');
  const where = (n) => 'perto do Bloco ' + LOT.byNum[n].block;
  const buzz = (pattern) => { try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* sem vibração */ } };

  const wide = window.matchMedia('(min-width: 960px)');
  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- estado ----------

  // savedAt: quando a lista ou o sorteio mudaram pela última vez (para saber qual cópia é a mais nova)
  const state = { prefs: [], taken: [], chosen: null, savedAt: 0, tab: 'lista', panel: 'lista', mapMode: 'lista' };
  const isSpot = (n) => Number.isInteger(n) && !!LOT.byNum[n];

  // Lê o que está salvo, descartando qualquer coisa que não seja um número de vaga válido.
  // `keepView` preserva a aba aberta (usado quando outra aba do navegador mexe nos dados).
  function loadState(keepView) {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { saved = {}; }
    if (typeof saved !== 'object') saved = {};
    const valid = (list) => [...new Set((Array.isArray(list) ? list : []).filter(isSpot))];
    state.prefs = valid(saved.prefs);
    state.taken = valid(saved.taken);
    state.chosen = isSpot(saved.chosen) ? saved.chosen : null;
    state.savedAt = Number.isFinite(saved.savedAt) ? saved.savedAt : 0;
    if (keepView) return;
    if (['lista', 'mapa', 'sorteio'].includes(saved.tab)) state.tab = saved.tab;
    if (['lista', 'sorteio'].includes(saved.panel)) state.panel = saved.panel;
    if (['lista', 'saidas'].includes(saved.mapMode)) state.mapMode = saved.mapMode;
  }

  // Se o navegador se recusar a gravar (modo restrito, armazenamento cheio), avisa em vez de fingir.
  let saveFailed = false;

  function save() {
    let ok = true;
    try {
      const data = JSON.stringify(state);
      localStorage.setItem(STORE, data);
      ok = localStorage.getItem(STORE) === data;
    } catch (e) {
      ok = false;
    }
    if (ok !== !saveFailed) {
      saveFailed = !ok;
      const warn = document.getElementById('saveWarn');
      if (warn) warn.hidden = ok;
    }
    syncAddress();
  }

  // Cópia de segurança no endereço da página. O Safari do iPhone apaga os dados de sites que
  // ficam uma semana sem uso; com a lista também no endereço, reabrir a mesma aba (ou um
  // favorito dela) traz tudo de volta.
  function addressFor(full) {
    let hash = '#l=' + state.prefs.join('.');
    if (full) {
      if (state.taken.length) hash += '&x=' + state.taken.join('.');
      if (state.chosen != null) hash += '&c=' + state.chosen;
      hash += '&s=' + state.savedAt;
    }
    return location.origin + location.pathname + location.search + hash;
  }

  function syncAddress() {
    const hasData = state.prefs.length || state.taken.length || state.chosen != null;
    const url = hasData ? addressFor(true) : location.origin + location.pathname + location.search;
    if (url === location.href) return;
    try { history.replaceState(null, '', url); } catch (e) { /* o navegador limita trocas de endereço muito seguidas */ }
  }

  function readAddress() {
    if (location.hash.slice(0, 3) !== '#l=') return null;
    const params = new URLSearchParams(location.hash.slice(1));
    const list = (value) => [...new Set((value || '').split('.').map(Number).filter(isSpot))];
    const chosen = Number(params.get('c') || NaN);
    return {
      prefs: list(params.get('l')),
      taken: list(params.get('x')),
      chosen: isSpot(chosen) ? chosen : null,
      stamp: Number(params.get('s')) || 0, // só os endereços gravados pelo app têm data; link compartilhado não
    };
  }

  function commit() {
    state.savedAt = Date.now();
    save();
    render();
  }

  const isTaken = (n) => state.taken.includes(n);
  const rankOf = (n) => state.prefs.indexOf(n) + 1;

  // Vagas livres fora da lista, da mais perto para a mais longe da 1ª opção.
  function nearestFree(count) {
    const anchor = LOT.byNum[state.prefs[0]];
    return LOT.spots
      .filter((s) => !isTaken(s.n))
      .map((s) => [Math.hypot(s.c[0] - anchor.c[0], s.c[1] - anchor.c[1]), s.n])
      .sort((p, q) => p[0] - q[0])
      .slice(0, count)
      .map((p) => p[1]);
  }

  // O que pedir agora: a primeira da lista que ainda está livre.
  function current() {
    if (!state.prefs.length) return { kind: 'empty' };
    const free = state.prefs.filter((n) => !isTaken(n));
    if (free.length) return { kind: 'pref', n: free[0], rank: rankOf(free[0]), next: free.slice(1, 4) };
    const near = nearestFree(4);
    if (near.length) return { kind: 'fallback', n: near[0], next: near.slice(1), anchor: state.prefs[0] };
    return { kind: 'none' };
  }

  // ---------- ações ----------

  let feed = { msg: '', tone: 'idle' };

  function markTaken(n) {
    if (!LOT.byNum[n]) return { ok: false, msg: `A vaga <b>${pad3(n)}</b> não existe.` };
    if (isTaken(n)) return { ok: false, msg: `A <b>${pad3(n)}</b> já tinha saído.` };

    const before = current();
    const rank = rankOf(n);
    state.taken.push(n);
    const after = current();

    let msg = `<b>${pad3(n)}</b> saiu.`, tone = 'ok', plain = `${pad3(n)} saiu`;
    if (rank && before.n === n) {
      tone = 'hit';
      msg = `<b>${pad3(n)}</b> saiu. Era a sua melhor opção.`;
      msg += after.kind === 'pref' ? ` Agora é a <b>${pad3(after.n)}</b>.` : ' Sua lista acabou.';
      plain = after.kind === 'pref' ? `${pad3(n)} saiu. Agora é a ${pad3(after.n)}` : `${pad3(n)} saiu. Sua lista acabou`;
      buzz([70, 50, 70]);
    } else if (rank) {
      tone = 'warn';
      msg = `<b>${pad3(n)}</b> saiu. Era a sua ${rank}ª opção.`;
      plain = `${pad3(n)} saiu. Era a sua ${rank}ª opção`;
      buzz(30);
    } else {
      buzz(12);
    }

    feed = { msg, tone };
    commit();
    return { ok: true, msg, plain };
  }

  function restore(n) {
    const i = state.taken.indexOf(n);
    if (i < 0) return;
    state.taken.splice(i, 1);
    feed = { msg: `<b>${pad3(n)}</b> voltou a ficar livre.`, tone: 'back' };
    commit();
  }

  function addPref(n) {
    if (!LOT.byNum[n]) return { ok: false, msg: `A vaga ${n} não existe (vai de 001 a ${TOTAL})` };
    if (rankOf(n)) return { ok: false, msg: `A ${pad3(n)} já é a sua ${rankOf(n)}ª opção` };
    state.prefs.push(n);
    commit();
    askToKeepData();
    return { ok: true, msg: `${pad3(n)} entrou como ${state.prefs.length}ª opção` };
  }

  // Pede ao navegador para não descartar os dados deste site quando faltar espaço.
  let askedToKeep = false;

  function askToKeepData() {
    if (askedToKeep || !navigator.storage || !navigator.storage.persist) return;
    askedToKeep = true;
    navigator.storage.persist().catch(() => {});
  }

  function removePref(n) {
    const i = state.prefs.indexOf(n);
    if (i < 0) return;
    state.prefs.splice(i, 1);
    commit();
    toast(`${pad3(n)} saiu da lista`, { action: 'Desfazer', run: () => { state.prefs.splice(Math.min(i, state.prefs.length), 0, n); commit(); } });
  }

  function movePref(from, to) {
    if (from === to) return;
    const [n] = state.prefs.splice(from, 1);
    state.prefs.splice(to, 0, n);
  }

  // ---------- mapa ----------

  function centroid(list) {
    return [
      Math.round(list.reduce((sum, p) => sum + p[0], 0) / list.length * 10) / 10,
      Math.round(list.reduce((sum, p) => sum + p[1], 0) / list.length * 10) / 10,
    ];
  }

  function mapMarkup() {
    let h = `<polygon class="m-ground" points="${pts(LOT.ground)}"/>`;
    for (const a of LOT.areas) h += `<polygon class="m-area" points="${pts(a)}"/>`;
    for (const b of LOT.blocks) {
      h += `<g class="m-block b${b.id}"><polygon points="${pts(b.pts)}"/><text x="${b.label[0]}" y="${b.label[1]}" dy=".35em">${b.name}</text></g>`;
    }
    for (const s of LOT.special) {
      const c = centroid(s.pts);
      h += `<g class="m-special"><polygon points="${pts(s.pts)}"/><text x="${c[0]}" y="${c[1]}" dy=".35em">${s.label}</text></g>`;
    }
    for (const s of LOT.spots) {
      const [l0, l1] = s.sizeLine;
      h += `<g class="spot sz-${s.size}" data-n="${s.n}">` +
        `<polygon class="s-body" points="${pts(s.pts)}"/>` +
        `<path class="s-x" d="M${s.pts[0]}L${s.pts[2]}M${s.pts[1]}L${s.pts[3]}"/>` +
        `<line class="s-size" x1="${l0[0]}" y1="${l0[1]}" x2="${l1[0]}" y2="${l1[1]}"/>` +
        `<text class="s-num" x="${s.c[0]}" y="${s.c[1]}" dy=".35em">${pad3(s.n)}</text>` +
        `<text class="s-rank" x="${s.c[0]}" y="${s.c[1] + 5.4}" dy=".35em"></text>` +
        '</g>';
    }
    return h + '<polygon class="halo" points=""/>';
  }

  function buildMap(svg) {
    svg.innerHTML = mapMarkup();
    const els = {};
    svg.querySelectorAll('.spot').forEach((g) => { els[g.dataset.n] = g; });
    return { svg, els, halo: $('.halo', svg) };
  }

  function paintMap(map) {
    const cur = current();
    const best = state.chosen == null && (cur.kind === 'pref' || cur.kind === 'fallback') ? cur.n : null;
    const taken = new Set(state.taken);
    for (const s of LOT.spots) {
      const g = map.els[s.n];
      const rank = rankOf(s.n);
      g.classList.toggle('is-pref', rank > 0);
      g.classList.toggle('is-taken', taken.has(s.n));
      g.classList.toggle('is-best', s.n === best);
      g.classList.toggle('is-chosen', s.n === state.chosen);
      g.children[3].setAttribute('y', s.c[1] - (rank ? 3.2 : 0));
      g.children[4].textContent = rank ? rank + 'ª' : '';
    }
    const glow = state.chosen != null ? state.chosen : best;
    map.halo.setAttribute('points', glow ? pts(LOT.byNum[glow].pts) : '');
    map.halo.style.display = glow ? '' : 'none';
  }

  // Arrastar, pinçar e tocar no mapa (mexendo no viewBox).
  function createPanZoom(svg, wrap, handlers) {
    const full = LOT.viewBox;
    const MAX_SCALE = 4.2;   // px de tela por unidade do mapa
    const LABEL_SCALE = 0.6; // abaixo disso os números não cabem
    const TOUCH_SCALE = 0.95; // abaixo disso a vaga é pequena demais para o dedo

    const size = { w: 0, h: 0 };
    const pointers = new Map();
    let view = null, base = null, gesture = null, anim = 0, animEnd = 0, atFit = true;

    function fitView() {
      const ar = size.w / size.h, lot = full.w / full.h;
      const w = ar > lot ? full.h * ar : full.w;
      const h = w / ar;
      return { x: full.x + (full.w - w) / 2, y: full.y + (full.h - h) / 2, w, h };
    }

    function bound(v) {
      const x = v.w >= full.w ? full.x + (full.w - v.w) / 2 : clamp(v.x, full.x, full.x + full.w - v.w);
      const y = v.h >= full.h ? full.y + (full.h - v.h) / 2 : clamp(v.y, full.y, full.y + full.h - v.h);
      return { x, y, w: v.w, h: v.h };
    }

    function set(v) {
      view = v;
      atFit = v.w >= fitView().w - 0.5;
      svg.setAttribute('viewBox', `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`);
      svg.classList.toggle('far', scale() < LABEL_SCALE);
      if (handlers.onChange) handlers.onChange();
    }

    function scale() { return view ? size.w / view.w : 0; }

    function zoomAt(px, py, factor, from) {
      const w = clamp(from.w / factor, size.w / MAX_SCALE, fitView().w);
      const h = w * size.h / size.w;
      const mx = from.x + px / size.w * from.w, my = from.y + py / size.h * from.h;
      return bound({ x: mx - px / size.w * w, y: my - py / size.h * h, w, h });
    }

    function centerOn(cx, cy, targetScale) {
      const w = clamp(size.w / targetScale, size.w / MAX_SCALE, fitView().w);
      const h = w * size.h / size.w;
      return bound({ x: cx - w / 2, y: cy - h / 2, w, h });
    }

    function stopAnim() {
      cancelAnimationFrame(anim);
      clearTimeout(animEnd);
    }

    function animateTo(target) {
      stopAnim();
      if (calm.matches || document.hidden || !view) { set(target); return; }
      const from = view, t0 = performance.now();
      const step = (now) => {
        const t = clamp((now - t0) / 280, 0, 1), e = 1 - Math.pow(1 - t, 3);
        set({
          x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
          w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e,
        });
        if (t < 1) anim = requestAnimationFrame(step); else clearTimeout(animEnd);
      };
      anim = requestAnimationFrame(step);
      // Se o navegador não estiver desenhando quadros, chega ao destino mesmo assim.
      animEnd = setTimeout(() => { cancelAnimationFrame(anim); set(target); }, 450);
    }

    // Lê o tamanho na tela; devolve false enquanto o mapa estiver escondido.
    function measure() {
      const w = wrap.clientWidth, h = wrap.clientHeight;
      if (!w || !h) return false;
      if (w === size.w && h === size.h && view) return true;
      const keep = view && !atFit ? { cx: view.x + view.w / 2, cy: view.y + view.h / 2, s: scale() } : null;
      size.w = w; size.h = h;
      set(keep ? centerOn(keep.cx, keep.cy, keep.s) : fitView());
      return true;
    }

    function local(e) {
      const r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function snapshot() {
      base = { view: { ...view }, p: [...pointers.values()].map((p) => ({ ...p })) };
    }

    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!measure()) return;
      stopAnim();
      try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro sintético */ }
      // Um novo primeiro dedo significa que não há outro na tela: descarta toques que ficaram presos.
      if (e.isPrimary) pointers.clear();
      pointers.set(e.pointerId, local(e));
      if (pointers.size === 1) gesture = { tap: true, t: performance.now(), start: local(e) };
      else if (gesture) gesture.tap = false;
      snapshot();
    });

    svg.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId) || !base) return;
      pointers.set(e.pointerId, local(e));
      const p = [...pointers.values()];
      if (p.length === 1) {
        if (gesture && gesture.tap && Math.hypot(p[0].x - gesture.start.x, p[0].y - gesture.start.y) > 8) gesture.tap = false;
        if (gesture && gesture.tap) return;
        const s = size.w / base.view.w;
        set(bound({ ...base.view, x: base.view.x - (p[0].x - base.p[0].x) / s, y: base.view.y - (p[0].y - base.p[0].y) / s }));
      } else if (base.p.length >= 2) {
        const d0 = Math.hypot(base.p[0].x - base.p[1].x, base.p[0].y - base.p[1].y) || 1;
        const d1 = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const m0 = { x: (base.p[0].x + base.p[1].x) / 2, y: (base.p[0].y + base.p[1].y) / 2 };
        const m1 = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
        const v = zoomAt(m0.x, m0.y, d1 / d0, base.view);
        const s = size.w / v.w;
        set(bound({ ...v, x: v.x - (m1.x - m0.x) / s, y: v.y - (m1.y - m0.y) / s }));
      }
    });

    function release(e) {
      if (!pointers.has(e.pointerId)) return;
      const only = pointers.size === 1;
      pointers.delete(e.pointerId);
      if (only && gesture && gesture.tap && e.type === 'pointerup' && performance.now() - gesture.t < 700) {
        const hit = document.elementFromPoint(e.clientX, e.clientY);
        const g = hit && hit.closest ? hit.closest('.spot') : null;
        const tooSmall = e.pointerType !== 'mouse' && scale() < TOUCH_SCALE;
        if (tooSmall) {
          const p = local(e);
          animateTo(zoomAt(p.x, p.y, 1.55 / scale(), view));
        } else if (g && svg.contains(g)) {
          handlers.onTap(+g.dataset.n);
        }
      }
      if (pointers.size) snapshot(); else { gesture = null; base = null; }
    }
    svg.addEventListener('pointerup', release);
    svg.addEventListener('pointercancel', release);

    svg.addEventListener('wheel', (e) => {
      if (!measure()) return;
      e.preventDefault();
      stopAnim();
      const p = local(e);
      set(zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0016), view));
    }, { passive: false });

    if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe(wrap);
    window.addEventListener('resize', () => measure());

    return {
      measure,
      scale,
      needsZoomToTap: () => scale() < TOUCH_SCALE,
      zoomBy(factor) { if (measure()) animateTo(zoomAt(size.w / 2, size.h / 2, factor, view)); },
      fit() { if (measure()) animateTo(fitView()); },
      focus(n) {
        if (!measure()) return;
        const c = LOT.byNum[n].c;
        animateTo(centerOn(c[0], c[1], Math.max(scale(), 1.6)));
      },
    };
  }

  // ---------- elementos ----------

  const app = $('#app');
  const el = {
    countNum: $('#countNum'), countPill: $('#countPill'),
    tabbar: $('#tabbar'), mapMode: $('#mapMode'), mapHint: $('#mapHint'),
    viewList: $('#viewList'), listSummary: $('#listSummary'), prefs: $('#prefs'), listEmpty: $('#listEmpty'),
    addForm: $('#addForm'), addInput: $('#addInput'),
    hero: $('#hero'), heroLabel: $('#heroLabel'), heroBay: $('#heroBay'), heroNum: $('#heroNum'), heroRank: $('#heroRank'),
    heroSize: $('#heroSize'), heroLoc: $('#heroLoc'), heroNext: $('#heroNext'), btnTurn: $('#btnTurn'), btnTurnLabel: $('#btnTurnLabel'),
    feed: $('#feed'), feedMsg: $('#feedMsg'), btnUndo: $('#btnUndo'),
    padDisplay: $('#padDisplay'), padDigits: $('#padDigits'), padStatus: $('#padStatus'), padOk: $('#padOk'),
    turn: $('#turn'), turnKicker: $('#turnKicker'), turnNum: $('#turnNum'), turnMeta: $('#turnMeta'), turnPlan: $('#turnPlan'),
    turnYes: $('#turnYes'), turnNo: $('#turnNo'), turnMapSvg: $('#turnMap'),
    sheet: $('#sheet'), sheetTitle: $('#sheetTitle'), sheetText: $('#sheetText'), sheetBody: $('#sheetBody'), sheetActions: $('#sheetActions'),
    toast: $('#toast'), toastMsg: $('#toastMsg'), toastAction: $('#toastAction'),
  };

  const mainMap = buildMap($('#map'));
  const panzoom = createPanZoom(mainMap.svg, $('#mapWrap'), { onTap: onMapTap, onChange: renderHint });
  let turnMap = null;

  // ---------- render ----------

  function render() {
    renderChrome();
    renderList();
    renderDraw();
    renderPad();
    paintMap(mainMap);
    if (!el.turn.hidden) renderTurn();
  }

  function renderChrome() {
    app.dataset.tab = state.tab;
    app.dataset.panel = state.panel;
    const active = wide.matches ? state.panel : state.tab;
    el.tabbar.querySelectorAll('button').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === active));
    el.mapMode.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.mode === state.mapMode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });
    el.countNum.textContent = state.taken.length;
    renderHint();
  }

  function renderHint() {
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && panzoom && panzoom.scale() && panzoom.needsZoomToTap()) {
      el.mapHint.innerHTML = '<b>Toque para aproximar</b> ou use dois dedos';
    } else if (state.mapMode === 'lista') {
      el.mapHint.innerHTML = state.prefs.length
        ? `<b>${state.prefs.length} na lista.</b> Toque na próxima que você prefere`
        : '<b>Toque nas vagas</b> na ordem em que você prefere';
    } else {
      el.mapHint.innerHTML = '<b>Toque na vaga que saiu</b> para riscá-la';
    }
  }

  const HANDLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h14M5 15h14"/></svg>';

  function renderList() {
    const count = state.prefs.length;
    const cur = current();
    const freeCount = state.prefs.filter((n) => !isTaken(n)).length;

    if (!count) el.listSummary.textContent = 'A 1ª é a que você mais quer.';
    else if (state.taken.length) el.listSummary.textContent = `${count} ${count === 1 ? 'vaga' : 'vagas'} · ${freeCount} ainda ${freeCount === 1 ? 'livre' : 'livres'}`;
    else el.listSummary.textContent = `${count} ${count === 1 ? 'vaga' : 'vagas'} · toque para opções, arraste para reordenar`;

    el.prefs.innerHTML = state.prefs.map((n, i) => {
      const s = LOT.byNum[n];
      let cls = '', note = where(n);
      if (n === state.chosen) { cls = ' is-chosen'; note = 'É a sua vaga'; }
      else if (isTaken(n)) { cls = ' is-taken'; note = 'Já saiu'; }
      else if (state.chosen == null && cur.n === n) { cls = ' is-best'; note = 'Melhor opção agora'; }
      return `<li class="pref${cls}" data-n="${n}">` +
        `<span class="pref-rank">${i + 1}ª</span>` +
        `<span class="pref-num">${pad3(n)}</span>` +
        `<span class="pref-info"><span class="tag sz-${s.size}"><i></i>${SIZE[s.size]}</span><span class="pref-loc">${note}</span></span>` +
        `<button class="pref-handle" type="button" aria-label="Arrastar a vaga ${pad3(n)} para reordenar">${HANDLE}</button>` +
        '</li>';
    }).join('');

    el.prefs.hidden = !count;
    el.listEmpty.hidden = count > 0;
  }

  let lastHero = null;

  function renderDraw() {
    const cur = current();
    const done = state.chosen != null;
    const kind = done ? 'done' : cur.kind;
    const n = done ? state.chosen : cur.n;
    const spot = n ? LOT.byNum[n] : null;

    el.hero.dataset.kind = kind;
    el.hero.dataset.size = spot ? spot.size : '';
    el.heroNum.textContent = spot ? pad3(n) : '—';
    el.heroBay.disabled = !spot;
    el.heroSize.className = 'tag' + (spot ? ' sz-' + spot.size : '');
    el.heroSize.innerHTML = spot ? `<i></i>${SIZE[spot.size]}` : '';
    el.heroSize.hidden = !spot;
    el.heroLoc.textContent = spot ? where(n) : '';

    const nextLine = (label, list) => (list && list.length ? `<span>${label}</span>${list.map((m) => `<b>${pad3(m)}</b>`).join('')}` : '');

    if (kind === 'done') {
      el.heroLabel.textContent = 'Sua vaga';
      el.heroRank.innerHTML = 'Garantida';
      el.heroNext.innerHTML = '';
      el.btnTurnLabel.textContent = 'Ver minha vaga';
    } else if (kind === 'pref') {
      el.heroLabel.textContent = 'Sua melhor opção agora';
      el.heroRank.innerHTML = `${cur.rank}ª opção<small>da sua lista</small>`;
      el.heroNext.innerHTML = nextLine('Depois', cur.next) || 'É a última livre da sua lista';
      el.btnTurnLabel.textContent = 'É a minha vez';
    } else if (kind === 'fallback') {
      el.heroLabel.textContent = 'Sua lista acabou';
      el.heroRank.innerHTML = `Fora da lista<small>a livre mais perto da ${pad3(cur.anchor)}</small>`;
      el.heroNext.innerHTML = nextLine('Outras perto', cur.next);
      el.btnTurnLabel.textContent = 'É a minha vez';
    } else if (kind === 'empty') {
      el.heroLabel.textContent = 'Sua melhor opção agora';
      el.heroRank.innerHTML = 'Sem lista ainda<small>Monte a sua ordem para eu dizer qual vaga pedir.</small>';
      el.heroNext.innerHTML = '';
      el.btnTurnLabel.textContent = 'Montar minha lista';
    } else {
      el.heroLabel.textContent = 'Sorteio encerrado';
      el.heroRank.innerHTML = 'Não sobrou vaga livre';
      el.heroNext.innerHTML = '';
      el.btnTurnLabel.textContent = 'É a minha vez';
    }

    const key = kind + ':' + n;
    if (lastHero !== null && lastHero !== key && spot) {
      el.hero.classList.remove('bump');
      void el.hero.offsetWidth;
      el.hero.classList.add('bump');
    }
    lastHero = key;

    el.feed.dataset.tone = feed.msg ? feed.tone : 'idle';
    el.feedMsg.innerHTML = feed.msg || (state.taken.length
      ? `${state.taken.length} de ${TOTAL} vagas já saíram.`
      : 'Digite o número de cada vaga que sair.');
    el.btnUndo.hidden = !state.taken.length;
    el.btnUndo.textContent = state.taken.length ? `Desfazer ${pad3(state.taken[state.taken.length - 1])}` : '';
  }

  // ---------- teclado do sorteio ----------

  let buf = '';

  function padCheck() {
    const n = +buf;
    if (!buf || n === 0) return { text: '', tone: 'idle', ok: false };
    if (!LOT.byNum[n]) return { text: 'não existe', tone: 'err', ok: false };
    if (isTaken(n)) return { text: 'já saiu', tone: 'err', ok: false };
    if (n === state.chosen) return { text: 'é a sua vaga', tone: 'err', ok: false };
    const rank = rankOf(n);
    if (rank) return { text: `livre · sua ${rank}ª opção`, tone: 'warn', ok: true };
    return { text: 'livre', tone: 'ok', ok: true };
  }

  function renderPad() {
    const shown = pad3(buf || 0), blank = 3 - buf.length;
    el.padDigits.innerHTML = [...shown].map((d, i) => `<i${i >= blank ? ' class="on"' : ''}>${d}</i>`).join('');
    const check = padCheck();
    el.padStatus.textContent = check.text;
    el.padDisplay.dataset.tone = check.tone;
    el.padOk.disabled = !check.ok;
  }

  let shakeTimer = 0;

  function padShake() {
    el.padDisplay.classList.remove('shake');
    void el.padDisplay.offsetWidth;
    el.padDisplay.classList.add('shake');
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => el.padDisplay.classList.remove('shake'), 400);
    buzz(40);
  }

  function padKey(key) {
    if (key === 'back') {
      buf = buf.slice(0, -1);
    } else if (key === 'ok') {
      if (!padCheck().ok) { padShake(); return; }
      const n = +buf;
      buf = '';
      markTaken(n);
      return;
    } else if (buf.length < 3) {
      buf += key;
    } else {
      padShake();
      return;
    }
    renderPad();
  }

  // ---------- é a minha vez ----------

  function renderTurn() {
    const cur = current();
    const done = state.chosen != null;
    const kind = done ? 'done' : cur.kind;
    const n = done ? state.chosen : cur.n;
    const spot = n ? LOT.byNum[n] : null;

    el.turn.dataset.kind = kind;
    el.turn.dataset.size = spot ? spot.size : '';
    el.turnNum.textContent = spot ? pad3(n) : '—';
    el.turnPlan.innerHTML = '';
    el.turnNo.hidden = false;
    el.turnMapSvg.style.display = spot ? '' : 'none';

    if (kind === 'done') {
      el.turnKicker.textContent = 'Vaga garantida';
      el.turnMeta.textContent = `${SIZE[spot.size]} · ${where(n)}`;
      el.turnYes.textContent = 'Fechar';
      el.turnNo.textContent = 'Desfazer: não fiquei com ela';
    } else if (kind === 'pref' || kind === 'fallback') {
      el.turnKicker.textContent = kind === 'pref' ? 'É a sua vez. Peça a vaga' : 'Sua lista acabou. Peça a vaga';
      el.turnMeta.textContent = kind === 'pref'
        ? `${cur.rank}ª opção da sua lista · ${SIZE[spot.size]} · ${where(n)}`
        : `Fora da lista: é a livre mais perto da ${pad3(cur.anchor)} · ${SIZE[spot.size]}`;
      if (cur.next.length) el.turnPlan.innerHTML = 'Se não der: ' + cur.next.map((m) => `<b>${pad3(m)}</b>`).join(' › ');
      el.turnYes.textContent = `Fiquei com a ${pad3(n)}`;
      el.turnNo.textContent = 'Já pegaram essa. Ver a próxima';
    } else if (kind === 'empty') {
      el.turnKicker.textContent = 'Você ainda não montou a lista';
      el.turnMeta.textContent = 'Sem a sua ordem de preferência não dá para dizer qual vaga pedir.';
      el.turnYes.textContent = 'Montar minha lista';
      el.turnNo.hidden = true;
    } else {
      el.turnKicker.textContent = 'Não sobrou vaga livre';
      el.turnMeta.textContent = 'Todas as vagas foram riscadas. Se riscou alguma por engano, devolva em "saíram", no topo.';
      el.turnYes.textContent = 'Fechar';
      el.turnNo.hidden = true;
    }

    if (spot) {
      if (!turnMap) turnMap = buildMap(el.turnMapSvg);
      paintMap(turnMap);
      el.turnMapSvg.setAttribute('viewBox', `${spot.c[0] - 210} ${spot.c[1] - 100} 420 200`);
      el.turnMapSvg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    }
  }

  function openTurn() {
    turnBusyUntil = performance.now() + 350;
    el.turn.hidden = false;
    renderTurn();
    buzz(20);
  }

  function closeTurn() {
    el.turn.hidden = true;
  }

  // Estes botões trocam de função no mesmo lugar; um toque duplo sem querer não pode valer duas vezes.
  let turnBusyUntil = 0;

  function turnBusy() {
    const now = performance.now();
    if (now < turnBusyUntil) return true;
    turnBusyUntil = now + 450;
    return false;
  }

  function turnYes() {
    if (turnBusy()) return;
    const kind = el.turn.dataset.kind;
    if (kind === 'pref' || kind === 'fallback') {
      state.chosen = current().n;
      feed = { msg: `Você ficou com a <b>${pad3(state.chosen)}</b>.`, tone: 'back' };
      buzz([40, 60, 120]);
      commit();
      return;
    }
    closeTurn();
    if (kind === 'empty') setTab('lista');
  }

  function turnNo() {
    if (turnBusy()) return;
    const kind = el.turn.dataset.kind;
    if (kind === 'done') {
      state.chosen = null;
      feed = { msg: 'Escolha desfeita.', tone: 'ok' };
      commit();
    } else if (kind === 'pref' || kind === 'fallback') {
      markTaken(current().n);
    }
  }

  // ---------- folha de opções e avisos ----------

  function openSheet(opts) {
    el.sheetTitle.textContent = opts.title;
    el.sheetText.textContent = opts.text || '';
    el.sheetBody.innerHTML = opts.body || '';
    el.sheetActions.innerHTML = '';
    const actions = (opts.actions || []).concat(opts.cancel === false ? [] : [{ label: opts.cancel || 'Fechar', kind: 'cancel' }]);
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn kind-' + (a.kind || 'plain');
      b.textContent = a.label;
      b.addEventListener('click', () => { closeSheet(); if (a.run) a.run(); });
      el.sheetActions.appendChild(b);
    }
    el.sheet.hidden = false;
  }

  function closeSheet() {
    el.sheet.hidden = true;
  }

  let toastTimer = 0;

  function toast(msg, opts) {
    opts = opts || {};
    clearTimeout(toastTimer);
    el.toastMsg.textContent = msg;
    el.toastAction.hidden = !opts.action;
    el.toastAction.textContent = opts.action || '';
    // O aviso pode nascer debaixo do dedo que acabou de tocar numa vaga; o clique desse mesmo
    // toque não pode acionar o "Desfazer". Só vale clique feito depois de o aviso aparecer.
    const shownAt = performance.now();
    el.toastAction.onclick = opts.run ? () => {
      if (performance.now() - shownAt < 500) return;
      hideToast();
      opts.run();
    } : null;
    el.toast.hidden = true;
    void el.toast.offsetWidth;
    el.toast.hidden = false;
    toastTimer = setTimeout(hideToast, opts.action ? 5000 : 2600);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    el.toast.hidden = true;
  }

  function openPrefSheet(n) {
    const i = state.prefs.indexOf(n), s = LOT.byNum[n], last = state.prefs.length - 1;
    const actions = [{ label: 'Ver no mapa', run: () => showOnMap(n) }];
    if (i > 0) actions.push({ label: 'Mover para o topo (1ª opção)', run: () => { movePref(i, 0); commit(); } });
    if (i > 0) actions.push({ label: 'Subir uma posição', run: () => { movePref(i, i - 1); commit(); } });
    if (i < last) actions.push({ label: 'Descer uma posição', run: () => { movePref(i, i + 1); commit(); } });
    if (i < last) actions.push({ label: 'Mover para o fim', run: () => { movePref(i, last); commit(); } });
    actions.push({ label: 'Tirar da lista', kind: 'danger', run: () => removePref(n) });
    openSheet({
      title: `Vaga ${pad3(n)}`,
      text: `${i + 1}ª da sua lista · ${SIZE[s.size]} · ${where(n)}${isTaken(n) ? ' · já saiu' : ''}`,
      actions,
    });
  }

  function openTakenSheet() {
    const list = state.taken.slice().reverse();
    openSheet({
      title: list.length ? `${list.length} de ${TOTAL} vagas saíram` : 'Nenhuma vaga saiu ainda',
      text: list.length
        ? 'Riscou alguma por engano? Toque nela para devolver. As contornadas em azul eram da sua lista.'
        : 'Na aba Sorteio, digite o número de cada vaga que for escolhida. Ela é riscada aqui e no mapa.',
      body: list.length ? `<div class="chips">${list.map((n) => `<button type="button" data-restore="${n}"${rankOf(n) ? ' class="was-pref"' : ''}>${pad3(n)}</button>`).join('')}</div>` : '',
    });
  }

  function openMenu() {
    openSheet({
      title: 'Opções',
      body: '<p class="note">Os tamanhos (grande, média, pequena) foram lidos da foto do mapa impresso. Antes do sorteio, confira no papel as vagas que mais importam para você.</p>',
      actions: [
        { label: 'Copiar link com a minha lista', run: shareList },
        { label: 'Ver a foto do mapa original', run: () => window.open('img/mapa-original.jpg', '_blank', 'noopener') },
        { label: 'Zerar o sorteio (devolve todas as vagas)', kind: 'danger', run: confirmResetDraw },
        { label: 'Apagar a minha lista', kind: 'danger', run: confirmClearList },
      ],
    });
  }

  function confirmResetDraw() {
    if (!state.taken.length && state.chosen == null) { toast('Nenhuma vaga foi riscada ainda'); return; }
    const count = state.taken.length;
    const freed = count === 1 ? 'A vaga riscada volta a ficar livre' : `As ${count} vagas riscadas voltam a ficar livres`;
    const undone = state.chosen != null ? (count ? ' e a sua escolha é desfeita' : 'A sua escolha é desfeita') : '';
    openSheet({
      title: 'Zerar o sorteio?',
      text: `${count ? freed : ''}${undone}. A sua lista de preferência continua igual.`,
      actions: [{ label: 'Zerar o sorteio', kind: 'danger', run: () => { state.taken = []; state.chosen = null; feed = { msg: '', tone: 'idle' }; buf = ''; commit(); toast('Sorteio zerado'); } }],
      cancel: 'Cancelar',
    });
  }

  function confirmClearList() {
    if (!state.prefs.length) { toast('A lista já está vazia'); return; }
    const backup = state.prefs.slice();
    openSheet({
      title: 'Apagar a sua lista?',
      text: `Você perde a ordem das ${backup.length} vagas que escolheu.`,
      actions: [{ label: 'Apagar a lista', kind: 'danger', run: () => { state.prefs = []; commit(); toast('Lista apagada', { action: 'Desfazer', run: () => { state.prefs = backup; commit(); } }); } }],
      cancel: 'Cancelar',
    });
  }

  function shareList() {
    if (!state.prefs.length) { toast('Monte a lista antes de compartilhar'); return; }
    const url = location.origin + location.pathname + '#l=' + state.prefs.join('.');
    askToKeepData();
    const manual = () => openSheet({
      title: 'Link da sua lista',
      text: 'Copie e abra no outro aparelho:',
      body: `<input class="link-box" readonly value="${url}">`,
    });
    if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
      navigator.share({ title: 'Minha lista de vagas', url }).catch(() => {});
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => toast('Link copiado. Abra no outro aparelho'), manual);
    } else {
      manual();
    }
  }

  // Lê a lista que veio no endereço: um link compartilhado ou a cópia de segurança do próprio app.
  function importFromAddress() {
    const link = readAddress();
    if (!link || !(link.prefs.length || link.taken.length)) return;
    const own = link.stamp > 0;
    const samePrefs = String(link.prefs) === String(state.prefs);
    const same = samePrefs && (!own || (String(link.taken) === String(state.taken) && link.chosen === state.chosen));
    if (same) return;

    const apply = (message) => {
      state.prefs = link.prefs;
      if (own) { state.taken = link.taken; state.chosen = link.chosen; }
      commit();
      toast(message);
    };
    const count = `${link.prefs.length} ${link.prefs.length === 1 ? 'vaga' : 'vagas'}`;
    const nothingHere = !state.prefs.length && !state.taken.length && state.chosen == null;

    if (nothingHere) { apply(own ? `Lista recuperada do endereço da página: ${count}` : `Lista importada: ${count}`); return; }
    // endereço antigo de uma aba que ficou para trás: o que está salvo aqui é mais novo
    if (own && link.stamp <= state.savedAt) return;
    if (!state.prefs.length && !own) { apply(`Lista importada: ${count}`); return; }

    const crossed = own && link.taken.length ? ` e ${link.taken.length} ${link.taken.length === 1 ? 'vaga riscada' : 'vagas riscadas'}` : '';
    openSheet({
      title: 'Importar a lista do link?',
      text: `O link traz uma lista com ${count}${crossed}. Ela substitui a que está neste aparelho, de ${state.prefs.length}.`,
      actions: [{ label: 'Substituir a minha lista', kind: 'primary', run: () => apply(`Lista importada: ${count}`) }],
      cancel: 'Manter a minha',
    });
  }

  // ---------- navegação ----------

  function setTab(tab) {
    state.tab = tab;
    if (tab !== 'mapa') {
      state.panel = tab;
      state.mapMode = tab === 'sorteio' ? 'saidas' : 'lista';
    }
    save();
    renderChrome();
    if (tab === 'mapa' || wide.matches) panzoom.measure();
    keepAwake();
  }

  function showOnMap(n) {
    if (!wide.matches) {
      state.tab = 'mapa';
      save();
      renderChrome();
    }
    panzoom.focus(n);
  }

  function onMapTap(n) {
    if (state.mapMode === 'lista') {
      if (rankOf(n)) {
        removePref(n);
      } else {
        const r = addPref(n);
        toast(r.msg);
        buzz(12);
      }
      return;
    }
    if (isTaken(n)) {
      restore(n);
      toast(`${pad3(n)} voltou a ficar livre`);
    } else if (n === state.chosen) {
      toast(`A ${pad3(n)} é a sua vaga`);
    } else {
      const r = markTaken(n);
      toast(r.plain, { action: 'Desfazer', run: () => restore(n) });
    }
  }

  // Reordenar a lista arrastando pela alça.
  function startDrag(e, row, handle) {
    const rows = [...el.prefs.children];
    const from = rows.indexOf(row);
    const h = row.offsetHeight;
    const scroller = el.viewList;
    const startY = e.clientY, startScroll = scroller.scrollTop;
    let lastY = startY, to = from, raf = 0;

    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro sintético */ }
    el.prefs.classList.add('sorting');
    row.classList.add('dragging');
    buzz(10);

    const place = () => {
      const dy = clamp(lastY - startY + scroller.scrollTop - startScroll, -from * h, (rows.length - 1 - from) * h);
      row.style.transform = `translateY(${dy}px)`;
      to = clamp(from + Math.round(dy / h), 0, rows.length - 1);
      rows.forEach((r, i) => {
        if (r === row) return;
        const shift = i > from && i <= to ? -h : i < from && i >= to ? h : 0;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };

    const tick = () => {
      const rect = scroller.getBoundingClientRect(), edge = 64;
      let v = 0;
      if (lastY < rect.top + edge) v = -(rect.top + edge - lastY) / 5;
      else if (lastY > rect.bottom - edge) v = (lastY - (rect.bottom - edge)) / 5;
      if (v) { scroller.scrollTop += v; place(); }
      raf = requestAnimationFrame(tick);
    };

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      lastY = ev.clientY;
      place();
    };

    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      cancelAnimationFrame(raf);
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      el.prefs.classList.remove('sorting');
      if (ev.type === 'pointerup') movePref(from, to);
      commit();
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    raf = requestAnimationFrame(tick);
  }

  // Mantém a tela acesa durante o sorteio.
  let wakeLock = null;

  function keepAwake() {
    const want = state.panel === 'sorteio' && document.visibilityState === 'visible';
    if (want && !wakeLock && navigator.wakeLock) {
      navigator.wakeLock.request('screen').then((lock) => {
        wakeLock = lock;
        lock.addEventListener('release', () => { wakeLock = null; });
      }).catch(() => {});
    } else if (!want && wakeLock) {
      wakeLock.release().catch(() => {});
    }
  }

  // ---------- eventos ----------

  el.tabbar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (b) setTab(b.dataset.tab);
  });

  el.mapMode.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (!b) return;
    state.mapMode = b.dataset.mode;
    save();
    renderChrome();
  });

  $('#zoomIn').addEventListener('click', () => panzoom.zoomBy(1.7));
  $('#zoomOut').addEventListener('click', () => panzoom.zoomBy(1 / 1.7));
  $('#zoomFit').addEventListener('click', () => panzoom.fit());

  el.countPill.addEventListener('click', openTakenSheet);
  $('#btnMenu').addEventListener('click', openMenu);

  el.addForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = el.addInput.value.trim();
    if (!/^\d{1,3}$/.test(raw)) { toast('Digite o número da vaga, de 1 a ' + TOTAL); return; }
    const r = addPref(+raw);
    toast(r.msg);
    if (r.ok) {
      el.addInput.value = '';
      el.viewList.scrollTop = el.viewList.scrollHeight;
    } else {
      el.addInput.select();
    }
  });
  // No iPhone, fechar o teclado pode deixar a página deslocada; volta ao lugar.
  el.addInput.addEventListener('blur', () => { window.scrollTo(0, 0); });
  el.addInput.addEventListener('input', () => { el.addInput.value = el.addInput.value.replace(/\D/g, '').slice(0, 3); });

  const pickOnMap = () => { state.mapMode = 'lista'; state.tab = 'mapa'; save(); renderChrome(); panzoom.measure(); };
  $('#btnPickOnMap').addEventListener('click', pickOnMap);
  $('#btnEmptyMap').addEventListener('click', pickOnMap);

  el.prefs.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('.pref-handle');
    if (!handle || e.button) return;
    e.preventDefault();
    startDrag(e, handle.closest('.pref'), handle);
  });
  el.prefs.addEventListener('click', (e) => {
    if (e.target.closest('.pref-handle')) return;
    const row = e.target.closest('.pref');
    if (row) openPrefSheet(+row.dataset.n);
  });

  el.btnTurn.addEventListener('click', () => {
    if (current().kind === 'empty' && state.chosen == null) setTab('lista');
    else openTurn();
  });
  el.heroBay.addEventListener('click', () => {
    const n = state.chosen != null ? state.chosen : current().n;
    if (n) showOnMap(n);
  });
  el.btnUndo.addEventListener('click', () => {
    if (state.taken.length) restore(state.taken[state.taken.length - 1]);
  });

  $('.pad-keys').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-key]');
    if (b) padKey(b.dataset.key);
  });

  $('#turnClose').addEventListener('click', closeTurn);
  el.turnYes.addEventListener('click', turnYes);
  el.turnNo.addEventListener('click', turnNo);

  el.sheet.addEventListener('click', (e) => {
    if (e.target === el.sheet) { closeSheet(); return; }
    const chip = e.target.closest('button[data-restore]');
    if (chip) {
      restore(+chip.dataset.restore);
      if (state.taken.length) openTakenSheet(); else closeSheet();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!el.sheet.hidden) closeSheet();
      else if (!el.turn.hidden) closeTurn();
      return;
    }
    const typing = e.target instanceof HTMLInputElement;
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !el.sheet.hidden || !el.turn.hidden) return;
    // Enter num botão focado (fora do teclado numérico) aciona o botão, não o "Riscar".
    const onOtherButton = e.target instanceof HTMLButtonElement && !e.target.closest('.pad-keys');
    if (onOtherButton && (e.key === 'Enter' || e.key === ' ')) return;
    const drawVisible = wide.matches ? state.panel === 'sorteio' : state.tab === 'sorteio';
    if (!drawVisible) return;
    if (/^\d$/.test(e.key)) padKey(e.key);
    else if (e.key === 'Backspace') padKey('back');
    else if (e.key === 'Enter') { e.preventDefault(); padKey('ok'); }
  });

  wide.addEventListener('change', () => { renderChrome(); panzoom.measure(); });

  // Outra aba deste navegador mudou os dados: acompanha, para uma não salvar por cima da outra.
  window.addEventListener('storage', (e) => {
    if (e.key !== null && e.key !== STORE) return;
    loadState(true);
    render();
    syncAddress();
  });

  // No iOS, o estado :active dos botões só aparece se a página escutar toques.
  document.addEventListener('touchstart', () => {}, { passive: true });
  document.addEventListener('visibilitychange', keepAwake);
  window.addEventListener('hashchange', () => { importFromAddress(); syncAddress(); });

  // ---------- início ----------

  loadState();
  render();
  importFromAddress(); // antes de gravar: o endereço pode ser a única cópia que sobrou
  save();
  panzoom.measure();
  keepAwake();

  // Em localhost o service worker fica desligado (não servir arquivos antigos), salvo com ?sw.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator && (!local || /[?&]sw(&|$)/.test(location.search))) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
