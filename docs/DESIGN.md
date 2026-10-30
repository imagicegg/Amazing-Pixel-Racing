# Tiny Turbo GP: design notes (v1)

## Vision

A short, cheerful arcade racer you can pick up in seconds. Races last about
two minutes, the cars are characters with faces and moods, and everything is
drawn in crisp pixel art. The characters are inspired by the Q-style ("chibi") look
of living cars in films like *Cars 2*: eyes on the windshield, a mouth on the
bumper, stubby bodies and big wheels. They are original designs, not copies of
any existing characters.

**Pillars**

1. **Cute first.** Big eyes, bouncy menus, chiptune music, confetti.
2. **Readable at a glance.** Top-down camera, strong outlines, a limited
   palette and a HUD that never covers the road ahead.
3. **Easy to play, room to master.** Holding the gas and steering is enough
   to finish. Drifting for nitro, drift combos, racing lines and boost pads
   reward skill.
4. **Easy to change.** Cars and tracks are plain text in two files, and art
   and sound are generated from code.

## Why Phaser

| Option | Pros | Cons for this game |
| ------ | ---- | ------------------ |
| **Phaser 4** (chosen) | Free and MIT; mature 2D engine; WebGL with a pixel-art mode; scenes, tweens, particles, input (keyboard, gamepad, touch) built in; runs in any browser, so it is easy to share | Needs a bundler for TypeScript (Vite) |
| Godot 4 | Excellent full engine and editor, exports to desktop and mobile | Editor-centric workflow; web exports are heavier; less suited to "everything in text files" |
| LÖVE (Lua) | Tiny and simple | Desktop only unless ported; no built-in scenes, UI or particles |
| Pygame | Simple, Python | Weak web story; performance |
| PixiJS / KAPLAY | Light renderers | Fewer game systems; more to build by hand |

Phaser gives a playable web build with no installation for players, which
suits a small, shareable first version. Physics is custom (see below), so the
choice of engine has no effect on how the cars feel.

**three.js for the 3D chase view.** Phaser is a 2D engine. The first 3D chase
view faked depth in software ("mode 7"): flat ground, with cars and trees as
flat sprites scaled by distance. Making the cars and scenery solid needs a
depth buffer, so that a building hides the car behind it and a tree hides
half of another. It also needs real lighting and shadows. That is a 3D
renderer's job, so the chase view uses **three.js** (MIT, version 0.186). It
is the most widely used WebGL library, it is tree-shaken into the same bundle,
and it adds about 145 KB gzipped. Everything else stays in Phaser: menus, HUD,
the overhead view, the paint shop and input. Moving the whole game to a 3D
engine such as Babylon.js or Godot would have meant rewriting all of that
for no gain. three.js draws into its own small canvas at the game's 480×270,
and Phaser shows that canvas as a texture under the HUD each frame. The old
software renderer is kept as a fallback for browsers where three.js cannot
start.

## Art direction

- **Resolution:** 480×270, scaled to fit the window with nearest-neighbour
  filtering. Text uses a hand-made 7px font with whole-pixel positioning.
- **Palette:** based on Sweetie 16 (soft, saturated, cute), plus a few extra
  shades for the cars and the neon night track.
- **Car anatomy:**
  - *Top view (20×24 to 22×30 px):* bumper with headlights, short hood, a
    windshield that is almost entirely two big eyes, a roof decal (stripe,
    heart or flames), and wheels poking out at the sides.
  - *Front view (32×26 to 34×28 px):* roof, eyes with iris, pupil and shine, side
    mirrors as "ears", round headlights, and a mouth grille (grin, smile or
    toothy).
- **Rotation:** 32 pre-rendered directions per car using a RotSprite-style
  method (Scale2x three times, then nearest-neighbour sampling), so rotated
  sprites stay clean instead of jagged.
- **Life:** pupils look into the steering direction, portraits blink, cars bob
  1px while driving and hop when a drift starts.
- **Tracks:** painted per pixel from the track spline: asphalt with noise,
  red and white curbs on bends only, a checkered start line, grid boxes, mown
  run-off stripes, themed barriers (tyre stacks, boulders, neon concrete),
  scenery (trees, ponds, mesas, cacti, buildings) and a grandstand next to the
  start. The night track adds dithered lamp pools and car headlight cones.
- **3D (chase view):** everything is voxels, 1 voxel = 1 world pixel, drawn
  at 480×270 so it stays pixel art. The voxel cars and scenery are built from
  the same drawings and palettes (see Camera views).

## Cars

