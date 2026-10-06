// Caça a bugs de ponta a ponta: roda o app no WebKit (motor do Safari) e no Chromium,
// nos tamanhos do iPhone 17 Pro Max e do iPad Pro 13", e confere layout, toque,
// memória (localStorage) e funcionamento offline.
//
//   npm test                 roda tudo
//   SHOTS=pasta npm test     escolhe onde salvar as capturas (padrão: tests/shots)
//   ONLY=iphone npm test     só os aparelhos cujo id contém o texto

import { webkit, chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = process.env.SHOTS || path.join(ROOT, 'tests', 'shots');
const ONLY = process.env.ONLY || '';
const KEY = 'sorteio-vagas:v1';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

const DEVICES = [
  { id: 'iphone17promax-safari', label: 'iPhone 17 Pro Max, Safari com as barras', w: 440, h: 770, dpr: 3, ua: IPHONE_UA, mobile: true },
  { id: 'iphone17promax-cheia', label: 'iPhone 17 Pro Max, tela cheia (tela inicial)', w: 440, h: 956, dpr: 3, ua: IPHONE_UA, mobile: true },
  { id: 'iphone17promax-deitado', label: 'iPhone 17 Pro Max deitado', w: 956, h: 440, dpr: 3, ua: IPHONE_UA, mobile: true },
  { id: 'ipadpro13-em-pe', label: 'iPad Pro 13" em pé', w: 1032, h: 1376, dpr: 2, ua: IPAD_UA },
  { id: 'ipadpro13-deitado', label: 'iPad Pro 13" deitado', w: 1376, h: 1032, dpr: 2, ua: IPAD_UA },
  { id: 'iphone-se-safari', label: 'iPhone SE, Safari com as barras (tela pequena)', w: 375, h: 553, dpr: 2, ua: IPHONE_UA, mobile: true },
];

// ---------- servidor estático ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json', '.json': 'application/json',
};

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// ---------- relatório ----------

const findings = [];
let scope = '';
let passed = 0;

function check(ok, message) {
  if (ok) { passed++; return true; }
  findings.push(`[${scope}] ${message}`);
  console.log(`  ✗ ${message}`);
  return false;
}

// ---------- ajudantes dentro da página ----------

const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) || 'null'), KEY);
const text = (page, sel) => page.evaluate((s) => (document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ').trim(), sel);
const settle = (page, ms = 350) => page.waitForTimeout(ms);

// Problemas de layout na tela atual: coisas fora da tela, sobrepostas ou com texto cortado.
function layoutProblems(page, spec) {
  return page.evaluate((spec) => {
    const out = [];
    const vw = window.innerWidth, vh = window.innerHeight;
    const shown = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const rect = (e) => e.getBoundingClientRect();
    const all = (sel) => [...document.querySelectorAll(sel)].filter(shown);
    const name = (e) => e.id ? '#' + e.id : (e.className && e.className.baseVal === undefined ? '.' + String(e.className).split(' ')[0] : e.tagName) + (e.textContent ? `"${e.textContent.trim().slice(0, 14)}"` : '');

    if (document.documentElement.scrollWidth > vw + 1) out.push(`página com rolagem horizontal (${document.documentElement.scrollWidth} > ${vw})`);

    for (const sel of spec.onScreen || []) {
      for (const e of all(sel)) {
        const b = rect(e);
        if (b.left < -0.5 || b.top < -0.5 || b.right > vw + 0.5 || b.bottom > vh + 0.5) {
          out.push(`${name(e)} sai da tela (${Math.round(b.left)},${Math.round(b.top)} a ${Math.round(b.right)},${Math.round(b.bottom)} em ${vw}x${vh})`);
        }
      }
    }
    for (const [outer, inner] of spec.inside || []) {
      const o = document.querySelector(outer);
      if (!shown(o)) continue;
      const ob = rect(o);
      for (const e of all(inner)) {
        const b = rect(e);
        if (b.left < ob.left - 0.5 || b.top < ob.top - 0.5 || b.right > ob.right + 0.5 || b.bottom > ob.bottom + 0.5) out.push(`${name(e)} vaza para fora de ${outer}`);
      }
    }
    for (const [a, b] of spec.apart || []) {
      const ea = document.querySelector(a), eb = document.querySelector(b);
      if (!shown(ea) || !shown(eb)) continue;
      const ra = rect(ea), rb = rect(eb);
      const overlap = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left) > 1 && Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top) > 1;
      if (overlap && ra.width && rb.width) out.push(`${a} e ${b} se sobrepõem`);
    }
    for (const sel of spec.noClip || []) {
      for (const e of all(sel)) {
        // com line-height 1 a tinta das letras passa da caixa sem ser cortada; só conta se a caixa corta
        const clipsY = getComputedStyle(e).overflowY !== 'visible';
        if (e.scrollWidth > e.clientWidth + 1 || (clipsY && e.scrollHeight > e.clientHeight + 1)) out.push(`texto cortado em ${name(e)} (${e.scrollWidth}x${e.scrollHeight} em ${e.clientWidth}x${e.clientHeight})`);
      }
    }
    for (const [sel, min] of spec.minHeight || []) {
      for (const e of all(sel)) if (rect(e).height < min - 0.5) out.push(`${name(e)} tem ${Math.round(rect(e).height)}px de altura (mínimo ${min} para o dedo)`);
    }
    for (const [sel, min] of spec.minWidth || []) {
      for (const e of all(sel)) if (rect(e).width < min - 0.5) out.push(`${name(e)} ficou com ${Math.round(rect(e).width)}px de largura (mínimo ${min})`);
    }
    // dentro de uma folha com rolagem, basta dar para chegar ao fim
    for (const sel of spec.reachable || []) {
      const box = document.querySelector(sel);
      if (!shown(box)) continue;
      box.scrollTop = 1e6;
      const b = rect(box), last = box.lastElementChild && rect(box.lastElementChild);
      if (b.top < -0.5 || b.bottom > vh + 0.5) out.push(`${sel} sai da tela`);
      if (last && last.bottom > b.bottom + 0.5) out.push(`não dá para rolar ${sel} até o fim`);
      box.scrollTop = 0;
    }
    for (const sel of spec.noScroll || []) {
      const e = document.querySelector(sel);
      if (shown(e) && e.scrollHeight > e.clientHeight + 1) out.push(`${sel} precisa de rolagem (${e.scrollHeight} > ${e.clientHeight})`);
    }
    return out;
  }, spec);
}

