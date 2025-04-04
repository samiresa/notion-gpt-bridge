const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

app.use(express.json());

// Temporary in-memory token store
const tokenStore = {};

// Root route
app.get('/', (req, res) => {
  res.send('Notion GPT Bridge is running.');
});

// DEBUG endpoint
app.post('/debug', (req, res) => {
  console.log('[DEBUG] Request received:', JSON.stringify(req.body, null, 2));
  res.status(200).send('Debug OK');
});

// 🔧 GPT Action Endpoint
app.post('/notion/query', async (req, res) => {
  console.log('[🟢 /notion/query HIT]');
  console.log('Request Body:', JSON.stringify(req.body, null, 2));

  const { user_id, action, parameters = {} } = req.body;
  const token = tokenStore[user_id];

  if (!token) {
    console.warn(`[🔒] No token found for user: ${user_id}`);
    return res.status(401).json({ error: 'User not connected to Notion' });
  }

  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    };

    switch (action) {
      case 'list_databases': {
        const response = await axios.get('https://api.notion.com/v1/search', {
          headers,
          data: {
            filter: {
              value: 'database',
              property: 'object'
            }
          }
        });
        return res.json({ databases: response.data.results });
      }

      case 'query_database': {
        const { database_id, filter } = parameters;
        const response = await axios.post(
          `https://api.notion.com/v1/databases/${database_id}/query`,
          filter || {},
          { headers }
        );
        return res.json({ results: response.data.results });
      }

      case 'create_page': {
        const { parent, properties } = parameters;
        const response = await axios.post(
          `https://api.notion.com/v1/pages`,
          { parent, properties },
          { headers }
        );
        return res.json({ page: response.data });
      }

      case 'update_page': {
        const { page_id, properties } = parameters;
        const response = await axios.patch(
          `https://api.notion.com/v1/pages/${page_id}`,
          { properties },
          { headers }
        );
        return res.json({ page: response.data });
      }

      case 'create_blocks': {
        const { block_id, children } = parameters;
        const response = await axios.patch(
          `https://api.notion.com/v1/blocks/${block_id}/children`,
          { children },
          { headers }
        );
        return res.json({ blocks: response.data });
      }

      case 'create_database': {
        const { parent, title, properties } = parameters;
        const response = await axios.post(
          `https://api.notion.com/v1/databases`,
          { parent, title, properties },
          { headers }
        );
        return res.json({ database: response.data });
      }

      default:
        return res.status(400).json({ error: 'Unsupported action' });
    }
  } catch (err) {
    const data = err.response?.data || err.message;
    console.error('[❌ ERROR]:', data);
    return res.status(500).json({ error: 'Notion API error', details: data });
  }
});

// 🔐 Notion OAuth Initiation
app.get('/notion/connect', (req, res) => {
  const { user_id } = req.query;
  const redirectUri = encodeURIComponent(process.env.REDIRECT_URI);
  const authUrl = `https://api.notion.com/v1/oauth/authorize?owner=workspace&client_id=${process.env.NOTION_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&state=${user_id}`;
  res.redirect(authUrl);
});

// 🔑 OAuth Callback
app.get('/oauth/callback', async (req, res) => {
  const { code, state: user_id } = req.query;

  try {
    const tokenRes = await axios.post(
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

    const accessToken = tokenRes.data.access_token;
    tokenStore[user_id] = accessToken;

    console.log(`🔐 Token stored for user ${user_id}`);
    res.send(`<h2>✅ Connected! Notion integration successful for user: ${user_id}</h2>`);
  } catch (err) {
    const message = err.response?.data || err.message;
    console.error('[OAuth Error]:', message);
    res.status(500).send('OAuth error. Failed to retrieve token.');
  }
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Notion GPT Bridge is running on port ${port}`);
});
