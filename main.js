const SVG_NS = "http://www.w3.org/2000/svg";

const SUB = 10;
const DIAGRAM_WIDTH = 178;
const DIAGRAM_HEIGHT = 242;
const CUBOID_ORIGIN = { x: 0.5, y: 220 };
// Rozteče z přesného SVG tvaru 1 cm³ krychle (ne z obrysu kvádru).
const FW = 29.8127;
const DD = 10.1873;
const FH = 29.8127;
// Přesné rozměry kvádru z dodaného SVG (popisky 4 cm, 3 cm, 3 cm).
// Tyto hodnoty jsou počty „velkých“ krychlí podél hran.
const EXACT_CUBOID = { widthDm: 4, depthDm: 3, heightDm: 3 };
const CM_CUBE_ORIGIN = { x: 20.5, y: 61 };
const MM_CUBE_ORIGIN = { x: 123.5, y: 50 };
const CUBOID_MIN_DM = 1;
const CUBOID_MAX_DM = 4;
const TOOLBAR_RESERVE = 48;
const VIEWPORT_SAFETY = 0.92;
const MIN_FIT_SCALE = 0.75;
const SNAP_THRESHOLD = 10;

// Kvádrový drátěný model ve vašem SVG má přední hranu délky 116 (0.5 -> 116.5).
// Aby se do ní vešly přesně 4 velké krychle, musí být 1 „krychlová jednotka“ = 116 / 4 = 29.
const WIREFRAME_FRONT_EDGE = 116;
const TARGET_UNIT = WIREFRAME_FRONT_EDGE / EXACT_CUBOID.widthDm; // 29
// Škálujeme krychli tak, aby její „přední hrana“ (FW) měla přesně TARGET_UNIT.
const CUBE_SCALE_TO_WIREFRAME = TARGET_UNIT / FW;
// Kroky projekce pro hloubku/výšku bereme z kvádru ve vašem SVG, aby přesně seděl „svislý rozměr“.
// (0.5,130.5)->(31,100) má délku 30.5, (147,189.5)->(147,100) má délku 89.5.
const WIREFRAME_UNIT = TARGET_UNIT; // osa „šířky“ (sx)
const WIREFRAME_DEPTH_STEP = 30.5 / EXACT_CUBOID.depthDm; // osa „hloubky“ (sy)
const WIREFRAME_HEIGHT_STEP = 89.5 / EXACT_CUBOID.heightDm; // osa „výšky“ (sz)

const CUBE_TYPES = {
  cm3: {
    subSize: SUB,
    scale: CUBE_SCALE_TO_WIREFRAME,
    origin: CM_CUBE_ORIGIN,
    templateId: "cm-cube-shape",
    stackCenter: { x: 40.65, y: 41 },
    hit: { x: 18, y: 18, w: 46, h: 46 },
  },
  mm3: {
    subSize: 1,
    scale: CUBE_SCALE_TO_WIREFRAME,
    origin: MM_CUBE_ORIGIN,
    templateId: "mm-cube-shape",
    stackCenter: { x: 125.5, y: 48 },
    hit: { x: 118, y: 42, w: 14, h: 14 },
  },
};

let CUBOID = { ...EXACT_CUBOID };

const diagram = document.getElementById("diagram");
const diagramBg = document.getElementById("diagram-bg");
const diagramWrap = document.getElementById("diagram-wrap");
const stage = document.getElementById("stage");
const newCuboidBtn = document.getElementById("new-cuboid-btn");
const freeSurfaceBtn = document.getElementById("free-surface-btn");
const cuboidSizeQuiz = document.getElementById("cuboid-size-quiz");
const cuboidWidthInput = document.getElementById("cuboid-width");
const cuboidDepthInput = document.getElementById("cuboid-depth");
const cuboidHeightInput = document.getElementById("cuboid-height");
const applyCuboidSizeBtn = document.getElementById("apply-cuboid-size-btn");
const volumeQuiz = document.querySelector(".volume-quiz");
const volumeValueInput = document.getElementById("volume-value");
const volumeUnitSelect = document.getElementById("volume-unit");
const verifyBtn = document.getElementById("verify-btn");
const content = document.getElementById("content");
const placedCubesLayer = document.getElementById("placed-cubes");
const cubeStack = document.getElementById("cube-stack");
const cuboidExact = document.getElementById("cuboid-exact");
const cuboidExactLabels = document.getElementById("cuboid-exact-labels");
const cuboidDynamic = document.getElementById("cuboid-dynamic");
const cuboidDynamicLabels = document.getElementById("cuboid-dynamic-labels");
const cuboidHiddenEdges = document.getElementById("cuboid-hidden-edges");
const cuboidFrontOverlay = document.getElementById("cuboid-front-overlay");
const labelLayer = document.getElementById("label-layer");
const staticLayer = document.getElementById("static-layer");

