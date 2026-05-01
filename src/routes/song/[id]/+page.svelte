<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import {
		deleteSong,
		getSong,
		subscribeSongs,
		updateSong
	} from '$lib/firebase/songs';
	import { uniqueCategoriesFromSongs } from '$lib/chordFormatter';
	import ChordDisplay from '$lib/components/ChordDisplay.svelte';
	import SongMetaForm from '$lib/components/SongMetaForm.svelte';
	import type { BarEdits, ChordLayout, SongDoc } from '$lib/types';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	let song = $state<SongDoc | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	// Edit-mode state
	let editing = $state(false);
	let title = $state('');
	let artist = $state('');
	let key = $state('');
	let barsPerLine = $state<2 | 4 | 8>(4);
	let chordLayout = $state<ChordLayout>('separate');
	let categories = $state<string[]>([]);
	let rawInput = $state('');
	let barEdits = $state<BarEdits>({});
	let transpose = $state(0);
	let saving = $state(false);
	let saveError = $state<string | null>(null);

	// Til kategori-autocomplete
	let allSongs = $state<SongDoc[]>([]);
	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs((s) => (allSongs = s));
		return () => unsub();
	});
	const knownCategories = $derived(uniqueCategoriesFromSongs(allSongs));

	// Hent sangen
	$effect(() => {
		const id = $page.params.id;
		if (!id || !authState.user) return;
		loading = true;
		loadError = null;
		getSong(id)
			.then((s) => {
				if (!s) {
					loadError = 'Sangen findes ikke (måske slettet).';
					return;
				}
				song = s;
				resetFormFromSong(s);
			})
			.catch((err) => (loadError = err instanceof Error ? err.message : 'Ukendt fejl'))
			.finally(() => (loading = false));
	});

	function resetFormFromSong(s: SongDoc) {
		title = s.title;
		artist = s.artist ?? '';
		key = s.key ?? '';
		barsPerLine = s.barsPerLine;
		chordLayout = s.chordLayout;
		categories = [...(s.categories ?? [])];
		rawInput = s.rawInput;
		barEdits = { ...(s.barEdits ?? {}) };
		transpose = s.transpose ?? 0;
	}

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

	function startEdit() {
		if (!song) return;
		resetFormFromSong(song);
		editing = true;
	}

	function cancelEdit() {
		if (!song) return;
		resetFormFromSong(song);
		editing = false;
		saveError = null;
	}

	async function handleSave() {
		if (!song || !authState.user) return;
		saveError = null;
		saving = true;
		try {
			const patch: Partial<Omit<SongDoc, 'id' | 'createdAt' | 'createdBy'>> = {
				title: title.trim(),
				artist: artist.trim() || undefined,
				key: key.trim() || undefined,
				barsPerLine,
				chordLayout,
				categories,
				rawInput,
				barEdits,
				transpose
			};
			await updateSong(song.id, patch, authState.user.uid);
			// Opdater lokal state
			song = { ...song, ...patch } as SongDoc;
			editing = false;
		} catch (err) {
			saveError = err instanceof Error ? err.message : 'Ukendt fejl';
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!song) return;
		const ok = confirm(`Slet "${song.title}"? Det kan ikke fortrydes.`);
		if (!ok) return;
		await deleteSong(song.id);
		goto('/songbook');
	}

	// Når brugeren tapper på en bar-separator i edit-mode, persistéres ændringen
	// IKKE med det samme — den ligger i barEdits og skrives ved Gem. Det giver
	// brugeren mulighed for at annullere alle bar-edits sammen med tekstændringer.
	function onBarEditsChange(next: BarEdits) {
		barEdits = next;
	}
</script>

<svelte:head>
	<title>{song?.title ?? 'Sang'} · {BAND.name}</title>
</svelte:head>

