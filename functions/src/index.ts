/**
 * Fællesbandet Cloud Functions.
 *
 * Region: europe-west1 — matcher klientens getFunctions(app, 'europe-west1').
 * Auth: alle callables kræver at request.auth.uid findes i
 *       chord_bands/faellesbandet.memberUids (samme allowlist som rules).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { fetchUg } from './ug';

if (getApps().length === 0) initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

const BAND_ID = 'faellesbandet';

async function assertBandMember(uid: string | undefined): Promise<void> {
	if (!uid) {
		throw new HttpsError('unauthenticated', 'Du skal være logget ind.');
	}
	const db = getFirestore();
	const snap = await db.collection('chord_bands').doc(BAND_ID).get();
	if (!snap.exists) {
		throw new HttpsError('failed-precondition', 'Band-dokument mangler.');
	}
	const data = snap.data() as { memberUids?: string[] };
	if (!data.memberUids?.includes(uid)) {
		throw new HttpsError('permission-denied', 'Kun bandets medlemmer.');
	}
}

interface FetchUgRequest {
	query: string;
}

export const fetchUgTab = onCall<FetchUgRequest>(
	{ timeoutSeconds: 30, memory: '256MiB' },
	async (req) => {
		await assertBandMember(req.auth?.uid);
		const query = (req.data?.query ?? '').toString().trim();
		if (!query) {
			throw new HttpsError('invalid-argument', 'Query er tom.');
		}
		try {
			const result = await fetchUg(query);
			return result;
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Ukendt fejl';
			throw new HttpsError('internal', msg);
		}
	}
);
