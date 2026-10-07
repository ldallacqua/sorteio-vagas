"""
Gera data.js e img/mapa-original.jpg a partir do PDF oficial do mapa de vagas.

    pip install pymupdf shapely
    python dev/extract_map.py caminho/para/mapa.pdf

O PDF é vetorial (InDesign): cada fileira é um quadrilátero, as divisórias são linhas
soltas, o tamanho das vagas é uma linha colorida por fileira e os números são texto.
Aqui as linhas viram um polígono por vaga, cada número cai no seu polígono e a linha
colorida que encosta na vaga dá o tamanho.
"""
import json
import math
import statistics
import sys
from collections import Counter
from pathlib import Path

import pymupdf
from shapely.geometry import LineString, Point, Polygon, box
from shapely.ops import polygonize, unary_union

ROOT = Path(__file__).resolve().parent.parent
SCALE = 1.4  # unidades do mapa por ponto do PDF (vaga com uns 24 × 48)

YELLOW, RED, GREEN = (1.0, 0.95, 0.0), (0.82, 0.14, 0.16), (0.25, 0.68, 0.29)
BLOCK_FILLS = [(0.98, 0.92, 0.0), (0.90, 0.38, 0.14), (0.05, 0.53, 0.79), (0.52, 0.78, 0.49)]
AREA_GROUPS = 3  # construções cinza, cada uma num grupo com transparência


def near(color, target, tol=0.06):
    return color is not None and all(abs(a - b) < tol for a, b in zip(color, target))


def extend(a, b, by):
    length = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    ux, uy = (b[0] - a[0]) / length, (b[1] - a[1]) / length
    return LineString([(a[0] - ux * by, a[1] - uy * by), (b[0] + ux * by, b[1] + uy * by)])


def path_points(drawing):
    pts = []
    for item in drawing['items']:
        if item[0] == 'l':
            if not pts:
                pts.append((item[1].x, item[1].y))
            pts.append((item[2].x, item[2].y))
    if len(pts) > 1 and math.dist(pts[0], pts[-1]) < 0.01:
        pts.pop()
    return pts


def to_quad(points):
    """Tira os vértices de junção em T até sobrarem os quatro cantos."""
    pts = []
    for p in points:
        if not pts or math.dist(p, pts[-1]) > 0.6:
            pts.append(tuple(p))
    if math.dist(pts[0], pts[-1]) <= 0.6:
        pts.pop()

    def turn(i):
        a, b, c = pts[i - 1], pts[i], pts[(i + 1) % len(pts)]
        v1, v2 = (b[0] - a[0], b[1] - a[1]), (c[0] - b[0], c[1] - b[1])
        return abs(math.atan2(v1[0] * v2[1] - v1[1] * v2[0], v1[0] * v2[0] + v1[1] * v2[1]))

    while len(pts) > 4:
        pts.pop(min(range(len(pts)), key=turn))
    return pts


def dist_to_segment(p, a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
    t = max(0, min(1, t))
    return math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t))


