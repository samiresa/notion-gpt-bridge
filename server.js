const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Temporary in-memory store for tokens
const tokenStore = {};

app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.send('Notion GPT Bridge is running.');
});

// Step 1: Start Notion OAuth flow
app.get('/notion/connect', (req, res) => {
  const { user_id } = req.query;
  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?owner=workspace&client_id=${process.env.NOTION_CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&response_type=code&state=${user_id}`;
  res.redirect(notionAuthUrl);
});

// Step 2: Handle OAuth callback and store access token
app.get('/oauth/callback', async (req, res) => {
  const { code, state: user_id } = req.query;

  try {
    const tokenRes = await axios.post('https://api.notion.com/v1/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.REDIRECT_URI
    }, {
      auth: {
        username: process.env.NOTION_CLIENT_ID,
        password: process.env.NOTION_CLIENT_SECRET
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const accessToken = tokenRes.data.access_token;
    tokenStore[user_id] = accessToken;

    console.log(`🔐 Stored token for user ${user_id}`);
    res.send('<h2>Success! Your Notion account is connected.</h2>');
  } catch (err) {
    console.error('OAuth callback error:', err.response?.data || err.message);
    res.status(500).send('OAuth Error: Unable to retrieve token.');
  }
});

// Check connection status
app.get('/notion/status', (req, res) => {
  const { user_id } = req.query;
  const isConnected = !!tokenStore[user_id];
  res.json({ connected: isConnected });
});

// Core GPT-safe Notion API handler
app.post('/notion/query', async (req, res) => {
  const { user_id, action, parameters } = req.body;
  const token = tokenStore[user_id];

  if (!token) {
    return res.status(401).json({ error: 'User not connected to Notion' });
  }

  try {
    const headers = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    switch (action) {
      case 'list_databases': {
        const response = await axios.post('https://api.notion.com/v1/search', {
          filter: { property: 'object', value: 'database' }
        }, { headers });

        return res.json({ databases: response.data.results });
      }

      case 'query_database': {
        const { database_id, filter, sorts } = parameters || {};
        const response = await axios.post(`https://api.notion.com/v1/databases/${database_id}/query`, {
          filter,
          sorts
        }, { headers });

        return res.json({ results: response.data.results });
      }

      case 'create_page': {
        const { parent, properties } = parameters || {};
        const response = await axios.post('https://api.notion.com/v1/pages', {
          parent,
          properties
        }, { headers });

        return res.json({ page: response.data });
      }

      case 'update_page': {
        const { page_id, properties } = parameters || {};
        const response = await axios.patch(`https://api.notion.com/v1/pages/${page_id}`, {
          properties
        }, { headers });

        return res.json({ page: response.data });
      }

      default:
        return res.status(400).json({ error: 'Unsupported action' });
    }
  } catch (err) {
    console.error('Notion API query failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Notion API query failed' });
  }
});

// Debug route (optional)
app.get('/debug/ping', (req, res) => {
  res.send('✅ This is the live deployed version of server.js');
});

// Start server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
