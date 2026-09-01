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
 * artist_name. Vi ranker først efter titel-/kunstner-relevans og bruger
 * kun rating/stemmer som tie-breaker mellem relevante matches.
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

/**
 * Detaljer vi vedhæfter en thrown Error (og som propageres til klienten
 * via HttpsError.details) så fallback-UI kan åbne den rigtige UG-side.
 */
export interface UgFetchErrorDetails {
	stage: 'search' | 'tab' | 'no-hits';
	searchUrl?: string;
	tabUrl?: string;
}

const UG_URL_REGEX = /^https?:\/\/(www\.)?(tabs\.)?ultimate-guitar\.com\//i;
const MIN_ACCEPTABLE_MATCH_SCORE = 0.58;

function buildSearchUrl(query: string): string {
	return `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(query)}`;
}

function attachDetails(err: unknown, details: UgFetchErrorDetails): Error {
	const e = err instanceof Error ? err : new Error(String(err));
	(e as Error & { details?: UgFetchErrorDetails }).details = details;
	return e;
}

/** Hovedfunktionen kaldt fra fetchUgTab callable. */
export async function fetchUg(input: string): Promise<UgFetchResult> {
	const trimmed = input.trim();
	if (!trimmed) throw new Error('Empty input');

	if (UG_URL_REGEX.test(trimmed)) {
		try {
			return await fetchTabPage(trimmed);
		} catch (err) {
			throw attachDetails(err, { stage: 'tab', tabUrl: trimmed });
		}
	}

	// UG's egen søgeside/Jina-HTML er langsom og rammer ofte Cloudflare.
	// Brug DuckDuckGo først; den er stabil fra Cloud Functions IP'er, og URL-
	// sluggen giver os nok titel/kunstner-data til relevans-ranking.
	let hits: UgSearchHit[] = [];
	let searchUrl = buildSearchUrl(trimmed);
	try {
		hits = await searchUgViaDuckDuckGo(trimmed);
	} catch {
		// DDG fejlede — fald gennem til UG/Jina-søgning nedenfor
	}
	if (hits.length === 0) {
		try {
			const r = await searchUg(trimmed);
			hits = r.hits;
			searchUrl = r.searchUrl;
		} catch (err) {
			throw attachDetails(err, { stage: 'search', searchUrl });
		}
	}
	if (hits.length === 0) {
		throw attachDetails(
			new Error('Ingen akkord-resultater fundet på Ultimate Guitar'),
			{ stage: 'no-hits', searchUrl }
		);
	}
	const ranked = rankSearchHits(trimmed, hits);
	if (ranked.length === 0) {
		throw attachDetails(
			new Error('Ingen relevante akkord-resultater fundet på Ultimate Guitar'),
			{ stage: 'no-hits', searchUrl }
		);
	}
	let lastErr: unknown = null;
	for (const hit of ranked.slice(0, 2)) {
		try {
			return await fetchTabPage(hit.url, searchUrl);
		} catch (err) {
			lastErr = err;
			// Næste relevante search-hit kan være en anden version af samme sang
			// hvor Jina's cached/rendered state faktisk kommer igennem Cloudflare.
		}
	}
	throw attachDetails(lastErr ?? new Error('Ingen UG-tab kunne hentes'), {
		stage: 'tab',
		tabUrl: ranked[0]?.url,
		searchUrl
	});
}

/**
 * Backup-søgning når UG's egen søgeside er blokeret af Cloudflare.
 * Bruger DuckDuckGo's no-JS HTML-frontend (`html.duckduckgo.com`) som
 * returnerer rene tab-URL'er — den er ikke Cloudflare-beskyttet og kommer
 * direkte igennem fra Cloud Functions IPs.
 */
