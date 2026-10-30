// The race items in the 3D chase view: voxel coins spinning over the road,
// rocket and bubble pickups floating over glowing rings, obstacles that
// tumble away when hit, missiles in flight, and the shield bubbles round
// cars and dizzy stars over knocked-out ones. Synced from the race every
// frame (see game/items.ts), like the overhead view's ItemSprites.
import * as THREE from 'three';
import { meshVoxels, type VoxelGrid } from '../art/voxel.ts';
import { coinVoxels, obstacleVoxels, rocketVoxels, starVoxels } from '../art/itemArt.ts';
import { propModel } from '../art/props3d.ts';
import { pointAt } from '../tracks/geometry.ts';
import { OBSTACLE_RESPAWN } from '../game/items.ts';
import type { Race } from '../game/race.ts';
import { voxelGeometry } from './World3D.ts';

/** How long a knocked-over obstacle is seen flying off, seconds (as in the overhead view). */
const TUMBLE = 0.6;
const MISSILES = 8;

export class Items3D {
  readonly group = new THREE.Group();
  private readonly race: Race;
  private readonly coins: THREE.InstancedMesh;
  private readonly pickups: { root: THREE.Group; ring: THREE.Mesh }[] = [];
  private readonly obstacles: { mesh: THREE.Mesh; angle: number }[] = [];
  private readonly missiles: THREE.Group[] = [];
  private readonly shields: THREE.Mesh[] = [];
  private readonly stars: THREE.Mesh[][] = [];
  private readonly owned: { dispose(): void }[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly pos = new THREE.Vector3();
  private readonly scl = new THREE.Vector3();

  constructor(race: Race) {
    this.race = race;
    const items = race.items;
    const own = <T extends { dispose(): void }>(t: T) => (this.owned.push(t), t);
    /** A voxel model centred on its footprint (x, z) and standing on y = 0, or centred all round. */
    const geo = (grid: VoxelGrid, middle = false) => own(voxelGeometry(meshVoxels(grid), -grid.sx / 2, middle ? -grid.sy / 2 : 0, -grid.sz / 2));
    const solid = own(new THREE.MeshLambertMaterial({ vertexColors: true }));

    // coins: one instanced mesh, slightly self-lit so the gold shines
    const gold = own(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x3a2a00 }));
    this.coins = own(new THREE.InstancedMesh(geo(coinVoxels(), true), gold, Math.max(1, items.coins.length)));
    this.coins.castShadow = true;
    this.coins.frustumCulled = false;
    this.group.add(this.coins);

