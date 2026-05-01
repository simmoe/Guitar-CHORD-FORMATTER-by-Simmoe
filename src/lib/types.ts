import type { Timestamp } from 'firebase/firestore';

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

export type ChordLayout = 'inline' | 'separate';

/**
 * Per-separator override for the rhythm/bass column. Stored as a sparse
 * record keyed by `${lineIndex}:${separatorIndex}` → 'bar' | 'space'.
 * Undefined keys keep the algorithm's qualified guess.
 */
export type BarEdits = Record<string, 'bar' | 'space'>;

export interface SongDoc {
	id: string;
	title: string;
	artist?: string;
	key?: string; // toneart, fx 'A', 'Em'
	capo?: number; // 0–11
	transpose?: number; // halftones, +/−
	rawInput: string; // raw chord+lyric text (UG-format eller paste)
	barsPerLine: 2 | 4 | 8;
	chordLayout: ChordLayout;
	barEdits?: BarEdits;
	/**
	 * Kategorier (koncert-temaer) som sangen er en del af, fx
	 * ["Summertime", "Forår", "Julen"]. Frit-tekst og deles på tværs af
	 * bandets sange — `uniqueCategoriesFromSongs()` udtrækker alle kendte.
	 */
	categories?: string[];
	sourceUrl?: string; // hvis hentet fra Ultimate Guitar
	notes?: string;
	createdBy: string;
	createdAt: Timestamp;
	updatedAt: Timestamp;
	updatedBy?: string;
}

export interface SetlistEntry {
	songId: string;
	keyOverride?: string; // hvis sangen skal i en anden toneart end gemt
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