def read_pdf(path):
    page = pymupdf.open(path)[0]
    quads, dividers, colored, blocks, pcd_marks = [], [], [], [[] for _ in BLOCK_FILLS], []
    areas, ground = [], None
    for d in page.get_drawings(extended=True):
        kind = d['type']
        if kind == 's' and abs((d.get('width') or 0) - 1.0) < 0.05:
            for item in d['items']:
                if item[0] == 'qu':
                    q = item[1]
                    quads.append([(p.x, p.y) for p in (q.ul, q.ur, q.lr, q.ll)])
                elif item[0] == 'l':
                    seg = ((item[1].x, item[1].y), (item[2].x, item[2].y))
                    size = 'M' if near(d['color'], YELLOW) else 'P' if near(d['color'], RED) else 'G' if near(d['color'], GREEN) else None
                    (colored if size else dividers).append((size, seg) if size else seg)
        elif kind == 'f':
            pts = path_points(d)
            for i, fill in enumerate(BLOCK_FILLS):
                if near(d['fill'], fill) and len(pts) == 4:
                    blocks[i].append(pts)
            if near(d['fill'], (0.0, 0.25, 0.53)) and len(pts) == 4:
                pcd_marks.append(pts)
            # Cinza do fundo e das construções: preto com transparência, dentro de um grupo.
            if near(d['fill'], (0, 0, 0)) and d.get('level', 0) >= 4:
                if len(pts) > 8:
                    ground = pts
                elif len(pts) == 4:
                    areas.append(pts)

    words = page.get_text('words')
    labels, extra = {}, []
    for i, w in enumerate(words):
        c, text = ((w[0] + w[2]) / 2, (w[1] + w[3]) / 2), w[4]
        if text.isdigit() and len(text) == 3:
            labels[int(text)] = c
        elif text == 'ZEL':
            extra.append(('ZEL', c))
        elif text == 'BLOCO':
            n = words[i + 1]
            extra.append(('BLOCO ' + n[4], ((w[0] + n[2]) / 2, (w[1] + n[3]) / 2)))
    street = next(d['items'][0][1] for d in page.get_drawings() if d['type'] == 'f' and d['items'][0][0] == 're' and near(d['fill'], (0.11, 0.09, 0.08)))
    assert len(areas) == AREA_GROUPS and ground, 'fundo cinza não encontrado'
    return page, quads, dividers, colored, blocks, pcd_marks, areas, ground, labels, extra, street


def build_cells(quads, dividers):
    lines = [extend(q[i], q[(i + 1) % 4], 0.3) for q in quads for i in range(4)]
    lines += [extend(a, b, 1.2) for a, b in dividers]
    return [c for c in polygonize(unary_union(lines)) if c.area > 60]


def read_sizes(quad, colored):
    """Linha colorida paralela a uma borda da vaga e desenhada logo para dentro dela. Em
    fileira dupla a linha da vizinha também encosta, mas fica do lado de fora da borda."""
    size, edge, used = {}, {}, set()
    for n, q in quad.items():
        cx, cy = sum(p[0] for p in q) / 4, sum(p[1] for p in q) / 4
        found = []
        for i in range(4):
            a, b = q[i], q[(i + 1) % 4]
            mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            ex, ey = b[0] - a[0], b[1] - a[1]
            length = math.hypot(ex, ey)
            nx, ny = -ey / length, ex / length
            if (cx - mid[0]) * nx + (cy - mid[1]) * ny < 0:
                nx, ny = -nx, -ny
            for k, (_, (c0, c1)) in enumerate(colored):
                dx, dy = c1[0] - c0[0], c1[1] - c0[1]
                parallel = abs(ex * dy - ey * dx) / (length * math.hypot(dx, dy)) < 0.2
                if not parallel or dist_to_segment(mid, c0, c1) > 2.5:
                    continue
                t = ((mid[0] - c0[0]) * dx + (mid[1] - c0[1]) * dy) / (dx * dx + dy * dy)
                inward = (c0[0] + dx * t - mid[0]) * nx + (c0[1] + dy * t - mid[1]) * ny
                if inward > 0.2:
                    found.append((k, i))
        assert len(found) == 1, f'vaga {n}: {len(found)} linhas de tamanho'
        k, i = found[0]
        size[n], edge[n] = colored[k][0], i
        used.add(k)
    assert used == set(range(len(colored))), 'linha colorida sem vaga'
    return size, edge


