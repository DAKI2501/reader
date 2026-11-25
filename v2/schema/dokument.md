# reader-dok/1: dokumentformatet

Det, enhver importør afleverer, og det, der gemmes på enheden. Kode: `src/core/document.js`. Tests: `test/document.test.js`.

```json
{
  "format": "reader-dok/1",
  "title": "Forelæsning 3",
  "lang": "da",
  "source": { "kind": "epub", "name": "forelaesning-3.epub" },
  "blocks": [
    { "id": "h1", "type": "heading", "level": 1, "text": "Behaviorismen" },
    { "id": "b1a2b3c4d", "type": "para", "label": "A1 s.37 ¶3", "text": "Watson afviste …" },
    { "id": "t1", "type": "table", "text": "År Navn …", "speak": null },
    { "id": "f1", "type": "formula", "text": "χ² = Σ (O − E)² / E", "speak": "ki i anden er summen af …" }
  ],
  "toc":   [ { "title": "Behaviorismen", "level": 1, "block": "h1", "word": 0 } ],
  "pages": [ { "label": "37", "block": "b1a2b3c4d", "word": 0 } ]
}
```

## Blokke

| Felt | Regel |
|---|---|
| `id` | Entydigt i dokumentet. Kommer fra kilden (elementets id i en EPUB), ellers dannes det: `r` + 8 hex-cifre af en hash over blokkens første 12 ord (små bogstaver, kun bogstaver og tal). To ens blokke får `-2`, `-3` … Et id fra kilden, der optræder to gange, er en fejl. |
| `type` | `heading` (med `level` 1–6) · `para` · `quote` · `list` · `footnote` · `caption` · `table` · `formula` · `reference` · `other`. Ukendt type bliver `para`. |
| `text` | Den viste tekst. Blødt bindestreg fjernes, mellemrum samles. Blokke uden ord udelades. |
| `label` | Valgfri. Kildens egen betegnelse for stedet. Readeren fortolker den ikke; den vises og føres med ud i noter. |
| `speak` | Mangler: teksten læses op, som den står. `null`: vises, men læses ikke op. En streng: det, der læses op i stedet. Markering ord for ord er kun mulig, når `speak` mangler. |

## Steder

Et sted er `{ "block": id, "word": n, "quote": "…" }`: blokkens id, ordets nummer i blokken (fra 0) og ordene omkring. Løbende ordnumre over hele teksten bruges kun i hukommelsen og gemmes aldrig.

Et gemt sted findes igen i denne rækkefølge: blok-id'et; ellers citatet et sted i teksten; ellers er det tabt, og det siges (`how: "lost"`). En note med et tabt sted slettes ikke.

## Indhold og sider

- `toc` har niveauer (`level` fra 1). Et punkt gælder, til det næste punkt på samme eller højere niveau.
- `pages` er trykte sidetal og er uafhængige af `toc`. `label` er en streng (`37`, `xiv`).
- Begge peger på en blok og eventuelt et ord i den. Før id'erne findes, kan en importør pege med `at` (blokkens nummer i sin egen liste).

## Ændringer

En ændring, der gør gamle filer ugyldige, giver `reader-dok/2` og en omsætter fra `/1`. Nye valgfri felter kræver ikke nyt nummer.
