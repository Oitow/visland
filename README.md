# Visland

Ein Inselspiel mit glattem, frei grabbarem Voxel-Gelände, das komplett aus Code besteht. Es gibt keine Bilder, Modelle, Sounds oder Schriftdateien.
Jede Insel wächst aus einem Seed (zum Beispiel `nebel-bucht-7`): Gleicher Seed, gleiche Insel.

Die Bausteine dafür kommen aus dem [procedural-almanac](https://github.com/BlaiseLabs/procedural-almanac)
(MIT-Lizenz, Kopie in `vendor/almanac/`).

## Spielen

Das Spiel ist eine einfache Webseite ohne Build-Schritt. Lokal starten:

```sh
npm start          # startet einen kleinen Webserver auf http://localhost:8080
```

Oder auf GitHub Pages veröffentlichen: Repo-Einstellungen → Pages → Branch wählen → Ordner `/` (root).

**Ziel:** Auf jeder Insel sind 8 Kristalle versteckt: einer auf dem Meeresgrund, einer in den Bergen, einer in einer
Höhle, der Rest irgendwo dazwischen. Nachts steht über jedem noch nicht gefundenen Kristall eine Lichtsäule.

| Aktion           | Handy                        | Computer                    |
| ---------------- | ---------------------------- | --------------------------- |
| Laufen           | linker Daumen (Joystick)     | WASD oder Pfeiltasten       |
| Schauen          | rechts wischen               | Maus (erst ins Bild klicken) |
| Springen/Schwimmen | ⤒                          | Leertaste                   |
| Graben, Bäume fällen, einsammeln | ⛏ (gedrückt halten) | Linksklick              |
| Material auftragen, Laterne setzen | ▣                    | Rechtsklick                 |
| Material wählen  | Hotbar antippen              | 1–9 oder Mausrad            |
| Menü             | ☰                            | ☰ oder M                    |

Deine Änderungen an einer Insel werden im Browser gespeichert: nur die Grab- und Bau-Schritte, die Insel selbst
wächst jedes Mal neu aus dem Seed.

## Wie das Gelände funktioniert

Die Welt ist ein Raster aus Punkten im Meterabstand (160 × 64 × 160). Jeder Punkt speichert keinen Block, sondern
eine **Dichte** (über 0 heißt Boden, unter 0 heißt Luft, ungefähr der Abstand zur Oberfläche) und ein Material.

- **Surface Nets** (`src/surfacenets.js`) machen daraus eine glatte Oberfläche: In jede Zelle, durch die die
  Oberfläche läuft, kommt ein Punkt, und Nachbarpunkte werden zu Vierecken verbunden. Normalen kommen aus dem
  Gefälle der Dichte, Farben werden zwischen Materialien weich gemischt, steile Hänge zeigen Erde oder Fels.
- **Graben** zieht eine Kugel von der Dichte ab, **Bauen** fügt eine hinzu. Danach werden nur die betroffenen
  16 × 16-Stücke neu berechnet.
- **Höhlen** entstehen, wo zwei 3D-Noise-Felder gleichzeitig ihre Mitte kreuzen: zwei Flächen schneiden sich in
  einer Linie, das ergibt Tunnel (`src/noise3.js`).
- Bäume, Kristalle und Laternen sind eigene Low-Poly-Objekte (`src/flora.js`).

## Was woher kommt

| Teil des Spiels                      | Almanac-Funktionen                                         | Datei            |
| ------------------------------------ | ---------------------------------------------------------- | ---------------- |
| Inselform, Berge, Fluss              | `islandHeight`, `ridgedNoise`, `windingRiver`, `smoothstep` | `src/world.js`   |
| Wälder, Steppen, Schneegrenze        | `fractalNoise`, `valueNoise`, `latticeRandom`              | `src/world.js`   |
| Laubbäume und Schirmbäume            | `branchingTree` (in zwei gekreuzten Ebenen)                | `src/world.js`   |
| Palmen mit gebogenem Stamm           | `swayingChain`                                             | `src/world.js`   |
| 3D-Noise für Höhlen                  | `hash32` (gleiches Prinzip wie `valueNoise`, eine Dimension mehr) | `src/noise3.js` |
| Farben der Materialien               | `hexToRgb`, `mixColour`                                    | `src/surfacenets.js` |
| Tag und Nacht, Himmelsfarben         | `dayCycle`, `mixColour`                                    | `src/sky.js`     |
| Funkelnde Sterne                     | `twinkle`                                                  | `src/sky.js`     |
| Wolken, die nahtlos weiterziehen     | `noiseTile`                                                | `src/sky.js`     |
| Möwenschwarm                         | `flockStep` (Boids)                                        | `src/birds.js`   |
| Lesbare Seeds                        | `seedOf`, `seedWords`, `SeededRandom`                      | `src/main.js`    |

Eigener Code im Spiel: Surface-Nets-Mesher mit Ambient Occlusion (`src/surfacenets.js`), Shader für Gelände
(Körnung, Kaustiken unter Wasser, Laternenlicht pro Pixel), Gras, Bäume, Wasser, Himmel und Wolken
(`src/shaders.js`), Physik auf glattem Boden und Blickstrahl (`src/player.js`), Steuerung für Touch und Maus
(`src/input.js`) und Klänge per WebAudio (`src/sound.js`). Für 3D wird [three.js](https://threejs.org) vom CDN
geladen.

## Prüfen

```sh
npm run check      # gleiche Seeds → gleiche Inseln, Kristalle, Startpunkt, Meshes, Graben, Laufen
node tools/map.mjs nebel-bucht-7   # Insel als ASCII-Karte im Terminal
```

## Ideen für später

- **Segeln zwischen Inseln:** Am Rand der Karte ein Floß bauen und zur Nachbarinsel (Seed + 1) fahren. Ein
  Archipel, in dem jede Insel anders ist.
- **Dörfer:** kleine Hütten mit `roofPlan` und Wege mit `gridAStar` aus dem Almanac.
- **Wetter:** Regen und Gewitter mit `frontStrength` und `lightningFlash`, Nebelbänke mit `fogBanks`.
- **Tiere:** Krabben am Strand mit `gridWalk`, Fischschwärme mit `flockStep`, Kreaturen mit Genen
  (`genomeFrom`, `crossGenomes`) und Beinen (`twoBoneLimb3d`, `gaitTiming`).
- **Bauteile** wie in Enshrouded (Wände, Böden, Dächer aus Holz und Stein), **Handwerk** (Holz → Bretter), eine
  **Inselkarte**, Werkzeuge mit verschiedener Pinselgröße.
