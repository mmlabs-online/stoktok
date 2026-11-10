# STK-064 security review

## Security review: STK-064 slice 1, attempt 1

I read the files directly because I have no Bash, so I could not run `git diff`. I ran no checks, and the verdict below comes from reading the code only.

**Verdict: no 🔴. Four 🟡 items to fix in this slice, and a few 🟢 notes.** Access control is solid. The weak spots are the plain-text filter and the deny-list, which can be bypassed with Unicode tricks, and the read-path parser, which skips some of the write-path checks.

### Findings

**🟢 RLS and grants are correct.** `supabase/migrations/20261110000300_ai_summaries.sql:42-44`
- RLS is on with no policies, `revoke all` covers public, anon and authenticated, and only service_role gets grants.
- Existing checks already cover the new table: `checks.sql:186` (RLS on), `:201` (no anon/authenticated table or sequence grants) and `:212` (anon/authenticated denied).
- The identity column needs no sequence grant, and the rollback is fine.

**🟢 Model output cannot invent citations.** `sanitize.ts:78-85`
- A sentence survives only if every id it cites is in `ctx.providedIds`, and `missing:` markers are refused. An id that appears inside article text ("news:999") is dropped unless it was really provided.
- Remaining limit (plan known limit 11): the model can still cite a real id for a false claim, or move a missing topic's claims into another section. Showing citations next to each sentence (slice 4) is the mitigation.

**🟡 Invisible and lookalike Unicode get past the plain-text and deny-list checks** (R9, R10). `body.ts:42-60`, `sanitize.ts:74-77`
- `hasControlOrBidi` blocks C0/C1, U+200B–200F, 202A–202E, 2060–2064, 2066–2069 and FEFF. It does not block U+00AD (soft hyphen), U+034F, U+061C, U+180E, U+2028/2029 (only stripped on write, never on read), variation selectors U+FE00–FE0F, or tag characters U+E0000–E007F.
- Example: `"nê­n mua"` looks like "nên mua" but passes both checks. A Cyrillic `а` in `"nên muа"` does the same.
- Tag characters can carry hidden instructions. That matters because `sum:` inputs feed stored summaries back into the portfolio prompt (STK-064c), which makes this a second-order prompt-injection risk (OWASP LLM01).
- Fix: replace the deny-list of characters with an allow-list. Normalise with NFKC, then require roughly `^[\p{Script=Latin}\p{M}\p{N}\p{Zs}.,;:!?%()'"/+\-–]+$` with flag `u`, and refuse `\p{Default_Ignorable_Code_Point}`. Use the same check on write and on read.

**🟡 The deny-list is easy to get around** (R9, R10). `config.ts:30-42`
These all pass today:
- Vietnamese without diacritics: "nen mua", "gia muc tieu".
- Reversed word order: "price target" (only "target price" is listed), "lợi nhuận kỳ vọng".
- "sẽ tăng 20%" (the pattern only catches "sẽ tăng" followed by lên/xuống/đến/tới).
- Advice verbs that are not listed: "nên gom/chốt lời/cắt lỗ/nắm giữ/tích lũy", "khuyên mua", "khuyến nghị nắm giữ", "tiềm năng tăng", "dự báo giá", "upside", "should buy/sell".

Fix:
- Also match on a copy with diacritics removed (NFD, then strip `\p{M}`, then `đ`→`d`).
- Add the phrases above, and treat "sẽ/có thể (tăng|giảm)" followed by a number or % as a forecast.
- Add tests for each bypass.

This remains a backstop. The real R9 control is still "AI explains rule-based signals, never decides".

**🟡 The read parser does not repeat the deny-list** (R9). `body.ts:70-97`
- `parseStoredSummaryBody` re-checks the text format but never runs `denyPatterns`. A tampered row, or a row written before the list grew, reaches the UI with forbidden wording.
- Fix: run the same NFC (later NFKC) plus lower-case deny check in the parser. A row that fails maps to `body: null` and gets regenerated.

