/**
 * Fællesbandet — checked-in meta JSON.
 *
 * `members` er den fulde allowlist over hvem der må logge ind og redigere
 * sangbogen. Tilføj nye medlemmer her, commit, deploy — og medlemmet kan
 * logge ind med Google. Firestore-rules bruger samme allowlist via
 * `chord_bands/faellesbandet`-dokumentet (memberUids / memberEmails),
 * så husk også at opdatere det dokument når listen ændres.
 */
export const BAND = {
	id: 'faellesbandet',
	name: 'Fællesbandet',
	tagline: 'Syng-med koncerter med publikumsdeltagelse',
	members: [
		{
			email: 'simmoe@gmail.com',
			displayName: 'Simo',
			role: 'owner' as const
		}
		// TODO: tilføj resten af bandets medlemmer her — { email, displayName, role: 'member' }
	]
} as const;

export type BandMember = (typeof BAND.members)[number];

export function isBandMemberEmail(email: string | null | undefined): boolean {
	if (!email) return false;
	return BAND.members.some((m) => m.email.toLowerCase() === email.toLowerCase());
}

export function getBandMember(email: string | null | undefined): BandMember | undefined {
	if (!email) return undefined;
	return BAND.members.find((m) => m.email.toLowerCase() === email.toLowerCase());
}
