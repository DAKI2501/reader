---
id: reader
type: projekt
status: aktiv
repo: DAKI2501/reader
ejer: "claude.ai-projektet READER"
sources: [README.md, v2/docs/arkitektur.md, v2/schema/dokument.md, v2/schema/noter.md, v2/schema/tidskilde.md]
links: []
quality: "Den gamle Reader (roden): i daglig brug, ingen tests. Den nye (v2/): kernen testet, første skal prøvet i Chrome."
foelsomt: false
opdateret: 2026-11-25
---

## Hvad det er

Reader er et studieredskab til hurtiglæsning i browseren, med Ψ-OCR til scannede sider. Repoet er offentligt og ligger på GitHub Pages.

Der er to udgaver. **Den gamle** i roden (`index.html`) er den, der bruges. **Den nye** bygges i `v2/`, så den også kan bære id'er fra kilden, indhold i niveauer og lyd, der følger teksten. Roden skifter, når den nye kan det samme som den gamle (`v2/docs/arkitektur.md` §5).

## Kan give andre

- **`reader-noter/1`** (`v2/schema/noter.md`): noter og markeringer med blok-id, etiket, side og citat, som JSON.
- **`reader-dok/1`** (`v2/schema/dokument.md`): blokke, indhold i niveauer og sidetal som egen akse.
- **Synkroniseringskort** (`v2/src/sync/map.js`): tid ↔ sted ud fra klip. Kører også i Node.
- **Ψ-OCR** (`ocr.html`, `ocr/`): tekstgenkendelse i browseren, dansk og engelsk.

## Har brug for

- EPUB3 Media Overlays, hvor hvert elements `id` er stabilt, med `nav` i niveauer og `page-list`, og én lydfil pr. EPUB.

## Ejerskab og grænser

- **Offentligt repo:** ingen henvisninger til private repos eller deres indhold, hverken i kode, testdata, dokumenter, commits eller PR'er.
- **Ingen nøgler, ingen persondata.** Credits bruger GitHub-navnet DAKI2501.
- **Den gamle Reader i roden ændres ikke**, mens den nye bygges, bortset fra fejlrettelser.
