const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// In-memory token store for testing
const tokenStore = {};

app.use(express.json());

// Root
app.get('/', (req, res) => {
  res.send('Notion GPT Bridge is running.');
});

// Start OAuth
app.get('/notion/connect', (req, res) => {
  const { user_id } = req.query;
  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?owner=user&client_id=${process.env.NOTION_CLIENT_ID}&redirect_uri=${process.env.REDIRECT_URI}&response_type=code&state=${user_id}`;
  res.redirect(notionAuthUrl);
});

// Handle OAuth Callback
app.get('/oauth/callback', async (req, res) => {
  const { code, state: user_id } = req.query;

  try {
    const response = await axios.post('https://api.notion.com/v1/oauth/token', {
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.REDIRECT_URI,
    }, {
      auth: {
        username: process.env.NOTION_CLIENT_ID,
        password: process.env.NOTION_CLIENT_SECRET,
      },
      headers: { 'Content-Type': 'application/json' },
    });

    const accessToken = response.data.access_token;
    tokenStore[user_id] = accessToken;

    res.send(`<h2>Success! Your Notion account is connected.</h2>`);
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).send('OAuth Error: Unable to retrieve token.');
  }
});

// Check Connection Status
app.get('/notion/status', (req, res) => {
  const { user_id } = req.query;
  const isConnected = !!tokenStore[user_id];
  res.json({ connected: isConnected });
});

// Query Notion (e.g., list databases)
app.post('/notion/query', async (req, res) => {
  const { user_id, action } = req.body;
  const token = tokenStore[user_id];

  if (!token) {
    return res.status(401).json({ error: 'Not connected to Notion' });
  }

  try {
    if (action === 'list_databases') {
      const response = await axios.get('https://api.notion.com/v1/databases', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
        },
      });
      return res.json(response.data);
    }

    res.status(400).json({ error: 'Unsupported action' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to query Notion API' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
