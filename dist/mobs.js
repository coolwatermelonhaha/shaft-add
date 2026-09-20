import * as THREE from 'three';
import { BLOCK, BIOME, WORLD_BOTTOM, MOB_GRAVITY, SEA_LEVEL } from './config.js';
import { mobs, player, scene, camera, getIsNightTime, gamemode } from './core.js';
import { queryBlock, getHeight, getBiome } from './worldgen.js';
import { playSound, soundHit } from './audio.js';

export const models = {};
export const modelManifest = {};

function mobSolid(x, y, z) {
  const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
  if (by < WORLD_BOTTOM - 5) return true;
  const b = queryBlock(bx, by, bz);
  return b !== BLOCK.AIR && b !== BLOCK.WATER && b !== BLOCK.LEAVES;
}

export function buildModel(modelData, color) {
  const g = new THREE.Group();

  function mbox(w, h, d, px, py, pz) {
    const geom = new THREE.BoxGeometry(w / 16, h / 16, d / 16);
    const mat = new THREE.MeshLambertMaterial({ color: color, side: THREE.FrontSide });
    const m = new THREE.Mesh(geom, mat);
    m.position.set(px / 16, -py / 16, pz / 16);
    return m;
  }

  for (const part of modelData.models) {
    for (const box of part.boxes) {
      const [x, y, z, w, h, d] = box.coordinates;
      g.add(mbox(w, h, d, x + w / 2, y + h / 2, z + d / 2));
    }
  }
  return g;
}

export async function loadAllModels() {
  const res = await fetch('models/manifest.json?v=' + Date.now());
  if (!res.ok) { console.error('models/manifest.json not found'); return; }
  const manifest = await res.json();
  Object.assign(modelManifest, manifest);

  const promises = Object.entries(manifest).map(([name, info]) => {
    return fetch(info.model + '?v=' + Date.now())
      .then(r => r.json())
      .then(data => {
        const color = new THREE.Color(info.color || '#888888');
        models[name] = {
          data: data,
          color: color,
          create: () => buildModel(data, color)
        };
        console.log('loaded model: ' + name + ' (' + info.color + ')');
      });
  });

  await Promise.all(promises);
}

export function getModel(name) {
  return models[name] ? models[name].create() : null;
}

function collectMaterials(group) {
  const mats = [];
  group.traverse(obj => {
    if (obj.isMesh && obj.material) mats.push(obj.material);
  });
  return mats;
}

export class Mob {
  constructor(x, y, z, modelName = 'cow') {
    this.group = getModel(modelName) || new THREE.Group();
    this.group.position.set(x, y, z);
    scene.add(this.group);
    this.vel = new THREE.Vector3();
    this.health = 10;
    this.maxHealth = 10;
    this.onGround = false;
    this.width = 0.8;
    this.height = 1.2;
    this.walkDir = new THREE.Vector3(0, 0, 0);
    this.idleTimer = 0;
    this.walkAnim = 0;
    this.type = modelName;
    this.flashTimer = 0;
    this.materials = collectMaterials(this.group);
    this.hurtTimer = 0;
    this.knockbackResist = 1.0;
  }
  update(dt) {
    this.vel.y -= MOB_GRAVITY * dt;
    this.vel.x *= Math.pow(0.15, dt);
    this.vel.z *= Math.pow(0.15, dt);

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const intensity = Math.max(0, this.flashTimer / 0.15);
      for (const m of this.materials) m.emissive.setRGB(intensity, 0, 0);
    }

    this.hurtTimer -= dt;
    const skipAI = this.hurtTimer > 0;

