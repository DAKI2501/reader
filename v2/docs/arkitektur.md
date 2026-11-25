# Ny Reader: arkitektur

**Pr.:** 25/11 2026. **Status:** fundament, skal og import af tekst, EPUB og PDF (F0–F2). Faserne står i §5.

En frisk session læser denne fil, kører `cd v2 && node --test` og fortsætter ved første ufærdige fase.

## 1. Hvorfor en ny ved siden af den gamle

Den gamle Reader (repoets rod) er ét script med én global tilstand. Tre ting i bunden af den kan ikke bære det, Readeren nu skal:

1. **Et sted er et ordnummer.** Noter og læseposition peger forkert, når en tekst udtrækkes igen, og kan ikke kobles til id'er fra kilden.
2. **Indholdet har ét niveau** og er enten sider eller kapitler.
3. **Tiden er ord pr. minut.** Lyd har sin egen tid.

Derfor står den gamle urørt og er den, der bruges. Den nye bygges i `v2/` med ny arkitektur; afprøvet logik fra den gamle flyttes ind modul for modul med kilden skrevet i filens hoved. Roden skifter, når den nye kan det samme (F6). Eneste ændring i den gamle er én linje i `sw.js`, så den ikke gemmer filer fra `v2/`.

## 2. Principper

1. **Tre kontrakter bærer alt:** dokument, tidskilde og import (`schema/`).
2. **Readeren kender ikke sine kilder.** Blok-id'er og etiketter er tekststrenge, der føres uændret igennem.
3. **Standardformat ind.** Synkroniseret lyd kommer ind som EPUB3 Media Overlays. `reader-dok/1` er Readerens eget format indadtil.
4. **Intet byggetrin, ingen pakker.** Kilden er ES-moduler, som browseren læser direkte.
5. **Lagdeling, håndhævet af én test:** et modul importerer kun fra sit eget lag eller et lavere. Det, der skal på tværs, gives ind af `app/`.
6. **Ny funktion = nyt modul bag en kontrakt.** En ny stemme er en ny tidskilde, en ny filtype en ny importør, et nyt tempoforløb en ny profil. Kræver den en særregel inde i et andet modul, er kontrakten forkert og rettes dér.
7. **Få tests, de rigtige steder:** det, der kan køre uden browser, testes i Node. Brugerfladen og de importører, der bruger browserens egne fortolkere (EPUB, PDF), prøves ved at bruge dem.

## 3. Lagene

```
app/      binder sammen: vælger tidskilde og visning
views/    tekst på siden, pacer (senere fikspunkter, fraser, RSVP, strøm)
import/   tekst, EPUB, PDF (senere Ψ-OCR)  →  reader-dok/1; nye filtyper meldes ind i import/index.js
sync/     tid ↔ sted, uanset hvor tiderne kom fra
time/     tidskilder: tempo (senere lydfil, enhedens stemme)
store/    tekster, positioner og noter på enheden
core/     dokument, steder, noter – ingen DOM, intet lager
```

## 4. Beslutninger

| # | Beslutning | Hvorfor | Pris eller forbehold |
|---|---|---|---|
| B1 | Ny i `v2/`, gammel urørt, samme repo | §1; samme adresse | To kodebaser, til roden skifter |
| B2 | ES-moduler uden byggetrin | Det, der ligger i repoet, er det, der kører | Kan ikke åbnes som én fil fra disken |
| B3 | Sted = blok-id + ord + citat | Overlever nyt udtræk | Dannede id'er skifter, hvis blokkens første 12 ord ændres; så bruges citatet |
| B4 | Én tidskilde-kontrakt | Tempo, lyd og stemme er ligestillede | Visninger skrives mod kontrakten og melder deres krav |
| B5 | Ord markeres som områder i teksten, ikke som ét element pr. ord | Lange bøger forbliver lette | Kræver CSS Custom Highlight (Safari 17.2+, Chrome 105+) |
| B6 | EPUB3 Media Overlays er eneste vej ind for synkroniseret lyd | Standard; andres filer virker | Readeren markerer kun så fint, som filen er opdelt |
| B7 | Ét `<audio>`-element; én lydfil pr. EPUB | Rapporter om iOS: næste fil kan ikke startes med låst skærm | **Ikke afprøvet.** `proeve/lyd.html` afgør det |
| B8 | Enhedens stemme som ur med sætningspræcision | Gratis, sender intet ud | Ordgrænser er upålidelige i Safari på iOS |
| B9 | Ingen API-nøgler i Readeren | Offentlig browser-app | Lydfiler laves andre steder |
| B10 | Eget lager (`reader2`) | Kan ikke ødelægge den gamles data | Tekster hentes over én gang ved skiftet |

## 5. Faser

| Fase | Indhold | Status |
|---|---|---|
| **F0** Fundament | Kontrakter, kerne, tempo-ur, synkroniseringskort, tekstimport, lydprøve | gjort |
| **F1** Skal | Indsæt eller åbn tekst, læs med pacer, tempo, indhold i niveauer, position, markeringer og noter med eksport | gjort; prøvet i Chrome, ikke på telefon |
| **F2** Import | EPUB (element-id som blok-id, indhold i niveauer, trykte sidetal, ZIP læst stykvis) og PDF (sider, bogmærker som indhold) | gjort; prøvet i Chrome med små prøvefiler. Mangler: overdragelse fra Ψ-OCR |
| **F3** Visninger | Fikspunkter, fraser, RSVP, strøm, fri læsning, én ad gangen | |
| **F4** Enhedens stemme | Andet ur; første prøve på kontrakten | |
| **F5** Lydfil | Tredje ur, Media Overlays, låseskærm, pause ved stopmærker | kræver lydprøvens resultat |
| **F6** Resten og skiftet | Træning, historik, ordbog, nøgleord, offline; flyt biblioteket; skift roden | |

## 6. Hentet fra den gamle Reader

| Fil | Kilde | Ændret |
|---|---|---|
| `src/import/text.js` | `reader @ 1652e0d`, `index.html`, afsnittet "text → document" | Afleverer `reader-dok/1`; linjer med `# ` bliver overskrifter |
| `src/import/zip.js` | samme, `openZip` | Læser stykker af filen i stedet for hele filen |
| `src/import/epub.js` | samme, afsnittet "EPUB" | Beholder id'er; indhold i niveauer; sidetal; blokke med type; tabeller som én blok |
| `src/import/pdf.js` | samme, afsnittet "PDF" (`pageLines`, `assemble`, `readPdf`) | Sider som egen liste; PDF'ens sidenavne og bogmærker bruges |

pdf.js hentes fra `ocr/pdfjs/`, som Ψ-OCR allerede bruger. Der ligger kun én kopi i repoet.

## 7. Åbent

- Lydprøven er ikke kørt på en iPhone (B7).
- Den nye virker ikke offline endnu (F6).
- Uden CSS Custom Highlight vises teksten, men uden markering. Der er ingen reserve.
- Scannede PDF'er afvises med en besked; overdragelsen til og fra Ψ-OCR er ikke flyttet endnu.
- Overskrifter i PDF'er genkendes ikke som overskrifter, kun bogmærker giver indhold.
- Fodnoter i EPUB springes over som i den gamle. ZIP64 (filer over 4 GB) læses ikke.
- EPUB og PDF er kun prøvet med små, hjemmelavede filer, ikke med rigtige bøger.
