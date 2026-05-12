/**
 * Ultimate Guitar parser & fetcher.
 *
 * UG renderer alle deres tab-sider med en SPA, men HTML'en indeholder
 * et komplet datadump i `<div class="js-store" data-content="ENCODED">`.
 * data-content er HTML-encodet JSON. Den struktur har historisk været
 * stabil — `store.page.data.tab` for metadata og
 * `store.page.data.tab_view.wiki_tab.content` for selve teksten.
 *
 * Søgning: samme js-store-trick — `store.page.data.results` indeholder
 * søgeresultater med type ("Chords", "Tab", etc), url, song_name og
 * artist_name. Vi vælger første resultat af typen "Chords" med højest
 * rating.
 */

/**
 * Headers der gør Cloud Function-requests så browser-lignende som muligt.
 * UG's tab-sider returnerer 403 ved minimal headers; med en realistisk
 * "fetch from Chrome on macOS"-signatur kommer vi typisk igennem.
 */
const UG_HEADERS: Record<string, string> = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
	Accept:
		'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9,da;q=0.8',
	'Accept-Encoding': 'gzip, deflate, br',
	'Cache-Control': 'no-cache',
	Pragma: 'no-cache',
	'Sec-Ch-Ua': '"Chromium";v="123", "Not:A-Brand";v="8", "Google Chrome";v="123"',
	'Sec-Ch-Ua-Mobile': '?0',
	'Sec-Ch-Ua-Platform': '"macOS"',
	'Sec-Fetch-Dest': 'document',
	'Sec-Fetch-Mode': 'navigate',
	'Sec-Fetch-Site': 'none',
	'Sec-Fetch-User': '?1',
	'Upgrade-Insecure-Requests': '1'
};

export interface UgFetchResult {
	title: string;
	artist: string;
	rawInput: string;
	sourceUrl: string;
	keyGuess?: string;
	tuning?: string;
	capo?: number;
}

export interface UgSearchHit {
	title: string;
	artist: string;
	url: string;
	rating: number;
	votes: number;
}

const UG_URL_REGEX = /^https?:\/\/(www\.)?(tabs\.)?ultimate-guitar\.com\//i;

/** Hovedfunktionen kaldt fra fetchUgTab callable. */
export async function fetchUg(input: string): Promise<UgFetchResult> {
	const trimmed = input.trim();
	if (!trimmed) throw new Error('Empty input');

	if (UG_URL_REGEX.test(trimmed)) {
		return fetchTabPage(trimmed);
	}

	const { hits, searchUrl } = await searchUg(trimmed);
	if (hits.length === 0) {
		throw new Error('Ingen akkord-resultater fundet på Ultimate Guitar');
	}
	// Vælg den med flest stemmer (rating × votes-vægtning).
	const best = hits.sort(
		(a, b) =>
			b.rating * Math.log10(b.votes + 1) - a.rating * Math.log10(a.votes + 1)
	)[0];
	return fetchTabPage(best.url, searchUrl);
}

async function searchUg(
	query: string
): Promise<{ hits: UgSearchHit[]; searchUrl: string }> {
	const url = `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(
		query
	)}`;
	const html = await fetchHtml(url);
	const data = extractJsStore(html);

	// I søgeresultater ligger results enten på store.page.data.results eller
	// store.page.data.results.array — UG har skiftet over årene. Vi prøver
	// først den nye struktur og fallbacker.
	const pageData = data?.store?.page?.data;
	const rawResults: unknown =
		pageData?.results ??
		pageData?.tabs?.tabs ??
		pageData?.tabs ??
		[];
	const results = Array.isArray(rawResults) ? rawResults : [];

	const hits: UgSearchHit[] = [];
	for (const r of results) {
		const item = r as Record<string, unknown>;
		const type = String(item.type ?? item.tab_type ?? '');
		if (type !== 'Chords') continue;
		const tabUrl = String(item.tab_url ?? item.url ?? '');
		if (!tabUrl) continue;
		hits.push({
			title: String(item.song_name ?? item.title ?? ''),
			artist: String(item.artist_name ?? item.artist ?? ''),
			url: tabUrl,
			rating: Number(item.rating ?? 0),
			votes: Number(item.votes ?? 0)
		});
	}
	return { hits, searchUrl: url };
}

