-- Tabela de perfis dos usuários
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  full_name text,
  whatsapp text,
  email text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Tabela de planos
CREATE TABLE IF NOT EXISTS public.plans (
  id serial PRIMARY KEY,
  name text NOT NULL,
  max_devices int NOT NULL DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- Tabela de assinaturas
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  plan_id int REFERENCES public.plans(id) NOT NULL,
  valid_until timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Planos padrão
INSERT INTO public.plans (name, max_devices) VALUES
  ('Free', 1),
  ('Pro', 3)
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies: profiles
DROP POLICY IF EXISTS "Usuários podem ver seu próprio profile" ON public.profiles;
CREATE POLICY "Usuários podem ver seu próprio profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Usuários podem inserir seu próprio profile" ON public.profiles;
CREATE POLICY "Usuários podem inserir seu próprio profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Usuários podem atualizar seu próprio profile" ON public.profiles;
CREATE POLICY "Usuários podem atualizar seu próprio profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- Policies: plans (leitura pública)
DROP POLICY IF EXISTS "Planos são públicos para leitura" ON public.plans;
CREATE POLICY "Planos são públicos para leitura"
  ON public.plans FOR SELECT
  TO authenticated, anon
  USING (true);

-- Policies: subscriptions
DROP POLICY IF EXISTS "Usuários podem ver suas próprias subscriptions" ON public.user_subscriptions;
CREATE POLICY "Usuários podem ver suas próprias subscriptions"
  ON public.user_subscriptions FOR SELECT
  USING (auth.uid() = user_id);

-- Trigger: cria profile e atribui plano Free automaticamente após signup no Auth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, whatsapp, email)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'whatsapp',
    new.email
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    whatsapp = EXCLUDED.whatsapp,
    email = EXCLUDED.email,
    updated_at = now();

  INSERT INTO public.user_subscriptions (user_id, plan_id, valid_until)
  VALUES (
    new.id,
    (SELECT id FROM public.plans WHERE name = 'Free' LIMIT 1),
    null
  )
  ON CONFLICT DO NOTHING;

  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