    if (!skipAI) {
      this.idleTimer -= dt;
      if (this.idleTimer <= 0) {
        this.idleTimer = 2 + Math.random() * 3;
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2;
          this.walkDir.set(Math.cos(a), 0, Math.sin(a));
        } else {
          this.walkDir.set(0, 0, 0);
        }
      }
    }

    const sp = 1.2, p = this.group.position;

    if (!skipAI) {
      const nx = p.x + this.walkDir.x * sp * dt;
      const nz = p.z + this.walkDir.z * sp * dt;
      if (!mobSolid(nx, p.y, p.z) && !mobSolid(nx, p.y + this.height - 0.2, p.z)) p.x = nx;
      else this.walkDir.x *= -1;
      if (!mobSolid(p.x, p.y, nz) && !mobSolid(p.x, p.y + this.height - 0.2, nz)) p.z = nz;
      else this.walkDir.z *= -1;
    }

    const kx = p.x + this.vel.x * dt;
    const kz = p.z + this.vel.z * dt;
    if (!mobSolid(kx, p.y, p.z) && !mobSolid(kx, p.y + this.height - 0.2, p.z)) p.x = kx;
    else this.vel.x = 0;
    if (!mobSolid(p.x, p.y, kz) && !mobSolid(p.x, p.y + this.height - 0.2, kz)) p.z = kz;
    else this.vel.z = 0;

    let ny = p.y + this.vel.y * dt;
    this.onGround = false;
    if (this.vel.y <= 0) {
      if (mobSolid(p.x, ny, p.z)) { p.y = Math.floor(ny) + 1; this.vel.y = 0; this.onGround = true; }
      else p.y = ny;
    } else {
      if (mobSolid(p.x, ny + this.height, p.z)) this.vel.y = 0;
      else p.y = ny;
    }

    if (!skipAI && this.walkDir.length() > 0) {
      this.walkAnim += dt * 8;
      this.group.rotation.y = Math.atan2(this.walkDir.x, this.walkDir.z) + Math.PI;
    }

    const swing = Math.sin(this.walkAnim) * 0.4;
    const legs = this.group.userData.legs;
    if (legs) {
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      if (legs[2]) legs[2].rotation.x = -swing;
      if (legs[3]) legs[3].rotation.x = swing;
    }
  }
  damage(a, sourceX, sourceZ) {
    this.health -= a;
    this.flashTimer = 0.15;
    this.hurtTimer = 0.3;
    if (sourceX !== undefined && sourceZ !== undefined) {
      const dx = this.group.position.x - sourceX;
      const dz = this.group.position.z - sourceZ;
      const dist = Math.hypot(dx, dz) || 1;
      const strength = 7 * this.knockbackResist;
      this.vel.x += (dx / dist) * strength;
      this.vel.z += (dz / dist) * strength;
      this.vel.y = 4;
    }
    if (this.health <= 0) { scene.remove(this.group); return true; }
    return false;
  }
}

export class Zombie {
  constructor(x, y, z) {
    this.group = getModel('zombie') || new THREE.Group();
    this.group.position.set(x, y, z);
    scene.add(this.group);
    this.vel = new THREE.Vector3();
    this.health = 20;
    this.maxHealth = 20;
    this.onGround = false;
    this.width = 0.6;
    this.height = 1.8;
    this.walkDir = new THREE.Vector3(0, 0, 0);
    this.walkAnim = 0;
    this.attackCooldown = 0;
    this.type = 'zombie';
    this.flashTimer = 0;
    this.materials = collectMaterials(this.group);
    this.hurtTimer = 0;
    this.knockbackResist = 0.6;
  }
  update(dt) {
    this.vel.y -= MOB_GRAVITY * dt;
    this.vel.x *= Math.pow(0.15, dt);
    this.vel.z *= Math.pow(0.15, dt);
    this.attackCooldown -= dt;

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const intensity = Math.max(0, this.flashTimer / 0.15);
      for (const m of this.materials) m.emissive.setRGB(intensity, 0, 0);
    }

    this.hurtTimer -= dt;
    const skipAI = this.hurtTimer > 0;
    const p = this.group.position;
    const dx = player.pos.x - p.x, dz = player.pos.z - p.z;
    const dist = Math.hypot(dx, dz);

    if (!skipAI) {
      if (dist < 16 && dist > 0) this.walkDir.set(dx / dist, 0, dz / dist);
      else if (Math.random() < 0.02) {
        const a = Math.random() * Math.PI * 2;
        this.walkDir.set(Math.cos(a), 0, Math.sin(a));
      }
      if (this.walkDir.length() > 0) {
        this.group.rotation.y = Math.atan2(this.walkDir.x, this.walkDir.z) + Math.PI;
      }

      const sp = 1.8;
      const nx = p.x + this.walkDir.x * sp * dt;
      const nz = p.z + this.walkDir.z * sp * dt;
      if (!mobSolid(nx, p.y, p.z) && !mobSolid(nx, p.y + this.height - 0.2, p.z)) p.x = nx;
      else this.walkDir.x *= -1;
      if (!mobSolid(p.x, p.y, nz) && !mobSolid(p.x, p.y + this.height - 0.2, nz)) p.z = nz;
      else this.walkDir.z *= -1;
    }

    const kx = p.x + this.vel.x * dt;
    const kz = p.z + this.vel.z * dt;
    if (!mobSolid(kx, p.y, p.z) && !mobSolid(kx, p.y + this.height - 0.2, p.z)) p.x = kx;
    else this.vel.x = 0;
    if (!mobSolid(p.x, p.y, kz) && !mobSolid(p.x, p.y + this.height - 0.2, kz)) p.z = kz;
    else this.vel.z = 0;

    let ny = p.y + this.vel.y * dt;
    this.onGround = false;
    if (this.vel.y <= 0) {
      if (mobSolid(p.x, ny, p.z)) { p.y = Math.floor(ny) + 1; this.vel.y = 0; this.onGround = true; }
      else p.y = ny;
    } else {
      if (mobSolid(p.x, ny + this.height, p.z)) this.vel.y = 0;
      else p.y = ny;
    }

