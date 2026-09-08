# Prata med platser

Webbplats för ett utforskande projekt mellan stadsplanering och offentlig konst,
i Främre Boländerna och Ulleråker i Uppsala. En 3D-scanning (gaussian splat) som
går att navigera och måla på med bläck, plus två textsidor.

**Live:** https://skoteskote.github.io/prata-med-platser/
**Repo:** `skoteskote/prata-med-platser` (public)

Gruppen: Love Antell, Jakob Skote, Rosa Danenberg.
Kontakt: love@loveantell.se · Instagram: @pratamedplatser

---

## Google Drive

Allt projektmaterial ligger i den delade enheten **Projects**, i mappen
`043_PrataMedPlatser`. IDn är med för att slippa leta igen — sökning på titel
fungerar också, men mappnamn upprepas mellan projekt.

| Sökväg | Folder ID |
|---|---|
| `Projects / 043_PrataMedPlatser` | `1d3jVHJ3-u6EMOvwQw9zViN_uKu24qpCG` |
| `… / Docs` | `1ZpdJ-JwUUEfu6fuH04C5csqECbHkrBvN` |
| `… / Docs / Hemsida` | `1QnskqeLceSyYlWxaOcAMtAC6RC7X4Sbd` |
| `… / Docs / Meeting notes` | `1RtXHFtLNpFH5GAPuagJd14M7kJztc_6W` |
| `… / Resources` | `1ENfp_37gj33hi8kaPxdFFaOUNUgmwAVv` |
| `… / Resources / Prata med platser Logo` | `1KX4IBHXLbZtv61UdSaLSXUxu7ZirEqXa` |
| `… / Resources / Skiss hemsida` | `1mW6zJ0V3uiL2mXwdg5Q-k_RHUvGLqyTI` |
| `… / Resources / Karta Främre Boländerna` | `1a4YwYK-b8CKXUpsxM1xKTROUaajS2bfe` |
| `… / Documentation` | `1vN23qaiWq_JuOJA6Bj6RcKcMPi_-bpVY` |

### Filer som hör ihop med sajten

- **`Docs / Hemsida / Hemsida – alla texter`** — doc `1_BOk6gf20p2ZwVFd8cf5HRVz2ZFHAi22k7cvMs_gk8I`.
  Alla sajtens texter, strukturerade så att Love och Rosa kan redigera dem utan
  att öppna kod. **Håll den i synk när text på sajten ändras**, och vice versa.
- **`Resources / Prata med platser Logo / prata-m-platser.jpg`** — fil
  `1aWvPjqQhWeEUPkroUNJt4W4wmhiPRhaO`, 1980×1980. Nuvarande källa för logotypen.
  Samma mapp har en äldre PDF och PSD; jpg-filen är den senaste versionen.

### Fallgropar med Drive-verktygen

- `download_file_content` på en binärfil spränger token-gränsen och sparas i
  stället till en fil på disk. Avkoda därifrån med python (`json` → `base64`),
  läs den aldrig in i kontexten.
- Markdown-**tabeller** blir sönderkonverterade när Drive gör om markdown till
  ett Google-dokument: rubrikraden blir tom och rubrikerna hamnar som literal
  `**text**` i en vanlig rad. Använd punktlistor med fet etikett i stället.
- `update_file` ändrar bara titel och mapp, **inte innehåll**. För att rätta ett
  dokument: skapa nytt och lägg det gamla i papperskorgen.
- Läs alltid tillbaka med `read_file_content` efter att ha skapat ett dokument —
  konverteringen är tyst när den misslyckas.

---

## Bygga och publicera

```sh
cd web-src && npx vite build     # skriver till ../web
```

Push till `main` publicerar automatiskt via `.github/workflows/pages.yml`, som
lägger ut innehållet i `web/`. Tar cirka 20 sekunder.

Titta lokalt:

```sh
cd web && python3 -m http.server 8000
```

`web/` är **byggd utdata men incheckad** — Pages serverar den direkt. Bygg om
och committa både `web-src/` och `web/` i samma commit.

---

## Var saker ligger

- **`web-src/index.html`** — all sidtext, som vanlig HTML. Sajten är på svenska.
- **`web-src/main.js`** — vyaren. Allt som är värt att justera ligger i
  `CONFIG` högst upp: kamera, pivot, dolly, bläck.
- **`web-src/style.css`** — formen. Off-white botten, svart tusch, DM Sans
  (självhostad i `web-src/assets/fonts/`).
- **`web-src/assets/`** — logotyp, bläckstreck, ikoner, typsnitt.
- **`scripts/` + `run.sh`** — pipelinen som gjorde scanningen. Sex steg,
  `./run.sh --list` visar status. Se `REPORT.md` för hela genomgången.
- **Gitignorerat och återskapningsbart:** `input/ frames/ colmap/ splat/ tools/
  web-fallback/` — cirka 3,2 GB.

### Logotypen

Genereras ur Drive-jpg:en med ImageMagick: alfa = inverterad luminans, så
tuschets antialiasade kanter behålls i stället för att få en vit halo.

```sh
magick prata-m-platser.jpg -colorspace gray -negate -level 6%,90% miff:- \
| magick -size 1980x1980 xc:'#141414' - -alpha off -compose CopyOpacity \
  -composite -trim +repage -resize 700x logo.png
```

`-level 6%,90%` städar bort JPEG-bruset i det vita, annars blir bakgrunden en
grå slöja i stället för genomskinlig. Ur samma fil klipps också `ink-rule.png`
(understrykningsstrecket, används som avdelare på textsidorna) och
`favicon.png` (bläckdroppen till vänster — hela logotypen blir gröt vid 32 px).
Kontrollera alltid `maxAlpha` efteråt; alfan tappas lätt i en pipe-kedja.

---

## Att veta

- **Ingen extern värd.** Steg 5 failar bygget om något i utdatan skulle ladda
  från en främmande domän. Typsnittet är därför självhostat. `<a href>` till
  Instagram räknas inte — det är navigering, inte en resurs.
- **Slöjan över scanningen ligger inne i renderingen**, mellan scanningen och
  bläcket (`CONFIG.scanFade`). Som DOM-lager dämpade den bläcket också och gjorde
  svart till grått. DOM-slöjan (`--veil`) används bara på textsidorna, där
  bläcket *ska* tona bort med scanningen.
- **Bläcket är instansierade penselstämplar**, inte gaussians. Spark renderar
  inte en andra `SplatMesh` vars `PackedSplats` startade tom — den initieras,
  rapporterar en generator och ritar ingenting.
- **Scanningen är fortfarande en testscanning av en lagerlokal**, inte
  Boländerna eller Ulleråker. Byts när det finns en riktig platsscanning.
- **Bläcket djuptestas inte** — splats skriver aldrig djup, så det finns inget
  att testa mot. Målningar syns genom väggar om man roterar bakom dem.
