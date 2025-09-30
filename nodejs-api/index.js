// nodejs-api/server/index.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mysql from 'mysql';
import { GoogleGenAI } from '@google/genai';
import { createInstruction } from './prompt.js'; // Import the new function

if (!process.env.GOOGLE_API_KEY) {
  console.error('Missing GOOGLE_API_KEY');
  process.exit(1);
}

// --- Database Connection ---
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to database:', err);
    return;
  }
  console.log('Connected to the MySQL server.');
});
// -------------------------

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });

// --- Helper function to get words from DB (Unchanged) ---
const getWordsForPrompt = () => {
  return new Promise((resolve, reject) => {
    const query = `
      SELECT w.id, w.word, w.word_type
      FROM words w
      LEFT JOIN communicated_words cw ON w.id = cw.word_id
      WHERE cw.id IS NULL
      AND w.language = 'Spanish'
      AND w.word_type NOT IN ('article', 'be_verb', 'pronoun', 'preposition', 'interjection', 'determiner', 'conjunction', 'adverb')
      ORDER BY w.created_at ASC
      LIMIT 10;
    `;
    db.query(query, (err, results) => {
      if (err) return reject(err);
      resolve(results);
    });
  });
};

const getHelperWords = () => {
    return new Promise((resolve, reject) => {
        const query = `
            SELECT word FROM words
            WHERE language = 'Spanish' AND
            word_type IN ('article', 'be_verb', 'pronoun', 'preposition', 'interjection', 'determiner', 'conjunction', 'adverb')
        `;
        db.query(query, (err, results) => {
            if (err) return reject(err);
            resolve(results.map(r => r.word));
        });
    });
};


app.get('/api/ephemeral-token', async (_req, res) => {
  try {
    const [wordsForPrompt, helperWords] = await Promise.all([
        getWordsForPrompt(),
        getHelperWords()
    ]);

    const wordList = wordsForPrompt.map(w => w.word).join(', ');

    // --- CONSTRUCT THE INSTRUCTION STRING ---
    const instruction = createInstruction(wordList, helperWords); // Use the imported function

    console.log("Generated Instruction:", instruction);

    // --- CREATE TOKEN (WITHOUT a systemInstruction) ---
    const token = await ai.authTokens.create({
      config: {
        uses: 1,
        httpOptions: { apiVersion: 'v1alpha' },
        expireTime: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        newSessionExpireTime: new Date(Date.now() + 60 * 1000).toISOString(),
      },
    });

    // Mark the words as communicated
    if (wordsForPrompt.length > 0) {
        const wordIds = wordsForPrompt.map(w => w.id);
        const insertQuery = 'INSERT INTO communicated_words (word_id) VALUES ?';
        const values = wordIds.map(id => [id]);
        db.query(insertQuery, [values], (err) => {
            if (err) console.error("Error marking words as communicated:", err);
        });
    }

    // --- SEND BOTH TOKEN AND INSTRUCTION TO CLIENT ---
    res.json({ token: token.name, instruction });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Failed to mint ephemeral token' });
  }
});

app.listen(8787, () => console.log('Token server on http://localhost:8787'));