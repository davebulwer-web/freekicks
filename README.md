# Free Kicks

A free-kick arcade game for Android in the style of *Roberto Baggio's Magical Kicks*, built with **TypeScript + Three.js** and wrapped as an Android app with **Capacitor**.

- Set **height**, **direction**, **swerve** and **dip** on a glowing ring around the ball. A marker sweeps along each segment in turn; tap to lock it. Dip runs from float (backspin) through none to heavy dip (topspin). After the fourth tap the kicker runs up and strikes.
- **3 lives.** A goal refills your lives, scores points and moves you on to a harder free kick. A miss costs a life and you retake the same kick. Losing all three is game over.
- **Points:** target zone (the top corners score most), plus a swerve bonus, times a difficulty multiplier (distance, angle, wall size, keeper quality). A rebound goal saves the life and scores a flat 100.
- **Live play** after the kick: the ball comes off posts, crossbar, net, wall and keeper. The keeper catches or parries, defenders clear, and attackers follow in for an automatic rebound shot. The ball going out of play counts as a miss.
- **Modes** (data in `src/config/modes.json`):
  - *Arcade*
  - *Weather Challenge*: gales; rain with puddles that slow the ball and fumbling keepers; snow
  - *Time Attack*: 90 s, no lives
  - *Target Challenge*: boards in the goal for a 1,000-point bonus
  - *Sudden Death*: one life
  - *Bending Masterclass*: goals need at least 50% swerve; double swerve bonus
  - *Night Match*: floodlit
- **Replays:** after every kick, an automatic replay from behind the goal plus one other angle (side, keeper, kicker, aerial). Drag to orbit, pinch to zoom, CAMERA cycles the angles, SKIP moves on. You can also drag to rotate the view while aiming.
- **Teams & kits:** preset teams in `src/config/teams.json` and an in-game kit editor (plain, stripes, hoops, halves, sash, with colours for shirt, shorts and socks plus the keeper kit). Teams are saved on the device.
- **Stadium dressing:** hoardings, stands with an animated crowd, cameramen, dugouts, corner flags and optional glTF models, all data-driven.
- Local top-10 high scores per mode, and placeholder synthesised sound effects.

All art is **placeholder** and designed to be replaced. See [ASSETS.md](ASSETS.md).

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL in a browser (use landscape on a phone). On a computer, click (or press Space) to lock each ring segment and drag to rotate the camera.

```bash
npm test
```

```bash
npm run playtest
```

`npm run playtest` is an automated headless play-through that saves screenshots to `playtest-output/` (it needs Playwright).

## Android APK

**CI:** every push runs `.github/workflows/android.yml`, which tests, builds and uploads `freekicks-debug-apk` (find it on the run's page in the Actions tab). Install it on a phone with "install unknown apps" enabled.

**Locally** (needs JDK 21 and the Android SDK, e.g. via Android Studio):

```bash
npm run android:apk
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. You can also run `npx cap open android` to build from Android Studio.

## Code map

| Path | What |
|---|---|
| `src/sim/` | Renderer-independent simulation: `Match.ts` (run-up, ball, keeper/wall/defender/attacker AI, outcomes), `Kick.ts` (ring values → velocity and spin) |
| `src/physics/` | Ball flight (drag, Magnus curl, wind, bounce, roll) and goal frame/net collisions |
| `src/game/` | `Game.ts` (flow and state machine), `Session.ts` (lives, stages, score), `Scoring.ts`, teams, high scores |
| `src/config/` | Pitch dimensions, rules, modes, preset teams, stage generator |
| `src/render/` | Three.js scene: pitch markings, goal and net ripple, billboard characters plus kit shader, stadium, weather |
| `src/camera/` | Gameplay camera, replay presets, orbit/zoom |
| `src/replay/` | 60 Hz recorder and interpolated playback |
| `src/assets/` | Manifest, stadium layout, asset loader with placeholder fallback |
| `src/placeholders/` | Procedural placeholder art (a small ray-caster renders the 8-direction player sprites) |
| `src/ui/` | HUD, menus, kit editor |
| `tools/` | Asset exporter and automated playtest |