const DRAW_LAYOUT = {
  onScreen: ['#hero', '#feed', '#padDisplay', '.pad-keys button', '#tabbar', '.topbar'],
  inside: [['#hero', '#heroLabel'], ['#hero', '#heroBay'], ['#hero', '.hero-meta'], ['#hero', '#btnTurn'], ['#hero', '#heroNext'], ['#heroBay', '#heroNum']],
  apart: [['#heroLabel', '#heroBay'], ['#heroBay', '.hero-meta'], ['#heroBay', '#btnTurn'], ['.hero-meta', '#btnTurn'], ['#heroNext', '#heroBay'], ['#heroNext', '#btnTurn'], ['#heroNext', '.hero-meta'], ['#hero', '#feed'], ['#feed', '#pad'], ['#pad', '#tabbar']],
  noClip: ['#btnTurn', '#heroRank', '#heroNext', '.pad-keys button', '.tabbar button', '#countPill', '#padStatus', '#feedMsg', '.brand-text strong'],
  minHeight: [['.pad-keys button', 40], ['#btnTurn', 40]],
  minWidth: [['.hero-meta', 110], ['.pad-keys button', 60]],
  noScroll: ['#viewDraw'],
};

const TURN_LAYOUT = {
  onScreen: ['#turnClose', '#turnKicker', '.turn-bay', '#turnMeta', '#turnYes', '#turnNo'],
  inside: [['.turn-bay', '#turnNum']],
  apart: [['#turnClose', '#turnKicker'], ['#turnKicker', '.turn-bay'], ['.turn-bay', '#turnMeta'], ['#turnMeta', '#turnMap'], ['#turnMeta', '#turnPlan'], ['#turnPlan', '#turnYes'], ['#turnMap', '#turnPlan'], ['#turnYes', '#turnNo']],
  noClip: ['#turnYes', '#turnNo', '#turnKicker'],
  minHeight: [['#turnYes', 44]],
  noScroll: ['#turn'],
};

const LIST_LAYOUT = {
  onScreen: ['.topbar', '#tabbar', '.add-field', '#addForm .btn'],
  apart: [['.list-head', '#addForm'], ['#addForm', '#prefs']],
  noClip: ['.pref-num', '.tabbar button', '#addForm .btn', '#listSummary'],
  minHeight: [['.pref-handle', 44]],
};

const MAP_LAYOUT = {
  onScreen: ['.seg', '.map-zoom', '.legend', '#tabbar', '.topbar'],
  inside: [['#mapWrap', '#mapHint']],
  apart: [['#mapHint', '.map-zoom'], ['.seg', '#mapWrap'], ['#mapWrap', '.legend']],
  noClip: ['.seg button', '.legend li'],
  minHeight: [['.map-zoom button', 44]],
};

// ---------- um aparelho ----------

