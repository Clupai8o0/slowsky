-- Slowsky build roadmap. Run by scripts/seed.mjs; safe to run again.

create table if not exists items (
  id          text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  kind        text not null check (kind in ('version', 'feature', 'block', 'milestone', 'step', 'idea')),
  title       text not null check (length(title) between 1 and 200),
  detail      text not null default '' check (length(detail) <= 4000),
  version     text,
  tier        text check (tier in ('core', 'weekend', 'if-ahead', 'roadmap')),
  lane        text,
  owner       text,
  start_at    timestamptz,
  due_at      timestamptz,
  status      text not null default 'todo' check (status in ('todo', 'doing', 'done', 'blocked', 'cut')),
  progress    integer not null default 0 check (progress between 0 and 100),
  gate        text,
  sort        integer not null default 0,
  updated_at  timestamptz not null default now()
);

create table if not exists updates (
  id        bigserial primary key,
  item_id   text references items(id) on delete set null,
  at        timestamptz not null default now(),
  author    text not null default 'unknown' check (length(author) between 1 and 80),
  status    text check (status in ('todo', 'doing', 'done', 'blocked', 'cut')),
  progress  integer check (progress between 0 and 100),
  note      text not null check (length(note) between 1 and 2000)
);

create index if not exists updates_at_idx on updates (at desc);
create index if not exists updates_item_idx on updates (item_id, at desc);

-- A block never ends before it starts, even after a partial edit of one end.
alter table items drop constraint if exists items_window_check;
alter table items add constraint items_window_check check (start_at is null or due_at is null or start_at <= due_at);
