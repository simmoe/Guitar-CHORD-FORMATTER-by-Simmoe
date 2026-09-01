declare const __BUILD_TIME__: string;

export const BUILD_TIME = __BUILD_TIME__;

export const BUILD_TIME_LABEL = new Intl.DateTimeFormat('da-DK', {
	dateStyle: 'medium',
	timeStyle: 'short',
	timeZone: 'Europe/Copenhagen'
}).format(new Date(BUILD_TIME));