async function runDevice(browser, engine, device, base) {
  scope = `${engine} · ${device.label}`;
  console.log(`\n${scope}`);
  const wide = device.w >= 960;
  const dir = path.join(SHOTS, `${engine}-${device.id}`);
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    viewport: { width: device.w, height: device.h }, deviceScaleFactor: Math.min(device.dpr, 2),
    userAgent: device.ua, hasTouch: true, isMobile: engine === 'chromium' ? !!device.mobile : undefined,
    locale: 'pt-BR', colorScheme: 'dark',
  });
  context.setDefaultTimeout(8000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('erro de script: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('pedido falhou: ' + r.url()));

  const shot = (name) => page.screenshot({ path: path.join(dir, name + '.png') });
  const press = (sel) => page.locator(sel).first().tap();
  const layout = async (label, spec) => { for (const p of await layoutProblems(page, spec)) check(false, `${label}: ${p}`); };
  const goTab = async (tab) => {
    if (wide && tab === 'mapa') return;
    await press(`#tabbar [data-tab="${tab}"]`);
    await settle(page, 250);
  };
  const digits = async (n) => { for (const d of String(n)) await press(`.pad-keys [data-key="${d}"]`); };
  const clearPad = async () => { for (let i = 0; i < 3; i++) await press('.pad-keys [data-key="back"]'); };
  const type = async (n) => { await digits(n); await press('#padOk'); };
  // Toca numa vaga do mapa com o dedo. Com o mapa afastado, o primeiro toque só aproxima.
  const tapSpot = async (n) => {
    for (let i = 0; i < 4; i++) {
      const before = JSON.stringify(await stored(page));
      const p = await page.evaluate((n) => {
        const b = document.querySelector(`#map .spot[data-n="${n}"] .s-body`).getBoundingClientRect();
        const w = document.querySelector('#mapWrap').getBoundingClientRect();
        const x = b.left + b.width / 2, y = b.top + b.height / 2;
        return { x, y, inView: x > w.left + 4 && x < w.right - 4 && y > w.top + 4 && y < w.bottom - 4 };
      }, n);
      if (!p.inView) { await press('#zoomFit'); await settle(page, 600); continue; }
      await page.touchscreen.tap(p.x, p.y);
      await settle(page, 600);
      if (JSON.stringify(await stored(page)) !== before) return true;
    }
    return false;
  };

  // 1. primeira abertura
  await page.goto(base + '/');
  await page.waitForFunction(() => document.querySelectorAll('#map .spot').length > 0);
  await page.evaluate(() => document.fonts.ready);
  check(await page.evaluate(() => document.querySelectorAll('#map .spot').length) === 211, 'o mapa não tem 211 vagas');
  check(await page.evaluate(() => document.fonts.check('700 40px "Barlow Condensed"') && [...document.fonts].some((f) => f.family.includes('Barlow Condensed') && f.status === 'loaded')), 'a fonte dos números (Barlow Condensed) não carregou');
  check(await text(page, '#listEmpty') !== '', 'a lista vazia não mostra a orientação inicial');
  await shot('01-lista-vazia');
  await layout('lista vazia', LIST_LAYOUT);

  // sorteio sem lista
  await goTab('sorteio');
  await layout('sorteio sem lista', DRAW_LAYOUT);
  await shot('02-sorteio-sem-lista');
  await goTab('lista');

  // 2. montar a lista pelo campo
  await page.locator('#addInput').tap();
  await page.keyboard.type('68');
  await page.keyboard.press('Enter');
  await page.locator('#addInput').fill('67');
  await press('#addForm .btn-primary');
  check(String((await stored(page))?.prefs) === '68,67', `adicionar pelo campo: lista ficou ${(await stored(page))?.prefs}`);
  await page.locator('#addInput').fill('300');
  await press('#addForm .btn-primary');
  check((await text(page, '#toastMsg')).includes('não existe'), 'vaga 300 deveria ser recusada com aviso');
  await page.locator('#addInput').fill('68');
  await press('#addForm .btn-primary');
  check((await text(page, '#toastMsg')).includes('já é'), 'vaga repetida deveria ser recusada com aviso');
  check(String((await stored(page)).prefs) === '68,67', 'entrada inválida mudou a lista');
  await page.locator('#addInput').fill('');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());

  // 3. montar a lista pelo mapa, com o dedo
  if (!wide) { await press('#btnPickOnMap'); await settle(page); }
  check(await page.evaluate(() => document.querySelector('#mapMode .is-active')?.dataset.mode) === 'lista', 'o mapa deveria abrir no modo "Montar lista"');
  await layout('mapa', MAP_LAYOUT);
  await shot('03-mapa-inteiro');
  for (const n of [66, 5, 170, 100]) check(await tapSpot(n), `tocar na vaga ${n} no mapa não a colocou na lista`);
  check(String((await stored(page)).prefs) === '68,67,66,5,170,100', `lista depois do mapa: ${(await stored(page)).prefs}`);
  check(await page.evaluate(() => document.querySelector('#map .spot[data-n="170"] .s-rank').textContent) === '5ª', 'o mapa não mostra a posição (5ª) na vaga 170');
  await shot('04-mapa-aproximado');

  // pinça com dois dedos (eventos de ponteiro sintéticos)
  const pinch = await page.evaluate(async () => {
    const svg = document.querySelector('#map'), r = svg.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const width = () => +svg.getAttribute('viewBox').split(' ')[2];
    const ev = (t, id, x, y, primary) => svg.dispatchEvent(new PointerEvent(t, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: primary, clientX: x, clientY: y, button: 0 }));
    document.querySelector('#zoomFit').click();
    await new Promise((res) => setTimeout(res, 600));
    const w0 = width();
    ev('pointerdown', 21, cx - 30, cy, true); ev('pointerdown', 22, cx + 30, cy, false);
    for (let d = 30; d <= 120; d += 15) { ev('pointermove', 21, cx - d, cy, true); ev('pointermove', 22, cx + d, cy, false); }
    const w1 = width();
    ev('pointerup', 21, cx - 120, cy, true); ev('pointerup', 22, cx + 120, cy, false);
    // um dedo que nunca "soltou" não pode travar os toques seguintes
    ev('pointerdown', 31, cx, cy, false);
    ev('pointerdown', 32, cx - 40, cy + 40, true); ev('pointermove', 32, cx + 40, cy + 40, true);
    const moved = svg.getAttribute('viewBox');
    ev('pointermove', 32, cx + 90, cy + 40, true);
    const moved2 = svg.getAttribute('viewBox');
    ev('pointerup', 32, cx + 90, cy + 40, true);
    return { w0, w1, panned: moved !== moved2 && +moved2.split(' ')[2] === +moved.split(' ')[2] };
  });
  check(pinch.w1 < pinch.w0 * 0.6, `pinça não aproximou o mapa (largura ${pinch.w0.toFixed(0)} -> ${pinch.w1.toFixed(0)})`);
  check(pinch.panned, 'depois de um toque perdido, arrastar com um dedo virou pinça (ponteiro preso)');
  await press('#zoomFit');
  await settle(page, 500);

  // o aviso com "Desfazer" pode aparecer debaixo do dedo: o clique do mesmo toque não pode desfazer
  const ghost = await page.evaluate(async (key) => {
    const prefs = () => JSON.parse(localStorage.getItem(key)).prefs;
    const svg = document.querySelector('#map');
    const b = svg.querySelector('.spot[data-n="100"] .s-body').getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, pointerId: 41, pointerType: 'mouse', isPrimary: true, button: 0, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2 };
    svg.dispatchEvent(new PointerEvent('pointerdown', at));
    svg.dispatchEvent(new PointerEvent('pointerup', at));
    const removed = !prefs().includes(100);
    document.querySelector('#toastAction').click();
    const stillRemoved = !prefs().includes(100);
    await new Promise((res) => setTimeout(res, 700));
    document.querySelector('#toastAction').click();
    return { removed, stillRemoved, undone: prefs().includes(100), order: String(prefs()) };
  }, KEY);
  check(ghost.removed, 'tocar numa vaga que já está na lista deveria tirá-la');
  check(ghost.stillRemoved, 'o clique do próprio toque acionou o "Desfazer" do aviso (a vaga voltou sozinha)');
  check(ghost.undone && ghost.order === '68,67,66,5,170,100', `"Desfazer" depois de um instante deveria devolver a vaga ao mesmo lugar; lista: ${ghost.order}`);
  await settle(page, 300);

  // 4. lista: aparência, arrastar, opções, rolagem
  await goTab('lista');
  await layout('lista', LIST_LAYOUT);
  await shot('05-lista');
  const handle = await page.locator('#prefs .pref-handle').first().boundingBox();
  const rowH = await page.evaluate(() => document.querySelector('#prefs .pref').offsetHeight);
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + (rowH * 2.1 * i) / 8);
  await page.mouse.up();
  await settle(page, 250);
  check(String((await stored(page)).prefs) === '67,66,68,5,170,100', `arrastar a 1ª duas posições para baixo: lista ficou ${(await stored(page)).prefs}`);
  check(await page.evaluate(() => document.querySelector('#sheet').hidden), 'soltar a alça abriu a folha de opções');

  await page.locator('#prefs .pref').nth(2).locator('.pref-num').tap();
  await settle(page);
  check(!(await page.evaluate(() => document.querySelector('#sheet').hidden)), 'tocar numa linha não abriu as opções');
  await layout('opções da vaga', { reachable: ['.sheet'], noClip: ['.sheet-actions .btn'], minHeight: [['.sheet-actions .btn', 44]] });
  await shot('06-opcoes-da-vaga');
  await page.locator('#sheetActions button', { hasText: 'topo' }).tap();
  check(String((await stored(page)).prefs) === '68,67,66,5,170,100', `"mover para o topo": lista ficou ${(await stored(page)).prefs}`);

  for (const n of [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 19, 21, 23]) {
    await page.locator('#addInput').fill(String(n));
    await page.keyboard.press('Enter');
  }
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await settle(page, 200);
  const scroll = await page.evaluate(() => {
    const v = document.querySelector('#viewList'), last = document.querySelector('#prefs .pref:last-child');
    v.scrollTop = 1e6;
    const b = last.getBoundingClientRect(), vb = v.getBoundingClientRect();
    return { rows: document.querySelectorAll('#prefs .pref').length, canScroll: v.scrollHeight > v.clientHeight, lastVisible: b.bottom <= vb.bottom + 1 && b.top >= vb.top };
  });
  check(scroll.rows === 24, `esperava 24 vagas na lista, há ${scroll.rows}`);
  check(scroll.canScroll && scroll.lastVisible, 'lista longa: não dá para rolar até a última vaga');
  await shot('07-lista-longa-no-fim');

  // 5. memória: recarregar mantém tudo
  const before = await stored(page);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#prefs .pref').length > 0);
  check(String((await stored(page)).prefs) === String(before.prefs), 'recarregar a página perdeu ou mudou a lista');
  check(await page.evaluate(() => [...document.querySelectorAll('#prefs .pref-num')].map((e) => +e.textContent).join()) === String(before.prefs), 'depois de recarregar, a lista na tela não bate com a salva');
  check(await page.evaluate(() => document.querySelector('#app').dataset.tab) === 'lista', 'recarregar não voltou para a aba em que estava');

  // 6. sorteio
  await goTab('sorteio');
  check(await text(page, '#heroNum') === '068', `melhor opção deveria ser 068, mostra ${await text(page, '#heroNum')}`);
  await layout('sorteio', DRAW_LAYOUT);
  await shot('08-sorteio');

  await type(12);
  check((await text(page, '#feedMsg')).startsWith('012 saiu'), `riscar 012: mensagem "${await text(page, '#feedMsg')}"`);
  await type(67);
  check((await text(page, '#feedMsg')).includes('2ª opção'), 'riscar a 2ª opção deveria avisar que era da lista');
  await type(68);
  check(await text(page, '#heroNum') === '066', `depois de sair a 068 e a 067 a melhor deveria ser 066, mostra ${await text(page, '#heroNum')}`);
  await settle(page, 700);
  await layout('sorteio depois de riscar', DRAW_LAYOUT);
  await shot('09-sorteio-apos-riscar');

  // dois toques seguidos na mesma tecla
  await press('.pad-keys [data-key="1"]'); await press('.pad-keys [data-key="1"]');
  check(await text(page, '#padDigits') === '0 1 1' || await text(page, '#padDigits') === '011', `dois toques no "1" deveriam dar 011, deu "${await text(page, '#padDigits')}"`);
  await press('.pad-keys [data-key="1"]'); await press('.pad-keys [data-key="1"]');
  check((await text(page, '#padDigits')).replace(/ /g, '') === '111', 'quarto dígito deveria ser ignorado');
  await layout('teclado com número digitado', DRAW_LAYOUT);
  await clearPad();
  await digits(300);
  check(await page.locator('#padOk').isDisabled() && (await text(page, '#padStatus')).includes('não existe'), 'vaga 300 deveria deixar o "Riscar" desligado e avisar que não existe');
  await clearPad();
  await digits(12);
  check(await page.locator('#padOk').isDisabled() && (await text(page, '#padStatus')).includes('já saiu'), 'vaga já riscada deveria deixar o "Riscar" desligado');
  await clearPad();
  check(String((await stored(page)).taken) === '12,67,68', `entradas inválidas mudaram as vagas riscadas: ${(await stored(page)).taken}`);

  await press('#btnUndo');
  check(String((await stored(page)).taken) === '12,67' && await text(page, '#heroNum') === '068', 'desfazer não devolveu a 068');
  await type(68);

  // riscar pelo mapa
  if (!wide) { await goTab('mapa'); }
  check(await page.evaluate(() => document.querySelector('#mapMode .is-active')?.dataset.mode) === 'saidas', 'vindo do sorteio, o mapa deveria estar em "Marcar saídas"');
  check(await tapSpot(101), 'tocar na vaga 101 no mapa (modo saídas) não a riscou');
  check((await stored(page)).taken.includes(101), 'a 101 não entrou nas vagas que saíram');
  await shot('10-mapa-saidas');
  await press('#zoomFit'); await settle(page, 500);
  await shot('11-mapa-inteiro-com-estado');
  await goTab('sorteio');

  // memória do sorteio
  const mid = await stored(page);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#heroNum').textContent !== '—');
  check(String((await stored(page)).taken) === String(mid.taken), 'recarregar perdeu as vagas riscadas');
  check(await text(page, '#heroNum') === '066' && await text(page, '#countNum') === String(mid.taken.length), 'depois de recarregar, o sorteio não voltou ao mesmo ponto');

  // vagas que saíram
  await press('#countPill');
  await settle(page);
  await layout('folha das vagas que saíram', { reachable: ['.sheet'], noClip: ['.chips button'], minHeight: [['.chips button', 44]] });
  await shot('12-saiu');
  await page.locator('#sheet [data-restore="12"]').tap();
  check(!(await stored(page)).taken.includes(12), 'devolver a 012 pela folha não funcionou');
  await page.locator('#sheetActions button').last().tap();

  // 7. é a minha vez
  await press('#btnTurn');
  await settle(page, 700);
  check(await text(page, '#turnNum') === '066', `"é a minha vez" deveria mostrar 066, mostra ${await text(page, '#turnNum')}`);
  await layout('é a minha vez', TURN_LAYOUT);
  await shot('13-minha-vez');
  await press('#turnNo');
  await settle(page, 600);
  // toque duplo sem querer em "já pegaram essa" não pode riscar duas vagas
  const takenBefore = (await stored(page)).taken.length;
  await page.evaluate(() => { const b = document.querySelector('#turnNo'); b.click(); b.click(); });
  check((await stored(page)).taken.length === takenBefore + 1, 'toque duplo em "já pegaram essa" riscou mais de uma vaga');
  await page.evaluate((key) => { const s = JSON.parse(localStorage.getItem(key)); s.taken.pop(); localStorage.setItem(key, JSON.stringify(s)); }, KEY);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#heroNum').textContent === '005');
  await press('#btnTurn');
  await settle(page, 700);
  check(await text(page, '#turnNum') === '005', `"já pegaram essa" deveria passar para a 005, mostra ${await text(page, '#turnNum')}`);
  await press('#turnYes');
  await settle(page, 500);
  check((await stored(page)).chosen === 5, 'confirmar a vaga não salvou a escolha');
  await layout('vaga garantida', TURN_LAYOUT);
  await shot('14-vaga-garantida');
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#hero').dataset.kind === 'done');
  check((await stored(page)).chosen === 5 && await text(page, '#heroNum') === '005', 'recarregar perdeu a vaga escolhida');
  await layout('sorteio com vaga garantida', DRAW_LAYOUT);
  await shot('15-sorteio-garantida');
  await press('#btnTurn'); await settle(page, 400);
  await press('#turnNo'); await settle(page, 600);
  check((await stored(page)).chosen === null, 'desfazer a escolha não funcionou');
  await press('#turnClose');

  // lista esgotada: sugere a vaga livre mais próxima
  await page.evaluate((key) => {
    const s = JSON.parse(localStorage.getItem(key));
    s.taken = [...new Set([...s.taken, ...s.prefs])];
    localStorage.setItem(key, JSON.stringify(s));
  }, KEY);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('#hero').dataset.kind === 'fallback');
  await layout('lista esgotada', DRAW_LAYOUT);
  await shot('16-lista-esgotada');
  await press('#btnTurn'); await settle(page, 600);
  await layout('é a minha vez com lista esgotada', TURN_LAYOUT);
  await shot('17-minha-vez-fora-da-lista');
  await press('#turnClose');

  // menu
  await press('#btnMenu'); await settle(page);
  await layout('menu', { reachable: ['.sheet'], noClip: ['.sheet-actions .btn'] });
  await shot('18-menu');
  await page.locator('#sheetActions button').last().tap();

  for (const e of [...new Set(errors)]) check(false, e);
  await context.close();
}

