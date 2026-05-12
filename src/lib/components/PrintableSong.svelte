<script lang="ts">
	/**
	 * Self-contained "én sang som A4-side" markup. Bruges både af
	 * `/print` og af PDF-export-utilen (som mounter komponenten
	 * off-screen for at fange et html2canvas-snapshot).
	 *
	 * Fra v4 er `song.rows` autoritativ; falder tilbage til `parseRows`
	 * af `rawInput` hvis et legacy-dokument slipper igennem.
	 */
	import EditableSong from './EditableSong.svelte';
	import { transposeBassLine } from '$lib/chordFormatter';
	import { parseRows, transposeRows } from '$lib/songParse';
	import type { BassLines, SongDoc } from '$lib/types';

	interface Props {
		song: SongDoc;
	}
	const { song }: Props = $props();

	const semitones = $derived(song.transpose ?? 0);
	const baseRows = $derived(song.rows ?? parseRows(song.rawInput ?? ''));
	const rows = $derived(transposeRows(baseRows, semitones));
	const bassLines = $derived(transposeBassLines(song.bassLines, semitones));

	function transposeBassLines(bl: BassLines | undefined, n: number): BassLines {
		if (!bl) return {};
		const out: BassLines = {};
		for (const [k, v] of Object.entries(bl)) out[k] = transposeBassLine(v, n);
		return out;
	}
</script>

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
	<EditableSong
		readOnly
		{rows}
		barsPerLine={song.barsPerLine}
		{bassLines}
		collapsedSections={song.collapsedSections ?? []}
	/>
</article>