def main(pdf_path):
    page, quads, dividers, colored, block_parts, pcd_marks, areas, ground, labels, extra, street = read_pdf(pdf_path)
    cells = build_cells(quads, dividers)

    owner = {}
    for n, c in labels.items():
        inside = [i for i, cell in enumerate(cells) if cell.contains(Point(c))]
        assert len(inside) == 1 and inside[0] not in owner, f'vaga {n}: polígono ambíguo'
        owner[inside[0]] = n
    assert sorted(owner.values()) == list(range(1, 212)), 'faltou vaga'
    quad = {n: to_quad(cells[i].exterior.coords[:-1]) for i, n in owner.items()}
    for i, n in owner.items():
        assert abs(Polygon(quad[n]).area - cells[i].area) < cells[i].area * 0.03, f'vaga {n}: não é um quadrilátero'
    size, edge = read_sizes(quad, colored)

    special = []
    for i, cell in enumerate(cells):
        if i in owner:
            continue
        if any(cell.contains(Point(c)) for name, c in extra if name == 'ZEL'):
            special.append(('ZEL', to_quad(cell.exterior.coords[:-1])))
        elif any(cell.contains(Polygon(m).centroid) for m in pcd_marks):
            special.append(('PCD', to_quad(cell.exterior.coords[:-1])))
        else:
            raise AssertionError(f'polígono sem dono em {cell.centroid}')
    assert Counter(name for name, _ in special) == {'PCD': 2, 'ZEL': 1}

    blocks = []
    for parts in block_parts:
        shape = unary_union([Polygon(p).buffer(0.05, join_style='mitre') for p in parts]).simplify(0.3)
        assert shape.geom_type == 'Polygon'
        name, label = next((name, c) for name, c in extra if name.startswith('BLOCO') and shape.contains(Point(c)))
        blocks.append((int(name.split()[1]), list(shape.exterior.coords[:-1]), label))
    blocks.sort()

    # O terreno é o que sobra da página sem o fundo cinza e sem a faixa da avenida.
    page_box = box(*page.rect)
    lot = page_box.difference(Polygon(ground).buffer(0)).difference(box(*street))
    lot = max(lot.geoms, key=lambda g: g.area) if lot.geom_type == 'MultiPolygon' else lot
    lot = lot.simplify(0.5)

    def fmt(pts):
        return '[' + ', '.join(f'[{round(x * SCALE, 1):g}, {round(y * SCALE, 1):g}]' for x, y in pts) + ']'

    def flat(pts):
        return ', '.join(f'{round(v * SCALE, 1):g}' for p in pts for v in p)

    rows = []
    for n in sorted(quad):
        q, e = quad[n], edge[n]
        rows.append(f"    [{n}, '{size[n]}', {flat(q[e:] + q[:e])}],")

    xs = [x for x, _ in lot.exterior.coords]
    ys = [y for _, y in lot.exterior.coords]
    pad, pad_top, pad_bottom = 12, 50, 16  # em cima fica o aviso do mapa (.map-hint)
    left = (street.x1 - 22) * SCALE
    view = dict(x=round(left - pad), y=round(min(ys) * SCALE - pad_top), w=round(max(xs) * SCALE - left + 2 * pad), h=round((max(ys) - min(ys)) * SCALE + pad_top + pad_bottom))
    top, bottom = view['y'] / SCALE, (view['y'] + view['h']) / SCALE  # a avenida ocupa a altura toda do desenho
    street_strip = [(street.x1 - 22, top), (street.x1, top), (street.x1, bottom), (street.x1 - 22, bottom)]
    street_label = [round((street.x1 - 11) * SCALE, 1), round((min(ys) + max(ys)) / 2 * SCALE, 1)]

    counts = Counter(size.values())
    out = TEMPLATE
    for key, value in {
        '@SPOTS@': '\n'.join(rows),
        '@SPECIAL@': '\n'.join(f"    {{ label: '{name}', pts: {fmt(pts)} }}," for name, pts in sorted(special, key=lambda s: s[1][0])),
        '@BLOCKS@': '\n'.join(f"    {{ id: {i}, name: 'Bloco {i}', label: {fmt([label])[1:-1]}, pts: {fmt(pts)} }}," for i, pts, label in blocks),
        '@AREAS@': '\n'.join(f'    {fmt(a)},' for a in sorted(areas)),
        '@GROUND@': fmt(lot.exterior.coords[:-1]),
        '@STREET@': f"{{ name: 'Av. Alberto Ramos', label: [{street_label[0]:g}, {street_label[1]:g}], pts: {fmt(street_strip)} }}",
        '@VIEWBOX@': f"{{ x: {view['x']}, y: {view['y']}, w: {view['w']}, h: {view['h']} }}",
        '@SCALE@': f'{SCALE:g}',
        '@COUNTS@': f"{counts['G']} grandes, {counts['M']} médias, {counts['P']} pequenas",
    }.items():
        out = out.replace(key, value)
    (ROOT / 'data.js').write_text(out, encoding='utf-8', newline='\n')

    # O mapa inteiro, alinhado ao desenho (1,5 px por unidade), para o dev/overlay.html.
    pix = page.get_pixmap(matrix=pymupdf.Matrix(SCALE * 1.5, SCALE * 1.5), colorspace=pymupdf.csRGB, alpha=False)
    pix.save(ROOT / 'img' / 'mapa-original.jpg', jpg_quality=82)

    areas_by_size = {s: statistics.median(Polygon(quad[n]).area for n in quad if size[n] == s) for s in 'GMP'}
    print(f'{len(quad)} vagas:', dict(counts), '| área mediana (pt²):', {s: round(a) for s, a in areas_by_size.items()})
    print('viewBox', view, '| página', round(page.rect.x1 * SCALE, 1), '×', round(page.rect.y1 * SCALE, 1))