// ---------- memória: casos extremos ----------

async function runStorage(browser, engine, base) {
  scope = `${engine} · memória`;
  console.log(`\n${scope}`);
  const context = await browser.newContext({ viewport: { width: 440, height: 770 }, hasTouch: true, userAgent: IPHONE_UA });
  context.setDefaultTimeout(12000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('erro de script: ' + e.message));

  // dados corrompidos ou estranhos não podem quebrar o app
  await page.goto(base + '/');
  for (const [label, value, want] of [
    ['JSON quebrado', '{"prefs":[1,2', ''],
    ['tipos errados', JSON.stringify({ prefs: 'abc', taken: { a: 1 }, chosen: 'x', tab: 9 }), ''],
    ['números inválidos e repetidos', JSON.stringify({ prefs: [5, 5, 0, 999, '7', -3, 8.5, null, 12], taken: [5, 5, 400] }), '5,12'],
  ]) {
    await page.evaluate(([key, v]) => localStorage.setItem(key, v), [KEY, value]);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#map .spot').length === 211);
    const shown = await page.evaluate(() => [...document.querySelectorAll('#prefs .pref-num')].map((e) => +e.textContent).join());
    check(shown === want, `${label}: a lista deveria ficar "${want}", ficou "${shown}"`);
  }

  // duas abas abertas: o que uma salva a outra enxerga
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ prefs: [45, 47], taken: [] })), KEY);
  await page.reload();
  const other = await context.newPage();
  await other.goto(base + '/');
  await other.locator('#addInput').fill('50');
  await other.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const seen = await page.evaluate(() => [...document.querySelectorAll('#prefs .pref-num')].map((e) => +e.textContent).join());
  check(seen === '45,47,50', `segunda aba adicionou a 050, mas a primeira mostra "${seen}"`);
  await page.locator('#addInput').fill('51');
  await page.keyboard.press('Enter');
  check(String((await stored(page)).prefs) === '45,47,50,51', `a primeira aba salvou por cima da segunda: ${(await stored(page)).prefs}`);
  await other.close();

  // link com a lista
  await page.goto(base + '/#l=10.20.30');
  await page.waitForTimeout(400);
  check(!(await page.evaluate(() => document.querySelector('#sheet').hidden)), 'link com lista diferente deveria perguntar antes de substituir');
  check(String((await stored(page)).prefs) === '45,47,50,51', 'o link substituiu a lista sem perguntar');
  await page.locator('#sheetActions .kind-primary').tap();
  check(String((await stored(page)).prefs) === '10,20,30', 'aceitar o link não importou a lista');
  check(page.url().includes('#l=10.20.30&s='), `depois de importar, o endereço deveria guardar a lista nova: ${page.url()}`);

  // cópia de segurança no endereço: se o navegador apagar os dados (o Safari faz isso depois de
  // uma semana sem uso), reabrir a mesma aba traz a lista e o sorteio de volta
  await page.locator('#tabbar [data-tab="sorteio"]').tap();
  for (const d of '20') await page.locator(`.pad-keys [data-key="${d}"]`).tap();
  await page.locator('#padOk').tap();
  const address = page.url();
  check(address.includes('#l=10.20.30&x=20&s='), `o endereço deveria guardar lista e vagas riscadas: ${address}`);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('#map .spot').length === 211);
  const back = await stored(page);
  check(String(back?.prefs) === '10,20,30' && String(back?.taken) === '20', `dados apagados pelo navegador: a mesma aba deveria recuperar tudo do endereço; ficou ${JSON.stringify(back)}`);
  check(await text(page, '#heroNum') === '010', 'depois de recuperar do endereço, a melhor opção deveria ser 010');
  check(await page.evaluate(() => document.querySelector('#sheet').hidden), 'recuperar do endereço não deveria perguntar nada');

  // endereço velho de uma aba que ficou para trás não pode passar por cima do que é mais novo
  await page.evaluate((key) => localStorage.setItem(key, JSON.stringify({ prefs: [1, 2, 3], taken: [], chosen: null, savedAt: Date.now() })), KEY);
  await page.goto(base + '/?v=1#l=99.98&x=5&s=1000');
  await page.waitForFunction(() => document.querySelectorAll('#map .spot').length === 211);
  check(String((await stored(page)).prefs) === '1,2,3' && await page.evaluate(() => document.querySelector('#sheet').hidden), 'um endereço antigo substituiu (ou quis substituir) a lista mais nova');
  check(page.url().includes('#l=1.2.3&s='), `o endereço antigo deveria ser atualizado para a lista atual: ${page.url()}`);

  // endereço mais novo vindo de outro aparelho: pergunta antes de trocar
  await page.goto(base + '/?v=2#l=99.98&x=5&s=' + (Date.now() + 60000));
  await page.waitForFunction(() => document.querySelectorAll('#map .spot').length === 211);
  check(!(await page.evaluate(() => document.querySelector('#sheet').hidden)) && String((await stored(page)).prefs) === '1,2,3', 'endereço de outro aparelho deveria perguntar antes de substituir a lista');
  await page.locator('#sheetActions .kind-primary').tap();
  const other2 = await stored(page);
  check(String(other2.prefs) === '99,98' && String(other2.taken) === '5', `aceitar o endereço de outro aparelho deveria trazer lista e riscadas; ficou ${JSON.stringify(other2)}`);

  // endereço com lixo não quebra nada
  await page.goto(base + '/?v=3#l=abc.-1.999..5&x=zz&c=foo&s=nope');
  await page.waitForFunction(() => document.querySelectorAll('#map .spot').length === 211);
  check(String((await stored(page)).prefs) === '99,98', 'endereço com lixo mexeu na lista sem perguntar');
  await page.evaluate(() => { const b = document.querySelector('#sheetActions .kind-cancel'); if (b) b.click(); });

  // navegador que se recusa a gravar (modo restrito): o app avisa em vez de fingir que salvou
  const blocked = await browser.newContext({ viewport: { width: 440, height: 770 }, hasTouch: true });
  const bp = await blocked.newPage();
  await bp.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('bloqueado', 'QuotaExceededError'); }; });
  await bp.goto(base + '/');
  await bp.locator('#addInput').fill('45');
  await bp.keyboard.press('Enter');
  await bp.waitForTimeout(300);
  check(await bp.evaluate(() => document.querySelectorAll('#prefs .pref').length) === 1, 'sem conseguir gravar, o app deveria continuar funcionando na sessão');
  check(/salv|grav/i.test(await bp.evaluate(() => document.body.innerText)), 'sem conseguir gravar, o app deveria avisar que a lista não está sendo salva');
  await bp.reload();
  await bp.waitForFunction(() => document.querySelectorAll('#map .spot').length === 211);
  check(await bp.evaluate(() => [...document.querySelectorAll('#prefs .pref-num')].map((e) => +e.textContent).join()) === '45', 'sem conseguir gravar, recarregar deveria recuperar a lista pelo endereço da página');
  await blocked.close();

  for (const e of [...new Set(errors)]) check(false, e);
  await context.close();
}

