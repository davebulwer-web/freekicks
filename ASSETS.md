# Art & audio guide

Every graphic in the game is a **placeholder in a named slot**. To replace one, save your file over the placeholder at the same path in `public/assets/`, or point the slot at a new file in `public/assets/manifest.json`. Then rebuild. If a file is missing, the game draws the procedural placeholder for it instead, so it never breaks.

- `npm run export-assets` writes all placeholders to `public/assets/`. It doesn't overwrite files you've replaced unless you pass `--overwrite`.
- `npm run export-assets -- --out ../art-pack` exports a clean copy to work from.
- `npm run dev`, then open `/tools/export.html` to see every placeholder in the browser.

## World scale and coordinates

- 1 unit = 1 metre. The goal line is at z = 0, the pitch runs towards +z (the far goal is at z = 105), and the touchlines are at x = ±34.
- Pitch markings are generated from the real IFAB dimensions in `src/config/rules.ts`. Don't paint lines into the grass texture.

## Characters (players, keepers, referee, cameramen)

Characters are camera-facing **billboard sprites** drawn from 8 directions. Each sheet comes in three layers of the same size:

| Layer | File | Contents |
|---|---|---|
| base | `sprites/people_base.png` | Full colour image with alpha. **Kit areas must be greyscale lighting.** A grey of 204 (0.8) shows the kit colour at full strength; lighter values are highlights and darker values are shadows. Skin, hair, boots and so on are painted in their real colours. |
| mask | `sprites/people_mask.png` | Opaque. Red = shirt, Green = shorts, Blue = socks, Black = everything else. Use hard edges with no anti-aliasing. |
| uv | `sprites/people_uv.png` | Opaque. Used for shirt pixels only. **R** = position *around* the body (0 = chest centre, 64 = the player's left side, 128 = centre of the back, 192 = the player's right side). **G** = height from the collar (0) to the hem (255). |

The game uses the uv layer to paint **stripes, hoops, halves and sashes** in any colours. You only draw one set of sprites, and every team kit is generated from it. Treat the uv layer as "where on the shirt is this pixel". The placeholder generator shows how it should look: a smooth gradient around the torso, and sleeves that take the value of the side they're on.

### Kit detail in the base layer

The default sprites are rendered by `src/placeholders/figure.ts`, a small signed-distance-field renderer with an athletic body model. Fabric detail is baked into the **grey values only**, so it survives any kit colour:

- shirt: drag folds from the armpits, waist folds, side seams, a V-neck with a ribbed collar, sleeve cuffs and a hem band;
- shorts: waistband, side seam, hem and folds;
- socks: ribbing and a turnover below the knee;
- boots (not recoloured): sole, laces and a side stripe.

Keep painted replacements to the same rule: shading in kit areas must be neutral grey (R = G = B), with 204 meaning the kit colour at full strength.

Every pose is automatically fitted inside its frame. The limb motion is scaled the same amount in all 8 directions, so nothing is clipped and the character centre never moves. Feet sit on the ground line in every grounded frame. The two exceptions are the airborne jump frame and the kick follow-through hop, which is about 5 px off the ground on purpose.

### Sheet layout

- **Frame size:** 128 × 256 px for `main` and 320 × 256 px for `dive` (keeper dives are wide). You can change frame sizes in the manifest.
- **Scale:** 110 px per metre, with the ground line 14 px from the bottom of each frame. The feet sit on that line, horizontally centred.
- **Rows** are the 8 viewing directions, in this order:

| Row | Character is facing… |
|---|---|
| 0 | towards the camera |
| 1 | camera, turned 45° to screen-right |
| 2 | screen-right (we see their right side) |
| 3 | away, 45° to the right |
| 4 | away from the camera (back view) |
| 5 | away, 45° to the left |
| 6 | screen-left |
| 7 | camera, 45° to the left |

- **Columns** are animation frames. The default table is below. Edit `characters.people.anims` in the manifest to change counts or fps:

| Anim | Sheet | Columns | Notes |
|---|---|---|---|
| idle | main | 0–1 | standing, breathing |
| run | main | 2–7 | 6-frame run cycle |
| kick | main | 8–11 | wind-up, contact, follow-through, recover (right foot) |
| jump | main | 12–13 | wall jump / keeper jump |
| celebrate | main | 14–15 | arms up |
| hold | main | 16 | keeper holding the ball at the chest |
| dive_left | dive | 0–2 | launch, full stretch, landed (towards the keeper's **left**) |
| dive_right | dive | 3–5 | same, to the right |

The goalkeeper and referee use the same sheets in their own kit colours. If you'd like a dedicated keeper sheet (with gloves, for example), add a sheet and anims to the manifest and point the keeper at them in `src/render/World.ts`.

### Cameramen

`characters.cameraman` follows the same three-layer, 8-direction format, with 2 idle columns. Their bibs are tinted through the mask.

## Crowd

`sprites/crowd.png` is an atlas of 48 × 64 px frames. Columns are 16 different fans. Row 0 is sitting or watching and row 1 is cheering (arms up). Each frame shows the waist upwards and represents 1 m of height. Fans are full colour (no mask). They're instanced along every stand row and cheer when goals go in.

## Textures

| Slot | Default file | Notes |
|---|---|---|
| grass | `textures/grass.png` | Tiles every 10.5 m. The top half and bottom half are the two mowing stripes, running parallel to the goal line. |
| surround | `textures/surround.png` | Track/apron beyond the grass, tiled. |
| net | `textures/net.png` | Transparent PNG, one tile = 0.6 m (4 × 4 meshes). |
| ball | `textures/ball.png` | Equirectangular 2:1 sphere map. |
| shadow | `textures/shadow.png` | Soft blob shadow under people and the ball. |
| stand | `textures/stand.png` | Front of one seating row, tiled every 4 m along the stand. |
| dugout | `textures/dugout.png` | Front face of a 6 m × 2.2 m dugout. |
| sky | `textures/sky.png` | Mapped onto a sky dome. |
| pitchWet | `textures/pitch_wet.png` | Rain overlay covering the whole grass area (x −40..40 m, z −6..111 m; top row = the near goal end). **Alpha = standing-water depth.** The ball physics reads it too: above 25% (alpha 64) is a puddle that slows the ball and splashes. Keep damp patches below that. |
| pitchSnow | `textures/pitch_snow.png` | Snow overlay with the same extent. Alpha is snow thickness. Keep it below about 85% so the turf shows through. Pitch markings are always drawn on top. |
| target | `textures/target.png` | Round board for Target Challenge (square image, circle-masked). |
| floodlight | `textures/floodlight.png` | Lamp panel on the floodlight towers (Night Match). |
| title | `ui/title.png` | Title splash key art, 16:9 (1920×1080). Shown full-screen on launch with TAP TO START over the bottom. |
| logo | `ui/logo.png` | Transparent DIP & DRIVE wordmark, used on the main menu. |
| ringIcons | `textures/ring_icons.png` | Shot ring icons: 4 square cells left to right (height, direction, swerve, dip), drawn upright with a transparent background. |

## Shot ring

The aiming control is a glowing arch drawn around the ball, always facing the camera. It is generated in a shader (`src/render/ShotRing.ts`), so it stays sharp at any distance. Its size, arc and gaps are the `RING` constants, and its colours are `FILL`, `EDGE` and `GLOW` in the shader. Only the icons are a bitmap slot.

## Advertising hoardings

`hoardings/hoarding_01.png` to `_10.png` are 1024 × 128 px, sliced from the sponsor sheet in `art/hoardings/hoardings_sheet.png` (ten boards, 10 px separators, plus a `@2x` version). The sheet's source is `tools/hoardings/hoardings.html`; run `node tools/hoardings/render.cjs` to re-render the sheet and slices. Each one is a 6 m × 0.9 m panel. Add as many as you like to the `hoardings` list in the manifest; panels around the ground cycle through them in order.

## Stadium layout

`public/assets/stadium.json` is optional and overrides `src/assets/stadium.ts`. It controls:

- `hoardings.runs`: lines of boards, given as from → to. Keep the pitch on the left-hand side of the run direction when seen from above, the same way round as the default runs.
- `stands`: position, width, number of rows, row depth/height, rotation and crowd density.
- `cameramen`, `dugouts` and `cornerFlags`.
- `models`: extra **glTF/GLB** models (floodlights, a detailed stand, an LED scoreboard and so on). For example: `{ "file": "models/floodlight.glb", "x": -40, "z": -10, "rotationDeg": 45, "scale": 1 }`. Put the files in `public/assets/models/`.

## Audio

`manifest.audio` has slots for `kick`, `whistle`, `post`, `net`, `bounce`, `cheer`, `groan`, `crowd` and `splash`. Leave a slot empty to use the synthesised placeholder, or set a path such as `"audio/kick.ogg"` (relative to `public/assets/`) to use your own file.

## Branding (logo, title art, app icon, launch splash)

`npm run branding` (`tools/branding/`) generates all of these:

- **Logo:** the wordmark, drawn in Luckiest Guy and Lilita One, with the dip swoosh.
- **Title key art:** rendered by the game itself around a real simulated dipping free kick. A clean copy without the logo is saved to `art/branding/key_art_clean.png`.
- **App icon:** a 1024 px master at `art/branding/icon_1024.png`, plus every Android launcher size (legacy, round and adaptive foreground/background) and `public/icon-512.png` / `public/favicon.png`.
- **Android launch splash:** every landscape and portrait density.

To use your own art, replace the PNGs and don't re-run the script, or edit `tools/branding/branding-entry.ts` and re-run it.