    if (!skipAI && dist < 1.2 && this.attackCooldown <= 0 && Math.abs(p.y - player.pos.y) < 1.5) {
      if (gamemode === 'survival') {
        player.health -= 3;
        if (player.health < 0) player.health = 0;
        const bar = document.getElementById('health-bar');
        if (bar) {
          bar.style.display = 'flex';
          bar.innerHTML = '';
          const hearts = Math.ceil(player.maxHealth / 2);
          for (let i = 0; i < hearts; i++) {
            const heart = document.createElement('div'), hp = player.health - i * 2;
            heart.className = 'heart' + (hp <= 0 ? ' empty' : '');
            bar.appendChild(heart);
          }
        }
        if (player.health <= 0) {
          document.getElementById('death-screen').style.display = 'flex';
          if (document.pointerLockElement) document.exitPointerLock();
        }
      }
      this.attackCooldown = 1;
    }
    this.walkAnim += dt * 6;
    const swing = Math.sin(this.walkAnim) * 0.5;
    const legs = this.group.userData.legs;
    if (legs) { legs[0].rotation.x = swing; legs[1].rotation.x = -swing; }
  }
  damage(a, sourceX, sourceZ) {
    this.health -= a;
    this.flashTimer = 0.15;
    this.hurtTimer = 0.3;
    if (sourceX !== undefined && sourceZ !== undefined) {
      const dx = this.group.position.x - sourceX;
      const dz = this.group.position.z - sourceZ;
      const dist = Math.hypot(dx, dz) || 1;
      const strength = 7 * this.knockbackResist;
      this.vel.x += (dx / dist) * strength;
      this.vel.z += (dz / dist) * strength;
      this.vel.y = 4;
    }
    if (this.health <= 0) { scene.remove(this.group); return true; }
    return false;
  }
}

export function spawnCow(x, z) {
  const y = getHeight(x, z) + 1;
  const cow = new Mob(x, y, z, 'cow');
  mobs.push(cow);
  return cow;
}

export function spawnZombie(x, z) {
  const y = getHeight(x, z) + 1;
  const zz = new Zombie(x, y, z);
  mobs.push(zz);
  return zz;
}

export function trySpawnCows(px, pz) {
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 30;
    const cx = Math.floor(px + Math.cos(a) * d), cz = Math.floor(pz + Math.sin(a) * d);
    const biome = getBiome(cx, cz);
    if (biome !== BIOME.PLAINS && biome !== BIOME.FOREST && biome !== BIOME.OLD_GROWTH) continue;
    const h = getHeight(cx, cz);
    if (h <= SEA_LEVEL) continue;
    if (mobs.some(m => Math.abs(m.group.position.x - cx) < 3 && Math.abs(m.group.position.z - cz) < 3)) continue;
    if (Math.random() < 0.5) spawnCow(cx + 0.5, cz + 0.5);
  }
}

export function trySpawnZombies(px, pz) {
  if (!getIsNightTime()) return;
  const zombieCount = mobs.filter(m => m.type === 'zombie').length;
  if (zombieCount >= 8) return;
  for (let i = 0; i < 6; i++) {
    const a = Math.random() * Math.PI * 2, d = 14 + Math.random() * 20;
    const cx = Math.floor(px + Math.cos(a) * d), cz = Math.floor(pz + Math.sin(a) * d);
    const h = getHeight(cx, cz);
    if (h <= SEA_LEVEL) continue;
    if (mobs.some(m => Math.abs(m.group.position.x - cx) < 2 && Math.abs(m.group.position.z - cz) < 2)) continue;
    if (Math.random() < 0.4) spawnZombie(cx + 0.5, cz + 0.5);
  }
}

let cowSpawnTimer = 0, zombieSpawnTimer = 0;
export function updateMobs(dt) {
  for (const m of mobs) m.update(dt);
  cowSpawnTimer += dt;
  if (cowSpawnTimer > 10) {
    cowSpawnTimer = 0;
    if (mobs.filter(m => m.type === 'cow').length < 15) trySpawnCows(player.pos.x, player.pos.z);
  }
  zombieSpawnTimer += dt;
  if (zombieSpawnTimer > 3) {
    zombieSpawnTimer = 0;
    trySpawnZombies(player.pos.x, player.pos.z);
  }
}

export function getTargetedMob() {
  const origin = new THREE.Vector3(player.pos.x, player.pos.y + 1.6, player.pos.z);
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  let closest = null, closestT = 5;
  for (const m of mobs) {
    const dx = m.group.position.x - origin.x;
    const dy = m.group.position.y + 0.3 - origin.y;
    const dz = m.group.position.z - origin.z;
    const t = dx * dir.x + dy * dir.y + dz * dir.z;
    if (t < 0 || t > 5) continue;
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    const d = Math.sqrt(
      (px - m.group.position.x) ** 2 +
      (py - m.group.position.y - 0.3) ** 2 +
      (pz - m.group.position.z) ** 2
    );
    if (d < 0.8 && t < closestT) { closest = m; closestT = t; }
  }
  return closest;
}