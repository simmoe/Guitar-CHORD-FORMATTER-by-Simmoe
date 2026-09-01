<script lang="ts">
	import { sectionHeaderType } from '$lib/chordFormatter';
	import { buildSections, parseRows, type Row } from '$lib/songParse';
	import type { CategoryMeta, SongDoc } from '$lib/types';
	import SongbookToc from './SongbookToc.svelte';
	import {
		buildSongbookTocPages,
		tocPageCountForSongs,
		type SongbookTocPage
	} from '$lib/songbookToc';

	interface Props {
		title: string;
		songs: SongDoc[];
		categoryMeta?: CategoryMeta;
	}

	const { title, songs, categoryMeta }: Props = $props();

	type AudienceLine =
		| { kind: 'lyric'; text: string }
		| { kind: 'label'; text: string }
		| { kind: 'blank' };

	interface AudienceSong {
		id: string;
		title: string;
		artist?: string;
		lines: AudienceLine[];
		page: number;
		columnClass: string;
		scale: number;
	}

	const baseSongs = $derived(songs.map(toAudienceSong).filter((song) => song.lines.length > 0));
	const tocPageCount = $derived(tocPageCountForSongs(baseSongs.length));
	const firstSongPage = $derived(2 + tocPageCount);
	const audienceSongs = $derived(assignPages(baseSongs, firstSongPage));
	const tocPages = $derived(buildTocPages(audienceSongs));

	function rowsFor(song: SongDoc): Row[] {
		return song.rows ?? parseRows(song.rawInput ?? '');
	}

	function toAudienceSong(song: SongDoc): AudienceSong {
		const rows = rowsFor(song);
		const sections = buildSections(rows);
		const lines: AudienceLine[] = [];
		let hasRenderedChorus = false;

		if (sections.length === 0) {
			for (const row of rows) appendAudienceRow(lines, row);
		} else {
			for (const section of sections) {
				if (sectionHeaderType(section.headerText) === 'chorus') {
					if (hasRenderedChorus) {
						appendBlank(lines);
						appendLabel(lines, cleanChorusLabel(section.headerText));
						continue;
					}
					appendBlank(lines);
					appendLabel(lines, cleanChorusLabel(section.headerText));
					hasRenderedChorus = true;
				} else {
					appendBlank(lines);
				}
				for (let i = section.bodyStart; i < section.bodyEnd; i++) {
					appendAudienceRow(lines, rows[i]);
				}
			}
		}

		return {
			id: song.id,
			title: song.title,
			artist: song.artist,
			lines: trimAudienceLines(lines),
			page: 0,
			columnClass: 'audience-lines--one',
			scale: 1
		};
	}

	function appendAudienceRow(lines: AudienceLine[], row: Row | undefined): void {
		if (!row) return;
		if (row.kind === 'chord') return;
		if (row.kind === 'header') {
			appendBlank(lines);
			return;
		}
		if (row.kind === 'lyric') {
			lines.push({ kind: 'lyric', text: row.text });
			return;
		}
		appendBlank(lines);
	}

	function appendBlank(lines: AudienceLine[]): void {
		if (lines.at(-1)?.kind !== 'blank') lines.push({ kind: 'blank' });
	}

	function appendLabel(lines: AudienceLine[], text: string): void {
		const lastNonBlank = [...lines].reverse().find((line) => line.kind !== 'blank');
		if (lastNonBlank?.kind === 'label' && lastNonBlank.text === text) return;
		lines.push({ kind: 'label', text });
	}

	function cleanChorusLabel(headerText: string): string {
		const trimmed = headerText.trim();
		return trimmed || 'Omkvæd';
	}

	function trimAudienceLines(lines: AudienceLine[]): AudienceLine[] {
		let start = 0;
		let end = lines.length;
		while (start < end && lines[start].kind === 'blank') start++;
		while (end > start && lines[end - 1].kind === 'blank') end--;
		return lines.slice(start, end);
	}

	function songUnits(song: AudienceSong): number {
		const lyricCount = song.lines.filter((line) => line.kind === 'lyric').length;
		const labelCount = song.lines.filter((line) => line.kind === 'label').length;
		const blankCount = song.lines.length - lyricCount - labelCount;
		return lyricCount + labelCount * 0.8 + blankCount * 1.35;
	}

	function columnsForSong(song: AudienceSong): { columnClass: string; scale: number } {
		const units = songUnits(song);
		if (units <= 31) return { columnClass: 'audience-lines--one', scale: 1 };
		if (units <= 76) return { columnClass: 'audience-lines--two', scale: 1 };
		if (units <= 114) return { columnClass: 'audience-lines--three', scale: 1 };
		return {
			columnClass: 'audience-lines--three',
			scale: Math.max(0.76, Math.min(1, 114 / units))
		};
	}

	function assignPages(input: AudienceSong[], startPage: number): AudienceSong[] {
		return input.map((song, index) => ({
			...song,
			page: startPage + index,
			...columnsForSong(song)
		}));
	}

	function buildTocPages(input: AudienceSong[]): SongbookTocPage[] {
		return buildSongbookTocPages(
			input.map((song) => ({
				id: song.id,
				title: song.title,
				artist: song.artist,
				page: song.page
			}))
		);
	}