| Car | Personality | Speed | Accel | Handling | Weight | Rival paint |
| --- | ----------- | :---: | :---: | :------: | :----: | ----------- |
| **Zippy** | Sunny yellow all-rounder with racing stripes | 4 | 3 | 4 | 3 | Kiwi (lime) |
| **Momo** | Pink bubble car with a heart roof, quick off the line | 3 | 5 | 4 | 1 | Lilac |
| **Rumble** | Blue muscle car with flames and a spoiler, unbeatable top speed | 5 | 2 | 3 | 5 | Ruby (red) |

Stats map to physics in `specFromStats` (`src/game/physics.ts`):

| Stat | Formula |
| ---- | ------- |
| Top speed | 222 + 9 × speed (px/s) |
| Acceleration | 100 + 24 × accel (px/s²) |
| Turn rate | 2.25 + 0.32 × handling (rad/s), reduced at speed (see below) |
| Grip | 9 + 2.2 × handling |
| Mass | 0.7 + 0.16 × weight |

`npm run sim` shows that each car can win with good driving. Light Momo loses
the most from bumps and recovers fastest. Heavy Rumble shoves the others aside
and rules the straights.

## Tracks

| Track | Difficulty | World | Lap | Features | Off-road |
| ----- | :--------: | ----- | --- | -------- | -------- |
| Sunny Meadow | ★ | 2600×1900 | 8.8k px, ~31s | Wide road, long serpentine loop, a 30 px hill with a long downhill, a river and lake with two stone bridges, one small jump, two boost pads | Grass: 75% speed |
| Dusty Canyon | ★★ | 2800×2100 | 9.5k px, ~35s | Figure of eight over a timber trestle (38 px over the road below), a 50 px drop into the canyon, zig-zag, two jumps, three pads | Sand: 70% speed and slippery |
| Neon City | ★★★ | 2800×2200 | 10.4k px, ~38s | 90° street corners, a 1,300 px flyover crossing the avenue, a 14 px hill, two hill jumps in a row, narrow run-off, night lighting, three pads | Pavement: 85% speed |

All races are 3 laps with 4 cars, about 1.5 to 2 minutes. The player starts
at the back of the grid. Each track also has four lines of coins, three rows
of item pickups, three to five obstacles and three puddles, placed by hand in
`tracks.ts` (see Items and hazards below).

**Why bigger.** The first tracks (3.4k to 5.3k px a lap, races of 45 to 60
seconds) were over almost before they began. The new laps are about twice as
long or more (8.8k to 10.4k px), on worlds of 2.5 to 2.7 times the area. A figure of eight packs a
long lap into less ground, so two of the tracks cross themselves on a bridge.

## Difficulty

Three levels, picked on the track screen and remembered
(`src/game/difficulty.ts`). Hard is the game as tuned for skilled players.
Easy and Medium use three levers: slower rivals, faster nitro charging for
you, and rivals that are slower and less keen to fire missiles at you.

| Level | Rival skill | Rivals' nitro charging | Your nitro charging | Rivals' missiles at you | Rival waits before firing |
| ----- | :---------: | :--------------------: | :-----------------: | :---------------------: | :-----------------------: |
| Easy | ×0.86 | ×0.5 | ×2 | never | 2–5 s |
| Medium | ×0.93 | ×0.75 | ×1.5 | a third as keen | 2.5–6 s |
| Hard | ×1 | ×1 | ×1 | as at any car | 0.8–2.5 s |

- **Rival skill** scales the speeds the AI plans: its target on straights,
  and how fast it dares to take corners. So rivals are slower everywhere
  without driving worse lines or crashing more. Rubber-banding still keeps
  the pack close behind a fast player.
- **Nitro charging** multiplies the drift points that go into the gauge.
  Halving the rivals' charging means fewer nitro bursts from them, which
  also slows them down.
- **Missiles at you** (`rivalAimAtYou`): on Easy you are never a rival's
  target. On Medium you count 0.3 when a rival picks among the cars ahead,
  and a rival whose only target is you holds its fire 70% of the time (it
  waits again). It was half until the tracks grew: races twice as long meant
  twice the hits per race. Rivals also hold a missile for a while before
  firing, longer on the easier levels.