**🟡 The read parser does not check that a row is consistent with itself.** `body.ts:82-94`, `mappers.ts:405-406`
- A section with `missing:true` can hold any text with ordinary ids.
- A section with `missing:false` can cite `missing:` markers.
- Body ids are not checked against the row's `input_ids`, or against its scope or symbol. For example, a VNM row can cite `px:FPT:…`, and in slice 4 a `news:<id>` would turn into a link from stored `news.url`.
- Fix:
  - `missing === true` must mean exactly one sentence, text equal to `noDataText`, ids equal to `[the missing marker for this subject and topic]`.
  - `missing === false` must mean no `missing:` ids.
  - Pass `inputIds` into the parser, or check in `aiSummaryFromRow`, and require every cited id to be in it.
  - Optionally require symbol-scoped ids to match the row's symbol.

**🟢 Bare domains and `javascript:` pass the URL check.** `body.ts:42`
- `example.vn/x` and `javascript:alert(1)` pass. This only matters if a later UI turns plain text into links.
- Keep slice 4 text-only with no linkifier, taking hrefs only from stored `news.url` with an https allow-list (plan line 232). The allow-list fix above also narrows this.

**🟢 `sanitizeSummaryOutput` trusts `ctx.providedIds`.** `sanitize.ts:70`
- These ids are copied into `inputIds` without being checked against the id format.
- Return `bad_context` if any id fails `parseInputId`, or starts with `missing:`. This keeps the "only ids built by `formatInputId`" rule enforced in code, not just by convention.

**🟢 The write path does not validate.** `rows.ts:286`, `ai-summaries.ts:14`
- `AiSummaryInsert.body` is `unknown`, so slice 2 could store an unchecked body. Reading would catch it (`body: null`), but that is late.
- Type it as `AiSummaryBody`, or call `parseStoredSummaryBody` before the upsert and throw `VALIDATION` if it fails.

**🟢 The database guards are coarse but adequate.** `migration:24`
- `pg_column_size(body)` measures stored binary size, not JSON text size, so it does not exactly match core's 32 KB limit. This is fine as a backstop.
- Optional extra defence: add `body::text !~ '[<>]'`, and a check that `body->>'version'` matches `body_version`.
- The size limits themselves hold up: 280 chars, 4 sentences, 5 sections, 6 ids, 32 KB in core and the database, at most 200 input ids, and a shrink loop in `sanitize.ts:120-128` that always terminates.

### Recommendations, in order
1. Use one shared allow-list text check (NFKC plus refusing Default_Ignorable characters) in `isPlainSummaryText`, on write and on read. Add tests for U+00AD, U+E0041 and a Cyrillic homoglyph.
2. Make the deny-list cover text without diacritics, plus the extra phrases and forecast patterns. Add a test for each.
3. Make `parseStoredSummaryBody` apply the deny-list, check the `missing` flag both ways, and require cited ids to be in the row's `input_ids`.
4. Check `providedIds` in `sanitizeSummaryOutput`, and type the insert `body` as `AiSummaryBody`.

### Risks for later slices
- **064c:** `sum:` inputs are model output that may have been shaped by injected article text. Send them only as data in a user-role block, with no tools, and never in the system prompt.
- **064d:** render as React text only, with no markdown and no linkifier. Build citation links only from stored rows.

### Open questions
- Should the deny-list allow company-commitment wording? "cam kết" currently drops news sentences such as "cam kết đầu tư". That errs on the cautious side, which is acceptable, but Ming should confirm.
- Will the UI ever render markdown? If yes, the plain-text rules need to be tightened again.

