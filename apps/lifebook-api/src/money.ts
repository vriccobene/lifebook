/** The database stores money as integer cents; the API and lifebook-core speak euro. */
export const eurosToCents = (euros: number): number => Math.round(euros * 100);
export const centsToEuros = (cents: number): number => cents / 100;
