<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import { createSong, subscribeSongs } from '$lib/firebase/songs';
	import { uniqueCategoriesFromSongs } from '$lib/chordFormatter';
	import ChordDisplay from '$lib/components/ChordDisplay.svelte';
	import SongMetaForm from '$lib/components/SongMetaForm.svelte';
	import type { ChordLayout, SongDoc } from '$lib/types';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	// Hent eksisterende kategorier til autocomplete
	let allSongs = $state<SongDoc[]>([]);
	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs((s) => (allSongs = s));
		return () => unsub();
	});
	const knownCategories = $derived(uniqueCategoriesFromSongs(allSongs));

	// Form state
	let title = $state('');
	let artist = $state('');
	let key = $state('');
	let barsPerLine = $state<2 | 4 | 8>(4);
	let chordLayout = $state<ChordLayout>('separate');
	let categories = $state<string[]>([]);
	let rawInput = $state('');

	let saving = $state(false);
	let saveError = $state<string | null>(null);

	function onMetaChange(next: {
		title: string;
		artist: string;
		key: string;
		barsPerLine: 2 | 4 | 8;
		chordLayout: ChordLayout;
		categories: string[];
	}) {
		title = next.title;
		artist = next.artist;
		key = next.key;
		barsPerLine = next.barsPerLine;
		chordLayout = next.chordLayout;
		categories = next.categories;
	}

	const canSave = $derived(title.trim().length > 0 && rawInput.trim().length > 0 && !saving);

	async function handleSave() {
		if (!authState.user) return;
		saveError = null;
		saving = true;
		try {
			const id = await createSong(
				{
					title: title.trim(),
					...(artist.trim() ? { artist: artist.trim() } : {}),
					...(key.trim() ? { key: key.trim() } : {}),
					rawInput,
					barsPerLine,
					chordLayout,
					categories
				},
				authState.user.uid
			);
			goto(`/song/${id}`);
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Ukendt fejl';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>Ny sang · {BAND.name}</title></svelte:head>

<main class="mx-auto max-w-6xl px-6 py-10">
	<header class="mb-6">
		<a href="/songbook" class="text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]">← Tilbage til sangbogen</a>
		<h1 class="mt-2 font-display text-2xl font-bold text-[var(--color-accent)]">Tilføj sang</h1>
		<p class="text-sm text-[var(--color-ink-faint)]">
			Indsæt akkorder + tekst (fx fra Ultimate Guitar). Algoritmen ordner formateringen — du kan
			finjustere taktstreger bagefter ved at klikke på dem.
		</p>
	</header>

	<div class="grid gap-6 lg:grid-cols-2">
		<!-- VENSTRE: form + raw paste -->
		<section class="card p-6">
			<SongMetaForm
				{title}
				{artist}
				{key}
				{barsPerLine}
				{chordLayout}
				{categories}
				{knownCategories}
				onChange={onMetaChange}
			/>

			<div class="mt-5 field">
				<span class="field-label">Akkorder + tekst <span class="req">*</span></span>
				<textarea
					bind:value={rawInput}
					rows="18"
					placeholder={`[Verse 1]\nAm     Dm     Am     Dm\nSummertime, and the livin' is easy\n…`}
					class="paste-area"
				></textarea>
			</div>

			{#if saveError}
				<p class="mt-3 text-sm text-[var(--color-error)]">{saveError}</p>
			{/if}
			<div class="mt-5 flex items-center justify-end gap-3">
				<a href="/songbook" class="btn-ghost">Annullér</a>
				<button type="button" class="btn-primary" disabled={!canSave} onclick={handleSave}>
					{saving ? 'Gemmer…' : 'Gem sang'}
				</button>
			</div>
		</section>

		<!-- HØJRE: live preview -->
		<section class="card p-6">
			<h2 class="text-sm font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
				Live preview
			</h2>
			<div class="mt-3 max-h-[70vh] overflow-auto">
				{#if rawInput.trim()}
					<ChordDisplay {rawInput} {barsPerLine} {chordLayout} />
				{:else}
					<p class="text-sm italic text-[var(--color-ink-muted)]">
						Indsæt akkorder + tekst til venstre, så ser du resultatet her.
					</p>
				{/if}
			</div>
		</section>
	</div>
</main>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.field-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-ink-faint);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.req {
		color: var(--color-error);
	}
	.paste-area {
		width: 100%;
		padding: 0.75rem;
		border-radius: var(--radius-button);
		background: var(--color-bg-elevated);
		border: 1px solid var(--color-border);
		color: var(--color-ink-on-dark);
		font-family: var(--font-mono);
		font-size: 0.85rem;
		resize: vertical;
	}
	.paste-area:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
