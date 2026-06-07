/**
 * Fællesbandet Cloud Functions.
 *
 * Region: europe-west1 — matcher klientens getFunctions(app, 'europe-west1').
 * Auth: alle callables kræver at request.auth.uid findes i
 *       chord_bands/faellesbandet.memberUids (samme allowlist som rules).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { defineSecret } from 'firebase-functions/params';
import { initializeApp, getApps } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import nodemailer from 'nodemailer';
import { fetchUg, type UgFetchErrorDetails } from './ug';

if (getApps().length === 0) initializeApp();
setGlobalOptions({ region: 'europe-west1', maxInstances: 5 });

const BAND_ID = 'faellesbandet';
const INVITE_PASSWORD = 'fælles';
const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const SMTP_FROM = defineSecret('SMTP_FROM');

interface BandData {
	name?: string;
	tagline?: string;
	ownerUid?: string;
	ownerEmail?: string;
	memberUids?: string[];
	memberEmails?: string[];
}

interface MemberProfile {
	uid: string;
	displayName: string;
	email: string;
	invitedBy?: string;
}

async function assertBandMember(uid: string | undefined): Promise<{ uid: string; band: BandData }> {
	if (!uid) {
		throw new HttpsError('unauthenticated', 'Du skal være logget ind.');
	}
	const db = getFirestore();
	const snap = await db.collection('chord_bands').doc(BAND_ID).get();
	if (!snap.exists) {
		throw new HttpsError('failed-precondition', 'Band-dokument mangler.');
	}
	const data = snap.data() as BandData;
	if (!data.memberUids?.includes(uid)) {
		throw new HttpsError('permission-denied', 'Kun bandets medlemmer.');
	}
	return { uid, band: data };
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
			const details = (err as { details?: UgFetchErrorDetails }).details;
			throw new HttpsError('internal', msg, details);
		}
	}
);

export const categoryImageDataUrl = onCall<CategoryImageDataUrlRequest>(
	{ memory: '512MiB', timeoutSeconds: 30 },
	async (req) => {
		await assertBandMember(req.auth?.uid);
		const imagePath = (req.data?.imagePath ?? '').toString().trim();
		const allowedPrefix = `chord_bands/${BAND_ID}/categoryImages/`;
		if (!imagePath.startsWith(allowedPrefix)) {
			throw new HttpsError('invalid-argument', 'Ugyldig billedsti.');
		}

		const file = getStorage().bucket('p5-firebase-eebc1.appspot.com').file(imagePath);
		const [exists] = await file.exists();
		if (!exists) {
			throw new HttpsError('not-found', 'Billedet findes ikke.');
		}
		const [metadata] = await file.getMetadata();
		const contentType = metadata.contentType ?? 'image/jpeg';
		if (!contentType.startsWith('image/')) {
			throw new HttpsError('failed-precondition', 'Filen er ikke et billede.');
		}
		const [buffer] = await file.download();
		return {
			dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`
		};
	}
);

interface UpdateMyProfileRequest {
	displayName?: string;
	email?: string;
}

interface InviteBandMemberRequest {
	email: string;
	displayName?: string;
	origin?: string;
}

interface RemoveBandMemberRequest {
	uid: string;
}

interface CategoryImageDataUrlRequest {
	imagePath: string;
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function cleanDisplayName(displayName: string | undefined, email: string): string {
	const cleaned = (displayName ?? '').trim();
	if (cleaned) return cleaned.slice(0, 80);
	return email.split('@')[0] || 'Medlem';
}

function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function ensurePasswordUser(email: string, displayName: string): Promise<UserRecord> {
	const auth = getAuth();
	try {
		const existing = await auth.getUserByEmail(email);
		const patch: { displayName?: string; password?: string; emailVerified?: boolean } = {};
		if (!existing.displayName && displayName) patch.displayName = displayName;
		patch.password = INVITE_PASSWORD;
		if (!existing.emailVerified) patch.emailVerified = true;
		return auth.updateUser(existing.uid, patch);
	} catch (err) {
		const code = (err as { code?: string }).code;
		if (code !== 'auth/user-not-found') throw err;
		return auth.createUser({
			email,
			password: INVITE_PASSWORD,
			displayName,
			emailVerified: true
		});
	}
}

async function upsertMemberProfile(
	uid: string,
	email: string,
	displayName: string,
	inviterUid: string
): Promise<void> {
	const db = getFirestore();
	await db.collection('chord_users').doc(uid).set(
		{
			displayName,
			email,
			invitedAt: FieldValue.serverTimestamp(),
			invitedBy: inviterUid,
			updatedAt: FieldValue.serverTimestamp()
		},
		{ merge: true }
	);
}

function getAppUrl(origin: string | undefined): string {
	const cleaned = (origin ?? '').trim();
	if (/^https?:\/\/[^/]+/i.test(cleaned)) return cleaned;
	return 'https://p5-firebase-eebc1.web.app';
}

async function sendInvitationEmail(
	to: string,
	displayName: string,
	appUrl: string,
	inviterName: string
): Promise<void> {
	const host = SMTP_HOST.value();
	const portRaw = SMTP_PORT.value();
	const user = SMTP_USER.value();
	const pass = SMTP_PASS.value();
	const from = SMTP_FROM.value();
	if (!host || !portRaw || !user || !pass || !from) {
		throw new HttpsError(
			'failed-precondition',
			'Mailafsendelse mangler SMTP-opsætning i Firebase Functions secrets.'
		);
	}
	const port = Number(portRaw);
	if (!Number.isFinite(port)) {
		throw new HttpsError('failed-precondition', 'SMTP_PORT skal være et tal.');
	}
	const transporter = nodemailer.createTransport({
		host,
		port,
		secure: port === 465,
		auth: { user, pass }
	});
	const subject = 'Invitation til Fællesbandets sangbog';
	const text = [
		`Hej ${displayName || to}`,
		'',
		`Du er blevet inviteret til Fællesbandets sangbog${inviterName ? ` af ${inviterName}` : ''}.`,
		'',
		'Log ind her:',
		appUrl,
		'',
		`Email: ${to}`,
		`Adgangskode: ${INVITE_PASSWORD}`,
		'',
		'Vi ses!'
	].join('\n');

	await transporter.sendMail({
		from,
		to,
		subject,
		text
	});
}

export const inviteBandMember = onCall<InviteBandMemberRequest>(
	{ secrets: [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM] },
	async (req) => {
		const { uid: inviterUid } = await assertBandMember(req.auth?.uid);
		const email = normalizeEmail((req.data?.email ?? '').toString());
		if (!isValidEmail(email)) {
			throw new HttpsError('invalid-argument', 'Skriv en gyldig email.');
		}
		const displayName = cleanDisplayName(req.data?.displayName, email);
		const user = await ensurePasswordUser(email, displayName);
		const db = getFirestore();
		await upsertMemberProfile(user.uid, email, displayName, inviterUid);
		await db
			.collection('chord_bands')
			.doc(BAND_ID)
			.set(
				{
					memberUids: FieldValue.arrayUnion(user.uid),
					memberEmails: FieldValue.arrayUnion(email),
					updatedAt: FieldValue.serverTimestamp()
				},
				{ merge: true }
			);

		await sendInvitationEmail(
			email,
			displayName,
			getAppUrl(req.data?.origin),
			req.auth?.token.name?.toString() ?? ''
		);

		return {
			uid: user.uid,
			email,
			displayName
		};
	}
);

export const updateMyProfile = onCall<UpdateMyProfileRequest>(async (req) => {
	const { uid } = await assertBandMember(req.auth?.uid);
	const auth = getAuth();
	const current = await auth.getUser(uid);
	const currentEmail = normalizeEmail(current.email ?? '');
	const nextEmail = normalizeEmail((req.data?.email ?? currentEmail).toString());
	if (!isValidEmail(nextEmail)) {
		throw new HttpsError('invalid-argument', 'Skriv en gyldig email.');
	}
	const nextDisplayName = cleanDisplayName(req.data?.displayName, nextEmail);

	await auth.updateUser(uid, {
		email: nextEmail,
		displayName: nextDisplayName,
		emailVerified: currentEmail === nextEmail ? current.emailVerified : true
	});

	const db = getFirestore();
	await db.collection('chord_users').doc(uid).set(
		{
			displayName: nextDisplayName,
			email: nextEmail,
			updatedAt: FieldValue.serverTimestamp()
		},
		{ merge: true }
	);
	if (currentEmail && currentEmail !== nextEmail) {
		await db
			.collection('chord_bands')
			.doc(BAND_ID)
			.update({
				memberEmails: FieldValue.arrayRemove(currentEmail),
				updatedAt: FieldValue.serverTimestamp()
			});
	}
	await db
		.collection('chord_bands')
		.doc(BAND_ID)
		.set(
			{
				memberEmails: FieldValue.arrayUnion(nextEmail),
				updatedAt: FieldValue.serverTimestamp()
			},
			{ merge: true }
		);

	return {
		uid,
		email: nextEmail,
		displayName: nextDisplayName
	};
});

export const removeBandMember = onCall<RemoveBandMemberRequest>(async (req) => {
	const { uid: requesterUid, band } = await assertBandMember(req.auth?.uid);
	if (band.ownerUid !== requesterUid) {
		throw new HttpsError('permission-denied', 'Kun ejeren kan slette medlemmer.');
	}
	const uid = (req.data?.uid ?? '').toString().trim();
	if (!uid) {
		throw new HttpsError('invalid-argument', 'Medlem mangler.');
	}
	if (uid === requesterUid || uid === band.ownerUid) {
		throw new HttpsError('failed-precondition', 'Du kan ikke slette dig selv som ejer.');
	}
	if (!band.memberUids?.includes(uid)) {
		return { uid, removed: false };
	}

	let email = '';
	try {
		email = normalizeEmail((await getAuth().getUser(uid)).email ?? '');
	} catch {
		const userSnap = await getFirestore().collection('chord_users').doc(uid).get();
		email = normalizeEmail((userSnap.data()?.email ?? '').toString());
	}

	const db = getFirestore();
	await db
		.collection('chord_bands')
		.doc(BAND_ID)
		.update({
			memberUids: FieldValue.arrayRemove(uid),
			...(email ? { memberEmails: FieldValue.arrayRemove(email) } : {}),
			updatedAt: FieldValue.serverTimestamp()
		});
	await db.collection('chord_users').doc(uid).delete();

	return { uid, removed: true };
});

export const listBandMembers = onCall(async (req) => {
	const { uid, band } = await assertBandMember(req.auth?.uid);
	const db = getFirestore();
	const memberUids = band.memberUids ?? [];
	const members = await Promise.all(
		memberUids.map(async (uid): Promise<MemberProfile | null> => {
			const snap = await db.collection('chord_users').doc(uid).get();
			if (snap.exists) {
				const data = snap.data() as Partial<MemberProfile>;
				return {
					uid,
					displayName: data.displayName ?? data.email ?? 'Medlem',
					email: data.email ?? '',
					invitedBy: data.invitedBy
				};
			}
			try {
				const user = await getAuth().getUser(uid);
				return {
					uid,
					displayName: user.displayName ?? user.email ?? 'Medlem',
					email: user.email ?? ''
				};
			} catch {
				return null;
			}
		})
	);
	return {
		canRemoveMembers: band.ownerUid === uid,
		members: members
			.filter((member): member is MemberProfile => member !== null)
			.sort((a, b) => a.displayName.localeCompare(b.displayName, 'da'))
	};
});
