<script lang="ts">
	import { goto } from '$app/navigation';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import { createSong, subscribeSongs } from '$lib/firebase/songs';
	import { fetchUgTab } from '$lib/firebase/ug';
	import {
		uniqueCategoriesFromSongs,
		normalizeRawInputAccidentals,
		normalizeAccidentals
	} from '$lib/chordFormatter';
	import EditableSong from '$lib/components/EditableSong.svelte';
	import SongMetaForm from '$lib/components/SongMetaForm.svelte';
	import { inferBassLinesForImportedRows } from '$lib/migrate';
	import {
		normalizeImportedChordSpacing,
		parseRows,
		serializeRows,
		type Row
	} from '$lib/songParse';
	import type { SongDoc } from '$lib/types';

	$effect(() => {
		if (!authState.loading && !authState.user) goto('/login');
	});

	let allSongs = $state<SongDoc[]>([]);
	$effect(() => {
		if (!authState.user) return;
		const unsub = subscribeSongs((s) => (allSongs = s));
		return () => unsub();
	});
	const knownCategories = $derived(uniqueCategoriesFromSongs(allSongs));

	// ───── Primært flow: bare skriv en titel og lad UG-fetch ordne resten ─────
	let query = $state('');
	let artistQuery = $state('');
	let fetching = $state(false);
	let fetchError = $state<string | null>(null);

	const URL_RX = /^https?:\/\//i;

	async function handleAutoFetch() {
		if (!authState.user) return;
		const t = query.trim();
		if (!t) return;
		const a = artistQuery.trim();
		// Hvis brugeren har pastet en URL i titel-feltet, send kun den.
		// Ellers kombinér titel + kunstner som UG søger på.
		const q = URL_RX.test(t) ? t : a ? `${t} ${a}` : t;
		fetching = true;
		fetchError = null;
		try {
			const ug = await fetchUgTab(q);
			const artistVal = ug.artist || a || undefined;
			// Engangs-konvertering ved import: parse den rå UG-tekst til
			// strukturerede rows og gem som ny v4-form.
			const rawNormalized = normalizeRawInputAccidentals(ug.rawInput);
			const importedRows = normalizeImportedChordSpacing(parseRows(rawNormalized));
			const barsPL: 2 | 4 | 8 = 4;
			const bassLines = inferBassLinesForImportedRows(importedRows, barsPL);
			const id = await createSong(
				{
					title: ug.title || t,
					...(artistVal ? { artist: artistVal } : {}),
					...(ug.keyGuess ? { key: normalizeAccidentals(ug.keyGuess) } : {}),
					rawInput: serializeRows(importedRows),
					rows: importedRows,
					barsPerLine: barsPL,
					...(Object.keys(bassLines).length > 0 ? { bassLines } : {}),
					categories: [],
					schemaVersion: 4,
					...(ug.sourceUrl ? { sourceUrl: ug.sourceUrl } : {}),
					...(ug.capo !== undefined ? { capo: ug.capo } : {})
				},
				authState.user.uid
			);
			goto(`/song/${id}`);
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Ukendt fejl';
			fetchError = `Kunne ikke hente fra Ultimate Guitar: ${msg}. Prøv at finde sangen på ultimate-guitar.com og indsæt dens URL — eller udfyld den manuelt nedenfor.`;
		} finally {
			fetching = false;
		}
	}

	// ───── Manuelt flow (folde-ud) ────────────────────────────────────────────
	let manualOpen = $state(false);
	let title = $state('');
	let artist = $state('');
	let key = $state('');
	let barsPerLine = $state<2 | 4 | 8>(4);
	let categories = $state<string[]>([]);
	let rows = $state<Row[]>([{ kind: 'blank' }]);

	let saving = $state(false);
	let saveError = $state<string | null>(null);

	function onMetaChange(next: {
		title: string;
		artist: string;
		key: string;
		barsPerLine: 2 | 4 | 8;
		categories: string[];
	}) {
		title = next.title;
		artist = next.artist;
		key = next.key;
		barsPerLine = next.barsPerLine;
		categories = next.categories;
	}

	const canSaveManual = $derived(
		title.trim().length > 0 && serializeRows(rows).trim().length > 0 && !saving
	);

	async function handleSaveManual() {
		if (!authState.user) return;
		saveError = null;
		saving = true;
		try {
			const importedRows = normalizeImportedChordSpacing(rows);
			const rawSerialized = serializeRows(importedRows);
			const bassLines = inferBassLinesForImportedRows(importedRows, barsPerLine);
			const id = await createSong(
				{
					title: title.trim(),
					...(artist.trim() ? { artist: artist.trim() } : {}),
					...(key.trim() ? { key: normalizeAccidentals(key.trim()) } : {}),
					rawInput: normalizeRawInputAccidentals(rawSerialized),
					rows: importedRows,
					barsPerLine,
					...(Object.keys(bassLines).length > 0 ? { bassLines } : {}),
					categories,
					schemaVersion: 4
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

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !fetching) {
			e.preventDefault();
			void handleAutoFetch();
		}
	}
</script>

<svelte:head><title>Tilføj sang · {BAND.name}</title></svelte:head>

<main class="mx-auto max-w-3xl px-6 py-10">
	<header class="mb-8">
		<a
			href="/songbook"
			class="text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-accent)]"
			>← Tilbage til sangbogen</a
		>
		<h1 class="mt-2 font-display text-3xl font-bold text-[var(--color-accent)]">Tilføj sang</h1>
		<p class="text-sm text-[var(--color-ink-faint)]">
			Skriv sangtitlen — så henter softwaren akkorder + tekst fra Ultimate Guitar og lægger
			sangen i sangmappen. Du kan altid finjustere bagefter.
		</p>
	</header>

	<!-- Primært flow: stort søgefelt -->
	<section class="card p-8">
		<label for="ug-query" class="form-label">Sangtitel</label>
		<input
			id="ug-query"
			type="text"
			bind:value={query}
			onkeydown={onSearchKey}
			disabled={fetching}
			placeholder="fx Baby Blue — eller indsæt en ultimate-guitar.com URL"
			class="mt-2 w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-[var(--color-ink-on-dark)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
		/>

		<label for="ug-artist" class="form-label mt-4 block">Kunstner <span class="optional">(valgfri — hjælper søgningen)</span></label>
		<input
			id="ug-artist"
			type="text"
			bind:value={artistQuery}
			onkeydown={onSearchKey}
			disabled={fetching}
			placeholder="fx Badfinger"
			class="mt-2 w-full rounded-[var(--radius-button)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-4 py-3 text-[var(--color-ink-on-dark)] placeholder:text-[var(--color-ink-faint)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
		/>

		<div class="mt-5 flex justify-end">
			<button
				type="button"
				class="btn-primary !text-base"
				style="padding: 0.75rem 2rem;"
				disabled={fetching || query.trim().length === 0}
				onclick={handleAutoFetch}
			>
				{fetching ? 'Henter…' : 'Find'}
			</button>
		</div>

		{#if fetchError}
			<div
				class="mt-4 rounded-md border border-[var(--color-error)] bg-[#3a1212] p-3 text-sm text-[var(--color-error)]"
			>
				{fetchError}
			</div>
		{/if}
	</section>

	<!-- Manuelt flow — folder ud kun hvis der er behov -->
	<section class="mt-6">
		<details bind:open={manualOpen} class="manual-details">
			<summary class="cursor-pointer rounded-[var(--radius-button)] border border-[var(--color-border)] bg-transparent px-4 py-3 text-sm font-semibold text-[var(--color-ink-on-dark)] hover:bg-white/5">
				Tilføj sangen manuelt i stedet
			</summary>

			<div class="card mt-3 p-6">
				<p class="mb-4 text-sm text-[var(--color-ink-muted)]">
					Hvis UG ikke kan finde sangen, kan du oprette den i hånden her. Skriv eller paste hele
					akkord+tekst-blokken i sangtekstboksen.
				</p>

				<SongMetaForm
					{title}
					{artist}
					{key}
					{barsPerLine}
					{categories}
					{knownCategories}
					onChange={onMetaChange}
				/>

				<div class="mt-5">
					<span class="form-label">Akkorder + tekst <span class="req">*</span></span>
					<p class="mt-1 mb-2 text-xs italic text-[var(--color-ink-faint)]">
						Akkord-linjer får automatisk monospace + blå farve; tekst-linjer bliver fede;
						<code>[Verse 1]</code> bliver til en pille-header.
					</p>
					<div class="paste-area-wrap">
						<EditableSong
							{rows}
							{barsPerLine}
							onRowsChange={(next) => (rows = next)}
						/>
					</div>
				</div>

				{#if saveError}
					<p class="mt-3 text-sm text-[var(--color-error)]">{saveError}</p>
				{/if}
				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="btn-primary"
						disabled={!canSaveManual}
						onclick={handleSaveManual}
					>
						{saving ? 'Gemmer…' : 'Gem sang'}
					</button>
				</div>
			</div>
		</details>
	</section>
</main>

<style>
	.form-label {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-ink-faint);
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.req {
		color: var(--color-error);
	}
	.optional {
		font-weight: 400;
		text-transform: none;
		letter-spacing: 0;
		color: var(--color-ink-faint);
		margin-left: 0.4em;
	}
	.paste-area-wrap {
		background: #ffffff;
		border-radius: 0.5rem;
		padding: 1rem;
		min-height: 18rem;
		border: 1px dashed var(--color-border);
		transition: border-color 120ms ease;
	}
	.paste-area-wrap:focus-within {
		border-color: var(--color-accent);
		border-style: solid;
	}
	.manual-details > summary {
		list-style: none;
	}
	.manual-details > summary::-webkit-details-marker {
		display: none;
	}
	.manual-details > summary::marker {
		content: '';
	}
	.manual-details > summary::before {
		content: '▸';
		display: inline-block;
		margin-right: 0.4em;
		transition: transform 160ms ease;
	}
	.manual-details[open] > summary::before {
		transform: rotate(90deg);
	}
</style>
