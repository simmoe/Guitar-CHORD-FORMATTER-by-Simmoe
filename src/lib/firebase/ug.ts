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

/**
 * Fejl-detaljer som Cloud Function vedhæfter via HttpsError(_, _, details).
 * Klienten bruger dem til at åbne den korrekte UG-side og vise et paste-
 * fallback i stedet for blot at vise en fejlbesked.
 */
export interface UgFetchErrorDetails {
	stage: 'search' | 'tab' | 'no-hits';
	searchUrl?: string;
	tabUrl?: string;
}

export interface UgFetchError extends Error {
	details?: UgFetchErrorDetails;
}

export async function fetchUgTab(query: string): Promise<UgFetchResult> {
	const callable = httpsCallable<{ query: string }, UgFetchResult>(getFns(), 'fetchUgTab');
	const res = await callable({ query });
	return res.data;
}
