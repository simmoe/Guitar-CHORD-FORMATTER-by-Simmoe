# AGENTS.md

## Cursor Cloud specific instructions

SvelteKit 2 + Svelte 5 (runes) + Firebase static app ("Fællesbandet" songbook). Standard scripts live in `package.json` (`dev`, `check`, `build`, `dev:emu`, `dev:all`) and `functions/package.json` (`build`); setup/deploy notes are in `README.md`. Notes below cover only non-obvious things.

### Services / how to run
- Web (SvelteKit dev): `npm run dev` → http://localhost:5173. This is the main app.
- Cloud Functions: TypeScript in `functions/` (built with `tsc` → `functions/lib`). Run against the emulator with `npm run dev:emu`, or everything at once with `npm run dev:all`.
- Firebase emulators require `firebase-tools` (installed globally under `~/.npm-global`, which is on `PATH` via `~/.bashrc`) and Java (already present). If `firebase` is missing, reinstall with `npm install -g firebase-tools`.

### Firebase config & emulators (important)
- The Firebase **web** config is hardcoded and public in `src/lib/firebase/client.ts` — there is no `.env` to create.
- By default local dev talks to the **deployed (production)** Firebase project `p5-firebase-eebc1`, not emulators. To use local emulators, add a query param to the URL: `?fullEmu` routes Auth + Firestore + Functions + Storage to emulators; `?emu` routes only Functions. The choice is read once at first page load and the Firebase singletons are cached, so keep `?fullEmu` on the **first** URL you open — later client-side navigations that drop the query string stay on the emulators.
- Emulator ports (see `firebase.json`): Auth 9099, Firestore 8080, Functions 5001, Storage 9199, Emulator UI 4000. Start a subset with e.g. `firebase emulators:start --only auth,firestore --project p5-firebase-eebc1`.

### Login / auth (important for end-to-end testing)
- Login is gated: a user can only sign in if their `uid` is in `chord_bands/faellesbandet.memberUids` (checked client-side in `auth.svelte.ts` and enforced by `firestore.rules`). A logged-in non-member is immediately signed out.
- Against **emulators**, seed a member before logging in: create an Auth user and a `chord_bands/faellesbandet` doc whose `memberUids`/`ownerUid` contain that user's uid (use `firebase-admin` with `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`, `projectId: 'p5-firebase-eebc1'`). Then log in via the email/password form at `/login?fullEmu`. Songs are created client-side in Firestore (`chord_bands/faellesbandet/songs`).
- Against **production** Firebase, login needs a real Google/allowlisted band account — not available in the cloud VM, so prefer the emulator + seed flow for testing.

### Deploy safety (see README for details)
- `p5-firebase-eebc1` is shared with other apps. Never run `firebase deploy --only functions` or a broad functions/rules deploy — scope deploys (e.g. `firebase deploy --only functions:fetchUgTab`). This repo's collections are prefixed `chord_*`.
