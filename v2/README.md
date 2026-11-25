# Ny Reader (under opbygning)

Den nye Reader bygges her, ved siden af den gamle i repoets rod. Den gamle er stadig den, der bruges.

- **Hvorfor og hvordan:** [`docs/arkitektur.md`](docs/arkitektur.md)
- **Kontrakter:** [`schema/dokument.md`](schema/dokument.md), [`schema/noter.md`](schema/noter.md), [`schema/tidskilde.md`](schema/tidskilde.md)
- **Tests:** `cd v2 && node --test` (kræver kun Node, ingen pakker)
- **Lydprøve til iPhone:** [`proeve/lyd.html`](proeve/lyd.html), når grenen er lagt ind: https://daki2501.github.io/reader/v2/proeve/lyd.html

Den kan nu: indsætte tekst eller åbne `.txt`, `.md`, `.epub` og `.pdf`, læse med pacer, springe i indholdet, markere og skrive noter.

Prøv den lokalt fra repoets rod (ikke fra `v2/`, fordi PDF-læseren ligger i `ocr/`): `python3 -m http.server 8000`, og åbn http://localhost:8000/v2/
