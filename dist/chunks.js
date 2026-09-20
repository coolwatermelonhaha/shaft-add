import * as THREE from 'three';
import {
  CHUNK_SIZE, RENDER_DISTANCE, SEA_LEVEL, WORLD_BOTTOM,
  BLOCK, BLOCK_TEXTURE_MAP, CACTUS_WIDTH, UV_INSET,
  ATLAS_COLS, ATLAS_SIZE
} from './config.js';
import {
  chunks, chunkBuildQueue, queuedChunks, chunkRebuildQueue, queuedRebuilds,
  treeCache, cactusCache, oreCache, caveCache,
  player, scene
} from './core.js';
import {
  getHeight, getGrassColorAt, getBaseBlock, getPlayerBlock, getBlockFacing,
  buildTreeBlocks, buildCactusBlocks
} from './worldgen.js';
import { material, overlayMaterial } from './textures.js';

export function chunkKey(cx, cz) { return `${cx},${cz}`; }

function getTreeBlocksForChunk(cx, cz) {
  const k = chunkKey(cx, cz);
  if (!treeCache.has(k)) treeCache.set(k, buildTreeBlocks(cx, cz));
  return treeCache.get(k);
}

function getCactusBlocksForChunk(cx, cz) {
  const k = chunkKey(cx, cz);
  if (!cactusCache.has(k)) cactusCache.set(k, buildCactusBlocks(cx, cz));
  return cactusCache.get(k);
}

