-- ============================================================
-- NEOdonto — Migração: Ficha Clínica, Odontograma e Plano de Tratamento
-- Execute este script no SQL Editor do Supabase
-- ============================================================

-- 1. Fichas Clínicas
CREATE TABLE IF NOT EXISTS clinical_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,

  -- Dados de saúde
  allergy_antibiotics TEXT DEFAULT 'Não informado' CHECK (allergy_antibiotics IN ('Sim', 'Não', 'Não informado')),
  allergy_antibiotics_desc TEXT,
  allergy_anesthetics TEXT DEFAULT 'Não informado' CHECK (allergy_anesthetics IN ('Sim', 'Não', 'Não informado')),
  allergy_anesthetics_desc TEXT,
  hereditary_disease TEXT DEFAULT 'Não informado' CHECK (hereditary_disease IN ('Sim', 'Não', 'Não informado')),
  hereditary_disease_desc TEXT,
  hypertension TEXT DEFAULT 'Não informado' CHECK (hypertension IN ('Sim', 'Não', 'Não informado')),
  hypertension_desc TEXT,
  diabetes TEXT DEFAULT 'Não informado' CHECK (diabetes IN ('Sim', 'Não', 'Não informado')),
  diabetes_desc TEXT,
  medications TEXT DEFAULT 'Não informado' CHECK (medications IN ('Sim', 'Não', 'Não informado')),
  medications_desc TEXT,
  health_problems TEXT DEFAULT 'Não informado' CHECK (health_problems IN ('Sim', 'Não', 'Não informado')),
  health_problems_desc TEXT,

  health_notes TEXT,
  status TEXT DEFAULT 'Ativo',
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinical_records_patient ON clinical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_clinical_records_appointment ON clinical_records(appointment_id);

-- 2. Odontograma (Entradas por dente — histórico)
CREATE TABLE IF NOT EXISTS odontogram_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id UUID REFERENCES appointments(id) ON DELETE SET NULL,
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,

  tooth_number INTEGER NOT NULL CHECK (tooth_number BETWEEN 11 AND 48),
  tooth_condition TEXT, -- Ex: Hígido, Cariado, Restaurado, Ausente, Fraturado, etc.
  procedure_performed TEXT,
  observation TEXT,
  status TEXT DEFAULT 'Registrado',
  record_date DATE DEFAULT CURRENT_DATE,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_odontogram_patient ON odontogram_entries(patient_id);
CREATE INDEX IF NOT EXISTS idx_odontogram_tooth ON odontogram_entries(tooth_number);

-- 3. Planos de Tratamento
CREATE TABLE IF NOT EXISTS treatment_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,

  plan_name TEXT DEFAULT 'Plano de Tratamento',
  status TEXT DEFAULT 'Planejado' CHECK (status IN ('Planejado', 'Aprovado', 'Em andamento', 'Concluído', 'Cancelado')),
  subtotal NUMERIC(12,2) DEFAULT 0,
  discount NUMERIC(12,2) DEFAULT 0,
  total NUMERIC(12,2) DEFAULT 0,
  notes TEXT,

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treatment_plans_patient ON treatment_plans(patient_id);

-- 4. Itens do Plano de Tratamento
CREATE TABLE IF NOT EXISTS treatment_plan_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES treatment_plans(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,

  procedure_name TEXT NOT NULL,
  tooth_number INTEGER, -- Null = Não aplicável
  description TEXT,
  unit_value NUMERIC(12,2) DEFAULT 0,
  quantity INTEGER DEFAULT 1,
  total_value NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'Planejado' CHECK (status IN ('Planejado', 'Aprovado', 'Em andamento', 'Concluído', 'Cancelado')),
  planned_date DATE,
  completed_date DATE,
  observation TEXT,

  -- Integração futura com financeiro
  financial_entry_id UUID, -- Referência futura para lançamento financeiro

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treatment_items_plan ON treatment_plan_items(plan_id);
CREATE INDEX IF NOT EXISTS idx_treatment_items_patient ON treatment_plan_items(patient_id);

-- 5. RLS (Row Level Security) — Habilitar para as novas tabelas
ALTER TABLE clinical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE odontogram_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE treatment_plan_items ENABLE ROW LEVEL SECURITY;

-- Políticas permissivas para usuários autenticados
CREATE POLICY "Authenticated users can manage clinical_records"
  ON clinical_records FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage odontogram_entries"
  ON odontogram_entries FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage treatment_plans"
  ON treatment_plans FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can manage treatment_plan_items"
  ON treatment_plan_items FOR ALL
  TO authenticated
  USING (true) WITH CHECK (true);
