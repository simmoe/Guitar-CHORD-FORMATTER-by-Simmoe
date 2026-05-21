<script lang="ts">
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import EditableSong from '$lib/components/EditableSong.svelte';
	import { createSong } from '$lib/firebase/songs';
	import { inferBassLinesForImportedRows } from '$lib/migrate';
	import {
		normalizeImportedChordSpacing,
		parseRows,
		serializeRows,
		type Row
	} from '$lib/songParse';
	import {
		UG_IMPORT_STORAGE_KEY,
		normalizeBookmarkletPayload,
		type UgBookmarkletPayload
	} from '$lib/ugImport';
	import { normalizeAccidentals, normalizeRawInputAccidentals } from '$lib/chordFormatter';

	let payload = $state<UgBookmarkletPayload | null>(null);
	let error = $state<string | null>(null);
	let saving = $state(false);
	let title = $state('');
	let artist = $state('');
	let key = $state('');
	let capo = $state<number | undefined>(undefined);
	let rows = $state<Row[]>([{ kind: 'blank' }]);
	const barsPerLine: 2 | 4 | 8 = 4;

	function adoptPayload(next: UgBookmarkletPayload): void {
		payload = next;
		title = next.title;
		artist = next.artist;
		key = next.keyGuess ?? '';
		capo = next.capo;
		const rawNormalized = normalizeRawInputAccidentals(next.rawInput);
		rows = normalizeImportedChordSpacing(parseRows(rawNormalized));
		error = null;
		if (browser) {
			sessionStorage.setItem(UG_IMPORT_STORAGE_KEY, JSON.stringify(next));
		}
	}

	$effect(() => {
		if (!authState.loading && !authState.user && payload) {
			goto('/login?next=/ug-import');
		}
	});

	$effect(() => {
		if (!browser) return;
		const saved = sessionStorage.getItem(UG_IMPORT_STORAGE_KEY);
		if (saved && !payload) {
			try {
				adoptPayload(normalizeBookmarkletPayload(JSON.parse(saved)));
			} catch {
				sessionStorage.removeItem(UG_IMPORT_STORAGE_KEY);
			}
		}

		function onMessage(e: MessageEvent) {
			if (!/https:\/\/(www\.|tabs\.)?ultimate-guitar\.com$/.test(e.origin)) return;
			try {
				adoptPayload(normalizeBookmarkletPayload(e.data));
			} catch (err) {
				error = err instanceof Error ? err.message : 'Kunne ikke læse UG-importen.';
			}
		}
		window.addEventListener('message', onMessage);
		return () => window.removeEventListener('message', onMessage);
	});

	const canSave = $derived(
		!!payload && title.trim().length > 0 && serializeRows(rows).trim().length > 0 && !saving
	);

	async function saveImportedSong(): Promise<void> {
		if (!authState.user || !payload) return;
		saving = true;
		error = null;
		try {
			const importedRows = normalizeImportedChordSpacing(rows);
			const rawInput = serializeRows(importedRows);
			const bassLines = inferBassLinesForImportedRows(importedRows, barsPerLine);
			const id = await createSong(
				{
					title: title.trim(),
					...(artist.trim() ? { artist: artist.trim() } : {}),
					...(key.trim() ? { key: normalizeAccidentals(key.trim()) } : {}),
					...(capo !== undefined ? { capo } : {}),
					rawInput,
					rows: importedRows,
					barsPerLine,
					...(Object.keys(bassLines).length > 0 ? { bassLines } : {}),
					categories: [],
					fitSinglePage: true,
					schemaVersion: 4,
					...(payload.sourceUrl ? { sourceUrl: payload.sourceUrl } : {})
				},
				authState.user.uid
			);
			sessionStorage.removeItem(UG_IMPORT_STORAGE_KEY);
			goto('/songbook');
		} catch (err) {
			error = err instanceof Error ? err.message : 'Kunne ikke gemme sangen.';
		} finally {
			saving = false;
		}
	}
</script>

<svelte:head><title>UG-import · Fællesbandet</title></svelte:head>

<main class="mx-auto max-w-4xl px-6 py-10">
	<a
		href="/songbook/new"
		class="text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
		>← Tilbage til tilføj sang</a
	>

	<header class="mt-3 mb-6">
		<h1 class="font-display text-3xl font-bold text-[var(--color-accent)]">UG-import</h1>
		<p class="mt-1 text-sm text-[var(--color-ink-faint)]">
			Åbn en Ultimate Guitar chord-side og klik bookmarkletten
			<span class="font-semibold">Send til Fællesbandet</span>. Importen dukker op her.
		</p>
	</header>

	{#if error}
		<div class="mb-5 rounded-md border border-[var(--color-error)] bg-[#3a1212] p-3 text-sm text-[var(--color-error)]">
			{error}
		</div>
	{/if}

	{#if !payload}
		<section class="card p-8 text-center">
			<p class="text-lg font-semibold text-[var(--color-ink)]">Venter på UG-data…</p>
			<p class="mx-auto mt-2 max-w-xl text-sm text-[var(--color-ink-muted)]">
				Hvis du lige har klikket bookmarkletten, så vent et øjeblik. Hvis intet sker,
				så sørg for at du står på en konkret chord-side på Ultimate Guitar.
			</p>
		</section>
	{:else}
		<section class="card p-6">
			<div class="grid gap-4 sm:grid-cols-2">
				<div>
					<label for="title" class="form-label">Titel</label>
					<input id="title" bind:value={title} class="form-input" />
				</div>
				<div>
					<label for="artist" class="form-label">Kunstner</label>
					<input id="artist" bind:value={artist} class="form-input" />
				</div>
				<div>
					<label for="key" class="form-label">Toneart</label>
					<input id="key" bind:value={key} class="form-input" placeholder="Valgfri" />
				</div>
				<div>
					<label for="capo" class="form-label">Capo</label>
					<input
						id="capo"
						type="number"
						min="0"
						bind:value={capo}
						class="form-input"
						placeholder="Valgfri"
					/>
				</div>
			</div>

			{#if payload.sourceUrl}
				<p class="mt-4 text-xs text-[var(--color-ink-faint)]">
					Kilde:
					<a
						href={payload.sourceUrl}
						target="_blank"
						rel="noopener noreferrer"
						class="text-[var(--color-accent)] underline"
					>
						{payload.sourceUrl}
					</a>
				</p>
			{/if}

			<div class="mt-5 rounded-lg border border-dashed border-[var(--color-border)] bg-white p-4">
				<EditableSong {rows} {barsPerLine} onRowsChange={(next) => (rows = next)} />
			</div>

			<div class="mt-5 flex justify-end">
				<button type="button" class="btn-primary" disabled={!canSave} onclick={saveImportedSong}>
					{saving ? 'Gemmer…' : 'Gem sang'}
				</button>
			</div>
		</section>
	{/if}
</main>

<style>
	.form-label {
		display: block;
		margin-bottom: 0.35rem;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--color-ink-faint);
	}
	.form-input {
		width: 100%;
		border-radius: var(--radius-button);
		border: 1px solid var(--color-border);
		background: var(--color-bg-elevated);
		color: var(--color-ink-on-dark);
		padding: 0.65rem 0.8rem;
	}
	.form-input:focus {
		outline: none;
		border-color: var(--color-accent);
	}
</style>
