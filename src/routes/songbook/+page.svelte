<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import { subscribeSongs } from '$lib/firebase/songs';
	import { uniqueCategoriesFromSongs } from '$lib/chordFormatter';
	import type { SongDoc } from '$lib/types';

	let songs = $state<SongDoc[]>([]);
	let loadingSongs = $state(true);
	let error = $state<string | null>(null);
	let activeCategory = $state<string | null>(null); // null = alle
	let search = $state('');

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs(
			(s) => {
				songs = s;
				loadingSongs = false;
			},
			(err) => {
				error = err.message;
				loadingSongs = false;
			}
		);
		return () => unsub();
	});

	const categories = $derived(uniqueCategoriesFromSongs(songs));

	const filteredSongs = $derived.by(() => {
		const q = search.trim().toLowerCase();
		return songs.filter((s) => {
			if (activeCategory && !(s.categories ?? []).includes(activeCategory)) return false;
			if (!q) return true;
			return (
				s.title.toLowerCase().includes(q) ||
				(s.artist ?? '').toLowerCase().includes(q) ||
				(s.categories ?? []).some((c) => c.toLowerCase().includes(q))
			);
		});
	});

	async function handleSignOut() {
		await authState.signOut();
		goto('/login');
	}

	function handlePrint() {
		const params = new URLSearchParams();
		if (activeCategory) params.set('category', activeCategory);
		goto(`/print?${params.toString()}`);
	}
</script>

<svelte:head><title>Sangbog · {BAND.name}</title></svelte:head>

<main class="mx-auto max-w-6xl px-6 py-10">
	<header class="mb-8 flex flex-wrap items-end justify-between gap-4">
		<div>
			<h1 class="font-display text-3xl font-bold tracking-tight text-[var(--color-accent)]">
				{BAND.name}
			</h1>
			<p class="text-sm text-[var(--color-ink-faint)]">
				{BAND.tagline} · samlede sangbog
			</p>
		</div>
		{#if authState.profile}
			<div class="flex items-center gap-3 text-sm">
				<span class="text-[var(--color-ink-faint)]">
					Logget ind som
					<span class="font-semibold text-[var(--color-ink-on-dark)]"
						>{authState.profile.displayName}</span
					>
				</span>
				<button class="btn-ghost" onclick={handleSignOut}>Log ud</button>
			</div>
		{/if}
	</header>

	<!-- Action bar: stort + til ny sang, og stort print-ikon for valgt kategori -->
	<div class="mb-6 flex flex-wrap items-center gap-3">
		<a
			href="/songbook/new"
			class="btn-primary !text-base"
			style="padding: 1rem 1.5rem; font-size: 1.05rem;"
			aria-label="Tilføj ny sang"
		>
			<span aria-hidden="true" style="font-size: 1.5rem; line-height: 1;">+</span>
			Tilføj sang
		</a>
		<button
			type="button"
			class="btn-secondary"
			style="padding: 1rem 1.25rem;"
			onclick={handlePrint}
			disabled={filteredSongs.length === 0}
			aria-label={activeCategory ? `Print kategorien ${activeCategory}` : 'Print hele sangbogen'}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="22"
				height="22"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
				><polyline points="6 9 6 2 18 2 18 9"></polyline><path
					d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"
				></path><rect x="6" y="14" width="12" height="8"></rect></svg
			>
			{activeCategory ? `Print "${activeCategory}"` : 'Print hele sangbogen'}
		</button>

		<div class="ml-auto">
			<input
				type="search"
				placeholder="Søg efter titel, kunstner eller kategori…"
				bind:value={search}
				class="rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-2 text-sm text-[var(--color-ink-on-dark)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none"
			/>
		</div>
	</div>

	<!-- Kategori-chips -->
	<div class="mb-6 flex flex-wrap gap-2">
		<button
			type="button"
			class="cat-chip"
			class:active={activeCategory === null}
			onclick={() => (activeCategory = null)}
		>
			Alle ({songs.length})
		</button>
		{#each categories as cat (cat)}
			{@const count = songs.filter((s) => (s.categories ?? []).includes(cat)).length}
			<button
				type="button"
				class="cat-chip"
				class:active={activeCategory === cat}
				onclick={() => (activeCategory = cat)}
			>
				{cat} ({count})
			</button>
		{/each}
	</div>

	<!-- Liste -->
	{#if loadingSongs}
		<div class="card p-8 text-center text-[var(--color-ink-muted)]">Henter sangbog…</div>
	{:else if error}
		<div class="card p-6">
			<p class="text-[var(--color-error)] font-semibold">Kunne ikke hente sange</p>
			<p class="mt-1 text-sm text-[var(--color-ink-muted)]">{error}</p>
		</div>
	{:else if filteredSongs.length === 0}
		<div class="card p-10 text-center">
			{#if songs.length === 0}
				<p class="text-lg font-semibold text-[var(--color-ink)]">Ingen sange endnu</p>
				<p class="mt-2 text-sm text-[var(--color-ink-muted)]">
					Klik på <span class="font-semibold">+ Tilføj sang</span> for at lægge den første sang i sangbogen.
				</p>
			{:else}
				<p class="text-[var(--color-ink-muted)]">Ingen sange matcher dit filter.</p>
			{/if}
		</div>
	{:else}
		<ul class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{#each filteredSongs as song (song.id)}
				<li>
					<a href={`/song/${song.id}`} class="song-card card block p-4">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<h3 class="truncate text-base font-semibold text-[var(--color-ink)]">
									{song.title}
								</h3>
								{#if song.artist}
									<p class="truncate text-sm text-[var(--color-ink-muted)]">{song.artist}</p>
								{/if}
							</div>
							{#if song.key}
								<span
									class="shrink-0 rounded-full bg-[var(--color-chord-soft)] px-2 py-0.5 text-xs font-bold text-[var(--color-chord)]"
								>
									{song.key}
								</span>
							{/if}
						</div>
						<div class="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
							<span class="meta-pill">
								{song.barsPerLine} takter
							</span>
							<span class="meta-pill">
								{song.chordLayout === 'inline' ? 'Akkord over tekst' : 'Akkord-skema'}
							</span>
							{#each song.categories ?? [] as cat (cat)}
								<span class="cat-pill">{cat}</span>
							{/each}
						</div>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</main>

<style>
	.cat-chip {
		padding: 0.4rem 0.85rem;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: rgba(255, 255, 255, 0.04);
		color: var(--color-ink-on-dark);
		font-size: 0.85rem;
		font-weight: 500;
		transition: background 120ms ease, border-color 120ms ease;
	}
	.cat-chip:hover {
		background: rgba(255, 255, 255, 0.1);
	}
	.cat-chip.active {
		background: var(--color-accent);
		color: #ffffff;
		border-color: var(--color-accent);
	}
	.song-card {
		transition: transform 120ms ease, box-shadow 120ms ease;
	}
	.song-card:hover {
		transform: translateY(-1px);
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.9) inset, 0 10px 28px rgba(15, 23, 42, 0.28);
	}
	.meta-pill {
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-bg-card-muted);
		color: var(--color-ink-muted);
		font-weight: 500;
	}
	.cat-pill {
		padding: 0.15rem 0.5rem;
		border-radius: 999px;
		background: var(--color-accent-soft);
		color: #92400e;
		font-weight: 600;
	}
</style>
