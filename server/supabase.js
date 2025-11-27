// server/supabase.js
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase with Service Role Key for server-side access
// Make sure to add SUPABASE_URL and SUPABASE_SERVICE_KEY to your .env
const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

export async function upsertOrderFromSession(session) {
  const md = session?.metadata || {};
  const cust = session?.customer_details || {};
  
  // Extract shipping info safely
  const shipping = session?.shipping_details
    ? {
        name: session.shipping_details.name || null,
        phone: cust.phone || null,
        address: session.shipping_details.address || null
      }
    : null;

  const orderData = {
    stripe_session_id: session.id,
    paid: session.payment_status === 'paid' && session.status === 'complete',
    email: cust.email || null,
    name: session?.shipping_details?.name || null,
    phone: cust.phone || null,
    shipping_address: shipping, // Supabase handles JSONB automatically
    currency: session.currency || null,
    amount_total: session.amount_total ?? null,
    
    // Metadata fields
    pack_key: md.packKey || null,
    model_key: md.modelKey || null,
    filename: md.filename || null,
    
    // Note: params are usually saved during checkout draft creation,
    // but if provided in metadata, we can save them here too.
    // params_json: md.params || null 
  };

  const { error } = await supabase
    .from('orders')
    .upsert(orderData, { onConflict: 'stripe_session_id' });

  if (error) console.error('Supabase upsert error:', error);
  return !error;
}

export async function saveDraftOrder(sessionId, { packKey, modelKey, params, filename }) {
  const { error } = await supabase
    .from('orders')
    .upsert({
      stripe_session_id: sessionId,
      pack_key: packKey,
      model_key: modelKey,
      params_json: params, // Pass the object directly, Supabase handles JSON
      filename: filename,
      paid: false
    }, { onConflict: 'stripe_session_id' });

  if (error) console.error('Supabase draft error:', error);
}

export async function getOrderBySession(sessionId) {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .eq('stripe_session_id', sessionId)
    .single();
  return data;
}

export async function listOrders(limit = 100) {
  const { data } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}
