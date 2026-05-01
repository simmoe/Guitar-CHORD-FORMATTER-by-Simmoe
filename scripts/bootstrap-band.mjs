/**
 * Engangs-bootstrap: opret band-dokumentet i Firestore.
 *
 * Bruger Firebase Admin SDK (omgår client security rules) til at oprette
 * `chord_bands/faellesbandet` med ownerUid + memberUids udfyldt fra Auth.
 *
 * Forudsætninger:
 *  - secrets/firebase-adminsdk.json er på plads (symlink til mat-teacher's
 *    service account er fint — det er samme Firebase-projekt)
 *  - Hvert band-medlem skal allerede være oprettet som Firebase Auth-bruger
 *    (de har som regel logget ind på en anden app i samme projekt før, fx
 *    mat-teacher). Hvis ikke, springer scriptet dem over og logger advarslen
 *    — du kan køre scriptet igen efter de første gang har logget ind.
 *
 * Brug:
 *    node scripts/bootstrap-band.mjs
 *
 * Idempotent: scriptet er sikkert at køre flere gange — det sletter ikke
 * eksisterende data, men opdaterer memberUids/memberEmails, så nye
 * medlemmer i src/lib/data/band.ts kommer ind hver gang.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const keyPath = resolve(root, 'secrets/firebase-adminsdk.json');
let serviceAccount;
try {
	serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
} catch (err) {
	console.error('❌ Kunne ikke læse service account fra:', keyPath);
	console.error('   ', err.message);
	process.exit(1);
}

admin.initializeApp({
	credential: admin.credential.cert(serviceAccount),
	projectId: serviceAccount.project_id
});

const db = admin.firestore();
const auth = admin.auth();

// Læs band-meta direkte fra src/lib/data/band.ts (parser bare de string-felter
// vi har brug for — undgår build-step for et engangs-script).
function parseBandMeta() {
	const src = readFileSync(resolve(root, 'src/lib/data/band.ts'), 'utf8');
	const idMatch = src.match(/id:\s*['"]([^'"]+)['"]/);
	const nameMatch = src.match(/name:\s*['"]([^'"]+)['"]/);
	const taglineMatch = src.match(/tagline:\s*['"]([^'"]+)['"]/);
	const memberRegex = /\{\s*email:\s*['"]([^'"]+)['"][^}]*displayName:\s*['"]([^'"]+)['"][^}]*role:\s*['"]([^'"]+)['"]/g;
	const members = [];
	let m;
	while ((m = memberRegex.exec(src)) !== null) {
		members.push({ email: m[1], displayName: m[2], role: m[3] });
	}
	return {
		id: idMatch?.[1],
		name: nameMatch?.[1],
		tagline: taglineMatch?.[1],
		members
	};
}

const meta = parseBandMeta();
if (!meta.id || !meta.name || meta.members.length === 0) {
	console.error('❌ Kunne ikke parse band-meta fra src/lib/data/band.ts');
	console.error('   Kontrollér at filen indeholder id, name, og mindst et member.');
	process.exit(1);
}

console.log(`🎸 Bootstrap'er band: ${meta.name} (${meta.id})`);
console.log(`   ${meta.members.length} medlem(mer) i listen:`);
for (const m of meta.members) {
	console.log(`   · ${m.email}  (${m.displayName}, ${m.role})`);
}

// Slå hvert medlems UID op i Firebase Auth.
const memberUids = [];
const memberEmails = [];
let ownerUid = null;
let ownerEmail = null;

for (const member of meta.members) {
	try {
		const userRecord = await auth.getUserByEmail(member.email);
		memberUids.push(userRecord.uid);
		memberEmails.push(member.email);
		if (member.role === 'owner') {
			ownerUid = userRecord.uid;
			ownerEmail = member.email;
		}
		console.log(`   ✓ ${member.email} → uid ${userRecord.uid}`);
	} catch (err) {
		if (err.code === 'auth/user-not-found') {
			console.warn(
				`   ⚠ ${member.email} har ikke en Firebase Auth-bruger endnu — ` +
					`bed dem logge ind én gang og kør scriptet igen.`
			);
		} else {
			console.error(`   ✗ ${member.email}: ${err.message}`);
		}
	}
}

if (!ownerUid) {
	console.error('\n❌ Ingen owner kunne findes i Auth — kan ikke fortsætte.');
	console.error('   Sørg for at "owner"-medlemmet i band.ts har en eksisterende Auth-bruger.');
	process.exit(1);
}

// Opret eller opdater band-dokumentet.
const bandRef = db.collection('chord_bands').doc(meta.id);
const existing = await bandRef.get();

const payload = {
	name: meta.name,
	tagline: meta.tagline ?? '',
	ownerUid,
	ownerEmail,
	memberUids,
	memberEmails,
	updatedAt: admin.firestore.FieldValue.serverTimestamp()
};

if (existing.exists) {
	await bandRef.set(payload, { merge: true });
	console.log(`\n✅ chord_bands/${meta.id} opdateret (memberUids: ${memberUids.length}).`);
} else {
	await bandRef.set({
		...payload,
		createdAt: admin.firestore.FieldValue.serverTimestamp()
	});
	console.log(`\n✅ chord_bands/${meta.id} oprettet.`);
}

// Sørg også for at hvert medlems chord_users-doc eksisterer (samme info som
// auth.svelte.ts ville oprette på første login — vi forskudsoprettelser så
// reglerne kan bruges fra start).
let userDocsCreated = 0;
for (let i = 0; i < memberUids.length; i++) {
	const uid = memberUids[i];
	const member = meta.members.find((m) => m.email === memberEmails[i]);
	if (!member) continue;
	const userRef = db.collection('chord_users').doc(uid);
	const userSnap = await userRef.get();
	if (!userSnap.exists) {
		await userRef.set({
			displayName: member.displayName,
			email: member.email,
			createdAt: admin.firestore.FieldValue.serverTimestamp()
		});
		userDocsCreated++;
	}
}
if (userDocsCreated > 0) {
	console.log(`✅ ${userDocsCreated} bruger-doc(s) oprettet i chord_users/.`);
}

console.log('\n🎉 Bootstrap færdig.');
process.exit(0);
