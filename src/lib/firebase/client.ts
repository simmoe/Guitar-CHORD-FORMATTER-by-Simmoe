import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, type Firestore } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator, type Functions } from 'firebase/functions';
import { browser } from '$app/environment';

/**
 * Lokal udvikling rammer som default de **deployerede** Firebase-services — så vi
 * ikke kræver kørende emulator for at appen virker.
 *
 * Opt-in:
 *  ?emu     → kun Functions går mod emulator (port 5001).
 *  ?fullEmu → Auth, Firestore og Functions går alle mod emulator.
 */
const isLocal =
	browser && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const useFunctionsEmu = isLocal && location.search.includes('emu');
const useFullEmu = isLocal && location.search.includes('fullEmu');

// Public Firebase web config — disse værdier er sikre at sende til klienten.
// Rigtige hemmeligheder ligger i Cloud Functions Secrets, ikke her.
// Samme projekt som mat-teacher / NEXT AI Design Hub — vi bruger blot
// chord_*-præfikser på vores collections så apperne ikke konflikter.
const firebaseConfig = {
	apiKey: 'AIzaSyDU1QQ5IOx65YauKjemsexCpfgNBblrQRc',
	authDomain: 'p5-firebase-eebc1.firebaseapp.com',
	projectId: 'p5-firebase-eebc1',
	storageBucket: 'p5-firebase-eebc1.appspot.com',
	messagingSenderId: '757530790495',
	appId: '1:757530790495:web:3b63a4a12d2afdad97e9ea'
};

let _app: FirebaseApp | undefined;
let _auth: Auth | undefined;
let _db: Firestore | undefined;
let _functions: Functions | undefined;

export function getFirebaseApp(): FirebaseApp {
	if (_app) return _app;
	_app = getApps()[0] ?? initializeApp(firebaseConfig);
	return _app;
}

export function getFirebaseAuth(): Auth {
	if (_auth) return _auth;
	_auth = getAuth(getFirebaseApp());
	if (useFullEmu) {
		connectAuthEmulator(_auth, 'http://localhost:9099', { disableWarnings: true });
	}
	return _auth;
}

export function getDb(): Firestore {
	if (_db) return _db;
	_db = getFirestore(getFirebaseApp());
	if (useFullEmu) {
		connectFirestoreEmulator(_db, 'localhost', 8080);
	}
	return _db;
}

export function getFns(): Functions {
	if (_functions) return _functions;
	_functions = getFunctions(getFirebaseApp(), 'europe-west1');
	if (useFunctionsEmu || useFullEmu) {
		connectFunctionsEmulator(_functions, 'localhost', 5001);
	}
	return _functions;
}

/**
 * Collection-præfiks så appen kan sameksistere med mat-teacher / aihub
 * i samme Firebase-projekt uden konflikter.
 */
export const COL = {
	users: 'chord_users',
	bands: 'chord_bands',
	songs: 'songs', // subcollection under chord_bands/{bandId}
	setlists: 'setlists' // subcollection under chord_bands/{bandId}
} as const;
