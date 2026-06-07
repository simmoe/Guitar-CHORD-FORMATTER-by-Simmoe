import {
	onAuthStateChanged,
	signInWithEmailAndPassword,
	signInWithPopup,
	updateProfile,
	GoogleAuthProvider,
	signOut as fbSignOut,
	type User
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebaseAuth, getDb, COL } from './firebase/client';
import { BAND } from './data/band';
import type { UserDoc } from './types';

class AuthState {
	user = $state<User | null>(null);
	profile = $state<UserDoc | null>(null);
	loading = $state(true);
	/** Sat hvis brugeren er logget ind på en konto der IKKE er på band-listen. */
	notAuthorized = $state(false);
	#initialized = false;

	init() {
		if (this.#initialized) return;
		this.#initialized = true;
		const auth = getFirebaseAuth();
		onAuthStateChanged(auth, async (u) => {
			this.user = u;
			this.notAuthorized = false;
			if (u) {
				if (!(await this.#isBandMember(u.uid))) {
					// Logget ind med en ikke-godkendt konto — vis fejlbesked,
					// log ud, og bed brugeren bruge en bandkonto.
					this.notAuthorized = true;
					this.profile = null;
					await fbSignOut(auth);
				} else {
					await this.#ensureProfile(u);
				}
			} else {
				this.profile = null;
			}
			this.loading = false;
		});
	}

	async #isBandMember(uid: string): Promise<boolean> {
		const db = getDb();
		try {
			const snap = await getDoc(doc(db, COL.bands, BAND.id));
			return ((snap.data()?.memberUids ?? []) as string[]).includes(uid);
		} catch (err) {
			console.warn('Kunne ikke validere band-medlemskab:', err);
			return false;
		}
	}

	async #ensureProfile(u: User) {
		const db = getDb();
		const ref = doc(db, COL.users, u.uid);
		const snap = await getDoc(ref);
		if (!snap.exists()) {
			await setDoc(ref, {
				displayName: u.displayName ?? u.email?.split('@')[0] ?? 'Bruger',
				email: u.email ?? '',
				createdAt: serverTimestamp()
			});
		}
		const fresh = await getDoc(ref);
		this.profile = fresh.data() as UserDoc;
	}

	async refreshCurrentProfile() {
		const auth = getFirebaseAuth();
		if (!auth.currentUser) return;
		await auth.currentUser.reload();
		this.user = auth.currentUser;
		await this.#ensureProfile(auth.currentUser);
	}

	async setCurrentDisplayName(displayName: string) {
		const auth = getFirebaseAuth();
		if (!auth.currentUser) return;
		await updateProfile(auth.currentUser, { displayName });
		await this.refreshCurrentProfile();
	}

	async loginEmail(email: string, password: string) {
		const auth = getFirebaseAuth();
		await signInWithEmailAndPassword(auth, email, password);
	}

	async loginGoogle() {
		const auth = getFirebaseAuth();
		const provider = new GoogleAuthProvider();
		await signInWithPopup(auth, provider);
	}

	async signOut() {
		await fbSignOut(getFirebaseAuth());
	}
}

export const authState = new AuthState();
