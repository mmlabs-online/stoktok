drop table if exists public.financials;
alter table public.symbols
  drop constraint if exists symbols_sector_provenance,
  drop constraint if exists symbols_sector_format,
  drop column if exists sector,
  drop column if exists sector_source,
  drop column if exists sector_fetched_at;
