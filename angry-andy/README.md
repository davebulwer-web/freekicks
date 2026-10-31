# Angry Andy Gets The Gig

A small top-down pixel-art browser game. You are **Andy**, a permanently annoyed IT manager. Get through the working day (09:00 to 17:00, about 5 real minutes) without your anger hitting 100%.

## How it plays

- Random **tasks** pop up in the panel on the right, each with a timer. Walk to the marker and **hold the action key** until the bar fills. Miss the timer and Andy's anger goes up; finish it and he calms down a little and scores points.
  - **Car arriving**: a car parks in the car park. Check the permit, then **Allow** or **Send away**. The plate must match and the date must not have passed. A wrong call costs anger.
  - **Loo alert**: someone is heading to the toilet to make a mess. Catch them, on the way or in there. If you're too late the toilet is out of order for a while, so Andy can't use it either.
  - **Rant at...**: one of the usual suspects (Printer Pam, Reply-All Roger, Password Pete, Cloud Clive, Budget Brenda) needs a telling-off. Ranting calms Andy the most.
  - **IT staff having fun**: Big Mick, Bearded Ben or Dev are gaming, watching football, chatting, or lounging in the server room. Stop them.
  - **Video call**: these are booked ahead and shown as "Starts in..." Be at your desk when one starts, then hold to sit through it while other tasks keep ticking.
  - **Boss wants you**: go to the stairs. Andy is upstairs for a few seconds, and the timers keep running while he's away.
  - **Shower hog**: Lycra Lee cycles in and hogs the shower. Evict him.
- **Bladder** and **thirst** rise slowly. When either is full, Andy's anger climbs faster and he walks slower. Use the **toilet** (bottom-right corridor) and make **tea** in the **kitchen**, which also calms him a little. Both take a few seconds.
- The day starts gently and gets busier through the afternoon. Each new day is harder. Half of Andy's anger carries over to the next day.
- Andy mutters catchphrases as he goes ("You don't get the gig!", "Worse than my ex-wife."...).

**Controls:** WASD or arrow keys to move. Hold E or Space to act. A/D (or 1/2) to allow or send away a car. P pauses, M mutes. On a phone or tablet, an on-screen joystick and ACT button appear when you touch the screen. Landscape works best.

## Run it

```bash
cd angry-andy
```

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL. `npm run build` makes a static site in `dist/` that you can host anywhere. It uses relative paths, so a sub-folder works too.

```bash
npm test
```

```bash
npm run smoke
```

`npm test` runs the unit tests, which include a headless simulation of a full day. `npm run smoke` drives the real page in headless Chromium and saves screenshots to `smoke-output/`. It needs Playwright.

## Changing things

Everything you'd want to tweak is in `src/data/`:

| File | What it holds |
|---|---|
| `catchphrases.json` | Andy's catchphrases, his grumbles, people's excuses and the boss's lines. Add as many as you like. |
| `tuning.json` | Day length, walking speeds, how fast bladder and thirst fill, how long tea and the loo take, difficulty ramp. |
| `events.json` | Each task type: how often it appears, time limit, hold time, anger penalty, calm reward, points. |
| `characters.json` | The cast: names, desks, who can be ranted at and why, and the looks used to draw placeholder art. |
| `map.json` | The floor plan as a tile grid (`#` wall, `.` floor), rooms, desks, furniture, car park bays and named spots. |

Art: see [ASSETS.md](ASSETS.md).

## Code layout

- `src/main.ts`: boot and the game loop.
- `src/game/`: rules, as plain TypeScript with no DOM. `game.ts` (tasks, events, needs, scoring), `spawner.ts` (random events and difficulty), `meters.ts`, `permit.ts`, `catchphrases.ts`.
- `src/world/map.ts`: the tile map, collision and A* pathfinding for office workers.
- `src/entities/`: Andy, the office workers and cars.
- `src/render/renderer.ts`: draws the office, the HUD, the task panel and the pop-ups on one canvas.
- `src/core/`: assets loader, keyboard and touch input, synthesised sound effects.
- `tools/make-placeholder-art.mjs`: draws all the placeholder PNGs.
