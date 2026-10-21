# Visland

Ein Voxel-Inselspiel, das komplett aus Code besteht. Es gibt keine Bilder, Modelle, Sounds oder Schriftdateien.
Jede Insel wächst aus einem Seed (zum Beispiel `nebel-bucht-7`): Gleicher Seed, gleiche Insel.

Die Bausteine dafür kommen aus dem [procedural-almanac](https://github.com/BlaiseLabs/procedural-almanac)
(MIT-Lizenz, Kopie in `vendor/almanac/`).

## Spielen

Das Spiel ist eine einfache Webseite ohne Build-Schritt. Lokal starten:

```sh
npm start          # startet einen kleinen Webserver auf http://localhost:8080
```

Oder auf GitHub Pages veröffentlichen: Repo-Einstellungen → Pages → Branch wählen → Ordner `/` (root).

**Ziel:** Auf jeder Insel sind 8 Kristalle versteckt: einer auf dem Meeresgrund, einer in den Bergen, der Rest
irgendwo dazwischen. Nachts steht über jedem noch nicht gefundenen Kristall eine Lichtsäule.

| Aktion           | Handy                        | Computer                    |
| ---------------- | ---------------------------- | --------------------------- |
| Laufen           | linker Daumen (Joystick)     | WASD oder Pfeiltasten       |
| Schauen          | rechts wischen               | Maus (erst ins Bild klicken) |
| Springen/Schwimmen | ⤒                          | Leertaste                   |
| Abbauen          | ⛏ (gedrückt halten)          | Linksklick                  |
| Bauen            | ▣                            | Rechtsklick                 |
| Block wählen     | Hotbar antippen              | 1–9 oder Mausrad            |
| Menü             | ☰                            | ☰ oder M                    |

Deine Änderungen an einer Insel werden im Browser gespeichert (nur das Geänderte, die Insel selbst wächst jedes Mal
neu aus dem Seed).

## Was woher kommt

| Teil des Spiels                      | Almanac-Funktionen                                         | Datei            |
| ------------------------------------ | ---------------------------------------------------------- | ---------------- |
| Inselform, Berge, Fluss              | `islandHeight`, `ridgedNoise`, `windingRiver`, `smoothstep` | `src/world.js`   |
| Wälder, Steppen, Schneegrenze        | `fractalNoise`, `valueNoise`, `latticeRandom`              | `src/world.js`   |
| Laubbäume und Schirmbäume            | `branchingTree` (in zwei gekreuzten Ebenen voxelisiert)    | `src/world.js`   |
| Palmen mit gebogenem Stamm           | `swayingChain`                                             | `src/world.js`   |
| Pixel-Texturen (16 × 16)             | `wallShade`, `leafShade`, `ridgedNoise`, `bayerThreshold`  | `src/textures.js`|
| Tag und Nacht, Himmelsfarben         | `dayCycle`, `mixColour`                                    | `src/sky.js`     |
| Funkelnde Sterne                     | `twinkle`                                                  | `src/sky.js`     |
| Wolken, die nahtlos weiterziehen     | `noiseTile`                                                | `src/sky.js`     |
| Möwenschwarm                         | `flockStep` (Boids)                                        | `src/birds.js`   |
| Lesbare Seeds                        | `seedOf`, `seedWords`, `SeededRandom`                      | `src/main.js`    |

Eigener Code im Spiel: Voxel-Mesher mit Ambient Occlusion und Laternenlicht (`src/mesher.js`), Shader für Gelände,
Wasser, Himmel und Wolken (`src/shaders.js`), Physik und Blickstrahl (`src/player.js`), Steuerung für Touch und
Maus (`src/input.js`) und Klänge per WebAudio (`src/sound.js`). Für 3D wird [three.js](https://threejs.org) vom CDN
geladen.

## Prüfen

```sh
npm run check      # gleiche Seeds → gleiche Inseln, Kristalle, Startpunkt, Meshes
node tools/map.mjs nebel-bucht-7   # Insel als ASCII-Karte im Terminal
```

## Ideen für später

- **Segeln zwischen Inseln:** Am Rand der Karte ein Floß bauen und zur Nachbarinsel (Seed + 1) fahren. Ein
  Archipel, in dem jede Insel anders ist.
- **Dörfer:** kleine Hütten mit `roofPlan` und Wege mit `gridAStar` aus dem Almanac.
- **Wetter:** Regen und Gewitter mit `frontStrength` und `lightningFlash`, Nebelbänke mit `fogBanks`.
- **Tiere:** Krabben am Strand mit `gridWalk`, Fischschwärme mit `flockStep`, Kreaturen mit Genen
  (`genomeFrom`, `crossGenomes`) und Beinen (`twoBoneLimb3d`, `gaitTiming`).
- **Höhlen** im Berg, **Handwerk** (Holz → Bretter), eine **Inselkarte** aus der Höhenkarte.
