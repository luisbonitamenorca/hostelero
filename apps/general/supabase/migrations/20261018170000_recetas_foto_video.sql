-- Recetas · foto y vídeo por receta (18-10-2026, pedido de Luis).
--
-- Cada receta puede llevar UNA foto y UN vídeo de la elaboración (subidos) o, en vez del vídeo
-- subido, un enlace (YouTube/Vimeo/Drive). Los ficheros van al bucket privado `recetas`, ruta
-- `<cuenta_id>/<receta_id>/<fichero>`: el primer segmento aísla inquilinos con la misma política
-- que el bucket `docs`. Se leen SIEMPRE con URL firmada bajo demanda (1 h) desde la app.
--
-- Límite por fichero: 100 MB (el límite global del proyecto manda si es menor). La app comprime la
-- foto en el navegador (máx. 1600 px, JPEG) y avisa si el vídeo pasa del límite.

alter table public.rec_receta add column if not exists foto_path  text null;
alter table public.rec_receta add column if not exists video_path text null;
alter table public.rec_receta add column if not exists video_url  text null;
comment on column public.rec_receta.foto_path  is 'Ruta en el bucket recetas (<cuenta_id>/<receta_id>/foto-<ts>.jpg). URL firmada bajo demanda.';
comment on column public.rec_receta.video_path is 'Ruta en el bucket recetas (<cuenta_id>/<receta_id>/video-<ts>.<ext>). URL firmada bajo demanda.';
comment on column public.rec_receta.video_url  is 'Alternativa al vídeo subido: enlace externo (YouTube, Vimeo, Drive…).';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recetas', 'recetas', false, 104857600, array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists recetas_bucket_acceso on storage.objects;
create policy recetas_bucket_acceso on storage.objects
  for all to authenticated
  using (bucket_id = 'recetas' and (((storage.foldername(name))[1])::uuid = (select cuenta_actual()) or (select es_operador())))
  with check (bucket_id = 'recetas' and (((storage.foldername(name))[1])::uuid = (select cuenta_actual()) or (select es_operador())));

-- VERIFICACIÓN (no se ejecuta):
--   select id, public, file_size_limit from storage.buckets where id = 'recetas';
--   select polname from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'recetas_bucket_acceso';
