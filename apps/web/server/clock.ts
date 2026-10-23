import { vnDateOf } from '@stoktok/core';

/** Today's date ('YYYY-MM-DD') in Vietnam time: the one server-side clock. */
export function todayVn(): string {
  return vnDateOf(new Date());
}
