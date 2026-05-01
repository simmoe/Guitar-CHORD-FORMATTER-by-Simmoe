<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';

	let email = $state('');
	let password = $state('');
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		if (!authState.loading && authState.user) goto('/songbook');
	});

	$effect(() => {
		if (authState.notAuthorized) {
			error =
				'Den valgte konto er ikke på bandets liste. Brug din bandkonto, eller bed Simo om at tilføje dig.';
		}
	});

	async function loginEmail(e: SubmitEvent) {
		e.preventDefault();
		error = '';
		busy = true;
		try {
			await authState.loginEmail(email, password);
		} catch (err: any) {
			if (err?.code === 'auth/invalid-credential' || err?.code === 'auth/wrong-password') {
				error = 'Forkert email eller adgangskode.';
			} else if (err?.code === 'auth/user-not-found') {
				error = 'Den email findes ikke i bandet.';
			} else {
				error = 'Login mislykkedes. Prøv igen.';
			}
		} finally {
			busy = false;
		}
	}

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

	<form class="card p-6 space-y-4" onsubmit={loginEmail}>
		<div>
			<label
				for="email"
				class="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]"
			>
				Email
			</label>
			<input
				id="email"
				type="email"
				bind:value={email}
				required
				autocomplete="email"
				class="w-full rounded-[var(--radius-button)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-card-muted)] px-3.5 py-3 text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
			/>
		</div>
		<div>
			<label
				for="password"
				class="mb-1 block text-xs font-medium uppercase tracking-wide text-[var(--color-ink-muted)]"
			>
				Adgangskode
			</label>
			<input
				id="password"
				type="password"
				bind:value={password}
				required
				autocomplete="current-password"
				class="w-full rounded-[var(--radius-button)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-card-muted)] px-3.5 py-3 text-base text-[var(--color-ink)] outline-none focus:border-[var(--color-accent)]"
			/>
		</div>

		{#if error}
			<p class="text-sm text-[var(--color-error)]">{error}</p>
		{/if}

		<button class="btn-primary w-full" type="submit" disabled={busy}>
			{busy ? 'Logger ind…' : 'Log ind'}
		</button>
	</form>

	<div class="my-6 flex items-center gap-3 text-xs text-[var(--color-ink-faint)]">
		<div class="h-px flex-1 bg-[var(--color-border)]"></div>
		<span>eller</span>
		<div class="h-px flex-1 bg-[var(--color-border)]"></div>
	</div>

	<button class="btn-secondary w-full" onclick={loginGoogle} disabled={busy}>
		Log ind med Google
	</button>

	<p class="mt-6 text-center text-xs text-[var(--color-ink-faint)]">
		Kun bandets medlemmer kan logge ind.
	</p>
</main>
