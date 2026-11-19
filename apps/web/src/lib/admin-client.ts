'use client';

import { apiPost } from './api';

/** Calls the API as the signed-in administrator. */
export const adminPost = <T = unknown>(path: string, body: unknown) => apiPost<T>(path, body, 'admin');

/** Calls the API without a session (public routes, sign-in). */
export const publicPost = <T = unknown>(path: string, body: unknown) => apiPost<T>(path, body);
