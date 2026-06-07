<script lang="ts">
	import { BAND } from '$lib/data/band';
	import type { CategoryMeta } from '$lib/types';

	interface Props {
		title: string;
		songCount: number;
		categoryMeta?: CategoryMeta;
	}

	const { title, songCount, categoryMeta }: Props = $props();
</script>

<article class="chord-cover-page">
	<div class="chord-cover-mark">{BAND.name}</div>
	{#if categoryMeta?.imageUrl}
		<img class="chord-cover-image" src={categoryMeta.imageUrl} alt="" crossorigin="anonymous" />
	{/if}
	<div class="chord-cover-copy">
		<p class="chord-cover-kicker">Akkordbog</p>
		<h1>{title}</h1>
		<p class="chord-cover-count">{songCount} {songCount === 1 ? 'sang' : 'sange'}</p>
		{#if categoryMeta?.introText?.trim()}
			<p class="chord-cover-intro">{categoryMeta.introText.trim()}</p>
		{/if}
	</div>
</article>

<style>
	.chord-cover-page {
		box-sizing: border-box;
		width: 210mm;
		min-height: 297mm;
		display: grid;
		grid-template-rows: auto minmax(0, 1fr) auto;
		gap: 14mm;
		padding: 22mm 20mm;
		background: #fbfaf7;
		color: #151a22;
		font-family: var(--font-sans);
		overflow: hidden;
	}

	.chord-cover-mark {
		color: #7b6f62;
		font-size: 8.5pt;
		font-weight: 700;
		letter-spacing: 0.16em;
		text-transform: uppercase;
	}

	.chord-cover-image {
		width: 100%;
		height: 150mm;
		object-fit: cover;
		border-radius: 18px;
		box-shadow: 0 24px 60px rgba(15, 23, 42, 0.13);
	}

	.chord-cover-copy {
		max-width: 130mm;
		align-self: end;
	}

	.chord-cover-kicker {
		margin: 0 0 5mm;
		color: #9a6a12;
		font-size: 9pt;
		font-weight: 700;
		letter-spacing: 0.14em;
		text-transform: uppercase;
	}

	.chord-cover-copy h1 {
		margin: 0;
		font-family: var(--font-display);
		font-size: 34pt;
		font-weight: 800;
		line-height: 0.96;
		letter-spacing: -0.035em;
		color: #111827;
	}

	.chord-cover-count {
		margin: 5mm 0 0;
		color: #6b7280;
		font-size: 11pt;
		font-weight: 500;
	}

	.chord-cover-intro {
		max-width: 110mm;
		margin: 7mm 0 0;
		color: #3f4652;
		font-size: 11pt;
		line-height: 1.5;
	}
</style>
