# Tidskilde-kontrakten

Et ur svarer på ét spørgsmål: hvor i dokumentet er vi nu? Visninger taler kun med et ur, og et ur ved intet om visninger. Kode: `src/time/clock.js`. Første ur: `src/time/tempo.js`.

| Medlem | Betydning |
|---|---|
| `kind` | `tempo`, `audio`, `voice` … |
| `caps` | Hvad uret kan, se nedenfor |
| `load(doc)` | Tag et dokument (må give et løfte) |
| `play()`, `pause()`, `playing` | |
| `seek(n)` | Gå til et løbende ordnummer; uret runder til det, `caps.seek` tillader |
| `now()` | `{ running, frac }`: ordet, vi er ved, og hvor langt inde i det (0–1) |
| `rate`, `setRate(n)` | I `caps.rateUnit`, holdt inden for `caps.rate` |
| `wpm()` | Farten lige nu i ord pr. minut, sat eller målt (til visning) |
| `on(type, fn)` | `state`, `end`, `seek`, `rate`. Giver en funktion, der melder fra |
| `dispose()` | |

`caps`:

| Felt | Værdier | Bruges til |
|---|---|---|
| `rateUnit` | `wpm` eller `x` | Tempo-skyder eller afspilningshastighed |
| `rate` | `{min, max, step}` | Skyderens grænser |
| `grain` | `word`, `sentence`, `block` | Hvor fint uret kender positionen |
| `seek` | `word`, `sentence`, `block` | Hvor fint man kan springe |
| `background` | sand/falsk | Om uret kan køre med låst skærm |

En visning oplyser sine krav (fx `{ grain: 'word', maxWpm: 900 }`), og `fits(caps, krav)` afgør, om parret tilbydes.

| Ur | `rateUnit` | `grain` | `background` | Status |
|---|---|---|---|---|
| Tempo | `wpm`, 50–2000 | `word` | nej | bygget |
| Lydfil | `x`, ca. 0,5–3 | det, filens klip giver | ja, hvis lydprøven holder | F5 |
| Enhedens stemme | `x` | `sentence` | ukendt | F4 |

**Tempoforløb** (jævn, stigende, sprint) er profiler i tempo-uret: en funktion fra grundtempo og spillet tid til tempo nu. Et nyt forløb er en ny profil.

**Lyd-uret får sit synkroniseringskort givet ind** (`src/sync/map.js`); det importerer det ikke selv. Kortet har samme form, uanset om tiderne kom fra Media Overlays eller andet.
