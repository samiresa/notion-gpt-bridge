const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// In-memory token store (temporary for dev)
const tokenStore = {};

app.use(express.json());

// Root health check
app.get('/', (req, res) => {
  res.send('Notion GPT Bridge is running.');
});

// OAuth Step 1: Redirect user to Notion auth
app.get('/notion/connect', (req, res) => {
  const { user_id } = req.query;
  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?owner=workspace&client_id=${process.env.NOTION_CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&response_type=code&state=${user_id}`;
  res.redirect(notionAuthUrl);
});

// OAuth Step 2: Handle Notion callback and store token
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

// Connection status check
app.get('/notion/status', (req, res) => {
  const { user_id } = req.query;
  const isConnected = !!tokenStore[user_id];
  res.json({ connected: isConnected });
});

// GPT-safe query endpoint
app.post('/notion/query', async (req, res) => {
  const { user_id, action, parameters } = req.body;
  const token = tokenStore[user_id];

  if (!token) {
    return res.status(401).json({ error: 'User not connected to Notion' });
  }

  try {
    if (action === 'list_databases') {
      const response = await axios.post('https://api.notion.com/v1/search', {
        filter: {
          property: "object",
          value: "database"
        }
      }, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        }
      });

      return res.json({ databases: response.data.results });
    }

    res.status(400).json({ error: 'Unsupported action' });
  } catch (err) {
    console.error('Notion API query failed:', err.response?.data || err.message);
    res.status(500).json({ error: 'Notion API query failed' });
  }
});

// Debug route (optional, useful for confirming deployment)
app.get('/debug/ping', (req, res) => {
  res.send('✅ This is the live deployed version of server.js');
});

// Start the server
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
