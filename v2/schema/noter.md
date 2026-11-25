# reader-noter/1: noter og markeringer

Det, Readeren skriver ud, når noter hentes som fil. Kode: `src/core/notes.js`. Tests: `test/notes.test.js`.

```json
{
  "format": "reader-noter/1",
  "exported": "2026-11-25T07:00:00.000Z",
  "document": { "title": "Forelæsning 3", "source": { "kind": "epub", "name": "forelaesning-3.epub" } },
  "notes": [
    { "id": "n…", "kind": "note", "block": "b1a2b3c4d", "word": 5, "label": "A1 s.37 ¶3",
      "page": "37", "section": ["Forelæsning 3", "Behaviorismen"],
      "quote": "afviste introspektion som metode i psykologien", "text": "Sammenlign med Wundt",
      "created": "2026-11-25T06:58:10.000Z", "found": "id" }
  ]
}
```

| Felt | Regel |
|---|---|
| `kind` | `note` (har tekst) eller `mark` (kun et sted) |
| `block`, `word` | Stedet, som i `reader-dok/1`. `block` er kildens id, når kilden havde et |
| `label` | Blokkens etiket, uændret, eller `null` |
| `page`, `section` | Udledt ved eksporten: trykt side og vejen ned gennem indholdet |
| `quote` | Ordene omkring stedet, gemt da noten blev skrevet |
| `found` | `id`, `quote` eller `lost`: hvordan stedet blev fundet ved eksporten |

Noterne står i læserækkefølge; tabte står sidst. Den, der læser filen, kan koble på `block` alene. Readeren laver også en ren tekstudgave til at læse.
