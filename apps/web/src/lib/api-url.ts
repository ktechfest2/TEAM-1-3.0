/** Address of the TrustElect API (set NEXT_PUBLIC_API_URL at build time). Safe on server and client. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

export const apiUrl = (path: string) => `${API_URL}${path}`;
