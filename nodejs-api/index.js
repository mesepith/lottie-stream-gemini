// nodejs-api/server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

if (!process.env.GOOGLE_API_KEY) {
  console.error('Missing GOOGLE_API_KEY');
  process.exit(1);
}

const app = express();
app.use(cors({ origin: 'http://localhost:3000' })); // allow CRA dev

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

app.get('/api/ephemeral-token', async (_req, res) => {
  try {
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        httpOptions: { apiVersion: 'v1alpha' },  // <- important
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
      },
    });
    res.json({ token: token.name }); // send the string the client should use
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to mint ephemeral token' });
  }
});

app.listen(8787, () => console.log('Token server on http://localhost:8787'));