// ---------- offline ----------

async function runOffline(browser, engine) {
  const own = await startServer();
  const base = `http://localhost:${own.address().port}`;
  scope = `${engine} · offline`;
  console.log(`\n${scope}`);
  const context = await browser.newContext({ viewport: { width: 440, height: 770 }, hasTouch: true, userAgent: IPHONE_UA });
  context.setDefaultTimeout(12000);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('erro de script: ' + e.message));

  // uma única visita com internet, como aconteceria em casa
  await page.goto(base + '/?sw');
  const hasSW = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!check(hasSW, 'este motor não expõe service worker no teste; offline não verificado aqui')) { await context.close(); return; }
  const ready = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]));
  if (!check(ready, 'o service worker não ficou ativo em 10 s; offline não verificado neste motor')) { await context.close(); return; }
  await page.waitForFunction(async () => (await caches.keys()).length > 0 && (await (await caches.open((await caches.keys())[0])).keys()).length >= 10, null, { timeout: 15000 }).catch(() => {});
  const cached = await page.evaluate(async () => { const k = await caches.keys(); return k.length ? (await (await caches.open(k[0])).keys()).map((r) => new URL(r.url).pathname) : []; });
  check(cached.length >= 10, `o cache offline deveria ter os arquivos do app, tem ${cached.length}`);
  check(cached.some((p) => p.endsWith('.woff2')), 'as fontes não foram guardadas para uso offline na primeira visita');

  await page.locator('#addInput').fill('45');
  await page.keyboard.press('Enter');
  await page.locator('#addInput').fill('47');
  await page.keyboard.press('Enter');

  // sem internet de verdade: o servidor some
  own.closeAllConnections();
  await new Promise((resolve) => own.close(resolve));
  let loaded = true;
  const started = Date.now();
  await page.goto(base + '/', { timeout: 15000 }).catch(() => { loaded = false; });
  if (check(loaded, 'sem internet, a página não abriu')) {
    const ok = await page.waitForFunction(() => document.querySelectorAll('#map .spot').length === 211, null, { timeout: 8000 }).then(() => true, () => false);
    check(ok, 'sem internet, o mapa não foi montado');
    const took = Date.now() - started;
    console.log(`  abriu sem internet em ${took} ms`);
    check(took < 5000, `sem internet, o app demorou ${took} ms para abrir`);
    await page.evaluate(() => document.fonts.ready);
    check(await page.evaluate(() => [...document.fonts].some((f) => f.family.includes('Barlow Condensed') && f.status === 'loaded')), 'sem internet, a fonte dos números não carregou');
    check(String((await stored(page))?.prefs) === '45,47', 'sem internet, a lista salva não apareceu');
    await page.locator('#tabbar [data-tab="sorteio"]').tap();
    for (const d of '45') await page.locator(`.pad-keys [data-key="${d}"]`).tap();
    await page.locator('#padOk').tap();
    check(await text(page, '#heroNum') === '047', 'sem internet, riscar a 045 deveria passar a melhor para 047');
    await page.screenshot({ path: path.join(SHOTS, `${engine}-offline.png`) });
    let again = true;
    await page.reload({ timeout: 15000 }).catch(() => { again = false; });
    check(again && String((await stored(page))?.taken) === '45' && await text(page, '#heroNum') === '047', 'sem internet, recarregar perdeu o que foi riscado');
    const img = await page.evaluate(() => fetch('img/mapa-original.jpg').then((r) => r.ok, () => false));
    check(img, 'sem internet, a foto do mapa original não abre');
  }
  for (const e of [...new Set(errors)]) check(false, e);
  await context.close();
}

