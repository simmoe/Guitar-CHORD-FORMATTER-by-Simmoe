<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	async function handleSignOut() {
		await authState.signOut();
		goto('/login');
	}
</script>

<svelte:head><title>Sangbog · {BAND.name}</title></svelte:head>

<main class="mx-auto max-w-5xl px-6 py-10">
	<header class="mb-10 flex items-center justify-between">
		<div>
			<h1 class="font-display text-3xl font-bold tracking-tight text-[var(--color-accent)]">
				{BAND.name}
			</h1>
			<p class="text-sm text-[var(--color-ink-faint)]">Sangbog</p>
		</div>
		{#if authState.profile}
			<div class="flex items-center gap-4">
				<span class="text-sm text-[var(--color-ink-faint)]">
					Logget ind som <span class="font-semibold text-[var(--color-ink-on-dark)]"
						>{authState.profile.displayName}</span
					>
				</span>
				<button class="btn-ghost" onclick={handleSignOut}>Log ud</button>
			</div>
		{/if}
	</header>

	<section class="card p-8">
		<h2 class="text-xl font-semibold text-[var(--color-ink)]">Sangbogen er klar til indhold</h2>
		<p class="mt-2 text-sm text-[var(--color-ink-muted)]">
			Phase 0/1 (auth + scaffold) er færdig. Editor, UG-import, sætlister og PDF-eksport bliver
			tilføjet i de næste faser.
		</p>
	</section>
</main>
