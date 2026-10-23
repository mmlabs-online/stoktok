const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids reach server code from route params and action arguments, so they are untrusted. */
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
