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
| Zuschlagen (Werkzeug), sonst mit der Hand graben, Kristalle und Laternen aufheben | ⛏ (gedrückt halten) | Linksklick |
| Material auftragen, Laterne setzen | ▣                    | Rechtsklick                 |
| Werkzeug oder Material wählen | Hotbar antippen | 1–9 oder Mausrad            |
| Menü             | ☰                            | ☰ oder M                    |

**Werkzeuge:** Die **Axt** schlägt waagerecht auf Blickhöhe und schneidet Holz. An Stein prallt sie ab. Die
**Spitzhacke** schlägt von oben bis vor die Füße und bricht Boden und Stein. Mit bloßen Händen gräbt man nur weichen
Boden. Ein Schlag zählt nur, wenn die Klinge auf ihrem Weg wirklich etwas trifft. Schnell und quer zur Faser schneidet
am tiefsten.

Deine Änderungen an einer Insel werden im Browser gespeichert: nur die Grab- und Bau-Schritte, die Insel selbst
wächst jedes Mal neu aus dem Seed.

## Wie das Gelände funktioniert

Die Welt ist ein Raster aus Punkten im Abstand von **0,5 m** (320 × 128 × 320). Jeder Punkt speichert keinen Block,
sondern eine **Dichte** (über 0 heißt Boden, unter 0 heißt Luft, ungefähr der Abstand zur Oberfläche) und ein
Material. Gespeichert wird in Blöcken von 8 m: Ein Block, der ganz Luft oder ganz Fels ist, ist nur eine Zahl, und
die Dichte belegt ein Byte pro Punkt. So braucht die Insel rund 8 MB statt 52.

- **Surface Nets** (`src/surfacenets.js`) machen daraus eine glatte Oberfläche (nahe Teilstücke mit jedem Punkt, ferne
  mit jedem zweiten): In jede Zelle, durch die die
  Oberfläche läuft, kommt ein Punkt, und Nachbarpunkte werden zu Vierecken verbunden. Normalen kommen aus dem
  Gefälle der Dichte, Farben werden zwischen Materialien weich gemischt, steile Hänge zeigen Erde oder Fels.
- **Graben** zieht eine Kugel von der Dichte ab, **Bauen** fügt eine hinzu. Danach werden nur die betroffenen
  16 × 16-Stücke neu berechnet.
- **Höhlen** entstehen, wo zwei 3D-Noise-Felder gleichzeitig ihre Mitte kreuzen: zwei Flächen schneiden sich in
  einer Linie, das ergibt Tunnel (`src/noise3.js`).
- Bäume, Kristalle und Laternen sind eigene Objekte (`src/trees.js`, `src/flora.js`).

## Physik und Engine

- **Fester Takt:** Die Physik rechnet immer in Schritten von 1/60 Sekunde, egal wie schnell das Gerät zeichnet; das
  Bild wird zwischen den letzten zwei Schritten weich eingeblendet. So fühlt sich das Spiel auf jedem Gerät gleich an.
- **Kapsel gegen Dichtefeld** (`src/player.js`): Die Figur besteht aus vier übereinander liegenden Kugeln. Das
  Dichtefeld sagt an jedem Punkt, wie weit die Oberfläche ungefähr ist (Wert geteilt durch die Stärke des Gefälles)
  und in welche Richtung es hinaus geht. Jede Kugel wird genau so weit herausgedrückt, wie sie eingesunken ist.
  Boden flacher als 50° trägt (man rutscht nicht), steilerer ist Wand oder Rutsche. An Wänden und Stämmen gleitet
  man entlang, bergab bleibt man am Boden, und nach einer Kante darf man noch kurz springen.
- **Web Worker** (`src/worker.js`, `src/worldjob.js`): Inselbau, Gelände- und Baum-Meshes laufen im Hintergrund.
  Die Seite und der Worker halten je eine Kopie der Welt; jeder Grab- oder Bau-Schritt und jeder gefällte Baum geht
  an beide. Die Teilstücke kommen nach Nähe zum Spieler an. Gibt es keinen Worker, macht die Seite die Arbeit selbst.

## Bäume