async function searchUgViaDuckDuckGo(query: string): Promise<UgSearchHit[]> {
	const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(
		'site:ultimate-guitar.com chords ' + query
	)}`;
	const res = await fetch(url, {
		headers: { 'User-Agent': UG_HEADERS['User-Agent'] },
		redirect: 'follow'
	});
	if (!res.ok) {
		throw new Error(`DuckDuckGo backup-søgning HTTP ${res.status}`);
	}
	const html = await res.text();

	// DDG wrapper deres ydre links som /l/?uddg=<URL-encoded ægte URL>.
	// Vi udtrækker både direkte og wrapped URL'er, dedupe'r og holder
	// rækkefølgen (DDG rangordner allerede efter relevans).
	const seen = new Set<string>();
	const hits: UgSearchHit[] = [];
	const RX = /(?:uddg=|href="https?:\/\/)?(tabs\.ultimate-guitar\.com\/tab\/[a-z0-9-]+\/[a-z0-9-]+-chords-\d+)/gi;
	let m: RegExpExecArray | null;
	while ((m = RX.exec(html)) !== null) {
		let path = m[1];
		// uddg-versionen er URL-encoded; URL-decode en gang er nok her
		try {
			path = decodeURIComponent(path);
		} catch {
			// ikke encoded — brug som-er
		}
		const tabUrl = path.startsWith('http') ? path : `https://${path}`;
		if (seen.has(tabUrl)) continue;
		seen.add(tabUrl);
		const parsed = parseUgTabUrl(tabUrl);
		hits.push({
			title: parsed.title,
			artist: parsed.artist,
			url: tabUrl,
			// DDG giver os ikke rating/votes — vægt alle ens men prioritér rækkefølgen
			rating: 5 - hits.length * 0.1,
			votes: 100
		});
		if (hits.length >= 5) break;
	}
	return hits;
}

function parseUgTabUrl(url: string): { artist: string; title: string } {
	const match = url.match(/\/tab\/([^/]+)\/([^/]+)-chords-\d+/i);
	if (!match) return { artist: '', title: '' };
	return {
		artist: slugToWords(match[1]),
		title: slugToWords(match[2])
	};
}

function slugToWords(slug: string): string {
	return slug.replace(/-/g, ' ').trim();
}

async function searchUg(
	query: string
): Promise<{ hits: UgSearchHit[]; searchUrl: string }> {
	const url = buildSearchUrl(query);
	const html = await fetchHtmlForSearch(url);
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

function rankSearchHits(query: string, hits: UgSearchHit[]): UgSearchHit[] {
	const queryNorm = normalizeSearchText(query);
	const queryTokens = meaningfulTokens(queryNorm);
	if (queryTokens.length === 0) return [];

	return hits
		.map((hit) => ({ hit, score: scoreSearchHit(queryNorm, queryTokens, hit) }))
		.filter((entry) => entry.score.relevance >= MIN_ACCEPTABLE_MATCH_SCORE)
		.sort((a, b) => {
			if (b.score.relevance !== a.score.relevance) return b.score.relevance - a.score.relevance;
			return b.score.popularity - a.score.popularity;
		})
		.map((entry) => entry.hit);
}

function scoreSearchHit(
	queryNorm: string,
	queryTokens: string[],
	hit: UgSearchHit
): { relevance: number; popularity: number } {
	const titleNorm = normalizeSearchText(hit.title);
	const artistNorm = normalizeSearchText(hit.artist);
	const combinedNorm = normalizeSearchText(`${hit.title} ${hit.artist}`);
	const titleTokens = meaningfulTokens(titleNorm);
	const combinedTokens = meaningfulTokens(combinedNorm);

	const titleScore = phraseScore(queryNorm, titleNorm);
	const combinedScore = phraseScore(queryNorm, combinedNorm);
	const titleTokenScore = tokenContainmentScore(queryTokens, titleTokens);
	const combinedTokenScore = tokenContainmentScore(queryTokens, combinedTokens);

	let relevance = Math.max(
		titleScore,
		combinedScore * 0.94,
		titleTokenScore * 0.95,
		combinedTokenScore * 0.88
	);

	if (queryNorm === titleNorm) relevance += 0.2;
	if (artistNorm && queryNorm.includes(artistNorm)) relevance += 0.08;

	return {
		relevance: Math.min(relevance, 1.2),
		popularity: Number.isFinite(hit.rating) ? hit.rating * Math.log10(hit.votes + 1) : 0
	};
}

function normalizeSearchText(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/&/g, ' and ')
		.replace(/\bfeat(?:uring)?\b|\bft\b/g, ' ')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function meaningfulTokens(value: string): string[] {
	return value.split(' ').filter((token) => token.length > 1);
}

function phraseScore(queryNorm: string, candidateNorm: string): number {
	if (!candidateNorm) return 0;
	if (queryNorm === candidateNorm) return 1;
	if (candidateNorm.includes(queryNorm)) {
		return Math.max(0.72, queryNorm.length / candidateNorm.length);
	}
	if (queryNorm.includes(candidateNorm)) {
		return Math.max(0.68, candidateNorm.length / queryNorm.length);
	}
	return levenshteinSimilarity(queryNorm, candidateNorm);
}

function tokenContainmentScore(queryTokens: string[], candidateTokens: string[]): number {
	if (queryTokens.length === 0 || candidateTokens.length === 0) return 0;
	let matched = 0;
	for (const queryToken of queryTokens) {
		if (
			candidateTokens.some(
				(candidateToken) =>
					candidateToken === queryToken ||
					candidateToken.includes(queryToken) ||
					queryToken.includes(candidateToken)
			)
		) {
			matched++;
		}
	}
	return matched / queryTokens.length;
}

function levenshteinSimilarity(a: string, b: string): number {
	const maxLen = Math.max(a.length, b.length);
	if (maxLen === 0) return 1;

	const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
	const current = new Array<number>(b.length + 1);

	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				current[j - 1] + 1,
				previous[j] + 1,
				previous[j - 1] + cost
			);
		}
		for (let j = 0; j <= b.length; j++) previous[j] = current[j];
	}

	return 1 - previous[b.length] / maxLen;
}

