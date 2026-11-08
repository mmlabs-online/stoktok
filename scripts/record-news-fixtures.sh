#!/usr/bin/env bash
# STK-062: record the real news RSS feeds and each host's robots.txt as test fixtures. RUN BY MING, from the repo root:
#   bash scripts/record-news-fixtures.sh
# Polite by design: honest stoktok User-Agent (same as NEWS_SYNC_CONFIG.userAgent), no cookies, no Referer, no
# redirects, 3 s between requests. On ANY status other than 200 it deletes the partial file and stops (exit 1):
# no retry, no workaround. Re-read the saved robots-*.txt files before committing the samples.
# Output: work/tickets/STK-062/live-samples/ (robots-<id>.txt, <id>-<n>.xml, README.md).
set -u

OUT="work/tickets/STK-062/live-samples"
UA="stoktok/0.1 (personal portfolio tracker; hourly RSS check)"
ACCEPT="application/rss+xml, application/xml"
PAUSE=3

# id|robots url|feed urls (space separated). Keep in sync with NEWS_SYNC_CONFIG in apps/worker/src/config.ts.
SOURCES="
cafef|https://cafef.vn/robots.txt|https://cafef.vn/thi-truong-chung-khoan.rss https://cafef.vn/doanh-nghiep.rss
vietstock|https://vietstock.vn/robots.txt|https://vietstock.vn/830/chung-khoan/co-phieu.rss https://vietstock.vn/739/chung-khoan/giao-dich-noi-bo.rss https://vietstock.vn/741/chung-khoan/niem-yet.rss https://vietstock.vn/738/doanh-nghiep/co-tuc.rss https://vietstock.vn/737/doanh-nghiep/hoat-dong-kinh-doanh.rss https://vietstock.vn/761/kinh-te/vi-mo.rss
vnexpress|https://vnexpress.net/robots.txt|https://vnexpress.net/rss/kinh-doanh.rss
"

mkdir -p "$OUT" || exit 1
RECORDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TABLE=""
FIRST=1

# fetch <url> <dest>: GET once; move into place only on HTTP 200, otherwise delete the temp file and stop.
fetch() {
  url="$1"
  dest="$2"
  if [ "$FIRST" -eq 0 ]; then sleep "$PAUSE"; fi
  FIRST=0
  tmp="$dest.tmp"
  status="$(curl --silent --show-error --connect-timeout 10 --max-time 20 --max-filesize 5242880 \
    --user-agent "$UA" --header "Accept: $ACCEPT" --output "$tmp" --write-out '%{http_code}' "$url")"
  rc=$?
  if [ "$rc" -ne 0 ] || [ "$status" != "200" ]; then
    rm -f "$tmp"
    echo "STOP: $url -> curl exit $rc, HTTP $status. Nothing more is requested." >&2
    exit 1
  fi
  mv "$tmp" "$dest" || exit 1
  bytes="$(wc -c < "$dest" | tr -d ' ')"
  if command -v sha256sum >/dev/null 2>&1; then sum="$(sha256sum "$dest" | cut -d' ' -f1)"; else sum="$(shasum -a 256 "$dest" | cut -d' ' -f1)"; fi
  TABLE="$TABLE| $url | $status | $bytes | $sum |
"
  echo "ok $status $bytes bytes  $url"
}

while IFS= read -r line; do
  [ -n "$line" ] || continue
  id="${line%%|*}"
  rest="${line#*|}"
  robots="${rest%%|*}"
  feeds="${rest#*|}"
  fetch "$robots" "$OUT/robots-$id.txt"
  n=0
  for feed in $feeds; do
    n=$((n + 1))
    fetch "$feed" "$OUT/$id-$n.xml"
  done
done <<< "$SOURCES"

{
  echo "# STK-062 live samples"
  echo
  echo "recorded_at_utc: $RECORDED_AT"
  echo "user_agent: $UA"
  echo
  echo "| url | status | bytes | sha256 |"
  echo "|---|---|---|---|"
  printf '%s' "$TABLE"
} > "$OUT/README.md"
echo "Done. Read robots-*.txt (Allow/Disallow, Crawl-delay) before committing $OUT."
