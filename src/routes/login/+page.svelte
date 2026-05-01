<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';

	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		if (!authState.loading && authState.user) goto('/songbook');
	});

	$effect(() => {
		if (authState.notAuthorized) {
			error =
				'Den valgte Google-konto er ikke på bandets liste. Brug din bandkonto, eller bed Simo om at tilføje dig.';
		}
	});

	async function loginGoogle() {
		error = '';
		busy = true;
		try {
			await authState.loginGoogle();
		} catch (err: any) {
			if (err?.code === 'auth/popup-closed-by-user') {
				error = '';
			} else {
				error = 'Google-login mislykkedes. Prøv igen.';
			}
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Log ind · {BAND.name}</title></svelte:head>

<main class="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-10">
	<div class="mb-10 text-center">
		<h1 class="font-display text-4xl font-bold tracking-tight text-[var(--color-accent)]">
			{BAND.name}
		</h1>
		<p class="mt-2 text-sm text-[var(--color-ink-faint)]">{BAND.tagline}</p>
	</div>

	<div class="card p-6 space-y-4">
		<p class="text-sm text-[var(--color-ink-muted)]">
			Log ind med din bandkonto for at få adgang til sangbogen og sætlisterne.
		</p>

		<button class="btn-primary w-full" onclick={loginGoogle} disabled={busy}>
			{busy ? 'Logger ind…' : 'Log ind med Google'}
		</button>

		{#if error}
			<p class="text-sm text-[var(--color-error)]">{error}</p>
		{/if}
	</div>

	<p class="mt-6 text-center text-xs text-[var(--color-ink-faint)]">
		Kun bandets medlemmer kan logge ind.
	</p>
</main>