    const rocket = geo(rocketVoxels(), true);
    const bubble = own(new THREE.IcosahedronGeometry(4.5, 1));
    const bubbleMat = own(new THREE.MeshLambertMaterial({ color: 0x73eff7, emissive: 0x1d6f80, transparent: true, opacity: 0.7, flatShading: true }));
    const ringGeo = own(new THREE.CircleGeometry(7, 20));
    for (const p of items.pickups) {
      const root = new THREE.Group();
      root.position.set(p.x, p.z, p.y);
      const ring = new THREE.Mesh(ringGeo, own(new THREE.MeshBasicMaterial({ color: p.kind === 'missile' ? 0xff6a3d : 0x41e6ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.3;
      root.add(ring);
      const icon = p.kind === 'missile' ? new THREE.Mesh(rocket, solid) : new THREE.Mesh(bubble, bubbleMat);
      icon.castShadow = p.kind === 'missile';
      icon.name = 'icon';
      root.add(icon);
      this.group.add(root);
      this.pickups.push({ root, ring });
    }

    const kind = items.obstacleKind;
    const obstacleGeo = geo(kind === 'bale' ? propModel('hay').grid : obstacleVoxels(kind));
    for (const o of items.obstacles) {
      const mesh = new THREE.Mesh(obstacleGeo, solid);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      // lined up with the road
      this.obstacles.push({ mesh, angle: pointAt(race.geom, o.s).angle });
    }

    for (let i = 0; i < MISSILES; i++) {
      const g = new THREE.Group();
      const mesh = new THREE.Mesh(rocket, solid);
      // lie the rocket down, nose along +x
      mesh.rotation.z = -Math.PI / 2;
      mesh.castShadow = true;
      g.add(mesh);
      g.visible = false;
      this.group.add(g);
      this.missiles.push(g);
    }

    const shieldGeo = own(new THREE.IcosahedronGeometry(14, 1));
    const shieldMat = own(new THREE.MeshLambertMaterial({ color: 0x73eff7, emissive: 0x2a8fa0, transparent: true, opacity: 0.3, depthWrite: false, flatShading: true }));
    const starGeo = geo(starVoxels(), true);
    const starMat = own(new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x5a4a10 }));
    for (let i = 0; i < race.racers.length; i++) {
      const shield = new THREE.Mesh(shieldGeo, shieldMat);
      shield.visible = false;
      this.group.add(shield);
      this.shields.push(shield);
      this.stars.push(
        [0, 1, 2].map(() => {
          const star = new THREE.Mesh(starGeo, starMat);
          star.visible = false;
          this.group.add(star);
          return star;
        }),
      );
    }
  }

  /** `clock` is a running time in seconds, for the animations. */
  update(clock: number): void {
    const items = this.race.items;
    const { m, q, up, pos, scl } = this;
    items.coins.forEach((c, i) => {
      const on = c.respawn <= 0;
      q.setFromAxisAngle(up, clock * 4 + i * 0.4);
      m.compose(pos.set(c.x, c.z + 5 + Math.sin(clock * 3 + i * 0.6) * 0.6, c.y), q, scl.setScalar(on ? 1 : 0));
      this.coins.setMatrixAt(i, m);
    });
    this.coins.instanceMatrix.needsUpdate = true;

    items.pickups.forEach((p, i) => {
      const { root, ring } = this.pickups[i];
      root.visible = p.respawn <= 0;
      if (!root.visible) return;
      const icon = root.getObjectByName('icon')!;
      icon.position.y = 7 + Math.sin(clock * 3 + i) * 1.2;
      icon.rotation.y = clock * 2 + i;
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.2 * Math.sin(clock * 5 + i);
    });

    items.obstacles.forEach((o, i) => {
      const { mesh, angle } = this.obstacles[i];
      const since = OBSTACLE_RESPAWN - o.respawn;
      if (o.respawn <= 0) {
        mesh.visible = true;
        mesh.position.set(o.x, o.z, o.y);
        mesh.rotation.set(0, -angle, 0);
        mesh.scale.setScalar(1);
      } else if (since < TUMBLE) {
        // knocked flying: slides off, hops and tumbles, shrinking away
        const t = since;
        mesh.visible = true;
        mesh.position.set(o.x + o.vx * t * 0.6, o.z + Math.sin((t / TUMBLE) * Math.PI) * 12, o.y + o.vy * t * 0.6);
        mesh.rotation.set(t * 9, -angle, t * 7);
        mesh.scale.setScalar(1 - (t / TUMBLE) * 0.7);
      } else mesh.visible = false;
    });

    this.missiles.forEach((g, i) => {
      const mi = items.missiles[i];
      g.visible = !!mi;
      if (!mi) return;
      g.position.set(mi.x, mi.z + 6, mi.y);
      // models face +x; three.js turns counter-clockwise seen from above
      g.rotation.y = -mi.angle;
    });

    this.race.racers.forEach((r, i) => {
      const b = r.body;
      const shield = this.shields[i];
      // the shield flickers in its last second
      shield.visible = r.shield > 0 && (r.shield > 1 || Math.floor(clock * 12) % 2 === 0);
      if (shield.visible) {
        shield.position.set(b.x, b.z + 6, b.y);
        shield.scale.setScalar(1 + 0.04 * Math.sin(clock * 9));
      }
      this.stars[i].forEach((star, k) => {
        star.visible = b.stun > 0;
        if (!star.visible) return;
        const a = clock * 5 + (k * Math.PI * 2) / 3;
        star.position.set(b.x + Math.cos(a) * 9, b.z + 17, b.y + Math.sin(a) * 9);
        star.rotation.y = -a;
      });
    });
  }

  dispose(): void {
    for (const o of this.owned) o.dispose();
    this.owned.length = 0;
  }
}
