-- FamilyHub — 0009: pin search_path on gen_invite_code (advisor hardening)
alter function public.gen_invite_code() set search_path = '';
