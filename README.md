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

`firestore.rules` deles med mat-teacher og AI Hub. **Ros til [`firestore-rules-safety`](~/.cursor/skills/firestore-rules-safety/SKILL.md)** — pull live rules, merge ind, vis diff, godkend, deploy. Vores tilføjelser ligger i [`firestore.rules.additions`](./firestore.rules.additions) som reference.

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
