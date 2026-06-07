<script lang="ts">
	import type { BandMemberProfile, InvitedBandMember } from '$lib/firebase/members';

	interface Props {
		displayName: string;
		email: string;
		members: BandMemberProfile[];
		loadingMembers?: boolean;
		saving?: boolean;
		inviting?: boolean;
		removingUid?: string | null;
		canRemoveMembers?: boolean;
		currentUserUid?: string | null;
		error?: string | null;
		onClose: () => void;
		onSaveProfile: (displayName: string, email: string) => Promise<void> | void;
		onInvite: (email: string, displayName: string) => Promise<InvitedBandMember | null> | InvitedBandMember | null;
		onRemoveMember: (uid: string) => Promise<void> | void;
	}

	const {
		displayName,
		email,
		members,
		loadingMembers = false,
		saving = false,
		inviting = false,
		removingUid = null,
		canRemoveMembers = false,
		currentUserUid = null,
		error = null,
		onClose,
		onSaveProfile,
		onInvite,
		onRemoveMember
	}: Props = $props();

	let profileName = $state('');
	let profileEmail = $state('');
	let inviteEmail = $state('');
	let inviteName = $state('');
	let localMessage = $state<string | null>(null);

	const sortedMembers = $derived(
		[...members].sort((a, b) => a.displayName.localeCompare(b.displayName, 'da'))
	);

	$effect(() => {
		profileName = displayName;
		profileEmail = email;
	});

	function resetMessage() {
		localMessage = null;
	}

	async function saveProfile() {
		resetMessage();
		await onSaveProfile(profileName.trim(), profileEmail.trim());
		localMessage = 'Profilen er gemt.';
	}

	async function invite() {
		resetMessage();
		const invited = await onInvite(inviteEmail.trim(), inviteName.trim());
		if (!invited) return;
		inviteEmail = '';
		inviteName = '';
		localMessage = `${invited.email} er indmeldt, og invitationen er sendt.`;
	}

	async function removeMember(member: BandMemberProfile) {
		if (!confirm(`Fjern ${member.displayName || member.email} fra Fællesbandet?`)) return;
		resetMessage();
		await onRemoveMember(member.uid);
		localMessage = `${member.displayName || member.email} er fjernet.`;
	}
</script>

