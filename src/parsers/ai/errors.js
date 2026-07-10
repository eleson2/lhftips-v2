/** Thrown by a provider when it's wired in but its API call is deliberately inactive. */
export class AIProviderDisabledError extends Error {
  constructor(message = 'AI assistance is not enabled') {
    super(message);
    this.name = 'AIProviderDisabledError';
  }
}
