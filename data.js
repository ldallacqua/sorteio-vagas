/*
 * Mapa do estacionamento (Allegro Jardim Avelino).
 * Coordenadas no espaço da foto do mapa impresso (1280 × 1108), ver img/mapa-original.jpg.
 * Para conferir o alinhamento: dev/overlay.html.
 */
(function () {
  'use strict';

  const seq = (a, b, step) => {
    step = step || (a <= b ? 1 : -1);
    const out = [];
    for (let i = a; step > 0 ? i <= b : i >= b; i += step) out.push(i);
    return out;
  };

  // Tamanho de cada vaga, lido da linha colorida do mapa impresso.
  // G = grande (verde), M = média (amarela), P = pequena (vermelha).
  // Leitura duvidosa na foto: 036–058 pares (M ou G) e 062–068 (G ou M).
  const GRANDES = new Set([1, 2, 4, 5, ...seq(62, 68)]);
  const PEQUENAS = new Set([
    18, 20, 22, 24, 25, 33, 59, 60,
    ...seq(35, 57, 2),
    ...seq(81, 112),
    ...seq(113, 133, 2),
    ...seq(143, 195, 2),
    ...seq(197, 211),
  ]);
  const sizeOf = (n) => (GRANDES.has(n) ? 'G' : PEQUENAS.has(n) ? 'P' : 'M');

  // Cada fileira tem duas bordas (a e b) que correm ao longo dela; as vagas são as fatias
  // entre as duas. `edge` é a borda onde o mapa impresso desenha a linha de tamanho.
  const ROWS = [
    { nums: seq(1, 7), a: [[81, 28], [243, 26]], b: [[81, 80], [243, 73]], edge: 'a' },
    { nums: seq(8, 16), a: [[84, 138], [285, 126]], b: [[84, 184], [285, 173]], edge: 'b' },
    { nums: [17], a: [[258, 174], [283, 173]], b: [[258, 226], [283, 225]], edge: 'b' },

    { nums: [18, 20, 22, 24], a: [[616, 111], [713, 109]], b: [[615, 156], [712, 155]], edge: 'b' },
    { nums: [19, 21, 23], a: [[615, 156], [688, 156]], b: [[614, 208], [687, 207]], edge: 'b' },
    { nums: [25], a: [[688, 156], [712, 155]], b: [[688, 201], [710, 201]], edge: 'b' },
    { nums: seq(26, 32), a: [[753, 112], [916, 123]], b: [[753, 164], [916, 173]], edge: 'b' },
    { nums: [33], a: [[918, 133], [920, 156]], b: [[961, 126], [964, 149]], edge: 'b' },
    { nums: [34], a: [[919, 157], [922, 180]], b: [[965, 151], [969, 174]], edge: 'b' },

    { nums: seq(35, 57, 2), a: [[927, 181], [984, 460]], b: [[969, 175], [1032, 451]], edge: 'b' },
    { nums: seq(36, 58, 2), a: [[878, 189], [932, 469]], b: [[927, 182], [984, 460]], edge: 'b' },
    { nums: [60, 59], a: [[984, 460], [1032, 451]], b: [[993, 503], [1040, 495]], edge: 'b' },
    { nums: [61], a: [[958, 466], [984, 460]], b: [[970, 514], [994, 508]], edge: 'b' },
    { nums: [62], a: [[933, 472], [958, 467]], b: [[944, 527], [971, 522]], edge: 'b' },

    { nums: seq(68, 63), a: [[767, 541], [916, 481]], b: [[788, 596], [938, 535]], edge: 'b' },
    { nums: [69], a: [[747, 557], [767, 550]], b: [[767, 604], [788, 596]], edge: 'b' },
    { nums: [70], a: [[728, 511], [750, 502]], b: [[747, 557], [767, 549]], edge: 'b' },
    { nums: seq(80, 72, -2), a: [[609, 559], [717, 517]], b: [[628, 605], [735, 563]], edge: 'b' },
    { nums: seq(79, 71, -2), a: [[628, 605], [735, 563]], b: [[646, 652], [753, 608]], edge: 'b' },

    { nums: [90], a: [[340, 713], [363, 705]], b: [[357, 755], [380, 748]], edge: 'b' },
    { nums: seq(89, 81), a: [[357, 756], [559, 677]], b: [[374, 799], [571, 713]], edge: 'b' },
    { nums: seq(91, 101), a: [[379, 853], [619, 745]], b: [[396, 896], [635, 787]], edge: 'b' },
    { nums: seq(112, 102), a: [[400, 908], [638, 798]], b: [[417, 951], [653, 842]], edge: 'b' },

    { nums: seq(113, 125, 2), a: [[436, 997], [588, 919]], b: [[455, 1038], [603, 957]], edge: 'b' },
    { nums: seq(127, 133, 2), a: [[588, 919], [673, 889]], b: [[603, 957], [688, 932]], edge: 'b' },
    { nums: [135, 137], a: [[673, 883], [717, 868]], b: [[688, 932], [733, 917]], edge: 'b' },
    { nums: seq(114, 126, 2), a: [[455, 1038], [603, 957]], b: [[474, 1084], [619, 1005]], edge: 'b' },
    { nums: seq(128, 138, 2), a: [[603, 957], [733, 917]], b: [[619, 1005], [752, 962]], edge: 'b' },

    { nums: [139], a: [[1115, 767], [1138, 757]], b: [[1135, 813], [1157, 803]], edge: 'b' },
    { nums: [140], a: [[1138, 757], [1162, 748]], b: [[1157, 803], [1180, 794]], edge: 'b' },

    { nums: [...seq(196, 142, -2), 141], a: [[1051, 64], [1199, 737]], b: [[1100, 54], [1252, 727]], edge: 'b' },
    { nums: seq(195, 143, -2), a: [[1007, 70], [1145, 698]], b: [[1051, 64], [1189, 690]], edge: 'b' },
    { nums: seq(211, 197), a: [[656, 2], [1008, 24]], b: [[656, 46], [1008, 68]], edge: 'a' },
  ];

  // Vagas que não entram no sorteio.
  const SPECIAL = [
    { label: 'PCD', pts: [[45, 30], [80, 28], [80, 81], [45, 83]] },
    { label: 'PCD', pts: [[713, 109], [752, 112], [752, 172], [712, 170]] },
    { label: 'ZEL', pts: [[1163, 753], [1184, 743], [1202, 785], [1180, 794]] },
  ];

  const BLOCKS = [
    {
      id: 1, name: 'Bloco 1', label: [112, 418],
      pts: [[22, 286], [95, 281], [96, 312], [121, 310], [120, 266], [176, 262], [181, 346], [166, 348], [171, 470], [190, 468], [202, 570], [135, 573], [133, 522], [100, 524], [102, 576], [42, 580], [38, 490], [50, 488], [42, 375], [28, 376]],
    },
    {
      id: 2, name: 'Bloco 2', label: [440, 166],
      pts: [[293, 90], [385, 85], [385, 98], [500, 98], [500, 85], [593, 90], [593, 155], [555, 155], [555, 187], [593, 187], [593, 245], [500, 247], [500, 232], [380, 232], [380, 247], [287, 247], [287, 187], [328, 187], [328, 150], [293, 150]],
    },
    {
      id: 3, name: 'Bloco 3', label: [817, 346],
      pts: [[710, 200], [775, 188], [782, 235], [812, 230], [805, 182], [868, 178], [880, 275], [868, 278], [890, 385], [905, 383], [925, 480], [858, 492], [850, 448], [822, 452], [830, 498], [765, 510], [752, 440], [763, 438], [742, 300], [725, 302]],
    },
    {
      id: 4, name: 'Bloco 4', label: [470, 594],
      pts: [[308, 522], [402, 518], [402, 532], [518, 510], [516, 497], [607, 495], [612, 555], [578, 557], [582, 592], [618, 590], [625, 652], [532, 662], [530, 645], [412, 655], [414, 672], [322, 690], [316, 625], [352, 622], [348, 588], [312, 590]],
    },
  ];

  // Áreas cinza do mapa (construções sem nome).
  const AREAS = [
    [[310, 345], [665, 303], [682, 450], [325, 488]],
    [[258, 365], [308, 362], [312, 475], [265, 478]],
    [[62, 600], [270, 572], [282, 715], [78, 738]],
  ];

  // Contorno do terreno.
  const GROUND = [[0, 40], [250, 14], [640, -6], [1010, 12], [1092, 38], [1114, 60], [1267, 722], [1250, 762], [1138, 832], [1036, 570], [664, 716], [778, 972], [440, 1114], [322, 742], [78, 838], [0, 640]];

  const VIEWBOX = { x: -24, y: -24, w: 1316, h: 1160 };

  // ---------- geometria derivada

  const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  const round = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];

  function distToSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
  }

  function distToPolygon(p, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      best = Math.min(best, distToSegment(p, pts[i], pts[(i + 1) % pts.length]));
    }
    return best;
  }

  const spots = [];
  for (const row of ROWS) {
    const count = row.nums.length;
    row.nums.forEach((n, i) => {
      const t0 = i / count, t1 = (i + 1) / count;
      const a0 = lerp(row.a[0], row.a[1], t0), a1 = lerp(row.a[0], row.a[1], t1);
      const b0 = lerp(row.b[0], row.b[1], t0), b1 = lerp(row.b[0], row.b[1], t1);
      const pts = [a0, a1, b1, b0].map(round);
      const c = round([(a0[0] + a1[0] + b0[0] + b1[0]) / 4, (a0[1] + a1[1] + b0[1] + b1[1]) / 4]);

      // Linha de tamanho: um pouco para dentro da vaga e mais curta que a borda.
      const [e0, e1] = row.edge === 'a' ? [a0, a1] : [b0, b1];
      const inset = (p) => lerp(p, c, 0.11);
      const s0 = inset(lerp(e0, e1, 0.1)), s1 = inset(lerp(e0, e1, 0.9));

      let block = BLOCKS[0], blockDist = Infinity;
      for (const b of BLOCKS) {
        const d = distToPolygon(c, b.pts);
        if (d < blockDist) { blockDist = d; block = b; }
      }

      spots.push({ n, pts, c, sizeLine: [round(s0), round(s1)], size: sizeOf(n), block: block.id });
    });
  }
  spots.sort((p, q) => p.n - q.n);

  const byNum = {};
  for (const s of spots) byNum[s.n] = s;

  window.LOT = { spots, byNum, blocks: BLOCKS, areas: AREAS, special: SPECIAL, ground: GROUND, viewBox: VIEWBOX };
})();
