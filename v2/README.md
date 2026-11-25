# Ny Reader (under opbygning)

Den nye Reader bygges her, ved siden af den gamle i repoets rod. Den gamle er stadig den, der bruges.

- **Hvorfor og hvordan:** [`docs/arkitektur.md`](docs/arkitektur.md)
- **Kontrakter:** [`schema/dokument.md`](schema/dokument.md), [`schema/noter.md`](schema/noter.md), [`schema/tidskilde.md`](schema/tidskilde.md)
- **Tests:** `cd v2 && node --test` (kræver kun Node, ingen pakker)
- **Lydprøve til iPhone:** [`proeve/lyd.html`](proeve/lyd.html), når grenen er lagt ind: https://daki2501.github.io/reader/v2/proeve/lyd.html

Første skal virker: indsæt eller åbn en tekst, læs med pacer, spring i indholdet, markér og skriv noter. Åbnes på https://daki2501.github.io/reader/v2/ (kræver en webserver; lokalt: `python3 -m http.server` i `v2/`).
