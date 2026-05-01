<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import { subscribeSongs } from '$lib/firebase/songs';
	import ChordDisplay from '$lib/components/ChordDisplay.svelte';
	import type { SongDoc } from '$lib/types';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	let allSongs = $state<SongDoc[]>([]);
	let loading = $state(true);

	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs((s) => {
			allSongs = s;
			loading = false;
		});
		return () => unsub();
	});

	const category = $derived($page.url.searchParams.get('category'));

	const filtered = $derived.by(() => {
		if (!category) return allSongs;
		return allSongs.filter((s) => (s.categories ?? []).includes(category));
	});

	function doPrint() {
		window.print();
	}
</script>

<svelte:head>
	<title>Print {category ?? 'sangbog'} · {BAND.name}</title>
</svelte:head>

<!-- Toolbar — skjules ved print -->
<header class="no-print sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur">
	<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-6 py-4">
		<a href="/songbook" class="btn-ghost">← Tilbage</a>
		<div class="flex-1">
			<h1 class="font-display text-lg font-bold text-[var(--color-accent)]">
				{category ? `Print: ${category}` : 'Print: hele sangbogen'}
			</h1>
			<p class="text-xs text-[var(--color-ink-faint)]">
				{filtered.length} {filtered.length === 1 ? 'sang' : 'sange'} — én pr. side
			</p>
		</div>
		<button type="button" class="btn-primary" onclick={doPrint} disabled={filtered.length === 0}>
			Print / Gem som PDF
		</button>
	</div>
</header>

{#if loading}
	<p class="mx-auto max-w-3xl px-6 py-10 text-center text-[var(--color-ink-muted)]">Henter…</p>
{:else if filtered.length === 0}
	<p class="mx-auto max-w-3xl px-6 py-10 text-center text-[var(--color-ink-muted)]">
		Ingen sange i {category ?? 'sangbogen'}.
	</p>
{:else}
	<div class="mx-auto max-w-3xl px-6 py-6">
		{#each filtered as song (song.id)}
			<article class="print-page mb-8 rounded-md bg-white p-6 text-[var(--color-ink)]">
				<header class="mb-4 border-b border-[var(--color-border-subtle)] pb-3">
					<h2 class="font-display text-2xl font-bold">{song.title}</h2>
					<div class="mt-1 flex flex-wrap items-center gap-3 text-sm text-[var(--color-ink-muted)]">
						{#if song.artist}<span>{song.artist}</span>{/if}
						{#if song.key}<span>· Toneart: <b>{song.key}</b></span>{/if}
						<span>· {song.barsPerLine} takter pr. linje</span>
						{#if (song.categories ?? []).length}
							<span>· {song.categories!.join(' · ')}</span>
						{/if}
					</div>
				</header>
				<ChordDisplay
					rawInput={song.rawInput}
					barsPerLine={song.barsPerLine}
					chordLayout={song.chordLayout}
					barEdits={song.barEdits}
					transpose={song.transpose ?? 0}
				/>
			</article>
		{/each}
	</div>
{/if}
