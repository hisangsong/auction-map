-- 경매·공매 지도 사용자 데이터 스키마 (Supabase SQL Editor에서 실행)
-- 로그인한 사용자별 관심목록·저장검색·알림설정을 저장하고,
-- RLS(Row Level Security)로 '본인 데이터만' 읽고 쓰게 한다.

-- 1) 사용자 환경설정(관심목록·저장검색·알림수신 여부)
create table if not exists public.user_prefs (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  favorites    jsonb  not null default '[]'::jsonb,   -- 관심물건 고유번호 배열
  saved_filters jsonb not null default '[]'::jsonb,   -- 저장검색 조건 배열
  alert_email  boolean not null default true,         -- 매각임박 이메일 알림 on/off
  email        text,                                  -- 알림 보낼 이메일(로그인 이메일 복사)
  updated_at   timestamptz not null default now()
);

alter table public.user_prefs enable row level security;

-- 본인 행만 접근
drop policy if exists "own_select" on public.user_prefs;
create policy "own_select" on public.user_prefs
  for select using (auth.uid() = user_id);

drop policy if exists "own_upsert" on public.user_prefs;
create policy "own_upsert" on public.user_prefs
  for insert with check (auth.uid() = user_id);

drop policy if exists "own_update" on public.user_prefs;
create policy "own_update" on public.user_prefs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) 로그인 시 빈 환경설정 자동 생성(트리거)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.user_prefs (user_id, email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 3) (알림용) 매일 크론이 모든 사용자 설정을 읽을 수 있도록 service_role만 접근하는 뷰
--    service_role 키는 RLS를 우회하므로 별도 정책 없이 서버(크론)에서 직접 조회한다.
