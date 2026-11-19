/**
 * OpenRouter model routing with a fallback (Sprint 16, degraded modes). When the primary
 * model is down, rate-limited or refuses, OpenRouter tries the fallback in the same request,
 * so a provider outage on election day does not stall verification or the assistant.
 * A fallback of "none" (or the same model) turns this off.
 */
export function routeModels(primary: string, fallback: string): { model: string } | { models: string[] } {
  return fallback && fallback !== 'none' && fallback !== primary ? { models: [primary, fallback] } : { model: primary };
}
