/**
 * Engangs-bootstrap: opret band-dokumentet i Firestore + sæt initial passwords.
 *
 * Bruger Firebase Admin SDK (omgår client security rules) til at oprette
 * `chord_bands/faellesbandet` med ownerUid + memberUids udfyldt fra Auth.
 *
 * Forudsætninger:
 *  - secrets/firebase-adminsdk.json er på plads (symlink til mat-teacher's
 *    service account er fint — det er samme Firebase-projekt)
 *  - Email/Password sign-in metoden er aktiveret i Firebase Console
 *    (Authentication → Sign-in method → Email/Password)
 *  - Eksisterende Auth-brugere (fx fra mat-teacher-login) genbruges; nye
 *    medlemmer oprettes med en initial password.
 *
 * Brug:
 *    node scripts/bootstrap-band.mjs                    # default password
 *    INIT_PASSWORD="dit-eget-pw" node scripts/...       # custom password
 *
 * Idempotent: scriptet er sikkert at køre flere gange — det sletter ikke
 * eksisterende data og rører ikke passwords for brugere der allerede er
 * oprettet (medmindre du sætter FORCE_RESET_PASSWORD=1).
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

const initPassword = process.env.INIT_PASSWORD ?? 'faelles';
const forceResetPassword = process.env.FORCE_RESET_PASSWORD === '1';

console.log(`\n🔑 Initial password: "${initPassword}"`);
if (forceResetPassword) console.log('   (FORCE_RESET_PASSWORD=1 — alle passwords nulstilles)');

// Slå hvert medlems UID op i Firebase Auth — opret hvis de mangler.
const memberUids = [];
const memberEmails = [];
const passwordChanges = [];
let ownerUid = null;
let ownerEmail = null;

for (const member of meta.members) {
	let userRecord;
	let isNew = false;
	try {
		userRecord = await auth.getUserByEmail(member.email);
	} catch (err) {
		if (err.code !== 'auth/user-not-found') {
			console.error(`   ✗ ${member.email}: ${err.message}`);
			continue;
		}
		// Opret ny Auth-bruger med initial password
		try {
			userRecord = await auth.createUser({
				email: member.email,
				password: initPassword,
				displayName: member.displayName,
				emailVerified: true
			});
			isNew = true;
			passwordChanges.push({ email: member.email, status: 'created' });
		} catch (createErr) {
			console.error(`   ✗ Kunne ikke oprette ${member.email}: ${createErr.message}`);
			continue;
		}
	}

	// Hvis bruger findes uden password-provider (fx kun signed in via Google),
	// tilføj et initial password så de også kan email/password-logge ind.
	const hasPassword = userRecord.providerData?.some((p) => p.providerId === 'password') ?? false;
	if (!isNew && (!hasPassword || forceResetPassword)) {
		try {
			await auth.updateUser(userRecord.uid, { password: initPassword });
			passwordChanges.push({
				email: member.email,
				status: hasPassword ? 'reset' : 'password-added'
			});
		} catch (updErr) {
			console.error(`   ✗ Kunne ikke sætte password for ${member.email}: ${updErr.message}`);
		}
	}

	memberUids.push(userRecord.uid);
	memberEmails.push(member.email);
	if (member.role === 'owner') {
		ownerUid = userRecord.uid;
		ownerEmail = member.email;
	}
	const status = isNew ? '🆕 oprettet' : '✓ findes';
	console.log(`   ${status} ${member.email} → uid ${userRecord.uid}`);
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

if (passwordChanges.length > 0) {
	console.log(`\n📬 Email/password-konti:`);
	for (const c of passwordChanges) {
		console.log(`   · ${c.email} — ${c.status} med password "${initPassword}"`);
	}
	console.log(`   Bed medlemmer skifte adgangskode efter første login.`);
}

console.log('\n🎉 Bootstrap færdig.');
process.exit(0);