</script>

<article class="audience-book bg-white text-[#1f2933]">
	<section class="audience-page audience-cover" data-fit-single-page="false">
		{#if categoryMeta?.imageUrl}
			<img class="audience-cover-image" src={categoryMeta.imageUrl} alt="" crossorigin="anonymous" />
		{/if}
		<div class="audience-cover-copy">
			<p class="audience-kicker">Publikums-sangbog</p>
			<h1>{title}</h1>
			<p class="audience-count">{audienceSongs.length} {audienceSongs.length === 1 ? 'sang' : 'sange'}</p>
			{#if categoryMeta?.introText?.trim()}
				<p class="audience-intro">{categoryMeta.introText.trim()}</p>
			{/if}
		</div>
	</section>

	<SongbookToc pages={tocPages} />

	{#each audienceSongs as song (song.id)}
		<section class="audience-page audience-song-page" data-fit-single-page="false">
			<section class="audience-song" style:--song-scale={song.scale}>
				<header>
					<h2>{song.title}</h2>
					{#if song.artist}<p>{song.artist}</p>{/if}
				</header>
				<div class="audience-lines {song.columnClass}">
					{#each song.lines as line}
						{#if line.kind === 'lyric'}
							<p>{line.text}</p>
						{:else if line.kind === 'label'}
							<p class="audience-repeat-label">{line.text}</p>
						{:else}
							<div class="audience-blank"></div>
						{/if}
					{/each}
				</div>
			</section>
			<footer class="audience-page-number">{song.page}</footer>
		</section>
	{/each}
</article>

<style>
	.audience-book {
		width: 210mm;
		font-family: var(--font-sans);
		--audience-rule: #d7b56d;
	}
	.audience-page {
		box-sizing: border-box;
		width: 210mm;
		height: 297mm;
		padding: 18mm 20mm;
		background: #ffffff;
		page-break-after: always;
		break-after: page;
		position: relative;
		overflow: hidden;
	}
	.audience-cover {
		display: grid;
		align-content: end;
		gap: 10mm;
		background: linear-gradient(180deg, #fffbf3 0%, #ffffff 55%);
	}
	.audience-cover-image {
		width: 100%;
		height: 120mm;
		object-fit: cover;
		border-radius: 12px;
		box-shadow: 0 18px 40px rgba(15, 23, 42, 0.18);
	}
	.audience-cover-copy {
		max-width: 140mm;
	}
	.audience-kicker {
		margin: 0 0 4mm;
		color: #9a6a12;
		font-size: 11pt;
		font-weight: 800;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}
	.audience-cover h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 34pt;
		line-height: 0.95;
		color: #172033;
	}
	.audience-count {
		margin: 5mm 0 0;
		color: #6b7280;
		font-size: 12pt;
	}
	.audience-intro {
		margin: 9mm 0 0;
		font-size: 13pt;
		line-height: 1.55;
		color: #334155;
	}
	.audience-song-page {
		padding-top: 20mm;
		padding-bottom: 17mm;
	}
	.audience-song {
		height: 252mm;
		transform: scale(var(--song-scale, 1));
		transform-origin: top left;
		width: calc(100% / var(--song-scale, 1));
		overflow: hidden;
	}
	.audience-song header {
		margin-bottom: 5mm;
		padding-bottom: 3mm;
		border-bottom: 1px solid #dcc48d;
	}
	.audience-song h2 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 16pt;
		line-height: 1.08;
		color: #172033;
	}
	.audience-song header p {
		margin: 1mm 0 0;
		color: #64748b;
		font-size: 9.5pt;
		font-style: italic;
	}
	.audience-lines {
		column-fill: auto;
		column-gap: 11mm;
		font-family: Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif;
	}
	.audience-lines--one {
		columns: 1;
		max-width: 118mm;
	}
	.audience-lines--two {
		columns: 2;
	}
	.audience-lines--three {
		columns: 3;
		column-gap: 8mm;
	}
	.audience-lines p {
		margin: 0 0 1.2mm;
		font-size: 15.4pt;
		line-height: 1.24;
		color: #1f2937;
		white-space: pre-wrap;
	}
	.audience-lines .audience-repeat-label {
		margin: 2.4mm 0 1.7mm;
		color: #9a6a12;
		font-family: var(--font-display);
		font-size: 13.2pt;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.audience-blank {
		height: 3.2mm;
	}
	.audience-page-number {
		position: absolute;
		right: 20mm;
		bottom: 8mm;
		color: #9ca3af;
		font-family: var(--font-display);
		font-size: 9pt;
	}
</style>
