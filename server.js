const express = require('express');
const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL connection using Railway's DATABASE_URL
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false
});

// Ensure notion_tokens table exists
(async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS notion_tokens (
      user_id TEXT PRIMARY KEY,
      access_token TEXT NOT NULL
    );
  `);
  console.log('✅ PostgreSQL connected and table verified');
})();

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('🌉 Notion GPT Bridge is running with PostgreSQL.');
});

// Step 1: Notion OAuth Redirect
app.get('/notion/connect', (req, res) => {
  const { user_id } = req.query;
  if (!user_id) return res.status(400).send('Missing user_id');

  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?owner=workspace&client_id=${process.env.NOTION_CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&response_type=code&state=${user_id}`;
  res.redirect(notionAuthUrl);
});

// Step 2: Notion OAuth Callback
app.get('/oauth/callback', async (req, res) => {
  const { code, state: user_id } = req.query;

  try {
    const response = await axios.post(
      'https://api.notion.com/v1/oauth/token',
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.REDIRECT_URI
      },
      {
        auth: {
          username: process.env.NOTION_CLIENT_ID,
          password: process.env.NOTION_CLIENT_SECRET
        },
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    const accessToken = response.data.access_token;

    await db.query(
      'INSERT INTO notion_tokens (user_id, access_token) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET access_token = EXCLUDED.access_token',
      [user_id, accessToken]
    );

    console.log(`🔐 Stored Notion token for user: ${user_id}`);
    res.send('<h2>✅ Success! Your Notion account is connected and stored securely.</h2>');
  } catch (err) {
    console.error('❌ OAuth callback error:', err.response?.data || err.message);
    res.status(500).send('OAuth Error: Failed to get Notion token.');
  }
});

// Helper to retrieve token
async function getTokenForUser(user_id) {
  const result = await db.query('SELECT access_token FROM notion_tokens WHERE user_id = $1', [user_id]);
  return result.rows[0]?.access_token || null;
}

// GPT-compatible Notion query endpoint
app.post('/notion/query', async (req, res) => {
  const { user_id, action, parameters } = req.body;

  if (!user_id) return res.status(400).json({ error: 'Missing user_id' });

  const token = await getTokenForUser(user_id);
  if (!token) return res.status(401).json({ error: 'User not connected to Notion' });

  const headers = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  };

  try {
    switch (action) {
      case 'list_databases': {
        const response = await axios.post('https://api.notion.com/v1/search', {
          filter: { property: 'object', value: 'database' }
        }, { headers });
        return res.json({ databases: response.data.results });
      }

      case 'query_database': {
        const { database_id, filter, sorts } = parameters || {};
        if (!database_id) return res.status(400).json({ error: 'Missing database_id in parameters' });

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

        const response = await axios.patch(
          `https://api.notion.com/v1/pages/${page_id}`,
          { properties },
          { headers }
        );
        return res.json({ page: response.data });
      }

      default:
        return res.status(400).json({ error: `Unsupported action: ${action}` });
    }
  } catch (err) {
    console.error('❌ Notion API failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Notion API query failed' });
  }
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Notion GPT Bridge is live on port ${port}`);
});
