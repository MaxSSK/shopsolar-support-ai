-- Add queue column to tickets table
-- Run this once in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/xjuztkkrmigyyzojyttw/sql

alter table tickets
  add column if not exists queue text;
