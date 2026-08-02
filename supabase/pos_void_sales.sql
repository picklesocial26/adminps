-- Supabase schema for voided POS sales
CREATE TABLE IF NOT EXISTS public.pos_void_sales (
  id bigint PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  tax numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  payment text NOT NULL DEFAULT 'cash',
  tendered numeric NOT NULL DEFAULT 0,
  change numeric NOT NULL DEFAULT 0,
  cashier text NOT NULL DEFAULT 'Pickle Social',
  reference_code text,
  voided_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_void_sales_created_at_idx
  ON public.pos_void_sales (created_at DESC);
