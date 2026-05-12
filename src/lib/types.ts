import type { Timestamp } from 'firebase/firestore';
import type { Row } from './songParse';

export type Role = 'owner' | 'member';

export interface UserDoc {
	displayName: string;
	email: string;
	createdAt: Timestamp;
}

export interface BandDoc {
	id: string;
	name: string;
	tagline?: string;
	memberUids: string[];
	memberEmails: string[];
	createdAt: Timestamp;
}

/**
 * Bass-linjen for hver chord-row, gemt præcis som brugeren har skrevet
 * den (typisk pipe-notation, fx `"Gm | Bb C"`). Key er chord-rækkens
 * rowIndex som streng. Tom/ikke-sat = tom celle. Dette er den ENESTE
 * kilde til bass-data — vi auto-genererer ingenting længere.
 */
export type BassLines = Record<string, string>;

/**
 * Sektioner (Verse, Chorus, …) brugeren har klappet sammen. Identificeret
 * via headerens 0-baserede index i sangens header-liste.
 */
export type CollapsedSections = number[];

export interface SongDoc {
	id: string;
	title: string;
	artist?: string;
	key?: string;
	capo?: number;
	transpose?: number;
	rawInput: string;
	/**
	 * Strukturerede rækker. Kanonisk fra v4 og frem — brugerens type-valg
	 * (chord/lyric/header/blank) per række persisteres her i stedet for
	 * at blive heuristisk udledt fra `rawInput` ved hver load.
	 *
	 * `rawInput` bevares som læsbar fallback / søge-felt og holdes i
	 * sync med `serializeRows(rows)` ved hvert save.
	 */
	rows?: Row[];
	barsPerLine: 2 | 4 | 8;
	bassLines?: BassLines;
	collapsedSections?: CollapsedSections;
	categories?: string[];
	sourceUrl?: string;
	notes?: string;
	/**
	 * Skema-version.
	 * - v3 = ren WYSIWYG: chord-linjen er literal, bass-linjen er kun
	 *   det brugeren har skrevet. Migreres fra v1/v2 i `migrateToV3`.
	 * - v4 = `rows: Row[]` er kanonisk; brugerens kind-valg per række
	 *   bevares. `rawInput` er nu læsbar fallback. Migreres fra v3 i
	 *   `migrateToV4` (`src/lib/migrate.ts`).
	 */
	schemaVersion?: number;
	createdBy: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	updatedBy?: string;
}

export interface SetlistEntry {
	songId: string;
	keyOverride?: string;
	transposeOverride?: number;
	notes?: string;
}

export interface SetlistDoc {
	id: string;
	name: string;
	gigDate?: Timestamp;
	venue?: string;
	songs: SetlistEntry[];
	createdBy: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
}