<main class="mx-auto max-w-5xl px-6 py-8">
	<header class="mb-4 flex items-center justify-between gap-4">
		<a href="/songbook" class="text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]">← Tilbage til sangbogen</a>
		{#if authState.profile}
			<span class="text-xs text-[var(--color-ink-faint)]"
				>Logget ind som {authState.profile.displayName}</span
			>
		{/if}
	</header>

	{#if loading}
		<div class="card p-8 text-center text-[var(--color-ink-muted)]">Henter sang…</div>
	{:else if loadError}
		<div class="card p-6">
			<p class="text-[var(--color-error)] font-semibold">Fejl</p>
			<p class="mt-1 text-sm text-[var(--color-ink-muted)]">{loadError}</p>
		</div>
	{:else if song}
		<article class="card p-6 sm:p-8">
			{#if editing}
				<!-- ============ EDIT MODE ============ -->
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

				<div class="mt-5 grid gap-5 lg:grid-cols-2">
					<div>
						<label for="rawInput" class="form-label">Akkorder + tekst</label>
						<textarea
							id="rawInput"
							bind:value={rawInput}
							rows="20"
							class="paste-area"
						></textarea>
					</div>

					<div>
						<div class="flex items-center justify-between">
							<span class="form-label">Live preview</span>
							<span class="text-xs italic text-[var(--color-ink-muted)]">
								Klik på <b style="color: var(--color-chord);">|</b> eller mellemrum for at toggle
								taktstreg
							</span>
						</div>
						<div class="mt-1 max-h-[70vh] overflow-auto rounded-md bg-white/95 p-3">
							{#if rawInput.trim()}
								<ChordDisplay
									{rawInput}
									{barsPerLine}
									{chordLayout}
									{barEdits}
									{transpose}
									editable
									{onBarEditsChange}
								/>
							{:else}
								<p class="text-sm italic text-[var(--color-ink-muted)]">Indsæt tekst…</p>
							{/if}
						</div>
					</div>
				</div>

				{#if saveError}
					<p class="mt-3 text-sm text-[var(--color-error)]">{saveError}</p>
				{/if}
				<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
					<button type="button" class="btn-ghost text-[var(--color-error)]" onclick={handleDelete}>
						Slet sang
					</button>
					<div class="flex items-center gap-3">
						<button class="btn-ghost" onclick={cancelEdit}>Annullér</button>
						<button class="btn-primary" disabled={saving} onclick={handleSave}>
							{saving ? 'Gemmer…' : 'Gem ændringer'}
						</button>
					</div>
				</div>
			{:else}
				<!-- ============ VIEW MODE ============ -->
				<div class="mb-4 flex flex-wrap items-start justify-between gap-3">
					<div>
						<h1 class="font-display text-2xl font-bold text-[var(--color-ink)]">{song.title}</h1>
						{#if song.artist}
							<p class="text-sm text-[var(--color-ink-muted)]">{song.artist}</p>
						{/if}
						<div class="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
							{#if song.key}
								<span
									class="rounded-full bg-[var(--color-chord-soft)] px-2 py-0.5 font-bold text-[var(--color-chord)]"
									>{song.key}</span
								>
							{/if}
							<span class="meta-pill">{song.barsPerLine} takter</span>
							<span class="meta-pill">{song.chordLayout === 'inline' ? 'Akkord over tekst' : 'Akkord-skema'}</span
							>
							{#each song.categories ?? [] as cat (cat)}
								<span class="cat-pill">{cat}</span>
							{/each}
						</div>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<!-- Hurtig transponering -->
						<div class="flex items-center gap-1 rounded-md border border-[var(--color-border-subtle)] bg-white p-1 text-xs">
							<button
								type="button"
								class="px-2 py-1 hover:bg-slate-100"
								title="Transponér ned"
								onclick={() => (transpose = (song?.transpose ?? 0) - 1)}>−</button
							>
							<span class="px-2 font-semibold text-[var(--color-ink)]">
								{transpose === 0 ? '±0' : transpose > 0 ? `+${transpose}` : transpose}
							</span>
							<button
								type="button"
								class="px-2 py-1 hover:bg-slate-100"
								title="Transponér op"
								onclick={() => (transpose = (song?.transpose ?? 0) + 1)}>+</button
							>
							{#if transpose !== 0}
								<button
									type="button"
									class="px-2 py-1 text-[var(--color-ink-muted)] hover:text-[var(--color-error)]"
									title="Nulstil"
									onclick={() => (transpose = 0)}>↺</button
								>
							{/if}
						</div>
						<button type="button" class="btn-secondary" onclick={() => window.print()}>Print</button>
						<button type="button" class="btn-primary" onclick={startEdit}>Rediger</button>
					</div>
				</div>

				<div class="rounded-md bg-white p-4">
					<ChordDisplay
						rawInput={song.rawInput}
						barsPerLine={song.barsPerLine}
						chordLayout={song.chordLayout}
						barEdits={song.barEdits}
						{transpose}
					/>
				</div>
			{/if}
		</article>
	{/if}
</main>

<style>
	.form-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-ink-faint);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.paste-area {
		margin-top: 0.35rem;
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