TEMPLATE = """/*
 * Mapa do estacionamento (Allegro Jardim Avelino).
 * Arquivo gerado por dev/extract_map.py a partir do PDF oficial do mapa de vagas: não edite
 * à mão. As coordenadas são as do PDF vezes @SCALE@; img/mapa-original.jpg é o mesmo PDF e
 * dev/overlay.html sobrepõe os dois para conferir.
 */
(function () {
  'use strict';

  // número, tamanho (G grande, M média, P pequena: a linha verde, amarela ou vermelha do mapa)
  // e os quatro cantos. Os dois primeiros cantos são a borda onde o mapa desenha essa linha.
  // @COUNTS@.
  const SPOTS = [
@SPOTS@
  ];

  // Vagas que não entram no sorteio.
  const SPECIAL = [
@SPECIAL@
  ];

  const BLOCKS = [
@BLOCKS@
  ];

  // Áreas cinza do mapa (construções sem nome).
  const AREAS = [
@AREAS@
  ];

  // Contorno do terreno.
  const GROUND = @GROUND@;

  const STREET = @STREET@;

  const VIEWBOX = @VIEWBOX@;

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

  const spots = SPOTS.map(([n, size, ...xy]) => {
    const pts = [0, 2, 4, 6].map((i) => [xy[i], xy[i + 1]]);
    const c = round([(pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]) / 4, (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]) / 4]);

    // Linha de tamanho: um pouco para dentro da vaga e mais curta que a borda.
    const inset = (p) => lerp(p, c, 0.11);
    const s0 = inset(lerp(pts[0], pts[1], 0.1)), s1 = inset(lerp(pts[0], pts[1], 0.9));

    let block = BLOCKS[0], blockDist = Infinity;
    for (const b of BLOCKS) {
      const d = distToPolygon(c, b.pts);
      if (d < blockDist) { blockDist = d; block = b; }
    }

    return { n, pts, c, sizeLine: [round(s0), round(s1)], size, block: block.id };
  });

  const byNum = {};
  for (const s of spots) byNum[s.n] = s;

  window.LOT = { spots, byNum, blocks: BLOCKS, areas: AREAS, special: SPECIAL, ground: GROUND, street: STREET, viewBox: VIEWBOX };
})();
"""

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