async function fetchTabPage(url: string, refererUrl?: string): Promise<UgFetchResult> {
	const html = await fetchHtml(url, refererUrl);
	const data = extractJsStore(html);
	const tab = data?.store?.page?.data?.tab;
	const wiki = data?.store?.page?.data?.tab_view?.wiki_tab;
	const meta = data?.store?.page?.data?.tab_view?.meta;

	if (!tab || !wiki?.content) {
		throw new Error('Kunne ikke parse tab-data fra Ultimate Guitar');
	}

	const rawInput = cleanUgContent(String(wiki.content));
	const title = String(tab.song_name ?? tab.title ?? '');
	const artist = String(tab.artist_name ?? tab.artist ?? '');
	const tuning = meta?.tuning?.value ? String(meta.tuning.value) : undefined;
	const capo = meta?.capo ? Number(meta.capo) : undefined;
	const keyGuess = meta?.tonality ? String(meta.tonality) : undefined;

	return {
		title,
		artist,
		rawInput,
		sourceUrl: url,
		...(keyGuess ? { keyGuess } : {}),
		...(tuning ? { tuning } : {}),
		...(capo !== undefined ? { capo } : {})
	};
}

/**
 * UG blokerer Cloud Functions IP'er direkte (403 selv med browser-headers).
 * Vi proxier via corsproxy.io som allerede har løst bot-detection.
 * Hvis direkte fetch lykkes, bruger vi det; ellers falder vi tilbage til proxy.
 */
async function fetchHtml(url: string, refererUrl?: string): Promise<string> {
	const headers: Record<string, string> = { ...UG_HEADERS };
	if (refererUrl) {
		headers['Referer'] = refererUrl;
		headers['Sec-Fetch-Site'] = 'same-origin';
	}

	try {
		const res = await fetch(url, { headers, redirect: 'follow' });
		if (res.ok) return await res.text();
		// 403/429 → fald gennem til proxy
	} catch {
		// netværksfejl → fald gennem til proxy
	}

	const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
	const proxyRes = await fetch(proxyUrl, {
		headers: { 'User-Agent': UG_HEADERS['User-Agent'] },
		redirect: 'follow'
	});
	if (!proxyRes.ok) {
		throw new Error(
			`Ultimate Guitar (via proxy) svarede HTTP ${proxyRes.status} på ${url}`
		);
	}
	return await proxyRes.text();
}

/** Find <div class="js-store" data-content="..."> og JSON-parse data-content. */
function extractJsStore(html: string): any {
	const m = html.match(/<div\s+class="js-store"[^>]*data-content="([^"]*)"/);
	if (!m) throw new Error('Kunne ikke finde js-store på Ultimate Guitar siden');
	const decoded = htmlDecode(m[1]);
	try {
		return JSON.parse(decoded);
	} catch (err) {
		throw new Error('js-store JSON kunne ikke parses: ' + (err as Error).message);
	}
}

/**
 * UG bruger almindelig HTML-entity-encoding på data-content. Vi dekoder
 * navngivne entities (æ, ø, å, é, …) + numeriske `&#229;` / `&#xE5;` så
 * danske tekster ikke ender som `Lyse N&aelig;tter` i rawInput.
 */
const NAMED_HTML_ENTITIES: Record<string, string> = {
	amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
	nbsp: '\u00a0', hellip: '…', ndash: '–', mdash: '—',
	lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
	aelig: 'æ', AElig: 'Æ',
	oslash: 'ø', Oslash: 'Ø',
	aring: 'å', Aring: 'Å',
	auml: 'ä', Auml: 'Ä',
	ouml: 'ö', Ouml: 'Ö',
	uuml: 'ü', Uuml: 'Ü',
	szlig: 'ß',
	eacute: 'é', Eacute: 'É',
	egrave: 'è', Egrave: 'È',
	ecirc: 'ê', Ecirc: 'Ê',
	euml: 'ë', Euml: 'Ë',
	agrave: 'à', Agrave: 'À',
	acirc: 'â', Acirc: 'Â',
	atilde: 'ã', Atilde: 'Ã',
	ccedil: 'ç', Ccedil: 'Ç',
	iacute: 'í', Iacute: 'Í',
	igrave: 'ì', Igrave: 'Ì',
	icirc: 'î', Icirc: 'Î',
	iuml: 'ï', Iuml: 'Ï',
	oacute: 'ó', Oacute: 'Ó',
	ograve: 'ò', Ograve: 'Ò',
	ocirc: 'ô', Ocirc: 'Ô',
	otilde: 'õ', Otilde: 'Õ',
	uacute: 'ú', Uacute: 'Ú',
	ugrave: 'ù', Ugrave: 'Ù',
	ucirc: 'û', Ucirc: 'Û',
	ntilde: 'ñ', Ntilde: 'Ñ',
	yacute: 'ý', Yacute: 'Ý'
};