Files reviewed:
- `/home/user/stoktok/supabase/migrations/20261110000300_ai_summaries.sql`
- `/home/user/stoktok/supabase/rollback/20261110000300_ai_summaries.down.sql`
- `/home/user/stoktok/scripts/db-check/checks.sql`
- `/home/user/stoktok/packages/core/src/ai/summary/{config,input-ids,body,sanitize}.ts`
- `/home/user/stoktok/packages/db/src/{repos/ai-summaries.ts,rows.ts,mappers.ts}`

## Security review: STK-064 slice 1, attempt 2

I read the code only. I have no Bash, so I could not run the checks, and I took the implementer's green typecheck/lint/test from `impl-log.md` as given. No SQL changed.

**Verdict: no 🔴.** All four attempt-1 🟡 items and both 🟢 items you asked about are fixed. One new 🟡: the allow-list is still broad enough to let lookalike characters through.

### Attempt-1 items

| Item | Status |
|---|---|
| 🟡 Invisible and lookalike Unicode | **Fixed for what was reported.** `body.ts:45-60` normalises to NFKC, refuses `Default_Ignorable`, and uses an allow-list. U+00AD, U+034F, U+061C, U+180E, variation selectors, tag characters and U+2028/2029 (on read) are now refused, and so is Cyrillic. Tests are at `sanitize.test.ts:130-134` and `body.test.ts:77`. **Remaining gap: see the new 🟡 below.** |
| 🟡 Deny-list bypasses | **Fixed.** `body.ts:64-71` matches both the NFKC lower-cased text and a copy with diacritics removed, and `config.ts:42-50` adds every phrase I listed. Tests are at `sanitize.test.ts:148-172`. |
| 🟡 Read parser skipped the deny-list | **Fixed.** `body.ts:108` |
| 🟡 Read parser had no row-consistency check | **Fixed.** `body.ts:109-122`: `missing` is checked both ways, cited ids must be a subset of `input_ids`, missing markers must match the topic and subject, and symbol-scoped ids must match the row's symbol. `mappers.ts:406` passes the context in. A null or empty symbol rejects the body, so it fails safe. |
| 🟢 `providedIds` trusted | **Fixed.** `sanitize.ts:59` returns `bad_context` for a malformed id or a `missing:` id. Tested at `sanitize.test.ts:125-127`. |
| 🟢 Insert body was `unknown` | **Fixed at compile time.** `rows.ts:286` is now `AiSummaryBody`. Nothing checks it when the code runs, which is acceptable because the type only allows sanitizer output. |

### New findings

**🟡 The allow-list still lets through Latin-script lookalikes, stray combining marks and non-ASCII digits** (R9, R10). `body.ts:45`
- **Latin-script lookalikes:** `\p{Script=Latin}` covers IPA and phonetic letters that NFKC leaves unchanged. Examples are ɑ U+0251, ɡ U+0261, ı U+0131 and small caps like ᴍ U+1D0D. So `"Nên muɑ"` and `"ɡiá mục tiêu"` pass both the plain-text check and the deny-list. The Cyrillic case is closed, but this one is still open.
- **Combining marks:** after NFKC, every Vietnamese letter is a single precomposed character, so any `\p{M}` that is still there is not Vietnamese. That includes strikethrough U+0336 and the overlay U+0338 (both can visually cancel a word like "không"), enclosing marks U+20DD/U+20E3, marks from other scripts, and Zalgo stacks. The deny copy strips them, so they don't bypass the deny-list; the risk is only how the text looks.
- **Digits:** `\p{N}` lets in digits from other scripts, for example Arabic-Indic ٠–٩ (bidi class AN) and Devanagari or Bengali digits. These can disguise numbers. They also slip past the forecast pattern, because `\d` with flag `u` only matches ASCII: `"sẽ tăng ٢٠ phần trăm"` is not caught.
- **Fix (one regex):** replace `\p{Script=Latin}\p{M}\p{N}` with the Vietnamese alphabet plus `0-9`. Roughly `A-Za-z`, `À-ÃÈ-ÊÌÍÒ-ÕÙÚÝà-ãè-êìíò-õùúý`, `ĂăĐđĨĩŨũƠơƯư` and `Ạ-ỹ`, with no `\p{M}`. Add tests for U+0251, U+0336 and U+0662.