- **Tuning:** each level was checked (on the first, smaller tracks) against
  three simulated players (12 races per track and level): an *expert* (the
  perfect AI driver), an
  *average* player (keyboard steering, speeds ×0.92) and a *beginner*
  (keyboard steering, speeds ×0.85, drifting only the tightest bends).
  - *Easy:* the beginner averages 1st to 2nd and wins 33–100% depending on
    the track; the expert wins every race by 4–8 s.
  - *Medium:* the average player wins 50–100%; the beginner averages 1.4
    to 3.4.
  - *Hard:* the expert and average players win 33–83%; the beginner comes
    last.
  - *With items* (`npm run sim`, the expert only; the checks above came
    before items): on Easy it wins every race and is never hit; on Medium it
    wins 78–100% and is hit 0.3–0.8 times a race; on Hard it wins 33–56%
    and is hit about once a race. Before the per-level missile settings,
    Medium's expert was hit twice a race and won only 2 of 9.
  - *On the bigger tracks with hills, jumps and bridges* (the expert, 12
    races per track): on Easy it wins every race, 17–26 s ahead, and is
    never hit; on Medium it wins 75–100% and is hit 0.1–1.3 times a race
    (most in the city, where the race stays close); on Hard it wins 92% in
    the meadow, 67% in the canyon and 33% in the city, and is hit 0.6–1.8
    times a race.
- **Records** are kept per level, because more nitro means faster times.
  Hard keeps the plain track key, so records set before levels existed (on
  Hard's rules) still count.

## Hills, jumps and bridges

The tracks used to be flat. Now they have height: hills that change your
speed, jumps, and bridges over rivers and over the track itself.

- **The road's height** is a profile along the lap (`elevation` in
  `tracks.ts`): heights at a few points, joined by a periodic monotone cubic
  (Fritsch–Carlson). It never overshoots, so a hill's top is level and two
  equal heights make a flat stretch. Stored every 1 px of arc length; the
  road band (asphalt, run-off, barrier) is level across.
- **Gravity** is 400 px/s², several times real gravity at this scale (a car
  is about 4 m long), so jumps are short and punchy and slopes matter. It
  pulls cars along the slope: on a 10% downhill that is 40 px/s².
- **Downhill surge.** Gravity can carry a car past its top speed going
  downhill, up to +30%. The extra (`CarBody.surge`) fades at 40 px/s² on the
  level, instead of being scrubbed off at the road's 420 px/s² like a spent
  boost, so a descent pays off on the straight after it. Uphill the engine
  still reaches top speed on these gentle grades, it just takes longer: the
  hills give speed rather than take it, in the forgiving spirit of the game.
  A wall hit cancels the surge.
- **Jumps** are kickers in the profile: the road rises as h·u² over `up` px,
  steepest at the lip, then falls as h·(1−v)² over `down` px, so a car flies
  off the lip and lands on a slope that eases out. Jumps are 8 to 14 px high
  with lips of 1 in 3.5 to 1 in 2.5.
- **Taking off.** On the road the car rides the profile. Each step it checks
  the road's rise over the last step: if the road has fallen away faster
  than gravity can pull (its second difference against g·dt²), the car flies.
  The rise is measured from the car's actual arc position, so it is right on
  the inside of a bend too. That arc position comes from tangents
  interpolated along each segment, because the plain nearest point sticks at
  each corner of the centreline polyline on the outside of a bend, which made
  heights stutter and set off one-frame "hops" on descending corners. Only
  the kickers launch cars; hill crests just feel light.
- **In the air** there is no grip and no engine: the car keeps its velocity.
  The steering still turns the nose at 35% of the usual rate, so the grip
  turns the car the way it points on landing. Walls still apply. Landings
  never cost speed. Measured on simulated races: jumps last 0.45 to 0.6 s on
  average (0.7 s at most), peak 13 to 23 px above the road and carry 110 to
  200 px.
