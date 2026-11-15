# Ψ-reader (Psy-reader) – træn hurtiglæsning

Et studieredskab til hurtiglæsning i én enkelt HTML-fil: træn din læsehastighed, eller stream en lang tekst på telefonen. Den kører i browseren, også uden internet, og gemmer intet andre steder end på din egen enhed.

**Åbn den her:** https://daki2501.github.io/reader/

På telefonen kan den lægges på hjemmeskærmen (iPhone: Safari → Del → Føj til hjemmeskærm). Efter første åbning virker den også uden internet; kun ordbogsopslag kræver net.

**Hent filen:** Hele appen er filen [`index.html`](index.html). Download den, og åbn den i en browser på computeren eller på Android (Chrome). På iPhone skal den åbnes via adressen ovenfor.

## Hvad den kan

- **Teknikker:** pacer med pen og indrykning, fikspunkter med lodrette streger, fraser, RSVP og fri læsning med måling af din hastighed.
- **Tempo og tid:** skyder fra 50 til 2000 ord/min, timer, stigende tempo og sprint-intervaller, jævn rulning og tid tilbage.
- **Tekster:** indsæt tekst, eller åbn PDF, EPUB eller tekstfiler. Kopibeskyttede e-bøger (DRM) kan ikke åbnes.
- **Overblik:** nøgleord med ordpar, opslag i engelsk ordbog, tilstand uden stopord og indholdsfortegnelse for bøger.
- **Træning:** et program i seks trin bygget over Tim Ferriss' PX-protokol, Schulte-tabel som opvarmning og historik med forståelse og effektiv hastighed.
- **Telefon:** betjening i bunden af skærmen, tryk for at pause og opslag ved tryk på et ord.
- **Historik og noter:** dine tekster gemmes på enheden, så du kan fortsætte, hvor du slap. Skriv noter ved det sted, du læser (tasten M), og hent dem som tekstfil.

## Ψ-OCR – tekstgenkendelse

**Åbn den her:** https://daki2501.github.io/reader/ocr.html (eller via menuen i Ψ-reader)

Gør scannede bøger, fotos af sider og skærmbilleder til tekst på dansk og engelsk. Alt sker i browseren; filerne forlader ikke din enhed.

- **Tager næsten alt:** PDF (også blandet scannet og almindelig), JPG, PNG, TIFF med flere sider, WebP, GIF, BMP, HEIC i Safari, ZIP/CBZ med sider og Word-, OpenDocument- og PowerPoint-filer med indscannede billeder. Skærmbilleder kan indsættes med Ctrl+V, og på telefonen kan du fotografere siderne.
- **Retter siderne op:** finder selv sider, der ligger ned eller står på hovedet, retter skæve scanninger, fjerner mørke kanter og skygger og deler opslag med to sider.
- **Rydder teksten op:** fjerner sidetal og gentagne sidehoveder, samler orddeling ved linjeskift, finder overskrifter og fodnoter, samler afsnit hen over sideskift og husker bogens egne sidetal.
- **Korrektur:** se hver side ved siden af teksten med usikre ord understreget, og ret direkte. Drej en side selv, hvis det automatiske valg er forkert.
- **Resultat:** læs direkte i Ψ-reader, eller hent en søgbar PDF, en e-bog (EPUB) med sidetal eller ren tekst.

Første gang hentes sprogmodellerne (ca. 8 MB); derefter virker Ψ-OCR også uden internet.

Under *Om teknikkerne* i appen står, hvad forskningen siger om hver teknik, med kilder.

## Credits

Lavet af [DAKI2501](https://github.com/DAKI2501) og Claude, 2026.

Freeware: må bruges, kopieres og deles gratis. Se [LICENSE.txt](LICENSE.txt).

PDF-læsning med [pdf.js](https://mozilla.github.io/pdf.js/) fra Mozilla (Apache 2.0-licens; licensnoten står i koden i `index.html`). Tekstgenkendelse med [Tesseract](https://github.com/tesseract-ocr/tesseract) via [tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), PDF-skrivning med [pdf-lib](https://pdf-lib.js.org/) (MIT) og TIFF-læsning med [UTIF.js](https://github.com/photopea/UTIF.js) (MIT); se [ocr/LICENSES.txt](ocr/LICENSES.txt). Ordbogsopslag via [Free Dictionary API](https://dictionaryapi.dev/) med data fra Wiktionary (CC BY-SA).