**🟢 Punctuation between words gets past the deny-list.** `body.ts:68-70`
- The patterns need exactly one space, so `"Nên – mua"`, `"nên/mua"` and `"nên: mua"` all pass. The newly allowed en dash, em dash and typographic quotes make this a little easier.
- Fix: in both deny copies, turn every run of characters other than `\p{L}\p{N}%` into one space before matching.
- The typographic quotes and dashes cause no other problems: they are not bidi or invisible, and they are not markup.

**🟢 Matching without diacritics drops normal sentences.** `config.ts:32,38,46`, `body.ts:70`
- `"tiềm năng tăng trưởng"` (growth potential) is very common in news and is dropped even with diacritics.
- `"mục tiêu gia tăng thị phần"` becomes `muc tieu gia…` once stripped, and so matches `mục tiêu giá`.
- `"lại chắc chắn"` matches `lãi chắc`.
- These mistakes block too much rather than too little, but news sections may often fall back to "Không có dữ liệu." Possible fix: `tiềm năng tăng(?! trưởng)` and `mục tiêu giá(?! ?tăng)`. Ming should decide, together with the existing "cam kết" question.

**🟢 Remaining deny-list gaps** (it is still only a backstop):
- "giá trị hợp lý" / "giá hợp lý" (the usual broker wording for fair value, which works as a price target)
- "tăng/giảm tỷ trọng", "mua vào", "vùng mua", "dự kiến tăng 20%"
- "sẽ tăng mạnh lên khoảng 20%" (three words between the verb and the number, but the pattern allows at most two)

**🟢 The read checks are optional.** `body.ts:86`
- `ctx` defaults to `{}`, so a future caller that leaves it out silently skips the subset and subject checks. Make `ctx` required, or add a separate `parseStoredRowBody`.

**🟢 The read path does not check topics against scope.** `body.ts:101`
- A symbol row can hold a `portfolio` section (and `missing:VNM:portfolio` is a valid id), and a portfolio row can hold `price`. Restrict the topics to `SYMBOL_SUMMARY_TOPICS` for symbol rows and to `['portfolio']` for the portfolio row.

**🟢 Carried over from attempt 1:**
- **Link-like text:** `javascript:alert(1)` and bare domains still pass, because `:`, `(` and `/` are allowed. Keep slice 4 text-only with no linkifier.
- **News ids:** `news:<id>` ids are not tied to a symbol. When slice 4 builds links, it should only link news rows that are linked to the row's symbol.
- **Input-id cap:** `sanitize.ts:132` does not apply `maxInputIds`. The SQL guard rejects the insert instead, which is fine but late.

### Recommendations, in order
1. Narrow `ALLOWED_TEXT_RE` to the Vietnamese alphabet and ASCII digits, with no `\p{M}`, and add lookalike tests (closes the 🟡).
2. Turn punctuation into spaces in the deny copies, and add tests for `"Nên – mua"` and `"nên/mua"`.
3. Make `StoredBodyContext` required, and check topics against scope.
4. Ming decides on the false-positive exceptions ("tăng trưởng", "gia tăng", "cam kết").

### Open question
- Will summaries ever need foreign Latin names with letters outside Vietnamese, such as "Nestlé"? "é" is a Vietnamese letter, so it is fine; "ç" and "ñ" are not. The narrower allow-list would drop those sentences.

Files reviewed:
- `/home/user/stoktok/packages/core/src/ai/summary/{body,config,sanitize,index,input-ids}.ts`
- `/home/user/stoktok/packages/core/src/ai/summary/sanitize.test.ts`
- `/home/user/stoktok/packages/db/src/{mappers,rows}.ts`
- `/home/user/stoktok/work/tickets/STK-064/impl-log.md`
