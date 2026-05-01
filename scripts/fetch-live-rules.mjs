/**
 * Henter de aktuelt deployerede Firestore-rules fra Firebase Rules REST API.
 *
 * Påkrævet af firestore-rules-safety-skill'en: vi må aldrig deploye uden
 * først at have set hvad der ligger live, så ingen anden app i samme
 * Firebase-projekt får deres rules slettet.
 *
 * Output skrives til scripts/.live-firestore.rules.txt (gitignored) så vi
 * kan diffe mod vores ønskede merged version.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import admin from 'firebase-admin';
import { GoogleAuth } from 'google-auth-library';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const keyPath = resolve(root, 'secrets/firebase-adminsdk.json');
const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
const projectId = serviceAccount.project_id;

if (!admin.apps.length) {
	admin.initializeApp({
		credential: admin.credential.cert(serviceAccount),
		projectId
	});
}

const auth = new GoogleAuth({
	credentials: serviceAccount,
	scopes: ['https://www.googleapis.com/auth/firebase']
});

const client = await auth.getClient();
const tokenResp = await client.getAccessToken();
const accessToken = tokenResp.token;

// 1. Find aktuel release for cloud.firestore
const releaseRes = await fetch(
	`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`,
	{ headers: { Authorization: `Bearer ${accessToken}` } }
);
if (!releaseRes.ok) {
	console.error('Kunne ikke hente release:', releaseRes.status, await releaseRes.text());
	process.exit(1);
}
const release = await releaseRes.json();
const rulesetName = release.rulesetName;
console.log(`📜 Aktiv ruleset: ${rulesetName}`);

// 2. Hent ruleset-indhold
const rulesetRes = await fetch(
	`https://firebaserules.googleapis.com/v1/${rulesetName}`,
	{ headers: { Authorization: `Bearer ${accessToken}` } }
);
if (!rulesetRes.ok) {
	console.error('Kunne ikke hente ruleset:', rulesetRes.status, await rulesetRes.text());
	process.exit(1);
}
const ruleset = await rulesetRes.json();

const files = ruleset.source?.files ?? [];
if (files.length === 0) {
	console.error('Ruleset uden filer — uventet.');
	process.exit(1);
}

const outDir = resolve(root, 'scripts');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, '.live-firestore.rules.txt');

const combined = files
	.map((f) => `// ===== ${f.name} =====\n${f.content}`)
	.join('\n\n');

writeFileSync(outPath, combined);
console.log(`✅ Live rules gemt i ${outPath} (${combined.length} bytes)`);
console.log(`\n--- BEGIN LIVE RULES ---\n${combined}\n--- END LIVE RULES ---`);

process.exit(0);
