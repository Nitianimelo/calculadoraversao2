// Supabase public config — anon key is safe to expose in browser code
const SUPABASE_URL = 'https://yugyneyhehitmsoxzdds.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1Z3luZXloZWhpdG1zb3h6ZGRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk3NDE4NTEsImV4cCI6MjA5NTMxNzg1MX0.z8mCf1F4mJhlJCvDbGYfWsH-mBnLOlW-2PP7H2klhzw';

// Initialize Supabase client for plain HTML pages (no module bundler)
let _supabase = null;
function getSupabase() {
  if (!_supabase && typeof supabase !== 'undefined' && supabase.createClient) {
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}
