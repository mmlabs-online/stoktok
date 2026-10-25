import { vnDateOf } from '@stoktok/core';

/** Today's date ('YYYY-MM-DD') in Vietnam time: the one server-side clock. */
export function todayVn(): string {
  return vnDateOf(new Date());
}

/** The current instant: the one server-side clock for code that needs the time of day. */
export function nowInstant(): Date {
  return new Date();
}
