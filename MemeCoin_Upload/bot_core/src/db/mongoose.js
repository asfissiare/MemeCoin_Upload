import mongoose from 'mongoose';

export async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.warn('[DATABASE] Attenzione: MONGODB_URI non definito nel .env! I dati andranno persi.');
    return false;
  }

  try {
    await mongoose.connect(uri);
    console.log('[DATABASE] Connesso a MongoDB Atlas con successo.');
    return true;
  } catch (err) {
    console.error('[DATABASE] Errore di connessione a MongoDB:', err.message);
    throw err;
  }
}
