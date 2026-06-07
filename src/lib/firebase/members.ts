import { httpsCallable } from 'firebase/functions';
import { getFns } from './client';

export interface BandMemberProfile {
	uid: string;
	displayName: string;
	email: string;
}

export interface InvitedBandMember {
	uid: string;
	displayName: string;
	email: string;
}

export interface BandMembersResult {
	members: BandMemberProfile[];
	canRemoveMembers: boolean;
}

export async function listBandMembers(): Promise<BandMembersResult> {
	const callable = httpsCallable<undefined, BandMembersResult>(
		getFns(),
		'listBandMembers'
	);
	const result = await callable(undefined);
	return result.data;
}

export async function removeBandMember(uid: string): Promise<void> {
	const callable = httpsCallable<{ uid: string }, { uid: string; removed: boolean }>(
		getFns(),
		'removeBandMember'
	);
	await callable({ uid });
}

export async function inviteBandMember(email: string, displayName: string): Promise<InvitedBandMember> {
	const callable = httpsCallable<{ email: string; displayName?: string; origin?: string }, InvitedBandMember>(
		getFns(),
		'inviteBandMember'
	);
	const result = await callable({
		email,
		displayName,
		origin: typeof location === 'undefined' ? undefined : location.origin
	});
	return result.data;
}

export async function updateMyProfile(
	displayName: string,
	email: string
): Promise<BandMemberProfile> {
	const callable = httpsCallable<{ displayName: string; email: string }, BandMemberProfile>(
		getFns(),
		'updateMyProfile'
	);
	const result = await callable({ displayName, email });
	return result.data;
}
