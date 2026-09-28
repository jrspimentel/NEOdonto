# NEOdonto — Sistema de Gestão Odontológica

Sistema web profissional para gerenciamento de clínica odontológica, construído com HTML5, CSS3, JavaScript puro (ES Modules) e Supabase.

---

## Estrutura do Projeto

```
NEOdonto/
├── index.html            ← Dashboard
├── pages/
│   ├── login.html
│   ├── pacientes.html
│   ├── agenda.html
│   └── sala-espera.html
├── css/
│   └── style.css
├── js/
│   ├── supabase.js       ← Client Supabase (configurar URL e key)
│   ├── auth.js            ← Autenticação e permissões
│   ├── layout.js          ← Sidebar, ícones, toasts, helpers
│   ├── app.js             ← Dashboard
│   ├── pacientes.js       ← Pacientes + histórico
│   ├── agenda.js          ← Agenda do Dia
│   └── sala-espera.js     ← Sala de Espera
└── README.md
```

---

## Configuração do Supabase

### 1. Criar projeto

Acesse [supabase.com](https://supabase.com), crie um projeto e copie:

- **Project URL** (`https://xxxxx.supabase.co`)
- **Anon/Public Key** (`eyJhbGci...`)

### 2. Configurar credenciais

Edite o arquivo `js/supabase.js`:

```js
const SUPABASE_URL  = 'https://SEU-PROJETO.supabase.co';
const SUPABASE_ANON = 'SUA-ANON-KEY-AQUI';
```

### 3. Criar tabelas e RLS

Acesse o **SQL Editor** do Supabase e execute:

```sql
-- ==========================
-- TABELAS
-- ==========================

-- Profiles (vinculada ao auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'auxiliar'
    CHECK (role IN ('admin', 'dentista', 'recepcionista', 'auxiliar')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pacientes
CREATE TABLE IF NOT EXISTS patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cpf TEXT,
  birth_date DATE,
  phone TEXT,
  is_whatsapp BOOLEAN DEFAULT FALSE,
  email TEXT,
  address TEXT,
  notes TEXT,
  legal_guardian_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Procedimentos / Atendimentos
CREATE TABLE IF NOT EXISTS procedures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID REFERENCES patients(id) ON DELETE CASCADE,
  professional TEXT,
  procedure_name TEXT NOT NULL,
  date DATE,
  time TEXT,
  insurance TEXT,
  value NUMERIC(10,2) DEFAULT 0,
  paid BOOLEAN DEFAULT FALSE,
  payment_date DATE,
  payment_method TEXT,
  status TEXT DEFAULT 'Agendado'
    CHECK (status IN ('Agendado', 'Realizado', 'Faltou', 'Cancelado')),
  situation TEXT DEFAULT 'Agendado'
    CHECK (situation IN ('Agendado', 'Paciente na recepção', 'Em atendimento', 'Finalizado', 'Cancelado')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==========================
-- TRIGGER: Criar profile automaticamente ao registrar usuário
-- ==========================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'role', 'auxiliar')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ==========================
-- RLS (Row Level Security)
-- ==========================

-- Ativar RLS em todas as tabelas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedures ENABLE ROW LEVEL SECURITY;

-- Função auxiliar: retorna o role do usuário autenticado
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ---- PROFILES ----

-- Todos autenticados podem ler seu próprio perfil
CREATE POLICY "Users read own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

-- Admin lê todos os perfis
CREATE POLICY "Admin reads all profiles"
  ON profiles FOR SELECT
  USING (get_user_role() = 'admin');

-- Permite INSERT via trigger (criação automática de profile)
CREATE POLICY "Allow trigger insert profiles"
  ON profiles FOR INSERT
  WITH CHECK (true);

-- Apenas admin gerencia profiles (update/delete)
CREATE POLICY "Admin manages profiles"
  ON profiles FOR ALL
  USING (get_user_role() = 'admin');

-- ---- PATIENTS ----

-- Leitura: todos autenticados
CREATE POLICY "Authenticated users read patients"
  ON patients FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Insert: admin, dentista, recepcionista
CREATE POLICY "Create patients"
  ON patients FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'dentista', 'recepcionista'));

-- Update: admin, dentista, recepcionista
CREATE POLICY "Update patients"
  ON patients FOR UPDATE
  USING (get_user_role() IN ('admin', 'dentista', 'recepcionista'));

-- Delete: somente admin
CREATE POLICY "Delete patients"
  ON patients FOR DELETE
  USING (get_user_role() = 'admin');

-- ---- PROCEDURES ----

-- Leitura: todos autenticados
CREATE POLICY "Authenticated users read procedures"
  ON procedures FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Insert: admin, dentista (procedimento), recepcionista (agendamento)
CREATE POLICY "Create procedures"
  ON procedures FOR INSERT
  WITH CHECK (get_user_role() IN ('admin', 'dentista', 'recepcionista'));

-- Update: admin, dentista, recepcionista
CREATE POLICY "Update procedures"
  ON procedures FOR UPDATE
  USING (get_user_role() IN ('admin', 'dentista', 'recepcionista'));

-- Delete: somente admin
CREATE POLICY "Delete procedures"
  ON procedures FOR DELETE
  USING (get_user_role() = 'admin');
```

### 4. Criar o primeiro usuário (Admin)

No **Supabase Dashboard > Authentication > Users**, clique em **"Add user"** e crie o primeiro usuário com e-mail e senha.

Depois, no **SQL Editor**, atualize o role para admin:

```sql
UPDATE profiles
SET role = 'admin', name = 'Seu Nome'
WHERE email = 'seu@email.com';
```

---

## Como Executar

O projeto utiliza ES Modules (imports), portanto **precisa de um servidor HTTP**. Não funciona abrindo o HTML diretamente pelo sistema de arquivos.

### Opção 1: VS Code Live Server

Instale a extensão **Live Server** no VS Code, clique com botão direito no `index.html` e selecione "Open with Live Server".

### Opção 2: npx serve

```bash
cd NEOdonto
npx -y serve .
```

### Opção 3: Python

```bash
cd NEOdonto
python -m http.server 8000
```

Acesse `http://localhost:8000` (ou a porta indicada).

---

## Tipos de Usuário

| Role | Menu | Financeiro | Pacientes | Agenda | Sala Espera |
|------|------|-----------|-----------|--------|------------|
| **admin** | Dashboard, Pacientes, Agenda, Sala de Espera | ✅ | CRUD completo | CRUD + Status | ✅ |
| **dentista** | Dashboard, Pacientes, Agenda, Sala de Espera | ❌ | Visualizar/Criar/Editar | Status/Situação | ✅ |
| **recepcionista** | Dashboard, Pacientes, Agenda, Sala de Espera | ❌ | Visualizar/Criar/Editar | CRUD Agendamento + Status | ✅ |
| **auxiliar** | Agenda, Sala de Espera | ❌ | Somente leitura | Somente leitura | ✅ |

---

## Licença

Projeto desenvolvido para uso interno da clínica.
