<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState } from '$lib/auth.svelte';
	import { BAND } from '$lib/data/band';
	import { subscribeSongs } from '$lib/firebase/songs';
	import PrintableSong from '$lib/components/PrintableSong.svelte';
	import { exportExistingPagesAsPdf } from '$lib/pdf';
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

	const bookTitle = $derived(category ?? `${BAND.name}s sangbog`);

	// Forvælgere — gemmes IKKE; kun aktive for det aktuelle print-besøg.
	let withBassTabs = $state(true);
	let fitSinglePage = $state(true);

	let pdfBusy = $state(false);

	async function doPdf() {
		if (pdfBusy || filtered.length === 0) return;
		pdfBusy = true;
		try {
			const pages = Array.from(document.querySelectorAll<HTMLElement>('.print-page'));
			await exportExistingPagesAsPdf(pages, {
				filename: bookTitle,
				withBassTabs,
				fitSinglePage
			});
		} catch (err) {
			console.error('PDF-eksport fejlede:', err);
			alert('Kunne ikke generere PDF — se konsollen for detaljer.');
		} finally {
			pdfBusy = false;
		}
	}
</script>

<svelte:head>
	<title>{bookTitle} · {BAND.name}</title>
</svelte:head>

<!-- Toolbar — skjules ved print -->
<header class="no-print sticky top-0 z-10 bg-[var(--color-bg)]/95 backdrop-blur">
	<div class="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-6 py-4">
		<a href="/songbook" class="btn-ghost">← Tilbage</a>
		<div class="flex-1">
			<h1 class="font-display text-lg font-bold text-[var(--color-accent)]">
				{bookTitle}
			</h1>
			<p class="text-xs text-[var(--color-ink-faint)]">
				{filtered.length} {filtered.length === 1 ? 'sang' : 'sange'} — én pr. side
			</p>
		</div>
		<label class="print-toggle">
			<input type="checkbox" bind:checked={withBassTabs} />
			Inkludér bass tabs
		</label>
		<label
			class="print-toggle"
			title="Skalér hver sang proportionalt så den fylder maks én A4-side"
		>
			<input type="checkbox" bind:checked={fitSinglePage} />
			Hold sang på en side
		</label>
		<button
			type="button"
			class="btn-secondary"
			onclick={doPdf}
			disabled={filtered.length === 0 || pdfBusy}
			title="Generér PDF og hent direkte"
		>
			{pdfBusy ? 'Genererer…' : 'Hent PDF'}
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
	<div class="mx-auto max-w-3xl px-6 py-6" class:no-bass-tabs={!withBassTabs}>
		<!-- Print-only forside: vises som en lille fed overskrift øverst på
		     første A4-side. Skjules på skærm. -->
		<div class="print-cover" aria-hidden="true">
			<h1>{bookTitle}</h1>
			<p>{filtered.length} {filtered.length === 1 ? 'sang' : 'sange'}</p>
		</div>

		{#each filtered as song (song.id)}
			<PrintableSong {song} />
		{/each}
	</div>
{/if}

<style>
	.print-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		font-size: 0.85rem;
		color: var(--color-ink-muted);
		cursor: pointer;
		user-select: none;
	}
	.print-toggle input {
		accent-color: var(--color-accent);
	}
	/* `.no-bass-tabs` reglerne ligger globalt i app.css så de gælder både
	   print-siden og enkelt-sang-siden. */
	.print-cover {
		display: none;
	}
	@media print {
		.print-cover {
			display: block;
			text-align: center;
			margin-bottom: 0.4cm;
			padding-bottom: 0.25cm;
			border-bottom: 1pt solid #000;
		}
		.print-cover h1 {
			font-family: var(--font-display, var(--font-sans));
			font-size: 18pt;
			font-weight: 800;
			color: #000;
			margin: 0;
			letter-spacing: 0.01em;
		}
		.print-cover p {
			font-size: 9pt;
			color: #444;
			margin: 0.1cm 0 0;
		}
	}
</style>
