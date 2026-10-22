-- Supabase Pro: videos up to 200 MB each (was 50 MB, the free plan's limit). Supabase's own Storage
-- setting "Upload file size limit" must also be at least 200 MB, or it still refuses anything over 50 MB.
update storage.buckets set file_size_limit = 200 * 1024 * 1024 where id = 'videos';
