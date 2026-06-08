-- Updated match_tickets function — adds queue to returned columns
-- Run this in the Supabase SQL editor after running add-queue-column.sql:
-- https://supabase.com/dashboard/project/xjuztkkrmigyyzojyttw/sql

create or replace function match_tickets(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count     int   default 10
)
returns table (
  id                     bigint,
  ticket_id              text,
  subject                text,
  agent_name             text,
  first_customer_message text,
  last_agent_message     text,
  full_conversation_text text,
  queue                  text,
  similarity             float
)
language sql stable
as $$
  select
    t.id,
    t.ticket_id,
    t.subject,
    t.agent_name,
    t.first_customer_message,
    t.last_agent_message,
    t.full_conversation_text,
    t.queue,
    1 - (t.embedding <=> query_embedding) as similarity
  from tickets t
  where 1 - (t.embedding <=> query_embedding) > match_threshold
  order by t.embedding <=> query_embedding
  limit match_count;
$$;
