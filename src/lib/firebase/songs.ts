/**
 * Firestore-helpers til Fællesbandets sangbog.
 *
 * Sange ligger i subcollection `chord_bands/{bandId}/songs/{songId}`.
 * Kategorier gemmes som string[] direkte på sangdokumentet — vi udleder
 * den unikke liste på klienten via `uniqueCategoriesFromSongs(...)`.
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
	setDoc,
	serverTimestamp,
	updateDoc,
	type Unsubscribe
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { getDb, getStorageBucket, COL } from './client';
import { BAND } from '$lib/data/band';
import type { CategoryColorMap, CategoryMetaMap, SongDoc } from '$lib/types';
import { decodeHtmlEntities } from '$lib/chordFormatter';
import { migrateSong } from '$lib/migrate';
import type { Row } from '$lib/songParse';

function songsCol() {
	return collection(getDb(), COL.bands, BAND.id, COL.songs);
}

function songRef(id: string) {
	return doc(getDb(), COL.bands, BAND.id, COL.songs, id);
}

function settingsRef(id: string) {
	return doc(getDb(), COL.bands, BAND.id, 'settings', id);
}

/**
 * Renser et SongDoc for HTML-entities ved load og kører migration til
 * seneste skema (v4 — idempotent hvis allerede v4).
 */
function sanitizeSong(s: SongDoc): SongDoc {
	const cleaned: SongDoc = {
		...s,
		title: decodeHtmlEntities(s.title),
		artist: s.artist != null ? decodeHtmlEntities(s.artist) : s.artist,
		key: s.key != null ? decodeHtmlEntities(s.key) : s.key,
		rawInput: decodeHtmlEntities(s.rawInput ?? ''),
		rows: s.rows ? decodeRows(s.rows) : s.rows,
		categories: s.categories?.map((c) => decodeHtmlEntities(c))
	};
	return migrateSong(cleaned);
}

function decodeRows(rows: Row[]): Row[] {
	return rows.map((r) => (r.kind === 'blank' ? r : { ...r, text: decodeHtmlEntities(r.text) }));
}

export function subscribeSongs(
	cb: (songs: SongDoc[]) => void,
	onError?: (err: Error) => void
): Unsubscribe {
	const q = query(songsCol(), orderBy('title'));
	return onSnapshot(
		q,
		(snap) => {
			cb(snap.docs.map((d) => sanitizeSong({ id: d.id, ...d.data() } as SongDoc)));
		},
		(err) => onError?.(err)
	);
}

export async function getSong(id: string): Promise<SongDoc | null> {
	const snap = await getDoc(songRef(id));
	if (!snap.exists()) return null;
	return sanitizeSong({ id: snap.id, ...snap.data() } as SongDoc);
}

/** Felter der kan sættes ved oprettelse — uden id/timestamps. */
export type NewSongInput = Omit<SongDoc, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>;

export async function createSong(input: NewSongInput, uid: string): Promise<string> {
	const ref = await addDoc(songsCol(), {
		...input,
		createdBy: uid,
		createdAt: serverTimestamp(),
		updatedAt: serverTimestamp()
	});
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

export function subscribeCategoryColors(
	cb: (colors: CategoryColorMap) => void,
	onError?: (err: Error) => void
): Unsubscribe {
	return onSnapshot(
		settingsRef('categoryColors'),
		(snap) => cb((snap.data()?.colors ?? {}) as CategoryColorMap),
		(err) => onError?.(err)
	);
}

export async function saveCategoryColors(colors: CategoryColorMap): Promise<void> {
	await setDoc(settingsRef('categoryColors'), { colors }, { merge: true });
}

export function subscribeCategoryMeta(
	cb: (meta: CategoryMetaMap) => void,
	onError?: (err: Error) => void
): Unsubscribe {
	return onSnapshot(
		settingsRef('categoryMeta'),
		(snap) => cb((snap.data()?.meta ?? {}) as CategoryMetaMap),
		(err) => onError?.(err)
	);
}

export async function saveCategoryMeta(meta: CategoryMetaMap): Promise<void> {
	await setDoc(settingsRef('categoryMeta'), { meta }, { merge: true });
}

export async function uploadCategoryImage(
	category: string,
	file: File,
	uid: string
): Promise<{ imageUrl: string; imagePath: string }> {
	const ext = extensionForFile(file);
	const imagePath = `${COL.bands}/${BAND.id}/categoryImages/${uid}/${slugForStorage(category)}-${Date.now()}.${ext}`;
	const storageRef = ref(getStorageBucket(), imagePath);
	await uploadBytes(storageRef, file, {
		contentType: file.type || `image/${ext}`,
		customMetadata: { category }
	});
	const imageUrl = await getDownloadURL(storageRef);
	return { imageUrl, imagePath };
}

export async function deleteCategoryImage(imagePath: string | undefined): Promise<void> {
	if (!imagePath) return;
	await deleteObject(ref(getStorageBucket(), imagePath));
}

function extensionForFile(file: File): string {
	const fromName = file.name.split('.').pop()?.toLowerCase();
	if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
	if (file.type === 'image/png') return 'png';
	if (file.type === 'image/webp') return 'webp';
	return 'jpg';
}

function slugForStorage(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'category';
}