let dragState = null;
let cubeCounter = 0;
let isFreeSurfaceMode = false;
const occupancy = new Map();

function occupancyKey(sx, sy, sz) {
  return `${sx},${sy},${sz}`;
}

function getLocalPoint(clientX, clientY) {
  const point = diagram.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  return point.matrixTransform(content.getScreenCTM().inverse());
}

function parseTranslate(element) {
  const transform = element.getAttribute("transform") || "";
  const match = transform.match(/translate\(([-\d.]+)[,\s]+([-\d.]+)\)/);
  if (!match) {
    return { x: 0, y: 0 };
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

function subGridToScreen(sx, sy, sz) {
  return {
    // Hloubka (sy) jde doprava a nahoru – stejně jako ve vzorovém SVG se dvěma krychlemi.
    x: CUBOID_ORIGIN.x + (sx / SUB) * WIREFRAME_UNIT + (sy / SUB) * WIREFRAME_DEPTH_STEP,
    y: CUBOID_ORIGIN.y - (sz / SUB) * WIREFRAME_HEIGHT_STEP - (sy / SUB) * WIREFRAME_DEPTH_STEP,
  };
}

function screenToSubGrid(screenX, screenY) {
  const localX = screenX - CUBOID_ORIGIN.x;
  const localY = screenY - CUBOID_ORIGIN.y;
  // Přibližný inverz k subGridToScreen (počítáme nejdřív hloubku ze svislé složky).
  const syEst = -localY / (WIREFRAME_DEPTH_STEP / SUB);
  const sxEst = (localX - syEst * (WIREFRAME_DEPTH_STEP / SUB)) / (WIREFRAME_UNIT / SUB);
  const szEst = (-localY - syEst * (WIREFRAME_DEPTH_STEP / SUB)) / (WIREFRAME_HEIGHT_STEP / SUB);

  return {
    sx: Math.round(sxEst),
    sy: Math.round(syEst),
    sz: Math.round(szEst),
  };
}

function getCuboidSubSize() {
  return {
    width: CUBOID.widthDm * SUB,
    depth: CUBOID.depthDm * SUB,
    height: CUBOID.heightDm * SUB,
  };
}

function isInsideCuboid(sx, sy, sz, subSize) {
  const bounds = getCuboidSubSize();
  return (
    sx >= 0 &&
    sy >= 0 &&
    sz >= 0 &&
    sx + subSize <= bounds.width &&
    sy + subSize <= bounds.depth &&
    sz + subSize <= bounds.height
  );
}

function markOccupied(sx, sy, sz, subSize, id) {
  for (let dz = 0; dz < subSize; dz += 1) {
    for (let dy = 0; dy < subSize; dy += 1) {
      for (let dx = 0; dx < subSize; dx += 1) {
        occupancy.set(occupancyKey(sx + dx, sy + dy, sz + dz), id);
      }
    }
  }
}

function clearOccupied(id) {
  for (const [key, value] of occupancy.entries()) {
    if (value === id) {
      occupancy.delete(key);
    }
  }
}

function canPlaceAt(sx, sy, sz, subSize, excludeId) {
  if (!isInsideCuboid(sx, sy, sz, subSize)) {
    return false;
  }

  for (let dz = 0; dz < subSize; dz += 1) {
    for (let dy = 0; dy < subSize; dy += 1) {
      for (let dx = 0; dx < subSize; dx += 1) {
        const occupant = occupancy.get(occupancyKey(sx + dx, sy + dy, sz + dz));
        if (occupant !== undefined && occupant !== excludeId) {
          return false;
        }
      }
    }
  }

  return true;
}

function alignSubCell(sx, sy, sz, subSize) {
  if (subSize === 1) {
    return { sx, sy, sz };
  }
  return {
    sx: Math.round(sx / subSize) * subSize,
    sy: Math.round(sy / subSize) * subSize,
    sz: Math.round(sz / subSize) * subSize,
  };
}

function snapSubPosition(sx, sy, sz, subSize, excludeId) {
  const aligned = alignSubCell(sx, sy, sz, subSize);
  sx = aligned.sx;
  sy = aligned.sy;
  sz = aligned.sz;

  let best = { sx, sy, sz };
  let bestDistance = Number.POSITIVE_INFINITY;
  const searchRadius = 2;

  for (let dz = -searchRadius; dz <= searchRadius; dz += 1) {
    for (let dy = -searchRadius; dy <= searchRadius; dy += 1) {
      for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
        const candidate = {
          sx: sx + dx,
          sy: sy + dy,
          sz: sz + dz,
        };

        if (!canPlaceAt(candidate.sx, candidate.sy, candidate.sz, subSize, excludeId)) {
          continue;
        }

        const screen = subGridToScreen(candidate.sx, candidate.sy, candidate.sz);
        const requested = subGridToScreen(sx, sy, sz);
        const distance = Math.hypot(screen.x - requested.x, screen.y - requested.y);

        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
    }
  }

  if (bestDistance > SNAP_THRESHOLD * 2) {
    return null;
  }

  return best;
}

function getSnapDistance(anchorX, anchorY, snapped) {
  if (!snapped) {
    return Number.POSITIVE_INFINITY;
  }
  const screen = subGridToScreen(snapped.sx, snapped.sy, snapped.sz);
  return Math.hypot(screen.x - anchorX, screen.y - anchorY);
}

function getCuboidScreenBounds() {
  const bounds = getCuboidSubSize();
  const xs = [];
  const ys = [];

  const corners = [
    { sx: 0, sy: 0, sz: 0 },
    { sx: bounds.width, sy: 0, sz: 0 },
    { sx: 0, sy: bounds.depth, sz: 0 },
    { sx: bounds.width, sy: bounds.depth, sz: 0 },
    { sx: 0, sy: 0, sz: bounds.height },
    { sx: bounds.width, sy: 0, sz: bounds.height },
    { sx: 0, sy: bounds.depth, sz: bounds.height },
    { sx: bounds.width, sy: bounds.depth, sz: bounds.height },
  ];

  corners.forEach((corner) => {
    const screen = subGridToScreen(corner.sx, corner.sy, corner.sz);
    xs.push(screen.x);
    ys.push(screen.y);
  });

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function shouldSnapToCuboid(anchorX, anchorY) {
  if (isFreeSurfaceMode) {
    return false;
  }

  // Snap jen pokud kurzor míří do projekce kvádru (mírná tolerance).
  const pad = 10;
  const bounds = getCuboidScreenBounds();
  return (
    anchorX >= bounds.minX - pad &&
    anchorX <= bounds.maxX + pad &&
    anchorY >= bounds.minY - pad &&
    anchorY <= bounds.maxY + pad
  );
}

function findNearestBigCubeCell(anchorX, anchorY, excludeId) {
  // Pro velkou krychli (dm3) je mřížka malá, takže můžeme vybrat nejbližší buňku přesně
  // a tím umožnit přichytávání i "na sebe" (osa z) bez nepřesností inverzní projekce.
  const subSize = SUB;
  const bounds = getCuboidSubSize();

  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (let sz = 0; sz <= bounds.height - subSize; sz += subSize) {
    for (let sy = 0; sy <= bounds.depth - subSize; sy += subSize) {
      for (let sx = 0; sx <= bounds.width - subSize; sx += subSize) {
        if (!canPlaceAt(sx, sy, sz, subSize, excludeId)) {
          continue;
        }

        const screen = subGridToScreen(sx, sy, sz);
        const distance = Math.hypot(screen.x - anchorX, screen.y - anchorY);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { sx, sy, sz, distance };
        }
      }
    }
  }

  return best;
}

function sortPlacedCubes() {
  const cubes = [...placedCubesLayer.querySelectorAll(".placed-cube")];
  cubes.sort((a, b) => {
    const ax = Number(a.dataset.sx);
    const ay = Number(a.dataset.sy);
    const az = Number(a.dataset.sz);
    const bx = Number(b.dataset.sx);
    const by = Number(b.dataset.sy);
    const bz = Number(b.dataset.sz);

    // Řazení od "nejvíc vzadu" k "nejvíc vpředu", aby přední bylo nakreslené (a klikatelné) navrchu.
    // - větší hloubka (sy) = víc vzadu -> kreslit dřív
    // - menší výška (sz) = níž -> kreslit dřív (vyšší krychle má být navrchu a uchopitelná)
    // - potom jemně podle x
    if (ay !== by) return by - ay; // sy desc
    if (az !== bz) return az - bz; // sz asc
    return ax - bx; // sx asc
  });
  cubes.forEach((cube) => placedCubesLayer.appendChild(cube));
}

function getCubePickRects(cube) {
  const def = CUBE_TYPES[cube.dataset.type];
  const cells = def.subSize / SUB;
  const anchor = getCubeScreenAnchor(cube);
  const w = WIREFRAME_UNIT * cells;
  const h = WIREFRAME_HEIGHT_STEP * cells;
  const d = WIREFRAME_DEPTH_STEP * cells;

  return [
    { x: anchor.x, y: anchor.y - h, w, h },
    { x: anchor.x, y: anchor.y - h - d, w: w + d, h: d },
    { x: anchor.x + w, y: anchor.y - h - d, w: d, h: h + d },
  ];
}

function isPointInAnyRect(px, py, rects) {
  return rects.some((rect) => isPointInRect(px, py, rect));
}

function isPointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

function pickTopmostCubeAt(localX, localY) {
  const candidates = [];
  placedCubesLayer.querySelectorAll(".placed-cube").forEach((cube) => {
    if (isPointInAnyRect(localX, localY, getCubePickRects(cube))) {
      candidates.push(cube);
    }
  });

  if (!candidates.length) {
    return null;
  }

  // Vyber "nejvíc navrchu" podle skutečné obrazovky, ne podle zastaralých grid souřadnic.
  candidates.sort((a, b) => {
    const aAnchor = getCubeScreenAnchor(a);
    const bAnchor = getCubeScreenAnchor(b);
    if (aAnchor.y !== bAnchor.y) return aAnchor.y - bAnchor.y;
    if (aAnchor.x !== bAnchor.x) return bAnchor.x - aAnchor.x;
    return Number(b.dataset.id) - Number(a.dataset.id);
  });

  return candidates[candidates.length - 1];
}

function pickPlacedCubeFromEvent(event) {
  const hit = event.target.closest(".placed-cube");
  if (hit && placedCubesLayer.contains(hit)) {
    return hit;
  }

  const point = getLocalPoint(event.clientX, event.clientY);
  return pickTopmostCubeAt(point.x, point.y);
}

function cloneCubeShape(type) {
  const def = CUBE_TYPES[type];
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${def.templateId}`);
  return use;
}

function getCubeScreenAnchor(element) {
  const def = CUBE_TYPES[element.dataset.type];
  const position = parseTranslate(element);
  return {
    x: position.x + def.origin.x * def.scale,
    y: position.y + def.origin.y * def.scale,
  };
}

function setCubeScreenAnchor(element, anchorX, anchorY) {
  const def = CUBE_TYPES[element.dataset.type];
  element.setAttribute(
    "transform",
    `translate(${anchorX - def.origin.x * def.scale}, ${anchorY - def.origin.y * def.scale})`,
  );
}
function cubeTransformForGrid(type, sx, sy, sz) {
  const def = CUBE_TYPES[type];
  const anchor = subGridToScreen(sx, sy, sz);
  return `translate(${anchor.x - def.origin.x * def.scale}, ${anchor.y - def.origin.y * def.scale})`;
}

function setCubeGridPosition(element, sx, sy, sz) {
  element.dataset.sx = String(sx);
  element.dataset.sy = String(sy);
  element.dataset.sz = String(sz);
  element.setAttribute("transform", cubeTransformForGrid(element.dataset.type, sx, sy, sz));
}

function createPlacedCubeHitArea(type) {
  const def = CUBE_TYPES[type];
  const cells = def.subSize / SUB;
  const w = WIREFRAME_UNIT * cells;
  const h = WIREFRAME_HEIGHT_STEP * cells;
  const d = WIREFRAME_DEPTH_STEP * cells;
  const originX = def.origin.x * def.scale;
  const originY = def.origin.y * def.scale;
  const hit = document.createElementNS(SVG_NS, "path");
  const front = `M${originX} ${originY}V${originY - h}H${originX + w}V${originY}Z`;
  const top = `M${originX} ${originY - h}H${originX + w + d}V${originY - h - d}H${originX}Z`;
  const side = `M${originX + w} ${originY}V${originY - h - d}H${originX + w + d}V${originY - d}Z`;
  hit.setAttribute("d", `${front} ${top} ${side}`);
  hit.setAttribute("fill", "transparent");
  hit.setAttribute("stroke", "none");
  hit.classList.add("cube-hit");
  return hit;
}

function createPlacedCube(type, sx, sy, sz) {
  const def = CUBE_TYPES[type];
  const group = document.createElementNS(SVG_NS, "g");
  const id = String(++cubeCounter);
  group.classList.add("placed-cube");
  group.dataset.type = type;
  group.dataset.id = id;
  const visual = document.createElementNS(SVG_NS, "g");
  visual.setAttribute("transform", `scale(${def.scale})`);
  visual.appendChild(cloneCubeShape(type));
  group.appendChild(visual);
  group.appendChild(createPlacedCubeHitArea(type));

  placedCubesLayer.appendChild(group);
  setCubeGridPosition(group, sx, sy, sz);
  markOccupied(sx, sy, sz, def.subSize, id);
  sortPlacedCubes();
  return group;
}

function bringToFront(element) {
  placedCubesLayer.appendChild(element);
}

function startDragFromStack(type, localX, localY) {
  const def = CUBE_TYPES[type];
  const cube = createPlacedCube(type, 0, 0, 0);
  clearOccupied(cube.dataset.id);
  // Nově vytvořená krychle se má objevit přesně na stejném místě jako krychle v zásobníku.
  // Jako referenční bod používáme stejný "anchor" jako u ostatních krychlí: (origin.x, origin.y).
  const stackX = def.origin.x;
  const stackY = def.origin.y;
  setCubeScreenAnchor(cube, stackX, stackY);
  bringToFront(cube);
  placedCubesLayer.classList.add("is-dragging");
  diagram.classList.add("is-dragging");

  dragState = {
    element: cube,
    offsetX: localX - stackX,
    offsetY: localY - stackY,
    pointerId: null,
  };
}

function startDragPlacedCube(element, localX, localY) {
  clearOccupied(element.dataset.id);
  const anchor = getCubeScreenAnchor(element);
  bringToFront(element);
  element.classList.add("is-dragging");
  placedCubesLayer.classList.add("is-dragging");
  diagram.classList.add("is-dragging");

  dragState = {
    element,
    offsetX: localX - anchor.x,
    offsetY: localY - anchor.y,
    pointerId: null,
  };
}

function updateDrag(localX, localY) {
  if (!dragState) {
    return;
  }

  const anchorX = localX - dragState.offsetX;
  const anchorY = localY - dragState.offsetY;
  const def = CUBE_TYPES[dragState.element.dataset.type];
  const excludeId = dragState.element.dataset.id;
  const snapLimit = SNAP_THRESHOLD * 1.2;

  if (!shouldSnapToCuboid(anchorX, anchorY)) {
    setCubeScreenAnchor(dragState.element, anchorX, anchorY);
    bringToFront(dragState.element);
    return;
  }

  // Velká krychle: najdeme nejbližší buňku v celé mřížce, aby fungovalo přichytávání
  // i v ose z (skládání na sebe).
  if (def.subSize === SUB) {
    const best = findNearestBigCubeCell(anchorX, anchorY, excludeId);
    if (best && best.distance <= snapLimit) {
      setCubeGridPosition(dragState.element, best.sx, best.sy, best.sz);
    } else {
      setCubeScreenAnchor(dragState.element, anchorX, anchorY);
    }
  } else {
    const grid = screenToSubGrid(anchorX, anchorY);
    const snapped = snapSubPosition(grid.sx, grid.sy, grid.sz, def.subSize, excludeId);
    const distance = getSnapDistance(anchorX, anchorY, snapped);
    if (snapped && distance <= snapLimit) {
      setCubeGridPosition(dragState.element, snapped.sx, snapped.sy, snapped.sz);
    } else {
      setCubeScreenAnchor(dragState.element, anchorX, anchorY);
    }
  }

  bringToFront(dragState.element);
}

function endDrag() {
  if (!dragState) {
    return;
  }

  const { element } = dragState;
  const def = CUBE_TYPES[element.dataset.type];
  const id = element.dataset.id;
  const anchor = getCubeScreenAnchor(element);
  let snapped = null;
  const snapLimit = SNAP_THRESHOLD * 1.2;

  if (shouldSnapToCuboid(anchor.x, anchor.y)) {
    if (def.subSize === SUB) {
      const best = findNearestBigCubeCell(anchor.x, anchor.y, id);
      if (best && best.distance <= snapLimit) {
        snapped = { sx: best.sx, sy: best.sy, sz: best.sz };
      }
    } else {
      const grid = screenToSubGrid(anchor.x, anchor.y);
      const candidate = snapSubPosition(grid.sx, grid.sy, grid.sz, def.subSize, id);
      const distance = getSnapDistance(anchor.x, anchor.y, candidate);
      if (candidate && distance <= snapLimit) {
        snapped = candidate;
      }
    }
  }

  if (snapped && (isFreeSurfaceMode || canPlaceAt(snapped.sx, snapped.sy, snapped.sz, def.subSize, id))) {
    setCubeGridPosition(element, snapped.sx, snapped.sy, snapped.sz);
    markOccupied(snapped.sx, snapped.sy, snapped.sz, def.subSize, id);
  } else {
    setCubeScreenAnchor(element, anchor.x, anchor.y);
  }

  element.classList.remove("is-dragging");
  placedCubesLayer.classList.remove("is-dragging");
  diagram.classList.remove("is-dragging");
  dragState = null;
  sortPlacedCubes();
}

placedCubesLayer.addEventListener("pointerdown", (event) => {
  const placedCube = pickPlacedCubeFromEvent(event);
  if (!placedCube) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  const point = getLocalPoint(event.clientX, event.clientY);
  startDragPlacedCube(placedCube, point.x, point.y);
  dragState.pointerId = event.pointerId;
  diagram.setPointerCapture(event.pointerId);
});

diagram.addEventListener("pointerdown", (event) => {
  if (event.target.closest(".placed-cube")) {
    return;
  }

  const stackCube = event.target.closest(".stack-cube");
  if (!stackCube) {
    return;
  }

  event.preventDefault();
  const point = getLocalPoint(event.clientX, event.clientY);
  const type = stackCube.dataset.type;
  startDragFromStack(type, point.x, point.y);
  dragState.pointerId = event.pointerId;
  diagram.setPointerCapture(event.pointerId);
});

diagram.addEventListener("pointermove", (event) => {
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  event.preventDefault();
  const point = getLocalPoint(event.clientX, event.clientY);
  updateDrag(point.x, point.y);
});

function finishPointer(event) {
  if (!dragState || dragState.pointerId !== event.pointerId) {
    return;
  }

  if (diagram.hasPointerCapture(event.pointerId)) {
    diagram.releasePointerCapture(event.pointerId);
  }
  endDrag();
}

diagram.addEventListener("pointerup", finishPointer);
diagram.addEventListener("pointercancel", finishPointer);

function createLine(x1, y1, x2, y2, options = {}) {
  const line = document.createElementNS(SVG_NS, "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", options.stroke || "#A4A4A4");
  if (options.dash) {
    line.setAttribute("stroke-dasharray", "2 2");
  }
  return line;
}

function createLabel(text, x, y, anchor = "middle") {
  const label = document.createElementNS(SVG_NS, "text");
  label.textContent = text;
  label.setAttribute("x", String(x));
  label.setAttribute("y", String(y));
  label.setAttribute("text-anchor", anchor);
  label.setAttribute("fill", "black");
  label.setAttribute("font-size", "10");
  label.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
  label.setAttribute("font-weight", "500");
  return label;
}

function edgeMidpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function offsetFromEdge(a, b, distance, side = 1) {
  const mid = edgeMidpoint(a, b);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    x: mid.x + (-dy / len) * distance * side,
    y: mid.y + (dx / len) * distance * side,
  };
}

function createDimensionLabel(cm, x, y, anchor = "middle") {
  return createLabel(`${cm} cm`, x, y, anchor);
}

function isExactCuboidSize(widthDm, depthDm, heightDm) {
  return (
    widthDm === EXACT_CUBOID.widthDm &&
    depthDm === EXACT_CUBOID.depthDm &&
    heightDm === EXACT_CUBOID.heightDm
  );
}

function getAvailableDiagramSize() {
  const toolbar = document.querySelector(".ui-overlay");
  const stageRect = stage.getBoundingClientRect();
  const toolbarHeight = toolbar ? toolbar.getBoundingClientRect().height : TOOLBAR_RESERVE;
  const stageGap = 12;

  return {
    width: Math.max(200, stageRect.width),
    height: Math.max(200, stageRect.height - toolbarHeight - stageGap),
  };
}

function getFitScale() {
  const available = getAvailableDiagramSize();
  return Math.min(
    (available.width * VIEWPORT_SAFETY) / DIAGRAM_WIDTH,
    (available.height * VIEWPORT_SAFETY) / DIAGRAM_HEIGHT,
  );
}

function getMaxCuboidDm() {
  const max = getFitScale() >= MIN_FIT_SCALE ? CUBOID_MAX_DM : CUBOID_MIN_DM;
  return { widthDm: max, depthDm: max, heightDm: max };
}

function clampCuboidSize(widthDm, depthDm, heightDm) {
  const max = getMaxCuboidDm();
  // Hrany kvádru musí být násobky hrany větší krychle (1 cm).
  widthDm = Math.round(widthDm);
  depthDm = Math.round(depthDm);
  heightDm = Math.round(heightDm);
  return {
    widthDm: Math.max(CUBOID_MIN_DM, Math.min(widthDm, max.widthDm)),
    depthDm: Math.max(CUBOID_MIN_DM, Math.min(depthDm, max.depthDm)),
    heightDm: Math.max(CUBOID_MIN_DM, Math.min(heightDm, max.heightDm)),
  };
}

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function clearPlacedCubes() {
  placedCubesLayer.replaceChildren();
  occupancy.clear();
}

function updateToolbarModeState() {
  newCuboidBtn.classList.toggle("is-active", !isFreeSurfaceMode);
  freeSurfaceBtn.classList.toggle("is-active", isFreeSurfaceMode);
}

function updateViewBox() {
  const fitScale = getFitScale();
  const displayWidth = DIAGRAM_WIDTH * fitScale;
  const displayHeight = DIAGRAM_HEIGHT * fitScale;

  diagram.setAttribute("viewBox", `0 0 ${DIAGRAM_WIDTH} ${DIAGRAM_HEIGHT}`);
  diagram.setAttribute("preserveAspectRatio", "xMidYMid meet");
  diagram.style.width = `${displayWidth}px`;
  diagram.style.height = `${displayHeight}px`;
  diagramBg.setAttribute("x", "0");
  diagramBg.setAttribute("y", "0");
  diagramBg.setAttribute("width", String(DIAGRAM_WIDTH));
  diagramBg.setAttribute("height", String(DIAGRAM_HEIGHT));
  diagramWrap.style.width = `${displayWidth}px`;
  diagramWrap.style.height = `${displayHeight}px`;
}

function setStaticLayerVisible(visible) {
  staticLayer.style.visibility = visible ? "visible" : "hidden";
  labelLayer.style.visibility = visible ? "visible" : "hidden";
}

function enterFreeSurfaceMode() {
  isFreeSurfaceMode = true;
  setStaticLayerVisible(false);
  volumeQuiz.hidden = true;
  cuboidSizeQuiz.hidden = true;
  clearPlacedCubes();
  resetVolumeQuiz();
  updateToolbarModeState();
  updateViewBox();
}

function exitFreeSurfaceMode() {
  isFreeSurfaceMode = false;
  setStaticLayerVisible(true);
  volumeQuiz.hidden = false;
  cuboidSizeQuiz.hidden = false;
  updateToolbarModeState();
}

function cornerSubGrid(gx, gy, gz) {
  return subGridToScreen(gx * SUB, gy * SUB, gz * SUB);
}

function getCuboidCornerPoints() {
  const { widthDm, depthDm, heightDm } = CUBOID;
  return {
    p000: cornerSubGrid(0, 0, 0),
    p100: cornerSubGrid(widthDm, 0, 0),
    p010: cornerSubGrid(0, depthDm, 0),
    p110: cornerSubGrid(widthDm, depthDm, 0),
    p001: cornerSubGrid(0, 0, heightDm),
    p101: cornerSubGrid(widthDm, 0, heightDm),
    p011: cornerSubGrid(0, depthDm, heightDm),
    p111: cornerSubGrid(widthDm, depthDm, heightDm),
    widthDm,
    depthDm,
    heightDm,
  };
}

function getCuboidVisibleEdges(points) {
  const { p000, p100, p010, p110, p001, p101, p011, p111 } = points;
  return [
    [p000, p100],
    [p100, p110],
    [p001, p101],
    [p101, p111],
    [p111, p011],
    [p011, p001],
    [p000, p001],
    [p100, p101],
    [p110, p111],
  ];
}

function getCuboidHiddenEdges(points) {
  const { p000, p010, p011, p110 } = points;
  return [
    [p010, p011],
    [p010, p000],
    [p110, p010],
  ];
}

function renderHiddenEdges() {
  cuboidHiddenEdges.replaceChildren();
  const points = getCuboidCornerPoints();

  getCuboidHiddenEdges(points).forEach(([a, b]) => {
    cuboidHiddenEdges.appendChild(createLine(a.x, a.y, b.x, b.y, { dash: true }));
  });
}

function renderFrontOverlay() {
  cuboidFrontOverlay.replaceChildren();
  const points = getCuboidCornerPoints();

  getCuboidVisibleEdges(points).forEach(([a, b]) => {
    cuboidFrontOverlay.appendChild(createLine(a.x, a.y, b.x, b.y));
  });
}

function renderDynamicCuboidLabels(points) {
  const { widthDm, depthDm, heightDm, p000, p100, p101, p110, p111 } = points;
  cuboidDynamicLabels.replaceChildren();

  const widthPos = offsetFromEdge(p000, p100, 14);
  const depthPos = offsetFromEdge(p100, p110, 12);
  const heightPos = offsetFromEdge(p110, p111, 12);

  cuboidDynamicLabels.appendChild(createDimensionLabel(widthDm, widthPos.x, widthPos.y));
  cuboidDynamicLabels.appendChild(createDimensionLabel(depthDm, depthPos.x, depthPos.y, "start"));
  cuboidDynamicLabels.appendChild(createDimensionLabel(heightDm, heightPos.x, heightPos.y, "start"));
}

function renderDynamicCuboid() {
  const points = getCuboidCornerPoints();
  renderDynamicCuboidLabels(points);
}

function setCuboidLayerVisibility(useExact) {
  cuboidExact.hidden = !useExact;
  cuboidDynamic.hidden = useExact;
  cuboidExactLabels.style.display = useExact ? "inline" : "none";
  cuboidDynamicLabels.style.display = useExact ? "none" : "inline";
}

function renderCuboidWireframe() {
  const { widthDm, depthDm, heightDm } = CUBOID;
  const useExact = isExactCuboidSize(widthDm, depthDm, heightDm);

  setCuboidLayerVisibility(useExact);
  cuboidExact.replaceChildren();

  if (!useExact) {
    renderDynamicCuboid();
  } else {
    cuboidDynamicLabels.replaceChildren();
  }

  renderHiddenEdges();
  renderFrontOverlay();
  updateViewBox();
}

function updateCuboidSizeInputs() {
  const max = getMaxCuboidDm();
  const inputs = [
    { element: cuboidWidthInput, max: max.widthDm },
    { element: cuboidDepthInput, max: max.depthDm },
    { element: cuboidHeightInput, max: max.heightDm },
  ];

  inputs.forEach(({ element, max: maxValue }) => {
    element.min = String(CUBOID_MIN_DM);
    element.max = String(maxValue);
  });

  cuboidWidthInput.value = String(CUBOID.widthDm);
  cuboidDepthInput.value = String(CUBOID.depthDm);
  cuboidHeightInput.value = String(CUBOID.heightDm);
}

function applyCuboidSizeFromInputs() {
  const width = Number(cuboidWidthInput.value);
  const depth = Number(cuboidDepthInput.value);
  const height = Number(cuboidHeightInput.value);

  if (!Number.isFinite(width) || !Number.isFinite(depth) || !Number.isFinite(height)) {
    return;
  }

  setCuboidSize(width, depth, height);
}

function setCuboidSize(widthDm, depthDm, heightDm) {
  exitFreeSurfaceMode();
  const clamped = clampCuboidSize(widthDm, depthDm, heightDm);
  CUBOID = clamped;
  clearPlacedCubes();
  resetVolumeQuiz();
  renderCuboidWireframe();
  updateCuboidSizeInputs();
}

function getCuboidVolumeCm3() {
  return CUBOID.widthDm * CUBOID.depthDm * CUBOID.heightDm;
}

function convertVolumeFromCm3(volumeCm3, unit) {
  if (unit === "mm3") {
    return volumeCm3 * 1000;
  }
  return volumeCm3;
}

function resetVolumeQuizFeedback() {
  volumeValueInput.classList.remove("is-correct", "is-wrong");
  volumeUnitSelect.classList.remove("is-correct", "is-wrong");
  verifyBtn.classList.remove("is-correct", "is-wrong");
}

function resetVolumeQuiz() {
  volumeValueInput.value = "";
  resetVolumeQuizFeedback();
}

function verifyVolumeAnswer() {
  const value = Number(volumeValueInput.value);
  const unit = volumeUnitSelect.value;

  resetVolumeQuizFeedback();

  if (!Number.isFinite(value)) {
    volumeValueInput.classList.add("is-wrong");
    verifyBtn.classList.add("is-wrong");
    return;
  }

  const expected = convertVolumeFromCm3(getCuboidVolumeCm3(), unit);
  const isCorrect = Math.abs(value - expected) < 0.001;

  volumeValueInput.classList.add(isCorrect ? "is-correct" : "is-wrong");
  volumeUnitSelect.classList.add(isCorrect ? "is-correct" : "is-wrong");
  verifyBtn.classList.add(isCorrect ? "is-correct" : "is-wrong");
}

function generateRandomCuboid() {
  const max = getMaxCuboidDm();
  setCuboidSize(
    randomInt(CUBOID_MIN_DM, max.widthDm),
    randomInt(CUBOID_MIN_DM, max.depthDm),
    randomInt(CUBOID_MIN_DM, max.heightDm),
  );
}

function handleViewportChange() {
  if (isFreeSurfaceMode) {
    updateViewBox();
    return;
  }

  const clamped = clampCuboidSize(CUBOID.widthDm, CUBOID.depthDm, CUBOID.heightDm);
  if (
    clamped.widthDm !== CUBOID.widthDm ||
    clamped.depthDm !== CUBOID.depthDm ||
    clamped.heightDm !== CUBOID.heightDm
  ) {
    setCuboidSize(clamped.widthDm, clamped.depthDm, clamped.heightDm);
  } else {
    updateCuboidSizeInputs();
    updateViewBox();
  }
}

function initCuboid() {
  generateRandomCuboid();
  requestAnimationFrame(updateViewBox);
}

initCuboid();
updateToolbarModeState();
newCuboidBtn.addEventListener("click", generateRandomCuboid);
applyCuboidSizeBtn.addEventListener("click", applyCuboidSizeFromInputs);
freeSurfaceBtn.addEventListener("click", enterFreeSurfaceMode);
verifyBtn.addEventListener("click", verifyVolumeAnswer);
[cuboidWidthInput, cuboidDepthInput, cuboidHeightInput].forEach((input) => {
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      applyCuboidSizeFromInputs();
    }
  });
});
volumeValueInput.addEventListener("input", resetVolumeQuizFeedback);
volumeUnitSelect.addEventListener("change", resetVolumeQuizFeedback);
volumeValueInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    verifyVolumeAnswer();
  }
});
window.addEventListener("resize", handleViewportChange);