- **AIR points.** A jump longer than 0.3 s scores speed × airtime × 20 points
  into the nitro gauge (with the level's charging rate, like drift points): a
  0.6 s jump at full speed is about a fifth of a gauge.
- **Bridges.** A deck is a stretch of road (`bridges` in `tracks.ts`). The
  per-pixel "nearest road" field that the painter uses leaves decks out, so
  it shows whatever passes under them, and the roads onto a deck end square
  at its ends (cut planes, not the rounded caps a nearest-segment field
  gives). Each deck has its own small field. Cars never use the global field:
  `probeNear` walks from the sample the car was at last step to the nearest
  segment, so a car under a bridge follows its own road and the deck's
  railings mean nothing to it. Cars more than 10 px apart in height don't
  collide, and things on the road (coins, pickups, obstacles, puddles,
  missiles) are only touched by a car at their height.
- **Clearance.** Where the loop crosses itself the deck is 36 to 38 px above
  the road below (the lower road dips to make room), so the approaches climb
  at 1 in 9 to 1 in 10 at their steepest. The camera is 75 px above the road, so under a bridge it
  looks down through the deck: the deck and its railings fade to 30% (the
  overhead view's deck to 45%) while your car is under it, over 0.2 s.
- **The land** (`terrain.ts`) is a height grid every 8 px. Across the road
  band it is the road's height; beyond the barrier it eases to the plain over
  110 px. The plain is the road's heights blurred over about 160 px (so a
  climbing road runs up a hillside, not along an embankment), gentle noise
  (±7 px in the meadow, ±5 in the canyon, none in the city), and the river's
  channel, 10 px deep with 16 px banks. Under a deck the ground stays 9 px
  below the road, and the embankment of a road leading onto a deck ends in a
  28 px slope.
- **Checks** (`check.ts`, printed by `npm run sim`): every crossing has a
  deck on its higher side with 30 px or more of room and reaching past the
  road below; no item, pad or puddle on a deck or a jump's ramp; a jump's
  landing doesn't bend more than half the road's width off the line of flight
  within 180 px; the river only meets the road under a deck.

**Overhead view.** The painting is lit like the 3D view: slopes facing the
north-west sun are lighter, the far sides darker, in dithered steps (up to
22%). Each deck is a separate picture, drawn above the cars on the road
below and below the cars on the deck, and its shadow falls on the ground
south-east of it, further the higher the deck. A car in the air rises up the
screen and grows (1.5% per px of height) while its shadow stays on the
ground. Tyre marks are left only on the ground, not in the air or on a deck.
Chevrons mark each jump's ramp.

**3D view.** The ground is a mesh over the height grid (in 384 px pieces,
culled when out of view) with the painted ground as its texture; slopes are
shaded by the sun. Scenery stands at the ground's height and buildings reach
down to the lowest ground under them. Bridges are a slab with the deck's
painting on top, railings by theme (a stone parapet, a timber rail, neon
concrete) and piers wherever they can stand clear of the road below: stone
piers, three-post timber trestle bents with a cross beam, or pairs of
concrete columns. Cars lean with the slope (and partly along their flight
path in the air). This is the car model only; the camera never tilts.

## Gameplay systems

- **Car physics** (`physics.ts`, fixed 120 Hz step): velocity is split into a
  forward part (engine, brakes, rolling drag) and a sideways part, which grip
  damps exponentially. Off-road lowers top speed, grip and acceleration.
- **Off-road is forgiving.** It was 55–75% of top speed, and a car leaving
  the road shed the difference at 420 px/s² (harder than the brakes, 330), so
  a wheel on the grass felt like hitting a wall. Playtesting asked for less,
  so off-road is now 70–85% (`themes.ts`) and each surface has its own `scrub`
  rate, 140–170 px/s², for slowing down to it: about half a second from top
  speed to grass speed. The road keeps 420, which is how quickly the extra
  speed goes when a boost or the nitro runs out.
- **Steering feel:** the virtual steering wheel turns in at 4.5 locks per
  second and returns at 9, so a 0.1 s key tap at speed turns the car about 5°
  (it was 13° before playtesting showed the car was too twitchy) while holding
  the key reaches full lock in ~0.2 s. The turn rate at full lock is
  `maxYawRate`: never tighter than a 36 px circle (no spinning on the spot at
  low speed) and 40% gentler at top speed, which gives a ~120 px circle there.
  That is tighter than nearly every corner, but the tightest hairpins (67 px)
  ask for a little braking or a drift. The AI plans its corner speeds from the
  same function.
- **Drifting (Need for Speed style).** The first version was Mario Kart's
  mini-turbo: hold Drift through a bend and the boost fires when you let go.
  Playtesters found it lacked involvement, so drifting now works like Need for
  Speed: the drift is something you steer, and it earns nitro you fire when
  you choose.
  - *Start:* Drift (Space) plus steering above 42% of top speed flicks the
    tail out: the slide angle grows fast for 0.3 s, then settles.
  - *Steering the slide:* the car travels along its path with its nose turned
    into the bend by the slide angle. The steering wheel's position sets the
    target angle and how fast the path bends. Into the bend gives 46°, or 37°
    without Drift held, and the path bends at up to 95% of the car's turn
    rate. Neutral with Drift held gives 29° and half that bend; neutral
    without Drift fades the drift out. Against the bend gives 4–6° and
    almost no bend, which ends the drift once the angle drops under 7°. A
    narrow slide bends the path less, so drifts straighten out smoothly.
  - *Off the road* a drift can't start, and one that runs onto the grass or
    sand unwinds its slide in about 0.2 s rather than stopping at once (which
    let grip scrub the sideways speed off in a jolt: up to 30% of the car's
    speed within a fifth of a second). If the car is back on the road before
    the slide has gone, the drift carries on. No points are scored on the
    grass.
  - *Cost and reward:* a slide caps speed at `1 − 0.3 × sin(angle)` of top
    speed (−21% at 46°). By these numbers it still takes tight hairpins
    faster than grip driving: the 67 px canyon hairpin goes at about
    200 px/s drifting against about 175 px/s on grip.
  - *Points and combos:* points flow at speed (px/s) × slide angle (degrees)
    × 0.5 per second, times the combo. A drift started within 2 s of the last
    one raises the combo (up to ×5). The combo is banked 2 s after the last
    drift, and a hit harder than 60 px/s (wall or car) loses it ("CRASH!").
  - *Nitro:* the points (with the combo) fill the gauge; 15,000 fills it,
    about two or three good drifts. A full gauge fires with C for 2.6 s:
    top speed ×1.4 and +600 px/s² of push, applied only on the throttle so
    you can brake for a corner.
- **Boost pads** raise top speed by 32% and add strong acceleration for
  0.9 s.
- **Items and hazards** (`items.ts`, placed per track in `tracks.ts`). Ideas
  taken from the genre, not from any one game: coins that make you faster
  while you hold them (kart racers), knock-over clutter on the road (Micro
  Machines' toys, CTR's crates), slippery patches (Super Sprint's oil),
  homing missiles from pickups (Rock n' Roll Racing, CTR), a bubble shield.
  - *Coins:* lines of 5–7, 14 px apart. Each one carried adds 1% top speed
    (`CarBody.bonus`), up to 10. A missile hit spills 3 and an obstacle 1.
    Back 6 s after being collected.
  - *Pickups:* rows of three across the road, alternating shield, missile,
    shield and missile, shield, missile, so you can pick. A car carries one
    missile and one shield, each in its own slot (`Racer.held`), and drives
    through pickups of a kind it already holds. A single shared slot made
    players waste a shield to make room for a missile. Each kind has its own
    button (`Controls.missile`, `Controls.shield`: F and G, gamepad LB and
    d-pad up). Pickups are back 2.5 s after being taken, so the cars behind
    still find some (the player starts last).
  - *Missiles* go for a random car ahead in the race (a rival's only for one
    within 700 px of road, so you see it coming). They follow the road at
    560 px/s, drifting sideways onto the target's line, and home in for the
    last 150 px. A hit stops the car for 3 s (`CarBody.stun`: it skids to a
    stop where it points, no spin, so the chase camera stays put, and R can't
    undo it), then it can't be hit again for 2 s. Only one missile chases a
    car at a time, and a leader has nothing to fire at. Missiles fizzle after
    8 s.
  - *Shields* last 6 s, stop one missile and let you drive through obstacles
    unslowed. A shield can't go up while another is up, so a spare one isn't
    wasted (its box is dimmed meanwhile). Rivals put theirs up 1.5–5 s after
    picking it up, or at once if a missile is 170 px away, so you usually see
    the bubble before firing. With two slots, more shields are carried: in
    `npm run sim` the expert is hit about 0.1–0.6 times a race on Medium
    (1.3 with one slot) and about once on Hard.
    When they waited for the missile, shields blocked 60–75% of shots, and
    firing felt pointless.
  - *Obstacles* (hay bale, keg, traffic cone by theme) cost 30% of the
    car's speed, a tenth at once and the rest through the same knock as a
    wall hit, and are back after 8 s.
  - *Puddles* are painted into the track and change the surface under the
    car: mud is 72% speed and 0.55 grip; oil is 90% speed and 0.18 grip.
  - *AI:* drivers steer round obstacles and puddles within 150 px ahead
    (passing on the side they already lean to). They fire missiles after a
    random wait and put shields up as above.
  - *Feedback:* "MISSILE!" with quickening beeps while one is coming for you,
    missiles on the minimap, BOOM!/HIT!/BLOCKED! messages, dizzy stars over a
    stopped car, and a blink (top view) or see-through car (chase view, to
    avoid flicker in the middle of the screen) while it can't be hit.
- **Collisions:** cars bump as circles with mass-weighted impulses. Barriers
  (tested at the nose, centre and tail) used to reflect the car and take 4%
  of its speed on every physics step of contact. Because the nose stayed
  pointed at the wall, a 15° scrape kept grinding and was down to 15% of its
  speed in half a second, and a square hit stopped dead. Now a car glances off
  and runs on along the wall (`Race.walls`): the way it was going, or after a
  square hit, the way its nose leans. Its nose swings round to match at
  6 rad/s, with the tyres loose while it turns so grip doesn't scrub the slide
  away. The hit costs `0.6 × sin²(angle)` of the speed: about 4% for a 15°
  scrape, 30% at 45° and 60% head-on. The square root of the share kept is
  taken at once and the rest over the next moment, through a temporary top
  speed (`knockSpeed`) that the surface's scrub rate slows the car to.
  Scraping along the wall lowers that top speed by 150 px/s², and the
  slowdown stops at 35% of top speed.
- **Reset (R):** puts the car back on the road at the centreline sample its
  lap progress has reached (so it gains nothing), facing the race direction
  and rolling at 30% of top speed. It lands in the middle of the road or, if
  another car is within 30 px of that spot, at the side of the road or one or
  two car lengths further back. The chase camera cuts to its new place rather
  than swinging round (up to 180° when you were facing the wrong way). The
  HUD suggests it with the wrong-way warning, and after 1.5 s stuck off the
  road.
- **Track queries:** a precomputed per-pixel field stores the nearest
  centreline sample (bridge decks have fields of their own), so "which part
  of the track is here" is a constant-time lookup for the painter and the
  scenery. Cars ask `probeNear` instead, which follows their own road from
  where they were a step ago (see Hills, jumps and bridges): that drives
  walls, surfaces and the lap counter.
- **Laps and positions:** continuous progress along the centreline (jumps
  over 60 samples are ignored, which stops shortcut cheese). A lap counts when
  progress passes a multiple of the lap length, and only the first time.
  Positions sort finishers by time, then everyone else by progress.
- **AI:** looks ahead proportionally to speed, aims at its own lane mixed
  with the inside of the coming bend, dodges slower cars in front, and plans
  speed with a braking curve over the next ~380px. It backs off when stuck.
  Mild rubber-banding (±7–8%) keeps races close. Skill rises with track
  difficulty. Rivals drift in bends tighter than about 240 px. In a drift
  they steer by the bend their path needs to reach their target point, so
  they hit walls no more often than without drifting (0–2 per race in
  `npm run sim`). They fire nitro when the next 320 px are straight, about
  once a lap, and raise their speed plan while it burns.

## Flow

```
Boot (build textures) → Title → Car select → Track select → Race → Results
                                  ↑    ↕           ↑           │  ↺ restart
                                  │  Paint shop    │           │
                                  └───── cars ─────┴─ tracks ──┘
```

The race goes from countdown (3-2-1-GO) to racing to the finish. After the
player finishes, the AI drives their car through a short victory lap while the
others finish, then the results podium shows: 2.5 s after everyone is in, or
after 6 s at most. Enter, Space, gamepad A or a tap goes there straight away.

Scene changes fade out the cameras that are drawing and wait for one of them.
Phaser runs no effects on a hidden camera, and the race hides its world
camera in the chase view. Waiting on that camera once left the race stuck
on an endless victory lap.

## Camera views

Two views, switched with the VIEW button, V, gamepad Y or the pause menu, and
remembered between sessions.

- **Top:** a fixed north-up overhead camera that leads the car slightly in the
  direction it is moving. It is clamped to the world edges.
- **Chase:** a 3D camera 75 px above the ground and 150 px behind the car,
  looking level at the horizon (`src/scenes/ChaseView3D.ts`, drawn by
  three.js).

**Why the chase view is 3D.** The first chase view turned the flat overhead
picture so the car always pointed up the screen. Playtesters found it dizzying,
and measuring keyboard-style laps showed why: to keep the road pointing up, the
picture had to spin at up to 84°/s on Sunny Meadow, 150°/s in Neon City and
164°/s at the Dusty Canyon hairpin, and even the calmer spring-follow version
was turning for 77–86% of every lap. Speed only matters because the turn rate
is speed ÷ corner radius. A flat picture spinning about the middle of the screen
is a *roll*, which reads as the whole world tipping over. Slower spin settings
reduced it, but left the car 30–50° off straight up on average (up to
85–120°), which defeats the point of the view. In a 3D view the same turn is a
*yaw*: the horizon stays level and slides sideways, as when you turn your head.
Playtesters confirmed the 3D view isn't dizzying.

**The camera**

- **Lens:** the camera looks level, and its lens is shifted down so the
  horizon sits at row 60 and upright things stay upright. Your car is at
  exactly 2× size, 210 px down the screen. The software renderer uses the
  same projection, so the two views frame the car identically.
- **Height:** the camera rides 75 px above the road under your car (not the
  car itself, so jumps don't throw it about) on a critically damped spring
  (stiffness 4), and always looks level. Over a recorded lap of each track
  it rises or falls at 30 px/s at most, with an RMS vertical acceleration of
  9 to 13 px/s².
- **Following:** the camera aims along the car's direction of travel (its
  nose when slow or reversing) on a critically damped spring (stiffness 5)
  that copies 30% of the car's turning straight away and is capped at
  150°/s (`src/game/chaseRig.ts`). Compared with locking the camera to the
  nose, the view's turning is 3–4× smoother (RMS turn acceleration), while
  the car stays within 10–13° of straight ahead on average (about 40° at
  most, at 90° street corners).
- **Comfort and readability:** this view never shakes (sound and sparks still
  mark a hit), and a rival between the camera and your car turns
  see-through.
- **Sky:** a 360° panorama per theme (`src/tracks/sky.ts`): a dithered
  gradient, clouds or stars and a moon, and a skyline of hills, mesas or
  towers. A shader samples it by viewing angle, so it pans exactly with the
  world when the camera turns. Distant ground and scenery fade into the same
  haze as the panorama's foot (fog from 450 to 2000 px).

**Voxel cars** (`src/art/car3d.ts`). Each car is built from its own top-view
drawing, so paint-shop cars become 3D with no extra work:

- The drawing gives the footprint and the colours seen from above. The rows
  with the eyes (the windshield) start a tall cabin about 11 px high. The
  bonnet in front is lower (7 px), and so is the rear deck behind (8 px).
  The outermost ring of pixels is one voxel lower, which rounds the body off.
- The sides get body colour with a band of glass side windows. The cabin's
  front shows the eyes again, with the pupils below the whites. Headlights,
  a little mouth and tail lights are placed from the drawing's `y`, `m`/`q`
  and `R` pixels.
- Tyre pixels become separate wheels, a bit bigger than drawn, because chibi
  cars have big wheels. They spin with the car's speed, and the front pair
  steers. A rear wing drawn in dark trim (`s`) floats on two posts.
- Four meshes per car (eyes ahead, left, right and closed) let the pupils
  follow the steering and the car blink every few seconds.

**Voxel scenery** (`src/art/props3d.ts`, `src/tracks/scenery3d.ts`,
`src/scenes/World3D.ts`). The track painter places the scenery and also paints
a second ground for the 3D view. That ground leaves out what the 3D view
builds solid: buildings, mesas, grandstands and the painted shadows.

- **Props:** a voxel model per prop (round trees, layered pines, bushes,
  rocks, hay bales, cacti, barrel cacti with a flower, tumbleweeds, planters,
  lamp posts), in up to three shapes each. Each placement gets a random turn
  and a slight size change. Props are instanced, in 320 px squares so whole
  squares out of view are skipped.
- **Barriers:** tyre stacks (tinted black, red or white in the same pattern as
  the overhead paint), chunky canyon boulders, or neon-topped concrete
  blocks. They are placed every few pixels along the middle of the painted
  barrier band and dropped where the band belongs to another part of the
  track.
- **Buildings:** boxes on the drawing's roof part, about 1.7× as tall as the
  drawing's front wall. They wear the drawing's own roof, and their walls are
  painted with the same window grid and neon signs. All the faces are packed
  into one texture atlas. Lit windows and signs are also in a glow atlas that
  shines at night.
- **Mesas** rise from the drawing's plateau outline on striped cliffs over a
  rubble foot. **Grandstands** have tiers with a little standing crowd, a
  striped roof, and face the track. A **start gantry** with a checkered
  banner (and neon strips at night) arches over the start line.

**Light, shadows and speed**

- **Exact colours:** colour management is off, and the sky light plus the sun
  on a face pointing straight up add up to exactly 1. So the painted ground
  and every top face show their colours exactly as drawn, and only sides and
  shadows are darker. Night is lit by a weaker "moon"; windows, neon, lamp
  heads and headlight pools glow on their own.
- **Shadows:** a 2048² hard-edged shadow map from a sun high in the
  north-west, the same direction as the overhead view's painted shadows.
  Its 840 px box follows the view in whole shadow-map texels, so shadow
  edges don't shimmer.
- **Effects:** sparks, dust, tyre smoke and boost and nitro flames are square
  particles that live in the world with height and gravity, so dust and
  smoke stay behind on the road. Tyre marks are painted into the ground texture, and
  only the changed rows are uploaded, a few times a second.
- **Cost:** about 1.3 ms per frame (physics and drawing) on a desktop. The
  scenery uses half-resolution stand-ins beyond about 500 px and is not drawn
  past 1700 px, which keeps the bigger tracks to about 450k triangles per
  frame, shadows included. If frames still take too long for a
  few seconds, the view drops a quality step for the rest of the session:
  first shadows go, then the draw distance shrinks.
- **Built once per track:** loading a track (field, terrain, painting and the
  3D world) takes about 1.5 s on a desktop and is kept for restarts. The renderer and its canvas are shared for
  the whole session, because browsers allow only a few WebGL contexts.
- **Two cameras:** Phaser's main camera draws the overhead world; a second
  camera draws the HUD and the chase view. The main camera is switched off
  while the chase view is on.

## Paint shop

Players can draw their own racers in the game (`src/scenes/PaintShopScene.ts`).

- **Same format as the team cars.** A painted car is the same ASCII drawing
  plus palette that `src/art/cars.ts` uses, so it goes through the same
  sprite pipeline: 32 rotations, eyes that follow the steering, and a
  blinking portrait. **Copy code** turns it into a `CAR_DESIGNS` entry.
- **Start from a team car, not a blank grid.** A new car begins as a copy of
  Zippy (or of the car you pressed E on), so a first-timer only recolours and
  tweaks. **Start over** switches to another base.
- **Paint pots, not raw colours.** Every letter of the format is a pot. Refilling
  a pot recolours every pixel painted with it, which makes repainting a whole
  car one click. Body and stripe pots also derive their shade and highlight.
- **Mirror on by default,** because cars are symmetric. Right-click erases,
  fill and pick work as in other pixel editors, and each stroke is one undo step.
- **Fair stats:** 14 points across the four stats (team cars total 13–15), each
  from 1 to 5, so a painted car can't be better at everything.
- **Storage:** up to 12 cars in `localStorage`, checked on load (sizes, known
  letters, colours, stat ranges), so a damaged entry is skipped instead of
  breaking the game. Painted cars race the three team cars.

## Audio

Everything is synthesised with WebAudio (`src/game/audio.ts`): a buzzy engine
tied to speed and throttle, tyre squeal and off-road rumble from filtered
noise, and chiptune jingles for countdown, laps and the finish. M toggles
sound, and the setting is remembered.

Music comes from a tiny step sequencer. A song is a few parts written as note
strings (8th- or 16th-note steps), each with a wave shape, a volume and
optional pluck, vibrato, low-pass filter or echo, plus one drum string (kick,
snare, hats, clap, tom and a whip crack). Each track has its own song:

| Song | Feel | Key, tempo | How |
| ---- | ---- | ---------- | --- |
| Menu | relaxed | C major, 116 | soft triangle tune over a slow bass |
| Sunny Meadow | bright and bouncy | C major, 152 | the original race song: square lead, octave-jumping bass |
| Dusty Canyon | dusty western gallop | A minor, 132 | "da-da-dum" galloping bass and hats, plucked guitar-like off-beats, a whistled lead with vibrato, a Spanish E major at the turnarounds, and a whip crack every four bars |
| Neon City | night-time synthwave | E minor, 120 | four-on-the-floor kick with claps and open hats, a driving 16th filtered sawtooth bass, sparkling arpeggios, and a soft sawtooth lead with a dotted-8th echo |

The new songs' volumes were set by rendering each song offline and comparing
loudness: Canyon sits about 2 dB under Meadow, and the calmer City about
4 dB under it.

## Next version ideas

1. **Swap cars with friends:** export a painted car as a short text code and
   import someone else's.
2. **More tracks:** a seaside riviera, a snowy mountain with ice patches and
   ski-jump kickers, a loop-the-loop.
3. **Time trial with a ghost car** and per-track medals.
4. **Grand Prix cup:** all three tracks in a row with points.
5. **Two-player split-screen** (shared keyboard or two gamepads).
6. **More items:** honk-to-stun, an oil slick to drop behind you, a coin
   magnet, and an "items off" switch for pure racing.
7. **More expressions:** squint when boosting, dizzy eyes after a wall hit,
   tears when lapped.
8. **Unlockable paints and stickers** for winning cups.
9. **3D in the menus:** a turntable of your voxel car on the car select
   screen and a live 3D preview in the paint shop.
