// Headless test drive: every car races every track with computer drivers.
// Run with `npm run sim` after editing cars or tracks to check that each
// circuit is drivable (everyone finishes, few wall hits) and roughly fair,
// and to see how much the items get used (missiles fired and how many hit,
// how often "you" were hit, obstacles knocked over, coins collected) and
// how the jumps fly. It first checks each layout (bridges where the road
// crosses itself, nothing on a bridge or a ramp...) and lists any problems.
// `npm run sim -- easy` (or medium) races on an easier difficulty.
import { CAR_DESIGNS } from '../src/art/cars.ts';
import { TRACKS } from '../src/tracks/tracks.ts';
import { buildGeometry } from '../src/tracks/geometry.ts';
import { checkTrack } from '../src/tracks/check.ts';
import { Race } from '../src/game/race.ts';
import { DIFFICULTIES, RULES, type Difficulty } from '../src/game/difficulty.ts';

// Node's command-line arguments (the project doesn't pull in Node's type definitions)
declare const process: { argv: string[] };

const DT = 1 / 120;
const difficulty = (process.argv[2] ?? 'hard') as Difficulty;
if (!DIFFICULTIES.includes(difficulty)) throw new Error(`difficulty must be one of ${DIFFICULTIES.join(', ')}`);
console.log(`Difficulty: ${RULES[difficulty].label}`);

for (const def of TRACKS) {
  const geom = buildGeometry(def);
  console.log(`\n${def.name} (${(geom.length / 1000).toFixed(1)}k px per lap)`);
  for (const problem of checkTrack(geom)) console.log(`  ! ${problem}`);
  for (const car of CAR_DESIGNS) {
    const race = new Race(geom, car, difficulty);
    race.started = true;
    race.player.ai.skill = 1;
    let walls = 0;
    const n = { missiles: 0, hits: 0, blocked: 0, youHit: 0, knocks: 0, coins: 0, jumps: 0, air: 0 };
    while (!race.allFinished() && race.time < 300) {
      race.step(DT, race.player.ai.drive(race, race.player, DT));
      for (const e of race.events) {
        if (e.type === 'wall') walls++;
        else if (e.type === 'missile') n.missiles++;
        else if (e.type === 'boom') {
          if (e.blocked) n.blocked++;
          else n.hits++;
          if (!e.blocked && e.racer.isPlayer) n.youHit++;
        } else if (e.type === 'knock') n.knocks++;
        else if (e.type === 'coin') n.coins++;
        else if (e.type === 'land' && e.racer.isPlayer && e.air > 0.2) {
          n.jumps++;
          n.air += e.air;
        }
      }
      race.events.length = 0;
    }
    const line = race
      .standings()
      .map((r) => `${r.place}. ${r.name}${r.isPlayer ? '*' : ''} ${r.finished ? r.finishTime.toFixed(1) + 's' : 'DNF'}`)
      .join('  ');
    console.log(`  ${car.name.padEnd(8)} wall hits ${String(walls).padStart(2)} | ${line}`);
    console.log(`           missiles ${n.missiles} (${n.hits} hit, ${n.blocked} blocked), you hit ${n.youHit}x, ${n.knocks} obstacles knocked, ${n.coins} coins`);
    console.log(`           you jumped ${n.jumps}x, ${n.jumps ? (n.air / n.jumps).toFixed(2) : 0} s in the air on average`);
  }
}
console.log('\n* = driven by a perfect-skill AI in place of the player');
