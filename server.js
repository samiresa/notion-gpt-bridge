const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL connection
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// DB startup check
(async () => {
  try {
    const client = await db.connect();
    console.log('✅ Connected to PostgreSQL');
    await db.query(`
      CREATE TABLE IF NOT EXISTS notion_tokens (
        user_id TEXT PRIMARY KEY,
        access_token TEXT NOT NULL
      );
    `);
    console.log('✅ Table `notion_tokens` is ready');
    client.release();
  } catch (err) {
    console.error('❌ DB Connection Error:', err);
    process.exit(1);
  }
})();

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('🌉 Notion GPT Bridge is running with PostgreSQL.');
});

// Step 1: Connect to Notion
app.get('/notion/connect', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');

  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?owner=workspace&client_id=${process.env.NOTION_CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&response_type=code&state=${user_id}`;
  res.redirect(notionAuthUrl);
});

// Step 2: OAuth callback
app.get('/oauth/callback', async (req, res) => {
  const { code, state: user_id } = req.query;

  try {
    const response = await axios.post(
      'https://api.notion.com/v1/oauth/token',
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI,
      },
      {
        auth: {
          username: process.env.NOTION_CLIENT_ID,
          password: process.env.NOTION_CLIENT_SECRET,
        },
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const accessToken = response.data.access_token;

    await db.query(
      `INSERT INTO notion_tokens (user_id, access_token)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET access_token = EXCLUDED.access_token`,
      [user_id, accessToken]
    );

    console.log(`🔐 Token stored for user: ${user_id}`);
    res.send('<h2>✅ Connected! You may now return to your app.</h2>');
  } catch (err) {
    console.error('❌ OAuth error:', err.response?.data || err.message);
    res.status(500).send('OAuth Error: Could not fetch token');
  }
});

// Retrieve token helper
async function getTokenForUser(user_id) {
  const result = await db.query('SELECT access_token FROM notion_tokens WHERE user_id = $1', [user_id]);
  return result.rows[0]?.access_token || null;
}

// Main GPT query endpoint
app.post('/notion/query', async (req, res) => {
  const { user_id, action, parameters } = req.body;

  console.log(`➡️ Received request: user=${user_id}, action=${action}`);

  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

  const token = await getTokenForUser(user_id);
  if (!token) {
    console.warn(`🚫 No token found for user: ${user_id}`);
    return res.status(401).json({ error: 'User not connected to Notion' });
  }

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  };

  try {
    switch (action) {
      case 'list_databases': {
        console.log('📚 Action: list_databases');
        const response = await axios.post(
          'https://api.notion.com/v1/search',
          { filter: { property: 'object', value: 'database' } },
          { headers }
        );
        return res.json({ databases: response.data.results });
      }

      case 'query_database': {
        const { database_id, filter, sorts } = parameters || {};
        if (!database_id) return res.status(400).json({ error: 'Missing database_id' });
        console.log(`🔎 Querying database: ${database_id}`);
        const response = await axios.post(
          `https://api.notion.com/v1/databases/${database_id}/query`,
          { filter, sorts },
          { headers }
        );
        return res.json({ results: response.data.results });
      }

      case 'create_page': {
        const { parent, properties } = parameters || {};
        if (!parent || !properties) return res.status(400).json({ error: 'Missing parent or properties' });
        console.log('📝 Creating new page...');
        const response = await axios.post(
          `https://api.notion.com/v1/pages`,
          { parent, properties },
          { headers }
        );
        return res.json({ page: response.data });
      }

      case 'update_page': {
        const { page_id, properties } = parameters || {};
        if (!page_id || !properties) return res.status(400).json({ error: 'Missing page_id or properties' });
        console.log(`♻️ Updating page: ${page_id}`);
        const response = await axios.patch(
          `https://api.notion.com/v1/pages/${page_id}`,
          { properties },
          { headers }
        );
        return res.json({ page: response.data });
      }

      default:
        console.warn(`⚠️ Unsupported action: ${action}`);
        return res.status(400).json({ error: `Unsupported action: ${action}` });
    }
  } catch (err) {
    console.error(`❌ Notion API error on action "${action}":`, err.response?.data || err.message);
    res.status(500).json({
      error: 'Notion API error',
      details: err.response?.data || err.message,
    });
  }
});

// Launch the app
app.listen(port, () => {
  console.log(`🚀 Notion GPT Bridge is live on port ${port}`);
});
