import {
	onAuthStateChanged,
	signInWithPopup,
	GoogleAuthProvider,
	signOut as fbSignOut,
	type User
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebaseAuth, getDb, COL } from './firebase/client';
import { isBandMemberEmail, getBandMember } from './data/band';
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
				if (!isBandMemberEmail(u.email)) {
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

	async #ensureProfile(u: User) {
		const db = getDb();
		const ref = doc(db, COL.users, u.uid);
		const snap = await getDoc(ref);
		const member = getBandMember(u.email);
		if (!snap.exists()) {
			await setDoc(ref, {
				displayName: member?.displayName ?? u.displayName ?? u.email?.split('@')[0] ?? 'Bruger',
				email: u.email ?? '',
				createdAt: serverTimestamp()
			});
		}
		const fresh = await getDoc(ref);
		this.profile = fresh.data() as UserDoc;
	}

	async loginGoogle() {
		const auth = getFirebaseAuth();
		const provider = new GoogleAuthProvider();
		provider.setCustomParameters({ prompt: 'select_account' });
		await signInWithPopup(auth, provider);
	}

	async signOut() {
		await fbSignOut(getFirebaseAuth());
	}
}

export const authState = new AuthState();