Jeder Baum wächst in 3D aus seinem Seed (`src/trees.js`): Ein Ast teilt sich in Kinder, die im goldenen Winkel
(137,5°) um ihn herum abzweigen, wie Äste und Blätter an echten Pflanzen. Sie biegen sich zum Licht oder hängen
durch, und Noise lässt sie leicht wandern. Arten: **Eiche** (breit, manche schon herbstlich), **Birke** (weiße
Rinde, hängende Zweige), **Kiefer** (Astquirle in Etagen), **Palme** (geringelter, gebogener Stamm, Wedel,
Kokosnüsse), **Schirmakazie** (flache Krone) und **Büsche**. Die Rinde sind Röhren mit Wurzeln am Fuß, das Laub sind
Blattbüschel mit einer im Code gemalten Blatt-Textur (`leafAtlas` in `src/flora.js`). Alles wiegt sich im Wind.

**Holz schneiden** (`src/wood.js`): Jeder Baum ist ein Skelett aus Röhren, und jeder Ast weiß, woran er hängt. Ein
Hieb schneidet genau dort eine Kerbe, wo er trifft: am Stamm, an einem Ast, an einem liegenden Stück. Dünnes Holz geht
schneller durch als dickes. Ist ein Schnitt durch, löst sich alles dahinter (der Rest des Astes, was daran wächst,
sein Laub) als eigener **Physik-Körper** (Rapier, `src/physics.js`). Er fällt, rollt, schwimmt im Wasser und bleibt
liegen. Ein am Fuß gekappter Stamm kippt von der Kerbe weg. Abgetrennte Stücke lassen sich weiter zerteilen. Ihr
Laub welkt nach einer Weile. Stücke bis 2,4 m Holz sammelst du durch Hinlaufen ein, größere müssen erst kleiner
gehackt werden.

## Was woher kommt

| Teil des Spiels                      | Almanac-Funktionen                                         | Datei            |
| ------------------------------------ | ---------------------------------------------------------- | ---------------- |
| Inselform, Berge, Fluss              | `islandHeight`, `ridgedNoise`, `windingRiver`, `smoothstep` | `src/world.js`   |
| Wälder, Steppen, Schneegrenze        | `fractalNoise`, `valueNoise`, `latticeRandom`              | `src/world.js`   |
| Wo welche Baumart wächst             | `fractalNoise`, `valueNoise`, `latticeRandom`              | `src/world.js`   |
| Äste, die sich biegen und wandern    | `valueNoise`, `SeededRandom`, `lerp`                       | `src/trees.js`   |
| 3D-Noise für Höhlen                  | `hash32` (gleiches Prinzip wie `valueNoise`, eine Dimension mehr) | `src/noise3.js` |
| Farben der Materialien               | `hexToRgb`, `mixColour`                                    | `src/surfacenets.js` |
| Tag und Nacht, Himmelsfarben         | `dayCycle`, `mixColour`                                    | `src/sky.js`     |
| Funkelnde Sterne                     | `twinkle`                                                  | `src/sky.js`     |
| Wolken, die nahtlos weiterziehen     | `noiseTile`                                                | `src/sky.js`     |
| Möwenschwarm                         | `flockStep` (Boids)                                        | `src/birds.js`   |
| Lesbare Seeds                        | `seedOf`, `seedWords`, `SeededRandom`                      | `src/main.js`    |

Eigener Code im Spiel: 3D-Baumgenerator (`src/trees.js`, nach den Verzweigungsmodellen aus *The Algorithmic
Beauty of Plants*, auf denen auch der Almanac aufbaut), Holz schneiden mit Physik (`src/wood.js`, `src/physics.js`), Werkzeug-Schwünge (`src/tools.js`), Partikel
(`src/particles.js`), Surface-Nets-Mesher mit Ambient Occlusion (`src/surfacenets.js`), Shader für Gelände
(Körnung, Kaustiken unter Wasser, Laternenlicht pro Pixel), Gras, Bäume, Wasser, Himmel und Wolken
(`src/shaders.js`), Physik auf glattem Boden und Blickstrahl (`src/player.js`), Steuerung für Touch und Maus
(`src/input.js`) und Klänge per WebAudio (`src/sound.js`). Für 3D wird [three.js](https://threejs.org) vom CDN
geladen.

## Prüfen

```sh
npm run check      # Inseln, Kristalle, Meshes, Graben, Laufen, Hänge, Stämme, Bildraten, Worker
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
