/**
 * Klient-side wrapper for fetchUgTab Cloud Function.
 * Funktionen ligger i europe-west1 og returnerer parset chord+lyric data
 * fra Ultimate Guitar — enten fra direkte URL eller via UG-søgning.
 */
import { httpsCallable } from 'firebase/functions';
import { getFns } from './client';

export interface UgFetchResult {
	title: string;
	artist: string;
	rawInput: string;
	sourceUrl: string;
	keyGuess?: string;
	tuning?: string;
	capo?: number;
}

export async function fetchUgTab(query: string): Promise<UgFetchResult> {
	const callable = httpsCallable<{ query: string }, UgFetchResult>(getFns(), 'fetchUgTab');
	const res = await callable({ query });
	return res.data;
}