async function fetchTabPage(url: string, refererUrl?: string): Promise<UgFetchResult> {
	const fetched = await fetchTabContent(url, refererUrl);
	if (fetched.kind === 'html') return parseTabFromHtml(fetched.text, url);
	return parseTabFromMarkdown(fetched.text, url);
}

function parseTabFromHtml(html: string, url: string): UgFetchResult {
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
 * Jina returnerer tab-siden som ren markdown med UG's egne sektion-headers
 * ([Intro], [Verse 1]) og chord/lyric-linjer i samme form som wiki_tab.content
 * efter cleanUgContent. Vi udtrækker title+artist fra Jina's H1
 * ("# WONDERWALL CHORDS (ver 2) by Oasis @ Ultimate-Guitar.Com") og lader
 * cleanUgContent finde første [Section] og smide UG-navigation væk.
 */
function parseTabFromMarkdown(md: string, url: string): UgFetchResult {
	const cleaned = cleanUgContent(md);
	if (!cleaned || cleaned.split('\n').length < 3) {
		throw new Error('Kunne ikke udlæse sang-indhold fra Ultimate Guitar (markdown)');
	}
	let title = '';
	let artist = '';
	const h1 = md.match(
		/^#\s+(.+?)\s+CHORDS(?:\s+\(ver\s*\d+\))?\s+by\s+([^\n@]+?)\s*@\s*Ultimate-?Guitar/im
	);
	if (h1) {
		title = toTitleCase(h1[1].trim());
		artist = h1[2].trim();
	} else {
		const tline = md.match(/^Title:\s*(.+?)\s*[-–]\s*(.+?)\s*\(Chords\)/im);
		if (tline) {
			artist = tline[1].trim();
			title = tline[2].trim();
		}
	}
	return { title, artist, rawInput: cleaned, sourceUrl: url };
}

function toTitleCase(s: string): string {
	return s
		.toLowerCase()
		.replace(/\b([a-zæøå])/g, (_, c) => c.toUpperCase());
}

interface FetchedHtml {
	kind: 'html';
	text: string;
}
interface FetchedMarkdown {
	kind: 'markdown';
	text: string;
}

/**
 * UG's søgeside har søgehits i `<div class="js-store" data-content="...">`,
 * også når Jina renderer den med X-Return-Format: html. Fallback kun:
 *   1. direkte fetch (typisk 403 fra Cloud Functions IP)
 *   2. Jina HTML-mode (samme js-store-struktur)
 */
async function fetchHtmlForSearch(url: string): Promise<string> {
	try {
		const res = await fetch(url, { headers: UG_HEADERS, redirect: 'follow' });
		if (res.ok) {
			const text = await res.text();
			if (text.includes('js-store')) return text;
		}
	} catch {
		// netværksfejl → fald gennem til Jina
	}

	const jinaHeaders: Record<string, string> = {
		'X-Return-Format': 'html',
		...(process.env.JINA_API_KEY
			? { Authorization: `Bearer ${process.env.JINA_API_KEY}` }
			: {})
	};
	let lastErr = '';
	for (let attempt = 0; attempt < 1; attempt++) {
		if (attempt > 0) await sleep(500 + attempt * 400);
		try {
			const res = await fetch(`https://r.jina.ai/${url}`, {
				headers: jinaHeaders,
				redirect: 'follow'
			});
			if (!res.ok) {
				lastErr = `HTTP ${res.status}`;
				continue;
			}
			const text = await res.text();
			if (text.includes('js-store')) return text;
			lastErr = 'ingen js-store-data (sandsynligvis Cloudflare-challenge)';
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err);
		}
	}
	throw new Error(`UG-søgning (Jina) fejlede efter retries: ${lastErr}`);
}