function htmlDecode(s: string): string {
	if (!s || s.indexOf('&') === -1) return s;
	return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (full, body) => {
		if (body[0] === '#') {
			const hex = body[1] === 'x' || body[1] === 'X';
			const num = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
			if (Number.isFinite(num) && num > 0 && num < 0x110000) {
				try {
					return String.fromCodePoint(num);
				} catch {
					return full;
				}
			}
			return full;
		}
		return NAMED_HTML_ENTITIES[body] ?? full;
	});
}

/**
 * UG markup → vores rawInput-format.
 * UG bruger:
 *   [ch]Am[/ch]                   → bare "Am"
 *   [tab]...[/tab]                → uændret indhold (kun fjern tags)
 *   \r\n                          → \n
 *   [Verse 1]                     → uændret (vi parser det som section header)
 *
 * Derudover smider vi:
 *  - al "tab info" væk der står FORAN første section-header
 *    (titel-genstart, transcription credits, akkord-diagrammer osv)
 *  - alle "post-song"-tilføjelser EFTER sangen — fx capo-tabeller
 *    (D = C, G = F osv), "Alternates:"-sektioner, "Capo II"-subheaders
 *    og "Open (...)"-sektioner. Det er typisk UG-noter som ikke hører
 *    til på sangbogs-printet.
 */
export function cleanUgContent(s: string): string {
	let cleaned = s
		.replace(/\r\n/g, '\n')
		.replace(/\[ch\]([\s\S]*?)\[\/ch\]/g, '$1')
		.replace(/\[\/?tab\]/g, '')
		.replace(/\u00a0/g, ' ')
		.trim();

	const SECTION_HEADER = /^\s*\[[^\]\n]+\]\s*$/m;
	const m = cleaned.match(SECTION_HEADER);
	if (m && typeof m.index === 'number' && m.index > 0) {
		cleaned = cleaned.slice(m.index).trim();
	}

	cleaned = stripTrailingUgJunk(cleaned);
	return cleaned;
}

/**
 * Skær alt fra første "post-song"-marker. Mønstre er bevidst snævre så
 * vi ikke risikerer at skære i selve sangen:
 *   - "Capo II" / "Capo V" / "Capo 5" subheaders
 *   - chord-equals-chord lines (capo transposition tables): "D = C"
 *   - "** Alternates:" / "* Alternate" sektion-headers
 *   - "Open (These chords are not in the original key)"
 */
function stripTrailingUgJunk(text: string): string {
	const CHORD_TOKEN = '[A-G][#b]?(?:m|maj|min|dim|sus|add)?\\d?';
	const JUNK_PATTERNS: RegExp[] = [
		/^\s*Capo\s+(?:I+|VI*|IX|X|\d+)\s*$/i,
		new RegExp(`^\\s*${CHORD_TOKEN}\\s*=\\s*${CHORD_TOKEN}\\s*$`),
		/^\s*\*+\s*Alternates?\b/i,
		/^\s*Open\s*\(/i
	];

	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (JUNK_PATTERNS.some((rx) => rx.test(line))) {
			// Rul evt. en blank linje TILBAGE før cuttet, så vi ikke
			// efterlader trailing whitespace.
			let cutIdx = i;
			while (cutIdx > 0 && lines[cutIdx - 1].trim() === '') cutIdx--;
			return lines.slice(0, cutIdx).join('\n').trimEnd();
		}
	}
	return text;
}