// ---------- principal ----------

const server = await startServer();
const base = `http://localhost:${server.address().port}`;
fs.mkdirSync(SHOTS, { recursive: true });

const engines = [['webkit', () => webkit.launch()], ['chromium', () => chromium.launch({ channel: 'msedge' })]];
for (const [engine, launch] of engines) {
  if (process.env.ENGINE && process.env.ENGINE !== engine) continue;
  let browser;
  try { browser = await launch(); } catch (e) { console.log(`\n${engine}: não foi possível abrir (${e.message.split('\n')[0]})`); continue; }
  for (const device of DEVICES) {
    if (ONLY && !device.id.includes(ONLY)) continue;
    try { await runDevice(browser, engine, device, base); } catch (e) { check(false, 'o roteiro parou: ' + e.message.split('\n')[0] + ' (linha ' + ((e.stack || '').match(/bughunt\.mjs:(\d+)/) || [])[1] + ')'); }
  }
  if (!ONLY || ONLY === 'extras') {
    try { await runStorage(browser, engine, base); } catch (e) { check(false, 'o roteiro parou: ' + e.message.split('\n')[0] + ' (linha ' + ((e.stack || '').match(/bughunt\.mjs:(\d+)/) || [])[1] + ')'); }
    try { await runOffline(browser, engine); } catch (e) { check(false, 'o roteiro parou: ' + e.message.split('\n')[0] + ' (linha ' + ((e.stack || '').match(/bughunt\.mjs:(\d+)/) || [])[1] + ')'); }
  }
  await browser.close();
}
server.close();

console.log(`\n${passed} verificações passaram, ${findings.length} falharam.`);
for (const f of findings) console.log(' - ' + f);
process.exit(findings.length ? 1 : 0);
