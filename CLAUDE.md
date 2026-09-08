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

### Kartan (`/map/`)

Ett dolt arbetsverktyg för workshops som körs digitalt: samma bläckpensel, men
på kartan i stället för på scanningen. Ligger som **egen sida**, inte som en
route i vyaren, så att den aldrig drar in three.js eller den 30 MB stora
splatten. Länkas inte från menyn och är `noindex`.

- **`web-src/brush.js`** — penseln. Delas av vyaren (3D, stämplar som
  instansierade quads) och kartan (2D, stämplar rakt på en canvas).
  Renderarna har inget gemensamt; penselkänslan har det. Ändra den här, så
  följer båda med.
- **`web-src/map/`** — sidan. `map.js` ritar och exporterar PDF, `sync.js`
  sköter delningen, `firebase-config.js` innehåller nycklarna.
- Ett streck är en platt `[x, y, bredd, …]`-array i **kartbredder** — båda
  axlarna delas med bredden, så en cirkel förblir en cirkel oavsett skärm.
  Det är streck som skickas över nätet och som PDF:en byggs om från, aldrig
  pixlar.
- Slumpen i penseln (torra hopp, stänk) är **seedad per streck-id**, så alla
  deltagares skärmar och PDF:en ritar exakt samma bläck.
- PDF:en byggs för hand — ett PDF-bibliotek hade varit ~350 kB för en knapp.
  En ensidig PDF med en JPEG är ett litet, väl upptrampat hörn av formatet.
  Sidan är A2 liggande (1683,78 × 1190,55 pt) för att matcha den tryckta
  kartan. Kontrollera med `qpdf --check` och `pdfinfo` efter ändringar.
- **Zoom och panorering** ligger som en transform, inte som CSS-skalning av
  canvasen: strecken ritas om i den nya skalan, så bläcket är lika skarpt vid
  8x som vid anpassad vy. Nyp (ctrl+hjul) zoomar, tvåfingerskroll panorerar,
  mellanslag eller mittenknappen drar. Vyn läcker inte in i PDF:en — den
  byggs alltid från hela arket.
- Kartbilderna kommer från `Resources / Karta Främre Boländerna`. Skärmversion
  som webp (~160 kB), tryckversion som jpg (4200 px = 180 dpi) som bara hämtas
  när någon trycker Spara.

### Slå på delningen

Kartan fungerar utan Firebase — man ritar, ångrar och sparar PDF, men ser inga
andra. För att koppla in delning:

1. Skapa ett gratisprojekt på [console.firebase.google.com](https://console.firebase.google.com).
2. Lägg till en **Realtime Database** (välj `europe-west1`). Det är först då
   `databaseURL` dyker upp.
3. Klistra in **`firebase/database.rules.json`** i Rules-fliken, eller kör
   `firebase deploy --only database` från `firebase/`.
4. Kopiera webb-konfigurationen till `web-src/map/firebase-config.js`, bygg om.

### Testa delningen utan projekt

Hela nätverksdelen går att köra lokalt, med riktiga regler och riktig databas:

```sh
cd firebase && firebase emulators:start --only database --project demo-prata
```

Peka sedan `firebase-config.js` mot emulatorn och bygg om:

```js
export const FIREBASE_CONFIG = {
  apiKey: "demo",
  projectId: "demo-prata",
  databaseURL: "https://demo-prata-default-rtdb.firebaseio.com",
  emulator: { host: "127.0.0.1", port: 9000 },
};
```

Öppna `/map/?rum=test` i två flikar. Så verifierades live-synk, sen anslutning,
närvaroräkning, ångra och rensa innan något Firebase-projekt fanns. **Ställ
tillbaka till `null` innan commit.** Reglerna testas snabbast med curl mot
`http://127.0.0.1:9000/…json?ns=demo-prata-default-rtdb`.

Konfigurationen är **inte hemlig** — en Firebase web-config identifierar
projektet, den ger ingen behörighet. Det är databasreglerna som skyddar datan.
Gratisnivån tar 100 samtidiga anslutningar och **somnar inte** vid inaktivitet,
vilket var skälet att välja den framför Supabase: workshops ligger utspridda
över månader.

Vem som helst med länken kan rita och rensa. Det är medvetet för ett dolt
verktyg — men det är värt att veta innan länken sprids.

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