<div class="profile-modal-backdrop" role="presentation">
	<button type="button" class="profile-modal-dismiss" aria-label="Luk profil" onclick={onClose}></button>
	<div class="profile-modal card" role="dialog" aria-modal="true" aria-labelledby="profile-title">
		<header class="profile-modal-header">
			<div>
				<p class="profile-modal-kicker">Medlemmer</p>
				<h2 id="profile-title">Profil og invitationer</h2>
			</div>
			<button type="button" class="btn-ghost" onclick={onClose}>Luk</button>
		</header>

		{#if error}
			<p class="profile-error">{error}</p>
		{/if}
		{#if localMessage}
			<p class="profile-message">{localMessage}</p>
		{/if}

		<section class="profile-panel profile-panel--primary" aria-labelledby="profile-edit-title">
			<div class="profile-section-heading">
				<h3 id="profile-edit-title">Din profil</h3>
				<p>Ret navn og email, som resten af bandet ser dem.</p>
			</div>
			<div class="profile-inline-fields">
				<label>
					<span>Navn</span>
					<input type="text" bind:value={profileName} autocomplete="name" />
				</label>
				<label>
					<span>Email</span>
					<input type="email" bind:value={profileEmail} autocomplete="email" />
				</label>
				<button type="button" class="btn-primary profile-action" onclick={saveProfile} disabled={saving}>
					{saving ? 'Gemmer…' : 'Gem'}
				</button>
			</div>
		</section>

		<section class="profile-panel" aria-labelledby="profile-invite-title">
			<div class="profile-section-heading">
				<h3 id="profile-invite-title">Tilføj nogen til fællesbandet</h3>
				<p>Vi opretter medlemmet og sender invitationen automatisk.</p>
			</div>
			<div class="profile-inline-fields">
				<label>
					<span>Email</span>
					<input type="email" bind:value={inviteEmail} placeholder="navn@example.com" />
				</label>
				<label>
					<span>Navn</span>
					<input type="text" bind:value={inviteName} placeholder="Valgfrit" />
				</label>
				<button type="button" class="btn-secondary profile-action" onclick={invite} disabled={inviting}>
					{inviting ? 'Sender…' : 'Tilføj'}
				</button>
			</div>
			<p class="profile-hint">
				Adgangskoden er altid <strong>fælles</strong>.
			</p>
		</section>

		<section class="profile-members" aria-labelledby="profile-members-title">
			<div class="profile-members-header">
				<h3 id="profile-members-title">Indmeldte medlemmer</h3>
				<span>{members.length}</span>
			</div>
			{#if loadingMembers}
				<p class="profile-hint">Henter medlemmer…</p>
			{:else if sortedMembers.length === 0}
				<p class="profile-hint">Ingen medlemmer fundet.</p>
			{:else}
				<div class="profile-member-list">
					{#each sortedMembers as member (member.uid)}
						<div class="profile-member-row">
							<div>
								<strong>{member.displayName}</strong>
								<span>{member.email}</span>
							</div>
							{#if canRemoveMembers && member.uid !== currentUserUid}
								<button
									type="button"
									class="profile-delete-button"
									aria-label={`Fjern ${member.displayName || member.email}`}
									title="Fjern medlem"
									disabled={removingUid === member.uid}
									onclick={() => removeMember(member)}
								>
									{removingUid === member.uid ? '…' : '×'}
								</button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.profile-modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: grid;
		place-items: center;
		padding: 1rem;
		background: color-mix(in srgb, #05070b 62%, transparent);
	}

	.profile-modal-dismiss {
		position: absolute;
		inset: 0;
		border: 0;
		background: transparent;
		cursor: default;
	}

	.profile-modal {
		position: relative;
		z-index: 1;
		width: min(760px, 100%);
		max-height: min(86vh, 840px);
		overflow: auto;
		padding: 1.25rem;
	}

	.profile-modal-header,
	.profile-members-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.profile-modal-kicker {
		margin: 0 0 0.2rem;
		color: var(--color-ink-faint);
		font-size: 0.72rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}

	h2,
	h3 {
		margin: 0;
		color: var(--color-ink);
	}

	h2 {
		font-family: var(--font-display);
		font-size: 1.35rem;
	}

	h3 {
		font-size: 0.98rem;
	}

	.profile-panel,
	.profile-members {
		border: 1px solid var(--color-border-subtle);
		border-radius: calc(var(--radius-card) * 0.8);
		background: rgba(255, 255, 255, 0.66);
		padding: 0.9rem;
	}

	.profile-panel {
		margin-top: 0.85rem;
	}

	.profile-panel--primary {
		margin-top: 1.1rem;
	}

	.profile-section-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 0.75rem;
	}

	.profile-section-heading p {
		margin: 0;
		color: var(--color-ink-faint);
		font-size: 0.78rem;
		text-align: right;
	}

	.profile-inline-fields {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
		align-items: end;
		gap: 0.7rem;
	}

	label {
		display: grid;
		gap: 0.35rem;
		color: var(--color-ink-muted);
		font-size: 0.78rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}

	input {
		width: 100%;
		border: 1px solid var(--color-border-subtle);
		border-radius: var(--radius-button);
		background: var(--color-bg-elevated);
		padding: 0.62rem 0.72rem;
		color: var(--color-ink-on-dark);
		font-size: 0.9rem;
		font-weight: 500;
		text-transform: none;
		letter-spacing: 0;
		outline: none;
	}

	input:focus {
		border-color: var(--color-accent);
	}

	.profile-hint {
		margin: 0.65rem 0 0;
		color: var(--color-ink-faint);
		font-size: 0.82rem;
		line-height: 1.45;
	}

	.profile-action {
		min-width: 5.4rem;
		min-height: 2.55rem;
		padding-inline: 1rem;
	}

	.profile-error,
	.profile-message {
		margin: 1rem 0 0;
		border-radius: var(--radius-button);
		padding: 0.75rem 0.9rem;
		font-size: 0.88rem;
	}

	.profile-error {
		background: color-mix(in srgb, var(--color-error) 13%, transparent);
		color: var(--color-error);
	}

	.profile-message {
		background: color-mix(in srgb, var(--color-accent) 14%, transparent);
		color: var(--color-ink);
	}

	.profile-members {
		margin-top: 1rem;
	}

	.profile-members-header span {
		color: var(--color-ink-faint);
		font-size: 0.85rem;
	}

	.profile-member-list {
		display: grid;
		gap: 0.45rem;
		margin-top: 0.75rem;
	}

	.profile-member-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		border-radius: calc(var(--radius-button) * 0.9);
		background: rgba(255, 255, 255, 0.58);
		padding: 0.58rem 0.7rem;
	}

	.profile-member-row div {
		display: grid;
		gap: 0.12rem;
		min-width: 0;
	}

	.profile-member-row strong {
		color: var(--color-ink);
		font-size: 0.92rem;
	}

	.profile-member-row span {
		color: var(--color-ink-faint);
		font-size: 0.78rem;
		overflow-wrap: anywhere;
	}

	.profile-delete-button {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 1.65rem;
		height: 1.65rem;
		border: 1px solid color-mix(in srgb, var(--color-error) 18%, var(--color-border-subtle));
		border-radius: 999px;
		background: transparent;
		color: var(--color-error);
		font-size: 1rem;
		line-height: 1;
		cursor: pointer;
	}

	.profile-delete-button:hover {
		background: color-mix(in srgb, var(--color-error) 8%, transparent);
	}

	.profile-delete-button:disabled {
		opacity: 0.5;
		cursor: wait;
	}

	@media (max-width: 720px) {
		.profile-inline-fields {
			grid-template-columns: 1fr;
		}

		.profile-section-heading {
			display: grid;
		}

		.profile-section-heading p {
			text-align: left;
		}
	}
</style>
