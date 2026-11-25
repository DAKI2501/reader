# Til agenter i dette repo

**Læs først:** `PROJEKT.md`, derefter `v2/docs/arkitektur.md`. Kør `cd v2 && node --test` før og efter en ændring i `v2/src/`.

**Regler i `v2/`:**
- Hold det enkelt. Ny funktion er et nyt modul bag en af de tre kontrakter (dokument, tidskilde, import). Kræver den en særregel inde i et andet modul, så ret kontrakten og skriv det i arkitekturen.
- Et modul importerer kun fra sit eget lag eller et lavere. Ingen pakker udefra, intet byggetrin.
- Kode flyttet fra den gamle Reader får kilden `reader @ commit` i filens hoved og i arkitekturens §6.
- Test kernen (`core/`, `sync/`, `time/`, `import/`), ikke brugerfladen. Få tests, der hver siger én ting.

**Aldrig:**
- Ret aldrig i den gamle Reader (`index.html`, `ocr.html`, `ocr/`, `sw.js`) som led i arbejdet på den nye.
- Repoet er offentligt: ingen henvisninger til private repos eller deres indhold, heller ikke i commits og PR'er. Ingen nøgler eller persondata.
