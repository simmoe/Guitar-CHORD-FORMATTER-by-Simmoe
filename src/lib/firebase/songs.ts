/**
 * Firestore-helpers til Fællesbandets sangbog.
 *
 * Sange ligger i subcollection `chord_bands/{bandId}/songs/{songId}`. Kategorier
 * er ikke en separat collection — de gemmes som en string[] direkte på
 * sangdokumentet. Vi udleder den unikke kategori-liste på klienten via
 * `uniqueCategoriesFromSongs(...)` så vi ikke skal vedligeholde en sideløbende
 * liste; for ~50–500 sange er det rigeligt hurtigt.
 */
import {
	addDoc,
	collection,
	deleteDoc,
	doc,
	getDoc,
	onSnapshot,
	orderBy,
	query,
	serverTimestamp,
	updateDoc,
	type Unsubscribe
} from 'firebase/firestore';
import { getDb, COL } from './client';
import { BAND } from '$lib/data/band';
import type { SongDoc } from '$lib/types';

function songsCol() {
	return collection(getDb(), COL.bands, BAND.id, COL.songs);
}

function songRef(id: string) {
	return doc(getDb(), COL.bands, BAND.id, COL.songs, id);
}

/** Live-subscribe til alle sange, sorteret efter titel. */
export function subscribeSongs(
	cb: (songs: SongDoc[]) => void,
	onError?: (err: Error) => void
): Unsubscribe {
	const q = query(songsCol(), orderBy('title'));
	return onSnapshot(
		q,
		(snap) => {
			const songs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SongDoc);
			cb(songs);
		},
		(err) => onError?.(err)
	);
}

export async function getSong(id: string): Promise<SongDoc | null> {
	const snap = await getDoc(songRef(id));
	if (!snap.exists()) return null;
	return { id: snap.id, ...snap.data() } as SongDoc;
}

/** Felter der kan sættes ved oprettelse — uden id/timestamps. */
export type NewSongInput = Omit<SongDoc, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export async function createSong(input: NewSongInput, uid: string): Promise<string> {
	const data = {
		...input,
		createdBy: uid,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	};
	const ref = await addDoc(songsCol(), data);
	return ref.id;
}

/** Patch-update — kun de felter der er sat overskrives, plus updatedAt. */
export async function updateSong(
	id: string,
	patch: Partial<Omit<SongDoc, 'id' | 'createdAt' | 'createdBy'>>,
	uid: string
): Promise<void> {
	await updateDoc(songRef(id), {
		...patch,
		updatedBy: uid,
		updatedAt: serverTimestamp()
	});
}

export async function deleteSong(id: string): Promise<void> {
	await deleteDoc(songRef(id));
}
