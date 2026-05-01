<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';

	$effect(() => {
		if (authState.loading) return;
		if (!authState.user) {
			goto('/login');
		} else {
			goto('/songbook');
		}
	});
</script>

<svelte:head><title>{BAND.name}</title></svelte:head>

<main class="flex min-h-dvh items-center justify-center px-6">
	<div class="text-center">
		<p class="font-display text-3xl font-bold tracking-tight text-[var(--color-accent)]">
			{BAND.name}
		</p>
		<p class="mt-2 text-sm text-[var(--color-ink-faint)]">{BAND.tagline}</p>
		<p class="mt-8 text-xs text-[var(--color-ink-faint)]">Indlæser…</p>
	</div>
</main>
