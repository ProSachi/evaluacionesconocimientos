// Vercel Serverless Function: entrega la configuración pública de Supabase desde variables de entorno.
// Define SUPABASE_URL y SUPABASE_ANON_KEY en Vercel → Project Settings → Environment Variables.
module.exports = function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Faltan las variables de entorno SUPABASE_URL y/o SUPABASE_ANON_KEY' });
  }
  return res.status(200).json({ SUPABASE_URL, SUPABASE_ANON_KEY });
};
