# Fællesbandet — sangbog & sætlister

> SvelteKit + Firebase app til Fællesbandets syng-med koncerter.
> Henter sange fra Ultimate Guitar, formatter akkord/tekst, gemmer i en fælles sangbog, og bygger sætlister med PDF-eksport til hele bandet.

## Stack

- **SvelteKit 2 + Svelte 5 (runes)** — moderne, små bundles, hostes som static fra Firebase
- **Firebase** — Auth (Google), Firestore (sangbog + sætlister), Cloud Functions (UG-fetch), Hosting
- **Tailwind v4** — design tokens i `src/app.css`
- Delt Firebase-projekt med `mat-teacher` og `NEXT AI Design Hub` — collections er præfikset `chord_*` for at undgå konflikter

## Kom i gang

```bash
npm install
npm run dev          # SvelteKit dev server på :5173
npm run dev:emu      # Functions emulator
npm run dev:all      # Alt på én gang
```

## Login

Kun medlemmer af Fællesbandet kan logge ind. Listen ligger checked-in i [`src/lib/data/band.ts`](./src/lib/data/band.ts) — tilføj nye medlemmer dér og commit.

## Datamodel (Firestore)

```
chord_users/{uid}                       — profil (oprettes ved første login)
chord_bands/{bandId}                    — band-doc med memberUids
  songs/{songId}                        — sang i sangbogen
  setlists/{setlistId}                  — sætliste med songOrder
```

## Firestore Rules — VIGTIGT

`firestore.rules` deles med mat-teacher og AI Hub i samme Firebase-projekt. Filen i repoet er fuld merged version (alle tre apps' blokke). **Følg [`firestore-rules-safety`](~/.cursor/skills/firestore-rules-safety/SKILL.md)** før hver `firebase deploy --only firestore:rules`:

```bash
node scripts/fetch-live-rules.mjs   # henter live rules → scripts/.live-firestore.rules.txt (gitignored)
diff scripts/.live-firestore.rules.txt firestore.rules
# Hvis kun vores chord_*-blokke skiller sig ud → safe at deploye
firebase deploy --only firestore:rules --project p5-firebase-eebc1
```

## Firebase Functions — VIGTIGT

Firebase-projektet `p5-firebase-eebc1` deles med andre apps og har functions,
som ikke tilhører dette repo. Deploy aldrig alle functions samlet, da Firebase
CLI kan forsøge at slette functions, der ikke findes lokalt.

```bash
# OK: deploy kun denne apps UG-import
firebase deploy --only functions:fetchUgTab

# IKKE OK: kan forsøge at slette andre projekters functions
firebase deploy --only functions
```

## Bootstrap af bandet

Engangs-script der opretter `chord_bands/faellesbandet`-dokumentet med UID'er slået op fra Firebase Auth:

```bash
npm run bootstrap:band
```

Forudsætter `secrets/firebase-adminsdk.json` (symlink eller kopi af mat-teacher's service account — det er samme Firebase-projekt). Idempotent: kan køres igen når nye medlemmer er tilføjet i `src/lib/data/band.ts`.

## Legacy

Den oprindelige rene-HTML-version (single-page chord formatter) ligger i [`legacy/`](./legacy/) som kørbar fallback og inspirationskilde.

## Faser

- [x] **0–1**: SvelteKit-scaffold, Google-login, Firebase-mønstre fra mat-teacher
- [ ] **2**: Cloud Function `fetchUgTab` til Ultimate Guitar-import
- [ ] **3**: Editor-route — port af chord-formatter-logikken til TypeScript
- [ ] **4**: Sangbog (CRUD i Firestore)
- [ ] **5**: Sætliste + drag-reorder
- [ ] **6**: Transponering + capo
- [ ] **7**: Print/PDF-eksport