export function buildChunkGeometry(cx, cz) {
  const positions = [], uvs = [], normals = [], indices = [];
  const oPositions = [], oUvs = [], oNormals = [], oIndices = [], oColors = [];
  const bX = cx * CHUNK_SIZE, bZ = cz * CHUNK_SIZE;
  const treeBlocks = getTreeBlocksForChunk(cx, cz);
  const cactusBlocks = getCactusBlocksForChunk(cx, cz);

  const getBlock = (lx, ly, lz) => {
    const wx = bX + lx, wz = bZ + lz;
    const pb = getPlayerBlock(wx, ly, wz);
    if (pb !== null) return pb;
    const k = `${lx},${ly},${lz}`;
    if (treeBlocks.has(k)) return treeBlocks.get(k);
    if (cactusBlocks.has(k)) return cactusBlocks.get(k);
    return getBaseBlock(wx, ly, wz);
  };

  const addFace = (lx, ly, lz, bt, fd, hs = 1, shrink = 0, overlay = false, overlayTop = false) => {
    const x = bX + lx, y = ly, z = bZ + lz, s = hs, pad = shrink;
    const x0 = x + pad, x1 = x + 1 - pad, y0 = y, y1 = y + s, z0 = z + pad, z1 = z + 1 - pad;
    const texDef = BLOCK_TEXTURE_MAP[bt];
    let ti;
    if (overlay) { ti = overlayTop ? texDef.top : texDef.overlay; }
    else {
      if (fd === 0) ti = texDef.top;
      else if (fd === 1) ti = texDef.bottom;
      else {
        let facing = 0;
        if (texDef.front !== undefined) {
          const wx = bX + lx, wz = bZ + lz, f = getBlockFacing(wx, ly, wz), frontFaceIdx = [3, 2, 5, 4][f];
          if (fd === frontFaceIdx) ti = texDef.front; else ti = texDef.side;
        } else ti = texDef.side;
      }
    }
    const u0 = ti / ATLAS_COLS + UV_INSET / ATLAS_COLS;
    const u1 = (ti + 1) / ATLAS_COLS - UV_INSET / ATLAS_COLS;
    const v0 = UV_INSET, v1 = 1 - UV_INSET;
    const P = overlay ? oPositions : positions;
    const U = overlay ? oUvs : uvs;
    const N = overlay ? oNormals : normals;
    const I = overlay ? oIndices : indices;
    const baseIdx = P.length / 3;
    const quad = (a, b, c_, d, ua, ub, uc, ud, nx, ny, nz) => {
      P.push(...a, ...b, ...c_, ...d);
      U.push(...ua, ...ub, ...uc, ...ud);
      for (let i = 0; i < 4; i++) N.push(nx, ny, nz);
      I.push(baseIdx, baseIdx + 1, baseIdx + 2, baseIdx, baseIdx + 2, baseIdx + 3);
    };
    const uvTL = [u0, v1], uvTR = [u1, v1], uvBR = [u1, v0], uvBL = [u0, v0];
    switch (fd) {
      case 0: quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], uvBL, uvBR, uvTR, uvTL, 0, 1, 0); break;
      case 1: quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], uvTL, uvTR, uvBR, uvBL, 0, -1, 0); break;
      case 2: quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], uvBL, uvBR, uvTR, uvTL, 0, 0, 1); break;
      case 3: quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], uvBL, uvBR, uvTR, uvTL, 0, 0, -1); break;
      case 4: quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], uvBL, uvBR, uvTR, uvTL, 1, 0, 0); break;
      case 5: quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], uvBL, uvBR, uvTR, uvTL, -1, 0, 0); break;
    }
  };

  const isOpaque = b => b !== BLOCK.AIR && b !== BLOCK.WATER && b !== BLOCK.LEAVES && b !== BLOCK.CACTUS && b !== BLOCK.TORCH && b !== BLOCK.BED_FOOT && b !== BLOCK.BED_HEAD;
  const TMP_COLOR = new THREE.Color();

  for (let lx = 0; lx < CHUNK_SIZE; lx++) for (let lz = 0; lz < CHUNK_SIZE; lz++) {
    const h = getHeight(bX + lx, bZ + lz);
    const maxY = Math.max(h + 30, SEA_LEVEL + 30);
    TMP_COLOR.setHex(getGrassColorAt(bX + lx + 0.5, bZ + lz + 0.5));

    for (let ly = WORLD_BOTTOM; ly <= maxY; ly++) {
      const block = getBlock(lx, ly, lz);
      if (block === BLOCK.AIR) continue;

      const isW = block === BLOCK.WATER;
      const isL = block === BLOCK.LEAVES;
      const isC = block === BLOCK.CACTUS;
      const isG = block === BLOCK.GRASS;
      const isTorch = block === BLOCK.TORCH;
      const isBed = block === BLOCK.BED_FOOT || block === BLOCK.BED_HEAD;
      const pad = isC ? (1 - CACTUS_WIDTH) / 2 : 0;

      const above = getBlock(lx, ly + 1, lz);
      const below = getBlock(lx, ly - 1, lz);

      let sT;
      if (isW) sT = above !== BLOCK.WATER;
      else if (isC) sT = above !== BLOCK.CACTUS;
      else if (isL) sT = above !== BLOCK.LEAVES;
      else if (isTorch) sT = true;
      else sT = !isOpaque(above);

      if (sT) {
        if (isG) {
          addFace(lx, ly, lz, block, 0, 1, pad, true, true);
          for (let i = 0; i < 4; i++) oColors.push(TMP_COLOR.r, TMP_COLOR.g, TMP_COLOR.b);
        } else {
          let hs2 = isW ? .8 : 1;
          if (isBed) hs2 = .5625;
          if (isTorch) hs2 = .625;
          addFace(lx, ly, lz, block, 0, hs2, pad);
        }
      }

      let sB;
      if (isC) sB = below !== BLOCK.CACTUS;
      else if (isL) sB = below !== BLOCK.LEAVES;
      else if (isTorch) sB = true;
      else sB = !isOpaque(below);
      if (sB) addFace(lx, ly, lz, block, 1, 1, pad);

      if (isW) continue;

      const nF = getBlock(lx, ly, lz + 1);
      const nB = getBlock(lx, ly, lz - 1);
      const nR = getBlock(lx + 1, ly, lz);
      const nL = getBlock(lx - 1, ly, lz);

      const sideFaces = [
        isC ? [2, nF !== BLOCK.CACTUS] : isL ? [2, nF !== BLOCK.LEAVES] : isTorch ? [2, true] : [2, !isOpaque(nF)],
        isC ? [3, nB !== BLOCK.CACTUS] : isL ? [3, nB !== BLOCK.LEAVES] : isTorch ? [3, true] : [3, !isOpaque(nB)],
        isC ? [4, nR !== BLOCK.CACTUS] : isL ? [4, nR !== BLOCK.LEAVES] : isTorch ? [4, true] : [4, !isOpaque(nR)],
        isC ? [5, nL !== BLOCK.CACTUS] : isL ? [5, nL !== BLOCK.LEAVES] : isTorch ? [5, true] : [5, !isOpaque(nL)]
      ];

      for (const [fd, shouldDraw] of sideFaces) {
        if (!shouldDraw) continue;
        let shrink2 = isC ? pad : 0;
        let hs3 = 1;
        if (isBed) hs3 = .5625;
        if (isTorch) { hs3 = .625; shrink2 = .375; }
        addFace(lx, ly, lz, block, fd, hs3, shrink2);
        if (isG) {
          addFace(lx, ly, lz, block, fd, 1, 0, true, false);
          for (let i = 0; i < 4; i++) oColors.push(TMP_COLOR.r, TMP_COLOR.g, TMP_COLOR.b);
        }
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setIndex(indices);

  const oGeom = new THREE.BufferGeometry();
  oGeom.setAttribute('position', new THREE.Float32BufferAttribute(oPositions, 3));
  oGeom.setAttribute('uv', new THREE.Float32BufferAttribute(oUvs, 2));
  oGeom.setAttribute('normal', new THREE.Float32BufferAttribute(oNormals, 3));
  oGeom.setAttribute('color', new THREE.Float32BufferAttribute(oColors, 3));
  oGeom.setIndex(oIndices);

  return { geom, oGeom };
}

export function queueChunkForBuild(cx, cz, priority) {
  const k = chunkKey(cx, cz);
  if (chunks.has(k)) return;
  if (queuedChunks.has(k)) return;
  queuedChunks.add(k);
  chunkBuildQueue.push({ cx, cz, priority });
}

export function queueChunkRebuilds(x, y, z) {
  const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
  const lx = x - cx * CHUNK_SIZE, lz = z - cz * CHUNK_SIZE;
  const addRebuild = (ccx, ccz) => {
    const nk = chunkKey(ccx, ccz);
    if (!chunks.has(nk)) return;
    if (queuedRebuilds.has(nk)) return;
    queuedRebuilds.add(nk);
    chunkRebuildQueue.push({ cx: ccx, cz: ccz });
  };
  addRebuild(cx, cz);
  const w = lx === 0, e = lx === CHUNK_SIZE - 1, n = lz === 0, s = lz === CHUNK_SIZE - 1;
  if (w) addRebuild(cx - 1, cz);
  if (e) addRebuild(cx + 1, cz);
  if (n) addRebuild(cx, cz - 1);
  if (s) addRebuild(cx, cz + 1);
  if (w && n) addRebuild(cx - 1, cz - 1);
  if (w && s) addRebuild(cx - 1, cz + 1);
  if (e && n) addRebuild(cx + 1, cz - 1);
  if (e && s) addRebuild(cx + 1, cz + 1);
}

export function processChunkQueues() {
  const startTime = performance.now(), BUDGET = 8;

  while (chunkRebuildQueue.length > 0 && performance.now() - startTime < BUDGET) {
    const { cx, cz } = chunkRebuildQueue.shift();
    const k = chunkKey(cx, cz);
    queuedRebuilds.delete(k);
    if (!chunks.has(k)) continue;
    const { geom, oGeom } = buildChunkGeometry(cx, cz);
    const newMesh = new THREE.Mesh(geom, material);
    scene.add(newMesh);
    const newOverlay = new THREE.Mesh(oGeom, overlayMaterial);
    scene.add(newOverlay);
    const old = chunks.get(k);
    scene.remove(old.solid); old.solid.geometry.dispose();
    scene.remove(old.overlay); old.overlay.geometry.dispose();
    chunks.set(k, { solid: newMesh, overlay: newOverlay });
  }

  while (chunkBuildQueue.length > 0 && performance.now() - startTime < BUDGET) {
    const { cx, cz } = chunkBuildQueue.shift();
    const k = chunkKey(cx, cz);
    queuedChunks.delete(k);
    if (chunks.has(k)) continue;
    const { geom, oGeom } = buildChunkGeometry(cx, cz);
    const mesh = new THREE.Mesh(geom, material);
    scene.add(mesh);
    const overlay = new THREE.Mesh(oGeom, overlayMaterial);
    scene.add(overlay);
    chunks.set(k, { solid: mesh, overlay: overlay });
  }
}

export function ensureChunksAround(px, pz) {
  const pcx = Math.floor(px / CHUNK_SIZE), pcz = Math.floor(pz / CHUNK_SIZE);
  const needed = new Set();
  for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
    const cx = pcx + dx, cz = pcz + dz, dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > RENDER_DISTANCE + .5) continue;
    const k = chunkKey(cx, cz);
    needed.add(k);
    if (!chunks.has(k)) queueChunkForBuild(cx, cz, dist);
  }
  for (const [k, chunk] of chunks) {
    if (!needed.has(k)) {
      scene.remove(chunk.solid); chunk.solid.geometry.dispose();
      scene.remove(chunk.overlay); chunk.overlay.geometry.dispose();
      chunks.delete(k);
      treeCache.delete(k); cactusCache.delete(k); oreCache.delete(k); caveCache.delete(k);
    }
  }
}

export function rebuildAllChunks() {
  for (const [k, chunk] of chunks) {
    scene.remove(chunk.solid); chunk.solid.geometry.dispose();
    scene.remove(chunk.overlay); chunk.overlay.geometry.dispose();
  }
  chunks.clear();
  ensureChunksAround(player.pos.x, player.pos.z);
}