/**
 * Tab-siden: direkte fetch giver os js-store (gammel parser). Jina i HTML-mode
 * giver post-renderet DOM uden js-store — så vi bruger Jina's markdown-mode
 * som returnerer chord/lyric-blokken som ren plaintext i samme form som
 * wiki_tab.content (efter cleanUgContent).
 */
async function fetchTabContent(
	url: string,
	refererUrl?: string
): Promise<FetchedHtml | FetchedMarkdown> {
	const headers: Record<string, string> = { ...UG_HEADERS };
	if (refererUrl) {
		headers['Referer'] = refererUrl;
		headers['Sec-Fetch-Site'] = 'same-origin';
	}

	try {
		const res = await fetch(url, { headers, redirect: 'follow' });
		if (res.ok) {
			const text = await res.text();
			if (text.includes('js-store')) return { kind: 'html', text };
		}
	} catch {
		// netværksfejl → fald gennem til Jina markdown
	}

	// Jina's IP-pool kan ramme Cloudflare. Hold retries lave, så UI hurtigt
	// falder tilbage til paste-flow i stedet for at føles frosset.
	const jinaHeaders: Record<string, string> = process.env.JINA_API_KEY
		? { Authorization: `Bearer ${process.env.JINA_API_KEY}` }
		: {};
	let lastErr: string = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		if (attempt > 0) await sleep(600 + attempt * 400);
		try {
			const res = await fetch(`https://r.jina.ai/${url}`, {
				headers: jinaHeaders,
				redirect: 'follow'
			});
			if (!res.ok) {
				lastErr = `HTTP ${res.status}`;
				continue;
			}
			const text = await res.text();
			if (isCloudflareChallenge(text)) {
				lastErr = 'Cloudflare challenge';
				continue;
			}
			return { kind: 'markdown', text };
		} catch (err) {
			lastErr = err instanceof Error ? err.message : String(err);
		}
	}
	throw new Error(`UG-tab (Jina) gav ikke indhold efter retries: ${lastErr}`);
}

function isCloudflareChallenge(text: string): boolean {
	// Jina sender Cloudflare-challenge-siden videre som den er. Disse
	// markører fanger både den klassiske "Just a moment..." og Jina's
	// markdown-warning.
	if (text.length < 3000) {
		if (/Just a moment/i.test(text)) return true;
		if (/CAPTCHA/i.test(text)) return true;
		if (/Performing security verification/i.test(text)) return true;
		if (/Warning: Target URL returned error 403/i.test(text)) return true;
	}
	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
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
 *   - UG-forfatterkommentarer efter sangen: "* It has been suggested..."
 *   - "Open (These chords are not in the original key)"
 *   - Jina/UG sideindhold efter sangen: closing code fence, rating,
 *     strumming, related tabs, footer/navigation.
 */
function stripTrailingUgJunk(text: string): string {
	const CHORD_TOKEN = '[A-G][#b]?(?:m|maj|min|dim|sus|add)?\\d?';
	const JUNK_PATTERNS: RegExp[] = [
		/^\s*```\s*$/,
		/^\s*Print\s+Create\s+correction\s+Report\s+bad\s+tab\s*$/i,
		/^\s*Last\s+update:\s+/i,
		/^\s*Rating\s*$/i,
		/^\s*Please,\s*rate\s+this\s+tab\s*$/i,
		/^\s*##\s+(?:Play\s+next|Chords|Strumming\s+pattern|Get\s+effects|Related\s+tabs)\s*$/i,
		/^\s*There\s+is\s+no\s+strumming\s+pattern\s+for\s+this\s+song\s+yet\b/i,
		/^\s*\*+\s+(?:it\s+has\s+been\s+suggested|suggested|note|notes?|this\s+song|you\s+can|thanks?|please|rate)\b/i,
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
			if (cutIdx > 0 && lines[cutIdx - 1].trim() === 'X') cutIdx--;
			return lines.slice(0, cutIdx).join('\n').trimEnd();
		}
	}
	return text;
}
